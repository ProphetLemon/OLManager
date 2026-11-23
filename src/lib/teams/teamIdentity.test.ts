import { describe, expect, it } from "vitest";

import type { TeamData } from "@/store/gameStore";
import { teamIdentity, teamIdentityById } from "./teamIdentity";

const team = (over: Partial<TeamData>) => ({ id: "t", name: "Team", short_name: "TM", logo_url: null, ...over }) as TeamData;

describe("teamIdentity", () => {
  it("gives the name, the short name as tag and the team's own logo", () => {
    expect(teamIdentity(team({ name: "UCAM Esports", short_name: "UCAM", logo_url: "/teams-icons/ucam.webp" }))).toEqual({
      name: "UCAM Esports",
      tag: "UCAM",
      logoUrl: "/teams-icons/ucam.webp",
    });
  });

  it("derives the logo from the short name first, then from the name", () => {
    expect(teamIdentity(team({ name: "Thunder Hawks", short_name: "THA" })).logoUrl).toBe("/teams-icons/tha.webp");
    expect(teamIdentity(team({ name: "Thunder Hawks", short_name: "" })).logoUrl).toBe("/teams-icons/thunderhawks.webp");
  });

  it("falls back to the name as tag when the short name is empty", () => {
    expect(teamIdentity(team({ name: "Thunder Hawks", short_name: "" })).tag).toBe("Thunder Hawks");
  });

  it("looks a team up by id and gives null for an unknown or missing id", () => {
    const teams = [team({ id: "a", name: "Alpha", short_name: "ALP" })];
    expect(teamIdentityById(teams, "a")?.tag).toBe("ALP");
    expect(teamIdentityById(teams, "zzz")).toBeNull();
    expect(teamIdentityById(teams, null)).toBeNull();
  });
});
