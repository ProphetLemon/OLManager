import type { PlayerData, TeamData } from "./types";

/** A legacy generated academy copy. A real club linked as an academy is a normal `Main` club. */
export function isAcademyTeam(team: TeamData): boolean {
  return team.team_kind === "Academy";
}

export function isMainTeam(team: TeamData): boolean {
  return team.team_kind !== "Academy";
}

export function getMainTeams(teams: TeamData[]): TeamData[] {
  return teams.filter(isMainTeam);
}

/** Real `Main` club linked to `parentTeamId` through both ids (`academy_team_id` / `parent_team_id`). */
function findLinkedClubForParent(
  teams: TeamData[],
  parentTeamId: string | null | undefined,
): TeamData | null {
  if (!parentTeamId) return null;
  const parent = teams.find((team) => team.id === parentTeamId);
  const clubId = parent?.academy_team_id;
  if (!clubId) return null;
  return (
    teams.find(
      (team) =>
        team.id === clubId && !isAcademyTeam(team) && team.parent_team_id === parentTeamId,
    ) ?? null
  );
}

/** True when `team` is a real club some parent has linked as its academy. */
export function isLinkedAcademyClub(teams: TeamData[], team: TeamData): boolean {
  return (
    !isAcademyTeam(team) &&
    Boolean(team.parent_team_id) &&
    findLinkedClubForParent(teams, team.parent_team_id)?.id === team.id
  );
}

/** True when `teamId` is the academy (linked club or legacy copy) of the manager's club. */
export function isUserAcademyClub(
  teams: TeamData[],
  managerTeamId: string | null | undefined,
  teamId: string,
): boolean {
  return findAcademyTeamForParent(teams, managerTeamId)?.id === teamId;
}

/** The manager's club plus its academy, which the user runs. */
export function getManagedTeamIds(
  teams: TeamData[],
  managerTeamId: string | null | undefined,
): Set<string> {
  const managed = new Set<string>();
  if (!managerTeamId) return managed;
  managed.add(managerTeamId);
  const academy = findAcademyTeamForParent(teams, managerTeamId);
  if (academy) managed.add(academy.id);
  return managed;
}

export function findAcademyTeamForParent(
  teams: TeamData[],
  parentTeamId: string | null | undefined,
): TeamData | null {
  if (!parentTeamId) {
    return null;
  }

  const linked = findLinkedClubForParent(teams, parentTeamId);
  if (linked) {
    return linked;
  }

  const parent = teams.find((team) => team.id === parentTeamId);
  const parentAcademyId = parent?.academy_team_id ?? null;

  return (
    teams.find(
      (team) =>
        isAcademyTeam(team) &&
        (team.parent_team_id === parentTeamId || team.id === parentAcademyId),
    ) ?? null
  );
}

export function getTeamAcademyRoster(
  teams: TeamData[],
  players: PlayerData[],
  parentTeamId: string | null | undefined,
): PlayerData[] {
  const academy = findAcademyTeamForParent(teams, parentTeamId);

  if (!academy) {
    return [];
  }

  return players.filter((player) => player.team_id === academy.id);
}
