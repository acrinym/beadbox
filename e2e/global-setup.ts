import { execFileSync } from "child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs"
import { join } from "path"
import { homedir, tmpdir } from "os"

import {
  findBd,
  findFreePort,
  startDoltServer,
  stopDoltServer,
  bd,
  bdCreate,
} from "./fixtures/dolt-server"

const REGISTRY_PATH = join(homedir(), ".beads", "registry.json")

// Unique suffix per Playwright process. globalSetup (main process) sets
// E2E_TEMPLATE_ID before workers spawn. Workers inherit the env var, so
// all processes within a single test run share the same paths. Different
// CI jobs on the same machine get different PIDs, avoiding cross-job races
// where one job's globalTeardown deletes another's template directories.
if (!process.env.E2E_TEMPLATE_ID) {
  process.env.E2E_TEMPLATE_ID = String(process.pid)
}
const TEMPLATE_SUFFIX = process.env.E2E_TEMPLATE_ID

// Template Dolt data directory: contains all seeded databases.
// Workers copy this and start their own Dolt server against the copy.
export const TEMPLATE_DATA_DIR = join(tmpdir(), `beadbox-e2e-dolt-data-${TEMPLATE_SUFFIX}`)

// Template workspace directories: contain .beads/ with metadata.json.
// Workers copy these and update the dolt_server_port in metadata.json.
export const TEMPLATE_WS_DIR = join(tmpdir(), `beadbox-e2e-ws-standard-${TEMPLATE_SUFFIX}`)
export const TEMPLATE_ALPHA_WS_DIR = join(tmpdir(), `beadbox-e2e-ws-alpha-${TEMPLATE_SUFFIX}`)
export const TEMPLATE_BETA_WS_DIR = join(tmpdir(), `beadbox-e2e-ws-beta-${TEMPLATE_SUFFIX}`)
export const TEMPLATE_GAMMA_WS_DIR = join(tmpdir(), `beadbox-e2e-ws-gamma-${TEMPLATE_SUFFIX}`)

// Port used by the temporary Dolt server during template creation.
// Not used at runtime; workers pick their own ephemeral ports.
// Uses findFreePort() to avoid hardcoded port conflicts (bd 0.60+ compat).
const TEMPLATE_DOLT_PORT = Number(process.env.E2E_TEMPLATE_DOLT_PORT) || findFreePort()

const BD_PATH = findBd()

// System databases that Dolt always creates (not user data).
const DOLT_SYSTEM_DATABASES = new Set(["dolt", "information_schema", "mysql"])

