// Unit tests for handler-timeout.ts (bb-3pqz).
//
// Uses short timeouts (50ms) so the test suite stays fast. The default
// production timeout (30s) is exercised via the kkrpc round-trip in
// production; here we only validate the primitive's contract.

import { describe, expect, test } from "bun:test"

import {
  HandlerTimeoutError,
  __TEST_DEFAULT_TIMEOUT_MS,
  withHandlerTimeout,
  wrapNamespace,
} from "../lib/handler-timeout"

const SHORT_MS = 50
const SHORTER_MS = 10

describe("withHandlerTimeout", () => {
  test("resolves with inner value when handler returns under timeout", async () => {
    const inner = async (a: number, b: number): Promise<number> => a + b
    const wrapped = withHandlerTimeout(inner, "math.add", SHORT_MS)
    expect(await wrapped(2, 3)).toBe(5)
  })

  test("rejects with HandlerTimeoutError when handler hangs past timeout", async () => {
    const hang = (): Promise<never> => new Promise(() => {})
    const wrapped = withHandlerTimeout(hang, "test.hang", SHORTER_MS)
    let caught: unknown
    try {
      await wrapped()
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(HandlerTimeoutError)
    expect((caught as HandlerTimeoutError).handlerName).toBe("test.hang")
    expect((caught as HandlerTimeoutError).timeoutMs).toBe(SHORTER_MS)
    expect((caught as HandlerTimeoutError).code).toBe("HANDLER_TIMEOUT")
    expect((caught as HandlerTimeoutError).message).toContain("workspace temporarily unreachable")
  })

  test("propagates inner error verbatim when handler rejects under timeout", async () => {
    const boom = async (): Promise<never> => {
      throw new Error("inner boom")
    }
    const wrapped = withHandlerTimeout(boom, "test.boom", SHORT_MS)
    let caught: unknown
    try {
      await wrapped()
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Error)
    expect(caught).not.toBeInstanceOf(HandlerTimeoutError)
    expect((caught as Error).message).toBe("inner boom")
  })

  test("clears timer on resolution so process can exit cleanly", async () => {
    const inner = async (): Promise<string> => "fast"
    const wrapped = withHandlerTimeout(inner, "test.fast", 60_000)
    const before = process.getActiveResourcesInfo?.() ?? []
    await wrapped()
    const after = process.getActiveResourcesInfo?.() ?? []
    // If the timer wasn't cleared, the active-handle count would tick up by
    // 1 per call. Allow exact equality (Bun's snapshot is stable).
    expect(after.length).toBeLessThanOrEqual(before.length)
  })

  test("preserves multiple args and shapes return value through Promise.race", async () => {
    const inner = async (a: string, b: string, c: string): Promise<{ joined: string }> => ({
      joined: `${a}-${b}-${c}`,
    })
    const wrapped = withHandlerTimeout(inner, "test.shape", SHORT_MS)
    const out = await wrapped("x", "y", "z")
    expect(out).toEqual({ joined: "x-y-z" })
  })

  test("default timeout matches DEFAULT_TIMEOUT_MS export", () => {
    expect(__TEST_DEFAULT_TIMEOUT_MS).toBe(30_000)
  })
})

describe("wrapNamespace", () => {
  test("wraps every function in the namespace with name = nsName.key", async () => {
    const ns = {
      hang: () => new Promise<never>(() => {}),
      fast: async (n: number) => n * 2,
    }
    const wrapped = wrapNamespace(ns, "fixture", SHORTER_MS)
    expect(await wrapped.fast(7)).toBe(14)
    let caught: unknown
    try {
      await wrapped.hang()
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(HandlerTimeoutError)
    expect((caught as HandlerTimeoutError).handlerName).toBe("fixture.hang")
  })

  test("passes through non-function entries unchanged", () => {
    const ns = {
      ALLOWED_COMMANDS: ["show", "list"] as const,
      CONFIG: { foo: 1 },
      run: async () => "ok",
    }
    const wrapped = wrapNamespace(ns, "console", SHORT_MS)
    expect(wrapped.ALLOWED_COMMANDS).toBe(ns.ALLOWED_COMMANDS)
    expect(wrapped.CONFIG).toBe(ns.CONFIG)
    expect(typeof wrapped.run).toBe("function")
    expect(wrapped.run).not.toBe(ns.run) // function was wrapped
  })
})

describe("HandlerTimeoutError", () => {
  test("has stable shape for client-side error rendering", () => {
    const err = new HandlerTimeoutError("workspaces.list", 30_000)
    expect(err.name).toBe("HandlerTimeoutError")
    expect(err.code).toBe("HANDLER_TIMEOUT")
    expect(err.handlerName).toBe("workspaces.list")
    expect(err.timeoutMs).toBe(30_000)
    expect(err instanceof Error).toBe(true)
  })
})
