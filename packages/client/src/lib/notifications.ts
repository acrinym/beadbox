// bb-pyv8: UI side-effect helpers extracted from lib/epic-tree-utils.ts
// per bb-78qr (arch audit) — pure helpers should not import posthog-js +
// sonner. New side-effect-bearing toast/analytics emitters live here.

import { toast } from "sonner"
import { getAnalyticsEnabled } from "./local-storage"
import { safeCapture } from "./posthog-safe"

export function toastError(message: string, opts?: { description?: string }) {
  toast.error(message, opts)
  if (getAnalyticsEnabled()) {
    safeCapture("app_error_shown", {
      error_category: "bd-error",
      component: "toast",
      workspace_count: 0,
      has_retry: false,
    })
  }
}
