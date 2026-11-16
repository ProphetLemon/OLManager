import { useEffect, useMemo, useState } from "react";

import { getExpectedSigningWages } from "@/services/transfersService";
import type { PlayerData } from "@/store/gameStore";

/** A free agent whose record carries no wage: the UI must show what they would ask. */
export function needsExpectedWage(player: Pick<PlayerData, "team_id" | "wage">): boolean {
  return player.team_id === null && !(player.wage > 0);
}

/** The wage to display: the real one, or the backend's ask for a wage-0 free agent. */
export function effectiveWage(
  player: Pick<PlayerData, "id" | "team_id" | "wage">,
  expectedWages: Record<string, number>,
): number {
  if (!needsExpectedWage(player)) return player.wage;
  return expectedWages[player.id] ?? player.wage;
}

/**
 * Expected signing wage (from the backend, the figure a wage negotiation names) for the
 * wage-0 free agents among `players`. Other players are never requested.
 */
export function useExpectedSigningWages(players: PlayerData[]): Record<string, number> {
  const idsKey = useMemo(
    () => players.filter(needsExpectedWage).map((player) => player.id).join("\u0000"),
    [players],
  );
  const [wages, setWages] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!idsKey) return;
    const ids = idsKey.split("\u0000");
    let cancelled = false;
    void (async () => {
      try {
        const response = await getExpectedSigningWages(ids);
        if (cancelled || !response) return;
        const next: Record<string, number> = {};
        for (const id of ids) {
          const value = response[id];
          if (typeof value === "number" && Number.isFinite(value) && value > 0) next[id] = value;
        }
        setWages((previous) => ({ ...previous, ...next }));
      } catch {
        // Keep showing the record's own wage when the lookup is unavailable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [idsKey]);

  return wages;
}
