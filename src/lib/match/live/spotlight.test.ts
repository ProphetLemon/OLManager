import { describe, expect, it } from "vitest";
import type { LiveChampion, LiveStructure } from "@/lib/match/live/engagementContext";
import {
  OBJECTIVE_TAKER_RADIUS,
  SPOTLIGHT_PRIORITY,
  buildEngagements,
  buildSpotlight,
  type SpotlightContext,
  type SpotlightPit,
} from "@/lib/match/live/spotlight";

const NOW = 1270;

function champ(id: string, team: "blue" | "red", extra: Partial<LiveChampion> = {}): LiveChampion {
  return { id, name: id.toUpperCase(), team, alive: true, pos: { x: 0.5, y: 0.5 }, state: "lane", ...extra };
}

const DRAGON_PIT: SpotlightPit = {
  id: "dragon",
  pos: { x: 674, y: 703 },
  alive: true,
  entity: "dragon",
  dragonKind: "mountain",
  hpPct: 55,
};

function ctx(champions: LiveChampion[], extra: Partial<SpotlightContext> = {}): SpotlightContext {
  return { nowSec: NOW, champions, structures: [], ...extra };
}

/** A moment with a mutual fight, a one-sided hit, a tower shot, a recall and a dead champion. */
function busyMoment(): SpotlightContext {
  const champions = [
    champ("b1", "blue", { pos: { x: 0.2, y: 0.5 }, lastDamagedByChampionId: "r1", lastDamagedByChampionAt: NOW - 1 }),
    champ("r1", "red", { pos: { x: 0.22, y: 0.5 }, lastDamagedByChampionId: "b1", lastDamagedByChampionAt: NOW - 0.4 }),
    champ("b2", "blue", { pos: { x: 0.8, y: 0.4 } }),
    champ("r2", "red", { pos: { x: 0.82, y: 0.4 }, lastDamagedByChampionId: "b2", lastDamagedByChampionAt: NOW - 2.2 }),
    champ("r3", "red", { pos: { x: 0.9, y: 0.47 }, state: "recall", recallChannelUntil: NOW + 3.9 }),
    champ("b3", "blue", { alive: false, pos: { x: 0.46, y: 0.54 }, respawnAt: NOW + 21.2 }),
    champ("b4", "blue", { pos: { x: 0.1, y: 0.28 } }),
  ];
  const structures: LiveStructure[] = [
    { id: "blue-top-outer", team: "blue", alive: true, pos: { x: 0.072, y: 0.284 }, rampTargetId: "r1", rampShots: 2, rampLastShotAt: NOW - 1.1 },
  ];
  return ctx(champions, { structures });
}

describe("priority table", () => {
  it("has the agreed weights", () => {
    expect(SPOTLIGHT_PRIORITY).toEqual({ nexus: 9, objective: 4, fight: 3, tower: 2.5, recall: 2, hit: 1.5, down: 1 });
  });
});

