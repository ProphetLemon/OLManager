import { describe, expect, it } from "vitest";
import type { LeagueData } from "../store/types";
import { resolveUserLeague } from "./userLeague";

const league = (competition_id: string | null, id = `league-${competition_id}`) =>
  ({ id, competition_id, name: id, fixtures: [], standings: [] }) as unknown as LeagueData;

describe("resolveUserLeague", () => {
  const lec = league("lec");
  const les = league("les");

  it("returns the user's league when it is not the first one", () => {
    expect(resolveUserLeague({ leagues: [lec, les], user_competition_id: "les" })).toBe(les);
  });

  it("returns the first league when the state has no user_competition_id", () => {
    expect(resolveUserLeague({ leagues: [lec, les] })).toBe(lec);
    expect(resolveUserLeague({ leagues: [lec, les], user_competition_id: null })).toBe(lec);
  });

  it("returns the first league when no league matches the id", () => {
    expect(resolveUserLeague({ leagues: [lec, les], user_competition_id: "lcs" })).toBe(lec);
  });

  it("returns null without leagues or without a state", () => {
    expect(resolveUserLeague({ leagues: [], user_competition_id: "les" })).toBeNull();
    expect(resolveUserLeague({})).toBeNull();
    expect(resolveUserLeague(null)).toBeNull();
    expect(resolveUserLeague(undefined)).toBeNull();
  });
});
