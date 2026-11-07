export interface WorldTeam {
  id: string;
  name: string;
  short_name: string;
  country: string;
  team_kind: string | null;
  competition: string;
}
export interface WorldPlayer {
  id: string;
  match_name: string;
  full_name: string;
  position: string;
  nationality: string;
  date_of_birth: string | null;
  team_id: string | null;
  competition: string | null;
  shard: string;
  raw: Record<string, any>;
}
export interface WorldStaff {
  id: string;
  nickname: string;
  first_name: string;
  last_name: string;
  role: string;
  nationality: string;
  team_id: string | null;
  competition: string | null;
  shard: string;
  raw: Record<string, any>;
}
export interface WorldCompetition {
  id: string;
  name: string;
  tier: number | null;
  teamIds: string[];
  playerCount: number;
  staleOf: string | null;
  covered: boolean;
  skipReason: string | null;
}
export interface World {
  dataDir: string;
  competitions: WorldCompetition[];
  teams: Map<string, WorldTeam>;
  players: WorldPlayer[];
  staff: WorldStaff[];
  duplicates: { players: Array<{ id: string; shards: string[] }>; staff: Array<{ id: string; shards: string[] }> };
}
export const STALE_DUPLICATE_COMPETITIONS: Readonly<Record<string, string>>;
export function readShard(file: string, key: string): unknown[] | null;
export function effectiveTeamId(rawId: string | null | undefined, competitionId: string): string | null;
export function loadWorld(dataDir: string): World;
export function coveredCompetitionIds(world: World): string[];
export function toOverlayWorld(world: World): {
  playerIds: Set<string>;
  staffIds: Set<string>;
  teamIds: Set<string>;
  competitionIds: Set<string>;
};
