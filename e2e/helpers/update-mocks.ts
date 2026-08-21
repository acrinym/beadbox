import type { Page } from "@playwright/test"

// A fake GitHub release response matching the shape from api.github.com/repos/:owner/:repo/releases/latest
export interface MockRelease {
  version: string
  body?: string
  publishedAt?: string
}

const DEFAULT_RELEASE_BODY = `## What's New

- Fixed critical bug in workspace switching
- Improved performance of epic tree rendering
- Added keyboard shortcut for refresh`

function buildGitHubRelease(release: MockRelease) {
  const version = release.version.replace(/^v/, "")
  // Include assets for all platforms and architectures so the update checker
  // can match regardless of how the test browser reports its platform/arch.
  return {
    tag_name: `v${version}`,
    html_url: `https://github.com/beadbox/beadbox/releases/tag/v${version}`,
    published_at: release.publishedAt ?? "2026-02-10T12:00:00Z",
    body: release.body ?? DEFAULT_RELEASE_BODY,
    draft: false,
    prerelease: false,
    assets: [
      {
        id: 10001,
        name: `Beadbox-${version}-macOS-arm64.dmg`,
        browser_download_url: `https://github.com/beadbox/beadbox/releases/download/v${version}/Beadbox-${version}-macOS-arm64.dmg`,
      },
      {
        id: 10002,
        name: `Beadbox-${version}-macOS-x64.dmg`,
        browser_download_url: `https://github.com/beadbox/beadbox/releases/download/v${version}/Beadbox-${version}-macOS-x64.dmg`,
      },
      {
        id: 10003,
        name: `Beadbox-${version}-Linux-amd64.AppImage`,
        browser_download_url: `https://github.com/beadbox/beadbox/releases/download/v${version}/Beadbox-${version}-Linux-amd64.AppImage`,
      },
      {
        id: 10004,
        name: `Beadbox-${version}-Windows-x64-setup.exe`,
        browser_download_url: `https://github.com/beadbox/beadbox/releases/download/v${version}/Beadbox-${version}-Windows-x64-setup.exe`,
      },
    ],
  }
}

// Intercept the GitHub releases API. Uses a URL regex instead of glob patterns
// because the repo path (e.g. beadbox/beadbox) contains a slash that glob * can't match.
const RELEASES_URL_RE = /api\.github\.com\/repos\/[^/]+\/[^/]+\/releases/

/**
 * Mock the GitHub releases API to return an available update.
 * Intercepts both /releases/latest and /releases list endpoints.
 */
export async function mockUpdateAvailable(page: Page, release: MockRelease) {
  const ghRelease = buildGitHubRelease(release)

  await page.route(RELEASES_URL_RE, (route) => {
    const url = route.request().url()
    if (url.endsWith("/latest")) {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(ghRelease),
      })
    } else {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([ghRelease]),
      })
    }
  })
}

/**
 * Mock the GitHub releases API to indicate no update is available.
 * Returns a release with version 0.0.0 which will always be <= current (also 0.0.0 in tests).
 */
export async function mockNoUpdate(page: Page) {
  const ghRelease = buildGitHubRelease({ version: "0.0.0" })

  await page.route(RELEASES_URL_RE, (route) => {
    const url = route.request().url()
    if (url.endsWith("/latest")) {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(ghRelease),
      })
    } else {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([ghRelease]),
      })
    }
  })
}

/**
 * NDJSON event types matching the download stream protocol.
 */
export type DownloadEvent =
  | { type: "progress"; downloaded: number; total: number }
  | { type: "complete"; filePath: string; platform?: string }
  | { type: "error"; message: string }

/**
 * Mock POST /api/update/download to stream NDJSON events.
 */
export async function mockDownloadStream(page: Page, events: DownloadEvent[]) {
  await page.route("**/api/update/download", (route) => {
    if (route.request().method() !== "POST") {
      route.fallback()
      return
    }

    const body = events.map((e) => JSON.stringify(e) + "\n").join("")

    route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body,
    })
  })
}

/**
 * Mock POST /api/update/download to send initial progress then end the stream.
 * The stream completes (no more data), which triggers the "Download ended unexpectedly"
 * error in the downloader. For cancel testing, the key is that the download is
 * in "downloading" state long enough to click Cancel.
 *
 * We use a page.evaluate approach to create a delayed response.
 */
export async function mockDownloadSlow(page: Page) {
  await page.route("**/api/update/download", (route) => {
    if (route.request().method() === "POST") {
      // Send multiple progress events to keep the stream alive
      const events = []
      for (let i = 0; i < 20; i++) {
        events.push(JSON.stringify({ type: "progress", downloaded: i * 524288, total: 10485760 }) + "\n")
      }
      route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: events.join(""),
      })
      return
    }
    route.fallback()
  })
}

/**
 * Mock DELETE /api/update/download (cancel endpoint).
 */
export async function mockDownloadCancel(page: Page) {
  await page.route("**/api/update/download", (route) => {
    if (route.request().method() === "DELETE") {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      })
      return
    }
    route.fallback()
  })
}

/**
 * Mock POST /api/update/install with a delay to observe the "installing" state.
 */
export async function mockInstallWithDelay(page: Page, platform: string = "darwin", delayMs: number = 2000) {
  await page.route("**/api/update/install", async (route) => {
    if (route.request().method() !== "POST") {
      route.fallback()
      return
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, platform }),
    })
  })
}
