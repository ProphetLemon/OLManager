import { describe, expect, it } from "vitest";
import { PITS } from "@/lib/match/live/mapGeometry";
import {
  BARON_BUFF_SEC,
  ELDER_BUFF_SEC,
  pitViews,
  teamBarView,
  type ObjectivesStateLike,
  type TimerLike,
} from "@/lib/match/live/objectivesView";

type Entities = Record<string, TimerLike>;

function state(extra: Partial<ObjectivesStateLike> & { entities?: Entities; teamBuffs?: unknown; events?: unknown } = {}): ObjectivesStateLike {
  const { entities, ...rest } = extra;
  return {
    timeSec: 1270,
    objectives: { dragon: { alive: false, nextSpawnAt: 1500, currentKind: "mountain" }, baron: { alive: false, nextSpawnAt: 1700 } },
    neutralTimers: {
      dragonSoulUnlocked: false,
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

const dragonPit = (s: ObjectivesStateLike) => pitViews(s)[0];
const topPit = (s: ObjectivesStateLike) => pitViews(s)[1];

describe("pitViews: dragon pit", () => {
  it("counts down to the next dragon and names its kind", () => {
    const pit = dragonPit(state());
    expect(pit).toMatchObject({ id: "dragon", entity: "dragon", dragonKind: "mountain", pos: PITS.dragon });
    expect(pit.status).toEqual({ state: "countdown", seconds: 230 });
  });

  it("shows HP percent while the dragon is up, never a 0:00 countdown, even when nextSpawnAt is in the past", () => {
    const pit = dragonPit(
      state({
        entities: { dragon: { alive: true, hp: 2860, maxHp: 5200, nextSpawnAt: 1200, unlocked: true } },
      }),
    );
    expect(pit.status).toEqual({ state: "alive", hpPct: 55 });
  });

  it("reads an up dragon with no HP as alive with unknown HP", () => {
    const pit = dragonPit(state({ entities: { dragon: { alive: true, nextSpawnAt: 1200, unlocked: true } } }));
    expect(pit.status).toEqual({ state: "alive", hpPct: null });
  });

  it("replaces the dragon with the Elder once unlocked, counting down 6:00 after the fourth dragon", () => {
    // The engine, after a team's fourth dragon: the dragon entity is not alive and not unlocked,
    // and the Elder spawns six minutes later (objectives.rs:362-395).
    const s = state({
      entities: {
        dragon: { alive: false, nextSpawnAt: null, unlocked: false },
        elder: { alive: false, nextSpawnAt: 1270 + 360, unlocked: true },
      },
    });
    s.neutralTimers = { ...s.neutralTimers, elderUnlocked: true, dragonSoulUnlocked: true };
    const pit = dragonPit(s);
    expect(pit).toMatchObject({ entity: "elder", dragonKind: null });
    expect(pit.status).toEqual({ state: "countdown", seconds: 360 });

    s.neutralTimers!.entities!.elder = { alive: true, hp: 6000, maxHp: 8000, unlocked: true };
    expect(dragonPit(s).status).toEqual({ state: "alive", hpPct: 75 });
  });

  it("has no countdown when the engine sends the no-spawn sentinel", () => {
    const pit = dragonPit(state({ entities: { dragon: { alive: false, nextSpawnAt: 9_999_999, unlocked: true } }, objectives: { dragon: { nextSpawnAt: 9_999_999 } } }));
    expect(pit.status).toEqual({ state: "none" });
  });

  it("names the soul kind and the team that holds it", () => {
    const s = state({
      objectives: { dragon: { alive: false, nextSpawnAt: 1500, currentKind: "ocean", soulRiftKind: "infernal", soulClaimedBy: "Home", homeStacks: 4, awayStacks: 1 } },
    });
    expect(dragonPit(s).soul).toEqual({ state: "claimed", side: "blue", kind: "infernal" });
    // The team buff has the kind too, and tells who holds it when the objective field is missing.
    const fromBuffs = state({ teamBuffs: { red: { soul_kind: "cloud" } } } as Partial<ObjectivesStateLike>);
    expect(dragonPit(fromBuffs).soul).toEqual({ state: "claimed", side: "red", kind: "cloud" });
  });

  it("marks the soul as up for grabs when a team is one dragon away, with the pre-rolled kind", () => {
    const s = state({
      objectives: { dragon: { alive: true, currentKind: "cloud", soulRiftKind: "hextech", homeStacks: 3, awayStacks: 1 } },
    });
    expect(dragonPit(s).soul).toEqual({ state: "open", sides: ["blue"], kind: "hextech" });
    expect(dragonPit(state()).soul).toBeNull();
  });

  it("reads the pre-rolled soul kind from the neutral timers when the objective has none", () => {
    const s = state({ objectives: { dragon: { homeStacks: 0, awayStacks: 3 } } });
    s.neutralTimers = { ...s.neutralTimers, dragonSoulRiftKind: "chemtech" };
    expect(dragonPit(s).soul).toEqual({ state: "open", sides: ["red"], kind: "chemtech" });
  });
});

describe("pitViews: top pit", () => {
  it("shows the grubs first when they are up", () => {
    const s = state({
      entities: {
        voidgrubs: { alive: true, hp: 1500, maxHp: 3000, unlocked: true },
        herald: { alive: false, nextSpawnAt: 1400 },
      },
    });
    expect(topPit(s)).toMatchObject({ id: "top", entity: "voidgrubs", pos: PITS.top, status: { state: "alive", hpPct: 50 } });
  });

  it("moves on to the herald, then to Baron, as each is up", () => {
    const herald = state({ entities: { herald: { alive: true, hp: 4000, maxHp: 4000 } } });
    expect(topPit(herald)).toMatchObject({ entity: "herald", status: { state: "alive", hpPct: 100 } });
    const baron = state({ entities: { baron: { alive: true, hp: 6600, maxHp: 6600 } } });
    expect(topPit(baron)).toMatchObject({ entity: "baron", status: { state: "alive", hpPct: 100 } });
    // A herald up while Baron is also up: the herald comes first.
    const both = state({ entities: { herald: { alive: true, hp: 1, maxHp: 4 }, baron: { alive: true, hp: 1, maxHp: 1 } } });
    expect(topPit(both).entity).toBe("herald");
  });

  it("counts down to whichever comes next when nothing is up", () => {
    const s = state();
    expect(topPit(s)).toMatchObject({ entity: "herald", status: { state: "countdown", seconds: 130 } });
    const afterHerald = state({ entities: { herald: { alive: false, nextSpawnAt: null } } });
    expect(topPit(afterHerald)).toMatchObject({ entity: "baron", status: { state: "countdown", seconds: 430 } });
  });

  it("never shows a countdown of zero for something that is up", () => {
    const s = state({ entities: { baron: { alive: true, hp: 3300, maxHp: 6600, nextSpawnAt: 1000 } } });
    const pit = topPit(s);
    expect(pit.status.state).toBe("alive");
  });

  it("falls back to the baron objective when the timers are missing", () => {
    const s: ObjectivesStateLike = { timeSec: 1000, objectives: { baron: { alive: false, nextSpawnAt: 1200 } } };
    expect(topPit(s)).toMatchObject({ entity: "baron", status: { state: "countdown", seconds: 200 } });
    expect(dragonPit(s).status).toEqual({ state: "none" });
  });

  it("names the herald carrier and drops it when the engine clears it", () => {
    const s = state({ heraldTeam: "red", heraldCarrierId: "p-r-top" });
    expect(topPit(s).heraldCarrier).toEqual({ side: "red", championId: "p-r-top" });
    expect(topPit(state()).heraldCarrier).toBeNull();
    expect(dragonPit(s).heraldCarrier).toBeNull();
  });
});

describe("teamBarView", () => {
  it("reads towers, kills, gold, barons and dragons from the stats", () => {
    const bar = teamBarView(
      state({ stats: { blue: { kills: 9, towers: 4, dragons: 2, barons: 1, gold: 31200 }, red: { kills: 6, towers: 1, dragons: 1, barons: 0, gold: 27800 } } }),
    );
    expect(bar.blue).toMatchObject({ side: "blue", kills: 9, towers: 4, gold: 31200, barons: 1, dragons: 2 });
    expect(bar.red).toMatchObject({ side: "red", kills: 6, towers: 1, gold: 27800, barons: 0, dragons: 1 });
  });

  it("shows four dragon pips in the order they were taken, empty ones as null", () => {
    const bar = teamBarView(
      state({
        stats: { blue: { dragons: 2 }, red: { dragons: 1 } },
        teamBuffs: { blue: { dragon_history: ["ocean", "cloud"] }, red: { dragon_history: ["infernal"] } },
      } as Partial<ObjectivesStateLike>),
    );
    expect(bar.blue.dragonPips).toEqual(["ocean", "cloud", null, null]);
    expect(bar.red.dragonPips).toEqual(["infernal", null, null, null]);
  });

  it("keeps a pip for a dragon whose kind is not known", () => {
    const bar = teamBarView(state({ stats: { blue: { dragons: 3 } }, teamBuffs: { blue: { dragon_history: ["ocean"] } } } as Partial<ObjectivesStateLike>));
    expect(bar.blue.dragonPips).toEqual(["ocean", "unknown", "unknown", null]);
    const odd = teamBarView(state({ teamBuffs: { blue: { dragon_history: ["wyrm"] } } } as Partial<ObjectivesStateLike>));
    expect(odd.blue.dragonPips[0]).toBe("unknown");
  });

  it("takes the grubs from the team buffs first, and from the events only when the stack count is absent", () => {
    const events = [{ t: 600, text: "BLUE cleared voidgrub camp", type: "info" }];
    const withStacks = teamBarView(state({ teamBuffs: { blue: { voidgrub_stacks: 1 } }, events } as Partial<ObjectivesStateLike>));
    expect(withStacks.blue.grubs).toBe(1);
    const absent = teamBarView(state({ events } as Partial<ObjectivesStateLike>));
    expect(absent.blue.grubs).toBe(3);
    expect(absent.red.grubs).toBe(0);
  });

  it("shows the Baron buff from baron_until, not from the event time (Baron secured 32:42, shown at 34:12)", () => {
    const securedAt = 32 * 60 + 42;
    const bar = teamBarView({
      ...state(),
      timeSec: 34 * 60 + 12,
      teamBuffs: { blue: { baron_until: securedAt + BARON_BUFF_SEC } },
    } as ObjectivesStateLike);
    expect(bar.blue.baronBuff).toEqual({ remainingSec: 90, totalSec: BARON_BUFF_SEC });
    expect(bar.red.baronBuff).toBeNull();
  });

  it("drops a buff once it is over, and never goes below zero", () => {
    const base = { ...state(), timeSec: 2000 } as ObjectivesStateLike;
    const over = teamBarView({ ...base, teamBuffs: { blue: { baron_until: 1999, elder_until: 2000 } } } as ObjectivesStateLike);
    expect(over.blue.baronBuff).toBeNull();
    expect(over.blue.elderBuff).toBeNull();
    const almost = teamBarView({ ...base, teamBuffs: { blue: { elder_until: 2000.5 } } } as ObjectivesStateLike);
    expect(almost.blue.elderBuff).toEqual({ remainingSec: 0.5, totalSec: ELDER_BUFF_SEC });
  });

  it("shows the soul kind next to the buffs", () => {
    const bar = teamBarView({ ...state(), teamBuffs: { red: { soul_kind: "mountain", elder_until: 1370 } } } as ObjectivesStateLike);
    expect(bar.red.soulKind).toBe("mountain");
    expect(bar.red.elderBuff).toEqual({ remainingSec: 100, totalSec: ELDER_BUFF_SEC });
    expect(bar.blue.soulKind).toBeNull();
  });

  it("degrades to zeros on an empty state", () => {
    const bar = teamBarView({ timeSec: 0 });
    expect(bar.blue).toEqual({
      side: "blue", kills: 0, towers: 0, gold: 0, barons: 0, grubs: 0, dragons: 0,
      dragonPips: [null, null, null, null], soulKind: null, baronBuff: null, elderBuff: null,
    });
  });
});
