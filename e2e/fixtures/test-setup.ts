import { test as base } from "@playwright/test"
import { randomUUID } from "crypto"
import type { ChildProcess } from "child_process"
import { cpSync, mkdirSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync, renameSync } from "fs"
import { join, basename, dirname } from "path"
import { tmpdir } from "os"
import {
  TEMPLATE_DATA_DIR,
  TEMPLATE_WS_DIR,
  TEMPLATE_ALPHA_WS_DIR,
  TEMPLATE_BETA_WS_DIR,
  TEMPLATE_GAMMA_WS_DIR,
} from "../global-setup"
import {
  startDoltServer,
  stopDoltServer,
  waitForTablesReady,
  waitForDoltStable,
  killProcessOnPort,
  waitForPortUnreachable,
  clearCircuitBreakerState,
  findFreePort,
  bd,
  bdCreate,
  type DoltServerControl,
  type DoltServerHandle,
} from "./dolt-server"

export { bd, bdCreate, waitForPortUnreachable }
export type { DoltServerControl }

// Per-worker Dolt servers use ephemeral ports (findFreePort) instead of
// hardcoded base ports. bd 0.60+ uses OS-assigned ports, so the fixture
// mirrors that behavior to avoid port conflicts and stale port state.

export interface TestDb {
  dbPath: string
  projectDir: string
  workspaceId: string
}

// Copy a template workspace dir and rewrite metadata.json + dolt-server.port
// to point to the worker's Dolt server port.
export function copyWorkspace(templateWsDir: string, suffix: string, doltPort: number): TestDb {
  const projectDir = join(tmpdir(), `beadbox-e2e-${suffix}-${process.pid}-${Date.now()}`)
  mkdirSync(projectDir, { recursive: true })
  cpSync(join(templateWsDir, ".beads"), join(projectDir, ".beads"), { recursive: true })

  const beadsDir = join(projectDir, ".beads")

  // Rewrite port in metadata.json
  const metaPath = join(beadsDir, "metadata.json")
  const meta = JSON.parse(readFileSync(metaPath, "utf-8"))
  meta.dolt_server_port = doltPort
  writeFileSync(metaPath, JSON.stringify(meta, null, 2))

  // Write dolt-server.port so bd CLI finds the correct server port at runtime.
  // bd reads both this file AND metadata.json's dolt_server_port for auto-start.
  writeFileSync(join(beadsDir, "dolt-server.port"), String(doltPort))

  // Disable bd auto-start in test workspaces. The E2E fixture manages Dolt
  // servers per-worker; bd's auto-start races with the fixture and fails
  // because it can't create lock files in temp dirs under parallel load.
  const configPath = join(beadsDir, "config.yaml")
  if (!existsSync(configPath)) {
    writeFileSync(configPath, "dolt:\n  auto-start: false\n")
  } else {
    const existing = readFileSync(configPath, "utf-8")
    if (!existing.includes("auto-start")) {
      writeFileSync(configPath, existing + "\ndolt:\n  auto-start: false\n")
    }
  }

  // Ensure dolt/ marker and beads.db placeholder exist so the health check
  // (databaseExists) recognizes this as a valid workspace. In server mode the
  // real data lives in the Dolt server, but the health check probes the filesystem.
  mkdirSync(join(beadsDir, "dolt"), { recursive: true })
  if (!existsSync(join(beadsDir, "beads.db"))) writeFileSync(join(beadsDir, "beads.db"), "")

  // Return .beads directory as dbPath (matches real registry format).
  // The app's normalizeDbPath converts .beads -> .beads/dolt for bd CLI calls.
  return { dbPath: beadsDir, projectDir, workspaceId: randomUUID() }
}

// Workspace pair for multi-workspace E2E tests
export interface WorkspacePair {
  alpha: TestDb & { name: string }
  beta: TestDb & { name: string }
}

// Workspace triple for lifecycle E2E tests (add/remove/switch scenarios)
export interface WorkspaceTriple {
  alpha: TestDb & { name: string }
  beta: TestDb & { name: string }
  gamma: TestDb & { name: string }
}

// Test-scoped registry control for workspace lifecycle tests
export interface RegistryControl {
  readRegistry(): unknown[]
  writeRegistry(entries: unknown[]): void
  clearRegistry(): void
  getPath(): string
}

