import { resolveUserLeague } from "@/lib/userLeague";
import type {
  DayPhase,
  GameStateData,
  PlayerData,
  ScrimFocus,
  ScrimReportData,
  TeamData,
} from "../../store/gameStore";
import type { BackendScrimContextResponse } from "../../services/trainingService";
import { calculateLolOvr } from "../players/lolPlayerStats";

export type ScrimDayState =
  | "NoScrimToday"
  | "Planned"
  | "Confirmed"
  | "PlayedNeedsReview"
  | "Reviewed"
  | "Cancelled";

export interface TodayScrimContext {
  state: ScrimDayState;
  slotIndex: number | null;
  opponentTeamId: string | null;
  resolvedOpponentTeamId: string | null;
  objective: ScrimFocus | null;
  report: ScrimReportData | null;
  canEditPlan: boolean;
  canCancel: boolean;
  canReview: boolean;
  canViewWeeklyPlan: boolean;
  hasOfficialMatch: boolean;
  primaryAction: "OpenPlan" | "Review" | "Training" | "Schedule" | null;
  pushThroughRecommended: boolean;
}

export interface WeeklyScrimSlotContext {
  slotIndex: number;
  weekday: number;
  label: string;
  labelDay: number;
  labelSuffix: string;
  plan: string[];
  resolvedOpponentTeamId: string | null;
  resultWon: boolean | null;
  report: ScrimReportData | null;
  status: "Open" | "Locked" | "Played" | "Reviewed" | "Cancelled";
  canEdit: boolean;
}

export interface WeeklyScrimContext {
  weekKey: string;
  objective: ScrimFocus | null;
  capacity: number;
  planned: number;
  reputation: number;
  cancellations: number;
  played: number;
  wins: number;
  losses: number;
  lossStreak: number;
  avgQuality: number;
  topFocus: ScrimFocus | null;
  topIssue: string | null;
  nextOfficialRivalTeamId: string | null;
  nextOfficialRivalCompetition: string | null;
  setupLocked: boolean;
  setupLockedReason: string | null;
  canFinalizeSetup: boolean;
  slots: WeeklyScrimSlotContext[];
  latestReports: ScrimReportData[];
}

export interface ScrimContextResponse {
  today: TodayScrimContext;
  week: WeeklyScrimContext;
}

export interface ScrimPlanSignals {
  ownOvr: number;
  plannedCount: number;
  fallbackSlotCount: number;
  avgOpponentOvr: number;
  maxOpponentOvr: number;
  avgOpponentScrimReputation: number;
}

export interface DailyScrimBlockMeta {
  blockLabel: "A" | "B";
  blockNumber: 1 | 2;
  blocksToday: 2;
}

type TFunctionLike = (key: string, fallback?: string) => string;

const LEGACY_SCRIMS_PER_WEEK: Record<string, number> = {
  Intense: 6,
  Balanced: 4,
  Light: 2,
};

const SCRIM_SLOT_WEEKDAYS_BY_COUNT: Record<number, number[]> = {
  2: [2, 2],
  4: [2, 2, 3, 3],
  6: [2, 2, 3, 3, 4, 4],
};

function normalizeWeeklyScrimSlots(rawSlots: number): number {
  if (rawSlots <= 2) return 2;
  if (rawSlots <= 4) return 4;
  return 6;
}

export function dateKey(value: string): string {
  return String(value).slice(0, 10);
}

export function weekdayMondayBased(value: string): number {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 0;
  return (date.getUTCDay() + 6) % 7;
}

