import { createFileRoute } from "@tanstack/react-router"
import { TrainsPage } from "../components/trains-page"

export const Route = createFileRoute("/trains")({
  component: TrainsPage,
})
