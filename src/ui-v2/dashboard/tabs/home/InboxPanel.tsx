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

const VISIBLE_ROWS = 3
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
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="font-heading text-section font-semibold leading-tight">
          {t("onAir.home.inboxTitle", { defaultValue: "Inbox" })}
        </h2>
        {unreadCount > 0 ? (
          <p className="text-sm font-semibold tabular-nums text-club-text" data-slot="inbox-unread-count">
            {t("onAir.home.unreadCount", { count: unreadCount, defaultValue: "{{count}} unread" })}
          </p>
        ) : null}
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
                className="flex min-h-[var(--hit)] w-full items-start gap-3 rounded-md py-2 text-start hover:bg-muted/60"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-1.5 size-2.5 shrink-0 rounded-full",
                    message.unread ? "bg-club" : "border border-line"
                  )}
                />
                {message.unread ? (
                  <span className="sr-only">
                    {t("onAir.home.unreadRow", { defaultValue: "Unread" })}
                  </span>
                ) : null}
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span
                    className={cn(
                      "truncate text-sm",
                      message.unread ? "font-semibold text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {message.subject}
                  </span>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <TagBlock tone="neutral" size="sm">
                      {resolveCategoryLabel(t, message)}
                    </TagBlock>
                    {message.urgent ? (
                      <TagBlock
                        tone="negative"
                        size="sm"
                        icon={<AlertTriangle />}
                      >
                        {t("inbox.urgent", { defaultValue: "Urgent" })}
                      </TagBlock>
                    ) : null}
                    <span className="min-w-0 truncate text-xs text-muted-foreground">{message.sender}</span>
                  </span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{message.date}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Button
        type="button"
        variant="outline"
        size="touch"
        className="self-start"
        onClick={() => onOpen()}
      >
        {t("onAir.home.openInbox", { defaultValue: "Open inbox" })}
      </Button>
    </section>
  )
}
