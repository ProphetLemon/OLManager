import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useGameStore } from "@/store/gameStore";
import { useSettingsStore } from "@/store/settingsStore";
import type { GameStateData } from "@/store/types";
import { resolveClubPalette } from "@/lib/teams/clubColors";
import { TEAM_LOGO_PALETTE } from "@/lib/teams/teamPalette.generated";
import { useClubTheme } from "./useClubTheme";

const PROPS = ["--club", "--club-foreground", "--club-text", "--club-secondary"];

function gameWith(team: Record<string, unknown>): GameStateData {
  return {
    manager: { team_id: team.id },
    teams: [team],
  } as unknown as GameStateData;
}

const CATALOG_TEAM = {
  id: "fnatic",
  name: "Fnatic",
  logo_url: "/teams-icons/fnatic.webp",
  colors: { primary: "#112233", secondary: "#445566" },
};

const CUSTOM_TEAM = {
  id: "lec-custom-rayo",
  name: "Rayo",
  logo_url: "data:image/svg+xml;base64,AAAA",
  colors: { primary: "#2f9e44", secondary: "#f08c00" },
};

function read(name: string) {
  return document.documentElement.style.getPropertyValue(name);
}

describe("useClubTheme", () => {
  beforeEach(() => {
    useGameStore.setState({ gameState: null });
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, high_contrast: false },
    });
  });

  afterEach(() => {
    for (const name of PROPS) document.documentElement.style.removeProperty(name);
    delete document.documentElement.dataset.clubSource;
  });

  it("exposes the logo-derived palette for a catalog club", () => {
    useGameStore.setState({ gameState: gameWith(CATALOG_TEAM) });
    renderHook(() => useClubTheme());

    const expected = resolveClubPalette(CATALOG_TEAM, TEAM_LOGO_PALETTE);
    expect(expected.source).toBe("logo");
    expect(read("--club")).toBe(expected.accent);
    expect(read("--club-foreground")).toBe(expected.accentForeground);
    expect(read("--club-text")).toBe(expected.accentText);
    expect(read("--club-secondary")).toBe(expected.secondary);
    expect(document.documentElement.dataset.clubSource).toBe("logo");
  });

  it("uses the chosen colours for a user-created club", () => {
    useGameStore.setState({ gameState: gameWith(CUSTOM_TEAM) });
    renderHook(() => useClubTheme());

    expect(document.documentElement.dataset.clubSource).toBe("custom");
    expect(read("--club")).toBe(resolveClubPalette(CUSTOM_TEAM, TEAM_LOGO_PALETTE).accent);
  });

  it("removes the properties when there is no managed team", () => {
    useGameStore.setState({ gameState: gameWith(CATALOG_TEAM) });
    renderHook(() => useClubTheme());
    expect(read("--club")).not.toBe("");

    act(() => useGameStore.setState({ gameState: null }));

    for (const name of PROPS) expect(read(name)).toBe("");
    expect(document.documentElement.dataset.clubSource).toBeUndefined();
  });

  it("recomputes when high contrast toggles", () => {
    useGameStore.setState({ gameState: gameWith(CUSTOM_TEAM) });
    renderHook(() => useClubTheme());

    act(() =>
      useSettingsStore.setState({
        settings: { ...useSettingsStore.getState().settings, high_contrast: true },
      }),
    );

    const high = resolveClubPalette(CUSTOM_TEAM, TEAM_LOGO_PALETTE, { highContrast: true });
    expect(read("--club")).toBe(high.accent);
    expect(read("--club-text")).toBe(high.accentText);
  });
});
