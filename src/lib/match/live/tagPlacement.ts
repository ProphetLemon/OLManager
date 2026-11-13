import { bubbleDiameterPx, structureDiameterPx, type MapPoint } from "@/lib/match/live/mapGeometry";

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
 * of it. Boxes that other things occupy (the labels of the objective pits, the ring and the beam
 * of a firing tower) are passed as `obstacles`, in map units; a tag never sits on one.
 *
 * The width of a tag depends on the font, which a character count cannot know (an "M" is a third
 * wider than an "e"). The caller therefore measures the rendered box of each form once per commit
 * and passes it as `sizes`; the character count is only the fallback for a form with no
 * measurement. Placed tags also keep `TAG_GAP_PX` apart, so a pixel of rounding never makes two touch.
 *
 * Markers keep moving after a solve, and a tag moves with its marker, so a champion may carry a
 * `to`: where it will be at the next solve. Two tags, or a tag and a bubble, then clash when the
 * boxes touch at any moment of that stretch (only their relative motion counts), and a tag clashes
 * with whatever stands still when its whole sweep touches it. The solve is exact for markers that
 * walk straight, which is all the next solve is told about.
 */

/** The map size the solver assumes when it is not told one; smaller maps switch to the compact form in CSS. */
export const NOMINAL_MAP_PX = 520;

/** Clear space the solver keeps between two placed tags, in pixels. */
export const TAG_GAP_PX = 3;
/** Pixels per character of a name and of a state line when a form has no measured size: the widest letters of the face, not the average. */
const NAME_CHAR_PX = 7.6;
const SUB_CHAR_PX = 6;

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
  /** Where the marker is drawn when the solve is made, 0..1. */
  pos: MapPoint;
  /**
   * Where the marker will be drawn by the time of the next solve, when it moves. The marker, and
   * the tag that is its child, travel in a straight line from `pos` to `to` in between, so the
   * solver keeps the whole stretch clear and not only the spot it starts from. Left out, the
   * champion stands still.
   */
  to?: MapPoint;
  /** Name shown in the full form. */
  name: string;
  /** State line of the full form ("Recall 3.9s", "Dead 12s", "Fighting"); empty when the champion has no state. */
  sub?: string;
  /** Shorter state text of the compact form. Defaults to `sub`. */
  subCompact?: string;
  /** Rendered size of the tag in each form, in pixels, as measured in the page. A form left out is estimated from its text. */
  sizes?: TagFormSizes;
}

/** Width and height of one rendered tag, border and padding included. */
export interface TagPxSize {
  w: number;
  h: number;
}

export type TagFormSizes = Partial<Record<"full" | "compact", TagPxSize>>;

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

/** Size of a tag in map units: what was measured for the form, else an estimate from its characters. */
function tagSize(m: Metrics, form: Form): { w: number; h: number } {
  if (form.measured && form.measured.w > 0 && form.measured.h > 0) {
    return { w: m.u(form.measured.w), h: m.u(form.measured.h) };
  }
  return {
    w: m.u(Math.max(form.nameChars * NAME_CHAR_PX, form.subChars * SUB_CHAR_PX) + 12),
    h: m.u(18 + (form.subChars > 0 ? 13 : 0)),
  };
}

function inflate(box: TagBox, by: number): TagBox {
  return { x0: box.x0 - by, y0: box.y0 - by, x1: box.x1 + by, y1: box.y1 + by };
}

function insideMap(box: TagBox): boolean {
  return (
    box.x0 >= MAP_MARGIN && box.x1 <= 1 - MAP_MARGIN && box.y0 >= MAP_MARGIN && box.y1 <= 1 - MAP_MARGIN
  );
}

interface Travel {
  dx: number;
  dy: number;
}

const STILL: Travel = { dx: 0, dy: 0 };

const travelOf = (champion: TagChampion): Travel =>
  champion.to ? { dx: champion.to.x - champion.pos.x, dy: champion.to.y - champion.pos.y } : STILL;

const shifted = (box: TagBox, travel: Travel, t: number): TagBox => ({
  x0: box.x0 + travel.dx * t,
  y0: box.y0 + travel.dy * t,
  x1: box.x1 + travel.dx * t,
  y1: box.y1 + travel.dy * t,
});

/** The span of t in [0, 1] in which one axis of a box, moving at `speed`, touches a still interval; null when it never does. */
function axisSpan(a0: number, a1: number, b0: number, b1: number, speed: number): [number, number] | null {
  if (speed === 0) return a1 >= b0 && a0 <= b1 ? [0, 1] : null;
  const first = (b0 - a1) / speed;
  const last = (b1 - a0) / speed;
  const lo = Math.max(0, Math.min(first, last));
  const hi = Math.min(1, Math.max(first, last));
  return lo <= hi ? [lo, hi] : null;
}

