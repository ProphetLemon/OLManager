import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { GameStateData } from "@/store/gameStore";
import { makeTransferBid, releasePlayerContract } from "@/services/transfersService";
import PlayerProfileV2 from "@/ui-v2/pages/PlayerProfileV2";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

vi.mock("@/services/transfersService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/transfersService")>()),
  makeTransferBid: vi.fn(),
  releasePlayerContract: vi.fn(),
  previewTransferBidFinancialImpact: vi.fn().mockResolvedValue({
    projection: {
      transfer_budget_before: 1000,
      transfer_budget_after: 500,
      finance_before: 2000,
      finance_after: 1500,
      projected_wage_budget_usage_pct: 42,
      exceeds_transfer_budget: false,
      exceeds_finance: false,
    },
  }),
}));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string | number> | string) =>
      typeof options === "object" && options?.defaultValue ? String(options.defaultValue) : key,
    i18n: { language: "en" },
  }),
}));

function team(id: string, name: string) {
  return {
    id,
    name,
    short_name: name.slice(0, 3),
    country: "GB",
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

function player(teamId: string | null) {
  return {
    id: "player-1",
    match_name: "J. Smith",
    full_name: "John Smith",
    date_of_birth: "2000-01-01",
    nationality: "GB",
    position: "Forward",
    natural_position: "Forward",
    alternate_positions: [],
    attributes: {},
    condition: 80,
    morale: 75,
    team_id: teamId,
    contract_end: "2027-08-01",
    wage: 12000,
    market_value: 350000,
    traits: ["Clutch"],
    career: [],
    transfer_offers: [],
  };
}

function gameState(teamId: string | null, windowStatus = "Open"): GameStateData {
  return {
    clock: { current_date: "2026-08-01T00:00:00Z", start_date: "2026-07-01T00:00:00Z" },
    manager: { id: "m-1", team_id: "team-1" },
    teams: [team("team-1", "Alpha FC"), team("team-2", "Beta FC")],
    players: [player(teamId)],
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
      transfer_window: { status: windowStatus },
    },
  } as unknown as GameStateData;
}

describe("PlayerProfileV2 actions", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue([]);
    vi.mocked(makeTransferBid).mockReset();
    vi.mocked(releasePlayerContract).mockReset();
  });

  it("renders nothing for an unknown player", () => {
    const { container } = render(
      <PlayerProfileV2 gameState={gameState("team-1")} playerId="missing" onClose={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the traits of the player", () => {
    render(<PlayerProfileV2 gameState={gameState("team-1")} playerId="player-1" onClose={vi.fn()} />);
    expect(screen.getByText("Clutch")).toBeInTheDocument();
  });

  it("opens the renewal modal when requested for an own-club player", async () => {
    render(
      <PlayerProfileV2
        gameState={gameState("team-1")}
        playerId="player-1"
        startWithRenewalModal
        onClose={vi.fn()}
        onGameUpdate={vi.fn()}
      />,
    );
    expect(await screen.findByLabelText("playerProfile.renewalWage")).toHaveValue(12000);
  });

  it("does not open the renewal modal for a player of another club", () => {
    render(
      <PlayerProfileV2
        gameState={gameState("team-2")}
        playerId="player-1"
        startWithRenewalModal
        onClose={vi.fn()}
        onGameUpdate={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("playerProfile.renewalWage")).toBeNull();
  });

  it("releases a contract after confirmation and closes the profile", async () => {
    const updated = gameState("team-1");
    vi.mocked(releasePlayerContract).mockResolvedValue(updated);
    const onGameUpdate = vi.fn();
    const onClose = vi.fn();
    render(
      <PlayerProfileV2
        gameState={gameState("team-1")}
        playerId="player-1"
        onClose={onClose}
        onGameUpdate={onGameUpdate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "playerProfile.releaseContract" }));
    expect(screen.getByText("playerProfile.releaseContractConfirm")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "playerProfile.releaseContract" })[1]);

    await waitFor(() => expect(releasePlayerContract).toHaveBeenCalledWith("player-1"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onGameUpdate).toHaveBeenCalledWith(updated);
  });

  it("keeps the release modal open and shows the error when releasing fails", async () => {
    vi.mocked(releasePlayerContract).mockRejectedValue("No budget");
    const onClose = vi.fn();
    render(
      <PlayerProfileV2
        gameState={gameState("team-1")}
        playerId="player-1"
        onClose={onClose}
        onGameUpdate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "playerProfile.releaseContract" }));
    fireEvent.click(screen.getAllByRole("button", { name: "playerProfile.releaseContract" })[1]);

    expect(await screen.findByText("No budget")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not offer releasing when the transfer window is closed", () => {
    render(
      <PlayerProfileV2
        gameState={gameState("team-1", "Closed")}
        playerId="player-1"
        onClose={vi.fn()}
        onGameUpdate={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "playerProfile.releaseContract" })).toBeNull();
  });

  it("sends a transfer offer for a player of another club", async () => {
    vi.mocked(makeTransferBid).mockResolvedValue({
      decision: "rejected",
      game: gameState("team-2"),
      suggested_fee: 400000,
      is_terminal: false,
      feedback: null,
    } as never);
    const onGameUpdate = vi.fn();
    render(
      <PlayerProfileV2
        gameState={gameState("team-2")}
        playerId="player-1"
        onClose={vi.fn()}
        onGameUpdate={onGameUpdate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "playerProfile.makeTransferOffer" }));
    const amount = await screen.findByLabelText("Offer amount");
    expect(amount).toHaveValue(350000);
    fireEvent.click(screen.getByRole("button", { name: "Send offer" }));

    await waitFor(() =>
      expect(makeTransferBid).toHaveBeenCalledWith("player-1", 350000, "main", []),
    );
    await waitFor(() => expect(onGameUpdate).toHaveBeenCalled());
    expect(await screen.findByText("Bid rejected.")).toBeInTheDocument();
    expect(screen.getByLabelText("Offer amount")).toHaveValue(400000);
  });

  it("rejects an invalid transfer offer amount without calling the backend", async () => {
    render(
      <PlayerProfileV2
        gameState={gameState("team-2")}
        playerId="player-1"
        onClose={vi.fn()}
        onGameUpdate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "playerProfile.makeTransferOffer" }));
    fireEvent.change(await screen.findByLabelText("Offer amount"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Send offer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Ingresá un monto de oferta valido.");
    expect(makeTransferBid).not.toHaveBeenCalled();
  });
});
