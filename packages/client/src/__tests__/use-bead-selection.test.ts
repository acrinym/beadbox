// bb-y729: useBeadSelection — page-level multi-select state.
//
// Pure hook (no rpc, no DOM). Verified via @testing-library/react renderHook
// rather than full component mount — the hook is the contract; the toolbar
// + table tests cover the wiring side.

import { describe, expect, test } from "bun:test"
import { act, renderHook } from "@testing-library/react"
import { useBeadSelection } from "../hooks/use-bead-selection"

describe("useBeadSelection (bb-y729)", () => {
  test("starts empty", () => {
    const { result } = renderHook(() => useBeadSelection())
    expect(result.current.selectedIds.size).toBe(0)
    expect(result.current.isAllSelected(["a"])).toBe(false)
    expect(result.current.isPartiallySelected(["a"])).toBe(false)
  })

  test("toggle adds and removes", () => {
    const { result } = renderHook(() => useBeadSelection())
    act(() => result.current.toggle("a"))
    expect(result.current.selectedIds.has("a")).toBe(true)
    act(() => result.current.toggle("a"))
    expect(result.current.selectedIds.has("a")).toBe(false)
  })

  test("toggleAll selects all when none selected", () => {
    const { result } = renderHook(() => useBeadSelection())
    act(() => result.current.toggleAll(["a", "b", "c"]))
    expect(result.current.selectedIds.size).toBe(3)
    expect(result.current.isAllSelected(["a", "b", "c"])).toBe(true)
  })

  test("toggleAll clears when all already selected", () => {
    const { result } = renderHook(() => useBeadSelection())
    act(() => result.current.toggleAll(["a", "b", "c"]))
    act(() => result.current.toggleAll(["a", "b", "c"]))
    expect(result.current.selectedIds.size).toBe(0)
  })

  test("toggleAll selects-all when partial", () => {
    const { result } = renderHook(() => useBeadSelection())
    act(() => result.current.toggle("a"))
    expect(result.current.isPartiallySelected(["a", "b", "c"])).toBe(true)
    act(() => result.current.toggleAll(["a", "b", "c"]))
    expect(result.current.isAllSelected(["a", "b", "c"])).toBe(true)
  })

  test("isPartiallySelected: 0 < intersect < visible", () => {
    const { result } = renderHook(() => useBeadSelection())
    act(() => result.current.toggle("a"))
    act(() => result.current.toggle("b"))
    expect(result.current.isPartiallySelected(["a", "b", "c"])).toBe(true)
    expect(result.current.isPartiallySelected(["a", "b"])).toBe(false) // all
    expect(result.current.isPartiallySelected(["x", "y"])).toBe(false) // none
  })

  test("clear empties the set", () => {
    const { result } = renderHook(() => useBeadSelection())
    act(() => result.current.toggleAll(["a", "b", "c"]))
    act(() => result.current.clear())
    expect(result.current.selectedIds.size).toBe(0)
  })

  test("pruneTo keeps only ids in the visible set", () => {
    const { result } = renderHook(() => useBeadSelection())
    act(() => result.current.toggleAll(["a", "b", "c"]))
    act(() => result.current.pruneTo(["a", "c"]))
    expect(result.current.selectedIds.has("a")).toBe(true)
    expect(result.current.selectedIds.has("b")).toBe(false)
    expect(result.current.selectedIds.has("c")).toBe(true)
  })

  test("pruneTo to empty visible drops everything", () => {
    const { result } = renderHook(() => useBeadSelection())
    act(() => result.current.toggleAll(["a", "b"]))
    act(() => result.current.pruneTo([]))
    expect(result.current.selectedIds.size).toBe(0)
  })
})
