import { useEffect, useState } from "react"

import { cn } from "@/ui-v2/lib/utils"

type ShieldSize = "sm" | "md" | "lg" | "xl"

const SIZE_CLASS: Record<ShieldSize, string> = {
  sm: "size-6 text-xs",
  md: "size-9 text-sm",
  lg: "size-12 text-base",
  xl: "size-20 text-2xl",
}

interface ClubShieldProps {
  name: string
  logoUrl?: string | null
  size?: ShieldSize
  /** CSS colour for the monogram background. Defaults to the club accent. */
  accent?: string
  /** CSS colour for the monogram text; pair it with `accent` for another club's palette. */
  foreground?: string
  /** Decorative shields hide from assistive tech (the name sits next to them). */
  decorative?: boolean
  className?: string
}

/** First two letters of the club name, upper-cased. */
function monogram(name: string): string {
  return Array.from(name.trim()).slice(0, 2).join("").toUpperCase()
}

/** Club logo with a monogram fallback when the logo is missing or fails to load. */
function ClubShield({
  name,
  logoUrl,
  size = "md",
  accent = "var(--club)",
  foreground = "var(--club-foreground)",
  decorative = true,
  className,
}: ClubShieldProps) {
  const [failed, setFailed] = useState(false)

  // A new logo gets a fresh chance to load.
  useEffect(() => {
    setFailed(false)
  }, [logoUrl])

  const a11y = decorative
    ? { "aria-hidden": true as const }
    : { role: "img" as const, "aria-label": name }

  if (!logoUrl || failed) {
    return (
      <span
        data-slot="club-shield"
        data-fallback="true"
        data-size={size}
        style={{ backgroundColor: accent, color: foreground }}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-md font-heading font-bold leading-none select-none",
          SIZE_CLASS[size],
          className
        )}
        {...a11y}
      >
        {monogram(name)}
      </span>
    )
  }

  return (
    <img
      data-slot="club-shield"
      data-size={size}
      src={logoUrl}
      alt={decorative ? "" : name}
      aria-hidden={decorative ? true : undefined}
      onError={() => setFailed(true)}
      className={cn("shrink-0 object-contain", SIZE_CLASS[size], className)}
    />
  )
}

export { ClubShield }
