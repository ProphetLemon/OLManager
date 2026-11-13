import { describe, expect, it } from "vitest";
import {
  RECALL_CHANNEL_SEC,
  detectContacts,
  recallProgress,
  recallRemainingSec,
  respawnRemaining,
  towerBeams,
  type ContactChampion,
  type ContactStructure,
} from "@/lib/match/live/contacts";

const NOW = 600;

function champ(id: string, extra: Partial<ContactChampion> = {}): ContactChampion {
  return { id, alive: true, pos: { x: 0.5, y: 0.5 }, state: "lane", ...extra };
}

describe("detectContacts", () => {
  it("links two champions when one hit the other inside the window", () => {
    const result = detectContacts(
      [champ("b1"), champ("r1", { lastDamagedByChampionId: "b1", lastDamagedByChampionAt: NOW - 1.2 })],
      NOW,
    );
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]).toMatchObject({ id: "b1|r1", a: "b1", b: "r1", mutual: false });
    expect(result.pairs[0].ageByTarget.r1).toBeCloseTo(1.2);
    expect(result.pairs[0].ageByTarget.b1).toBeUndefined();
    expect(result.fightingIds).toEqual(["b1", "r1"]);
  });

  it("does not link a champion whose lastDamagedAt is fresh but whose champion hit is old (tower, minion or ignite damage)", () => {
    // The false-fight case: lastDamagedAt is refreshed by towers and minions, so the
    // detector must read lastDamagedByChampionAt only. 9 s old is outside the window.
    const victim = {
      ...champ("r1", { lastDamagedByChampionId: "b1", lastDamagedByChampionAt: NOW - 9 }),
      lastDamagedAt: NOW - 0.2,
    };
    const result = detectContacts([champ("b1"), victim], NOW);
    expect(result.pairs).toEqual([]);
    expect(result.fightingIds).toEqual([]);
  });

  it("draws nothing when only lastDamagedAt exists", () => {
    const onlyOld = { ...champ("r1", { lastDamagedByChampionId: "b1" }), lastDamagedAt: NOW - 0.1 };
    expect(detectContacts([champ("b1"), onlyOld], NOW).pairs).toEqual([]);
  });

  it("treats a missing or zero champion hit time as no contact", () => {
    expect(detectContacts([champ("b1"), champ("r1", { lastDamagedByChampionId: "b1" })], NOW).pairs).toEqual([]);
    expect(
      detectContacts([champ("b1"), champ("r1", { lastDamagedByChampionId: "b1", lastDamagedByChampionAt: 0 })], NOW).pairs,
    ).toEqual([]);
    expect(
      detectContacts(
        [champ("b1"), champ("r1", { lastDamagedByChampionId: "b1", lastDamagedByChampionAt: Number.NaN })],
        NOW,
      ).pairs,
    ).toEqual([]);
  });

  it("keeps the window edges: 4 s counts, 4.1 s does not, a hit in the future does not", () => {
    const at = (age: number) =>
      detectContacts([champ("b1"), champ("r1", { lastDamagedByChampionId: "b1", lastDamagedByChampionAt: NOW - age })], NOW).pairs;
    expect(at(0)).toHaveLength(1);
    expect(at(4)).toHaveLength(1);
    expect(at(4.1)).toHaveLength(0);
    expect(at(-0.5)).toHaveLength(0);
  });

  it("needs both champions alive", () => {
    const hit = { lastDamagedByChampionId: "b1", lastDamagedByChampionAt: NOW - 1 };
    expect(detectContacts([champ("b1", { alive: false }), champ("r1", hit)], NOW).pairs).toEqual([]);
    expect(detectContacts([champ("b1"), champ("r1", { ...hit, alive: false })], NOW).pairs).toEqual([]);
  });

  it("ignores an attacker that is not in the list, and self hits", () => {
    expect(
      detectContacts([champ("r1", { lastDamagedByChampionId: "ghost", lastDamagedByChampionAt: NOW - 1 })], NOW).pairs,
    ).toEqual([]);
    expect(
      detectContacts([champ("r1", { lastDamagedByChampionId: "r1", lastDamagedByChampionAt: NOW - 1 })], NOW).pairs,
    ).toEqual([]);
  });

  it("merges a mutual pair into one link with both ages", () => {
    const result = detectContacts(
      [
        champ("b1", { lastDamagedByChampionId: "r1", lastDamagedByChampionAt: NOW - 2.5 }),
        champ("r1", { lastDamagedByChampionId: "b1", lastDamagedByChampionAt: NOW - 0.5 }),
      ],
      NOW,
    );
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0].mutual).toBe(true);
    expect(result.pairs[0].ageByTarget.b1).toBeCloseTo(2.5);
    expect(result.pairs[0].ageByTarget.r1).toBeCloseTo(0.5);
    expect(result.pairs[0].ageSec).toBeCloseTo(0.5);
    expect(result.fightingIds).toEqual(["b1", "r1"]);
  });

  it("keeps a three way fight as separate pairs with stable, sorted ids", () => {
    const result = detectContacts(
      [
        champ("r2", { lastDamagedByChampionId: "b1", lastDamagedByChampionAt: NOW - 1 }),
        champ("r1", { lastDamagedByChampionId: "b1", lastDamagedByChampionAt: NOW - 2 }),
        champ("b1"),
      ],
      NOW,
    );
    expect(result.pairs.map((p) => p.id)).toEqual(["b1|r1", "b1|r2"]);
    expect(result.fightingIds).toEqual(["b1", "r1", "r2"]);
  });
});

