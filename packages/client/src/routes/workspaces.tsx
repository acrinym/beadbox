// TanStack Router file route for /workspaces (P3.2 / bb-90zz.2).
// Replaces app/workspaces/page.tsx — old Next.js route stays running per
// the P3 coordination contract until P3.7 cutover.

import { createFileRoute } from "@tanstack/react-router"
import { WorkspacesPage } from "../components/workspaces-page"

export const Route = createFileRoute("/workspaces")({
  component: WorkspacesPage,
})
