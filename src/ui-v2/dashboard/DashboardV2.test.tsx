import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { useGameStore } from "@/store/gameStore";
import { useSettingsStore } from "@/store/settingsStore";
import { useBugReportStore } from "@/store/bugReportStore";
import type { GameStateData } from "@/store/gameStore";
import type { EndOfSeasonSummaryData } from "@/store/types";

// ─── Mocks ───────────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((command: string) => {
    if (command === "get_active_game") {
      return Promise.resolve(minimalGameState());
    }
    if (command === "get_champions") {
      return Promise.resolve([]);
    }
    return Promise.resolve();
  }),
}));

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return { ...actual, useTranslation: () => ({ t: (key: string) => key }) };
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
    handleContinue: vi.fn(),
    handleConfirmMatch: vi.fn(),
    handleSkipToMatchDay: vi.fn(),
    handleSkipToNextDay: vi.fn(),
  }),
}));

vi.mock("@/lib/teams/teamLogos", () => ({
  resolveTeamLogo: () => null,
  resolveTeamLogoById: () => null,
}));

vi.mock("@/store/academySelectors", () => ({
  isAcademyTeam: () => false,
}));

vi.mock("@/lib/assetUrl", () => ({
  assetUrl: (path: string) => path,
}));

vi.mock("@/lib/common/managerAvatars", () => ({
  DEFAULT_MANAGER_ICON_PATH: "/default-manager.png",
}));

vi.mock("@/lib/common/helpers", () => ({
  formatDateFull: () => "19 Jun 2026",
  isSeasonComplete: () => false,
}));

vi.mock("@/lib/dashboard/helpers", () => ({
  getDashboardAlerts: () => [],
  getManagerTeamName: () => "Test Team",
  getTodayMatchFixture: () => null,
  getUnreadMessagesCount: () => 0,
  getPendingIncomingOffersCount: () => 0,
}));

vi.mock("@/ui-v2/_legacy/components/dashboard/DashboardWorkspaceContent", async () => {
  const { default: DashboardTabContent } = await import(
    "@/ui-v2/_legacy/components/dashboard/DashboardTabContent"
  );
  return {
    default: ({ dashboardTabContentModel }: { dashboardTabContentModel: never }) => (
      <DashboardTabContent viewModel={dashboardTabContentModel} />
    ),
  };
});

vi.mock("@/ui-v2/_legacy/components/dashboard/DashboardOverlays", () => ({
  default: () => null,
}));

vi.mock("@/ui-v2/_legacy/components/dashboard/FiredModal", () => ({
  default: () => null,
}));

vi.mock("@/ui-v2/dashboard/DashboardHeaderV2", () => ({
  DashboardHeaderV2: () => null,
}));

vi.mock("@/ui-v2/dashboard/DashboardSidebarV2", () => ({
  DashboardSidebarV2: ({ onNavClick }: { onNavClick: (tab: string) => void }) => (
    <button onClick={() => onNavClick("Training")}>Training</button>
  ),
}));

vi.mock("@/ui-v2/dashboard/tabs/HomeTabV2", () => ({
  HomeTabV2: () => <div data-testid="home-tab-v2" />,
}));
vi.mock("@/ui-v2/dashboard/tabs/InboxTabV2", () => ({ InboxTabV2: () => null }));
vi.mock("@/ui-v2/dashboard/tabs/ScheduleTabV2", () => ({ ScheduleTabV2: () => null }));
vi.mock("@/ui-v2/dashboard/tabs/SquadTabV2", () => ({ SquadTabV2: () => null }));
vi.mock("@/ui-v2/dashboard/tabs/TacticsTabV2", () => ({ TacticsTabV2: () => null }));
vi.mock("@/ui-v2/dashboard/tabs/TrainingTabV2", () => ({ TrainingTabV2: () => null }));
vi.mock("@/ui-v2/dashboard/tabs/PlayersTabV2", () => ({ PlayersTabV2: () => null }));
vi.mock("@/ui-v2/dashboard/tabs/TeamsTabV2", () => ({ TeamsTabV2: () => null }));
vi.mock("@/ui-v2/dashboard/tabs/StaffTabV2", () => ({ StaffTabV2: () => null }));
vi.mock("@/ui-v2/dashboard/tabs/FinancesTabV2", () => ({
  FinancesTabV2: ({
    onSelectPlayer,
  }: {
    onSelectPlayer?: (id: string, options?: { openRenewal?: boolean }) => void;
  }) => (
    <button onClick={() => onSelectPlayer?.("player-1", { openRenewal: true })}>
      renew-player-1
    </button>
  ),
}));
vi.mock("@/ui-v2/dashboard/tabs/ScrimsTabV2", () => ({ ScrimsTabV2: () => null }));
vi.mock("@/ui-v2/dashboard/tabs/SoloqTabV2", () => ({ SoloqTabV2: () => null }));
vi.mock("@/ui-v2/dashboard/tabs/ScoutingTabV2", () => ({ ScoutingTabV2: () => null }));
vi.mock("@/ui-v2/dashboard/tabs/TransfersTabV2", () => ({ TransfersTabV2: () => null }));
vi.mock("@/ui-v2/dashboard/tabs/NewsTabV2", () => ({ NewsTabV2: () => null }));
vi.mock("@/ui-v2/dashboard/tabs/SocialTabV2", () => ({ SocialTabV2: () => null }));
vi.mock("@/ui-v2/dashboard/tabs/ManagerTabV2", () => ({ ManagerTabV2: () => null }));
vi.mock("@/ui-v2/dashboard/tabs/YouthTabV2", () => ({ YouthTabV2: () => null }));
vi.mock("@/ui-v2/dashboard/tabs/CompetitionsTabV2", () => ({ CompetitionsTabV2: () => null }));
vi.mock("@/ui-v2/dashboard/tabs/MarketTabV2", () => ({ MarketTabV2: () => null }));
vi.mock("@/ui-v2/dashboard/tabs/ChampionsWorldTabV2", () => ({ ChampionsWorldTabV2: () => null }));
vi.mock("@/ui-v2/dashboard/tabs/MetaTabV2", () => ({ MetaTabV2: () => null }));