// Registry path for test isolation (legacy bd format)
function getTestRegistryPath(): string {
  const envPath = process.env.BEADS_REGISTRY_PATH
  if (!envPath) {
    throw new Error(
      "BEADS_REGISTRY_PATH not set. E2E tests must run via playwright.config.ts which sets this."
    )
  }
  return envPath
}

// Beadbox-format registry path (used by the app's health check)
function getTestBeadboxRegistryPath(): string {
  const envPath = process.env.BEADBOX_REGISTRY_PATH
  if (!envPath) {
    throw new Error(
      "BEADBOX_REGISTRY_PATH not set. E2E tests must run via playwright.config.ts which sets this."
    )
  }
  return envPath
}

// Atomically write JSON to a file (write-to-temp + rename).
function atomicWriteJson(filePath: string, data: unknown): void {
  const dir = dirname(filePath)
  const tmp = join(dir, `.tmp-${process.pid}-${Date.now()}.json`)
  writeFileSync(tmp, JSON.stringify(data, null, 2))
  renameSync(tmp, filePath)
}

// File-based lock using mkdir (atomic on all platforms).
// Serializes read-modify-write operations on the shared registry files
// across parallel Playwright workers (separate processes).
function withRegistryLock<T>(fn: () => T): T {
  const lockDir = getTestRegistryPath() + ".lock"
  const maxWaitMs = 10_000
  const start = Date.now()
  while (true) {
    try {
      mkdirSync(lockDir)
      break
    } catch {
      if (Date.now() - start > maxWaitMs) {
        // Stale lock from a crashed process
        try { rmSync(lockDir, { recursive: true }) } catch { /* ignore */ }
        try { mkdirSync(lockDir) } catch { /* ignore */ }
        break
      }
      // Busy-wait with jitter to avoid thundering herd
      const waitUntil = Date.now() + 5 + Math.floor(Math.random() * 20)
      while (Date.now() < waitUntil) { /* spin */ }
    }
  }
  try {
    return fn()
  } finally {
    try { rmSync(lockDir, { recursive: true }) } catch { /* ignore */ }
  }
}

// Register test workspaces in both the legacy and beadbox registries.
// Appends entries to each registry (preserving other workers' entries).
// Returns a cleanup function that removes only the entries we added.
export function registerTestWorkspaces(workspaces: TestDb[]): () => void {
  const registryPath = getTestRegistryPath()
  const beadboxRegistryPath = getTestBeadboxRegistryPath()

  // Legacy bd format (flat array)
  const additions = workspaces.map((ws) => ({
    workspace_path: ws.projectDir,
    database_path: ws.dbPath,
    socket_path: join(ws.projectDir, ".beads", "bd.sock"),
    pid: 0,
    version: "e2e-test",
    started_at: new Date().toISOString(),
  }))

  // Beadbox v2 format ({version: 2, workspaces: [...], activeWorkspace: null})
  const beadboxAdditions = workspaces.map((ws) => ({
    id: ws.workspaceId,            // Use the UUID assigned at copyWorkspace time
    path: ws.dbPath,               // v1 compat: current app reads this
    name: basename(ws.projectDir),
    addedAt: new Date().toISOString(),
    local: { path: ws.dbPath },    // v2: structured local path
    server: null,                  // v2: no server connection for test workspaces
    mode: "embedded" as const,     // v2: mode field
  }))

  withRegistryLock(() => {
    let existing: unknown[] = []
    try {
      existing = JSON.parse(readFileSync(registryPath, "utf-8"))
    } catch {
      // File may not exist yet
    }
    atomicWriteJson(registryPath, [...existing, ...additions])

    let existingBeadbox: { version?: number; workspaces: Array<Record<string, unknown>>; activeWorkspace: string | null } = { version: 2, workspaces: [], activeWorkspace: null }
    try {
      const parsed = JSON.parse(readFileSync(beadboxRegistryPath, "utf-8"))
      existingBeadbox = {
        version: parsed.version ?? 2,
        workspaces: Array.isArray(parsed.workspaces) ? parsed.workspaces : [],
        activeWorkspace: typeof parsed.activeWorkspace === "string" ? parsed.activeWorkspace : null,
      }
    } catch {
      // File may not exist yet
    }
    atomicWriteJson(beadboxRegistryPath, {
      version: 2,
      workspaces: [...existingBeadbox.workspaces, ...beadboxAdditions],
      activeWorkspace: existingBeadbox.activeWorkspace,
    })
  })

  return () => {
    withRegistryLock(() => {
      // Clean up legacy registry
      try {
        const current = JSON.parse(readFileSync(registryPath, "utf-8")) as Array<{ database_path?: string }>
        const testPaths = new Set(workspaces.map((ws) => ws.dbPath))
        const cleaned = current.filter((e) => !testPaths.has(e.database_path ?? ""))
        atomicWriteJson(registryPath, cleaned)
      } catch {
        // Best-effort cleanup
      }
      // Clean up beadbox registry (v2 format)
      try {
        const current = JSON.parse(readFileSync(beadboxRegistryPath, "utf-8")) as { version?: number; workspaces: Array<{ path?: string; local?: { path: string } }>; activeWorkspace?: string | null }
        const testPaths = new Set(workspaces.map((ws) => ws.dbPath))
        const cleanedWs = (current.workspaces || []).filter((e) => {
          const entryPath = e.path ?? e.local?.path ?? ""
          return !testPaths.has(entryPath)
        })
        atomicWriteJson(beadboxRegistryPath, { version: 2, workspaces: cleanedWs, activeWorkspace: current.activeWorkspace ?? null })
      } catch {
        // Best-effort cleanup
      }
    })
  }
}

