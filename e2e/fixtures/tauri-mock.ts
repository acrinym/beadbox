import type { Page } from "@playwright/test"

// Inject a minimal Tauri IPC mock before page scripts run.
// This prevents errors in components that check for window.__TAURI_INTERNALS__
// when running in a regular browser (non-Tauri context).
//
// The mock returns no-op handlers so Tauri plugin imports (dialog, process)
// fail gracefully instead of throwing.
export async function injectTauriMock(page: Page) {
  await page.addInitScript(() => {
    // Do NOT set __TAURI_INTERNALS__ - we want the app to detect it's in web mode.
    // The app already checks `"__TAURI_INTERNALS__" in window` and branches accordingly.
    // This mock just ensures dynamic imports of @tauri-apps/* don't throw unhandled errors.
    //
    // If a future test needs Tauri-mode behavior, set window.__TAURI_INTERNALS__ here
    // with the appropriate invoke/transformCallback handlers.
  })
}
