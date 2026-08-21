import type { Page, Locator } from "@playwright/test"
import { expect } from "@playwright/test"

/**
 * Visual regression helper (bb-8xey).
 *
 * Wraps Playwright's `toHaveScreenshot` with the masks Beadbox needs to keep
 * baselines stable across runs and releases:
 *
 *  - DevBadge (bottom-right corner): shows app version + build ID + git
 *    commit, all volatile across runs and releases.
 *
 * Usage in a spec:
 *
 *   import { snapshotPage } from "./helpers/visual"
 *
 *   test("main page visual baseline", async ({ page, testDb }) => {
 *     await page.goto("/")
 *     await expect(page.locator("header")).toBeVisible()
 *     await snapshotPage(page, "main-page.png")
 *   })
 *
 * For a region rather than the whole page, pass a locator:
 *
 *   await snapshotElement(page.locator("[data-testid='epic-tree']"), "tree.png")
 *
 * To regenerate baselines after intentional UI changes:
 *
 *   pnpm test:e2e --update-snapshots
 *
 * Baselines live in `e2e/__screenshots__/<spec>/<name>-<platform>.png`. CI
 * (Linux) is the source of truth for committed baselines; macOS locals will
 * see diffs from font hinting and should regenerate before committing.
 */

const DEFAULT_MASKS = (page: Page): Locator[] => [
  page.locator('[data-testid="dev-badge"]'),
]

interface SnapshotOptions {
  /** Extra locators to mask in addition to the defaults. */
  mask?: Locator[]
  /** Whole page (false, default) or just the visible viewport (true). */
  fullPage?: boolean
}

export async function snapshotPage(
  page: Page,
  name: string,
  opts: SnapshotOptions = {},
): Promise<void> {
  const mask = [...DEFAULT_MASKS(page), ...(opts.mask ?? [])]
  await expect(page).toHaveScreenshot(name, {
    mask,
    fullPage: opts.fullPage ?? true,
  })
}

export async function snapshotElement(
  locator: Locator,
  name: string,
  opts: SnapshotOptions = {},
): Promise<void> {
  const page = locator.page()
  const mask = [...DEFAULT_MASKS(page), ...(opts.mask ?? [])]
  await expect(locator).toHaveScreenshot(name, { mask })
}
