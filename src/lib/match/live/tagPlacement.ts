import type { MapPoint } from "@/lib/match/live/mapGeometry";

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
 */

/** The map is laid out at this size; smaller maps switch to the compact form in CSS. */
export const NOMINAL_MAP_PX = 520;

const U = (px: number) => px / NOMINAL_MAP_PX;
const BUBBLE_HALF = U(12.5);
const BUBBLE_PAD = U(5);
/** Gap between the bubble centre and the near edge of a tag. */
const BELOW_OFFSET = U(23.5);
const ABOVE_OFFSET = U(20.5);
const SIDE_OFFSET = U(20.5);
/** How far a start or end anchored tag reaches past the bubble centre. */
const EDGE_ANCHOR = U(18.5);
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

function tagSize(nameChars: number, subChars: number): { w: number; h: number } {
  return { w: U(Math.max(nameChars * 6.6, subChars * 6) + 12), h: U(18 + (subChars > 0 ? 13 : 0)) };
}

function intersects(a: TagBox, b: TagBox): boolean {
  return !(a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0);
}

function insideMap(box: TagBox): boolean {
  return (
    box.x0 >= MAP_MARGIN && box.x1 <= 1 - MAP_MARGIN && box.y0 >= MAP_MARGIN && box.y1 <= 1 - MAP_MARGIN
  );
}

function bubbleBox(pos: MapPoint): TagBox {
  const reach = BUBBLE_HALF + BUBBLE_PAD;
  return { x0: pos.x - reach, y0: pos.y - reach, x1: pos.x + reach, y1: pos.y + reach };
}

function candidateBox(
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
      x0 = pos.x - EDGE_ANCHOR;
      x1 = x0 + size.w;
    };
    const toEnd = () => {
      align = "end";
      x1 = pos.x + EDGE_ANCHOR;
      x0 = x1 - size.w;
    };
    if (candidate.force === "start") toStart();
    else if (candidate.force === "end") toEnd();
    else if (x0 < EDGE_TRIGGER) toStart();
    else if (x1 > 1 - EDGE_TRIGGER) toEnd();
    const y0 = candidate.slot === "below" ? pos.y + BELOW_OFFSET : pos.y - ABOVE_OFFSET - size.h;
    return { align, box: { x0, y0, x1, y1: y0 + size.h } };
  }
  const y0 = pos.y - size.h / 2;
  const y1 = pos.y + size.h / 2;
  return candidate.slot === "right"
    ? { align: "center", box: { x0: pos.x + SIDE_OFFSET, y0, x1: pos.x + SIDE_OFFSET + size.w, y1 } }
    : { align: "center", box: { x0: pos.x - SIDE_OFFSET - size.w, y0, x1: pos.x - SIDE_OFFSET, y1 } };
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

/**
 * Place every tag. `prev` is the result of the last solve: a tag keeps its slot
 * and form while that spot is still free of clashes.
 */
export function placeTags(champions: readonly TagChampion[], prev?: Readonly<TagPlacements>): TagPlacements {
  const bubbles = champions.map((champion) => ({ id: champion.id, box: bubbleBox(champion.pos) }));
  const placed: TagBox[] = [];
  const result: TagPlacements = {};

  // Champions with a state line choose first so their timers keep a slot.
  const order = [...champions].sort(
    (p, q) =>
      Number(hasState(q)) - Number(hasState(p)) || p.pos.y - q.pos.y || (p.id < q.id ? -1 : p.id > q.id ? 1 : 0),
  );

  for (const champion of order) {
    const obstacles = bubbles.filter((bubble) => bubble.id !== champion.id).map((bubble) => bubble.box);
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
        const spot = candidateBox(champion.pos, { slot: before.slot, force }, tagSize(form.nameChars, form.subChars));
        if (!clashes(spot.box)) choice = { form: form.form, slot: before.slot, align: spot.align, box: spot.box };
      }
    }

    for (const form of forms) {
      if (choice) break;
      const size = tagSize(form.nameChars, form.subChars);
      for (const candidate of CANDIDATES) {
        const spot = candidateBox(champion.pos, candidate, size);
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
