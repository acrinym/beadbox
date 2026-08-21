// bb-pnk0: tee sidecar stderr to a file in the platform-canonical log dir
// so ops can grep production failures without depending on macOS unified
// log (which quarantines under high volume — burned us during bb-pnlx).
//
// Channel discipline contract is unchanged: stdout is still the kkrpc wire,
// nothing here writes to it. This module ONLY mirrors stderr writes to a
// log file. Callers shouldn't import this directly — console-discipline
// installs the mirror at boot, then the existing console.error /
// process.stderr.write paths produce file content for free.

import { mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

function resolveLogPath(): string {
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Logs", "Beadbox", "beadbox-sidecar.log")
  }
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local")
    return join(localAppData, "Beadbox", "Logs", "beadbox-sidecar.log")
  }
  // Linux + everything else: XDG_STATE_HOME with the spec's fallback.
  const stateHome = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state")
  return join(stateHome, "beadbox", "beadbox-sidecar.log")
}

type FileWriter = ReturnType<ReturnType<typeof Bun.file>["writer"]>
let writer: FileWriter | null = null
let openFailed = false

function openWriter(): FileWriter | null {
  if (writer || openFailed) return writer
  try {
    const path = resolveLogPath()
    mkdirSync(join(path, ".."), { recursive: true })
    // Bun.file().writer() opens in write mode by default; pass the file
    // handle to a Bun writable for append semantics.
    const file = Bun.file(path)
    writer = file.writer({ highWaterMark: 256 })
    // Touch with a session-start marker so log rotation / inspection can
    // tell when this sidecar boot began.
    writer?.write(`\n--- ${new Date().toISOString()} sidecar boot pid=${process.pid} ---\n`)
  } catch (err) {
    openFailed = true
    // One-time stderr warning so the operator knows the file sink is dead.
    // Do NOT use console.error here — discipline.ts wraps that and would
    // re-enter this function. Direct write to the underlying stderr fd.
    process.stderr.write(
      `[beadbox-sidecar] log file unavailable, stderr-only mode: ${err instanceof Error ? err.message : String(err)}\n`,
    )
  }
  return writer
}

export function logFileWrite(line: string): void {
  const w = openWriter()
  if (!w) return
  try {
    w.write(line.endsWith("\n") ? line : `${line}\n`)
    // Flush immediately. Diagnostic logs are low-volume; correctness (a
    // crash leaves a complete log) trumps throughput. Bun's flush returns
    // a number (sync) or Promise<number> (async) — we don't await; fire
    // and forget either form.
    w.flush()
  } catch {
    // Disk full / handle closed mid-process — give up silently. Stderr
    // already has the line via the discipline.ts mirror; logging failure
    // must never crash the sidecar.
  }
}

export function closeLogFile(): void {
  if (!writer) return
  try {
    writer.end()
  } catch {
    /* best-effort flush on shutdown */
  }
  writer = null
}
