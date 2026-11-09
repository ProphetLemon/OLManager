import { describe, expect, it } from "vitest";

import {
  MAX_IMPORTS_IN_STARTING_FIVE,
  countImports,
  orderSwapsImportsFirst,
  parseImportLimitError,
  pickBestFive,
  wouldExceedImportLimit,
} from "@/lib/squad/imports";

const p = (id: string, isImport = false, score = 70) => ({ id, is_import: isImport, score });

describe("import rule helpers", () => {
  it("allows two imports in the starting five", () => {
    expect(MAX_IMPORTS_IN_STARTING_FIVE).toBe(2);
  });

  it("counts imports and ignores a missing flag", () => {
    expect(countImports([p("a", true), p("b"), { id: "c" }, p("d", true)])).toBe(2);
  });

  it("flags a swap that adds a third import", () => {
    const starters = [p("a", true), p("b", true), p("c"), p("d"), p("e")];
    expect(wouldExceedImportLimit(starters, "c", p("x", true))).toBe(true);
    expect(wouldExceedImportLimit(starters, "a", p("x", true))).toBe(false);
    expect(wouldExceedImportLimit(starters, "c", p("x"))).toBe(false);
  });

  it("never blocks a swap that does not add an import", () => {
    const over = [p("a", true), p("b", true), p("c", true), p("d"), p("e")];
    expect(wouldExceedImportLimit(over, "a", p("x"))).toBe(false);
    expect(wouldExceedImportLimit(over, "d", p("x", true))).toBe(true);
  });

  it("does not count an incoming import twice when he already starts in another slot", () => {
    const starters = [p("a", true), p("b", true), p("c"), p("d"), p("e")];
    expect(wouldExceedImportLimit(starters, "c", p("a", true))).toBe(false);
  });

  it("parses the backend refusal", () => {
    expect(parseImportLimitError("LINEUP_TOO_MANY_IMPORTS:3:2")).toEqual({ count: 3, max: 2 });
    expect(parseImportLimitError(new Error("LINEUP_TOO_MANY_IMPORTS:4:2"))).toEqual({
      count: 4,
      max: 2,
    });
    expect(parseImportLimitError("something else")).toBeNull();
  });

  it("auto-picks the best five without a third import", () => {
    const pool = [
      p("i1", true, 95),
      p("i2", true, 90),
      p("i3", true, 85),
      p("r1", false, 80),
      p("r2", false, 70),
      p("r3", false, 60),
    ];
    const ids = pickBestFive(pool, (x) => x.score).map((x) => x.id);
    expect(ids).toEqual(["i1", "i2", "r1", "r2", "r3"]);
  });

  it("orders swaps so the import count never passes the limit mid-way", () => {
    const current = [p("i1", true), p("i2", true), p("r1"), p("r2"), p("r3")];
    const target = [p("r4"), p("i3", true), p("r1"), p("r2"), p("r3")];
    const swaps = orderSwapsImportsFirst(current, target);
    let imports = countImports(current);
    const state = new Map(current.map((x) => [x.id, x]));
    for (const swap of swaps) {
      state.delete(swap.off);
      state.set(swap.on.id, swap.on);
      imports = countImports([...state.values()]);
      expect(imports).toBeLessThanOrEqual(MAX_IMPORTS_IN_STARTING_FIVE);
    }
    expect([...state.keys()].sort()).toEqual(["i3", "r1", "r2", "r3", "r4"]);
  });
});
