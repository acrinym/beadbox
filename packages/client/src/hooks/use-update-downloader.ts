// Self-update downloader hook (beadbox-b2p, option A-3'). Drives the Rust
// host command `updater_download_and_install`, which fetches the private
// asset (Rust holds the token), verifies the .sig against the bundled pubkey,
// and installs in place. Progress arrives over a Tauri Channel whose event
// shape matches what the old plugin JS downloadAndInstall() emitted, so the
// switch below is unchanged.
//
// API note: the contract is now startDownload() with NO argument — there is
// no JS Update object in A-3' (detection + download both live in Rust).

import { useCallback, useState } from "react"

// Mirrors the Rust `DownloadEvent` (adjacently tagged {event, data}). The
// `Finished` variant carries no data.
type DownloadEvent =
  | { event: "Started"; data: { contentLength: number | null } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" }

export type DownloadStatus = "idle" | "downloading" | "installing" | "installed" | "error"

interface DownloadProgress {
  downloaded: number
  total: number
}

interface UseUpdateDownloaderResult {
  status: DownloadStatus
  progress: DownloadProgress
  error: string | null
  filePath: string | null
  platform: string | null
  startDownload: () => Promise<void>
  cancelDownload: () => void
  install: () => Promise<void>
  reset: () => void
}

function detectPlatform(): string | null {
  if (typeof navigator === "undefined") return null
  const p = navigator.platform.toLowerCase()
  if (p.includes("mac")) return "darwin"
  if (p.includes("win")) return "win32"
  if (p.includes("linux")) return "linux"
  return null
}

export function useUpdateDownloader(): UseUpdateDownloaderResult {
  const [status, setStatus] = useState<DownloadStatus>("idle")
  const [progress, setProgress] = useState<DownloadProgress>({ downloaded: 0, total: 0 })
  const [error, setError] = useState<string | null>(null)
  const platform = detectPlatform()

  const startDownload = useCallback(async (): Promise<void> => {
    setError(null)
    setProgress({ downloaded: 0, total: 0 })
    setStatus("downloading")

    try {
      let totalSize = 0
      let downloaded = 0

      const { Channel, invoke } = await import("@tauri-apps/api/core")

      // The Rust command streams Started / Progress / Finished, then installs
      // in place before resolving. After it resolves the new binary is staged;
      // the dialog auto-relaunches via its handleQuit useEffect when
      // status === "installed".
      const onEvent = new Channel<DownloadEvent>()
      onEvent.onmessage = (event) => {
        switch (event.event) {
          case "Started":
            totalSize = event.data.contentLength ?? 0
            setProgress({ downloaded: 0, total: totalSize })
            break
          case "Progress":
            downloaded += event.data.chunkLength
            setProgress({ downloaded, total: totalSize })
            break
          case "Finished":
            setStatus("installing")
            break
        }
      }

      await invoke("updater_download_and_install", { onEvent })

      setStatus("installed")
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error("[updater] download_and_install failed:", err)
      setStatus("error")
      setError(msg)
    }
  }, [])

  const cancelDownload = useCallback((): void => {
    // tauri-plugin-updater 2.x does not expose a public cancel API for an
    // in-flight downloadAndInstall. Best we can do is mark the local state
    // idle so the dialog re-renders; the underlying download finishes in
    // the background and discards the result. Document this limitation.
    setStatus("idle")
    setError(null)
    setProgress({ downloaded: 0, total: 0 })
  }, [])

  const install = useCallback(async (): Promise<void> => {
    // No-op: downloadAndInstall already installed. The dialog's existing
    // useEffect picks up status === "installed" and triggers relaunch via
    // @tauri-apps/plugin-process. Exposed here only because the prior
    // (stub) API exported it.
  }, [])

  const reset = useCallback((): void => {
    setStatus("idle")
    setError(null)
    setProgress({ downloaded: 0, total: 0 })
  }, [])

  return {
    status,
    progress,
    error,
    filePath: null,
    platform,
    startDownload,
    cancelDownload,
    install,
    reset,
  }
}
