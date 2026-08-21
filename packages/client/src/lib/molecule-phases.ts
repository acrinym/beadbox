import type { Bead } from "./types"

export interface GateInfo {
  id: string
  type: string
  status: string
}

export interface PhaseTask extends Bead {
  gate?: GateInfo
}

export interface MoleculePhase {
  phaseNumber: number
  tasks: PhaseTask[]
  closedCount: number
  totalCount: number
}

// bb-fe03.7: original CCN was 26 — five distinct steps inlined into one
// function (gate/task split, gate-source map, gate-info map, predecessor
// resolution, topological sort + grouping). Each step extracted into a
// pure helper below; computeMoleculePhases is now a thin orchestrator
// (CCN ≤ 6). Each helper has CCN < 15. Behavior is identical: tests in
// src/__tests__/molecule-phases.test.ts pin the observable contract.

interface SplitChildren {
  gates: Bead[]
  tasks: Bead[]
  taskIds: Set<string>
  gateIds: Set<string>
}

function splitGatesAndTasks(children: Bead[]): SplitChildren {
  const gates = children.filter((b) => b.type === "gate")
  const tasks = children.filter((b) => b.type !== "gate")
  return {
    gates,
    tasks,
    taskIds: new Set(tasks.map((t) => t.id)),
    gateIds: new Set(gates.map((g) => g.id)),
  }
}

// Map gate -> source task (the task the gate depends on via blockedBy).
// May be empty in practice — molecule gates often only have parent-child
// deps to the root.
function buildGateToSourceTask(gates: Bead[], taskIds: Set<string>): Map<string, string> {
  const map = new Map<string, string>()
  for (const gate of gates) {
    const sourceTask = gate.blockedBy?.find((dep) => taskIds.has(dep.id))
    if (sourceTask) map.set(gate.id, sourceTask.id)
  }
  return map
}

function classifyGateType(gateTitle: string): GateInfo["type"] {
  if (gateTitle.includes("conditional")) return "conditional"
  if (gateTitle.includes("human")) return "human"
  return "unknown"
}

// Attach gate badge to the destination task (task blocked by the gate).
function buildGateInfoByTask(
  tasks: Bead[],
  gates: Bead[],
  gateIds: Set<string>,
): Map<string, GateInfo> {
  const map = new Map<string, GateInfo>()
  for (const task of tasks) {
    const gateBlocker = task.blockedBy?.find((dep) => gateIds.has(dep.id))
    if (!gateBlocker) continue
    const gate = gates.find((g) => g.id === gateBlocker.id)
    if (!gate) continue
    map.set(task.id, {
      id: gate.id,
      type: classifyGateType(gate.title || ""),
      status: gate.status as string,
    })
  }
  return map
}

// Resolve task -> set of predecessor task ids, walking gates through to
// their source task. Gates with no source task contribute nothing (the
// task is phased based on its other non-gate deps).
function buildTaskPredecessors(
  tasks: Bead[],
  taskIds: Set<string>,
  gateIds: Set<string>,
  gateToSourceTask: Map<string, string>,
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  for (const task of tasks) {
    const preds = new Set<string>()
    for (const dep of task.blockedBy || []) {
      if (taskIds.has(dep.id)) {
        preds.add(dep.id)
      } else if (gateIds.has(dep.id)) {
        const sourceTask = gateToSourceTask.get(dep.id)
        if (sourceTask) preds.add(sourceTask)
      }
    }
    map.set(task.id, preds)
  }
  return map
}

// Topological assignment: tasks with no preds get phase 1; each subsequent
// pass assigns tasks whose preds are all assigned, to maxPredPhase + 1.
// Unassigned tasks (cycles or orphans) collapse to phase 1.
function assignPhases(
  tasks: Bead[],
  taskPredecessors: Map<string, Set<string>>,
): Map<string, number> {
  const phaseOf = new Map<string, number>()
  const assigned = new Set<string>()

  for (const task of tasks) {
    const preds = taskPredecessors.get(task.id)!
    if (preds.size === 0) {
      phaseOf.set(task.id, 1)
      assigned.add(task.id)
    }
  }

  let changed = true
  while (changed) {
    changed = false
    for (const task of tasks) {
      if (assigned.has(task.id)) continue
      const preds = taskPredecessors.get(task.id)!
      if (![...preds].every((p) => assigned.has(p))) continue
      const maxPredPhase = Math.max(...[...preds].map((p) => phaseOf.get(p) || 1))
      phaseOf.set(task.id, maxPredPhase + 1)
      assigned.add(task.id)
      changed = true
    }
  }

  for (const task of tasks) {
    if (!assigned.has(task.id)) phaseOf.set(task.id, 1)
  }
  return phaseOf
}

// Group tasks by phase number, preserve input order within each phase,
// attach the gate-info badge.
function groupTasksByPhase(
  tasks: Bead[],
  phaseOf: Map<string, number>,
  gateInfoByTask: Map<string, GateInfo>,
): MoleculePhase[] {
  const taskIndex = new Map<string, number>(tasks.map((t, i) => [t.id, i]))
  const phaseMap = new Map<number, PhaseTask[]>()
  for (const task of tasks) {
    const phase = phaseOf.get(task.id) || 1
    if (!phaseMap.has(phase)) phaseMap.set(phase, [])
    phaseMap.get(phase)!.push({ ...task, gate: gateInfoByTask.get(task.id) })
  }
  const phaseNumbers = [...phaseMap.keys()].sort((a, b) => a - b)
  return phaseNumbers.map((num) => {
    const phaseTasks = phaseMap.get(num)!
    phaseTasks.sort((a, b) => (taskIndex.get(a.id) ?? 0) - (taskIndex.get(b.id) ?? 0))
    return {
      phaseNumber: num,
      tasks: phaseTasks,
      closedCount: phaseTasks.filter((t) => t.status === "closed").length,
      totalCount: phaseTasks.length,
    }
  })
}

export function computeMoleculePhases(children: Bead[]): MoleculePhase[] {
  const { gates, tasks, taskIds, gateIds } = splitGatesAndTasks(children)
  const gateToSourceTask = buildGateToSourceTask(gates, taskIds)
  const gateInfoByTask = buildGateInfoByTask(tasks, gates, gateIds)
  const taskPredecessors = buildTaskPredecessors(tasks, taskIds, gateIds, gateToSourceTask)
  const phaseOf = assignPhases(tasks, taskPredecessors)
  return groupTasksByPhase(tasks, phaseOf, gateInfoByTask)
}
