// Sonner Toaster wrapper for the SPA. Ported from components/ui/sonner.tsx
// (P2.3 / bb-cqpc.3).
//
// Differences from the Next.js version:
// - Removed the next-themes useTheme() call. Beadbox is dark-only (Blue,
//   Gray, Green are all dark variants per ADR-2008 addendum 3 — theme is
//   set as html className/data-theme, never light/system). Hardcoded
//   theme="dark" matches the production layout's actual rendering.
// - Stripped the "use client" directive. Vite SPA, no RSC boundary.
//
// CSS variables (--popover, --popover-foreground, --border) come from the
// theme tokens P2.1 ports into packages/client/src/index.css. If the
// scaffold hasn't landed those yet, sonner falls back to library defaults.

import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
