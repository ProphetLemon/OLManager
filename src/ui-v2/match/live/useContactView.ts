import { useMemo } from "react";

import { detectContacts, towerBeams, type ContactResult, type TowerBeam } from "@/lib/match/live/contacts";
import type { LolSimV1RuntimeState } from "@/ui-v2/_legacy/components/match/lol-prototype/backend/contract-v1";

export interface ContactView {
  contacts: ContactResult;
  beams: TowerBeam[];
}

const EMPTY: ContactView = { contacts: { pairs: [], fightingIds: [] }, beams: [] };

/**
 * Who is fighting and which towers are shooting, from the last engine answer. Worked out once
 * per commit and handed to every layer that shows it, so they cannot disagree.
 */
export function useContactView(state: LolSimV1RuntimeState | null): ContactView {
  return useMemo(
    () =>
      state
        ? {
            contacts: detectContacts(state.champions, state.timeSec),
            beams: towerBeams(state.structures, state.champions, state.timeSec),
          }
        : EMPTY,
    [state],
  );
}
