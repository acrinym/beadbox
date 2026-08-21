import { test, expect } from "./fixtures/test-setup"
import { injectTauriMock } from "./fixtures/tauri-mock"
import type { Page } from "@playwright/test"

// Set workspace cookie (UUID) and navigate to main page.
// Waits for the header to render and the epic tree to load.
async function loadWorkspace(page: Page, workspaceId: string) {
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

// Switch workspace via /workspaces page (workspace tabs removed from header in bb-hzp5.1).
async function switchWorkspace(page: Page, workspaceName: string) {
  await page.goto("/workspaces")
  await expect(page.getByText("Select a workspace")).toBeVisible({ timeout: 10_000 })

  // Find the workspace card and click its Open button
  const card = page.locator("[class*='rounded-lg']").filter({ hasText: workspaceName }).first()
  await expect(card.getByRole("button", { name: "Open" })).toBeVisible({ timeout: 5_000 })
  await card.getByRole("button", { name: "Open" }).click()

  // After clicking Open, the app navigates to / and the layout-level
  // StartupGate re-runs health (detects cookie change). Wait for the
  // gate to finish and the header to render. CI can be slow.
  await expect(page).toHaveURL(/\/\?from=selector|^\/$/, { timeout: 15_000 })
  await expect(page.locator("header")).toBeVisible({ timeout: 15_000 })
}

test.describe("Workspace switching", () => {
  test.beforeEach(async ({ page }) => {
    await injectTauriMock(page)
  })

  // --- Header shows current workspace name (no tabs) ---
  test("header shows current workspace name", async ({ page, workspacePair }) => {
    await loadWorkspace(page, workspacePair.alpha.workspaceId)

    // Current workspace name should be visible in the header
    await expect(
      page.locator("header").getByText(workspacePair.alpha.name)
    ).toBeVisible({ timeout: 10_000 })

    // Other workspace name should NOT be in the header (tabs removed)
    await expect(
      page.locator("header").getByText(workspacePair.beta.name)
    ).not.toBeVisible()
  })

  // --- Switching workspace changes bead data ---
  test("switching workspace loads different beads", async ({ page, workspacePair }) => {
    await loadWorkspace(page, workspacePair.alpha.workspaceId)

    // Alpha workspace should show Alpha Epic
    await expect(page.getByText("Alpha Epic")).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText("Beta Epic")).not.toBeVisible()

    // Switch to Beta via /workspaces page
    await switchWorkspace(page, workspacePair.beta.name)

    // Beta workspace should now show Beta Epic
    await expect(page.getByText("Beta Epic")).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText("Alpha Epic")).not.toBeVisible()
  })

  // --- Data isolation between workspaces ---
  test("workspace data is isolated", async ({ page, workspacePair }) => {
    // Load workspace Alpha
    await loadWorkspace(page, workspacePair.alpha.workspaceId)
    await expect(page.getByText("Alpha Epic")).toBeVisible({ timeout: 10_000 })

    // Expand Alpha epic to see children
    const alphaEpicRow = page.locator("[data-item-id]").filter({ hasText: "Alpha Epic" }).first()
    await alphaEpicRow.locator("button[type='button']").first().click()
    await expect(page.getByText("Alpha Task One")).toBeVisible({ timeout: 5_000 })
    await expect(page.getByText("Alpha Task Two")).toBeVisible()

    // Beta tasks should NOT be visible
    await expect(page.getByText("Beta Task One")).not.toBeVisible()
    await expect(page.getByText("Beta Task Two")).not.toBeVisible()

    // Switch to Beta via /workspaces
    await switchWorkspace(page, workspacePair.beta.name)
    await expect(page.getByText("Beta Epic")).toBeVisible({ timeout: 10_000 })

    // Expand Beta epic
    const betaEpicRow = page.locator("[data-item-id]").filter({ hasText: "Beta Epic" }).first()
    await betaEpicRow.locator("button[type='button']").first().click()
    await expect(page.getByText("Beta Task One")).toBeVisible({ timeout: 5_000 })
    await expect(page.getByText("Beta Task Two")).toBeVisible()

    // Alpha tasks should NOT be visible
    await expect(page.getByText("Alpha Task One")).not.toBeVisible()
    await expect(page.getByText("Alpha Task Two")).not.toBeVisible()
  })

  // --- Cookie persists workspace selection across reload ---
  test("workspace selection persists across page reload", async ({ page, workspacePair }) => {
    // Start on Alpha
    await loadWorkspace(page, workspacePair.alpha.workspaceId)
    await expect(page.getByText("Alpha Epic")).toBeVisible({ timeout: 10_000 })

    // Switch to Beta via /workspaces (this updates the cookie)
    await switchWorkspace(page, workspacePair.beta.name)
    await expect(page.getByText("Beta Epic")).toBeVisible({ timeout: 10_000 })

    // Reload the page without setting cookies again
    await page.reload()
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 })

    // Beta should still be the active workspace after reload
    await expect(page.getByText("Beta Epic")).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText("Alpha Epic")).not.toBeVisible()
  })

  // --- Filters persist across workspace switch ---
  test("filters persist across workspace switch", async ({ page, workspacePair }) => {
    await loadWorkspace(page, workspacePair.alpha.workspaceId)

    // Apply a status filter (filters are global localStorage, not per-workspace)
    await page.getByRole("combobox").filter({ hasText: "All Status" }).first().click()
    await page.getByRole("option", { name: "Open", exact: true }).click()

    // Verify filter is applied
    await expect(
      page.getByRole("combobox").filter({ hasText: "Open" }).first()
    ).toBeVisible({ timeout: 5_000 })

    // Switch to Beta via /workspaces
    await switchWorkspace(page, workspacePair.beta.name)
    await expect(page.getByText("Beta Epic")).toBeVisible({ timeout: 10_000 })

    // Status filter should still show "Open" (global persistence)
    await expect(
      page.getByRole("combobox").filter({ hasText: "Open" }).first()
    ).toBeVisible({ timeout: 5_000 })

    // Reset filter for clean state
    await page.getByRole("combobox").filter({ hasText: "Open" }).first().click()
    await page.getByRole("option", { name: "All Status", exact: true }).click()
  })

  // --- Workspaces page renders workspace list ---
  test("workspaces page lists available workspaces", async ({ page, workspacePair }) => {
    // Set cookie so startup gate doesn't redirect
    await page.context().addCookies([{
      name: "beads-workspace",
      value: workspacePair.alpha.workspaceId,
      domain: "localhost",
      path: "/",
    }])

    await page.goto("/workspaces")
    await expect(
      page.getByText("Select a workspace")
    ).toBeVisible({ timeout: 10_000 })

    // Both test workspaces should appear in the workspace list
    // Use first() because workspace name appears in both the title and the path display
    await expect(page.getByText(workspacePair.alpha.name).first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(workspacePair.beta.name).first()).toBeVisible({ timeout: 10_000 })
  })
})
