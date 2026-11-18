import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { useGameStore } from "@/store/gameStore";
import { useSettingsStore } from "@/store/settingsStore";
import { useBugReportStore } from "@/store/bugReportStore";
import { resetSessionNavigation } from "@/store/sessionReset";
import { useDashboardLocationStore } from "@/store/dashboardLocationStore";
import type { GameStateData, PlayerData } from "@/store/gameStore";
import type { EndOfSeasonSummaryData } from "@/store/types";
import type { CallState } from "@/lib/dashboard/needsYourCall";

// ─── Mocks ───────────────────────────────────────────────────────────────

interface BlockerModalMock {
  blockers: { id: string; severity: string; text: string; tab: string }[];
  pendingAction?: () => void;
}

const shell = vi.hoisted(() => ({
  header: null as Record<string, unknown> | null,
  sidebar: null as Record<string, unknown> | null,
  home: null as Record<string, unknown> | null,
  /** What the backend probe answers; null answers the minimal game. */
  activeGame: null as GameStateData | null,
  blockerModal: null as BlockerModalMock | null,
  scrimResultNotice: null as string[] | null,
  dismissScrimResultNotice: vi.fn(),
  checkBlockingActions: vi.fn(),
}));

vi.mock("@/services/advanceTimeService", () => ({
  checkBlockingActions: shell.checkBlockingActions,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((command: string) => {
    if (command === "get_active_game") {
      return Promise.resolve(shell.activeGame ?? minimalGameState());
    }
    if (command === "get_champions") {
      return Promise.resolve([]);
    }
    return Promise.resolve();
  }),
}));

// One t for every render, as react-i18next gives, so memoised values stay put.
const stableT = vi.hoisted(() => (key: string) => key);
vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return { ...actual, useTranslation: () => ({ t: stableT }) };
});

