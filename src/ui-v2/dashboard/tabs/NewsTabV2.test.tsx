import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { GameStateData, NewsArticle, TeamData } from "@/store/gameStore";
import { NewsTabV2 } from "./NewsTabV2";

vi.mock("react-i18next", () => ({
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      if (key === "news.noNews") return "No news";
      if (key === "news.newsWillAppear") return "News will appear soon";
      if (key === "common.all") return "All";
      if (key === "news.allTeams") return "All Teams";
      if (key === "common.nextPage") return "Next";
      if (key === "news.backToNews") return "Back to news";
      if (key === "news.nArticles") return `${params?.count} articles`;
      if (key.startsWith("news.categories.")) {
        return key.replace("news.categories.", "");
      }
      return key;
    },
    i18n: { language: "en" },
  }),
}));

vi.mock("@/lib/i18n/backendI18n", () => ({
  resolveNewsArticle: (article: unknown) => article,
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

function createNewsArticle(overrides: Partial<NewsArticle> = {}): NewsArticle {
  return {
    id: "news-1",
    headline: "League headline",
    body: "Longer body text",
    source: "OpenFoot Times",
    date: "2026-08-01",
    category: "LeagueRoundup",
    team_ids: ["team-1", "team-2"],
    player_ids: [],
    match_score: null,
    read: false,
    ...overrides,
  };
}

function createGameState(news: NewsArticle[]): GameStateData {
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
    teams: [
      createTeam(),
      createTeam({ id: "team-2", name: "Beta FC", short_name: "BET" }),
    ],
    players: [],
    staff: [],
    messages: [],
    news,
    leagues: [],
    scouting_assignments: [],
    board_objectives: [],
  };
}

describe("NewsTabV2", () => {
  it("renders the empty state when there is no news", () => {
    render(<NewsTabV2 gameState={createGameState([])} onSelectTeam={vi.fn()} />);

    expect(screen.getByText("No news")).toBeInTheDocument();
    expect(screen.getByText("News will appear soon")).toBeInTheDocument();
  });

  it("opens article detail and routes team clicks from the detail footer", () => {
    const onSelectTeam = vi.fn();

    render(
      <NewsTabV2
        gameState={createGameState([createNewsArticle()])}
        onSelectTeam={onSelectTeam}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /League headline/i }));

    expect(screen.getByText("Back to news")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Alpha FC" }).length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole("button", { name: "Alpha FC" })[0]);

    expect(onSelectTeam).toHaveBeenCalledWith("team-1");
  });

  it("filters by category and clears with All", () => {
    render(
      <NewsTabV2
        gameState={createGameState([
          createNewsArticle(),
          createNewsArticle({ id: "news-2", headline: "Injury headline", category: "InjuryNews", date: "2026-07-30" }),
        ])}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "InjuryNews" }));
    expect(screen.queryByRole("button", { name: /League headline/i })).toBeNull();
    expect(screen.getByRole("button", { name: /Injury headline/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByRole("button", { name: /League headline/i })).toBeInTheDocument();
  });

  it("filters by team and shows the score line", () => {
    render(
      <NewsTabV2
        gameState={createGameState([
          createNewsArticle({
            match_score: { home_team_id: "team-1", away_team_id: "team-2", home_goals: 2, away_goals: 1 },
          }),
          createNewsArticle({ id: "news-2", headline: "Other", team_ids: ["team-2"], date: "2026-07-30" }),
        ])}
      />,
    );

    expect(screen.getByText("2 – 1")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("All Teams"), { target: { value: "team-1" } });
    expect(screen.queryByRole("button", { name: /Other/i })).toBeNull();
  });

  it("paginates beyond one page of articles", () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      createNewsArticle({ id: `n${i}`, headline: `Story ${i}`, date: `2026-07-${String(i + 1).padStart(2, "0")}` }),
    );
    render(<NewsTabV2 gameState={createGameState(many)} />);

    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
  });
});
