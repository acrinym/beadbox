import { useEffect } from "react"
import type { BdCommandEvent, WsLifecycleEvent } from "../lib/console-types"
import { setRpcTap } from "../lib/rpc"
import { setSubscriptionTap } from "../lib/subscribe"

interface DevConsoleTaps {
  addCommand: (event: BdCommandEvent) => void
  addEvent: (event: WsLifecycleEvent) => void
}

// bb-nypf: extracted from home-page + activity-page (bb-78qr arch audit).
// Wires the dev-console buffer's addCommand/addEvent into the module-scope
// rpc + subscription taps. The taps are global singletons; only one
// consumer should mount at a time (router-mediated page guarantees that).
export function useDevConsoleTaps(taps: DevConsoleTaps): void {
  const { addCommand, addEvent } = taps
  useEffect(() => {
    setRpcTap(addCommand)
    setSubscriptionTap(addEvent)
    return () => {
      setRpcTap(null)
      setSubscriptionTap(null)
    }
  }, [addCommand, addEvent])
}
