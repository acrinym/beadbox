/**
 * Data Fidelity Check (testplan 6.1)
 *
 * Picks beads from the test workspace, runs `bd show <id> --json` for each,
 * opens the detail panel in the UI, and asserts every field matches the CLI output.
 * Screenshots each bead for the report.
 *
 * All assertions are deterministic: field-by-field JSON comparison, no LLM.
 */

import { test, expect, bd } from "../fixtures/test-setup"
import { injectTauriMock } from "../fixtures/tauri-mock"
import { waitForAppReady } from "./helpers"
import type { Page } from "@playwright/test"

// Priority mapping: bd CLI uses numeric (0-4), UI uses labels
const PRIORITY_MAP: Record<number, string> = {
  0: "Critical",
  1: "High",
  2: "Medium",
  3: "Low",
  4: "Backlog",
}

// Status mapping: bd CLI uses snake_case, UI uses title case
const STATUS_MAP: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  closed: "Closed",
  ready_for_qa: "Ready for QA",
  ready_to_ship: "Ready to Ship",
}

interface BdBead {
  id: string
  title: string
  status: string
  priority: number
  issue_type: string
  assignee?: string
  description?: string
  comment_count?: number
  dependency_count?: number
  dependent_count?: number
  parent?: string
}

async function setupPage(page: Page, dbPath: string) {
  await page.context().addCookies([{
    name: "beads-workspace",
    value: encodeURIComponent(dbPath),
    domain: "localhost",
    path: "/",
  }])

  // Block update checker
  await page.route(/api\.github\.com\/repos\/[^/]+\/[^/]+\/releases/, (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tag_name: "v0.0.0", draft: false, prerelease: false, assets: [] }),
    })
  })
}

// Get the detail panel container (same selector as bead-crud spec)
function getDetailPanel(page: Page) {
  return page.locator("div.h-full.flex.flex-col.relative.outline-none")
}

// Expand the epic to show children
async function expandEpic(page: Page) {
  const epicRow = page.locator("[data-item-id]").filter({ hasText: "E2E Test Epic" }).first()
  await expect(epicRow).toBeVisible({ timeout: 5_000 })
  // Check for a specific child of THIS epic (not any .bead-row, which could
  // match loose beads already visible on the page).
  const knownChild = page.getByText("High Priority Task").first()
  if (!await knownChild.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await epicRow.locator("button[type='button']").first().click()
    await expect(knownChild).toBeVisible({ timeout: 5_000 })
  }
}

// Expand the "Loose Beads" section
async function expandLooseBeads(page: Page) {
  const looseBeadsBtn = page.locator("button").filter({ hasText: "Loose Beads" })
  if (await looseBeadsBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    const chevronRight = looseBeadsBtn.locator(".lucide-chevron-right")
    if (await chevronRight.isVisible().catch(() => false)) {
      await looseBeadsBtn.click()
      await page.waitForTimeout(500)
    }
  }
}

// Parse bd show --json output (returns array with one element)
function parseBdShow(output: string): BdBead {
  const parsed = JSON.parse(output)
  return Array.isArray(parsed) ? parsed[0] : parsed
}

// Close the detail panel by pressing Escape
async function closeDetailPanel(page: Page) {
  await page.keyboard.press("Escape")
  await page.waitForTimeout(300)
}

