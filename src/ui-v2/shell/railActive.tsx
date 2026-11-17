import { cn } from "@/ui-v2/lib/utils";

/** Most a badge shows: 99+ beyond it. */
export const BADGE_CAP = 99;

/** The text of a badge count, capped. */
export function badgeText(count: number): string {
  return count > BADGE_CAP ? `${BADGE_CAP}+` : String(count);
}

/**
 * A label with its badge count attached, "Players (22)", so a count never reads as part of
 * the clause that follows it ("Players (22), 2 need your call").
 */
export function withBadge(label: string, badge: number | undefined): string {
  return badge !== undefined && badge > 0 ? `${label} (${badgeText(badge)})` : label;
}

/**
 * What the row that owns the current page wears, in every rail form: the club tint (`--row-wash`),
 * foreground text, and a solid outline in high contrast. Weight and the bar come with it, so the
 * state never depends on colour alone.
 */
export const ACTIVE_ROW_CLASS =
  "bg-[var(--row-wash)] text-foreground [[data-contrast=high]_&]:data-[active=true]:outline-2 [[data-contrast=high]_&]:data-[active=true]:-outline-offset-2 [[data-contrast=high]_&]:data-[active=true]:outline-solid [[data-contrast=high]_&]:data-[active=true]:outline-club-text";

/** The 3 px club bar at a row's start edge: tall for an icon-over-label stop, short for a text row. */
export function RailActiveBar({ size }: { size: "stop" | "row" }) {
  return (
    <span
      aria-hidden="true"
      data-slot="rail-item-bar"
      className={cn(
        "absolute inset-y-0 -start-1.5 my-auto rounded-e-sm bg-club-text",
        size === "stop" ? "h-8 max-h-full w-1" : "h-4 w-[3px]",
      )}
    />
  );
}
