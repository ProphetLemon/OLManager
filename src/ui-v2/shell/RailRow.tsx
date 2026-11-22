import { ChevronDown, TriangleAlert, type LucideIcon } from "lucide-react";
import type { Ref } from "react";

import { cn } from "@/ui-v2/lib/utils";

import { ACTIVE_ROW_CLASS, RailActiveBar, badgeText as formatBadge } from "./railActive";

export type RailRowKind = "leaf" | "header" | "child" | "panel";

interface RailRowProps {
  kind: RailRowKind;
  /** Stable id, exposed as `data-nav-id` (`tab:Squad`, `group:club`). */
  navId: string;
  label: string;
  /** Not shown for children. */
  icon?: LucideIcon;
  /** Count appended to the accessible name (capped at 99+). */
  badge?: number;
  /** The row that owns the current page: wash, bar, bold and aria-current. */
  active?: boolean;
  /** Headers: the group holds the active tab. Bold and marked, never aria-current. */
  activeWithin?: boolean;
  /** Panel rows on touch: `--hit` high (ruling R1: 48 px on Android) instead of `--nav-row-child`. */
  tall?: boolean;
  /** Headers only. */
  expanded?: boolean;
  controls?: string;
  /** Something here needs a call: a warning icon (a shape, not a colour) and the count above 1. */
  attention?: { count: number; headline: string };
  /** The accessible name of an attention row ("Scrims, needs your call"); replaces the label. */
  attentionName?: string;
  tabIndex?: 0 | -1;
  buttonRef?: Ref<HTMLButtonElement>;
  onClick: () => void;
}

/** One row of the rail tree: a direct stop, a group header (disclosure) or a child. */
export function RailRow({
  kind,
  navId,
  label,
  icon: Icon,
  badge,
  active = false,
  activeWithin = false,
  tall = false,
  expanded,
  controls,
  attention,
  attentionName,
  tabIndex,
  buttonRef,
  onClick,
}: RailRowProps) {
  const count = badge !== undefined && badge > 0 ? badge : 0;
  const badgeText = formatBadge(count);
  const isHeader = kind === "header";
  const bold = active || activeWithin;

  return (
    <button
      ref={buttonRef}
      type="button"
      tabIndex={tabIndex}
      onClick={onClick}
      // An attention name already carries the badge in front of its clause ("Players (22), 2 need your call").
      aria-label={attentionName ?? (count > 0 ? `${label}, ${badgeText}` : label)}
      aria-description={attention?.headline}
      // A collapsed header that holds the current page says so ("true": only the row itself is "page").
      aria-current={active ? "page" : activeWithin && expanded === false ? "true" : undefined}
      aria-expanded={isHeader ? expanded : undefined}
      aria-controls={isHeader ? controls : undefined}
      title={label}
      data-slot="rail-row"
      data-nav-id={navId}
      data-active={active ? "true" : undefined}
      data-active-within={activeWithin ? "true" : undefined}
      className={cn(
        "relative flex w-full items-center gap-2 rounded-[0.625rem] pe-2 text-start transition-colors",
        bold ? "font-bold" : "font-medium",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring",
        kind === "child"
          ? "h-[var(--nav-row-child)] ps-[var(--nav-indent)]"
          : kind === "panel"
            ? cn(tall ? "min-h-[var(--hit)]" : "min-h-[var(--nav-row-child)]", "py-[2px] ps-3")
            : "h-[var(--nav-row)] ps-3",
        active
          ? ACTIVE_ROW_CLASS
          : activeWithin
            ? "text-foreground hover:bg-accent"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {active && <RailActiveBar size="row" />}
      {Icon && <Icon className="size-[var(--nav-icon)] shrink-0" aria-hidden="true" />}
      <span
        aria-hidden="true"
        className={cn(
          "min-w-0 flex-1 font-heading text-nav leading-4",
          kind === "panel" ? "line-clamp-2 wrap-break-word hyphens-auto" : "truncate",
        )}
      >
        {label}
      </span>
      {attention && (
        <span
          aria-hidden="true"
          data-slot="rail-attention"
          className="inline-flex shrink-0 items-center gap-0.5 font-heading text-nav leading-4 font-bold tabular-nums"
        >
          <TriangleAlert className="size-[var(--nav-icon)]" />
          {attention.count > 1 ? attention.count : null}
        </span>
      )}
      {count > 0 && (
        <span
          aria-hidden="true"
          data-slot="rail-item-badge"
          className="inline-flex min-w-4 shrink-0 items-center justify-center rounded-full bg-club px-1 font-heading text-nav leading-4 font-bold text-club-foreground tabular-nums"
        >
          {badgeText}
        </span>
      )}
      {isHeader && (
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "size-[var(--nav-icon)] shrink-0 transition-transform motion-reduce:transition-none",
            !expanded && "-rotate-90 rtl:rotate-90",
          )}
        />
      )}
    </button>
  );
}
