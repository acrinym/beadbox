// Test-only sidecar fixture. Mirrors src/index.ts but exposes a single
// `ping` handler so the smoke test can exercise a real kkrpc round-trip.
//
// The production index.ts ships with an empty handler registry in P1.1 —
// P1.[2-6] add real namespaces. Until then, "real kkrpc round-trip" coverage
// is provided by spawning this fixture instead of the production entrypoint.
// This keeps production code uncontaminated by test-only handlers.

import { BunIo, RPCChannel } from "kkrpc"

interface PingResult {
  pid: number
  bunVersion: string
  ts: number
}

interface PingApi {
  ping(): Promise<PingResult>
}

const api: PingApi = {
  async ping(): Promise<PingResult> {
    return { pid: process.pid, bunVersion: Bun.version, ts: Date.now() }
  },
}

process.stderr.write(
  `[beadbox-sidecar:ping-fixture] starting pid=${process.pid} bun=${Bun.version}\n`,
)

const io = new BunIo(Bun.stdin.stream())
const channel = new RPCChannel<PingApi, Record<string, never>, BunIo>(io, {
  expose: api,
})
void channel
