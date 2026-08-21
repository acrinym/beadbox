// Test seams for subscribe.ts. Kept in a sibling module so the handler's
// public surface (handlers/subscribe.ts) stays exactly two exports —
// `start` and `stop` — per bead bb-vy13.6 acceptance grep:
//   grep -E "^export" packages/server/src/handlers/subscribe.ts
// must yield exactly those two.
//
// Module-scope state lives here. ES module exports are live bindings, so
// `subscribe.ts` reads `state.writer` at call time and always sees the
// current value, including mutations from _setWriter.

import type { ChangeDetector } from "../lib/change-detector"

const defaultWriter = (line: string): void => {
  process.stderr.write(line)
}

export const state = {
  writer: defaultWriter as (line: string) => void,
  detectors: new Map<string, ChangeDetector>(),
}

export function _setWriter(fn: (line: string) => void): void {
  state.writer = fn
}

export function _resetWriter(): void {
  state.writer = defaultWriter
}

export function _activeIds(): string[] {
  return Array.from(state.detectors.keys())
}
