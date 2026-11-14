import {
  LANE_KEYS,
  LANES,
  MAP_UNITS,
  distanceToPolyline,
  isInBase,
  type LaneKey,
  type MapPoint,
  type TeamSide,
} from "@/lib/match/live/mapGeometry";

/** The wave is even while its meeting point stays this close to the middle of the lane. */
export const LANE_EVEN_BAND = 0.07;
/** A fight belongs to a lane when it is within this many map units of the lane's centre line. */
export const LANE_FIGHT_RANGE_UNITS = 60;

export type LanePush = "none" | "even" | TeamSide;

export interface LaneView {
  lane: LaneKey;
  /** Who is pushing: a side, "even", or "none" when no wave is on the lane. */
  push: LanePush;
  /** Where the waves meet along the lane, 0 at the blue base and 1 at the red base; null without a wave. */
  front: number | null;
  /** Champions are fighting on this lane. */
  fight: boolean;
}

export interface LaneMinion {
  team: TeamSide;
  lane: string;
  pos: MapPoint;
  alive: boolean;
  kind?: string;
}

export interface LaneChampion {
  id: string;
  pos: MapPoint;
  alive: boolean;
}

export interface LaneStripInput {
  minions: readonly LaneMinion[];
  champions: readonly LaneChampion[];
  /** Ids of the champions in a fight (the contact view's `fightingIds`). */
  fightingIds: readonly string[];
}

/** Position along a polyline, 0 at its first point and 1 at its last, of the point nearest to `p`. */
export function progressAlong(polyline: readonly MapPoint[], p: MapPoint): number {
  let total = 0;
  let best = { distance: Number.POSITIVE_INFINITY, along: 0 };
  for (let i = 1; i < polyline.length; i += 1) {
    const a = polyline[i - 1];
    const b = polyline[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    const k = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (length * length)));
    const distance = Math.hypot(p.x - (a.x + k * dx), p.y - (a.y + k * dy));
    if (distance < best.distance) best = { distance, along: total + k * length };
    total += length;
  }
  return total === 0 ? 0 : best.along / total;
}

const toUnits = (pos: MapPoint): MapPoint => ({ x: pos.x * MAP_UNITS, y: pos.y * MAP_UNITS });
const mean = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

/** Where the waves meet on one lane, and who is pushing; the strip reads this and nothing else of the minions. */
function waveOf(lane: LaneKey, minions: readonly LaneMinion[]): Pick<LaneView, "push" | "front"> {
  const progress: Record<TeamSide, number[]> = { blue: [], red: [] };
  for (const minion of minions) {
    if (!minion.alive || minion.kind === "summon" || minion.lane !== lane) continue;
    progress[minion.team].push(progressAlong(LANES[lane], toUnits(minion.pos)));
  }
  const { blue, red } = progress;
  // A wave with nobody against it is pushing, wherever it stands: the other side has none left.
  if (blue.length > 0 && red.length === 0) return { push: "blue", front: mean(blue) };
  if (red.length > 0 && blue.length === 0) return { push: "red", front: mean(red) };
  if (blue.length === 0) return { push: "none", front: null };
  // Each side counts once, so a wave of six does not drown a wave of two.
  const front = (mean(blue) + mean(red)) / 2;
  if (front >= 0.5 + LANE_EVEN_BAND) return { push: "blue", front };
  if (front <= 0.5 - LANE_EVEN_BAND) return { push: "red", front };
  return { push: "even", front };
}

/** The lane a fighting champion stands on: the nearest within range, none in a base where the lanes run together. */
function fightLane(pos: MapPoint): LaneKey | null {
  const units = toUnits(pos);
  if (isInBase(units, "blue") || isInBase(units, "red")) return null;
  let best: { lane: LaneKey; distance: number } | null = null;
  for (const lane of LANE_KEYS) {
    const distance = distanceToPolyline(units, LANES[lane]);
    if (distance <= LANE_FIGHT_RANGE_UNITS && (!best || distance < best.distance)) best = { lane, distance };
  }
  return best?.lane ?? null;
}

/**
 * Per lane, which way the wave pushes and whether champions are fighting there, from the minions
 * and the contact view the screen already holds. Nothing here is sent by the engine as such.
 */
export function laneStripView({ minions, champions, fightingIds }: LaneStripInput): LaneView[] {
  const fighting = new Set(fightingIds);
  const fights = new Set<LaneKey>();
  for (const champion of champions) {
    if (!champion.alive || !fighting.has(champion.id)) continue;
    const lane = fightLane(champion.pos);
    if (lane) fights.add(lane);
  }
  return LANE_KEYS.map((lane) => ({ lane, ...waveOf(lane, minions), fight: fights.has(lane) }));
}
