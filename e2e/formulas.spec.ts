import { test, expect } from "./fixtures/test-setup"
import { injectTauriMock } from "./fixtures/tauri-mock"
import type { Page } from "@playwright/test"
import { mkdirSync, writeFileSync } from "fs"
import { join } from "path"

// ---------------------------------------------------------------------------
// Test formula fixture: 4 steps with a parallel fan-out and a human gate
// ---------------------------------------------------------------------------

const TEST_FORMULA_TOML = `
formula = "e2e-test-workflow"
description = "Test formula for E2E validation"
version = 1
type = "workflow"

[vars.version]
description = "Version string"
required = true

[vars.label]
description = "Optional label"
default = "default-label"

[[steps]]
id = "setup"
title = "Setup environment"
type = "task"
description = "Prepare the test environment"

[[steps]]
id = "build-a"
title = "Build component A"
type = "task"
needs = ["setup"]
assignee = "eng1"
description = "Build the first component"

[[steps]]
id = "build-b"
title = "Build component B"
type = "task"
needs = ["setup"]
assignee = "eng2"
description = "Build the second component"

[[steps]]
id = "verify"
title = "Verify outputs"
type = "task"
needs = ["build-a", "build-b"]
description = "Run verification suite"

[steps.gate]
type = "human"
timeout = "1d"
`

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setupPage(page: Page, workspaceId: string) {
  const consoleErrors: string[] = []
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text()
      if (text.includes("posthog") || text.includes("PostHog")) return
      if (text.includes("favicon")) return
      if (text.includes("WebSocket")) return
      consoleErrors.push(text)
    }
  })

  await page.context().addCookies([{
    name: "beads-workspace",
    value: workspaceId,
    domain: "localhost",
    path: "/",
  }])

  return consoleErrors
}

// Enable the formulas EA feature flag via localStorage
async function enableFormulasFlag(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("beadbox_enable_formulas", "true")
  })
}

// Install the test formula into a workspace's .beads/formulas/ directory
function installTestFormula(projectDir: string): void {
  const formulasDir = join(projectDir, ".beads", "formulas")
  mkdirSync(formulasDir, { recursive: true })
  writeFileSync(
    join(formulasDir, "e2e-test-workflow.formula.toml"),
    TEST_FORMULA_TOML
  )
}