describe("buildSpotlight", () => {
  it("is quiet when nothing is happening", () => {
    const quiet = buildSpotlight(ctx([champ("b1", "blue"), champ("r1", "red")]));
    expect(quiet).toMatchObject({ kind: "quiet", headline: null, chips: [], focus: { x: 0.5, y: 0.5 } });
  });

  it("puts a mutual fight first and keeps the rest as chips in priority order", () => {
    const spot = buildSpotlight(busyMoment());
    expect(spot.kind).toBe("fight");
    expect(spot.headline).toMatchObject({ kind: "fight", params: { a: { id: "b1" }, b: { id: "r1" } } });
    expect(spot.chips.map((chip) => chip.kind)).toEqual(["tower", "recall", "hit", "down"]);
    expect(spot.focus.x).toBeCloseTo(0.21);
  });

  it("reads a one-sided hit as who hit whom and how long ago", () => {
    const hit = buildEngagements(busyMoment()).find((engagement) => engagement.kind === "hit");
    expect(hit).toMatchObject({
      kind: "hit",
      params: { attacker: { id: "b2", team: "blue" }, victim: { id: "r2", team: "red" } },
    });
    expect(hit?.kind === "hit" && hit.params.ageSec).toBeCloseTo(2.2);
  });

  it("reads a mutual contact as a fight, not as two hits", () => {
    const kinds = buildEngagements(busyMoment()).map((engagement) => engagement.kind);
    expect(kinds.filter((kind) => kind === "fight")).toHaveLength(1);
    expect(kinds.filter((kind) => kind === "hit")).toHaveLength(1);
  });

  it("shows tower shots as rampShots + 1 with the structure parts", () => {
    const tower = buildEngagements(busyMoment()).find((engagement) => engagement.kind === "tower");
    expect(tower).toMatchObject({
      params: { shots: 3, owner: "blue", target: { id: "r1" }, structure: { part: "outer-tower", lane: "top" } },
    });
  });

  it("ranks an objective over a fight and a nexus over everything", () => {
    const base = busyMoment();
    const takers = [
      champ("b5", "blue", { state: "objective", pos: { x: 0.67, y: 0.7 } }),
      champ("b6", "blue", { state: "objective", pos: { x: 0.68, y: 0.71 } }),
    ];
    const withDragon = { ...base, champions: [...base.champions, ...takers], pits: [DRAGON_PIT] };
    const spot = buildSpotlight(withDragon);
    expect(spot.kind).toBe("objective");
    expect(spot.headline).toMatchObject({
      params: { pit: "dragon", entity: "dragon", dragonKind: "mountain", hpPct: 55 },
    });
    expect(spot.headline?.kind === "objective" && spot.headline.params.champions.map((c) => c.id)).toEqual(["b5", "b6"]);

    const over = buildSpotlight({
      ...withDragon,
      winner: "blue",
      structures: [...base.structures, { id: "red-nexus", team: "red", kind: "nexus", alive: false, pos: { x: 0.93, y: 0.07 } }],
    });
    expect(over.kind).toBe("nexus");
    expect(over.headline).toMatchObject({ params: { winner: "blue" }, focus: { x: 0.93, y: 0.07 } });
  });

  it("counts objective takers only while the pit is alive and only inside the radius", () => {
    const near = champ("b5", "blue", { state: "objective", pos: { x: 0.67, y: 0.7 } });
    const far = champ("b6", "blue", { state: "objective", pos: { x: 0.67 + OBJECTIVE_TAKER_RADIUS + 0.05, y: 0.7 } });
    const lane = champ("b7", "blue", { state: "lane", pos: { x: 0.67, y: 0.7 } });
    const alive = buildEngagements(ctx([near, far, lane], { pits: [DRAGON_PIT] }));
    expect(alive).toHaveLength(1);
    expect(alive[0].kind === "objective" && alive[0].params.champions.map((c) => c.id)).toEqual(["b5"]);

    const gone = buildEngagements(ctx([near, far, lane], { pits: [{ ...DRAGON_PIT, alive: false }] }));
    expect(gone).toEqual([]);
  });

  it("lets a pinned player replace the headline and keeps every engagement as a chip", () => {
    const moment = busyMoment();
    const spot = buildSpotlight(moment, "r3");
    expect(spot.kind).toBe("following");
    expect(spot.headline).toMatchObject({
      kind: "following",
      params: { champion: { id: "r3" }, state: "recall" },
      focus: { x: 0.9, y: 0.47 },
    });
    expect(spot.headline?.kind === "following" && spot.headline.params.seconds).toBeCloseTo(3.9);
    expect(spot.chips).toEqual(buildEngagements(moment));
    expect(spot.chips.map((chip) => chip.kind)).toContain("fight");
  });

  it("follows a dead player with the respawn seconds, and a player in a state with that state", () => {
    const moment = busyMoment();
    expect(buildSpotlight(moment, "b3").headline).toMatchObject({ params: { state: "dead", seconds: 22 } });
    expect(buildSpotlight(moment, "b4").headline).toMatchObject({ params: { state: "lane", seconds: null } });
    expect(buildSpotlight(ctx([champ("j", "blue", { state: "jungle" })]), "j").headline).toMatchObject({
      params: { state: "jungle" },
    });
  });

  it("ignores a pin that is not in the match", () => {
    expect(buildSpotlight(busyMoment(), "nobody").kind).toBe("fight");
  });

  it("reads level and health of a pinned player", () => {
    const spot = buildSpotlight(ctx([champ("a", "blue", { level: 12, hp: 820, maxHp: 1640 })]), "a");
    expect(spot.headline).toMatchObject({ params: { level: 12, hpPct: 50 } });
  });

  it("gives every engagement a distinct stable id", () => {
    const ids = buildEngagements(busyMoment()).map((engagement) => engagement.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(buildEngagements(busyMoment()).map((engagement) => engagement.id)).toEqual(ids);
  });
});
