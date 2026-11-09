import { cn } from "@/ui-v2/lib/utils"

type NumeralSize = "ovr" | "scoreboard" | "title"
type NumeralTone = "foreground" | "club" | "muted"

const SIZE_CLASS: Record<NumeralSize, string> = {
  ovr: "text-ovr",
  scoreboard: "text-scoreboard",
  title: "text-title",
}

const TONE_CLASS: Record<NumeralTone, string> = {
  foreground: "text-foreground",
  club: "text-club-text",
  muted: "text-muted-foreground",
}

interface ScoreNumeralProps {
  value: string | number
  size?: NumeralSize
  tone?: NumeralTone
  /** Accessible name. Without it the numeral is decorative and hidden from assistive tech. */
  label?: string
  className?: string
}

/** Big condensed numeral for OVR badges and scoreboards. */
function ScoreNumeral({
  value,
  size = "ovr",
  tone = "foreground",
  label,
  className,
}: ScoreNumeralProps) {
  return (
    <span
      data-slot="score-numeral"
      data-size={size}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      className={cn(
        "inline-block font-heading font-extrabold tabular-nums leading-none",
        SIZE_CLASS[size],
        TONE_CLASS[tone],
        className
      )}
    >
      {value}
    </span>
  )
}

export { ScoreNumeral }
