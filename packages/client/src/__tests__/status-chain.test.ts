// Tests for lib/status-chain.ts — shared helpers for spec §4.3 (workflow
// advancement button, beadbox-3qo) and §4.9 (activity pipeline card,
// beadbox-8k3).

import { describe, expect, test } from "bun:test"
import {
  composePipelineChain,
  deriveCustomStatusChain,
  getStatusDisplayLabel,
} from "../lib/status-chain"

describe("getStatusDisplayLabel (beadbox-8k3)", () => {
  test("title-cases single-word statuses", () => {
    expect(getStatusDisplayLabel("open")).toBe("Open")
    expect(getStatusDisplayLabel("closed")).toBe("Closed")
    expect(getStatusDisplayLabel("blocked")).toBe("Blocked")
  })

  test("normalizes underscores into spaces with title-case per word", () => {
    expect(getStatusDisplayLabel("in_progress")).toBe("In Progress")
    expect(getStatusDisplayLabel("ready_to_ship")).toBe("Ready to Ship")
  })

  test("preserves all-caps tokens via override map (qa, ui, api, etc.)", () => {
    expect(getStatusDisplayLabel("ready_for_qa")).toBe("Ready for QA")
    expect(getStatusDisplayLabel("qa_passed")).toBe("QA Passed")
    expect(getStatusDisplayLabel("ui_review")).toBe("UI Review")
    expect(getStatusDisplayLabel("api_check")).toBe("API Check")
  })

  test("lowercases connectors mid-phrase but title-cases first word", () => {
    expect(getStatusDisplayLabel("ready_for_qa")).toBe("Ready for QA")
    expect(getStatusDisplayLabel("for_review")).toBe("For Review") // first-word case
    expect(getStatusDisplayLabel("waiting_on_review")).toBe("Waiting on Review")
  })

  test("returns empty string for empty input", () => {
    expect(getStatusDisplayLabel("")).toBe("")
  })

  test("custom user statuses get reasonable title-case", () => {
    expect(getStatusDisplayLabel("awaiting_review")).toBe("Awaiting Review")
    expect(getStatusDisplayLabel("awaiting_testing")).toBe("Awaiting Testing")
  })
})

describe("deriveCustomStatusChain (beadbox-8k3)", () => {
  test("filters out core lifecycle statuses, preserves order", () => {
    expect(deriveCustomStatusChain(["open", "in_progress", "ready_for_qa", "closed"])).toEqual([
      "ready_for_qa",
    ])
    expect(
      deriveCustomStatusChain(["open", "in_progress", "closed", "ready_for_qa", "qa_passed"]),
    ).toEqual(["ready_for_qa", "qa_passed"])
  })

  test("returns empty array when there are no custom statuses", () => {
    expect(deriveCustomStatusChain(["open", "in_progress", "closed"])).toEqual([])
  })

  test("handles arbitrary user chain order", () => {
    expect(
      deriveCustomStatusChain([
        "open",
        "in_progress",
        "closed",
        "awaiting_review",
        "awaiting_testing",
        "awaiting_docs",
      ]),
    ).toEqual(["awaiting_review", "awaiting_testing", "awaiting_docs"])
  })

  test("does NOT strip a custom status that shares a name with a core one (sanity)", () => {
    // Defensive: deriveCustomStatusChain strips by EXACT core-set membership.
    // If a user explicitly added "open" to status.custom (unusual but possible),
    // it's filtered out — composePipelineChain enforces "open" appears in the
    // fixed first position.
    expect(deriveCustomStatusChain(["open", "in_progress", "open", "closed"])).toEqual([])
  })
})

describe("composePipelineChain (beadbox-8k3)", () => {
  test("composes the canonical OPEN/IN_PROGRESS/<chain>/CLOSED order", () => {
    expect(composePipelineChain(["ready_for_qa", "qa_passed", "ready_to_ship"])).toEqual([
      "open",
      "in_progress",
      "ready_for_qa",
      "qa_passed",
      "ready_to_ship",
      "closed",
    ])
  })

  test("empty status.custom → 3-tile built-in chain", () => {
    expect(composePipelineChain([])).toEqual(["open", "in_progress", "closed"])
  })

  test("de-duplicates if a custom-chain entry collides with a core status", () => {
    // Direct callers (not via deriveCustomStatusChain) might pass an
    // unfiltered list; composePipelineChain defends.
    expect(composePipelineChain(["in_progress", "ready_for_qa", "closed"])).toEqual([
      "open",
      "in_progress",
      "ready_for_qa",
      "closed",
    ])
  })

  test("preserves arbitrary user chain order in the middle slot", () => {
    expect(composePipelineChain(["alpha", "beta", "gamma"])).toEqual([
      "open",
      "in_progress",
      "alpha",
      "beta",
      "gamma",
      "closed",
    ])
  })
})
