// bb-hivb: local-override path for feature flags. PostHog SDK has been
// dark on v0.25 builds (bb-aurr re-opened) so flags configured at 100%
// rollout still evaluate to false on Nelson's machine. This helper
// short-circuits PostHog when an override is set.
//
// Override precedence (first match wins):
//   1. Build-time env: VITE_BEADBOX_FLAG_OVERRIDE="flag=true;other=false"
//   2. Runtime localStorage: localStorage.beadbox_flag_overrides='{"flag":true}'
//   3. PostHog SDK (try/catch — returns false if SDK is dark or throws)
//
// Both override sources use the literal flag key (e.g. "enable-ai-help").
// Designed to stay in place as a permanent escape hatch even after bb-aurr
// fixes the SDK init.
//
// beadbox-01f.1: KEPT deliberately after Formulas went GA and stopped being its
// only caller. It is the sole override path for a live open bug, and three
// shipping flags -- use-private-update-repo, enable-ai-help,
// enable-molecule-view -- still call posthog.isFeatureEnabled directly with no
// hatch at all, so they evaluate false whenever the SDK is dark. That is the
// same accident that hid Formulas. See feature-flag.test.ts, which is kept
// green so this is tested infrastructure rather than machinery that merely
// looks alive.
import posthog from "posthog-js"

function readEnvOverride(flag: string): boolean | undefined {
  const raw = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_BEADBOX_FLAG_OVERRIDE
  if (!raw) return undefined
  for (const pair of raw.split(";")) {
    const eq = pair.indexOf("=")
    if (eq <= 0) continue
    const key = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim().toLowerCase()
    if (key === flag) return value === "true"
  }
  return undefined
}

function readLocalStorageOverride(flag: string): boolean | undefined {
  try {
    const raw = localStorage.getItem("beadbox_flag_overrides")
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const value = parsed[flag]
    if (typeof value === "boolean") return value
  } catch {
    /* malformed JSON, missing localStorage, etc. — ignore */
  }
  return undefined
}

export function isFeatureEnabled(flag: string): boolean {
  const envOverride = readEnvOverride(flag)
  if (envOverride !== undefined) return envOverride

  const lsOverride = readLocalStorageOverride(flag)
  if (lsOverride !== undefined) return lsOverride

  try {
    return posthog.isFeatureEnabled(flag) === true
  } catch {
    return false
  }
}
