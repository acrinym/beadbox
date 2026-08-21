import type { SortOption } from "@/components/filter-bar"
import type { Bead, Epic } from "@/lib/types"

// Priority order for sorting (lower = higher priority)
export const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }

// Status order for sorting (higher = closer to completion)
export const statusOrder: Record<string, number> = {
  open: 0,
  in_progress: 1,
  ready_for_qa: 2,
  in_qa: 3,
  qa_passed: 4,
  ready_to_ship: 5,
  closed: 6,
}

export function compareBead(a: Bead, b: Bead, sort: SortOption): number {
  let cmp = 0
  switch (sort.field) {
    case "title":
      cmp = a.title.localeCompare(b.title)
      break
    case "priority":
      cmp = (priorityOrder[a.priority] ?? 99) - (priorityOrder[b.priority] ?? 99)
      break
    case "status":
      cmp = (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99)
      break
    case "updated":
      cmp = (a.updatedAt?.getTime() ?? 0) - (b.updatedAt?.getTime() ?? 0)
      break
  }
  return sort.direction === "asc" ? cmp : -cmp
}

export function sortBeads(beads: Bead[], sort: SortOption): Bead[] {
  return [...beads]
    .map((bead) => ({
      ...bead,
      children: bead.children ? sortBeads(bead.children, sort) : undefined,
    }))
    .sort((a, b) => compareBead(a, b, sort))
}

export function sortEpics(epics: Epic[], sort: SortOption): Epic[] {
  return [...epics]
    .map((epic) => ({
      ...epic,
      children: sortBeads(epic.children ?? [], sort),
      childEpics: epic.childEpics ? sortEpics(epic.childEpics, sort) : undefined,
    }))
    .sort((a, b) => compareBead(a, b, sort))
}
