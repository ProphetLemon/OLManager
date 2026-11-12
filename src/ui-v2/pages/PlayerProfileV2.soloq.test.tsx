import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SoloQHistory, SoloQHistoryDay } from "@/api/types";
import en from "@/i18n/locales/en.json";
import type { GameStateData, PlayerData, TeamData } from "@/store/gameStore";
import PlayerProfileV2 from "@/ui-v2/pages/PlayerProfileV2";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

vi.mock("react-i18next", async () => {
  const { translateFromEnglish } = await import("@/test-i18n");
  return {
    initReactI18next: { type: "3rdParty", init: () => {} },
    useTranslation: () => ({ t: translateFromEnglish, i18n: { language: "en" } }),
  };
});

vi.mock("@/lib/i18n/backendI18n", () => ({
  resolveBackendText: (_key?: string, fallback?: string) => fallback ?? "",
}));

vi.mock("@/lib/common/countries", () => ({
  countryName: () => "England",
  isValidCountryCode: () => true,
  normaliseNationality: (value: string) => value,
  resolveCountryFlagCode: () => "GB",
}));

function createTeam(overrides: Partial<TeamData> = {}): TeamData {
  return {
    id: "team-1",
    name: "Alpha FC",
    short_name: "ALP",
    country: "GB",
    city: "London",
    stadium_name: "Alpha Ground",
    stadium_capacity: 30000,
    finance: 500000,
    manager_id: "manager-1",
    reputation: 50,
    wage_budget: 50000,
    transfer_budget: 250000,
    season_income: 0,
    season_expenses: 0,
    draft_strategy: "Balanced",
    training_focus: "General",
    training_intensity: "Balanced",
    training_schedule: "Balanced",
    founded_year: 1900,
    colors: { primary: "#000000", secondary: "#ffffff" },
    starting_xi_ids: [],
    form: [],
    history: [],
    ...overrides,
  };
}

function createPlayer(overrides: Partial<PlayerData> = {}): PlayerData {
  return {
    id: "player-1",
    match_name: "J. Smith",
    full_name: "John Smith",
    date_of_birth: "2000-01-01",
    nationality: "GB",
    position: "Forward",
    natural_position: "Forward",
    alternate_positions: [],
    training_focus: null,
    attributes: {
      pace: 60,
      stamina: 60,
      strength: 60,
      agility: 60,
      passing: 60,
      shooting: 60,
      tackling: 60,
      dribbling: 60,
      defending: 60,
      positioning: 60,
      vision: 60,
      decisions: 60,
      composure: 60,
      aggression: 60,
      teamwork: 60,
      leadership: 60,
      handling: 20,
      reflexes: 20,
      aerial: 60,
    },
    condition: 80,
    morale: 75,
    team_id: "team-1",
    contract_end: "2026-10-15",
    wage: 12000,
    market_value: 350000,
    stats: {
      appearances: 0,
      goals: 0,
      assists: 0,
      clean_sheets: 0,
      yellow_cards: 0,
      red_cards: 0,
      avg_rating: 0,
      minutes_played: 0,
      shots: 0,
      shots_on_target: 0,
      passes_completed: 0,
      passes_attempted: 0,
      tackles_won: 0,
      interceptions: 0,
      fouls_committed: 0,
    },
    career: [],
    transfer_listed: false,
    loan_listed: false,
    transfer_offers: [],
    traits: [],
    ...overrides,
  };
}

function createGameState(player: PlayerData): GameStateData {
  return {
    clock: {
      current_date: "2026-08-01T00:00:00Z",
      start_date: "2026-07-01T00:00:00Z",
    },
    manager: {
      id: "manager-1",
      first_name: "Jane",
      last_name: "Doe",
      date_of_birth: "1980-01-01",
      nationality: "GB",
      reputation: 50,
      satisfaction: 50,
      fan_approval: 50,
      team_id: "team-1",
      career_stats: {
        matches_managed: 0,
        wins: 0,
        losses: 0,
        trophies: 0,
        best_finish: null,
      },
      career_history: [],
    },
    teams: [createTeam()],
    players: [player],
    staff: [],
    messages: [],
    news: [],
    leagues: [{
      id: "league-1",
      name: "League",
      season: 1,
      fixtures: [],
      standings: [],
    }],
    scouting_assignments: [],
    board_objectives: [],
  };
}


const PRESETS = [
  { mode: "Off", decay_per_idle_day: 0, bank_days: 0, recovery_per_played_day: 0 },
  { mode: "Soft", decay_per_idle_day: 25, bank_days: 21, recovery_per_played_day: 50 },
  { mode: "Real", decay_per_idle_day: 50, bank_days: 14, recovery_per_played_day: 100 },
  { mode: "Harsh", decay_per_idle_day: 75, bank_days: 7, recovery_per_played_day: 150 },
];

const FIRST = Date.UTC(2026, 6, 1);
const iso = (index: number) => new Date(FIRST + index * 86_400_000).toISOString().slice(0, 10);

function day(index: number, over: Partial<SoloQHistoryDay> = {}): SoloQHistoryDay {
  return { date: iso(index), lp: 900, formula_lp: 900, focus: "Scrims", kind: "Played", bank: 14, ...over };
}

