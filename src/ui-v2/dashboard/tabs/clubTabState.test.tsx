import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import "@/i18n";
import type { GameStateData, PlayerData, StaffData } from "@/store/gameStore";
import { useTabUiStore } from "@/store/tabUiStore";
import { FinancesTabV2 } from "./FinancesTabV2";
import { MetaTabV2 } from "./MetaTabV2";
import { SquadTabV2 } from "./SquadTabV2";
import { StaffTabV2 } from "./StaffTabV2";
import { TrainingTabV2 } from "./TrainingTabV2";
import { YouthTabV2 } from "./YouthTabV2";

// Every backend call on mount (the SoloQ ranks, the lineup auto-save) resolves to
// an empty list: these tests are about the tab's own view state, not its data.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue([]) }));

// R23: a tab keeps its view, filters, sort, page and selection when it unmounts
// for a profile visit and mounts again on Back. Each case changes the state
// through the real control, remounts, and reads the control again.

// ─── Fixtures ────────────────────────────────────────────────────

function squadPlayer(id: string, position: string, ovr: number): PlayerData {
  return {
    id,
    match_name: id,
    full_name: id,
    team_id: "t1",
    position,
    natural_position: position,
    lol_ovr: ovr,
    condition: 90,
    morale: 80,
    fitness: 85,
    wage: 100000,
    contract_end: "2030-06-30",
    date_of_birth: "2000-01-01",
    is_import: false,
    transfer_listed: false,
    loan_listed: false,
  } as unknown as PlayerData;
}

const STARTERS = [
  squadPlayer("s_top", "TOP", 80),
  squadPlayer("s_jng", "JUNGLE", 81),
  squadPlayer("s_mid", "MID", 82),
  squadPlayer("s_adc", "ADC", 83),
  squadPlayer("s_sup", "SUPPORT", 84),
];
const BENCH = [
  squadPlayer("b_jng", "JUNGLE", 70),
  squadPlayer("b_mid", "MID", 72),
  squadPlayer("b_mid_two", "MID", 71),
];

function squadState(players: PlayerData[] = [...STARTERS, ...BENCH]): GameStateData {
  return {
    manager: { team_id: "t1" },
    clock: { current_date: "2026-03-01T00:00:00Z" },
    teams: [{ id: "t1", active_lineup_ids: players.slice(0, 5).map((p) => p.id) }],
    players,
  } as unknown as GameStateData;
}

function renderSquad(state = squadState()) {
  return render(<SquadTabV2 gameState={state} onGameUpdate={vi.fn()} onSelectPlayer={vi.fn()} />);
}

function trainingState(): GameStateData {
  return {
    manager: { team_id: "team-1", name: "Coach" },
    teams: [
      {
        id: "team-1",
        name: "Test Team",
        short_name: "TST",
        training_focus: "Scrims",
        training_intensity: "Medium",
        training_schedule: "Balanced",
        training_groups: [],
        staff_ids: [],
      },
    ],
    players: [],
    staff: [],
    leagues: [],
    messages: [],
    clock: { current_date: "2026-01-05" },
    user_competition_id: null,
  } as unknown as GameStateData;
}

function metaState(): GameStateData {
  return {
    manager: { team_id: null, name: "Coach", id: "mgr-1" },
    players: [],
    teams: [],
    leagues: [],
    clock: { current_date: "2025-03-15", start_date: "2025-01-01" },
    messages: [],
    news: [],
    champion_masteries: [],
    champions: [],
    champion_patch: {
      current_patch_label: "25.1",
      discovered_champion_ids: ["Ahri", "Garen"],
      hidden_meta: [
        { champion_id: "Ahri", role: "Mid", tier: "S" },
        { champion_id: "Garen", role: "Top", tier: "A" },
      ],
    },
    user_competition_id: null,
  } as unknown as GameStateData;
}

function staffMember(id: string, overrides: Partial<StaffData> = {}): StaffData {
  return {
    id,
    first_name: id,
    last_name: "Staff",
    date_of_birth: "1985-03-01",
    nationality: "ES",
    role: "Coach",
    attributes: { coaching: 70, judging_ability: 50, judging_potential: 55, physiotherapy: 30 },
    team_id: null,
    specialization: null,
    wage: 30000,
    contract_end: null,
    ...overrides,
  } as StaffData;
}

