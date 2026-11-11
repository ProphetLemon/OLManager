import { describe, expect, it } from "vitest";

import { deriveTodayScrimContext, deriveWeeklyScrimContext } from "@/lib/scrims/scrimContext";
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

describe("scrim context reads the user's league, not leagues[0]", () => {
  it("scrim context sees the official match of the user's league today", () => {
    const gs = state([league("lec"), league("les", { fixtures: [fixture({ id: "b" })] })]);
    expect(deriveTodayScrimContext(gs, userTeam).hasOfficialMatch).toBe(true);
  });

  it("scrim context names the next official rival from the user's league", () => {
    const gs = state([
      league("lec", { fixtures: [fixture({ id: "a", date: "2026-05-02", away_team_id: "team-3" })] }),
      league("les", { fixtures: [fixture({ id: "b", date: "2026-05-02", away_team_id: "team-2" })] }),
    ]);
    expect(deriveWeeklyScrimContext(gs, userTeam).nextOfficialRivalTeamId).toBe("team-2");
  });
});
