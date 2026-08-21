// Regression suite for getEmbeddedFingerprint (bd.ts cache-validation key).
//
// Signal-source history (see dolt-write-marker.ts for the empirical table):
//   - bb-onv3.11:  last-touched → journal.idx mtime+size.
//   - beadbox-v7l: journal.idx → manifest CONTENT-HASH. Cousin to the
//     subscription-side fix in change-detector-fingerprint.test.ts.
//
// Both invalidations share the same write-marker helper, so they agree
// on what counts as fresh state. The Dolt manifest's bytes encode the
// current commit hash + root pointer; real writes change the bytes,
// while bd show / bd list / Dolt GC do not.
//
// JSON wrapper shape [{ h: "embedded:..." }] is preserved per bb-3gnz.5
// — parseFingerprint elsewhere reads .h; beadbox-v7l only moves the
// inner string's data source.

import { rmSync, utimesSync, writeFileSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { getEmbeddedFingerprint } from "../lib/bd"

let tmpRoot: string

function uniqueRoot(): string {
  return join(tmpdir(), `bb-v7l-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
}

async function setupServerLayout(root: string, dbName: string): Promise<string> {
  const manifest = join(root, ".beads", "dolt", dbName, ".dolt", "noms", "manifest")
  await mkdir(join(root, ".beads", "dolt", dbName, ".dolt", "noms"), { recursive: true })
  await writeFile(manifest, "5:__DOLT__:f8oprniddg50up7sbmifm9u49lbvpvmi:initial-root-hash")
  return manifest
}

async function setupEmbeddedLayout(root: string, dbName: string): Promise<string> {
  const manifest = join(root, ".beads", "embeddeddolt", dbName, ".dolt", "noms", "manifest")
  await mkdir(join(root, ".beads", "embeddeddolt", dbName, ".dolt", "noms"), { recursive: true })
  await writeFile(manifest, "5:__DOLT__:f8oprniddg50up7sbmifm9u49lbvpvmi:initial-root-hash")
  return manifest
}

function parseH(fingerprint: string): string {
  const parsed = JSON.parse(fingerprint) as Array<{ h: string }>
  return parsed[0]?.h ?? ""
}

afterEach(() => {
  if (tmpRoot) {
    try {
      rmSync(tmpRoot, { recursive: true, force: true })
    } catch {
      /* tolerable */
    }
  }
})

beforeEach(() => {
  tmpRoot = uniqueRoot()
})

describe("getEmbeddedFingerprint (beadbox-v7l)", () => {
  test("returns cold-path sentinel when doltDir does not exist", async () => {
    await mkdir(join(tmpRoot, ".beads"), { recursive: true })
    const fp = await getEmbeddedFingerprint(join(tmpRoot, ".beads"))
    const h = parseH(fp)
    expect(h).toMatch(/^embedded:\d+$/) // "embedded:<Date.now()>" sentinel
  })

  test("returns cold-path sentinel when doltDir exists but no manifest", async () => {
    await mkdir(join(tmpRoot, ".beads", "dolt", "bb"), { recursive: true })
    const fp = await getEmbeddedFingerprint(join(tmpRoot, ".beads"))
    const h = parseH(fp)
    expect(h).toMatch(/^embedded:\d+$/)
  })

  test("returns a manifest-derived fingerprint (server layout)", async () => {
    await setupServerLayout(tmpRoot, "bb")
    const fp = await getEmbeddedFingerprint(join(tmpRoot, ".beads"))
    const h = parseH(fp)
    expect(h).toContain("manifest")
    expect(h).not.toMatch(/^embedded:\d+$/) // NOT the cold-path sentinel
  })

  test("returns a manifest-derived fingerprint (embedded layout)", async () => {
    await setupEmbeddedLayout(tmpRoot, "cla")
    const fp = await getEmbeddedFingerprint(join(tmpRoot, ".beads"))
    const h = parseH(fp)
    expect(h).toContain("manifest")
  })

  test("fingerprint stays stable when manifest content is unchanged", async () => {
    await setupServerLayout(tmpRoot, "bb")
    const fp1 = await getEmbeddedFingerprint(join(tmpRoot, ".beads"))
    const fp2 = await getEmbeddedFingerprint(join(tmpRoot, ".beads"))
    expect(fp1).toBe(fp2)
  })

  test("fingerprint flips when manifest content changes (real bd-create pattern)", async () => {
    const manifest = await setupServerLayout(tmpRoot, "bb")
    const fpBefore = await getEmbeddedFingerprint(join(tmpRoot, ".beads"))
    writeFileSync(manifest, "5:__DOLT__:f8oprniddg50up7sbmifm9u49lbvpvmi:NEW-root-hash-after-commit")
    const fpAfter = await getEmbeddedFingerprint(join(tmpRoot, ".beads"))
    expect(fpAfter).not.toBe(fpBefore)
  })

  test("fingerprint does NOT flip on mtime-only updates (bd 1.0.2 GC pattern)", async () => {
    const manifest = await setupServerLayout(tmpRoot, "bb")
    const fpBefore = await getEmbeddedFingerprint(join(tmpRoot, ".beads"))
    const future = new Date(Date.now() + 2000)
    utimesSync(manifest, future, future)
    const fpAfter = await getEmbeddedFingerprint(join(tmpRoot, ".beads"))
    expect(fpAfter).toBe(fpBefore)
  })

  test("does NOT flip when sibling Dolt internals churn (journal.idx + vvv...v)", async () => {
    await setupServerLayout(tmpRoot, "bb")
    const noms = join(tmpRoot, ".beads", "dolt", "bb", ".dolt", "noms")
    const journal = join(noms, "journal.idx")
    const vvvv = join(noms, "vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv")
    await writeFile(journal, "initial-journal-content")
    await writeFile(vvvv, "initial-data-content")
    const fpBefore = await getEmbeddedFingerprint(join(tmpRoot, ".beads"))
    writeFileSync(journal, "compacted-journal-different-bytes-and-length")
    writeFileSync(vvvv, "compacted-data-different-content")
    const future = new Date(Date.now() + 2000)
    utimesSync(journal, future, future)
    utimesSync(vvvv, future, future)
    const fpAfter = await getEmbeddedFingerprint(join(tmpRoot, ".beads"))
    expect(fpAfter).toBe(fpBefore)
  })

  test("multiple databases under one dolt root combine into one fingerprint", async () => {
    await setupServerLayout(tmpRoot, "bb")
    const secondManifest = join(
      tmpRoot,
      ".beads",
      "dolt",
      "secondary",
      ".dolt",
      "noms",
      "manifest",
    )
    await mkdir(join(tmpRoot, ".beads", "dolt", "secondary", ".dolt", "noms"), { recursive: true })
    await writeFile(secondManifest, "5:__DOLT__:secondary-db-initial-hash")
    const fp = await getEmbeddedFingerprint(join(tmpRoot, ".beads"))
    const h = parseH(fp)
    expect(h).toContain("bb")
    expect(h).toContain("secondary")
  })

  test("does NOT rely on .beads/last-touched (bd 1.0.x read-marker noise)", async () => {
    await setupServerLayout(tmpRoot, "bb")
    const lastTouched = join(tmpRoot, ".beads", "last-touched")
    await writeFile(lastTouched, "initial-bead-id")
    const fp1 = await getEmbeddedFingerprint(join(tmpRoot, ".beads"))
    await writeFile(lastTouched, "different-bead-id-from-bd-show")
    const fp2 = await getEmbeddedFingerprint(join(tmpRoot, ".beads"))
    expect(fp1).toBe(fp2)
  })

  test("wrapper shape [{ h: ... }] is preserved (bb-3gnz.5 contract)", async () => {
    await setupServerLayout(tmpRoot, "bb")
    const fp = await getEmbeddedFingerprint(join(tmpRoot, ".beads"))
    const parsed = JSON.parse(fp)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.length).toBe(1)
    expect(typeof parsed[0].h).toBe("string")
    expect(parsed[0].h).toMatch(/^embedded:/)
    expect(parsed[0].i).toBeUndefined()
    expect(parsed[0].c).toBeUndefined()
  })
})
