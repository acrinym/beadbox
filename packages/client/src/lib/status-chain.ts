// Shared status-chain helpers for spec §4.3 (workflow advancement button)
// and §4.9 (activity-tab pipeline card). Both surfaces read the workspace's
// `status.custom` chain and need consistent ordering + display labels.
//
// beadbox-8k3 introduces this module for the pipeline card. eng1's
// beadbox-3qo will consume the same helpers for the workflow advancement
// button. Pure functions only — no React, no I/O. Workspace-lifecycle
// owns the chain fetch + state.

/** Core lifecycle statuses, always present + position-fixed in the pipeline. */
const CORE_STATUSES = new Set(["open", "in_progress", "closed"])

/** Special-case display tokens that lowercase-title-case would mangle. */
const DISPLAY_TOKEN_OVERRIDES: Record<string, string> = {
  qa: "QA",
  ui: "UI",
  ux: "UX",
  api: "API",
  ci: "CI",
  cd: "CD",
  pr: "PR",
  id: "ID",
}

/**
 * Format a raw status string as a human-readable display label.
 * Per pm/spec.md §4.9: "title-cased + underscore-normalized".
 *
 *   getStatusDisplayLabel("ready_for_qa") === "Ready for QA"
 *   getStatusDisplayLabel("qa_passed")    === "QA Passed"
 *   getStatusDisplayLabel("in_progress")  === "In Progress"
 *   getStatusDisplayLabel("closed")       === "Closed"
 *
 * Token-override map handles tokens that title-case would mangle (qa, ui, etc.).
 * Connector words ("for", "the") are lowercased mid-phrase per typographic
 * convention; first word always title-cased.
 */
export function getStatusDisplayLabel(status: string): string {
  if (!status) return ""
  const connectors = new Set(["for", "the", "of", "and", "or", "to", "in", "on", "at"])
  return status
    .split("_")
    .map((token, idx) => {
      const lower = token.toLowerCase()
      if (DISPLAY_TOKEN_OVERRIDES[lower]) return DISPLAY_TOKEN_OVERRIDES[lower]
      if (idx > 0 && connectors.has(lower)) return lower
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join(" ")
}

/**
 * Filter the `availableStatuses` list (core + custom, flat) down to just
 * the user-configured custom chain, preserving original order. This mirrors
 * what `bd config get status.custom` returns directly; we derive client-side
 * to avoid a second RPC.
 *
 * If a user explicitly added a core status (e.g., "open") to their custom
 * chain, it's still filtered out here — core statuses always occupy their
 * fixed positions in `composePipelineChain` below.
 */
export function deriveCustomStatusChain(availableStatuses: readonly string[]): string[] {
  return availableStatuses.filter((s) => !CORE_STATUSES.has(s))
}

/**
 * Compose the full pipeline-card chain per pm/spec.md §4.9 tile order:
 *
 *   OPEN -> IN_PROGRESS -> <custom chain in order> -> CLOSED
 *
 * De-duplicates if a custom-chain entry happens to be one of the core
 * statuses (defensive — `deriveCustomStatusChain` should already strip
 * those, but a direct caller might pass an unfiltered list).
 */
export function composePipelineChain(customChain: readonly string[]): string[] {
  const seen = new Set<string>(["open", "in_progress", "closed"])
  const middle: string[] = []
  for (const entry of customChain) {
    if (!seen.has(entry)) {
      seen.add(entry)
      middle.push(entry)
    }
  }
  return ["open", "in_progress", ...middle, "closed"]
}
