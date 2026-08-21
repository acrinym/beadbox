import { test, expect, bdCreate } from "./fixtures/test-setup"
import { injectTauriMock } from "./fixtures/tauri-mock"
import { snapshotElement } from "./helpers/visual"

// Shared setup: inject Tauri mock and set workspace cookie
async function setupPage(page: Parameters<Parameters<typeof test>[2]>[0]["page"], testDb: { workspaceId: string }) {
  await injectTauriMock(page)
  await page.context().addCookies([{
    name: "beads-workspace",
    value: testDb.workspaceId,
    domain: "localhost",
    path: "/",
  }])
}

async function waitForApp(page: Parameters<Parameters<typeof test>[2]>[0]["page"]) {
  await page.goto("/")
  await expect(page.locator("header")).toBeVisible({ timeout: 10_000 })
  // Wait for the epic tree to load
  await expect(page.getByText("Epics")).toBeVisible({ timeout: 10_000 })
}

// Expand the "Loose Beads" section (starts collapsed by default in fresh test dbs)
async function expandLooseBeads(page: Parameters<Parameters<typeof test>[2]>[0]["page"]) {
  const looseBeadsBtn = page.locator("button").filter({ hasText: "Loose Beads" })
  await expect(looseBeadsBtn).toBeVisible({ timeout: 5_000 })
  // Only expand if currently collapsed (chevron-right visible)
  const chevronRight = looseBeadsBtn.locator(".lucide-chevron-right")
  if (await chevronRight.isVisible()) {
    await looseBeadsBtn.click()
  }
}

// Get the detail panel container (scoped to avoid matching filter bar comboboxes)
function getDetailPanel(page: Parameters<Parameters<typeof test>[2]>[0]["page"]) {
  return page.locator("div.h-full.flex.flex-col.relative.outline-none")
}

// Retry page.reload() on transient connection errors (dev server restarts under load)
async function safeReload(page: Parameters<Parameters<typeof test>[2]>[0]["page"]) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.reload()
      return
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes("ERR_CONNECTION_REFUSED") && attempt < 2) {
        await page.waitForTimeout(3_000)
        continue
      }
      throw e
    }
  }
}

// Block GitHub releases API to prevent noisy update-checker network requests
async function blockUpdateChecker(page: Parameters<Parameters<typeof test>[2]>[0]["page"]) {
  await page.route(/api\.github\.com\/repos\/[^/]+\/[^/]+\/releases/, (route) => {
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tag_name: "v0.0.0", draft: false, prerelease: false, assets: [] }) })
  })
}

// The seed database has a standalone task "Search Target Alpha" (open, P2/medium, type task)
const LOOSE_BEAD = "Search Target Alpha"

