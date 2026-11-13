import {
  JUNGLE_CAMPS_LAYOUT,
  NEUTRAL_OBJECTIVES_LAYOUT,
  type JungleCampPoint,
} from "@/lib/match/lolMapLayout";

/**
 * Geometry of the schematic arena. The engine reports positions normalised to
 * 0..1 (blue base bottom left, red base top right); the terrain SVG and the
 * overlays use a 1000 unit square. Pure functions, no DOM.
 */

export const MAP_UNITS = 1000;

export interface MapPoint {
  x: number;
  y: number;
}

export type LaneKey = "top" | "mid" | "bot";
export type TeamSide = "blue" | "red";

/** Stroke widths of the drawn lanes, in map units. */
export const LANE_STROKE_UNITS = 58;
export const LANE_INNER_STROKE_UNITS = 50;
export const LANE_HALF_WIDTH_UNITS = LANE_STROKE_UNITS / 2;
export const RIVER_STROKE_UNITS = 88;
export const PIT_RADIUS_UNITS = 46;

function line(...pairs: Array<[number, number]>): MapPoint[] {
  return pairs.map(([x, y]) => ({ x, y }));
}

/** One polyline per lane, running from the blue base to the red base. */
export const LANES: Record<LaneKey, readonly MapPoint[]> = {
  top: line(
    [115, 860], [90, 700], [100, 553], [72, 284], [90, 150],
    [130, 95], [275, 72], [533, 82], [702, 94], [845, 125],
  ),
  mid: line(
    [140, 860], [262, 741], [347, 670], [402, 576], [500, 500],
    [596, 441], [657, 332], [740, 262], [860, 140],
  ),
  bot: line(
    [160, 885], [299, 913], [472, 896], [721, 923], [900, 890],
    [930, 706], [902, 449], [912, 312], [890, 160],
  ),
};

export const LANE_KEYS: readonly LaneKey[] = ["top", "mid", "bot"];

/** The river runs corner to corner, between the two pits. */
export const RIVER: readonly MapPoint[] = line([70, 70], [330, 298], [500, 500], [674, 703], [930, 930]);

function pit(id: string): MapPoint {
  const found = NEUTRAL_OBJECTIVES_LAYOUT.find((objective) => objective.id === id);
  if (!found) throw new Error(`Missing neutral objective layout: ${id}`);
  return { x: found.x * MAP_UNITS, y: found.y * MAP_UNITS };
}

/** Top pit (grubs, herald, Baron) and dragon pit, taken from the engine layout. */
export const PITS = {
  top: pit("baron-pit"),
  dragon: pit("dragon-pit"),
} as const;

export interface CampPoint extends MapPoint {
  id: string;
  side: JungleCampPoint["side"];
  icon: JungleCampPoint["icon"];
}

export const CAMP_POINTS: readonly CampPoint[] = JUNGLE_CAMPS_LAYOUT.map((camp) => ({
  id: camp.id,
  side: camp.side,
  icon: camp.icon,
  x: camp.x * MAP_UNITS,
  y: camp.y * MAP_UNITS,
}));

// ── Bases ───────────────────────────────────────────────────────────────

export interface BaseZone {
  /** SVG path in map units. */
  path: string;
  /** The same outline flattened to a polygon, for hit tests. */
  polygon: readonly MapPoint[];
}

function sampleQuad(from: MapPoint, ctrl: MapPoint, to: MapPoint, steps = 16): MapPoint[] {
  const out: MapPoint[] = [];
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const u = 1 - t;
    out.push({
      x: u * u * from.x + 2 * u * t * ctrl.x + t * t * to.x,
      y: u * u * from.y + 2 * u * t * ctrl.y + t * t * to.y,
    });
  }
  return out;
}

function buildBase(mirror: boolean): BaseZone {
  const m = (p: MapPoint): MapPoint => (mirror ? { x: MAP_UNITS - p.x, y: MAP_UNITS - p.y } : p);
  const corner = m({ x: 0, y: 1000 });
  const wallTop = m({ x: 0, y: 690 });
  const mid = m({ x: 250, y: 790 });
  const floor = m({ x: 335, y: 1000 });
  const c1 = m({ x: 150, y: 710 });
  const c2 = m({ x: 335, y: 870 });
  const path =
    `M${corner.x} ${corner.y}V${wallTop.y}` +
    `Q${c1.x} ${c1.y} ${mid.x} ${mid.y}` +
    `Q${c2.x} ${c2.y} ${floor.x} ${floor.y}Z`;
  return {
    path,
    polygon: [corner, wallTop, ...sampleQuad(wallTop, c1, mid), ...sampleQuad(mid, c2, floor)],
  };
}

export const BASE_ZONES: Record<TeamSide, BaseZone> = {
  blue: buildBase(false),
  red: buildBase(true),
};

