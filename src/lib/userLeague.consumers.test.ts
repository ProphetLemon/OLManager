import { describe, expect, it } from "vitest";

import { getTodayMatchFixture } from "@/lib/dashboard/helpers";
import { getRecentResultsForTeam } from "@/lib/home/helpers";
import { resolveSeasonContext } from "@/lib/season/seasonContext";
import { buildTeamProfileViewModel } from "@/lib/teamProfile/viewModel";
import { getTodayMatchFixture as getLegacyTodayMatchFixture } from "@/ui-v2/_legacy/components/dashboard/dashboardHelpers";
import type { FixtureData, GameStateData, LeagueData, TeamData } from "@/store/types";

// The user plays in the SECOND league of the list ("les"); the first one ("lec") belongs
// to another competition. Every consumer must read "les".

const TODAY = "2026-04-29";

function fixture(overrides: Partial<FixtureData>): FixtureData {
  return {
    id: "fx",
    matchday: 1,
    date: TODAY,
    home_team_id: "team-1",
    away_team_id: "team-2",
    match_type: "League",
    status: "Scheduled",
    result: null,
    ...overrides,
  } as FixtureData;
}

function standing(team_id: string, points: number) {
  return { team_id, played: 1, won: 1, lost: 0, maps_won: 2, maps_lost: 0, points };
}

function league(competition_id: string, overrides: Partial<LeagueData> = {}): LeagueData {
  return {
    id: `league-${competition_id}`,
    competition_id,
    name: competition_id.toUpperCase(),
    season: 1,
    fixtures: [],
    standings: [],
    ...overrides,
  } as LeagueData;
}

function state(leagues: LeagueData[], overrides: Partial<GameStateData> = {}): GameStateData {
  return {
    clock: { current_date: `${TODAY}T00:00:00Z`, start_date: "2026-04-01T00:00:00Z" },
    day_phase: "Morning",
    manager: { team_id: "team-1" },
    teams: [],
    players: [],
    staff: [],
    messages: [],
    news: [],
    leagues,
    user_competition_id: "les",
    scouting_assignments: [],
    board_objectives: [],
    ...overrides,
  } as unknown as GameStateData;
}

const userTeam = {
  id: "team-1",
  name: "Alpha",
  scrim_weekly_slots: 2,
  weekly_scrim_plan_team_ids: [],
  scrim_reports: [],
  scrim_slot_results: [],
} as unknown as TeamData;

describe("consumers read the user's league, not leagues[0]", () => {
  it("team profile standings come from the user's league", () => {
    const gs = state([
      league("lec", { standings: [standing("team-1", 0), standing("team-9", 9)] }),
      league("les", { standings: [standing("team-2", 6), standing("team-1", 3)] }),
    ]);
    const view = buildTeamProfileViewModel(userTeam, gs);
    expect(view.standings?.points).toBe(3);
    expect(view.leaguePos).toBe(2);
  });

  it("season context phase comes from the user's league", () => {
    const gs = state([
      league("lec", { fixtures: [fixture({ id: "a", status: "Completed" })] }),
      league("les", { fixtures: [fixture({ id: "b", date: "2026-08-01" })] }),
    ]);
    expect(resolveSeasonContext(gs).phase).toBe("Preseason");
  });

  it.each([
    ["lib/dashboard/helpers", getTodayMatchFixture],
    ["_legacy dashboardHelpers", getLegacyTodayMatchFixture],
  ])("%s finds today's match in the user's league", (_name, find) => {
    const gs = state([league("lec"), league("les", { fixtures: [fixture({ id: "b" })] })]);
    expect(find(gs)?.id).toBe("b");
  });

  it("recent results come from the user's league", () => {
    const done = fixture({
      id: "b",
      status: "Completed",
      result: { home_wins: 2, away_wins: 0 } as unknown as FixtureData["result"],
    });
    const gs = state([league("lec"), league("les", { fixtures: [done] })]);
    expect(getRecentResultsForTeam(gs, "team-1")).toHaveLength(1);
  });
});
