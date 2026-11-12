import { describe, expect, it } from "vitest";

import type { GameStateData, ScrimReportData, TeamData } from "../../store/gameStore";
import { deriveDailyScrimBlockMeta, deriveTodayScrimContext, deriveWeeklyScrimContext, scrimSlotWeekdays } from "./scrimContext";

function team(overrides: Partial<TeamData> = {}): TeamData {
  return {
    id: "team-1",
    name: "Alpha",
    short_name: "ALP",
    country: "ES",
    city: "Madrid",
    stadium_name: "Arena",
    stadium_capacity: 10000,
    finance: 0,
    manager_id: "manager-1",
    reputation: 500,
    wage_budget: 0,
    transfer_budget: 0,
    season_income: 0,
    season_expenses: 0,
    draft_strategy: "Balanced",
    training_focus: "Scrims",
    training_intensity: "Medium",
    training_schedule: "Balanced",
    weekly_scrim_opponent_ids: ["team-2"],
    weekly_scrim_plan_team_ids: [["team-2", "team-3"]],
    scrim_weekly_slots: 2,
    scrim_reputation: 50,
    scrim_weekly_cancellations: 0,
    scrim_weekly_played: 0,
    scrim_weekly_wins: 0,
    scrim_weekly_losses: 0,
    scrim_loss_streak: 0,
    scrim_slot_results: [],
    scrim_reports: [],
    founded_year: 2024,
    colors: { primary: "#000", secondary: "#fff" },
    starting_xi_ids: [],
    form: [],
    history: [],
    ...overrides,
  };
}

function report(overrides: Partial<ScrimReportData> = {}): ScrimReportData {
  return {
    date: "2026-04-29",
    week_key: "2026-W18",
    slot_index: 0,
    weekday: 1,
    team_id: "team-1",
    opponent_team_id: "team-2",
    status: "Played",
    won: true,
    focus: "DraftPrep",
    issue: null,
    severity: 1,
    quality: 80,
    player_champion_picks: [],
    post_decision: null,
    created_on: "2026-04-28",
    ...overrides,
  };
}

function gameState(myTeam: TeamData, overrides: Partial<GameStateData> = {}): GameStateData {
  return {
    clock: { current_date: "2026-04-29T00:00:00Z", start_date: "2026-04-01T00:00:00Z" },
    day_phase: "Morning",
    manager: { team_id: "team-1" },
    teams: [myTeam, team({ id: "team-2", name: "Beta", weekly_scrim_plan_team_ids: [] })],
    players: [],
    staff: [],
    messages: [],
    news: [],
    leagues: [{ id: "l", name: "League", season: 1, fixtures: [], standings: [] }],
    scouting_assignments: [],
    board_objectives: [],
    ...overrides,
  } as GameStateData;
}

