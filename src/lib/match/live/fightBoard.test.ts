import { describe, expect, it } from "vitest";
import { buildFightBoard } from "@/lib/match/live/fightBoard";
import type { LiveChampion, LiveStructure } from "@/lib/match/live/engagementContext";

const NOW = 1270.4;

function champ(id: string, team: "blue" | "red", extra: Partial<LiveChampion> = {}): LiveChampion {
  return { id, name: id.toUpperCase(), team, alive: true, pos: { x: 0.5, y: 0.5 }, state: "lane", ...extra };
}

describe("buildFightBoard", () => {
  it("has one quiet row when nothing is happening", () => {
    const rows = buildFightBoard({ nowSec: NOW, champions: [champ("b1", "blue"), champ("r1", "red")], structures: [] });
    expect(rows).toEqual([{ id: "quiet", kind: "quiet", params: {} }]);
  });

  it("lists a one-sided contact with who hit whom and its age", () => {
    const rows = buildFightBoard({
      nowSec: NOW,
      champions: [champ("b1", "blue"), champ("r1", "red", { lastDamagedByChampionId: "b1", lastDamagedByChampionAt: NOW - 1.3 })],
      structures: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "contact:b1|r1", kind: "contact", params: { mutual: false } });
    const row = rows[0];
    expect(row.kind === "contact" && row.params.hits).toHaveLength(1);
    expect(row.kind === "contact" && row.params.hits[0]).toMatchObject({ attacker: { id: "b1" }, victim: { id: "r1" } });
    expect(row.kind === "contact" && row.params.hits[0].ageSec).toBeCloseTo(1.3);
  });

  it("marks a contact seen from both sides as mutual, with the fresher hit first", () => {
    const rows = buildFightBoard({
      nowSec: NOW,
      champions: [
        champ("b1", "blue", { lastDamagedByChampionId: "r1", lastDamagedByChampionAt: NOW - 2 }),
        champ("r1", "red", { lastDamagedByChampionId: "b1", lastDamagedByChampionAt: NOW - 0.5 }),
      ],
      structures: [],
    });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.kind === "contact" && row.params.mutual).toBe(true);
    expect(row.kind === "contact" && row.params.hits.map((hit) => hit.victim.id)).toEqual(["r1", "b1"]);
    expect(row.kind === "contact" && row.params.ageSec).toBeCloseTo(0.5);
  });

  it("lists a firing turret with shots = rampShots + 1 and the age of the last shot", () => {
    const structures: LiveStructure[] = [
      { id: "red-bot-inner", team: "red", alive: true, rampTargetId: "b1", rampShots: 3, rampLastShotAt: NOW - 1.8 },
    ];
    const rows = buildFightBoard({ nowSec: NOW, champions: [champ("b1", "blue")], structures });
    expect(rows).toEqual([
      {
        id: "turret:red-bot-inner",
        kind: "turret",
        params: {
          structure: { id: "red-bot-inner", owner: "red", part: "inner-tower", lane: "bot" },
          owner: "red",
          target: { id: "b1", name: "B1", team: "blue" },
          shots: 4,
          lastShotAgeSec: expect.closeTo(1.8, 5),
        },
      },
    ]);
  });

  it("skips a turret whose last shot is stale", () => {
    const structures: LiveStructure[] = [
      { id: "red-bot-inner", team: "red", alive: true, rampTargetId: "b1", rampShots: 3, rampLastShotAt: NOW - 3.5 },
    ];
    expect(buildFightBoard({ nowSec: NOW, champions: [champ("b1", "blue")], structures })[0].kind).toBe("quiet");
  });

  it("lists a recall with the seconds left of 6.5", () => {
    const rows = buildFightBoard({
      nowSec: NOW,
      champions: [champ("r1", "red", { state: "recall", recallChannelUntil: NOW + 3.9 })],
      structures: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "recall:r1", kind: "recall", params: { totalSec: 6.5 } });
    expect(rows[0].kind === "recall" && rows[0].params.secondsLeft).toBeCloseTo(3.9);
  });

  it("lists a dead champion with the respawn seconds rounded up", () => {
    const rows = buildFightBoard({
      nowSec: NOW,
      champions: [champ("b1", "blue", { alive: false, respawnAt: NOW + 21.2 })],
      structures: [],
    });
    expect(rows).toEqual([
      { id: "dead:b1", kind: "dead", params: { champion: { id: "b1", name: "B1", team: "blue" }, respawnSec: 22 } },
    ]);
  });

  it("orders contacts, turrets, recalls and the dead, with distinct stable ids", () => {
    const champions = [
      champ("b1", "blue"),
      champ("r1", "red", { lastDamagedByChampionId: "b1", lastDamagedByChampionAt: NOW - 1 }),
      champ("r2", "red", { state: "recall", recallChannelUntil: NOW + 2 }),
      champ("b2", "blue", { alive: false, respawnAt: NOW + 5 }),
    ];
    const structures: LiveStructure[] = [
      { id: "blue-top-outer", team: "blue", alive: true, rampTargetId: "r1", rampShots: 0, rampLastShotAt: NOW - 0.6 },
    ];
    const rows = buildFightBoard({ nowSec: NOW, champions, structures });
    expect(rows.map((row) => row.kind)).toEqual(["contact", "turret", "recall", "dead"]);
    const ids = rows.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(buildFightBoard({ nowSec: NOW + 0.2, champions, structures }).map((row) => row.id)).toEqual(ids);
  });

  it("never returns English text", () => {
    const rows = buildFightBoard({ nowSec: NOW, champions: [champ("b1", "blue", { alive: false, respawnAt: NOW + 3 })], structures: [] });
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(["id", "kind", "params"]);
  });
});
