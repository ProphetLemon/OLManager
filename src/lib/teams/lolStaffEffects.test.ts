import { describe, expect, it } from "vitest";

import type { GameStateData, StaffData } from "@/store/gameStore";

import { getLolStaffEffectsForTeam } from "./lolStaffEffects";

function member(id: string, role: StaffData["role"], coaching: number): StaffData {
  return {
    id,
    first_name: id,
    last_name: id,
    date_of_birth: "",
    nationality: "ES",
    role,
    attributes: { coaching, judging_ability: coaching, judging_potential: coaching, physiotherapy: coaching },
    team_id: "team-1",
    specialization: null,
    wage: 0,
    contract_end: null,
  };
}

const stateWith = (staff: StaffData[]) => ({ staff }) as unknown as GameStateData;

describe("getLolStaffEffectsForTeam", () => {
  it("ignores a club owner", () => {
    const coach = member("coach", "Coach", 60);
    const owner = member("owner", "Owner", 99);

    expect(getLolStaffEffectsForTeam(stateWith([coach, owner]), "team-1")).toEqual(
      getLolStaffEffectsForTeam(stateWith([coach]), "team-1"),
    );
  });

  it("gives a club with only an owner the same effects as a club with no staff", () => {
    expect(getLolStaffEffectsForTeam(stateWith([member("owner", "Owner", 99)]), "team-1")).toEqual(
      getLolStaffEffectsForTeam(stateWith([]), "team-1"),
    );
  });
});
