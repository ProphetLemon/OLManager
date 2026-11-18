import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import "@/i18n";
import type { ChampionData } from "@/store/types";
import type { GameStateData, MessageData, NewsArticle, PlayerData } from "@/store/gameStore";
import { useTabUiStore } from "@/store/tabUiStore";
import ChampionsGridV2 from "@/ui-v2/components/ChampionsGridV2";
import { CompetitionsTabV2 } from "./CompetitionsTabV2";
import { InboxTabV2 } from "./InboxTabV2";
import { MarketTabV2 } from "./MarketTabV2";
import { NewsTabV2 } from "./NewsTabV2";
import { PlayersTabV2 } from "./PlayersTabV2";
import { ScheduleTabV2 } from "./ScheduleTabV2";
import { TeamsTabV2 } from "./TeamsTabV2";

const TRANSFERS = [
  { id: "x1", player_name: "Mine", is_user_involved: true },
  { id: "x2", player_name: "Theirs", is_user_involved: false },
].map((entry) => ({
  player_id: entry.id,
  player_ovr: 70,
  player_position: "MID",
  player_profile_image_url: null,
  from_team_id: "a",
  from_team_name: "From",
  to_team_id: "b",
  to_team_name: "To",
  fee: 1000,
  annual_wage: 100,
  contract_years: 1,
  date: "2026-08-01",
  is_user_buying: entry.is_user_involved,
  ...entry,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((command: string) =>
    Promise.resolve(command === "get_transfer_history_cmd" ? TRANSFERS : []),
  ),
}));

// R23: a World or direct tab keeps its view, filters, sort, page and selection
// when it unmounts for a profile visit and mounts again on Back. Each case
// changes the state through the real control, remounts, and reads it again.

afterEach(() => vi.useRealTimers());

// ─── Fixtures ────────────────────────────────────────────────────

function scheduleState(): GameStateData {
  const fixture = (id: string, date: string, matchday: number) => ({
    id, matchday, date, home_team_id: "t1", away_team_id: "t2", competition: "League",
    match_type: "League", best_of: 1, status: "Scheduled", result: null,
  });
  return {
    clock: { current_date: "2027-01-01T12:00:00Z" },
    manager: { team_id: "t1" },
    teams: [
      { id: "t1", name: "Alpha", short_name: "ALP", logo_url: null },
      { id: "t2", name: "Beta", short_name: "BET", logo_url: null },
    ],
    players: [],
    user_competition_id: "lec",
    leagues: [
      {
        id: "lg1",
        competition_id: "lec",
        name: "LEC",
        standings: [],
        fixtures: [fixture("f1", "2027-01-02", 1), fixture("f2", "2027-02-08", 4)],
      },
    ],
  } as unknown as GameStateData;
}

function competitionsState(): GameStateData {
  const league = (id: string, name: string) => ({
    id: `${id}-league`, competition_id: id, name, tier: 1, active: true, season: 1, standings: [], fixtures: [],
  });
  return {
    leagues: [league("lec", "LEC"), league("lck", "LCK")],
    teams: [
      { id: "t1", name: "Alpha", short_name: "ALP", competition_id: "lec" },
      { id: "t2", name: "Beta", short_name: "BET", competition_id: "lec" },
      { id: "t3", name: "Gamma", short_name: "GAM", competition_id: "lck" },
    ],
    players: [],
  } as unknown as GameStateData;
}

function renderCompetitions(initialCompetitionId: string | null = null) {
  return render(
    <CompetitionsTabV2
      gameState={competitionsState()}
      onSelectTeam={vi.fn()}
      initialCompetitionId={initialCompetitionId}
    />,
  );
}

/** The hero shows the selected league's name a second time, after its pill. */
function selectedLeague(): string | null {
  for (const name of ["LEC", "LCK"]) if (screen.getAllByText(name).length > 1) return name;
  return null;
}