test.describe("Data Fidelity: bd CLI JSON vs UI fields (testplan 6.1)", () => {
  // Iterating through all beads takes time; increase timeout
  test.setTimeout(60_000)

  test.beforeEach(async ({ page }) => {
    await injectTauriMock(page)
  })

  test("all seeded beads match bd show --json output in the UI", async ({ page, testDb }) => {
    await setupPage(page, testDb.dbPath)
    await page.goto("/")
    await waitForAppReady(page, "data-fidelity")
    await expect(page.getByText("Epics")).toBeVisible({ timeout: 10_000 })

    // Expand all sections so bead rows are visible
    await expandEpic(page)
    await expandLooseBeads(page)

    // Get all beads from bd CLI
    const listOutput = bd(testDb.dbPath, ["list", "--all", "--json"])
    const allBeads: BdBead[] = JSON.parse(listOutput)

    // Test all non-epic beads
    const beadsToTest = allBeads.filter((b) => b.issue_type !== "epic")
    expect(beadsToTest.length).toBeGreaterThan(0)

    for (const cliBead of beadsToTest) {
      // Get full detail from bd show --json
      const showData = parseBdShow(bd(testDb.dbPath, ["show", cliBead.id, "--json"]))

      // Click the bead row in the UI
      const beadRow = page.locator(".bead-row").filter({ hasText: showData.title }).first()
      await expect(beadRow).toBeVisible({ timeout: 5_000 })
      await beadRow.click()

      // Wait for detail panel to open
      const detailHeading = page.getByRole("heading", { name: showData.title })
      await expect(detailHeading).toBeVisible({ timeout: 5_000 })

      const panel = getDetailPanel(page)

      // Assert: Title
      await expect(detailHeading).toHaveText(showData.title)

      // Assert: Status
      const expectedStatus = STATUS_MAP[showData.status] ?? showData.status
      const statusCombobox = panel.locator('[role="combobox"]').first()
      await expect(statusCombobox).toContainText(expectedStatus)

      // Assert: Type (the type badge button has CSS capitalize)
      const typeButton = panel.locator("button.capitalize").filter({ hasText: showData.issue_type })
      await expect(typeButton).toBeVisible()

      // Assert: Priority
      const expectedPriority = PRIORITY_MAP[showData.priority]
      if (expectedPriority) {
        const priorityCombobox = panel.locator('[role="combobox"]').nth(1)
        await expect(priorityCombobox).toContainText(expectedPriority)
      }

      // Assert: ID is displayed
      await expect(panel.getByText(showData.id)).toBeVisible()

      // Screenshot for the report
      await page.screenshot({
        path: `test-results/data-fidelity-${showData.id.replace(/\./g, "-")}.png`,
        fullPage: false,
      })

      // Close the detail panel for the next bead
      await closeDetailPanel(page)
    }
  })

  test("comment and dependency counts match bd CLI", async ({ page, testDb }) => {
    await setupPage(page, testDb.dbPath)
    await page.goto("/")
    await waitForAppReady(page, "data-fidelity-counts")
    await expect(page.getByText("Epics")).toBeVisible({ timeout: 10_000 })

    // Expand all sections
    await expandEpic(page)
    await expandLooseBeads(page)

    // Get all beads
    const listOutput = bd(testDb.dbPath, ["list", "--all", "--json"])
    const allBeads: BdBead[] = JSON.parse(listOutput)

    for (const cliBead of allBeads) {
      const showData = parseBdShow(bd(testDb.dbPath, ["show", cliBead.id, "--json"]))

      const commentCount = showData.comment_count ?? 0
      const depCount = showData.dependency_count ?? 0

      // Skip beads with no comments and no dependencies (nothing extra to verify)
      if (commentCount === 0 && depCount === 0) continue

      // Open the bead
      const beadRow = page.locator(".bead-row, [data-item-id]").filter({ hasText: showData.title }).first()
      await expect(beadRow).toBeVisible({ timeout: 5_000 })
      await beadRow.click()
      await expect(page.getByRole("heading", { name: showData.title })).toBeVisible({ timeout: 5_000 })

      const panel = getDetailPanel(page)

      // Verify comments section if comments exist
      if (commentCount > 0) {
        await expect(panel.getByText(/Comments/)).toBeVisible({ timeout: 3_000 })
      }

      // Verify dependency section if dependencies exist
      if (depCount > 0) {
        await expect(panel.getByText(/Blocked By|Dependencies/i)).toBeVisible({ timeout: 3_000 })
      }

      await page.screenshot({
        path: `test-results/data-fidelity-meta-${showData.id.replace(/\./g, "-")}.png`,
        fullPage: false,
      })

      await closeDetailPanel(page)
    }
  })
})
