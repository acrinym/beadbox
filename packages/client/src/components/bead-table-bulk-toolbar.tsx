// bb-y729: floating toolbar that appears when ≥1 bead-table row is selected.
// Initial single bulk action: Archive. Future bulk ops (close, reparent,
// priority change) extend this component without changing the selection
// state contract on home-page.

import { Archive, Loader2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface BeadTableBulkToolbarProps {
  selectedCount: number
  onBulkArchive: () => void | Promise<void>
  onClear: () => void
  isPending?: boolean
  className?: string
}

export function BeadTableBulkToolbar({
  selectedCount,
  onBulkArchive,
  onClear,
  isPending = false,
  className,
}: BeadTableBulkToolbarProps) {
  if (selectedCount === 0) return null

  return (
    <div
      className={cn(
        "bead-table-bulk-toolbar flex items-center gap-3 px-3 py-2 border-b border-border/50 bg-primary/10",
        className,
      )}
      role="toolbar"
      aria-label="Bulk actions"
    >
      <span className="text-sm font-medium text-foreground/80">{selectedCount} selected</span>
      <div className="flex-1" />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          void onBulkArchive()
        }}
        disabled={isPending}
        aria-label="Archive selected"
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Archive className="h-4 w-4" />
        )}
        Archive
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onClear}
        disabled={isPending}
        aria-label="Clear selection"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}
