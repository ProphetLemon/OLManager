import { useCallback, useEffect, useLayoutEffect, useRef, type MutableRefObject } from "react";

import { fireObstacles } from "@/lib/match/live/fireObstacles";
import type { TowerBeam } from "@/lib/match/live/contacts";
import type { MapPoint, StructureKind } from "@/lib/match/live/mapGeometry";
import { GUARD_GAP_PX, createGuardState, stepTagGuard, type GuardState, type GuardTag } from "@/lib/match/live/tagGuard";
import type { TagBox } from "@/lib/match/live/tagPlacement";

import { useArenaBus, useMapSize } from "./arenaMapContext";

export interface TagGuardInput {
  /** The tags the solver placed, highest priority first, with the box each was solved for. */
  tags: readonly GuardTag[];
  /** Boxes that stand still between two commits: the labels of the pits and of the nexus. */
  fixed: readonly TagBox[];
  /** Towers that are shooting: their beam and chip follow the target, so they are worked out on every frame. */
  beams: readonly Pick<TowerBeam, "structureId" | "targetId">[];
  structures: ReadonlyArray<{ id: string; kind: StructureKind; pos: MapPoint }>;
  /** The elements of the tags, by champion id. */
  elements: MutableRefObject<Map<string, Element>>;
}

interface Live {
  input: TagGuardInput;
  sizePx: number;
  ids: string[];
  state: GuardState;
  anchors: Float64Array;
  /** Per tag, what was last written to the page. */
  written: boolean[];
  /** The fixed boxes, then whatever the beams add on the current frame. */
  obstacles: TagBox[];
  indexById: Map<string, number>;
}

type Champions = ReadonlyArray<{ id: string; pos: MapPoint }>;

function write(live: Live, index: number) {
  const element = live.input.elements.current.get(live.ids[index]) as HTMLElement | undefined;
  if (element) element.style.opacity = live.state.shown[index] ? "" : "0";
  live.written[index] = live.state.shown[index];
}

/**
 * Keeps the name tags from sitting on each other or on a label between two solves. On every frame
 * it reads where the markers are drawn (from the frame the bus publishes, so no layout is read),
 * works out which tags the guard lets show and writes `opacity` on the ones that changed, through
 * their refs. Nothing renders per frame. The size of every tag is the one measured for the solve,
 * so a frame costs a few dozen comparisons. A short opacity transition in the stylesheet (none for
 * reduced motion) softens the switch.
 */
export function useTagGuard(input: TagGuardInput): void {
  const bus = useArenaBus();
  const sizePx = useMapSize();
  const live = useRef<Live | null>(null);
  const lastFrame = useRef<{ champions: Champions; nowMs: number } | null>(null);

  const run = useCallback(() => {
    const current = live.current;
    const frame = lastFrame.current;
    if (!current || !frame || !(current.sizePx > 0)) return;
    const { anchors, indexById, input: now } = current;
    for (const champion of frame.champions) {
      const index = indexById.get(champion.id);
      if (index === undefined) continue;
      anchors[2 * index] = champion.pos.x;
      anchors[2 * index + 1] = champion.pos.y;
    }
    // A beam ends on its target, which keeps moving: its boxes are worked out here, and only while a tower shoots.
    current.obstacles.length = now.fixed.length;
    if (now.beams.length > 0) {
      for (const box of fireObstacles(now.beams, now.structures, frame.champions, current.sizePx)) current.obstacles.push(box);
    }
    stepTagGuard(
      {
        tags: now.tags,
        anchors,
        obstacles: current.obstacles,
        gap: GUARD_GAP_PX / current.sizePx,
        nowMs: frame.nowMs,
      },
      current.state,
    );
    for (let i = 0; i < current.ids.length; i += 1) {
      if (current.written[i] !== current.state.shown[i]) write(current, i);
    }
  }, []);

  // After every commit: the new list of tags is guarded at once, before anything is painted, with
  // what the tags had before so that a new solve does not make them blink.
  useLayoutEffect(() => {
    const ids = input.tags.map((tag) => tag.id);
    const before = live.current;
    const state = createGuardState(ids, before ? { ids: before.ids, state: before.state } : undefined);
    const anchors = new Float64Array(ids.length * 2);
    input.tags.forEach((tag, index) => {
      anchors[2 * index] = tag.from.x;
      anchors[2 * index + 1] = tag.from.y;
    });
    live.current = {
      input,
      sizePx,
      ids,
      state,
      anchors,
      written: ids.map(() => true),
      obstacles: [...input.fixed],
      indexById: new Map(ids.map((id, index) => [id, index])),
    };
    // A tag element may be new: write every one, once.
    ids.forEach((_, index) => {
      write(live.current as Live, index);
    });
    // Before the first frame there is no clock to time a hold by: the solver's own placement stands.
    run();
  }, [input, sizePx, run]);

  useEffect(
    () =>
      bus.subscribe((frame) => {
        lastFrame.current = { champions: frame.state.champions, nowMs: frame.nowMs };
        run();
      }),
    [bus, run],
  );
}
