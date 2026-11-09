import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { FixtureData, GameStateData, PlayerData, TeamData } from "@/store/gameStore";
import type { BlockerData } from "@/services/advanceTimeService";
import type { DashboardAlert } from "@/lib/dashboard/helpers";
import { HomeTabV2 } from "./HomeTabV2";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const template = typeof opts?.defaultValue === "string" ? opts.defaultValue : key;
      return template.replace(/\{\{(\w+)\}\}/g, (_, name) => String(opts?.[name] ?? ""));
    },
    i18n: { language: "en" },
  }),
}));

vi.mock("@/lib/teams/teamLogos", () => ({
  resolveTeamLogo: () => null,
}));

// Backend i18n is a pass-through here; the real one needs a loaded catalogue.
vi.mock("@/lib/i18n/backendI18n", () => ({
  resolveMessage: (message: unknown) => message,
}));

const ROLES = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"] as const;

function createTeam(id: string, name: string, short: string, extra: Partial<TeamData> = {}): TeamData {
  return {
    id,
    name,
    short_name: short,
    logo_url: null,
    colors: { primary: "#2563eb", secondary: "#f59e0b" },
    form: [],
    active_lineup_ids: [],
    ...extra,
  } as unknown as TeamData;
}

function roster(teamId: string): PlayerData[] {
  return ROLES.map(
    (role, i) =>
      ({
        id: `${teamId}-${role}`,
        match_name: `${teamId}-${role}`.toUpperCase(),
        full_name: `${teamId} ${role}`,
        team_id: teamId,
        position: role,
        natural_position: role,
        lol_ovr: 70 + i,
        contract_end: "2030-01-01",
      }) as unknown as PlayerData,
  );
}

function fixture(): FixtureData {
  return {
    id: "f1",
    matchday: 3,
    date: "2025-03-20",
    home_team_id: "team-1",
    away_team_id: "team-2",
    match_type: "League",
    status: "Scheduled",
    result: null,
  } as unknown as FixtureData;
}

function stateWithFixture(overrides: Partial<GameStateData> = {}): GameStateData {
  return minimalGameState({
    teams: [
      createTeam("team-1", "Test Team", "TEA"),
      createTeam("team-2", "Opponent FC", "OPP"),
    ],
    players: [...roster("team-1"), ...roster("team-2")],
    user_competition_id: "comp-1",
    leagues: [
      {
        id: "comp-1",
        name: "Test League",
        competition_id: "comp-1",
        season: 1,
        logo: null,
        fixtures: [fixture()],
        standings: [
          { team_id: "team-1", played: 2, won: 2, lost: 0, points: 6 },
          { team_id: "team-2", played: 2, won: 0, lost: 2, points: 0 },
        ],
      },
    ] as unknown as GameStateData["leagues"],
    ...overrides,
  });
}

function minimalGameState(overrides: Partial<GameStateData> = {}): GameStateData {
  return {
    manager: { team_id: "team-1", name: "Coach" },
    teams: [createTeam("team-1", "Test Team", "TEA")],
    players: [],
    leagues: [],
    clock: { current_date: "2025-03-15" },
    day_phase: "Morning",
    messages: [],
    news: [],
    champion_masteries: [],
    user_competition_id: null,
    ...overrides,
  } as unknown as GameStateData;
}

function message(id: string, date: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    subject: `Subject ${id}`,
    body: "",
    sender: "Board",
    sender_role: "",
    date,
    read: false,
    category: "Board",
    priority: "Normal",
    actions: [],
    context: { team_id: null },
    ...extra,
  };
}

