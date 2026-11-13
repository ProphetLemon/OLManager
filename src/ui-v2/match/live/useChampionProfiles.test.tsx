import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GameStateData } from "@/store/gameStore";
import type { ChampionKitsById } from "@/ui-v2/_legacy/components/match/championProfiles";

import {
  computeRuntimeModifiers,
  MODIFIER_MAX,
  MODIFIER_MIN,
  useChampionProfiles,
  type ChampionSelectionByPlayer,
} from "./useChampionProfiles";

const kits = vi.hoisted(() => ({ load: vi.fn() }));

vi.mock("@/ui-v2/_legacy/components/match/championProfiles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ui-v2/_legacy/components/match/championProfiles")>()),
  loadChampionKits: kits.load,
}));

const KITS: ChampionKitsById = {
  Ahri: { tags: ["Mage"], stats: { hp: 600, attackrange: 550 }, ultimate: { archetype: "dash", icon: "ahri-r.png" } },
};

const selection = (home: Record<string, string> = { p1: "Ahri" }): ChampionSelectionByPlayer => ({
  home,
  away: {},
  homeRoles: { p1: "MID" },
  awayRoles: {},
});

const state = (masteries: Array<[string, string, number]>, meta: Array<[string, string, string]> = []) =>
  ({
    champion_masteries: masteries.map(([player_id, champion_id, mastery]) => ({ player_id, champion_id, mastery, last_active_on: "" })),
    champion_patch: { hidden_meta: meta.map(([champion_id, role, tier]) => ({ champion_id, role, tier })) },
  }) as unknown as GameStateData;

describe("computeRuntimeModifiers", () => {
  const roles = { p1: "MID" } as const;

  it("is neutral with no mastery entry and no meta tier", () => {
    // Mastery 25 gives -0.07 and the neutral tier B adds nothing.
    expect(computeRuntimeModifiers({ p1: "Ahri" }, roles, null).Ahri).toBeCloseTo(0.93, 5);
  });

  it("adds the S-tier bonus on top of the mastery", () => {
    const withS = computeRuntimeModifiers({ p1: "Ahri" }, roles, state([["p1", "Ahri", 50]], [["Ahri", "Mid", "S"]]));
    expect(withS.Ahri).toBeCloseTo(1.08, 5);
  });

  it("clamps to 0.82 at the bottom and 1.25 at the top", () => {
    const low = computeRuntimeModifiers({ p1: "Ahri" }, roles, state([["p1", "Ahri", 0]], [["Ahri", "Mid", "D"]]));
    const high = computeRuntimeModifiers({ p1: "Ahri" }, roles, state([["p1", "Ahri", 150]], [["Ahri", "Mid", "S"]]));
    expect(low.Ahri).toBe(MODIFIER_MIN);
    expect(high.Ahri).toBe(MODIFIER_MAX);
    expect([MODIFIER_MIN, MODIFIER_MAX]).toEqual([0.82, 1.25]);
  });

  it("blends the modifiers of a champion picked twice", () => {
    const both = computeRuntimeModifiers({ p1: "Ahri", p2: "Ahri" }, { p1: "MID", p2: "MID" }, state([["p1", "Ahri", 50], ["p2", "Ahri", 100]]));
    expect(both.Ahri).toBeCloseTo((1 + 1.14) / 2, 5);
  });
});

describe("useChampionProfiles", () => {
  beforeEach(() => {
    kits.load.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is ready at once, with nothing loaded, when nobody picked a champion", async () => {
    const { result } = renderHook(() => useChampionProfiles(null, null));
    await waitFor(() => expect(result.current.profilesReady).toBe(true));
    expect(result.current.championProfilesById).toEqual({});
    expect(kits.load).not.toHaveBeenCalled();
  });

  it("turns ready after a rejected kit load, with no profiles", async () => {
    kits.load.mockRejectedValue(new Error("chunk failed"));
    const { result } = renderHook(() => useChampionProfiles(null, selection()));
    expect(result.current.profilesReady).toBe(false);
    await waitFor(() => expect(result.current.profilesReady).toBe(true));
    expect(result.current.championProfilesById).toEqual({});
    expect(result.current.championUltimatesById).toEqual({});
  });

  it("builds the profile and the ultimate of a picked champion from the local kits, with no fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    kits.load.mockResolvedValue(KITS);
    const { result } = renderHook(() => useChampionProfiles(state([["p1", "Ahri", 50]]), selection()));
    await waitFor(() => expect(result.current.profilesReady).toBe(true));
    expect(result.current.championProfilesById.Ahri.baseHp).toBe(Math.round(600 * 1));
    expect(result.current.championUltimatesById.Ahri).toEqual({ archetype: "dash", icon: "ahri-r.png" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loads once: a new selection object with the same picks, or a new game state, does not reload", async () => {
    kits.load.mockResolvedValue(KITS);
    const { result, rerender } = renderHook(({ gs, sel }) => useChampionProfiles(gs, sel), {
      initialProps: { gs: state([["p1", "Ahri", 50]]), sel: selection() },
    });
    await waitFor(() => expect(result.current.profilesReady).toBe(true));
    const profiles = result.current.championProfilesById;

    await act(async () => {
      rerender({ gs: state([["p1", "Ahri", 100]]), sel: selection() });
    });

    expect(kits.load).toHaveBeenCalledTimes(1);
    expect(result.current.profilesReady).toBe(true);
    expect(result.current.championProfilesById).toBe(profiles);
  });

  it("drops a load that settles after unmount", async () => {
    let resolve: (value: ChampionKitsById) => void = () => undefined;
    kits.load.mockReturnValue(new Promise<ChampionKitsById>((r) => (resolve = r)));
    const { result, unmount } = renderHook(() => useChampionProfiles(null, selection()));
    unmount();
    await act(async () => resolve(KITS));
    expect(result.current.profilesReady).toBe(false);
  });
});
