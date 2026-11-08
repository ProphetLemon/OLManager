import { describe, expect, it } from "vitest";

import { groupLeaguesByTier, listCompetitionLeagues } from "@/lib/world/leagueGroups";

const league = (id: string, tier: number, extra: Record<string, unknown> = {}) => ({ id, tier, ...extra });

describe("groupLeaguesByTier", () => {
  it("puts tier-1 leagues in main and tier >= 2 leagues in regional, preserving order", () => {
    const groups = groupLeaguesByTier([league("les", 2), league("lec", 1), league("lfl", 2), league("lck", 1)]);

    expect(groups.main.map((l) => l.id)).toEqual(["lec", "lck"]);
    expect(groups.regional.map((l) => l.id)).toEqual(["les", "lfl"]);
  });

  it("treats a missing tier as a main league", () => {
    expect(groupLeaguesByTier([{ id: "x", tier: undefined }]).main).toHaveLength(1);
  });
});

describe("listCompetitionLeagues", () => {
  const fixtures = [{ id: "f1" }];

  it("lists active tier-1 leagues first, then active regional leagues with fixtures", () => {
    const result = listCompetitionLeagues([
      league("les", 2, { active: true, fixtures }),
      league("lec", 1, { active: true, fixtures: [] }),
    ]);

    expect(result.map((l) => l.id)).toEqual(["lec", "les"]);
  });

  it("hides regional leagues without fixtures and inactive leagues", () => {
    const result = listCompetitionLeagues([
      league("lfl", 2, { active: true, fixtures: [] }),
      league("lit", 2, { active: false, fixtures }),
      league("lec", 1, { active: true, fixtures }),
    ]);

    expect(result.map((l) => l.id)).toEqual(["lec"]);
  });
});
