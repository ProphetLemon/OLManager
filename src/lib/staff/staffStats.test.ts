import { describe, expect, it } from "vitest";

import type { StaffData } from "@/store/types";

import { getStaffImpactRows } from "./staffStats";

function member(role: StaffData["role"]): StaffData {
  return {
    id: "s-1",
    first_name: "A",
    last_name: "B",
    date_of_birth: "",
    nationality: "ES",
    role,
    attributes: { coaching: 70, judging_ability: 70, judging_potential: 70, physiotherapy: 70 },
    team_id: "team-1",
    specialization: null,
    wage: 0,
    contract_end: null,
  };
}

describe("getStaffImpactRows", () => {
  it("shows no gameplay impact for a club owner", () => {
    expect(getStaffImpactRows(member("Owner"))).toEqual([]);
  });

  it("still shows the impact of a coach", () => {
    expect(getStaffImpactRows(member("Coach")).length).toBeGreaterThan(0);
  });
});
