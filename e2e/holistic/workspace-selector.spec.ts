/**
 * Workspace Selector E2E Tests (epic ship gate: bb-nmf0.1)
 *
 * Verifies the workspace selector page works end-to-end with real bd CLI
 * and Dolt. Tests workspace grid rendering, open/add/remove flows,
 * empty state, and health check.
 *
 * These tests use resilient locators that work with both the old monolith
 * page and the rewritten component-based page.
 *
 * Uses the holistic config (ephemeral port, 1 worker, sequential).
 * Run: npx playwright test --config e2e/holistic/playwright.holistic.config.ts e2e/holistic/workspace-selector.spec.ts
 */

import { test, expect, copyWorkspace, registerTestWorkspaces, destroyTestDb } from "../fixtures/test-setup"
import { injectTauriMock } from "../fixtures/tauri-mock"
import { waitForAppReady } from "./helpers"
import { TEMPLATE_ALPHA_WS_DIR, TEMPLATE_BETA_WS_DIR, TEMPLATE_GAMMA_WS_DIR } from "../global-setup"
import { existsSync, mkdirSync, rmSync } from "fs"
import { join, basename } from "path"
import { tmpdir } from "os"
import type { Page } from "@playwright/test"

// Block GitHub update checker to prevent UI noise.
async function blockUpdateChecker(page: Page) {
  await page.route(/api\.github\.com\/repos\/[^/]+\/[^/]+\/releases/, (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tag_name: "v0.0.0", draft: false, prerelease: false, assets: [] }),
    })
  })
}

async function goToWorkspaces(page: Page) {
  await injectTauriMock(page)
  await blockUpdateChecker(page)
  await page.goto("/workspaces")
}

// Find a workspace card by name, targeting the name paragraph specifically
// to avoid strict mode violations (name appears in both title and path).
function workspaceCardByName(page: Page, name: string) {
  return page.locator("[class*='rounded-lg'][class*='border']").filter({
    has: page.locator("p[class*='font-medium']").filter({ hasText: name }),
  })
}

