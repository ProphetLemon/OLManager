import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";

import type { CallItem } from "@/lib/dashboard/needsYourCall";
import type { DashboardLocation } from "@/lib/dashboard/profileNavigation";
import type { GameStateData } from "@/store/gameStore";
import { translateFromEnglish } from "@/test-i18n";

import { buildPaletteIndex, type PaletteEntry, type PaletteIndexInput } from "./paletteIndex";
import { groupPaletteResults, searchPalette } from "./paletteSearch";

const t = translateFromEnglish as unknown as TFunction;

function call(id: string, over: Partial<CallItem>): CallItem {
  return {
    id,
    kind: "blocker",
    severity: "hard",
    tagKey: "onAir.tags.blocker",
    tagTone: "negative",
    headline: `Headline ${id}`,
    actionLabelKey: "onAir.calls.actions.review",
    target: { tab: "Squad" },
    ...over,
  };
}

const scrims = call("blocker:scrims", {
  actionLabelKey: "onAir.calls.actions.openScrims",
  headline: "No scrims planned for Thursday",
  target: { tab: "Scrims" },
});
const renewal = call("contract:p1", {
  kind: "contract",
  severity: "soft",
  actionLabelKey: "onAir.calls.actions.renew",
  headline: "Upset",
  target: { tab: "Squad", context: { playerId: "p1" } },
});
const inbox = call("blocker:inbox", { actionLabelKey: "onAir.calls.actions.openInbox", target: { tab: "Inbox" } });

const at = (tab: string, over: Partial<DashboardLocation> = {}): DashboardLocation => ({
  tab,
  playerId: null,
  teamId: null,
  staffId: null,
  championKey: null,
  ...over,
});

const game = {
  manager: { team_id: "team-1" },
  players: [{ id: "p1", match_name: "Upset", team_id: "team-1", position: "ADC", lol_ovr: 86 }],
  teams: [{ id: "team-1", name: "Fnatic" }],
  staff: [
    { id: "s-coach", first_name: "Ana", last_name: "Ruiz", role: "Coach", team_id: "team-1" },
    { id: "s-owner", first_name: "Olga", last_name: "Mar", role: "Owner", team_id: "team-1" },
    { id: "s-free", first_name: "Pau", last_name: "Gil", role: "Physio", team_id: null },
  ],
} as unknown as PaletteIndexInput["game"] & GameStateData;

function input(over: Partial<PaletteIndexInput> = {}): PaletteIndexInput {
  return {
    callState: { decisionItems: [scrims, renewal] },
    recent: [at("Squad", { playerId: "p1" }), at("Transfers"), at("Inbox")],
    current: at("Home"),
    unemployed: false,
    scheduleCalendar: true,
    game,
    t,
    ...over,
  };
}

const ofKind = <K extends PaletteEntry["kind"]>(entries: PaletteEntry[], kind: K) =>
  entries.filter((e): e is Extract<PaletteEntry, { kind: K }> => e.kind === kind);
const secondaryText = (e: PaletteEntry) => e.secondary.map((d) => (d.sep ? ` ${d.sep} ` : "") + d.text).join("");

