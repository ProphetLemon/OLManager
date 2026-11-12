import type { GameStateData, TeamData } from "@/store/gameStore";
import { teamLolOvr, teamLolStrength } from "./scrimContext";

/**
 * The scrim engine's odds, mirrored from `olm_core::training` (`scrim_request_accepted` and the
 * win probability in `process_scrim_block`). `rivalOdds.parity.test.ts` reads the Rust source and
 * fails when a constant here stops matching it.
 */
export const SCRIM_ODDS = {
  accept: { base: 0.52, perReputation: 0.006, min: 0.08, max: 0.88 },
  win: { base: 0.5, perStrength: 0.022, min: 0.2, max: 0.8, strengthGap: 14 },
} as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Chance that a rival takes a slot, for a slot whose plan has two or more entries. */
export function acceptChance(ownReputation: number, opponentReputation: number): number {
  const { base, perReputation, min, max } = SCRIM_ODDS.accept;
  return clamp(base + (ownReputation - opponentReputation) * perReputation, min, max);
}

/** Chance that the club wins a scrim against a rival, from the strength of both lineups. */
export function winChance(ownStrength: number, opponentStrength: number): number {
  const { base, perStrength, min, max, strengthGap } = SCRIM_ODDS.win;
  return clamp(base + clamp(ownStrength - opponentStrength, -strengthGap, strengthGap) * perStrength, min, max);
}

export interface RivalRow {
  teamId: string;
  name: string;
  ovr: number;
  reputation: number;
  /** Whole percent. */
  winPercent: number;
  /** Whole percent. */
  acceptPercent: number;
}

/** The other clubs of the manager's competition, strongest first, with the odds the engine uses against each. */
export function buildRivalRows(gameState: GameStateData, myTeam: TeamData, ownReputation: number): RivalRow[] {
  const ownStrength = teamLolStrength(gameState, myTeam.id);
  return gameState.teams
    .filter((team) => team.id !== myTeam.id && team.competition_id === myTeam.competition_id)
    .map((team) => {
      const reputation = team.scrim_reputation ?? 50;
      return {
        teamId: team.id,
        name: team.name,
        ovr: teamLolOvr(gameState, team.id),
        reputation,
        winPercent: Math.round(winChance(ownStrength, teamLolStrength(gameState, team.id)) * 100),
        acceptPercent: Math.round(acceptChance(ownReputation, reputation) * 100),
      };
    })
    .sort((a, b) => b.ovr - a.ovr || a.name.localeCompare(b.name));
}
