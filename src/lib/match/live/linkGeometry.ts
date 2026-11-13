import { MAP_UNITS, type MapPoint } from "@/lib/match/live/mapGeometry";
import type { ContactPair } from "@/lib/match/live/contacts";

/**
 * Geometry of the contact links, in the 1000 unit space of the overlay SVG.
 * The link runs between the outer edges of the two bubbles, not between their
 * centres, so it never hides under a bubble, and the dot sits on the attacker.
 */

export interface LinkOptions {
  /** Radius of the second bubble when it differs (a tower beam ends on a champion). */
  radiusBPx?: number;
  /** Clear space between a bubble and the end of the link. */
  gapPx?: number;
  /** Below this length (px) the link is not drawn. */
  minLengthPx?: number;
}

export interface LinkEndpoints {
  /** End next to `a`. */
  x1: number;
  y1: number;
  /** End next to `b`. */
  x2: number;
  y2: number;
  lengthUnits: number;
  /** False when the bubbles touch or overlap: the chip and the rings still show the fight. */
  visible: boolean;
}

export function linkEndpoints(
  a: MapPoint,
  b: MapPoint,
  radiusPx: number,
  sizePx: number,
  options: LinkOptions = {},
): LinkEndpoints {
  const { radiusBPx = radiusPx, gapPx = 1.5, minLengthPx = 2 } = options;
  const ax = a.x * MAP_UNITS;
  const ay = a.y * MAP_UNITS;
  const bx = b.x * MAP_UNITS;
  const by = b.y * MAP_UNITS;
  const dx = bx - ax;
  const dy = by - ay;
  const centres = Math.hypot(dx, dy);
  const unitsPerPx = sizePx > 0 ? MAP_UNITS / sizePx : 0;
  const offsetA = (radiusPx + gapPx) * unitsPerPx;
  const offsetB = (radiusBPx + gapPx) * unitsPerPx;
  const length = centres - offsetA - offsetB;

  if (centres === 0 || unitsPerPx === 0 || length < minLengthPx * unitsPerPx) {
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    return { x1: mx, y1: my, x2: mx, y2: my, lengthUnits: 0, visible: false };
  }
  const ux = dx / centres;
  const uy = dy / centres;
  return {
    x1: ax + ux * offsetA,
    y1: ay + uy * offsetA,
    x2: bx - ux * offsetB,
    y2: by - uy * offsetB,
    lengthUnits: length,
    visible: true,
  };
}

/**
 * Which ends of a pair's link carry the dot: the end of whoever hit. Hits on `b`
 * come from `a`, so the dot is at `a`; both ends when it is mutual.
 */
export function linkDots(pair: Pick<ContactPair, "a" | "b" | "ageByTarget">): { atA: boolean; atB: boolean } {
  return {
    atA: pair.ageByTarget[pair.b] !== undefined,
    atB: pair.ageByTarget[pair.a] !== undefined,
  };
}

/** Where the chip of a link sits: the midpoint of the two centres, same space as the inputs. */
export function chipPosition(a: MapPoint, b: MapPoint): MapPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Opacity of a link or beam by the age of its hit: full, then 0.78, then 0.55. */
export function linkOpacity(ageSec: number): number {
  return ageSec < 1.5 ? 1 : ageSec < 3 ? 0.78 : 0.55;
}

/** A tower beam is never shorter than this, so a target standing next to the tower still gets a mark. */
export const MIN_BEAM_PX = 16;
/** Length of each arm of the arrowhead on the target's end. */
const BEAM_HEAD_PX = 7;
/** Clear space between the tower's ring and the xN chip that sits behind it. */
const BEAM_CHIP_GAP_PX = 18;

export interface BeamGeometry {
  /** Start, on the tower's ring (overlay SVG units). */
  x1: number;
  y1: number;
  /** End, on the target's near edge, or `MIN_BEAM_PX` from the start when that is shorter. */
  x2: number;
  y2: number;
  /** The three points of the arrowhead (tip last but one), as an SVG `points` value. */
  head: string;
  /** Where the xN chip sits: behind the tower, away from the target (map units 0..1). */
  chip: MapPoint;
  /** True when the target's bubble reaches the tower and the beam was stretched to stay visible. */
  stretched: boolean;
}

/**
 * Where a tower's shot is drawn. It starts at the ring of the tower and ends at the near edge of
 * the target's bubble; when the target stands so close that this is under `MIN_BEAM_PX`, the beam
 * keeps that length and runs over the bubble's edge (the layer is drawn above the champions), and
 * the arrowhead says where it lands. The chip goes on the other side of the tower, so it never
 * sits under the target.
 */
export function beamGeometry(
  tower: MapPoint,
  target: MapPoint,
  ringRadiusPx: number,
  targetRadiusPx: number,
  sizePx: number,
  gapPx = 1.5,
): BeamGeometry {
  const unitsPerPx = sizePx > 0 ? MAP_UNITS / sizePx : 0;
  const ax = tower.x * MAP_UNITS;
  const ay = tower.y * MAP_UNITS;
  const dx = target.x * MAP_UNITS - ax;
  const dy = target.y * MAP_UNITS - ay;
  const centres = Math.hypot(dx, dy);
  // Straight down when the two share a point: any direction will do, it only has to be stable.
  const ux = centres === 0 ? 0 : dx / centres;
  const uy = centres === 0 ? 1 : dy / centres;

  const startPx = ringRadiusPx;
  const naturalEndPx = centres / (unitsPerPx || 1) - targetRadiusPx - gapPx;
  const stretched = naturalEndPx - startPx < MIN_BEAM_PX;
  const endPx = stretched ? startPx + MIN_BEAM_PX : naturalEndPx;

  const x1 = ax + ux * startPx * unitsPerPx;
  const y1 = ay + uy * startPx * unitsPerPx;
  const x2 = ax + ux * endPx * unitsPerPx;
  const y2 = ay + uy * endPx * unitsPerPx;

  const arm = BEAM_HEAD_PX * unitsPerPx;
  const backX = x2 - ux * arm;
  const backY = y2 - uy * arm;
  const sideX = -uy * arm * 0.6;
  const sideY = ux * arm * 0.6;
  const point = (x: number, y: number) => `${x.toFixed(1)},${y.toFixed(1)}`;
  const head = `${point(backX + sideX, backY + sideY)} ${point(x2, y2)} ${point(backX - sideX, backY - sideY)}`;

  const behindPx = sizePx > 0 ? (ringRadiusPx + BEAM_CHIP_GAP_PX) / sizePx : 0;
  return { x1, y1, x2, y2, head, chip: { x: tower.x - ux * behindPx, y: tower.y - uy * behindPx }, stretched };
}
