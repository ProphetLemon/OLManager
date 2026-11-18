import { describe, expect, it } from "vitest";

import {
  applyNavIntent,
  createDashboardProfileNavigationState,
  currentLocation,
  backDestination,
  goBackDashboardProfile,
  HISTORY_CAP,
  isLocationInGame,
  locationKey,
  navigateDashboardProfiles,
  pushLocation,
  pushRecent,
  RECENT_CAP,
  type DashboardLocation,
  type DashboardNavigateContext,
  type DashboardProfileNavigationState,
  type NavIntent,
} from "./profileNavigation";

const at = (tab: string, over: Partial<DashboardLocation> = {}): DashboardLocation => ({
  tab,
  playerId: null,
  teamId: null,
  staffId: null,
  championKey: null,
  ...over,
});

const top = (history: DashboardLocation[]) => history[history.length - 1];

const run = (state: DashboardProfileNavigationState, ...intents: NavIntent[]) =>
  intents.reduce(applyNavIntent, state);

const tab = (name: string, context?: DashboardNavigateContext): NavIntent => ({ kind: "tab", tab: name, context });

describe("navigateDashboardProfiles competition target", () => {
  it("keeps the competition to preselect and clears it on the next navigation", () => {
    const start = createDashboardProfileNavigationState("Inbox");
    const opened = navigateDashboardProfiles(start, "Competitions", { competitionId: "lec" });
    expect(opened.activeTab).toBe("Competitions");
    expect(opened.initialCompetitionId).toBe("lec");

    const next = navigateDashboardProfiles(opened, "Competitions");
    expect(next.initialCompetitionId).toBeNull();
  });
});

describe("locationKey", () => {
  it("names every part of a location", () => {
    expect(locationKey(at("Squad"))).toBe("Squad|p:|t:|s:|c:");
    expect(locationKey(at("Squad", { playerId: "p1", championKey: "ahri" }))).toBe("Squad|p:p1|t:|s:|c:ahri");
  });
});

describe("the back stack (R19)", () => {
  const home = createDashboardProfileNavigationState("Home");

  it("pushes the previous location on a tab change", () => {
    const state = run(home, tab("Squad"), tab("Training"));
    expect(state.activeTab).toBe("Training");
    expect(state.navHistory).toEqual([at("Home"), at("Squad")]);
  });

  it("pops on Back, with no forward stack", () => {
    const state = goBackDashboardProfile(run(home, tab("Squad"), tab("Training")));
    expect(currentLocation(state)).toEqual(at("Squad"));
    expect(state.navHistory).toEqual([at("Home")]);
    expect(goBackDashboardProfile(state).navHistory).toEqual([]);
  });

  it("does not push a navigation to the current location", () => {
    const state = run(home, tab("Squad"), tab("Squad"));
    expect(state.navHistory).toEqual([at("Home")]);
    expect(pushLocation(state, at("Squad")).navHistory).toEqual([at("Home")]);
  });

  it("caps the stack at 30, dropping the oldest entry", () => {
    const tabs = Array.from({ length: HISTORY_CAP + 5 }, (_, i) => tab(`T${i}`));
    const state = run(home, ...tabs);
    expect(HISTORY_CAP).toBe(30);
    expect(state.navHistory).toHaveLength(30);
    // Home and T0..T3 fell off the bottom; the newest left location is on top.
    expect(state.navHistory[0]).toEqual(at("T4"));
    expect(top(state.navHistory)).toEqual(at(`T${HISTORY_CAP + 3}`));
  });

  it("collapses consecutive duplicates", () => {
    const state: DashboardProfileNavigationState = {
      ...createDashboardProfileNavigationState("Squad"),
      navHistory: [at("Home"), at("Squad")],
    };
    expect(pushLocation(state, at("Training")).navHistory).toEqual([at("Home"), at("Squad")]);
  });

  it("pushes when a profile opens and Back returns to the tab", () => {
    const opened = run(home, tab("Squad"), { kind: "player", id: "p1" });
    expect(currentLocation(opened)).toEqual(at("Squad", { playerId: "p1" }));
    expect(top(opened.navHistory)).toEqual(at("Squad"));
    expect(currentLocation(goBackDashboardProfile(opened))).toEqual(at("Squad"));
  });

  it("pushes when the champion page opens, and Back from it returns to the player profile", () => {
    const champion = run(home, tab("Squad"), { kind: "player", id: "p1" }, { kind: "champion", key: "ahri" });
    expect(champion.championKey).toBe("ahri");
    expect(top(champion.navHistory)).toEqual(at("Squad", { playerId: "p1" }));

    const back = goBackDashboardProfile(champion);
    expect(back.championKey).toBeNull();
    expect(currentLocation(back)).toEqual(at("Squad", { playerId: "p1" }));
  });

  it("skips the entries Back is told are no longer valid", () => {
    const state = run(
      home,
      tab("Squad"),
      { kind: "player", id: "released" },
      { kind: "team", id: "t1" },
    );
    const back = goBackDashboardProfile(state, (loc) => loc.playerId !== "released");
    expect(currentLocation(back)).toEqual(at("Squad"));
    expect(back.navHistory).toEqual([at("Home")]);
  });

  it("closes a profile to its tab when no valid entry is left", () => {
    const state = run(createDashboardProfileNavigationState("Squad"), { kind: "player", id: "p1" });
    const back = goBackDashboardProfile(state, () => false);
    expect(currentLocation(back)).toEqual(at("Squad"));
    expect(back.navHistory).toEqual([]);
  });

  it("leaves a tab as it is when Back has nowhere to go", () => {
    expect(goBackDashboardProfile(home)).toBe(home);
  });

  it("never restores one-shot intents on Back", () => {
    const renewal = run(home, tab("Inbox", { messageId: "m1" }), { kind: "player", id: "p1", openRenewal: true });
    expect(renewal.selectedPlayerOptions).toEqual({ openRenewal: true });
    // The message was consumed by the move that carried it.
    expect(renewal.initialMessageId).toBeNull();

    const atTeam = applyNavIntent(renewal, { kind: "team", id: "t1" });
    const backToPlayer = goBackDashboardProfile(atTeam);
    expect(currentLocation(backToPlayer)).toEqual(at("Inbox", { playerId: "p1" }));
    expect(backToPlayer.selectedPlayerOptions).toBeNull();

    const backToInbox = goBackDashboardProfile(backToPlayer);
    expect(currentLocation(backToInbox)).toEqual(at("Inbox"));
    expect(backToInbox.initialMessageId).toBeNull();
  });

  it("keeps the backend select targets reachable from a tab intent", () => {
    const team = run(home, tab("__selectTeam", { messageId: "t9" }));
    expect(currentLocation(team)).toEqual(at("Home", { teamId: "t9" }));
    expect(team.navHistory).toEqual([at("Home")]);
  });
});

