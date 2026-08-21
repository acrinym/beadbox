import { afterEach, describe, expect, it, mock } from "bun:test"
import {
  startParentDeathWatcher,
  startParentDeathWatcherViaShell,
} from "../lib/parent-death-watcher"

// Helpers to build a watcher with deterministic ppid + onDeath, polling
// at a tight 5ms interval so tests resolve in tens of ms.

function makeWatcher(opts: {
  initialPpid: number
  ppids: number[] // sequence returned by successive ppidProvider() calls
}) {
  const onDeath = mock(() => {})
  let i = 0
  const ppidProvider = () => {
    if (i === 0) {
      i++
      return opts.initialPpid
    }
    const p = opts.ppids[Math.min(i - 1, opts.ppids.length - 1)]
    i++
    return p
  }
  const stop = startParentDeathWatcher({ intervalMs: 5, onDeath, ppidProvider })
  return { onDeath, stop }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

describe("startParentDeathWatcher", () => {
  const stops: Array<() => void> = []
  afterEach(() => {
    while (stops.length) stops.pop()?.()
  })

  it("returns no-op when initial ppid is 1 (daemon-style start)", async () => {
    const { onDeath, stop } = makeWatcher({ initialPpid: 1, ppids: [1, 1, 1] })
    stops.push(stop)
    await sleep(30)
    expect(onDeath).not.toHaveBeenCalled()
  })

  it("does NOT trigger onDeath while ppid stays unchanged", async () => {
    const { onDeath, stop } = makeWatcher({ initialPpid: 12345, ppids: [12345, 12345, 12345] })
    stops.push(stop)
    await sleep(30)
    expect(onDeath).not.toHaveBeenCalled()
  })

  it("triggers onDeath when ppid transitions to 1 (orphaned to launchd/init)", async () => {
    const { onDeath, stop } = makeWatcher({ initialPpid: 12345, ppids: [1, 1] })
    stops.push(stop)
    await sleep(30)
    expect(onDeath).toHaveBeenCalledTimes(1)
  })

  it("triggers onDeath when ppid changes to a different non-1 parent", async () => {
    const { onDeath, stop } = makeWatcher({ initialPpid: 12345, ppids: [99999, 99999] })
    stops.push(stop)
    await sleep(30)
    expect(onDeath).toHaveBeenCalledTimes(1)
  })

  it("only fires onDeath once even on continued polls", async () => {
    const { onDeath, stop } = makeWatcher({ initialPpid: 12345, ppids: [1, 1, 1, 1, 1] })
    stops.push(stop)
    await sleep(60)
    expect(onDeath).toHaveBeenCalledTimes(1)
  })

  it("stop() prevents further onDeath calls", async () => {
    const { onDeath, stop } = makeWatcher({ initialPpid: 12345, ppids: [12345, 12345, 1, 1] })
    stop()
    await sleep(30)
    expect(onDeath).not.toHaveBeenCalled()
  })
})

// bb-x0il: integration tests for the shell-spawn watcher. We can't fake
// /bin/sh, so each test spawns a real victim child (sleep 30) and asserts
// the watcher kills it within a bounded window after the configured
// "parent" disappears.

async function isAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitDead(pid: number, budgetMs: number): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < budgetMs) {
    if (!(await isAlive(pid))) return true
    await sleep(50)
  }
  return false
}

describe("startParentDeathWatcherViaShell", () => {
  it("returns no-op when parentPid is 1 (no shell spawned)", () => {
    // Sanity: with parentPid=1 the watcher must not throw or attach a
    // child it can't terminate. The returned stop() is also a no-op.
    const stop = startParentDeathWatcherViaShell({ parentPid: 1 })
    stop()
  })

  it("kills mainPid when the configured parent does not exist", async () => {
    // Spawn a victim sleep child to play the role of "main".
    const victim = Bun.spawn(["/bin/sh", "-c", "sleep 30"], {
      stdio: ["ignore", "ignore", "ignore"],
    })
    expect(victim.pid).toBeGreaterThan(0)
    expect(await isAlive(victim.pid)).toBe(true)

    // Parent PID is impossible (well above the 32-bit max PID range on
    // macOS and Linux) — kill -0 will fail immediately, watcher signals
    // the victim within ~1 sleep cycle.
    const stop = startParentDeathWatcherViaShell({
      parentPid: 9_999_999,
      mainPid: victim.pid,
      intervalSec: 1,
      signal: "KILL",
    })

    const died = await waitDead(victim.pid, 5_000)
    stop()
    expect(died).toBe(true)
  }, 8000)

  it("does NOT kill mainPid while the configured parent is alive", async () => {
    const victim = Bun.spawn(["/bin/sh", "-c", "sleep 30"], {
      stdio: ["ignore", "ignore", "ignore"],
    })
    expect(victim.pid).toBeGreaterThan(0)

    // Use the test process's own PID — guaranteed alive for the test duration.
    const stop = startParentDeathWatcherViaShell({
      parentPid: process.pid,
      mainPid: victim.pid,
      intervalSec: 1,
      signal: "KILL",
    })

    await sleep(2_500)
    expect(await isAlive(victim.pid)).toBe(true)

    stop()
    victim.kill()
    await waitDead(victim.pid, 2_000)
  }, 6000)

  it("stop() terminates the shell child so it can't kill mainPid later", async () => {
    // beadbox-l5i.1 / qa1: this test used to pass parentPid: 9_999_999 and
    // rely on stop() landing "before the first sleep elapses". That premise
    // was wrong. The shell runs
    //     while kill -0 <parent> 2>/dev/null; do sleep N; done; kill -KILL <main>
    // and `kill -0` against an impossible pid fails IMMEDIATELY, so the loop
    // body never runs and the shell kills mainPid at once — there is no
    // interval-length grace period at all. The test therefore only passed by
    // winning a race between Bun.spawn returning and the shell's first
    // instruction: a fast machine wins it, a loaded 2-core hosted runner
    // loses it, and the victim dies (observed: assertion failed at ~6002ms,
    // which is the assertion, not the 10s timeout).
    //
    // Restructured so no race exists in either direction: give the watcher a
    // parent that is genuinely ALIVE, so the shell provably enters its sleep
    // loop and cannot kill anything yet. stop() it there, then kill the
    // parent. If stop() had failed, the surviving shell would observe the
    // dead parent within one interval (1s) and kill the victim; asserting the
    // victim is still alive well past that proves stop() did its job.
    const parent = Bun.spawn(["/bin/sh", "-c", "sleep 30"], {
      stdio: ["ignore", "ignore", "ignore"],
    })
    const victim = Bun.spawn(["/bin/sh", "-c", "sleep 30"], {
      stdio: ["ignore", "ignore", "ignore"],
    })
    expect(parent.pid).toBeGreaterThan(0)
    expect(victim.pid).toBeGreaterThan(0)

    const stop = startParentDeathWatcherViaShell({
      parentPid: parent.pid,
      mainPid: victim.pid,
      intervalSec: 1,
      signal: "KILL",
    })
    stop()

    // Now remove the parent. A live watcher would react within ~1 interval.
    parent.kill()
    await waitDead(parent.pid, 3_000)

    // Several intervals past the parent's death.
    await sleep(3_000)
    expect(await isAlive(victim.pid)).toBe(true)

    victim.kill()
    await waitDead(victim.pid, 3_000)
  }, 20_000)
})
