"use client"

import * as React from "react"

/**
 * Breakpoint boundaries (min-width, mobile-first):
 *   mobile:  < 640px
 *   tablet:  640px - 1023px
 *   desktop: >= 1024px
 *
 * These match Tailwind v4 defaults: sm=640, md=768, lg=1024.
 * The "tablet" range spans sm through md into lg.
 */
const BP_TABLET = 640
const BP_MOBILE_LAYOUT = 768
const BP_DESKTOP = 1024

export type Breakpoint = "mobile" | "tablet" | "desktop"

export interface ViewportState {
  /** Current named breakpoint */
  breakpoint: Breakpoint
  /** Viewport < 640px */
  isMobile: boolean
  /** Viewport 640px - 1023px */
  isTablet: boolean
  /** Viewport >= 1024px */
  isDesktop: boolean
  /** Viewport < 768px: use stacked single-panel layout */
  isMobileLayout: boolean
}

function getBreakpoint(width: number): Breakpoint {
  if (width < BP_TABLET) return "mobile"
  if (width < BP_DESKTOP) return "tablet"
  return "desktop"
}

function stateFromWidth(width: number): ViewportState {
  const bp = getBreakpoint(width)
  return {
    breakpoint: bp,
    isMobile: bp === "mobile",
    isTablet: bp === "tablet",
    isDesktop: bp === "desktop",
    isMobileLayout: width < BP_MOBILE_LAYOUT,
  }
}

// SSR default: desktop (Beadbox is desktop-first)
const SSR_DEFAULT = stateFromWidth(BP_DESKTOP)

/**
 * Returns the current viewport breakpoint. SSR-safe: defaults to
 * 'desktop' on the server, then corrects after hydration via useEffect.
 * Uses matchMedia listeners for efficient change detection (no resize spam).
 */
export function useViewport(): ViewportState {
  const [state, setState] = React.useState<ViewportState>(SSR_DEFAULT)

  React.useEffect(() => {
    // Set initial value from actual window width
    setState(stateFromWidth(window.innerWidth))

    const tabletMql = window.matchMedia(`(min-width: ${BP_TABLET}px)`)
    const mobileLayoutMql = window.matchMedia(`(min-width: ${BP_MOBILE_LAYOUT}px)`)
    const desktopMql = window.matchMedia(`(min-width: ${BP_DESKTOP}px)`)

    const update = () => {
      setState(stateFromWidth(window.innerWidth))
    }

    tabletMql.addEventListener("change", update)
    mobileLayoutMql.addEventListener("change", update)
    desktopMql.addEventListener("change", update)

    return () => {
      tabletMql.removeEventListener("change", update)
      mobileLayoutMql.removeEventListener("change", update)
      desktopMql.removeEventListener("change", update)
    }
  }, [])

  return state
}
