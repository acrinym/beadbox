// Resource leak gate for subscribe.start / subscribe.stop.
//
// The bead's hard contract: every resource acquired by a subscription must
// be released when stop() returns. If a watcher leaks, it accumulates per
// route mount/unmount in P3 and only surfaces under user navigation
// patterns — far more expensive to debug then.
//
// What we measure:
//   - Active handles: process._getActiveHandles().length is Bun's nearest
//     equivalent to "things keeping the event loop alive". fs.FSWatcher,
//     setInterval, setTimeout all count.
//   - dolt-pool cache size: connections opened by the server-mode poll
//     must be drained on stop.
//   - Active subscriptions in the handler module: stop() must remove
//     the id from the registry.
//
// Tolerance: handle counts can fluctuate by 1-2 across the test (Bun
// internal timers, GC). We assert the *delta* between baseline and
// post-stop is zero or negative — strictly no growth.

import { afterEach, describe, expect, test } from "bun:test"
import { execFile } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

import { start, stop } from "../handlers/subscribe"
import { _activeIds, _resetWriter, _setWriter } from "../handlers/subscribe-internals"
import { __getPoolCacheSize } from "../lib/dolt-pool"

const execFileAsync = promisify(execFile)

type CleanupFn = () => Promise<void> | void
const pendingCleanup: CleanupFn[] = []

afterEach(async () => {
  while (pendingCleanup.length > 0) {
    const fn = pendingCleanup.pop()!
    try {
      await fn()
    } catch {
      /* test-only cleanup */
    }
  }
  _resetWriter()
})

// bb-yelc defense-in-depth: strip git's hook-injected GIT_* env so this
// fixture works under the husky pre-push hook even if the hook-level
// strip is removed. See activity.unit.test.ts NO_GIT_ENV for context.
const NO_GIT_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")),
) as NodeJS.ProcessEnv

async function bdInit(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "p1-6-leak-"))
  await execFileAsync("bd", ["init", "--skip-hooks", "--skip-agents"], {
    cwd: dir,
    env: NO_GIT_ENV,
  })
  pendingCleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

interface ProcessWithHandles extends NodeJS.Process {
  _getActiveHandles?: () => unknown[]
}

function activeHandleCount(): number {
  const p = process as ProcessWithHandles
  if (typeof p._getActiveHandles !== "function") return 0
  return p._getActiveHandles().length
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

describe("subscribe leak gate", () => {
  test("start then stop returns all resources to baseline", async () => {
    const workspace = await bdInit()
    const beadsDir = join(workspace, ".beads")

    // Suppress writer so test stderr stays clean.
    _setWriter(() => {})

    // Settle: wait for any pre-test timers (afterEach cleanups from other
    // suites) to drain before snapshotting baselines.
    await sleep(50)

    const baselineHandles = activeHandleCount()
    const baselinePool = __getPoolCacheSize()
    const baselineActive = _activeIds().length

    const { id } = await start(beadsDir)
    expect(_activeIds()).toContain(id)
    expect(_activeIds().length).toBe(baselineActive + 1)

    // Let the detector spin up its watcher and (would-be) poll cycle.
    await sleep(150)
    const peakHandles = activeHandleCount()
    expect(peakHandles).toBeGreaterThan(baselineHandles - 2)

    await stop(id)

    // Allow any straggling timer callbacks to drain.
    await sleep(150)

    const postHandles = activeHandleCount()
    const postPool = __getPoolCacheSize()
    const postActive = _activeIds().length

    expect(postActive).toBe(baselineActive)
    expect(_activeIds()).not.toContain(id)
    expect(postPool).toBe(baselinePool)
    // Strictly no growth in active handles; small fluctuation downward is OK.
    expect(postHandles - baselineHandles).toBeLessThanOrEqual(0)
  }, 15_000)

  test("stop is idempotent on unknown id", async () => {
    await stop("does-not-exist")
    await stop("00000000-0000-0000-0000-000000000000")
    expect(_activeIds()).toEqual([])
  })

  test("multiple subscriptions on same workspace each clean up", async () => {
    const workspace = await bdInit()
    const beadsDir = join(workspace, ".beads")

    _setWriter(() => {})
    await sleep(50)

    const baselineHandles = activeHandleCount()
    const baselineActive = _activeIds().length

    const a = await start(beadsDir)
    const b = await start(beadsDir)
    const c = await start(beadsDir)

    expect(_activeIds().length).toBe(baselineActive + 3)
    expect(new Set([a.id, b.id, c.id]).size).toBe(3)

    await sleep(150)
    await stop(a.id)
    await stop(b.id)
    await stop(c.id)
    await sleep(150)

    expect(_activeIds().length).toBe(baselineActive)
    expect(activeHandleCount() - baselineHandles).toBeLessThanOrEqual(0)
  }, 20_000)
})