/** 30 days that end 10 days into a stretch without a team: grace used up, floor reached. */
function floorHistory(): SoloQHistory {
  const days = Array.from({ length: 30 }, (_, i) => {
    if (i < 10) return day(i);
    if (i < 20) return day(i, { kind: "Idle", focus: null, bank: 14 - (i - 9) });
    return day(i, { kind: "Decay", focus: null, bank: 0, lp: Math.max(0, 900 - (i - 19) * 90), formula_lp: 900 });
  });
  return { player_id: "player-1", followed: true, decay_mode: "Real", bank_days: 0, bank_max: 14, offset_lp: 900, days };
}

function serve(history: SoloQHistory | "fail", extra: Record<string, unknown> = {}) {
  vi.mocked(invoke).mockImplementation(async (command: string) => {
    if (command === "get_soloq_history") {
      if (history === "fail") throw new Error("no history");
      return history;
    }
    if (command === "get_soloq_decay_settings") return { mode: "Real", presets: PRESETS };
    if (command === "get_player_match_history") return [];
    if (command in extra) return extra[command];
    return null;
  });
}

function stateWith(player: PlayerData, staff: unknown[] = []): GameStateData {
  return { ...createGameState(player), staff: staff as GameStateData["staff"] };
}

const SCOUT = { id: "scout-1", role: "Scout", team_id: "team-1", first_name: "S", last_name: "Cout" };

function renderProfile(player: PlayerData, state = stateWith(player)) {
  return render(<PlayerProfileV2 gameState={state} playerId={player.id} onClose={vi.fn()} onGameUpdate={vi.fn()} />);
}

describe("PlayerProfileV2 SoloQ history", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("asks the engine for this player's history and the decay presets", async () => {
    serve(floorHistory());
    renderProfile(createPlayer());
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("get_soloq_history", { playerId: "player-1" }));
    expect(invoke).toHaveBeenCalledWith("get_soloq_decay_settings");
  });

  it("draws the ladder section under the hero and reads Master 0 LP at the floor", async () => {
    serve(floorHistory());
    renderProfile(createPlayer({ soloq_lp: 0 }));

    const ladder = await screen.findByRole("region", { name: "SoloQ ladder" });
    expect(ladder).toHaveAttribute("id", "ladder");
    expect(within(ladder).getByText("Floor: Master 0 LP")).toBeInTheDocument();

    const hero = screen.getByRole("region", { name: "SoloQ" });
    expect(within(hero).getByText("Master 0 LP")).toBeInTheDocument();
    expect(within(hero).getByText("Idle (no team)")).toBeInTheDocument();
    expect(within(hero).getByText("At the floor: Master 0 LP")).toBeInTheDocument();
    expect(within(hero).getByText("−90 LP since yesterday")).toBeInTheDocument();
  });

  it("shows today's LP and tier from the player when no history can be read", async () => {
    serve("fail");
    renderProfile(createPlayer({ soloq_lp: 850 }));

    const hero = await screen.findByRole("region", { name: "SoloQ" });
    expect(within(hero).getByText("Grandmaster")).toBeInTheDocument();
    expect(within(hero).getByText("850")).toBeInTheDocument();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("get_soloq_history", expect.anything()));
    expect(screen.queryByRole("region", { name: "SoloQ ladder" })).not.toBeInTheDocument();
  });

  it("reads 0 LP as Master, not unranked, from the player's cached value", async () => {
    serve("fail");
    renderProfile(createPlayer({ soloq_lp: 0 }));
    const hero = await screen.findByRole("region", { name: "SoloQ" });
    expect(within(hero).getByText("Master 0 LP")).toBeInTheDocument();
    expect(hero.querySelector("img")).toHaveAttribute("src", "/ladder-icons/master.webp");
  });

  it("shows the empty state, with the scout action, for a player nobody follows", async () => {
    serve({ player_id: "player-1", followed: false, decay_mode: "Real", bank_days: 14, bank_max: 14, offset_lp: 0, days: [] });
    renderProfile(createPlayer({ team_id: "team-2" }), stateWith(createPlayer({ team_id: "team-2" }), [SCOUT]));

    const ladder = await screen.findByRole("region", { name: "SoloQ ladder" });
    expect(within(ladder).getByText("No LP history yet")).toBeInTheDocument();
    expect(within(ladder).getByRole("button", { name: "Scout" })).toBeInTheDocument();
  });
});

describe("PlayerProfileV2 hero actions", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    serve("fail");
  });

  it("keeps renew, release and scout in the hero, and out of the contract card", async () => {
    const player = createPlayer();
    const state = stateWith(player, [SCOUT]);
    state.leagues = [
      { ...state.leagues[0], transfer_window: { status: "Open" } } as never,
    ];
    renderProfile(player, state);

    const renew = screen.getByRole("button", { name: "Renew Contract" });
    const hero = renew.closest('[data-slot="card"]') as HTMLElement;
    expect(within(hero).getByRole("heading", { name: "J. Smith" })).toBeInTheDocument();
    expect(within(hero).getByRole("button", { name: "Scout" })).toBeInTheDocument();

    const contract = screen.getByText(en.playerProfile.contractInfo).closest('[data-slot="card"]') as HTMLElement;
    expect(within(contract).queryByRole("button")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Renew Contract" })).toHaveLength(1);
  });

  it("still scouts from the hero", async () => {
    const player = createPlayer();
    renderProfile(player, stateWith(player, [SCOUT]));
    vi.mocked(invoke).mockResolvedValue(stateWith(player, [SCOUT]));
    fireEvent.click(screen.getByRole("button", { name: "Scout" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("send_scout", { scoutId: "scout-1", playerId: "player-1" }));
  });
});
