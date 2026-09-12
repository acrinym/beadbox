import { basename, dirname, join, resolve } from "path"
import { readdir, readFile } from "fs/promises"
import { parseTrainSource, type LoadedTrain } from "./beadtrain-ready"

export function beadsDirFromDatabasePath(dbPath: string): string | null {
  if (!dbPath || dbPath.startsWith("server://")) return null
  const resolved = resolve(dbPath)
  if (basename(resolved) === ".beads") return resolved
  if (basename(dirname(resolved)) === ".beads") return dirname(resolved)
  return join(resolved, ".beads")
}

export async function listTrainPaths(beadsDir: string): Promise<string[]> {
  const names = await readdir(beadsDir).catch(() => [] as string[])
  const files = names
    .filter((name) => name.endsWith(".beadtrain"))
    .map((name) => join(beadsDir, name))
  const nested: string[] = []
  for (const name of names) {
    if (name.includes(".")) continue
    const childDir = join(beadsDir, name)
    const childNames = await readdir(childDir).catch(() => null)
    if (!childNames) continue
    for (const child of childNames) {
      if (child.endsWith(".beadtrain")) nested.push(join(childDir, child))
    }
  }
  return [...files, ...nested]
}

export async function loadAllTrains(beadsDir: string): Promise<LoadedTrain[]> {
  const paths = await listTrainPaths(beadsDir)
  const trains: LoadedTrain[] = []
  for (const filePath of paths) {
    const source = await readFile(filePath, "utf-8")
    trains.push(parseTrainSource(basename(filePath), source))
  }
  return trains
}

export async function loadJsonlStatus(beadsDir: string): Promise<Map<string, string> | null> {
  const jsonlPath = join(beadsDir, "issues.jsonl")
  const jsonl = await readFile(jsonlPath, "utf-8").catch(() => null)
  if (!jsonl) return null
  const map = new Map<string, string>()
  for (const line of jsonl.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const row = JSON.parse(trimmed) as { id?: string; status?: string }
      if (row.id && row.status) map.set(row.id, row.status)
    } catch {
      /* skip */
    }
  }
  return map
}