function initWorkspace(wsDir: string, prefix: string): string {
  if (existsSync(wsDir)) rmSync(wsDir, { recursive: true, force: true })
  mkdirSync(wsDir, { recursive: true })

  // Record databases before init so we can identify the new one.
  const beforeDbs = new Set(
    existsSync(TEMPLATE_DATA_DIR)
      ? readdirSync(TEMPLATE_DATA_DIR).filter(d => !d.startsWith(".") && !DOLT_SYSTEM_DATABASES.has(d))
      : []
  )

  // Use env vars to tell bd init the server is already running. Without
  // these, bd init tries to start its own Dolt server on the same port,
  // which kills the already-running template server.
  // bd 1.0.x compatibility:
  //   --server + --external  : bd init defaults to embedded mode now, even
  //     with --server-host/--server-port set. We start the dolt server
  //     ourselves (above) and want bd to use it, so we pass --server (use
  //     external sql-server) and --external (server is already running,
  //     don't try to manage its lifecycle).
  //   --skip-hooks            : avoids a bd 1.0.2 self-deadlock on macOS.
  //     bd init runs `git commit`, which fires bd's own pre-commit hook,
  //     which calls `bd export`, which blocks on the embedded-dolt lock
  //     still held by bd init. The hook tries to bound itself with
  //     `timeout`, but that binary is not installed by default on macOS
  //     (only `gtimeout` from coreutils), so the unbounded fallback
  //     hangs indefinitely. Test workspaces are throwaway anyway and do
  //     not need bd's git integration.
  execFileSync(BD_PATH, [
    "init",
    "--prefix", prefix,
    "--server",
    "--external",
    "--server-host", "127.0.0.1",
    "--server-port", String(TEMPLATE_DOLT_PORT),
    "--skip-hooks",
    "-q",
  ], {
    cwd: wsDir,
    encoding: "utf-8",
    env: {
      ...process.env,
      BEADS_DOLT_SERVER_HOST: "127.0.0.1",
      BEADS_DOLT_SERVER_PORT: String(TEMPLATE_DOLT_PORT),
    },
  })

  // Ensure metadata.json records the port and database name.
  // The database name MUST be explicit so it's portable: when workers copy
  // the workspace to a temp directory with a different name, bd derives a
  // different default database name from the directory, causing
  // "database not found" errors. Writing dolt_database makes it stable.
  const metaPath = join(wsDir, ".beads", "metadata.json")
  const meta = JSON.parse(readFileSync(metaPath, "utf-8"))
  if (!meta.dolt_server_port) {
    meta.dolt_server_port = TEMPLATE_DOLT_PORT
  }
  const afterDbs = readdirSync(TEMPLATE_DATA_DIR).filter(d =>
    !d.startsWith(".") && !DOLT_SYSTEM_DATABASES.has(d)
  )
  const newDb = afterDbs.find(d => !beforeDbs.has(d))
  if (!newDb) {
    throw new Error(
      `initWorkspace: no new database detected after bd init in ${wsDir}. ` +
      `Before: [${[...beforeDbs].join(", ")}], After: [${afterDbs.join(", ")}]. ` +
      `This means bd init reused an existing database instead of creating one.`
    )
  }
  meta.dolt_database = newDb
  writeFileSync(metaPath, JSON.stringify(meta, null, 2))

  return join(wsDir, ".beads", "beads.db")
}

function seedStandardData(dbPath: string): void {
  const epicId = bdCreate(dbPath, [
    "--title", "E2E Test Epic", "--type", "epic", "--priority", "2",
  ], TEMPLATE_DOLT_PORT)
  bdCreate(dbPath, [
    "--title", "High Priority Task", "--type", "task", "--priority", "1",
    "--parent", epicId,
  ], TEMPLATE_DOLT_PORT)
  const inProgressId = bdCreate(dbPath, [
    "--title", "In Progress Task", "--type", "task", "--priority", "2",
    "--parent", epicId,
  ], TEMPLATE_DOLT_PORT)
  bd(dbPath, ["update", inProgressId, "--status", "in_progress"], TEMPLATE_DOLT_PORT)
  bdCreate(dbPath, [
    "--title", "Critical Bug", "--type", "bug", "--priority", "0",
    "--parent", epicId,
  ], TEMPLATE_DOLT_PORT)
  const closedId = bdCreate(dbPath, [
    "--title", "Completed Task", "--type", "task", "--priority", "3",
    "--parent", epicId,
  ], TEMPLATE_DOLT_PORT)
  bd(dbPath, ["update", closedId, "--status", "closed"], TEMPLATE_DOLT_PORT)
  bdCreate(dbPath, [
    "--title", "Search Target Alpha", "--type", "task", "--priority", "2",
  ], TEMPLATE_DOLT_PORT)
}

function cleanStaleRegistryEntries(): void {
  try {
    const raw = readFileSync(REGISTRY_PATH, "utf-8")
    const entries = JSON.parse(raw) as Array<{ workspace_path?: string; database_path?: string }>
    const cleaned = entries.filter((e) => {
      const path = e.workspace_path ?? e.database_path ?? ""
      return !path.includes("beadbox-e2e-") && !path.includes("e2e-alpha-") && !path.includes("e2e-beta-") && !path.includes("e2e-gamma-")
    })
    if (cleaned.length !== entries.length) {
      writeFileSync(REGISTRY_PATH, JSON.stringify(cleaned, null, 2))
    }
  } catch {
    // Registry may not exist
  }
}

