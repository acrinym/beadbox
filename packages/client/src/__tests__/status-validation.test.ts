// Tests for lib/status-validation.ts (bb-wxuw port from 1386b41).
// Translated from vitest to bun:test; behavior identical.

import { describe, expect, test } from "bun:test"

import { RESERVED_STATUSES, validateStatusName } from "../lib/status-validation"

describe("validateStatusName", () => {
  test("accepts valid names", () => {
    expect(validateStatusName("ready_for_qa", [])).toBeNull()
    expect(validateStatusName("in_review", [])).toBeNull()
    expect(validateStatusName("stage_3", [])).toBeNull()
    expect(validateStatusName("a", [])).toBeNull()
  })

  test("rejects empty / whitespace-only", () => {
    expect(validateStatusName("", [])).toBe("Name is required")
    expect(validateStatusName("   ", [])).toBe("Name is required")
  })

  test("trims whitespace before validating", () => {
    expect(validateStatusName("  ready_for_qa  ", [])).toBeNull()
  })

  test("rejects uppercase and special characters", () => {
    expect(validateStatusName("ReadyForQA", [])).toMatch(/lowercase/)
    expect(validateStatusName("ready-for-qa", [])).toMatch(/lowercase/)
    expect(validateStatusName("ready for qa", [])).toMatch(/lowercase/)
    expect(validateStatusName("ready.for.qa", [])).toMatch(/lowercase/)
  })

  test("rejects leading digit or underscore", () => {
    expect(validateStatusName("1_status", [])).toMatch(/lowercase/)
    expect(validateStatusName("_status", [])).toMatch(/lowercase/)
  })

  test("rejects reserved built-in statuses", () => {
    for (const reserved of RESERVED_STATUSES) {
      const err = validateStatusName(reserved, [])
      expect(err).toMatch(/built-in/)
    }
  })

  test("rejects duplicates", () => {
    expect(validateStatusName("ready_for_qa", ["ready_for_qa"])).toMatch(/already exists/)
  })

  test("is case-sensitive for dupe detection (matches bd storage)", () => {
    expect(validateStatusName("ReadyForQa", ["ready_for_qa"])).toMatch(/lowercase/)
  })

  test("enforces max length of 50", () => {
    expect(validateStatusName("a".repeat(50), [])).toBeNull()
    expect(validateStatusName("a".repeat(51), [])).toMatch(/50 characters/)
  })

  test("allows names that contain but are not equal to reserved", () => {
    expect(validateStatusName("reopen", [])).toBeNull()
    expect(validateStatusName("closed_late", [])).toBeNull()
  })
})

describe("RESERVED_STATUSES", () => {
  test("matches bd's built-in status list", () => {
    expect(RESERVED_STATUSES).toEqual(["open", "in_progress", "blocked", "deferred", "closed"])
  })
})
