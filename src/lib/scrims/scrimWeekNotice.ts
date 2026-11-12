import type { DashboardAlert } from "@/lib/dashboard/helpers";
import {
  effectiveWeeklyScrimSlots,
  isoWeekKey,
  scrimSlotWeekdays,
  weekdayMondayBased,
} from "@/lib/scrims/scrimContext";
import { resolveUserLeague } from "@/lib/userLeague";
import type { FixtureData, GameStateData } from "@/store/gameStore";

/** Id of the Home notice that tells the player the week's scrims can be planned. */
export const SCRIM_WEEK_OPEN_ALERT_ID = "scrim_week_open";

const DAY_MS = 86_400_000;

function dayNumber(isoDate: string): number {
  return Math.floor(Date.parse(`${isoDate.slice(0, 10)}T00:00:00Z`) / DAY_MS);
}

/**
 * Mirror of the backend rule (`user_club_rests_this_week`): the league plays a
 * regular-season matchday this week that the club does not play, and the club
 * has no fixture of its own this week (Monday to Sunday, any type or status).
 */
function userClubRestsThisWeek(gameState: GameStateData, teamId: string): boolean {
  const fixtures: FixtureData[] = resolveUserLeague(gameState)?.fixtures ?? [];
  const today = dayNumber(gameState.clock.current_date);
  if (!Number.isFinite(today)) return false;
  const weekStart = today - weekdayMondayBased(gameState.clock.current_date);
  const inThisWeek = (fixture: FixtureData) => {
    const day = dayNumber(fixture.date);
    return day >= weekStart && day <= weekStart + 6;
  };
  const involvesUser = (fixture: FixtureData) =>
    fixture.home_team_id === teamId || fixture.away_team_id === teamId;

  if (fixtures.some((fixture) => inThisWeek(fixture) && involvesUser(fixture))) return false;
  return fixtures.some(
    (fixture) =>
      fixture.match_type === "League" &&
      inThisWeek(fixture) &&
      !fixtures.some(
        (other) =>
          other.match_type === "League" && other.matchday === fixture.matchday && involvesUser(other),
      ),
  );
}

/**
 * Whether the week's scrims can still be planned from scratch and nothing is
 * planned yet: some slot is still ahead (a later weekday, or today before its
 * block starts), so the week is open and editable, as the scrim context reports
 * it for an empty week. That covers the Monday the planning reopens and a
 * career that starts mid-week. Same emptiness test as the `scrim_setup_required`
 * advance blocker (no objective, no plan, setup not confirmed) and the same
 * rest-week rule.
 */
export function isScrimWeekAwaitingSetup(gameState: GameStateData): boolean {
  const team = gameState.teams.find((candidate) => candidate.id === gameState.manager.team_id);
  if (!team) return false;

  const slotWeekdays = scrimSlotWeekdays(effectiveWeeklyScrimSlots(team));
  const weekday = weekdayMondayBased(gameState.clock.current_date);
  const morning = (gameState.day_phase ?? "Morning") === "Morning";
  if (!slotWeekdays.some((slotWeekday) => slotWeekday > weekday || (slotWeekday === weekday && morning))) return false;

  if (team.scrim_setup_locked_week_key === isoWeekKey(gameState.clock.current_date)) return false;
  if (team.scrim_weekly_objective) return false;
  if ((team.weekly_scrim_plan_team_ids ?? []).some((plan) => plan.some((entry) => entry !== ""))) return false;

  return !userClubRestsThisWeek(gameState, team.id);
}

/** The non-blocking Home notice for a week whose scrims are still unplanned, or null. */
export function getScrimWeekOpenAlert(
  gameState: GameStateData,
  t: (key: string, options?: Record<string, unknown>) => string,
): DashboardAlert | null {
  if (!isScrimWeekAwaitingSetup(gameState)) return null;
  return {
    id: SCRIM_WEEK_OPEN_ALERT_ID,
    text: t("dashboard.alerts.scrimWeekOpen", {
      defaultValue: "This week's scrims are not planned yet. Set them up before the first scrim day.",
    }),
    tab: "Scrims",
    severity: "info",
  };
}
