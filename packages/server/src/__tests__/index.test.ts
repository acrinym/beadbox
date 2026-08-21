// Smoke tests for the Beadbox Bun sidecar (P1.1).
//
// Two tests:
//   1. Production index.ts boots — emits the boot diagnostic on stderr and
//      stays alive holding stdin open. Validates the empty-registry entry
//      point doesn't crash on startup.
//   2. A fixture sidecar (./fixtures/ping-sidecar.ts) with a single `ping`
//      handler completes a real kkrpc round-trip in under 500ms, proving
//      BunIo + RPCChannel + handler dispatch work end-to-end.
//
// Why two: P1.1 ships an empty handler registry, so we can't call a real
// method against the production entry point. The fixture proves the kkrpc
// machinery; the boot test proves index.ts itself runs.

import { describe, expect, test } from "bun:test"
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { join } from "node:path"
import { NodeIo, RPCChannel } from "kkrpc"

const PACKAGE_ROOT = join(import.meta.dir, "..", "..")
const PROD_ENTRY = join(PACKAGE_ROOT, "src", "index.ts")
const PING_FIXTURE = join(import.meta.dir, "fixtures", "ping-sidecar.ts")

interface PingResult {
  pid: number
  bunVersion: string
  ts: number
}

interface PingApi {
  ping(): Promise<PingResult>
}

function spawnSidecar(entryPath: string): ChildProcessWithoutNullStreams {
  return spawn("bun", ["run", entryPath], {
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams
}

async function awaitStderrLine(
  proc: ChildProcessWithoutNullStreams,
  predicate: (line: string) => boolean,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = ""
    const timer = setTimeout(() => {
      proc.stderr.removeListener("data", onData)
      reject(new Error(`stderr predicate not matched within ${timeoutMs}ms; got: ${buffer}`))
    }, timeoutMs)
    function onData(buf: Buffer): void {
      buffer += buf.toString()
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      for (const line of lines) {
        if (predicate(line)) {
          clearTimeout(timer)
          proc.stderr.removeListener("data", onData)
          resolve(line)
          return
        }
      }
    }
    proc.stderr.on("data", onData)
  })
}

describe("packages/server entry point", () => {
  test("production index.ts boots and emits stderr diagnostic", async () => {
    const proc = spawnSidecar(PROD_ENTRY)
    try {
      const line = await awaitStderrLine(
        proc,
        (l) => l.startsWith("[beadbox-sidecar] starting"),
        2000,
      )
      expect(line).toMatch(/pid=\d+/)
      expect(line).toMatch(/bun=/)
      // Process is still alive — kkrpc is listening on stdin.
      expect(proc.exitCode).toBeNull()
    } finally {
      proc.kill("SIGTERM")
    }
  })

  test("kkrpc round-trip through fixture sidecar completes under 500ms", async () => {
    const proc = spawnSidecar(PING_FIXTURE)
    // Drain stderr to nothing so the buffer doesn't fill and stall.
    proc.stderr.on("data", (buf: Buffer) => {
      // Echo for test debugging only.
      process.stderr.write(`[fixture stderr] ${buf.toString()}`)
    })
    const io = new NodeIo(proc.stdout, proc.stdin)
    const channel = new RPCChannel<Record<string, never>, PingApi>(io)
    try {
      const remote = channel.getAPI()
      const start = Date.now()
      const res = await remote.ping()
      const elapsed = Date.now() - start

      expect(res.pid).toBeGreaterThan(0)
      expect(res.pid).not.toBe(process.pid)
      expect(res.bunVersion.length).toBeGreaterThan(0)
      expect(elapsed).toBeLessThan(500)
    } finally {
      channel.destroy()
      proc.kill("SIGTERM")
    }
  })
})
