import type { LucideIcon } from "lucide-react";
import type { Ref } from "react";

import { IconTip } from "@/ui-v2/components/ui/icon-tip";
import { cn } from "@/ui-v2/lib/utils";

interface RailItemProps {
  icon: LucideIcon;
  label: string;
  /** Marks the stop that owns the current page: bar, tint, weight and aria-current. */
  active?: boolean;
  /** Count shown on the icon; also appended to the accessible name. */
  badge?: number;
  /** Short description of what the stop opens (a launcher's children). */
  hint?: string;
  tabIndex?: 0 | -1;
  onClick: () => void;
  /** Hides the visible label (still exposed through the accessible name). */
  compact?: boolean;
  /**
   * R13: no visible label, the stop is a `--nav-cell` cell with an IconTip (hover and keyboard
   * focus) and its aria-label. Used when the labelled stops would not fit the rail's height.
   */
  iconOnly?: boolean;
  tone?: "default" | "danger";
  buttonRef?: Ref<HTMLButtonElement>;
  "data-rail-stop"?: string;
  /** Stable row id (`util:settings`) the tree rail keys focus and tests on. */
  "data-nav-id"?: string;
}

const BADGE_CAP = 99;

/** One icon-over-label stop of the navigation rail. */
export function RailItem({
  icon: Icon,
  label,
  active = false,
  badge,
  hint,
  tabIndex,
  onClick,
  compact = false,
  iconOnly = false,
  tone = "default",
  buttonRef,
  ...rest
}: RailItemProps) {
  const count = badge !== undefined && badge > 0 ? badge : 0;
  const badgeText = count > BADGE_CAP ? `${BADGE_CAP}+` : String(count);
  const accessibleName = count > 0 ? `${label}, ${badgeText}` : label;

  const iconAndBadge = (
    <>
      <Icon className="size-[var(--nav-icon)] shrink-0" aria-hidden="true" />
      {count > 0 && (
        <span
          aria-hidden="true"
          data-slot="rail-item-badge"
          className="absolute -top-1.5 -end-2.5 inline-flex min-w-4 items-center justify-center rounded-full bg-club px-1 font-heading text-nav leading-4 font-bold text-club-foreground tabular-nums"
        >
          {badgeText}
        </span>
      )}
    </>
  );

  return (
    <button
      ref={buttonRef}
      type="button"
      tabIndex={tabIndex}
      onClick={onClick}
      aria-label={accessibleName}
      aria-current={active ? "page" : undefined}
      aria-description={hint}
      title={iconOnly ? undefined : hint ? `${label}: ${hint}` : label}
      data-slot="rail-item"
      data-active={active ? "true" : undefined}
      data-rail-stop={rest["data-rail-stop"]}
      data-nav-id={rest["data-nav-id"]}
      className={cn(
        "relative mx-1.5 flex w-[calc(100%-0.75rem)] scroll-my-8 flex-col rounded-[0.625rem] items-center justify-center text-center transition-colors",
        iconOnly ? "h-[var(--nav-cell)]" : "min-h-[var(--hit)] gap-0.5 px-1 py-1.5",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring",
        tone === "danger"
          ? "text-negative hover:bg-negative/10"
          : active
            ? "bg-[color-mix(in_srgb,var(--club)_16%,transparent)] text-foreground [[data-contrast=high]_&]:data-[active=true]:outline-2 [[data-contrast=high]_&]:data-[active=true]:-outline-offset-2 [[data-contrast=high]_&]:data-[active=true]:outline-solid [[data-contrast=high]_&]:data-[active=true]:outline-club-text"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {active && (
        <span
          aria-hidden="true"
          data-slot="rail-item-bar"
          className="absolute inset-y-0 -start-1.5 my-auto h-8 max-h-full w-1 rounded-e-sm bg-club-text"
        />
      )}
      {iconOnly ? (
        // The tip's parent must be the button itself, so it follows the button's focus.
        <IconTip label={hint ? `${label}: ${hint}` : label} followFocus className="relative inline-flex">
          {iconAndBadge}
        </IconTip>
      ) : (
        <span className="relative inline-flex">{iconAndBadge}</span>
      )}
      {!iconOnly && (
      <span
        aria-hidden="true"
        data-slot="rail-item-label"
        className={cn(
          // Up to two balanced lines, hyphenated by the document language, never clipped (R12).
          "w-full wrap-break-word font-heading text-nav leading-4 line-clamp-2 text-balance hyphens-auto",
          active ? "font-bold" : "font-medium",
          compact && "sr-only",
        )}
      >
        {label}
      </span>
      )}
    </button>
  );
}