describe("buildPaletteIndex: browse mode (R26)", () => {
  it("lists the calls, then Recent, then the Sections", () => {
    const browse = searchPalette(buildPaletteIndex(input()), "", "en");
    expect(groupPaletteResults(browse).map((g) => g.group)).toEqual(["calls", "recent", "sections"]);
  });

  it("has one call row per decision, in order, named by its action", () => {
    const calls = ofKind(buildPaletteIndex(input()), "call");
    expect(calls.map((c) => c.item)).toEqual([scrims, renewal]);
    expect(calls[0].label).toBe("Open scrims");
    expect(secondaryText(calls[0])).toBe("Club › Scrims · No scrims planned for Thursday");
  });

  it("leaves the group out of a call's secondary text on a direct stop", () => {
    const [row] = ofKind(buildPaletteIndex(input({ callState: { decisionItems: [inbox] } })), "call");
    expect(secondaryText(row)).toBe(`Inbox · ${inbox.headline}`);
  });

  it("names a recent profile live, with the kind, team, role and rating", () => {
    const [player] = ofKind(buildPaletteIndex(input()), "recent");
    expect(player.label).toBe("Upset");
    expect(secondaryText(player)).toMatch(/^Player · Fnatic · .+ · 86 OVR$/);
  });

  it("keeps Recent to the last 6 places, without the current one or a player who is gone", () => {
    const recent = [
      at("Home"),
      at("Squad", { playerId: "gone" }),
      at("Inbox"),
      at("News"),
      at("Social"),
      at("Schedule"),
      at("Squad"),
      at("Tactics"),
      at("Training"),
    ];
    const rows = ofKind(buildPaletteIndex(input({ recent, current: at("Home") })), "recent");
    expect(rows.map((r) => r.location.tab)).toEqual(["Inbox", "News", "Social", "Schedule", "Squad", "Tactics"]);
  });

  it("lists every section in rail order, then Manager and one Settings row", () => {
    const sections = buildPaletteIndex(input()).filter((e) => e.kind === "section" || e.kind === "settings");
    expect(sections.map((s) => s.label)).toEqual([
      "Home", "Inbox", "News", "Social", "Schedule",
      "Squad", "Tactics", "Training", "Scrims", "SoloQ", "Meta", "Staff", "Scouting", "Academy", "Finances",
      "Market", "Transfers",
      "Competitions", "Players", "Teams", "Staffs", "Champions",
      "Head Coach", "Settings",
    ]);
    const staff = sections.filter((s) => s.label.startsWith("Staff"));
    expect(staff.map((s) => `${s.label} · ${s.zone}`)).toEqual(["Staff · Club", "Staffs · World"]);
    expect(ofKind(buildPaletteIndex(input()), "settings")).toHaveLength(1);
  });

  it("omits Club, its views and its recent places when the manager has no club", () => {
    const entries = buildPaletteIndex(input({ unemployed: true, recent: [at("Squad"), at("Inbox")] }));
    const tabs = entries.flatMap((e) => ("tab" in e ? [e.tab] : e.kind === "recent" ? [e.location.tab] : []));
    for (const clubTab of ["Squad", "Tactics", "Training", "Staff", "Finances"]) expect(tabs).not.toContain(clubTab);
    expect(tabs).toContain("Inbox");
    expect(tabs).toContain("Transfers");
  });

  it("keeps a recent profile opened from a Club tab when the manager has no club", () => {
    const entries = buildPaletteIndex(input({ unemployed: true, recent: [at("Squad", { playerId: "p1" })] }));
    expect(ofKind(entries, "recent").map((r) => r.label)).toEqual(["Upset"]);
  });

  it("has no Continue, Save or Exit entries, nor actions of any kind", () => {
    const entries = buildPaletteIndex(input());
    expect(new Set(entries.map((e) => e.kind))).toEqual(new Set(["call", "recent", "section", "settings", "view"]));
    for (const e of entries) expect(`${e.label} ${e.alias}`).not.toMatch(/continue|save|exit|quit/i);
  });

  it("gives every entry an id of its own, a tab in Recent and Sections included", () => {
    const entries = buildPaletteIndex(input({ recent: [at("Transfers")] }));
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
  });
});

describe("buildPaletteIndex: English aliases", () => {
  it("keeps every row's English name as its alias in another language, so 'squad' finds it", () => {
    const foreign = ((key: string) => `xx:${key}`) as unknown as TFunction;
    const entries = buildPaletteIndex(input({ t: foreign, recent: [at("Transfers")] }));
    const alias = (id: string) => entries.find((e) => e.id === id)?.alias;
    expect(alias("call:blocker:scrims")).toBe("Open scrims");
    expect(alias("section:Squad")).toBe("Squad");
    expect(alias("section:Manager")).toBe("Head Coach");
    expect(alias("settings")).toBe("Settings");
    expect(ofKind(entries, "recent").map((r) => r.alias)).toEqual(["Transfers"]);
    expect(alias("view:Transfers:offers")).toBe("Offers");
    expect(searchPalette(entries, "squad", "fr").map((e) => e.id)).toContain("section:Squad");
  });
});

describe("buildPaletteIndex: Views (R26)", () => {
  it("adds the 17 fixed sub-views, shown only while typing", () => {
    const entries = buildPaletteIndex(input());
    expect(ofKind(entries, "view")).toHaveLength(17);
    expect(searchPalette(entries, "", "en").some((e) => e.kind === "view")).toBe(false);
    const offers = searchPalette(entries, "offers", "en").filter((e) => e.kind === "view");
    expect(offers.map((v) => `${v.labelPrefix} › ${v.label}`)).toEqual(["Transfers › Offers"]);
    expect(offers[0].zone).toBe("Market");
  });

  it("drops Schedule's Calendar when the window is too narrow for it", () => {
    const views = ofKind(buildPaletteIndex(input({ scheduleCalendar: false })), "view");
    expect(views).toHaveLength(16);
    expect(views.filter((v) => v.tab === "Schedule").map((v) => v.label)).toEqual(["Matches"]);
  });

  it("labels Staff's views with the tab's counts", () => {
    const staff = ofKind(buildPaletteIndex(input()), "view").filter((v) => v.tab === "Staff");
    expect(staff.map((v) => v.label)).toEqual(["My Staff (2)", "Available (1)"]);
  });
});
