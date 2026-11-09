import { AlertTriangle } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { TFunction } from "i18next"

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

const VISIBLE_ROWS = 5
const MISSING = "\u0000"

/**
 * Category labels live under inbox.categories.*, and the training key is registered
 * in lowercase while the backend sends "Training". Resolve the label tolerantly and
 * fall back to the raw category so a chip is never empty.
 */
function resolveCategoryLabel(t: TFunction, message: InboxPanelMessage): string {
  const { category, categoryLabel } = message
  if (categoryLabel && categoryLabel !== `inbox.categories.${category}`) return categoryLabel
  const lowerFirst = category.charAt(0).toLowerCase() + category.slice(1)
  for (const candidate of new Set([category, lowerFirst, category.toLowerCase()])) {
    const label = t(`inbox.categories.${candidate}`, { defaultValue: MISSING }) as string
    if (label && label !== MISSING && label !== `inbox.categories.${candidate}`) return label
  }
  return category
}

/** Compact Home inbox: the latest messages with unread, urgent and category cues. */
export function InboxPanel({ messages, unreadCount, onOpen }: InboxPanelProps) {
  const { t } = useTranslation()
  const rows = messages.slice(0, VISIBLE_ROWS)

  return (
    <section
      data-slot="inbox-panel"
      aria-label={t("onAir.home.inboxTitle", { defaultValue: "Inbox" })}
      className="flex flex-col gap-3 rounded-xl border border-line bg-card p-4 text-card-foreground"
    >
      <header className="flex items-center gap-3">
        <h2 className="min-w-0 flex-1 font-heading text-section font-bold uppercase leading-tight tracking-wide">
          {t("onAir.home.inboxTitle", { defaultValue: "Inbox" })}
        </h2>
        {unreadCount > 0 ? (
          <span
            data-slot="inbox-unread-count"
            className="shrink-0 rounded-full bg-club px-3 py-1 font-heading text-sm font-bold tabular-nums text-club-foreground"
          >
            {t("onAir.home.unreadCount", { count: unreadCount, defaultValue: "{{count}} unread" })}
          </span>
        ) : null}
        <Button type="button" variant="ghost" size="touch" className="shrink-0 text-club-text" onClick={() => onOpen()}>
          {t("onAir.home.openInbox", { defaultValue: "Open inbox" })}
        </Button>
      </header>

      {rows.length === 0 ? (
        <p data-slot="inbox-empty" className="py-2 text-sm text-muted-foreground">
          {t("onAir.home.inboxEmpty", { defaultValue: "Your inbox is clear" })}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line/60">
          {rows.map((message) => (
            <li key={message.id}>
              <button
                type="button"
                onClick={() => onOpen(message.id)}
                className="flex min-h-9 w-full items-center gap-3 rounded-md py-1.5 text-start hover:bg-muted/60"
              >
                {message.unread ? (
                  <span className="sr-only">{t("onAir.home.unreadRow", { defaultValue: "Unread" })}</span>
                ) : null}
                <span className="w-20 shrink-0">
                  <TagBlock tone="neutral" size="sm" className="max-w-full">
                    <span className="truncate" title={resolveCategoryLabel(t, message)}>
                      {resolveCategoryLabel(t, message)}
                    </span>
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
                  <TagBlock tone="negative" size="sm" icon={<AlertTriangle />}>
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
