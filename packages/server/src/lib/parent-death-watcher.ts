// Sidecar parent-death watcher.
//
// Two surfaces in this module:
//
//   1. `startParentDeathWatcher(opts)` — main-thread polling watcher.
//      Empirically observed (bb-6x9y smoke): kkrpc's BunIo stdin reader
//      blocks Bun's setTimeout/setInterval entirely. This main-thread
//      version still works in pure-test contexts (no kkrpc loop) and
//      stays for unit-testability + future use cases without kkrpc.
//
//   2. `startParentDeathWatcherViaShell(opts)` — shell-spawn variant
//      that runs `/bin/sh -c "while kill -0 PARENT; do sleep N; done;
//      kill -SIG MAIN"` as a child process. The shell child has its own
//      scheduler — immune to the BunIo stdin reader blocking the main
//      thread's timers. This is what index.ts uses in the real sidecar.
//
// History (bb-x0il):
//   bb-6x9y originally shipped a Bun Worker variant
//   (`startParentDeathWatcherInWorker`). That worked under `bun
//   packages/server/src/index.ts` (dev) but silently failed under
//   `bun build --compile` (production): Bun's compile mode does NOT
//   bundle worker files referenced via
//   `new Worker(new URL("./worker.ts", import.meta.url))`. The compiled
//   Mach-O contained the Worker constructor call but not the worker
//   file's bytes, so at runtime the Worker had nothing to execute and
//   the watcher silently no-op'd. ops Phase 2 T1.4 caught the gap on
//   rc.9 (sidecar surviving 15s+ at ~100% CPU after Tauri parent kill).
//   Replaced with shell-spawn — /bin/sh + kill are OS-provided so no
//   bundling concern.

const DEFAULT_INTERVAL_MS = 5000
const DEFAULT_INTERVAL_SEC = 5

export interface ParentDeathWatcherOptions {
  /** Poll interval (default 5000ms). */
  intervalMs?: number
  /** Override the death-action (default: SIGTERM self). Useful for tests. */
  onDeath?: () => void
  /** Override the ppid source (default: () => process.ppid). Useful for tests. */
  ppidProvider?: () => number
}

/**
 * Starts a polling watcher that triggers `onDeath` when the parent
 * process dies. Returns a stop function (for tests + clean shutdown).
 *
 * If the initial ppid is already 1 (e.g. sidecar started as a daemon),
 * the watcher is a no-op — there's no parent to watch.
 */
export function startParentDeathWatcher(opts: ParentDeathWatcherOptions = {}): () => void {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS
  const ppidProvider = opts.ppidProvider ?? (() => process.ppid)
  const onDeath =
    opts.onDeath ??
    (() => {
      process.kill(process.pid, "SIGTERM")
    })

  const initialPpid = ppidProvider()
  if (initialPpid === 1) {
    return () => {}
  }

  let fired = false
  let cancelled = false
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null

  const tick = () => {
    if (fired || cancelled) return
    const current = ppidProvider()
    if (current === 1 || current !== initialPpid) {
      fired = true
      process.stderr.write(
        `[beadbox-sidecar] parent died (initialPpid=${initialPpid} currentPpid=${current}); shutting down\n`,
      )
      onDeath()
      return
    }
    timeoutHandle = setTimeout(tick, intervalMs)
  }
  timeoutHandle = setTimeout(tick, intervalMs)

  return () => {
    cancelled = true
    if (timeoutHandle !== null) clearTimeout(timeoutHandle)
  }
}

export interface ShellWatcherOptions {
  /** Sleep seconds between probes inside the shell loop (default 5). Min 1. */
  intervalSec?: number
  /** Override the parent PID (default: process.ppid). Useful for tests. */
  parentPid?: number
  /** Override the main PID the shell signals on death (default: process.pid). */
  mainPid?: number
  /**
   * Signal the shell sends to mainPid on parent death.
   *   - "KILL" (default, prod): bypass main's blocked event loop.
   *   - "TERM": let main's handler run cleanup IF its event loop is responsive.
   */
  signal?: "KILL" | "TERM"
}

/**
 * Shell-spawn variant. Spawns a tiny shell child running a tight polling
 * loop that exits when the parent disappears, then signals mainPid.
 *
 * Platform-aware:
 *   - POSIX (macOS/Linux): `/bin/sh -c "while kill -0 PARENT; do sleep N;
 *     done; kill -SIG MAIN"`.
 *   - Windows: `powershell -NoProfile -Command "while (Get-Process -Id
 *     PARENT -ErrorAction SilentlyContinue) { Start-Sleep -Seconds N };
 *     Stop-Process -Id MAIN -Force"`. powershell.exe is on Windows's
 *     System32 PATH so Bun.spawn finds it without bundling.
 *
 * Both survive `bun build --compile` because the shell binaries are
 * OS-provided. Before beadbox-cdi the POSIX path was hard-coded and
 * Bun.spawn('/bin/sh') threw ENOENT on Windows, leaving zombie sidecars
 * after every Tauri parent exit and starving the renderer of subsequent
 * subscription events.
 *
 * Returns a stop function that terminates the shell child.
 *
 * No-op when parentPid === 1 (daemon-style start, no parent to watch).
 */
export function startParentDeathWatcherViaShell(opts: ShellWatcherOptions = {}): () => void {
  const intervalSec = Math.max(1, Math.floor(opts.intervalSec ?? DEFAULT_INTERVAL_SEC))
  const parentPid = opts.parentPid ?? process.ppid
  const mainPid = opts.mainPid ?? process.pid
  const signal = opts.signal ?? "KILL"

  if (parentPid === 1) {
    process.stderr.write(
      `[bb-x0il-state] watcher_skipped reason=parent_pid_1 mainPid=${mainPid}\n`,
    )
    return () => {}
  }

  const isWindows = process.platform === "win32"
  const command: string[] = isWindows
    ? [
        "powershell",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `while (Get-Process -Id ${parentPid} -ErrorAction SilentlyContinue) { Start-Sleep -Seconds ${intervalSec} }; Stop-Process -Id ${mainPid} -Force`,
      ]
    : [
        "/bin/sh",
        "-c",
        // POSIX: while `kill -0 PARENT` succeeds, sleep. When it fails
        // (parent gone), signal mainPid and exit. `2>/dev/null` swallows
        // the "No such process" stderr from kill -0 once the parent dies.
        `while kill -0 ${parentPid} 2>/dev/null; do sleep ${intervalSec}; done; kill -${signal} ${mainPid}`,
      ]

  try {
    const child = Bun.spawn(command, {
      stdio: ["ignore", "ignore", "ignore"],
    })
    process.stderr.write(
      `[bb-x0il-state] watcher_spawned shellPid=${child.pid} parentPid=${parentPid} mainPid=${mainPid} intervalSec=${intervalSec} signal=${signal} platform=${process.platform}\n`,
    )
    return () => {
      try {
        child.kill()
      } catch {
        /* shell may have already exited */
      }
    }
  } catch (err) {
    process.stderr.write(
      `[bb-x0il-state] watcher_spawn_failed parentPid=${parentPid} mainPid=${mainPid} err=${String(err)}\n`,
    )
    return () => {}
  }
}
