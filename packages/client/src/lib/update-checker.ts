// Tauri 2 self-update — private-repo path (beadbox-b2p, option A-3').
//
// Detection now runs through a Rust host command (`updater_check`) rather than
// the plugin's JS `check()`. The private nmelo/beadbox repo cannot be reached
// by the plugin's static github.com endpoint (404 anonymously); the Rust host
// holds a scope-minimized PAT, resolves the latest.json asset id at runtime,
// and drives tauri-plugin-updater with the asset-API endpoint + auth headers.
// The plugin still does native minisign verification + install + relaunch.
//
// Download is driven by `updater_download_and_install` (see
// hooks/use-update-downloader.ts); the token never enters this WebView bundle.

import type { BeadboxUpdateOutcome } from "./window-globals"
import { ensureBeadboxStamp } from "./window-globals"

// Preserved for source compat with callers (use-update-checker.ts) that still
// thread config in. All fields are no-ops in A-3' — endpoint + auth live in
// the Rust host. Kept so existing call sites compile without churn.
export interface UpdateCheckOptions {
  repo?: string
  includePrerelease?: boolean
  token?: string
  buildTag?: string
}

export interface UpdateInfo {
  version: string
  releaseUrl: string
  publishedAt: string
  body: string
  changelogContent?: string
}

// Shape returned by the Rust `updater_check` command (snake_case crosses the
// IPC boundary verbatim from serde).
interface UpdateMeta {
  version: string
  current_version: string
  body: string | null
  date: string | null
}

function isTauriRuntime(): boolean {
  // biome-ignore lint/suspicious/noExplicitAny: window globals
  return typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
}

function stamp(
  outcome: BeadboxUpdateOutcome,
  ctx: {
    currentVersion: string
    remoteVersion?: string | null
  },
): void {
  const beadbox = ensureBeadboxStamp()
  if (!beadbox) return
  beadbox.update = {
    lastCheckedAt: new Date().toISOString(),
    outcome,
    repo: "(rust-host updater)",
    includePrerelease: false,
    currentVersion: ctx.currentVersion,
    buildTag: undefined,
    remoteVersion: ctx.remoteVersion ?? null,
    artifactName: null,
  }
}

// `_options` is retained but ignored — endpoint + auth are configured in the
// Rust host (updater.rs), not here.
export async function checkForUpdate(
  currentVersion: string,
  _options?: UpdateCheckOptions,
): Promise<UpdateInfo | null> {
  if (!isTauriRuntime()) {
    stamp("ok_no_update_same_version", { currentVersion })
    return null
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core")
    const meta = await invoke<UpdateMeta | null>("updater_check")
    if (!meta) {
      stamp("ok_no_update_same_version", { currentVersion })
      return null
    }

    const info: UpdateInfo = {
      version: meta.version,
      releaseUrl: `https://github.com/nmelo/beadbox/releases/tag/v${meta.version}`,
      publishedAt: meta.date ?? new Date().toISOString(),
      body: meta.body ?? "",
      changelogContent: meta.body ?? "",
    }
    stamp("ok_update_available", { currentVersion, remoteVersion: meta.version })
    return info
  } catch (err) {
    stamp("checker_threw", { currentVersion })
    console.warn("[update-checker] updater_check failed:", err)
    return null
  }
}
