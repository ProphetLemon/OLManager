import type { GameStateData, PlayerData } from "../../store/gameStore";
import { calculateLolOvr } from "../../lib/players/lolPlayerStats";
import { findAcademyTeamForParent } from "@/store/academySelectors";
import { getLolRoleForPlayer } from "@/lib/squad/helpers";
import { calcAge, compareAgesUnknownLast } from "../../lib/common/helpers";

function normalizePlayerKey(player: PlayerData): string {
  const normalizeToken = (value: string): string =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

  const matchName = normalizeToken(player.match_name || "");
  const fullName = normalizeToken(player.full_name || "");
  const identity = matchName || fullName || player.id;
  const dob = player.date_of_birth || "unknown-dob";
  const nationality = normalizeToken(player.nationality || "unknown-nat");
  return `${identity}|${dob}|${nationality}`;
}

function normalizeNameToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function dedupePlayersPreferAcademy(
  players: PlayerData[],
  academyTeamIds: Set<string>,
): PlayerData[] {
  const byKey = new Map<string, PlayerData>();

  players.forEach((player) => {
    const key = normalizePlayerKey(player);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, player);
      return;
    }

    const currentIsAcademy = academyTeamIds.has(player.team_id ?? "");
    const existingIsAcademy = academyTeamIds.has(existing.team_id ?? "");
    if (currentIsAcademy && !existingIsAcademy) {
      byKey.set(key, player);
    }
  });

  return [...byKey.values()];
}

export type TransferTabView = "my_list" | "market" | "erl" | "loans" | "offers";

export interface TransferCollections {
  myTransferList: PlayerData[];
  myLoanList: PlayerData[];
  marketPlayers: PlayerData[];
  erlPlayers?: PlayerData[];
  loanPlayers: PlayerData[];
  playersWithOffers: PlayerData[];
}

export function deriveTransferCollections(
  gameState: GameStateData,
  userTeamId: string | null,
): TransferCollections {
  const academyTeamIds = new Set(
    gameState.teams
      .filter((team) => team.team_kind === "Academy")
      .map((team) => team.id),
  );
  const academyIdentityKeys = new Set(
    gameState.players
      .filter((player) => academyTeamIds.has(player.team_id ?? ""))
      .map((player) => normalizePlayerKey(player)),
  );
  const userClubTeamIds = new Set<string>();
  if (userTeamId) {
    userClubTeamIds.add(userTeamId);
    gameState.teams
      .filter(
        (team) =>
          team.team_kind === "Academy" &&
          team.parent_team_id === userTeamId,
      )
      .forEach((team) => userClubTeamIds.add(team.id));
  }
  // A real club linked as the user's academy is the user's side: it is a normal Main
  // club, so it is not in `academyTeamIds`, yet its players are not for sale to the user.
  const linkedClubId = findAcademyTeamForParent(gameState.teams, userTeamId)?.id ?? null;
  const isLinkedClubPlayer = (player: PlayerData) =>
    linkedClubId !== null && player.team_id === linkedClubId;

  const contractedNickSet = new Set(
    gameState.players
      .filter((player) => player.team_id !== null)
      .map((player) => normalizeNameToken(player.match_name || ""))
      .filter((token) => token.length > 0),
  );

  const marketPlayers = dedupePlayersPreferAcademy(
    gameState.players.filter(
      (player) =>
        (player.team_id === null || player.transfer_listed) &&
        player.team_id !== userTeamId &&
        !isLinkedClubPlayer(player) &&
        !academyIdentityKeys.has(normalizePlayerKey(player)) &&
        !(
          player.team_id === null &&
          contractedNickSet.has(normalizeNameToken(player.match_name || ""))
        ),
    ),
    academyTeamIds,
  );

  const loanPlayers = dedupePlayersPreferAcademy(
    gameState.players.filter(
      (player) =>
        player.loan_listed &&
        player.team_id !== userTeamId &&
        !isLinkedClubPlayer(player) &&
        !academyIdentityKeys.has(normalizePlayerKey(player)),
    ),
    academyTeamIds,
  );

  const erlPlayers = dedupePlayersPreferAcademy(
    gameState.players.filter((player) => {
      const teamId = player.team_id ?? "";
      return academyTeamIds.has(teamId) && !userClubTeamIds.has(teamId);
    }),
    academyTeamIds,
  );

  return {
    myTransferList: gameState.players.filter(
      (player) => player.team_id === userTeamId && player.transfer_listed,
    ),
    myLoanList: gameState.players.filter(
      (player) => player.team_id === userTeamId && player.loan_listed,
    ),
    marketPlayers,
    erlPlayers,
    loanPlayers,
    playersWithOffers: gameState.players.filter(
      (player) =>
        player.transfer_offers.length > 0 &&
        (player.team_id === userTeamId ||
          player.transfer_offers.some(
            (offer) => offer.from_team_id === userTeamId,
          )),
    ),
  };
}

