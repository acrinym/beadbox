// Hook for the DevBadge (and any other "what's running?" surface) to
// fetch the sidecar's tool versions. Wraps rpc.health.getToolVersions in
// TanStack Query so DevBadge can render a placeholder while the call
// resolves and a fallback when the call errors (browser dev mode raises
// RpcUnavailableError).
//
// appVersion is a build-time client constant (Vite inline-replaces
// import.meta.env at build), so it doesn't need a query — read it
// directly. BUILD_TAG preferred over APP_VERSION so dogfood DevBadge
// shows the RC suffix (e.g. "0.25.0-rc.2" instead of "0.25.0").

import { useQuery } from "@tanstack/react-query"
import { rpc } from "./rpc"

const APP_VERSION =
  (import.meta.env.VITE_BUILD_TAG as string | undefined) ||
  (import.meta.env.VITE_APP_VERSION as string | undefined) ||
  null

export function useVersion() {
  const query = useQuery({
    queryKey: ["health", "tool-versions"] as const,
    queryFn: async () => rpc.health.getToolVersions(),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  })
  return { ...query, appVersion: APP_VERSION }
}
