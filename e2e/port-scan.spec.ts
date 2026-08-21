import { test, expect } from "./fixtures/test-setup"
import { createManagedDoltServer, findDolt, type ManagedDoltServer } from "./fixtures/dolt-server"
import { injectTauriMock } from "./fixtures/tauri-mock"
import { spawnSync } from "child_process"
import type { Page } from "@playwright/test"

const DOLT_PATH = findDolt()

// ---------------------------------------------------------------------------
// Port choices
// ---------------------------------------------------------------------------

// Use a fixed port for the discovery test's standalone Dolt server.
// Worker Dolt servers use ephemeral ports, so no conflict risk.
const DISCOVER_TEST_PORT = 14050

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal beads schema (issues table) on a managed Dolt server
 * so that discoverServerDatabases recognizes it as a beads database.
 */
function seedBeadsSchema(port: number, databaseName: string) {
  const sql = `CREATE TABLE IF NOT EXISTS \`${databaseName}\`.issues (id VARCHAR(255) PRIMARY KEY, title TEXT)`
  const result = spawnSync(DOLT_PATH, [
    "--host", "127.0.0.1",
    "--port", String(port),
    "--user", "root",
    "-p", "",
    "--no-tls",
    "sql", "-q", sql,
  ], { timeout: 5000, stdio: "ignore" })
  if (result.status !== 0) {
    throw new Error(`Failed to seed beads schema on port ${port}: exit ${result.status}`)
  }
}

/**
 * Navigate to /workspaces with a workspace cookie.
 * The workspacePair fixture must be used so the page shows the workspace
 * selector (with scan support) rather than the first-run onboarding screen.
 */
async function gotoWorkspaces(page: Page, workspaceId: string) {
  await page.context().addCookies([{
    name: "beads-workspace",
    value: workspaceId,
    domain: "localhost",
    path: "/",
  }])
  await page.goto("/workspaces")
  await expect(page.getByText("Select a workspace")).toBeVisible({ timeout: 10_000 })
}

/**
 * Open the AddWorkspaceDialog and expand the Advanced server section.
 * Click "Need to connect to a remote Dolt server?" link on the workspace
 * selector, then expand "Advanced: Connect to remote server" in the dialog.
 * No auto-scan runs (removed); the manual form is shown immediately.
 */
async function openServerDialog(page: Page) {
  await page.getByText("Need to connect to a remote Dolt server?").click()
  await expect(page.getByRole("dialog", { name: "Add Workspace" })).toBeVisible({ timeout: 5_000 })
  // The dialog opens with the Advanced section already expanded (defaultTab="server").
  // Wait for the server connection form to be visible.
  await expect(page.getByText("Connect to a remote Dolt server.")).toBeVisible({ timeout: 5_000 })
}

/**
 * Navigate to the manual entry form. If auto-scan showed scan-results,
 * clicks "Enter manually" to get to the form. If already in manual form, no-op.
 */
async function ensureManualForm(page: Page) {
  const enterManually = page.getByText("Enter manually")
  if (await enterManually.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await enterManually.click()
  }
  // Verify we're in the manual form
  await expect(page.getByRole("button", { name: "Discover" })).toBeVisible({ timeout: 5_000 })
}

/**
 * Fill in the manual connection form and click Discover.
 */
async function fillAndDiscover(page: Page, host: string, port: number) {
  await ensureManualForm(page)

  // Clear and fill host
  const hostInput = page.locator('input[placeholder="127.0.0.1"]')
  await hostInput.clear()
  await hostInput.fill(host)

  // Clear and fill port
  const portInput = page.locator('input[placeholder="3307"]')
  await portInput.clear()
  await portInput.fill(String(port))

  // Click Discover
  await page.getByRole("button", { name: "Discover" }).click()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Port-scan discovery flow", () => {
  test.beforeEach(async ({ page }) => {
    // Port-scan tests start their own managed Dolt servers and exercise the
    // scan UI flow. In CI, the webServer env and port allocation make these
    // unreliable. Run locally only.
    test.skip(!!process.env.CI, "Port-scan tests require local Dolt server control; skip in CI")
    await injectTauriMock(page)
  })

  // ── Happy path: manual entry -> Discover -> database selection ─────────

  test("manual entry discovers databases on server", async ({
    page, workspacePair,
  }) => {
    let server: ManagedDoltServer | null = null
    try {
      server = createManagedDoltServer({
        port: DISCOVER_TEST_PORT,
        databaseName: "scantest",
      })
      seedBeadsSchema(DISCOVER_TEST_PORT, "scantest")

      await gotoWorkspaces(page, workspacePair.alpha.workspaceId)
      await openServerDialog(page)

      // Fill in the managed server's host:port and discover databases
      await fillAndDiscover(page, "127.0.0.1", DISCOVER_TEST_PORT)

      // Verify Discover triggers
      await expect(page.getByText(/Discovering databases/)).toBeVisible({ timeout: 5_000 })

      // Verify database selection phase shows our database
      await expect(page.getByText(/database/)).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText("scantest")).toBeVisible()
    } finally {
      server?.cleanup()
    }
  })

  // ── Scan UI: verify scan-results view and Use button ───────────────────
  // This test relies on any Dolt servers already running on the system
  // (e.g. the worker Dolt, the beadbox project server). If Phase 1 finds
  // servers, we test the scan-results UI. If not, we test via manual form.

  test("server section shows manual form with Discover and Re-scan", async ({
    page, workspacePair,
  }) => {
    await gotoWorkspaces(page, workspacePair.alpha.workspaceId)
    await openServerDialog(page)

    // No auto-scan: manual form is shown immediately with help text
    await expect(page.getByRole("button", { name: "Discover" })).toBeVisible({ timeout: 5_000 })
    await expect(page.getByText("Re-scan ports")).toBeVisible()
  })

  // ── Re-scan: "Re-scan ports" re-runs Phase 1 ──────────────────────────

  test("re-scan ports from manual form", async ({
    page, workspacePair,
  }) => {
    await gotoWorkspaces(page, workspacePair.alpha.workspaceId)
    await openServerDialog(page)

    // Manual form is shown immediately (no auto-scan)
    await expect(page.getByRole("button", { name: "Discover" })).toBeVisible({ timeout: 5_000 })

    // Click "Re-scan ports" to trigger Phase 1 scan
    await page.getByText("Re-scan ports").click()

    // Should briefly show scanning state, then resolve
    const scanning = page.getByText("Scanning for local Dolt servers...")
    try {
      if (await scanning.isVisible({ timeout: 2_000 })) {
        await expect(scanning).not.toBeVisible({ timeout: 15_000 })
      }
    } catch {
      // Scan completed before we could observe it
    }

    // After re-scan, dialog should be in a valid state:
    // either found servers or back to manual form with Discover button
    const foundText = page.getByText(/Found \d+ server/)
    const discoverBtn = page.getByRole("button", { name: "Discover" })
    const foundVisible = await foundText.isVisible().catch(() => false)
    const manualVisible = await discoverBtn.isVisible().catch(() => false)
    expect(foundVisible || manualVisible).toBe(true)
  })

})