// Register workspaces in the beadbox v2 registry only (not legacy bd registry).
// Used by single-workspace fixtures (testDb, serverTestDb) that need UUID lookup
// but should not pollute the header with extra tabs from other workers.
function registerInBeadboxRegistry(
  workspaces: TestDb[],
  mode: "embedded" | "server",
  server?: { host: string; port: number; database: string; user: string; tls: boolean },
): () => void {
  const beadboxRegPath = getTestBeadboxRegistryPath()

  const additions = workspaces.map((ws) => ({
    id: ws.workspaceId,
    path: ws.dbPath,
    name: basename(ws.projectDir),
    addedAt: new Date().toISOString(),
    local: { path: ws.dbPath },
    server: server ?? null,
    mode,
  }))

  withRegistryLock(() => {
    let existing: { version?: number; workspaces: Array<Record<string, unknown>>; activeWorkspace: string | null } = { version: 2, workspaces: [], activeWorkspace: null }
    try {
      const parsed = JSON.parse(readFileSync(beadboxRegPath, "utf-8"))
      existing = {
        version: parsed.version ?? 2,
        workspaces: Array.isArray(parsed.workspaces) ? parsed.workspaces : [],
        activeWorkspace: typeof parsed.activeWorkspace === "string" ? parsed.activeWorkspace : null,
      }
    } catch { /* file may not exist yet */ }

    atomicWriteJson(beadboxRegPath, {
      version: 2,
      workspaces: [...existing.workspaces, ...additions],
      activeWorkspace: existing.activeWorkspace,
    })
  })

  return () => {
    withRegistryLock(() => {
      try {
        const current = JSON.parse(readFileSync(beadboxRegPath, "utf-8")) as {
          version?: number; workspaces: Array<{ id?: string }>; activeWorkspace?: string | null
        }
        const ids = new Set(workspaces.map((ws) => ws.workspaceId))
        const cleaned = (current.workspaces || []).filter((e) => !ids.has(e.id ?? ""))
        atomicWriteJson(beadboxRegPath, { version: 2, workspaces: cleaned, activeWorkspace: current.activeWorkspace ?? null })
      } catch { /* best-effort */ }
    })
  }
}

/**
 * Rewrite dolt-server.port in all test workspace directories belonging to
 * this process. After a managed Dolt restart, bd auto-start may have written
 * a stale random port during the stop window. This overwrites those files
 * with the correct managed server port.
 */