async function navigateToFormulas(page: Page) {
  await page.goto("/formulas")
  await expect(page.locator("header")).toBeVisible({ timeout: 15_000 })
  // Wait for async formula list to finish loading (CI can be slow with Dolt queries)
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {})
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Formulas tab", () => {
  test.beforeEach(async ({ page, testDb }) => {
    await injectTauriMock(page)
    installTestFormula(testDb.projectDir)
  })

  // 1. Navigation
  test("navigates to /formulas via header tab", async ({ page, testDb }) => {
    await setupPage(page, testDb.workspaceId)
    await enableFormulasFlag(page)
    await page.goto("/")
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 })

    // Click the Formulas tab in the header.
    // The Formulas tab renders as a <button> when enabled, <span> when disabled.
    // Wait for the button variant to appear after the feature flag applies.
    const formulasBtn = page.getByRole("button", { name: /Formulas/i })
    await expect(formulasBtn).toBeVisible({ timeout: 15_000 })
    await formulasBtn.click()
    await expect(page).toHaveURL(/\/formulas/, { timeout: 15_000 })

    // Two-panel layout should render
    await expect(page.locator("header")).toBeVisible({ timeout: 15_000 })
  })

  // 2. Formula list
  test("sidebar shows formula names with step counts", async ({ page, testDb }) => {
    await setupPage(page, testDb.workspaceId)
    await enableFormulasFlag(page)
    await navigateToFormulas(page)

    // The test formula should appear in the sidebar (CI needs extra time for Dolt queries).
    // Use .first() because the name appears in both the sidebar button and detail panel.
    await expect(page.getByText("e2e-test-workflow").first()).toBeVisible({ timeout: 20_000 })

    // Step count badge
    await expect(page.getByText("4 steps")).toBeVisible({ timeout: 5_000 })
  })

  // 3. Formula selection and detail panel
  test("clicking formula shows detail with title, description, and variables", async ({ page, testDb }) => {
    await setupPage(page, testDb.workspaceId)
    await enableFormulasFlag(page)
    await navigateToFormulas(page)

    // The single formula is auto-selected on first visit.
    // Wait for the detail panel to load rather than clicking (which would toggle it off).
    // Use .first() because the name appears in both sidebar and detail panel.
    await expect(page.getByText("e2e-test-workflow").first()).toBeVisible({ timeout: 10_000 })

    // Detail subpanel should show formula info
    await expect(page.getByText("Test formula for E2E validation")).toBeVisible({ timeout: 5_000 })

    // Variables section (use exact match to avoid matching "default-label")
    await expect(page.getByText("version", { exact: true })).toBeVisible()
    await expect(page.getByText("label", { exact: true })).toBeVisible()
  })

  // 4. DAG rendering with parallel fan-out
  test("DAG renders step nodes with parallel fan-out", async ({ page, testDb }) => {
    await setupPage(page, testDb.workspaceId)
    await enableFormulasFlag(page)
    await navigateToFormulas(page)

    // Auto-selected on first visit; wait for the Step Graph to render
    await expect(page.getByText("Step Graph")).toBeVisible({ timeout: 10_000 })

    // All 4 step nodes should be visible
    await expect(page.getByText("Setup environment")).toBeVisible()
    await expect(page.getByText("Build component A")).toBeVisible()
    await expect(page.getByText("Build component B")).toBeVisible()
    await expect(page.getByText("Verify outputs")).toBeVisible()

    // Gate badge on the verify step
    await expect(page.getByText("human").first()).toBeVisible()

    // Assignee badges
    await expect(page.getByText("@eng1")).toBeVisible()
    await expect(page.getByText("@eng2")).toBeVisible()
  })

  // 5. Step detail panel
  test("clicking step node opens detail panel, Escape closes it", async ({ page, testDb }) => {
    await setupPage(page, testDb.workspaceId)
    await enableFormulasFlag(page)
    await navigateToFormulas(page)

    // Auto-selected on first visit; wait for graph to render
    await expect(page.getByText("Step Graph")).toBeVisible({ timeout: 10_000 })

    // Click a step node
    await page.getByText("Setup environment").first().click()

    // Step detail panel should appear with description.
    // The description appears in both the DAG node and the detail panel,
    // so assert that at least 2 elements match (node + detail).
    await expect(page.getByText("Prepare the test environment")).toHaveCount(2, { timeout: 3_000 })

    // Press Escape to close the detail panel
    await page.keyboard.press("Escape")
    // After closing, only the DAG node description remains (1 element)
    await expect(page.getByText("Prepare the test environment")).toHaveCount(1, { timeout: 3_000 })
  })

  // 6. Preview flow
  test("Preview button opens modal with cooked formula output", async ({ page, testDb }) => {
    await setupPage(page, testDb.workspaceId)
    await enableFormulasFlag(page)
    await navigateToFormulas(page)

    // Auto-selected on first visit; wait for graph to render
    await expect(page.getByText("Step Graph")).toBeVisible({ timeout: 10_000 })

    // Click Preview button
    await page.getByRole("button", { name: /Preview/i }).click()

    // Modal should open
    await expect(page.getByText("Read-only preview")).toBeVisible({ timeout: 5_000 })

    // Cooked step titles should be visible in the preview
    await expect(page.getByRole("dialog").getByText("Setup environment")).toBeVisible()

    // Close modal
    await page.keyboard.press("Escape")
    await expect(page.getByText("Read-only preview")).not.toBeVisible({ timeout: 3_000 })
  })

  // 7. Pour flow
  test("Pour button opens modal, fills variables, and creates molecule", async ({ page, testDb }) => {
    await setupPage(page, testDb.workspaceId)
    await enableFormulasFlag(page)
    await navigateToFormulas(page)

    // Auto-selected on first visit; wait for graph to render
    await expect(page.getByText("Step Graph")).toBeVisible({ timeout: 10_000 })

    // Click Pour button
    await page.getByRole("button", { name: /Pour/i }).click()

    // Modal should open with variable form
    await expect(page.getByText("Create a live workflow")).toBeVisible({ timeout: 5_000 })

    // Fill required version variable (label is first, version is second input)
    const inputs = page.getByRole("dialog").getByRole("textbox")
    // Variables render alphabetically: label (0), version (1), assignee (2)
    await inputs.nth(1).fill("1.0.0-e2e")

    // Click Pour to submit
    await page.getByRole("dialog").getByRole("button", { name: "Pour" }).click()

    // Success toast should appear
    await expect(page.getByText("Molecule created")).toBeVisible({ timeout: 10_000 })
  })

  // 8. Keyboard navigation: Cmd+3
  test("Cmd+3 navigates to formulas page", async ({ page, testDb }) => {
    await setupPage(page, testDb.workspaceId)
    await enableFormulasFlag(page)
    await page.goto("/")
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 })

    // Press Cmd+3 (Meta+3 on Mac)
    await page.keyboard.press("Meta+3")
    await expect(page).toHaveURL(/\/formulas/, { timeout: 5_000 })
  })

  // 11. No formula selected shows placeholder
  test("shows placeholder when no formula is selected", async ({ page, testDb }) => {
    await setupPage(page, testDb.workspaceId)
    await enableFormulasFlag(page)
    await navigateToFormulas(page)

    // The single formula is auto-selected on first visit.
    // Click it to deselect, then verify the placeholder appears.
    // Use .first() because the name appears in both sidebar and detail panel.
    await expect(page.getByText("e2e-test-workflow").first()).toBeVisible({ timeout: 20_000 })
    await page.getByText("e2e-test-workflow").first().click()

    // Right panel shows placeholder when no formula is selected
    await expect(page.getByText("Select a formula to view its step graph")).toBeVisible({ timeout: 10_000 })
  })

  // 12. Feature flag gating
  test("formulas tab is disabled without feature flag", async ({ page, testDb }) => {
    await setupPage(page, testDb.workspaceId)
    // Do NOT enable the formulas flag
    await page.goto("/")
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 })

    // Formulas tab should show "EA" badge (disabled state)
    await expect(page.getByText("EA", { exact: true })).toBeVisible({ timeout: 5_000 })
  })
})
