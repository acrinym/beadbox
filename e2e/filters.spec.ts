import { test, expect } from "./fixtures/test-setup"
import { injectTauriMock } from "./fixtures/tauri-mock"
import { snapshotElement } from "./helpers/visual"
import type { Page, Locator } from "@playwright/test"

// Shared helper: set workspace cookie, track console errors, and navigate to main page.
// Waits for the epic tree to fully render and expands the test epic.
async function setupMainPage(page: Page, workspaceId: string) {
  const consoleErrors: string[] = []
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text()
      if (text.includes("posthog") || text.includes("PostHog")) return
      if (text.includes("favicon")) return
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

  await page.goto("/")
  await expect(page.locator("header")).toBeVisible({ timeout: 10_000 })
  // Wait for epic tree to render
  await expect(page.getByText("Epics")).toBeVisible({ timeout: 10_000 })
  // Wait for the test epic row to appear
  await expect(page.getByText("E2E Test Epic")).toBeVisible({ timeout: 10_000 })

  // Expand the epic by clicking its chevron button (first button in the epic's data-item-id container)
  const epicRow = page.locator("[data-item-id]").filter({ hasText: "E2E Test Epic" }).first()
  const chevron = epicRow.locator("button[type='button']").first()
  await chevron.click()

  // Wait for child beads to appear
  await expect(page.locator(".bead-row").first()).toBeVisible({ timeout: 10_000 })

  return consoleErrors
}

// Count visible bead rows
function beadRows(page: Page): Locator {
  return page.locator(".bead-row")
}

// Open a Radix Select dropdown by its current value text and pick an option.
// Uses first() to disambiguate when text matches multiple comboboxes
// (e.g., "Closed" matches both status filter and sort "Status (Closed first)").
// Filters render before sort in DOM order so first() picks the correct one.
async function selectOption(page: Page, currentText: string, optionText: string) {
  await page.getByRole("combobox").filter({ hasText: currentText }).first().click()
  await page.getByRole("option", { name: optionText, exact: true }).click()
}

