import { test, expect, bd, bdCreate } from "./fixtures/test-setup"
import { injectTauriMock } from "./fixtures/tauri-mock"
import { snapshotElement } from "./helpers/visual"
import type { Page } from "@playwright/test"

// Shared helper: set workspace cookie and navigate to main page.
async function setupPage(page: Page, workspaceId: string) {
  await page.context().addCookies([{
    name: "beads-workspace",
    value: workspaceId,
    domain: "localhost",
    path: "/",
  }])

  await page.goto("/")
  await expect(page.locator("header")).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText("Epics")).toBeVisible({ timeout: 10_000 })
}

// Expand an epic by clicking its chevron button
async function expandEpic(page: Page, epicName: string) {
  const epicRow = page.locator("[data-item-id]").filter({ hasText: epicName }).first()
  await epicRow.locator("button[type='button']").first().click()
  await expect(page.locator(".bead-row").first()).toBeVisible({ timeout: 10_000 })
}

test.describe("Epic tree interactions", () => {
  test.beforeEach(async ({ page }) => {
    await injectTauriMock(page)
  })

  // --- Epic tree renders with parent/child hierarchy ---
  test("epic tree renders with hierarchy", async ({ page, testDb }) => {
    await setupPage(page, testDb.workspaceId)

    // EPICS section header should be visible with count
    await expect(page.getByText("Epics")).toBeVisible()

    // The test epic should be visible as a tree row
    await expect(page.getByText("E2E Test Epic")).toBeVisible()

    // Children should NOT be visible before expanding
    await expect(page.getByText("High Priority Task")).not.toBeVisible()

    // Expand the epic
    await expandEpic(page, "E2E Test Epic")

    // All four children should now be visible
    await expect(page.getByText("High Priority Task")).toBeVisible()
    await expect(page.getByText("In Progress Task")).toBeVisible()
    await expect(page.getByText("Critical Bug")).toBeVisible()
    await expect(page.getByText("Completed Task")).toBeVisible()
  })

  // --- Expand/collapse toggle works ---
  test("expand and collapse epic toggles children visibility", async ({ page, testDb }) => {
    await setupPage(page, testDb.workspaceId)

    // Expand the epic
    await expandEpic(page, "E2E Test Epic")
    await expect(page.getByText("High Priority Task")).toBeVisible()

    // Collapse by clicking chevron again
    const epicRow = page.locator("[data-item-id]").filter({ hasText: "E2E Test Epic" }).first()
    await epicRow.locator("button[type='button']").first().click()

    // Children should be hidden
    await expect(page.getByText("High Priority Task")).not.toBeVisible({ timeout: 5_000 })
    await expect(page.getByText("Critical Bug")).not.toBeVisible()
  })

  // --- Progress bar reflects child bead status ---
  test("progress bar shows correct counts", async ({ page, testDb }) => {
    await setupPage(page, testDb.workspaceId)

    // The epic has 4 children, 1 closed. Progress should show "1/4 (25%)"
    const epicRow = page.locator("[data-item-id]").filter({ hasText: "E2E Test Epic" }).first()
    await expect(epicRow.getByText("1/4")).toBeVisible()
    await expect(epicRow.getByText("25%")).toBeVisible()
  })

  // --- Clicking a child bead opens the detail panel ---
  test("clicking a bead opens detail panel", async ({ page, testDb }) => {
    await setupPage(page, testDb.workspaceId)
    await expandEpic(page, "E2E Test Epic")

    // The detail panel placeholder should show before clicking
    await expect(page.getByText("Select a bead to view details")).toBeVisible()

    // Click on "High Priority Task" text (the bead row, not the chevron)
    await page.getByText("High Priority Task").click()

    // The detail panel should open showing the bead's DESCRIPTION heading
    await expect(page.getByRole("heading", { name: "Description" })).toBeVisible({ timeout: 10_000 })

    // The placeholder should be gone
    await expect(page.getByText("Select a bead to view details")).not.toBeVisible()
  })

  // --- Empty epic displays correctly ---
  test("empty epic shows zero progress and delete button", async ({ page, testDb }) => {
    // Create an empty epic via CLI and capture its ID
    const emptyEpicId = bdCreate(testDb.dbPath, [
      "--title", "Empty Test Epic", "--type", "epic", "--priority", "2",
    ])

    // Reload the page to pick up the new epic
    await setupPage(page, testDb.workspaceId)

    // Locate the epic row by its data-item-id attribute (title text may be truncated
    // due to long test bead IDs consuming the available width)
    const epicRow = page.locator(`[data-item-id="${emptyEpicId}"]`)
    await expect(epicRow).toBeVisible({ timeout: 10_000 })

    // Progress should show 0/0
    await expect(epicRow.getByText("0/0")).toBeVisible()
    await expect(epicRow.getByText("0%")).toBeVisible()

    // Empty epics show a delete button (the hover:bg-red-500 styled button with Trash2 icon)
    await expect(epicRow.locator(".hover\\:bg-red-500\\/20")).toBeVisible()
  })

  // --- Visual regression: expanded epic tree (bb-8xey) ---
  // Targets just the tree container so detail-panel content (which can vary
  // based on selection state) doesn't flap the snapshot.
  test("epic tree visual baseline (expanded)", async ({ page, testDb }) => {
    await setupPage(page, testDb.workspaceId)
    await expandEpic(page, "E2E Test Epic")
    await page.evaluate(() => document.fonts.ready)
    await snapshotElement(page.locator("main"), "epic-tree-expanded.png")
  })
})
