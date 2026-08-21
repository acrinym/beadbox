import { Check } from "lucide-react"
import type React from "react"
import { useState } from "react"
import { useViewport } from "../hooks/use-viewport"
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip"

const TRUNCATE_THRESHOLD = 14

function truncateId(id: string): string {
  if (id.length <= TRUNCATE_THRESHOLD) return id
  return `${id.slice(0, 8)}...${id.slice(-6)}`
}

interface CopyableIdProps {
  id: string
  className?: string
  onCopy?: () => void
}

export function CopyableId({ id, className = "", onCopy }: CopyableIdProps) {
  const displayId = truncateId(id)
  const isTruncated = displayId !== id
  const { isMobile } = useViewport()
  const [copied, setCopied] = useState(false)

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()

    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(id)
      } else {
        const textarea = document.createElement("textarea")
        textarea.value = id
        textarea.style.position = "fixed"
        textarea.style.opacity = "0"
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand("copy")
        document.body.removeChild(textarea)
      }
      setCopied(true)
      onCopy?.()
      setTimeout(() => {
        setCopied(false)
      }, 1000)
    } catch (err) {
      console.error("Failed to copy:", err)
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="button"
          tabIndex={0}
          onClick={handleCopy}
          onKeyDown={(e) => e.key === "Enter" && handleCopy(e as unknown as React.MouseEvent)}
          className={`inline-flex items-center gap-1.5 font-mono text-sm text-muted-foreground hover:text-primary hover:underline underline-offset-2 transition-all cursor-pointer min-w-[5rem] ${isMobile ? "min-h-[44px]" : ""} ${className}`}
        >
          {copied ? (
            <span className="inline-flex items-center gap-1 text-primary animate-in fade-in duration-150">
              <Check className="h-3.5 w-3.5" />
              <span className="text-xs">Copied</span>
            </span>
          ) : (
            <span className="transition-opacity whitespace-nowrap">{displayId}</span>
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent>{isTruncated ? `${id} · Click to copy` : "Click to copy"}</TooltipContent>
    </Tooltip>
  )
}
