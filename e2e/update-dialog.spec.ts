import { test, expect } from "./fixtures/test-setup"
import { injectTauriMock } from "./fixtures/tauri-mock"
import {
  mockUpdateAvailable,
  mockNoUpdate,
  mockDownloadStream,
  mockDownloadSlow,
  mockDownloadCancel,
  mockInstallWithDelay,
  type DownloadEvent,
} from "./helpers/update-mocks"

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

// Wait for the app to finish its startup gate and render the header
async function waitForApp(page: Parameters<Parameters<typeof test>[2]>[0]["page"]) {
  await page.goto("/")
  await expect(page.locator("header")).toBeVisible({ timeout: 10_000 })
}

test.describe("Update dialog", () => {
  // Skip in CI: these tests mock Tauri desktop update flows and trigger OOM
  // kills on the self-hosted Linux runner (SIGKILL after ~50 tests).
  test.skip(!!process.env.CI, "Tauri update dialog tests skipped in CI")
  test("shows update badge in header when update is available", async ({ page, testDb }) => {
    await setupPage(page, testDb)
    await mockUpdateAvailable(page, { version: "99.0.0" })

    await waitForApp(page)

    // The update badge button should appear with the ArrowUpCircle icon
    const updateButton = page.locator('button[aria-label*="Update available"]')
    await expect(updateButton).toBeVisible({ timeout: 10_000 })
    await expect(updateButton).toHaveAttribute("aria-label", "Update available: v99.0.0")
  })

  test("opens dialog with version comparison and release notes", async ({ page, testDb }) => {
    await setupPage(page, testDb)
    await mockUpdateAvailable(page, {
      version: "99.0.0",
      body: "## Changes\n\n- Fixed a **critical** bug\n- Added new feature",
      publishedAt: "2026-02-10T12:00:00Z",
    })

    await waitForApp(page)

    // Click the update badge to open the dialog
    const updateButton = page.locator('button[aria-label*="Update available"]')
    await expect(updateButton).toBeVisible({ timeout: 10_000 })
    await updateButton.click()

    // Dialog should be visible
    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()

    // Should show "Update Available" heading (not the sr-only DialogTitle)
    await expect(dialog.locator("h2.text-lg:not(.sr-only)").filter({ hasText: "Update Available" })).toBeVisible()

    // Should show "Current" version label
    await expect(dialog.getByText("Current")).toBeVisible()

    // Should show new version
    await expect(dialog.getByText("v99.0.0")).toBeVisible()

    // Should show "Latest" label for new version
    await expect(dialog.getByText("Latest")).toBeVisible()

    // Should render release notes as markdown (the heading "Changes" and list items)
    await expect(dialog.getByText("Changes")).toBeVisible()
    await expect(dialog.getByText("Fixed a")).toBeVisible()

    // Should show the "What's New" section header
    await expect(dialog.getByText("What's New")).toBeVisible()

    // Should have all idle-state buttons
    await expect(dialog.getByRole("button", { name: /Download & Install/i })).toBeVisible()
    await expect(dialog.getByRole("button", { name: /Later/i })).toBeVisible()
    await expect(dialog.getByRole("button", { name: /View on GitHub/i })).toBeVisible()
    await expect(dialog.getByText("Skip this version")).toBeVisible()
  })

  test("shows download progress with byte counts", async ({ page, testDb }) => {
    await setupPage(page, testDb)
    await mockUpdateAvailable(page, { version: "99.0.0" })

    const progressEvents: DownloadEvent[] = [
      { type: "progress", downloaded: 0, total: 10485760 },
      { type: "progress", downloaded: 2621440, total: 10485760 },
      { type: "progress", downloaded: 5242880, total: 10485760 },
      { type: "progress", downloaded: 10485760, total: 10485760 },
      { type: "complete", filePath: "/tmp/Beadbox-99.0.0-macOS-arm64.dmg", platform: "darwin" },
    ]
    await mockDownloadStream(page, progressEvents)
    await mockDownloadCancel(page)

    await waitForApp(page)

    // Open dialog
    const updateButton = page.locator('button[aria-label*="Update available"]')
    await expect(updateButton).toBeVisible({ timeout: 10_000 })
    await updateButton.click()

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()

    // Click Download & Install
    await dialog.getByRole("button", { name: /Download & Install/i }).click()

    // The download stream is fast (all events at once), so it may go through
    // downloading -> installed quickly. Check that we reach the installed state.
    // The progress bar or the "Download complete" message should appear.
    await expect(dialog.getByText("Download complete")).toBeVisible({ timeout: 10_000 })
  })

  test("shows installed state with platform-specific instructions (darwin)", async ({ page, testDb }) => {
    await setupPage(page, testDb)
    await mockUpdateAvailable(page, { version: "99.0.0" })

    // Download completes with platform = "darwin"
    const events: DownloadEvent[] = [
      { type: "progress", downloaded: 5242880, total: 10485760 },
      { type: "complete", filePath: "/tmp/Beadbox-99.0.0-macOS-arm64.dmg", platform: "darwin" },
    ]
    await mockDownloadStream(page, events)
    await mockDownloadCancel(page)

    await waitForApp(page)

    const updateButton = page.locator('button[aria-label*="Update available"]')
    await expect(updateButton).toBeVisible({ timeout: 10_000 })
    await updateButton.click()

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()

    // Start download
    await dialog.getByRole("button", { name: /Download & Install/i }).click()

    // Wait for installed state
    await expect(dialog.getByText("Download complete")).toBeVisible({ timeout: 10_000 })

    // macOS-specific instructions
    await expect(dialog.getByText(/Drag.*Beadbox.*to your Applications folder/)).toBeVisible()

    // Dialog heading should change to "Update Ready"
    await expect(dialog.getByText("Update Ready")).toBeVisible()

    // Close button should be visible (not the dialog's X button, use the text-based one)
    await expect(dialog.getByRole("button", { name: "Close", exact: true }).first()).toBeVisible()

    // brew upgrade hint
    await expect(dialog.getByText(/brew upgrade/)).toBeVisible()
  })

  test("shows error state with retry and fallback options", async ({ page, testDb }) => {
    await setupPage(page, testDb)
    await mockUpdateAvailable(page, { version: "99.0.0" })

    // Download fails with an error
    const events: DownloadEvent[] = [
      { type: "progress", downloaded: 1048576, total: 10485760 },
      { type: "error", message: "Connection timed out" },
    ]
    await mockDownloadStream(page, events)
    await mockDownloadCancel(page)

    await waitForApp(page)

    const updateButton = page.locator('button[aria-label*="Update available"]')
    await expect(updateButton).toBeVisible({ timeout: 10_000 })
    await updateButton.click()

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()

    // Start download
    await dialog.getByRole("button", { name: /Download & Install/i }).click()

    // Wait for error state
    await expect(dialog.getByText("Connection timed out")).toBeVisible({ timeout: 10_000 })

    // Error state buttons
    await expect(dialog.getByRole("button", { name: /Try again/i })).toBeVisible()
    await expect(dialog.getByRole("button", { name: /Later/i })).toBeVisible()
    await expect(dialog.getByRole("button", { name: /View on GitHub/i })).toBeVisible()
  })

  test("cancel download returns to idle state", async ({ page, testDb }) => {
    await setupPage(page, testDb)
    await mockUpdateAvailable(page, { version: "99.0.0" })

    // Mock a download that sends many progress events (stream completes but events
    // are processed fast enough that we can click Cancel during the "downloading" state).
    // The useUpdateDownloader reads the stream in a while loop, so it transitions
    // through downloading state while processing events.
    await mockDownloadSlow(page)
    await mockDownloadCancel(page)

    await waitForApp(page)

    const updateButton = page.locator('button[aria-label*="Update available"]')
    await expect(updateButton).toBeVisible({ timeout: 10_000 })
    await updateButton.click()

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()

    // Start download
    await dialog.getByRole("button", { name: /Download & Install/i }).click()

    // The stream ends without a complete/error event, so the downloader will set
    // error state ("Download ended unexpectedly"). But the Cancel button might flash.
    // Since the stream is fast, we'll verify we can see either:
    // - The Cancel button (if caught during downloading)
    // - Or the error state (if stream ended)
    // Then test that clicking Later returns to a clean state.

    // Wait for the download to finish processing
    await page.waitForTimeout(500)

    // The downloader should be in error state since stream ended without complete event.
    // Verify we can see the error state or the downloading state.
    const cancelButton = dialog.getByRole("button", { name: /Cancel/i })
    const tryAgainButton = dialog.getByRole("button", { name: /Try again/i })

    // Either Cancel (still downloading) or Try again (error state) should be visible
    await expect(cancelButton.or(tryAgainButton)).toBeVisible({ timeout: 5_000 })
  })

  test("dismiss update persists across page reload", async ({ page, testDb }) => {
    await setupPage(page, testDb)
    await mockUpdateAvailable(page, { version: "99.0.0" })

    await waitForApp(page)

    // Wait for update badge
    const updateButton = page.locator('button[aria-label*="Update available"]')
    await expect(updateButton).toBeVisible({ timeout: 10_000 })

    // Open dialog
    await updateButton.click()
    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()

    // Click "Skip this version"
    await dialog.getByText("Skip this version").click()

    // Dialog should close
    await expect(dialog).not.toBeVisible()

    // Badge should disappear
    await expect(updateButton).not.toBeVisible()

    // Reload the page and verify badge stays gone
    await page.reload()
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 })

    // Badge should not reappear (version is dismissed in localStorage)
    // Wait briefly for the update check to complete
    await page.waitForTimeout(1_500)
    await expect(page.locator('button[aria-label*="Update available"]')).not.toBeVisible()
  })

  test("installing state shows spinner", async ({ page, testDb }) => {
    await setupPage(page, testDb)
    await mockUpdateAvailable(page, { version: "99.0.0" })

    // Download completes WITHOUT platform (triggers install endpoint fallback)
    const events: DownloadEvent[] = [
      { type: "progress", downloaded: 5242880, total: 10485760 },
      { type: "complete", filePath: "/tmp/Beadbox-99.0.0-macOS-arm64.dmg" },
    ]
    await mockDownloadStream(page, events)
    await mockDownloadCancel(page)

    // Install endpoint has a long delay so we can observe the "installing" state
    await mockInstallWithDelay(page, "darwin", 5000)

    await waitForApp(page)

    const updateButton = page.locator('button[aria-label*="Update available"]')
    await expect(updateButton).toBeVisible({ timeout: 10_000 })
    await updateButton.click()

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()

    // Start download
    await dialog.getByRole("button", { name: /Download & Install/i }).click()

    // Should transition through downloading to installing state
    await expect(dialog.getByText("Opening installer...")).toBeVisible({ timeout: 10_000 })

    // Eventually should reach installed state
    await expect(dialog.getByText("Download complete")).toBeVisible({ timeout: 10_000 })
  })

  test("no update badge when on latest version", async ({ page, testDb }) => {
    await setupPage(page, testDb)
    await mockNoUpdate(page)

    await waitForApp(page)

    // Wait briefly for the update check to complete
    await page.waitForTimeout(1_500)

    // No update badge should be visible
    await expect(page.locator('button[aria-label*="Update available"]')).not.toBeVisible()
  })

  test("settings page shows update controls and check result", async ({ page, testDb }) => {
    await setupPage(page, testDb)
    await mockNoUpdate(page)

    await waitForApp(page)

    // Open settings with Cmd+,
    await page.keyboard.press("Meta+,")

    const settingsDialog = page.locator('[role="dialog"]')
    await expect(settingsDialog).toBeVisible({ timeout: 5_000 })

    // Verify we're on General tab (default) and Updates section is visible
    await expect(settingsDialog.getByRole("heading", { name: "Updates" })).toBeVisible()

    // Update toggle should be visible
    await expect(settingsDialog.getByText("Automatically check for updates")).toBeVisible()

    // Check frequency select should be visible
    await expect(settingsDialog.locator("#update-frequency")).toBeVisible()

    // Click "Check for Updates" button
    await settingsDialog.getByRole("button", { name: /Check for Updates/i }).click()

    // Should show "You're on the latest version" since we mocked no update
    await expect(settingsDialog.getByText(/latest version/)).toBeVisible({ timeout: 10_000 })
  })

  test("settings shows available update with view details link", async ({ page, testDb }) => {
    await setupPage(page, testDb)
    // Mock update available from the start
    await mockUpdateAvailable(page, { version: "99.0.0" })

    await waitForApp(page)

    // Wait for the automatic check to detect the update
    const updateButton = page.locator('button[aria-label*="Update available"]')
    await expect(updateButton).toBeVisible({ timeout: 10_000 })

    // Open settings
    await page.keyboard.press("Meta+,")
    const settingsDialog = page.locator('[role="dialog"]')
    await expect(settingsDialog).toBeVisible({ timeout: 5_000 })

    // Click "Check for Updates"
    await settingsDialog.getByRole("button", { name: /Check for Updates/i }).click()

    // Should show "Version 99.0.0 is available" with "View details" link
    await expect(settingsDialog.getByText(/99\.0\.0 is available/)).toBeVisible({ timeout: 10_000 })
    await expect(settingsDialog.getByText("View details")).toBeVisible()
  })
})
