import type { ActivityEvent, AgentState, PipelineStage } from "./types"

const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes
const QUIET_THRESHOLD_MS = 30 * 60 * 1000 // 30 minutes

export const CANONICAL_STAGES = [
  "backlog",
  "open",
  "in_progress",
  "ready_for_qa",
  "ready_to_ship",
  "closed",
] as const

// Maps non-canonical statuses to the nearest canonical stage
const STATUS_ALIASES: Record<string, string> = {
  in_qa: "ready_for_qa",
  qa_passed: "ready_for_qa",
}

/** Resolve a raw bd status to its canonical pipeline stage name. */
export function toCanonicalStage(status: string): string {
  return STATUS_ALIASES[status] ?? status
}

export function deriveActionVerb(event: ActivityEvent): string {
  if (event.type === "status" && event.old_status && event.new_status) {
    return `moved ${event.old_status} to ${event.new_status}`
  }

  switch (event.type) {
    case "create":
      return "created bead"
    case "update":
      return "updated bead"
    case "status":
      return "updated bead"
    case "comment":
      return "commented on bead"
    case "delete":
      return "deleted bead"
    default:
      return "updated bead"
  }
}

function computeStatus(lastSeen: Date, now: Date): AgentState["status"] {
  const elapsed = now.getTime() - lastSeen.getTime()
  if (elapsed < ACTIVE_THRESHOLD_MS) return "active"
  if (elapsed < QUIET_THRESHOLD_MS) return "quiet"
  return "silent"
}

function extractTitle(event: ActivityEvent): string {
  const colonIdx = event.message.indexOf(": ")
  if (colonIdx !== -1) {
    return event.message.slice(colonIdx + 2)
  }
  return event.message
}

export function deriveAgentStates(events: ActivityEvent[], now?: Date): AgentState[] {
  const reference = now ?? new Date()
  const agentMap = new Map<string, AgentState>()

  for (const event of events) {
    if (!event.actor) continue

    const existing = agentMap.get(event.actor)
    const eventTime = new Date(event.timestamp)

    if (existing && existing.lastSeen >= eventTime) continue

    agentMap.set(event.actor, {
      name: event.actor,
      lastEvent: event,
      lastBeadId: event.issue_id,
      lastBeadTitle: extractTitle(event),
      lastAction: deriveActionVerb(event),
      lastSeen: eventTime,
      status: computeStatus(eventTime, reference),
    })
  }

  return Array.from(agentMap.values()).sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime())
}

export function formatRelativeTime(timestamp: string | Date): string {
  const now = new Date()
  const date = typeof timestamp === "string" ? new Date(timestamp) : timestamp
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHours = Math.floor(diffMin / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSec < 60) return "just now"
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

const TYPE_DISPLAY_ORDER = ["bug", "task", "feature", "epic"] as const

export function formatTypeSummary(typeCounts: Record<string, number>): string {
  const parts: string[] = []

  for (const t of TYPE_DISPLAY_ORDER) {
    const count = typeCounts[t]
    if (count && count > 0) {
      parts.push(`${count} ${count === 1 ? t : t + "s"}`)
    }
  }

  for (const [t, count] of Object.entries(typeCounts)) {
    if (count > 0 && !(TYPE_DISPLAY_ORDER as readonly string[]).includes(t)) {
      parts.push(`${count} ${count === 1 ? t : t + "s"}`)
    }
  }

  return parts.join(" · ")
}

/** Minimal shape for derivePipelineStages — matches both BdBead (server) and client-side rpc.activity.listBeadsByStatus output. */
export interface PipelineBead {
  id: string
  status: string
  issue_type?: string
  priority?: number
}

// beadbox-8k3: pipeline-card stages are now derived from a workspace's
// configured chain (pm/spec.md §4.9), not a hardcoded canonical set.
// Caller passes the composed chain (`composePipelineChain(customChain)`
// from lib/status-chain.ts → `[open, in_progress, ...custom, closed]`).
//
// The legacy `backlog` synthetic tile is gone per strict-spec reading —
// spec §4.9's tile composition is OPEN/IN_PROGRESS/<chain>/CLOSED with no
// backlog. P4 beads with status=open now count under OPEN. The filter-bar
// priority filter still provides backlog filtering elsewhere.
//
// Retired-status legacy beads (e.g., bead.status='in_qa' but in_qa not in
// the current chain) fall under STATUS_ALIASES → closest matching tile.
// Spec authorizes either closest-match or an "Other" tile; closest-match
// chosen for UX continuity with existing alias handling.
export function derivePipelineStages(
  beads: PipelineBead[],
  chain: readonly string[],
): PipelineStage[] {
  const buckets = new Map<string, string[]>()
  const typeCountBuckets = new Map<string, Record<string, number>>()
  for (const stage of chain) {
    buckets.set(stage, [])
    typeCountBuckets.set(stage, {})
  }

  for (const bead of beads) {
    const aliased = STATUS_ALIASES[bead.status] ?? bead.status
    const beadType = bead.issue_type ?? "task"

    // Bucket by the bead's status (or its alias for retired statuses).
    // Beads whose status is not in the workspace's current chain fall
    // through silently — same dropped-on-floor semantics as the
    // pre-cleanup `bucket` guard.
    const bucket = buckets.get(aliased)
    if (bucket) {
      bucket.push(bead.id)
      const tc = typeCountBuckets.get(aliased)!
      tc[beadType] = (tc[beadType] ?? 0) + 1
    }
  }

  return chain.map((stage) => {
    const ids = buckets.get(stage) ?? []
    return {
      name: stage,
      count: ids.length,
      beadIds: ids,
      displayIds: ids.slice(0, 4),
      overflow: Math.max(0, ids.length - 4),
      typeCounts: typeCountBuckets.get(stage) ?? {},
    }
  })
}
