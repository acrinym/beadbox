"use client"

import posthog from "posthog-js"
import { useCallback, useEffect, useRef, useState } from "react"
import { safeCapture } from "../lib/posthog-safe"
import {
  getAnalyticsEnabled,
  getUpdateCheckEnabled,
  getUpdateCheckFrequency,
  getUpdateDismissedVersion,
  setUpdateDismissedVersion,
} from "../lib/local-storage"
import { checkForUpdate, type UpdateCheckOptions, type UpdateInfo } from "../lib/update-checker"

const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? "0.0.0"
const BUILD_TAG = import.meta.env.VITE_BUILD_TAG ?? ""

interface UpdateCheckerConfig {
  enabled?: boolean
  frequency?: number
}

interface UseUpdateCheckerResult {
  updateAvailable: UpdateInfo | null
  checking: boolean
  checkNow: () => Promise<void>
  dismissUpdate: () => void
  lastChecked: Date | null
  clearUpdate: () => void
}

export function useUpdateChecker(config?: UpdateCheckerConfig): UseUpdateCheckerResult {
  const [updateAvailable, setUpdateAvailable] = useState<UpdateInfo | null>(null)
  const [checking, setChecking] = useState(false)
  const [lastChecked, setLastChecked] = useState<Date | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Track which version we already fired app_update_available for to prevent
  // duplicates (initial check + onFeatureFlags callback both call runCheck).
  const firedVersionRef = useRef<string | null>(null)

  // Resolve config: explicit params take precedence over localStorage
  const enabled = config?.enabled ?? getUpdateCheckEnabled()
  const frequency = config?.frequency ?? getUpdateCheckFrequency()

  const getUpdateOptions = useCallback((): UpdateCheckOptions | undefined => {
    try {
      if (posthog.isFeatureEnabled("use-private-update-repo")) {
        const payload = posthog.getFeatureFlagPayload("use-private-update-repo") as
          | { token?: string }
          | string
          | undefined
        const token = typeof payload === "object" && payload !== null ? payload.token : undefined
        return {
          repo: "nmelo/beadbox",
          includePrerelease: true,
          token,
          buildTag: BUILD_TAG || undefined,
        }
      }
    } catch {
      // PostHog not initialized or flags not loaded; use defaults
    }
    return undefined
  }, [])

  const runCheck = useCallback(async () => {
    setChecking(true)
    try {
      const result = await checkForUpdate(APP_VERSION, getUpdateOptions())
      if (result) {
        const dismissed = getUpdateDismissedVersion()
        if (dismissed === result.version) {
          setUpdateAvailable(null)
        } else {
          setUpdateAvailable(result)
          if (getAnalyticsEnabled() && firedVersionRef.current !== result.version) {
            firedVersionRef.current = result.version
            safeCapture("app_update_available", {
              current_version: APP_VERSION,
              available_version: result.version,
              channel: result.version.includes("-rc") ? "rc" : "stable",
            })
          }
        }
      } else {
        setUpdateAvailable(null)
      }
      setLastChecked(new Date())
    } finally {
      setChecking(false)
    }
  }, [getUpdateOptions])

  // Initial check on mount + periodic interval, reactive to enabled/frequency
  useEffect(() => {
    if (!enabled) {
      setUpdateAvailable(null)
      return
    }

    runCheck()

    // Re-run check when PostHog flags become available (flags load async,
    // so the initial runCheck above may miss the use-private-update-repo flag)
    posthog.onFeatureFlags?.(() => {
      runCheck()
    })

    intervalRef.current = setInterval(runCheck, frequency)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [runCheck, enabled, frequency])

  // Manual check ignores the enabled flag (user explicitly requested it)
  const checkNow = useCallback(async () => {
    setChecking(true)
    try {
      const result = await checkForUpdate(APP_VERSION, getUpdateOptions())
      if (result) {
        setUpdateAvailable(result)
      } else {
        setUpdateAvailable(null)
      }
      setLastChecked(new Date())
    } finally {
      setChecking(false)
    }
  }, [getUpdateOptions])

  const dismissUpdate = useCallback(() => {
    if (updateAvailable) {
      if (getAnalyticsEnabled()) {
        safeCapture("app_update_dismissed", {
          available_version: updateAvailable.version,
        })
      }
      setUpdateDismissedVersion(updateAvailable.version)
      setUpdateAvailable(null)
    }
  }, [updateAvailable])

  const clearUpdate = useCallback(() => {
    setUpdateAvailable(null)
  }, [])

  return { updateAvailable, checking, checkNow, dismissUpdate, lastChecked, clearUpdate }
}