export function getCurrentTransferList(
  view: TransferTabView,
  collections: TransferCollections,
): PlayerData[] {
  switch (view) {
    case "my_list":
      return [...collections.myTransferList, ...collections.myLoanList];
    case "market":
      return collections.marketPlayers;
    case "erl":
      return collections.erlPlayers ?? [];
    case "loans":
      return collections.loanPlayers;
    case "offers":
    default:
      return collections.playersWithOffers;
  }
}

export function filterTransferPlayers(
  players: PlayerData[],
  search: string,
  posFilter: string | null,
  competitionTeamIds: Set<string> | null,
): PlayerData[] {
  return players.filter((player) => {
    if (posFilter && getLolRoleForPlayer(player) !== posFilter) {
      return false;
    }
    if (competitionTeamIds && (!player.team_id || !competitionTeamIds.has(player.team_id))) {
      return false;
    }

    if (search.length >= 2) {
      const query = search.toLowerCase();

      if (
        !player.match_name.toLowerCase().includes(query) &&
        !player.full_name.toLowerCase().includes(query) &&
        !player.nationality.toLowerCase().includes(query)
      ) {
        return false;
      }
    }

    return true;
  });
}

export type TransferSortKey = "value" | "wage" | "ovr" | "name" | "position" | "age" | "team" | "status" | "nationality" | "soloq";
export type TransferSortDirection = "asc" | "desc";

export interface TransferSortState {
  key: TransferSortKey;
  direction: TransferSortDirection;
}

export function sortTransferPlayers(
  players: PlayerData[],
  sort: TransferSortState | null,
): PlayerData[] {
  if (!sort) return players;

  const factor = sort.direction === "asc" ? 1 : -1;

  const sorted = [...players].sort((a, b) => {
    switch (sort.key) {
      case "value":
        return (a.market_value - b.market_value) * factor;
      case "wage":
        return (a.wage - b.wage) * factor;
      case "ovr":
        return (calculateLolOvr(a) - calculateLolOvr(b)) * factor;
      case "name":
        return a.match_name.localeCompare(b.match_name) * factor;
      case "position": {
        const roleA = getLolRoleForPlayer(a);
        const roleB = getLolRoleForPlayer(b);
        const order: Record<string, number> = { TOP: 1, JUNGLE: 2, MID: 3, ADC: 4, SUPPORT: 5 };
        return ((order[roleA] ?? 0) - (order[roleB] ?? 0)) * factor;
      }
      case "age":
        return compareAgesUnknownLast(
          calcAge(a.date_of_birth, new Date().toISOString()),
          calcAge(b.date_of_birth, new Date().toISOString()),
          factor,
        );
      case "team": {
        const teamA = a.team_id ?? "";
        const teamB = b.team_id ?? "";
        return teamA.localeCompare(teamB) * factor;
      }
      case "status": {
        const statusVal = (p: typeof a) => {
          if (p.loan_listed) return 3;
          if (p.transfer_listed) return 2;
          return 0;
        };
        return (statusVal(b) - statusVal(a)) * factor;
      }
      case "nationality":
        return (a.nationality ?? "").localeCompare(b.nationality ?? "") * factor;
      case "soloq":
        return ((a.soloq_lp ?? 0) - (b.soloq_lp ?? 0)) * factor;
      default:
        return 0;
    }
  });

  return sorted;
}

