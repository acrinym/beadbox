// Workspace path validation (beadbox-l5i.3, item 4).
//
// addWorkspaceByPath() and initializeWorkspace() take a filesystem path
// straight from the client and hand it to stat(), join(".beads") and bd's
// working directory. Before this bead they accepted anything: a relative
// path resolved against whatever cwd the sidecar happened to inherit, and a
// NUL byte reached the syscall layer as an opaque ERR_INVALID_ARG_VALUE.
//
// isValidDbPath() (already used by console/recovery/diagnostics) is the
// wrong check here — it demands a .beads component, which the DIRECTORY
// being added deliberately does not have.

import { describe, expect, test } from "bun:test"
import { homedir } from "node:os"

import { expandHome, isValidWorkspaceDir } from "../lib/path-validation"

describe("expandHome", () => {
  test("expands a bare tilde", () => {
    expect(expandHome("~")).toBe(homedir())
  })

  test("expands a leading tilde segment", () => {
    expect(expandHome("~/Projects/x")).toBe(`${homedir()}/Projects/x`)
  })

  test("leaves a tilde that is part of a name alone", () => {
    expect(expandHome("~user/x")).toBe("~user/x")
    expect(expandHome("/tmp/~x")).toBe("/tmp/~x")
  })

  test("leaves an ordinary absolute path untouched", () => {
    expect(expandHome("/tmp/ws")).toBe("/tmp/ws")
  })
})

describe("isValidWorkspaceDir", () => {
  test("accepts an absolute directory path", () => {
    expect(isValidWorkspaceDir("/Users/someone/Projects/thing")).toBe(true)
  })

  test("rejects a relative path, which would resolve against the sidecar cwd", () => {
    expect(isValidWorkspaceDir("relative/path")).toBe(false)
    expect(isValidWorkspaceDir("./x")).toBe(false)
    expect(isValidWorkspaceDir("..")).toBe(false)
  })

  test("rejects an unexpanded tilde (callers must expandHome first)", () => {
    expect(isValidWorkspaceDir("~/Projects/x")).toBe(false)
  })

  test("rejects a NUL byte before it reaches a syscall", () => {
    expect(isValidWorkspaceDir("/tmp/ws\0/etc")).toBe(false)
  })

  test("rejects empty and whitespace-only input", () => {
    expect(isValidWorkspaceDir("")).toBe(false)
    expect(isValidWorkspaceDir("   ")).toBe(false)
  })

  test("rejects a non-string", () => {
    expect(isValidWorkspaceDir(undefined as unknown as string)).toBe(false)
    expect(isValidWorkspaceDir(42 as unknown as string)).toBe(false)
  })

  test("accepts an absolute path containing traversal segments once resolved", () => {
    // Traversal is not itself a threat here: bd runs as the user and the OS
    // enforces permissions. What matters is that the path is absolute and
    // syscall-safe, so a normalised absolute path is fine.
    expect(isValidWorkspaceDir("/Users/someone/Projects/../Projects/thing")).toBe(true)
  })
})