/** 40 free agents: five mids and 35 tops, so the tops alone still fill two pages of 30. */
function playersState(): GameStateData {
  const player = (i: number): PlayerData => {
    const mid = i < 5;
    return {
      id: `p${i}`,
      match_name: `${mid ? "Mid" : "Top"}${String(i).padStart(2, "0")}`,
      full_name: `Player ${i}`,
      nationality: "ES",
      date_of_birth: "2002-03-04",
      team_id: null,
      position: mid ? "MID" : "TOP",
      natural_position: mid ? "MID" : "TOP",
      alternate_positions: [],
      lol_role: mid ? "MID" : "TOP",
      lol_ovr: 60 + i,
      market_value: 100000,
      wage: 50000,
      transfer_listed: false,
      loan_listed: false,
      attributes: {},
    } as unknown as PlayerData;
  };
  return {
    players: Array.from({ length: 40 }, (_, i) => player(i)),
    teams: [],
    leagues: [],
    clock: { current_date: "2027-01-01T12:00:00Z" },
  } as unknown as GameStateData;
}

function renderPlayers() {
  return render(<PlayersTabV2 gameState={playersState()} onSelectPlayer={vi.fn()} onSelectTeam={vi.fn()} />);
}

function teamsState(): GameStateData {
  const teams = Array.from({ length: 23 }, (_, i) => ({
    id: `t${i}`,
    name: `${i < 22 ? "Club" : "Other"} ${String(i).padStart(2, "0")}`,
    short_name: `T${i}`,
    competition_id: i < 22 ? "lec" : "lck",
    colors: { primary: "#111", secondary: "#eee" },
  }));
  return {
    manager: { team_id: null },
    leagues: [
      { id: "lec-league", competition_id: "lec", name: "LEC", season: 1, fixtures: [], standings: [] },
      { id: "lck-league", competition_id: "lck", name: "LCK", season: 1, fixtures: [], standings: [] },
    ],
    teams,
    players: [],
  } as unknown as GameStateData;
}

function champions(): ChampionData[] {
  // Akali is a Top and Mid laner in the champion seed; the rest have no role.
  const named = { champion_key: "Akali", name: "Akali" };
  const filler = Array.from({ length: 59 }, (_, i) => ({
    champion_key: `Filler${String(i).padStart(2, "0")}`,
    name: `Filler ${String(i).padStart(2, "0")}`,
  }));
  return [named, ...filler] as unknown as ChampionData[];
}

function renderChampions() {
  return render(<ChampionsGridV2 champions={champions()} onChampionClick={vi.fn()} />);
}

function message(id: string, category: string): MessageData {
  return {
    id,
    subject: `Subject ${id}`,
    body: `Body ${id}`,
    sender: "Board",
    sender_role: "Chairman",
    date: `2026-08-0${id.slice(1)}`,
    read: true,
    category,
    priority: "Normal",
    actions: [],
    context: { team_id: null, player_id: null },
  } as unknown as MessageData;
}

function inboxState(): GameStateData {
  return {
    messages: [message("m1", "Transfer"), message("m2", "Transfer"), message("m3", "Finance")],
  } as unknown as GameStateData;
}

function renderInbox(initialMessageId: string | null = null) {
  return render(
    <InboxTabV2 gameState={inboxState()} onGameUpdate={vi.fn()} initialMessageId={initialMessageId} />,
  );
}

function selectedSubject(): string | null {
  const heading = screen.queryByRole("heading", { level: 2, name: /^Subject m\d$/ });
  return heading?.textContent ?? null;
}

function newsState(): GameStateData {
  const article = (i: number): NewsArticle => ({
    id: `n${i}`,
    headline: `Headline ${String(i).padStart(2, "0")}`,
    body: "Body",
    source: "Times",
    date: `2026-08-${String(i + 1).padStart(2, "0")}`,
    category: i < 30 ? "LeagueRoundup" : "TransferRumour",
    team_ids: [i % 2 === 0 ? "team-1" : "team-2"],
    player_ids: [],
    match_score: null,
    read: false,
  });
  return {
    clock: { current_date: "2026-09-01T00:00:00Z" },
    manager: { team_id: "team-1" },
    teams: [
      { id: "team-1", name: "Alpha FC", short_name: "ALP" },
      { id: "team-2", name: "Beta FC", short_name: "BET" },
    ],
    players: [],
    news: Array.from({ length: 40 }, (_, i) => article(i)),
  } as unknown as GameStateData;
}

// ─── Tests ───────────────────────────────────────────────────────

