import { ChevronDown, TriangleAlert, type LucideIcon } from "lucide-react";
import type { Ref } from "react";

import { cn } from "@/ui-v2/lib/utils";

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

const BADGE_CAP = 99;

/** One row of the rail tree: a direct stop, a group header (disclosure) or a child. */
export function RailRow({
  kind,
  navId,
  label,
  icon: Icon,
  badge,
  active = false,
  activeWithin = false,
  expanded,
  controls,
  attention,
  attentionName,
  tabIndex,
  buttonRef,
  onClick,
}: RailRowProps) {
  const count = badge !== undefined && badge > 0 ? badge : 0;
  const badgeText = count > BADGE_CAP ? `${BADGE_CAP}+` : String(count);
  const isHeader = kind === "header";
  const bold = active || activeWithin;

  return (
    <button
      ref={buttonRef}
      type="button"
      tabIndex={tabIndex}
      onClick={onClick}
      aria-label={count > 0 ? `${attentionName ?? label}, ${badgeText}` : (attentionName ?? label)}
      aria-description={attention?.headline}
      aria-current={active ? "page" : undefined}
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
            ? "min-h-[var(--nav-row-child)] py-[2px] ps-3"
            : "h-[var(--nav-row)] ps-3",
        active
          ? "bg-[color-mix(in_srgb,var(--club)_16%,transparent)] text-foreground [[data-contrast=high]_&]:data-[active=true]:outline-2 [[data-contrast=high]_&]:data-[active=true]:-outline-offset-2 [[data-contrast=high]_&]:data-[active=true]:outline-solid [[data-contrast=high]_&]:data-[active=true]:outline-club-text"
          : activeWithin
            ? "text-foreground hover:bg-accent"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {active && (
        <span
          aria-hidden="true"
          data-slot="rail-item-bar"
          className="absolute inset-y-0 -start-1.5 my-auto h-4 w-[3px] rounded-e-sm bg-club-text"
        />
      )}
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
