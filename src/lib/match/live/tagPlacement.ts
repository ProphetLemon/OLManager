import { bubbleDiameterPx, type MapPoint } from "@/lib/match/live/mapGeometry";

/**
 * Where each champion's name tag goes, so tags do not sit on bubbles or on each
 * other. Greedy over eight slots, full form first, then a compact form. Pure and
 * cheap, and meant to run once per committed engine answer, not per frame: the
 * tag is a child of its marker, so between solves it follows the marker.
 *
 * Two promises the screen relies on:
 * - A champion with a state line (recall, dead, fighting, objective) is never
 *   left without it. When no slot is free the result is a `badge`, a short text
 *   on the bubble or its ring, not an empty result.
 * - A tag does not jump between slots while its slot stays clash-free.
 *
 * Nothing here returns text. The caller supplies the texts it will show (only
 * their length matters here) and renders the badge from the state itself.
 *
 * Tags and bubbles have a size in pixels, not in map units, so the solver is told the side of
 * the map it works for (`sizePx`) and converts: on a small map the same tag takes a bigger share
 * of it. Boxes that other things occupy (the labels of the objective pits) are passed as
 * `obstacles`, in map units; a tag never sits on one.
 */

/** The map size the solver assumes when it is not told one; smaller maps switch to the compact form in CSS. */
export const NOMINAL_MAP_PX = 520;

/** Pixel gaps between a bubble's edge and the near edge of its tag. They match the marker's CSS. */
const BELOW_GAP_PX = 11;
const SIDE_GAP_PX = 8;
/** How far a start or end anchored tag reaches past the bubble's edge. */
const EDGE_REACH_PX = 6;
const BUBBLE_PAD_PX = 5;

/** Everything the solver measures in pixels, converted to map units for one map size. */
interface Metrics {
  u: (px: number) => number;
  bubbleReach: number;
  below: number;
  above: number;
  side: number;
  edgeAnchor: number;
}

function metricsFor(sizePx: number): Metrics {
  const u = (px: number) => px / sizePx;
  const radius = bubbleDiameterPx(sizePx) / 2;
  return {
    u,
    bubbleReach: u(radius + BUBBLE_PAD_PX),
    below: u(radius + BELOW_GAP_PX),
    above: u(radius + SIDE_GAP_PX),
    side: u(radius + SIDE_GAP_PX),
    edgeAnchor: u(radius + EDGE_REACH_PX),
  };
}

const MAP_MARGIN = 0.003;
const EDGE_TRIGGER = 0.005;

export interface TagChampion {
  id: string;
  /** Engine position, 0..1. */
  pos: MapPoint;
  /** Name shown in the full form. */
  name: string;
  /** State line of the full form ("Recall 3.9s", "Dead 12s", "Fighting"); empty when the champion has no state. */
  sub?: string;
  /** Shorter state text of the compact form. Defaults to `sub`. */
  subCompact?: string;
}

export type TagSlot = "below" | "above" | "right" | "left";
/** Along the bubble: `start` puts the tag's left edge at the bubble, `end` its right edge. Only below and above use it. */
export type TagAlign = "center" | "start" | "end";

/** Box in map units (0..1). */
export interface TagBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type TagPlacement =
  | { form: "full" | "compact"; slot: TagSlot; align: TagAlign; box: TagBox }
  /** A state tag with no free slot: show its short text on the bubble or the ring. */
  | { form: "badge" }
  /** A champion with no state and no free slot. */
  | { form: "none" };

export type TagPlacements = Record<string, TagPlacement>;

interface Candidate {
  slot: TagSlot;
  force?: "start" | "end";
}

/** Tried in this order: below, above, right, left, then the edge anchored variants. */
const CANDIDATES: readonly Candidate[] = [
  { slot: "below" },
  { slot: "above" },
  { slot: "right" },
  { slot: "left" },
  { slot: "below", force: "start" },
  { slot: "below", force: "end" },
  { slot: "above", force: "start" },
  { slot: "above", force: "end" },
];

const COMPACT_NAME_CHARS = 3;

function tagSize(m: Metrics, nameChars: number, subChars: number): { w: number; h: number } {
  return { w: m.u(Math.max(nameChars * 6.6, subChars * 6) + 12), h: m.u(18 + (subChars > 0 ? 13 : 0)) };
}

function intersects(a: TagBox, b: TagBox): boolean {
  return !(a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0);
}

function insideMap(box: TagBox): boolean {
  return (
    box.x0 >= MAP_MARGIN && box.x1 <= 1 - MAP_MARGIN && box.y0 >= MAP_MARGIN && box.y1 <= 1 - MAP_MARGIN
  );
}

function bubbleBox(m: Metrics, pos: MapPoint): TagBox {
  const reach = m.bubbleReach;
  return { x0: pos.x - reach, y0: pos.y - reach, x1: pos.x + reach, y1: pos.y + reach };
}

