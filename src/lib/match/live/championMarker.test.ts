import { describe, expect, it } from "vitest";

import { COMPACT_NAME_CHARS, hpShare, initialsOf, markerState, shortName } from "@/lib/match/live/championMarker";
import type { ContactChampion } from "@/lib/match/live/contacts";

const champ = (over: Partial<ContactChampion> = {}): ContactChampion => ({ id: "c", alive: true, state: "lane", ...over });

describe("markerState", () => {
  it("is empty for a champion walking a lane", () => {
    expect(markerState(champ(), false, 100)).toBeNull();
  });

  it("counts a dead champion's seconds up to the whole second", () => {
    expect(markerState(champ({ alive: false, respawnAt: 112.2 }), false, 100)).toEqual({ kind: "dead", seconds: 13 });
  });

  it("shows recall seconds to a tenth", () => {
    const recalling = champ({ state: "recall", recallChannelUntil: 103.94 });
    expect(markerState(recalling, false, 100)).toEqual({ kind: "recall", seconds: 3.9 });
  });

  it("does not call a recall that has landed a recall", () => {
    const landed = champ({ state: "recall", recallChannelUntil: 99 });
    expect(markerState(landed, false, 100)).toBeNull();
  });

  it("ranks dead above recall above fighting above objective", () => {
    const recalling = champ({ state: "recall", recallChannelUntil: 104 });
    expect(markerState({ ...recalling, alive: false, respawnAt: 110 }, true, 100)?.kind).toBe("dead");
    expect(markerState(recalling, true, 100)?.kind).toBe("recall");
    expect(markerState(champ({ state: "objective" }), true, 100)?.kind).toBe("fighting");
    expect(markerState(champ({ state: "objective" }), false, 100)?.kind).toBe("objective");
  });
});

describe("labels", () => {
  it("takes both initials of a two word name and two letters of a single word", () => {
    expect(initialsOf("Lee Sin")).toBe("LS");
    expect(initialsOf("  korvan ")).toBe("KO");
    expect(initialsOf("")).toBe("");
  });

  it("keeps three letters of a name in the compact tag", () => {
    expect(COMPACT_NAME_CHARS).toBe(3);
    expect(shortName("BRANNIC")).toBe("BRA");
    expect(shortName("Jo")).toBe("Jo");
  });
});

describe("hpShare", () => {
  it("keeps a sliver for a living champion and none for a dead one", () => {
    expect(hpShare(1, 1000, true)).toBe(0.04);
    expect(hpShare(500, 1000, true)).toBe(0.5);
    expect(hpShare(2000, 1000, true)).toBe(1);
    expect(hpShare(500, 1000, false)).toBe(0);
    expect(hpShare(5, 0, true)).toBe(0);
  });
});
