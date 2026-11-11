import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { GameStateData } from "@/store/gameStore";
import PlayerProfileV2 from "@/ui-v2/pages/PlayerProfileV2";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string | number> | string) =>
      typeof options === "object" && options?.defaultValue ? String(options.defaultValue) : key,
    i18n: { language: "en" },
  }),
}));

const OWN = "les-custom-ray";

function team(id: string) {
  return {
    id,
    name: id,
    short_name: id.slice(0, 3),
    country: "ES",
    wage_budget: 50000,
    transfer_budget: 250000,
    finance: 500000,
    team_kind: "Main",
    starting_xi_ids: [],
    form: [],
    history: [],
    colors: { primary: "#000", secondary: "#fff" },
  };
}

function player(id: string, teamId: string | null) {
  return {
    id,
    match_name: "Rayo",
    full_name: "Raul Vega",
    date_of_birth: "2004-01-01",
    nationality: "ES",
    position: "MID",
    natural_position: "MID",
    alternate_positions: [],
    attributes: {},
    condition: 80,
    morale: 75,
    team_id: teamId,
    contract_end: "2027-08-01",
    wage: 12000,
    market_value: 350000,
    traits: [],
    career: [],
    transfer_offers: [],
  };
}

function gameState(players: ReturnType<typeof player>[]): GameStateData {
  return {
    clock: { current_date: "2026-08-01T00:00:00Z", start_date: "2026-07-01T00:00:00Z" },
    manager: { id: "m-1", team_id: OWN },
    teams: [team(OWN), team("les-b")],
    players,
    staff: [],
    messages: [],
    news: [],
    leagues: [],
    scouting_assignments: [],
    board_objectives: [],
    season_context: {
      phase: "InSeason",
      season_start: "2026-07-01",
      season_end: "2027-05-01",
      days_until_season_start: null,
      transfer_window: { status: "Closed" },
    },
  } as unknown as GameStateData;
}

const renameButton = () => screen.queryByRole("button", { name: "playerProfile.rename.actionAria" });

function open(playerRecord: ReturnType<typeof player>, onGameUpdate = vi.fn()) {
  render(
    <PlayerProfileV2
      gameState={gameState([playerRecord])}
      playerId={playerRecord.id}
      onClose={vi.fn()}
      onGameUpdate={onGameUpdate}
    />,
  );
  return onGameUpdate;
}

describe("PlayerProfileV2 rename", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue([]);
  });

  it("offers Rename for a generated founder of the manager's club", () => {
    open(player("gen-ray-mid-1", OWN));
    expect(renameButton()).toBeInTheDocument();
  });

  it.each([
    ["a player the club did not start with", player("p-123", OWN)],
    ["a generated player of another club", player("gen-ray-mid-1", "les-b")],
    ["a free agent", player("gen-ray-mid-1", null)],
  ])("does not offer Rename for %s", (_label, record) => {
    open(record);
    expect(renameButton()).not.toBeInTheDocument();
  });

  it("does not offer Rename when the profile cannot update the game", () => {
    render(<PlayerProfileV2 gameState={gameState([player("gen-ray-mid-1", OWN)])} playerId="gen-ray-mid-1" onClose={vi.fn()} />);
    expect(renameButton()).not.toBeInTheDocument();
  });

  it("sends only the changed field and updates the game with the answer", async () => {
    const updated = { marker: "renamed game" };
    vi.mocked(invoke).mockImplementation(async (command: string) =>
      command === "rename_player" ? updated : [],
    );
    const onGameUpdate = open(player("gen-ray-mid-1", OWN));

    fireEvent.click(renameButton()!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("playerProfile.rename.nick"), { target: { value: " Ray " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "playerProfile.rename.save" }));

    await waitFor(() => expect(onGameUpdate).toHaveBeenCalledWith(updated));
    expect(invoke).toHaveBeenCalledWith("rename_player", {
      playerId: "gen-ray-mid-1",
      nick: "Ray",
      fullName: null,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("does not call the backend when nothing changed", async () => {
    const onGameUpdate = open(player("gen-ray-mid-1", OWN));
    fireEvent.click(renameButton()!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "playerProfile.rename.save" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("playerProfile.rename.errors.nothingToChange");
    expect(invoke).not.toHaveBeenCalledWith("rename_player", expect.anything());
    expect(onGameUpdate).not.toHaveBeenCalled();
  });

  it("states the name constraints under each field before any submit", async () => {
    open(player("gen-ray-mid-1", OWN));
    fireEvent.click(renameButton()!);
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByLabelText("playerProfile.rename.nick")).toHaveAccessibleDescription(
      "playerProfile.rename.nickHint",
    );
    expect(within(dialog).getByLabelText("playerProfile.rename.fullName")).toHaveAccessibleDescription(
      "playerProfile.rename.fullNameHint",
    );
  });

  it("shows the backend's field error at the field and keeps the dialog open", async () => {
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "rename_player") {
        throw JSON.stringify({ kind: "invalid_field", role: "MID", field: "full_name", reason: "taken" });
      }
      return [];
    });
    const onGameUpdate = open(player("gen-ray-mid-1", OWN));

    fireEvent.click(renameButton()!);
    const dialog = await screen.findByRole("dialog");
    const full = within(dialog).getByLabelText("playerProfile.rename.fullName");
    fireEvent.change(full, { target: { value: "Ana Pons" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "playerProfile.rename.save" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("playerProfile.rename.errors.taken");
    expect(full).toHaveAttribute("aria-invalid", "true");
    expect(full.getAttribute("aria-describedby")).toContain(alert.id);
    expect(within(dialog).getByLabelText("playerProfile.rename.nick")).not.toHaveAttribute("aria-invalid");
    expect(onGameUpdate).not.toHaveBeenCalled();
  });

  it("closes on Escape", async () => {
    open(player("gen-ray-mid-1", OWN));
    fireEvent.click(renameButton()!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(within(dialog).getByLabelText("playerProfile.rename.nick"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
