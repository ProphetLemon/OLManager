import { describe, expect, it } from "vitest";

import type { WeeklyScrimContext } from "./scrimContext";
import { autofillDisabled, autofillPlans, planGrid, rivalTeams, withPlan } from "./scrimPlans";
import type { TeamData } from "@/store/gameStore";

const week = (slots: Array<{ plan: string[]; canEdit?: boolean }>) =>
  ({ capacity: slots.length, slots: slots.map((slot) => ({ canEdit: true, ...slot })) }) as unknown as WeeklyScrimContext;

describe("planGrid", () => {
  it("gives every slot exactly three entries, empty ones as empty strings", () => {
    expect(planGrid(week([{ plan: ["a"] }, { plan: [] }, { plan: ["a", "b", "c"] }]))).toEqual([
      ["a", "", ""],
      ["", "", ""],
      ["a", "b", "c"],
    ]);
  });

  it("covers a capacity larger than the slots the week lists", () => {
    const short = { capacity: 2, slots: [{ plan: ["x"] }] } as unknown as WeeklyScrimContext;
    expect(planGrid(short)).toEqual([["x", "", ""], ["", "", ""]]);
  });
});

describe("withPlan", () => {
  it("changes one entry and leaves the input untouched", () => {
    const before = [["a", "", ""], ["", "", ""]];
    const after = withPlan(before, 1, 2, "z");
    expect(after).toEqual([["a", "", ""], ["", "", "z"]]);
    expect(before[1][2]).toBe("");
    expect(after[0]).not.toBe(before[0]);
  });
});

describe("rivalTeams", () => {
  const team = (id: string, name: string, competition_id: string) => ({ id, name, competition_id }) as unknown as TeamData;
  it("keeps the other clubs of the competition, strongest first and by name on a tie", () => {
    const mine = team("me", "Me", "lec");
    const teams = [mine, team("b", "Beta", "lec"), team("a", "Alpha", "lec"), team("x", "Other", "lck"), team("c", "Gamma", "lec")];
    const ovr = new Map([["a", 70], ["b", 70], ["c", 80], ["x", 99]]);
    expect(rivalTeams(teams, mine, ovr).map((t) => t.id)).toEqual(["c", "a", "b"]);
  });
});

describe("autofillPlans", () => {
  const ids = ["a", "b", "c", "d", "e", "f"];
  it("deals the strongest rivals in turn for a plain objective", () => {
    expect(autofillPlans(ids, "DraftPrep", 2)).toEqual([["a", "b", "c"], ["b", "c", "d"]]);
    expect(autofillPlans(ids, null, 1)).toEqual([["a", "b", "c"]]);
  });

  it("starts from the weakest for the Mental objective", () => {
    expect(autofillPlans(ids, "Mental", 1)).toEqual([["f", "e", "d"]]);
  });

  it("moves the strongest third to the end for Early game and Champion pool", () => {
    expect(autofillPlans(ids, "EarlyGame", 1)).toEqual([["c", "d", "e"]]);
    expect(autofillPlans(ids, "ChampionPool", 1)).toEqual([["c", "d", "e"]]);
  });

  it("drops repeats when there are fewer rivals than plans", () => {
    expect(autofillPlans(["a", "b"], "Macro", 3)).toEqual([["a", "b"], ["b", "a"], ["a", "b"]]);
  });

  it("does nothing without rivals", () => {
    expect(autofillPlans([], "Macro", 2)).toBeNull();
  });
});

describe("autofillDisabled", () => {
  it("is off only while saving, read-only or with a slot that cannot be edited", () => {
    const open = week([{ plan: [] }, { plan: [] }]);
    expect(autofillDisabled(open, { isSaving: false, readOnly: false })).toBe(false);
    expect(autofillDisabled(open, { isSaving: true, readOnly: false })).toBe(true);
    expect(autofillDisabled(open, { isSaving: false, readOnly: true })).toBe(true);
    expect(autofillDisabled(week([{ plan: [] }, { plan: [], canEdit: false }]), { isSaving: false, readOnly: false })).toBe(true);
  });
});
