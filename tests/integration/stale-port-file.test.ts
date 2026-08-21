/**
 * Integration tests for stale dolt-server.port file handling.
 *
 * Reproduces Pattern 3 from production error analysis: "database beadbox not
 * found on Dolt server at 127.0.0.1:13977" where 13977 was a stale port from
 * a crashed Dolt instance.
 *
 * Key finding (bd v0.59.0): bd reads dolt-server.port to determine the Dolt
 * server address, NOT metadata.json. A stale port file causes bd to connect
 * to the wrong address and fail. Beadbox must keep the port file in sync.
 *
 * These tests verify:
 * 1. bd CLI fails when dolt-server.port contains a dead port (expected behavior)
 * 2. bd CLI fails when dolt-server.port points to the wrong Dolt instance
 * 3. Port file gets correctly updated when Dolt restarts on a new port
 */

import { describe, it, expect, afterEach } from "vitest"
import { spawnSync } from "child_process"
import { readFileSync, writeFileSync, mkdtempSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import {
  createManagedDoltServer,
  seedServerWorkspace,
  findBd,
  type ManagedDoltServer,
} from "../../e2e/fixtures/dolt-server"

const BD_PATH = findBd()

// Track servers for cleanup
const activeServers: ManagedDoltServer[] = []

afterEach(() => {
  for (const server of activeServers) {
    try { server.cleanup() } catch { /* best-effort */ }
  }
  activeServers.length = 0
})

/** Call bd CLI with optional port override via BEADS_DOLT_SERVER_PORT. */
function bdExec(
  dbPath: string,
  args: string[],
  options?: { doltPort?: number; expectFailure?: boolean },
): { status: number; stdout: string; stderr: string } {
  const env: NodeJS.ProcessEnv = { ...process.env }
  // Remove any inherited BEADS_DOLT_SERVER_PORT so tests control it explicitly
  delete env.BEADS_DOLT_SERVER_PORT
  if (options?.doltPort !== undefined) {
    env.BEADS_DOLT_SERVER_PORT = String(options.doltPort)
  }
  const result = spawnSync(BD_PATH, ["--db", dbPath, ...args], {
    encoding: "utf-8",
    env,
    timeout: 15_000,
  })
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  }
}

