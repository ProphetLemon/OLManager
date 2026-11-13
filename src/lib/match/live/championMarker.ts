import { recallRemainingSec, respawnRemaining, type ContactChampion } from "@/lib/match/live/contacts";

/**
 * What a champion marker says about the champion, as data. The words come later, from
 * i18next; the tag solver and the marker both read this, so they agree on what has a state.
 */

export type MarkerStateKind = "dead" | "recall" | "fighting" | "objective";

export interface MarkerState {
  kind: MarkerStateKind;
  /** Whole seconds until respawn, or seconds of recall left to a tenth. 0 for the other kinds. */
  seconds: number;
}

/** The tag in its compact form keeps this many letters of the name. */
export const COMPACT_NAME_CHARS = 3;

const tenths = (value: number) => Math.round(value * 10) / 10;

/**
 * The one state a marker shows, in priority order: dead, recalling, fighting, on an
 * objective. A champion walking a lane has none.
 */
export function markerState(champion: ContactChampion, fighting: boolean, nowSec: number): MarkerState | null {
  if (!champion.alive) return { kind: "dead", seconds: Math.ceil(respawnRemaining(champion, nowSec)) };
  const recall = recallRemainingSec(champion, nowSec);
  if (recall !== null && recall > 0) return { kind: "recall", seconds: tenths(recall) };
  if (fighting) return { kind: "fighting", seconds: 0 };
  if (champion.state === "objective") return { kind: "objective", seconds: 0 };
  return null;
}

/** Two letters for the bubble when the champion has no tile: both initials of two words, else the first two letters. */
export function initialsOf(name: string): string {
  const chunks = name.trim().split(/\s+/).filter(Boolean);
  if (chunks.length >= 2) return `${chunks[0][0]}${chunks[1][0]}`.toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}

export function shortName(name: string): string {
  return name.slice(0, COMPACT_NAME_CHARS);
}

/** Share of a bar that is full, from 0 to 1, with a sliver kept for a living champion so the bar never vanishes. */
export function hpShare(hp: number, maxHp: number, alive: boolean): number {
  if (!alive || !(maxHp > 0)) return 0;
  return Math.min(1, Math.max(0.04, hp / maxHp));
}
