import { resolveUserLeague } from "@/lib/userLeague";
import type {
  FixtureData,
  GameStateData,
  PlayerData,
  TeamData,
  ChampionData,
} from "../../store/gameStore";
import { formatVal } from "../../lib/common/helpers";
import { getTeamFinanceSnapshot } from "../../lib/finances/finance";
import { getSponsorshipContractView } from "../../lib/finances/lolFinanceContracts";
import {
  buildActiveLineupIds,
  LOL_ACTIVE_ROLES,
} from "@/lib/squad/helpers";

export interface DashboardAlert {
  id: string;
  text: string;
  tab: string;
  severity: "warn" | "info";
}

export interface DashboardSearchResults {
  matchedPlayers: PlayerData[];
  matchedTeams: TeamData[];
  matchedChampions: ChampionData[];
}

type DashboardAlertTranslator = (
  key: string,
  options?: Record<string, unknown>,
) => string;

export function getTodayMatchFixture(gameState: GameStateData): FixtureData | null {
  const fixtures = resolveUserLeague(gameState)?.fixtures;

  if (!fixtures) {
    return null;
  }

  const today = gameState.clock.current_date.split("T")[0];

  return (
    fixtures.find((fixture) => {
      return (
        fixture.date === today &&
        fixture.status === "Scheduled" &&
        (fixture.home_team_id === gameState.manager.team_id ||
          fixture.away_team_id === gameState.manager.team_id)
      );
    }) ?? null
  );
}

export function getUnreadMessagesCount(gameState: GameStateData): number {
  return gameState.messages.filter((message) => !message.read).length;
}

/** Pending transfer offers other clubs made for the user's players (the ones awaiting an answer). */
export function getPendingIncomingOffersCount(gameState: GameStateData): number {
  const teamId = gameState.manager.team_id;
  return gameState.players
    .filter((player) => player.team_id === teamId)
    .reduce(
      (total, player) =>
        total + player.transfer_offers.filter((offer) => offer.status === "Pending").length,
      0,
    );
}

export function getManagerTeamName(gameState: GameStateData): string | null {
  return (
    gameState.teams.find((team) => team.id === gameState.manager.team_id)?.name ??
    null
  );
}

export function getPlayerBadgeVariant(
  position: string,
): "accent" | "danger" | "primary" | "success" {
  switch (position) {
    case "Goalkeeper":
      return "accent";
    case "Defender":
      return "primary";
    case "Midfielder":
      return "success";
    default:
      return "danger";
  }
}

export function getDashboardSearchResults(
  gameState: GameStateData,
  query: string,
): DashboardSearchResults {
  const normalizedQuery = query.trim().toLowerCase();

  if (normalizedQuery.length < 2) {
    return {
      matchedPlayers: [],
      matchedTeams: [],
      matchedChampions: [],
    };
  }

  return {
    matchedPlayers: gameState.players
      .filter((player) => {
        return (
          player.full_name.toLowerCase().includes(normalizedQuery) ||
          player.match_name.toLowerCase().includes(normalizedQuery)
        );
      })
      .slice(0, 5),
    matchedTeams: gameState.teams
      .filter((team) => {
        return (
          team.name.toLowerCase().includes(normalizedQuery) ||
          team.short_name.toLowerCase().includes(normalizedQuery)
        );
      })
      .slice(0, 4),
    matchedChampions: (gameState.champions ?? [])
      .filter((champion) => {
        return (
          champion.name.toLowerCase().includes(normalizedQuery) ||
          champion.champion_key.toLowerCase().includes(normalizedQuery)
        );
      })
      .slice(0, 5),
  };
}

