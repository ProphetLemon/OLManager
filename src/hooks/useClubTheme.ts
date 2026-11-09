import { useEffect, useMemo } from "react";
import { useGameStore } from "@/store/gameStore";
import { useSettingsStore } from "@/store/settingsStore";
import { resolveClubPalette } from "@/lib/teams/clubColors";
import { TEAM_LOGO_PALETTE } from "@/lib/teams/teamPalette.generated";

const CLUB_PROPERTIES = ["--club", "--club-foreground", "--club-text", "--club-secondary"] as const;

/**
 * Publishes the managed club's palette as CSS custom properties on <html>, so
 * portals mounted on body inherit them. With no managed team the properties
 * are removed and the theme defaults apply. `enabled` is true only on in-game
 * screens: after an exit without saving, the store can still hold the last
 * game while the main menu or settings are shown.
 */
export function useClubTheme(enabled = true): void {
  const gameState = useGameStore((s) => s.gameState);
  const highContrast = useSettingsStore((s) => s.settings.high_contrast);
  const managerTeamId = gameState?.manager.team_id ?? null;
  const teams = gameState?.teams;

  const team = managerTeamId ? teams?.find((t) => t.id === managerTeamId) : undefined;

  // Key the memo on the fields the resolver reads: gameState.teams is replaced
  // on every refresh, so the team object identity changes even when its
  // colours do not.
  const id = team?.id ?? null;
  const name = team?.name ?? null;
  const logoUrl = team?.logo_url ?? null;
  const primary = team?.colors?.primary ?? null;
  const secondary = team?.colors?.secondary ?? null;

  const palette = useMemo(
    () =>
      enabled && id
        ? resolveClubPalette(
            { id, name, logo_url: logoUrl, colors: { primary, secondary } },
            TEAM_LOGO_PALETTE,
            { highContrast },
          )
        : null,
    [enabled, id, name, logoUrl, primary, secondary, highContrast],
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
