// bb-y729: page-level bulk-selection state for bead-table rows.
//
// Pure React state — no rpc, no DOM. Lifted to home-page so a single
// selection set survives across the multiple <BeadTable> mount sites
// (flat-table, EpicTree's per-epic tables, mobile views) without
// per-mount divergence.
//
// Visibility-aware helpers (`isAllSelected`, `isPartiallySelected`,
// `pruneTo`) take the currently visible id set so filter changes can
// drop selections that no longer match without the hook owning filter
// semantics.

import { useCallback, useState } from "react"

export interface UseBeadSelection {
  selectedIds: Set<string>
  toggle: (id: string) => void
  toggleAll: (visibleIds: string[]) => void
  clear: () => void
  pruneTo: (visibleIds: string[]) => void
  isAllSelected: (visibleIds: string[]) => boolean
  isPartiallySelected: (visibleIds: string[]) => boolean
}

export function useBeadSelection(): UseBeadSelection {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const toggleAll = useCallback((visibleIds: string[]) => {
    setSelectedIds((prev) => {
      const allSelected = visibleIds.length > 0 && visibleIds.every((id) => prev.has(id))
      if (allSelected) {
        const next = new Set(prev)
        for (const id of visibleIds) next.delete(id)
        return next
      }
      const next = new Set(prev)
      for (const id of visibleIds) next.add(id)
      return next
    })
  }, [])

  const clear = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const pruneTo = useCallback((visibleIds: string[]) => {
    setSelectedIds((prev) => {
      const visible = new Set(visibleIds)
      const next = new Set<string>()
      for (const id of prev) {
        if (visible.has(id)) next.add(id)
      }
      return next
    })
  }, [])

  const isAllSelected = useCallback(
    (visibleIds: string[]) => {
      if (visibleIds.length === 0) return false
      return visibleIds.every((id) => selectedIds.has(id))
    },
    [selectedIds],
  )

  const isPartiallySelected = useCallback(
    (visibleIds: string[]) => {
      if (visibleIds.length === 0) return false
      let hits = 0
      for (const id of visibleIds) {
        if (selectedIds.has(id)) hits++
      }
      return hits > 0 && hits < visibleIds.length
    },
    [selectedIds],
  )

  return { selectedIds, toggle, toggleAll, clear, pruneTo, isAllSelected, isPartiallySelected }
}
