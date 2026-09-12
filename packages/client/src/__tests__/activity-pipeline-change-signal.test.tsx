// beadbox-11i: the pipeline card's per-workspace session cache must yield to
// bd's change signal. The 30 s TTL exists so a signal-less re-mount (Beads →
// Activity → Beads inside one workspace) paints from cache instead of
// spawning `bd list` again; it must NOT hold a stale snapshot over a change
// signal — that is the invalidation Nelson's #34 cache ruling relies on.
//
// The pipeline path is exercised through the real ActivityPage with the rpc
// proxy stubbed, so the assertion is on the observable contract (how many
// times `bd list` was asked for) rather than on the cache's internals.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router"
import { act, cleanup, render, waitFor } from "@testing-library/react"

import { ActivityPage } from "../components/activity-page"
import { StartupGate } from "../components/startup-gate"
import { _resetRpc, _setRpc, type RemoteApi } from "../lib/rpc"
import { _emitChangeForTests, _resetSubscriptionChangeCount } from "../lib/subscribe"
import type { Workspace } from "../lib/types"
import { clearWorkspaceCookie, setWorkspaceCookie } from "../lib/workspace-cookie"
import { _resetWorkspaceSessions } from "../lib/workspace-session-cache"

const alpha: Workspace = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "alpha",
  path: "/tmp/alpha",
  databasePath: "/tmp/alpha/.beads",
  registered: true,
  available: true,
  mode: "embedded",
}

let listBeadsByStatus: ReturnType<typeof mock>

function installRpc() {
  listBeadsByStatus = mock((_dbPath?: string) =>
    Promise.resolve({ beads: [{ id: "alpha-1", title: "one", status: "open", priority: 2 }] }),
  )
  const neutral = () => Promise.resolve(undefined)
  _setRpc({
    health: {
      runStartupHealth: mock(() =>
        Promise.resolve({
          platform: "darwin",
          hasWorkspaces: true,
          workspaces: [alpha],
          activeWorkspaceId: alpha.id,
          healthCheck: { ok: true as const },
          bdVersion: "1.2.2",
          bdPath: "/opt/homebrew/bin/bd",
        }),
      ),
    },
    activity: {
      listBeadsByStatus,
      getActivityEvents: mock(() => Promise.resolve({ events: [], error: undefined })),
      getActivityEventsSince: mock(() => Promise.resolve({ events: [], error: undefined })),
    },
    beads: {
      getAvailableStatuses: mock(() => Promise.resolve(["open", "in_progress", "closed"])),
      getCustomStatusList: mock(() => Promise.resolve([])),
      checkBeadExists: mock(() => Promise.resolve(false)),
    },
    workspaces: {
      getWorkspaces: mock(() => Promise.resolve([alpha])),
      setActiveWorkspaceAction: mock(neutral),
    },
    console: { run: mock(neutral) },
  } as unknown as RemoteApi)
}

function mountActivity() {
  const rootRoute = createRootRoute({
    component: () => (
      <StartupGate>
        <Outlet />
      </StartupGate>
    ),
  })
  const routeTree = rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: "/", component: () => null }),
    createRoute({ getParentRoute: () => rootRoute, path: "/activity", component: ActivityPage }),
    createRoute({ getParentRoute: () => rootRoute, path: "/workspaces", component: () => null }),
  ])
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/activity"] }),
  })
  // The page's Header asks TanStack Query about .beadtrain plans.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  installRpc()
  setWorkspaceCookie(alpha.id)
  _resetSubscriptionChangeCount()
  _resetWorkspaceSessions()
})

afterEach(() => {
  cleanup()
  _resetRpc()
  clearWorkspaceCookie()
  _resetWorkspaceSessions()
  _resetSubscriptionChangeCount()
})

describe("pipeline session cache vs bd change signal", () => {
  test("a bd change signal refetches the pipeline even inside the 30 s TTL", async () => {
    mountActivity()
    await waitFor(() => expect(listBeadsByStatus).toHaveBeenCalledTimes(1))

    // A CLI edit lands: the sidecar's subscription emits `change`. The
    // snapshot is seconds old, well inside the TTL.
    act(() => _emitChangeForTests())

    await waitFor(() => expect(listBeadsByStatus).toHaveBeenCalledTimes(2))
  })

  test("a signal-less re-mount inside the TTL is served from cache", async () => {
    const first = mountActivity()
    await waitFor(() => expect(listBeadsByStatus).toHaveBeenCalledTimes(1))
    cleanup()
    void first

    // Navigate away and back with no change signal in between: no second
    // `bd list` — the whole point of the TTL.
    mountActivity()
    await new Promise((r) => setTimeout(r, 50))
    expect(listBeadsByStatus).toHaveBeenCalledTimes(1)
  })
})