function candidateBox(
  m: Metrics,
  pos: MapPoint,
  candidate: Candidate,
  size: { w: number; h: number },
): { align: TagAlign; box: TagBox } {
  if (candidate.slot === "below" || candidate.slot === "above") {
    let align: TagAlign = "center";
    let x0 = pos.x - size.w / 2;
    let x1 = pos.x + size.w / 2;
    const toStart = () => {
      align = "start";
      x0 = pos.x - m.edgeAnchor;
      x1 = x0 + size.w;
    };
    const toEnd = () => {
      align = "end";
      x1 = pos.x + m.edgeAnchor;
      x0 = x1 - size.w;
    };
    if (candidate.force === "start") toStart();
    else if (candidate.force === "end") toEnd();
    else if (x0 < EDGE_TRIGGER) toStart();
    else if (x1 > 1 - EDGE_TRIGGER) toEnd();
    const y0 = candidate.slot === "below" ? pos.y + m.below : pos.y - m.above - size.h;
    return { align, box: { x0, y0, x1, y1: y0 + size.h } };
  }
  const y0 = pos.y - size.h / 2;
  const y1 = pos.y + size.h / 2;
  return candidate.slot === "right"
    ? { align: "center", box: { x0: pos.x + m.side, y0, x1: pos.x + m.side + size.w, y1 } }
    : { align: "center", box: { x0: pos.x - m.side - size.w, y0, x1: pos.x - m.side, y1 } };
}

interface Form {
  form: "full" | "compact";
  nameChars: number;
  subChars: number;
}

function formsOf(champion: TagChampion): Form[] {
  const sub = champion.sub ?? "";
  const subCompact = champion.subCompact ?? sub;
  return [
    { form: "full", nameChars: champion.name.length, subChars: sub.length },
    { form: "compact", nameChars: Math.min(COMPACT_NAME_CHARS, champion.name.length), subChars: subCompact.length },
  ];
}

const hasState = (champion: TagChampion) => (champion.sub ?? "").length > 0;

export interface PlaceTagsOptions {
  /** Side of the map in pixels; the nominal size when left out. */
  sizePx?: number;
  /** Boxes (map units) no tag may touch, such as the label of an objective pit. */
  obstacles?: readonly TagBox[];
}

/** Pixels of the label of an objective pit, drawn under its glyph (see `.arena-pit-label`). */
const PIT_HALF_WIDTH_PX = 66;
const PIT_ABOVE_PX = 14;
const PIT_LABEL_TOP_PX = 17;
const PIT_LABEL_BASE_PX = 44;
const PIT_NOTE_LINE_PX = 14;

/**
 * The box of an objective pit, its glyph and its label, for the tags to keep clear of.
 * `noteLines` is how many extra lines the label has (the soul, the Herald's carrier).
 */
export function pitObstacle(pos: MapPoint, noteLines = 0, sizePx = NOMINAL_MAP_PX): TagBox {
  const u = (px: number) => px / sizePx;
  return {
    x0: pos.x - u(PIT_HALF_WIDTH_PX),
    y0: pos.y - u(PIT_ABOVE_PX),
    x1: pos.x + u(PIT_HALF_WIDTH_PX),
    y1: pos.y + u(PIT_LABEL_TOP_PX + PIT_LABEL_BASE_PX + noteLines * PIT_NOTE_LINE_PX),
  };
}

/**
 * Place every tag. `prev` is the result of the last solve: a tag keeps its slot
 * and form while that spot is still free of clashes.
 */
export function placeTags(
  champions: readonly TagChampion[],
  prev?: Readonly<TagPlacements>,
  options: PlaceTagsOptions = {},
): TagPlacements {
  const { sizePx = NOMINAL_MAP_PX, obstacles: fixed = [] } = options;
  const m = metricsFor(sizePx);
  const bubbles = champions.map((champion) => ({ id: champion.id, box: bubbleBox(m, champion.pos) }));
  const placed: TagBox[] = [];
  const result: TagPlacements = {};

  // Champions with a state line choose first so their timers keep a slot.
  const order = [...champions].sort(
    (p, q) =>
      Number(hasState(q)) - Number(hasState(p)) || p.pos.y - q.pos.y || (p.id < q.id ? -1 : p.id > q.id ? 1 : 0),
  );

  for (const champion of order) {
    const obstacles = [...bubbles.filter((bubble) => bubble.id !== champion.id).map((bubble) => bubble.box), ...fixed];
    const clashes = (box: TagBox) =>
      !insideMap(box) || obstacles.some((other) => intersects(box, other)) || placed.some((other) => intersects(box, other));
    const forms = formsOf(champion);
    let choice: TagPlacement | null = null;

    // Stickiness: the previous slot and form, when it still fits.
    const before = prev?.[champion.id];
    if (before && (before.form === "full" || before.form === "compact")) {
      const form = forms.find((candidate) => candidate.form === before.form);
      if (form) {
        const force = before.align === "center" ? undefined : before.align;
        const spot = candidateBox(m, champion.pos, { slot: before.slot, force }, tagSize(m, form.nameChars, form.subChars));
        if (!clashes(spot.box)) choice = { form: form.form, slot: before.slot, align: spot.align, box: spot.box };
      }
    }

    for (const form of forms) {
      if (choice) break;
      const size = tagSize(m, form.nameChars, form.subChars);
      for (const candidate of CANDIDATES) {
        const spot = candidateBox(m, champion.pos, candidate, size);
        if (clashes(spot.box)) continue;
        choice = { form: form.form, slot: candidate.slot, align: spot.align, box: spot.box };
        break;
      }
    }

    if (choice && "box" in choice) placed.push(choice.box);
    result[champion.id] = choice ?? (hasState(champion) ? { form: "badge" } : { form: "none" });
  }
  return result;
}
