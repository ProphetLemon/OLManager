import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach } from "vitest";
import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { GameStateData, PlayerData, TeamData } from "@/store/gameStore";
import PlayerProfileV2 from "@/ui-v2/pages/PlayerProfileV2";

function hasAnnualWage(text: string, amount: number): boolean {
  const numberPortion = amount.toLocaleString();
  return text.replace(/\s+/g, "").includes(`€${numberPortion}/yr`);
}

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  initReactI18next: {
    type: "3rdParty",
    init: () => {},
  },
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      if (key === "common.back") return "Back";
      if (key === "common.contract") return "Contract";
      if (key === "common.renewContract") return "Renew Contract";
      if (key === "common.cancel") return "Cancel";
      if (key === "common.done") return "Done";
      if (key === "common.submit") return "Submit";
      if (key === "common.condition") return "Condition";
      if (key === "common.morale") return "Morale";
      if (key === "common.value") return "Value";
      if (key === "common.wage") return "Wage";
      if (key === "common.age") return "Age";
      if (key === "common.freeAgent") return "Free Agent";
      if (key === "common.unknown") return "Unknown";
      if (key === "finances.perWeekSuffix") return "/wk";
      if (key === "finances.perYearSuffix") return "/yr";
      if (key === "finances.marketValue") return "Market Value";
      if (key === "finances.contractRiskCritical") return "Critical";
      if (key === "finances.contractRiskWarning") return "Warning";
      if (key === "finances.contractRiskStable") return "Stable";
      if (key === "finances.contractExpiresOn")
        return `Expires ${params?.date}`;
      if (key === "playerProfile.contractInfo") return "Contract Info";
      if (key === "playerProfile.dateOfBirth") return "Date of Birth";
      if (key === "playerProfile.annualWage") return "Annual Wage";
      if (key === "playerProfile.noContract") return "No Contract";
      if (key === "playerProfile.yearsRemaining") return "Years Remaining";
      if (key === "playerProfile.contractRisk") return "Contract Risk";
      if (key === "playerProfile.releaseContract") return "Release Contract";
      if (key === "playerProfile.releaseContractConfirm")
        return "Release this player and pay a termination fee?";
      if (key === "playerProfile.releasePenalty") return "Termination cost";
      if (key === "playerProfile.makeTransferOffer") return "Make Offer";
      if (key === "playerProfile.transferOfferPrompt")
        return "Enter transfer offer amount (€)";
      if (key === "playerProfile.transferOfferAmount") return "Offer amount";
      if (key === "playerProfile.transferOfferSubmit") return "Send offer";
      if (key === "playerProfile.renewalTitle") return "Renew Contract";
      if (key === "playerProfile.renewalWage") return "Offered Wage";
      if (key === "playerProfile.renewalLength") return "Contract Length";
      if (key === "playerProfile.renewalLengthYears")
        return `${params?.count} years`;
      if (key === "playerProfile.renewalSubmit") return "Submit Offer";
      if (key === "playerProfile.renewalBudgetWarning")
        return "Exceeds wage budget";
      if (key === "playerProfile.renewalInvalidWage")
        return "Enter a valid annual wage";
      if (key === "playerProfile.renewalAccepted") return "Offer accepted";
      if (key === "playerProfile.renewalRejected") return "Offer rejected";
      if (key === "playerProfile.renewalCounter")
        return `Wants more: €${params?.wage}/wk for ${params?.years} years`;
      if (key === "playerProfile.renewalBlocked")
        return "Talks are blocked after your earlier decision";
      if (key === "playerProfile.renewalCooledOff")
        return "Previous talks cooled off, so this starts as a fresh conversation.";
      if (key === "playerProfile.delegateRenewal")
        return "Delegate to Assistant";
      if (key === "playerProfile.renewalDelegateMissingReport")
        return "Assistant report did not include this player.";
      if (key === "playerProfile.renewalConversationTitle")
        return "Negotiation pulse";
      if (key === "playerProfile.renewalProjectionTitle")
        return "Projected financial impact";
      if (key === "playerProfile.renewalProjectionWageBill")
        return `Weekly wage bill ${params?.before} -> ${params?.after}`;
      if (key === "playerProfile.renewalProjectionBudgetUsage")
        return `Wage budget use ${params?.before}% -> ${params?.after}%`;
      if (key === "playerProfile.renewalProjectionRunway")
        return `Cash runway ${params?.before} -> ${params?.after}`;
      if (key === "playerProfile.renewalRound")
        return `Round ${params?.count}`;
      if (key === "playerProfile.renewalPatience") return "Patience";
      if (key === "playerProfile.renewalTension") return "Tension";
      if (key === "playerProfile.renewalFeedbackFirmHeadline")
        return "They want stronger terms before moving.";
      if (key === "playerProfile.renewalFeedbackFirmDetail")
        return "The discussion is still open, but wage level and contract length need to feel clearly worthwhile from their side.";
      if (key === "playerProfile.attributes") return "Attributes";
      if (key === "playerProfile.championPoolTitle") return "Champion Pool";
      if (key === "playerProfile.championInsignia") return "Insignia";
      if (key === "playerProfile.championWinRateShort") return "WR";
      if (key === "playerProfile.championMasteryLabel") return `Mastery ${params?.value}`;
      if (key === "playerProfile.championGames") return "games";
      if (key === "finances.wagePerWeek") return "Wage/wk";
      return key;
    },
    i18n: { language: "en" },
  }),
}));

