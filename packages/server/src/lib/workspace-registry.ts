import { randomUUID } from "crypto"
import { mkdir, readFile, writeFile } from "fs/promises"
import { homedir } from "os"
import { basename, dirname, join, resolve } from "path"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ServerConnection {
  host: string
  port: number
  database: string
  user: string
  tls: boolean
}

// v2 registry entry with UUID identity
export interface RegistryEntry {
  id: string // UUID, assigned at creation, immutable
  name: string // display name
  addedAt: string // ISO 8601
  local: { path: string } | null // null for server-only
  server: ServerConnection | null // null for local-only
  mode: "server" | "embedded"
  credentialKey?: string // OS keychain account name (host:port/database/user)
}

export interface WorkspaceRegistry {
  version: 2
  activeWorkspace: string | null // UUID
  workspaces: RegistryEntry[]
}

// Legacy v1 types for migration
interface V1RegistryEntry {
  path: string | null
  name: string
  addedAt: string
  server?: ServerConnection
}

interface V1Registry {
  workspaces: V1RegistryEntry[]
  activeWorkspace: string | null // was a path or serverWorkspaceId
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Returns the path to the beadbox workspace registry file.
 * Respects BEADBOX_REGISTRY_PATH env var for test isolation.
 */
export function getBeadboxRegistryPath(): string {
  return process.env.BEADBOX_REGISTRY_PATH || join(homedir(), ".beadbox", "registry.json")
}

/**
 * Returns the path to the legacy bd workspace registry for migration.
 * Respects BEADS_REGISTRY_PATH env var for test isolation.
 */
function getLegacyRegistryPath(): string {
  return process.env.BEADS_REGISTRY_PATH || join(homedir(), ".beads", "registry.json")
}

// ---------------------------------------------------------------------------
// UUID generation & lookup
// ---------------------------------------------------------------------------

export function generateWorkspaceId(): string {
  return randomUUID()
}

export function findWorkspace(registry: WorkspaceRegistry, id: string): RegistryEntry | null {
  return registry.workspaces.find((w) => w.id === id) ?? null
}

/**
 * Find a workspace by its databasePath (local path, server runtime path, or server:// URI).
 * Used as a transitional adapter while callers still pass databasePath instead of UUID.
 */
export function findWorkspaceByDbPath(
  registry: WorkspaceRegistry,
  databasePath: string,
): RegistryEntry | null {
  // Match server:// URIs against registry entries
  if (databasePath.startsWith("server://")) {
    for (const entry of registry.workspaces) {
      if (entry.server) {
        const uri = `server://${entry.server.host}:${entry.server.port}/${entry.server.database}`
        if (uri === databasePath) return entry
      }
    }
    return null
  }
  const normalized = resolve(databasePath)
  for (const entry of registry.workspaces) {
    if (entry.local && resolve(entry.local.path) === normalized) return entry
  }
  return null
}

/**
 * Derive the db identifier for bd CLI from a registry entry.
 * Server-only -> server:// URI (bd uses env vars), local -> local.path.
 */
export function resolveBdDbPath(entry: RegistryEntry): string {
  if (entry.mode === "server" && !entry.local && entry.server) {
    return `server://${entry.server.host}:${entry.server.port}/${entry.server.database}`
  }
  if (entry.local) return join(entry.local.path, "beads.db")
  throw new Error(`Workspace ${entry.id} has no local path and no server connection`)
}

// ---------------------------------------------------------------------------
// Workspace metadata
// ---------------------------------------------------------------------------

export interface WorkspaceMetadata {
  mode: "server" | "embedded"
  serverHost?: string
  serverPort?: number
  serverDatabase?: string
  serverUser?: string
  serverTls?: boolean
  parseError?: string
}

export async function readWorkspaceMetadata(beadsDir: string): Promise<WorkspaceMetadata> {
  try {
    const metaPath = join(beadsDir, "metadata.json")
    const content = await readFile(metaPath, "utf-8")
    const meta = JSON.parse(content)
    if (meta.dolt_mode === "server") {
      return {
        mode: "server",
        serverHost: typeof meta.dolt_server_host === "string" ? meta.dolt_server_host : "127.0.0.1",
        serverPort: typeof meta.dolt_server_port === "number" ? meta.dolt_server_port : 3307,
        serverDatabase: typeof meta.dolt_database === "string" ? meta.dolt_database : "beads",
        serverUser: typeof meta.dolt_server_user === "string" ? meta.dolt_server_user : "root",
        serverTls: meta.dolt_server_tls === true,
      }
    }
    return { mode: "embedded" }
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return { mode: "embedded" }
    }
    return {
      mode: "embedded",
      parseError:
        "metadata.json exists but could not be parsed: " +
        (err instanceof Error ? err.message : String(err)),
    }
  }
}