describe("towerBeams", () => {
  const tower = (extra: Partial<ContactStructure> = {}): ContactStructure => ({
    id: "blue-mid-outer",
    alive: true,
    rampTargetId: "r1",
    rampShots: 2,
    rampLastShotAt: NOW - 1,
    ...extra,
  });

  it("draws a beam with shots = rampShots + 1 while the latest shot is recent", () => {
    expect(towerBeams([tower({ rampLastShotAt: NOW - 2.9 })], [champ("r1")], NOW)).toEqual([
      expect.objectContaining({ structureId: "blue-mid-outer", targetId: "r1", shots: 3 }),
    ]);
    expect(towerBeams([tower({ rampLastShotAt: NOW - 2.9 })], [champ("r1")], NOW)[0].ageSec).toBeCloseTo(2.9);
  });

  it("drops the beam once the latest shot is older than 3 s, although rampTargetId is still set", () => {
    expect(towerBeams([tower({ rampLastShotAt: NOW - 3.5 })], [champ("r1")], NOW)).toEqual([]);
    expect(towerBeams([tower({ rampLastShotAt: NOW - 3.1 })], [champ("r1")], NOW)).toEqual([]);
  });

  it("shows the first shot as x1 when rampShots is 0 or missing", () => {
    expect(towerBeams([tower({ rampShots: 0 })], [champ("r1")], NOW)[0].shots).toBe(1);
    expect(towerBeams([tower({ rampShots: undefined })], [champ("r1")], NOW)[0].shots).toBe(1);
  });

  it("draws nothing for a dead target, an unknown target (a minion) or a dead tower", () => {
    expect(towerBeams([tower()], [champ("r1", { alive: false })], NOW)).toEqual([]);
    expect(towerBeams([tower({ rampTargetId: "minion-17" })], [champ("r1")], NOW)).toEqual([]);
    expect(towerBeams([tower({ alive: false })], [champ("r1")], NOW)).toEqual([]);
  });

  it("draws nothing when the engine sent no ramp fields", () => {
    expect(towerBeams([{ id: "blue-mid-outer", alive: true }], [champ("r1")], NOW)).toEqual([]);
    expect(towerBeams([tower({ rampLastShotAt: 0 })], [champ("r1")], NOW)).toEqual([]);
    expect(towerBeams([tower({ rampTargetId: null })], [champ("r1")], NOW)).toEqual([]);
  });

  it("does not draw a shot from the future", () => {
    expect(towerBeams([tower({ rampLastShotAt: NOW + 1 })], [champ("r1")], NOW)).toEqual([]);
  });
});

describe("recallProgress", () => {
  const recalling = (until: number) => champ("b1", { state: "recall", recallChannelUntil: until });

  it("runs from 0 to 1 over the 6.5 s channel", () => {
    expect(recallProgress(recalling(NOW + 6.5), NOW)).toBeCloseTo(0);
    expect(recallProgress(recalling(NOW + 3.25), NOW)).toBeCloseTo(0.5);
    expect(recallProgress(recalling(NOW + 0.1), NOW)).toBeCloseTo(1 - 0.1 / 6.5);
  });

  it("reports the seconds left", () => {
    expect(recallRemainingSec(recalling(NOW + 3.9), NOW)).toBeCloseTo(3.9);
    expect(RECALL_CHANNEL_SEC).toBe(6.5);
  });

  it("is null when the champion is not channeling", () => {
    expect(recallProgress(champ("b1"), NOW)).toBeNull();
    expect(recallProgress(recalling(NOW), NOW)).toBeNull();
    expect(recallProgress(recalling(NOW - 1), NOW)).toBeNull();
    expect(recallProgress(champ("b1", { state: "recall" }), NOW)).toBeNull();
    expect(recallProgress({ ...recalling(NOW + 3), alive: false }, NOW)).toBeNull();
    expect(recallRemainingSec(champ("b1"), NOW)).toBeNull();
  });

  it("clamps a channel end that is further away than the channel", () => {
    expect(recallProgress(recalling(NOW + 30), NOW)).toBe(0);
  });
});

describe("respawnRemaining", () => {
  it("counts down to respawnAt for a dead champion", () => {
    expect(respawnRemaining(champ("b1", { alive: false, respawnAt: NOW + 14 }), NOW)).toBe(14);
    expect(respawnRemaining(champ("b1", { alive: false, respawnAt: NOW - 1 }), NOW)).toBe(0);
  });

  it("is 0 for a living champion or an engine that sent no time", () => {
    expect(respawnRemaining(champ("b1", { respawnAt: NOW + 14 }), NOW)).toBe(0);
    expect(respawnRemaining(champ("b1", { alive: false }), NOW)).toBe(0);
  });
});