vi.mock("@/lib/i18n/backendI18n", () => ({
  resolveBackendText: (
    _key?: string,
    fallback?: string,
    _params?: Record<string, string>,
  ) => fallback ?? "",
}));

vi.mock("@/lib/common/countries", () => ({
  countryName: () => "England",
  isValidCountryCode: () => true,
  normaliseNationality: (value: string) => value,
  resolveCountryFlagCode: () => "GB",
}));

interface PlayerProfileAdapterProps {
  player: PlayerData;
  gameState: GameStateData;
  isOwnClub?: boolean;
  onClose: () => void;
  onSelectTeam?: (id: string) => void;
  onGameUpdate?: (state: GameStateData) => void;
}

function PlayerProfile({ player, gameState, onClose, onSelectTeam, onGameUpdate }: PlayerProfileAdapterProps) {
  return (
    <PlayerProfileV2
      gameState={gameState}
      playerId={player.id}
      onClose={onClose}
      onSelectTeam={onSelectTeam}
      onGameUpdate={onGameUpdate}
    />
  );
}

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

function defaultInvokeResponse(_command: string) {
  return createGameState(createPlayer());
}

function RenewalHarness({ initialPlayer }: { initialPlayer?: PlayerData }) {
  const [gameState, setGameState] = useState<GameStateData>(
    createGameState(initialPlayer ?? createPlayer()),
  );

  return (
    <PlayerProfile
      player={gameState.players[0]}
      gameState={gameState}
      isOwnClub
      onClose={vi.fn()}
      onGameUpdate={setGameState}
    />
  );
}

