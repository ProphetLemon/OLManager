// @vitest-environment node
import { describe, expect, it } from "vitest";
import { POOL_BUCKET, leagueLevelStats, leagueLevels, poolOfLevels } from "../../../scripts/stats/lib/levels.mjs";
import type { GamePlayer } from "../../../scripts/stats/lib/game-world.mjs";

const player = (id: string, competition: string | null, ovr: number, over: Partial<GamePlayer> = {}): GamePlayer =>
  ({ id, match_name: id, full_name: id, team_id: competition ? `${competition}-t` : null, competition, position: "Mid", attributes: {}, potential_base: 70, market_value: 0, wage: 0, authoredOvr: ovr, isFlat50: false, isAllZero: false, ...over }) as GamePlayer;

describe("leagueLevels", () => {
  it("is the median and population sd of authored OVR per competition", () => {
    const levels = leagueLevels([player("a", "lec", 70), player("b", "lec", 80), player("c", "lec", 90), player("d", "lck", 85), player("e", "lck", 85)]);
    expect(levels).toEqual({ lck: { median: 85, sd: 0 }, lec: { median: 80, sd: 8.16 } });
  });

  it("averages the two middle values of an even count", () => {
    expect(leagueLevels([player("a", "lec", 70), player("b", "lec", 75), player("c", "lec", 80), player("d", "lec", 81)]).lec.median).toBe(77.5);
  });

  it("excludes flat-50, all-zero rows and players without a team", () => {
    const levels = leagueLevels([
      player("a", "lec", 80),
      player("flat", "lec", 50, { isFlat50: true }),
      player("zero", "lec", 1, { isAllZero: true }),
      player("fa", null, 30),
      player("nocomp", "lec", 10, { team_id: null }),
    ]);
    expect(levels).toEqual({ lec: { median: 80, sd: 0 } });
  });

  it("omits competitions with no usable player and sorts keys", () => {
    const levels = leagueLevels([player("z", "zzz", 60), player("f", "lck", 50, { isFlat50: true }), player("a", "aaa", 60)]);
    expect(Object.keys(levels)).toEqual(["aaa", "zzz"]);
  });
});

describe("jittered placeholders", () => {
  const ATTRS = ["mechanics", "laning", "teamfighting", "macro_play", "consistency", "shotcalling", "champion_pool", "discipline", "mental_resilience"];
  const attrs = (values: number[]) => Object.fromEntries(ATTRS.map((name, i) => [name, values[i]]));
  const real = (id: string, ovr: number) => player(id, "lec", ovr, { attributes: attrs([60, 70, 80, 65, 75, 62, 72, 68, 77]) as never });
  const jitter = (id: string) => player(id, "lec", 51, { attributes: attrs([46, 53, 48, 51, 49, 50, 52, 47, 50]) as never });

  it("leaves flat-band rows out of the median and sd and counts them", () => {
    const players = [real("a", 70), real("b", 80), real("c", 90), jitter("j1"), jitter("j2"), player("f", "lec", 50, { isFlat50: true })];
    const { levels, counts } = leagueLevelStats(players);
    expect(levels).toEqual({ lec: { median: 80, sd: 8.16 } });
    expect(counts).toEqual({ lec: { n_used: 3, n_excluded: 3 } });
    expect(leagueLevels(players)).toEqual(levels);
  });
});

describe("poolOfLevels", () => {
  it("groups competitions into buckets of 5 OVR points by their level", () => {
    expect(POOL_BUCKET).toBe(5);
    const pool = poolOfLevels({ lck: { median: 85.2, sd: 4 }, lpl: { median: 84.9, sd: 4 }, lec: { median: 80, sd: 4 }, cblol: { median: 75.5, sd: 4 } });
    expect(pool("lck")).toBe(pool("lpl"));
    expect(pool("lck")).not.toBe(pool("lec"));
    expect(pool("lec")).not.toBe(pool("cblol"));
    expect(pool("unknown")).toBeNull();
  });
});
