import { useEffect, useMemo } from "react";
import { useGameStore } from "@/store/gameStore";
import { useSettingsStore } from "@/store/settingsStore";
import { resolveClubPalette } from "@/lib/teams/clubColors";
import { TEAM_LOGO_PALETTE } from "@/lib/teams/teamPalette.generated";

const CLUB_PROPERTIES = ["--club", "--club-foreground", "--club-text", "--club-secondary"] as const;

/**
 * Publishes the managed club's palette as CSS custom properties on <html>, so
 * portals mounted on body inherit them. With no managed team the properties
 * are removed and the theme defaults apply.
 */
export function useClubTheme(): void {
  const gameState = useGameStore((s) => s.gameState);
  const highContrast = useSettingsStore((s) => s.settings.high_contrast);
  const managerTeamId = gameState?.manager.team_id ?? null;
  const teams = gameState?.teams;

  const team = useMemo(
    () => (managerTeamId ? (teams?.find((t) => t.id === managerTeamId) ?? null) : null),
    [managerTeamId, teams],
  );

  const palette = useMemo(
    () => (team ? resolveClubPalette(team, TEAM_LOGO_PALETTE, { highContrast }) : null),
    [team, highContrast],
  );

  useEffect(() => {
    const root = document.documentElement;
    if (!palette) {
      for (const name of CLUB_PROPERTIES) root.style.removeProperty(name);
      delete root.dataset.clubSource;
      return;
    }
    root.style.setProperty("--club", palette.accent);
    root.style.setProperty("--club-foreground", palette.accentForeground);
    root.style.setProperty("--club-text", palette.accentText);
    root.style.setProperty("--club-secondary", palette.secondary);
    root.dataset.clubSource = palette.source;
  }, [palette]);
}
