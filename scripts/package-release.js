#!/usr/bin/env node
// Tarball + checksum the Tauri-built bundle for release distribution.
//
// P5.3 collapse (bb-x6lg.3): the previous 304-LOC version flattened pnpm,
// dereferenced symlinks, copied .next/standalone, ran a whitelist cleanup,
// and patched server.js — all to package the Next.js Node-sidecar that the
// migration removed. Post-cutover, Tauri builds the .app/.dmg/.AppImage/.msi
// directly from packages/client/dist + the Bun-compiled sidecar binary
// (P4.2 + P5.1), so this script's job collapses to: read version, tarball
// the bundle dir, SHA256 the result.
//
// No whitelist mode anymore — Tauri owns bundle composition; if a file lands
// in src-tauri/target/release/bundle/ it's there because Tauri put it there.
// Uses execFileSync (no shell) so future inputs can't be shell-injected.
//
// Usage: node scripts/package-release.js

const { execFileSync } = require("child_process")
const { existsSync, mkdirSync, rmSync } = require("fs")
const path = require("path")

const REPO_ROOT = path.join(__dirname, "..")
const VERSION = require(path.join(REPO_ROOT, "package.json")).version
const BUNDLE_DIR = path.join(REPO_ROOT, "src-tauri", "target", "release", "bundle")
const DIST_DIR = path.join(REPO_ROOT, "dist")
const TARBALL = `beadbox-${VERSION}.tar.gz`

if (!existsSync(BUNDLE_DIR)) {
  console.error(`Bundle dir not found: ${BUNDLE_DIR}`)
  console.error("Run `bun run tauri build` first.")
  process.exit(1)
}

if (existsSync(DIST_DIR)) rmSync(DIST_DIR, { recursive: true })
mkdirSync(DIST_DIR, { recursive: true })

const tarballPath = path.join(DIST_DIR, TARBALL)
console.log(`Tarballing ${BUNDLE_DIR} → dist/${TARBALL}`)
execFileSync("tar", [
  "-czf",
  tarballPath,
  "-C",
  path.dirname(BUNDLE_DIR),
  path.basename(BUNDLE_DIR),
])

const sha256Bin = process.platform === "darwin" ? "shasum" : "sha256sum"
const sha256Args = process.platform === "darwin" ? ["-a", "256", tarballPath] : [tarballPath]
const sha256 = execFileSync(sha256Bin, sha256Args).toString().split(" ")[0]
console.log(`SHA256: ${sha256}`)
console.log(`Release package: dist/${TARBALL}`)
