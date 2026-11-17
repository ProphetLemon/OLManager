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
