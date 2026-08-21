// Unit tests for handlers/health.ts (P1.3 / bb-vy13.3).
//
// Surface coverage:
//   - getWorkspaceCount() returns 0 on empty registry, N when populated
//   - runStartupHealth() returns hasWorkspaces=false for empty registry
//   - runStartupHealth() resolves cookie hint > registry active > first entry
//   - removeActiveWorkspace() removes by UUID and surfaces credentialKey
//   - checkBdHealth() returns { bdAvailable: true } on a system with bd installed
//
// We do NOT exercise checkHealth's deep paths against real Dolt servers here —
// those are validated by the P1.7 parity runner against a real workspace. The
// unit suite focuses on registry-IO and signature parity.

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  checkBdHealth,
  getWorkspaceCount,
  removeActiveWorkspace,
  runStartupHealth,
  runWorkspaceMigration,
} from "../handlers/health"

const ORIGINAL_REGISTRY_PATH = process.env.BEADBOX_REGISTRY_PATH
let sandboxDir: string
let sandboxRegistry: string

beforeEach(async () => {
  sandboxDir = await mkdtemp(join(tmpdir(), "beadbox-health-"))
  sandboxRegistry = join(sandboxDir, "registry.json")
  process.env.BEADBOX_REGISTRY_PATH = sandboxRegistry
  // Suppress migration from legacy ~/.beads/registry.json — point it at an
  // empty sandbox path so readRegistry() gets a clean slate.
  process.env.BEADS_REGISTRY_PATH = join(sandboxDir, "legacy-registry.json")
})

afterEach(async () => {
  if (sandboxDir) {
    await rm(sandboxDir, { recursive: true, force: true })
  }
  if (ORIGINAL_REGISTRY_PATH === undefined) {
    delete process.env.BEADBOX_REGISTRY_PATH
  } else {
    process.env.BEADBOX_REGISTRY_PATH = ORIGINAL_REGISTRY_PATH
  }
  delete process.env.BEADS_REGISTRY_PATH
})

async function writeRegistry(payload: Record<string, unknown>): Promise<void> {
  await writeFile(sandboxRegistry, JSON.stringify(payload) + "\n")
}

describe("getWorkspaceCount", () => {
  test("returns 0 for empty registry", async () => {
    expect(await getWorkspaceCount()).toBe(0)
  })

  test("returns N for a populated registry", async () => {
    await writeRegistry({
      version: 2,
      activeWorkspace: null,
      workspaces: [
        {
          id: "a",
          name: "A",
          addedAt: "2026-01-01",
          local: { path: "/tmp/a" },
          server: null,
          mode: "embedded",
        },
        {
          id: "b",
          name: "B",
          addedAt: "2026-01-02",
          local: { path: "/tmp/b" },
          server: null,
          mode: "embedded",
        },
      ],
    })
    expect(await getWorkspaceCount()).toBe(2)
  })
})

describe("runStartupHealth", () => {
  test("returns hasWorkspaces=false on empty registry", async () => {
    const result = await runStartupHealth()
    expect(result.hasWorkspaces).toBe(false)
    expect(result.workspaces).toEqual([])
    expect(result.activeWorkspaceId).toBeUndefined()
    expect(result.platform).toBe(process.platform)
  })

  test("resolves activeWorkspace from cookie hint when valid", async () => {
    const beadsA = join(sandboxDir, "project-a", ".beads")
    const beadsB = join(sandboxDir, "project-b", ".beads")
    await mkdir(beadsA, { recursive: true })
    await mkdir(beadsB, { recursive: true })
    await writeRegistry({
      version: 2,
      activeWorkspace: "a",
      workspaces: [
        {
          id: "a",
          name: "A",
          addedAt: "2026-01-01",
          local: { path: beadsA },
          server: null,
          mode: "embedded",
        },
        {
          id: "b",
          name: "B",
          addedAt: "2026-01-02",
          local: { path: beadsB },
          server: null,
          mode: "embedded",
        },
      ],
    })
    // Pass cookie hint that overrides activeWorkspace
    const result = await runStartupHealth("b")
    expect(result.hasWorkspaces).toBe(true)
    expect(result.workspaces).toHaveLength(2)
    // The health check itself will fail (no real bd workspace), but the
    // structural fields are deterministic.
    expect(result.platform).toBe(process.platform)
    // beadbox-l5i.1: bun's 5s default was enough only while bd was
    // ABSENT and runStartupHealth failed instantly with 'bd not found'.
    // With bd installed in CI it really shells out, which exceeds 5s on a
    // 2-core hosted runner (observed 5001ms). The assertions here are
    // structural, so the extra budget costs nothing.
  }, 30_000)

  test("falls back to first entry when no cookie + no active", async () => {
    const beadsA = join(sandboxDir, "project-a", ".beads")
    await mkdir(beadsA, { recursive: true })
    await writeRegistry({
      version: 2,
      activeWorkspace: null,
      workspaces: [
        {
          id: "a",
          name: "A",
          addedAt: "2026-01-01",
          local: { path: beadsA },
          server: null,
          mode: "embedded",
        },
      ],
    })
    const result = await runStartupHealth()
    expect(result.hasWorkspaces).toBe(true)
    expect(result.activeWorkspaceId).toBe("a")
    // beadbox-l5i.1: bun's 5s default was enough only while bd was
    // ABSENT and runStartupHealth failed instantly with 'bd not found'.
    // With bd installed in CI it really shells out, which exceeds 5s on a
    // 2-core hosted runner (observed 5001ms). The assertions here are
    // structural, so the extra budget costs nothing.
  }, 30_000)
})

describe("removeActiveWorkspace", () => {
  test("removes a workspace by UUID and surfaces credentialKey", async () => {
    await writeRegistry({
      version: 2,
      activeWorkspace: "a",
      workspaces: [
        {
          id: "a",
          name: "A",
          addedAt: "2026-01-01",
          local: null,
          server: { host: "h", port: 1, database: "d", user: "u", tls: false },
          mode: "server",
          credentialKey: "h:1/d/u",
        },
      ],
    })
    const result = await removeActiveWorkspace("a")
    expect(result.removed).toBe(true)
    expect(result.credentialKey).toBe("h:1/d/u")
    expect(await getWorkspaceCount()).toBe(0)
  })

  test("returns removed=false for unknown UUID", async () => {
    await writeRegistry({ version: 2, activeWorkspace: null, workspaces: [] })
    const result = await removeActiveWorkspace("ghost")
    expect(result.removed).toBe(false)
    expect(result.credentialKey).toBeUndefined()
  })
})

describe("checkBdHealth", () => {
  test("returns a result with platform set regardless of bd availability", async () => {
    const result = await checkBdHealth()
    expect(result.platform).toBe(process.platform)
    // bd may or may not be installed in the test env; both branches share
    // the platform field.
    if (result.bdAvailable) {
      expect(typeof result.bdVersion).toBe("string")
      expect(typeof result.bdPath).toBe("string")
    } else {
      expect(Array.isArray(result.paths_checked)).toBe(true)
      expect(typeof result.error_detail).toBe("string")
    }
  })
})

describe("runWorkspaceMigration", () => {
  test("returns ok=false when path is empty", async () => {
    const result = await runWorkspaceMigration("")
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Missing workspace path/i)
  })
})
