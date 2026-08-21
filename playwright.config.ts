import { defineConfig, devices } from "@playwright/test"
import { join } from "path"
import { tmpdir } from "os"
import { findFreePort } from "./e2e/fixtures/dolt-server"

// Use an ephemeral port for the E2E webServer to avoid collisions on CI.
// Overridable via TEST_PORT env var for local development.
//
// CRITICAL: cache back into process.env so worker processes reading
// playwright.config.ts inherit the SAME port. Without this, workers
// re-evaluate `findFreePort()` and use a port that nothing's listening
// on, causing every test to fail with ECONNREFUSED.
const TEST_PORT = Number(process.env.TEST_PORT) || findFreePort()
process.env.TEST_PORT = String(TEST_PORT)

// Isolated registry files for e2e tests so they never touch real user registries.
// Only set once by the main process; workers inherit via env so they share the same file.
const TEST_REGISTRY_PATH =
  process.env.BEADS_REGISTRY_PATH || join(tmpdir(), "beadbox-e2e-registry.json")
if (!process.env.BEADS_REGISTRY_PATH) {
  process.env.BEADS_REGISTRY_PATH = TEST_REGISTRY_PATH
}
// Beadbox-format registry (used by the app's health check and workspace detection).
const TEST_BEADBOX_REGISTRY_PATH =
  process.env.BEADBOX_REGISTRY_PATH || join(tmpdir(), "beadbox-e2e-beadbox-registry.json")
if (!process.env.BEADBOX_REGISTRY_PATH) {
  process.env.BEADBOX_REGISTRY_PATH = TEST_BEADBOX_REGISTRY_PATH
}

export default defineConfig({
  testDir: "./e2e",
  // P6.5 (bb-3g1j.5): every legacy e2e/*.spec.ts test exercises a
  // surface that no longer exists post-migration:
  //   - HTTP routes /api/health and /api/version were Next.js API
  //     routes deleted in P6.1.
  //   - Every other test expects StartupGate to clear under vite-only,
  //     but vite-only correctly blocks because rpc.health.* throws
  //     RpcUnavailableError without a Tauri runtime (the dev-mode
  //     caveat retired in tb0/REPORT.md §9 still describes the
  //     underlying property).
  // Per super's P6.5 reframing: Gate 2 collapses into Gate 3 (Playwright
  // MCP against `bun run tauri:dev`) and into install-smoke (P5.6) — both
  // strictly stronger verifiers because they exercise the real runtime
  // context users hit. The v0.26 follow-up bead (super files separately)
  // rewrites the e2e suite to be Tauri-aware.
  // Spec files kept in tree as the rewrite's starting point.
  testIgnore: ["**/holistic/**", "**/*.spec.ts"],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  timeout: 20_000,
  expect: {
    timeout: 5_000,
    // Visual regression defaults (bb-8xey). toHaveScreenshot is opt-in per
    // call; these settings tune diff sensitivity to avoid flaky failures
    // from sub-pixel anti-aliasing while still catching real layout drift.
    //   - threshold: per-pixel color tolerance (0..1). 0.2 ignores AA noise.
    //   - maxDiffPixelRatio: allow 2% of pixels to differ (font rendering
    //     varies across font versions even on the same OS).
    //   - animations: disable CSS transitions during capture (deterministic).
    //   - scale: render at CSS pixel scale, ignoring devicePixelRatio.
    toHaveScreenshot: {
      threshold: 0.2,
      maxDiffPixelRatio: 0.02,
      animations: "disabled",
      scale: "css",
      caret: "hide",
    },
  },
  // Snapshot path layout: e2e/__screenshots__/<spec>/<testname>.png
  // Platform-neutral: CI (Linux) is the source of truth. macOS locals
  // will see diffs from font hinting on first run after a CI baseline
  // refresh; rerun with --update-snapshots locally if you need to
  // iterate, but commit baselines from CI.
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}{ext}",
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
      // P6.5 (bb-3g1j.5): Vite ignores the PORT env var the legacy
      // Next.js dev script honored; invoke vite via bun --cwd inside
      // the client package and pass --port + --strictPort. Without
      // --strictPort, Vite picks the next free port (5174) and the
      // webServer ready-wait times out on TEST_PORT.
      command: `bun --cwd=packages/client x vite --port ${TEST_PORT} --strictPort`,
      port: TEST_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        ...process.env,
        PORT: String(TEST_PORT),
        NODE_ENV: "production",
        BEADS_REGISTRY_PATH: process.env.BEADS_REGISTRY_PATH,
        BEADBOX_REGISTRY_PATH: process.env.BEADBOX_REGISTRY_PATH,
        BEADS_SKIP_LOCAL_DISCOVERY: "1",
      },
    },
  ],
})
