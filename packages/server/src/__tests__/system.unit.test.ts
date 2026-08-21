// Unit tests for the system handler namespace.
//
// getLogDirectory is platform-dependent; we assert the platform-correct
// branch was hit. openInFileManager is exercised on the missing-directory
// path (no UI process spawn).

import { describe, expect, test } from "bun:test"
import os from "node:os"
import path from "node:path"
import { getLogDirectory, openInFileManager } from "../handlers/system"

describe("system.getLogDirectory", () => {
  test("returns a platform-appropriate path containing 'Beadbox'", async () => {
    const dir = await getLogDirectory()
    if (process.platform === "darwin") {
      expect(dir).toBe(path.join(os.homedir(), "Library", "Logs", "Beadbox"))
    } else if (process.platform === "linux") {
      expect(dir).toBe(path.join(os.homedir(), ".local", "share", "Beadbox", "logs"))
    } else if (process.platform === "win32") {
      const appdata = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")
      expect(dir).toBe(path.join(appdata, "Beadbox", "logs"))
    } else {
      expect(dir).toBeNull()
    }
  })
})

describe("system.openInFileManager", () => {
  test("missing directory returns { success: false, error: 'Directory not found' }", async () => {
    const result = await openInFileManager("/nonexistent/__bb_p1_4_test__/never/exists")
    expect(result.success).toBe(false)
    expect(result.error).toBe("Directory not found")
  })

  test("relative path is resolved before the existence check", async () => {
    // Same negative path, asserted via a relative input. resolve() turns it
    // into an absolute path the existsSync check will not find.
    const result = await openInFileManager("./__bb_p1_4_test_relative__/never/exists")
    expect(result.success).toBe(false)
    expect(result.error).toBe("Directory not found")
  })
})
