import type { MapPoint } from "@/lib/match/live/mapGeometry";

/**
 * Who is fighting whom, which towers are shooting, and the recall and respawn
 * timers, all from one engine answer. Pure, and tolerant: a field the engine
 * does not send (the TS fallback simulation never fills the damage and ramp
 * fields) reads as "no contact" or "no beam", never as an error.
 */

/** A hit by a champion counts as a fight for this many game seconds. */
export const CONTACT_WINDOW_SEC = 4;
/** A tower beam shows while its latest shot is at most this old (`TOWER_SHOT_RAMP_WINDOW_SEC` in the engine). */
export const TOWER_BEAM_WINDOW_SEC = 3;
/** Length of the recall channel. */
export const RECALL_CHANNEL_SEC = 6.5;

export interface ContactChampion {
  id: string;
  alive: boolean;
  pos?: MapPoint;
  state?: string;
  lastDamagedByChampionId?: string | null;
  /** Pairs with `lastDamagedByChampionId`. Never use `lastDamagedAt`: towers, minions and ignite refresh it too. */
  lastDamagedByChampionAt?: number;
  recallChannelUntil?: number;
  respawnAt?: number;
}

export interface ContactStructure {
  id: string;
  alive: boolean;
  rampTargetId?: string | null;
  rampShots?: number;
  rampLastShotAt?: number;
}

export interface ContactPair {
  /** `a|b` with the ids sorted: a stable key. */
  id: string;
  a: string;
  b: string;
  /** Both sides hit each other inside the window. */
  mutual: boolean;
  /** Seconds since the last hit on each champion of the pair, by the id of the one that was hit. */
  ageByTarget: Partial<Record<string, number>>;
  /** Age of the freshest hit of the pair. */
  ageSec: number;
}

export interface ContactResult {
  pairs: ContactPair[];
  /** Ids of every champion in a pair, sorted. */
  fightingIds: string[];
}

export interface TowerBeam {
  structureId: string;
  targetId: string;
  /** Shots to show: `rampShots + 1`. */
  shots: number;
  ageSec: number;
}

const isTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function detectContacts(champions: readonly ContactChampion[], nowSec: number): ContactResult {
  const byId = new Map(champions.map((champion) => [champion.id, champion]));
  const pairs = new Map<string, ContactPair>();

  for (const victim of champions) {
    const attackerId = victim.lastDamagedByChampionId;
    const at = victim.lastDamagedByChampionAt;
    if (!victim.alive || !attackerId || attackerId === victim.id || !isTime(at) || at <= 0) continue;
    const attacker = byId.get(attackerId);
    if (!attacker?.alive) continue;
    const age = nowSec - at;
    if (age < 0 || age > CONTACT_WINDOW_SEC) continue;

    const [a, b] = attackerId < victim.id ? [attackerId, victim.id] : [victim.id, attackerId];
    const id = `${a}|${b}`;
    const pair = pairs.get(id) ?? { id, a, b, mutual: false, ageByTarget: {}, ageSec: age };
    pair.ageByTarget[victim.id] = age;
    pair.ageSec = Math.min(pair.ageSec, age);
    pair.mutual = pair.ageByTarget[a] !== undefined && pair.ageByTarget[b] !== undefined;
    pairs.set(id, pair);
  }

  const list = [...pairs.values()].sort((x, y) => (x.id < y.id ? -1 : 1));
  const fighting = new Set<string>();
  for (const pair of list) {
    fighting.add(pair.a);
    fighting.add(pair.b);
  }
  return { pairs: list, fightingIds: [...fighting].sort() };
}

/**
 * Beams from towers to champions. `rampTargetId` is cleared only when the target
 * is a minion, so a stale id can outlive the shooting: the latest shot must be
 * recent. A dead tower or a dead or unknown target draws nothing.
 */
export function towerBeams(
  structures: readonly ContactStructure[],
  champions: readonly ContactChampion[],
  nowSec: number,
): TowerBeam[] {
  const byId = new Map(champions.map((champion) => [champion.id, champion]));
  const beams: TowerBeam[] = [];
  for (const structure of structures) {
    const targetId = structure.rampTargetId;
    const last = structure.rampLastShotAt;
    if (!structure.alive || !targetId || !isTime(last) || last <= 0) continue;
    const age = nowSec - last;
    if (age < 0 || age > TOWER_BEAM_WINDOW_SEC) continue;
    if (!byId.get(targetId)?.alive) continue;
    const prior = isTime(structure.rampShots) ? Math.max(0, Math.floor(structure.rampShots)) : 0;
    beams.push({ structureId: structure.id, targetId, shots: prior + 1, ageSec: age });
  }
  return beams.sort((x, y) => (x.structureId < y.structureId ? -1 : 1));
}

/**
 * How far a recall has got, 0 to 1 (1 = about to land), or null when the
 * champion is not channeling. The ring that drains shows `1 - progress`.
 */
export function recallProgress(champion: ContactChampion, nowSec: number): number | null {
  const until = champion.recallChannelUntil;
  if (!champion.alive || champion.state !== "recall" || !isTime(until) || until <= nowSec) return null;
  const remaining = Math.min(RECALL_CHANNEL_SEC, until - nowSec);
  return 1 - remaining / RECALL_CHANNEL_SEC;
}

/** Seconds of recall left (0 to 6.5), or null when not channeling. */
export function recallRemainingSec(champion: ContactChampion, nowSec: number): number | null {
  const progress = recallProgress(champion, nowSec);
  return progress === null ? null : (1 - progress) * RECALL_CHANNEL_SEC;
}

/** Seconds until a dead champion is back; 0 when alive or when the engine sent no respawn time. */
export function respawnRemaining(champion: ContactChampion, nowSec: number): number {
  if (champion.alive || !isTime(champion.respawnAt)) return 0;
  return Math.max(0, champion.respawnAt - nowSec);
}
