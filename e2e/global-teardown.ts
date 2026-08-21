import { execFileSync } from "child_process"
import { rmSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import {
  TEMPLATE_DATA_DIR,
  TEMPLATE_WS_DIR,
  TEMPLATE_ALPHA_WS_DIR,
  TEMPLATE_BETA_WS_DIR,
  TEMPLATE_GAMMA_WS_DIR,
} from "./global-setup"
import { findBd } from "./fixtures/dolt-server"

const REGISTRY_PATH = join(homedir(), ".beads", "registry.json")

export default function globalTeardown() {
  // Kill orphaned Dolt servers from this test run.
  // Mirrors global-setup cleanup to catch anything spawned during tests.
  try {
    execFileSync(findBd(), ["dolt", "killall"], { encoding: "utf-8", timeout: 10_000 })
  } catch { /* best-effort */ }

  // Remove template directories (data dir + workspace dirs)
  for (const dir of [TEMPLATE_DATA_DIR, TEMPLATE_WS_DIR, TEMPLATE_ALPHA_WS_DIR, TEMPLATE_BETA_WS_DIR, TEMPLATE_GAMMA_WS_DIR]) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Best-effort
    }
  }

  // Reset the isolated test registries (legacy + beadbox format)
  const testRegistryPath = process.env.BEADS_REGISTRY_PATH
  if (testRegistryPath) {
    try {
      writeFileSync(testRegistryPath, "[]")
    } catch {
      // Best-effort
    }
  }
  const testBeadboxRegistryPath = process.env.BEADBOX_REGISTRY_PATH
  if (testBeadboxRegistryPath) {
    try {
      writeFileSync(testBeadboxRegistryPath, JSON.stringify({ workspaces: [], activeWorkspace: null }))
    } catch {
      // Best-effort
    }
  }

  // Clean stale e2e entries from production registry
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
    // Best-effort
  }
}
