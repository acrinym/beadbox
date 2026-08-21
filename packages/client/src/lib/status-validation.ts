// Reserved status names — bd's built-in statuses that users cannot redefine.
// Source: `bd config --help` → "the built-in statuses (open, in_progress, blocked, deferred, closed)".
//
// Ported from v0.24 lib/status-validation.ts (commit 1386b41 / bb-oqux) for
// v0.25's bb-wxuw port. Kept on the client side because the inline validation
// runs in the manager UI before the rpc round-trip; the server handler
// re-validates as defence-in-depth.
export const RESERVED_STATUSES = ["open", "in_progress", "blocked", "deferred", "closed"] as const

const NAME_PATTERN = /^[a-z][a-z0-9_]*$/
const MAX_LENGTH = 50

export function validateStatusName(name: string, existing: readonly string[]): string | null {
  const trimmed = name.trim()
  if (!trimmed) return "Name is required"
  if (trimmed.length > MAX_LENGTH) return `Name must be ${MAX_LENGTH} characters or fewer`
  if (!NAME_PATTERN.test(trimmed)) {
    return "Use lowercase letters, digits, and underscores only (must start with a letter)"
  }
  if ((RESERVED_STATUSES as readonly string[]).includes(trimmed)) {
    return `'${trimmed}' is a built-in status and cannot be redefined`
  }
  if (existing.includes(trimmed)) return `'${trimmed}' already exists`
  return null
}
