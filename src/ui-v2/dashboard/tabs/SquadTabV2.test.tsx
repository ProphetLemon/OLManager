import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GameStateData, PlayerData } from "@/store/gameStore";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (key: string, opts?: Record<string, unknown>) =>
      String(opts?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_m, k) => String(opts?.[k] ?? "")),
  }),
}));

import { SquadTabV2 } from "./SquadTabV2";

// ─── Fixtures ────────────────────────────────────────────────────

type Role = "TOP" | "JUNGLE" | "MID" | "ADC" | "SUPPORT";

function makePlayer(
  id: string,
  position: Role,
  ovr: number,
  extra: Partial<PlayerData> = {},
): PlayerData {
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
    ...extra,
  } as unknown as PlayerData;
}

const STARTER_IDS = ["s_top", "s_jng", "s_mid", "s_adc", "s_sup"];

function baseStarters(extra: Partial<Record<string, Partial<PlayerData>>> = {}): PlayerData[] {
  return [
    makePlayer("s_top", "TOP", 80, extra.s_top),
    makePlayer("s_jng", "JUNGLE", 81, extra.s_jng),
    makePlayer("s_mid", "MID", 82, extra.s_mid),
    makePlayer("s_adc", "ADC", 83, extra.s_adc),
    makePlayer("s_sup", "SUPPORT", 84, extra.s_sup),
  ];
}

function makeState(
  players: PlayerData[],
  opts: { teamId?: string; lineup?: string[] } = {},
): GameStateData {
  return {
    manager: { team_id: opts.teamId ?? "t1" },
    clock: { current_date: "2026-03-01T00:00:00Z" },
    teams: [{ id: "t1", active_lineup_ids: opts.lineup ?? STARTER_IDS }],
    players,
  } as unknown as GameStateData;
}

const BENCH = [
  makePlayer("b_jng_low", "JUNGLE", 70),
  makePlayer("b_jng_high", "JUNGLE", 75),
  makePlayer("b_mid", "MID", 72),
];

function setup(state: GameStateData, props: Partial<React.ComponentProps<typeof SquadTabV2>> = {}) {
  const onGameUpdate = vi.fn();
  const onSelectPlayer = vi.fn();
  const onNavigate = vi.fn();
  const view = render(
    <SquadTabV2
      gameState={state}
      onGameUpdate={onGameUpdate}
      onSelectPlayer={onSelectPlayer}
      onNavigate={onNavigate}
      {...props}
    />,
  );
  return { ...view, onGameUpdate, onSelectPlayer, onNavigate };
}

async function openMenu(name: string): Promise<HTMLElement> {
  const trigger = screen.getByRole("button", { name });
  act(() => trigger.focus());
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  return screen.findByRole("menu");
}

function benchNames(): string[] {
  return screen
    .getAllByRole("listitem")
    .map((row) => row.querySelector("span[title]")?.getAttribute("title") ?? "");
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
});

// ─── Tests ───────────────────────────────────────────────────────

