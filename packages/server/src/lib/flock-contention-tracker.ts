// Tracks flock contention events per dbPath. STUBBED for the sidecar.
//
// In the main app (lib/flock-contention-tracker.ts), crossing the 5-events-in-60s
// threshold broadcasts a `flock_threshold` message over WebSocket via the legacy ws transport.
// The sidecar has no WebSocket broadcaster — that transport is the very thing
// the P1-P6 migration replaces. Pulling the legacy ws transport into packages/server would
// contaminate the new package with the code P1.6 is built to delete.
//
// Resolution (super-authorized 2026-04-25, bb-vy13.1 halt): keep the file
// signature and threshold bookkeeping identical so packages/server/src/lib/bd.ts
// can call recordFlockContention without modification, but drop the broadcast
// side-effect. P1.6 will route flock_threshold events through the kkrpc
// subscription channel, at which point this stub gets a real implementation.
//
// P6 dedup will collapse this stub and the original lib/flock-contention-tracker.ts
// into a single source of truth driven by kkrpc.
//
// Server-side only (runs in the Bun sidecar process).

const THRESHOLD_COUNT = 5
const THRESHOLD_WINDOW_MS = 60_000

/** Test-only overrides. */
export const _testOverrides = {
  thresholdCount: null as number | null,
  thresholdWindowMs: null as number | null,
}

function getThresholdCount(): number {
  return _testOverrides.thresholdCount ?? THRESHOLD_COUNT
}

function getThresholdWindowMs(): number {
  return _testOverrides.thresholdWindowMs ?? THRESHOLD_WINDOW_MS
}

interface TrackerState {
  timestamps: number[]
  thresholdBroadcasted: boolean
}

const trackers = new Map<string, TrackerState>()

function getTracker(dbPath: string): TrackerState {
  let t = trackers.get(dbPath)
  if (!t) {
    t = { timestamps: [], thresholdBroadcasted: false }
    trackers.set(dbPath, t)
  }
  return t
}

/**
 * Record a flock contention event. Returns true the first time the threshold
 * is crossed. The original main-app version broadcasts a WebSocket message
 * here; the sidecar version has no broadcaster and silently records the event.
 * P1.6 wires a real subscription emit.
 */
export function recordFlockContention(dbPath: string): boolean {
  const tracker = getTracker(dbPath)
  const now = Date.now()

  tracker.timestamps.push(now)

  const windowStart = now - getThresholdWindowMs()
  tracker.timestamps = tracker.timestamps.filter((t) => t >= windowStart)

  if (tracker.timestamps.length >= getThresholdCount() && !tracker.thresholdBroadcasted) {
    tracker.thresholdBroadcasted = true
    // Stub: broadcast deliberately omitted. See file header for rationale.
    return true
  }

  return false
}

/** Reset tracker state for a dbPath (e.g. after switching to server mode). */
export function resetFlockTracker(dbPath: string): void {
  trackers.delete(dbPath)
}

/** Reset all trackers (for testing). */
export function __resetAllTrackers(): void {
  trackers.clear()
}
