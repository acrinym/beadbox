// Channel discipline: route console.log and console.debug to stderr so they
// can never corrupt the kkrpc wire on stdout.
//
// Why a separate file? ESM evaluates imports depth-first in source order. If
// the redirect lived in index.ts's body, it would run AFTER all import
// statements completed — and those imports may include modules with
// top-level console.log calls (e.g. lib/bd.ts hydrates credentials at module
// load and logs the count). To win the race, this redirect must execute
// before any other import in the sidecar, so it lives in its own module
// that is imported FIRST from index.ts.
//
// console.warn and console.error already route to stderr by default; only
// the stdout-bound calls (.log, .debug) need rewiring.
//
// bb-pnk0: also tee everything that lands on stderr to a per-platform log
// file (~/Library/Logs/Beadbox/beadbox-sidecar.log on macOS) so ops can
// grep production failures without depending on macOS unified log.

import { logFileWrite } from "./log-file"

const originalConsoleError = console.error.bind(console)
const originalConsoleWarn = console.warn.bind(console)

function mirroredError(...args: unknown[]): void {
  originalConsoleError(...args)
  logFileWrite(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "))
}

function mirroredWarn(...args: unknown[]): void {
  originalConsoleWarn(...args)
  logFileWrite(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "))
}

console.error = mirroredError
console.warn = mirroredWarn
console.log = mirroredError
console.debug = mirroredError

// Also mirror direct process.stderr.write calls (e.g. the boot diagnostic
// in index.ts that bypasses console.* entirely).
const originalStderrWrite = process.stderr.write.bind(process.stderr)
process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
  const text = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)
  logFileWrite(text.replace(/\n$/, ""))
  // biome-ignore lint/suspicious/noExplicitAny: forwarding variadic args to original
  return (originalStderrWrite as any)(chunk, ...rest)
}) as typeof process.stderr.write
