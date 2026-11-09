import { useEffect, useState } from "react"

import { cn } from "@/ui-v2/lib/utils"

/** Head-and-shoulders silhouette used whenever a player has no usable photo. */
export function PlayerSilhouette({ className }: { className?: string }) {
  return (
    <svg
      data-slot="player-silhouette"
      viewBox="0 0 96 88"
      aria-hidden="true"
      focusable="false"
      className={cn("fill-current", className)}
    >
      <circle cx="48" cy="26" r="20" />
      <path d="M4 88c0-26 18-40 44-40s44 14 44 40z" />
    </svg>
  )
}

interface PlayerPortraitProps {
  src: string | null
  /** "bust" fills a banner from the bottom-left; "round" is a small avatar. */
  shape?: "bust" | "round"
  className?: string
}

/**
 * Decorative player picture. A missing source or a failed load (onError) falls back to
 * the silhouette, never an empty circle. The name is always printed next to it, so the
 * picture itself carries no accessible name.
 */
export function PlayerPortrait({ src, shape = "round", className }: PlayerPortraitProps) {
  const [failed, setFailed] = useState(false)

  // A reused row can receive a new photo after an earlier one failed.
  useEffect(() => setFailed(false), [src])

  const showPhoto = Boolean(src) && !failed

  if (shape === "bust") {
    return (
      <span
        data-slot="player-portrait"
        data-fallback={showPhoto ? "false" : "true"}
        className={cn("pointer-events-none flex items-end", className)}
      >
        {showPhoto ? (
          <img
            src={src ?? undefined}
            alt=""
            loading="lazy"
            onError={() => setFailed(true)}
            className="h-full w-auto max-w-full object-contain object-bottom"
          />
        ) : (
          <PlayerSilhouette className="h-[88%] w-auto text-muted-foreground/40" />
        )}
      </span>
    )
  }

  return (
    <span
      data-slot="player-portrait"
      data-fallback={showPhoto ? "false" : "true"}
      className={cn(
        "inline-flex shrink-0 items-end justify-center overflow-hidden rounded-full border border-line bg-muted",
        className,
      )}
    >
      {showPhoto ? (
        <img
          src={src ?? undefined}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      ) : (
        <PlayerSilhouette className="h-[85%] w-auto text-muted-foreground/60" />
      )}
    </span>
  )
}
