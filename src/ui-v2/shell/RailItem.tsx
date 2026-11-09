import type { LucideIcon } from "lucide-react";
import type { Ref } from "react";

import { cn } from "@/ui-v2/lib/utils";

interface RailItemProps {
  icon: LucideIcon;
  label: string;
  /** Marks the stop that owns the current page: bar, tint, weight and aria-current. */
  active?: boolean;
  /** Count shown on the icon; also appended to the accessible name. */
  badge?: number;
  tabIndex?: 0 | -1;
  onClick: () => void;
  /** Hides the visible label (still exposed through the accessible name). */
  compact?: boolean;
  tone?: "default" | "danger";
  buttonRef?: Ref<HTMLButtonElement>;
  "data-rail-stop"?: string;
}

const BADGE_CAP = 99;

/** One icon-over-label stop of the navigation rail. */
export function RailItem({
  icon: Icon,
  label,
  active = false,
  badge,
  tabIndex,
  onClick,
  compact = false,
  tone = "default",
  buttonRef,
  ...rest
}: RailItemProps) {
  const count = badge !== undefined && badge > 0 ? badge : 0;
  const badgeText = count > BADGE_CAP ? `${BADGE_CAP}+` : String(count);
  const accessibleName = count > 0 ? `${label}, ${badgeText}` : label;

  return (
    <button
      ref={buttonRef}
      type="button"
      tabIndex={tabIndex}
      onClick={onClick}
      aria-label={accessibleName}
      aria-current={active ? "page" : undefined}
      title={label}
      data-slot="rail-item"
      data-active={active ? "true" : undefined}
      data-rail-stop={rest["data-rail-stop"]}
      className={cn(
        "relative flex min-h-[var(--hit)] w-full flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-center transition-colors",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring",
        tone === "danger"
          ? "text-negative hover:bg-negative/10"
          : active
            ? "bg-[color-mix(in_srgb,var(--club)_16%,transparent)] text-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {active && (
        <span
          aria-hidden="true"
          data-slot="rail-item-bar"
          className="absolute inset-y-0 start-0 my-auto h-12 max-h-full w-1 rounded-e-sm bg-club-text"
        />
      )}
      <span className="relative inline-flex">
        <Icon className="size-5 shrink-0" aria-hidden="true" />
        {count > 0 && (
          <span
            aria-hidden="true"
            data-slot="rail-item-badge"
            className="absolute -top-1.5 -end-2.5 inline-flex min-w-4 items-center justify-center rounded-full bg-club px-1 font-heading text-xs leading-4 font-bold text-club-foreground tabular-nums"
          >
            {badgeText}
          </span>
        )}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "w-full truncate font-heading text-xs leading-4",
          active ? "font-bold" : "font-medium",
          compact && "sr-only",
        )}
      >
        {label}
      </span>
    </button>
  );
}
