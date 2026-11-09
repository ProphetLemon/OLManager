import { useId, useState } from "react"
import { useTranslation } from "react-i18next"

import type { CallItem, CallKind } from "@/lib/dashboard/needsYourCall"
import { Button } from "@/ui-v2/components/ui/button"
import { TagBlock, type TagTone } from "@/ui-v2/components/ui/tag-block"
import { cn } from "@/ui-v2/lib/utils"

export interface NeedsYourCallPanelProps {
  items: CallItem[]
  total: number
  hiddenContracts: number
  onAct: (item: CallItem) => void
}

const VISIBLE_LIMIT = 4

const TAG_DEFAULTS: Record<CallKind, string> = {
  blocker: "Blocker",
  contract: "Contract",
  alert: "Alert",
}

// English fallbacks for the pre-registered onAir.calls.actions.* keys.
const ACTION_DEFAULTS: Record<string, string> = {
  fixLineup: "Fix lineup",
  openSquad: "Open squad",
  openScrims: "Open scrims",
  openFinances: "Open finances",
  openContracts: "Open contracts",
  openInbox: "Open inbox",
  renew: "Renew",
  review: "Review",
}

// Slanted word tag at the head of a row. Text always uses the paired foreground token.
const ROW_TAG_TONE: Record<TagTone, string> = {
  club: "bg-club text-club-foreground",
  secondary: "bg-secondary-foreground text-secondary",
  neutral: "bg-muted text-foreground",
  warning: "bg-warning text-warning-foreground",
  positive: "bg-positive text-positive-foreground",
  negative: "bg-negative text-negative-foreground",
  info: "bg-info text-info-foreground",
}

// Non-colour severity marker: the bar style differs (solid / dashed / dotted).
const ROW_SEVERITY: Record<CallItem["severity"], string> = {
  hard: "border-s-[0.1875rem] border-s-foreground [border-inline-start-style:solid]",
  soft: "border-s-[0.1875rem] border-s-foreground [border-inline-start-style:dashed]",
  info: "border-s-2 border-s-muted-foreground [border-inline-start-style:dotted]",
}

function actionDefault(key: string): string {
  const leaf = key.slice(key.lastIndexOf(".") + 1)
  return ACTION_DEFAULTS[leaf] ?? "Review"
}

/** Home panel listing everything that needs a decision before the game can move on. */
export function NeedsYourCallPanel({ items, total, hiddenContracts, onAct }: NeedsYourCallPanelProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const uid = useId()
  const headingId = `${uid}-heading`
  const listId = `${uid}-list`

  const canExpand = items.length > VISIBLE_LIMIT
  const visible = expanded || !canExpand ? items : items.slice(0, VISIBLE_LIMIT)
  const title = t("onAir.home.needsTitle", { defaultValue: "Needs your call" })

  const liveText =
    total > 0
      ? `${title}: ${t("onAir.bar.toResolve", { count: total, defaultValue: "{{count}} to resolve" })}`
      : t("onAir.home.needsEmpty", { defaultValue: "Nothing needs your call" })

  return (
    <section
      id="needs-your-call"
      tabIndex={-1}
      aria-labelledby={headingId}
      data-slot="needs-your-call"
      className="flex flex-col gap-3 rounded-xl border border-line bg-card p-4 text-card-foreground"
    >
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id={headingId} className="font-heading text-section font-bold uppercase leading-tight tracking-wide">
          {title}
        </h2>
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          {total > 0
            ? t("onAir.home.needsSubtitle", { defaultValue: "Resolve these before you continue." })
            : null}
        </p>
        {total > 0 ? (
          <span
            aria-hidden="true"
            data-slot="needs-your-call-count"
            className="inline-flex min-h-6 min-w-6 items-center justify-center rounded-full bg-secondary px-2 font-heading text-sm font-bold tabular-nums text-foreground"
          >
            {total}
          </span>
        ) : null}
      </header>

      <div role="status" aria-live="polite" className="sr-only" data-slot="needs-your-call-live">
        {liveText}
      </div>

      {items.length === 0 ? (
        <div
          data-slot="needs-your-call-empty"
          className="flex min-h-16 items-center gap-3 rounded-lg bg-secondary px-4"
        >
          <TagBlock tone="positive" size="md">
            {t("onAir.home.needsEmptyTag", { defaultValue: "All clear" })}
          </TagBlock>
          <p className="min-w-0 text-sm text-foreground">
            {t("onAir.home.needsEmptyHint", {
              defaultValue: "You can continue whenever you are ready.",
            })}
          </p>
        </div>
      ) : (
        <ul id={listId} className="flex flex-col gap-2">
          {visible.map((item) => (
            <li
              key={item.id}
              data-slot="lower-third"
              data-severity={item.severity}
              className={cn(
                "flex min-h-16 flex-wrap items-stretch gap-x-4 overflow-hidden rounded-lg bg-secondary text-card-foreground",
                ROW_SEVERITY[item.severity],
              )}
            >
              <span
                data-slot="call-tag"
                data-tone={item.tagTone}
                className={cn(
                  "flex min-w-24 shrink-0 items-center py-2 ps-4 pe-8 font-heading text-lg font-bold leading-none [clip-path:polygon(0_0,100%_0,calc(100%-1rem)_100%,0_100%)]",
                  ROW_TAG_TONE[item.tagTone],
                )}
              >
                {t(item.tagKey, { defaultValue: TAG_DEFAULTS[item.kind] })}
              </span>
              <div className="flex min-w-0 flex-1 basis-48 flex-col justify-center gap-0.5 py-2">
                <div data-slot="lower-third-headline" className="font-heading text-lg font-semibold leading-tight">
                  {item.headline}
                </div>
                {item.consequence ? (
                  <div data-slot="lower-third-consequence" className="text-sm text-muted-foreground">
                    {item.consequence}
                  </div>
                ) : null}
              </div>
              <div className="flex items-center py-2 pe-3">
                <Button type="button" variant="club" size="touch" onClick={() => onAct(item)}>
                  {t(item.actionLabelKey, { defaultValue: actionDefault(item.actionLabelKey) })}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {hiddenContracts > 0 ? (
        <p className="text-sm text-muted-foreground" data-slot="needs-your-call-hidden">
          {t("onAir.home.moreContracts", {
            count: hiddenContracts,
            defaultValue: "{{count}} more contract renewals not shown",
          })}
        </p>
      ) : null}

      {canExpand ? (
        <Button
          type="button"
          variant="ghost"
          size="touch"
          className="self-start text-club-text"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded
            ? t("onAir.home.showLess", { defaultValue: "Show less" })
            : t("onAir.home.seeAll", { count: items.length, defaultValue: "See all {{count}}" })}
        </Button>
      ) : null}
    </section>
  )
}
