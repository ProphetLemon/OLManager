import { Meter } from "@/ui-v2/components/ui/meter"

interface LabelledMeterProps {
  label: string
  value: number
}

/**
 * A meter with its name printed beside it, so the gauge is never an unlabeled bar.
 * The meter itself carries the accessible name; the visible copy is hidden from
 * assistive tech to avoid reading the label twice.
 */
export function LabelledMeter({ label, value }: LabelledMeterProps) {
  return (
    <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-2">
      <span aria-hidden="true" className="truncate text-xs font-medium text-muted-foreground">
        {label}
      </span>
      <Meter size="sm" label={label} value={value} />
    </div>
  )
}