export default function globalSetup() {
  // 0. Kill orphaned Dolt processes from previous test runs.
  // On CI runners, orphans accumulate across RC cycles and hit the 3-process cap.
  try {
    execFileSync(BD_PATH, ["dolt", "killall"], { encoding: "utf-8", timeout: 10_000 })
  } catch {
    // Ignore: killall may fail if no processes exist or bd is too old
  }
  // 1. Clean stale e2e entries from production registry
  cleanStaleRegistryEntries()

  // 2. Reset the isolated test registries (legacy + beadbox format)
  const testRegistryPath = process.env.BEADS_REGISTRY_PATH
  if (testRegistryPath) {
    writeFileSync(testRegistryPath, "[]")
  }
  const testBeadboxRegistryPath = process.env.BEADBOX_REGISTRY_PATH
  if (testBeadboxRegistryPath) {
    writeFileSync(testBeadboxRegistryPath, JSON.stringify({ version: 2, workspaces: [], activeWorkspace: null }))
  }

  // 3. Prepare template Dolt data directory
  if (existsSync(TEMPLATE_DATA_DIR)) rmSync(TEMPLATE_DATA_DIR, { recursive: true, force: true })
  mkdirSync(TEMPLATE_DATA_DIR, { recursive: true })

  // 4. Start a temporary Dolt server for seeding
  const server = startDoltServer(TEMPLATE_DOLT_PORT, TEMPLATE_DATA_DIR)

  try {
    // 5. Create and seed template workspaces (all on the same temp server)
    const stdDbPath = initWorkspace(TEMPLATE_WS_DIR, "e2e")
    seedStandardData(stdDbPath)

    const alphaDbPath = initWorkspace(TEMPLATE_ALPHA_WS_DIR, "alpha")
    const alphaEpicId = bdCreate(alphaDbPath, [
      "--title", "Alpha Epic", "--type", "epic", "--priority", "2",
    ], TEMPLATE_DOLT_PORT)
    bdCreate(alphaDbPath, [
      "--title", "Alpha Task One", "--type", "task", "--priority", "1",
      "--parent", alphaEpicId,
    ], TEMPLATE_DOLT_PORT)
    bdCreate(alphaDbPath, [
      "--title", "Alpha Task Two", "--type", "task", "--priority", "2",
      "--parent", alphaEpicId,
    ], TEMPLATE_DOLT_PORT)

    const betaDbPath = initWorkspace(TEMPLATE_BETA_WS_DIR, "beta")
    const betaEpicId = bdCreate(betaDbPath, [
      "--title", "Beta Epic", "--type", "epic", "--priority", "1",
    ], TEMPLATE_DOLT_PORT)
    bdCreate(betaDbPath, [
      "--title", "Beta Task One", "--type", "task", "--priority", "0",
      "--parent", betaEpicId,
    ], TEMPLATE_DOLT_PORT)
    bdCreate(betaDbPath, [
      "--title", "Beta Task Two", "--type", "task", "--priority", "3",
      "--parent", betaEpicId,
    ], TEMPLATE_DOLT_PORT)
    const gammaDbPath = initWorkspace(TEMPLATE_GAMMA_WS_DIR, "gamma")
    const gammaEpicId = bdCreate(gammaDbPath, [
      "--title", "Gamma Epic", "--type", "epic", "--priority", "3",
    ], TEMPLATE_DOLT_PORT)
    bdCreate(gammaDbPath, [
      "--title", "Gamma Task One", "--type", "task", "--priority", "2",
      "--parent", gammaEpicId,
    ], TEMPLATE_DOLT_PORT)
  } finally {
    // 6. Stop the template server. Data persists in TEMPLATE_DATA_DIR.
    stopDoltServer(server)
  }

  // 7. Reset test registries again (bd init may have registered templates)
  // NOTE: gamma database stays in TEMPLATE_DATA_DIR alongside e2e/alpha/beta.
  // Dolt sql-server does not auto-discover databases added to its data directory
  // after startup, so extracting gamma and injecting on-demand would require
  // restarting the server (disproportionate complexity for ~200ms latency savings).
  if (testRegistryPath) {
    writeFileSync(testRegistryPath, "[]")
  }
  if (testBeadboxRegistryPath) {
    writeFileSync(testBeadboxRegistryPath, JSON.stringify({ version: 2, workspaces: [], activeWorkspace: null }))
  }
}