describe("World and direct tab state survives a remount (R23)", () => {
  it("Schedule keeps its view and its selected day", () => {
    const first = render(<ScheduleTabV2 gameState={scheduleState()} onSelectTeam={vi.fn()} />);
    fireEvent.click(screen.getByTitle("Friday, January 1, 2027"));
    first.unmount();

    const second = render(<ScheduleTabV2 gameState={scheduleState()} onSelectTeam={vi.fn()} />);
    expect(second.container.querySelector('[data-fixture-date="2027-01-01"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Calendar" }));
    second.unmount();

    const third = render(<ScheduleTabV2 gameState={scheduleState()} onSelectTeam={vi.fn()} />);
    expect(third.container.querySelector(".schedule-calendar-container")).not.toBeNull();
  });

  it("Competitions keeps its competition, view and team search", () => {
    const first = renderCompetitions();
    fireEvent.click(screen.getByRole("button", { name: /^LEC/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Teams/ }));
    fireEvent.change(screen.getByPlaceholderText("Search team..."), { target: { value: "Bet" } });
    first.unmount();

    renderCompetitions();
    expect(selectedLeague()).toBe("LEC");
    expect(screen.getByPlaceholderText("Search team...")).toHaveValue("Bet");
    expect(screen.queryByText("Alpha")).toBeNull();
  });

  it("Competitions opens the linked competition once, then keeps the user's pick and Back restores it", () => {
    const stored = renderCompetitions();
    fireEvent.click(screen.getByRole("button", { name: /^LCK/ }));
    stored.unmount();

    // A message link carries LEC: it wins over the stored LCK and is written back.
    const linked = renderCompetitions("lec");
    expect(selectedLeague()).toBe("LEC");
    expect(useTabUiStore.getState().tabs.competitions.selectedCid).toBe("lec");

    // The user picks LCK while the link is still in the props: the pick stays.
    fireEvent.click(screen.getByRole("button", { name: /^LCK/ }));
    linked.rerender(
      <CompetitionsTabV2 gameState={competitionsState()} onSelectTeam={vi.fn()} initialCompetitionId="lec" />,
    );
    expect(selectedLeague()).toBe("LCK");
    linked.unmount();

    // Back drops the link: the stored pick is what comes back.
    renderCompetitions(null);
    expect(selectedLeague()).toBe("LCK");
  });

  it("Players keeps its search, filters, sort and page, and searches from the stored input at once", () => {
    vi.useFakeTimers();
    const first = renderPlayers();
    fireEvent.click(screen.getByRole("button", { name: "Top" }));
    fireEvent.click(screen.getByRole("columnheader", { name: /^Player/ }));
    act(() => vi.advanceTimersByTime(300));
    fireEvent.click(screen.getByText("1 / 2").nextElementSibling as HTMLElement);
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    first.unmount();

    const second = renderPlayers();
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    expect(screen.queryByText("Mid00")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Search by name or nationality..."), {
      target: { value: "Top3" },
    });
    act(() => vi.advanceTimersByTime(300));
    second.unmount();

    // No timer has run yet: the list is already searched by the stored input.
    renderPlayers();
    expect(screen.getByPlaceholderText("Search by name or nationality...")).toHaveValue("Top3");
    expect(screen.getByText("Top30")).toBeInTheDocument();
    expect(screen.queryByText("Top29")).toBeNull();
  });

  it("Players still goes back to the first page when a filter changes", () => {
    vi.useFakeTimers();
    renderPlayers();
    act(() => vi.advanceTimersByTime(300));
    fireEvent.click(screen.getByText("1 / 2").nextElementSibling as HTMLElement);
    expect(screen.getByText("2 / 2")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search by name or nationality..."), {
      target: { value: "Player" },
    });
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
  });

  it("Teams keeps its competition filter, search, sort and page", () => {
    const first = render(<TeamsTabV2 gameState={teamsState()} onSelectTeam={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "lec" } });
    fireEvent.change(screen.getByPlaceholderText("Search teams..."), { target: { value: "Club" } });
    fireEvent.click(screen.getByRole("button", { name: /^Team$/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Team$/ }));
    fireEvent.click(screen.getByText("1 / 2").nextElementSibling as HTMLElement);
    first.unmount();

    render(<TeamsTabV2 gameState={teamsState()} onSelectTeam={vi.fn()} />);
    expect(screen.getByRole("combobox")).toHaveValue("lec");
    expect(screen.getByPlaceholderText("Search teams...")).toHaveValue("Club");
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    // Name, descending: the second page ends with the lowest name.
    expect(screen.getByText("Club 00")).toBeInTheDocument();
    expect(screen.queryByText("Club 21")).toBeNull();
  });

  it("Champions keeps its search, role and page", () => {
    const first = renderChampions();
    fireEvent.change(screen.getByPlaceholderText("Search champions..."), { target: { value: "i" } });
    fireEvent.click(screen.getByText("1 / 2").nextElementSibling as HTMLElement);
    first.unmount();

    const second = renderChampions();
    expect(screen.getByPlaceholderText("Search champions...")).toHaveValue("i");
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mid" }));
    second.unmount();

    renderChampions();
    expect(screen.getByRole("img", { name: "Akali" })).toBeInTheDocument();
    expect(screen.queryByText("Filler 00")).toBeNull();
  });

  it("Inbox keeps its selected message, filter, sort and search", () => {
    const first = renderInbox();
    fireEvent.click(screen.getByRole("button", { name: /^Transfer/ }));
    fireEvent.click(screen.getByRole("button", { name: "Newest first" }));
    fireEvent.change(screen.getByPlaceholderText("Search"), { target: { value: "Subject" } });
    fireEvent.click(screen.getByRole("button", { name: /Subject m2/ }));
    first.unmount();

    renderInbox();
    expect(selectedSubject()).toBe("Subject m2");
    expect(screen.getByRole("button", { name: "Oldest first" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search")).toHaveValue("Subject");
    expect(screen.queryByRole("button", { name: /Subject m3/ })).toBeNull();
  });

  it("Inbox opens the linked message once, then keeps the user's pick and Back restores it", () => {
    const stored = renderInbox();
    fireEvent.click(screen.getByRole("button", { name: /Subject m1/ }));
    stored.unmount();

    // A notification carries m2: it wins over the stored m1 and is written back.
    const linked = renderInbox("m2");
    expect(selectedSubject()).toBe("Subject m2");
    expect(useTabUiStore.getState().tabs.inbox.selectedId).toBe("m2");

    // The user opens m3 while the link is still in the props: the pick stays.
    fireEvent.click(screen.getByRole("button", { name: /Subject m3/ }));
    linked.rerender(<InboxTabV2 gameState={inboxState()} onGameUpdate={vi.fn()} initialMessageId="m2" />);
    expect(selectedSubject()).toBe("Subject m3");
    linked.unmount();

    // Back drops the link: the stored message is reselected.
    renderInbox(null);
    expect(selectedSubject()).toBe("Subject m3");
  });

  it("Inbox reads a deleted message as no selection", () => {
    const first = renderInbox();
    fireEvent.click(screen.getByRole("button", { name: /Subject m1/ }));
    first.unmount();

    render(
      <InboxTabV2
        gameState={{ messages: [message("m2", "Transfer")] } as unknown as GameStateData}
        onGameUpdate={vi.fn()}
      />,
    );
    expect(selectedSubject()).toBeNull();
    expect(useTabUiStore.getState().tabs.inbox.selectedId).toBeNull();
  });

  it("News keeps its category, team and page", () => {
    const first = render(<NewsTabV2 gameState={newsState()} />);
    fireEvent.change(screen.getByRole("combobox", { name: "All teams" }), { target: { value: "team-1" } });
    fireEvent.click(screen.getByRole("button", { name: "League Roundup" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    first.unmount();

    render(<NewsTabV2 gameState={newsState()} />);
    expect(screen.getByRole("combobox", { name: "All teams" })).toHaveValue("team-1");
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
  });

  it("Market keeps its filter", async () => {
    const first = render(<MarketTabV2 gameState={{ teams: [] } as unknown as GameStateData} />);
    await screen.findByText("Theirs");
    fireEvent.click(screen.getByRole("button", { name: "My Club" }));
    expect(screen.queryByText("Theirs")).toBeNull();
    first.unmount();

    render(<MarketTabV2 gameState={{ teams: [] } as unknown as GameStateData} />);
    await screen.findByText("Mine");
    expect(screen.queryByText("Theirs")).toBeNull();
  });
});
