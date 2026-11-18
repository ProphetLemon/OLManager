import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";

import type { CallItem } from "@/lib/dashboard/needsYourCall";
import type { DashboardLocation } from "@/lib/dashboard/profileNavigation";
import { translateFromEnglish } from "@/test-i18n";

import { entryToIntent, paletteOpensOwnFocus } from "./paletteActivate";
import { buildPaletteIndex, type PaletteEntry, type PaletteIndexInput } from "./paletteIndex";

const t = translateFromEnglish as unknown as TFunction;

const renewal: CallItem = {
  id: "contract:p1",
  kind: "contract",
  severity: "soft",
  tagKey: "onAir.tags.contract",
  tagTone: "warning",
  headline: "Upset",
  actionLabelKey: "onAir.calls.actions.renew",
  target: { tab: "Squad", context: { playerId: "p1" } },
};
const lineup: CallItem = {
  ...renewal,
  id: "blocker:lineup",
  kind: "blocker",
  severity: "hard",
  actionLabelKey: "onAir.calls.actions.fixLineup",
  target: { tab: "Squad", context: { messageId: "m1" } },
};

const at = (tab: string, over: Partial<DashboardLocation> = {}): DashboardLocation => ({
  tab,
  playerId: null,
  teamId: null,
  staffId: null,
  championKey: null,
  ...over,
});

const entries = buildPaletteIndex({
  callState: { decisionItems: [renewal, lineup] },
  recent: [at("Squad", { playerId: "p1" }), at("Inbox"), at("Meta", { championKey: "Ahri" })],
  current: at("Home"),
  unemployed: false,
  scheduleCalendar: true,
  selectedCompetitionId: null,
  game: {
    manager: { team_id: "team-1" },
    user_competition_id: "lec",
    leagues: [{ id: "league-lec", competition_id: "lec" }],
    players: [{ id: "p1", match_name: "Upset", team_id: "team-1", position: "ADC", lol_ovr: 86 }],
    teams: [{ id: "team-1", name: "Fnatic" }],
    staff: [],
  } as unknown as PaletteIndexInput["game"],
  t,
});

const find = (predicate: (e: PaletteEntry) => boolean) => {
  const entry = entries.find(predicate);
  if (!entry) throw new Error("entry not found");
  return entry;
};

describe("entryToIntent", () => {
  it("gives a call row the call's own intent (callAction)", () => {
    expect(entryToIntent(find((e) => e.id === "call:contract:p1"))).toEqual({ kind: "player", id: "p1", openRenewal: true });
    expect(entryToIntent(find((e) => e.id === "call:blocker:lineup"))).toEqual({
      kind: "tab",
      tab: "Squad",
      context: { messageId: "m1" },
    });
  });

  it("gives a Views row its tab and the view to write in tabUiStore", () => {
    const offers = find((e) => e.kind === "view" && e.tab === "Transfers" && e.label === "Offers");
    expect(entryToIntent(offers)).toEqual({ kind: "tab", tab: "Transfers", view: { slice: "transfers", value: "offers" } });
  });

  it("gives a Competitions view with no league selected the manager's league to select (R67)", () => {
    const teams = find((e) => e.kind === "view" && e.id === "view:Competitions:teams");
    expect(entryToIntent(teams)).toEqual({
      kind: "tab",
      tab: "Competitions",
      view: { slice: "competitions", value: "teams", selectedCid: "lec" },
    });
  });

  it("gives the Settings row the route to /settings", () => {
    expect(entryToIntent(find((e) => e.kind === "settings"))).toEqual({ kind: "route", path: "/settings" });
  });

  it("gives a Sections row its tab", () => {
    expect(entryToIntent(find((e) => e.kind === "section" && e.tab === "Competitions"))).toEqual({
      kind: "tab",
      tab: "Competitions",
    });
  });

  it("gives a recent place the move back to it: a profile, a champion or a tab", () => {
    const recent = entries.filter((e) => e.kind === "recent");
    expect(recent.map(entryToIntent)).toEqual([
      { kind: "player", id: "p1" },
      { kind: "tab", tab: "Inbox" },
      { kind: "champion", key: "Ahri" },
    ]);
  });
});

describe("paletteOpensOwnFocus (R37, R69)", () => {
  it("is true for Settings, a page that takes focus itself", () => {
    expect(paletteOpensOwnFocus({ kind: "route", path: "/settings" })).toBe(true);
  });

  it("is false for a renewal, a tab, a view, a profile or a champion, which focus main and announce (R69)", () => {
    expect(paletteOpensOwnFocus({ kind: "player", id: "p1", openRenewal: true })).toBe(false);
    expect(paletteOpensOwnFocus({ kind: "tab", tab: "Squad" })).toBe(false);
    expect(paletteOpensOwnFocus({ kind: "tab", tab: "Transfers", view: { slice: "transfers", value: "offers" } })).toBe(false);
    expect(paletteOpensOwnFocus({ kind: "player", id: "p1" })).toBe(false);
    expect(paletteOpensOwnFocus({ kind: "champion", key: "Ahri" })).toBe(false);
  });
});
