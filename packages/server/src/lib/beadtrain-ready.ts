import { parseBeadtrainToml, type TomlTable } from "./beadtrain-parse"

export interface TrainCoupler {
  id: string
  fromTrain: string
  fromCar: string
  toTrain: string
  toCar: string
  mode: "after" | "with" | string
  joinMainAt?: string
  note: string
}

export interface TrainCar {
  id: string
  bead: string
  title: string
  parallelStart: boolean
  dependsOn: string[]
  summary: string
}

export interface LoadedTrain {
  fileName: string
  name: string
  title: string
  description: string
  created: string
  status: string
  oneLiner: string
  watch: string
  cars: TrainCar[]
  couplers: TrainCoupler[]
}

export interface CarView {
  train: string
  carId: string
  bead: string
  title: string
  ready: boolean
  reason: string
  beadStatus: string | null
}

const TERMINAL = new Set(["closed", "tombstone"])

function asTable(value: unknown): TomlTable | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as TomlTable
  return null
}

function str(value: unknown): string {
  if (value == null) return ""
  return String(value)
}

function strList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item))
}

export function trainFromToml(fileName: string, table: TomlTable): LoadedTrain {
  const train = asTable(table.train) ?? {}
  const meta = asTable(table.meta) ?? {}
  const carsRaw = Array.isArray(table.cars) ? table.cars : []
  const couplersRaw = Array.isArray(table.couplers) ? table.couplers : []
  const cars: TrainCar[] = carsRaw.map((row) => {
    const item = asTable(row) ?? {}
    return {
      id: str(item.id),
      bead: str(item.bead),
      title: str(item.title),
      parallelStart: Boolean(item.parallel_start),
      dependsOn: strList(item.depends_on),
      summary: str(item.summary),
    }
  })
  const couplers: TrainCoupler[] = couplersRaw.map((row) => {
    const item = asTable(row) ?? {}
    return {
      id: str(item.id),
      fromTrain: str(item.from_train),
      fromCar: str(item.from_car),
      toTrain: str(item.to_train),
      toCar: str(item.to_car),
      mode: str(item.mode),
      joinMainAt: str(item.join_main_at) || undefined,
      note: str(item.note),
    }
  })
  return {
    fileName,
    name: str(train.name) || fileName.replace(/\.beadtrain$/, ""),
    title: str(train.title),
    description: str(train.description),
    created: str(train.created),
    status: str(train.status),
    oneLiner: str(meta.one_liner),
    watch: str(meta.watch),
    cars,
    couplers,
  }
}

export function parseTrainSource(fileName: string, source: string): LoadedTrain {
  return trainFromToml(fileName, parseBeadtrainToml(source))
}

function beadTerminal(status: string | null): boolean {
  if (!status) return false
  return TERMINAL.has(status.toLowerCase())
}

function couplerFromOk(mode: string, fromStatus: string | null): boolean {
  if (!fromStatus) return false
  const lowered = fromStatus.toLowerCase()
  if (mode === "after") return beadTerminal(lowered)
  if (mode === "with") return beadTerminal(lowered) || lowered === "in_progress"
  return false
}

type Gate = { fromTrain: string; fromCar: string; mode: string }

function buildIncoming(trains: LoadedTrain[]): Map<string, Gate[]> {
  const incoming = new Map<string, Gate[]>()
  for (const train of trains) {
    for (const coupler of train.couplers) {
      const key = `${coupler.toTrain}\0${coupler.toCar}`
      const list = incoming.get(key) ?? []
      list.push({ fromTrain: coupler.fromTrain, fromCar: coupler.fromCar, mode: coupler.mode })
      incoming.set(key, list)
    }
  }
  return incoming
}

/** First local depends_on that is missing or not yet terminal, as a reason string. */
function localDepsBlocker(
  car: TrainCar,
  carsById: Map<string, TrainCar>,
  status: Map<string, string>,
): string | null {
  for (const depId of car.dependsOn) {
    const dep = carsById.get(depId)
    if (!dep) return `depends_on '${depId}' missing`
    const depStatus = status.get(dep.bead) ?? null
    if (!beadTerminal(depStatus)) {
      return `waiting on local car '${depId}' (${dep.bead}=${depStatus ?? "unknown"})`
    }
  }
  return null
}

/** First incoming coupler whose source car is not yet satisfied, as a reason string. */
function couplerBlocker(
  gates: Gate[],
  byName: Map<string, LoadedTrain>,
  status: Map<string, string>,
): string | null {
  for (const gate of gates) {
    const peer = byName.get(gate.fromTrain)
    if (!peer) return `coupler peer train '${gate.fromTrain}' not loaded`
    const source = peer.cars.find((item) => item.id === gate.fromCar)
    if (!source) return `coupler from_car '${gate.fromCar}' missing on ${gate.fromTrain}`
    const fromStatus = status.get(source.bead) ?? null
    if (!couplerFromOk(gate.mode, fromStatus)) {
      return `coupler ${gate.mode} waiting on ${gate.fromTrain}/${gate.fromCar} (${source.bead}=${fromStatus ?? "unknown"})`
    }
  }
  return null
}

function toView(train: LoadedTrain, car: TrainCar, own: string | null, blocked: string | null): CarView {
  return {
    train: train.name,
    carId: car.id,
    bead: car.bead,
    title: car.title,
    ready: blocked === null,
    reason: blocked ?? "ready",
    beadStatus: own,
  }
}

export function readyViews(
  trains: LoadedTrain[],
  beadStatus: Map<string, string> | null,
): CarView[] {
  const byName = new Map(trains.map((train) => [train.name, train]))
  const incoming = buildIncoming(trains)
  const haveStatus = beadStatus !== null
  const status = beadStatus ?? new Map<string, string>()
  const views: CarView[] = []

  for (const train of trains) {
    const carsById = new Map(train.cars.map((car) => [car.id, car]))
    for (const car of train.cars) {
      const own = status.get(car.bead) ?? null
      let blocked: string | null
      if (beadTerminal(own)) {
        blocked = "bead already closed"
      } else if (!haveStatus) {
        blocked = "bead status unknown (bd list failed and no issues.jsonl export)"
      } else {
        blocked =
          localDepsBlocker(car, carsById, status) ??
          couplerBlocker(incoming.get(`${train.name}\0${car.id}`) ?? [], byName, status)
      }
      views.push(toView(train, car, own, blocked))
    }
  }
  return views
}
