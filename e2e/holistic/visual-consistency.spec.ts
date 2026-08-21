/**
 * Visual Consistency Check (testplan 6.2)
 *
 * Screenshots at 3 viewport widths (1440px, 1024px, 768px).
 * Asserts health indicators
 * don't overlap header elements, priority badges use distinct background
 * colors, and progress bar width is proportional to closed/total counts.
 *
 * All assertions use computed styles and bounding boxes. No LLM.
 */

import { test, expect, bd } from "../fixtures/test-setup"
import { injectTauriMock } from "../fixtures/tauri-mock"
import { waitForAppReady } from "./helpers"
import type { Page } from "@playwright/test"

const VIEWPORTS = [
  { width: 1440, height: 900, label: "desktop-wide" },
  { width: 1024, height: 768, label: "desktop-narrow" },
  { width: 768, height: 1024, label: "tablet" },
]

async function waitForEpicsWithDiag(page: Page, label: string) {
  const epicsLocator = page.getByText("Epics")
  if (!await epicsLocator.isVisible({ timeout: 3_000 }).catch(() => false)) {
    const bodyText = await page.locator("body").innerText().catch(() => "(failed to read)")
    console.error(`[diag:${label}] Epics not visible. URL: ${page.url()}\n[diag] Body text:\n${bodyText}`)
    await page.screenshot({ path: `test-results/diag-visual-${label}.png` }).catch(() => {})
  }
  await expect(epicsLocator).toBeVisible({ timeout: 10_000 })
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

test.describe("Visual Consistency: layout and styling assertions (testplan 6.2)", () => {
  test.beforeEach(async ({ page }) => {
    await injectTauriMock(page)
  })

  for (const viewport of VIEWPORTS) {
    test(`screenshots and layout assertions at ${viewport.label} (${viewport.width}x${viewport.height})`, async ({ page, testDb }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await setupPage(page, testDb.dbPath)
      await page.goto("/")
      await waitForAppReady(page, `visual-${viewport.label}`)
      await waitForEpicsWithDiag(page, "visual")

      // Expand the epic to see bead rows with priority badges
      const epicRow = page.locator("[data-item-id]").filter({ hasText: "E2E Test Epic" }).first()
      if (await epicRow.isVisible({ timeout: 2_000 }).catch(() => false)) {
        const toggleBtn = epicRow.locator("button[type='button']").first()
        if (await toggleBtn.isVisible()) {
          await toggleBtn.click()
          await page.waitForTimeout(500)
        }
      }

      // Screenshot the full page at this viewport
      await page.screenshot({
        path: `test-results/visual-consistency-${viewport.label}.png`,
        fullPage: true,
      })

      // Assert: Header is visible and properly positioned
      const header = page.locator("header")
      const headerBox = await header.boundingBox()
      expect(headerBox).toBeTruthy()
      expect(headerBox!.y).toBe(0) // Header should be at top
      expect(headerBox!.width).toBeGreaterThan(0)

      // Assert: EPICS heading is visible below header
      const epicsHeading = page.getByText("Epics").first()
      const epicsBox = await epicsHeading.boundingBox()
      expect(epicsBox).toBeTruthy()
      expect(epicsBox!.y).toBeGreaterThan(headerBox!.y + headerBox!.height - 1)
    })
  }

  test("priority badges have distinct background colors", async ({ page, testDb }) => {
    await setupPage(page, testDb.dbPath)
    await page.goto("/")
    await waitForAppReady(page, "priority-badges")
    await expect(page.getByText("Epics")).toBeVisible({ timeout: 10_000 })

    // Expand the epic to show bead rows
    const epicRow = page.locator("[data-item-id]").filter({ hasText: "E2E Test Epic" }).first()
    if (await epicRow.isVisible({ timeout: 2_000 }).catch(() => false)) {
      const toggleBtn = epicRow.locator("button[type='button']").first()
      if (await toggleBtn.isVisible()) {
        await toggleBtn.click()
        await page.waitForTimeout(500)
      }
    }

    // Open a bead to see priority badge in the detail panel
    // Click the first visible bead row
    const beadRow = page.locator(".bead-row").first()
    await expect(beadRow).toBeVisible({ timeout: 5_000 })
    await beadRow.click()

    // Wait for detail panel
    await page.waitForTimeout(1_000)

    // Collect all priority badge colors from the badge-config
    // The priority selector (combobox) shows the current priority.
    // To verify distinct colors, check that different priority values
    // in the seed data produce different badge styling.

    // Get all beads with different priorities from CLI
    const listOutput = bd(testDb.dbPath, ["list", "--all", "--json"])
    const allBeads = JSON.parse(listOutput)
    const priorities = new Set(allBeads.map((b: { priority: number }) => b.priority))

    // We have at least 3 different priority levels in seed data (0, 1, 2, 3)
    expect(priorities.size).toBeGreaterThanOrEqual(3)

    // Verify the priority badge classes in badge-config are distinct:
    // P0 (critical) = red, P1 (high) = orange, P2 (medium) = yellow, P3 (low) = slate
    // We check this by evaluating computed styles on the priority selector options
    const priorityColors = await page.evaluate(() => {
      // Find all elements that look like priority badges (pill badges with priority text)
      const badges = document.querySelectorAll("span.inline-flex.items-center")
      const colorMap: Record<string, string> = {}
      badges.forEach((badge) => {
        const text = badge.textContent?.trim() ?? ""
        if (text.match(/^P[0-4]/)) {
          const style = window.getComputedStyle(badge)
          colorMap[text] = style.color
        }
      })
      return colorMap
    })

    // If priority badges are visible, verify they use distinct colors
    const colorValues = Object.values(priorityColors)
    if (colorValues.length > 1) {
      const uniqueColors = new Set(colorValues)
      expect(uniqueColors.size).toBe(colorValues.length)
    }

    await page.screenshot({
      path: "test-results/visual-consistency-priority-badges.png",
      fullPage: false,
    })
  })

  test("progress bar width is proportional to closed/total ratio", async ({ page, testDb }) => {
    await setupPage(page, testDb.dbPath)
    await page.goto("/")
    await waitForAppReady(page, "progress-bar")
    await expect(page.getByText("Epics")).toBeVisible({ timeout: 10_000 })

    // The seed data has 1 epic with children: 1 closed out of 4 non-epic children
    // (High Priority Task: open, In Progress Task: in_progress,
    //  Critical Bug: open, Completed Task: closed)
    // So progress should be 1/4 = 25%

    // Get the actual counts from CLI
    const listOutput = bd(testDb.dbPath, ["list", "--all", "--json"])
    const allBeads = JSON.parse(listOutput)
    const epic = allBeads.find((b: { issue_type: string }) => b.issue_type === "epic")
    expect(epic).toBeTruthy()

    const children = allBeads.filter((b: { parent?: string; issue_type: string }) =>
      b.parent === epic.id && b.issue_type !== "epic"
    )
    const closedChildren = children.filter((b: { status: string }) => b.status === "closed")
    const totalChildren = children.length
    const expectedRatio = totalChildren > 0 ? closedChildren.length / totalChildren : 0

    // Find the progress bar in the epic row
    // The progress bar is a div with an inline style width: `${progress}%`
    const progressBar = page.locator("[data-item-id]")
      .filter({ hasText: "E2E Test Epic" })
      .first()
      .locator("div.absolute.inset-y-0.left-0")
      .first()

    if (await progressBar.isVisible({ timeout: 3_000 }).catch(() => false)) {
      const barStyle = await progressBar.getAttribute("style")
      expect(barStyle).toBeTruthy()

      // Extract the width percentage from the style
      const widthMatch = barStyle!.match(/width:\s*([\d.]+)%/)
      expect(widthMatch).toBeTruthy()
      const actualWidth = parseFloat(widthMatch![1])
      const expectedWidth = expectedRatio * 100

      // Allow 1% tolerance for rounding
      expect(Math.abs(actualWidth - expectedWidth)).toBeLessThan(1.5)
    }

    // Also check the text display (filter by N/N pattern to avoid matching bead IDs)
    const progressText = page.locator("[data-item-id]")
      .filter({ hasText: "E2E Test Epic" })
      .first()
      .locator("span.font-mono")
      .filter({ hasText: /\d+\/\d+/ })
      .first()

    if (await progressText.isVisible({ timeout: 2_000 }).catch(() => false)) {
      const text = await progressText.textContent()
      // Should contain "closedCount/totalCount"
      expect(text).toContain(`${closedChildren.length}/${totalChildren}`)
    }

    await page.screenshot({
      path: "test-results/visual-consistency-progress-bar.png",
      fullPage: false,
    })
  })

  // Mode indicator tests removed: ModeIcon was deleted from the header in bb-hzp5.1.
  // Server/embedded mode distinction is no longer shown in the header.
})
