import { describe, expect, it } from "vitest";

import type { FixtureData, GameStateData, TeamData } from "../../store/gameStore";
import { getScrimWeekOpenAlert, isScrimWeekAwaitingSetup } from "./scrimWeekNotice";

const t = (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key);

function fixture(over: Partial<FixtureData>): FixtureData {
  return {
    id: "f",
    matchday: 1,
    date: "2026-01-11",
    home_team_id: "me",
    away_team_id: "other",
    match_type: "League",
    status: "Scheduled",
    result: null,
    ...over,
  };
}

function game(
  date: string,
  teamOver: Partial<TeamData> = {},
  extra: Partial<GameStateData> = {},
): GameStateData {
  return {
    clock: { current_date: `${date}T12:00:00Z`, start_date: "2026-01-01T00:00:00Z" },
    manager: { team_id: "me" },
    day_phase: "Morning",
    teams: [
      {
        id: "me",
        training_schedule: "Balanced",
        scrim_weekly_slots: 4,
        weekly_scrim_plan_team_ids: [],
        scrim_weekly_objective: null,
        scrim_setup_locked_week_key: null,
        ...teamOver,
      },
    ],
    leagues: [{ id: "l", competition_id: null, fixtures: [fixture({ date: "2026-01-11" })] }],
    ...extra,
  } as unknown as GameStateData;
}

// 2026-01-05 is a Monday; slots 4 means the first scrim day is Wednesday (2026-01-07).
describe("scrim week notice", () => {
  it("tells the player on the Monday the planning reopens with nothing planned", () => {
    const alert = getScrimWeekOpenAlert(game("2026-01-05"), t);
    expect(alert).toMatchObject({ id: "scrim_week_open", tab: "Scrims", severity: "info" });
  });

  it("keeps telling the player until the first scrim day morning", () => {
    expect(isScrimWeekAwaitingSetup(game("2026-01-06"))).toBe(true);
    expect(isScrimWeekAwaitingSetup(game("2026-01-07"))).toBe(true);
  });

  it("keeps telling the player while a later slot of the week is still open", () => {
    expect(isScrimWeekAwaitingSetup(game("2026-01-07", {}, { day_phase: "ScrimBlock" }))).toBe(true);
    expect(isScrimWeekAwaitingSetup(game("2026-01-08"))).toBe(true);
  });

  it("stops once the last scrim day is under way or past", () => {
    expect(isScrimWeekAwaitingSetup(game("2026-01-08", {}, { day_phase: "ScrimBlock" }))).toBe(false);
    expect(isScrimWeekAwaitingSetup(game("2026-01-09"))).toBe(false);
  });

  it("tells a career that starts on the Friday of a six-slot week while the Friday blocks are open", () => {
    const sixSlots = { scrim_weekly_slots: 6 };
    expect(isScrimWeekAwaitingSetup(game("2026-01-09", sixSlots))).toBe(true);
    expect(isScrimWeekAwaitingSetup(game("2026-01-09", sixSlots, { day_phase: "ScrimBlock" }))).toBe(false);
    expect(isScrimWeekAwaitingSetup(game("2026-01-10", sixSlots))).toBe(false);
  });

  it("goes away once the week has a plan, an objective or a confirmed setup", () => {
    expect(isScrimWeekAwaitingSetup(game("2026-01-05", { weekly_scrim_plan_team_ids: [["rival"]] }))).toBe(false);
    expect(isScrimWeekAwaitingSetup(game("2026-01-05", { scrim_weekly_objective: "Macro" }))).toBe(false);
    expect(isScrimWeekAwaitingSetup(game("2026-01-05", { scrim_setup_locked_week_key: "2026-W2" }))).toBe(false);
  });

  it("stays quiet in a week the club rests", () => {
    const resting = game("2026-01-05", {}, {
      leagues: [
        { id: "l", competition_id: null, fixtures: [fixture({ home_team_id: "a", away_team_id: "b", date: "2026-01-11" })] },
      ],
    } as unknown as Partial<GameStateData>);
    expect(isScrimWeekAwaitingSetup(resting)).toBe(false);
  });
});
