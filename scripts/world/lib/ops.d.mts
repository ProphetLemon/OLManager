export function isWorldTeamName(name: string, worldTeamNames: Set<string>): boolean;
export function decideAbsentPlayer(
  player: { id: string; match_name: string },
  status: unknown,
  worldTeamNames: Set<string>,
): { op: Record<string, any>; note: string } | { skip: string };
