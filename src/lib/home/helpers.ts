import { resolveUserLeague } from "@/lib/userLeague";
import { findNextFixture } from "../../lib/common/helpers";
import { calculateLolOvr } from "../../lib/players/lolPlayerStats";
import { hasCompetitiveStandings } from "../../lib/season/seasonContext";
import { parseUtcDate } from "../../lib/formatting/dateFormatting";
import type {
  FixtureData,
  GameStateData,
  NewsArticle,
  PlayerData,
  TeamData,
} from "../../store/gameStore";
import { compareStandingsByLolScore } from "../../store/gameStore";

const ONBOARDING_VISIBLE_DAYS = 7;
const ONBOARDING_PAGE_TABS = new Set(["Squad", "Staff", "Tactics", "Training"]);
const ONBOARDING_STORAGE_KEY_PREFIX = "ofm-onboarding-visited-tabs";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface OnboardingCompletionState {
  completedSteps: number;
  hasReadInbox: boolean;
  hasVisitedSquadPage: boolean;
  hasVisitedStaffPage: boolean;
  hasVisitedTacticsPage: boolean;
  hasVisitedTrainingPage: boolean;
  showOnboarding: boolean;
}

export interface NextOpponentWidgetData {
  fixture: FixtureData;
  isHome: boolean;
  opponent: TeamData;
  recentForm: string[];
  standingPoints: number | null;
  standingPosition: number | null;
}

export interface HomeRosterOverview {
  avgCondition: number;
  avgOvr: number;
  coldPlayers: PlayerData[];
  exhaustedCount: number;
  hotPlayers: PlayerData[];
}

export interface HomeRecentResult {
  fixture: FixtureData & {
    result: NonNullable<FixtureData["result"]>;
  };
  isHome: boolean;
  myGoals: number;
  opponentGoals: number;
  opponentId: string;
  resultCode: "W" | "D" | "L";
}

function getStandingPosition(
  gameState: GameStateData,
  teamId: string,
): number | null {
  const playerLeague = resolveUserLeague(gameState);

  if (!playerLeague) {
    return null;
  }

  const sortedStandings = [...playerLeague.standings].sort(compareStandingsByLolScore);
  const standingIndex = sortedStandings.findIndex(
    (entry) => entry.team_id === teamId,
  );

  if (standingIndex === -1) {
    return null;
  }

  return standingIndex + 1;
}

export function getNextOpponentWidgetData(
  gameState: GameStateData,
): NextOpponentWidgetData | null {
  const userTeamId = gameState.manager.team_id;
  if (!userTeamId) return null;

  const playerLeague = resolveUserLeague(gameState);

  if (!playerLeague) return null;

  const nextFixture = findNextFixture(playerLeague.fixtures, userTeamId);

  if (!nextFixture) {
    return null;
  }

  const isHome = nextFixture.home_team_id === userTeamId;
  const opponentId = isHome ? nextFixture.away_team_id : nextFixture.home_team_id;
  const opponent = gameState.teams.find((team) => team.id === opponentId);

  if (!opponent) {
    return null;
  }

  const canShowStandings =
    hasCompetitiveStandings(gameState) && nextFixture.match_type === "League";
  const standingEntry = canShowStandings
    ? playerLeague.standings.find((entry) => entry.team_id === opponentId)
    : null;

  return {
    fixture: nextFixture,
    isHome,
    opponent,
    recentForm: opponent.form.slice(-5),
    standingPoints: standingEntry?.points ?? null,
    standingPosition: canShowStandings
      ? getStandingPosition(gameState, opponentId)
      : null,
  };
}

export function getLeagueDigestArticles(
  gameState: GameStateData,
): NewsArticle[] {
  return [...(gameState.news || [])]
    .filter((article) => {
      return (
        article.category === "LeagueRoundup" ||
        article.category === "StandingsUpdate"
      );
    })
    .sort((leftArticle, rightArticle) => {
      return rightArticle.date.localeCompare(leftArticle.date);
    })
    .slice(0, 2);
}

export function getHomeRosterOverview(
  roster: PlayerData[],
): HomeRosterOverview {
  const avgCondition =
    roster.length > 0
      ? Math.round(
          roster.reduce((total, player) => total + player.condition, 0) /
            roster.length,
        )
      : 0;
  const avgOvr =
    roster.length > 0
      ? Math.round(
          roster.reduce(
            (total, player) => total + calculateLolOvr(player),
            0,
          ) / roster.length,
        )
      : 0;
  const exhaustedCount = roster.filter((player) => player.condition < 40).length;
  const hotPlayers = roster
    .filter((player) => player.morale >= 80)
    .sort((leftPlayer, rightPlayer) => rightPlayer.morale - leftPlayer.morale)
    .slice(0, 3);
  const coldPlayers = roster
    .filter((player) => player.morale <= 40)
    .sort((leftPlayer, rightPlayer) => leftPlayer.morale - rightPlayer.morale)
    .slice(0, 3);

  return {
    avgCondition,
    avgOvr,
    coldPlayers,
    exhaustedCount,
    hotPlayers,
  };
}

