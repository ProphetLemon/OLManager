import type { ReactNode } from "react"

import { cn } from "@/ui-v2/lib/utils"

interface StartingFiveGridProps {
  children: ReactNode
  className?: string
}

/**
 * Responds to the width of its own container, not the viewport, so the five cards
 * always sit 5 across, 3 + 2, or 2 + 2 + 1 whatever the shell around it does (rail,
 * compact mode, UI scale). Tiers are explicit because auto-fit would leave a 4 + 1
 * row in between. Columns use minmax(0, 1fr), so a long name truncates instead of
 * pushing a neighbour. 58rem is five 11rem cards plus their gaps.
 */
export function StartingFiveGrid({ children, className }: StartingFiveGridProps) {
  return (
    <div data-slot="starting-five-grid" className="@container w-full [container-type:inline-size]">
      <div
        className={cn(
          "grid grid-cols-2 gap-3 @[26rem]:grid-cols-3 @[58rem]:grid-cols-5",
          className,
        )}
      >
        {children}
      </div>
    </div>
  )
}
