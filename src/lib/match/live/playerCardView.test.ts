import { describe, expect, it } from "vitest";

import {
  cardDescriptionParts,
  cardState,
  cooldownChips,
  goldGap,
  ITEM_SLOTS,
  opposingChampion,
  totalGold,
  type CardChampion,
} from "./playerCardView";

function champ(over: Partial<CardChampion> = {}): CardChampion {
  return {
    id: "korvan",
    name: "Korvan",
    team: "blue",
    role: "TOP",
    alive: true,
    level: 8,
    hp: 640.4,
    maxHp: 1200,
    kills: 3,
    deaths: 1,
    assists: 2,
    cs: 71,
    gold: 400,
    spentGold: 2600,
    items: [],
    state: "lane",
    recallChannelUntil: 0,
    respawnAt: 0,
    ...over,
  };
}

describe("cooldownChips", () => {
  it("lists the ultimate, the two summoner spells and the trinket, with the seconds left rounded up", () => {
    const chips = cooldownChips(
      champ({
        ultimate: { cdUntil: 112.3 },
        summonerSpells: [
          { key: "Flash", cdUntil: 100 },
          { key: "ignite", cdUntil: 160.01 },
        ],
        trinketKey: "wardingtotem",
        wardCdUntil: 107,
      }),
      100,
    );
    expect(chips).toEqual([
      { kind: "ultimate", letter: "R", key: null, seconds: 13 },
      { kind: "summoner", letter: "F", key: "flash", seconds: 0 },
      { kind: "summoner", letter: "I", key: "ignite", seconds: 61 },
      { kind: "trinket", letter: "W", key: "stealth_ward", seconds: 7 },
    ]);
  });

  it("counts the oracle lens through its active time and then its cooldown", () => {
    const lens = champ({ trinketKey: "oraclelens", sweeperActiveUntil: 108, sweeperCdUntil: 140 });
    expect(cooldownChips(lens, 100)[0]).toMatchObject({ letter: "O", key: "oracle_lens", seconds: 8 });
    expect(cooldownChips(lens, 120)[0]).toMatchObject({ seconds: 20 });
    expect(cooldownChips(lens, 150)[0]).toMatchObject({ seconds: 0 });
  });

  it("leaves out what the engine does not send", () => {
    expect(cooldownChips(champ(), 100)).toEqual([]);
    expect(cooldownChips(champ({ ultimate: null, summonerSpells: [{ key: " ", cdUntil: 5 }], trinketKey: "unknown" }), 100)).toEqual([]);
  });
});

describe("the gold gap", () => {
  const opponent = champ({ id: "ruvia", team: "red", gold: 100, spentGold: 2000 });

  it("adds the gold in hand to the gold spent", () => {
    expect(totalGold(champ())).toBe(3000);
  });

  it("is ahead, behind or even against the opposing laner", () => {
    expect(goldGap(champ(), opponent)).toEqual({ direction: "ahead", amount: 900 });
    expect(goldGap(opponent, champ())).toEqual({ direction: "behind", amount: 900 });
    expect(goldGap(champ(), champ({ id: "x", team: "red" }))).toEqual({ direction: "even", amount: 0 });
  });

  it("is unknown when nobody stands opposite", () => {
    expect(goldGap(champ(), undefined)).toBeNull();
  });

  it("finds the opposing laner by role and team", () => {
    const mid = champ({ id: "m1", role: "MID" });
    const all = [champ(), mid, opponent, champ({ id: "m2", role: "MID", team: "red" })];
    expect(opposingChampion(champ(), all)?.id).toBe("ruvia");
    expect(opposingChampion(mid, all)?.id).toBe("m2");
    expect(opposingChampion(champ({ role: "SUP" }), all)).toBeUndefined();
  });
});

describe("the state of a card", () => {
  it("is the dead seconds, the recall seconds, a fight or an objective, else lane", () => {
    expect(cardState(champ({ alive: false, respawnAt: 114.2 }), false, 100)).toEqual({ kind: "dead", seconds: 15 });
    expect(cardState(champ({ state: "recall", recallChannelUntil: 103.9 }), false, 100)).toEqual({ kind: "recall", seconds: 3.9 });
    expect(cardState(champ(), true, 100)).toEqual({ kind: "fighting", seconds: 0 });
    expect(cardState(champ({ state: "objective" }), false, 100)).toEqual({ kind: "objective", seconds: 0 });
    expect(cardState(champ(), false, 100)).toEqual({ kind: "lane", seconds: 0 });
  });
});

describe("cardDescriptionParts", () => {
  it("gathers what the description says", () => {
    const parts = cardDescriptionParts(
      champ({ items: ["abyssal_mask", "boots"], ultimate: { cdUntil: 105 } }),
      champ({ id: "ruvia", team: "red", spentGold: 2000, gold: 100 }),
      false,
      100,
    );
    expect(parts).toMatchObject({
      level: 8,
      alive: true,
      hp: 640,
      maxHp: 1200,
      respawnSec: 0,
      kills: 3,
      deaths: 1,
      assists: 2,
      cs: 71,
      totalGold: 3000,
      gap: { direction: "ahead", amount: 900 },
      opponentRole: "TOP",
      itemKeys: ["abyssal_mask", "boots"],
      emptySlots: ITEM_SLOTS - 2,
    });
    expect(parts.cooldowns).toHaveLength(1);
  });

  it("keeps six items at most and counts the empty slots", () => {
    const seven = ["a", "b", "c", "d", "e", "f", "g"];
    expect(cardDescriptionParts(champ({ items: seven }), undefined, false, 0)).toMatchObject({ itemKeys: seven.slice(0, 6), emptySlots: 0 });
    expect(cardDescriptionParts(champ({ items: [] }), undefined, false, 0)).toMatchObject({ itemKeys: [], emptySlots: 6, gap: null, opponentRole: null });
  });

  it("gives a dead champion its respawn seconds and no negative time", () => {
    expect(cardDescriptionParts(champ({ alive: false, respawnAt: 114.2 }), undefined, false, 100).respawnSec).toBe(15);
    expect(cardDescriptionParts(champ({ alive: false, respawnAt: 90 }), undefined, false, 100).respawnSec).toBe(0);
  });
});