/**
 * Whether two boxes that each travel in a straight line over t in [0, 1] touch at any moment of
 * it. Only the relative motion matters, so two markers walking the same way never clash, and two
 * walking into each other do, wherever along the way they meet.
 */
function sweptTouch(a: TagBox, travelA: Travel, b: TagBox, travelB: Travel): boolean {
  const x = axisSpan(a.x0, a.x1, b.x0, b.x1, travelA.dx - travelB.dx);
  const y = axisSpan(a.y0, a.y1, b.y0, b.y1, travelA.dy - travelB.dy);
  return Boolean(x && y && Math.max(x[0], y[0]) <= Math.min(x[1], y[1]));
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
  measured?: TagPxSize;
}

function formsOf(champion: TagChampion): Form[] {
  const sub = champion.sub ?? "";
  const subCompact = champion.subCompact ?? sub;
  return [
    { form: "full", nameChars: champion.name.length, subChars: sub.length, measured: champion.sizes?.full },
    {
      form: "compact",
      nameChars: Math.min(COMPACT_NAME_CHARS, champion.name.length),
      subChars: subCompact.length,
      measured: champion.sizes?.compact,
    },
  ];
}

const hasState = (champion: TagChampion) => (champion.sub ?? "").length > 0;

export interface PlaceTagsOptions {
  /** Side of the map in pixels; the nominal size when left out. */
  sizePx?: number;
  /** Boxes (map units) no tag may touch, such as the label of an objective pit. */
  obstacles?: readonly TagBox[];
}

/** Pixels of the label of a nexus (see `.arena-struct-under`): the marker, then a health bar when damaged, then the word. */
const NEXUS_LABEL_HALF_WIDTH_PX = 28;
const NEXUS_LABEL_UNDER_PX = 3 + 7 + 20;

/** The box of a nexus and the name under it, for the tags to keep clear of. */
export function nexusLabelObstacle(pos: MapPoint, sizePx = NOMINAL_MAP_PX): TagBox {
  const u = (px: number) => px / sizePx;
  const radius = structureDiameterPx("nexus", sizePx) / 2;
  const half = u(Math.max(radius, NEXUS_LABEL_HALF_WIDTH_PX));
  return { x0: pos.x - half, y0: pos.y - u(radius), x1: pos.x + half, y1: pos.y + u(radius + NEXUS_LABEL_UNDER_PX) };
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
  const gap = m.u(TAG_GAP_PX);
  const travels = new Map(champions.map((champion) => [champion.id, travelOf(champion)]));
  const bubbles = champions.map((champion) => ({ id: champion.id, box: bubbleBox(m, champion.pos), travel: travelOf(champion) }));
  const placed: Array<{ box: TagBox; travel: Travel }> = [];
  const result: TagPlacements = {};

  // Champions with a state line choose first so their timers keep a slot.
  const order = [...champions].sort(
    (p, q) =>
      Number(hasState(q)) - Number(hasState(p)) || p.pos.y - q.pos.y || (p.id < q.id ? -1 : p.id > q.id ? 1 : 0),
  );

  for (const champion of order) {
    const travel = travels.get(champion.id) ?? STILL;
    const others = bubbles.filter((bubble) => bubble.id !== champion.id);
    // A tag moves with its champion. It must stay on the map, off the objects that stand still, and
    // off every bubble and tag at every moment of the way to the next solve.
    const clashes = (box: TagBox) =>
      !insideMap(box) ||
      !insideMap(shifted(box, travel, 1)) ||
      fixed.some((other) => sweptTouch(box, travel, other, STILL)) ||
      others.some((other) => sweptTouch(box, travel, other.box, other.travel)) ||
      placed.some((other) => sweptTouch(box, travel, inflate(other.box, gap), other.travel));
    const forms = formsOf(champion);
    let choice: TagPlacement | null = null;

    // Stickiness: the previous slot and form, when it still fits.
    const before = prev?.[champion.id];
    if (before && (before.form === "full" || before.form === "compact")) {
      const form = forms.find((candidate) => candidate.form === before.form);
      if (form) {
        const force = before.align === "center" ? undefined : before.align;
        const spot = candidateBox(m, champion.pos, { slot: before.slot, force }, tagSize(m, form));
        if (!clashes(spot.box)) choice = { form: form.form, slot: before.slot, align: spot.align, box: spot.box };
      }
    }

    for (const form of forms) {
      if (choice) break;
      const size = tagSize(m, form);
      for (const candidate of CANDIDATES) {
        const spot = candidateBox(m, champion.pos, candidate, size);
        if (clashes(spot.box)) continue;
        choice = { form: form.form, slot: candidate.slot, align: spot.align, box: spot.box };
        break;
      }
    }

    if (choice && "box" in choice) placed.push({ box: choice.box, travel });
    result[champion.id] = choice ?? (hasState(champion) ? { form: "badge" } : { form: "none" });
  }
  return result;
}
