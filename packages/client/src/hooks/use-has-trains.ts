import { useQuery } from "@tanstack/react-query"
import { rpc } from "@/lib/rpc"
import { useSubscriptionChangeSignal } from "@/lib/subscribe"

/**
 * beadbox-if6: the Trains surface (header tab + Cmd/Ctrl+4) exists only when
 * the active workspace has .beadtrain files. Keyed on the subscription change
 * signal so a plan file appearing or vanishing flips it live.
 */
export function useHasTrains(dbPath: string | undefined): boolean {
  const changeSignal = useSubscriptionChangeSignal()
  const query = useQuery({
    queryKey: ["trains-present", dbPath, changeSignal],
    queryFn: async () => {
      const result = await rpc.trains.hasTrains(dbPath)
      return result.success ? result.data : false
    },
    enabled: Boolean(dbPath),
  })
  return query.data === true
}