vi.mock("@/ui-v2/pages/TeamProfileV2", () => ({ default: () => null }));
vi.mock("@/ui-v2/pages/ChampionPageV2", () => ({ default: () => null }));
vi.mock("@/ui-v2/pages/PlayerProfileV2", () => ({
  default: ({ startWithRenewalModal }: { startWithRenewalModal?: boolean }) => (
    <div data-testid="player-profile" data-renewal={String(startWithRenewalModal)} />
  ),
}));
vi.mock("@/ui-v2/pages/StaffProfileV2", () => ({ default: () => null }));

// ─── Helpers ─────────────────────────────────────────────────────────────

function minimalGameState(): GameStateData {
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
    teams: [{ id: "team-1", name: "Test Team" }],
    players: [],
    staff: [],
    messages: [],
    news: [],
    leagues: [],
    scouting_assignments: [],
    board_objectives: [],
    champions: [],
  } as unknown as GameStateData;
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe("DashboardV2 tab sync", () => {
  beforeEach(() => {
    useGameStore.setState({
      hasActiveGame: true,
      managerName: "Coach",
      gameState: minimalGameState(),
      isDirty: false,
      showFiredModal: false,
    });
    useSettingsStore.setState({ loaded: true });
    useBugReportStore.setState({
      currentRoute: "",
      currentDashboardTab: "",
    });
  });

  it("syncs the active dashboard tab to the bug-report store", async () => {
    const DashboardV2 = (await import("./DashboardV2")).default;

    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <DashboardV2 />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Training" }));

    await waitFor(() =>
      expect(useBugReportStore.getState().currentDashboardTab).toBe("Training"),
    );
  });

  it("reflects the tab implied by the dashboard route", async () => {
    const DashboardV2 = (await import("./DashboardV2")).default;

    render(
      <MemoryRouter initialEntries={["/finanzas"]}>
        <DashboardV2 />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(useBugReportStore.getState().currentDashboardTab).toBe("Finances"),
    );
  });

  it("opens the player profile with the renewal intent from finances", async () => {
    const DashboardV2 = (await import("./DashboardV2")).default;

    render(
      <MemoryRouter initialEntries={["/finanzas"]}>
        <DashboardV2 />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "renew-player-1" }));

    const profile = await screen.findByTestId("player-profile");
    expect(profile.getAttribute("data-renewal")).toBe("true");
  });
});

describe("DashboardV2 pending season summary", () => {
  function freshSeasonState(): GameStateData {
    return {
      ...minimalGameState(),
      user_competition_id: "les",
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
    poty_player: "",
    poty_rating: 0,
    total_teams: 2,
    ladder_movements: [
      {
        lower_competition_id: "les",
        lower_competition_name: "LES",
        upper_competition_id: "lec",
        upper_competition_name: "LEC",
        season: 1,
        status: "Applied",
        promoted: [{ id: "team-1", name: "Test Team" }],
        relegated: [],
      },
    ],
    user_ladder: { result: "Promoted", from_competition_id: "les", to_competition_id: "lec" },
  } as unknown as EndOfSeasonSummaryData;

  beforeEach(() => {
    useGameStore.setState({
      hasActiveGame: true,
      managerName: "Coach",
      gameState: freshSeasonState(),
      pendingSeasonSummary: summary,
      isDirty: false,
      showFiredModal: false,
    });
    useSettingsStore.setState({ loaded: true });
  });

  it("keeps the wrap summary on Home until it is dismissed", async () => {
    const DashboardV2 = (await import("./DashboardV2")).default;

    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <DashboardV2 />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("ladder-user-result", {}, { timeout: 10000 })).toBeInTheDocument();
    expect(screen.queryByTestId("home-tab-v2")).toBeNull();

    act(() => useGameStore.getState().setPendingSeasonSummary(null));

    expect(await screen.findByTestId("home-tab-v2", {}, { timeout: 10000 })).toBeInTheDocument();
    expect(screen.queryByTestId("ladder-user-result")).toBeNull();
  });
});
