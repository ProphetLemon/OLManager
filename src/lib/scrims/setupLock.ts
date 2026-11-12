import { dateKey, weekdayMondayBased, type WeeklyScrimContext } from "@/lib/scrims/scrimContext";

/** Locale key explaining each reason the weekly scrim setup can be locked (see `weekly_scrim_setup_lock_state`). */
const LOCK_REASON_KEYS: Record<string, string> = {
  manual: "scrims.setupLockedManual",
  week_started: "scrims.setupLockedWeekStarted",
  first_scrim_window: "scrims.setupLockedFirstWindow",
  // The career began after this week's scrim days; the text names the Monday planning opens (`{{date}}`).
  career_started_late: "scrims.setupLockedCareerStart",
};

const DAY_MS = 86_400_000;

/** The ISO date (YYYY-MM-DD) of the Monday after `currentDate`, when the next week's scrim planning opens. */
export function nextPlanningMonday(currentDate: string): string {
  const day = dateKey(currentDate);
  const daysUntilMonday = 7 - weekdayMondayBased(day);
  return new Date(Date.parse(`${day}T00:00:00Z`) + daysUntilMonday * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The locale key that says why the weekly scrim form is disabled, or null while it can be edited.
 * Every state that disables the form has its own text, and each one says when it opens again.
 */
export function scrimSetupBlockedKey(week: WeeklyScrimContext, assistantControls: boolean): string | null {
  if (assistantControls) return "scrims.assistantHandling";
  if (week.setupLocked) {
    return (week.setupLockedReason && LOCK_REASON_KEYS[week.setupLockedReason]) || "scrims.setupLocked";
  }
  if (week.slots.length > 0 && week.slots.every((slot) => !slot.canEdit)) return "scrims.setupAllSlotsPassed";
  // Some days are past or played: their selects and Autofill (which needs every slot open) are disabled.
  if (week.slots.some((slot) => !slot.canEdit)) return "scrims.setupSomeSlotsPassed";
  return null;
}
