// The whole file runs as a phone: the dashboard reads the user agent while it renders.
vi.hoisted(() => {
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: "Mozilla/5.0 (Linux; Android 14; CPH2449) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36",
  });
});

import { render, screen } from "@testing-library/react";
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

vi.mock("@/ui-v2/dashboard/tabs/ScrimsTabV2", () => ({
  ScrimsTabV2: () => <div data-testid="scrims-tab-v2" />,
}));
vi.mock("@/ui-v2/dashboard/tabs/YouthTabV2", () => ({
  YouthTabV2: () => <div data-testid="youth-tab-v2" />,
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

describe("DashboardV2 wrapper of a fixed-pane tab on a phone", () => {
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

  const renderTab = async (tab: "Scrims" | "Youth") => {
    useDashboardLocationStore.getState().go({ kind: "tab", tab });
    const DashboardV2 = (await import("./DashboardV2")).default;
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <DashboardV2 />
      </MemoryRouter>,
    );
    return await screen.findByTestId(tab === "Scrims" ? "scrims-tab-v2" : "youth-tab-v2", {}, { timeout: 3000 });
  };

  it("marks the direct child of #main-content that holds the Scrims tab, so the page-scroll rule lets go of it", async () => {
    const tab = await renderTab("Scrims");
    const wrapper = tab.parentElement as HTMLElement;
    expect(wrapper.parentElement).toBe(document.getElementById("main-content"));
    expect(wrapper).toHaveAttribute("data-phone-fixed");
  });

  it("does not mark the wrapper of another tab", async () => {
    const tab = await renderTab("Youth");
    const wrapper = tab.parentElement as HTMLElement;
    expect(wrapper.parentElement).toBe(document.getElementById("main-content"));
    expect(wrapper).not.toHaveAttribute("data-phone-fixed");
  });
});
