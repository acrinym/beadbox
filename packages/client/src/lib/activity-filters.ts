import type { ActivityFilters } from "./activity-storage"
import type { ActivityEvent } from "./types"

export const ALL_EVENT_TYPES = ["status", "comment", "create", "update", "delete"] as const

export const EVENT_TYPE_LABELS: Record<string, string> = {
  status: "Status changes",
  comment: "Comments",
  create: "Created",
  update: "Updates",
  delete: "Deleted",
}

export const TIME_RANGE_OPTIONS = [
  { value: "1h", label: "Last hour" },
  { value: "today", label: "Today" },
  { value: "24h", label: "Last 24h" },
  { value: "7d", label: "Last 7 days" },
  { value: "all", label: "All time" },
]

// Check if any filters are active
export function hasActiveFilters(filters: ActivityFilters): boolean {
  return (
    filters.actors.length > 0 ||
    filters.beadSearch.length > 0 ||
    filters.eventTypes.length > 0 ||
    filters.timeRange !== "all"
  )
}

// Count active filters
export function countActiveFilters(filters: ActivityFilters): number {
  let count = 0
  if (filters.actors.length > 0) count++
  if (filters.beadSearch.length > 0) count++
  if (filters.eventTypes.length > 0) count++
  if (filters.timeRange !== "all") count++
  return count
}

// Get time cutoff for a time range
export function getTimeCutoff(timeRange: string): Date | null {
  if (timeRange === "all") return null
  const now = new Date()
  switch (timeRange) {
    case "1h":
      return new Date(now.getTime() - 60 * 60 * 1000)
    case "today": {
      const today = new Date(now)
      today.setHours(0, 0, 0, 0)
      return today
    }
    case "24h":
      return new Date(now.getTime() - 24 * 60 * 60 * 1000)
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    default:
      return null
  }
}

// Apply filters to an event
export function matchesFilters(
  event: ActivityEvent,
  filters: ActivityFilters,
  extractActor: (e: ActivityEvent) => string,
): boolean {
  // Actor filter
  if (filters.actors.length > 0) {
    const actor = extractActor(event)
    if (!filters.actors.includes(actor)) return false
  }

  // Bead search filter (matches issue_id or title from message)
  if (filters.beadSearch) {
    const search = filters.beadSearch.toLowerCase()
    const matchesId = event.issue_id.toLowerCase().includes(search)
    const matchesMessage = event.message.toLowerCase().includes(search)
    if (!matchesId && !matchesMessage) return false
  }

  // Event type filter
  if (filters.eventTypes.length > 0) {
    if (!filters.eventTypes.includes(event.type)) return false
  }

  // Time range filter
  const cutoff = getTimeCutoff(filters.timeRange)
  if (cutoff) {
    const eventTime = new Date(event.timestamp)
    if (eventTime < cutoff) return false
  }

  return true
}
