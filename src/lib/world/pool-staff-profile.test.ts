// @vitest-environment node
// A person whose Players page lists a staff role is pooled as staff, unless the stats rows show he still plays.
import { describe, expect, it } from "vitest";
import { POSITION_MIN_GAMES, gamesSinceFromRows } from "../../../scripts/world/lib/pool-rating.mjs";
import { selectPool } from "../../../scripts/world/lib/pool.mjs";
import { context, peopleOf, row, world } from "./poolFixtures";

const sofm = row({ player: "SofM", ign: "SofM", name: "Le Quang Duy", country: "Vietnam", birth: "1999-05-01", prole: "Coach", rmin: "Support", rmax: "Support" });
const pick = (rows: ReturnType<typeof row>[], gamesLastYear: Map<string, number> | null) => selectPool({ people: peopleOf(rows), context, world, gamesLastYear });

describe("people the wiki lists as staff", () => {
  it("are pooled as staff with the mapped game role, whatever their roster rows say", () => {
    const out = pick([sofm], new Map());
    expect(out.players).toHaveLength(0);
    expect(out.staff).toEqual([expect.objectContaining({ page: "SofM", role: "Performance Coach" })]);
  });

  it("stay players with the minimum games in the last year, and become staff with one less", () => {
    const plays = pick([sofm], new Map([["SofM", POSITION_MIN_GAMES]]));
    expect(plays.staff).toHaveLength(0);
    expect(plays.players).toEqual([expect.objectContaining({ page: "SofM", role: "Support" })]);
    expect(pick([sofm], new Map([["SofM", POSITION_MIN_GAMES - 1]])).staff).toHaveLength(1);
  });

  it("are pooled as neither when the label maps to no game role", () => {
    const out = pick([row({ player: "Boss", ign: "Boss", prole: "Owner", rmin: "Top", rmax: "Top" })], new Map());
    expect(out.players).toHaveLength(0);
    expect(out.staff).toHaveLength(0);
    expect(out.refused).toEqual([expect.objectContaining({ page: "Boss", kind: "staff", code: "non-sporting-staff" })]);
  });

  it("leave players with a playing or empty profile role as before, with or without stats", () => {
    const rows = [row({ player: "Mid1", ign: "Mid1", prole: "Mid", rmin: "Mid", rmax: "Mid" }), row({ player: "Blank", ign: "Blank", name: "Blank One", prole: "", rmin: "Top", rmax: "Top" })];
    for (const games of [new Map<string, number>(), null]) expect(pick(rows, games).players.map((e) => `${e.page}:${e.role}`)).toEqual(["Blank:Top", "Mid1:Mid"]);
  });

  it("are left alone when there are no stats rows to tell whether he still plays", () => {
    expect(pick([sofm], null).players.map((e) => e.page)).toEqual(["SofM"]);
  });
});

describe("gamesSinceFromRows", () => {
  it("counts the games dated on or after the first day, per player, whatever the role", () => {
    const game = (playerKey: string, role: string, date: string) => ({ playerKey, role, date });
    const rows = [game("A", "Top", "2025-11-17"), game("A", "Jungle", "2026-01-01"), game("A", "Mid", "2025-11-16"), game("B", "Top", "2026-02-02")];
    expect(gamesSinceFromRows(rows, { since: "2025-11-17" })).toEqual(new Map([["A", 2], ["B", 1]]));
  });
});
