"use client"

import { SimpleMarkdown } from "@/components/simple-markdown"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"

interface SpecViewerModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  specId: string
  loading: boolean
  error: string
  content: string
}

export function SpecViewerModal({
  open,
  onOpenChange,
  specId,
  loading,
  error,
  content,
}: SpecViewerModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!w-[95vw] md:!w-[80vw] !max-w-[95vw] md:!max-w-[80vw] max-h-[90vh] h-[90vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="text-sm font-mono text-muted-foreground">{specId}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-1">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Spinner className="h-6 w-6" />
            </div>
          )}
          {error && (
            <div className="text-sm text-destructive py-4">Could not read spec file: {error}</div>
          )}
          {!loading && !error && content && <SimpleMarkdown content={content} />}
        </div>
      </DialogContent>
    </Dialog>
  )
}
