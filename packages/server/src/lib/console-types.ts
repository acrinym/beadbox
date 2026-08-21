export interface BdCommandEvent {
  type: "bd_command"
  id: string
  timestamp: number
  command: string
  args: string[]
  dbPath: string | null
  durationMs: number
  exitCode: number
  resultSummary: string | null
  stderr: string | null
  stdout: string | null
  source: "app" | "console"
}

export interface WsLifecycleEvent {
  type: "ws_lifecycle"
  id: string
  timestamp: number
  event:
    | "connected"
    | "disconnected"
    | "reconnecting"
    | "change_detected"
    | "polling_error"
    | "recovered"
    | "heartbeat"
  detail: string | null
}
