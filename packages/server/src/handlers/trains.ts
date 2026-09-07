import { listBeads } from "../lib/bd"
import { beadsDirFromDatabasePath, loadAllTrains, loadJsonlStatus } from "../lib/beadtrain-fs"
import { readyViews } from "../lib/beadtrain-ready"

type Success<T> = { success: true; data: T }
type Failure = { success: false; error: string }

function extractError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error"
}

async function loadBeadStatus(
  beadsDir: string,
  dbPath?: string,
): Promise<Map<string, string> | null> {
  const fromFile = await loadJsonlStatus(beadsDir)
  if (fromFile) return fromFile
  if (!dbPath || dbPath.startsWith("server://")) return null
  try {
    const beads = await listBeads({ db: dbPath })
    return new Map(beads.map((bead) => [bead.id, bead.status]))
  } catch {
    return null
  }
}

export async function loadTrains(
  dbPath?: string,
): Promise<Success<Awaited<ReturnType<typeof loadAllTrains>>> | Failure> {
  try {
    const beadsDir = dbPath ? beadsDirFromDatabasePath(dbPath) : null
    if (!beadsDir) return { success: true, data: [] }
    const data = await loadAllTrains(beadsDir)
    return { success: true, data }
  } catch (error: unknown) {
    return { success: false, error: extractError(error) }
  }
}

export async function loadReady(
  dbPath?: string,
): Promise<Success<ReturnType<typeof readyViews>> | Failure> {
  try {
    const beadsDir = dbPath ? beadsDirFromDatabasePath(dbPath) : null
    if (!beadsDir) return { success: true, data: [] }
    const trains = await loadAllTrains(beadsDir)
    const status = await loadBeadStatus(beadsDir, dbPath)
    return { success: true, data: readyViews(trains, status) }
  } catch (error: unknown) {
    return { success: false, error: extractError(error) }
  }
}

export async function loadCouplers(
  dbPath?: string,
): Promise<
  | Success<
      Array<{
        id: string
        fromTrain: string
        fromCar: string
        toTrain: string
        toCar: string
        mode: string
        note: string
      }>
    >
  | Failure
> {
  try {
    const beadsDir = dbPath ? beadsDirFromDatabasePath(dbPath) : null
    if (!beadsDir) return { success: true, data: [] }
    const trains = await loadAllTrains(beadsDir)
    const seen = new Set<string>()
    const rows: Array<{
      id: string
      fromTrain: string
      fromCar: string
      toTrain: string
      toCar: string
      mode: string
      note: string
    }> = []
    for (const train of trains) {
      for (const coupler of train.couplers) {
        const key = `${coupler.id}|${coupler.fromTrain}|${coupler.fromCar}|${coupler.toTrain}|${coupler.toCar}|${coupler.mode}`
        if (seen.has(key)) continue
        seen.add(key)
        rows.push({
          id: coupler.id,
          fromTrain: coupler.fromTrain,
          fromCar: coupler.fromCar,
          toTrain: coupler.toTrain,
          toCar: coupler.toCar,
          mode: coupler.mode,
          note: coupler.note,
        })
      }
    }
    return { success: true, data: rows }
  } catch (error: unknown) {
    return { success: false, error: extractError(error) }
  }
}
