import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { useGameStore } from "@/store/gameStore";
import { useSettingsStore } from "@/store/settingsStore";
import { useBugReportStore } from "@/store/bugReportStore";
import type { GameStateData } from "@/store/gameStore";
import type { EndOfSeasonSummaryData } from "@/store/types";

// ─── Mocks ───────────────────────────────────────────────────────────────

interface BlockerModalMock {
  blockers: { id: string; severity: string; text: string; tab: string }[];
  pendingAction?: () => void;
}

const shell = vi.hoisted(() => ({
  header: null as Record<string, unknown> | null,
  sidebar: null as Record<string, unknown> | null,
  blockerModal: null as BlockerModalMock | null,
  checkBlockingActions: vi.fn(),
}));

vi.mock("@/services/advanceTimeService", () => ({
  checkBlockingActions: shell.checkBlockingActions,
}));

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
    blockerModal: shell.blockerModal,
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
  DashboardHeaderV2: (props: Record<string, unknown>) => {
    shell.header = props;
    return null;
  },
}));

vi.mock("@/ui-v2/dashboard/DashboardSidebarV2", () => ({
  DashboardSidebarV2: (props: Record<string, unknown>) => {
    shell.sidebar = props;
    const onNavClick = props.onNavClick as (tab: string) => void;
    return <button onClick={() => onNavClick("Training")}>Training</button>;
  },
}));

