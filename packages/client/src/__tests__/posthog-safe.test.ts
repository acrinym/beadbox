// bb-mhh1.2: tests for the shared safeCapture wrapper. Mirrors the
// failure-mode coverage from bb-on9h's subscribe.test.ts cases (capture
// undefined / capture throws) but exercises the helper directly so the
// contract is asserted at the module boundary, not just at the
// subscription call site.
//
// Approach mirrors bb-on9h: stub posthog.capture in place via the
// imported module singleton. posthog-js is a real CommonJS module here;
// per-module mock indirection isn't needed because the helper reads
// `posthog.capture` at call time, not at module-evaluation time.

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import posthog from "posthog-js"
import { _resetSafeCaptureWarned, safeCapture } from "../lib/posthog-safe"

describe("safeCapture (bb-mhh1.2 shared guard)", () => {
  let originalCapture: typeof posthog.capture | undefined
  let warnSpy: ReturnType<typeof mock>

  beforeEach(() => {
    originalCapture = posthog.capture
    _resetSafeCaptureWarned()
    warnSpy = mock(() => {})
    // biome-ignore lint/suspicious/noExplicitAny: console.warn override
    ;(console as any).warn = warnSpy
  })

  afterEach(() => {
    ;(posthog as { capture?: unknown }).capture = originalCapture
  })

  test("forwards eventName + props when posthog.capture is a function", () => {
    const captureSpy = mock(() => {})
    ;(posthog as { capture?: unknown }).capture = captureSpy

    safeCapture("test_event", { foo: "bar", count: 42 })

    expect(captureSpy).toHaveBeenCalledTimes(1)
    expect(captureSpy).toHaveBeenCalledWith("test_event", { foo: "bar", count: 42 })
    expect(warnSpy).not.toHaveBeenCalled()
  })

  test("no-op + warn-once when posthog.capture is undefined (pre-init / SDK never loaded)", () => {
    ;(posthog as { capture?: unknown }).capture = undefined

    expect(() => safeCapture("test_event", { x: 1 })).not.toThrow()
    expect(() => safeCapture("test_event_2")).not.toThrow()

    // The contract is once per session (per module load). Two calls,
    // one warn — proves the gate.
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0]).toContain("posthog.capture unavailable")
  })

  test("no-op + warn-once when posthog.capture throws (transport/SDK runtime error)", () => {
    const captureThrow = mock(() => {
      throw new Error("posthog transport down")
    })
    ;(posthog as { capture?: unknown }).capture = captureThrow

    expect(() => safeCapture("test_event", { x: 1 })).not.toThrow()
    expect(() => safeCapture("test_event_2")).not.toThrow()

    // capture WAS attempted both times (try block runs first), but the
    // warn-once gate fires only on the first throw.
    expect(captureThrow).toHaveBeenCalledTimes(2)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0]).toContain("posthog.capture threw")
  })
})
