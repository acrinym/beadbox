// Unit tests for lib/workspace-cookie.ts.
//
// Coverage (bb-onv3.2):
//   - getWorkspaceCookie / setWorkspaceCookie / clearWorkspaceCookie round-trip
//   - subscribeWorkspaceCookie fires on set + clear; reads stay consistent
//   - unsubscribe stops further notifications
//
// happy-dom (installed via the bunfig _test-globals.ts preload) provides
// localStorage. The EventTarget under test is module-scoped, so listeners
// added in one case persist into the next unless explicitly unsubscribed —
// each case stores + tears down its own unsubscribe handle.

import { afterEach, describe, expect, mock, test } from "bun:test"
import {
  clearWorkspaceCookie,
  getWorkspaceCookie,
  setWorkspaceCookie,
  subscribeWorkspaceCookie,
} from "../lib/workspace-cookie"

const KEY = "beads-workspace"

afterEach(() => {
  // Reset localStorage between cases so a stale cookie doesn't leak across.
  // We don't dispatch through clearWorkspaceCookie here on purpose — that
  // would fire listeners from the case under test that weren't torn down.
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(KEY)
    } catch {
      /* ignore */
    }
  }
})

describe("workspace-cookie", () => {
  test("get returns null when unset", () => {
    expect(getWorkspaceCookie()).toBeNull()
  })

  test("set then get round-trips", () => {
    setWorkspaceCookie("ws-uuid-1")
    expect(getWorkspaceCookie()).toBe("ws-uuid-1")
  })

  test("clear removes the value", () => {
    setWorkspaceCookie("ws-uuid-2")
    clearWorkspaceCookie()
    expect(getWorkspaceCookie()).toBeNull()
  })

  test("subscribeWorkspaceCookie fires listener on set", () => {
    const listener = mock(() => undefined)
    const unsubscribe = subscribeWorkspaceCookie(listener)
    try {
      setWorkspaceCookie("ws-uuid-3")
      expect(listener).toHaveBeenCalledTimes(1)
      // Listener has no args — expects the consumer to read getWorkspaceCookie
      // inside the listener for the current value.
      expect(getWorkspaceCookie()).toBe("ws-uuid-3")
    } finally {
      unsubscribe()
    }
  })

  test("subscribeWorkspaceCookie fires listener on clear", () => {
    setWorkspaceCookie("ws-uuid-4")
    const listener = mock(() => undefined)
    const unsubscribe = subscribeWorkspaceCookie(listener)
    try {
      clearWorkspaceCookie()
      expect(listener).toHaveBeenCalledTimes(1)
      expect(getWorkspaceCookie()).toBeNull()
    } finally {
      unsubscribe()
    }
  })

  test("subscribeWorkspaceCookie fires once per write across multiple writes", () => {
    const listener = mock(() => undefined)
    const unsubscribe = subscribeWorkspaceCookie(listener)
    try {
      setWorkspaceCookie("ws-a")
      setWorkspaceCookie("ws-b")
      setWorkspaceCookie("ws-c")
      expect(listener).toHaveBeenCalledTimes(3)
      expect(getWorkspaceCookie()).toBe("ws-c")
    } finally {
      unsubscribe()
    }
  })

  test("unsubscribe stops further notifications", () => {
    const listener = mock(() => undefined)
    const unsubscribe = subscribeWorkspaceCookie(listener)
    setWorkspaceCookie("ws-before-unsub")
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    setWorkspaceCookie("ws-after-unsub")
    expect(listener).toHaveBeenCalledTimes(1) // no additional firing
  })

  test("multiple subscribers all receive the event", () => {
    const a = mock(() => undefined)
    const b = mock(() => undefined)
    const unsubA = subscribeWorkspaceCookie(a)
    const unsubB = subscribeWorkspaceCookie(b)
    try {
      setWorkspaceCookie("ws-fan-out")
      expect(a).toHaveBeenCalledTimes(1)
      expect(b).toHaveBeenCalledTimes(1)
    } finally {
      unsubA()
      unsubB()
    }
  })
})