describe("stale dolt-server.port file", () => {

  describe("Test 1: port file with dead port", () => {
    it("bd fails when dolt-server.port contains a dead port", () => {
      // Start a Dolt server and seed a workspace
      const server = createManagedDoltServer({ databaseName: "beadbox" })
      activeServers.push(server)

      const projectDir = mkdtempSync(join(tmpdir(), "stale-port-test1-"))
      seedServerWorkspace(server.host, server.port, "beadbox", projectDir)

      const dbPath = join(projectDir, ".beads", "dolt")
      const portFile = join(projectDir, ".beads", "dolt-server.port")

      // Baseline: bd works with correct port file
      const baseline = bdExec(dbPath, ["status", "--json"])
      expect(baseline.status).toBe(0)

      // Write a dead port to the port file (no server on 13977)
      writeFileSync(portFile, "13977")
      expect(readFileSync(portFile, "utf-8").trim()).toBe("13977")

      // Also poison metadata.json so bd's auto-start can't fall back to
      // the correct port. bd reads dolt-server.port first, but auto-start
      // reads metadata.json's dolt_server_port as a fallback.
      const metaPath = join(projectDir, ".beads", "metadata.json")
      const meta = JSON.parse(readFileSync(metaPath, "utf-8"))
      const savedPort = meta.dolt_server_port
      meta.dolt_server_port = 13977
      writeFileSync(metaPath, JSON.stringify(meta, null, 2))

      // bd can't find a valid server via either source → failure
      const result = bdExec(dbPath, ["status", "--json"])
      expect(result.status).not.toBe(0)
      const errorOutput = result.stdout + result.stderr
      expect(errorOutput).toMatch(/failed to open database|Dolt server unreachable/i)

      // Restoring both the port file and metadata.json fixes the issue
      writeFileSync(portFile, String(server.port))
      meta.dolt_server_port = savedPort
      writeFileSync(metaPath, JSON.stringify(meta, null, 2))
      const recovered = bdExec(dbPath, ["status", "--json"])
      expect(recovered.status).toBe(0)
    })
  })

  describe("Test 2: port file pointing to wrong Dolt instance", () => {
    it("bd fails when dolt-server.port points to the wrong Dolt instance", () => {
      // Start Dolt A with database "alpha"
      const serverA = createManagedDoltServer({ databaseName: "alpha" })
      activeServers.push(serverA)

      // Start Dolt B with database "beadbox"
      const serverB = createManagedDoltServer({ databaseName: "beadbox" })
      activeServers.push(serverB)

      // Seed workspace: metadata.json points to server B (correct),
      // but port file will point to server A (wrong)
      const projectDir = mkdtempSync(join(tmpdir(), "stale-port-test2-"))
      seedServerWorkspace(serverB.host, serverB.port, "beadbox", projectDir)

      const dbPath = join(projectDir, ".beads", "dolt")
      const portFile = join(projectDir, ".beads", "dolt-server.port")

      // Overwrite port file with server A's port (wrong Dolt instance)
      writeFileSync(portFile, String(serverA.port))

      // Also poison metadata.json so bd's auto-start can't fall back to
      // the correct port (server B). Both sources must point to server A.
      const metaPath = join(projectDir, ".beads", "metadata.json")
      const meta = JSON.parse(readFileSync(metaPath, "utf-8"))
      meta.dolt_server_port = serverA.port
      writeFileSync(metaPath, JSON.stringify(meta, null, 2))

      // Verify both sources point to server A
      expect(readFileSync(portFile, "utf-8").trim()).toBe(String(serverA.port))
      expect(meta.dolt_server_port).toBe(serverA.port)

      // Port file + metadata both point to server A (has "alpha", not "beadbox").
      // bd connects to server A and fails because "beadbox" database isn't there.
      const badResult = bdExec(dbPath, ["status", "--json"])
      expect(badResult.status).not.toBe(0)
      const errorOutput = badResult.stdout + badResult.stderr
      expect(errorOutput).toMatch(/failed to open database|not found/i)

      // BEADS_DOLT_SERVER_PORT env override also causes the same failure
      // when it points to the wrong server
      writeFileSync(portFile, String(serverB.port)) // fix port file
      meta.dolt_server_port = serverB.port          // fix metadata
      writeFileSync(metaPath, JSON.stringify(meta, null, 2))
      const envBadResult = bdExec(dbPath, ["status", "--json"], {
        doltPort: serverA.port,
      })
      expect(envBadResult.status).not.toBe(0)

      // With correct port file, correct metadata, and no env override, bd succeeds
      const goodResult = bdExec(dbPath, ["status", "--json"])
      expect(goodResult.status).toBe(0)
    })
  })

  describe("Test 3: port file gets updated when Dolt restarts on new port", () => {
    it("port file reflects the new port after Dolt restart", () => {
      // Start Dolt on port A
      const serverA = createManagedDoltServer({ databaseName: "beadbox" })
      activeServers.push(serverA)
      const portA = serverA.port

      // Seed workspace with port A
      const projectDir = mkdtempSync(join(tmpdir(), "stale-port-test3-"))
      seedServerWorkspace(serverA.host, portA, "beadbox", projectDir)

      const portFile = join(projectDir, ".beads", "dolt-server.port")
      const metaPath = join(projectDir, ".beads", "metadata.json")
      const dbPath = join(projectDir, ".beads", "dolt")

      // Verify port file has port A
      expect(readFileSync(portFile, "utf-8").trim()).toBe(String(portA))

      // Verify bd works with port A
      const resultA = bdExec(dbPath, ["status", "--json"])
      expect(resultA.status).toBe(0)

      // Stop Dolt A
      serverA.stop()

      // Start Dolt B on a different port
      const serverB = createManagedDoltServer({ databaseName: "beadbox" })
      activeServers.push(serverB)
      const portB = serverB.port
      expect(portB).not.toBe(portA)

      // Port file is now stale (still has port A, which is dead)
      expect(readFileSync(portFile, "utf-8").trim()).toBe(String(portA))

      // Re-seed workspace with new port B (simulates app updating on restart)
      seedServerWorkspace(serverB.host, portB, "beadbox", projectDir)

      // Verify port file now has port B
      expect(readFileSync(portFile, "utf-8").trim()).toBe(String(portB))

      // Verify metadata.json now has port B
      const meta = JSON.parse(readFileSync(metaPath, "utf-8"))
      expect(meta.dolt_server_port).toBe(portB)

      // Verify bd works with the new port
      const resultB = bdExec(dbPath, ["status", "--json"])
      expect(resultB.status).toBe(0)
    })
  })
})