// Serial because CRUD tests mutate shared state (the seed database)
test.describe.serial("Bead CRUD operations", () => {
  test("open bead detail by clicking a row", async ({ page, testDb }) => {
    await setupPage(page, testDb)
    await blockUpdateChecker(page)
    await waitForApp(page)
    await expandLooseBeads(page)

    // Click the standalone bead row
    const taskRow = page.getByText(LOOSE_BEAD)
    await expect(taskRow).toBeVisible({ timeout: 5_000 })
    await taskRow.click()

    // Detail panel should open with the bead's title in an h2 heading
    await expect(page.getByRole("heading", { name: LOOSE_BEAD })).toBeVisible({ timeout: 5_000 })

    const panel = getDetailPanel(page)

    // Type badge should show "task"
    await expect(panel.locator("button.capitalize").filter({ hasText: "task" })).toBeVisible()

    // Status should show "Open" (default for new beads)
    await expect(panel.locator('[role="combobox"]').first()).toContainText("Open")
  })

  test("change bead status persists across reload", async ({ page, testDb }) => {
    await setupPage(page, testDb)
    await blockUpdateChecker(page)
    await waitForApp(page)
    await expandLooseBeads(page)

    // Click the task bead
    await page.getByText(LOOSE_BEAD).click()

    // Wait for detail panel to load
    await expect(page.getByRole("heading", { name: LOOSE_BEAD })).toBeVisible({ timeout: 5_000 })

    // Click the status selector in the detail panel (it shows "Open" currently)
    const panel = getDetailPanel(page)
    const statusTrigger = panel.locator('[role="combobox"]').first()
    await statusTrigger.click()

    // Select "In Progress" from the dropdown
    await page.getByRole("option", { name: /In Progress/i }).click()

    // Wait for the status to update in the detail panel
    await expect(panel.getByText("In Progress").first()).toBeVisible({ timeout: 5_000 })

    // Reload and verify persistence.
    // The app preserves the selected bead in the URL, so detail auto-opens.
    await safeReload(page)
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole("heading", { name: LOOSE_BEAD })).toBeVisible({ timeout: 10_000 })
    await expect(getDetailPanel(page).getByText("In Progress").first()).toBeVisible({ timeout: 5_000 })
  })

  test("change bead priority persists across reload", async ({ page, testDb }) => {
    await setupPage(page, testDb)
    await blockUpdateChecker(page)
    await waitForApp(page)
    await expandLooseBeads(page)

    // Click the task bead
    await page.getByText(LOOSE_BEAD).click()
    await expect(page.getByRole("heading", { name: LOOSE_BEAD })).toBeVisible({ timeout: 5_000 })

    // The priority selector is the second combobox in the detail panel controls row
    const panel = getDetailPanel(page)
    const priorityTrigger = panel.locator('[role="combobox"]').nth(1)
    await priorityTrigger.click()

    // Select "High" from the dropdown
    await page.getByRole("option", { name: /High/i }).click()

    // Wait for save
    await page.waitForTimeout(1_000)

    // Reload and verify (detail auto-opens via URL param)
    await safeReload(page)
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole("heading", { name: LOOSE_BEAD })).toBeVisible({ timeout: 10_000 })

    // Priority should still be "High"
    await expect(getDetailPanel(page).getByText("High").first()).toBeVisible({ timeout: 5_000 })
  })

  test("change bead type persists across reload", async ({ page, testDb }) => {
    await setupPage(page, testDb)
    await blockUpdateChecker(page)
    await waitForApp(page)
    await expandLooseBeads(page)

    // Click the task bead
    await page.getByText(LOOSE_BEAD).click()
    await expect(page.getByRole("heading", { name: LOOSE_BEAD })).toBeVisible({ timeout: 5_000 })

    // The type badge is a dropdown trigger showing the current type
    const panel = getDetailPanel(page)
    const typeBadge = panel.locator("button.capitalize").first()
    await typeBadge.click()

    // Select "bug" from the dropdown
    await page.getByRole("menuitem", { name: /^bug$/i }).click()

    // Wait for save
    await page.waitForTimeout(1_000)

    // Reload and verify (detail auto-opens via URL param)
    await safeReload(page)
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole("heading", { name: LOOSE_BEAD })).toBeVisible({ timeout: 10_000 })

    // Type should still be "bug"
    await expect(getDetailPanel(page).locator("button.capitalize").first()).toContainText("bug")
  })

  test("close bead via close button", async ({ page, testDb }) => {
    await setupPage(page, testDb)
    await blockUpdateChecker(page)

    // Create a fresh bead for this test
    bdCreate(testDb.dbPath, ["--title", "Bead To Close", "--type", "task", "--priority", "2"])

    await waitForApp(page)
    await expandLooseBeads(page)

    // Click the bead
    await page.getByText("Bead To Close").click()
    await expect(page.getByRole("heading", { name: "Bead To Close" })).toBeVisible({ timeout: 5_000 })

    // Click the close button (CheckCircle2 / CircleCheck icon in detail panel)
    const closeButton = page.locator('button').filter({ has: page.locator('.lucide-circle-check') })
    await expect(closeButton).toBeVisible({ timeout: 5_000 })
    await closeButton.click()

    // Wait for status to change to "Closed"
    await expect(page.getByText("Closed").first()).toBeVisible({ timeout: 5_000 })
  })

  test("delete bead from table with confirmation dialog", async ({ page, testDb }) => {
    await setupPage(page, testDb)
    await blockUpdateChecker(page)

    // Create a fresh bead for deletion
    bdCreate(testDb.dbPath, ["--title", "Bead To Delete From Table", "--type", "task", "--priority", "2"])

    await waitForApp(page)
    await expandLooseBeads(page)

    // Find the bead row (use .bead-row to avoid matching the _standalone container)
    const beadRow = page.locator('.bead-row').filter({ hasText: "Bead To Delete From Table" })
    await expect(beadRow).toBeVisible()
    await beadRow.hover()

    // Click the delete button (trash icon) on the row
    const deleteBtn = beadRow.locator('button').filter({ has: page.locator('.lucide-trash2') })
    await expect(deleteBtn).toBeVisible()
    await deleteBtn.click()

    // Confirmation dialog should appear
    const dialog = page.locator('[role="alertdialog"]')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText("Delete this item?")).toBeVisible()

    // Click "Delete" to confirm
    await dialog.getByRole("button", { name: "Delete" }).click()

    // Wait for the server action to complete (success toast confirms bd delete --force ran)
    await expect(page.getByText("Bead deleted")).toBeVisible({ timeout: 10_000 })

    // Bead should disappear from the list
    await expect(page.getByText("Bead To Delete From Table")).not.toBeVisible({ timeout: 5_000 })

    // Reload and verify it stays deleted
    await safeReload(page)
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText("Epics")).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText("Bead To Delete From Table")).not.toBeVisible()
  })

  test("delete bead from detail panel", async ({ page, testDb }) => {
    await setupPage(page, testDb)
    await blockUpdateChecker(page)

    // Create a fresh bead for deletion
    bdCreate(testDb.dbPath, ["--title", "Bead To Delete From Panel", "--type", "task", "--priority", "2"])

    await waitForApp(page)
    await expandLooseBeads(page)

    // Click the bead to open detail
    await page.getByText("Bead To Delete From Panel").click()
    await expect(page.getByRole("heading", { name: "Bead To Delete From Panel" })).toBeVisible({ timeout: 5_000 })

    // Click the delete button in the DETAIL PANEL (not the row's delete button).
    // The detail panel has a trash icon button that triggers direct delete (no confirmation).
    const panel = getDetailPanel(page)
    const trashButton = panel.locator('button').filter({ has: page.locator('.lucide-trash2') })
    await expect(trashButton).toBeVisible({ timeout: 5_000 })
    await trashButton.click()

    // Detail panel delete goes directly through handleDelete (no confirmation dialog).
    // The heading should disappear as the detail panel closes.
    await expect(page.getByRole("heading", { name: "Bead To Delete From Panel" })).not.toBeVisible({ timeout: 5_000 })
  })

  test("bead detail shows all core fields", async ({ page, testDb }) => {
    await setupPage(page, testDb)
    await blockUpdateChecker(page)
    await waitForApp(page)

    // Click the epic's inner clickable area to open its detail.
    // In the narrow test viewport, the epic title is truncated to zero width, and the
    // CopyableId + badges overlay the icon. Use JS to dispatch click directly on the
    // inner clickable div (bypasses CopyableId's stopPropagation and badge overlay).
    const epicRow = page.locator('[data-item-id]:not([data-item-id="_standalone"])').filter({ hasText: "E2E Test Epic" })
    await expect(epicRow).toBeVisible({ timeout: 5_000 })
    await epicRow.locator("div.cursor-pointer").first().dispatchEvent("click")

    // Detail panel should show the epic's title
    await expect(page.getByRole("heading", { name: "E2E Test Epic" })).toBeVisible({ timeout: 5_000 })

    const panel = getDetailPanel(page)

    // Verify core fields are present
    // Type badge (should show "epic")
    await expect(panel.locator("button.capitalize").filter({ hasText: "epic" })).toBeVisible()

    // Status selector
    const comboboxes = panel.locator('[role="combobox"]')
    await expect(comboboxes.first()).toBeVisible()

    // Priority selector
    await expect(comboboxes.nth(1)).toBeVisible()

    // Assignee selector
    await expect(comboboxes.nth(2)).toBeVisible()

    // Description section header
    await expect(panel.getByText("Description", { exact: true })).toBeVisible()

    // Bead ID (CopyableId component in detail panel)
    const beadIdElement = panel.locator('[class*="font-mono"]').filter({ hasText: /e2e/i }).first()
    await expect(beadIdElement).toBeVisible()
  })

  test("cancel delete confirmation keeps bead", async ({ page, testDb }) => {
    await setupPage(page, testDb)
    await blockUpdateChecker(page)
    await waitForApp(page)
    await expandLooseBeads(page)

    // Use the standalone bead for the cancel-delete test.
    // After previous tests, it's been modified (type=bug, status=In Progress, priority=High)
    // but it still exists under Loose Beads.
    const beadRow = page.locator('.bead-row').filter({ hasText: LOOSE_BEAD })
    await expect(beadRow).toBeVisible()
    await beadRow.hover()

    // Click the delete button (trash icon)
    const deleteBtn = beadRow.locator('button').filter({ has: page.locator('.lucide-trash2') })
    await expect(deleteBtn).toBeVisible()
    await deleteBtn.click()

    // Confirmation dialog
    const dialog = page.locator('[role="alertdialog"]')
    await expect(dialog).toBeVisible()

    // Click Cancel instead of Delete
    await dialog.getByRole("button", { name: "Cancel" }).click()

    // Dialog should close
    await expect(dialog).not.toBeVisible()

    // Bead should still be there
    await expect(page.getByText(LOOSE_BEAD)).toBeVisible()
  })
})

