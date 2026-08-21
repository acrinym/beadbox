// Call-site enforcement tests for the bd argv guards (beadbox-l5i.3, item 3).
//
// bd-argv.security.test.ts proves the guards are correct in isolation. This
// file proves they are actually WIRED UP — that a hostile bead ID or title
// reaching an exported lib/bd.ts function is stopped before it becomes argv.
//
// No bd process is spawned: validation throws ahead of execFile, so these
// tests need no database and have no side effects. That is itself part of
// the contract — a rejection must never reach the CLI.

import { describe, expect, test } from "bun:test"
import {
  addComment,
  closeBead,
  deleteBead,
  deleteComment,
  getComments,
  reopenBead,
  setCustomStatuses,
  showBead,
  showBeads,
  updateStatus,
  updateTitle,
} from "../lib/bd"
import { BdArgvError, buildCommentArgs, buildUpdateArgs } from "../lib/bd-argv"

const HOSTILE_ID = "--db=/tmp/evil"

describe("buildUpdateArgs", () => {
  test("emits the option as a single token", () => {
    expect(buildUpdateArgs("bb-1", "--title", "hello")).toEqual(["update", "bb-1", "--title=hello"])
  })

  test("keeps a flag-shaped title inside the value token", () => {
    expect(buildUpdateArgs("bb-1", "--title", HOSTILE_ID)).toEqual([
      "update",
      "bb-1",
      `--title=${HOSTILE_ID}`,
    ])
  })

  test("rejects a flag-shaped bead ID", () => {
    expect(() => buildUpdateArgs(HOSTILE_ID, "--title", "x")).toThrow(BdArgvError)
  })
})

describe("buildCommentArgs", () => {
  test("puts a flag terminator ahead of the free-text body", () => {
    // Comment text is a variadic positional (bd comment <id> [text...]), so
    // unlike an option value it cannot use the --flag=value trick. bdExecRaw
    // appends nothing after the caller's args, so "--" is safe here.
    expect(buildCommentArgs("bb-1", "hello")).toEqual(["comment", "bb-1", "--", "hello"])
  })

  test("neutralises comment text that begins with a dash", () => {
    expect(buildCommentArgs("bb-1", "--db=/tmp/evil")).toEqual([
      "comment",
      "bb-1",
      "--",
      "--db=/tmp/evil",
    ])
  })

  test("rejects a flag-shaped bead ID", () => {
    expect(() => buildCommentArgs(HOSTILE_ID, "text")).toThrow(BdArgvError)
  })
})

describe("exported bd functions reject flag-shaped bead IDs", () => {
  const cases: Array<[string, () => Promise<unknown>]> = [
    ["showBead", () => showBead(HOSTILE_ID)],
    ["showBeads", () => showBeads(["bb-1", HOSTILE_ID])],
    ["getComments", () => getComments(HOSTILE_ID)],
    ["addComment", () => addComment(HOSTILE_ID, "text")],
    ["updateStatus", () => updateStatus(HOSTILE_ID, "open")],
    ["updateTitle", () => updateTitle(HOSTILE_ID, "x")],
    ["closeBead", () => closeBead(HOSTILE_ID)],
    ["reopenBead", () => reopenBead(HOSTILE_ID)],
    ["deleteBead", () => deleteBead(HOSTILE_ID)],
  ]

  for (const [name, invoke] of cases) {
    test(`${name} throws before spawning bd`, async () => {
      await expect(invoke()).rejects.toThrow(BdArgvError)
    })
  }
})

describe("deleteComment", () => {
  test("rejects a non-numeric comment ID before it reaches the SQL string", async () => {
    await expect(deleteComment("1' OR '1'='1", { db: "/tmp/x/.beads" })).rejects.toThrow(
      BdArgvError,
    )
  })
})

describe("setCustomStatuses", () => {
  // `bd config set status.custom <value>` takes the value as a positional, so
  // neither the --flag=value form nor a "--" terminator applies; the status
  // labels themselves have to be rejected when they look like flags.
  test("rejects a status label that would be parsed as a bd flag", async () => {
    await expect(setCustomStatuses(["open", "--db=/tmp/evil"])).rejects.toThrow(BdArgvError)
  })

  test("rejects a single-dash status label", async () => {
    await expect(setCustomStatuses(["-h"])).rejects.toThrow(BdArgvError)
  })
})
