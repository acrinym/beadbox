// bb-mhh1.2: shared safeCapture wrapper for posthog.capture call sites.
// Promoted from subscribe.ts (bb-on9h commit 7f2c467) to a shared module
// per pm/systemdesign.md §11.3 (SDK Init + DCE Protection) + §11.4 (PII
// Boundary). The architectural contract: PostHog init can fail silently
// (key absent → no init → posthog.capture undefined; transport-level
// throws after init), and supplementary telemetry must NEVER propagate
// exceptions into load-bearing wires (subscriptions, mutations, route
// transitions, error screens).
//
// safeCapture is byte-equivalent to direct posthog.capture in the happy
// path and adds graceful fallback when capture is undefined or throws.
// The once-per-session warn keeps diagnosability without log spam.
//
// Usage: replace `posthog.capture(name, props)` with `safeCapture(name,
// props)`. SDK lifecycle calls (posthog.init, register, identify, alias)
// are out of scope — those have different failure semantics and are
// invoked from a single init site (posthog-provider.tsx).

import posthog from "posthog-js"

let _safeCaptureWarned = false

export function safeCapture(eventName: string, props?: Record<string, unknown>): void {
  try {
    if (typeof posthog.capture !== "function") {
      if (!_safeCaptureWarned) {
        _safeCaptureWarned = true
        // eslint-disable-next-line no-console
        console.warn(
          "[posthog-safe] posthog.capture unavailable (SDK not initialized) — telemetry events will be dropped this session",
        )
      }
      return
    }
    posthog.capture(eventName, props)
  } catch (err) {
    // Defense-in-depth: if posthog itself throws (e.g., transport
    // misconfig, snippet-level exception), the calling wire still wins.
    // Log once per session for diagnosability.
    if (!_safeCaptureWarned) {
      _safeCaptureWarned = true
      // eslint-disable-next-line no-console
      console.warn("[posthog-safe] posthog.capture threw, suppressing telemetry:", err)
    }
  }
}

// Test-only: reset the once-per-session warn flag between cases so tests
// can assert the warn-fires-once contract without leaking state.
export function _resetSafeCaptureWarned(): void {
  _safeCaptureWarned = false
}
