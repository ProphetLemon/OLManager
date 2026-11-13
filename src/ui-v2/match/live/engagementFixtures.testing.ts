import type { LiveChampion, LiveStructure } from "@/lib/match/live/engagementContext";
import type { SpotlightContext } from "@/lib/match/live/spotlight";

/** Fixtures for the spotlight caption and the Fight board: both read the same engagements. */

export const NOW = 1270;

export function champ(id: string, team: "blue" | "red", extra: Partial<LiveChampion> = {}): LiveChampion {
  return { id, name: id.toUpperCase(), team, alive: true, pos: { x: 0.5, y: 0.5 }, state: "lane", ...extra };
}

export function moment(champions: LiveChampion[], extra: Partial<SpotlightContext> = {}): SpotlightContext {
  return { nowSec: NOW, champions, structures: [], ...extra };
}

/** A tower that fired at `targetId` 1.1 s ago, on its third hit in a row. */
export const TOWER_ON_R1: LiveStructure = {
  id: "blue-top-outer",
  team: "blue",
  alive: true,
  pos: { x: 0.072, y: 0.284 },
  rampTargetId: "r1",
  rampShots: 2,
  rampLastShotAt: NOW - 1.1,
};

/** A mutual fight, a one-sided hit, a tower hit, a recall and a dead champion, in that order of weight. */
export function busyMoment(): SpotlightContext {
  return moment(
    [
      champ("b1", "blue", {
        level: 6,
        hp: 800,
        maxHp: 1000,
        pos: { x: 0.2, y: 0.5 },
        lastDamagedByChampionId: "r1",
        lastDamagedByChampionAt: NOW - 1,
      }),
      champ("r1", "red", { pos: { x: 0.22, y: 0.5 }, lastDamagedByChampionId: "b1", lastDamagedByChampionAt: NOW - 0.4 }),
      champ("b2", "blue", { pos: { x: 0.8, y: 0.4 } }),
      champ("r2", "red", { pos: { x: 0.82, y: 0.4 }, lastDamagedByChampionId: "b2", lastDamagedByChampionAt: NOW - 2.2 }),
      champ("r3", "red", { pos: { x: 0.9, y: 0.47 }, state: "recall", recallChannelUntil: NOW + 3.9 }),
      champ("b3", "blue", { alive: false, pos: { x: 0.46, y: 0.54 }, respawnAt: NOW + 21.2 }),
      champ("b4", "blue", { pos: { x: 0.1, y: 0.28 } }),
    ],
    { structures: [TOWER_ON_R1] },
  );
}
