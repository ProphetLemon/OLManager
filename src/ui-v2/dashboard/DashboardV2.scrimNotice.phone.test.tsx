// The whole file runs as a phone: the dashboard reads the user agent while it renders.
vi.hoisted(() => {
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: "Mozilla/5.0 (Linux; Android 14; CPH2449) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36",
  });
});

import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { useGameStore } from "@/store/gameStore";
import { useSettingsStore } from "@/store/settingsStore";
import type { GameStateData } from "@/store/gameStore";
import { useDashboardLocationStore } from "@/store/dashboardLocationStore";
import { resetSessionNavigation } from "@/store/sessionReset";

const shell = vi.hoisted(() => ({
  scrimResultNotice: null as string[] | null,
  autoDelegationNotice: null as string | null,
  dismissScrimResultNotice: vi.fn(),
}));

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
    autoDelegationNotice: shell.autoDelegationNotice,
    matchPlayedNotice: null,
    scrimResultNotice: shell.scrimResultNotice,
    dismissScrimResultNotice: shell.dismissScrimResultNotice,
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
// Home lists the call items, so the assistant's note can be found where the dashboard sends it.
vi.mock("@/ui-v2/dashboard/tabs/HomeTabV2", () => ({
  HomeTabV2: ({ calls }: { calls: { items: { id: string; headline: string }[] } }) => (
    <ul data-testid="home-calls">
      {calls.items.map((item) => (
        <li key={item.id}>{item.headline}</li>
      ))}
    </ul>
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

const NOTICE = '[data-slot="scrim-result-notice"]';

describe("the scrim result banner on a phone", () => {
  beforeEach(() => {
    shell.scrimResultNotice = ["Won against Rivals"];
    shell.autoDelegationNotice = null;
    shell.dismissScrimResultNotice.mockClear();
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

  const renderOn = async (tab: "Scrims" | "Youth" | "Home") => {
    useDashboardLocationStore.getState().go({ kind: "tab", tab });
    const DashboardV2 = (await import("./DashboardV2")).default;
    return render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <DashboardV2 />
      </MemoryRouter>,
    );
  };

  it("is not drawn while the Scrims tab is on screen, and what the player saw there is dismissed", async () => {
    await renderOn("Scrims");
    await screen.findByTestId("scrims-tab-v2", {}, { timeout: 3000 });
    expect(document.querySelector(NOTICE)).toBeNull();
    await waitFor(() => expect(shell.dismissScrimResultNotice).toHaveBeenCalled());
  });

  it("is drawn as before on another tab of the phone and is not dismissed there", async () => {
    await renderOn("Youth");
    await screen.findByTestId("youth-tab-v2", {}, { timeout: 3000 });
    expect(document.querySelector(NOTICE)).toHaveTextContent("Won against Rivals");
    expect(shell.dismissScrimResultNotice).not.toHaveBeenCalled();
  });

  it("is dismissed when the player moves to Scrims, so it does not come back on the next tab", async () => {
    await renderOn("Youth");
    await screen.findByTestId("youth-tab-v2", {}, { timeout: 3000 });
    act(() => useDashboardLocationStore.getState().go({ kind: "tab", tab: "Scrims" }));
    await screen.findByTestId("scrims-tab-v2");
    expect(document.querySelector(NOTICE)).toBeNull();
    expect(shell.dismissScrimResultNotice).toHaveBeenCalled();
  });

  it("holds only while the Scrims body is on screen: a profile open over it still shows the banner and keeps the notice", async () => {
    await renderOn("Scrims");
    await screen.findByTestId("scrims-tab-v2", {}, { timeout: 3000 });
    shell.dismissScrimResultNotice.mockClear();
    shell.scrimResultNotice = ["Won against Rivals"];
    act(() => useDashboardLocationStore.getState().go({ kind: "player", id: "p-1" }));
    await waitFor(() => expect(document.querySelector(NOTICE)).not.toBeNull());
    expect(shell.dismissScrimResultNotice).not.toHaveBeenCalled();
  });

  it("keeps the assistant's note reachable: it goes to the dashboard's calls, as when there is no result notice", async () => {
    shell.autoDelegationNotice = "Assistant played the block";
    await renderOn("Home");
    const calls = await screen.findByTestId("home-calls");
    // On Home the banner still carries the note and the calls do not repeat it.
    expect(calls).not.toHaveTextContent("Assistant played the block");

    act(() => useDashboardLocationStore.getState().go({ kind: "tab", tab: "Scrims" }));
    await screen.findByTestId("scrims-tab-v2");
    expect(document.querySelector(NOTICE)).toBeNull();

    shell.scrimResultNotice = null; // what the dismissal does to the hook's state
    act(() => useDashboardLocationStore.getState().go({ kind: "tab", tab: "Home" }));
    expect(await screen.findByTestId("home-calls")).toHaveTextContent("Assistant played the block");
  });
});
