// Unit tests for getNextStatusInChain (beadbox-3qo, pm/spec §4.3).
//
// Each case mirrors a row in the §4.3 contract or an edge case the spec
// explicitly authorizes. Pre-implementation a hardcoded "Ready to Ship"
// button only fired for the canonical chain; this helper drives the
// dynamic-label/dynamic-target behavior across arbitrary chains.

import { describe, expect, test } from "bun:test"
import { getNextStatusInChain, getWorkflowAdvancement } from "../components/bead-detail-helpers"

describe("getNextStatusInChain (beadbox-3qo)", () => {
  const canonical = ["ready_for_qa", "qa_passed", "ready_to_ship"]

  test("empty chain → null (button hidden)", () => {
    expect(getNextStatusInChain("in_progress", [])).toBeNull()
    expect(getNextStatusInChain("ready_for_qa", [])).toBeNull()
  })

  test("current outside chain (open/in_progress) → first chain entry", () => {
    expect(getNextStatusInChain("open", canonical)).toBe("ready_for_qa")
    expect(getNextStatusInChain("in_progress", canonical)).toBe("ready_for_qa")
    expect(getNextStatusInChain("blocked", canonical)).toBe("ready_for_qa")
    expect(getNextStatusInChain("deferred", canonical)).toBe("ready_for_qa")
  })

  test("current is mid-chain → next chain entry", () => {
    expect(getNextStatusInChain("ready_for_qa", canonical)).toBe("qa_passed")
    expect(getNextStatusInChain("qa_passed", canonical)).toBe("ready_to_ship")
  })

  test("current is last chain entry → null (terminal)", () => {
    expect(getNextStatusInChain("ready_to_ship", canonical)).toBeNull()
  })

  test("current is closed → null (closed never advances)", () => {
    expect(getNextStatusInChain("closed", canonical)).toBeNull()
    expect(getNextStatusInChain("closed", [])).toBeNull()
  })

  test("arbitrary chain (non-canonical names) → same behavior", () => {
    const review = ["awaiting_review", "awaiting_testing", "awaiting_docs"]
    expect(getNextStatusInChain("in_progress", review)).toBe("awaiting_review")
    expect(getNextStatusInChain("awaiting_review", review)).toBe("awaiting_testing")
    expect(getNextStatusInChain("awaiting_testing", review)).toBe("awaiting_docs")
    expect(getNextStatusInChain("awaiting_docs", review)).toBeNull()
  })

  test("single-entry chain", () => {
    const solo = ["ship_it"]
    expect(getNextStatusInChain("in_progress", solo)).toBe("ship_it")
    expect(getNextStatusInChain("ship_it", solo)).toBeNull()
  })

  test("two-entry chain", () => {
    const pair = ["review", "ship"]
    expect(getNextStatusInChain("in_progress", pair)).toBe("review")
    expect(getNextStatusInChain("review", pair)).toBe("ship")
    expect(getNextStatusInChain("ship", pair)).toBeNull()
  })
})

describe("getWorkflowAdvancement (beadbox-3qo, terminal-close variant)", () => {
  const canonical = ["ready_for_qa", "qa_passed", "ready_to_ship"]

  test("empty chain → hidden", () => {
    expect(getWorkflowAdvancement("in_progress", [])).toEqual({ kind: "hidden" })
  })

  test("closed bead → hidden (no advancement past terminal)", () => {
    expect(getWorkflowAdvancement("closed", canonical)).toEqual({ kind: "hidden" })
  })

  test("outside chain → advance to first entry", () => {
    expect(getWorkflowAdvancement("in_progress", canonical)).toEqual({
      kind: "advance",
      targetStatus: "ready_for_qa",
    })
    expect(getWorkflowAdvancement("blocked", canonical)).toEqual({
      kind: "advance",
      targetStatus: "ready_for_qa",
    })
  })

  test("mid-chain → advance to next entry", () => {
    expect(getWorkflowAdvancement("ready_for_qa", canonical)).toEqual({
      kind: "advance",
      targetStatus: "qa_passed",
    })
    expect(getWorkflowAdvancement("qa_passed", canonical)).toEqual({
      kind: "advance",
      targetStatus: "ready_to_ship",
    })
  })

  test("last chain entry → close (footer offers Close affordance)", () => {
    expect(getWorkflowAdvancement("ready_to_ship", canonical)).toEqual({ kind: "close" })
  })

  test("single-entry chain → close at that entry", () => {
    expect(getWorkflowAdvancement("ship_it", ["ship_it"])).toEqual({ kind: "close" })
    expect(getWorkflowAdvancement("open", ["ship_it"])).toEqual({
      kind: "advance",
      targetStatus: "ship_it",
    })
  })
})
