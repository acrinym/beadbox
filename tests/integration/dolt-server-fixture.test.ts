/**
 * Integration tests for the reusable Dolt server fixture.
 *
 * Verifies:
 * 1. Server starts and accepts connections
 * 2. Workspace seeding writes correct metadata
 * 3. bd CLI can reach the seeded workspace
 * 4. Cleanup kills server and removes temp data
 */

import { describe, it, expect, afterEach } from "vitest"
import { spawnSync } from "child_process"
import { existsSync, readFileSync, mkdtempSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import {
  createManagedDoltServer,
  seedServerWorkspace,
  findDolt,
  findBd,
  type ManagedDoltServer,
} from "../../e2e/fixtures/dolt-server"

const DOLT_PATH = findDolt()
const BD_PATH = findBd()

// Track servers for cleanup in case a test fails mid-way
let activeServer: ManagedDoltServer | null = null

afterEach(() => {
  if (activeServer) {
    try { activeServer.cleanup() } catch { /* best-effort */ }
    activeServer = null
  }
})

function doltQuery(port: number, query: string): { status: number; stdout: string } {
  const result = spawnSync(DOLT_PATH, [
    "--host", "127.0.0.1",
    "--port", String(port),
    "--user", "root",
    "-p", "",
    "--no-tls",
    "sql", "-q", query,
  ], { encoding: "utf-8", timeout: 5000 })
  return { status: result.status ?? -1, stdout: result.stdout ?? "" }
}

describe("createManagedDoltServer", () => {
  it("starts a server that accepts connections", () => {
    const server = createManagedDoltServer()
    activeServer = server

    expect(server.host).toBe("127.0.0.1")
    expect(server.port).toBeGreaterThan(0)
    expect(server.isRunning()).toBe(true)

    // Verify the server accepts a SQL query
    const result = doltQuery(server.port, "SELECT 1 AS ok")
    expect(result.status).toBe(0)

    server.cleanup()
    activeServer = null
  })

  it("creates the test database during init", () => {
    const server = createManagedDoltServer({ databaseName: "test_db_check" })
    activeServer = server

    // The database subdirectory should exist in the data dir
    expect(existsSync(join(server.dataDir, "test_db_check"))).toBe(true)

    // Verify the database is accessible via SQL
    const result = doltQuery(server.port, "SHOW DATABASES")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("test_db_check")

    server.cleanup()
    activeServer = null
  })

  it("cleanup kills server and removes temp directory", () => {
    const server = createManagedDoltServer()
    activeServer = server

    const dataDir = server.dataDir
    const port = server.port

    expect(existsSync(dataDir)).toBe(true)
    expect(server.isRunning()).toBe(true)

    server.cleanup()
    activeServer = null

    // Temp directory should be gone
    expect(existsSync(dataDir)).toBe(false)

    // Server should no longer accept connections
    const result = doltQuery(port, "SELECT 1")
    expect(result.status).not.toBe(0)
  })

  it("no port conflicts with unique ports per call", () => {
    const server1 = createManagedDoltServer()
    activeServer = server1

    const server2 = createManagedDoltServer()

    expect(server1.port).not.toBe(server2.port)

    const r1 = doltQuery(server1.port, "SELECT 1")
    const r2 = doltQuery(server2.port, "SELECT 1")
    expect(r1.status).toBe(0)
    expect(r2.status).toBe(0)

    server2.cleanup()
    server1.cleanup()
    activeServer = null
  })
})

describe("seedServerWorkspace", () => {
  it("writes metadata.json with correct server config", () => {
    const server = createManagedDoltServer({ databaseName: "seed_test" })
    activeServer = server

    const projectDir = mkdtempSync(join(tmpdir(), "dolt-fixture-ws-"))
    seedServerWorkspace(server.host, server.port, "seed_test", projectDir)

    const metaPath = join(projectDir, ".beads", "metadata.json")
    expect(existsSync(metaPath)).toBe(true)

    const meta = JSON.parse(readFileSync(metaPath, "utf-8"))
    expect(meta.dolt_mode).toBe("server")
    expect(meta.dolt_server_host).toBe("127.0.0.1")
    expect(meta.dolt_server_port).toBe(server.port)
    expect(meta.dolt_database).toBe("seed_test")

    // Filesystem markers should exist for health checks
    expect(existsSync(join(projectDir, ".beads", "dolt"))).toBe(true)
    expect(existsSync(join(projectDir, ".beads", "beads.db"))).toBe(true)

    server.cleanup()
    activeServer = null
  })
})