describe("backDestination (R20)", () => {
  const home = createDashboardProfileNavigationState("Home");
  const all = () => true;

  it("is the location left last, on a tab as on a profile", () => {
    expect(backDestination(run(home, tab("Squad"), tab("Training")), all)).toEqual(at("Squad"));
    expect(backDestination(run(home, tab("Squad"), { kind: "player", id: "p1" }), all)).toEqual(at("Squad"));
  });

  it("is null on a tab with an empty stack, where Back does nothing", () => {
    expect(backDestination(home, all)).toBeNull();
  });

  it("is the profile's own tab when the stack is empty, because Back still closes the profile", () => {
    const profile = run(createDashboardProfileNavigationState("Squad"), { kind: "player", id: "p1" });
    expect(backDestination({ ...profile, navHistory: [] }, all)).toEqual(at("Squad"));
  });

  it("skips the entries Back skips, so it names where Back lands", () => {
    const state = run(home, tab("Squad"), { kind: "player", id: "released" }, { kind: "team", id: "t1" });
    expect(backDestination(state, (loc) => loc.playerId !== "released")).toEqual(at("Squad"));
  });

  it("is null on a tab whose every entry is invalid", () => {
    expect(backDestination(run(home, tab("Squad")), () => false)).toBeNull();
  });
});

describe("pushRecent", () => {
  it("puts the newest first and dedupes by location", () => {
    const recent = pushRecent([at("Squad"), at("Home")], at("Home"), at("Inbox"));
    expect(recent).toEqual([at("Home"), at("Squad")]);
  });

  it("caps the list at 6", () => {
    let recent: DashboardLocation[] = [];
    for (let i = 0; i < 10; i += 1) recent = pushRecent(recent, at(`T${i}`), at("Home"));
    expect(RECENT_CAP).toBe(6);
    expect(recent.map((loc) => loc.tab)).toEqual(["T9", "T8", "T7", "T6", "T5", "T4"]);
  });

  it("excludes the current location", () => {
    const recent = pushRecent([at("Squad"), at("Inbox")], at("Training"), at("Squad"));
    expect(recent).toEqual([at("Training"), at("Inbox")]);
  });
});

describe("isLocationInGame", () => {
  const game = {
    players: [{ id: "p1" }],
    teams: [{ id: "t1" }],
    staff: [{ id: "s1" }],
  } as unknown as Parameters<typeof isLocationInGame>[1];

  it("accepts a tab, and profiles whose entity still exists", () => {
    expect(isLocationInGame(at("Squad"), game)).toBe(true);
    expect(isLocationInGame(at("Squad", { playerId: "p1", championKey: "ahri" }), game)).toBe(true);
    expect(isLocationInGame(at("Teams", { teamId: "t1" }), game)).toBe(true);
    expect(isLocationInGame(at("Staff", { staffId: "s1" }), game)).toBe(true);
  });

  it("rejects a profile whose player, team or staff member is gone", () => {
    expect(isLocationInGame(at("Squad", { playerId: "retired" }), game)).toBe(false);
    expect(isLocationInGame(at("Teams", { teamId: "folded" }), game)).toBe(false);
    expect(isLocationInGame(at("Staff", { staffId: "left" }), game)).toBe(false);
  });
});
