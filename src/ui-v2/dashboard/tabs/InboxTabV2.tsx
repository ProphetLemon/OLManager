import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDownUp,
  ArrowLeft,
  CheckCheck,
  Inbox as InboxIcon,
  Search,
  Trash2,
} from "lucide-react";

import type { GameStateData, MessageAction, MessageData } from "@/store/gameStore";
import {
  clearOldMessages,
  deleteMessage,
  markAllMessagesRead,
  markMessageRead,
  resolveMessageAction,
} from "@/services/inboxService";
import { resolveBackendText, resolveMessage } from "@/lib/i18n/backendI18n";
import {
  getFilteredMessages,
  getNavigationTarget,
  isNavigateAction,
  sortInboxMessages,
  UNREAD_FILTER,
  type MessageSortOrder,
} from "@/lib/inbox/helpers";
import { formatDateShort } from "@/lib/common/helpers";
import { useTabUiStore } from "@/store/tabUiStore";

import { Card, CardContent } from "@/ui-v2/components/ui/card";
import { Badge } from "@/ui-v2/components/ui/badge";
import { Button } from "@/ui-v2/components/ui/button";
import { Separator } from "@/ui-v2/components/ui/separator";
import { cn } from "@/ui-v2/lib/utils";

interface Props {
  gameState: GameStateData;
  onGameUpdate: (g: GameStateData) => void;
  initialMessageId?: string | null;
  onNavigate?: (tab: string, ctx?: { messageId?: string }) => void;
}

