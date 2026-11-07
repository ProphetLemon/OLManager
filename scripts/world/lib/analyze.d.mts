import type { World } from "./world.mjs";
import type { IdMap } from "./match.mjs";

export function analyzeRosters(input: {
  world: World;
  titleToTeam: Map<string, string>;
  rosters: Map<string, { players: any[]; staff: any[] }>;
  overrides: IdMap;
}): {
  moves: any[];
  adds: any[];
  absent: any[];
  staffMoves: any[];
  staffAdds: any[];
  issues: Array<{ kind: string; subject: string; detail: string; [key: string]: unknown }>;
  teamStats: Map<string, any>;
  suspectTeams: Set<string>;
  seenPlayers: Set<string>;
  seenStaff: Set<string>;
};
