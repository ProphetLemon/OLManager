import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { markerState } from "@/lib/match/live/championMarker";
import type { ContactResult, TowerBeam } from "@/lib/match/live/contacts";
import { fireObstacles } from "@/lib/match/live/fireObstacles";
import { MAP_UNITS } from "@/lib/match/live/mapGeometry";
import { pitViews } from "@/lib/match/live/objectivesView";
import { guardTagsFor } from "@/lib/match/live/tagGuard";
import { nexusLabelObstacle, pitObstacle, placeTags, type TagPlacements } from "@/lib/match/live/tagPlacement";
import type { LolSimV1RuntimeState } from "@/ui-v2/_legacy/components/match/lol-prototype/backend/contract-v1";
import type { ChampionState } from "@/ui-v2/_legacy/components/match/lol-prototype/engine/types";

import { useArenaBus, useMapSize } from "./arenaMapContext";
import { ChampionMarker } from "./ChampionMarker";
import { useElementRegistry } from "./layerDom";
import { NO_TAG_SIZES, readTagSizes, sameTagSizes, type TagSizesById } from "./tagSizes";
import { projectTravel } from "./tagMotion";
import { TagContent } from "./TagContent";
import { COMMIT_INTERVAL_MS } from "./useLiveSession";
import { useMarkerTexts } from "./useMarkerTexts";
import { useTagGuard } from "./useTagGuard";

export interface ChampionLayerProps {
  /** The state of the last engine answer, not the interpolated one. */
  state: LolSimV1RuntimeState;
  /** Champion picked by each player, for the tiles. */
  championByPlayerId: Record<string, string>;
  contacts: Pick<ContactResult, "fightingIds">;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Towers that are shooting: their ring, beam and chip are drawn above the tags, so the tags keep clear of them. */
  beams?: readonly TowerBeam[];
}

const NO_BEAMS: readonly TowerBeam[] = [];

/** One animation frame on top of the commit interval: the longest a marker goes without a new solve. */
const SOLVE_WINDOW_SEC = COMMIT_INTERVAL_MS / 1000 + 1 / 60;

/**
 * All ten markers. On every committed answer it works out each champion's state, measures the
 * real size of every tag, solves the tag placement once for the whole map (keeping the slots that
 * still fit, so tags do not flicker) and hands each marker its result. Between answers the markers
 * move on their own, so the solve is given the stretch each one will cover until the next solve:
 * it starts at the position the marker is drawn at (the last frame, not the engine's answer) and
 * ends where its walk leads, and a tag is only placed where it stays clear along all of it.
 *
 * Between solves a champion may turn, so a tag can still end up on another tag or on a label. A
 * guard (`useTagGuard`) looks at the drawn positions on every frame and hides, never moves, the
 * tag that loses, through `opacity` alone.
 *
 * The size of a tag comes from probes: for each champion, one hidden box per form, built from the
 * same markup and styled by the same rules as the tag, so the font, the padding and the width of
 * the map all count. They are read in a layout effect after the commit, and a change of size
 * renders once more before the screen is painted.
 */
