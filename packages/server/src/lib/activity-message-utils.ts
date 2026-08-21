import type { ActivityEvent } from "./types"

// Extract bead title from the message field
// Message format: "bb-xxx -> status_name . Bead Title @actor" or "bb-xxx comment . Bead Title @actor"
export function extractBeadTitle(event: ActivityEvent): string | null {
  const msg = event.message
  // Try to extract title after the center dot
  const dotIndex = msg.indexOf("\u00b7")
  if (dotIndex === -1) return null
  let title = msg.slice(dotIndex + 1).trim()
  // Remove trailing @actor if present
  const atIndex = title.lastIndexOf("@")
  if (atIndex > 0) {
    title = title.slice(0, atIndex).trim()
  }
  // Remove trailing ellipsis from truncated titles
  return title || null
}

// Extract actor from message when actor field is absent
// Messages end with @actorname
export function extractActorFromMessage(event: ActivityEvent): string {
  if (event.actor) return event.actor
  const msg = event.message
  const atIndex = msg.lastIndexOf("@")
  if (atIndex > 0) {
    return msg.slice(atIndex + 1).trim()
  }
  return "Unknown"
}

// Create a unique key for deduplication
export function eventKey(event: ActivityEvent): string {
  return `${event.timestamp}|${event.issue_id}|${event.type}|${event.message}`
}
