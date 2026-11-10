import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useGameStore } from "@/store/gameStore";
import type { GameStateData } from "@/store/gameStore";
import type { EndOfSeasonSummaryData } from "@/store/types";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  const { translateFromEnglish } = await import("@/test-i18n");
  return { ...actual, useTranslation: () => ({ t: translateFromEnglish }) };
});
vi.mock("@/ui-v2/_legacy/components/playoffs/PlayoffBracketBoard", () => ({
  default: () => <div data-testid="bracket" />,
}));

import DashboardTabContent from "@/ui-v2/_legacy/components/dashboard/DashboardTabContent";

function game(season: number): GameStateData {
  return {
    manager: { team_id: "t-user" },
    user_competition_id: "les",
    teams: [
      { id: "t-user", name: "Mine Esports", logo_url: null },
      { id: "t-other", name: "Other Club", logo_url: null },
    ],
    leagues: [
      {
        id: "l1",
        competition_id: "les",
        name: "LES",
        season,
        fixtures: [],
        standings: [
          { team_id: "t-user", won: 10, lost: 2, points: 30 },
          { team_id: "t-other", won: 2, lost: 10, points: 6 },
        ],
      },
    ],
  } as unknown as GameStateData;
}

function summary(withLadder: boolean): EndOfSeasonSummaryData {
  return {
    season: 1,
    league_name: "LES",
    champion_id: "t-user",
    champion_name: "Mine Esports",
    user_position: 1,
    user_points: 30,
    user_won: 10,
    user_lost: 2,
    user_maps_won: 20,
    user_maps_lost: 5,
    golden_boot_player: "",
    golden_boot_goals: 0,
    poty_player: "",
    poty_rating: 0,
    total_teams: 2,
    ladder_movements: withLadder
      ? [
          {
            lower_competition_id: "les",
            lower_competition_name: "LES",
            upper_competition_id: "lec",
            upper_competition_name: "LEC",
            season: 1,
            status: "Applied",
            promoted: [{ id: "t-user", name: "Mine Esports" }],
            relegated: [],
          },
        ]
      : [],
    user_ladder: withLadder
      ? { result: "Promoted", from_competition_id: "les", to_competition_id: "lec" }
      : null,
  } as EndOfSeasonSummaryData;
}

/** Mimics DashboardV2: seasonComplete follows the store's game (season 1 = complete). */
function Harness({ tab }: { tab: string }) {
  const gameState = useGameStore((s) => s.gameState)!;
  const setGameState = useGameStore((s) => s.setGameState);
  const seasonComplete = gameState.leagues[0].season === 1;
  const viewModel = {
    activeTab: tab,
    gameState,
    initialMessageId: null,
    managerId: "m",
    seasonComplete,
    handlers: {
      onGameUpdate: setGameState,
      onNavigate: vi.fn(),
      onSelectPlayer: vi.fn(),
      onSelectTeam: vi.fn(),
      onViewChampion: vi.fn(),
    },
  } as never;
  return <DashboardTabContent viewModel={viewModel} />;
}

describe("end-of-season summary survives the season wrap", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useGameStore.getState().clearGame();
    useGameStore.getState().setGameState(game(1));
  });

  function advance(withLadder: boolean, nextSeason = 2) {
    invokeMock.mockResolvedValue({ game: game(nextSeason), summary: summary(withLadder) });
    const view = render(<Harness tab="Home" />);
    fireEvent.click(screen.getByRole("button", { name: /start next season/i }));
    return view;
  }

  it("keeps the promotion card visible after the game moves to the new season", async () => {
    advance(true);
    expect(await screen.findByTestId("ladder-user-result")).toBeInTheDocument();
    expect(screen.getByText("Promoted")).toBeInTheDocument();
    expect(useGameStore.getState().gameState?.leagues[0].season).toBe(2);
  });

  it("announces the new season when the rollover wraps the season", async () => {
    advance(false, 2);
    expect(await screen.findByRole("heading", { name: "Season 2" })).toBeInTheDocument();
  });

  it("does not announce a year when only a split changed inside the season", async () => {
    advance(false, 1);
    expect(await screen.findByRole("heading", { name: "Next split" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Season 2" })).toBeNull();
    expect(screen.getByText(/new schedule has been released/i)).toBeInTheDocument();
  });

  it("returns to the normal Home once dismissed", async () => {
    advance(true);
    await screen.findByTestId("ladder-user-result");
    fireEvent.click(screen.getByRole("button", { name: /continue to dashboard/i }));
    await waitFor(() => expect(screen.queryByTestId("ladder-user-result")).toBeNull());
    expect(screen.queryByRole("button", { name: /continue to dashboard/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /start next season/i })).toBeNull();
  });

  it("shows the summary for a wrap without ladder movement until dismissed", async () => {
    advance(false);
    expect(await screen.findByText(/new schedule has been released/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /continue to dashboard/i }));
    await waitFor(() =>
      expect(screen.queryByText(/new schedule has been released/i)).toBeNull(),
    );
  });

  it("still shows the pending summary after visiting another tab and back", async () => {
    const view = advance(true);
    await screen.findByTestId("ladder-user-result");
    view.rerender(<Harness tab="Squad" />);
    await act(async () => {
      view.rerender(<Harness tab="Home" />);
    });
    expect(screen.getByTestId("ladder-user-result")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start next season/i })).toBeNull();
  });

  it("drops a pending summary when the game is cleared", async () => {
    const view = advance(true);
    await screen.findByTestId("ladder-user-result");
    view.unmount();
    act(() => useGameStore.getState().clearGame());
    expect(useGameStore.getState().pendingSeasonSummary).toBeNull();
  });
});
