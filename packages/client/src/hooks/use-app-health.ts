"use client"

import { useCallback, useRef, useState } from "react"
import type { BdLoadError } from "../lib/bd-error"
import { getAnalyticsEnabled } from "../lib/local-storage"
import { safeCapture } from "../lib/posthog-safe"

export type AppHealth =
  | { status: "healthy" }
  | { status: "degraded"; reason: string }
  | { status: "error"; reason: string; canRetry: boolean; loadError: BdLoadError }
  | { status: "fatal"; reason: string; loadError: BdLoadError }

export function useAppHealth() {
  const [health, setHealth] = useState<AppHealth>({ status: "healthy" })
  const healthRef = useRef<AppHealth>(health)

  const update = useCallback((h: AppHealth) => {
    healthRef.current = h
    setHealth(h)
  }, [])

  // bb-v340: app_health_recovered emits only on transitions OUT of an
  // unhealthy status. v0.24.x parity (app/page.tsx setHealthy + the
  // wasDegraded check at the legacy ws transport site) — no spurious events
  // when already-healthy setHealthy is called repeatedly.
  const setHealthy = useCallback(() => {
    const prev = healthRef.current.status
    update({ status: "healthy" })
    if (prev !== "healthy" && prev !== "fatal" && getAnalyticsEnabled()) {
      safeCapture("app_health_recovered", { recovered_from: prev })
    }
  }, [update])

  // bb-v340: app_health_degraded emits on healthy→degraded OR on a
  // degraded→degraded reason change (so dashboards see the new reason).
  // Repeated setDegraded with the same reason is a no-op for telemetry.
  // Property shape matches v0.24.x (reason + previous_status + was_healthy).
  const setDegraded = useCallback(
    (reason: string) => {
      const prev = healthRef.current
      update({ status: "degraded", reason })
      if (
        prev.status !== "degraded" ||
        (prev.status === "degraded" && prev.reason !== reason)
      ) {
        if (getAnalyticsEnabled()) {
          safeCapture("app_health_degraded", {
            reason,
            was_healthy: prev.status === "healthy",
            previous_status: prev.status,
          })
        }
      }
    },
    [update],
  )

  const setError = useCallback(
    (reason: string, loadError: BdLoadError, canRetry = true) =>
      update({ status: "error", reason, canRetry, loadError }),
    [update],
  )

  const setFatal = useCallback(
    (reason: string, loadError: BdLoadError) => update({ status: "fatal", reason, loadError }),
    [update],
  )

  return { health, healthRef, setHealthy, setDegraded, setError, setFatal }
}
