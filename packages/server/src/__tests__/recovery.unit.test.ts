// Unit tests for the recovery handler namespace.
//
// Coverage focuses on the validation paths (unknown command, invalid db
// path) — they are pure-function safe and exhaustively cover the early
// return branches. The destructive bd-CLI paths (init --from-jsonl,
// migrateToServerMode end-to-end) require dedicated workspace fixtures
// and are validated by the parity runner in P1.7 against the production
// action.

import { describe, expect, test } from "bun:test"
import { migrateToServerMode, runRecoveryCommand } from "../handlers/recovery"

describe("recovery.runRecoveryCommand", () => {
  test("unknown command returns { success: false, error: 'Unknown command' }", async () => {
    const result = await runRecoveryCommand("bd evil --rm-rf /", "/tmp/.beads")
    expect(result.success).toBe(false)
    expect(result.error).toBe("Unknown command")
  })

  test("empty command returns 'Unknown command'", async () => {
    const result = await runRecoveryCommand("", "/tmp/.beads")
    expect(result.success).toBe(false)
    expect(result.error).toBe("Unknown command")
  })

  test("known command with invalid db path is rejected by isValidDbPath", async () => {
    const result = await runRecoveryCommand("bd init", "/etc/passwd")
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Invalid database path/)
  })

  test("known command with empty db path is rejected", async () => {
    const result = await runRecoveryCommand("bd init", "")
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Invalid database path/)
  })

  test("ALLOWED_FIX_COMMANDS only contains pre-approved bd subcommands", async () => {
    // Exercise each allowed key with an invalid db path to confirm the
    // dispatch table is wired before the validation guard.
    const allowed = ["bd init --from-jsonl", "bd dolt stop", "bd dolt start", "bd init"]
    for (const cmd of allowed) {
      const result = await runRecoveryCommand(cmd, "/etc/passwd")
      expect(result.success).toBe(false)
      // Validation guard fires AFTER the allowlist check, so we should
      // see the path-validation error message, not 'Unknown command'.
      expect(result.error).toMatch(/Invalid database path/)
    }
  })
})

describe("recovery.migrateToServerMode", () => {
  test("invalid db path returns structured error without mutating", async () => {
    const result = await migrateToServerMode("/etc/passwd")
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Invalid database path/)
    expect(result.failedStep).toBeUndefined()
  })

  test("empty db path returns structured error without mutating", async () => {
    const result = await migrateToServerMode("")
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Invalid database path/)
  })

  test("valid path but no metadata.json fails at the backup step", async () => {
    // /tmp/.beads passes isValidDbPath (server:// or .beads structural
    // check) but readPrefix will fail on missing metadata.json, which the
    // handler reports as a backup-step failure with a stable message.
    // Use a clearly-fake .beads path that wouldn't accidentally exist.
    const result = await migrateToServerMode("/tmp/__bb_p1_4_recovery_test__/.beads")
    expect(result.success).toBe(false)
    expect(result.failedStep).toBe("backup")
    expect(result.error).toBe("Could not read workspace prefix from metadata.json")
  })
})
