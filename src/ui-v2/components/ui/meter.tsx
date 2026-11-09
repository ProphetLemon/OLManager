import { cn } from "@/ui-v2/lib/utils"

type MeterTone = "auto" | "positive" | "warning" | "negative" | "info" | "club"
type ResolvedTone = Exclude<MeterTone, "auto">

const FILL_CLASS: Record<ResolvedTone, string> = {
  positive: "bg-positive",
  warning: "bg-warning",
  negative: "bg-negative",
  info: "bg-info",
  club: "bg-club",
}

/** Auto tone: >= 60 positive, >= 35 warning, otherwise negative (on a 0-100 scale). */
function resolveTone(tone: MeterTone, percent: number): ResolvedTone {
  if (tone !== "auto") return tone
  if (percent >= 60) return "positive"
  if (percent >= 35) return "warning"
  return "negative"
}

interface MeterProps {
  value: number
  max?: number
  label: string
  valueText?: string
  tone?: MeterTone
  size?: "sm" | "md"
  showValue?: boolean
  className?: string
}

/** Labelled gauge. The number is always visible so colour is never the only signal. */
function Meter({
  value,
  max = 100,
  label,
  valueText,
  tone = "auto",
  size = "md",
  showValue = true,
  className,
}: MeterProps) {
  const safeMax = max > 0 ? max : 100
  const clamped = Math.max(0, Math.min(safeMax, Number.isFinite(value) ? value : 0))
  const percent = (clamped / safeMax) * 100
  const resolved = resolveTone(tone, percent)
  const text = valueText ?? `${value}`

  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuetext={text}
      data-slot="meter"
      data-tone={resolved}
      data-size={size}
      className={cn("flex items-center gap-2", className)}
    >
      <div
        className={cn(
          "flex-1 overflow-hidden rounded-full bg-muted",
          size === "sm" ? "h-1.5" : "h-2.5"
        )}
      >
        <div
          data-slot="meter-fill"
          className={cn("h-full rounded-full", FILL_CLASS[resolved])}
          style={{ width: `${percent}%` }}
        />
      </div>
      {showValue ? (
        <span
          data-slot="meter-value"
          className="min-w-[2.5ch] text-right text-xs font-bold tabular-nums text-foreground"
        >
          {text}
        </span>
      ) : null}
    </div>
  )
}

export { Meter }
