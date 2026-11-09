import { useRef, type KeyboardEvent } from "react"

import { cn } from "@/ui-v2/lib/utils"

export interface SegmentedOption {
  value: string
  label: string
  count?: number
  disabled?: boolean
}

export interface SegmentedControlProps {
  value: string
  onValueChange: (value: string) => void
  options: SegmentedOption[]
  ariaLabel: string
  size?: "sm" | "md"
  className?: string
}

export function SegmentedControl({
  value,
  onValueChange,
  options,
  ariaLabel,
  size = "md",
  className,
}: SegmentedControlProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0)
  const selectedIndex = options.findIndex((o) => o.value === value)
  // Single tab stop: the selected option, else the first enabled one.
  const tabStop =
    selectedIndex >= 0 && !options[selectedIndex].disabled ? selectedIndex : (enabled[0] ?? -1)

  const move = (from: number, key: string) => {
    if (enabled.length === 0) return
    const pos = enabled.indexOf(from)
    let next: number | undefined
    if (key === "ArrowRight" || key === "ArrowDown") next = enabled[(pos + 1) % enabled.length]
    else if (key === "ArrowLeft" || key === "ArrowUp")
      next = enabled[(pos - 1 + enabled.length) % enabled.length]
    else if (key === "Home") next = enabled[0]
    else if (key === "End") next = enabled[enabled.length - 1]
    if (next === undefined) return
    refs.current[next]?.focus()
    onValueChange(options[next].value)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key))
      return
    event.preventDefault()
    move(index, event.key)
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      data-slot="segmented-control"
      data-size={size}
      className={cn("inline-flex items-stretch gap-1 rounded-lg bg-muted p-1", className)}
    >
      {options.map((option, index) => {
        const checked = option.value === value
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={option.disabled}
            tabIndex={index === tabStop ? 0 : -1}
            onClick={() => onValueChange(option.value)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border-b-2 px-3 text-sm transition-colors",
              "min-h-[var(--hit)] disabled:pointer-events-none disabled:opacity-50",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              size === "sm" && "px-2",
              checked
                ? "border-club-text font-bold text-foreground"
                : "border-transparent font-medium text-muted-foreground hover:text-foreground",
            )}
          >
            <span>{option.label}</span>
            {option.count !== undefined ? (
              <span className="text-xs tabular-nums text-muted-foreground">{option.count}</span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
