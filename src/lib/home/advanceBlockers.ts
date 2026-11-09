import type { GameStateData } from "@/store/gameStore";
import {
  checkBlockingActions,
  type BlockerData,
  type CheckBlockingOptions,
} from "@/services/advanceTimeService";
import {
  dateKey,
  effectiveWeeklyScrimSlots,
  isoWeekKey,
  scrimSlotWeekdays,
  weekdayMondayBased,
} from "@/lib/scrims/scrimContext";

export const SCRIM_SETUP_BLOCKER_ID = "scrim_setup_required";
export const SCRIM_DECISION_BLOCKER_ID = "scrim_decision_required";

/**
 * The weekly scrim blockers are NOT reported by `check_blocking_actions`: the
 * backend only raises them from inside `advance_time_with_mode`
 * (`blocked_scrim_setup` / `blocked_scrim_decision`, time_advancement.rs). This
 * mirrors those two conditions on the client game state so every caller that
 * asks "would Continue block?" sees them.
 */
export function deriveScrimAdvanceBlockers(
  game: GameStateData | null | undefined,
  options: { mode?: string } = {},
): BlockerData[] {
  const teamId = game?.manager?.team_id;
  if (!game || !teamId) return [];
  const team = game.teams.find((candidate) => candidate.id === teamId);
  if (!team) return [];

  const blockers: BlockerData[] = [];
  const today = dateKey(game.clock.current_date);
  const phase = game.day_phase ?? "Morning";

  if (options.mode !== "delegate" && phase === "Morning") {
    const firstDay = Math.min(...scrimSlotWeekdays(effectiveWeeklyScrimSlots(team)));
    const lockedWeek = team.scrim_setup_locked_week_key;
    const inStartWindow = weekdayMondayBased(game.clock.current_date) === firstDay;
    const locked = lockedWeek === isoWeekKey(game.clock.current_date);
    const hasObjective = Boolean(team.scrim_weekly_objective);
    const hasPlans = (team.weekly_scrim_plan_team_ids ?? []).some((plan) => plan.some((entry) => entry !== ""));
    if (inStartWindow && !locked && !hasObjective && !hasPlans) {
      blockers.push({
        id: SCRIM_SETUP_BLOCKER_ID,
        severity: "warn",
        tab: "Scrims",
        text: "Define el setup semanal de scrims (objetivo y rivales) o delega el avance para continuar.",
      });
    }
  }

  if (
    phase === "ScrimBlock" &&
    (team.scrim_reports ?? []).some((report) => dateKey(report.date) === today && !report.post_decision)
  ) {
    blockers.push({
      id: SCRIM_DECISION_BLOCKER_ID,
      severity: "warn",
      tab: "Scrims",
      text: "Debes tomar una decision de scrims antes de continuar.",
    });
  }

  return blockers;
}

/**
 * The single source of "what blocks the advance": the backend pre-check plus
 * the scrim blockers the advance command would raise. Used by the Continue
 * pre-checks and by the Home retained-blocker refresh so both agree.
 */
export async function collectAdvanceBlockers(
  logContext: string,
  game: GameStateData | null | undefined,
  options: CheckBlockingOptions & { mode?: string } = {},
): Promise<BlockerData[]> {
  const { mode, ...checkOptions } = options;
  const backend = await checkBlockingActions(logContext, checkOptions);
  const known = new Set(backend.map((blocker) => blocker.id));
  const derived = deriveScrimAdvanceBlockers(game, { mode }).filter((blocker) => !known.has(blocker.id));
  return [...backend, ...derived];
}
