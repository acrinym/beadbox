// P3.4 /formulas route. The route file itself is trivial — TanStack
// Router file-based routing wraps the FormulasView orchestrator
// (packages/client/src/components/formulas-view.tsx) which owns the
// data flow + chrome mounting.
//
// Mirror of app/formulas/page.tsx (which similarly just shells to
// FormulasView). Migration parity: navigating to /formulas shows the
// same DAG/tree/step-detail/preview/pour modal flow as the Next.js
// route at the same path.

import { createFileRoute } from "@tanstack/react-router"
import { FormulasView } from "../components/formulas-view"

export const Route = createFileRoute("/formulas")({
  component: FormulasView,
})
