import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TeamProfileLeagueStandingCardV2 } from "@/ui-v2/pages/teamProfile/TeamProfileInfoCardsV2";
import {
  TeamProfileHistoryCardV2,
  TeamProfileRecentMatchesCardV2,
} from "@/ui-v2/pages/teamProfile/TeamProfileRecordCardsV2";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

describe("team profile standings use a series record, not football points", () => {
  it("shows the W-L record without a points box in the league standing card", () => {
    render(
      <TeamProfileLeagueStandingCardV2
        standings={{ played: 5, won: 3, lost: 2, points: 9 } as never}
      />,
    );

    expect(screen.getByText("3-2")).toBeInTheDocument();
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.queryByText("common.pts")).not.toBeInTheDocument();
    expect(screen.queryByText("9")).not.toBeInTheDocument();
  });

  it("renders nothing without standings", () => {
    const { container } = render(<TeamProfileLeagueStandingCardV2 standings={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the W-L record without a points column in the season history card", () => {
    render(
      <TeamProfileHistoryCardV2
        history={[
          { season: 1, league_position: 2, played: 5, won: 3, lost: 2, points: 9 },
        ] as never}
      />,
    );

    expect(screen.getByText("3-2")).toBeInTheDocument();
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(screen.getByText("#2")).toBeInTheDocument();
    expect(screen.queryByText("common.pts")).not.toBeInTheDocument();
    expect(screen.queryByText("9")).not.toBeInTheDocument();
  });

  it("renders nothing for an empty history or match list", () => {
    const history = render(<TeamProfileHistoryCardV2 history={[]} />);
    expect(history.container).toBeEmptyDOMElement();
    const matches = render(<TeamProfileRecentMatchesCardV2 matches={[]} />);
    expect(matches.container).toBeEmptyDOMElement();
  });

  it("falls back to english labels for missing recent-match translations", () => {
    render(
      <TeamProfileRecentMatchesCardV2
        matches={[
          {
            fixtureId: "f1", date: "2026-08-01", competition: "lec", matchday: 1,
            opponentTeamId: "t2", opponentName: "Bravo FC", side: "Blue", result: "Win",
            gameDurationSeconds: 1800, kills: 10, deaths: 2, goldEarned: 100, damageToChampions: 200, objectives: 5,
          },
        ]}
      />,
    );

    expect(screen.getByText("Recent Matches")).toBeInTheDocument();
    expect(screen.getByText("K / D / A")).toBeInTheDocument();
    expect(screen.getByText("10 / 2 / 5")).toBeInTheDocument();
  });
});