test.describe("Workspace Selector (epic ship gate bb-nmf0.1)", () => {

  // ── Scenario 1: Workspace grid renders ──────────────────────────────────

  test("workspace grid renders cards with name and mode badge", async ({ page, workspaceTriple }) => {
    await goToWorkspaces(page)

    const alphaCard = workspaceCardByName(page, workspaceTriple.alpha.name)
    const betaCard = workspaceCardByName(page, workspaceTriple.beta.name)
    const gammaCard = workspaceCardByName(page, workspaceTriple.gamma.name)

    await expect(alphaCard).toBeVisible({ timeout: 15_000 })
    await expect(betaCard).toBeVisible()
    await expect(gammaCard).toBeVisible()

    // Each card shows the workspace name in a font-medium paragraph
    for (const ws of [workspaceTriple.alpha, workspaceTriple.beta, workspaceTriple.gamma]) {
      const card = workspaceCardByName(page, ws.name)
      const nameEl = card.locator("p[class*='font-medium']").first()
      await expect(nameEl).toContainText(ws.name)
    }
  })

  // ── Scenario 2: Open workspace navigates to / ──────────────────────────

  test("open workspace navigates to main page with correct workspace", async ({ page, workspaceTriple }) => {
    await goToWorkspaces(page)

    const alphaCard = workspaceCardByName(page, workspaceTriple.alpha.name)
    await expect(alphaCard).toBeVisible({ timeout: 15_000 })

    // New page: "Open" button on card. Old page: double-click to connect.
    const openBtn = alphaCard.getByRole("button", { name: /open/i })
    if (await openBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await openBtn.click()
    } else {
      await alphaCard.dblclick()
    }

    await page.waitForURL(/\/(\?.*)?$/, { timeout: 15_000 })
    await waitForAppReady(page, "ws-selector-open")
    await expect(page.getByText("Alpha Epic")).toBeVisible({ timeout: 15_000 })
  })

  // ── Scenario 3: Add workspace by local path ────────────────────────────

  test("add workspace by local path", async ({ page, _workerDoltServer }) => {
    const unregistered = copyWorkspace(TEMPLATE_GAMMA_WS_DIR, "add-path", _workerDoltServer.port)
    const alpha = copyWorkspace(TEMPLATE_ALPHA_WS_DIR, "addpath-a", _workerDoltServer.port)
    const restoreRegistry = registerTestWorkspaces([alpha])

    try {
      await goToWorkspaces(page)
      await expect(workspaceCardByName(page, basename(alpha.projectDir))).toBeVisible({ timeout: 15_000 })

      // Click "Add workspace"
      await page.getByRole("button", { name: /add workspace/i }).first().click()

      // Two possible flows:
      // New page: AddWorkspaceDialog opens with "Local Path" tab and input
      // Old page: inline input appears at bottom of page
      const dialogInput = page.locator("[role='dialog'] input[placeholder*='project'], [role='dialog'] input[placeholder*='Project']").first()
      const inlineInput = page.locator("input[placeholder*='project'], input[placeholder*='Project']").first()

      // Wait for any input to appear
      await expect(inlineInput).toBeVisible({ timeout: 5_000 })

      // Fill path and submit
      await inlineInput.fill(unregistered.projectDir)
      await page.getByRole("button", { name: /^add$/i }).click()

      // New workspace card should appear
      const wsName = basename(unregistered.projectDir)
      await expect(workspaceCardByName(page, wsName)).toBeVisible({ timeout: 15_000 })
    } finally {
      restoreRegistry()
      destroyTestDb(alpha.projectDir)
      destroyTestDb(unregistered.projectDir)
    }
  })

  // ── Scenario 4: Add workspace needsInit flow ──────────────────────────

  test("add workspace triggers init when path has no .beads", async ({ page, _workerDoltServer }) => {
    const bareDir = join(tmpdir(), `beadbox-e2e-bare-${process.pid}-${Date.now()}`)
    mkdirSync(bareDir, { recursive: true })

    const alpha = copyWorkspace(TEMPLATE_ALPHA_WS_DIR, "init-a", _workerDoltServer.port)
    const restoreRegistry = registerTestWorkspaces([alpha])

    try {
      await goToWorkspaces(page)
      await expect(workspaceCardByName(page, basename(alpha.projectDir))).toBeVisible({ timeout: 15_000 })

      // Click "Add workspace" then enter bare path
      await page.getByRole("button", { name: /add workspace/i }).first().click()
      const pathInput = page.locator("input[placeholder*='project'], input[placeholder*='Project']").first()
      await expect(pathInput).toBeVisible({ timeout: 5_000 })
      await pathInput.fill(bareDir)
      await page.getByRole("button", { name: /^add$/i }).click()

      // Path has no .beads, so the app should prompt for initialization.
      // New page: InitWorkspaceDialog opens
      // Old page: inline prompt "No workspace found. Create one?"
      await expect(
        page.getByRole("heading", { name: /initialize workspace/i })
          .or(page.getByText(/no workspace found/i))
          .or(page.getByText(/create one/i))
          .or(page.getByText("Initialize Workspace"))
      ).toBeVisible({ timeout: 10_000 })

      // Complete initialization
      const initBtn = page.getByRole("button", { name: /initialize/i }).first()
      if (await initBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await initBtn.click()

        const wsName = basename(bareDir)
        // CI Dolt startup is slower; allow up to 60s for bd init + workspace detection
        await expect(workspaceCardByName(page, wsName)).toBeVisible({ timeout: 60_000 })
        expect(existsSync(join(bareDir, ".beads"))).toBe(true)
      }
    } finally {
      restoreRegistry()
      destroyTestDb(alpha.projectDir)
      try { rmSync(bareDir, { recursive: true, force: true }) } catch { /* best-effort */ }
    }
  })

  // ── Scenario 5: Remove workspace ──────────────────────────────────────

  test("remove workspace removes card but preserves .beads on disk", async ({ page, _workerDoltServer }) => {
    const alpha = copyWorkspace(TEMPLATE_ALPHA_WS_DIR, "rm-a", _workerDoltServer.port)
    const beta = copyWorkspace(TEMPLATE_BETA_WS_DIR, "rm-b", _workerDoltServer.port)
    const restoreRegistry = registerTestWorkspaces([alpha, beta])
    const alphaName = basename(alpha.projectDir)
    const betaName = basename(beta.projectDir)

    try {
      await goToWorkspaces(page)
      const alphaCard = workspaceCardByName(page, alphaName)
      await expect(alphaCard).toBeVisible({ timeout: 15_000 })
      await expect(workspaceCardByName(page, betaName)).toBeVisible()

      // Hover to reveal X button, then click it
      await alphaCard.hover()
      const removeBtn = page.locator(`button[aria-label="Remove ${alphaName}"]`)
      await expect(removeBtn).toBeVisible({ timeout: 3_000 })
      await removeBtn.click()

      // If a confirmation dialog appears, confirm it
      const alertDialog = page.getByRole("alertdialog")
      if (await alertDialog.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await alertDialog.getByRole("button", { name: /remove|confirm|yes/i }).click()
      }

      // Alpha card should disappear
      await expect(alphaCard).not.toBeVisible({ timeout: 10_000 })

      // Beta should remain
      await expect(workspaceCardByName(page, betaName)).toBeVisible()

      // .beads still exists on disk (removal is registry-only)
      expect(existsSync(join(alpha.projectDir, ".beads"))).toBe(true)
    } finally {
      restoreRegistry()
      destroyTestDb(alpha.projectDir)
      destroyTestDb(beta.projectDir)
    }
  })

  // ── Scenario 6: Empty state ────────────────────────────────────────────

  test("empty state shows init and connect options", async ({ page, registryControl }) => {
    registryControl.clearRegistry()
    await goToWorkspaces(page)

    // Empty state should show workspace creation options.
    // Use heading level 1 to be specific (avoids matching h3 sub-headings too).
    await expect(
      page.locator("h1").filter({ hasText: /welcome|select a workspace|no workspaces|get started/i })
    ).toBeVisible({ timeout: 15_000 })

    // Should have a server/connect option.
    // Empty state shows "Use existing workspace" button.
    await expect(
      page.getByRole("button", { name: /use existing workspace/i })
    ).toBeVisible({ timeout: 10_000 })
  })

  // ── Scenario 7: Health check passes ───────────────────────────────────

  test("workspace selector loads successfully when bd is available", async ({ page, registryControl }) => {
    registryControl.clearRegistry()
    await goToWorkspaces(page)

    // When bd is available, the page should load (not stuck on error).
    // Match the h1 heading that appears in both old and new pages.
    await expect(
      page.locator("h1").first()
    ).toBeVisible({ timeout: 15_000 })

    // The page should be interactive: either showing workspaces or creation options
    const h1Text = await page.locator("h1").first().textContent()
    expect(h1Text).toBeTruthy()
    // h1 should be one of the known headings (not an error page)
    expect(
      /select a workspace|welcome|no workspaces|beadbox/i.test(h1Text ?? "")
    ).toBe(true)
  })
})