describe("SquadTabV2", () => {
  it("renders five player cards with the lineup summary and the preserved test ids", () => {
    setup(makeState([...baseStarters(), ...BENCH]));
    const lineup = screen.getByTestId("active-lineup");
    expect(lineup.querySelectorAll("[data-slot='player-card']")).toHaveLength(5);
    expect(screen.getByRole("heading", { name: "Starting five" })).toBeInTheDocument();
    expect(screen.getByText("5 of 5 slots filled")).toBeInTheDocument();
    expect(screen.getByTestId("lineup-import-count")).toBeInTheDocument();
  });

  it("shows no Spanish literals", () => {
    const { container } = setup(
      makeState([...baseStarters({ s_top: { condition: 20 } }), ...BENCH]),
    );
    const text = container.textContent ?? "";
    for (const literal of ["Plantilla", "Energía", "titular", "Edad", "Sin jugador"]) {
      expect(text).not.toContain(literal);
    }
    expect(text).not.toMatch(/\bMoral\b/);
    expect(screen.getByText("s_top: energy 20%")).toBeInTheDocument();
  });

  it("shows the selection bar for a selected card and hides it again", () => {
    const { onSelectPlayer } = setup(makeState([...baseStarters(), ...BENCH]));
    expect(screen.queryByRole("region", { name: "Selected player" })).toBeNull();

    const card = within(screen.getByTestId("active-lineup")).getByRole("button", { name: /s_mid/ });
    fireEvent.click(card);
    const bar = screen.getByRole("region", { name: "Selected player" });
    expect(within(bar).getByRole("heading", { name: "s_mid" })).toBeInTheDocument();
    expect(card).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(within(bar).getByRole("button", { name: "Renew" }));
    expect(onSelectPlayer).toHaveBeenCalledWith("s_mid", { openRenewal: true });
    fireEvent.click(within(bar).getByRole("button", { name: "Profile" }));
    expect(onSelectPlayer).toHaveBeenCalledWith("s_mid");

    fireEvent.click(within(bar).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("region", { name: "Selected player" })).toBeNull();

    fireEvent.click(card);
    fireEvent.click(card);
    expect(screen.queryByRole("region", { name: "Selected player" })).toBeNull();
  });

  it("toggles the transfer list from the selection bar", async () => {
    const updated = makeState([...baseStarters(), ...BENCH]);
    invokeMock.mockResolvedValue(updated);
    const { onGameUpdate } = setup(makeState([...baseStarters(), ...BENCH]));
    fireEvent.click(within(screen.getByTestId("active-lineup")).getByRole("button", { name: /s_top/ }));
    fireEvent.click(screen.getByRole("button", { name: "List for transfer" }));
    await waitFor(() => expect(onGameUpdate).toHaveBeenCalledWith(updated));
    expect(invokeMock).toHaveBeenCalledWith("toggle_transfer_list", { playerId: "s_top" });
  });

  it("swaps a starter for a bench player through set_active_lineup", async () => {
    const updated = makeState([...baseStarters(), ...BENCH]);
    invokeMock.mockResolvedValue(updated);
    const { onGameUpdate } = setup(makeState([...baseStarters(), ...BENCH]));

    const menu = await openMenu("Swap Mid");
    const items = within(menu).getAllByRole("menuitem");
    // Same-role candidate first, then by rating among the rest.
    expect(items[0]).toHaveTextContent("b_mid");
    expect(items[1]).toHaveTextContent("b_jng_high");
    fireEvent.click(items[0]);

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("set_active_lineup", {
        playerIds: ["s_top", "s_jng", "b_mid", "s_adc", "s_sup"],
      }),
    );
    await waitFor(() => expect(onGameUpdate).toHaveBeenCalledWith(updated));
  });

  it("disables an import candidate that would break the two-import limit", async () => {
    const players = [
      ...baseStarters({ s_top: { is_import: true }, s_jng: { is_import: true } }),
      makePlayer("b_import", "MID", 90, { is_import: true }),
      makePlayer("b_home", "MID", 60),
    ];
    setup(makeState(players));

    const menu = await openMenu("Swap Mid");
    const blocked = within(menu).getByRole("menuitem", { name: /b_import/ });
    expect(blocked).toHaveAttribute("aria-disabled", "true");
    expect(within(blocked).getByText("Import limit reached")).toBeInTheDocument();
    fireEvent.click(blocked);
    expect(invokeMock).not.toHaveBeenCalledWith("set_active_lineup", expect.anything());
  });

  it("allows an import swap when the limit has room, and shows the backend refusal as a notice", async () => {
    invokeMock.mockRejectedValue(new Error("LINEUP_TOO_MANY_IMPORTS:3:2"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const players = [
      ...baseStarters({ s_top: { is_import: true } }),
      makePlayer("b_import", "MID", 90, { is_import: true }),
    ];
    setup(makeState(players));
    expect(screen.queryByTestId("lineup-import-notice")).toBeNull();

    const menu = await openMenu("Swap Mid");
    const item = within(menu).getByRole("menuitem", { name: /b_import/ });
    expect(item).not.toHaveAttribute("aria-disabled", "true");
    fireEvent.click(item);

    const notice = await screen.findByTestId("lineup-import-notice");
    expect(notice).toHaveAttribute("role", "alert");
    errorSpy.mockRestore();
  });

  it("marks imports with the import badge on cards and bench rows", () => {
    setup(
      makeState([
        ...baseStarters({ s_adc: { is_import: true } }),
        makePlayer("b_import", "TOP", 60, { is_import: true }),
      ]),
    );
    expect(screen.getAllByTestId("import-badge")).toHaveLength(2);
  });

  it("filters the bench by role and by name, and sorts without reordering the lineup", () => {
    setup(makeState([...baseStarters(), ...BENCH]));
    expect(benchNames()).toEqual(["b_jng_high", "b_jng_low", "b_mid"]);

    fireEvent.click(screen.getByRole("radio", { name: /Jungle/ }));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("2 of 3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /All roles/ }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "b_mid" } });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    const sortGroup = screen.getByRole("group", { name: "Sort bench by" });
    const ovrSort = within(sortGroup).getByRole("button", { name: "OVR" });
    fireEvent.click(ovrSort);
    expect(ovrSort).toHaveAttribute("aria-pressed", "true");
    expect(benchNames()).toEqual(["b_jng_high", "b_mid", "b_jng_low"]);
    fireEvent.click(within(sortGroup).getByRole("button", { name: /OVR/ }));
    expect(benchNames()).toEqual(["b_jng_low", "b_mid", "b_jng_high"]);
    // The starting five keeps its slot order whatever the bench sort is.
    const cards = screen.getByTestId("active-lineup").querySelectorAll("[data-slot='player-card']");
    expect(Array.from(cards, (c) => c.querySelector("span[title]")?.getAttribute("title"))).toEqual(
      STARTER_IDS,
    );
  });

  it("shows the filtered empty state with a clear action", () => {
    setup(makeState([...baseStarters(), ...BENCH]));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });
    const empty = document.querySelector("[data-slot='bench-empty-state']") as HTMLElement;
    expect(empty).toHaveAttribute("data-variant", "filtered");
    fireEvent.click(within(empty).getByRole("button", { name: "Clear filter" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByRole("searchbox")).toHaveValue("");
  });

  it("shows the empty bench call to action and navigates to market and academy", () => {
    const { onNavigate } = setup(makeState(baseStarters()));
    const empty = document.querySelector("[data-slot='bench-empty-state']") as HTMLElement;
    expect(empty).toHaveAttribute("data-variant", "empty");
    fireEvent.click(within(empty).getByRole("button", { name: "Browse market" }));
    expect(onNavigate).toHaveBeenCalledWith("Transfers");
    fireEvent.click(within(empty).getByRole("button", { name: "Open academy" }));
    expect(onNavigate).toHaveBeenCalledWith("Youth");
  });

  it("fills an empty slot from the bench", async () => {
    // Nobody can play support, so the slot stays empty and the bench offers its players.
    const players = [...baseStarters().filter((p) => p.id !== "s_sup"), makePlayer("b_top", "TOP", 70)];
    setup(makeState(players, { lineup: ["s_top", "s_jng", "s_mid", "s_adc", ""] }));
    expect(screen.getByText("4 of 5 slots filled")).toBeInTheDocument();
    const menu = await openMenu("Fill Support slot");
    fireEvent.click(within(menu).getByRole("menuitem", { name: /b_top/ }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("set_active_lineup", {
        playerIds: ["s_top", "s_jng", "s_mid", "s_adc", "b_top"],
      }),
    );
  });

  it("opens a bench player's profile and toggles the loan list", async () => {
    const { onSelectPlayer } = setup(makeState([...baseStarters(), ...BENCH]));
    const row = screen.getAllByRole("listitem")[0];
    fireEvent.click(within(row).getAllByRole("button")[0]);
    expect(onSelectPlayer).toHaveBeenCalledWith("b_jng_high");
    fireEvent.click(within(row).getByRole("button", { name: /Add to loan list/ }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("toggle_loan_list", { playerId: "b_jng_high" }),
    );
  });

  it("saves the computed lineup once on mount when the stored one is stale", () => {
    const state = makeState([...baseStarters(), ...BENCH], { lineup: ["s_jng", "s_top"] });
    const { rerender } = setup(state);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("set_active_lineup", { playerIds: STARTER_IDS });
    rerender(
      <SquadTabV2 gameState={state} onGameUpdate={vi.fn()} onSelectPlayer={vi.fn()} />,
    );
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("does not break the hook order when the team goes missing", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const withTeam = makeState([...baseStarters(), ...BENCH]);
    const { rerender } = setup(withTeam);
    expect(screen.getByRole("heading", { name: "Starting five" })).toBeInTheDocument();

    rerender(
      <SquadTabV2
        gameState={makeState([...baseStarters(), ...BENCH], { teamId: "nobody" })}
        onGameUpdate={vi.fn()}
        onSelectPlayer={vi.fn()}
      />,
    );
    expect(screen.getByText("You are currently unemployed.")).toBeInTheDocument();

    rerender(
      <SquadTabV2 gameState={withTeam} onGameUpdate={vi.fn()} onSelectPlayer={vi.fn()} />,
    );
    expect(screen.getByRole("heading", { name: "Starting five" })).toBeInTheDocument();
    const hookErrors = errorSpy.mock.calls.filter((call) => /hook/i.test(String(call[0])));
    expect(hookErrors).toHaveLength(0);
    errorSpy.mockRestore();
  });

  it("renders the unemployed state on first render without a team", () => {
    setup(makeState(baseStarters(), { teamId: "nobody" }));
    expect(screen.getByText("You are currently unemployed.")).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("never sorts the incoming players array in place", () => {
    const players = Object.freeze([...baseStarters(), ...BENCH]) as unknown as PlayerData[];
    const state = makeState(players);
    expect(() => setup(state)).not.toThrow();
    expect(players.map((p) => p.id)).toEqual([...STARTER_IDS, "b_jng_low", "b_jng_high", "b_mid"]);
  });
});
