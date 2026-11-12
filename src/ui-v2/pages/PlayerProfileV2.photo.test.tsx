import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { GameStateData } from "@/store/gameStore";
import { buildPortraitFromFile } from "@/lib/customTeam/portrait";
import PlayerProfileV2 from "@/ui-v2/pages/PlayerProfileV2";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

vi.mock("@/lib/customTeam/portrait", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/customTeam/portrait")>()),
  buildPortraitFromFile: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string | number> | string) =>
      typeof options === "object" && options?.defaultValue ? String(options.defaultValue) : key,
    i18n: { language: "en" },
  }),
}));

const OWN = "les-custom-ray";
const PHOTO = "data:image/png;base64,NEWPHOTO";
const OLD_PHOTO = "data:image/png;base64,OLDPHOTO";

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

function player(id: string, teamId: string | null, photo: string | null = null) {
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
    profile_image_url: photo,
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

const changeButton = () => screen.queryByRole("button", { name: /^playerProfile\.photo\.(change|add)Aria$/ });
const removeButton = () => screen.queryByRole("button", { name: "playerProfile.photo.removeAria" });
const fileInput = () => screen.getByTestId("player-photo-input");

function open(record: ReturnType<typeof player>, onGameUpdate: ((game: GameStateData) => void) | undefined = vi.fn()) {
  const view = render(
    <PlayerProfileV2
      gameState={gameState([record])}
      playerId={record.id}
      onClose={vi.fn()}
      onGameUpdate={onGameUpdate}
    />,
  );
  return { onGameUpdate, view };
}

const pick = (file: File) => fireEvent.change(fileInput(), { target: { files: [file] } });
const png = () => new File(["x"], "me.png", { type: "image/png" });

describe("PlayerProfileV2 photo", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue([]);
    vi.mocked(buildPortraitFromFile).mockReset();
  });

  it("offers Add photo, and no Remove, to a founder who has none", () => {
    open(player("gen-ray-mid-1", OWN));
    expect(changeButton()).toHaveAccessibleName("playerProfile.photo.addAria");
    expect(removeButton()).not.toBeInTheDocument();
  });

  it("offers Change photo and Remove photo to a founder who has one", () => {
    open(player("gen-ray-mid-1", OWN, OLD_PHOTO));
    expect(changeButton()).toHaveAccessibleName("playerProfile.photo.changeAria");
    expect(removeButton()).toBeInTheDocument();
  });

  it.each([
    ["a player the club did not start with", player("p-123", OWN)],
    ["a generated player of another club", player("gen-ray-mid-1", "les-b")],
    ["a free agent", player("gen-ray-mid-1", null)],
  ])("does not offer a photo change for %s", (_label, record) => {
    open(record);
    expect(changeButton()).not.toBeInTheDocument();
    expect(removeButton()).not.toBeInTheDocument();
    expect(screen.queryByTestId("player-photo-input")).not.toBeInTheDocument();
  });

  it("does not offer a photo change when the profile cannot update the game", () => {
    render(<PlayerProfileV2 gameState={gameState([player("gen-ray-mid-1", OWN)])} playerId="gen-ray-mid-1" onClose={vi.fn()} />);
    expect(changeButton()).not.toBeInTheDocument();
  });

  it("stores the prepared photo and hands the returned game to the app", async () => {
    const updated = { marker: "photo game" } as unknown as GameStateData;
    vi.mocked(buildPortraitFromFile).mockResolvedValue(PHOTO);
    vi.mocked(invoke).mockImplementation(async (command: string) => (command === "set_player_photo" ? updated : []));
    const { onGameUpdate } = open(player("gen-ray-mid-1", OWN));

    pick(png());

    await waitFor(() => expect(onGameUpdate).toHaveBeenCalledWith(updated));
    expect(invoke).toHaveBeenCalledWith("set_player_photo", { playerId: "gen-ray-mid-1", photo: PHOTO });
  });

  it("removes the photo by sending null", async () => {
    const updated = { marker: "removed game" } as unknown as GameStateData;
    vi.mocked(invoke).mockImplementation(async (command: string) => (command === "set_player_photo" ? updated : []));
    const { onGameUpdate } = open(player("gen-ray-mid-1", OWN, OLD_PHOTO));

    fireEvent.click(removeButton()!);

    await waitFor(() => expect(onGameUpdate).toHaveBeenCalledWith(updated));
    expect(invoke).toHaveBeenCalledWith("set_player_photo", { playerId: "gen-ray-mid-1", photo: null });
    expect(buildPortraitFromFile).not.toHaveBeenCalled();
  });

  it("shows the wizard's message for a refused file and never reaches the command", async () => {
    const { buildPortraitFromFile: real } = await vi.importActual<typeof import("@/lib/customTeam/portrait")>(
      "@/lib/customTeam/portrait",
    );
    vi.mocked(buildPortraitFromFile).mockImplementation(real);
    const { onGameUpdate } = open(player("gen-ray-mid-1", OWN, OLD_PHOTO));

    pick(new File(["<svg/>"], "me.svg", { type: "image/svg+xml" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("teamSelect.founders.photo.errors.unsupportedType");
    expect(invoke).not.toHaveBeenCalledWith("set_player_photo", expect.anything());
    expect(onGameUpdate).not.toHaveBeenCalled();
  });

  it("shows the image message when the backend refuses the photo", async () => {
    vi.mocked(buildPortraitFromFile).mockResolvedValue(PHOTO);
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "set_player_photo") {
        throw JSON.stringify({ kind: "invalid_photo", role: "MID", reason: "too_large" });
      }
      return [];
    });
    const { onGameUpdate } = open(player("gen-ray-mid-1", OWN));

    pick(png());

    expect(await screen.findByRole("alert")).toHaveTextContent("teamSelect.founders.photo.errors.tooBig");
    expect(onGameUpdate).not.toHaveBeenCalled();
  });

  it("explains a refusal for a player who is no longer a founder", async () => {
    vi.mocked(buildPortraitFromFile).mockResolvedValue(PHOTO);
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "set_player_photo") throw JSON.stringify({ kind: "not_a_founder", player_id: "gen-ray-mid-1" });
      return [];
    });
    open(player("gen-ray-mid-1", OWN));

    pick(png());

    expect(await screen.findByRole("alert")).toHaveTextContent("playerProfile.photo.notAFounder");
  });

  it("shows the new photo in the profile once the game carries it", () => {
    const record = player("gen-ray-mid-1", OWN, OLD_PHOTO);
    const { view } = open(record);
    expect(screen.getAllByAltText("Rayo")[0]).toHaveAttribute("src", OLD_PHOTO);

    view.rerender(
      <PlayerProfileV2
        gameState={gameState([player("gen-ray-mid-1", OWN, PHOTO)])}
        playerId="gen-ray-mid-1"
        onClose={vi.fn()}
        onGameUpdate={vi.fn()}
      />,
    );

    expect(screen.getAllByAltText("Rayo")[0]).toHaveAttribute("src", PHOTO);
  });
});