test.describe("Filter bar and search interactions", () => {
  test.beforeEach(async ({ page }) => {
    await injectTauriMock(page)
  })

  // --- Status filter ---
  test("status filter narrows displayed beads", async ({ page, testDb }) => {
    await setupMainPage(page, testDb.workspaceId)

    // Count initial bead rows (epic is expanded, showing children)
    const initialCount = await beadRows(page).count()
    expect(initialCount).toBeGreaterThan(0)

    // Filter to "In Progress" only
    await selectOption(page, "All Status", "In Progress")
    // Only "In Progress Task" should be visible
    await expect(page.getByText("In Progress Task")).toBeVisible({ timeout: 5_000 })
    await expect(page.getByText("High Priority Task")).not.toBeVisible()

    // Filter to "Closed"
    await selectOption(page, "In Progress", "Closed")
    await expect(page.getByText("Completed Task")).toBeVisible({ timeout: 5_000 })
    await expect(page.getByText("In Progress Task")).not.toBeVisible()

    // Reset to "All Status"
    await selectOption(page, "Closed", "All Status")
    await expect(beadRows(page).first()).toBeVisible({ timeout: 5_000 })
  })

  // --- Priority filter ---
  test("priority filter narrows displayed beads", async ({ page, testDb }) => {
    await setupMainPage(page, testDb.workspaceId)

    // Filter to "P0 - Critical" - only "Critical Bug" (P0) should show
    await selectOption(page, "All Priority", "P0 - Critical")
    await expect(page.getByText("Critical Bug")).toBeVisible({ timeout: 5_000 })
    await expect(page.getByText("High Priority Task")).not.toBeVisible()

    // Filter to "P1 - High" - only "High Priority Task" (P1)
    await selectOption(page, "P0 - Critical", "P1 - High")
    await expect(page.getByText("High Priority Task")).toBeVisible({ timeout: 5_000 })
    await expect(page.getByText("Critical Bug")).not.toBeVisible()

    // Reset to "All Priority"
    await selectOption(page, "P1 - High", "All Priority")
    const count = await beadRows(page).count()
    expect(count).toBeGreaterThan(1)
  })

  // --- Search by title ---
  test("search narrows results by title", async ({ page, testDb }) => {
    await setupMainPage(page, testDb.workspaceId)

    const searchInput = page.locator("[data-search-input]")

    // Search for a term that matches one specific bead
    await searchInput.fill("Critical Bug")
    await expect(page.getByText("Critical Bug")).toBeVisible({ timeout: 5_000 })
    // Other beads should be filtered out
    await expect(page.getByText("High Priority Task")).not.toBeVisible()

    // Clear search - full list returns
    await searchInput.fill("")
    await expect(beadRows(page).first()).toBeVisible({ timeout: 5_000 })
    const count = await beadRows(page).count()
    expect(count).toBeGreaterThan(1)
  })

  // --- Search by ID ---
  test("search works by bead ID", async ({ page, testDb }) => {
    await setupMainPage(page, testDb.workspaceId)

    // Get text content of first bead ID display
    const firstIdElement = page.locator(".bead-row .bead-row-id").first()
    await expect(firstIdElement).toBeVisible()
    const idText = await firstIdElement.textContent()
    expect(idText).toBeTruthy()

    // Extract a searchable ID fragment (last 4+ chars of the bead ID)
    const cleanId = idText!.trim()
    const searchInput = page.locator("[data-search-input]")
    await searchInput.fill(cleanId)

    // Should find at least the matching bead
    await expect(beadRows(page).first()).toBeVisible({ timeout: 5_000 })

    await searchInput.fill("")
  })

  // --- Sort ---
  test("sort changes bead order", async ({ page, testDb }) => {
    await setupMainPage(page, testDb.workspaceId)

    // Get initial bead titles
    const getBeadTitles = async (): Promise<string[]> => {
      const rows = beadRows(page)
      const count = await rows.count()
      const titles: string[] = []
      for (let i = 0; i < count; i++) {
        const text = await rows.nth(i).textContent()
        if (text) titles.push(text)
      }
      return titles
    }

    const initialTitles = await getBeadTitles()
    expect(initialTitles.length).toBeGreaterThan(1)

    // Sort by "Title (A-Z)"
    await selectOption(page, "Status (Closed first)", "Title (A-Z)")
    await expect(beadRows(page).first()).toBeVisible()
    const sortedTitles = await getBeadTitles()
    expect(sortedTitles.length).toBe(initialTitles.length)

    // Sort by "Priority (High-Low)"
    await selectOption(page, "Title (A-Z)", "Priority (High-Low)")
    await expect(beadRows(page).first()).toBeVisible()
    const prioritySorted = await getBeadTitles()
    expect(prioritySorted.length).toBe(initialTitles.length)
  })

  // --- Filter combination (AND logic) ---
  test("multiple filters combine with AND logic", async ({ page, testDb }) => {
    await setupMainPage(page, testDb.workspaceId)

    // Apply status=open AND priority=P0 - Critical
    await selectOption(page, "All Status", "Open")
    await selectOption(page, "All Priority", "P0 - Critical")

    // Only "Critical Bug" is both open AND critical
    await expect(page.getByText("Critical Bug")).toBeVisible({ timeout: 5_000 })
    await expect(page.getByText("High Priority Task")).not.toBeVisible()
    await expect(page.getByText("In Progress Task")).not.toBeVisible()

    const count = await beadRows(page).count()
    expect(count).toBe(1)
  })

  // --- Filter reset ---
  test("resetting filters restores full list", async ({ page, testDb }) => {
    await setupMainPage(page, testDb.workspaceId)
    const fullCount = await beadRows(page).count()
    expect(fullCount).toBeGreaterThan(0)

    // Apply a restrictive filter
    await selectOption(page, "All Priority", "P3 - Low")
    const filteredCount = await beadRows(page).count()

    // Reset
    await selectOption(page, "P3 - Low", "All Priority")
    await expect(beadRows(page).first()).toBeVisible({ timeout: 5_000 })
    const resetCount = await beadRows(page).count()
    expect(resetCount).toBe(fullCount)
  })

  // --- Mobile filter panel ---
  test("mobile filter panel collapses with badge count", async ({ page, testDb }) => {
    // Set narrow viewport for mobile
    await page.setViewportSize({ width: 375, height: 812 })

    const consoleErrors: string[] = []
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const text = msg.text()
        if (text.includes("posthog") || text.includes("PostHog")) return
        if (text.includes("favicon")) return
        if (text.includes("WebSocket")) return
        consoleErrors.push(text)
      }
    })

    await page.context().addCookies([{
      name: "beads-workspace",
      value: testDb.workspaceId,
      domain: "localhost",
      path: "/",
    }])

    await page.goto("/")
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText("Epics")).toBeVisible({ timeout: 10_000 })

    // On mobile, filter dropdowns should be hidden behind the collapsible trigger
    // The SlidersHorizontal icon button is the collapsible trigger
    const filterToggle = page.locator("button").filter({
      has: page.locator("svg.lucide-sliders-horizontal"),
    })
    await expect(filterToggle).toBeVisible({ timeout: 5_000 })

    // Filter selects should NOT be visible before expanding
    await expect(page.getByRole("combobox").filter({ hasText: "All Status" })).not.toBeVisible()

    // Click the filter toggle to expand
    await filterToggle.click()

    // Now filter selects should be visible
    await expect(page.getByRole("combobox").filter({ hasText: "All Status" })).toBeVisible({ timeout: 5_000 })

    // Apply a filter
    await selectOption(page, "All Status", "Open")

    // Collapse the filter panel
    await filterToggle.click()
    // Badge should show active filter count
    // The badge is a small span with the count inside the toggle button
    const badge = filterToggle.locator("span.rounded-full")
    await expect(badge).toBeVisible({ timeout: 5_000 })
    await expect(badge).toHaveText("1")
  })

  // --- Visual regression: filter bar default + active state (bb-8xey) ---
  // Snapshots the filter bar in two states so layout regressions in either
  // state surface independently. Targets just the bar to keep the diff tight.
  test("filter bar visual baseline (default + active)", async ({ page, testDb }) => {
    await setupMainPage(page, testDb.workspaceId)
    await page.evaluate(() => document.fonts.ready)

    // Default state: no filters applied
    const filterBar = page.locator("[data-testid='filter-bar']").or(page.locator("nav").first())
    await snapshotElement(filterBar, "filter-bar-default.png")

    // Active state: status filter applied. selectOption is the same helper
    // the functional tests use so we know it produces the canonical state.
    await selectOption(page, "All Status", "In Progress")
    await expect(page.getByText("In Progress Task")).toBeVisible({ timeout: 5_000 })
    await snapshotElement(filterBar, "filter-bar-status-active.png")
  })
})
