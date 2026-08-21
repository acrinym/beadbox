// bb-nxqh: suppress one specific known-upstream deprecation warning.
//
// react-force-graph-3d (1.29.x) bundles its own copy of three.js. That
// bundled three.js prints
//
//   THREE.THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.
//
// the first time a force-graph component instantiates an AudioListener
// (which calls `new Clock()` internally — see
// node_modules/.bun/react-force-graph-3d@1.29.1/.../react-force-graph-3d.js
// at the AudioListener constructor). We can't fix this at source without
// forking the dep; the doubled `THREE.THREE.` prefix is from three.js's
// `warn()` helper prepending its own namespace to messages that already
// include it.
//
// Filter is intentionally narrow — string match on "THREE.THREE.Clock"
// only — so other console.warn output (including future, different
// three.js deprecations) keeps reaching DevTools. Remove this module +
// its main.tsx import when react-force-graph-3d upgrades to bundle a
// three.js that uses THREE.Timer (verify in their changelog before
// removing). See bb-tu1m for the original root-cause trace.

const SUPPRESSED_NEEDLE = "THREE.THREE.Clock"

/**
 * Predicate exported for unit testing. Production callers don't need
 * this — they just import the side effect.
 */
export function shouldSuppressWarn(args: unknown[]): boolean {
  return typeof args[0] === "string" && args[0].includes(SUPPRESSED_NEEDLE)
}

/**
 * Wrap an arbitrary console-shaped target's `warn` method with the
 * suppression filter. Idempotent via a tag on the wrapper. Exported so
 * tests can install on a fresh object instead of polluting the test
 * process's console (Bun's mock.module is process-global per
 * project_bun_mock_module_global, so re-imports during a test run
 * are no-ops and we cannot rely on dynamic-import-after-stub).
 */
export function installSilenceThreeClockWarn(
  target: { warn: (...args: unknown[]) => void } = console,
): void {
  if (typeof target?.warn !== "function") return
  const wrapper = target.warn as ((...args: unknown[]) => void) & {
    __bbNxqhInstalled?: boolean
  }
  if (wrapper.__bbNxqhInstalled) return
  const originalWarn = target.warn.bind(target)
  const filtered = ((...args: unknown[]): void => {
    if (shouldSuppressWarn(args)) return
    originalWarn(...args)
  }) as ((...args: unknown[]) => void) & { __bbNxqhInstalled?: boolean }
  filtered.__bbNxqhInstalled = true
  target.warn = filtered
}

// Side-effect: install on the global console at module-load so a single
// side-effect import from main.tsx is enough.
if (typeof console !== "undefined") installSilenceThreeClockWarn(console)
