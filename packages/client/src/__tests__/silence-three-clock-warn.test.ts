// bb-nxqh: confirm the console.warn filter suppresses ONLY the
// THREE.THREE.Clock deprecation string and lets everything else
// through. Tests install the filter on a fresh console-shaped object
// so we don't pollute the process console (which is already filtered
// by the side-effect import).

import { describe, expect, test } from "bun:test"
import {
  installSilenceThreeClockWarn,
  shouldSuppressWarn,
} from "../lib/silence-three-clock-warn"

describe("shouldSuppressWarn", () => {
  test("matches the canonical THREE.THREE.Clock deprecation line", () => {
    expect(
      shouldSuppressWarn([
        "THREE.THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.",
      ]),
    ).toBe(true)
  })

  test("matches when the needle is anywhere in the message", () => {
    expect(shouldSuppressWarn(["prefix THREE.THREE.Clock suffix"])).toBe(true)
  })

  test("does not match other deprecation messages", () => {
    expect(shouldSuppressWarn(["THREE.Geometry has been deprecated"])).toBe(false)
    expect(shouldSuppressWarn(["[posthog] disabled"])).toBe(false)
  })

  test("does not match non-string first arg", () => {
    expect(shouldSuppressWarn([{ msg: "THREE.THREE.Clock" }])).toBe(false)
    expect(shouldSuppressWarn([42, "THREE.THREE.Clock"])).toBe(false)
    expect(shouldSuppressWarn([])).toBe(false)
  })
})

describe("installSilenceThreeClockWarn", () => {
  function makeFakeConsole(): {
    target: { warn: (...args: unknown[]) => void }
    captured: unknown[][]
  } {
    const captured: unknown[][] = []
    const target = {
      warn: (...args: unknown[]) => {
        captured.push(args)
      },
    }
    return { target, captured }
  }

  test("installed filter suppresses THREE.THREE.Clock and forwards everything else", () => {
    const { target, captured } = makeFakeConsole()
    installSilenceThreeClockWarn(target)
    target.warn("THREE.THREE.Clock: deprecated")
    target.warn("Some other warning")
    target.warn({ payload: true })
    expect(captured).toHaveLength(2)
    expect(captured[0]).toEqual(["Some other warning"])
    expect(captured[1]).toEqual([{ payload: true }])
  })

  test("install is idempotent — second call is a no-op", () => {
    const { target, captured } = makeFakeConsole()
    installSilenceThreeClockWarn(target)
    const wrappedAfterFirst = target.warn
    installSilenceThreeClockWarn(target)
    expect(target.warn).toBe(wrappedAfterFirst)
    target.warn("plain message")
    expect(captured).toHaveLength(1)
  })
})
