// Source-local STUB of lib/posthog-node.ts (P1.3 / bb-vy13.3).
//
// Same stub pattern as P1.1 flock-contention-tracker: keep the import surface
// available so consumers (handlers/workspaces.ts here) compile and behave
// without pulling the posthog-node dep into the sidecar binary. Analytics
// belong on the client side of the Tauri/sidecar boundary; the production
// app keeps emitting via Next.js. P3 wiring will keep PostHog reporting
// in the client process where it already lives.
//
// Behavior: getPostHogNode() always returns null, so the
// `if (ph) { ph.capture(...) }` guards in callers short-circuit cleanly.
// captureServerError() is a no-op for the same reason.

import { scrubPii } from "./scrub-pii"

// PostHog client interface — only the methods the action surface calls.
// Kept structural so swapping in real PostHog later requires no signature change.
interface PostHogClient {
  capture(payload: {
    distinctId: string
    event: string
    properties?: Record<string, unknown>
  }): void
  flush(): void
}

const client: PostHogClient | null = null

export function getPostHogNode(): PostHogClient | null {
  // Stub: never initialise inside the sidecar. Returning null is the
  // "analytics disabled" branch every caller already handles.
  return client
}

export function captureServerError(error: Error, _context?: Record<string, unknown>): void {
  // Stub: no-op. Surface the scrubbed message on stderr so failures are still
  // observable in dev when the parent (Tauri host) relays sidecar stderr.
  process.stderr.write(
    `[posthog-stub] captureServerError ${error.name}: ${scrubPii(error.message)}\n`,
  )
}
