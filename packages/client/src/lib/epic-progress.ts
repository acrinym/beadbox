import type { Bead, Epic } from "./types"

// Recursively count closed and total from a bead and its subtasks
export function countBeadAndSubtasks(bead: Bead): { closed: number; total: number } {
  let closed = bead.status === "closed" || bead.status === "ready_to_ship" ? 1 : 0
  let total = 1

  if (bead.children && bead.children.length > 0) {
    for (const child of bead.children) {
      const childCounts = countBeadAndSubtasks(child)
      closed += childCounts.closed
      total += childCounts.total
    }
  }

  return { closed, total }
}

// Recursively calculate closed and total counts from all descendants of an epic
export function getAggregatedCounts(epic: Epic): { closed: number; total: number } {
  let closed = 0
  let total = 0

  for (const child of epic.children ?? []) {
    const childCounts = countBeadAndSubtasks(child)
    closed += childCounts.closed
    total += childCounts.total
  }

  if (epic.childEpics && epic.childEpics.length > 0) {
    for (const childEpic of epic.childEpics) {
      const childCounts = getAggregatedCounts(childEpic)
      closed += childCounts.closed
      total += childCounts.total
    }
  }

  return { closed, total }
}
