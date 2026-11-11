import { describe, expect, it } from "vitest";
import {
  RAIL_DIRECT,
  RAIL_GROUPS,
  defaultTabForGroup,
  groupForTab,
  navLabelFor,
  railStopForTab,
  resolveNavTab,
  resolveGroupLanding,
} from "./navModel";

const GROUPED = RAIL_GROUPS.flatMap((g) => g.items.map((i) => i.tab));

describe("navModel", () => {
  it("exposes 5 direct stops and 17 grouped tabs, each tab exactly once", () => {
    expect(RAIL_DIRECT.map((i) => i.tab)).toEqual(["Home", "Inbox", "News", "Social", "Schedule"]);
    expect(GROUPED).toHaveLength(17);
    const all = [...RAIL_DIRECT.map((i) => i.tab), ...GROUPED];
    expect(new Set(all).size).toBe(all.length);
  });

  it("only hides the club group when unemployed", () => {
    expect(RAIL_GROUPS.filter((g) => g.hiddenWhenUnemployed).map((g) => g.id)).toEqual(["club"]);
  });

  it("maps every grouped tab to its group and others to null", () => {
    for (const g of RAIL_GROUPS) for (const i of g.items) expect(groupForTab(i.tab)).toBe(g.id);
    for (const tab of ["Home", "Inbox", "News", "Social", "Schedule", "Manager", "Tournaments", "Nope"]) {
      expect(groupForTab(tab)).toBeNull();
    }
  });

  it("gives every tab one rail stop", () => {
    expect(railStopForTab("Inbox")).toBe("Inbox");
    expect(railStopForTab("Squad")).toBe("group:club");
    expect(railStopForTab("Transfers")).toBe("group:market");
    expect(railStopForTab("Teams")).toBe("group:world");
    expect(railStopForTab("Manager")).toBe("");
    expect(railStopForTab("Tournaments")).toBe("");
  });

  it("resolves landings", () => {
    expect(defaultTabForGroup("club")).toBe("Squad");
    expect(defaultTabForGroup("market")).toBe("Market");
    expect(defaultTabForGroup("world")).toBe("Competitions");
    expect(resolveGroupLanding("club", {})).toBe("Squad");
    expect(resolveGroupLanding("club", { club: "Finances" })).toBe("Finances");
    expect(resolveGroupLanding("club", { club: "Teams" })).toBe("Squad");
    expect(resolveGroupLanding("world", { club: "Finances" })).toBe("Competitions");
  });

  it("uses dashboard label keys with English defaults", () => {
    for (const i of [...RAIL_DIRECT, ...RAIL_GROUPS.flatMap((g) => g.items)]) {
      expect(i.labelKey).toMatch(/^dashboard\./);
      expect(i.defaultLabel).not.toBe("");
    }
    expect(RAIL_GROUPS.map((g) => g.labelKey)).toEqual([
      "dashboard.sectionClub",
      "dashboard.sectionMarket",
      "dashboard.sectionWorld",
    ]);
  });
});

describe("backend tab names", () => {
  it("maps the academy tab the backend raises to the navigation's Youth tab", () => {
    expect(resolveNavTab("YouthAcademy")).toBe("Youth");
    expect(resolveNavTab("Squad")).toBe("Squad");
  });

  it("gives every tab a backend blocker can point to a navigation label", () => {
    for (const tab of ["Squad", "Inbox", "Finances", "Scrims", "YouthAcademy"]) {
      expect(navLabelFor(tab), tab).not.toBeNull();
    }
    expect(navLabelFor("YouthAcademy")).toMatchObject({ labelKey: "dashboard.youthAcademy" });
    expect(navLabelFor("Nope")).toBeNull();
  });
});

