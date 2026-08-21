// bb-lh8f: tests for the pre-push deletion-skip helper
// (`.husky/_is-deletion-only-push.sh`).
//
// Citation: pm/systemdesign.md §6.3 Pre-Push Hook Policy. The helper
// implements the "trigger contract" portion of the policy — parse stdin
// per the git pre-push protocol, identify deletion-form specs by the
// 40-zero local-sha sentinel, and surface ALL_DELETIONS / ANY_SPECS for
// the hook's skip-clause check.
//
// Why this test file exists: round-1 of bb-lh8f (commit 2580cd6) shipped
// the hook change without committed tests — interactive shell verification
// was conflated with "added unit tests" in the deliver message. This
// round-2 file closes the gap. Going forward: never characterize
// verification as "added tests" unless the test files are committed.
//
// Approach: spawn `bash` per case, source the helper, echo the resulting
// flags, and assert on the captured output. This exercises the actual
// helper script (single source of truth) rather than re-implementing the
// parse logic inline.

import { resolve } from "node:path"
import { describe, expect, test } from "bun:test"

const HELPER = resolve(import.meta.dir, "../../../../.husky/_is-deletion-only-push.sh")
const ZERO_SHA = "0000000000000000000000000000000000000000"

interface ParseResult {
  ALL_DELETIONS: string
  ANY_SPECS: string
  exitCode: number
}

function runHelperWithStdin(stdin: string): ParseResult {
  const proc = Bun.spawnSync({
    cmd: ["bash", "-c", `. "${HELPER}"; echo "$ALL_DELETIONS $ANY_SPECS"`],
    stdin: new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  })
  const out = new TextDecoder().decode(proc.stdout).trim()
  const [allDeletions, anySpecs] = out.split(" ")
  return {
    ALL_DELETIONS: allDeletions ?? "",
    ANY_SPECS: anySpecs ?? "",
    exitCode: proc.exitCode ?? -1,
  }
}

describe("pre-push deletion-skip helper (.husky/_is-deletion-only-push.sh, §6.3)", () => {
  test("pure deletion (40-zero local-sha sentinel) → skip should fire", () => {
    // Single ref, deletion form: `git push origin :refs/heads/old-branch`
    // produces this stdin shape. ALL_DELETIONS stays true; ANY_SPECS
    // flips to true on the first read; the hook's skip clause then
    // matches and exits 0 without running gates.
    const r = runHelperWithStdin(`refs/heads/old-branch ${ZERO_SHA} refs/heads/old-branch abc123\n`)
    expect(r.exitCode).toBe(0)
    expect(r.ALL_DELETIONS).toBe("true")
    expect(r.ANY_SPECS).toBe("true")
  })

  test("mixed batch (any non-deletion spec) → gates must run", () => {
    // Two specs: one content push, one deletion. §6.3 fallback says
    // the trigger contract is "either all deletions or run everything";
    // mixed batches are NOT partially-skipped. Any non-zero local-sha
    // flips ALL_DELETIONS to false → hook's skip clause fails → gates
    // run.
    const stdin =
      `refs/heads/feat aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa refs/heads/feat bbbbbbbb\n` +
      `refs/heads/old ${ZERO_SHA} refs/heads/old cccccccc\n`
    const r = runHelperWithStdin(stdin)
    expect(r.exitCode).toBe(0)
    expect(r.ALL_DELETIONS).toBe("false")
    expect(r.ANY_SPECS).toBe("true")
  })

  test("empty stdin (no specs read) → conservative fallback runs gates", () => {
    // ANY_SPECS stays false because the read loop body never executes;
    // the hook's skip clause requires ANY_SPECS=true so the empty case
    // falls through to gates. This is deliberate per the bead body's
    // "errs on the side of running checks if input shape is unexpected"
    // and is documented in the helper file.
    const r = runHelperWithStdin("")
    expect(r.exitCode).toBe(0)
    expect(r.ANY_SPECS).toBe("false")
    // ALL_DELETIONS happens to be "true" by initialization — but the
    // skip clause AND-conjoins with ANY_SPECS so the value here is moot.
    expect(r.ALL_DELETIONS).toBe("true")
  })
})
