// Source-local copy of lib/scrub-pii.ts (P1.3 / bb-vy13.3).
// Verbatim — no deps.
//
// Strip user-identifiable paths from error messages before sending to telemetry.
// Replaces /Users/<name>/, /home/<name>/, and C:\Users\<name>\ with ~/

const HOME_DIR_PATTERNS = [
  // Windows (forward slashes, as seen in some Node errors) - must run before macOS pattern
  /C:\/Users\/[^/\s]+\//gi,
  // Windows (backslashes, doubled in JSON/string escaping)
  /C:\\\\Users\\\\[^\\\\\s]+\\\\/gi,
  // Windows (single backslashes in raw text)
  /C:\\Users\\[^\\\s]+\\/gi,
  // macOS: /Users/stevenriley/.beads/ -> ~/.beads/
  /\/Users\/[^/\s]+\//g,
  // Linux: /home/timmstokke/projects/ -> ~/projects/
  /\/home\/[^/\s]+\//g,
]

export function scrubPii(text: string): string {
  let result = text
  for (const pattern of HOME_DIR_PATTERNS) {
    result = result.replace(pattern, "~/")
  }
  return result
}
