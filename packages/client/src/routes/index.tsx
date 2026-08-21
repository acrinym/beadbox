// Home route — REPLACES the P2.1 placeholder (bb-90zz.5).
//
// Split 1 wires HomePage with EpicTree + FilterBar + chrome. Bead table /
// detail panel / expanded modal are stubs from this same bead's Split 2
// landing. Subscriptions hook off the central useChangeSubscription
// mounted by __root.

import { createFileRoute } from "@tanstack/react-router"
import { HomePage } from "@/components/home-page"

export const Route = createFileRoute("/")({
  component: HomePage,
})
