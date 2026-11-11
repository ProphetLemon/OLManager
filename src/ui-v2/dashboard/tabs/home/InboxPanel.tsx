import { useLayoutEffect, useRef, useState } from "react"
import { AlertTriangle } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { TFunction } from "i18next"

import { resolveInboxCategoryLabel } from "@/lib/inbox/categoryLabel"
import { Button } from "@/ui-v2/components/ui/button"
import { TagBlock } from "@/ui-v2/components/ui/tag-block"
import { cn } from "@/ui-v2/lib/utils"

export interface InboxPanelMessage {
  id: string
  subject: string
  sender: string
  date: string
  category: string
  categoryLabel: string
  unread: boolean
  urgent: boolean
}

export interface InboxPanelProps {
  messages: InboxPanelMessage[]
  unreadCount: number
  onOpen: (messageId?: string) => void
}

/** Rows rendered before the list is measured (and when it cannot be measured). */
const VISIBLE_ROWS = 5
/** Upper bound of rows when the panel is tall enough for more than the default. */
const MAX_ROWS = 8
/** Fallback row height in px, matching the `h-9` row class. */
const ROW_HEIGHT_PX = 36

/**
 * Prefer the label the caller already resolved; otherwise resolve it from the category
 * (see resolveInboxCategoryLabel for the lowercase `training` key quirk).
 */
function resolveCategoryLabel(t: TFunction, message: InboxPanelMessage): string {
  const { category, categoryLabel } = message
  if (categoryLabel && categoryLabel !== `inbox.categories.${category}`) return categoryLabel
  return resolveInboxCategoryLabel(t, category)
}

/**
 * How many whole rows fit in `containerHeight`. An unmeasured container (height 0,
 * e.g. before layout or in jsdom) keeps `fallback` so the list never renders empty.
 */
export function fitRowCount(
  containerHeight: number,
  rowHeight: number,
  max: number = MAX_ROWS,
  fallback: number = VISIBLE_ROWS
): number {
  if (!(containerHeight > 0) || !(rowHeight > 0)) return fallback
  return Math.max(1, Math.min(max, Math.floor(containerHeight / rowHeight)))
}

/** Compact Home inbox: the latest messages with unread, urgent and category cues. */
export function InboxPanel({ messages, unreadCount, onOpen }: InboxPanelProps) {
  const { t } = useTranslation()
  const listRef = useRef<HTMLUListElement>(null)
  const [fit, setFit] = useState(VISIBLE_ROWS)
  const hasRows = messages.length > 0

  // Render only the rows that fit whole, so no row is ever cut mid-text and the
  // list needs no scrollbar; "Open inbox" in the header covers the rest.
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const measure = () => {
      const firstRow = list.querySelector("li")
      const rowHeight = firstRow instanceof HTMLElement && firstRow.offsetHeight > 0 ? firstRow.offsetHeight : ROW_HEIGHT_PX
      setFit(fitRowCount(list.clientHeight, rowHeight))
    }
    measure()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measure)
    observer.observe(list)
    return () => observer.disconnect()
  }, [hasRows])

  const rows = messages.slice(0, fit)

  return (
    <section
      data-slot="inbox-panel"
      aria-label={t("onAir.home.inboxTitle", { defaultValue: "Inbox" })}
      className="flex h-full min-h-0 flex-col gap-3 rounded-xl border border-line bg-card p-4 text-card-foreground"
    >
      <header className="flex items-center gap-2">
        <h2
          className="min-w-0 flex-1 truncate whitespace-nowrap font-heading text-section font-bold uppercase leading-tight tracking-wide">
          {t("onAir.home.inboxTitleShort", { defaultValue: "Inbox" })}
        </h2>
        {unreadCount > 0 ? (
          <span
            data-slot="inbox-unread-count"
            className="shrink-0 whitespace-nowrap rounded-full bg-club px-2.5 py-1 font-heading text-sm font-bold tabular-nums text-club-foreground"
          >
            {t("onAir.home.unreadCount", { count: unreadCount, defaultValue: "{{count}} unread" })}
          </span>
        ) : null}
        <Button type="button" variant="ghost" size="touch" className="shrink-0 whitespace-nowrap px-2 text-club-text" onClick={() => onOpen()}>
          {t("onAir.home.openInbox", { defaultValue: "Open inbox" })}
        </Button>
      </header>

      {rows.length === 0 ? (
        <p data-slot="inbox-empty" className="py-2 text-sm text-muted-foreground">
          {t("onAir.home.inboxEmpty", { defaultValue: "Your inbox is clear" })}
        </p>
      ) : (
        <ul ref={listRef} data-slot="inbox-list" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {rows.map((message) => (
            <li key={message.id} className="box-border h-9 shrink-0 border-b border-line/60 last:border-b-0">
              <button
                type="button"
                onClick={() => onOpen(message.id)}
                className="flex h-full w-full items-center gap-3 rounded-md text-start hover:bg-muted/60"
              >
                {message.unread ? (
                  <span className="sr-only">{t("onAir.home.unreadRow", { defaultValue: "Unread" })}</span>
                ) : null}
                <span data-slot="inbox-category" className="min-w-28 shrink-0">
                  <TagBlock tone="neutral" size="sm" className="whitespace-nowrap">
                    {resolveCategoryLabel(t, message)}
                  </TagBlock>
                </span>
                <span
                  title={message.subject}
                  className={cn(
                    "min-w-0 flex-1 truncate text-sm",
                    message.unread ? "font-bold text-foreground" : "font-normal text-muted-foreground"
                  )}
                >
                  {message.subject}
                </span>
                {message.urgent ? (
                  <TagBlock tone="negative" size="sm" icon={<AlertTriangle />} className="shrink-0">
                    {t("inbox.urgent", { defaultValue: "Urgent" })}
                  </TagBlock>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