describe("PlayerProfileV2 contract surfaces", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation(async (command: string) =>
      defaultInvokeResponse(command),
    );
  });

  it("renders expiry date, years remaining, and contract risk for the selected player", () => {
    const player = createPlayer();
    const gameState = createGameState(player);

    render(
      <PlayerProfile
        player={player}
        gameState={gameState}
        isOwnClub
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Contract Info")).toBeInTheDocument();
    expect(screen.getByText("Expires 2026-10-15")).toBeInTheDocument();
    expect(screen.getByText("Years Remaining")).toBeInTheDocument();
    expect(screen.getByText("Contract Risk")).toBeInTheDocument();
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(
      screen.getAllByText((_, element) =>
        hasAnnualWage(element?.textContent ?? "", 12000),
      ).length,
    ).toBeGreaterThan(0);
  });

  it("uses persisted champion masteries in the champion pool card", () => {
    const player = createPlayer({ match_name: "Unseeded Player" });
    const gameState = {
      ...createGameState(player),
      champion_masteries: [
        {
          player_id: player.id,
          champion_id: "Azir",
          mastery: 82,
          last_active_on: "2026-08-01",
        },
        {
          player_id: player.id,
          champion_id: "Orianna",
          mastery: 74,
          last_active_on: "2026-08-01",
        },
      ],
    } satisfies GameStateData;

    render(
      <PlayerProfile
        player={player}
        gameState={gameState}
        isOwnClub
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Azir")).toBeInTheDocument();
    expect(screen.getByText("Mastery 82")).toBeInTheDocument();
    expect(screen.getByText("Orianna")).toBeInTheDocument();
    expect(screen.getByText("Mastery 74")).toBeInTheDocument();
  });

  describe("season stats card", () => {
    const record = (fixtureId: string, season: number, result: string, cs: number) => ({
      fixtureId,
      season,
      date: `2026-0${season}-01`,
      competition: "League",
      matchday: 1,
      opponentTeamId: "team-2",
      opponentName: "Bravo FC",
      side: "Blue",
      result,
      role: "Mid",
      championId: null,
      gameDurationSeconds: 1800,
      kills: 3,
      deaths: 1,
      assists: 5,
      cs,
      goldEarned: 10000,
      damageToChampions: 20000,
      visionScore: 20,
      wardsPlaced: 5,
    });

    const renderWithHistory = async (appearances: number, history: unknown[]) => {
      const base = createPlayer();
      const player = createPlayer({ stats: { ...base.stats, appearances, kills: 6, assists: 10 } });
      vi.mocked(invoke).mockImplementation(async (command: string) =>
        command === "get_player_match_history" ? history : defaultInvokeResponse(command),
      );
      render(
        <PlayerProfile player={player} gameState={createGameState(player)} isOwnClub onClose={vi.fn()} />,
      );
      await waitFor(() =>
        expect(vi.mocked(invoke)).toHaveBeenCalledWith("get_player_match_history", expect.anything()),
      );
    };

    it("shows wins, losses, CS and vision summed from the running season's records", async () => {
      await renderWithHistory(2, [
        record("f1", 1, "Win", 300),
        record("f2", 1, "Loss", 250),
        record("old", 0, "Win", 999),
      ]);

      expect(await screen.findByText("common.wins")).toBeInTheDocument();
      expect(screen.getByText("common.losses")).toBeInTheDocument();
      expect(screen.getByText("550")).toBeInTheDocument();
      expect(screen.getByText("40")).toBeInTheDocument();
    });

    it("leaves the derived numbers out when the records do not cover every appearance", async () => {
      await renderWithHistory(5, [record("f1", 1, "Win", 300), record("f2", 1, "Loss", 250)]);

      expect(await screen.findByText("common.games")).toBeInTheDocument();
      expect(screen.queryByText("common.wins")).toBeNull();
      expect(screen.queryByText("CS")).toBeNull();
    });
  });

  it("shows imported attributes for players outside your club", () => {
    const player = createPlayer({
      team_id: "team-2",
      attributes: {
        ...createPlayer().attributes,
        mechanics: 81,
        teamfighting: 77,
        macro_play: 73,
        discipline: 69,
      },
    });
    const gameState = {
      ...createGameState(player),
      teams: [createTeam(), createTeam({ id: "team-2", name: "Beta FC", manager_id: "manager-2" })],
      messages: [
        {
          id: "scout_report_1",
          subject: "Scout Report — J. Smith",
          body: "Report complete",
          sender: "Scout",
          sender_role: "Scout",
          date: "2026-08-02",
          read: false,
          category: "ScoutReport",
          priority: "Normal",
          actions: [],
          context: {
            team_id: null,
            player_id: player.id,
            fixture_id: null,
            match_result: null,
            scout_report: {
              player_id: player.id,
              player_name: player.match_name,
              position: "ADC",
              nationality: player.nationality,
              dob: player.date_of_birth,
              team_name: "Beta FC",
              pace: null,
              shooting: null,
              passing: null,
              dribbling: null,
              defending: null,
              physical: null,
              mechanics: 81,
              laning: null,
              teamfighting: 77,
              macro: 73,
              champion_pool: null,
              discipline: 69,
              condition: null,
              morale: null,
              avg_rating: 75,
              rating_key: "common.scoutRatings.veryGood",
              potential_key: "common.scoutPotential.strong",
              confidence_key: "common.scoutConfidence.moderate",
            },
          },
        },
      ],
    } satisfies GameStateData;

    render(
      <PlayerProfile
        player={player}
        gameState={gameState}
        isOwnClub={false}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByText("playerProfile.attributesHidden")).not.toBeInTheDocument();
    expect(screen.getByText("81")).toBeInTheDocument();
    expect(screen.getByText("77")).toBeInTheDocument();
    expect(screen.getAllByText("73").length).toBeGreaterThan(0);
    expect(screen.getAllByText("69").length).toBeGreaterThan(0);
  });

  it("shows imported attributes for outside players without requiring a scout report", () => {
    const player = createPlayer({
      team_id: "team-2",
      attributes: {
        ...createPlayer().attributes,
        dribbling: 97,
      },
    });
    const gameState = {
      ...createGameState(player),
      teams: [
        createTeam(),
        createTeam({ id: "team-2", name: "Beta FC", manager_id: "manager-2" }),
      ],
      messages: [],
    } satisfies GameStateData;

    render(
      <PlayerProfile
        player={player}
        gameState={gameState}
        isOwnClub
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByText("playerProfile.attributesHidden")).not.toBeInTheDocument();
    expect(screen.getByText("97")).toBeInTheDocument();
  });

  it("allows selecting the player's team from the hero header", () => {
    const player = createPlayer();
    const gameState = createGameState(player);
    const onSelectTeam = vi.fn();

    render(
      <PlayerProfile
        player={player}
        gameState={gameState}
        isOwnClub
        onClose={vi.fn()}
        onSelectTeam={onSelectTeam}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Alpha FC" }));

    expect(onSelectTeam).toHaveBeenCalledWith("team-1");
  });

  it("validates renewal offers before submission", async () => {
    vi.mocked(invoke).mockImplementation(
      async (command: string, payload?: any) => {
        if (command === "preview_renewal_financial_impact") {
          const offered = Number(payload?.annualWage ?? 0);
          return {
            projection: {
              current_annual_wage_bill: 24000,
              projected_annual_wage_bill: 24000 - 12000 + offered,
              annual_wage_budget: 50000,
              annual_soft_cap: 55000,
              current_weekly_wage_spend: 461,
              projected_weekly_wage_spend: Math.round(
                (24000 - 12000 + offered) / 52,
              ),
              current_cash_runway_weeks: 1084,
              projected_cash_runway_weeks: 500,
              currently_over_budget: false,
              policy_allows: offered <= 55000,
            },
          };
        }

        return defaultInvokeResponse(command);
      },
    );

    render(<RenewalHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Renew Contract" }));

    fireEvent.change(screen.getByLabelText("Offered Wage"), {
      target: { value: "0" },
    });

    expect(screen.getByText("Enter a valid annual wage")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Offered Wage"), {
      target: { value: "60000" },
    });

    await waitFor(() => {
      expect(screen.getByText("Exceeds wage budget")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Submit Offer" }),
      ).toBeDisabled();
      expect(screen.getByText("Projected financial impact")).toBeInTheDocument();
    });
  });

  it("submits a renewal offer and refreshes contract data when accepted", async () => {
    const updatedPlayer = createPlayer({
      contract_end: "2029-08-01",
      wage: 15000,
    });
    const updatedGame = createGameState(updatedPlayer);

    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "propose_renewal") {
        return {
          outcome: "accepted",
          game: updatedGame,
          suggested_wage: null,
          suggested_years: null,
          session_status: "agreed",
          is_terminal: true,
        };
      }

      return defaultInvokeResponse(command);
    });

    render(<RenewalHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Renew Contract" }));
    fireEvent.change(screen.getByLabelText("Offered Wage"), {
      target: { value: "15000" },
    });
    fireEvent.change(screen.getByLabelText("Contract Length"), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit Offer" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("propose_renewal", {
        playerId: "player-1",
        annualWage: 15000,
        contractYears: 3,
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Offer accepted")).toBeInTheDocument();
      expect(screen.getByText("Expires 2029-08-01")).toBeInTheDocument();
      expect(
        screen.getAllByText((_, element) =>
          hasAnnualWage(element?.textContent ?? "", 15000),
        ).length,
      ).toBeGreaterThan(0);
      expect(screen.getByText("Stable")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Submit Offer" }),
      ).not.toBeInTheDocument();
    });
  });

  it("shows a rejected state when the renewal offer is turned down", async () => {
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "propose_renewal") {
        return {
          outcome: "rejected",
          game: createGameState(createPlayer()),
          suggested_wage: null,
          suggested_years: null,
          session_status: "stalled",
          is_terminal: false,
        };
      }

      return defaultInvokeResponse(command);
    });

    render(<RenewalHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Renew Contract" }));
    fireEvent.change(screen.getByLabelText("Offered Wage"), {
      target: { value: "12000" },
    });
    fireEvent.change(screen.getByLabelText("Contract Length"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit Offer" }));

    await waitFor(() => {
      expect(screen.getByText("Offer rejected")).toBeInTheDocument();
    });
  });

  it("shows improved terms when the player wants more", async () => {
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "propose_renewal") {
        return {
          outcome: "counter_offer",
          game: createGameState(createPlayer()),
          suggested_wage: 16000,
          suggested_years: 4,
          session_status: "open",
          is_terminal: false,
          feedback: {
            mood: "firm",
            headline_key: "playerProfile.renewalFeedbackFirmHeadline",
            detail_key: "playerProfile.renewalFeedbackFirmDetail",
            tension: 58,
            patience: 64,
            round: 1,
            params: {},
          },
        };
      }

      return defaultInvokeResponse(command);
    });

    render(<RenewalHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Renew Contract" }));
    fireEvent.change(screen.getByLabelText("Offered Wage"), {
      target: { value: "13000" },
    });
    fireEvent.change(screen.getByLabelText("Contract Length"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit Offer" }));

    await waitFor(() => {
      expect(
        screen.getByText("Wants more: €16000/wk for 4 years"),
      ).toBeInTheDocument();
      expect(screen.getByText("Negotiation pulse")).toBeInTheDocument();
      expect(
        screen.getByText("They want stronger terms before moving."),
      ).toBeInTheDocument();
      expect(screen.getByText("Round 1")).toBeInTheDocument();
      expect(screen.getByText("Patience")).toBeInTheDocument();
      expect(screen.getByText("Tension")).toBeInTheDocument();
    });
  });

  it("shows a cooled-off notice when stale talks reset before a new offer", async () => {
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "propose_renewal") {
        return {
          outcome: "counter_offer",
          game: createGameState(createPlayer()),
          suggested_wage: 15500,
          suggested_years: 3,
          session_status: "open",
          is_terminal: false,
          cooled_off: true,
          feedback: {
            mood: "calm",
            headline_key: "playerProfile.renewalFeedbackCalmHeadline",
            detail_key: "playerProfile.renewalFeedbackCalmDetail",
            tension: 34,
            patience: 76,
            round: 1,
            params: {},
          },
        };
      }

      return defaultInvokeResponse(command);
    });

    render(<RenewalHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Renew Contract" }));
    fireEvent.change(screen.getByLabelText("Offered Wage"), {
      target: { value: "13500" },
    });
    fireEvent.change(screen.getByLabelText("Contract Length"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit Offer" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Previous talks cooled off, so this starts as a fresh conversation.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByText("Round 1")).toBeInTheDocument();
    });
  });

  it("can delegate a single renewal attempt to the assistant", async () => {
    const delegatedPlayer = createPlayer({
      contract_end: "2029-08-01",
      wage: 14000,
    });
    const updatedGame = createGameState(delegatedPlayer);

    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "delegate_renewals") {
        return {
          game: updatedGame,
          report: {
            success_count: 1,
            failure_count: 0,
            stalled_count: 0,
            cases: [
              {
                player_id: "player-1",
                player_name: "John Smith",
                status: "successful",
                agreed_wage: 14000,
                agreed_years: 3,
                note: "I was able to close this one without needing you to step in.",
              },
            ],
          },
        };
      }

      return defaultInvokeResponse(command);
    });

    render(<RenewalHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Renew Contract" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Delegate to Assistant" }),
    );

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("delegate_renewals", {
        playerIds: ["player-1"],
        maxWageIncreasePct: 35,
        maxContractYears: 3,
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Offer accepted")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    });
  });

  it("shows a localized error when the assistant report omits the player", async () => {
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "delegate_renewals") {
        return {
          game: createGameState(createPlayer()),
          report: {
            success_count: 0,
            failure_count: 0,
            stalled_count: 0,
            cases: [],
          },
        };
      }

      return defaultInvokeResponse(command);
    });

    render(<RenewalHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Renew Contract" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Delegate to Assistant" }),
    );

    await waitFor(() => {
      expect(
        screen.getByText("Assistant report did not include this player."),
      ).toBeInTheDocument();
    });
  });
});


