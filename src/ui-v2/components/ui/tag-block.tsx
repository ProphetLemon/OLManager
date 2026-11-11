import type { ReactNode } from "react"

import { cn } from "@/ui-v2/lib/utils"

export type TagTone =
  | "club"
  | "secondary"
  | "neutral"
  | "warning"
  | "positive"
  | "negative"
  | "info"

type TagSize = "sm" | "md" | "lg"

// Each tone sets the plate colour on the skewed ::before and the text colour on
// the (unskewed) element itself. Foregrounds come from the paired tokens.
const TONE_CLASS: Record<TagTone, string> = {
  club: "text-club-foreground before:bg-club",
  secondary: "text-secondary-foreground before:bg-secondary",
  neutral: "text-foreground before:bg-muted",
  warning: "text-warning-foreground before:bg-warning",
  positive: "text-positive-foreground before:bg-positive",
  negative: "text-negative-foreground before:bg-negative",
  info: "text-info-foreground before:bg-info",
}

const SIZE_CLASS: Record<TagSize, string> = {
  sm: "min-h-5 gap-1 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3",
  md: "min-h-6 gap-1.5 px-3 text-sm [&_svg:not([class*='size-'])]:size-3.5",
  lg: "min-h-8 gap-2 px-4 text-base [&_svg:not([class*='size-'])]:size-4",
}

interface TagBlockProps {
  children: ReactNode
  tone?: TagTone
  size?: TagSize
  slant?: boolean
  icon?: ReactNode
  className?: string
}

/**
 * Broadcast-style label plate. The plate is a skewed pseudo-element so the text
 * stays upright; the high-contrast outline is an inset shadow driven by
 * --tag-outline-width (0px by default, 2px under data-contrast).
 */
function TagBlock({
  children,
  tone = "neutral",
  size = "md",
  slant = true,
  icon,
  className,
}: TagBlockProps) {
  return (
    <span
      data-slot="tag-block"
      data-tone={tone}
      data-size={size}
      data-slant={slant ? "true" : "false"}
      className={cn(
        "relative isolate inline-flex w-fit shrink-0 items-center justify-center font-heading font-bold leading-none whitespace-nowrap",
        "before:absolute before:inset-0 before:-z-10 before:content-['']",
        "before:shadow-[inset_0_0_0_var(--tag-outline-width,0px)_var(--tag-outline-color,currentColor)]",
        slant ? "before:[transform:skewX(var(--tag-skew,-14deg))]" : "before:transform-none",
        SIZE_CLASS[size],
        TONE_CLASS[tone],
        className
      )}
    >
      {icon ? (
        <span aria-hidden="true" data-slot="tag-block-icon" className="inline-flex shrink-0">
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  )
}

export { TagBlock }
