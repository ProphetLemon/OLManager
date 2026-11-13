import { useEffect, useMemo, useRef } from "react";

import { markerState } from "@/lib/match/live/championMarker";
import type { ContactResult } from "@/lib/match/live/contacts";
import { placeTags, type TagPlacements } from "@/lib/match/live/tagPlacement";
import type { LolSimV1RuntimeState } from "@/ui-v2/_legacy/components/match/lol-prototype/backend/contract-v1";

import { ChampionMarker } from "./ChampionMarker";
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
 * All ten markers. On every committed answer it works out each champion's state, solves the
 * tag placement once for the whole map (keeping the slots that still fit, so tags do not
 * flicker) and hands each marker its result. Between answers the markers move on their own.
 */
export function ChampionLayer({ state, championByPlayerId, contacts, selectedId, onSelect }: ChampionLayerProps) {
  const textsFor = useMarkerTexts();
  const previous = useRef<TagPlacements | undefined>(undefined);
  const nowSec = state.timeSec;

  const rows = useMemo(() => {
    const fighting = new Set(contacts.fightingIds);
    return state.champions.map((champion) => {
      const marker = markerState(champion, fighting.has(champion.id), nowSec);
      return { champion, marker, texts: textsFor(marker), fighting: fighting.has(champion.id) };
    });
  }, [state.champions, contacts.fightingIds, nowSec, textsFor]);

  const placements = useMemo(
    () =>
      placeTags(
        rows.map(({ champion, texts }) => ({
          id: champion.id,
          pos: champion.pos,
          name: champion.name,
          sub: texts.sub,
          subCompact: texts.subCompact,
        })),
        previous.current,
      ),
    [rows],
  );

  // Remembered after the commit, so that rendering stays free of side effects.
  useEffect(() => {
    previous.current = placements;
  }, [placements]);

  return (
    <>
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