const calls = vi.hoisted(() => ({ build: 0 }));
vi.mock("@/lib/dashboard/needsYourCall", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dashboard/needsYourCall")>();
  return {
    ...actual,
    buildCallItems: (input: Parameters<typeof actual.buildCallItems>[0]) => {
      calls.build += 1;
      return actual.buildCallItems(input);
    },
  };
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
    scrimResultNotice: shell.scrimResultNotice,
    dismissScrimResultNotice: shell.dismissScrimResultNotice,
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
  formatMatchDate: () => "Jun 19",
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
    return <div data-testid="dashboard-header" />;
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
  HomeTabV2: (props: Record<string, unknown>) => {
    shell.home = props;
    return (
      <div data-testid="home-tab-v2">
        <section id="needs-your-call" tabIndex={-1} aria-label="calls" />
      </div>
    );
  },
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
vi.mock("@/ui-v2/pages/StaffProfileV2", () => ({
  default: ({ staffId }: { staffId: string }) => <div data-testid="staff-profile" data-staff={staffId} />,
}));

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

// The location, the rail memory and the blocker cache outlive a render on purpose, so each test starts a fresh session.
beforeEach(() => {
  resetSessionNavigation();
  shell.activeGame = null;
});

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
  it("shows a staff profile opened while on Home, not the Home tab", async () => {
    const DashboardV2 = (await import("./DashboardV2")).default;
    useDashboardLocationStore.getState().go({ kind: "staff", id: "staff-1" });

    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <DashboardV2 />
      </MemoryRouter>,
    );

    expect((await screen.findByTestId("staff-profile")).getAttribute("data-staff")).toBe("staff-1");
    expect(screen.queryByTestId("home-tab-v2")).toBeNull();
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
    shell.scrimResultNotice = null;
    shell.dismissScrimResultNotice.mockReset();
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
    expect(link).toHaveClass("focus:min-h-[var(--target-min)]");

    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "main-content");
    expect(main).toHaveAttribute("tabindex", "-1");

    fireEvent.click(link);
    expect(document.activeElement).toBe(main);
  });

  it("hands the header a short date next to the full one", async () => {
    await renderDashboard();
    await screen.findByTestId("home-tab-v2");
    const { currentDate, currentDateShort } = shell.header as { currentDate: string; currentDateShort: string };
    expect(currentDateShort).toBeTruthy();
    expect(currentDateShort).not.toContain("2026");
    expect(currentDateShort.length).toBeLessThan(currentDate.length);
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
    });
    // The header no longer takes navigation or badges: the rail is the only navigation.
    expect(shell.header).not.toHaveProperty("onNavClick");
    expect(shell.header).not.toHaveProperty("badges");
    expect(shell.header).not.toHaveProperty("stripVisible");
    expect(typeof shell.header?.onShowCalls).toBe("function");
    expect(shell.sidebar).toMatchObject({ compact: false, activeTab: "Home" });
  });

  it("shows the scrim result notice on any tab and opens the Scrims tab from it", async () => {
    shell.scrimResultNotice = ["Won against Rivals"];
    await renderDashboard();
    fireEvent.click(await screen.findByRole("button", { name: "Training" }));
    await waitFor(() => expect(shell.header?.activeTab).toBe("Training"));

    expect(screen.getByRole("region", { name: "dashboard.scrimResultTitle" })).toHaveTextContent("Won against Rivals");
    fireEvent.click(screen.getByRole("button", { name: "dashboard.scrimResultOpen" }));

    expect(shell.dismissScrimResultNotice).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(shell.header?.activeTab).toBe("Scrims"));
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

  const scrimSetup = {
    id: "scrim_setup_required",
    severity: "warn",
    text: "Set up the weekly scrims",
    tab: "Scrims",
  };

  async function renderWithRetainedScrimSetup() {
    const DashboardV2 = (await import("./DashboardV2")).default;
    const tree = () => (
      <MemoryRouter initialEntries={["/dashboard"]}>
        <DashboardV2 />
      </MemoryRouter>
    );
    shell.blockerModal = { blockers: [scrimSetup] };
    const view = render(tree());
    await waitFor(() => expect(shell.header?.callCount).toBe(1));
    shell.blockerModal = null;
    view.rerender(tree());
    shell.checkBlockingActions.mockClear();
    return view;
  }

  it("keeps a scrim blocker only while the backend check still reports it", async () => {
    await renderWithRetainedScrimSetup();
    shell.checkBlockingActions.mockResolvedValue([scrimSetup]);
    act(() => useGameStore.setState({ gameState: { ...minimalGameState() } }));
    await waitFor(() =>
      expect(shell.checkBlockingActions).toHaveBeenCalledWith("dashboard-refresh", {
        rethrow: true,
        mode: "live",
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(shell.header?.callCount).toBe(1);

    // The manager sets a weekly objective: the backend no longer blocks.
    shell.checkBlockingActions.mockResolvedValue([]);
    act(() => useGameStore.setState({ gameState: { ...minimalGameState() } }));
    await waitFor(() => expect(shell.header?.callCount).toBe(0));
  });

  it("asks the backend with the delegate mode when the manager is unemployed", async () => {
    await renderWithRetainedScrimSetup();
    shell.checkBlockingActions.mockResolvedValue([]);
    act(() =>
      useGameStore.setState({
        gameState: { ...minimalGameState(), manager: { ...minimalGameState().manager, team_id: null } },
      }),
    );
    await waitFor(() =>
      expect(shell.checkBlockingActions).toHaveBeenCalledWith("dashboard-refresh", {
        rethrow: true,
        mode: "delegate",
      }),
    );
  });

  it("re-runs the refresh and clears the scrim blocker when the scrims delegation is switched to auto", async () => {
    await renderWithRetainedScrimSetup();
    // The game state does not change: only the settings store fires.
    shell.checkBlockingActions.mockResolvedValue([scrimSetup]);
    act(() => useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, scrim_review_mode: "assistant" } }));

    await waitFor(() => expect(shell.checkBlockingActions).toHaveBeenCalled());
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

    await waitFor(() => expect(shell.checkBlockingActions).toHaveBeenCalledWith("dashboard-refresh", { rethrow: true, mode: "live" }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(shell.header?.callCount).toBe(1);
  });

  const academyBlocker = {
    id: "academy_missing_roles",
    severity: "warn",
    text: "Academy incomplete",
    tab: "YouthAcademy",
  };

  const nextDay = () => {
    const state = minimalGameState();
    useGameStore.setState({
      gameState: { ...state, clock: { ...state.clock, current_date: "2025-06-20" } },
    });
  };

  it("lists the blockers the pre-check reports on Home without a Continue press", async () => {
    shell.checkBlockingActions.mockResolvedValue([academyBlocker]);
    await renderDashboard();
    await screen.findByTestId("home-tab-v2");

    await waitFor(() => expect(shell.header?.callCount).toBe(1));
    expect(shell.checkBlockingActions).toHaveBeenCalledWith("dashboard-refresh", {
      rethrow: true,
      mode: "live",
    });
  });

  it("shows the blocker that applies to the new day after the date changes", async () => {
    await renderDashboard();
    await screen.findByTestId("home-tab-v2");
    await waitFor(() => expect(shell.checkBlockingActions).toHaveBeenCalled());
    expect(shell.header?.callCount).toBe(0);

    shell.checkBlockingActions.mockResolvedValue([academyBlocker]);
    act(nextDay);
    await waitFor(() => expect(shell.header?.callCount).toBe(1));

    // Another day, nothing blocks any more: the panel goes back to empty.
    shell.checkBlockingActions.mockResolvedValue([]);
    act(() => {
      const state = minimalGameState();
      useGameStore.setState({
        gameState: { ...state, clock: { ...state.clock, current_date: "2025-06-21" } },
      });
    });
    await waitFor(() => expect(shell.header?.callCount).toBe(0));
  });

  it("keeps the previous list until the new day check answers, then drops it if the check fails", async () => {
    shell.checkBlockingActions.mockResolvedValue([academyBlocker]);
    await renderDashboard();
    await waitFor(() => expect(shell.header?.callCount).toBe(1));

    shell.checkBlockingActions.mockRejectedValue(new Error("backend down"));
    act(nextDay);
    // Never "all in order" while the answer is pending...
    expect(shell.header?.callCount).toBe(1);
    // ...and a stale list from another day is not kept once the check fails.
    await waitFor(() => expect(shell.checkBlockingActions).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(shell.header?.callCount).toBe(0));
  });

  it("does not check blockers while the blocker modal is open", async () => {
    shell.blockerModal = { blockers: [lineupBlocker] };
    await renderDashboard();
    await waitFor(() => expect(shell.header?.callCount).toBe(1));
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

describe("DashboardV2 Needs your call source (R18)", () => {
  const ROLES = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"] as const;

  /** Five starters whose contracts all end within 180 days: five decisions, two hidden by the cap of 3. */
  function expiringStartersState(): GameStateData {
    const base = minimalGameState();
    const players = ROLES.map(
      (role, i) =>
        ({
          id: `p-${role}`,
          match_name: role,
          full_name: `Player ${role}`,
          team_id: "team-1",
          position: role,
          natural_position: role,
          lol_ovr: 70,
          condition: 100,
          contract_end: `2025-0${7 + (i % 3)}-1${i}`,
        }) as unknown as PlayerData,
    );
    return {
      ...base,
      teams: [{ id: "team-1", name: "Test Team", active_lineup_ids: players.map((p) => p.id) }],
      players,
    } as unknown as GameStateData;
  }

  beforeEach(() => {
    shell.home = null;
    shell.header = null;
    shell.blockerModal = null;
    shell.checkBlockingActions.mockReset();
    shell.checkBlockingActions.mockResolvedValue([]);
    shell.activeGame = expiringStartersState();
    useGameStore.setState({
      hasActiveGame: true,
      managerName: "Coach",
      gameState: shell.activeGame,
      pendingSeasonSummary: null,
      isDirty: false,
      showFiredModal: false,
    });
    useSettingsStore.setState({ loaded: true });
  });

  async function renderDashboard() {
    const DashboardV2 = (await import("./DashboardV2")).default;
    const tree = () => (
      <MemoryRouter initialEntries={["/dashboard"]}>
        <DashboardV2 />
      </MemoryRouter>
    );
    return { view: render(tree()), tree };
  }

  it("gives the header chip the count of the call state Home renders, hidden contracts included", async () => {
    await renderDashboard();
    await screen.findByTestId("home-tab-v2");

    const homeCalls = shell.home?.calls as CallState;
    expect(homeCalls.count).toBe(5);
    expect(homeCalls.hiddenContracts).toBe(2);
    expect(homeCalls.items.filter((item) => item.kind === "contract")).toHaveLength(3);
    expect(shell.header?.callCount).toBe(homeCalls.count);
  });

  it("does not build the call items again on a render that changes none of their inputs", async () => {
    const { view, tree } = await renderDashboard();
    await screen.findByTestId("home-tab-v2");
    await waitFor(() => expect(shell.checkBlockingActions).toHaveBeenCalled());
    const before = calls.build;

    view.rerender(tree());
    view.rerender(tree());

    expect(calls.build).toBe(before);
  });
});

describe("DashboardV2 rail mode", () => {
  class MockResizeObserver {
    static all: MockResizeObserver[] = [];
    constructor(private cb: (entries: Array<{ contentRect: { width: number; height: number } }>) => void) {
      MockResizeObserver.all.push(this);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
    emit(width: number, height: number) {
      this.cb([{ contentRect: { width, height } }]);
    }
  }

  beforeEach(() => {
    MockResizeObserver.all = [];
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    document.documentElement.style.fontSize = "16px";
    useGameStore.setState({
      hasActiveGame: true,
      managerName: "Coach",
      gameState: minimalGameState(),
      isDirty: false,
      showFiredModal: false,
    });
    useSettingsStore.setState({ loaded: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.style.fontSize = "";
  });

  async function renderDashboard() {
    const DashboardV2 = (await import("./DashboardV2")).default;
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <DashboardV2 />
      </MemoryRouter>,
    );
  }
  const measure = (w: number, h: number) =>
    act(() => MockResizeObserver.all.forEach((o) => o.emit(w, h)));

  it("is Split while the body has no size", async () => {
    await renderDashboard();
    expect(shell.sidebar).toMatchObject({ railMode: "split" });
  });

  it("is already in Tree on the first committed render when the body has a size", async () => {
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 1280, height: 764, top: 0, left: 0, right: 1280, bottom: 764, x: 0, y: 0, toJSON() {},
    } as DOMRect);
    try {
      await renderDashboard();
      expect(shell.sidebar).toMatchObject({ railMode: "tree" });
      } finally {
      rect.mockRestore();
    }
  });

  it("hands the sidebar the attention map built from the call items", async () => {
    await renderDashboard();
    expect(shell.sidebar).toHaveProperty("attention");
    expect(shell.sidebar?.attention).toEqual({});
  });

  it("always passes Split on Android, whatever the body size, with the platform", async () => {
    document.documentElement.dataset.platform = "android";
    try {
      await renderDashboard();
      measure(5000, 5000);
      expect(shell.sidebar).toMatchObject({ railMode: "split", platform: "android" });
    } finally {
      delete document.documentElement.dataset.platform;
    }
  });

  it("passes Tree to the sidebar when the body fits the tree", async () => {
    await renderDashboard();
    measure(1280, 764);
    expect(shell.sidebar).toMatchObject({
      railMode: "tree",
      railSlot: { slotW: 1280, slotH: 764, need: 622 },
    });
  });

  it("falls back to Split at 960x640", async () => {
    await renderDashboard();
    measure(1280, 764);
    measure(960, 595);
    expect(shell.sidebar).toMatchObject({ railMode: "split" });
  });
});

describe("DashboardV2 attention lane (NR2.6)", () => {
  class MockResizeObserver {
    static all: MockResizeObserver[] = [];
    constructor(private cb: (entries: Array<{ contentRect: { width: number; height: number } }>) => void) {
      MockResizeObserver.all.push(this);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
    emit(width: number, height: number) {
      this.cb([{ contentRect: { width, height } }]);
    }
  }

  const academy = { id: "academy_missing_roles", severity: "warn", text: "Academy incomplete", tab: "YouthAcademy" };

  beforeEach(() => {
    MockResizeObserver.all = [];
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    document.documentElement.style.fontSize = "16px";
    Element.prototype.scrollIntoView = vi.fn();
    shell.header = null;
    shell.blockerModal = null;
    shell.scrimResultNotice = null;
    shell.checkBlockingActions.mockReset();
    shell.checkBlockingActions.mockResolvedValue([academy]);
    useGameStore.setState({
      hasActiveGame: true,
      managerName: "Coach",
      gameState: minimalGameState(),
      pendingSeasonSummary: null,
      isDirty: false,
      showFiredModal: false,
    });
    useSettingsStore.setState({ loaded: true });
    resetSessionNavigation();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.style.fontSize = "";
  });

  const lane = () => document.querySelector<HTMLElement>('[data-slot="attention-lane"]');

  /** Opens the dashboard on a tab, with a 1280 x `bodyHeight` body and one decision. */
  async function renderOn(tab: string, bodyHeight = 764) {
    if (tab !== "Home") useDashboardLocationStore.getState().go({ kind: "tab", tab });
    const DashboardV2 = (await import("./DashboardV2")).default;
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <DashboardV2 />
      </MemoryRouter>,
    );
    act(() => MockResizeObserver.all.forEach((o) => o.emit(1280, bodyHeight)));
    await waitFor(() => expect(shell.header?.callCount).toBe(1));
  }

  it("is absent on Home, whose panel lists the decisions", async () => {
    await renderOn("Home");
    expect(lane()).toBeNull();
  });

  it("shows off Home, after the header and before the scrim notice and the main region", async () => {
    shell.scrimResultNotice = ["Scrim won 2-1"];
    await renderOn("Training");
    await waitFor(() => expect(lane()).not.toBeNull());
    const header = screen.getByTestId("dashboard-header");
    const notice = document.querySelector('[data-slot="scrim-result-notice"]')!;
    const main = document.getElementById("main-content")!;
    const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(notice).not.toBeNull();
    expect(follows(header, lane()!)).toBe(true);
    expect(follows(lane()!, notice)).toBe(true);
    expect(follows(notice, main)).toBe(true);
  });

  it("gives way below 380 px of body", async () => {
    await renderOn("Training", 379);
    expect(lane()).toBeNull();
  });

  it("acting on a pill goes to the call's tab and puts focus on the main region", async () => {
    await renderOn("Training");
    const pill = await screen.findByRole("button", { name: /Academy incomplete/ });
    fireEvent.click(pill);
    // The academy rule sends the call to the Youth tab.
    await waitFor(() => expect(shell.header?.activeTab).toBe("Youth"));
    expect(document.activeElement).toBe(document.getElementById("main-content"));
  });

  it("leaves focus on Home's panel after its pinned pill, not on the main region (R47)", async () => {
    await renderOn("Training");
    await waitFor(() => expect(lane()).not.toBeNull());
    const pin = lane()!.querySelector<HTMLButtonElement>('[data-pill-id="lane:home"]')!;
    act(() => pin.focus());
    fireEvent.click(pin);
    await screen.findByTestId("home-tab-v2");
    expect(lane()).toBeNull();
    await waitFor(() => expect(document.activeElement?.id).toBe("needs-your-call"));
  });

  it("focuses the main region even when the call's place is the current one", async () => {
    await renderOn("Youth");
    fireEvent.click(await screen.findByRole("button", { name: /Academy incomplete/ }));
    expect(document.activeElement).toBe(document.getElementById("main-content"));
  });
});
