import { describe, expect, it } from "vitest";

import type { GameStateData } from "@/store/types";
import { resolveEndPeriod } from "./endPeriod";

function state(splitIndex: number, splitNames: string[] | null): GameStateData {
  return {
    user_competition_id: "les",
    leagues: [{ id: "l1", competition_id: "les", name: "LES", season: 1, split_index: splitIndex, fixtures: [], standings: [] }],
    ...(splitNames
      ? { competition_configs: { les: { schedule: { splits: splitNames.map((name) => ({ name })) } } } }
      : {}),
  } as unknown as GameStateData;
}

describe("resolveEndPeriod", () => {
  it("names the split when later splits remain in the season", () => {
    expect(resolveEndPeriod(state(0, ["Winter", "Spring", "Summer"]))).toEqual({ kind: "split", name: "Winter" });
    expect(resolveEndPeriod(state(1, ["Winter", "Spring", "Summer"]))).toEqual({ kind: "split", name: "Spring" });
  });

  it("is the season at the last split", () => {
    expect(resolveEndPeriod(state(2, ["Winter", "Spring", "Summer"]))).toEqual({ kind: "season" });
  });

  it("is the season for a single-split league or without a manifest", () => {
    expect(resolveEndPeriod(state(0, ["Spring"]))).toEqual({ kind: "season" });
    expect(resolveEndPeriod(state(0, null))).toEqual({ kind: "season" });
  });

  it("falls back to a nameless split when the split has no name", () => {
    expect(resolveEndPeriod(state(0, ["", "Spring"]))).toEqual({ kind: "split", name: null });
  });
});
