// bb-yelc regression. Documents + locks in the contract that
// .husky/pre-push strips git's hook-injected GIT_* env vars before
// running anything that spawns bd / git / dolt.
//
// Pre-fix: git invokes the hook with GIT_DIR / GIT_WORK_TREE /
// GIT_INDEX_FILE set; bun:test inherits; bd init → dolt clone →
// `git init --bare` fails with:
//   "fatal: GIT_WORK_TREE not allowed without specifying GIT_DIR"
// Reproduces 100% under the hook context. eng3 was forced to push
// with --no-verify on bb-3g1j.5; this test prevents the hook fix
// from being silently reverted.
//
// We test the hook FILE'S CONTENT (not a real git push) because:
//   1. Running an actual `git push --dry-run` from inside a test
//      would invoke the hook itself — recursive, fragile, and
//      requires a remote.
//   2. The fix is a single shell `unset` line; asserting its
//      presence is the natural granularity.
//   3. Catching a regression at lint speed (ms) beats catching it
//      at the next push attempt.

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// __dirname = packages/server/src/__tests__/ → 4 ups to repo root.
const REPO_ROOT = join(__dirname, "..", "..", "..", "..")
const PRE_PUSH = join(REPO_ROOT, ".husky", "pre-push")

const REQUIRED_VARS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_NAMESPACE",
  "GIT_PREFIX",
] as const

describe("husky pre-push hook strips git's hook-injected env", () => {
  const hookSource = readFileSync(PRE_PUSH, "utf-8")

  test("contains an `unset` line for each GIT_* var git may inject", () => {
    const unsetLines = hookSource
      .split("\n")
      .filter((line) => line.trim().startsWith("unset"))
    expect(unsetLines.length, "expected at least one `unset GIT_*` line in .husky/pre-push").toBeGreaterThan(0)

    const allUnsetTokens = unsetLines.flatMap((line) => line.trim().split(/\s+/).slice(1))
    for (const v of REQUIRED_VARS) {
      expect(
        allUnsetTokens,
        `bb-yelc: .husky/pre-push must \`unset ${v}\` so child bd/git/dolt processes don't inherit git's hook env`,
      ).toContain(v)
    }
  })

  test("`unset` line precedes any test-running command (so children start clean)", () => {
    const lines = hookSource.split("\n")
    const unsetIdx = lines.findIndex((l) => l.trim().startsWith("unset GIT_"))
    const firstRunnerIdx = lines.findIndex((l) => /^(bun |python3 |bd |npm |yarn )/.test(l.trim()))
    expect(unsetIdx).toBeGreaterThanOrEqual(0)
    expect(firstRunnerIdx).toBeGreaterThanOrEqual(0)
    expect(unsetIdx, "bb-yelc: `unset GIT_*` must appear BEFORE any runner command").toBeLessThan(firstRunnerIdx)
  })
})
