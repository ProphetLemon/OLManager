import { describe, expect, it } from "vitest";

import type { StaffData } from "@/store/types";

import { availableStaff, clubStaff } from "./staffLists";

function member(id: string, role: StaffData["role"], teamId: string | null): StaffData {
  return {
    id,
    first_name: "A",
    last_name: "B",
    date_of_birth: "",
    nationality: "ES",
    role,
    attributes: { coaching: 70, judging_ability: 70, judging_potential: 70, physiotherapy: 70 },
    team_id: teamId,
    specialization: null,
    wage: 0,
    contract_end: null,
  };
}

const staff = [
  member("coach", "Coach", "team-1"),
  member("owner", "Owner", "team-1"),
  member("rival", "Scout", "team-2"),
  member("free", "Physio", null),
  member("free-owner", "Owner", null),
];

describe("clubStaff", () => {
  it("lists the staff of the club, its owner included", () => {
    expect(clubStaff(staff, "team-1").map((s) => s.id)).toEqual(["coach", "owner"]);
  });
});

describe("availableStaff", () => {
  it("lists the staff with no club, never an owner", () => {
    expect(availableStaff(staff).map((s) => s.id)).toEqual(["free"]);
  });
});