// ---------------------------------------------------------------------------
// Read / Write
// ---------------------------------------------------------------------------

function emptyRegistry(): WorkspaceRegistry {
  return { version: 2, workspaces: [], activeWorkspace: null }
}

/**
 * Read the beadbox workspace registry. Returns empty v2 registry if file is
 * missing. Detects v1 format and auto-migrates to v2 with UUID identity.
 * On first run (file doesn't exist), attempts one-time migration from
 * the legacy ~/.beads/registry.json.
 */
export async function readRegistry(): Promise<WorkspaceRegistry> {
  const registryPath = getBeadboxRegistryPath()

  try {
    const content = await readFile(registryPath, "utf-8")
    const parsed = JSON.parse(content)
    if (parsed.version === 2) {
      return deduplicateEntries(parsed as WorkspaceRegistry)
    }
    // v1 registry (no version field): migrate
    const v1: V1Registry = {
      workspaces: Array.isArray(parsed.workspaces) ? parsed.workspaces : [],
      activeWorkspace: typeof parsed.activeWorkspace === "string" ? parsed.activeWorkspace : null,
    }
    return deduplicateEntries(migrateV1ToV2(v1))
  } catch {
    // File doesn't exist or invalid JSON - attempt migration from legacy registry
    const legacy = await migrateFromLegacyRegistry()
    if (legacy.workspaces.length > 0) {
      return deduplicateEntries(
        migrateV1ToV2({
          workspaces: legacy.workspaces,
          activeWorkspace: legacy.activeWorkspace,
        }),
      )
    }
    return emptyRegistry()
  }
}

/**
 * Remove duplicate entries from a registry. Deduplicates by:
 * - local.path (resolved) for local workspaces
 * - host+port+database for server-only workspaces
 * Keeps the first entry for each identity.
 */
function deduplicateEntries(registry: WorkspaceRegistry): WorkspaceRegistry {
  const seenLocalPaths = new Set<string>()
  const seenServerKeys = new Set<string>()
  const before = registry.workspaces.length

  registry.workspaces = registry.workspaces.filter((entry) => {
    if (entry.local) {
      const key = resolve(entry.local.path)
      if (seenLocalPaths.has(key)) return false
      seenLocalPaths.add(key)
    }
    if (!entry.local && entry.server) {
      const key = `${entry.server.host}:${entry.server.port}/${entry.server.database}`
      if (seenServerKeys.has(key)) return false
      seenServerKeys.add(key)
    }
    return true
  })

  if (registry.workspaces.length < before) {
    console.log(
      `[beadbox-registry] deduplicated ${before - registry.workspaces.length} entries on load`,
    )
  }

  return registry
}

/**
 * Write the registry atomically (mkdir -p the parent dir first).
 */
export async function writeRegistry(registry: WorkspaceRegistry): Promise<void> {
  const registryPath = getBeadboxRegistryPath()
  await mkdir(dirname(registryPath), { recursive: true })
  await writeFile(registryPath, JSON.stringify(registry, null, 2) + "\n")
}

// ---------------------------------------------------------------------------
// v1 -> v2 Migration
// ---------------------------------------------------------------------------

