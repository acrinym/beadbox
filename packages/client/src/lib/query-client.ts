// TanStack Query client singleton.
//
// Defaults are tuned for an SPA that drives invalidation through the
// dual-channel subscription (lib/subscribe.ts) — staleTime is generous
// because we trust the change-detector to fire invalidations when bd
// state changes; gcTime is moderate to keep navigation responsive
// without retaining stale data forever.

import { QueryClient } from "@tanstack/react-query"

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})
