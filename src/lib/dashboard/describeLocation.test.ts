import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";

import type { GameStateData } from "@/store/gameStore";
import { translateFromEnglish } from "@/test-i18n";
import { backControlLabel, describeLocation, routeAnnouncement, tabTitle } from "./describeLocation";
import type { DashboardLocation } from "./profileNavigation";

const game = {
  players: [{ id: "p1", match_name: "Faker" }],
  teams: [{ id: "t1", name: "Night Owls" }],
  staff: [{ id: "s1", first_name: "Ana", last_name: "Ruiz" }],
} as unknown as Pick<GameStateData, "players" | "teams" | "staff">;

const at = (tab: string, over: Partial<DashboardLocation> = {}): DashboardLocation => ({
  tab,
  playerId: null,
  teamId: null,
  staffId: null,
  championKey: null,
  ...over,
});

const t = translateFromEnglish as unknown as TFunction;
const deps = { t, game };

describe("describeLocation", () => {
  it("names a tab with the label the navigation shows", () => {
    expect(describeLocation(at("Squad"), deps)).toEqual({ title: "Squad", kind: "tab" });
    expect(describeLocation(at("Youth"), deps)).toEqual({ title: "Academy", kind: "tab" });
  });

  it("names the tabs the rail does not list instead of treating them as missing", () => {
    expect(describeLocation(at("Manager"), deps)).toEqual({ title: "Head Coach", kind: "tab" });
    expect(describeLocation(at("Tournaments"), deps)).toEqual({ title: "Tournaments", kind: "tab" });
  });

  it("names a player profile by the player's match name", () => {
    expect(describeLocation(at("Squad", { playerId: "p1" }), deps)).toEqual({ title: "Faker", kind: "player" });
  });

  it("names a team by its name and a staff member by first and last name", () => {
    expect(describeLocation(at("Teams", { teamId: "t1" }), deps)).toEqual({ title: "Night Owls", kind: "team" });
    expect(describeLocation(at("Staff", { staffId: "s1" }), deps)).toEqual({ title: "Ana Ruiz", kind: "staff" });
  });

  it("names the champion page by its champion, not by the profile kept under it", () => {
    const champion = at("Squad", { playerId: "p1", championKey: "AurelionSol" });
    expect(describeLocation(champion, deps)).toEqual({ title: "Aurelion Sol", kind: "champion" });
  });

  it("returns null when the player, team or staff member is gone", () => {
    expect(describeLocation(at("Squad", { playerId: "released" }), deps)).toBeNull();
    expect(describeLocation(at("Teams", { teamId: "gone" }), deps)).toBeNull();
    expect(describeLocation(at("Staff", { staffId: "gone" }), deps)).toBeNull();
  });
});

describe("tabTitle", () => {
  it("falls back to the tab id for a tab nobody labels", () => {
    expect(tabTitle("Unknown", t)).toBe("Unknown");
  });
});

describe("routeAnnouncement (R46)", () => {
  it("frames the arrival as 'Now on {title}, {group}' for a grouped tab", () => {
    expect(routeAnnouncement(at("Squad"), deps)).toBe("Now on Squad, Club");
  });

  it("drops the group for a direct stop", () => {
    expect(routeAnnouncement(at("Home"), deps)).toBe("Now on Home");
  });

  it("names a profile with the group of the tab it was opened from", () => {
    expect(routeAnnouncement(at("Squad", { playerId: "p1" }), deps)).toBe("Now on Faker, Club");
  });

  it("says nothing for a location whose entity is gone", () => {
    expect(routeAnnouncement(at("Squad", { playerId: "released" }), deps)).toBeNull();
  });
});

describe("backControlLabel (R20)", () => {
  it("names the destination", () => {
    expect(backControlLabel(t, "Squad")).toBe("Back to Squad");
  });

  it("says there is nothing to go back to without one", () => {
    expect(backControlLabel(t, null)).toBe("Nothing to go back to");
  });
});
