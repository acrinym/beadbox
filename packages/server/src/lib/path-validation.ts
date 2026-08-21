import { homedir } from "node:os"
import { basename, dirname, isAbsolute, resolve } from "path"

// Accepts .beads/ directory paths (Dolt workspaces), files inside .beads/,
// and server:// URIs for server-only workspaces (e.g. server://host:port/database).
//
// Security: The .beads structural check ensures the path targets a beads database.
// bd CLI respects OS file permissions, and the Tauri app runs under the user's
// account, so restricting to specific base directories is unnecessary and breaks
// Windows where projects live on arbitrary drives (D:\, UNC paths, etc.).
export function isValidDbPath(dbPath: string): boolean {
  if (!dbPath) return false
  if (dbPath.includes("\0")) return false

  // Server-only workspace URI (no filesystem path to validate)
  if (dbPath.startsWith("server://")) return true

  const resolved = resolve(dbPath)

  // Must resolve to an absolute path (resolve always returns absolute, but
  // guard against edge cases like empty string after resolution)
  if (!isAbsolute(resolved)) return false

  // Must be a .beads directory or a file/subdir inside .beads/
  const base = basename(resolved)
  const parent = dirname(resolved)
  const isBeadsDir = base === ".beads"
  const parentIsBeads = basename(parent) === ".beads"
  if (!isBeadsDir && !parentIsBeads) return false

  return true
}

// Expand a leading "~" (alone or followed by a separator) to the user's home
// directory. "~user" style expansion is deliberately NOT supported — it would
// require passwd lookups and no caller needs it.
export function expandHome(input: string): string {
  if (typeof input !== "string") return input
  return input.replace(/^~(?=$|\/)/, homedir())
}

// Validate a directory path supplied by the client for workspace add/init
// (beadbox-l5i.3, item 4).
//
// Deliberately NOT isValidDbPath(): that one requires a .beads component,
// which is exactly what the directory being added does not have yet.
//
// What this rejects, and why:
//   - non-string / empty / whitespace-only: nothing sensible to resolve.
//   - NUL byte: reaches the syscall layer as an opaque ERR_INVALID_ARG_VALUE
//     and, in the C string world underneath, truncates.
//   - relative paths: they would resolve against whatever cwd the sidecar
//     inherited from the Tauri host, so the same input means different
//     directories depending on how the app was launched. Callers run
//     expandHome() first, so "~/x" arriving here unexpanded is also a
//     rejection rather than a silently-relative path.
//
// Traversal segments in an absolute path are fine: bd runs as the user and
// the OS enforces permissions, so confining to a base directory would only
// break legitimate layouts (Windows drive letters, UNC paths, external
// volumes) without adding a boundary the kernel isn't already enforcing.
export function isValidWorkspaceDir(dirPath: string): boolean {
  if (typeof dirPath !== "string") return false
  if (dirPath.trim().length === 0) return false
  if (dirPath.includes("\0")) return false
  return isAbsolute(dirPath)
}
