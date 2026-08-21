import { defineConfig, devices } from "@playwright/test"
import { join, resolve } from "path"
import { tmpdir } from "os"
import { findFreePort } from "../fixtures/dolt-server"

// Resolve the project root (e2e/holistic/../../ = src/)
const PROJECT_ROOT = resolve(__dirname, "..", "..")

/**
 * Playwright configuration for holistic packaging verification tests.
 *
 * Most specs reuse the standard e2e test-setup fixtures (Dolt template data,
 * dev server) for deterministic assertions. The smoke spec uses the app-launcher
 * fixture for packaged .app lifecycle checks.
 *
 * Run: npx playwright test --config e2e/holistic/playwright.holistic.config.ts
 */

// Use an ephemeral port to avoid collisions on CI.
const TEST_PORT = Number(process.env.TEST_PORT) || findFreePort()

// Isolated registry files so holistic tests never touch ~/.beads/registry.json.
const TEST_REGISTRY_PATH =
  process.env.BEADS_REGISTRY_PATH || join(tmpdir(), "beadbox-holistic-registry.json")
if (!process.env.BEADS_REGISTRY_PATH) {
  process.env.BEADS_REGISTRY_PATH = TEST_REGISTRY_PATH
}
const TEST_BEADBOX_REGISTRY_PATH =
  process.env.BEADBOX_REGISTRY_PATH || join(tmpdir(), "beadbox-holistic-beadbox-registry.json")
if (!process.env.BEADBOX_REGISTRY_PATH) {
  process.env.BEADBOX_REGISTRY_PATH = TEST_BEADBOX_REGISTRY_PATH
}

export default defineConfig({
  testDir: ".",
  testIgnore: ["**/app-lifecycle*"],
  fullyParallel: false, // Sequential: tests share worker-scoped fixtures
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // Single worker avoids Dolt port conflicts and registry races
  globalSetup: "../global-setup.ts",
  globalTeardown: "../global-teardown.ts",
  reporter: process.env.CI
    ? [
        ["html", { open: "never", outputFolder: "../../playwright-report-holistic" }],
        ["junit", { outputFile: "../../test-results/holistic-junit.xml" }],
        ["github"],
      ]
    : [
        ["html", { open: "never", outputFolder: "../../playwright-report-holistic" }],
        ["junit", { outputFile: "../../test-results/holistic-junit.xml" }],
        ["list"],
      ],
  timeout: 60_000,
  expect: {
    // The startup health check runs dolt version (5s) + bd version (5s) +
    // bd list (15s timeout). Under CI load (concurrent release jobs on
    // same runner), these can approach their maximums. 30s accommodates
    // the health check pipeline plus React rendering.
    timeout: 30_000,
  },
  use: {
    baseURL: `http://localhost:${TEST_PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: `bun --cwd=packages/client run dev`,
      port: TEST_PORT,
      cwd: PROJECT_ROOT,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        ...process.env,
        PORT: String(TEST_PORT),
        NODE_ENV: "production",
        BEADS_REGISTRY_PATH: TEST_REGISTRY_PATH,
        BEADBOX_REGISTRY_PATH: process.env.BEADBOX_REGISTRY_PATH,
        BEADS_SKIP_LOCAL_DISCOVERY: "1",
      },
    },
  ],
})
