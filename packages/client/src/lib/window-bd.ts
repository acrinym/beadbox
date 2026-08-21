// window.bd() global helper restoration (P3.6 / bb-90zz.6).
//
// Mirrors the existing browser-console muscle memory: `await
// window.bd("show", "bb-xyz")` prints colorized bd output to DevTools
// and returns it.
//
// Wire path: main.tsx calls installWindowBd() at module-load (bb-tu1m
// moved this from console-logo.tsx's mount effect when the cosmetic
// dev-console banner was deleted) → rpc.console.run({ args, db:
// window.__BEADBOX__?.db }) → kkrpc → sidecar handlers/console.ts →
// execFile bd against the allowlist.
//
// Security contract (mirrored from handlers/console.ts):
//   The allowlist + arg sanitization ENFORCEMENT is server-side; the helper
//   is intentionally thin. A malicious page could call this directly, but
//   the same boundary applies — the sidecar refuses anything outside
//   ["show", "list", "comments", "dep", "search", "config", "help"].

import { rpc } from "./rpc"

const HELP_TEXT =
  "Usage: await bd('show <id>')\n" + "Allowed: show, list, comments, dep, search, config, help"

async function runBdCommand(args: string[]): Promise<string> {
  if (args.length === 0) {
    console.log("%c" + HELP_TEXT, "color: #fbbf24")
    return HELP_TEXT
  }

  // Read the active workspace path from the URL (?db=) first, falling back
  // to the global StartupGate sets after a workspace is selected.
  const params = new URLSearchParams(window.location.search)
  const db = params.get("db") || window.__BEADBOX__?.db || null

  try {
    const result = await rpc.console.run({ args, db })
    if (result.error) {
      console.log("%c" + result.error, "color: #ef4444")
      return result.error
    }
    const output = (result.stdout || result.stderr || "No output").trim()
    const isError = result.exitCode !== 0
    console.log("%c" + output, isError ? "color: #ef4444" : "color: #a5b4fc; white-space: pre")
    return output
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to execute command"
    console.log("%c" + msg, "color: #ef4444")
    return msg
  }
}

/**
 * Install window.bd as a tagged-template-style helper. Two call shapes:
 *   await bd("show", "bb-xyz")
 *   await bd("show bb-xyz")        // single string is split on whitespace
 */
export function installWindowBd(): void {
  if (typeof window === "undefined") return
  if (window.bd) return // idempotent — calling installWindowBd() twice is a no-op
  window.bd = async (...args: string[]): Promise<string> => {
    // Allow the single-string form for terseness.
    const flat =
      args.length === 1 && args[0].includes(" ") ? args[0].split(/\s+/).filter(Boolean) : args
    return runBdCommand(flat)
  }
}
