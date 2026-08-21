// Ported from components/workspace-card.tsx (P3.2 / bb-90zz.2).
// Pure presentational — no actions/imports to swap; only @/ alias paths
// rewritten to relative.

import { Circle, Server, Settings, X } from "lucide-react"
import type { WorkspaceCard as WorkspaceCardType } from "../lib/types"
import { cn } from "../lib/utils"
import { Button } from "./ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip"

interface WorkspaceCardProps {
  workspace: WorkspaceCardType
  onOpen: (ws: WorkspaceCardType) => void
  onRemove: (ws: WorkspaceCardType) => void
  onConfigure?: (ws: WorkspaceCardType) => void
}

export function WorkspaceCard({ workspace, onOpen, onRemove, onConfigure }: WorkspaceCardProps) {
  const isServerOnly = workspace.path === null && workspace.serverHost
  const subtitle = isServerOnly
    ? `${workspace.serverHost}:${workspace.serverPort} . ${workspace.serverDatabase}`
    : workspace.path?.startsWith("/Users/")
      ? "~" + workspace.path.slice(workspace.path.indexOf("/", 1))
      : (workspace.path ?? "")

  return (
    <div className="relative group rounded-lg border border-border bg-card p-4 hover:bg-accent/30 transition-colors">
      <div className="flex items-start gap-3">
        <div className="rounded-md bg-muted/50 p-1.5 mt-0.5">
          {isServerOnly ? (
            <Server className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Circle className="h-4 w-4 fill-current text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-medium text-foreground truncate">{workspace.name}</p>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="text-xs text-muted-foreground truncate mt-0.5">{subtitle}</p>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <p className="text-xs font-mono break-all">
                {isServerOnly
                  ? `${workspace.serverHost}:${workspace.serverPort}/${workspace.serverDatabase}`
                  : workspace.path}
              </p>
            </TooltipContent>
          </Tooltip>
          <div className="mt-3">
            <Button size="sm" onClick={() => onOpen(workspace)}>
              Open
            </Button>
          </div>
        </div>
      </div>
      <div
        className={cn(
          "absolute top-2 right-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-70 transition-opacity",
        )}
      >
        {isServerOnly && onConfigure && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onConfigure(workspace)
            }}
            className={cn(
              "rounded-md p-1",
              "hover:bg-accent text-muted-foreground hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
            aria-label={`Configure ${workspace.name}`}
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove(workspace)
          }}
          className={cn(
            "rounded-md p-1",
            "hover:bg-destructive/10 text-muted-foreground hover:text-destructive",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
          aria-label={`Remove ${workspace.name}`}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
