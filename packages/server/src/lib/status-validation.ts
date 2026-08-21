// Source-local copy of packages/client/src/lib/status-validation.ts. The
// client uses this for inline validation in the Workflow tab; the server
// re-uses the same rules in the kkrpc handler as defence-in-depth (a
// malformed client payload must never write garbage to status.custom).
//
// Mirrors the P1.2 pattern: each workspace package keeps a self-contained
// copy of zero-dep utility modules rather than introducing a shared package.
//
// Ported from v0.24 lib/status-validation.ts (commit 1386b41 / bb-oqux).
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
