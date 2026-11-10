import { describe, expect, it } from "vitest";
import type { GameStateData } from "@/store/types";
import { getStandingsPanelData, shortCompetitionName } from "./standings";

function build(opts: { count?: number; myRank?: number; phase?: "Preseason" | "InSeason"; ladder?: unknown } = {}) {
  const count = opts.count ?? 14;
  const myRank = opts.myRank ?? 1;
  const teams = Array.from({ length: count }, (_, i) => ({
    id: `t${i + 1}`,
    name: `Team ${i + 1}`,
    short_name: `T${i + 1}`,
    logo_url: null,
  }));
  // Rank i has points (count - i): strictly descending, so rank == index + 1.
  const standings = teams.map((t, i) => ({ team_id: t.id, played: 5, won: count - i, lost: i, points: count - i }));
  return {
    manager: { team_id: `t${myRank}` },
    user_competition_id: "lec",
    teams,
    players: [],
    season_context: { phase: opts.phase ?? "InSeason" },
    ladder: opts.ladder,
    leagues: [{ id: "l", name: "LEC", season: 2, competition_id: "lec", standings, fixtures: [] }],
  } as unknown as GameStateData;
}

describe("getStandingsPanelData", () => {
  it("returns null without a league", () => {
    expect(getStandingsPanelData({ ...build(), leagues: [] } as unknown as GameStateData)).toBeNull();
  });

  it("lists the top rows sorted by points and flags the user", () => {
    const data = getStandingsPanelData(build({ myRank: 2 }))!;
    expect(data.rows).toHaveLength(8);
    expect(data.rows.map((r) => r.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(data.rows[1]).toMatchObject({ isMe: true, shortName: "T2", won: 13, lost: 1 });
    expect(data.gapBefore).toBeNull();
    expect(data).toMatchObject({ competitionName: "LEC", season: 2, preseason: false });
  });

  it("appends the user row with a gap divider when ranked 12th", () => {
    const data = getStandingsPanelData(build({ myRank: 12 }))!;
    expect(data.rows).toHaveLength(9);
    expect(data.rows[8]).toMatchObject({ position: 12, isMe: true });
    expect(data.gapBefore).toBe(8);
  });

  it("needs no divider when the user is directly below the limit", () => {
    const data = getStandingsPanelData(build({ myRank: 9 }))!;
    expect(data.rows[8].position).toBe(9);
    expect(data.gapBefore).toBeNull();
  });

  it("lists every club of a league with up to nine clubs, with no divider", () => {
    for (const myRank of [1, 5, 9]) {
      const data = getStandingsPanelData(build({ count: 9, myRank }))!;
      expect(data.rows.map((r) => r.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      expect(data.rows.filter((r) => r.isMe)).toHaveLength(1);
      expect(data.gapBefore).toBeNull();
    }
    expect(getStandingsPanelData(build({ count: 8, myRank: 3 }))!.rows).toHaveLength(8);
  });

  it("keeps the top-eight rule from ten clubs up", () => {
    expect(getStandingsPanelData(build({ count: 10, myRank: 2 }))!.rows).toHaveLength(8);
  });

  it("honours a custom limit", () => {
    expect(getStandingsPanelData(build({ myRank: 1 }), { limit: 3 })!.rows).toHaveLength(3);
  });

  it("flags preseason", () => {
    expect(getStandingsPanelData(build({ phase: "Preseason" }))!.preseason).toBe(true);
  });

  it("tags promoted teams only from movements into this competition", () => {
    const ladder = {
      movements: [
        { link_lower: "lfl", link_upper: "lec", season: 1, promoted: ["t3"], relegated: ["t9"], status: "Applied" },
        { link_lower: "lec", link_upper: "other", season: 1, promoted: ["t4"], relegated: [], status: "Applied" },
      ],
    };
    const rows = getStandingsPanelData(build({ ladder }))!.rows;
    expect(rows.find((r) => r.teamId === "t3")?.movement).toBe("promoted");
    expect(rows.find((r) => r.teamId === "t4")?.movement).toBeNull();
    expect(rows.find((r) => r.teamId === "t9")).toBeUndefined();
  });

  it("tags only the latest promotion in a multi-season history", () => {
    const ladder = {
      movements: [
        { link_lower: "lfl", link_upper: "lec", season: 0, promoted: ["t3", "t5"], relegated: [], status: "Applied" },
        { link_lower: "lfl", link_upper: "lec", season: 1, promoted: ["t6"], relegated: ["t5"], status: "Applied" },
      ],
    };
    const rows = getStandingsPanelData(build({ ladder }))!.rows;
    const tag = (id: string) => rows.find((r) => r.teamId === id)?.movement;
    expect(tag("t6")).toBe("promoted");
    expect(tag("t3")).toBeNull();
    expect(tag("t5")).toBeNull();
  });

  it("drops the tag once the promotion is older than the previous season", () => {
    const ladder = {
      movements: [
        { link_lower: "lfl", link_upper: "lec", season: 0, promoted: ["t3"], relegated: [], status: "Applied" },
      ],
    };
    expect(getStandingsPanelData(build({ ladder }))!.rows.every((r) => r.movement === null)).toBe(true);
  });

  it("does not tag when the latest movement was skipped", () => {
    const ladder = {
      movements: [
        { link_lower: "lfl", link_upper: "lec", season: 0, promoted: ["t3"], relegated: [], status: "Applied" },
        { link_lower: "lfl", link_upper: "lec", season: 1, promoted: ["t4"], relegated: [], status: "SkippedLate" },
      ],
    };
    expect(getStandingsPanelData(build({ ladder }))!.rows.every((r) => r.movement === null)).toBe(true);
  });

  it("gives no movement tag without a ladder", () => {
    const rows = getStandingsPanelData(build())!.rows;
    expect(rows.every((r) => r.movement === null)).toBe(true);
  });
});

describe("shortCompetitionName", () => {
  it("keeps names that already fit", () => {
    expect(shortCompetitionName("LEC")).toBe("LEC");
  });

  it("collapses long names to their initials", () => {
    expect(shortCompetitionName("League of Legends Championship")).toBe("LOLC");
    expect(shortCompetitionName("Liga Espanola Superior")).toBe("LES");
  });

  it("falls back to a prefix for a single long word", () => {
    expect(shortCompetitionName("Superliga")).toBe("SUPE");
  });
});