/** One hired coach and 14 free agents: 13 coaches (two pages) and one scout. */
function staffState(): GameStateData {
  const free = Array.from({ length: 13 }, (_, i) => staffMember(`free${String(i).padStart(2, "0")}`));
  return {
    clock: { current_date: "2026-08-10T00:00:00Z", start_date: "2026-07-01T00:00:00Z" },
    manager: { id: "manager-1", team_id: "team-1" },
    teams: [{ id: "team-1", name: "Alpha FC", competition_id: null }],
    players: [],
    staff: [
      staffMember("hired", { team_id: "team-1" }),
      ...free,
      staffMember("scouty", { role: "Scout" }),
    ],
    leagues: [],
  } as unknown as GameStateData;
}

function renderStaff(mode: "club" | "world" = "club") {
  return render(<StaffTabV2 gameState={staffState()} onGameUpdate={vi.fn()} mode={mode} />);
}

function financesState(): GameStateData {
  return {
    manager: { team_id: "team-1", name: "Coach" },
    teams: [
      {
        id: "team-1",
        name: "Test Team",
        short_name: "TST",
        finance: 1_000_000,
        wage_budget: 500_000,
        transfer_budget: 750_000,
        season_income: 900_000,
        season_expenses: 650_000,
        financial_ledger: [
          {
            date: "2026-01-03",
            description: "Transfer purchase",
            amount: -250_000,
            kind: "TransferPurchase",
            source: "transfer",
            balance_after: 750_000,
          },
          {
            date: "2026-01-04",
            description: "Monthly salary",
            amount: -99_999,
            kind: "Salary",
            source: "monthly",
            balance_after: 650_001,
          },
        ],
        form: [],
        history: [],
      },
    ],
    players: [],
    staff: [],
    leagues: [],
    messages: [],
    clock: { current_date: "2026-01-05" },
  } as unknown as GameStateData;
}

function renderFinances() {
  return render(<FinancesTabV2 gameState={financesState()} onGameUpdate={vi.fn()} />);
}

function youthState(): GameStateData {
  const kid = (id: string) => ({
    id,
    match_name: id,
    full_name: `${id} full`,
    date_of_birth: "2006-01-01",
    nationality: "ES",
    position: "TOP",
    natural_position: "TOP",
    alternate_positions: [],
    attributes: {
      mechanics: 60, laning: 60, teamfighting: 60, macro_play: 60, consistency: 60,
      shotcalling: 60, champion_pool: 60, discipline: 60, mental_resilience: 60,
    },
    condition: 90,
    team_id: "academy",
    contract_end: "2027-06-30",
    wage: 1000,
    market_value: 1000,
    potential_revealed: null,
  });
  return {
    manager: { id: "m1", team_id: "team-1" },
    teams: [
      { id: "team-1", name: "Koi", academy_team_id: "academy", team_kind: "Main" },
      { id: "academy", name: "Alpha Esports", parent_team_id: "team-1", team_kind: "Main" },
    ],
    players: [kid("kid-one"), kid("kid-two")],
    staff: [],
    clock: { current_date: "2026-08-10T00:00:00Z" },
  } as unknown as GameStateData;
}

// ─── Tests ───────────────────────────────────────────────────────

