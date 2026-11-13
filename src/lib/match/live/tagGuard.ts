import type { MapPoint } from "@/lib/match/live/mapGeometry";
import { compareTagPriority, type TagBox, type TagChampion, type TagPlacements } from "@/lib/match/live/tagPlacement";

/**
 * The visibility guard of the name tags. The solver keeps tags apart for the stretch a marker is
 * expected to walk until the next solve, but a champion may turn between solves, so a placed tag
 * can still end up on another tag or on a label. The guard looks at where every marker is drawn
 * on each frame and hides, never moves, the tag that loses: the lower priority one of a pair that
 * touches, and any tag that touches an obstacle. It never shows a tag the solver did not place:
 * it only receives the tags that were placed.
 *
 * It is a plain function over numbers, with no DOM and no allocation, so it can run on every
 * frame. A hidden tag comes back only after it has been clear for `GUARD_HOLD_MS` of frame time,
 * so a pair that grazes each other does not blink.
 */

/** How long a hidden tag has to stay clear before it is shown again. */
export const GUARD_HOLD_MS = 150;
/** Clear space the guard asks for between a tag and what it must not touch, in pixels. Smaller than the solver's own gap. */
export const GUARD_GAP_PX = 1;

/** A tag the solver placed: its box relative to the marker it hangs from, in map units. */
export interface GuardTag {
  id: string;
  /** Where the marker was drawn when the tag was placed: the box was solved from here. */
  from: MapPoint;
  offset: TagBox;
}

/**
 * The tags the solver placed, highest priority first (the order the solver chose in), each with
 * its box relative to the marker. A champion with a badge or nothing has no tag to guard.
 */
export function guardTagsFor(champions: readonly TagChampion[], placements: Readonly<TagPlacements>): GuardTag[] {
  const tags: GuardTag[] = [];
  for (const champion of [...champions].sort(compareTagPriority)) {
    const placement = placements[champion.id];
    if (!placement || !("box" in placement)) continue;
    const { box } = placement;
    tags.push({
      id: champion.id,
      from: champion.pos,
      offset: {
        x0: box.x0 - champion.pos.x,
        y0: box.y0 - champion.pos.y,
        x1: box.x1 - champion.pos.x,
        y1: box.y1 - champion.pos.y,
      },
    });
  }
  return tags;
}

/** What the guard remembers between frames, one entry per tag, in the order of the tags. */
export interface GuardState {
  /** Whether the tag is shown right now. */
  shown: boolean[];
  /** Frame time since which a hidden tag has been clear; -1 while it is blocked, or shown. */
  clearSince: number[];
}

const NOT_CLEAR = -1;

/**
 * The memory for a new list of tags. A tag that was already there keeps what it had, so a new
 * solve does not make every tag blink; a new one starts shown.
 */
export function createGuardState(ids: readonly string[], previous?: { ids: readonly string[]; state: GuardState }): GuardState {
  const before = new Map(previous?.ids.map((id, index) => [id, index]));
  return {
    shown: ids.map((id) => {
      const index = before.get(id);
      return index === undefined || previous === undefined ? true : previous.state.shown[index];
    }),
    clearSince: ids.map((id) => {
      const index = before.get(id);
      return index === undefined || previous === undefined ? NOT_CLEAR : previous.state.clearSince[index];
    }),
  };
}

export interface GuardFrame {
  /** Highest priority first. */
  tags: readonly GuardTag[];
  /** Where each marker is drawn, `[x0, y0, x1, y1, ...]` in the order of `tags`, in map units. */
  anchors: ArrayLike<number>;
  /** Boxes no tag may touch, in map units. */
  obstacles: readonly TagBox[];
  /** Clear space to keep, in map units. */
  gap: number;
  /** Frame time in milliseconds. */
  nowMs: number;
}

/**
 * Decides which tags are shown on this frame, updating `state` in place. Tags are taken in
 * priority order and each looks only at the tags above it, as already decided for this frame, so
 * the result never has two shown tags on each other, and the one that loses is always the lower.
 * Returns whether any tag changed between shown and hidden.
 */
export function stepTagGuard({ tags, anchors, obstacles, gap, nowMs }: GuardFrame, state: GuardState): boolean {
  let changed = false;
  for (let i = 0; i < tags.length; i += 1) {
    const offset = tags[i].offset;
    const x0 = anchors[2 * i] + offset.x0;
    const y0 = anchors[2 * i + 1] + offset.y0;
    const x1 = anchors[2 * i] + offset.x1;
    const y1 = anchors[2 * i + 1] + offset.y1;

    let blocked = false;
    for (let k = 0; k < obstacles.length && !blocked; k += 1) {
      const o = obstacles[k];
      blocked = x0 < o.x1 + gap && o.x0 < x1 + gap && y0 < o.y1 + gap && o.y0 < y1 + gap;
    }
    for (let j = 0; j < i && !blocked; j += 1) {
      if (!state.shown[j]) continue;
      const other = tags[j].offset;
      const ox0 = anchors[2 * j] + other.x0;
      const oy0 = anchors[2 * j + 1] + other.y0;
      const ox1 = anchors[2 * j] + other.x1;
      const oy1 = anchors[2 * j + 1] + other.y1;
      blocked = x0 < ox1 + gap && ox0 < x1 + gap && y0 < oy1 + gap && oy0 < y1 + gap;
    }

    if (blocked) {
      state.clearSince[i] = NOT_CLEAR;
      if (state.shown[i]) {
        state.shown[i] = false;
        changed = true;
      }
    } else if (!state.shown[i]) {
      if (state.clearSince[i] === NOT_CLEAR) state.clearSince[i] = nowMs;
      if (nowMs - state.clearSince[i] >= GUARD_HOLD_MS) {
        state.shown[i] = true;
        state.clearSince[i] = NOT_CLEAR;
        changed = true;
      }
    }
  }
  return changed;
}
