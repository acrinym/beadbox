/**
 * Shared helpers for holistic tests.
 *
 * The standalone server's startup health check can take 15-25s under CI load
 * (dolt version + bd version + bd list). These helpers provide adequate
 * timeouts and diagnostics for tests that navigate to the main page.
 */

import type { Page } from "@playwright/test"
import { expect } from "@playwright/test"

/** How long to wait for the startup gate to finish (healthy or error). */
const STARTUP_GATE_TIMEOUT = 30_000

/**
 * Wait for the app to finish its startup health check and render the main UI.
 * Captures diagnostic info if the header doesn't appear in time.
 */
export async function waitForAppReady(page: Page, label = "test") {
  try {
    await expect(page.locator("header")).toBeVisible({ timeout: STARTUP_GATE_TIMEOUT })
  } catch {
    // Capture diagnostics before re-throwing
    const bodyText = await page.locator("body").innerText().catch(() => "(failed to read)")
    const url = page.url()
    console.error(
      `[diag:${label}] header not visible after ${STARTUP_GATE_TIMEOUT}ms.\n` +
      `  URL: ${url}\n` +
      `  Body text: ${bodyText.slice(0, 500)}`
    )
    await page.screenshot({ path: `test-results/diag-startup-gate-${label}.png` }).catch(() => {})
    // Re-throw with context
    throw new Error(
      `Startup gate did not reach healthy state within ${STARTUP_GATE_TIMEOUT}ms. ` +
      `Page shows: "${bodyText.slice(0, 200)}". ` +
      `This usually means the health check (bd list) is slow or failing under CI load.`
    )
  }
}

/**
 * Wait for the startup gate to show an error screen (not healthy).
 * Used by first-run tests that expect the health check to fail.
 */
export async function waitForStartupError(page: Page, label = "test") {
  await expect(
    page.getByText("Database not found")
      .or(page.getByText("Database server unreachable"))
      .or(page.getByText("Startup error"))
      .or(page.getByText("Connection timed out"))
  ).toBeVisible({ timeout: STARTUP_GATE_TIMEOUT })
}