export function getDashboardAlerts(
  gameState: GameStateData,
  hasMatchToday: boolean,
  t: DashboardAlertTranslator,
): DashboardAlert[] {
  const alerts: DashboardAlert[] = [];
  const myTeam = gameState.teams.find(
    (team) => team.id === gameState.manager.team_id,
  );
  const roster = myTeam
    ? gameState.players.filter((player) => player.team_id === myTeam.id)
    : [];
  const teamStaff = myTeam
    ? gameState.staff.filter((staffMember) => staffMember.team_id === myTeam.id)
    : [];
  const financeSnapshot = myTeam
    ? getTeamFinanceSnapshot(myTeam, roster, teamStaff)
    : null;
  const exhaustedCount = roster.filter((player) => player.condition < 25).length;
  const urgentUnreadCount = gameState.messages.filter((message) => {
    return !message.read && message.priority === "Urgent";
  }).length;
  const savedLineupIds = myTeam?.active_lineup_ids ?? myTeam?.starting_xi_ids ?? [];
  const effectiveLineupIds = myTeam
    ? buildActiveLineupIds(roster, savedLineupIds)
    : [];
  const activeLineupRoleCount = effectiveLineupIds.filter(Boolean).length;
  const rosterRoleCount = new Set(
    buildActiveLineupIds(roster, []).filter(Boolean),
  ).size;

  if (exhaustedCount >= 3) {
    alerts.push({
      id: "exhausted",
      text: t("dashboard.alerts.exhausted", { count: exhaustedCount }),
      tab: "Training",
      severity: "warn",
    });
  }

  if (savedLineupIds.length > 0) {
    if (
      activeLineupRoleCount < LOL_ACTIVE_ROLES.length &&
      rosterRoleCount >= LOL_ACTIVE_ROLES.length
    ) {
      alerts.push({
        id: "incomplete_lineup",
        text: t("dashboard.alerts.incompleteStartingXi"),
        tab: "Squad",
        severity: "warn",
      });
    }
  }

  if (urgentUnreadCount > 0) {
    alerts.push({
      id: "urgent",
      text: t("dashboard.alerts.urgentUnread", { count: urgentUnreadCount }),
      tab: "Inbox",
      severity: "warn",
    });
  }

  if (myTeam && financeSnapshot) {
    const sponsorshipContract = getSponsorshipContractView(myTeam.sponsorship);

    if (myTeam.finance < 0 || financeSnapshot.runwayStatus === "critical") {
      alerts.push({
        id: "finance_crisis",
        text: t("dashboard.alerts.financeCrisis", {
          balance: formatVal(myTeam.finance),
          weeks: financeSnapshot.cashRunwayMonths ?? 0,
          defaultValue:
            "Finances critical — balance {{balance}}, runway {{weeks}} week(s)",
        }),
        tab: "Finances",
        severity: "warn",
      });
    } else if (financeSnapshot.runwayStatus === "warning") {
      alerts.push({
        id: "finance_runway",
        text: t("dashboard.alerts.financeRunway", {
          count: financeSnapshot.cashRunwayMonths,
          defaultValue: "Cash runway down to {{count}} week(s)",
        }),
        tab: "Finances",
        severity: "warn",
      });
    }

    if (sponsorshipContract?.theme === "esports") {
      alerts.push({
        id: "sponsor_theme_esports",
        text: t("dashboard.alerts.esportsSponsor", {
          sponsorName: sponsorshipContract.sponsorName,
          defaultValue: "{{sponsorName}} is an esports sponsor",
        }),
        tab: "Finances",
        severity: "info",
      });
    }

    if (
      financeSnapshot.wageBudgetStatus === "warning" ||
      financeSnapshot.wageBudgetStatus === "critical"
    ) {
      alerts.push({
        id: "wage_pressure",
        text: t("dashboard.alerts.wagePressure", {
          percent: financeSnapshot.wageBudgetUsagePercent,
          defaultValue: "Wage bill at {{percent}}% of budget",
        }),
        tab: "Finances",
        severity: "warn",
      });
    }
  }

  if (
    hasMatchToday &&
    savedLineupIds.length > 0 &&
    activeLineupRoleCount < LOL_ACTIVE_ROLES.length
  ) {
    alerts.push({
      id: "match_lineup",
      text: t("dashboard.alerts.matchTodayStartingXi"),
      tab: "Squad",
      severity: "warn",
    });
  }

  return alerts;
}



