import type { ChampionSelectionByPlayer } from "@/ui-v2/match/live/useChampionProfiles";
import type { MatchSnapshot } from "@/ui-v2/_legacy/components/match/types";
import type { GameStateData, ScrimFocus, ScrimReportData } from "../../store/gameStore";

export interface LolScrimPrepSidePayload {
  preparation: number;
  focus: ScrimFocus | null;
  comfortByPlayer: Record<string, number>;
}

export interface LolScrimPrepPayload {
  home: LolScrimPrepSidePayload;
  away: LolScrimPrepSidePayload;
}

export interface LolScrimPrepInsightText {
  key: string;
  defaultValue: string;
  values?: Record<string, string | number>;
}

export interface LolScrimPrepInsight {
  title: LolScrimPrepInsightText;
  summary: LolScrimPrepInsightText;
  details: LolScrimPrepInsightText[];
  focusLabel: LolScrimPrepInsightText;
  totalSignal: number;
}

function reportTimestamp(report: ScrimReportData): number {
  const raw = report.created_on || report.date;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function recentPlayedReportsForTeam(gameState: GameStateData, teamId: string): ScrimReportData[] {
  const team = gameState.teams.find((candidate) => candidate.id === teamId);
  return (team?.scrim_reports ?? [])
    .filter((report) => report.team_id === teamId && report.status === "Played")
    .slice()
    .sort((left, right) => reportTimestamp(right) - reportTimestamp(left))
    .slice(0, 8);
}

export function buildLolScrimPrepSidePayload(
  reports: ScrimReportData[],
  upcomingOpponentTeamId: string,
  championSelections: Record<string, string> = {},
): LolScrimPrepSidePayload {
  if (reports.length === 0) {
    return { preparation: 0, focus: null, comfortByPlayer: {} };
  }

  const opponentReports = reports.filter((report) => report.opponent_team_id === upcomingOpponentTeamId);
  const focusSource = opponentReports[0] ?? reports[0] ?? null;
  const comfortByPlayer: Record<string, number> = {};

  Object.entries(championSelections).forEach(([playerId, championId]) => {
    const championKey = championId.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!playerId || !championKey) return;

    const reps = reports.filter((report) =>
      report.player_champion_picks.some((pick) =>
        pick.player_id === playerId && pick.champion_id.toLowerCase().replace(/[^a-z0-9]/g, "") === championKey,
      ),
    );

    if (reps.length > 0) {
      comfortByPlayer[playerId] = Math.min(2, reps.length >= 2 || reps.some((report) => report.quality >= 75) ? 2 : 1);
    }
  });

  const preparationRaw = opponentReports.reduce((sum, report) => {
    const focusBonus = report.focus === "DraftPrep" || report.focus === "Macro" ? 1 : 0;
    const reviewBonus = report.post_decision === "VodReview" ? 1 : 0;
    const qualityBonus = report.quality >= 75 ? 1 : 0;
    return sum + 1 + focusBonus + reviewBonus + qualityBonus;
  }, 0);

  return {
    preparation: Math.min(3, preparationRaw),
    focus: focusSource?.focus ?? null,
    comfortByPlayer,
  };
}

export function buildLolScrimPrepPayload(
  gameState: GameStateData,
  snapshot: MatchSnapshot,
  championSelections?: ChampionSelectionByPlayer | null,
): LolScrimPrepPayload {
  const homeReports = recentPlayedReportsForTeam(gameState, snapshot.home_team.id);
  const awayReports = recentPlayedReportsForTeam(gameState, snapshot.away_team.id);

  return {
    home: buildLolScrimPrepSidePayload(
      homeReports,
      snapshot.away_team.id,
      championSelections?.home ?? {},
    ),
    away: buildLolScrimPrepSidePayload(
      awayReports,
      snapshot.home_team.id,
      championSelections?.away ?? {},
    ),
  };
}

function focusText(focus: ScrimFocus | null): LolScrimPrepInsightText {
  switch (focus) {
    case "DraftPrep":
      return { key: "match.scrimPrep.focus.draftPrep", defaultValue: "draft prep" };
    case "ChampionPool":
      return { key: "match.scrimPrep.focus.championPool", defaultValue: "champion pool" };
    case "EarlyGame":
      return { key: "match.scrimPrep.focus.earlyGame", defaultValue: "early game" };
    case "Teamfighting":
      return { key: "match.scrimPrep.focus.teamfighting", defaultValue: "teamfighting" };
    case "Macro":
      return { key: "match.scrimPrep.focus.macro", defaultValue: "macro" };
    case "Mental":
      return { key: "match.scrimPrep.focus.mental", defaultValue: "mental reset" };
    default:
      return { key: "match.scrimPrep.focus.general", defaultValue: "general prep" };
  }
}

export function buildLolScrimPrepInsight(
  payload: LolScrimPrepPayload | undefined,
  side: "home" | "away",
): LolScrimPrepInsight | null {
  const sidePayload = payload?.[side];
  if (!sidePayload) return null;

  const comfortTotal = Object.values(sidePayload.comfortByPlayer ?? {}).reduce(
    (sum, value) => sum + Math.max(0, Number(value) || 0),
    0,
  );
  const preparation = Math.max(0, Number(sidePayload.preparation) || 0);
  const totalSignal = preparation + comfortTotal;
  if (totalSignal <= 0) return null;

  const focusLabel = focusText(sidePayload.focus);
  const focusEntry: LolScrimPrepInsightText | null = focusLabel
    ? { key: "match.scrimPrep.details.focus", defaultValue: "Focus: {{focus}}", values: { focus: focusLabel.defaultValue } }
    : null;

  const details: LolScrimPrepInsightText[] = [
    preparation > 0
      ? {
          key: "match.scrimPrep.details.opponentPrep",
          defaultValue: "Opponent prep +{{value}}",
          values: { value: preparation },
        }
      : null,
    comfortTotal > 0
      ? {
          key: "match.scrimPrep.details.championComfort",
          defaultValue: "Champion comfort +{{value}}",
          values: { value: comfortTotal },
        }
      : null,
    focusEntry,
  ].filter((entry): entry is LolScrimPrepInsightText => entry !== null);

  return {
    title: {
      key: "match.scrimPrep.title",
      defaultValue: "Scrim prep carried into the match",
    },
    summary: {
      key: "match.scrimPrep.summary",
      defaultValue: "Recent scrims gave this side a small {{focus}} execution signal. It affects timing and comfort, not a guaranteed result.",
      values: { focus: focusLabel.defaultValue },
    },
    details,
    focusLabel,
    totalSignal,
  };
}

