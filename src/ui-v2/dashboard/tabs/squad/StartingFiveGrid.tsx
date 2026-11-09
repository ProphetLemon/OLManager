import type { ReactNode } from "react"

import { cn } from "@/ui-v2/lib/utils"

interface StartingFiveGridProps {
  children: ReactNode
  className?: string
}

/**
 * Responds to the width of its own container, not the viewport, so five cards wrap
 * 5 / 3+2 / 2+2+1 whatever the shell around it does (rail, compact mode, UI scale).
 */
export function StartingFiveGrid({ children, className }: StartingFiveGridProps) {
  return (
    <div data-slot="starting-five-grid" className="@container w-full [container-type:inline-size]">
      <div
        className={cn(
          "grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))]",
          className,
        )}
      >
        {children}
      </div>
    </div>
  )
}