export function InboxTabV2({
  gameState,
  onGameUpdate,
  initialMessageId,
  onNavigate,
}: Props) {
  const { t, i18n } = useTranslation();
  const messages = gameState.messages ?? [];
  const allMessages = useMemo(
    () => messages.map(resolveMessage),
    [messages, i18n.language],
  );

  const [selectedId, setSelectedId] = useState<string | null>(initialMessageId ?? null);
  const [filter, setFilter] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<MessageSortOrder>("newest");
  const [query, setQuery] = useState("");
  const [effect, setEffect] = useState<string | null>(null);

  const categoryCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const msg of allMessages) {
      m.set(msg.category, (m.get(msg.category) ?? 0) + 1);
    }
    return m;
  }, [allMessages]);

  const categories = useMemo(() => Array.from(categoryCounts.keys()).sort(), [categoryCounts]);

  const filteredMessages = useMemo(() => {
    const base = sortInboxMessages(getFilteredMessages(allMessages, filter), sortOrder);
    if (!query.trim()) return base;
    const q = query.toLowerCase();
    return base.filter(
      (m) =>
        m.subject.toLowerCase().includes(q) ||
        m.body.toLowerCase().includes(q) ||
        m.sender.toLowerCase().includes(q),
    );
  }, [allMessages, filter, sortOrder, query]);

  const unreadCount = useMemo(() => allMessages.filter((m) => !m.read).length, [allMessages]);
  const selectedMessage = useMemo(
    () => allMessages.find((m) => m.id === selectedId) ?? null,
    [allMessages, selectedId],
  );

  useEffect(() => {
    const ids = new Set(allMessages.map((m) => m.id));
    if (selectedId && !ids.has(selectedId)) setSelectedId(null);
  }, [allMessages, selectedId]);

  async function handleSelect(id: string) {
    setSelectedId(id);
    setEffect(null);
    const msg = allMessages.find((m) => m.id === id);
    if (msg && !msg.read) {
      try {
        const updated = await markMessageRead(id);
        onGameUpdate(updated);
      } catch {
        /* ignore */
      }
    }
  }

  async function handleMarkAllRead() {
    try {
      const updated = await markAllMessagesRead();
      onGameUpdate(updated);
    } catch {
      /* ignore */
    }
  }

  async function handleClearOld() {
    try {
      const updated = await clearOldMessages();
      onGameUpdate(updated);
      setSelectedId(null);
    } catch {
      /* ignore */
    }
  }

  async function handleDelete(id: string) {
    try {
      const updated = await deleteMessage(id);
      onGameUpdate(updated);
      if (selectedId === id) setSelectedId(null);
    } catch {
      /* ignore */
    }
  }

  async function handleAction(messageId: string, actionId: string, optionId?: string) {
    const msg = allMessages.find((m) => m.id === messageId);
    const action = msg?.actions.find((a) => a.id === actionId);
    if (action && isNavigateAction(action.action_type)) {
      const target = getNavigationTarget(action.action_type.NavigateTo.route);
      if (target.tab === "Transfers" && target.view) {
        // The Transfers view is persisted in the tab UI store; preselect it before navigating.
        useTabUiStore.getState().setTabField("transfers", "view", target.view);
      }
      onNavigate?.(target.tab, target.context);
      if (!target.shouldResolveAction) return;
    }
    try {
      const result = await resolveMessageAction(messageId, actionId, optionId);
      onGameUpdate(result.game);
      if (result.effect) {
        const params = result.effect_i18n_params
          ? Object.fromEntries(
              Object.entries(result.effect_i18n_params).map(([k, v]) => [k, String(v)]),
            )
          : undefined;
        const text = resolveBackendText(
          result.effect_i18n_key ?? undefined,
          result.effect,
          params,
        );
        setEffect(text);
        setTimeout(() => setEffect(null), 4000);
      }
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      {/* Toolbar */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-3">
          <div className="flex items-center gap-2">
            <InboxIcon className="size-5 text-primary" />
            <span className="font-heading text-base font-bold uppercase tracking-wider">
              {t("inbox.title")}
            </span>
            <Badge variant="secondary" className="tabular-nums">
              {allMessages.length}
            </Badge>
            {unreadCount > 0 && (
              <Badge className="tabular-nums">{t("inbox.unread", { count: unreadCount })}</Badge>
            )}
          </div>

          <Separator orientation="vertical" className="h-6" />

          {/* Search */}
          <div className="flex h-8 flex-1 items-center gap-2 rounded-md border border-border bg-muted/30 px-3 min-w-48">
            <Search className="size-3.5 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("common.search")}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          {/* Sort */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSortOrder((s) => (s === "newest" ? "oldest" : "newest"))}
          >
            <ArrowDownUp className="size-3.5" />
            {sortOrder === "newest" ? t("inbox.sortNewest") : t("inbox.sortOldest")}
          </Button>

          {/* Actions */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleMarkAllRead}
            disabled={unreadCount === 0}
          >
            <CheckCheck className="size-3.5" />
            {t("inbox.markAllRead")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleClearOld}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
            {t("inbox.clearOld")}
          </Button>
        </CardContent>
      </Card>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-1.5">
        <FilterChip
          active={filter === null}
          onClick={() => setFilter(null)}
          label={t("inbox.all", { count: allMessages.length })}
        />
        <FilterChip
          active={filter === UNREAD_FILTER}
          onClick={() => setFilter(UNREAD_FILTER)}
          label={t("inbox.unread", { count: unreadCount })}
          accent
        />
        {categories.map((c) => (
          <FilterChip
            key={c}
            active={filter === c}
            onClick={() => setFilter((f) => (f === c ? null : c))}
            label={`${c} (${categoryCounts.get(c)})`}
          />
        ))}
      </div>

      {/* Master / detail */}
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[360px_1fr]">
        <Card className="flex h-full min-h-0 flex-col overflow-hidden p-0">
          {filteredMessages.length === 0 ? (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
              {t("inbox.noMessages")}
            </div>
          ) : (
            <ul className="flex-1 divide-y divide-border/40 overflow-y-auto">
              {filteredMessages.map((m) => (
                <MessageRow
                  key={m.id}
                  message={m}
                  isSelected={m.id === selectedId}
                  lang={i18n.language}
                  onSelect={() => handleSelect(m.id)}
                />
              ))}
            </ul>
          )}
        </Card>

        <Card className="flex h-full min-h-0 flex-col overflow-hidden">
          {selectedMessage ? (
            <DetailPane
              message={selectedMessage}
              lang={i18n.language}
              effect={effect}
              onAction={(actionId, optionId) => handleAction(selectedMessage.id, actionId, optionId)}
              onClose={() => { setSelectedId(null); setEffect(null); }}
              onDelete={() => handleDelete(selectedMessage.id)}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              {t("inbox.selectMessage")}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────

function FilterChip({
  active,
  onClick,
  label,
  accent,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary/10 text-primary"
          : accent
            ? "border-border bg-card text-foreground hover:bg-muted"
            : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function MessageRow({
  message,
  isSelected,
  lang,
  onSelect,
}: {
  message: MessageData;
  isSelected: boolean;
  lang: string;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "flex w-full items-start gap-3 border-l-4 px-3 py-3 text-left transition-colors hover:bg-muted/40",
          message.read ? "border-l-transparent" : "border-l-primary",
          isSelected && "bg-muted",
        )}
      >
        <div
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg font-heading text-sm font-bold overflow-hidden",
            message.read ? "bg-muted text-muted-foreground" : "bg-primary/15 text-primary",
          )}
        >
          {message.sender_icon ? (
            <img
              src={`/messages-icons/${message.sender_icon}`}
              alt={message.sender}
              className="size-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
                (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden");
              }}
            />
          ) : null}
          <span className={cn(message.sender_icon && "hidden")}>
            {message.sender.charAt(0).toUpperCase()}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <div
              className={cn(
                "truncate text-sm",
                message.read ? "font-normal text-muted-foreground" : "font-semibold text-foreground",
              )}
            >
              {message.subject}
            </div>
            <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
              {formatDateShort(message.date, lang)}
            </span>
          </div>
          <div className="truncate text-xs text-muted-foreground">{message.sender}</div>
          <div
            className={cn(
              "mt-0.5 truncate text-xs",
              message.read ? "text-muted-foreground/70" : "text-muted-foreground",
            )}
          >
            {message.body}
          </div>
        </div>
      </button>
    </li>
  );
}

function DetailPane({
  message,
  lang,
  effect,
  onAction,
  onClose,
  onDelete,
}: {
  message: MessageData;
  lang: string;
  effect: string | null;
  onAction: (actionId: string, optionId?: string) => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [openOptions, setOpenOptions] = useState<string | null>(null);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t("inbox.close")}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onDelete}
          aria-label={t("inbox.deleteMessage")}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        <h2 className="font-heading text-xl font-bold leading-tight">{message.subject}</h2>
        <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
          {message.sender_icon && (
            <img
              src={`/messages-icons/${message.sender_icon}`}
              alt=""
              className="size-5 rounded object-contain bg-muted"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          )}
          <span>{message.sender}</span>
          {message.sender_role && (
            <>
              <span>·</span>
              <span>{message.sender_role}</span>
            </>
          )}
          <span>·</span>
          <span>{formatDateShort(message.date, lang)}</span>
        </div>

        <Separator className="my-4" />

        <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
          {message.body}
        </div>

        {effect && (
          <div className="mt-4 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
            {effect}
          </div>
        )}
      </div>

      {message.actions.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-border bg-muted/20 px-5 py-3">
          {message.actions.map((action) => (
            <ActionButton
              key={action.id}
              action={action}
              openOptions={openOptions}
              onToggleOptions={() =>
                setOpenOptions((o) => (o === action.id ? null : action.id))
              }
              onResolve={(optionId) => {
                onAction(action.id, optionId);
                setOpenOptions(null);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ActionButton({
  action,
  openOptions,
  onToggleOptions,
  onResolve,
}: {
  action: MessageAction;
  openOptions: string | null;
  onToggleOptions: () => void;
  onResolve: (optionId?: string) => void;
}) {
  const type = action.action_type;

  if (typeof type === "object" && "ChooseOption" in type) {
    const isOpen = openOptions === action.id;
    return (
      <div className="relative">
        <Button
          variant={action.resolved ? "outline" : "default"}
          size="sm"
          disabled={action.resolved}
          onClick={onToggleOptions}
        >
          {action.label}
        </Button>
        {isOpen && (
          <div className="absolute bottom-full left-0 z-10 mb-1 w-64 rounded-md border border-border bg-popover p-1 shadow-lg">
            {type.ChooseOption.options.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onResolve(opt.id)}
                className="block w-full rounded-sm px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
              >
                <div className="font-medium">{opt.label}</div>
                {opt.description && (
                  <div className="text-xs text-muted-foreground">{opt.description}</div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const isNav = typeof type === "object" && "NavigateTo" in type;
  return (
    <Button
      variant={isNav ? "outline" : action.resolved ? "outline" : "default"}
      size="sm"
      disabled={action.resolved}
      onClick={() => onResolve()}
    >
      {action.label}
    </Button>
  );
}


