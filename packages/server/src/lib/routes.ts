import { readFile } from "fs/promises"
import { join } from "path"

/**
 * Parse .beads/routes.jsonl into a prefix-to-rig-name map.
 * Format: one JSON object per line, e.g. {"prefix":"tr-","path":"testrig"}
 * Returns empty map for missing file, malformed lines, or empty file.
 */
export async function parseRoutes(beadsDir: string): Promise<Map<string, string>> {
  const routes = new Map<string, string>()
  try {
    const content = await readFile(join(beadsDir, "routes.jsonl"), "utf-8")
    for (const line of content.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const entry = JSON.parse(trimmed)
        if (typeof entry.prefix === "string" && typeof entry.path === "string") {
          routes.set(entry.prefix, entry.path)
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    // Missing file or unreadable -- return empty map
  }
  return routes
}

/**
 * Match a bead ID against known route prefixes.
 * Returns the rig name if the bead ID starts with a known prefix, undefined otherwise.
 */
export function matchRig(beadId: string, routes: Map<string, string>): string | undefined {
  for (const [prefix, rigName] of routes) {
    if (beadId.startsWith(prefix)) {
      return rigName
    }
  }
  return undefined
}
