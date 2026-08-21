// Source-local copy of lib/capture-action-failed.ts (P3.2 / bb-90zz.2).
// Verbatim — only the relative import for scrub-pii (already relative in source).

import { safeCapture } from "./posthog-safe"
import { scrubPii } from "./scrub-pii"

export function captureServerActionFailed(
  action: string,
  errorMessage: string,
  elapsedMs: number,
): void {
  safeCapture("app_server_action_failed", {
    action,
    error_message: scrubPii(
      errorMessage
        .replace(/\s*\n\s*/g, " ")
        .trim()
        .slice(0, 500),
    ),
    elapsed_ms: elapsedMs,
  })
}

export async function trackedAction<T extends { success: boolean; error?: string }>(
  action: string,
  fn: () => Promise<T>,
): Promise<T> {
  const startMs = Date.now()
  const result = await fn()
  if (!result.success) {
    captureServerActionFailed(action, result.error ?? "Unknown error", Date.now() - startMs)
  }
  return result
}
