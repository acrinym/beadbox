import path from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vitest/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// P6.5: root vitest is now reserved for the integration suite only
// (vitest.integration.config.mts). The unit-test surface migrated to
// bun:test inside each workspace package; the legacy root-level Next.js
// sources that vitest used to cover were deleted in P6.1.
//
// The orchestrating `bun run test` script in package.json invokes
// `bun --cwd=packages/server run test` and `bun --cwd=packages/client
// run test` directly; this vitest config is only consumed by
// `bun run test:integration` via vitest.integration.config.mts.
//
// bb-46ad sweep removed the dead infrastructure that supported the
// pre-P6 Next.js test surface (jsdom env, react plugin, Next.js mocks
// in vitest.setup.ts, the @tauri-apps/api/core mock in __mocks__/).
// The exclude list below is the only thing that earns its keep — it
// keeps `bunx vitest` from the repo root from picking up tests in
// places it shouldn't.
//
// No passWithNoTests flag: anyone running raw `bunx vitest` from the
// repo root sees the empty match and goes looking for the right
// command. That's a deliberate signal, not a temporary state.
export default defineConfig({
  root: __dirname,
  test: {
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '.next', 'src-tauri', 'tests/integration', 'e2e', 'tb0', 'packages'],
  },
})
