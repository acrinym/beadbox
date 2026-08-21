import type { ActivityEvent } from "./types"

export function extractBeadTitle(event: ActivityEvent): string | null {
  const msg = event.message
  const dotIndex = msg.indexOf("·")
  if (dotIndex === -1) return null
  let title = msg.slice(dotIndex + 1).trim()
  const atIndex = title.lastIndexOf("@")
  if (atIndex > 0) {
    title = title.slice(0, atIndex).trim()
  }
  return title || null
}

export function extractActorFromMessage(event: ActivityEvent): string {
  if (event.actor) return event.actor
  const msg = event.message
  const atIndex = msg.lastIndexOf("@")
  if (atIndex > 0) {
    return msg.slice(atIndex + 1).trim()
  }
  return "Unknown"
}

export function eventKey(event: ActivityEvent): string {
  return `${event.timestamp}|${event.issue_id}|${event.type}|${event.message}`
}
