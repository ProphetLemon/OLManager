import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GameStateData, TeamData } from "@/store/gameStore";
import YouthAcademyTab from "@/ui-v2/_legacy/components/youthAcademy/YouthAcademyTab";

const promoteAcademyPlayer = vi.fn();
const getAcademyAcquisitionOptions = vi.fn();
const acquireAcademyTeam = vi.fn();

vi.mock("@/services/academyService", () => ({
  getAcademyAcquisitionOptions: (...args: unknown[]) => getAcademyAcquisitionOptions(...args),
  acquireAcademyTeam: (...args: unknown[]) => acquireAcademyTeam(...args),
  promoteAcademyPlayer: (...args: unknown[]) => promoteAcademyPlayer(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      if (key === "youthAcademy.title") return "Academia";
      if (key === "youthAcademy.youthPlayers") return "Jugadores academia";
      if (key === "youthAcademy.avgOvr") return "Media OVR";
      if (key === "youthAcademy.avgPotential") return "Media Potencial";
      if (key === "youthAcademy.highPotential") return "Alto Potencial";
      if (key === "youthAcademy.youthCoach") return "Entrenador de Academia";
      if (key === "youthAcademy.noYouthPlayers") return "No hay jugadores en tu academia.";
      if (key === "youthAcademy.player") return "Jugador";
      if (key === "youthAcademy.pos") return "Pos";
      if (key === "youthAcademy.age") return "Edad";
      if (key === "youthAcademy.ovr") return "OVR";
      if (key === "youthAcademy.potential") return "Potencial";
      if (key === "youthAcademy.growth") return "Crecimiento";
      if (key === "youthAcademy.traits") return "Rasgos";
      if (key === "youthAcademy.condition") return "Energia";
      if (key === "youthAcademy.playersUnder21") return `${params?.count ?? 0} jugadores academia`;
      if (key === "youthAcademy.promote") return "Subir";
      if (key === "youthAcademy.promoting") return "Subiendo...";
      if (key === "youthAcademy.fundAcademy") return "Financiar academia";
      if (key === "youthAcademy.fundingAcademy") return "Financiando...";
      if (key === "youthAcademy.placeholderCustomName") return "Nombre personalizado (opcional)";
      if (key === "youthAcademy.placeholderCustomShortName") return "Sigla personalizada (opcional)";
      if (key === "youthAcademy.placeholderCustomLogoUrl") return "URL logo (opcional)";
      return key;
    },
  }),
}));

beforeEach(() => {
  promoteAcademyPlayer.mockReset();
  getAcademyAcquisitionOptions.mockReset();
  getAcademyAcquisitionOptions.mockResolvedValue({
    parent_team_id: "team-1",
    acquisition_allowed: false,
    blocked_reason: "No eligible ERL acquisition candidate configured for this team country",
    options: [],
  });
  acquireAcademyTeam.mockReset();
});

