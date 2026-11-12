import { describe, expect, it } from "vitest";

import type { GameStateData } from "../../store/gameStore";
import { getDashboardAlerts } from "./helpers";

const t = (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key);

function game(date: string, planned = false): GameStateData {
  return {
    clock: { current_date: `${date}T12:00:00Z`, start_date: "2026-01-01T00:00:00Z" },
    manager: { team_id: "me" },
    day_phase: "Morning",
    players: [],
    staff: [],
    messages: [],
    leagues: [],
    teams: [
      {
        id: "me",
        finance: 1_000_000,
        training_schedule: "Balanced",
        scrim_weekly_slots: 4,
        weekly_scrim_plan_team_ids: planned ? [["rival"]] : [],
        scrim_weekly_objective: null,
        scrim_setup_locked_week_key: null,
      },
    ],
  } as unknown as GameStateData;
}

const ids = (state: GameStateData, assistant = false) =>
  getDashboardAlerts(state, false, t, { assistantResolvesScrims: assistant }).map((alert) => alert.id);

describe("getDashboardAlerts scrim week notice", () => {
  // 2026-01-05 is the Monday the planning reopens after the first (partial) week.
  it("notices on Monday that the week's scrims can be planned", () => {
    expect(ids(game("2026-01-05"))).toContain("scrim_week_open");
  });

  it("drops the notice once the week is planned", () => {
    expect(ids(game("2026-01-05", true))).not.toContain("scrim_week_open");
  });

  it("stays quiet when the Assistant Coach handles the scrims", () => {
    expect(ids(game("2026-01-05"), true)).not.toContain("scrim_week_open");
  });
});