describe("scrimContext", () => {
  it("returns Planned for morning unresolved scrim", () => {
    const context = deriveTodayScrimContext(gameState(team()), team());
    expect(context.state).toBe("Planned");
    expect(context.canCancel).toBe(true);
    expect(context.primaryAction).toBe("OpenPlan");
  });

  it("returns PlayedNeedsReview when report has no decision", () => {
    const myTeam = team({ scrim_reports: [report()] });
    const context = deriveTodayScrimContext(gameState(myTeam, { day_phase: "ScrimBlock" }), myTeam);
    expect(context.state).toBe("PlayedNeedsReview");
    expect(context.canCancel).toBe(false);
    expect(context.canReview).toBe(true);
    expect(context.primaryAction).toBe("Review");
  });

  it("offers the review in the scrim phase and not in the morning, before the scrim is played", () => {
    const myTeam = team({ scrim_reports: [report()] });
    expect(deriveTodayScrimContext(gameState(myTeam, { day_phase: "ScrimBlock" }), myTeam).canReview).toBe(true);
    expect(deriveTodayScrimContext(gameState(myTeam, { day_phase: "Morning" }), myTeam).canReview).toBe(false);
  });

  it("returns Reviewed after post decision", () => {
    const myTeam = team({ scrim_reports: [report({ post_decision: "VodReview" })] });
    const context = deriveTodayScrimContext(gameState(myTeam, { day_phase: "ScrimBlock" }), myTeam);
    expect(context.state).toBe("Reviewed");
    expect(context.canReview).toBe(false);
  });

  it("returns NoScrimToday when no slot matches current weekday", () => {
    const myTeam = team({ scrim_weekly_slots: 2, weekly_scrim_plan_team_ids: [[], []] });
    const context = deriveTodayScrimContext(
      gameState(myTeam, { clock: { current_date: "2026-04-26T00:00:00Z", start_date: "2026-04-01T00:00:00Z" } }),
      myTeam,
    );
    expect(context.state).toBe("NoScrimToday");
    expect(context.canCancel).toBe(false);
  });

  it("returns Cancelled when slot exists but no opponent outside morning", () => {
    const myTeam = team({ weekly_scrim_plan_team_ids: [[]], weekly_scrim_opponent_ids: [""] });
    const context = deriveTodayScrimContext(gameState(myTeam, { day_phase: "ScrimBlock" }), myTeam);
    expect(context.state).toBe("Cancelled");
    expect(context.canCancel).toBe(false);
  });

  it("preserves Plan A/B/C order in weekly context", () => {
    const myTeam = team({ weekly_scrim_plan_team_ids: [["team-2", "team-3", "team-4"]] });
    const weekly = deriveWeeklyScrimContext(gameState(myTeam), myTeam);
    expect(weekly.slots[0].plan).toEqual(["team-2", "team-3", "team-4"]);
  });

  it("keeps Plan A only without inventing fallbacks", () => {
    const myTeam = team({ weekly_scrim_plan_team_ids: [["team-2"]] });
    const weekly = deriveWeeklyScrimContext(gameState(myTeam), myTeam);
    expect(weekly.slots[0].plan).toEqual(["team-2"]);
  });

  it("returns open slot with empty plan when no opponent exists yet", () => {
    const myTeam = team({
      weekly_scrim_plan_team_ids: [[], []],
      weekly_scrim_opponent_ids: ["", ""],
      scrim_weekly_slots: 2,
    });
    const weekly = deriveWeeklyScrimContext(gameState(myTeam), myTeam);
    expect(weekly.slots[0].status).toBe("Open");
    expect(weekly.slots[0].plan).toEqual([]);
  });

  it("marks past unresolved empty slot as cancelled", () => {
    const myTeam = team({
      weekly_scrim_plan_team_ids: [[], []],
      weekly_scrim_opponent_ids: ["", ""],
      scrim_weekly_slots: 2,
    });
    const weekly = deriveWeeklyScrimContext(
      gameState(myTeam, { clock: { current_date: "2026-04-30T00:00:00Z", start_date: "2026-04-01T00:00:00Z" } }),
      myTeam,
    );
    expect(weekly.slots[0].status).toBe("Cancelled");
  });

  it("locks past unresolved slot and disallows editing", () => {
    const myTeam = team({
      scrim_weekly_slots: 2,
      weekly_scrim_plan_team_ids: [["team-2"], []],
      weekly_scrim_opponent_ids: ["team-2", ""],
    });
    const weekly = deriveWeeklyScrimContext(
      gameState(myTeam, { clock: { current_date: "2026-04-30T00:00:00Z", start_date: "2026-04-01T00:00:00Z" } }),
      myTeam,
    );
    expect(weekly.slots[0].status).toBe("Locked");
    expect(weekly.slots[0].canEdit).toBe(false);
  });

  it("marks played slot as Reviewed when decision exists", () => {
    const myTeam = team({
      scrim_reports: [report({ post_decision: "MentalReset" })],
    });
    const weekly = deriveWeeklyScrimContext(gameState(myTeam), myTeam);
    expect(weekly.slots[0].status).toBe("Reviewed");
    expect(weekly.slots[0].canEdit).toBe(false);
    expect(weekly.slots[0].resultWon).toBe(true);
  });

  it("uses fixed weekday distribution for 2/4/6 weekly slots", () => {
    expect(scrimSlotWeekdays(2)).toEqual([2, 2]);
    expect(scrimSlotWeekdays(4)).toEqual([2, 2, 3, 3]);
    expect(scrimSlotWeekdays(6)).toEqual([2, 2, 3, 3, 4, 4]);
  });

  it("normalizes odd slot counts to supported capacities", () => {
    expect(scrimSlotWeekdays(3)).toEqual([2, 2, 3, 3]);
    expect(scrimSlotWeekdays(5)).toEqual([2, 2, 3, 3, 4, 4]);
    expect(scrimSlotWeekdays(1)).toEqual([2, 2]);
  });

  it("recomputes slot count consistently when weekly volume changes", () => {
    const base = team({ scrim_weekly_slots: 2, weekly_scrim_plan_team_ids: [["team-2"], ["team-2"]] });
    const weekly2 = deriveWeeklyScrimContext(gameState(base), base);
    expect(weekly2.capacity).toBe(2);
    expect(weekly2.slots).toHaveLength(2);

    const expanded = { ...base, scrim_weekly_slots: 6 };
    const weekly6 = deriveWeeklyScrimContext(gameState(expanded), expanded);
    expect(weekly6.capacity).toBe(6);
    expect(weekly6.slots).toHaveLength(6);

    const reduced = { ...expanded, scrim_weekly_slots: 4 };
    const weekly4 = deriveWeeklyScrimContext(gameState(reduced), reduced);
    expect(weekly4.capacity).toBe(4);
    expect(weekly4.slots).toHaveLength(4);
  });

  it("derives daily block metadata (A/B) from weekday slot positions", () => {
    const firstBlock = deriveDailyScrimBlockMeta(2, "2026-04-29T00:00:00Z", 0);
    const secondBlock = deriveDailyScrimBlockMeta(2, "2026-04-29T00:00:00Z", 1);

    expect(firstBlock).toEqual({ blockLabel: "A", blockNumber: 1, blocksToday: 2 });
    expect(secondBlock).toEqual({ blockLabel: "B", blockNumber: 2, blocksToday: 2 });
  });
});
