import { useEffect, useRef } from "react"
import { CopyableCommand } from "@/components/copyable-command"
import { getAnalyticsEnabled } from "@/lib/local-storage"
import { safeCapture } from "@/lib/posthog-safe"

// next/image isn't available under Vite. Use a plain <img> with the asset
// served from /public/ (Vite copies that dir to dist root). Same width/
// height props on the wrapper give parity layout-wise.
const magpieImg = { src: "/magpie.png", width: 96, height: 96 }
const Image = ({
  src,
  alt,
  ...rest
}: { src: { src: string; width: number; height: number }; alt: string } & Record<
  string,
  unknown
>) => (
  <img
    src={src.src}
    alt={alt}
    width={src.width}
    height={src.height}
    {...(rest as Record<string, unknown>)}
  />
)

export function OnboardingHero() {
  const shownAtRef = useRef(Date.now())

  useEffect(() => {
    if (getAnalyticsEnabled()) {
      safeCapture("app_onboarding_shown", {})
    }

    const shownAt = shownAtRef.current
    return () => {
      if (getAnalyticsEnabled()) {
        safeCapture("app_onboarding_dismissed", {
          dwell_ms: Date.now() - shownAt,
        })
      }
    }
  }, [])

  return (
    <div className="flex items-center justify-center h-full w-full py-12">
      <div className="text-center max-w-[480px] px-4">
        <div className="flex justify-center mb-5">
          <Image src={magpieImg} alt="Beadbox mascot" width={80} height={80} priority />
        </div>

        <h2 className="text-lg font-semibold text-foreground mb-4">Nothing here yet.</h2>

        <div className="space-y-3 mb-4">
          <CopyableCommand
            label="Create your first bead:"
            command='bd create --title "My first task"'
          />
          <CopyableCommand
            label="Or let an agent seed the board:"
            command='claude "create three tasks for this project"'
          />
        </div>

        <p className="text-sm text-muted-foreground mb-6">Beads appear here in real time.</p>

        <div className="border-t border-border pt-5">
          <p className="text-xs text-muted-foreground/60 italic">
            You&apos;re the pilot, not the mechanic. Agents create and update beads. You watch,
            prioritize, and intervene from this board.
          </p>
        </div>
      </div>
    </div>
  )
}
