import { createFileRoute } from "@tanstack/react-router"

import { ActivityPage } from "../components/activity-page"

// /activity — read-only stream view. The dual-channel useChangeSubscription
// (mounted in __root.tsx) drives invalidations; ActivityFeed re-fetches via
// rpc.activity.* on each event.
//
// Per the bb-90zz.3 PLAN: NO additional useChangeSubscription mount here.
// Single source of invalidations is the binding rule.

export const Route = createFileRoute("/activity")({
  component: ActivityPage,
})
