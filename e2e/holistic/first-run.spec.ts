/**
 * First-Run Experience E2E tests (spec 12.4)
 *
 * Verifies the first-run flows using the standard holistic test infrastructure
 * (dev server + Dolt fixtures). Tests cover:
 * - Empty registry -> startup gate redirects to /workspaces
 * - /workspaces page renders workspace creation options
 * - bd missing -> error screen with platform-appropriate install guidance
 * - Stale registry -> error screen with recovery actions
 * - Remove stale workspace -> redirects to /workspaces
 *
 * Run: npx playwright test --config e2e/holistic/playwright.holistic.config.ts e2e/holistic/first-run.spec.ts
 */

import { test, expect } from "../fixtures/test-setup"
import { injectTauriMock } from "../fixtures/tauri-mock"
import { waitForStartupError } from "./helpers"
import { writeFileSync, readFileSync } from "fs"
import { randomUUID } from "crypto"
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

async function setupPage(page: Page) {
  await injectTauriMock(page)
  await blockUpdateChecker(page)
}

test.describe("First-Run Experience (spec 12.4)", () => {

  // ── Scenario 1: Empty registry redirects to /workspaces ─────────────────

  test("empty registry: startup gate redirects to /workspaces", async ({ page, registryControl }) => {
    registryControl.clearRegistry()
    await setupPage(page)

    // Navigate to the main page; the startup gate should detect no workspaces
    // and redirect to /workspaces.
    await page.goto("/")
    await page.waitForURL(/\/workspaces/, { timeout: 15_000 })

    expect(page.url()).toContain("/workspaces")
  })

  // ── Scenario 2: /workspaces page renders workspace creation options ─────

  test("empty registry: /workspaces shows init and add options", async ({ page, registryControl }) => {
    registryControl.clearRegistry()
    await setupPage(page)
    await page.goto("/workspaces")

    // The empty state shows "Welcome to Beadbox" heading
    await expect(
      page.locator("h1").filter({ hasText: /welcome to beadbox/i })
    ).toBeVisible({ timeout: 15_000 })

    // Should offer init and add-existing options
    await expect(
      page.getByRole("button", { name: /init.*workspace/i })
    ).toBeVisible({ timeout: 5_000 })

    await expect(
      page.getByRole("button", { name: /use existing workspace/i })
    ).toBeVisible({ timeout: 5_000 })
  })

  // ── Scenario 3: bd missing -> error screen on /workspaces ───────────────
  //
  // When bd is not on PATH, the /workspaces page shows a bd-missing screen
  // with platform-appropriate install instructions. We simulate this by
  // intercepting the checkBdHealth server action response via route interception.

  test("bd missing: /workspaces shows install instructions with Retry", async ({ page, registryControl }) => {
    registryControl.clearRegistry()
    await setupPage(page)

    // Intercept the server action that checks bd health, making it return bd unavailable.
    // Server actions are POST requests to the page URL with Next-Action header.
    await page.route(/.*/, async (route) => {
      const request = route.request()
      // Server actions use POST with Next-Action header
      if (request.method() === "POST" && request.headers()["next-action"]) {
        const postData = await request.postData()
        // checkBdHealth is called by the workspaces page on mount.
        // We intercept all server actions and check if they return bd health data.
        // Let the request through but intercept the response.
        const response = await route.fetch()
        const body = await response.text()

        // If this response contains bdAvailable, replace it with false
        if (body.includes("bdAvailable")) {
          const modified = body
            .replace(/"bdAvailable"\s*:\s*true/g, '"bdAvailable":false')
            .replace(/"bdPath"\s*:\s*"[^"]*"/g, '"bdPath":"/nonexistent/bd"')
          return route.fulfill({
            status: response.status(),
            headers: response.headers(),
            body: modified,
          })
        }
        return route.fulfill({ response })
      }
      return route.continue()
    })

    await page.goto("/workspaces")

    // Should show "Welcome to Beadbox" (bd_missing title)
    await expect(
      page.locator("h1").filter({ hasText: /welcome to beadbox/i })
    ).toBeVisible({ timeout: 15_000 })

    // Should show install instructions (platform-dependent)
    await expect(
      page.getByText("brew install beads")
        .or(page.getByText("go install github.com/steveyegge/beads/cmd/bd@latest"))
        .or(page.getByText("Download bd for Windows"))
    ).toBeVisible({ timeout: 5_000 })

    // Should have a "Check again" button (the /workspaces page equivalent of Retry)
    await expect(
      page.getByRole("button", { name: /check again/i })
    ).toBeVisible({ timeout: 5_000 })

    // Should have the "What is beads?" link
    await expect(
      page.getByText("What is beads?")
    ).toBeVisible({ timeout: 5_000 })
  })

  // ── Scenario 4: Stale registry -> error screen with recovery ────────────
  //
  // Use a server-only workspace (no local path) pointing at a non-existent
  // database. resolveBdDbPath falls through to serverRuntimeDbPath, and bd
  // fails because the database doesn't exist on the Dolt server.

  test("stale registry: database not found shows error with recovery actions", async ({ page, _workerDoltServer }) => {
    const beadboxRegPath = process.env.BEADBOX_REGISTRY_PATH!
    let original: string
    try { original = readFileSync(beadboxRegPath, "utf-8") } catch { original = '{"version":2,"workspaces":[],"activeWorkspace":null}' }

    const staleId = randomUUID()
    const staleEntry = {
      id: staleId,
      name: "stale-workspace",
      addedAt: new Date().toISOString(),
      local: null,
      server: {
        host: "127.0.0.1",
        port: _workerDoltServer.port,
        database: "nonexistent_database_xyz",
        user: "root",
        tls: false,
      },
      mode: "server" as const,
    }

    const existing = JSON.parse(original)
    writeFileSync(beadboxRegPath, JSON.stringify({
      version: 2,
      workspaces: [...(existing.workspaces || []), staleEntry],
      activeWorkspace: staleId,
    }, null, 2))

    try {
      await setupPage(page)
      await page.goto("/")

      // The startup gate should show an error screen.
      // The exact error depends on how bd reports the missing database:
      // "Database not found", "Database server unreachable", or generic "Startup error".
      await waitForStartupError(page, "stale-registry")

      // Retry button should be visible
      await expect(
        page.getByRole("button", { name: "Retry" })
      ).toBeVisible({ timeout: 5_000 })

      // Recovery actions: "Remove workspace" and "Choose workspace" buttons
      await expect(
        page.getByRole("button", { name: /remove workspace/i })
      ).toBeVisible({ timeout: 5_000 })

      await expect(
        page.getByRole("button", { name: /choose workspace/i })
      ).toBeVisible({ timeout: 5_000 })
    } finally {
      writeFileSync(beadboxRegPath, original)
    }
  })

  // ── Scenario 5: Remove stale workspace -> redirect to /workspaces ───────

  test("remove stale workspace redirects to workspace selector", async ({ page, _workerDoltServer }) => {
    const beadboxRegPath = process.env.BEADBOX_REGISTRY_PATH!
    let original: string
    try { original = readFileSync(beadboxRegPath, "utf-8") } catch { original = '{"version":2,"workspaces":[],"activeWorkspace":null}' }

    const staleId = randomUUID()
    const staleEntry = {
      id: staleId,
      name: "stale-rm-workspace",
      addedAt: new Date().toISOString(),
      local: null,
      server: {
        host: "127.0.0.1",
        port: _workerDoltServer.port,
        database: "nonexistent_database_rm",
        user: "root",
        tls: false,
      },
      mode: "server" as const,
    }

    // Write registry with ONLY the stale entry (so removing it leaves empty registry)
    writeFileSync(beadboxRegPath, JSON.stringify({
      version: 2,
      workspaces: [staleEntry],
      activeWorkspace: staleId,
    }, null, 2))

    try {
      await setupPage(page)
      await page.goto("/")

      // Wait for error screen
      await expect(
        page.getByText("Database not found")
          .or(page.getByText("Database server unreachable"))
          .or(page.getByText("Startup error"))
      ).toBeVisible({ timeout: 20_000 })

      // Click "Remove workspace"
      await page.getByRole("button", { name: /remove workspace/i }).click()

      // After removing the only workspace, the startup gate re-checks,
      // finds no workspaces, and redirects to /workspaces.
      await page.waitForURL(/\/workspaces/, { timeout: 15_000 })
      expect(page.url()).toContain("/workspaces")

      // The workspace selector should show the empty state
      await expect(
        page.locator("h1").filter({ hasText: /welcome to beadbox/i })
      ).toBeVisible({ timeout: 10_000 })
    } finally {
      writeFileSync(beadboxRegPath, original)
    }
  })

  // ── Scenario 6: Choose workspace navigates to /workspaces ───────────────

  test("choose workspace button navigates to /workspaces from error screen", async ({ page, _workerDoltServer }) => {
    const beadboxRegPath = process.env.BEADBOX_REGISTRY_PATH!
    let original: string
    try { original = readFileSync(beadboxRegPath, "utf-8") } catch { original = '{"version":2,"workspaces":[],"activeWorkspace":null}' }

    const staleId = randomUUID()
    const staleEntry = {
      id: staleId,
      name: "stale-choose-workspace",
      addedAt: new Date().toISOString(),
      local: null,
      server: {
        host: "127.0.0.1",
        port: _workerDoltServer.port,
        database: "nonexistent_database_choose",
        user: "root",
        tls: false,
      },
      mode: "server" as const,
    }

    writeFileSync(beadboxRegPath, JSON.stringify({
      version: 2,
      workspaces: [staleEntry],
      activeWorkspace: staleId,
    }, null, 2))

    try {
      await setupPage(page)
      await page.goto("/")

      // Wait for error screen
      await expect(
        page.getByText("Database not found")
          .or(page.getByText("Database server unreachable"))
          .or(page.getByText("Startup error"))
      ).toBeVisible({ timeout: 20_000 })

      // Click "Choose workspace"
      await page.getByRole("button", { name: /choose workspace/i }).click()

      // Should navigate to /workspaces
      await page.waitForURL(/\/workspaces/, { timeout: 10_000 })
      expect(page.url()).toContain("/workspaces")
    } finally {
      writeFileSync(beadboxRegPath, original)
    }
  })
})
