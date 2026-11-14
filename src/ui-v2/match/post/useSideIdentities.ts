import { useMemo, type CSSProperties } from "react";

import { resolveSideStyles, sideTokens } from "@/lib/match/live/sidePalette";
import { teamIdentity } from "@/lib/match/live/teamIdentity";
import type { TeamIdentity } from "@/lib/match/live/teamIdentity";
import type { GameStateData } from "@/store/gameStore";
import { useSettingsStore } from "@/store/settingsStore";
import type { MatchSnapshot } from "@/ui-v2/_legacy/components/match/types";

export interface SideIdentities {
  blue: TeamIdentity;
  red: TeamIdentity;
  /** The two clubs' colours as the `--side-*` custom properties, published once on the screen root. */
  style: CSSProperties;
}

/** Home is the blue side and away the red one, as on the live screen; each wears its club's logo and colours. */
export function useSideIdentities(snapshot: MatchSnapshot, gameState: GameStateData | null): SideIdentities {
  const highContrast = useSettingsStore((s) => s.settings.high_contrast);
  return useMemo(() => {
    const homeRef = { id: snapshot.home_team.id, name: snapshot.home_team.name };
    const awayRef = { id: snapshot.away_team.id, name: snapshot.away_team.name };
    const sides = resolveSideStyles(gameState?.teams, homeRef, awayRef, { highContrast });
    const blue = teamIdentity(homeRef.name, gameState?.teams, sides.blue);
    const red = teamIdentity(awayRef.name, gameState?.teams, sides.red);
    return { blue, red, style: sideTokens(blue.palette, red.palette) as CSSProperties };
  }, [snapshot.home_team.id, snapshot.home_team.name, snapshot.away_team.id, snapshot.away_team.name, gameState?.teams, highContrast]);
}
