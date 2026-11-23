import { describe, expect, it, vi } from "vitest";

import { paletteKeyAction } from "./paletteKeys";
import {
  groupPaletteResults,
  normalize,
  rankEntry,
  searchPalette,
  type PaletteGroupId,
  type PaletteSearchable,
} from "./paletteSearch";

interface Row extends PaletteSearchable {
  id: string;
}

function row(id: string, over: Partial<Row> = {}): Row {
  return { id, group: "sections", order: 0, label: id, zone: null, alias: id, ...over };
}

const ids = (rows: Row[]) => rows.map((r) => r.id);

describe("normalize", () => {
  it("lowercases, strips accents and collapses whitespace", () => {
    expect(normalize("  Équipe   Première ", "fr")).toBe("equipe premiere");
  });

  it("lowercases in the language first, then folds the dotless i (tr)", () => {
    expect(normalize("İsim", "tr")).toBe("isim");
    expect(normalize("ISIM", "tr")).toBe("isim");
    expect(normalize("Takımlar", "tr")).toBe("takimlar");
  });

  it("falls back to a plain lowercase when the language tag is not valid", () => {
    expect(normalize("Squad", "not a tag!")).toBe("squad");
  });
});

describe("searchPalette", () => {
  it('finds "Équipe" from "equipe"', () => {
    const rows = [row("teams", { label: "Équipes", alias: "Teams" }), row("squad", { label: "Effectif", alias: "Squad" })];
    expect(ids(searchPalette(rows, "equipe", "fr"))).toEqual(["teams"]);
  });

  it('matches "İsim" and "ISIM" from "isim", and "Takımlar" from "takimlar" (tr)', () => {
    const rows = [
      row("dotted", { label: "İsim", alias: "Name" }),
      row("caps", { label: "ISIM", alias: "Name", order: 1 }),
      row("teams", { label: "Takımlar", alias: "Teams", order: 2 }),
    ];
    expect(ids(searchPalette(rows, "isim", "tr"))).toEqual(["dotted", "caps"]);
    expect(ids(searchPalette(rows, "takimlar", "tr"))).toEqual(["teams"]);
  });

  it("ranks exact, then prefix, then word-start, then substring", () => {
    const rows = [
      row("substring", { label: "Backstaffing", order: 0 }),
      row("word-start", { label: "World staff", order: 1 }),
      row("prefix", { label: "Staffs", order: 2 }),
      row("exact", { label: "Staff", order: 3 }),
      row("none", { label: "Squad", order: 4 }),
    ];
    expect(rows.map((r) => rankEntry(r, "staff", "en"))).toEqual([3, 2, 1, 0, null]);
    expect(ids(searchPalette(rows, "staff", "en"))).toEqual(["exact", "prefix", "word-start", "substring"]);
  });

  it("breaks a tie by rail order inside a group", () => {
    const rows = [row("b", { label: "Market", order: 2 }), row("a", { label: "Market", order: 1 })];
    expect(ids(searchPalette(rows, "market", "en"))).toEqual(["a", "b"]);
  });

  it("lists the groups by their best entry's rank, a tie in the fixed order (R66)", () => {
    const rows = [
      row("section", { group: "sections", label: "Squad" }),
      row("recent", { group: "recent", label: "Squad" }),
      row("call", { group: "calls", label: "Fix lineup", headline: "Your squad has four starters" }),
      row("view", { group: "views", label: "Squad list" }),
    ];
    expect(ids(searchPalette(rows, "squad", "en"))).toEqual(["recent", "section", "view", "call"]);
  });

  it("puts an exact Sections match above a call whose headline only contains the query, as Enter's target and as a group (R66)", () => {
    const rows = [
      row("call", { group: "calls", label: "Fix lineup", headline: "Your squad has four starters" }),
      row("section", { group: "sections", label: "Squad", order: 5 }),
    ];
    const results = searchPalette(rows, "squad", "en");
    expect(groupPaletteResults(results).map((g) => g.group)).toEqual<PaletteGroupId[]>(["sections", "calls"]);
    // The highlighted entry is the first result: Enter there activates the section.
    const enter = paletteKeyAction({ optionGroups: results.map((r) => r.group), activeIndex: 0, query: "squad" }, { key: "Enter" });
    expect(enter).toEqual({ type: "activate", index: 0 });
    expect(results[0].id).toBe("section");
  });

  it("orders the entries of a group by rank, then rail order (R66)", () => {
    const rows = [
      row("call-contains", { group: "calls", order: 0, label: "Fix lineup", headline: "Your squad has four starters" }),
      row("call-prefix", { group: "calls", order: 1, label: "Squad depth" }),
    ];
    expect(ids(searchPalette(rows, "squad", "en"))).toEqual(["call-prefix", "call-contains"]);
  });

  it('finds the fr "Effectif" from "squad" through its English alias', () => {
    const rows = [row("squad", { label: "Effectif", alias: "Squad" })];
    expect(ids(searchPalette(rows, "squad", "fr"))).toEqual(["squad"]);
  });

  it("searches a call's headline and a view's parent tab", () => {
    const rows = [
      row("call", { group: "calls", label: "Plan scrims", alias: "Plan scrims", headline: "No scrims planned for Thursday" }),
      row("offers", { group: "views", label: "Offers", labelPrefix: "Transfers", alias: "Offers" }),
    ];
    expect(ids(searchPalette(rows, "thursday", "en"))).toEqual(["call"]);
    expect(ids(searchPalette(rows, "transfers", "en"))).toEqual(["offers"]);
  });

  it('tells "Staff · Club" from "Staffs · World" by the zone', () => {
    const rows = [
      row("club-staff", { label: "Staff", zone: "Club", alias: "Staff", order: 6 }),
      row("world-staff", { label: "Staffs", zone: "World", alias: "Staffs", order: 20 }),
    ];
    const both = searchPalette(rows, "staff", "en");
    expect(both.map((r) => `${r.label} · ${r.zone}`)).toEqual(["Staff · Club", "Staffs · World"]);
    expect(ids(searchPalette(rows, "staff world", "en"))).toEqual(["world-staff"]);
    expect(ids(searchPalette(rows, "staff club", "en"))).toEqual(["club-staff"]);
  });

  it("returns every row but the views, in group then rail order, with an empty query", () => {
    const rows = [
      row("view", { group: "views", label: "Offers" }),
      row("section-2", { group: "sections", order: 2 }),
      row("section-1", { group: "sections", order: 1 }),
      row("call", { group: "calls" }),
    ];
    expect(ids(searchPalette(rows, "", "en"))).toEqual(["call", "section-1", "section-2"]);
    expect(ids(searchPalette(rows, "   ", "en"))).toEqual(["call", "section-1", "section-2"]);
  });

  it("normalizes a row's fields once per index build and the query once per keystroke", () => {
    const rows = [row("squad", { label: "Squad" }), row("staff", { label: "Staff", zone: "Club" })];
    const spy = vi.spyOn(String.prototype, "normalize");
    try {
      searchPalette(rows, "s", "en");
      spy.mockClear();
      searchPalette(rows, "st", "en");
      expect(spy).toHaveBeenCalledTimes(1);
      // Another language folds differently, so it normalizes the fields again.
      spy.mockClear();
      searchPalette(rows, "st", "tr");
      expect(spy.mock.calls.length).toBeGreaterThan(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("returns nothing when nothing matches", () => {
    expect(searchPalette([row("squad", { label: "Squad" })], "zzz", "en")).toEqual([]);
  });
});

describe("groupPaletteResults", () => {
  it("keeps the groups in the order the results give them (R66)", () => {
    const rows = [row("section", { group: "sections" }), row("call", { group: "calls" })];
    expect(groupPaletteResults(rows).map((g) => g.group)).toEqual<PaletteGroupId[]>(["sections", "calls"]);
  });


  it("groups the results and leaves out the groups with no row", () => {
    const rows = [row("call", { group: "calls" }), row("section-1", { group: "sections" }), row("section-2", { group: "sections" })];
    const groups = groupPaletteResults(rows);
    expect(groups.map((g) => g.group)).toEqual<PaletteGroupId[]>(["calls", "sections"]);
    expect(groups.map((g) => ids(g.entries))).toEqual([["call"], ["section-1", "section-2"]]);
  });
});
