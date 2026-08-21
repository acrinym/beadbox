// Unit tests for useDevConsoleTaps (hooks/use-dev-console-taps.ts).
//
// Strategy (post-bb-jjdw): use the real setRpcTap / setSubscriptionTap
// from lib/rpc + lib/subscribe, and observe their internal state through
// the `_getRpcTap` / `_getSubscriptionTap` test seams that bb-jjdw added
// for exactly this purpose.
//
// Earlier draft used `mock.module` to swap the rpc + subscribe modules,
// which corrupted bun's process-global module cache and broke every
// downstream consumer that imported `{rpc}` (root cause of bb-jjdw).
//
// DOM globals come from the bunfig preload (_test-globals.ts) — do NOT
// create our own happy-dom Window or reassign globalThis.document.
//
// Cases covered (per bb-nypf AC):
//   1. mount → rpc tap = addCommand, subscription tap = addEvent
//   2. unmount → both taps reset to null
//   3. callback identity change → re-registers with new refs

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { act, createElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { BdCommandEvent, WsLifecycleEvent } from "../lib/console-types"
import { _getRpcTap, setRpcTap } from "../lib/rpc"
import { _getSubscriptionTap, setSubscriptionTap } from "../lib/subscribe"
import { useDevConsoleTaps } from "../hooks/use-dev-console-taps"

let container: HTMLElement

function HookHost({
  addCommand,
  addEvent,
}: {
  addCommand: (evt: BdCommandEvent) => void
  addEvent: (evt: WsLifecycleEvent) => void
}): ReactNode {
  useDevConsoleTaps({ addCommand, addEvent })
  return null
}

describe("useDevConsoleTaps", () => {
  let root: Root

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    setRpcTap(null)
    setSubscriptionTap(null)
    root = createRoot(container)
  })

  afterEach(() => {
    try {
      root.unmount()
    } catch {
      /* already unmounted */
    }
    if (container?.parentNode) container.parentNode.removeChild(container)
    setRpcTap(null)
    setSubscriptionTap(null)
  })

  test("mount installs addCommand as the rpc tap and addEvent as the subscription tap", async () => {
    const addCommand = mock(() => {})
    const addEvent = mock(() => {})
    await act(async () => {
      root.render(createElement(HookHost, { addCommand, addEvent }))
    })
    expect(_getRpcTap()).toBe(addCommand as unknown as (evt: BdCommandEvent) => void)
    expect(_getSubscriptionTap()).toBe(addEvent as unknown as (evt: WsLifecycleEvent) => void)
  })

  test("unmount resets both taps to null", async () => {
    const addCommand = mock(() => {})
    const addEvent = mock(() => {})
    await act(async () => {
      root.render(createElement(HookHost, { addCommand, addEvent }))
    })
    await act(async () => {
      root.unmount()
    })
    expect(_getRpcTap()).toBeNull()
    expect(_getSubscriptionTap()).toBeNull()
  })

  test("callback identity change re-registers the new refs", async () => {
    const addCommand1 = mock(() => {})
    const addEvent1 = mock(() => {})
    const addCommand2 = mock(() => {})
    const addEvent2 = mock(() => {})
    await act(async () => {
      root.render(
        createElement(HookHost, { addCommand: addCommand1, addEvent: addEvent1 }),
      )
    })
    await act(async () => {
      root.render(
        createElement(HookHost, { addCommand: addCommand2, addEvent: addEvent2 }),
      )
    })
    expect(_getRpcTap()).toBe(addCommand2 as unknown as (evt: BdCommandEvent) => void)
    expect(_getSubscriptionTap()).toBe(addEvent2 as unknown as (evt: WsLifecycleEvent) => void)
  })
})
