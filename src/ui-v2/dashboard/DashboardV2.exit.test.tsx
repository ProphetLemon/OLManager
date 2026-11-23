import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";

import { useGameStore } from "@/store/gameStore";
import { useSettingsStore } from "@/store/settingsStore";
import type { GameStateData } from "@/store/gameStore";
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

function Menu() {
  const navigate = useNavigate();
  return (
    <div>
      <p>main-menu</p>
      <button onClick={() => navigate(-1)}>system-back</button>
    </div>
  );
}

describe("DashboardV2 leaving a game", () => {
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

  // The menu opened the dashboard (a push), so history is [menu, dashboard].
  const renderFromMenu = async () => {
    const DashboardV2 = (await import("./DashboardV2")).default;
    return render(
      <MemoryRouter initialEntries={["/", "/dashboard"]} initialIndex={1}>
        <Routes>
          <Route path="/" element={<Menu />} />
          <Route path="/dashboard" element={<DashboardV2 />} />
        </Routes>
      </MemoryRouter>,
    );
  };

  // Android's system Back after leaving: it must not bring back a game that is no longer loaded.
  const expectBackStaysOnMenu = async () => {
    await screen.findByText("main-menu");
    fireEvent.click(screen.getByRole("button", { name: "system-back" }));
    await waitFor(() => expect(screen.getByText("main-menu")).toBeInTheDocument());
    expect(screen.queryByRole("navigation", { name: /main navigation/i })).not.toBeInTheDocument();
  };

  it.each([
    ["Save & Exit", /save & exit/i],
    ["Exit without saving", /exit without saving/i],
  ])("replaces the dashboard's history entry on %s", async (_label, choice) => {
    await renderFromMenu();
    fireEvent.click(await screen.findByRole("button", { name: /exit to menu/i }));
    fireEvent.click(await screen.findByRole("button", { name: choice }));

    await expectBackStaysOnMenu();
  });
});
