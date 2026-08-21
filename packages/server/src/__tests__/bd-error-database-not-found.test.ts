// bb-nwh0 (port of bb-s1nu from origin/main 645d3a8). Locks the
// database-not-found classification + recovery contract on the v0.25
// branch. The fixCommand for "database X not found on Dolt server at..."
// MUST be `bd init --from-jsonl`, NOT `bd dolt start` — see file
// header in lib/bd-error.ts for the architectural rationale (JSONL =
// source of truth, Dolt = runtime; branch-switch case where Dolt data
// is on a different branch but JSONL is tracked in git).

import { describe, expect, test } from "bun:test"
import { toBdLoadError } from "../lib/bd-error"

describe("bb-s1nu / bb-nwh0: database-not-found routes to JSONL re-import", () => {
  test("classifies the v0.24.1 PostHog-captured 'fala' error and routes to JSONL re-import", () => {
    // Verbatim error string from PostHog (5 events, 1 user, week of
    // 2026-04-21 on v0.24.1). Triggering action: getEpics. The string
    // shape comes straight from bd's own surface — preserving it as the
    // test fixture means future bd output drift surfaces here.
    const stderr =
      'failed to open database: database "fala" not found on Dolt server at 127.0.0.1:14235'
    const result = toBdLoadError({ stderr, message: "Command failed: bd list" })

    expect(result.category).toBe("database-not-found")
    expect(result.severity).toBe("fatal")
    expect(result.fixCommand).toBe("bd init --from-jsonl")
    expect(result.fixDescription).toContain("git branch switch")
    expect(result.fixDescription).toContain("issues.jsonl")
    // Specifically NOT the deprecated recovery suggestion:
    expect(result.fixCommand).not.toBe("bd dolt start")
    expect(result.fixDescription).not.toContain("Restart the Dolt server")
  })

  test("matches arbitrary database names between 'database' and 'not found'", () => {
    // The classifier uses /database\b.*\bnot found/i — covers any
    // workspace name (the literal-includes() approach in the original
    // patterns table couldn't match because the db name varies).
    const cases = [
      'database "beads" not found on Dolt server at 127.0.0.1:3307',
      "database mydb not found",
      'failed to open database: database "abc-123" not found',
    ]
    for (const stderr of cases) {
      const result = toBdLoadError({ stderr, message: "" })
      expect(result.category, `should classify: ${stderr}`).toBe("database-not-found")
      expect(result.fixCommand).toBe("bd init --from-jsonl")
    }
  })
})
