// bb-hivb: unit tests for the feature-flag override helper.
// Precedence: env override > localStorage override > posthog SDK > false.

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

// Mock posthog-js BEFORE importing the helper so the helper picks up the
// mocked module. mock.module is process-global per project_bun_mock_module_global.
let posthogReturn: boolean | undefined
let posthogThrows = false
mock.module("posthog-js", () => ({
  default: {
    isFeatureEnabled: (_flag: string) => {
      if (posthogThrows) throw new Error("PostHog not initialized")
      return posthogReturn
    },
  },
}))

import { isFeatureEnabled } from "../lib/feature-flag"

// beadbox-01f.1: the helper is key-agnostic, so these use a neutral key. The
// flag that used to appear here (Formulas) is now GA and gone from the codebase;
// keeping its name in the tests would point at something that no longer exists.
// The helper is KEPT deliberately: it is the only override path for a dark
// PostHog SDK (bb-aurr, still open), and three shipping flags
// (use-private-update-repo, enable-ai-help, enable-molecule-view) still call
// PostHog directly with no such hatch.
describe("isFeatureEnabled", () => {
  beforeEach(() => {
    posthogReturn = undefined
    posthogThrows = false
    localStorage.removeItem("beadbox_flag_overrides")
    delete (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_BEADBOX_FLAG_OVERRIDE
  })

  afterEach(() => {
    localStorage.removeItem("beadbox_flag_overrides")
    // beadbox-l5i.1: this MUST mirror beforeEach. import.meta.env is
    // process-global, so a VITE_BEADBOX_FLAG_OVERRIDE left set by the last
    // test in this file leaked into every test file that ran after it —
    // and since isFeatureEnabled checks the env override FIRST, it silently
    // overrode their localStorage/PostHog setup. That made
    // epic-navigation-keys' Cmd+3 tests pass or fail purely on file
    // execution order (green on macOS, red on hosted Linux).
  })

  test("returns false when no override and PostHog returns false", () => {
    posthogReturn = false
    expect(isFeatureEnabled("example-flag")).toBe(false)
  })

  test("returns true when PostHog returns true and no overrides", () => {
    posthogReturn = true
    expect(isFeatureEnabled("example-flag")).toBe(true)
  })

  test("returns false when PostHog returns undefined and no overrides", () => {
    posthogReturn = undefined
    expect(isFeatureEnabled("example-flag")).toBe(false)
  })

  test("returns false when PostHog throws and no overrides", () => {
    posthogThrows = true
    expect(isFeatureEnabled("example-flag")).toBe(false)
  })

  test("localStorage override true wins over PostHog false", () => {
    posthogReturn = false
    localStorage.setItem(
      "beadbox_flag_overrides",
      JSON.stringify({ "example-flag": true }),
    )
    expect(isFeatureEnabled("example-flag")).toBe(true)
  })

  test("localStorage override false wins over PostHog true", () => {
    posthogReturn = true
    localStorage.setItem(
      "beadbox_flag_overrides",
      JSON.stringify({ "example-flag": false }),
    )
    expect(isFeatureEnabled("example-flag")).toBe(false)
  })

  test("localStorage override unblocks formulas when PostHog throws (bb-hivb scenario)", () => {
    posthogThrows = true
    localStorage.setItem(
      "beadbox_flag_overrides",
      JSON.stringify({ "example-flag": true }),
    )
    expect(isFeatureEnabled("example-flag")).toBe(true)
  })

  test("localStorage override only affects the named flag", () => {
    posthogReturn = false
    localStorage.setItem(
      "beadbox_flag_overrides",
      JSON.stringify({ "example-flag": true }),
    )
    expect(isFeatureEnabled("example-flag")).toBe(true)
    expect(isFeatureEnabled("other-flag")).toBe(false)
  })

  test("malformed localStorage JSON falls through to PostHog", () => {
    posthogReturn = true
    localStorage.setItem("beadbox_flag_overrides", "{not json")
    expect(isFeatureEnabled("example-flag")).toBe(true)
  })

  test("non-boolean localStorage value falls through to PostHog", () => {
    posthogReturn = true
    localStorage.setItem(
      "beadbox_flag_overrides",
      JSON.stringify({ "example-flag": "yes" }),
    )
    expect(isFeatureEnabled("example-flag")).toBe(true)
  })

  test("env override wins over both localStorage and PostHog", () => {
    posthogReturn = false
    localStorage.setItem(
      "beadbox_flag_overrides",
      JSON.stringify({ "example-flag": false }),
    )
    const env = (import.meta as { env: Record<string, string | undefined> }).env
    env.VITE_BEADBOX_FLAG_OVERRIDE = "example-flag=true"
    expect(isFeatureEnabled("example-flag")).toBe(true)
  })

  test("env override parses semicolon-separated multi-flag", () => {
    posthogReturn = false
    const env = (import.meta as { env: Record<string, string | undefined> }).env
    env.VITE_BEADBOX_FLAG_OVERRIDE = "example-flag=true;other-flag=false"
    expect(isFeatureEnabled("example-flag")).toBe(true)
    expect(isFeatureEnabled("other-flag")).toBe(false)
  })
})
