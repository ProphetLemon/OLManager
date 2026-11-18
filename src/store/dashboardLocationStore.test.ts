import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { currentLocation, type DashboardLocation } from "@/lib/dashboard/profileNavigation";
import { useDashboardLocationStore } from "./dashboardLocationStore";

const at = (tab: string, over: Partial<DashboardLocation> = {}): DashboardLocation => ({
  tab,
  playerId: null,
  teamId: null,
  staffId: null,
  championKey: null,
  ...over,
});

const here = () => currentLocation(useDashboardLocationStore.getState().nav);
const store = () => useDashboardLocationStore.getState();

describe("dashboardLocationStore", () => {
  beforeEach(() => store().reset());

  it("starts on Home with an empty stack and no Recent", () => {
    expect(here()).toEqual(at("Home"));
    expect(store().nav.navHistory).toEqual([]);
    expect(store().recent).toEqual([]);
  });

  it("pushes every move on the stack and the left location on Recent", () => {
    store().go({ kind: "tab", tab: "Squad" });
    store().go({ kind: "player", id: "p1" });
    expect(here()).toEqual(at("Squad", { playerId: "p1" }));
    expect(store().nav.navHistory).toEqual([at("Home"), at("Squad")]);
    expect(store().recent).toEqual([at("Squad"), at("Home")]);
  });

  it("resolves a backend tab name to its navigation tab", () => {
    store().go({ kind: "tab", tab: "YouthAcademy" });
    expect(here()).toEqual(at("Youth"));
  });

  it("changes nothing on a move to the current location", () => {
    store().go({ kind: "tab", tab: "Squad" });
    const before = store();
    store().go({ kind: "tab", tab: "Squad" });
    expect(store().nav.navHistory).toEqual(before.nav.navHistory);
    expect(store().recent).toEqual(before.recent);
  });

  it("pops on back() and puts the location left on Recent", () => {
    store().go({ kind: "tab", tab: "Squad" });
    store().go({ kind: "tab", tab: "Training" });
    store().back();
    expect(here()).toEqual(at("Squad"));
    expect(store().recent).toEqual([at("Training"), at("Home")]);
  });

  it("skips entries the validator rejects", () => {
    store().go({ kind: "tab", tab: "Squad" });
    store().go({ kind: "player", id: "released" });
    store().go({ kind: "team", id: "t1" });
    store().back((loc) => loc.playerId !== "released");
    expect(here()).toEqual(at("Squad"));
  });

  it("closeChampion() goes back from the champion page and leaves other pages alone", () => {
    store().go({ kind: "tab", tab: "Squad" });
    store().go({ kind: "player", id: "p1" });
    store().closeChampion();
    expect(here()).toEqual(at("Squad", { playerId: "p1" }));

    store().go({ kind: "champion", key: "ahri" });
    store().closeChampion();
    expect(here()).toEqual(at("Squad", { playerId: "p1" }));
  });

  it("clearOneShots() drops the renewal and message intents and keeps the location", () => {
    store().go({ kind: "tab", tab: "Inbox", context: { messageId: "m1" } });
    expect(store().nav.initialMessageId).toBe("m1");
    store().go({ kind: "player", id: "p1", openRenewal: true });
    store().clearOneShots();
    expect(here()).toEqual(at("Inbox", { playerId: "p1" }));
    expect(store().nav.selectedPlayerOptions).toBeNull();
    expect(store().nav.initialMessageId).toBeNull();
  });

  it("survives an unmount and remount of its readers", () => {
    const first = renderHook(() => useDashboardLocationStore((s) => s.nav));
    store().go({ kind: "tab", tab: "Squad" });
    store().go({ kind: "staff", id: "s1" });
    first.unmount();

    const second = renderHook(() => useDashboardLocationStore((s) => s.nav));
    expect(currentLocation(second.result.current)).toEqual(at("Squad", { staffId: "s1" }));
    expect(second.result.current.navHistory).toEqual([at("Home"), at("Squad")]);
  });

  it("reset() returns to Home with an empty stack and no Recent", () => {
    store().go({ kind: "tab", tab: "Squad" });
    store().reset();
    expect(here()).toEqual(at("Home"));
    expect(store().nav.navHistory).toEqual([]);
    expect(store().recent).toEqual([]);
  });
});
