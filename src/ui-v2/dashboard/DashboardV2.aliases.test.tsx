import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { useGameStore } from "@/store/gameStore";
import { useSettingsStore } from "@/store/settingsStore";
import type { GameStateData } from "@/store/gameStore";
import { useDashboardLocationStore } from "@/store/dashboardLocationStore";
import { resetSessionNavigation } from "@/store/sessionReset";

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

vi.mock("@/ui-v2/dashboard/tabs/HomeTabV2", () => ({
  HomeTabV2: ({ onNavigate }: { onNavigate: (tab: string) => void }) => (
    <button onClick={() => onNavigate("YouthAcademy")}>go-youth-academy</button>
  ),
}));
vi.mock("@/ui-v2/dashboard/tabs/YouthTabV2", () => ({
  YouthTabV2: ({ onSelectPlayer }: { onSelectPlayer: (id: string, options?: { openRenewal?: boolean }) => void }) => (
    <div data-testid="youth-tab-v2">
      <button onClick={() => onSelectPlayer("p1", { openRenewal: true })}>renew-p1</button>
    </div>
  ),
}));
vi.mock("@/ui-v2/pages/PlayerProfileV2", () => ({
  default: ({
    startWithRenewalModal,
    onClose,
    onSelectTeam,
  }: {
    startWithRenewalModal?: boolean;
    onClose: () => void;
    onSelectTeam: (id: string) => void;
  }) => (
    <div data-testid="player-profile" data-renewal={String(startWithRenewalModal)}>
      <button onClick={onClose}>close-profile</button>
      <button onClick={() => onSelectTeam("team-1")}>open-team-1</button>
    </div>
  ),
}));
vi.mock("@/ui-v2/pages/TeamProfileV2", () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="team-profile">
      <button onClick={onClose}>close-team</button>
    </div>
  ),
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
    teams: [{ id: "team-1", name: "Test Team", logo_url: null }],
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

describe("DashboardV2 backend tab aliases", () => {
  beforeEach(() => {
    useGameStore.setState({
      hasActiveGame: true,
      managerName: "Coach",
      gameState: game(),
      pendingSeasonSummary: null,
      isDirty: false,
      showFiredModal: false,
    });
    useSettingsStore.setState({ loaded: true });
    resetSessionNavigation();
  });

  const renderAt = async (path: string) => {
    const DashboardV2 = (await import("./DashboardV2")).default;
    return render(
      <MemoryRouter initialEntries={[path]}>
        <DashboardV2 />
      </MemoryRouter>,
    );
  };

  it("lands the backend 'YouthAcademy' tab on the v2 Youth tab", async () => {
    const DashboardV2 = (await import("./DashboardV2")).default;

    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <DashboardV2 />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "go-youth-academy" }));

    expect(await screen.findByTestId("youth-tab-v2", {}, { timeout: 3000 })).toBeInTheDocument();
  });

  it("returns to the same tab after the dashboard unmounts, as Settings or a match do", async () => {
    const DashboardV2 = (await import("./DashboardV2")).default;

    const first = render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <DashboardV2 />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "go-youth-academy" }));
    expect(await screen.findByTestId("youth-tab-v2", {}, { timeout: 3000 })).toBeInTheDocument();
    first.unmount();

    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <DashboardV2 />
      </MemoryRouter>,
    );
    expect(await screen.findByTestId("youth-tab-v2", {}, { timeout: 3000 })).toBeInTheDocument();
  });

  it("keeps an open profile across an unmount, as Settings or a match do, and Back still reaches the tab", async () => {
    const first = await renderAt("/dashboard");
    fireEvent.click(await screen.findByRole("button", { name: "go-youth-academy" }));
    fireEvent.click(await screen.findByRole("button", { name: "renew-p1" }, { timeout: 3000 }));
    expect((await screen.findByTestId("player-profile")).dataset.renewal).toBe("true");
    first.unmount();

    await renderAt("/dashboard");
    const profile = await screen.findByTestId("player-profile", {}, { timeout: 3000 });
    // The renewal intent rode the first visit only; the return does not reopen it.
    expect(profile.dataset.renewal).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "close-profile" }));
    expect(await screen.findByTestId("youth-tab-v2", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByTestId("player-profile")).toBeNull();
  });

  it("skips a profile whose player has left the game when going back", async () => {
    await renderAt("/dashboard");
    fireEvent.click(await screen.findByRole("button", { name: "go-youth-academy" }));
    // p1 is not among the game's players: it was released or retired since.
    fireEvent.click(await screen.findByRole("button", { name: "renew-p1" }, { timeout: 3000 }));
    fireEvent.click(await screen.findByRole("button", { name: "open-team-1" }));
    fireEvent.click(await screen.findByRole("button", { name: "close-team" }, { timeout: 3000 }));

    expect(await screen.findByTestId("youth-tab-v2", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByTestId("player-profile")).toBeNull();
  });

  it("lets an alias route win over the remembered location", async () => {
    useDashboardLocationStore.getState().go({ kind: "tab", tab: "Youth" });
    await renderAt("/finanzas");

    await screen.findByRole("navigation", { name: "Main navigation" });
    expect(screen.queryByTestId("youth-tab-v2")).toBeNull();
    expect(useDashboardLocationStore.getState().nav.activeTab).toBe("Finances");
  });

  it("never commits the remembered tab on an alias mount, so its effects never run", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockClear();
    useDashboardLocationStore.getState().go({ kind: "tab", tab: "Youth" });
    await renderAt("/finanzas");

    await screen.findByRole("navigation", { name: "Main navigation" });
    const presence = vi.mocked(invoke).mock.calls.filter(([command]) => command === "update_discord_presence");
    expect(presence.length).toBeGreaterThan(0);
    expect(presence.map(([, args]) => args)).not.toContainEqual({ stateKey: "youth" });
  });

  it("keeps the alias route when the backend probe activates the game after mount", async () => {
    useGameStore.setState({ hasActiveGame: false, gameState: null });
    await renderAt("/finanzas");

    await screen.findByRole("navigation", { name: "Main navigation" });
    expect(useGameStore.getState().hasActiveGame).toBe(true);
    expect(useDashboardLocationStore.getState().nav.activeTab).toBe("Finances");
  });

  it("opens on Home once the session is reset", async () => {
    useDashboardLocationStore.getState().go({ kind: "tab", tab: "Youth" });
    resetSessionNavigation();
    const DashboardV2 = (await import("./DashboardV2")).default;

    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <DashboardV2 />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("button", { name: "go-youth-academy" })).toBeInTheDocument();
    expect(screen.queryByTestId("youth-tab-v2")).toBeNull();
  });
});
