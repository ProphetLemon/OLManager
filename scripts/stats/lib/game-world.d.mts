export interface GamePlayer {
  id: string;
  match_name: string;
  full_name: string;
  team_id: string | null;
  /** Competition of the player's team after the roster overlay; null for free agents. */
  competition: string | null;
  position: string;
  attributes: Record<string, number>;
  potential_base: number;
  market_value: number;
  wage: number;
  /** olm_core calculate_lol_ovr of the authored attributes. */
  authoredOvr: number;
  isFlat50: boolean;
  isAllZero: boolean;
}

export const DEFAULT_DATA_DIR: string;
export const DEFAULT_OVERLAY_FILE: string;
export const ATTRIBUTE_NAMES: readonly string[];
export function calculateLolOvr(attributes: Record<string, number>): number;
export function loadGamePlayers(options?: {
  dataDir?: string;
  overlayFile?: string | null;
  corrections?: unknown[];
}): {
  players: GamePlayer[];
  teams: Map<string, { id: string; name: string; competition: string }>;
  report: {
    overlay: { moved: number; retired: number; added: number; skipped: string[] };
    corrections: { applied: number; skipped: string[] };
  };
};
