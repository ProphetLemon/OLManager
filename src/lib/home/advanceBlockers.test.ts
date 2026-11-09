import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GameStateData } from "@/store/gameStore";

const service = vi.hoisted(() => ({ checkBlockingActions: vi.fn() }));
vi.mock("@/services/advanceTimeService", () => ({ checkBlockingActions: service.checkBlockingActions }));

import { collectAdvanceBlockers, deriveScrimAdvanceBlockers } from "./advanceBlockers";

function game(
  team: Record<string, unknown> = {},
  overrides: { date?: string; phase?: string } = {},
): GameStateData {
  return {
    manager: { team_id: "t1" },
    clock: { current_date: overrides.date ?? "2025-06-18" },
    day_phase: overrides.phase ?? "Morning",
    teams: [{ id: "t1", name: "Team", ...team }],
  } as unknown as GameStateData;
}

describe("deriveScrimAdvanceBlockers", () => {
  it("reports the weekly setup on the first scrim morning when nothing is configured", () => {
    expect(deriveScrimAdvanceBlockers(game()).map((b) => b.id)).toEqual(["scrim_setup_required"]);
  });

  it("is resolved by an objective, a plan, the week lock or delegating the advance", () => {
    expect(deriveScrimAdvanceBlockers(game({ scrim_weekly_objective: "Draft" }))).toEqual([]);
    expect(deriveScrimAdvanceBlockers(game({ weekly_scrim_plan_team_ids: [["t2"]] }))).toEqual([]);
    expect(deriveScrimAdvanceBlockers(game({ scrim_setup_locked_week_key: "2025-W25" }))).toEqual([]);
    expect(deriveScrimAdvanceBlockers(game(), { mode: "delegate" })).toEqual([]);
  });

  it("only blocks inside the start window", () => {
    expect(deriveScrimAdvanceBlockers(game({}, { date: "2025-06-19" }))).toEqual([]);
    expect(deriveScrimAdvanceBlockers(game({}, { phase: "ScrimBlock" }))).toEqual([]);
  });

  it("reports an undecided scrim review for today during the scrim block", () => {
    const reports = [{ date: "2025-06-19", post_decision: null }];
    const open = game({ scrim_weekly_objective: "Draft", scrim_reports: reports }, { date: "2025-06-19", phase: "ScrimBlock" });
    expect(deriveScrimAdvanceBlockers(open).map((b) => b.id)).toEqual(["scrim_decision_required"]);
    const decided = game(
      { scrim_reports: [{ date: "2025-06-19", post_decision: "Rest" }] },
      { date: "2025-06-19", phase: "ScrimBlock" },
    );
    expect(deriveScrimAdvanceBlockers(decided)).toEqual([]);
  });

  it("returns nothing without a game or a manager team", () => {
    expect(deriveScrimAdvanceBlockers(null)).toEqual([]);
    expect(deriveScrimAdvanceBlockers({ ...game(), manager: {} } as unknown as GameStateData)).toEqual([]);
  });
});

describe("collectAdvanceBlockers", () => {
  beforeEach(() => service.checkBlockingActions.mockReset());

  it("merges the backend pre-check with the scrim blockers the advance command raises", async () => {
    const lineup = { id: "incomplete_lineup", severity: "warn", text: "Lineup", tab: "Squad" };
    service.checkBlockingActions.mockResolvedValue([lineup]);
    const result = await collectAdvanceBlockers("test", game(), { rethrow: true });
    expect(service.checkBlockingActions).toHaveBeenCalledWith("test", { rethrow: true });
    expect(result.map((b) => b.id)).toEqual(["incomplete_lineup", "scrim_setup_required"]);
  });

  it("does not duplicate a blocker the backend already reports", async () => {
    service.checkBlockingActions.mockResolvedValue([
      { id: "scrim_setup_required", severity: "warn", text: "Backend copy", tab: "Scrims" },
    ]);
    const result = await collectAdvanceBlockers("test", game());
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("Backend copy");
  });
});