describe("Club tab state survives a remount (R23)", () => {
  it("Squad keeps its bench search, sort, role filter and selected starter", () => {
    const first = renderSquad();
    fireEvent.change(screen.getByPlaceholderText("Search substitutes"), { target: { value: "mid" } });
    fireEvent.click(within(screen.getByRole("group", { name: "Sort bench by" })).getByRole("button", { name: /OVR/ }));
    fireEvent.click(screen.getByRole("radio", { name: /^Mid/ }));
    fireEvent.click(within(screen.getByTestId("active-lineup")).getByRole("button", { name: /s_mid/ }));
    first.unmount();

    renderSquad();
    expect(screen.getByPlaceholderText("Search substitutes")).toHaveValue("mid");
    expect(
      within(screen.getByRole("group", { name: "Sort bench by" })).getByRole("button", { name: /OVR/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("radio", { name: /^Mid/ })).toHaveAttribute("aria-checked", "true");
    const bar = screen.getByRole("region", { name: "Selected player" });
    expect(within(bar).getByRole("heading", { name: "s_mid" })).toBeInTheDocument();
  });

  it("Squad reads a selected player who has left the club as no selection", () => {
    const first = renderSquad();
    fireEvent.click(within(screen.getByTestId("active-lineup")).getByRole("button", { name: /s_mid/ }));
    first.unmount();

    // s_mid was released while a profile was open; b_mid takes the slot.
    const withoutMid = [STARTERS[0], STARTERS[1], BENCH[1], STARTERS[3], STARTERS[4], BENCH[0]];
    renderSquad(squadState(withoutMid));
    expect(screen.queryByRole("region", { name: "Selected player" })).toBeNull();
    expect(useTabUiStore.getState().tabs.squad.selectedId).toBeNull();
  });

  it("Training keeps the SoloQ view", () => {
    const first = render(<TrainingTabV2 gameState={trainingState()} onGameUpdate={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "SoloQ" }));
    first.unmount();

    render(<TrainingTabV2 gameState={trainingState()} onGameUpdate={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "SoloQ" })).toHaveAttribute("aria-selected", "true");
  });

  it("Meta keeps its role filter", () => {
    const first = render(<MetaTabV2 gameState={metaState()} onViewChampion={vi.fn()} />);
    expect(screen.getByRole("img", { name: "Garen" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mid" }));
    expect(screen.queryByRole("img", { name: "Garen" })).toBeNull();
    first.unmount();

    render(<MetaTabV2 gameState={metaState()} onViewChampion={vi.fn()} />);
    expect(screen.getByRole("img", { name: "Ahri" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Garen" })).toBeNull();
  });

  it("Staff keeps its view, search and page", () => {
    const first = renderStaff();
    fireEvent.click(screen.getByRole("button", { name: /Available/ }));
    fireEvent.change(screen.getByPlaceholderText("Search staff..."), { target: { value: "free" } });
    fireEvent.click(screen.getByText("1 / 2").nextElementSibling as HTMLElement);
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    first.unmount();

    renderStaff();
    expect(screen.getByPlaceholderText("Search staff...")).toHaveValue("free");
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    expect(screen.getByText("free12 Staff")).toBeInTheDocument();
  });

  it("Staff still goes back to the first page when a filter changes", () => {
    renderStaff();
    fireEvent.click(screen.getByRole("button", { name: /Available/ }));
    fireEvent.click(screen.getByText("1 / 2").nextElementSibling as HTMLElement);
    expect(screen.getByText("2 / 2")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search staff..."), { target: { value: "fre" } });
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
  });

  it("Staff keeps separate filters for the club and the world", () => {
    const club = renderStaff("club");
    fireEvent.change(screen.getByPlaceholderText("Search staff..."), { target: { value: "hired" } });
    club.unmount();

    const world = renderStaff("world");
    expect(screen.getByPlaceholderText("Search staff...")).toHaveValue("");
    fireEvent.change(screen.getByPlaceholderText("Search staff..."), { target: { value: "scouty" } });
    world.unmount();

    const clubAgain = renderStaff("club");
    expect(screen.getByPlaceholderText("Search staff...")).toHaveValue("hired");
    clubAgain.unmount();

    renderStaff("world");
    expect(screen.getByPlaceholderText("Search staff...")).toHaveValue("scouty");
  });

  it("Finances keeps its view and its ledger filters", () => {
    const first = renderFinances();
    fireEvent.change(screen.getByLabelText("Search ledger"), { target: { value: "salary" } });
    fireEvent.change(screen.getByLabelText("Transaction type"), { target: { value: "Salary" } });
    first.unmount();

    const second = renderFinances();
    expect(screen.getByLabelText("Search ledger")).toHaveValue("salary");
    expect(screen.getByLabelText("Transaction type")).toHaveValue("Salary");
    fireEvent.click(screen.getByRole("tab", { name: "Facilities" }));
    second.unmount();

    renderFinances();
    expect(screen.getByRole("tab", { name: "Facilities" })).toHaveAttribute("aria-selected", "true");
  });

  it("Youth keeps its search", () => {
    const first = render(<YouthTabV2 gameState={youthState()} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "two" } });
    first.unmount();

    render(<YouthTabV2 gameState={youthState()} />);
    expect(screen.getByRole("searchbox")).toHaveValue("two");
    expect(screen.queryByText("kid-one", { selector: "p.text-foreground" })).toBeNull();
  });
});
