import { useId, useState } from "react"
import { useTranslation } from "react-i18next"

import type { CallItem, CallKind } from "@/lib/dashboard/needsYourCall"
import { LowerThird } from "@/ui-v2/components/ui/lower-third"
import { Button } from "@/ui-v2/components/ui/button"
import { TagBlock } from "@/ui-v2/components/ui/tag-block"

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
      <header className="flex items-center justify-between gap-3">
        <h2 id={headingId} className="font-heading text-section font-semibold leading-tight">
          {title}
        </h2>
        {total > 0 ? (
          <span aria-hidden="true">
            <TagBlock tone="warning" size="sm">
              {total}
            </TagBlock>
          </span>
        ) : null}
      </header>

      <div role="status" aria-live="polite" className="sr-only" data-slot="needs-your-call-live">
        {liveText}
      </div>

      {items.length === 0 ? (
        <div data-slot="needs-your-call-empty" className="flex flex-col gap-1 py-2">
          <p className="font-heading text-section font-semibold">
            {t("onAir.home.needsEmpty", { defaultValue: "Nothing needs your call" })}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("onAir.home.needsEmptyHint", {
              defaultValue: "You can continue whenever you are ready.",
            })}
          </p>
        </div>
      ) : (
        <ul id={listId} className="flex flex-col gap-2">
          {visible.map((item) => (
            <LowerThird
              key={item.id}
              as="li"
              className="bg-secondary"
              severity={item.severity}
              tagLabel={t(item.tagKey, { defaultValue: TAG_DEFAULTS[item.kind] })}
              tagTone={item.tagTone}
              headline={item.headline}
              consequence={item.consequence}
              action={{
                label: t(item.actionLabelKey, { defaultValue: actionDefault(item.actionLabelKey) }),
                onClick: () => onAct(item),
              }}
            />
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
