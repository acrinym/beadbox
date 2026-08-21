/**
 * Server-side epic data prefetch cache.
 *
 * When the startup health check proves Dolt connectivity, we fire getEpics()
 * immediately — before returning the health result to the client. The prefetch
 * runs during the network round-trip + React re-render, so by the time
 * page.tsx mounts and loadEpics calls getEpics, the data is already available.
 */

import type { EpicResult } from "../handlers/epics"

let prefetchPromise: Promise<EpicResult> | null = null
let prefetchDbPath: string | undefined
let prefetchTimestamp = 0

const PREFETCH_TTL_MS = 15_000

export function startEpicPrefetch(dbPath: string | undefined, fetcher: () => Promise<EpicResult>) {
  prefetchDbPath = dbPath
  prefetchTimestamp = Date.now()
  prefetchPromise = fetcher()
}

export function consumeEpicPrefetch(dbPath: string | undefined): Promise<EpicResult> | null {
  if (!prefetchPromise) return null
  if (prefetchDbPath !== dbPath) {
    discardEpicPrefetch()
    return null
  }
  if (Date.now() - prefetchTimestamp > PREFETCH_TTL_MS) {
    discardEpicPrefetch()
    return null
  }
  const p = prefetchPromise
  discardEpicPrefetch()
  return p
}

export function discardEpicPrefetch() {
  prefetchPromise = null
  prefetchDbPath = undefined
  prefetchTimestamp = 0
}
