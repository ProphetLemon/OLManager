import { useEffect, useState } from "react";
import type { SoloQDecayPreset, SoloQHistory } from "@/api/types";
import { normalizeHistory } from "@/lib/players/soloqHistory";
import { getSoloQDecaySettings, getSoloQHistory } from "@/services/playerService";

export type SoloqHistoryState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "ready"; history: SoloQHistory; presets: SoloQDecayPreset[] | null };

interface Loaded {
  playerId: string;
  state: SoloqHistoryState;
}

/**
 * Loads one player's SoloQ record and the decay presets. `version` is anything that changes when the
 * save moves on (the in-game date), so the record is read again after a day is played.
 * A failed or malformed answer is "unavailable": the profile then shows today's LP only.
 */
export function useSoloqHistory(playerId: string, version: string): SoloqHistoryState {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [history, settings] = await Promise.allSettled([getSoloQHistory(playerId), getSoloQDecaySettings()]);
      if (cancelled) return;
      const normalized = history.status === "fulfilled" ? normalizeHistory(history.value) : null;
      const presets =
        settings.status === "fulfilled" && Array.isArray(settings.value?.presets) ? settings.value.presets : null;
      setLoaded({
        playerId,
        state: normalized ? { status: "ready", history: normalized, presets } : { status: "unavailable" },
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [playerId, version]);

  return loaded && loaded.playerId === playerId ? loaded.state : { status: "loading" };
}
