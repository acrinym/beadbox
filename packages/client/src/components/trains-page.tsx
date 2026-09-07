import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Loader2, TrainFront } from "lucide-react"
import { useMemo, useState } from "react"
import { useAppHealth } from "../hooks/use-app-health"
import { usePreferences } from "../hooks/use-preferences"
import { useUpdateChecker } from "../hooks/use-update-checker"
import { setSelectedBead as persistSelectedBead } from "../lib/local-storage"
import { rpc } from "../lib/rpc"
import { useSubscriptionChangeSignal } from "../lib/subscribe"
import type { Workspace } from "../lib/types"
import { getWorkspaceCookie } from "../lib/workspace-cookie"
import { Header } from "./header"
import { SettingsDialog } from "./settings-dialog"
import { useWorkspaceGate } from "./startup-gate"
import { UpdateDialog } from "./update-dialog"

function unwrap<T>(result: { success: true; data: T } | { success: false; error: string }): T {
  if (!result.success) throw new Error(result.error)
  return result.data
}

export function TrainsPage() {
  const { workspaces } = useWorkspaceGate()
  const navigate = useNavigate()
  const { health: appHealth } = useAppHealth()
  const prefs = usePreferences()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const changeSignal = useSubscriptionChangeSignal()
  const {
    updateAvailable,
    checking: updateChecking,
    checkNow: checkForUpdates,
    checkError: updateCheckError,
    dismissUpdate,
  } = useUpdateChecker({
    enabled: prefs.updateCheckEnabled,
    frequency: prefs.updateCheckFrequency,
  })

  const currentWorkspace: Workspace | null = useMemo(() => {
    const cookie = getWorkspaceCookie()
    return workspaces.find((ws) => ws.id === cookie) ?? workspaces[0] ?? null
  }, [workspaces])

  const dbPath = currentWorkspace?.databasePath

  const trainsQuery = useQuery({
    queryKey: ["trains", dbPath, changeSignal],
    queryFn: async () => unwrap(await rpc.trains.loadTrains(dbPath)),
    enabled: Boolean(dbPath),
  })
  const readyQuery = useQuery({
    queryKey: ["trains-ready", dbPath, changeSignal],
    queryFn: async () => unwrap(await rpc.trains.loadReady(dbPath)),
    enabled: Boolean(dbPath),
  })
  const couplerQuery = useQuery({
    queryKey: ["trains-couplers", dbPath, changeSignal],
    queryFn: async () => unwrap(await rpc.trains.loadCouplers(dbPath)),
    enabled: Boolean(dbPath),
  })

  const trains = trainsQuery.data ?? []
  const ready = readyQuery.data ?? []
  const couplers = couplerQuery.data ?? []
  const selected = trains.find((train) => train.name === selectedName) ?? trains[0] ?? null
  const readyForSelected = ready.filter((row) => row.train === selected?.name)

  return (
    <div className="h-full flex flex-col bg-background safe-area-inset">
      <Header
        currentWorkspace={
          currentWorkspace || { id: "", name: "Loading...", mode: "embedded" as const }
        }
        isRefreshing={trainsQuery.isFetching}
        isPending={trainsQuery.isLoading}
        appHealth={appHealth}
        onRefresh={() => {
          void trainsQuery.refetch()
          void readyQuery.refetch()
          void couplerQuery.refetch()
        }}
        updateAvailable={updateAvailable}
        onUpdateClick={() => setUpdateDialogOpen(true)}
        onSettingsOpen={() => setSettingsOpen(true)}
      />

      <main className="flex-1 overflow-y-auto mx-auto w-full max-w-6xl px-6 py-6 space-y-6">
        <div className="flex items-center gap-2">
          <TrainFront className="h-5 w-5" />
          <h1 className="text-lg font-semibold">Trains</h1>
          <span className="text-sm text-muted-foreground">
            .beadtrain plans beside this workspace. Tickets stay in bd.
          </span>
        </div>

        {trainsQuery.isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading trains
          </div>
        ) : trains.length === 0 ? (
          <p className="text-muted-foreground">
            No .beadtrain files in this workspace .beads folder.
          </p>
        ) : (
          <div className="grid gap-6 md:grid-cols-[minmax(16rem,22rem)_1fr]">
            <section className="space-y-2">
              {trains.map((train) => {
                const readyCount = ready.filter((row) => row.train === train.name && row.ready)
                  .length
                const active = selected?.name === train.name
                return (
                  <button
                    key={train.name}
                    type="button"
                    onClick={() => setSelectedName(train.name)}
                    className={`w-full text-left rounded-md border px-3 py-2 ${
                      active ? "border-primary bg-accent" : "border-border hover:bg-accent/50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate">{train.name}</span>
                      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {train.status}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {train.cars.length} cars
                      {readyCount > 0 ? ` · ${readyCount} ready` : ""}
                    </div>
                  </button>
                )
              })}
            </section>

            {selected ? (
              <section className="space-y-4">
                <div>
                  <h2 className="text-base font-semibold">{selected.title || selected.name}</h2>
                  {selected.oneLiner ? (
                    <p className="text-sm text-muted-foreground">{selected.oneLiner}</p>
                  ) : null}
                </div>
                <ul className="space-y-2">
                  {selected.cars.map((car) => {
                    const view = readyForSelected.find((row) => row.carId === car.id)
                    return (
                      <li key={car.id} className="rounded-md border border-border px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            className="font-mono text-sm hover:underline"
                            onClick={() => {
                              persistSelectedBead(car.bead)
                              void navigate({ to: "/" })
                            }}
                          >
                            {car.id} · {car.bead}
                          </button>
                          <span className="text-[11px] uppercase">
                            {view?.ready ? "ready" : (view?.beadStatus ?? "wait")}
                          </span>
                        </div>
                        <p className="text-sm">{car.title}</p>
                        {view ? (
                          <p className="text-xs text-muted-foreground">{view.reason}</p>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
                {couplers.some(
                  (row) => row.fromTrain === selected.name || row.toTrain === selected.name,
                ) ? (
                  <div>
                    <h3 className="text-sm font-medium mb-2">Couplers</h3>
                    <ul className="space-y-1 text-sm font-mono">
                      {couplers
                        .filter(
                          (row) =>
                            row.fromTrain === selected.name || row.toTrain === selected.name,
                        )
                        .map((row) => (
                          <li key={row.id}>
                            {row.fromTrain}/{row.fromCar} -{row.mode}-&gt; {row.toTrain}/
                            {row.toCar}
                          </li>
                        ))}
                    </ul>
                  </div>
                ) : null}
              </section>
            ) : null}
          </div>
        )}
      </main>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        theme={prefs.theme}
        onThemeChange={prefs.handleThemeChange}
        zoomLevel={prefs.zoomLevel}
        onZoomChange={prefs.handleZoomChange}
        databasePath={dbPath}
        vimNavigationEnabled={prefs.vimEnabled}
        onVimNavigationChange={prefs.handleVimNavigationChange}
        updateCheckEnabled={prefs.updateCheckEnabled}
        onUpdateCheckEnabledChange={prefs.handleUpdateCheckEnabledChange}
        updateCheckFrequency={prefs.updateCheckFrequency}
        onUpdateCheckFrequencyChange={prefs.handleUpdateCheckFrequencyChange}
        updateAvailable={updateAvailable}
        updateChecking={updateChecking}
        updateCheckError={updateCheckError}
        onCheckForUpdates={checkForUpdates}
        onOpenUpdateDialog={() => setUpdateDialogOpen(true)}
      />

      {updateAvailable ? (
        <UpdateDialog
          open={updateDialogOpen}
          onOpenChange={setUpdateDialogOpen}
          updateInfo={updateAvailable}
          onDismiss={dismissUpdate}
          currentVersion={import.meta.env.VITE_APP_VERSION || "0.0.0"}
        />
      ) : null}
    </div>
  )
}
