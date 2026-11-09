import { beforeEach, describe, expect, it, vi } from "vitest";

const service = vi.hoisted(() => ({ checkBlockingActions: vi.fn() }));
vi.mock("@/services/advanceTimeService", () => ({ checkBlockingActions: service.checkBlockingActions }));

import { collectAdvanceBlockers } from "./advanceBlockers";

const lineup = { id: "incomplete_lineup", severity: "warn", tab: "Squad", text: "Lineup" };
const setup = { id: "scrim_setup_required", severity: "warn", tab: "Scrims", text: "Setup" };
const decision = { id: "scrim_decision_required", severity: "warn", tab: "Scrims", text: "Decision" };

describe("collectAdvanceBlockers", () => {
  beforeEach(() => {
    service.checkBlockingActions.mockReset();
  });

  it("returns the backend list as is and forwards the mode and check options", async () => {
    service.checkBlockingActions.mockResolvedValue([lineup, setup]);

    await expect(
      collectAdvanceBlockers("ctx", { mode: "live", rethrow: true, includeScrimStops: false }),
    ).resolves.toEqual([lineup, setup]);
    expect(service.checkBlockingActions).toHaveBeenCalledWith("ctx", {
      mode: "live",
      rethrow: true,
      includeScrimStops: false,
    });
  });

  it("drops the scrim stops the Assistant Coach resolves itself, and only those", async () => {
    service.checkBlockingActions.mockResolvedValue([lineup, setup, decision]);

    await expect(
      collectAdvanceBlockers("ctx", { assistantResolvesScrims: true }),
    ).resolves.toEqual([lineup]);
  });

  it("propagates a failed check so callers keep their previous list", async () => {
    service.checkBlockingActions.mockRejectedValue(new Error("boom"));

    await expect(collectAdvanceBlockers("ctx", { rethrow: true })).rejects.toThrow("boom");
  });
});
