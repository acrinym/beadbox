// Unit tests for groupBeadsByStatus (beadbox-brg).

import { describe, expect, test } from "bun:test"
import { groupBeadsByStatus } from "../lib/epic-tree-utils"
import type { Bead, BeadStatus } from "../lib/types"

const b = (id: string, status: BeadStatus): Bead =>
  ({
    id,
    title: id,
    status,
    priority: "medium",
    type: "task",
  }) as unknown as Bead

describe("groupBeadsByStatus (beadbox-brg)", () => {
  test("empty input → empty array", () => {
    expect(groupBeadsByStatus([], [])).toEqual([])
    expect(groupBeadsByStatus([], ["ready_for_qa"])).toEqual([])
  })

  test("canonical order: open → in_progress → chain → closed", () => {
    const beads = [
      b("a", "closed"),
      b("b", "open"),
      b("c", "ready_for_qa"),
      b("d", "in_progress"),
      b("e", "ready_to_ship"),
      b("f", "qa_passed"),
    ]
    const chain = ["ready_for_qa", "qa_passed", "ready_to_ship"]
    const groups = groupBeadsByStatus(beads, chain)
    expect(groups.map((g) => g.status)).toEqual([
      "open",
      "in_progress",
      "ready_for_qa",
      "qa_passed",
      "ready_to_ship",
      "closed",
    ])
  })

  test("empty sections filtered out", () => {
    const beads = [b("a", "open"), b("b", "closed")]
    const groups = groupBeadsByStatus(beads, ["ready_for_qa", "ready_to_ship"])
    expect(groups.map((g) => g.status)).toEqual(["open", "closed"])
    expect(groups[0].beads.map((x) => x.id)).toEqual(["a"])
    expect(groups[1].beads.map((x) => x.id)).toEqual(["b"])
  })

  test("statuses outside canonical/chain order go to trailing buckets", () => {
    const beads = [b("a", "open"), b("b", "blocked" as BeadStatus), b("c", "deferred" as BeadStatus)]
    const groups = groupBeadsByStatus(beads, [])
    expect(groups.map((g) => g.status)).toEqual(["open", "blocked", "deferred"])
  })

  test("title-cases the labels", () => {
    const beads = [b("a", "ready_for_qa"), b("b", "in_progress")]
    const groups = groupBeadsByStatus(beads, ["ready_for_qa"])
    const labels = Object.fromEntries(groups.map((g) => [g.status, g.label]))
    expect(labels.ready_for_qa).toBe("Ready For Qa")
    expect(labels.in_progress).toBe("In Progress")
  })

  test("custom chain reorders the middle band", () => {
    const beads = [b("a", "awaiting_review"), b("b", "in_progress"), b("c", "awaiting_docs")]
    const chain = ["awaiting_review", "awaiting_docs"]
    const groups = groupBeadsByStatus(beads, chain)
    expect(groups.map((g) => g.status)).toEqual(["in_progress", "awaiting_review", "awaiting_docs"])
  })

  test("does not duplicate chain entries that overlap canonical buckets", () => {
    // open + closed are in the canonical ramp; chain naming them should
    // not produce duplicate sections.
    const beads = [b("a", "open"), b("b", "closed")]
    const chain = ["open", "closed"]
    const groups = groupBeadsByStatus(beads, chain)
    expect(groups.map((g) => g.status)).toEqual(["open", "closed"])
  })
})
