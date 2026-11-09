import { cn } from "@/ui-v2/lib/utils"

type ProgressTone = "primary" | "success" | "danger"

const TONE_CLASS: Record<ProgressTone, string> = {
  primary: "bg-primary",
  success: "bg-positive",
  danger: "bg-destructive",
}

interface ProgressProps {
  value: number
  tone?: ProgressTone
  showLabel?: boolean
  className?: string
}

/** Thin 0-100 progress bar with an optional tabular percentage label. */
function Progress({ value, tone = "primary", showLabel = false, className }: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        data-slot="progress"
        className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn("h-full rounded-full transition-all duration-500", TONE_CLASS[tone])}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {showLabel ? (
        <span className="min-w-[2.5rem] text-right text-xs font-bold tabular-nums text-muted-foreground">
          {clamped}%
        </span>
      ) : null}
    </div>
  )
}

export { Progress }
export type { ProgressTone }