function createTeam(overrides: Partial<TeamData> = {}): TeamData {
  return {
    id: "team-1",
    name: "Movistar KOI",
    short_name: "MKOI",
    country: "ES",
    city: "Madrid",
    stadium_name: "Arena",
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

function createGameState(): GameStateData {
  const mainTeam = createTeam({ id: "team-1", academy_team_id: "academy-1" });
  const academyTeam = createTeam({
    id: "academy-1",
    name: "Movistar KOI Fenix",
    short_name: "KOIF",
    team_kind: "Academy",
    parent_team_id: "team-1",
    manager_id: null,
  });

  const academyPlayer = {
    id: "academy-player-1",
    team_id: "academy-1",
    full_name: "Academy Player",
    match_name: "Prospect",
    date_of_birth: "2004-01-01",
    natural_position: "MID",
    position: "MID",
    condition: 100,
    traits: [],
    attributes: {
      mechanics: 70,
      laning: 70,
      teamfighting: 70,
      macro_play: 70,
      consistency: 70,
      shotcalling: 70,
      champion_pool: 70,
      discipline: 70,
      mental_resilience: 70,
    },
  } as any;

  const mainPlayer = {
    ...academyPlayer,
    id: "main-player-1",
    team_id: "team-1",
    full_name: "Main Player",
  };

  return {
    clock: { current_date: "2026-08-10T00:00:00Z", start_date: "2026-07-01T00:00:00Z" },
    manager: {
      id: "manager-1",
      first_name: "Jane",
      last_name: "Doe",
      date_of_birth: "1980-01-01",
      nationality: "ES",
      reputation: 50,
      satisfaction: 50,
      fan_approval: 50,
      team_id: "team-1",
      career_stats: { matches_managed: 0, wins: 0, losses: 0, trophies: 0, best_finish: null },
      career_history: [],
    },
    teams: [mainTeam, academyTeam],
    players: [academyPlayer, mainPlayer],
    staff: [],
    messages: [],
    news: [],
    leagues: [],
    scouting_assignments: [],
    board_objectives: [],
  } as GameStateData;
}

describe("YouthAcademyTab", () => {
  it("shows academy roster and hides legacy acquisition section", () => {
    render(<YouthAcademyTab gameState={createGameState()} onSelectPlayer={vi.fn()} onGameUpdate={vi.fn()} />);

    expect(screen.getByText("Movistar KOI Fenix")).toBeInTheDocument();
    expect(screen.getByText("Academy Player")).toBeInTheDocument();
    expect(screen.queryByText("Equipo ERL para adquirir")).not.toBeInTheDocument();
  });

  it("promotes an academy player to main team", async () => {
    const onGameUpdate = vi.fn();
    promoteAcademyPlayer.mockResolvedValueOnce(createGameState());

    render(<YouthAcademyTab gameState={createGameState()} onSelectPlayer={vi.fn()} onGameUpdate={onGameUpdate} />);

    fireEvent.click(screen.getByRole("button", { name: "Subir" }));

    await waitFor(() => expect(promoteAcademyPlayer).toHaveBeenCalledWith("academy-player-1"));
    expect(onGameUpdate).toHaveBeenCalled();
  });

  it("shows finance academy button when team has no linked academy", async () => {
    const stateWithoutAcademy = createGameState();
    stateWithoutAcademy.teams = stateWithoutAcademy.teams.filter((team) => team.id !== "academy-1");
    stateWithoutAcademy.teams[0].academy_team_id = null;
    stateWithoutAcademy.players = stateWithoutAcademy.players.filter((player) => player.team_id !== "academy-1");

    getAcademyAcquisitionOptions.mockResolvedValueOnce({
      parent_team_id: "team-1",
      acquisition_allowed: false,
      blocked_reason: "No eligible ERL acquisition candidate configured for this team country",
      options: [],
    });

    render(<YouthAcademyTab gameState={stateWithoutAcademy} onSelectPlayer={vi.fn()} onGameUpdate={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Financiar academia" })).toBeDisabled();
    });
  });

  it("passes custom academy rename values when financing", async () => {
    const stateWithoutAcademy = createGameState();
    stateWithoutAcademy.teams = stateWithoutAcademy.teams.filter((team) => team.id !== "academy-1");
    stateWithoutAcademy.teams[0].academy_team_id = null;
    stateWithoutAcademy.players = stateWithoutAcademy.players.filter((player) => player.team_id !== "academy-1");

    getAcademyAcquisitionOptions.mockResolvedValueOnce({
      parent_team_id: "team-1",
      acquisition_allowed: true,
      blocked_reason: null,
      options: [
        {
          source_team_id: "academy-lfl-karmine-corp-blue",
          source_team_name: "Karmine Corp Blue",
          source_team_short_name: "KCB",
          source_team_logo_url: null,
          erl_league_id: "lfl",
          league_name: "LFL",
          country: "FR",
          region: "EMEA",
          assignment_rule: "Fallback",
          fallback_reason: null,
          reputation: 5,
          development_level: 4,
          acquisition_cost: 380000,
          rebrand_allowed: true,
          source_identity: {
            source_team_id: "academy-lfl-karmine-corp-blue",
            original_name: "Karmine Corp Blue",
            original_short_name: "KCB",
            original_logo_url: null,
          },
        },
      ],
    });
    acquireAcademyTeam.mockResolvedValueOnce(stateWithoutAcademy);

    render(<YouthAcademyTab gameState={stateWithoutAcademy} onSelectPlayer={vi.fn()} onGameUpdate={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Karmine Corp Blue")).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText("Nombre personalizado (opcional)"), {
      target: { value: "KCB Academy Prime" },
    });
    fireEvent.change(screen.getByPlaceholderText("Sigla personalizada (opcional)"), {
      target: { value: "KCBP" },
    });
    fireEvent.change(screen.getByPlaceholderText("URL logo (opcional)"), {
      target: { value: "https://cdn.example/kcbp.png" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Financiar academia" }));

    await waitFor(() => {
      expect(acquireAcademyTeam).toHaveBeenCalledWith({
        parent_team_id: "team-1",
        source_team_id: "academy-lfl-karmine-corp-blue",
        custom_name: "KCB Academy Prime",
        custom_short_name: "KCBP",
        custom_logo_url: "https://cdn.example/kcbp.png",
      });
    });
  });
});