export function ChampionLayer({ state, championByPlayerId, contacts, selectedId, onSelect, beams = NO_BEAMS }: ChampionLayerProps) {
  const textsFor = useMarkerTexts();
  const previous = useRef<TagPlacements | undefined>(undefined);
  const sizePx = useMapSize();
  const bus = useArenaBus();
  const nowSec = state.timeSec;
  // Where the markers are drawn: the last frame of the bus. Keeping the array is all a frame does here.
  const drawn = useRef<readonly ChampionState[] | null>(null);
  useEffect(
    () =>
      bus.subscribe((frame) => {
        drawn.current = frame.state.champions;
      }),
    [bus],
  );
  // The commit before this one, to tell how fast each champion is walking. Kept as state derived
  // from `state`, so every pass over the same commit sees the same one.
  const [trail, setTrail] = useState<{ now: LolSimV1RuntimeState; before: LolSimV1RuntimeState | null }>({ now: state, before: null });
  if (trail.now !== state) setTrail({ now: state, before: trail.now });
  const { elements: tagElements, refFor: tagRefFor } = useElementRegistry();
  const probesRef = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState<TagSizesById>(NO_TAG_SIZES);

  useLayoutEffect(() => {
    const root = probesRef.current;
    if (!root) return;
    const measured = readTagSizes(root);
    setSizes((current) => (sameTagSizes(current, measured) ? current : measured));
  });

  const rows = useMemo(() => {
    const fighting = new Set(contacts.fightingIds);
    return state.champions.map((champion) => {
      const marker = markerState(champion, fighting.has(champion.id), nowSec);
      return { champion, marker, texts: textsFor(marker), fighting: fighting.has(champion.id) };
    });
  }, [state.champions, contacts.fightingIds, nowSec, textsFor]);

  // Tags keep clear of the labels of the objective pits and of the name under each nexus, which
  // stand still, and of the ring, the beam and the chip of a tower that is shooting: those are
  // drawn above them and would hide them.
  const fixedObstacles = useMemo(
    () => [
      ...pitViews(state).map((pit) =>
        pitObstacle(
          { x: pit.pos.x / MAP_UNITS, y: pit.pos.y / MAP_UNITS },
          Number(Boolean(pit.soul)) + Number(Boolean(pit.heraldCarrier)),
          sizePx || undefined,
        ),
      ),
      ...state.structures.filter((structure) => structure.kind === "nexus").map((nexus) => nexusLabelObstacle(nexus.pos, sizePx || undefined)),
    ],
    [state, sizePx],
  );
  const obstacles = useMemo(
    () => [...fixedObstacles, ...fireObstacles(beams, state.structures, state.champions, sizePx)],
    [fixedObstacles, beams, state.structures, state.champions, sizePx],
  );

  const solved = useMemo(() => {
    const before = new Map((trail.before?.champions ?? []).map((champion) => [champion.id, champion]));
    const onScreen = new Map((drawn.current ?? []).map((champion) => [champion.id, champion.pos]));
    const elapsedGameSec = trail.before ? state.timeSec - trail.before.timeSec : 0;
    const aheadGameSec = SOLVE_WINDOW_SEC * (Number.isFinite(state.speed) && state.speed > 0 ? state.speed : 0);
    const champions = rows.map(({ champion, texts }) => {
      const { from, to } = projectTravel({
        before: before.get(champion.id),
        after: champion,
        elapsedGameSec,
        aheadGameSec,
        rendered: onScreen.get(champion.id),
      });
      return {
        id: champion.id,
        pos: from,
        to,
        name: champion.name,
        sub: texts.sub,
        subCompact: texts.subCompact,
        sizes: sizes[champion.id],
      };
    });
    const result = placeTags(champions, previous.current, { sizePx: sizePx || undefined, obstacles });
    return { placements: result, guardTags: guardTagsFor(champions, result) };
  }, [rows, sizePx, obstacles, sizes, trail, state.timeSec, state.speed]);
  const { placements, guardTags } = solved;

  const guard = useMemo(
    () => ({ tags: guardTags, fixed: fixedObstacles, beams, structures: state.structures, elements: tagElements }),
    [guardTags, fixedObstacles, beams, state.structures, tagElements],
  );
  useTagGuard(guard);

  // Remembered after the commit, so that rendering stays free of side effects.
  useEffect(() => {
    previous.current = placements;
  }, [placements]);

  return (
    <>
      <div ref={probesRef} className="arena-tag-probes" aria-hidden="true">
        {rows.map(({ champion, texts }) =>
          (["full", "compact"] as const).map((form) => (
            <div key={`${champion.id}:${form}`} className="arena-tag arena-tag-probe" data-probe={champion.id} data-form={form}>
              <TagContent name={champion.name} texts={texts} probe />
            </div>
          )),
        )}
      </div>
      {rows.map(({ champion, marker, texts, fighting }) => (
        <ChampionMarker
          key={champion.id}
          champion={champion}
          championKey={championByPlayerId[champion.id]}
          nowSec={nowSec}
          state={marker}
          texts={texts}
          tag={placements[champion.id]}
          tagRef={tagRefFor(champion.id)}
          fighting={fighting}
          selected={selectedId === champion.id}
          dimmed={selectedId !== null && selectedId !== champion.id}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}
