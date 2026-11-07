import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import TeamProfileHistoryCard from "@/ui-v2/_legacy/components/teamProfile/TeamProfileHistoryCard";
import TeamProfileLeagueStandingCard from "@/ui-v2/_legacy/components/teamProfile/TeamProfileLeagueStandingCard";

const t = (key: string) => key;

describe("team profile standings use a series record, not football points", () => {
  it("shows the W-L record without a points box in the league standing card", () => {
    render(
      <TeamProfileLeagueStandingCard
        t={t as never}
        standings={{ played: 5, won: 3, lost: 2, points: 9 } as never}
      />,
    );

    expect(screen.getByText("3-2")).toBeInTheDocument();
    expect(screen.queryByText("common.pts")).not.toBeInTheDocument();
    expect(screen.queryByText("9")).not.toBeInTheDocument();
  });

  it("shows the W-L record without a points column in the season history card", () => {
    render(
      <TeamProfileHistoryCard
        t={t as never}
        history={[
          { season: 1, league_position: 2, played: 5, won: 3, lost: 2, points: 9 },
        ] as never}
      />,
    );

    expect(screen.getByText("3-2")).toBeInTheDocument();
    expect(screen.queryByText("common.pts")).not.toBeInTheDocument();
    expect(screen.queryByText("9")).not.toBeInTheDocument();
  });
});
