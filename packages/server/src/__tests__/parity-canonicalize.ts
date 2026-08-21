// Canonicalization helpers for the parity runner (bb-vy13.7).
//
// Six binding rules per the bead spec:
//   1. Object keys sorted alphabetically at every level.
//   2. Date -> ISO string at second precision (".toISOString().slice(0, 19) + 'Z'").
//   3. null and undefined collapsed to null (server actions sometimes return
//      missing fields as undefined while JSON marshalling produces null).
//   4. Arrays preserved in encounter order EXCEPT for fields explicitly marked
//      unordered (labels, tags, comments, children, dependencies, dependents).
//      Sort by element id if available, else by JSON-stringified canonicalized
//      element.
//   5. Floating-point numbers rounded to 6 decimal places.
//   6. Errors compared by `error.constructor.name + error.message` only
//      (no stack trace).

const UNORDERED_FIELD_NAMES: ReadonlySet<string> = new Set([
  "labels",
  "tags",
  "comments",
  "children",
  "childEpics",
  "dependencies",
  "dependents",
  "blockedBy",
  "blocks",
])

/**
 * Recursively canonicalize a value per the six rules above.
 *
 * Returns a structurally-normalized clone that is safe to JSON.stringify
 * for byte-equality comparison. Does NOT mutate the input.
 */
export function canonicalize(value: unknown, fieldName?: string): unknown {
  // Rule 6: special handling for Errors via canonicalizeError; here we just
  // pass through if someone mistakenly threaded an Error in. Use
  // canonicalizeError() for that case.
  if (value instanceof Error) {
    return canonicalizeError(value)
  }

  // Rule 3: null and undefined collapse to null.
  if (value === undefined || value === null) {
    return null
  }

  // Rule 2: Date to ISO at second precision.
  if (value instanceof Date) {
    const ms = value.getTime()
    if (Number.isNaN(ms)) return null
    return value.toISOString().slice(0, 19) + "Z"
  }

  // Rule 5: floats to 6 decimals (integers untouched).
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null
    if (Number.isInteger(value)) return value
    return Math.round(value * 1_000_000) / 1_000_000
  }

  // Rule 4: arrays. Preserve order except when the parent field name marks
  // this as unordered.
  if (Array.isArray(value)) {
    const items = value.map((v) => canonicalize(v))
    if (fieldName && UNORDERED_FIELD_NAMES.has(fieldName)) {
      items.sort(stableCompare)
    }
    return items
  }

  // Rule 1: object keys sorted alphabetically.
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const k of Object.keys(obj).sort()) {
      sorted[k] = canonicalize(obj[k], k)
    }
    return sorted
  }

  // Primitives (string, boolean, bigint, symbol) unchanged.
  return value
}

/**
 * Canonicalize a thrown Error per rule 6: name + message, no stack.
 */
export function canonicalizeError(err: unknown): { __error: true; name: string; message: string } {
  if (err instanceof Error) {
    return { __error: true, name: err.constructor.name, message: err.message }
  }
  return { __error: true, name: "NonError", message: String(err) }
}

/**
 * Stable comparison for canonicalized array elements. Sorts by `id` if
 * present, else by JSON-stringified element. Both sides must already be
 * canonicalized so the JSON form is stable.
 */
function stableCompare(a: unknown, b: unknown): number {
  const idA = extractId(a)
  const idB = extractId(b)
  if (idA !== null && idB !== null) {
    return idA < idB ? -1 : idA > idB ? 1 : 0
  }
  const sa = JSON.stringify(a)
  const sb = JSON.stringify(b)
  return sa < sb ? -1 : sa > sb ? 1 : 0
}

function extractId(value: unknown): string | null {
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id: unknown }).id
    if (typeof id === "string") return id
    if (typeof id === "number") return String(id)
  }
  return null
}

/**
 * Produce a human-readable diff between two canonicalized values. Shows the
 * first byte-position mismatch with ~80 chars of surrounding context on
 * either side, plus a summary of which side has more bytes.
 */
export function formatDiff(a: unknown, b: unknown): string {
  const sa = JSON.stringify(a, null, 2)
  const sb = JSON.stringify(b, null, 2)
  if (sa === sb) return "(no diff)"

  let firstMismatch = 0
  const minLen = Math.min(sa.length, sb.length)
  while (firstMismatch < minLen && sa[firstMismatch] === sb[firstMismatch]) {
    firstMismatch++
  }

  const ctxBefore = 80
  const ctxAfter = 80
  const start = Math.max(0, firstMismatch - ctxBefore)
  const endA = Math.min(sa.length, firstMismatch + ctxAfter)
  const endB = Math.min(sb.length, firstMismatch + ctxAfter)

  const aSnippet = sa.slice(start, endA)
  const bSnippet = sb.slice(start, endB)

  return [
    `byte-position mismatch at offset ${firstMismatch} (action ${sa.length}b vs handler ${sb.length}b)`,
    `--- action snippet (offset ${start}..${endA}) ---`,
    aSnippet,
    `--- handler snippet (offset ${start}..${endB}) ---`,
    bSnippet,
  ].join("\n")
}
