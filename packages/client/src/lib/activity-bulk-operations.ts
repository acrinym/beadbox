import { extractActorFromMessage } from "./activity-message-utils"
import type { ActivityEvent } from "./types"

const BULK_GROUP_WINDOW_MS = 60 * 1000 // 60 seconds between consecutive events
const BULK_GROUP_THRESHOLD = 3

export interface BulkGroup {
  type: "bulk"
  actor: string
  events: ActivityEvent[]
  groupKey: string
}

interface SingleItem {
  type: "single"
  event: ActivityEvent
}

export type FeedItem = BulkGroup | SingleItem

export type FlatNavItem =
  | { type: "single"; event: ActivityEvent }
  | { type: "bulk-header"; group: BulkGroup }
  | { type: "bulk-sub"; event: ActivityEvent; group: BulkGroup }

// Group consecutive events from the same actor within a time window.
// Input events are in newest-first order.
export function groupBulkOperations(events: ActivityEvent[]): FeedItem[] {
  if (events.length === 0) return []

  const items: FeedItem[] = []
  let i = 0

  while (i < events.length) {
    const actor = extractActorFromMessage(events[i])
    let j = i + 1

    // Extend run while next event is from same actor and within time window of its predecessor.
    // Events are newest-first, so timestamps decrease as j increases.
    while (
      j < events.length &&
      extractActorFromMessage(events[j]) === actor &&
      Math.abs(
        new Date(events[j - 1].timestamp).getTime() - new Date(events[j].timestamp).getTime(),
      ) <= BULK_GROUP_WINDOW_MS
    ) {
      j++
    }

    const runLength = j - i

    if (runLength >= BULK_GROUP_THRESHOLD) {
      const groupEvents = events.slice(i, j)
      // Key by actor + oldest event timestamp (stable as new events prepend)
      items.push({
        type: "bulk",
        actor,
        events: groupEvents,
        groupKey: `bulk-${actor}-${groupEvents[groupEvents.length - 1].timestamp}`,
      })
    } else {
      for (let k = i; k < j; k++) {
        items.push({ type: "single", event: events[k] })
      }
    }

    i = j
  }

  return items
}

// Summarize what types of actions a bulk group contains
export function getBulkGroupSummary(group: BulkGroup): string {
  const typeCounts = new Map<string, number>()
  for (const e of group.events) {
    typeCounts.set(e.type, (typeCounts.get(e.type) || 0) + 1)
  }

  if (typeCounts.size === 1) {
    const [type, count] = [...typeCounts.entries()][0]
    const labels: Record<string, string> = {
      status: "status changes",
      create: "beads created",
      comment: "comments",
      update: "updates",
      delete: "deletions",
    }
    return `${count} ${labels[type] || "changes"}`
  }

  return `${group.events.length} changes`
}
