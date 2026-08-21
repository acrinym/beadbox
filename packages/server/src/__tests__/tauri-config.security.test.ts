// Tauri shell security configuration (beadbox-l5i.3, items 2 and 5).
//
// In the stdio architecture there is no HTTP endpoint to put a session token
// or an Origin check in front of. The equivalent control — "which web origins
// can reach the mutating surface" — lives in Tauri's capability system, so
// the bead's item 2 is enforced here rather than in a request handler.
//
// Item 2 (origin scope): src-tauri/capabilities/default.json previously
// granted IPC to `http://127.0.0.1:*/*` and `http://localhost:*/*` — i.e. ANY
// page on ANY localhost port, which is exactly the drive-by / DNS-rebinding
// class the bead names. It is not needed even for `tauri dev`: Tauri treats a
// URL relative to devUrl as Origin::Local (webview/mod.rs is_local_url, "or if
// relative to `devUrl` or `frontendDist`"), so the dev server already has IPC
// without a remote grant.
//
// Item 5 (CSP / updater): the CSP carried Next.js-era network origins that
// nothing can reach any more, including `http://127.0.0.1:*` in SCRIPT-SRC —
// which would have let anything listening on any local port serve executable
// script into the webview.

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..")
const TAURI_DIR = join(REPO_ROOT, "src-tauri")

function readJson(...parts: string[]): Record<string, unknown> {
  return JSON.parse(readFileSync(join(TAURI_DIR, ...parts), "utf-8"))
}

// biome-ignore lint/suspicious/noExplicitAny: walking untyped JSON config
const conf = readJson("tauri.conf.json") as any
// biome-ignore lint/suspicious/noExplicitAny: walking untyped JSON config
const defaultCap = readJson("capabilities", "default.json") as any

describe("capability scope (item 2)", () => {
  test("grants IPC to no remote origin", () => {
    // A `remote` block would re-open the whole rpc.* surface — including
    // console.run — to pages Beadbox did not serve.
    expect(defaultCap.remote).toBeUndefined()
  })

  test("permissions stay on the known-minimal set", () => {
    // Drift guard: a new permission here is a deliberate decision, not a
    // side effect of adding a plugin.
    expect(defaultCap.permissions).toEqual([
      "core:default",
      "js:default",
      "dialog:allow-open",
      "process:allow-exit",
      "process:allow-restart",
      "updater:default",
    ])
  })

  test("the mobile capability grants no remote origin either", () => {
    // biome-ignore lint/suspicious/noExplicitAny: walking untyped JSON config
    const mobileCap = readJson("capabilities", "mobile.json") as any
    expect(mobileCap.remote).toBeUndefined()
  })
})

describe("content security policy (item 5)", () => {
  const csp: string = conf.app.security.csp

  test("is set", () => {
    expect(typeof csp).toBe("string")
    expect(csp.length).toBeGreaterThan(0)
  })

  test("allows no plaintext-http or websocket origin", () => {
    // ipc: and http://ipc.localhost are Tauri's own IPC transport, not network
    // reachable, so they are excluded by exact match. An https:// origin is
    // deliberately NOT banned here — outbound telemetry may legitimately need
    // one — but plaintext http:// and ws:// to a local port never can.
    const withoutIpc = csp.replaceAll("http://ipc.localhost", "").replaceAll("ipc:", "")
    expect(withoutIpc).not.toMatch(/http:\/\//)
    expect(withoutIpc).not.toMatch(/wss?:\/\//)
  })

  test("script-src names no network origin at all", () => {
    // The sharpest edge of the old CSP: `script-src ... http://127.0.0.1:*`
    // meant anything listening on any local port could serve executable code
    // into the webview. Script may only come from the app bundle.
    const scriptSrc = csp.split(";").find((d) => d.trim().startsWith("script-src")) ?? ""
    expect(scriptSrc).not.toContain("://")
  })

  test("script-src permits no eval", () => {
    // Verified against the production bundle: 0 occurrences of `eval(` and
    // `new Function(` across all 16 emitted chunks.
    const scriptSrc = csp.split(";").find((d) => d.trim().startsWith("script-src")) ?? ""
    expect(scriptSrc).not.toContain("unsafe-eval")
  })

  test("keeps a self-only default-src", () => {
    const defaultSrc = csp.split(";").find((d) => d.trim().startsWith("default-src")) ?? ""
    expect(defaultSrc).toContain("'self'")
  })

  test("still permits inline styles, which Radix requires at runtime", () => {
    // Documented exception, asserted so it is not "tightened" by accident and
    // silently breaks every popover and dialog.
    const styleSrc = csp.split(";").find((d) => d.trim().startsWith("style-src")) ?? ""
    expect(styleSrc).toContain("'unsafe-inline'")
  })
})

describe("updater signing (item 5)", () => {
  test("ships the public key only", () => {
    const raw = readFileSync(join(TAURI_DIR, "tauri.conf.json"), "utf-8")
    expect(conf.plugins.updater.pubkey).toBeTruthy()
    // minisign secret keys carry this header; the private key must exist only
    // as ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }} in the release workflow.
    expect(raw).not.toContain("minisign encrypted secret key")
    expect(raw).not.toContain("PRIVATE KEY")
    expect(Buffer.from(conf.plugins.updater.pubkey, "base64").toString("utf-8")).toContain(
      "minisign public key",
    )
  })

  test("fetches its manifest over https only", () => {
    for (const endpoint of conf.plugins.updater.endpoints as string[]) {
      expect(endpoint.startsWith("https://")).toBe(true)
    }
  })
})
