import { test, expect } from "./fixtures/test-setup"
import { injectTauriMock } from "./fixtures/tauri-mock"
import { snapshotPage } from "./helpers/visual"

// Shared helper: set workspace cookie and track console errors
async function setupPage(page: import("@playwright/test").Page, workspaceId: string) {
  const consoleErrors: string[] = []
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text()
      // Ignore known noisy errors that don't affect functionality
      if (text.includes("posthog") || text.includes("PostHog")) return
      if (text.includes("favicon")) return
      // WebSocket connection errors are expected during test startup.
      if (text.includes("WebSocket connection")) return
      if (text.includes("WebSocket")) return
      consoleErrors.push(text)
    }
  })

  await page.context().addCookies([{
    name: "beads-workspace",
    value: workspaceId,
    domain: "localhost",
    path: "/",
  }])

  return consoleErrors
}

// Filter out expected noise from console errors
function filterRealErrors(errors: string[]): string[] {
  return errors.filter(
    (e) =>
      !e.includes("hydration") &&
      !e.includes("Warning:") &&
      // Fetch aborts happen when navigating away while a server action is in-flight
      !e.includes("Failed to fetch") &&
      // Resource load failures (e.g., analytics endpoints returning 403 in test)
      !e.includes("Failed to load resource")
  )
}

test.describe("Core navigation and page load", () => {
  test.beforeEach(async ({ page }) => {
    await injectTauriMock(page)
  })

  // --- Spec item 1: Main page loads and renders ---
  test("main page loads and renders epic tree", async ({ page, testDb }) => {
    const consoleErrors = await setupPage(page, testDb.workspaceId)
    await page.goto("/")

    // Wait for StartupGate to pass and render the header
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 })
    await expect(page).toHaveTitle(/Beadbox/)

    // Main content area present
    const main = page.locator("main")
    await expect(main).toBeVisible()

    // Seeded data should render the EPICS section
    await expect(page.getByText("Epics")).toBeVisible({ timeout: 10_000 })

    // No unexpected console errors
    expect(filterRealErrors(consoleErrors)).toEqual([])
  })

  // --- Spec item 2: Activity page loads ---
  test("activity page loads and renders", async ({ page, testDb }) => {
    const consoleErrors = await setupPage(page, testDb.workspaceId)
    await page.goto("/activity")

    // Header should render (StartupGate passed)
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 })

    // Main content area present
    await expect(page.locator("main")).toBeVisible()

    // No unexpected console errors
    expect(filterRealErrors(consoleErrors)).toEqual([])
  })

  // --- Spec item 3: Workspaces page loads ---
  test("workspaces page loads and renders", async ({ page, testDb }) => {
    const consoleErrors = await setupPage(page, testDb.workspaceId)
    await page.goto("/workspaces")

    // Workspaces page has its own layout (no StartupGate header).
    // Shows "Welcome to Beadbox" when empty, or "Select a workspace" when
    // other workers have registered workspaces in the shared test registry.
    await expect(
      page.getByText("Welcome to Beadbox").or(page.getByText("Select a workspace"))
    ).toBeVisible({ timeout: 10_000 })

    // No unexpected console errors
    expect(filterRealErrors(consoleErrors)).toEqual([])
  })

  // --- Spec item 4: Health endpoint ---
  test("health endpoint returns bd availability info", async ({ page, testDb }) => {
    await setupPage(page, testDb.workspaceId)

    const response = await page.request.get(
      `/api/health?savedId=${testDb.workspaceId}`
    )
    expect(response.ok()).toBe(true)

    const body = await response.json()
    expect(body.bdAvailable).toBe(true)
    expect(body).toHaveProperty("bdVersion")
    expect(body).toHaveProperty("bdPath")
    expect(body).toHaveProperty("hasWorkspaces")
    expect(body).toHaveProperty("workspaces")
  })

  // --- Spec item 5: Version endpoint ---
  test("version endpoint returns version and build info", async ({ page }) => {
    const response = await page.request.get("/api/version")
    expect(response.ok()).toBe(true)

    const body = await response.json()
    expect(body).toHaveProperty("version")
    expect(body).toHaveProperty("commit")
    expect(body).toHaveProperty("branch")
    expect(body).toHaveProperty("dev")
    expect(body).toHaveProperty("arch")
    // Standalone server runs with NODE_ENV=production
    expect(body.dev).toBe(false)
  })

  // --- Spec item 6: Navigation between pages via header links ---
  test("navigation between pages works via header links", async ({ page, testDb }) => {
    const consoleErrors = await setupPage(page, testDb.workspaceId)
    await page.goto("/")

    // Wait for header to render
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 })

    // Click "Activity" nav link in header.
    // After bb-4gdo.1, StartupGate is at layout level and persists across
    // route changes. Nav buttons are always rendered when gate is healthy.
    const activityBtn = page.getByRole("button", { name: "Activity" })
    await expect(activityBtn).toBeVisible({ timeout: 15_000 })
    await activityBtn.click()
    await expect(page).toHaveURL(/\/activity/, { timeout: 15_000 })
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 })
    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 })

    // Click "Beads" nav link to go back to main page.
    const beadsBtn = page.getByRole("button", { name: "Beads", exact: true })
    await expect(beadsBtn).toBeVisible({ timeout: 15_000 })
    await beadsBtn.click()
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 })
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 })

    // No unexpected console errors during navigation
    expect(filterRealErrors(consoleErrors)).toEqual([])
  })

  // --- Spec item 7: No console errors on page load ---
  test("pages load with no console errors", async ({ page, testDb }) => {
    const consoleErrors = await setupPage(page, testDb.workspaceId)

    // Load main page
    await page.goto("/")
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 })

    // Navigate to activity
    await page.goto("/activity")
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 })

    // Navigate to workspaces
    await page.goto("/workspaces")
    await expect(
      page.getByText("Welcome to Beadbox").or(page.getByText("Select a workspace"))
    ).toBeVisible({ timeout: 10_000 })

    // All page loads should be error-free
    expect(filterRealErrors(consoleErrors)).toEqual([])
  })

  // --- Spec item 8: StartupGate renders correctly when bd is available ---
  test("startup gate passes and renders app when bd is available", async ({ page, testDb }) => {
    const consoleErrors = await setupPage(page, testDb.workspaceId)
    await page.goto("/")

    // StartupGate should NOT show the "bd missing" screen
    await expect(
      page.getByText("Welcome to Beadbox")
    ).not.toBeVisible({ timeout: 5_000 })

    // Instead, the main app should render with header and workspace switcher
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 })

    // The "Beadbox" brand name appears in header
    await expect(page.getByText("Beadbox").first()).toBeVisible()

    // The "Beta" badge is visible (use first() to avoid matching stale workspace tabs)
    await expect(page.getByText("Beta").first()).toBeVisible()

    // No console errors
    expect(filterRealErrors(consoleErrors)).toEqual([])
  })

  // --- Visual regression: full main page baseline (bb-8xey) ---
  // Catches CSS / layout drift across the whole app shell. See
  // helpers/visual.ts for the snapshot pattern and re-baseline workflow.
  test("main page visual baseline", async ({ page, testDb }) => {
    await setupPage(page, testDb.workspaceId)
    await page.goto("/")
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText("Epics")).toBeVisible({ timeout: 10_000 })
    // Settle the layout: wait for one frame after fonts + initial WS load.
    await page.evaluate(() => document.fonts.ready)
    await snapshotPage(page, "main-page.png")
  })
})