// Visual regression spec runs OUTSIDE the serial CRUD describe so the
// shared seed bead's state doesn't leak in. Each run creates a fresh
// dedicated bead and snapshots the detail panel with timestamps masked.
test.describe("Bead detail visual regression (bb-8xey)", () => {
  test("bead detail panel visual baseline", async ({ page, testDb }) => {
    const beadId = bdCreate(testDb.dbPath, [
      "--title", "Visual Snapshot Bead",
      "--type", "task",
      "--priority", "2",
      "--description", "Stable description body for snapshot stability across runs.",
    ])
    await setupPage(page, testDb)
    await waitForApp(page)
    await expandLooseBeads(page)

    const row = page.locator(`[data-bead-id="${beadId}"]`).or(
      page.getByText("Visual Snapshot Bead").first()
    )
    await expect(row).toBeVisible({ timeout: 10_000 })
    await row.click()

    await expect(
      page.getByRole("heading", { name: "Visual Snapshot Bead" })
    ).toBeVisible({ timeout: 5_000 })

    await page.evaluate(() => document.fonts.ready)

    // Mask the relative-time spans in the detail panel header — they show
    // "Created: a few seconds ago" / "Updated: a few seconds ago" and
    // change wording as time passes.
    await snapshotElement(getDetailPanel(page), "bead-detail-panel.png", {
      mask: [
        page.locator('[data-testid="bead-created-ts"]'),
        page.locator('[data-testid="bead-updated-ts"]'),
      ],
    })
  })
})
