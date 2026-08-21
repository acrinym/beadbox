// Subscribe stderr-writer burst tests.
//
// History: this file used to compare the new sidecar change-detector
// against the legacy Next.js broadcast manager (parity contract during the
// migration window). P4.4 deleted the legacy broadcast manager — there is
// no second transport to compare against anymore. The legacy describe()
// block was removed; what remains is the burst test that exercises the
// stderr-line writer in isolation.
//
// The burst test stays because it pins down the writer behavior the
// tauri-plugin-js bridge depends on: 1000 events written via
// process.stderr.write must arrive as 1000 newline-terminated lines on the
// receiving side without interleaving or drops.

import { describe, expect, test } from "bun:test"
import type { ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import { join, sep } from "node:path"

import {
  formatLine,
  parseLine,
  SUBSCRIPTION_PREFIX,
  type SubscriptionEvent,
} from "../subscribe-protocol"

describe("subscribe stderr writer burst", () => {
  test("1000-event burst: every line round-trips through formatLine/parseLine", () => {
    const id = "00000000-0000-0000-0000-000000000abc"
    const written: string[] = []

    const events: SubscriptionEvent[] = []
    for (let i = 0; i < 1000; i++) {
      events.push({ type: "change", timestamp: i, trigger: `seq-${i}` })
    }

    for (const e of events) {
      written.push(formatLine(id, e))
    }

    expect(written).toHaveLength(1000)
    for (let i = 0; i < written.length; i++) {
      expect(written[i].endsWith("\n")).toBe(true)
      const parsed = parseLine(written[i])
      expect(parsed).not.toBeNull()
      expect(parsed!.id).toBe(id)
      expect(parsed!.payload.type).toBe("change")
      const payload = parsed!.payload as Extract<SubscriptionEvent, { type: "change" }>
      expect(payload.timestamp).toBe(i)
      expect(payload.trigger).toBe(`seq-${i}`)
    }
  })

  test("1000-event burst: process.stderr.write does not interleave or drop", async () => {
    // Spawn a Bun subprocess that writes 1000 SUBSCRIPTION lines and exits.
    // Capture stderr; assert exactly 1000 well-formed lines arrive.
    const { handlerScript } = makeBurstScript()
    const proc = (await import("node:child_process")).spawn("bun", ["run", "-"], {
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcess
    proc.stdin!.write(handlerScript)
    proc.stdin!.end()

    let stderrBuf = ""
    proc.stderr!.on("data", (d: Buffer) => {
      stderrBuf += d.toString()
    })
    const exitCode: number = await new Promise((r) => proc.on("exit", (c) => r(c ?? 0)))
    expect(exitCode).toBe(0)

    const lines = stderrBuf.split("\n").filter((l) => l.startsWith(SUBSCRIPTION_PREFIX))
    expect(lines).toHaveLength(1000)
    for (let i = 0; i < lines.length; i++) {
      const parsed = parseLine(lines[i] + "\n")
      expect(parsed).not.toBeNull()
      const payload = parsed!.payload as Extract<SubscriptionEvent, { type: "change" }>
      expect(payload.timestamp).toBe(i)
    }
  }, 15_000)
})

function makeBurstScript(): { handlerScript: string } {
  // Inline Bun script that imports the protocol module via absolute path and
  // emits 1000 lines through process.stderr.write. Absolute path keeps this
  // self-contained — the test can run from any cwd.
  const protocolPath = join(__dirname, "..", "subscribe-protocol.ts")
  // Normalize Windows separators for the source string.
  const importPath = protocolPath.split(sep).join("/")
  if (!existsSync(protocolPath)) {
    throw new Error(`subscribe-protocol.ts not found at ${protocolPath}`)
  }
  const handlerScript = [
    `import { formatLine } from "${importPath}"`,
    `const id = "00000000-0000-0000-0000-000000000abc"`,
    `for (let i = 0; i < 1000; i++) {`,
    `  process.stderr.write(formatLine(id, { type: "change", timestamp: i }))`,
    `}`,
  ].join("\n")
  return { handlerScript }
}