export function isoWeekKey(dateStr: string): string {
  const date = new Date(dateStr);
  if (!Number.isFinite(date.getTime())) return "unknown";
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((utc.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${utc.getUTCFullYear()}-W${weekNo}`;
}

export function effectiveWeeklyScrimSlots(team: TeamData): number {
  const rawSlots = team.scrim_weekly_slots && team.scrim_weekly_slots > 0
    ? team.scrim_weekly_slots
    : LEGACY_SCRIMS_PER_WEEK[team.training_schedule] ?? LEGACY_SCRIMS_PER_WEEK.Balanced;
  return normalizeWeeklyScrimSlots(Math.round(rawSlots));
}

export function scrimSlotWeekdays(slots: number): number[] {
  return SCRIM_SLOT_WEEKDAYS_BY_COUNT[normalizeWeeklyScrimSlots(slots)] ?? SCRIM_SLOT_WEEKDAYS_BY_COUNT[4];
}

export function scrimSlotLabel(weekdays: number[], slotIndex: number): string {
  const day = weekdays[slotIndex] ?? 0;
  const previousSameDay = weekdays.slice(0, slotIndex).filter((candidate) => candidate === day).length;
  const totalSameDay = weekdays.filter((candidate) => candidate === day).length;
  const suffix = totalSameDay > 1 ? ` ${String.fromCharCode(65 + previousSameDay)}` : "";
  return `${day}${suffix}`;
}

export function scrimSlotLabelParts(weekdays: number[], slotIndex: number): { day: number; suffix: string } {
  const day = weekdays[slotIndex] ?? 0;
  const previousSameDay = weekdays.slice(0, slotIndex).filter((candidate) => candidate === day).length;
  const totalSameDay = weekdays.filter((candidate) => candidate === day).length;
  const suffix = totalSameDay > 1 ? String.fromCharCode(65 + previousSameDay) : "";
  return { day, suffix };
}

export function deriveDailyScrimBlockMeta(
  slots: number,
  currentDate: string,
  slotIndex: number,
): DailyScrimBlockMeta | null {
  if (slotIndex < 0) return null;
  const weekdays = scrimSlotWeekdays(slots);
  const todayWeekday = weekdayMondayBased(currentDate);
  const todaySlotIndices = weekdays
    .map((weekday, index) => ({ weekday, index }))
    .filter((entry) => entry.weekday === todayWeekday)
    .map((entry) => entry.index);
  const dailyPosition = todaySlotIndices.indexOf(slotIndex);
  if (dailyPosition < 0) return null;
  return {
    blockLabel: dailyPosition === 0 ? "A" : "B",
    blockNumber: dailyPosition === 0 ? 1 : 2,
    blocksToday: 2,
  };
}

export function deriveTodayScrimContext(gameState: GameStateData, team: TeamData): TodayScrimContext {
  const today = dateKey(gameState.clock.current_date);
  const dayPhase: DayPhase = gameState.day_phase ?? "Morning";
  const slots = effectiveWeeklyScrimSlots(team);
  const weekdays = scrimSlotWeekdays(slots);
  const todayWeekday = weekdayMondayBased(gameState.clock.current_date);
  const todaySlotIndices = weekdays
    .map((weekday, idx) => (weekday === todayWeekday ? idx : -1))
    .filter((idx) => idx >= 0);
  const hasOfficialMatch = Boolean(resolveUserLeague(gameState)?.fixtures.find((fixture) => {
    if (fixture.status !== "Scheduled") return false;
    if (dateKey(fixture.date) !== today) return false;
    return fixture.home_team_id === team.id || fixture.away_team_id === team.id;
  }));

  const todayReports = [...(team.scrim_reports ?? [])]
    .filter((report) => report.date === today)
    .sort((left, right) => left.slot_index - right.slot_index);
  const unresolvedReport = todayReports.find((report) => report.post_decision == null) ?? null;

  if (unresolvedReport) {
    // The backend blocks advancing in ScrimBlock while a report is unresolved, so the
    // decision is offered there.
    const reviewPhaseActive = dayPhase === "ScrimBlock";
    return {
      state: "PlayedNeedsReview",
      slotIndex: unresolvedReport.slot_index,
      opponentTeamId: unresolvedReport.opponent_team_id,
      resolvedOpponentTeamId: unresolvedReport.opponent_team_id,
      objective: team.scrim_weekly_objective ?? null,
      report: unresolvedReport,
      canEditPlan: false,
      canCancel: false,
      canReview: reviewPhaseActive,
      canViewWeeklyPlan: true,
      hasOfficialMatch,
      primaryAction: reviewPhaseActive ? "Review" : hasOfficialMatch ? "Schedule" : "Training",
      pushThroughRecommended: false,
    };
  }

  const reviewedReport = todayReports.find((report) => report.post_decision != null) ?? null;
  if (reviewedReport) {
    return {
      state: "Reviewed",
      slotIndex: reviewedReport.slot_index,
      opponentTeamId: reviewedReport.opponent_team_id,
      resolvedOpponentTeamId: reviewedReport.opponent_team_id,
      objective: team.scrim_weekly_objective ?? null,
      report: reviewedReport,
      canEditPlan: false,
      canCancel: false,
      canReview: false,
      canViewWeeklyPlan: true,
      hasOfficialMatch,
      primaryAction: hasOfficialMatch ? "Schedule" : "Training",
      pushThroughRecommended: false,
    };
  }

  if (todaySlotIndices.length === 0) {
    return {
      state: "NoScrimToday",
      slotIndex: null,
      opponentTeamId: null,
      resolvedOpponentTeamId: null,
      objective: team.scrim_weekly_objective ?? null,
      report: null,
      canEditPlan: false,
      canCancel: false,
      canReview: false,
      canViewWeeklyPlan: true,
      hasOfficialMatch,
      primaryAction: hasOfficialMatch ? "Schedule" : "Training",
      pushThroughRecommended: false,
    };
  }

  const firstSlotIndex = todaySlotIndices[0];
  const plan = team.weekly_scrim_plan_team_ids?.[firstSlotIndex] ?? [];
  const opponentTeamId = plan.find(Boolean) ?? team.weekly_scrim_opponent_ids?.[firstSlotIndex] ?? null;
  const state: ScrimDayState = opponentTeamId || dayPhase === "Morning" ? "Planned" : "Cancelled";
  const canCancel = state === "Planned" && dayPhase === "Morning";

  return {
    state,
    slotIndex: firstSlotIndex,
    opponentTeamId,
    resolvedOpponentTeamId: null,
    objective: team.scrim_weekly_objective ?? null,
    report: null,
    canEditPlan: dayPhase === "Morning",
    canCancel,
    canReview: false,
    canViewWeeklyPlan: true,
    hasOfficialMatch,
    primaryAction: state === "Planned" ? "OpenPlan" : hasOfficialMatch ? "Schedule" : "Training",
    pushThroughRecommended: false,
  };
}

export function deriveWeeklyScrimContext(gameState: GameStateData, team: TeamData): WeeklyScrimContext {
  const capacity = effectiveWeeklyScrimSlots(team);
  const weekdays = scrimSlotWeekdays(capacity);
  const todayWeekday = weekdayMondayBased(gameState.clock.current_date);
  const weekKey = isoWeekKey(gameState.clock.current_date);

  const slots: WeeklyScrimSlotContext[] = Array.from({ length: capacity }, (_, slotIndex) => {
    const plan = team.weekly_scrim_plan_team_ids?.[slotIndex] ?? [];
    const legacy = team.weekly_scrim_opponent_ids?.[slotIndex];
    const mergedPlan = plan.length > 0 ? plan : legacy ? [legacy] : [];
    const report = (team.scrim_reports ?? []).find(
      (entry) => entry.week_key === weekKey && entry.slot_index === slotIndex,
    ) ?? null;
    const result = (team.scrim_slot_results ?? []).find(
      (entry) => entry.week_key === weekKey && entry.slot_index === slotIndex,
    ) ?? null;
    const hasPastLock = (weekdays[slotIndex] ?? 0) < todayWeekday;

    let status: WeeklyScrimSlotContext["status"] = "Open";
    if (report?.post_decision != null) status = "Reviewed";
    else if (report != null || result != null) status = "Played";
    else if (mergedPlan.length === 0 && hasPastLock) status = "Cancelled";
    else if (hasPastLock) status = "Locked";

    const labelParts = scrimSlotLabelParts(weekdays, slotIndex);
    return {
      slotIndex,
      weekday: weekdays[slotIndex] ?? 0,
      label: scrimSlotLabel(weekdays, slotIndex),
      labelDay: labelParts.day,
      labelSuffix: labelParts.suffix,
      plan: mergedPlan,
      resolvedOpponentTeamId: report?.opponent_team_id ?? result?.opponent_team_id ?? null,
      resultWon: report?.won ?? result?.won ?? null,
      report,
      status,
      canEdit: !hasPastLock && report == null && result == null,
    };
  });

  const latestReports = [...(team.scrim_reports ?? [])]
    .filter((report) => report.week_key === weekKey)
    .sort((left, right) => right.date.localeCompare(left.date) || right.slot_index - left.slot_index);
  const playedReports = latestReports.filter((report) => report.status === "Played");
  const recurringIssue = playedReports
    .map((report) => report.issue)
    .filter((issue): issue is NonNullable<typeof issue> => Boolean(issue))
    .reduce<Record<string, number>>((counts, issue) => {
      counts[issue] = (counts[issue] ?? 0) + 1;
      return counts;
    }, {});
  const recurringFocus = playedReports
    .map((report) => report.focus)
    .filter((focus): focus is NonNullable<typeof focus> => Boolean(focus))
    .reduce<Record<string, number>>((counts, focus) => {
      counts[focus] = (counts[focus] ?? 0) + 1;
      return counts;
    }, {});
  const nextOfficialFixture = (resolveUserLeague(gameState)?.fixtures ?? [])
    .filter((fixture) => {
      if (fixture.status !== "Scheduled") return false;
      if (fixture.home_team_id !== team.id && fixture.away_team_id !== team.id) return false;
      return fixture.date >= gameState.clock.current_date;
    })
    .sort((left, right) => left.date.localeCompare(right.date))[0] ?? null;
  const nextOfficialRivalTeamId = nextOfficialFixture
    ? nextOfficialFixture.home_team_id === team.id
      ? nextOfficialFixture.away_team_id
      : nextOfficialFixture.home_team_id
    : null;

  return {
    weekKey,
    objective: team.scrim_weekly_objective ?? null,
    capacity,
    planned: slots.filter((slot) => slot.plan.length > 0 || slot.resolvedOpponentTeamId).length,
    reputation: team.scrim_reputation ?? 50,
    cancellations: team.scrim_weekly_cancellations ?? 0,
    played: team.scrim_weekly_played ?? 0,
    wins: team.scrim_weekly_wins ?? 0,
    losses: team.scrim_weekly_losses ?? 0,
    lossStreak: team.scrim_loss_streak ?? 0,
    avgQuality: playedReports.length > 0
      ? Math.round(playedReports.reduce((sum, report) => sum + report.quality, 0) / playedReports.length)
      : 0,
    topFocus: (Object.entries(recurringFocus).sort((a, b) => b[1] - a[1])[0]?.[0] as ScrimFocus | undefined) ?? null,
    topIssue: Object.entries(recurringIssue).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    nextOfficialRivalTeamId,
    nextOfficialRivalCompetition: nextOfficialFixture?.match_type ?? null,
    setupLocked: false,
    setupLockedReason: null,
    canFinalizeSetup: true,
    slots,
    latestReports,
  };
}

function playerLolOvr(player: PlayerData): number {
  return calculateLolOvr(player);
}

export function teamLolOvr(gameState: GameStateData, teamId: string): number {
  const team = gameState.teams.find((candidate) => candidate.id === teamId);
  const starters = (team?.active_lineup_ids ?? team?.starting_xi_ids ?? [])
    .map((playerId) => gameState.players.find((player) => player.id === playerId))
    .filter((player): player is NonNullable<typeof player> => Boolean(player))
    .slice(0, 5);
  const roster = gameState.players
    .filter((player) => player.team_id === teamId)
    .sort((left, right) => playerLolOvr(right) - playerLolOvr(left))
    .slice(0, 5);
  const sample = starters.length >= 5 ? starters : roster;

  if (sample.length === 0) return 74;

  return Math.round(sample.reduce((sum, player) => sum + playerLolOvr(player), 0) / sample.length);
}

export function buildTeamLolOvrMap(gameState: GameStateData): Map<string, number> {
  const map = new Map<string, number>();
  gameState.teams.forEach((team) => {
    map.set(team.id, teamLolOvr(gameState, team.id));
  });
  return map;
}

export function buildScrimPlanSignals(
  gameState: GameStateData,
  teamId: string,
  weeklyContext: WeeklyScrimContext,
): ScrimPlanSignals {
  const plannedOpponentIds = Array.from(new Set(
    weeklyContext.slots.flatMap((slot) => slot.plan).filter((candidate) => candidate && candidate !== teamId),
  ));
  const opponents = plannedOpponentIds
    .map((opponentId) => gameState.teams.find((candidate) => candidate.id === opponentId))
    .filter((opponent): opponent is NonNullable<typeof opponent> => Boolean(opponent));
  const opponentOvrs = opponents.map((opponent) => teamLolOvr(gameState, opponent.id));
  const opponentReputations = opponents.map((opponent) => opponent.scrim_reputation ?? 50);

  return {
    ownOvr: teamLolOvr(gameState, teamId),
    plannedCount: plannedOpponentIds.length,
    fallbackSlotCount: weeklyContext.slots.filter((slot) => slot.plan.length >= 2).length,
    avgOpponentOvr: opponentOvrs.length > 0
      ? Math.round(opponentOvrs.reduce((sum, value) => sum + value, 0) / opponentOvrs.length)
      : 0,
    maxOpponentOvr: opponentOvrs.length > 0 ? Math.max(...opponentOvrs) : 0,
    avgOpponentScrimReputation: opponentReputations.length > 0
      ? Math.round(opponentReputations.reduce((sum, value) => sum + value, 0) / opponentReputations.length)
      : 0,
  };
}

export function buildStaffSuggestions(
  t: TFunctionLike,
  objective: ScrimFocus | null,
  weeklyCapacity: number,
  reports: ScrimReportData[],
  lossStreak: number,
  cancellations: number,
  planSignals?: ScrimPlanSignals,
  ownScrimReputation = 50,
): string[] {
  const suggestions: string[] = [];
  const playedReports = reports.filter((report) => report.status === "Played");
  const avgQuality = playedReports.length > 0
    ? Math.round(playedReports.reduce((sum, report) => sum + report.quality, 0) / playedReports.length)
    : 0;
  const recurringIssue = playedReports
    .map((report) => report.issue)
    .filter((issue): issue is NonNullable<typeof issue> => Boolean(issue))
    .reduce<Record<string, number>>((counts, issue) => {
      counts[issue] = (counts[issue] ?? 0) + 1;
      return counts;
    }, {});
  const topIssue = Object.entries(recurringIssue).sort((a, b) => b[1] - a[1])[0]?.[0];

  if (!objective) {
    suggestions.push(t(
      "training.scrims.staff.pickObjective",
      "Define un objetivo semanal antes de elegir rivales: sin intención, el volumen solo genera ruido.",
    ));
  }
  if (lossStreak >= 3 || objective === "Mental") {
    suggestions.push(t(
      "training.scrims.staff.mentalReset",
      "Prioriza Mental Reset o VOD Review: la racha ya está afectando la calidad del aprendizaje.",
    ));
  }
  if (cancellations >= 2) {
    suggestions.push(t(
      "training.scrims.staff.reduceCancellations",
      "Reduce cancelaciones esta semana; la reputación de scrims también es infraestructura competitiva.",
    ));
  }
  if (objective === "ChampionPool" && weeklyCapacity < 4) {
    suggestions.push(t(
      "training.scrims.staff.moreVolumeForPool",
      "Para expandir champion pool necesitas al menos 4 bloques; dos scrims no dan una muestra suficiente.",
    ));
  }
  if (objective && planSignals?.plannedCount === 0) {
    suggestions.push(t(
      "training.scrims.staff.noPlannedOpponents",
      "El objetivo es correcto, pero no hay rivales definidos: cierra al menos Plan A para dar dirección a la semana.",
    ));
  }
  if (objective === "DraftPrep") {
    suggestions.push(t(
      "training.scrims.staff.draftPrepPlan",
      "Usa Plan A/B/C contra equipos fuertes: busca castigar draft, no sumar confianza fácil.",
    ));
  }
  if (
    (objective === "DraftPrep" || objective === "Macro" || objective === "Teamfighting")
    && planSignals
    && planSignals.plannedCount > 0
    && planSignals.maxOpponentOvr < 77
  ) {
    suggestions.push(t(
      "training.scrims.staff.strongerOpponents",
      "Para este objetivo faltan rivales exigentes; busca al menos un bloque contra un equipo más fuerte.",
    ));
  }
  if (
    objective === "Mental"
    && planSignals
    && planSignals.avgOpponentOvr > planSignals.ownOvr + 5
  ) {
    suggestions.push(t(
      "training.scrims.staff.softerMentalWeek",
      "Semana mental: no abras con todos los rivales por encima de tu nivel. Combina un bloque controlado para recuperar confianza.",
    ));
  }
  if (
    objective
    && planSignals
    && planSignals.plannedCount > 0
    && planSignals.fallbackSlotCount === 0
    && planSignals.avgOpponentScrimReputation > ownScrimReputation + 8
  ) {
    suggestions.push(t(
      "training.scrims.staff.addFallbacksForReputation",
      "Tus rivales planificados tienen mejor reputación de scrims; agrega Plan B/C para evitar rechazos.",
    ));
  }
  if (topIssue === "ObjectiveSetup" || objective === "Macro") {
    suggestions.push(t(
      "training.scrims.staff.macroReview",
      "Marca un bloque de VOD Review: si el issue es setup de objetivos, más scrims sin revisión repiten el error.",
    ));
  }
  if (playedReports.length >= 2 && avgQuality > 0 && avgQuality < 45) {
    suggestions.push(t(
      "training.scrims.staff.narrowFocus",
      "La calidad promedio de los scrims jugados esta semana es baja; mantén el volumen y reduce el foco antes de sumar más rivales.",
    ));
  }
  if (suggestions.length === 0) {
    suggestions.push(t(
      "training.scrims.staff.keepPlan",
      "El plan actual está equilibrado: mantén el objetivo, elige rivales exigentes y revisa el primer reporte antes de aumentar volumen.",
    ));
  }

  return suggestions.slice(0, 3);
}

export function normalizeBackendScrimContext(payload: BackendScrimContextResponse): ScrimContextResponse {
  return {
    today: {
      state: payload.today.state as ScrimDayState,
      slotIndex: payload.today.slot_index,
      opponentTeamId: payload.today.opponent_team_id,
      resolvedOpponentTeamId: payload.today.resolved_opponent_team_id,
      objective: payload.today.objective,
      report: payload.today.report,
      canEditPlan: payload.today.can_edit_plan,
      canCancel: payload.today.can_cancel,
      canReview: payload.today.can_review,
      canViewWeeklyPlan: payload.today.can_view_weekly_plan,
      hasOfficialMatch: payload.today.has_official_match,
      primaryAction: payload.today.primary_action,
      pushThroughRecommended: payload.today.push_through_recommended,
    },
    week: {
      weekKey: payload.week.week_key,
      objective: payload.week.objective,
      capacity: payload.week.capacity,
      planned: payload.week.planned,
      reputation: payload.week.reputation,
      cancellations: payload.week.cancellations,
      played: payload.week.played,
      wins: payload.week.wins,
      losses: payload.week.losses,
      lossStreak: payload.week.loss_streak,
      avgQuality: payload.week.avg_quality,
      topFocus: payload.week.top_focus,
      topIssue: payload.week.top_issue,
      nextOfficialRivalTeamId: payload.week.next_official_rival_team_id,
      nextOfficialRivalCompetition: payload.week.next_official_rival_competition,
      setupLocked: payload.week.setup_locked,
      setupLockedReason: payload.week.setup_locked_reason,
      canFinalizeSetup: payload.week.can_finalize_setup,
      slots: payload.week.slots.map((slot) => ({
        slotIndex: slot.slot_index,
        weekday: slot.weekday,
        label: slot.label,
        labelDay: slot.label_day,
        labelSuffix: slot.label_suffix,
        plan: slot.plan,
        resolvedOpponentTeamId: slot.resolved_opponent_team_id,
        resultWon: slot.result_won,
        report: slot.report,
        status: slot.status,
        canEdit: slot.can_edit,
      })),
      latestReports: payload.week.latest_reports,
    },
  };
}


