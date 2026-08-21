import { describe, expect, test } from "bun:test"
import { _parseStateLineForTests as parseStateLine } from "../lib/sidecar-watcher-stamp"

describe("parseStateLine", () => {
  test("parses watcher_spawned line with all fields", () => {
    const line =
      "[bb-x0il-state] watcher_spawned shellPid=91017 parentPid=90984 mainPid=90986 intervalSec=5 signal=KILL"
    const out = parseStateLine(line)
    expect(out).not.toBeNull()
    expect(out?.status).toBe("watcher_spawned")
    expect(out?.shellPid).toBe(91017)
    expect(out?.parentPid).toBe(90984)
    expect(out?.mainPid).toBe(90986)
    expect(out?.intervalSec).toBe(5)
    expect(out?.signal).toBe("KILL")
    expect(out?.reason).toBeNull()
    expect(out?.raw).toBe(line)
  })

  test("parses watcher_skipped line", () => {
    const line = "[bb-x0il-state] watcher_skipped reason=parent_pid_1 mainPid=90478"
    const out = parseStateLine(line)
    expect(out?.status).toBe("watcher_skipped")
    expect(out?.reason).toBe("parent_pid_1")
    expect(out?.mainPid).toBe(90478)
    expect(out?.shellPid).toBeNull()
    expect(out?.parentPid).toBeNull()
  })

  test("parses watcher_spawn_failed line", () => {
    const line =
      "[bb-x0il-state] watcher_spawn_failed parentPid=12345 mainPid=67890 err=ENOENT"
    const out = parseStateLine(line)
    expect(out?.status).toBe("watcher_spawn_failed")
    expect(out?.parentPid).toBe(12345)
    expect(out?.mainPid).toBe(67890)
  })

  test("returns null for non-matching line", () => {
    expect(parseStateLine("[bd] update completed in 200ms")).toBeNull()
    expect(parseStateLine("[beadbox-sidecar] starting pid=1234")).toBeNull()
    expect(parseStateLine("")).toBeNull()
  })

  test("classifies unknown status as 'unknown' but still parses kv pairs", () => {
    const line = "[bb-x0il-state] something_new shellPid=42 mainPid=99"
    const out = parseStateLine(line)
    expect(out?.status).toBe("unknown")
    expect(out?.shellPid).toBe(42)
    expect(out?.mainPid).toBe(99)
  })

  test("non-numeric values render as null", () => {
    const line = "[bb-x0il-state] watcher_spawned shellPid=abc parentPid=oops"
    const out = parseStateLine(line)
    expect(out?.shellPid).toBeNull()
    expect(out?.parentPid).toBeNull()
  })
})
