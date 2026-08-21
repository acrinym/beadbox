"use client"

import { formatDateTime } from "@/components/bead-detail-helpers"
import { SimpleMarkdown } from "@/components/simple-markdown"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { Comment } from "@/lib/types"

interface ExpandedCommentModalProps {
  comment: Comment | null
  onClose: () => void
}

export function ExpandedCommentModal({ comment, onClose }: ExpandedCommentModalProps) {
  return (
    <Dialog open={!!comment} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="!w-[95vw] md:!w-[80vw] !max-w-[95vw] md:!max-w-[80vw] max-h-[90vh] h-[90vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold bg-primary/20 text-primary">
              {comment?.author.charAt(0).toUpperCase()}
            </div>
            <span className="font-medium">{comment?.author}</span>
            <span className="text-sm text-muted-foreground font-normal">
              {comment && formatDateTime(comment.timestamp)}
            </span>
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto py-4">
          <div className="prose prose-sm prose-invert max-w-none text-foreground/90">
            {comment && <SimpleMarkdown content={comment.content} />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
