import type { GamePlayer } from "./game-world.mjs";
import type { PlayerIndex } from "./normalize.mjs";

export interface IdentityMatch {
  link: string;
  playerId: string;
  via: "team" | "role-competition" | "pin";
}
export interface ReviewCandidate {
  id: string;
  matchName: string;
  teamId: string | null;
  competition: string | null;
  position: string;
  teamOk: boolean;
  roleCompetitionOk: boolean;
}
export interface ReviewItem {
  link: string;
  reason: "team_and_role_mismatch" | "ambiguous_game_players" | "ambiguous_links";
  candidates: ReviewCandidate[];
}
export interface UnmatchedLink {
  link: string;
  games: number;
  names: string[];
  team: string | null;
  competition: string | null;
}
export interface MatchResult {
  matches: IdentityMatch[];
  review: ReviewItem[];
  unmatched: UnmatchedLink[];
  pinIssues: string[];
}

export function roleOfPosition(position: unknown): "Top" | "Jungle" | "Mid" | "Bot" | "Support" | null;
export function matchPlayers(input: {
  index: PlayerIndex;
  players: GamePlayer[];
  teamMap: { teams?: Record<string, { title: string | null; name: string }> } | null | undefined;
  pins?: Record<string, string | null>;
}): MatchResult;
