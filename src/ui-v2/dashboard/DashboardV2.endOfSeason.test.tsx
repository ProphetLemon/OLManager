import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { useGameStore } from "@/store/gameStore";
import { useSettingsStore } from "@/store/settingsStore";
import type { GameStateData } from "@/store/gameStore";
import type { EndOfSeasonSummaryData } from "@/store/types";

// Drives the real dashboard path: DashboardV2 -> lazy DashboardWorkspaceContent
// -> DashboardTabContent -> EndOfSeasonScreen. Only the backend, the clock hook
// and the router are replaced; no dashboard component is mocked.

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((command: string) => {
    if (command === "get_active_game") return Promise.resolve(game());
    if (command === "get_champions") return Promise.resolve([]);
    return Promise.resolve();
  }),
}));

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  const { translateFromEnglish } = await import("@/test-i18n");
  return { ...actual, useTranslation: () => ({ t: translateFromEnglish, i18n: { language: "en" } }) };
});

vi.mock("@/hooks/useAdvanceTime", () => ({
  useAdvanceTime: () => ({
    isAdvancing: false,
    showContinueMenu: false,
    setShowContinueMenu: vi.fn(),
    showMatchConfirm: false,
    setShowMatchConfirm: vi.fn(),
    matchMode: "live",
    blockerModal: null,
    setBlockerModal: vi.fn(),
    autoDelegationNotice: null,
    matchPlayedNotice: null,
    scrimResultNotice: null,
    dismissScrimResultNotice: vi.fn(),
    handleContinue: vi.fn(),
    handleConfirmMatch: vi.fn(),
    handleSkipToMatchDay: vi.fn(),
    handleSkipToNextDay: vi.fn(),
  }),
}));

vi.mock("@/services/advanceTimeService", () => ({
  checkBlockingActions: vi.fn().mockResolvedValue([]),
}));

function game(): GameStateData {
  return {
    manager: {
      id: "mgr-1",
      nickname: null,
      first_name: "Test",
      last_name: "Manager",
      date_of_birth: "1990-01-01",
      nationality: "AR",
      avatar_path: null,
      reputation: 50,
      satisfaction: 50,
      fan_approval: 50,
      team_id: "team-1",
      career_stats: {},
      career_history: [],
    },
    clock: { current_date: "2025-06-19", start_date: "2025-01-01" },
    day_phase: "Morning",
    user_competition_id: "les",
    teams: [{ id: "team-1", name: "Test Team", logo_url: null }],
    players: [],
    staff: [],
    messages: [],
    news: [],
    leagues: [
      {
        id: "l1",
        competition_id: "les",
        name: "LES",
        season: 2,
        fixtures: [],
        standings: [{ team_id: "team-1", won: 0, lost: 0, points: 0 }],
      },
    ],
    scouting_assignments: [],
    board_objectives: [],
    champions: [],
  } as unknown as GameStateData;
}

const summary = {
  season: 1,
  league_name: "LES",
  champion_id: "team-1",
  champion_name: "Test Team",
  user_position: 1,
  user_points: 30,
  user_won: 10,
  user_lost: 2,
  user_maps_won: 20,
  user_maps_lost: 5,
  golden_boot_player: "",
  golden_boot_goals: 0,
  poty_player: "Ana Gomez",
  poty_rating: 7.25,
  total_teams: 2,
  ladder_movements: [],
  user_ladder: null,
} as unknown as EndOfSeasonSummaryData;

describe("DashboardV2 end-of-season screen (real workspace path)", () => {
  beforeEach(() => {
    useGameStore.setState({
      hasActiveGame: true,
      managerName: "Coach",
      gameState: game(),
      pendingSeasonSummary: summary,
      isDirty: false,
      showFiredModal: false,
    });
    useSettingsStore.setState({ loaded: true });
  });

  it("renders the end-of-season summary on Home while the season summary shows", async () => {
    const DashboardV2 = (await import("./DashboardV2")).default;

    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <DashboardV2 />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Ana Gomez", {}, { timeout: 10000 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue to dashboard/i })).toBeInTheDocument();
    expect(screen.getByText(/new schedule has been released/i)).toBeInTheDocument();
  });
});
