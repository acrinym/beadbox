// Handler-level enforcement of workspace path validation
// (beadbox-l5i.3, item 4).
//
// path-validation.security.test.ts proves the predicate; this proves the two
// client-facing entry points actually call it. Both handlers return a result
// object rather than throwing, so a rejection must surface as
// { success: false } — and must do so WITHOUT touching the filesystem or
// spawning bd.

import { describe, expect, test } from "bun:test"

import { addWorkspaceByPath, initializeWorkspace } from "../handlers/workspaces"

const BAD_PATHS: Array<[string, string]> = [
  ["relative path", "relative/path"],
  ["dot-relative path", "./somewhere"],
  ["parent-relative path", ".."],
  ["NUL byte", "/tmp/ws\0/etc"],
  ["empty string", ""],
  ["whitespace only", "   "],
]

describe("addWorkspaceByPath rejects unusable paths", () => {
  for (const [name, path] of BAD_PATHS) {
    test(`rejects ${name}`, async () => {
      const result = await addWorkspaceByPath(path)
      expect(result.success).toBe(false)
      if (!result.success) {
        // Must be the validation gate, not an incidental stat() failure —
        // otherwise this test would pass with no validation at all.
        expect(result.error).toMatch(/absolute/i)
        // A rejected path must not be offered an init affordance.
        expect(result.needsInit).toBeFalsy()
      }
    })
  }
})

describe("initializeWorkspace rejects unusable paths", () => {
  for (const [name, path] of BAD_PATHS) {
    test(`rejects ${name}`, async () => {
      const result = await initializeWorkspace(path)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toMatch(/absolute/i)
      }
    })
  }
})
