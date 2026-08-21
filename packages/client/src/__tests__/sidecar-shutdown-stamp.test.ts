import { describe, expect, test } from "bun:test"
import {
  _parseShutdownLineForTests as parseShutdownLine,
  type ShutdownStamp,
} from "../lib/sidecar-shutdown-stamp"

describe("parseShutdownLine — sigterm_received", () => {
  test("parses signal, pid, ppid as numbers", () => {
    const line = `[bb-0vlu] sigterm_received signal=SIGTERM pid=46864 ppid=46859 parentChain="row1\\nrow2" beadboxProcs="46864 beadbox-sidecar"`
    const out = parseShutdownLine(line)
    expect(out).not.toBeNull()
    expect(out?.signal).toBe("SIGTERM")
    expect(out?.pid).toBe(46864)
    expect(out?.ppid).toBe(46859)
    expect(out?.watchdogEscalated).toBe(false)
    expect(out?.raw).toBe(line)
  })

  test("re-parses JSON-stringified parentChain back to multi-line text", () => {
    const line = `[bb-0vlu] sigterm_received signal=SIGTERM pid=1 ppid=2 parentChain="line one\\nline two\\nline three" beadboxProcs="x"`
    const out = parseShutdownLine(line)
    expect(out?.parentChain).toBe("line one\nline two\nline three")
    expect(out?.beadboxProcs).toBe("x")
  })

  test("handles parentChain with embedded quotes (escaped in the stringified form)", () => {
    const line = `[bb-0vlu] sigterm_received signal=SIGTERM pid=1 ppid=2 parentChain="cmd \\"with quoted arg\\"" beadboxProcs=""`
    const out = parseShutdownLine(line)
    expect(out?.parentChain).toBe('cmd "with quoted arg"')
    expect(out?.beadboxProcs).toBe("")
  })

  test("returns null for non-bb-0vlu lines", () => {
    expect(parseShutdownLine("[beadbox-sidecar] starting pid=1234")).toBeNull()
    expect(parseShutdownLine("[bb-x0il-state] watcher_spawned shellPid=1")).toBeNull()
    expect(parseShutdownLine("")).toBeNull()
  })

  test("missing optional fields render as null without crashing", () => {
    const line = "[bb-0vlu] sigterm_received signal=SIGINT pid=42"
    const out = parseShutdownLine(line)
    expect(out?.signal).toBe("SIGINT")
    expect(out?.pid).toBe(42)
    expect(out?.ppid).toBeNull()
    expect(out?.parentChain).toBeNull()
    expect(out?.beadboxProcs).toBeNull()
  })
})

describe("parseShutdownLine — watchdog escalation", () => {
  test("sets watchdogEscalated and preserves prior sigterm_received fields", () => {
    const sigtermLine =
      '[bb-0vlu] sigterm_received signal=SIGTERM pid=46864 ppid=46859 parentChain="x" beadboxProcs="y"'
    const sigterm = parseShutdownLine(sigtermLine) as ShutdownStamp
    const watchdog = parseShutdownLine(
      "[bb-0vlu] shutdown_watchdog_escalating — process.exit hung past 2s, SIGKILL self",
      sigterm,
    )
    expect(watchdog?.watchdogEscalated).toBe(true)
    expect(watchdog?.signal).toBe("SIGTERM")
    expect(watchdog?.pid).toBe(46864)
    expect(watchdog?.ppid).toBe(46859)
    expect(watchdog?.parentChain).toBe("x")
    expect(watchdog?.raw).toContain("sigterm_received")
    expect(watchdog?.raw).toContain("shutdown_watchdog_escalating")
  })

  test("watchdog without prior sigterm still produces a stamp (degraded)", () => {
    const watchdog = parseShutdownLine(
      "[bb-0vlu] shutdown_watchdog_escalating — process.exit hung past 2s, SIGKILL self",
    )
    expect(watchdog?.watchdogEscalated).toBe(true)
    expect(watchdog?.signal).toBeNull()
    expect(watchdog?.pid).toBeNull()
  })
})
