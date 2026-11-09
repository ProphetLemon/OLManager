import type { TFunction } from "i18next";
import type { FixtureData, LeagueData } from "../../store/gameStore";

export function getFixtureDisplayLabel(
    t: TFunction,
    fixture: FixtureData,
): string {
    if (fixture.match_type === "Playoffs") {
        return t("schedule.playoffs");
    }

    if (fixture.match_type === "PreseasonTournament") {
        return t("season.preseasonTournament");
    }

    if (fixture.match_type === "Friendly") {
        return t("season.friendly");
    }

    return t("common.matchday", { n: fixture.matchday });
}

export function isCompetitiveFixture(fixture: FixtureData): boolean {
    return !fixture.match_type || fixture.match_type === "League";
}

export function getCompetitiveFixtures(fixtures: FixtureData[]): FixtureData[] {
    return fixtures.filter(isCompetitiveFixture);
}

export function findNextFixture(
    fixtures: FixtureData[],
    teamId: string,
): FixtureData | undefined {
    return fixtures.find(
        (fixture) =>
            fixture.status !== "Completed" &&
            (fixture.home_team_id === teamId || fixture.away_team_id === teamId),
    );
}

export function expectedFixtureCount(teamCount: number): number | null {
  if (teamCount >= 2) {
        // Supports both single and double round-robin. Odd sizes add a bye
        // slot, so every pair still meets once per leg.
        return (teamCount * (teamCount - 1)) / 2;
  }

    return null;
}

export function hasFullLeagueSchedule(league: LeagueData): boolean {
    const expectedSingleRoundCount = expectedFixtureCount(league.standings.length);

    if (expectedSingleRoundCount === null) {
        return false;
    }

    const actual = getCompetitiveFixtures(league.fixtures).length;
    const expectedDoubleRoundCount = expectedSingleRoundCount * 2;
    return actual === expectedSingleRoundCount || actual === expectedDoubleRoundCount;
}

export function isSeasonComplete(league: LeagueData | null | undefined): boolean {
    if (!league) {
        return false;
    }

    const regularFixtures = getCompetitiveFixtures(league.fixtures);
    const seasonHasStarted =
        regularFixtures.some((fixture) => fixture.status === "Completed")
        || league.standings.some((entry) => entry.played > 0);
    const regularComplete =
        seasonHasStarted
        && hasFullLeagueSchedule(league)
        && regularFixtures.every((fixture) => fixture.status === "Completed");

    const playoffFixtures = league.fixtures.filter(
        (fixture) => fixture.match_type === "Playoffs",
    );
    const playoffsComplete =
        playoffFixtures.length === 0
        || playoffFixtures.every((fixture) => fixture.status === "Completed");

    return regularComplete && playoffsComplete;
}