function rewriteTestWorkspacePorts(port: number): void {
  const tmp = tmpdir()
  const pid = String(process.pid)
  try {
    for (const entry of readdirSync(tmp)) {
      // Match workspace dirs created by copyWorkspace: beadbox-e2e-{suffix}-{pid}-{ts}
      if (!entry.startsWith("beadbox-e2e-") || !entry.includes(pid)) continue
      // Skip data dirs (dolt server data, not workspaces)
      if (entry.includes("beadbox-e2e-dolt-")) continue
      const beadsDir = join(tmp, entry, ".beads")
      // Rewrite dolt-server.port (read by buildEnv -> readDoltPort)
      const portFile = join(beadsDir, "dolt-server.port")
      if (existsSync(portFile)) {
        writeFileSync(portFile, String(port))
      }
      // Rewrite metadata.json dolt_server_port (read by bd for auto-start).
      const metaPath = join(beadsDir, "metadata.json")
      if (existsSync(metaPath)) {
        try {
          const meta = JSON.parse(readFileSync(metaPath, "utf-8"))
          meta.dolt_server_port = port
          writeFileSync(metaPath, JSON.stringify(meta, null, 2))
        } catch { /* corrupted metadata.json: skip */ }
      }
    }
  } catch { /* best-effort: tmpdir listing failure is non-fatal */ }
}

export function destroyTestDb(projectDir: string) {
  // Clear circuit breaker state BEFORE destroying so bd calls for other
  // workspaces on the same Dolt port aren't blocked by a stale breaker.
  try {
    const meta = JSON.parse(readFileSync(join(projectDir, ".beads", "metadata.json"), "utf-8"))
    if (meta.dolt_server_port) clearCircuitBreakerState(meta.dolt_server_port)
  } catch { /* best-effort: metadata may already be gone */ }
  try {
    rmSync(projectDir, { recursive: true, force: true })
  } catch {
    // Best-effort cleanup
  }
}

// Per-worker Dolt server state. Shared across fixtures within a worker.
// Exposes stop/start for mid-test server control (error-recovery tests).
interface WorkerDoltServer {
  port: number
  dataDir: string
  stop: () => void
  start: () => void
  isRunning: () => boolean
}