export function getRecentResultsForTeam(
  gameState: GameStateData,
  teamId: string | null,
  limit = 5,
): HomeRecentResult[] {
  const playerLeague = resolveUserLeague(gameState);

  if (!playerLeague || !teamId) {
    return [];
  }

  const recentResults: HomeRecentResult[] = [];

  for (const fixture of [...playerLeague.fixtures].reverse()) {
    if (
      fixture.status !== "Completed" ||
      !fixture.result ||
      (fixture.home_team_id !== teamId && fixture.away_team_id !== teamId)
    ) {
      continue;
    }

    const isHome = fixture.home_team_id === teamId;
    // home_goals/away_goals are legacy fields typed `unknown` — coerce to number.
    const myGoals = Number(isHome ? fixture.result.home_goals : fixture.result.away_goals) || 0;
    const opponentGoals =
      Number(isHome ? fixture.result.away_goals : fixture.result.home_goals) || 0;

    recentResults.push({
      fixture: fixture as FixtureData & {
        result: NonNullable<FixtureData["result"]>;
      },
      isHome,
      myGoals,
      opponentGoals,
      opponentId: isHome ? fixture.away_team_id : fixture.home_team_id,
      resultCode: myGoals > opponentGoals ? "W" : myGoals < opponentGoals ? "L" : "D",
    });

    if (recentResults.length >= limit) {
      break;
    }
  }

  return recentResults.reverse();
}

export function isOnboardingPageTab(tab: string): boolean {
  return ONBOARDING_PAGE_TABS.has(tab);
}

function getOnboardingStorageKey(gameState: GameStateData): string {
  return `${ONBOARDING_STORAGE_KEY_PREFIX}:${gameState.manager.id}:${gameState.clock.start_date}`;
}

function getDefaultStorage(): StorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

export function loadVisitedOnboardingTabs(
  gameState: GameStateData,
  storage: StorageLike | null = getDefaultStorage(),
): Set<string> {
  if (!storage) {
    return new Set<string>();
  }

  const storedValue = storage.getItem(getOnboardingStorageKey(gameState));

  if (!storedValue) {
    return new Set<string>();
  }

  try {
    const parsedValue: unknown = JSON.parse(storedValue);

    if (!Array.isArray(parsedValue)) {
      return new Set<string>();
    }

    return new Set<string>(
      parsedValue.filter(
        (tab): tab is string => typeof tab === "string" && isOnboardingPageTab(tab),
      ),
    );
  } catch {
    return new Set<string>();
  }
}

export function saveVisitedOnboardingTabs(
  gameState: GameStateData,
  visitedTabs: ReadonlySet<string>,
  storage: StorageLike | null = getDefaultStorage(),
): void {
  if (!storage) {
    return;
  }

  const persistedTabs = Array.from(visitedTabs).filter((tab) =>
    isOnboardingPageTab(tab),
  );

  storage.setItem(
    getOnboardingStorageKey(gameState),
    JSON.stringify(persistedTabs),
  );
}

export function getOnboardingCompletionState(
  gameState: GameStateData,
  visitedTabs: ReadonlySet<string> = new Set<string>(),
): OnboardingCompletionState {
  const currentDate = parseUtcDate(gameState.clock.current_date);
  const startDate = parseUtcDate(gameState.clock.start_date);
  if (!currentDate || !startDate) return { showOnboarding: false, completedSteps: 0, hasReadInbox: false, hasVisitedSquadPage: false, hasVisitedStaffPage: false, hasVisitedTacticsPage: false, hasVisitedTrainingPage: false };

  const daysSinceStart = Math.floor(
    (currentDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
  );
  const showOnboarding = daysSinceStart <= ONBOARDING_VISIBLE_DAYS;
  const hasVisitedSquadPage = visitedTabs.has("Squad");
  const hasVisitedStaffPage = visitedTabs.has("Staff");
  const hasVisitedTacticsPage = visitedTabs.has("Tactics");
  const hasVisitedTrainingPage = visitedTabs.has("Training");
  const hasReadInbox = gameState.messages.some((message) => message.read);
  const completedSteps = [
    hasVisitedSquadPage,
    hasVisitedStaffPage,
    hasVisitedTacticsPage,
    hasVisitedTrainingPage,
    hasReadInbox,
  ].filter(Boolean).length;

  return {
    completedSteps,
    hasReadInbox,
    hasVisitedSquadPage,
    hasVisitedStaffPage,
    hasVisitedTacticsPage,
    hasVisitedTrainingPage,
    showOnboarding,
  };
}