function migrateV1ToV2(v1: V1Registry): WorkspaceRegistry {
  const idMap = new Map<string, string>() // old path/serverWorkspaceId -> new UUID
  const workspaces: RegistryEntry[] = v1.workspaces.map((entry) => {
    const id = generateWorkspaceId()
    // Map old identity formats to the new UUID
    if (entry.path) idMap.set(entry.path, id)
    if (entry.server) {
      idMap.set(serverWorkspaceId(entry.server), id)
    }

    return {
      id,
      name: entry.name,
      addedAt: entry.addedAt,
      local: entry.path ? { path: entry.path } : null,
      server: entry.server ?? null,
      mode: (entry.server ? "server" : "embedded") as "server" | "embedded",
    }
  })

  // Resolve activeWorkspace: look up old path/id in the idMap
  let activeWorkspace: string | null = null
  if (v1.activeWorkspace) {
    activeWorkspace = idMap.get(v1.activeWorkspace) ?? null
  }

  const v2: WorkspaceRegistry = { version: 2, activeWorkspace, workspaces }
  // Write v2 atomically (fire and forget; next read will re-migrate if this fails)
  writeRegistry(v2).catch(() => {})
  return v2
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Add a local workspace to the registry. Deduplicates by path.
 * Generates a UUID for the new entry. Returns the UUID (existing or new).
 */
export async function addWorkspace(databasePath: string, name: string): Promise<string> {
  const registry = await readRegistry()
  const normalizedPath = resolve(databasePath)
  const existing = registry.workspaces.find(
    (w) => w.local !== null && resolve(w.local.path) === normalizedPath,
  )
  if (existing) return existing.id

  const id = generateWorkspaceId()
  registry.workspaces.push({
    id,
    name,
    addedAt: new Date().toISOString(),
    local: { path: normalizedPath },
    server: null,
    mode: "embedded",
  })
  await writeRegistry(registry)
  console.log(`[beadbox-registry] added workspace: ${name} (${normalizedPath})`)
  return id
}

/**
 * Add or update a server-only workspace in the registry.
 * Deduplicates by server identity (host+port+database).
 * If a matching entry exists, updates its server block in place.
 */
export async function addServerWorkspaceEntry(
  name: string,
  server: ServerConnection,
): Promise<string> {
  const registry = await readRegistry()

  // Check for existing entry with same server identity
  const existingIdx = registry.workspaces.findIndex(
    (w) =>
      w.server &&
      w.server.host === server.host &&
      w.server.port === server.port &&
      w.server.database === server.database,
  )

  const credentialKey = `${server.host}:${server.port}/${server.database}/${server.user}`

  if (existingIdx >= 0) {
    // Update server block in place
    registry.workspaces[existingIdx].server = server
    registry.workspaces[existingIdx].name = name
    registry.workspaces[existingIdx].credentialKey = credentialKey
    await writeRegistry(registry)
    console.log(
      `[beadbox-registry] updated server workspace: ${name} (${server.host}:${server.port}/${server.database})`,
    )
    return registry.workspaces[existingIdx].id
  }

  const id = generateWorkspaceId()
  registry.workspaces.push({
    id,
    name,
    addedAt: new Date().toISOString(),
    local: null,
    server,
    mode: "server",
    credentialKey,
  })
  await writeRegistry(registry)
  console.log(
    `[beadbox-registry] added server workspace: ${name} (${server.host}:${server.port}/${server.database})`,
  )
  return id
}

/**
 * Atomically replace a local workspace with a server-only workspace.
 * Removes the old entry and inserts a new server entry in one write.
 * Preserves activeWorkspace if it pointed to the old entry (transfers to new).
 * Returns the new workspace UUID, or null if oldId was not found.
 */
export async function replaceWorkspace(
  oldId: string,
  name: string,
  server: ServerConnection,
): Promise<string | null> {
  const registry = await readRegistry()
  const oldIdx = registry.workspaces.findIndex((w) => w.id === oldId)
  if (oldIdx < 0) return null

  const newId = generateWorkspaceId()
  const wasActive = registry.activeWorkspace === oldId

  // Remove old entry, insert new server entry at same position
  registry.workspaces.splice(oldIdx, 1, {
    id: newId,
    name,
    addedAt: new Date().toISOString(),
    local: null,
    server,
    mode: "server",
    credentialKey: `${server.host}:${server.port}/${server.database}/${server.user}`,
  })

  if (wasActive) registry.activeWorkspace = newId

  await writeRegistry(registry)
  console.log(
    `[beadbox-registry] replaced workspace ${oldId} with server entry: ${name} (${server.host}:${server.port}/${server.database})`,
  )
  return newId
}

/**
 * Update a workspace's local path (e.g., after creating a scaffold for a server workspace).
 */
export async function updateWorkspaceLocal(workspaceId: string, localPath: string): Promise<void> {
  const registry = await readRegistry()
  const entry = registry.workspaces.find((w) => w.id === workspaceId)
  if (!entry) return
  entry.local = { path: localPath }
  await writeRegistry(registry)
}

/**
 * Remove a workspace from the registry by UUID.
 * Returns true if found and removed, false if not found.
 */
export async function removeWorkspaceFromRegistry(workspaceId: string): Promise<boolean> {
  const registry = await readRegistry()
  const before = registry.workspaces.length
  registry.workspaces = registry.workspaces.filter((w) => w.id !== workspaceId)

  if (registry.workspaces.length === before) return false

  // If the removed workspace was active, clear it
  if (registry.activeWorkspace === workspaceId) {
    registry.activeWorkspace = null
  }

  await writeRegistry(registry)
  console.log(`[beadbox-registry] removed workspace: ${workspaceId}`)
  return true
}

/**
 * Update a workspace's server connection and mode in the registry.
 * Used to backfill the server block for local-path workspaces that
 * operate in server mode (detected from metadata.json after registration).
 */
export async function updateWorkspaceServer(
  workspaceId: string,
  server: ServerConnection,
): Promise<void> {
  const registry = await readRegistry()
  const entry = registry.workspaces.find((w) => w.id === workspaceId)
  if (!entry) return
  entry.server = server
  entry.mode = "server"
  await writeRegistry(registry)
}

/**
 * Set the active workspace in the registry by UUID.
 */
export async function setActiveWorkspace(workspaceId: string): Promise<void> {
  const registry = await readRegistry()
  registry.activeWorkspace = workspaceId
  await writeRegistry(registry)
}

/**
 * Get the active workspace UUID from the registry.
 */
export async function getActiveWorkspace(): Promise<string | null> {
  const registry = await readRegistry()
  return registry.activeWorkspace
}

// ---------------------------------------------------------------------------
// Migration from legacy ~/.beads/registry.json
// ---------------------------------------------------------------------------

/**
 * One-time migration: read legacy ~/.beads/registry.json (bd daemon format)
 * and convert to v1 beadbox format. Returns the intermediate v1 entries
 * (caller will run v1->v2 migration).
 */
async function migrateFromLegacyRegistry(): Promise<V1Registry> {
  const legacyPath = getLegacyRegistryPath()

  try {
    const content = await readFile(legacyPath, "utf-8")
    const parsed = JSON.parse(content)
    const entries = Array.isArray(parsed) ? parsed : []

    if (entries.length === 0) return { workspaces: [], activeWorkspace: null }

    const now = new Date().toISOString()
    const workspaces: V1RegistryEntry[] = entries
      .filter((e: Record<string, unknown>) => e.database_path && e.workspace_path)
      .map((e: Record<string, unknown>) => ({
        path: e.database_path as string,
        name: basename(e.workspace_path as string),
        addedAt: now,
      }))

    if (workspaces.length === 0) return { workspaces: [], activeWorkspace: null }

    console.log(
      `[beadbox-registry] migrated ${workspaces.length} workspace(s) from legacy registry`,
    )
    return { workspaces, activeWorkspace: null }
  } catch {
    // Legacy registry doesn't exist or can't be read - that's fine
    return { workspaces: [], activeWorkspace: null }
  }
}

// ---------------------------------------------------------------------------
// Server-only workspace identity & runtime paths
// ---------------------------------------------------------------------------

/**
 * Stable identifier for a server-only workspace: "host:port/database".
 * Used during migration to map old IDs to new UUIDs. Not used as identity
 * in v2 (UUID replaces this).
 */
export function serverWorkspaceId(server: ServerConnection): string {
  return `${server.host}:${server.port}/${server.database}`
}

/**
 * Parse a server:// URI back into a ServerConnection.
 * Format: server://host:port/database
 * Returns null if the URI is not a valid server:// URI.
 */
export function parseServerUri(uri: string): ServerConnection | null {
  if (!uri.startsWith("server://")) return null
  const rest = uri.slice("server://".length)
  const colonIdx = rest.indexOf(":")
  const slashIdx = rest.indexOf("/")
  if (colonIdx < 0 || slashIdx < 0 || slashIdx <= colonIdx) return null
  const host = rest.slice(0, colonIdx)
  const port = parseInt(rest.slice(colonIdx + 1, slashIdx), 10)
  const database = rest.slice(slashIdx + 1)
  if (!host || !Number.isFinite(port) || !database) return null
  return { host, port, database, user: "root", tls: false }
}

// ---------------------------------------------------------------------------
// Utility: derive project directory from a database path
// ---------------------------------------------------------------------------

/**
 * Given a databasePath ("/foo/bar/.beads" or "/foo/bar/.beads/beads.db"),
 * return the project directory ("/foo/bar").
 */
export function projectDirFromDatabasePath(databasePath: string): string {
  const resolved = resolve(databasePath)
  if (basename(resolved) === ".beads") return dirname(resolved)
  // .db file: parent is .beads/, grandparent is project dir
  return dirname(dirname(resolved))
}