// Custom fixtures that provide test databases backed by per-worker Dolt servers.
// Each worker gets its own Dolt server instance for complete data isolation.
export const test = base.extend<{
  doltServerControl: DoltServerControl
  registryControl: RegistryControl
}, {
  testDb: TestDb
  serverTestDb: TestDb
  workspacePair: WorkspacePair
  workspaceTriple: WorkspaceTriple
  _workerDoltServer: WorkerDoltServer
}>({
  // Internal fixture: starts a per-worker Dolt server.
  // Other fixtures depend on this to get their port.
  // Uses ephemeral ports (findFreePort) to match bd 0.60+ behavior.
  _workerDoltServer: [async ({}, use, workerInfo) => {
    let currentPort = findFreePort()
    const dataDir = join(tmpdir(), `beadbox-e2e-dolt-${workerInfo.parallelIndex}-${process.pid}`)

    // Copy template data directory (contains pre-seeded databases)
    if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true })
    cpSync(TEMPLATE_DATA_DIR, dataDir, { recursive: true })

    // Start the worker's Dolt server (mutable handle for stop/start)
    let handle: DoltServerHandle | null = startDoltServer(currentPort, dataDir)
    waitForTablesReady(currentPort)
    waitForDoltStable(currentPort)
    let hasStartedOnce = true

    await use({
      // Port is a getter because it changes on restart (ephemeral ports).
      get port() { return currentPort },
      dataDir,
      stop() {
        const portToKill = currentPort
        if (handle && !handle.process.killed) {
          stopDoltServer(handle)
        }
        handle = null
        killProcessOnPort(portToKill)
        // Poison test workspace ports to port 1 (requires root to bind).
        // start() restores the real port via rewriteTestWorkspacePorts(port).
        rewriteTestWorkspacePorts(1)
      },
      start() {
        // Use kill(pid, 0) for reliable alive check. ChildProcess.killed is
        // only set by Node's own .kill(); external kills leave
        // it false. kill(0) is a synchronous POSIX process-alive test.
        let processAlive = false
        if (handle?.process?.pid !== undefined) {
          try { process.kill(handle.process.pid, 0); processAlive = true } catch {}
        }
        if (handle && processAlive) {
          throw new Error("Server is already running. Call stop() first.")
        }
        // Pick a new ephemeral port for the restarted server.
        const oldPort = currentPort
        currentPort = findFreePort()
        // Re-copy template data to guarantee clean noms state. After SIGKILL
        // (from test stop()), the noms MANIFEST can be left
        // mid-write. Dolt silently skips databases with corrupt noms, causing
        // "tables not ready" on restart. Fresh copy avoids this entirely.
        killProcessOnPort(oldPort)
        rmSync(dataDir, { recursive: true, force: true })
        cpSync(TEMPLATE_DATA_DIR, dataDir, { recursive: true })
        handle = startDoltServer(currentPort, dataDir)
        // Rewrite ports immediately after server binds, BEFORE stability
        // checks. If waitForTablesReady or waitForDoltStable throws, ports
        // must already point at the real server (not poisoned port 1).
        rewriteTestWorkspacePorts(currentPort)
        clearCircuitBreakerState(currentPort)
        clearCircuitBreakerState(oldPort)
        clearCircuitBreakerState(1)
        // On restart, wait for database tables to be accessible.
        // After SIGKILL, not all databases may reload, so we dynamically
        // discover which ones loaded and verify their tables.
        if (hasStartedOnce) {
          waitForTablesReady(currentPort)
        }
        hasStartedOnce = true
        // Final stability check: confirm the server responds to multiple
        // consecutive queries. A single successful probe can pass while
        // the server is still settling under CI load, causing the next
        // real query (from a test page load) to fail.
        waitForDoltStable(currentPort)
      },
      isRunning() {
        if (handle === null) return false
        // exitCode/signalCode are set asynchronously via the event loop when
        // SIGCHLD fires. In synchronous fixture code the event loop may not
        // have processed the child's death yet, so those fields can still be
        // null even though the process is gone. Use kill(pid, 0) as a
        // synchronous POSIX process-alive check instead.
        if (handle.process.pid === undefined) return false
        try {
          process.kill(handle.process.pid, 0)
          return true
        } catch {
          return false
        }
      },
    })

    // Teardown: stop server, kill any respawned process on the port, remove data.
    if (handle && !handle.process.killed) stopDoltServer(handle)
    killProcessOnPort(currentPort)
    try { rmSync(dataDir, { recursive: true, force: true }) } catch { /* best-effort */ }
  }, { scope: "worker" }],

  // Test-scoped server control: exposes stop/start for error-recovery tests.
  doltServerControl: async ({ _workerDoltServer }, use) => {
    // Ensure the worker Dolt is running (it usually is from _workerDoltServer
    // setup). Only restart if it's down, avoiding a 30-90s restart cycle
    // on every doltServerControl test.
    if (!_workerDoltServer.isRunning()) {
      _workerDoltServer.start()
    }

    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use({
      stop: () => _workerDoltServer.stop(),
      start: () => {
        try {
          _workerDoltServer.start()
        } catch (err) {
          // First attempt failed. Aggressively clean up and retry once.
          try { _workerDoltServer.stop() } catch {}
          _workerDoltServer.start()
        }
      },
      isRunning: () => _workerDoltServer.isRunning(),
      get port() { return _workerDoltServer.port },
    })

    // Teardown: ensure Dolt is running for subsequent worker tests.
    if (!_workerDoltServer.isRunning()) {
      _workerDoltServer.start()
    }
  },

  // Test-scoped registry control for workspace lifecycle tests.
  // Snapshots both registries on setup and restores on teardown so that
  // clearRegistry() within a test doesn't permanently destroy other workers' entries.
  registryControl: async ({}, use) => {
    const regPath = getTestRegistryPath()
    const beadboxRegPath = getTestBeadboxRegistryPath()

    // Snapshot current registry state before the test runs
    const { snapshot, beadboxSnapshot } = withRegistryLock(() => {
      let snap: unknown[]
      try { snap = JSON.parse(readFileSync(regPath, "utf-8")) }
      catch { snap = [] }

      let bbSnap: { version: number; workspaces: unknown[]; activeWorkspace: string | null }
      try { bbSnap = JSON.parse(readFileSync(beadboxRegPath, "utf-8")) }
      catch { bbSnap = { version: 2, workspaces: [], activeWorkspace: null } }

      return { snapshot: snap, beadboxSnapshot: bbSnap }
    })

    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use({
      readRegistry() {
        return withRegistryLock(() => {
          try { return JSON.parse(readFileSync(regPath, "utf-8")) }
          catch { return [] }
        })
      },
      writeRegistry(entries: unknown[]) {
        withRegistryLock(() => atomicWriteJson(regPath, entries))
      },
      clearRegistry() {
        withRegistryLock(() => {
          atomicWriteJson(regPath, [])
          atomicWriteJson(beadboxRegPath, { version: 2, workspaces: [], activeWorkspace: null })
        })
      },
      getPath() { return regPath },
    })

    // Restore: put back entries that existed before this test.
    // This ensures clearRegistry() within a test is scoped to that test only.
    withRegistryLock(() => {
      atomicWriteJson(regPath, snapshot)
      atomicWriteJson(beadboxRegPath, beadboxSnapshot)
    })
  },

  // Single-workspace fixtures register in the beadbox v2 registry so the app
  // can resolve UUID cookies. Only the beadbox registry is written (not the
  // legacy bd registry), which avoids header tab pollution from other workers.
  testDb: [async ({ _workerDoltServer }, use) => {
    const db = copyWorkspace(TEMPLATE_WS_DIR, "test", _workerDoltServer.port)
    // Register in beadbox v2 registry with mode=server and server connection.
    // bd needs dolt_server_port + dolt-server.port to connect to the worker Dolt server.
    const unregister = registerInBeadboxRegistry([db], "server", {
      host: "127.0.0.1",
      port: _workerDoltServer.port,
      database: "e2e",
      user: "root",
      tls: false,
    })
    await use(db)
    unregister()
    destroyTestDb(db.projectDir)
  }, { scope: "worker" }],

  serverTestDb: [async ({ _workerDoltServer }, use) => {
    const db = copyWorkspace(TEMPLATE_WS_DIR, "server", _workerDoltServer.port)
    // Register in beadbox v2 registry with mode=server and server connection
    const unregister = registerInBeadboxRegistry([db], "server", {
      host: "127.0.0.1",
      port: _workerDoltServer.port,
      database: "e2e",
      user: "root",
      tls: false,
    })
    await use(db)
    unregister()
    destroyTestDb(db.projectDir)
  }, { scope: "worker" }],

  workspacePair: [async ({ _workerDoltServer }, use) => {
    const alpha = copyWorkspace(TEMPLATE_ALPHA_WS_DIR, "alpha", _workerDoltServer.port)
    const beta = copyWorkspace(TEMPLATE_BETA_WS_DIR, "beta", _workerDoltServer.port)
    const restoreRegistry = registerTestWorkspaces([alpha, beta])

    const pair: WorkspacePair = {
      alpha: { ...alpha, name: basename(alpha.projectDir) },
      beta: { ...beta, name: basename(beta.projectDir) },
    }

    await use(pair)

    restoreRegistry()
    destroyTestDb(alpha.projectDir)
    destroyTestDb(beta.projectDir)
  }, { scope: "worker" }],

  workspaceTriple: [async ({ _workerDoltServer }, use) => {
    const alpha = copyWorkspace(TEMPLATE_ALPHA_WS_DIR, "alpha3", _workerDoltServer.port)
    const beta = copyWorkspace(TEMPLATE_BETA_WS_DIR, "beta3", _workerDoltServer.port)
    const gamma = copyWorkspace(TEMPLATE_GAMMA_WS_DIR, "gamma3", _workerDoltServer.port)
    const restoreRegistry = registerTestWorkspaces([alpha, beta, gamma])

    const triple: WorkspaceTriple = {
      alpha: { ...alpha, name: basename(alpha.projectDir) },
      beta: { ...beta, name: basename(beta.projectDir) },
      gamma: { ...gamma, name: basename(gamma.projectDir) },
    }

    await use(triple)

    restoreRegistry()
    destroyTestDb(alpha.projectDir)
    destroyTestDb(beta.projectDir)
    destroyTestDb(gamma.projectDir)
  }, { scope: "worker" }],
})

export { expect } from "@playwright/test"
