import type { ScrimReportData } from "@/store/gameStore";
import type { TodayScrimContext, WeeklyScrimContext, WeeklyScrimSlotContext } from "./scrimContext";

/** The three bodies the wide column of the Scrims tab can show. */
export type DeskPanel = "decision" | "today" | "setup";

const DAY_HAS_SCRIM = new Set<TodayScrimContext["state"]>([
  "Planned",
  "Confirmed",
  "PlayedNeedsReview",
  "Reviewed",
  "Cancelled",
]);

/**
 * Which body owns the wide column:
 * - `decision` while a played block waits for the manager's call (the backend only allows it in
 *   the scrim-block phase, so `canReview` decides);
 * - `today` once the week has started and today has a scrim, so there is nothing left to set up;
 * - `setup` on every other day, including the days when the form is shown read-only with its reason.
 */
export function deskPanel(today: TodayScrimContext, week: WeeklyScrimContext): DeskPanel {
  if (today.state === "PlayedNeedsReview" && today.report && today.canReview) return "decision";
  if (DAY_HAS_SCRIM.has(today.state) && week.setupLocked) return "today";
  return "setup";
}

export type RiskLevel = "high" | "medium" | "low";

/** The browser-side estimate behind "Today's Risk": the rival's OVR first, then the larger of the OVR and reputation gaps. */
export function riskLevel(opponentOvr: number, ownOvr: number, repGap: number): RiskLevel {
  if (opponentOvr >= 80) return "high";
  if (opponentOvr >= 77) return "medium";
  const gap = Math.max(opponentOvr - ownOvr, Math.round(repGap / 4));
  if (gap >= 4) return "high";
  if (gap >= 2) return "medium";
  return "low";
}

/** Decisions the backend applies to the first block of a day that also cancel the second block. */
const CANCELLING_DECISIONS = new Set<NonNullable<ScrimReportData["post_decision"]>>([
  "DayOff",
  "VodReview",
  "MentalReset",
  "TargetedDrills",
]);

/**
 * A second block whose plan was cleared today. The game keeps such a slot `Open` until its weekday
 * is past (`Cancelled` needs both an empty plan and a past weekday), so the UI cannot read the
 * clearing from the status: it reads it from the first block of the same day, which was decided
 * with a choice that cancels the next block.
 */
export function isPlanClearedToday(slot: WeeklyScrimSlotContext, week: WeeklyScrimContext): boolean {
  if (slot.status !== "Open" || slot.plan.length > 0 || slot.report || slot.resultWon != null) return false;
  return week.slots.some(
    (other) =>
      other.weekday === slot.weekday
      && other.slotIndex < slot.slotIndex
      && other.report?.post_decision != null
      && CANCELLING_DECISIONS.has(other.report.post_decision),
  );
}

export type ChipRival =
  | { kind: "team"; teamId: string }
  | { kind: "cleared" }
  | { kind: "none" };

/** The opponent a strip chip names: the one actually played, else Plan A, else a note on why there is none. */
export function chipRival(slot: WeeklyScrimSlotContext, cleared: boolean): ChipRival {
  const teamId = slot.resolvedOpponentTeamId ?? slot.plan[0] ?? null;
  if (teamId) return { kind: "team", teamId };
  return cleared ? { kind: "cleared" } : { kind: "none" };
}

export interface DayGroup {
  weekday: number;
  slots: WeeklyScrimSlotContext[];
}

/** The slots of the week grouped by their weekday, in slot order. */
export function slotsByDay(week: WeeklyScrimContext): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const slot of week.slots) {
    const last = groups[groups.length - 1];
    if (last && last.weekday === slot.labelDay) last.slots.push(slot);
    else groups.push({ weekday: slot.labelDay, slots: [slot] });
  }
  return groups;
}
