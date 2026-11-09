import type { ReactNode } from "react"
import { X } from "lucide-react"

import { Button } from "@/ui-v2/components/ui/button"
import { cn } from "@/ui-v2/lib/utils"

// Mirrors the TagTone contract owned by tag-block.tsx (W1-PRIM-A). Swap the
// local type and TagChip for the shared TagBlock once both branches integrate.
export type LowerThirdTagTone =
  | "club"
  | "secondary"
  | "neutral"
  | "warning"
  | "positive"
  | "negative"
  | "info"

export interface LowerThirdAction {
  label: string
  onClick: () => void
  disabled?: boolean
}

export interface LowerThirdProps {
  tagLabel: string
  tagTone?: LowerThirdTagTone
  headline: ReactNode
  consequence?: ReactNode
  action?: LowerThirdAction
  secondaryAction?: LowerThirdAction
  severity?: "hard" | "soft" | "info"
  onDismiss?: () => void
  dismissLabel?: string
  as?: "li" | "div" | "section"
  className?: string
}

const TONE_CLASS: Record<LowerThirdTagTone, string> = {
  club: "bg-club text-club-foreground",
  secondary: "bg-secondary text-secondary-foreground",
  neutral: "bg-muted text-foreground",
  warning: "bg-warning text-background",
  positive: "bg-positive text-background",
  negative: "bg-destructive text-foreground",
  info: "bg-info text-background",
}

// Non-colour severity marker: bar style differs (solid / dashed / dotted).
const SEVERITY_CLASS: Record<NonNullable<LowerThirdProps["severity"]>, string> = {
  hard: "border-s-[0.1875rem] border-s-foreground [border-inline-start-style:solid]",
  soft: "border-s-[0.1875rem] border-s-foreground [border-inline-start-style:dashed]",
  info: "border-s-2 border-s-muted-foreground [border-inline-start-style:dotted]",
}

function TagChip({ tone, children }: { tone: LowerThirdTagTone; children: ReactNode }) {
  return (
    <span
      data-slot="tag-block"
      data-tone={tone}
      className={cn(
        "inline-flex w-fit items-center rounded-sm px-2 py-0.5 font-heading text-xs font-bold",
        "shadow-[inset_0_0_0_var(--tag-outline-width)_var(--tag-outline-color)]",
        TONE_CLASS[tone],
      )}
    >
      {children}
    </span>
  )
}

export function LowerThird({
  tagLabel,
  tagTone = "warning",
  headline,
  consequence,
  action,
  secondaryAction,
  severity = "soft",
  onDismiss,
  dismissLabel,
  as: Root = "div",
  className,
}: LowerThirdProps) {
  return (
    <Root
      data-slot="lower-third"
      data-severity={severity}
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg bg-card py-3 pe-3 ps-4 text-card-foreground",
        SEVERITY_CLASS[severity],
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 basis-60 flex-col gap-1">
        <TagChip tone={tagTone}>{tagLabel}</TagChip>
        <div data-slot="lower-third-headline" className="font-heading text-section font-semibold">
          {headline}
        </div>
        {consequence ? (
          <div data-slot="lower-third-consequence" className="text-sm text-muted-foreground">
            {consequence}
          </div>
        ) : null}
      </div>
      {action || secondaryAction || onDismiss ? (
        <div className="flex items-center gap-2">
          {secondaryAction ? (
            <Button
              type="button"
              variant="outline"
              className="h-[var(--hit)] min-w-[var(--hit)] px-4 text-sm"
              disabled={secondaryAction.disabled}
              onClick={secondaryAction.onClick}
            >
              {secondaryAction.label}
            </Button>
          ) : null}
          {action ? (
            <Button
              type="button"
              className="h-[var(--hit)] min-w-[var(--hit)] px-4 text-sm"
              disabled={action.disabled}
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          ) : null}
          {onDismiss ? (
            <Button
              type="button"
              variant="ghost"
              className="size-[var(--hit)]"
              aria-label={dismissLabel ?? "Dismiss"}
              onClick={onDismiss}
            >
              <X aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      ) : null}
    </Root>
  )
}
