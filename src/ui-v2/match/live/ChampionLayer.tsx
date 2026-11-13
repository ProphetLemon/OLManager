import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { markerState } from "@/lib/match/live/championMarker";
import type { ContactResult } from "@/lib/match/live/contacts";
import { MAP_UNITS } from "@/lib/match/live/mapGeometry";
import { pitViews } from "@/lib/match/live/objectivesView";
import { pitObstacle, placeTags, type TagPlacements } from "@/lib/match/live/tagPlacement";
import type { LolSimV1RuntimeState } from "@/ui-v2/_legacy/components/match/lol-prototype/backend/contract-v1";

import { useMapSize } from "./arenaMapContext";
import { ChampionMarker } from "./ChampionMarker";
import { NO_TAG_SIZES, readTagSizes, sameTagSizes, type TagSizesById } from "./tagSizes";
import { TagContent } from "./TagContent";
import { useMarkerTexts } from "./useMarkerTexts";

export interface ChampionLayerProps {
  /** The state of the last engine answer, not the interpolated one. */
  state: LolSimV1RuntimeState;
  /** Champion picked by each player, for the tiles. */
  championByPlayerId: Record<string, string>;
  contacts: Pick<ContactResult, "fightingIds">;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/**
 * All ten markers. On every committed answer it works out each champion's state, measures the
 * real size of every tag, solves the tag placement once for the whole map (keeping the slots that
 * still fit, so tags do not flicker) and hands each marker its result. Between answers the markers
 * move on their own.
 *
 * The size of a tag comes from probes: for each champion, one hidden box per form, built from the
 * same markup and styled by the same rules as the tag, so the font, the padding and the width of
 * the map all count. They are read in a layout effect after the commit, and a change of size
 * renders once more before the screen is painted.
 */
export function ChampionLayer({ state, championByPlayerId, contacts, selectedId, onSelect }: ChampionLayerProps) {
  const textsFor = useMarkerTexts();
  const previous = useRef<TagPlacements | undefined>(undefined);
  const sizePx = useMapSize();
  const nowSec = state.timeSec;
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

  // The labels of the objective pits are drawn under the champions' tags: tags keep clear of them.
  const obstacles = useMemo(
    () =>
      pitViews(state).map((pit) =>
        pitObstacle(
          { x: pit.pos.x / MAP_UNITS, y: pit.pos.y / MAP_UNITS },
          Number(Boolean(pit.soul)) + Number(Boolean(pit.heraldCarrier)),
          sizePx || undefined,
        ),
      ),
    [state, sizePx],
  );

  const placements = useMemo(
    () =>
      placeTags(
        rows.map(({ champion, texts }) => ({
          id: champion.id,
          pos: champion.pos,
          name: champion.name,
          sub: texts.sub,
          subCompact: texts.subCompact,
          sizes: sizes[champion.id],
        })),
        previous.current,
        { sizePx: sizePx || undefined, obstacles },
      ),
    [rows, sizePx, obstacles, sizes],
  );

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
          fighting={fighting}
          selected={selectedId === champion.id}
          dimmed={selectedId !== null && selectedId !== champion.id}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}
