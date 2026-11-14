import { describe, expect, it } from "vitest";

import { BARON_BUFF_SEC, ELDER_BUFF_SEC, type ObjectivesStateLike, type TimerLike } from "@/lib/match/live/objectivesView";
import { timerRailView } from "@/lib/match/live/timerRail";

type Entities = Record<string, TimerLike>;

function state(over: Partial<ObjectivesStateLike> & { entities?: Entities; teamBuffs?: unknown } = {}): ObjectivesStateLike {
  const { entities, ...rest } = over;
  return {
    timeSec: 1270,
    objectives: { dragon: { alive: false, nextSpawnAt: 1500, currentKind: "mountain" }, baron: { alive: false, nextSpawnAt: 1700 } },
    neutralTimers: {
      elderUnlocked: false,
      entities: {
        dragon: { alive: false, nextSpawnAt: 1500, unlocked: true },
        voidgrubs: { alive: false, nextSpawnAt: null },
        herald: { alive: false, nextSpawnAt: 1400 },
        baron: { alive: false, nextSpawnAt: 1700 },
        elder: { alive: false, nextSpawnAt: null, unlocked: false },
        ...entities,
      },
    },
    ...rest,
  } as ObjectivesStateLike;
}

const byId = (s: ObjectivesStateLike) => Object.fromEntries(timerRailView(s).map((timer) => [timer.id, timer]));

describe("timerRailView", () => {
  it("lists the four timers in a fixed order, so the rail never reflows", () => {
    expect(timerRailView(state()).map((timer) => timer.id)).toEqual(["dragon", "voidgrubs", "herald", "baron"]);
  });

  it("counts down each monster on its own, instead of one pit at a time", () => {
    const rail = byId(state());
    expect(rail.dragon.status).toEqual({ state: "countdown", seconds: 230 });
    expect(rail.dragon).toMatchObject({ entity: "dragon", dragonKind: "mountain" });
    expect(rail.herald.status).toEqual({ state: "countdown", seconds: 130 });
    expect(rail.baron.status).toEqual({ state: "countdown", seconds: 430 });
    // A timer with no next spawn is over: no countdown is invented for it.
    expect(rail.voidgrubs.status).toEqual({ state: "none" });
  });

  it("shows health while a monster is up, whatever its next spawn says", () => {
    const rail = byId(
      state({
        entities: {
          voidgrubs: { alive: true, hp: 30, maxHp: 100, nextSpawnAt: 900 },
          baron: { alive: true, nextSpawnAt: 1200 },
        },
      }),
    );
    expect(rail.voidgrubs.status).toEqual({ state: "alive", hpPct: 30 });
    expect(rail.baron.status).toEqual({ state: "alive", hpPct: null });
  });

  it("swaps the dragon tile for the Elder once it is unlocked", () => {
    const elder = state({
      entities: { dragon: { alive: false, nextSpawnAt: null, unlocked: false }, elder: { alive: false, nextSpawnAt: 1450, unlocked: true } },
    });
    elder.neutralTimers!.elderUnlocked = true;
    expect(byId(elder).dragon).toMatchObject({ entity: "elder", dragonKind: null, status: { state: "countdown", seconds: 180 } });
  });

  it("reads the Baron from the objective when an older state has no timers", () => {
    const old = { timeSec: 100, objectives: { baron: { alive: false, nextSpawnAt: 1300 } } } as ObjectivesStateLike;
    expect(byId(old).baron.status).toEqual({ state: "countdown", seconds: 1200 });
  });

  it("puts a running Baron buff on the Baron tile and an Elder buff on the dragon tile, with its holder", () => {
    const rail = byId(
      state({
        teamBuffs: { blue: { baron_until: 1270 + 48 }, red: { elder_until: 1270 + 70 } },
      } as Partial<ObjectivesStateLike>),
    );
    expect(rail.baron.buff).toEqual({ side: "blue", remainingSec: 48, totalSec: BARON_BUFF_SEC });
    expect(rail.dragon.buff).toEqual({ side: "red", remainingSec: 70, totalSec: ELDER_BUFF_SEC });
    expect(rail.herald.buff).toBeNull();
    expect(byId(state()).baron.buff).toBeNull();
  });

  it("names the Herald's carrier side, and nobody when it is not carried", () => {
    expect(byId(state({ heraldTeam: "red", heraldCarrierId: "r3" })).herald.carrier).toBe("red");
    expect(byId(state()).herald.carrier).toBeNull();
  });
});
