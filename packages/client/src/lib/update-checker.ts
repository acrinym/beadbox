// Tauri 2 self-update — PUBLIC repo path (beadbox-l5i.6.4, cutover phase D).
//
// The manifest is fetched anonymously from beadbox/beadbox's public releases
// via the plugin's static endpoint (configured in tauri.conf.json
// plugins.updater.endpoints). No token, no auth header, no Rust host.
//
// WHAT RETIRED AND WHY (beadbox-b2p disposition):
// b2p existed solely because github.com/<repo>/releases/latest/download/
// only redirects for PUBLIC repos, so the old private origin repo 404'd. Its
// workaround was a Rust host holding a PAT, resolving the latest.json asset id
// at runtime and driving the plugin with the REST asset-API plus Bearer auth.
// A public repo needs none of that: the static endpoint works, so the entire
// credentialed-fetch half is gone.
//
// WHAT SURVIVES: minisign verification. The plugin natively verifies the
// manifest signature against plugins.updater.pubkey, and that is precisely
// what makes an anonymously-fetchable manifest safe to trust. It is
// orthogonal to WHERE the manifest comes from. The pubkey must not change.
//
// DISTINGUISHABLE OUTCOMES — this is a fix, not a refactor.
// The version shipped in 0.25.x did `await check()` inside a try and returned
// null from the catch: the SAME value it returned for "you are up to date".
// Because that endpoint 404'd on the private repo, every 0.25.x user was told
// they were on the latest version when the check had actually failed. A silent
// false negative is worse than an error, because nobody reports it. This
// module now returns a discriminated union so "failed" and "up to date" are
// different states and the UI can show them differently.

import type { BeadboxUpdateOutcome } from "./window-globals"
import { ensureBeadboxStamp } from "./window-globals"

// Retained for source compat with existing call sites. Endpoint and
// verification live in tauri.conf.json; there is no token to thread.
export interface UpdateCheckOptions {
  repo?: string
  includePrerelease?: boolean
  buildTag?: string
}

export interface UpdateInfo {
  version: string
  releaseUrl: string
  publishedAt: string
  body: string
  changelogContent?: string
}

export type UpdateCheckResult =
  | { status: "update-available"; info: UpdateInfo }
  | { status: "up-to-date" }
  | { status: "check-failed"; message: string }

function isTauriRuntime(): boolean {
  // biome-ignore lint/suspicious/noExplicitAny: window globals
  return typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__
}

function stamp(
  outcome: BeadboxUpdateOutcome,
  ctx: { currentVersion: string; remoteVersion?: string | null },
): void {
  const beadbox = ensureBeadboxStamp()
  if (!beadbox) return
  beadbox.update = {
    lastCheckedAt: new Date().toISOString(),
    outcome,
    repo: "beadbox/beadbox",
    includePrerelease: false,
    currentVersion: ctx.currentVersion,
    buildTag: undefined,
    remoteVersion: ctx.remoteVersion ?? null,
    artifactName: null,
  }
}

export async function checkForUpdate(
  currentVersion: string,
  _options?: UpdateCheckOptions,
): Promise<UpdateCheckResult> {
  // Browser-only mode has no updater. Reporting "up to date" here is honest:
  // there is no update mechanism, not a failed one.
  if (!isTauriRuntime()) {
    stamp("ok_no_update_same_version", { currentVersion })
    return { status: "up-to-date" }
  }

  try {
    const { check } = await import("@tauri-apps/plugin-updater")
    const update = await check()

    if (!update) {
      stamp("ok_no_update_same_version", { currentVersion })
      return { status: "up-to-date" }
    }

    stamp("ok_update_available", { currentVersion, remoteVersion: update.version })
    return {
      status: "update-available",
      info: {
        version: update.version,
        releaseUrl: `https://github.com/beadbox/beadbox/releases/tag/v${update.version}`,
        publishedAt: update.date ?? new Date().toISOString(),
        body: update.body ?? "",
        changelogContent: update.body ?? "",
      },
    }
  } catch (err) {
    // Deliberately NOT collapsed into "up to date". See the header note.
    const message = err instanceof Error ? err.message : String(err)
    stamp("fetch_failed", { currentVersion })
    console.warn("[update-checker] update check failed:", err)
    return { status: "check-failed", message }
  }
}