describe("HomeTabV2", () => {
  it("renders the scoreboard hero when a fixture exists", () => {
    render(<HomeTabV2 gameState={stateWithFixture()} />);
    const hero = document.querySelector('[data-slot="scoreboard-hero"]');
    expect(hero).not.toBeNull();
    expect(hero).not.toHaveAttribute("data-empty");
    expect(within(hero as HTMLElement).getByText("Next Match")).toBeInTheDocument();
  });

  it("shows the hero empty state when there is no fixture", () => {
    render(<HomeTabV2 gameState={minimalGameState()} />);
    const hero = document.querySelector('[data-slot="scoreboard-hero"]');
    expect(hero).toHaveAttribute("data-empty", "true");
    expect(screen.getByText("No fixtures scheduled")).toBeInTheDocument();
  });

  it("opens schedule and squad from the hero", () => {
    const onNavigate = vi.fn();
    render(<HomeTabV2 gameState={stateWithFixture()} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: "Squad" }));
    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
    expect(onNavigate).toHaveBeenNthCalledWith(1, "Squad");
    expect(onNavigate).toHaveBeenNthCalledWith(2, "Schedule");
  });

  it("lists blockers and alerts in the focusable Needs your call panel", () => {
    const blockers: BlockerData[] = [
      { id: "incomplete_lineup", severity: "warn", text: "Starting five is incomplete", tab: "Squad" },
    ];
    const alerts: DashboardAlert[] = [
      { id: "finance_runway", text: "Cash is running low", tab: "Finances", severity: "warn" },
    ];
    render(<HomeTabV2 gameState={stateWithFixture()} blockers={blockers} alerts={alerts} />);
    const panel = document.getElementById("needs-your-call");
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute("tabindex", "-1");
    expect(within(panel as HTMLElement).getByText("Starting five is incomplete")).toBeInTheDocument();
    expect(within(panel as HTMLElement).getByText("Cash is running low")).toBeInTheDocument();
  });

  it("shows the empty Needs your call state with nothing pending", () => {
    render(<HomeTabV2 gameState={stateWithFixture()} />);
    expect(screen.getAllByText("Nothing needs your call").length).toBeGreaterThan(0);
  });

  it("navigates to the target tab when a call is acted on", () => {
    const onNavigate = vi.fn();
    const blockers: BlockerData[] = [
      { id: "incomplete_lineup", severity: "warn", text: "Starting five is incomplete", tab: "Squad" },
    ];
    render(<HomeTabV2 gameState={stateWithFixture()} blockers={blockers} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: "Fix lineup" }));
    expect(onNavigate).toHaveBeenCalledWith("Squad", undefined);
  });

  it("opens the profile with the renewal flow for a contract call", () => {
    const onSelectPlayer = vi.fn();
    const players = roster("team-1");
    players[0] = { ...players[0], contract_end: "2025-04-01" } as PlayerData;
    const gs = stateWithFixture({
      players,
      teams: [
        createTeam("team-1", "Test Team", "TEA", { active_lineup_ids: players.map((p) => p.id) }),
        createTeam("team-2", "Opponent FC", "OPP"),
      ],
    });
    render(<HomeTabV2 gameState={gs} onSelectPlayer={onSelectPlayer} />);
    fireEvent.click(screen.getByRole("button", { name: "Renew" }));
    expect(onSelectPlayer).toHaveBeenCalledWith("team-1-TOP", { openRenewal: true });
  });

  it("shows the latest three messages and marks High priority as urgent", () => {
    const messages = [
      message("m1", "2025-03-10"),
      message("m2", "2025-03-11"),
      message("m3", "2025-03-12", { priority: "High" }),
      message("m4", "2025-03-13"),
    ];
    const onNavigate = vi.fn();
    render(
      <HomeTabV2
        gameState={stateWithFixture({ messages: messages as unknown as GameStateData["messages"] })}
        unreadCount={4}
        onNavigate={onNavigate}
      />,
    );
    const inbox = document.querySelector('[data-slot="inbox-panel"]') as HTMLElement;
    expect(within(inbox).getByText("Subject m4")).toBeInTheDocument();
    expect(within(inbox).getByText("Subject m3")).toBeInTheDocument();
    expect(within(inbox).getByText("Subject m2")).toBeInTheDocument();
    expect(within(inbox).queryByText("Subject m1")).not.toBeInTheDocument();
    expect(within(inbox).getByText("4 unread")).toBeInTheDocument();
    // m3 is the only message with the backend's capitalised "High" priority.
    const urgentRow = within(inbox).getByText("Subject m3").closest("button") as HTMLElement;
    const normalRow = within(inbox).getByText("Subject m4").closest("button") as HTMLElement;
    expect(urgentRow.querySelector("svg")).not.toBeNull();
    expect(normalRow.querySelector("svg")).toBeNull();
  });

  it("opens the standings table and navigates to Teams", () => {
    const onNavigate = vi.fn();
    render(<HomeTabV2 gameState={stateWithFixture()} onNavigate={onNavigate} />);
    const table = screen.getByRole("table");
    expect(within(table).getByText("TEA")).toBeInTheDocument();
    fireEvent.click(within(table).getByText("OPP"));
    expect(onNavigate).toHaveBeenCalledWith("Teams");
  });

  it("flags the preseason standings and keeps the opponent form line", () => {
    const gs = stateWithFixture({
      leagues: [
        {
          id: "comp-1",
          name: "Test League",
          competition_id: "comp-1",
          season: 1,
          logo: null,
          fixtures: [fixture()],
          standings: [],
        },
      ] as unknown as GameStateData["leagues"],
    });
    render(<HomeTabV2 gameState={gs} />);
    expect(document.querySelector('[data-slot="standings-preseason"]')).not.toBeNull();
    expect(screen.getByText("Opponent FC's form appears after their first match")).toBeInTheDocument();
  });

  it("does not render the retired phase, opponent or finance cards", () => {
    render(<HomeTabV2 gameState={stateWithFixture()} />);
    expect(screen.queryByText("Finances")).not.toBeInTheDocument();
    expect(screen.queryByText("Today")).not.toBeInTheDocument();
  });
});