vi.mock("@/ui-v2/dashboard/tabs/HomeTabV2", () => ({
  HomeTabV2: () => (
    <div data-testid="home-tab-v2">
      <section id="needs-your-call" tabIndex={-1} aria-label="calls" />
    </div>
  ),
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

describe("DashboardV2 shell wiring", () => {
  beforeEach(() => {
    shell.header = null;
    shell.sidebar = null;
    shell.blockerModal = null;
    shell.checkBlockingActions.mockReset();
    shell.checkBlockingActions.mockResolvedValue([]);
    useGameStore.setState({
      hasActiveGame: true,
      managerName: "Coach",
      gameState: minimalGameState(),
      pendingSeasonSummary: null,
      isDirty: false,
      showFiredModal: false,
    });
    useSettingsStore.setState({ loaded: true });
  });

  async function renderDashboard() {
    const DashboardV2 = (await import("./DashboardV2")).default;
    return render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <DashboardV2 />
      </MemoryRouter>,
    );
  }

  const lineupBlocker = {
    id: "incomplete_lineup",
    severity: "warn",
    text: "Starting five is incomplete",
    tab: "Squad",
  };

  it("renders a skip link that moves focus to the focusable main landmark", async () => {
    await renderDashboard();

    const link = await screen.findByRole("link", { name: "onAir.nav.skip" });
    expect(link).toHaveAttribute("href", "#main-content");

    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "main-content");
    expect(main).toHaveAttribute("tabindex", "-1");

    fireEvent.click(link);
    expect(document.activeElement).toBe(main);
  });

  it("passes the shell props to the header and the rail", async () => {
    await renderDashboard();
    await screen.findByTestId("home-tab-v2");

    expect(shell.header).toMatchObject({
      teamName: "Test Team",
      activeTab: "Home",
      isUnemployed: false,
      callCount: 0,
      compact: false,
      badges: { unread: 0, offers: 0, players: 0, teams: 1, staff: 0 },
    });
    expect(typeof shell.header?.onNavClick).toBe("function");
    expect(typeof shell.header?.onShowCalls).toBe("function");
    expect(shell.sidebar).toMatchObject({ compact: false, activeTab: "Home" });
  });

  it("keeps the header and rail active tab in sync with navigation", async () => {
    await renderDashboard();
    fireEvent.click(await screen.findByRole("button", { name: "Training" }));

    await waitFor(() => expect(shell.header?.activeTab).toBe("Training"));
    expect(shell.sidebar?.activeTab).toBe("Training");
  });

  it("retains blockers after the modal closes and clears them on a day change", async () => {
    const DashboardV2 = (await import("./DashboardV2")).default;
    const tree = () => (
      <MemoryRouter initialEntries={["/dashboard"]}>
        <DashboardV2 />
      </MemoryRouter>
    );

    shell.blockerModal = { blockers: [lineupBlocker], pendingAction: vi.fn() };
    const view = render(tree());
    await waitFor(() => expect(shell.header?.callCount).toBe(1));

    // The modal is dismissed: the call stays listed.
    shell.blockerModal = null;
    view.rerender(tree());
    expect(shell.header?.callCount).toBe(1);

    // A new day starts: the retained blockers are dropped.
    act(() => {
      const state = minimalGameState();
      useGameStore.setState({
        gameState: { ...state, clock: { ...state.clock, current_date: "2025-06-20" } },
      });
    });
    await waitFor(() => expect(shell.header?.callCount).toBe(0));
  });

  it("drops retained blockers when a later check returns an empty list", async () => {
    const DashboardV2 = (await import("./DashboardV2")).default;
    const tree = () => (
      <MemoryRouter initialEntries={["/dashboard"]}>
        <DashboardV2 />
      </MemoryRouter>
    );

    shell.blockerModal = { blockers: [lineupBlocker] };
    const view = render(tree());
    await waitFor(() => expect(shell.header?.callCount).toBe(1));

    shell.blockerModal = { blockers: [] };
    view.rerender(tree());
    await waitFor(() => expect(shell.header?.callCount).toBe(0));
  });

  it("drops retained blockers once a game state update shows they are resolved", async () => {
    const DashboardV2 = (await import("./DashboardV2")).default;
    const tree = () => (
      <MemoryRouter initialEntries={["/dashboard"]}>
        <DashboardV2 />
      </MemoryRouter>
    );

    shell.blockerModal = { blockers: [lineupBlocker], pendingAction: vi.fn() };
    const view = render(tree());
    await waitFor(() => expect(shell.header?.callCount).toBe(1));

    // The modal is dismissed and the user fixes the lineup: same day, new state.
    shell.blockerModal = null;
    view.rerender(tree());
    shell.checkBlockingActions.mockResolvedValue([]);
    act(() => {
      useGameStore.setState({ gameState: { ...minimalGameState() } });
    });

    await waitFor(() => expect(shell.checkBlockingActions).toHaveBeenCalled());
    await waitFor(() => expect(shell.header?.callCount).toBe(0));
  });

  it("keeps the blockers that are still unresolved after a refresh", async () => {
    const DashboardV2 = (await import("./DashboardV2")).default;
    const tree = () => (
      <MemoryRouter initialEntries={["/dashboard"]}>
        <DashboardV2 />
      </MemoryRouter>
    );
    const rosterBlocker = { id: "main_roster_minimum", severity: "warn", text: "Roster too small", tab: "Squad" };

    shell.blockerModal = { blockers: [lineupBlocker, rosterBlocker], pendingAction: vi.fn() };
    const view = render(tree());
    await waitFor(() => expect(shell.header?.callCount).toBe(2));

    shell.blockerModal = null;
    view.rerender(tree());
    shell.checkBlockingActions.mockResolvedValue([rosterBlocker]);
    act(() => {
      useGameStore.setState({ gameState: { ...minimalGameState() } });
    });

    await waitFor(() => expect(shell.header?.callCount).toBe(1));
  });

  it("keeps a scrim setup blocker the advance path reports until its condition is fixed", async () => {
    const DashboardV2 = (await import("./DashboardV2")).default;
    const tree = () => (
      <MemoryRouter initialEntries={["/dashboard"]}>
        <DashboardV2 />
      </MemoryRouter>
    );
    const scrimSetup = {
      id: "scrim_setup_required",
      severity: "warn",
      text: "Set up the weekly scrims",
      tab: "Scrims",
    };
    // Wednesday morning, the first scrim day, with no objective and no plan.
    const wednesday = (team: Record<string, unknown> = {}) => {
      const state = minimalGameState();
      return {
        ...state,
        clock: { ...state.clock, current_date: "2025-06-18" },
        teams: [{ id: "team-1", name: "Test Team", ...team }],
      } as unknown as GameStateData;
    };
    const view = render(tree());
    await screen.findByTestId("home-tab-v2");
    act(() => useGameStore.setState({ gameState: wednesday() }));

    shell.blockerModal = { blockers: [scrimSetup], pendingAction: vi.fn() };
    view.rerender(tree());
    await waitFor(() => expect(shell.header?.callCount).toBe(1));

    // The modal closes. check_blocking_actions answers [] for this blocker (only
    // the advance command raises it), yet it must survive the refresh.
    shell.blockerModal = null;
    view.rerender(tree());
    shell.checkBlockingActions.mockClear();
    act(() => useGameStore.setState({ gameState: wednesday() }));
    await waitFor(() => expect(shell.checkBlockingActions).toHaveBeenCalledWith("dashboard-refresh", { rethrow: true }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(shell.header?.callCount).toBe(1);

    // The manager sets a weekly objective: the advance path would no longer block.
    act(() => useGameStore.setState({ gameState: wednesday({ scrim_weekly_objective: "Draft" }) }));
    await waitFor(() => expect(shell.header?.callCount).toBe(0));
  });

  it("keeps the retained blockers when the refresh check fails", async () => {
    const DashboardV2 = (await import("./DashboardV2")).default;
    const tree = () => (
      <MemoryRouter initialEntries={["/dashboard"]}>
        <DashboardV2 />
      </MemoryRouter>
    );

    shell.blockerModal = { blockers: [lineupBlocker], pendingAction: vi.fn() };
    const view = render(tree());
    await waitFor(() => expect(shell.header?.callCount).toBe(1));

    shell.blockerModal = null;
    view.rerender(tree());
    shell.checkBlockingActions.mockRejectedValue(new Error("backend down"));
    act(() => {
      useGameStore.setState({ gameState: { ...minimalGameState() } });
    });

    await waitFor(() => expect(shell.checkBlockingActions).toHaveBeenCalledWith("dashboard-refresh", { rethrow: true }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(shell.header?.callCount).toBe(1);
  });

  it("does not re-check blockers while none are retained or the modal is open", async () => {
    await renderDashboard();
    await screen.findByTestId("home-tab-v2");
    act(() => {
      useGameStore.setState({ gameState: { ...minimalGameState() } });
    });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(shell.checkBlockingActions).not.toHaveBeenCalled();
  });

  it("flags compact while a season summary is pending", async () => {
    useGameStore.setState({
      pendingSeasonSummary: { season: 1 } as unknown as EndOfSeasonSummaryData,
    });
    await renderDashboard();
    await waitFor(() => expect(shell.header?.compact).toBe(true));
    expect(shell.sidebar?.compact).toBe(true);
  });

  it("moves to Home and focuses the Needs your call panel from the header chip", async () => {
    await renderDashboard();
    fireEvent.click(await screen.findByRole("button", { name: "Training" }));
    await waitFor(() => expect(shell.header?.activeTab).toBe("Training"));

    act(() => (shell.header?.onShowCalls as () => void)());

    await waitFor(() => expect(shell.header?.activeTab).toBe("Home"));
    await waitFor(() => expect(document.activeElement?.id).toBe("needs-your-call"));
  });
});
