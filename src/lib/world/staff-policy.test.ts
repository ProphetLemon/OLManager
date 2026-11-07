// @vitest-environment node
import { describe, expect, it } from "vitest";
import { dataRoleForLabel, resolveRoleChange } from "../../../scripts/world/lib/staff-policy.mjs";

describe("staff policy", () => {
  it("maps Leaguepedia labels to data role strings and never to Assistant or Owner", () => {
    expect(dataRoleForLabel("Head Coach")).toBe("HeadCoach");
    expect(dataRoleForLabel("Interim Head Coach")).toBe("HeadCoach");
    expect(dataRoleForLabel("Assistant Coach")).toBe("Performance Coach");
    expect(dataRoleForLabel("Strategy Analyst")).toBe("Analyst");
    expect(dataRoleForLabel("Scout")).toBe("Scout");
    for (const label of ["Owner", "Chief Executive Officer", "Streamer", "Head Chef & Nutritionist"]) expect(dataRoleForLabel(label)).toBeNull();
  });

  it("changes roles only among coach-like roles", () => {
    expect(resolveRoleChange("Analyst", "HeadCoach")).toEqual({ role: "HeadCoach", blockedBy: null });
    expect(resolveRoleChange("HeadCoach", "HeadCoach")).toEqual({ role: null, blockedBy: null });
    expect(resolveRoleChange("Assistant", "HeadCoach").blockedBy).toMatch(/protected/);
    expect(resolveRoleChange("Owner", "HeadCoach").blockedBy).toMatch(/protected/);
    expect(resolveRoleChange("Scout", "Analyst").blockedBy).toMatch(/not a coach-like/);
    expect(resolveRoleChange("Assistant", "Performance Coach")).toEqual({ role: null, blockedBy: null });
  });
});