// ── Projection ──────────────────────────────────────────────────────────

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Engine position (0..1) to pixels of a square map `sizePx` wide. */
export function toPx(pos: MapPoint, sizePx: number): MapPoint {
  return { x: round2(pos.x * sizePx), y: round2(pos.y * sizePx) };
}

/** Pixels back to the engine position. A map with no size maps to the origin. */
export function fromPx(px: MapPoint, sizePx: number): MapPoint {
  if (sizePx <= 0) return { x: 0, y: 0 };
  return { x: px.x / sizePx, y: px.y / sizePx };
}

/** Engine position (0..1) to the 1000 unit space of the SVG overlays. */
export function toUnits(pos: MapPoint): MapPoint {
  return { x: pos.x * MAP_UNITS, y: pos.y * MAP_UNITS };
}

/**
 * Transform for a zero size anchor that carries a marker. The visible marker is
 * a centred child, so the anchor itself moves by `transform` and never by
 * `left` or `top`.
 */
export function anchorTransform(pos: MapPoint, sizePx: number): string {
  const { x, y } = toPx(pos, sizePx);
  return `translate(${x}px, ${y}px)`;
}

// ── Champion bubble ─────────────────────────────────────────────────────

/** The bubble is this share of the map, never below 24 px (WCAG 2.5.8 target size) or above 38 px. */
export const BUBBLE_MAP_FRACTION = 0.048;
export const BUBBLE_MIN_PX = 24;
export const BUBBLE_MAX_PX = 38;

/** Side of a champion bubble in pixels for a map `sizePx` wide. One answer for the CSS box and the link maths. */
export function bubbleDiameterPx(sizePx: number): number {
  return Math.min(BUBBLE_MAX_PX, Math.max(BUBBLE_MIN_PX, sizePx * BUBBLE_MAP_FRACTION));
}

// ── Structure markers ───────────────────────────────────────────────────

/** Share of the map and the floor and ceiling in pixels of each kind of structure marker. */
const STRUCTURE_PX: Record<StructureKind, { fraction: number; min: number; max: number }> = {
  tower: { fraction: 0.023, min: 11, max: 22 },
  inhib: { fraction: 0.032, min: 15, max: 30 },
  nexus: { fraction: 0.052, min: 24, max: 48 },
};

/** Side of a structure marker in pixels for a map `sizePx` wide. */
export function structureDiameterPx(kind: StructureKind, sizePx: number): number {
  const { fraction, min, max } = STRUCTURE_PX[kind];
  return Math.min(max, Math.max(min, sizePx * fraction));
}

// ── Hit tests ───────────────────────────────────────────────────────────

function distanceToSegment(p: MapPoint, a: MapPoint, b: MapPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Shortest distance from a point to a polyline, in the units of the inputs. */
export function distanceToPolyline(p: MapPoint, polyline: readonly MapPoint[]): number {
  if (polyline.length === 0) return Number.POSITIVE_INFINITY;
  if (polyline.length === 1) return Math.hypot(p.x - polyline[0].x, p.y - polyline[0].y);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < polyline.length; i += 1) {
    best = Math.min(best, distanceToSegment(p, polyline[i - 1], polyline[i]));
  }
  return best;
}

export function pointInPolygon(p: MapPoint, polygon: readonly MapPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** True when a map-unit point lies inside the stroke of the lane. */
export function isOnLane(p: MapPoint, lane: LaneKey): boolean {
  return distanceToPolyline(p, LANES[lane]) <= LANE_HALF_WIDTH_UNITS;
}

export function isInBase(p: MapPoint, side: TeamSide): boolean {
  return pointInPolygon(p, BASE_ZONES[side].polygon);
}

// ── Marker shapes ───────────────────────────────────────────────────────

export type MarkerShape = "circle" | "rounded-square" | "diamond";
export type StructureKind = "tower" | "inhib" | "nexus";

/** Champions and minions: the team is carried by shape as well as colour. */
export const TEAM_MARKER_SHAPE: Record<TeamSide, MarkerShape> = {
  blue: "circle",
  red: "rounded-square",
};

export interface StructureShape {
  shape: MarkerShape;
  /** Side of the marker in map units. */
  sizeUnits: number;
}

/** Structures: blue is round, red is a diamond; the kind sets the size. */
export const STRUCTURE_SHAPE: Record<StructureKind, Record<TeamSide, StructureShape>> = {
  tower: { blue: { shape: "circle", sizeUnits: 26 }, red: { shape: "diamond", sizeUnits: 26 } },
  inhib: { blue: { shape: "circle", sizeUnits: 34 }, red: { shape: "diamond", sizeUnits: 34 } },
  nexus: { blue: { shape: "circle", sizeUnits: 52 }, red: { shape: "diamond", sizeUnits: 52 } },
};
