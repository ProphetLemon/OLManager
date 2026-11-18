import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import type { GameStateData } from "@/store/gameStore";
import { useGameStore } from "@/store/gameStore";
import { useSettingsStore } from "@/store/settingsStore";
import { resetSessionNavigation } from "@/store/sessionReset";
import { ROUTE_ANNOUNCE_DEBOUNCE_MS, RouteAnnouncer, useRouteAnnouncer } from "./RouteAnnouncer";

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

// The rail: a plain button per move, so a rail click is one onNavClick.
vi.mock("@/ui-v2/dashboard/DashboardSidebarV2", () => ({
  DashboardSidebarV2: ({ onNavClick }: { onNavClick: (tab: string) => void }) => (
    <nav aria-label="Main navigation">
      <button onClick={() => onNavClick("Squad")}>rail-squad</button>
    </nav>
  ),
}));
vi.mock("@/ui-v2/dashboard/tabs/HomeTabV2", () => ({ HomeTabV2: () => <div data-testid="home-tab" /> }));
vi.mock("@/ui-v2/dashboard/tabs/SquadTabV2", () => ({
  SquadTabV2: ({ onSelectPlayer }: { onSelectPlayer: (id: string) => void }) => (
    <div data-testid="squad-tab">
      <button onClick={() => onSelectPlayer("p1")}>open-p1</button>
    </div>
  ),
}));
vi.mock("@/ui-v2/pages/PlayerProfileV2", () => ({
  default: ({ onSelectTeam }: { onSelectTeam: (id: string) => void }) => (
    <div data-testid="player-profile">
      <button onClick={() => onSelectTeam("team-1")}>open-team-1</button>
    </div>
  ),
}));
vi.mock("@/ui-v2/pages/TeamProfileV2", () => ({
  default: ({ onClose, backTo }: { onClose: () => void; backTo?: string | null }) => (
    <div data-testid="team-profile">
      <button onClick={onClose}>{`in-page-back to ${String(backTo)}`}</button>
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
      team_id: "team-1",
    },
    clock: { current_date: "2025-06-19", start_date: "2025-01-01" },
    day_phase: "Morning",
    teams: [{ id: "team-1", name: "Test Team", logo_url: null }],
    players: [{ id: "p1", match_name: "Faker", team_id: "team-1", transfer_offers: [] }],
    staff: [],
    messages: [],
    news: [],
    leagues: [],
    scouting_assignments: [],
    board_objectives: [],
    champions: [],
  } as unknown as GameStateData;
}

const announcer = () => document.querySelector<HTMLElement>('[data-slot="route-announcer"]')!;
/** Long enough for the trailing debounce to have posted anything it holds. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, ROUTE_ANNOUNCE_DEBOUNCE_MS + 50)));

describe("useRouteAnnouncer", () => {
  afterEach(() => vi.useRealTimers());

  it("posts after a short quiet spell, and the last message of a burst wins", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useRouteAnnouncer());
    act(() => {
      result.current.announce("Now on Squad, Club");
      result.current.announce("Now on Home");
    });
    expect(result.current.message).toBe("");
    act(() => vi.advanceTimersByTime(ROUTE_ANNOUNCE_DEBOUNCE_MS));
    expect(result.current.message).toBe("Now on Home");
  });

  it("changes the region's text when the same message comes again, so it is spoken again", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useRouteAnnouncer());
    act(() => result.current.announce("Now on Home"));
    act(() => vi.advanceTimersByTime(ROUTE_ANNOUNCE_DEBOUNCE_MS));
    const first = result.current.message;
    act(() => result.current.announce("Now on Home"));
    act(() => vi.advanceTimersByTime(ROUTE_ANNOUNCE_DEBOUNCE_MS));
    expect(result.current.message).not.toBe(first);
    expect(result.current.message.trim()).toBe("Now on Home");
  });
});

describe("RouteAnnouncer", () => {
  it("is one polite, atomic, visually hidden status region", () => {
    render(<RouteAnnouncer message="Now on Home" />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveAttribute("aria-atomic", "true");
    expect(region.className).toContain("sr-only");
    expect(region).toHaveTextContent("Now on Home");
  });
});

describe("the route announcer in the dashboard (R46)", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
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

  const renderDashboard = async () => {
    const DashboardV2 = (await import("./DashboardV2")).default;
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <DashboardV2 />
      </MemoryRouter>,
    );
    await screen.findByTestId("home-tab", {}, { timeout: 3000 });
  };

  it("is mounted once and says nothing on mount or after a rail move", async () => {
    await renderDashboard();
    expect(document.querySelectorAll('[data-slot="route-announcer"]')).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "rail-squad" }));
    await screen.findByTestId("squad-tab", {}, { timeout: 3000 });
    await settle();
    // The rail row's aria-current already speaks the move.
    expect(announcer()).toHaveTextContent("");
  });

  it("says 'Now on Squad, Club' after the header Back, which keeps focus", async () => {
    await renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: "rail-squad" }));
    fireEvent.click(await screen.findByRole("button", { name: "open-p1" }, { timeout: 3000 }));
    await screen.findByTestId("player-profile", {}, { timeout: 3000 });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Faker");

    const back = screen.getByRole("button", { name: "Back to Squad" });
    act(() => back.focus());
    fireEvent.click(back);

    await waitFor(() => expect(announcer()).toHaveTextContent("Now on Squad, Club"));
    expect(back).toHaveFocus();
  });

  it("moves focus to main and speaks the arrival after an in-page Back, whose button goes away", async () => {
    await renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: "rail-squad" }));
    fireEvent.click(await screen.findByRole("button", { name: "open-p1" }, { timeout: 3000 }));
    fireEvent.click(await screen.findByRole("button", { name: "open-team-1" }, { timeout: 3000 }));
    // The in-page Back names the same place as the header's (R41).
    expect(screen.getByRole("button", { name: "Back to Faker" })).toBeInTheDocument();
    const inPage = await screen.findByRole("button", { name: "in-page-back to Faker" }, { timeout: 3000 });
    act(() => inPage.focus());
    fireEvent.click(inPage);

    await screen.findByTestId("player-profile", {}, { timeout: 3000 });
    expect(document.getElementById("main-content")).toHaveFocus();
    await waitFor(() => expect(announcer()).toHaveTextContent("Now on Faker, Club"));
  });

  it("says nothing when Back has nowhere to go", async () => {
    await renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: "Nothing to go back to" }));
    await settle();
    expect(announcer()).toHaveTextContent("");
  });
});
