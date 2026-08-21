import { useCallback, useState } from "react"
import type { CrossFilter } from "../lib/types"

const EMPTY_FILTER: CrossFilter = { type: null, value: null }

export function useCrossFilter() {
  const [filter, setFilter] = useState<CrossFilter>(EMPTY_FILTER)

  const setAgentFilter = useCallback((agentName: string) => {
    setFilter({ type: "agent", value: agentName })
  }, [])

  const setStageFilter = useCallback((stageName: string) => {
    setFilter({ type: "stage", value: stageName })
  }, [])

  const setBeadFilter = useCallback((beadId: string) => {
    setFilter({ type: "bead", value: beadId })
  }, [])

  const clearFilter = useCallback(() => {
    setFilter(EMPTY_FILTER)
  }, [])

  return {
    filter,
    setAgentFilter,
    setStageFilter,
    setBeadFilter,
    clearFilter,
    isFiltered: filter.type !== null,
  }
}
