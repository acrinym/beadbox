import { mkdtemp, writeFile } from "fs/promises"
import { join } from "path"
import { beforeAll, describe, expect, test } from "bun:test"
import { tmpdir } from "os"
import { loadAllTrains, loadJsonlStatus, beadsDirFromDatabasePath } from "../lib/beadtrain-fs"
import { parseTrainSource, readyViews } from "../lib/beadtrain-ready"

const PRIMARY = `# classroom
[train]
name        = "example_primary_demo"
title       = "Example primary (coupler demo)"
description = """
Fictional classroom train.
"""
created     = "2026-07-15"
status      = "planned"

[[cars]]
id             = "build"
bead           = "classroom-demo-1"
title          = "Build step"
parallel_start = true
depends_on     = []
summary        = "Demo car."

[[cars]]
id             = "capstone"
bead           = "classroom-demo-2"
title          = "Capstone"
parallel_start = false
depends_on     = ["build"]
summary        = "Demo capstone."

[meta]
one_liner    = "Primary side of coupler demo."
couples_with = ["example_secondary_demo"]

[[couplers]]
id         = "demo-join"
from_train = "example_primary_demo"
from_car   = "capstone"
to_train   = "example_secondary_demo"
to_car     = "start"
mode       = "after"
note       = "Classroom coupler example."
`

const SECONDARY = `[train]
name        = "example_secondary_demo"
title       = "Example secondary (coupler demo)"
description = """
Unlocked after primary capstone.
"""
created     = "2026-07-15"
status      = "planned"

[[cars]]
id             = "start"
bead           = "classroom-demo-3"
title          = "Start after coupler"
parallel_start = true
depends_on     = []
summary        = "Unlocked by demo-join."
`

describe("beadtrain parse + ready", () => {
  test("parses classroom primary cars and coupler", () => {
    const train = parseTrainSource("example_primary_demo.beadtrain", PRIMARY)
    expect(train.name).toBe("example_primary_demo")
    expect(train.cars).toHaveLength(2)
    expect(train.cars[1]?.dependsOn).toEqual(["build"])
    expect(train.couplers[0]?.toCar).toBe("start")
  })

  test("parses multiline v1.3 dependency arrays", () => {
    const train = parseTrainSource(
      "multiline.beadtrain",
      PRIMARY.replace('depends_on     = ["build"]', 'depends_on     = [\n  "build",\n]'),
    )
    expect(train.cars[1]?.dependsOn).toEqual(["build"])
  })

  test("ready after closed capstone unlocks secondary start", () => {
    const trains = [
      parseTrainSource("example_primary_demo.beadtrain", PRIMARY),
      parseTrainSource("example_secondary_demo.beadtrain", SECONDARY),
    ]
    const status = new Map([
      ["classroom-demo-1", "closed"],
      ["classroom-demo-2", "closed"],
      ["classroom-demo-3", "open"],
    ])
    const views = readyViews(trains, status)
    const ready = views.filter((view) => view.ready).map((view) => `${view.train}/${view.carId}`)
    expect(ready).toContain("example_secondary_demo/start")
    expect(ready).not.toContain("example_primary_demo/build")
  })

  test("unknown status is never ready", () => {
    const trains = [parseTrainSource("example_primary_demo.beadtrain", PRIMARY)]
    const views = readyViews(trains, null)
    expect(views.every((view) => !view.ready)).toBe(true)
  })
})

describe("beadtrain fs", () => {
  let beadsDir: string

  beforeAll(async () => {
    beadsDir = await mkdtemp(join(tmpdir(), "beadtrain-"))
    await writeFile(join(beadsDir, "example_primary_demo.beadtrain"), PRIMARY)
    await writeFile(join(beadsDir, "example_secondary_demo.beadtrain"), SECONDARY)
    await writeFile(
      join(beadsDir, "issues.jsonl"),
      `${JSON.stringify({ id: "classroom-demo-1", status: "closed" })}\n${JSON.stringify({ id: "classroom-demo-2", status: "closed" })}\n${JSON.stringify({ id: "classroom-demo-3", status: "open" })}\n`,
    )
  })

  test("loadAllTrains lists both files", async () => {
    const trains = await loadAllTrains(beadsDir)
    expect(trains.map((train) => train.name).sort()).toEqual([
      "example_primary_demo",
      "example_secondary_demo",
    ])
  })

  test("jsonl status + ready", async () => {
    const trains = await loadAllTrains(beadsDir)
    const status = await loadJsonlStatus(beadsDir)
    const views = readyViews(trains, status)
    expect(views.some((view) => view.ready && view.carId === "start")).toBe(true)
  })
})

describe("beadsDirFromDatabasePath", () => {
  test("server URI is null", () => {
    expect(beadsDirFromDatabasePath("server://localhost:3306/beads")).toBeNull()
  })
})
