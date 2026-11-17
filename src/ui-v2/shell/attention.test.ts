import { describe, expect, it } from "vitest";
import type { CallItem } from "@/lib/dashboard/needsYourCall";
import { attentionForGroup, buildAttentionMap } from "./attention";

function item(partial: Partial<CallItem> & { tab: string }): CallItem {
  const { tab, ...rest } = partial;
  return {
    id: `${tab}-${Math.random()}`,
    kind: "alert",
    severity: "hard",
    tagKey: "k",
    tagTone: "warning",
    headline: `${tab} needs work`,
    actionLabelKey: "a",
    target: { tab },
    ...rest,
  };
}

describe("buildAttentionMap", () => {
  it("is empty without items", () => {
    expect(buildAttentionMap([])).toEqual({});
  });

  it("counts hard and soft items per tab and keeps the first headline", () => {
    const map = buildAttentionMap([
      item({ tab: "Scrims", severity: "hard", headline: "Scrims not planned" }),
      item({ tab: "Scrims", severity: "soft", headline: "Second" }),
      item({ tab: "Squad", severity: "soft", headline: "Lineup incomplete" }),
    ]);
    expect(map).toEqual({
      Scrims: { count: 2, headline: "Scrims not planned" },
      Squad: { count: 1, headline: "Lineup incomplete" },
    });
  });

  it("ignores info notices", () => {
    expect(buildAttentionMap([item({ tab: "Squad", severity: "info" })])).toEqual({});
  });

  it("keys the backend alias YouthAcademy to the Youth tab", () => {
    const map = buildAttentionMap([item({ tab: "YouthAcademy" }), item({ tab: "Youth" })]);
    expect(Object.keys(map)).toEqual(["Youth"]);
    expect(map.Youth.count).toBe(2);
  });

  it("keeps tabs the navigation does not know (they simply never render)", () => {
    expect(buildAttentionMap([item({ tab: "Nowhere" })])).toEqual({ Nowhere: { count: 1, headline: "Nowhere needs work" } });
  });
});

describe("attentionForGroup", () => {
  const map = buildAttentionMap([
    item({ tab: "Squad", headline: "First" }),
    item({ tab: "Scrims" }),
    item({ tab: "Scrims" }),
    item({ tab: "Transfers" }),
  ]);

  it("rolls the children of a group up, headline of the first child in navigation order", () => {
    expect(attentionForGroup(map, "club")).toEqual({ count: 3, headline: "First" });
    expect(attentionForGroup(map, "market")).toEqual({ count: 1, headline: "Transfers needs work" });
  });

  it("is null when nothing in the group needs a call", () => {
    expect(attentionForGroup(map, "world")).toBeNull();
    expect(attentionForGroup({}, "club")).toBeNull();
  });
});
