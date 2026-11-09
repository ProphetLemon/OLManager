// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  aggregatePlayers,
  blendRating,
  estimateSkill,
  gameFeatures,
  inverseSpearmanBrown,
  isSuspect,
  ovrTarget,
  recencyWeight,
  rho,
  spearmanBrown,
  type GameRow,
} from "../../../scripts/stats/lib/skill.mjs";

const REF = "2026-11-01";

function row(over: Partial<GameRow> = {}): GameRow {
  return {
    playerKey: "p",
    competition: "LEC",
    role: "Mid",
    date: "2026-10-01",
    gameMinutes: 30,
    kills: 5,
    deaths: 2,
    assists: 7,
    teamKills: 20,
    damageToChampions: 20000,
    teamDamageToChampions: 80000,
    gold: 12000,
    teamGold: 60000,
    cs: 300,
    visionScore: 30,
    ...over,
  };
}

// Tiny seeded generator so the fixtures are deterministic.
function lcg(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** Players with a latent skill; stats = skill signal + noise. */
function league(competition: string, role: GameRow["role"], players: number, games: number, seed: number): GameRow[] {
  const rnd = lcg(seed);
  const rows: GameRow[] = [];
  for (let p = 0; p < players; p++) {
    const skill = (p - players / 2) / players;
    for (let g = 0; g < games; g++) {
      const noise = () => (rnd() - 0.5) * 0.6;
      const day = String(1 + ((g * 3) % 28)).padStart(2, "0");
      rows.push(
        row({
          playerKey: `${competition}-${role}-${p}`,
          competition,
          role,
          date: `2026-10-${day}`,
          kills: Math.max(0, Math.round(5 + 6 * (skill + noise()))),
          assists: Math.max(0, Math.round(7 + 6 * (skill + noise()))),
          deaths: Math.max(0, Math.round(3 - 3 * (skill + noise()))),
          damageToChampions: 20000 * (1 + skill + noise()),
          gold: 12000 * (1 + 0.5 * (skill + noise())),
          cs: 300 * (1 + 0.5 * (skill + noise())),
        }),
      );
    }
  }
  return rows;
}

const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
const sd = (xs: number[]) => Math.sqrt(mean(xs.map((v) => (v - mean(xs)) ** 2)));

describe("gameFeatures", () => {
  it("computes the documented formulas", () => {
    const f = gameFeatures(row());
    expect(f.kda).toBeCloseTo(6);
    expect(f.killParticipation).toBeCloseTo(0.6);
    expect(f.damageShare).toBeCloseTo(0.25);
    expect(f.damagePerMinute).toBeCloseTo(20000 / 30);
    expect(f.csPerMinute).toBeCloseTo(10);
    expect(f.goldShare).toBeCloseTo(0.2);
    expect(f.negDeathsPerGame).toBe(-2);
    expect(f.visionPerMinute).toBeUndefined();
  });

  it("uses max(1, deaths) and max(1, teamKills)", () => {
    const f = gameFeatures(row({ deaths: 0, kills: 4, assists: 2, teamKills: 0 }));
    expect(f.kda).toBe(6);
    expect(f.killParticipation).toBe(6);
  });

  it("adds vision only for Support and Jungle", () => {
    expect(gameFeatures(row({ role: "Support" })).visionPerMinute).toBeCloseTo(1);
    expect(gameFeatures(row({ role: "Jungle" })).visionPerMinute).toBeCloseTo(1);
    expect(gameFeatures(row({ role: "Top" })).visionPerMinute).toBeUndefined();
    expect(gameFeatures(row({ role: "Support", visionScore: null })).visionPerMinute).toBeUndefined();
  });

  it("skips features instead of dividing by zero or invalid values", () => {
    const f = gameFeatures(row({ role: "Support", gameMinutes: 0, teamDamageToChampions: 0, teamGold: 0 }));
    expect(f.damagePerMinute).toBeUndefined();
    expect(f.csPerMinute).toBeUndefined();
    expect(f.visionPerMinute).toBeUndefined();
    expect(f.damageShare).toBeUndefined();
    expect(f.goldShare).toBeUndefined();
    expect(f.kda).toBeDefined();
    const bad = gameFeatures(row({ gameMinutes: Number.NaN, teamKills: -1 }));
    expect(bad.csPerMinute).toBeUndefined();
    expect(bad.killParticipation).toBeUndefined();
    for (const v of Object.values(bad)) expect(Number.isFinite(v)).toBe(true);
  });
});

describe("recencyWeight", () => {
  it("is 1 at age 0 and 0.5 at the half-life", () => {
    expect(recencyWeight(0)).toBe(1);
    expect(recencyWeight(270)).toBeCloseTo(0.5);
    expect(recencyWeight(540)).toBeCloseTo(0.25);
    expect(recencyWeight(90, 90)).toBeCloseTo(0.5);
  });

  it("treats future games as age 0", () => {
    expect(recencyWeight(-10)).toBe(1);
  });
});

describe("aggregatePlayers", () => {
  it("weights recent games more and reports raw and effective counts", () => {
    const rows = [
      row({ date: "2026-11-01", cs: 300 }), // 10 cs/min, weight 1
      row({ date: "2026-02-04", cs: 600 }), // 270 days old, 20 cs/min, weight 0.5
    ];
    const [p] = aggregatePlayers(rows, { referenceDate: REF });
    expect(p.games).toBe(2);
    expect(p.effectiveGames).toBeCloseTo(1.5);
    expect(p.features.csPerMinute).toBeCloseTo((10 + 0.5 * 20) / 1.5);
  });

  it("keeps separate groups per player, competition and role", () => {
    const rows = [row(), row({ role: "Top" }), row({ competition: "LCK" }), row({ playerKey: "q" })];
    expect(aggregatePlayers(rows, { referenceDate: REF })).toHaveLength(4);
  });

  it("requires a valid reference date", () => {
    expect(() => aggregatePlayers([row()], { referenceDate: "nope" })).toThrow();
  });
});

describe("Spearman-Brown", () => {
  it("matches known values", () => {
    expect(spearmanBrown(0.2, 10)).toBeCloseTo(2 / 2.8, 10); // 0.714...
    expect(spearmanBrown(0.2, 10)).toBeCloseTo(0.7142857, 6);
    expect(spearmanBrown(0.2, 1)).toBeCloseTo(0.2);
  });

  it("round-trips through the inverse", () => {
    for (const r1 of [0.05, 0.2, 0.45]) {
      for (const n of [2, 5, 12.5]) {
        expect(inverseSpearmanBrown(spearmanBrown(r1, n), n)).toBeCloseTo(r1, 10);
      }
    }
  });

  it("shrinkage rho(n) is monotonic in games and zero without games", () => {
    let prev = 0;
    for (let n = 1; n <= 60; n++) {
      const r = rho(n, 0.15);
      expect(r).toBeGreaterThan(prev);
      expect(r).toBeLessThan(1);
      prev = r;
    }
    expect(rho(0, 0.15)).toBe(0);
  });
});

describe("estimateSkill", () => {
  const opts = { referenceDate: REF };

  it("standardizes the composite within the cohort", () => {
    const est = estimateSkill(league("LEC", "Mid", 20, 20, 1), opts);
    const zs = est.map((e) => e.z as number);
    expect(zs).toHaveLength(20);
    expect(mean(zs)).toBeCloseTo(0, 8);
    expect(sd(zs)).toBeCloseTo(1, 8);
    expect(est[0].cohort).toEqual({ scope: "competition:LEC", size: 20 });
  });

  it("ranks the better player higher and shrinks z by rho", () => {
    const est = estimateSkill(league("LEC", "Mid", 20, 20, 2), opts);
    const lo = est.find((e) => e.playerKey === "LEC-Mid-0")!;
    const hi = est.find((e) => e.playerKey === "LEC-Mid-19")!;
    expect(hi.z!).toBeGreaterThan(lo.z!);
    expect(hi.zShrunk!).toBeCloseTo(hi.rho! * hi.z!, 10);
    expect(Math.abs(hi.zShrunk!)).toBeLessThan(Math.abs(hi.z!));
  });

  it("uses the split-half r1 when enough players exist, within the clamp", () => {
    const est = estimateSkill(league("LEC", "Mid", 30, 24, 3), opts);
    expect(est[0].r1).toBeGreaterThan(0.1);
    expect(est[0].r1).toBeLessThanOrEqual(0.5);
  });

  it("falls back to defaultR1 when there are too few players", () => {
    const est = estimateSkill(league("LEC", "Mid", 16, 20, 4), { ...opts, minR1Pairs: 50, defaultR1: 0.12 });
    expect(est[0].r1).toBeCloseTo(0.12);
  });

  it("falls back to the pool when the cohort is small", () => {
    const rows = [...league("LES", "Mid", 6, 15, 5), ...league("LEC", "Mid", 12, 15, 6), ...league("LFL", "Mid", 12, 15, 7)];
    const poolOf = (c: string) => (["LES", "LEC", "LFL"].includes(c) ? "europe" : undefined);
    const est = estimateSkill(rows, { ...opts, poolOf });
    const les = est.find((e) => e.competition === "LES")!;
    expect(les.cohort).toEqual({ scope: "pool:europe", size: 30 });
    expect(les.z).not.toBeNull();
    // a large cohort keeps its own scope
    const solo = estimateSkill(league("LEC", "Mid", 20, 15, 8), { ...opts, poolOf });
    expect(solo[0].cohort!.scope).toBe("competition:LEC");
  });

  it("gives no estimate when the pool is also too small or missing", () => {
    const rows = league("LES", "Mid", 6, 15, 9);
    const noPool = estimateSkill(rows, opts);
    expect(noPool.every((e) => e.z === null && e.reason === "cohort_too_small")).toBe(true);
    const tiny = estimateSkill(rows, { ...opts, poolOf: () => "x" });
    expect(tiny.every((e) => e.z === null && e.reason === "cohort_too_small")).toBe(true);
  });

  it("cuts players below minWriteGames but scores the 8-9 game players", () => {
    const rows = [
      ...league("LEC", "Mid", 20, 15, 10),
      ...league("LEC", "Mid", 1, 7, 11).map((r) => ({ ...r, playerKey: "short" })),
      ...league("LEC", "Mid", 1, 9, 12).map((r) => ({ ...r, playerKey: "medium" })),
    ];
    const est = estimateSkill(rows, opts);
    const short = est.find((e) => e.playerKey === "short")!;
    expect(short.z).toBeNull();
    expect(short.reason).toBe("below_min_write_games");
    const medium = est.find((e) => e.playerKey === "medium")!;
    expect(medium.z).not.toBeNull();
    expect(medium.cohort!.size).toBe(20); // 9 games never shape the cohort
  });

  it("is deterministic for any row order", () => {
    const rows = league("LEC", "Mid", 20, 14, 13);
    const shuffled = rows.slice().sort((a, b) => ((a.kills * 31 + a.cs) % 17) - ((b.kills * 31 + b.cs) % 17) || b.kills - a.kills);
    expect(shuffled).not.toEqual(rows);
    expect(estimateSkill(shuffled, opts)).toEqual(estimateSkill(rows, opts));
    expect(estimateSkill(rows.slice().reverse(), opts)).toEqual(estimateSkill(rows, opts));
  });
});

describe("isSuspect", () => {
  const median = 75;
  it("flags Boal-like jittered attributes around 50", () => {
    expect(isSuspect({ attributes: [46, 53, 49, 51, 50, 47, 52, 50, 48], authoredOvr: 50, leagueMedian: median })).toBe(true);
  });
  it("does not flag flat 50 rows", () => {
    expect(isSuspect({ attributes: Array(9).fill(50), authoredOvr: 50, leagueMedian: median })).toBe(false);
  });
  it("does not flag a normal 75-ish player", () => {
    expect(isSuspect({ attributes: [74, 77, 75, 73, 76, 78, 72, 75, 75], authoredOvr: 75, leagueMedian: median })).toBe(false);
  });
  it("flags a player 12 or more below the league median", () => {
    expect(isSuspect({ attributes: [63, 63, 63, 63, 63, 63, 63, 63, 63], authoredOvr: 63, leagueMedian: median })).toBe(true);
    expect(isSuspect({ attributes: [64, 64, 64, 64, 64, 64, 64, 64, 64], authoredOvr: 64, leagueMedian: median })).toBe(false);
  });
  it("accepts thresholds and attribute objects", () => {
    const attrs = { a: 64, b: 64, c: 64, d: 64, e: 64, f: 64, g: 64, h: 64, i: 64 };
    expect(isSuspect({ attributes: attrs, authoredOvr: 64, leagueMedian: median }, { belowMedian: 10 })).toBe(true);
  });
});

describe("ovrTarget and blendRating", () => {
  it("places a player on the fixed ladder with the sd clamped to 3..5", () => {
    expect(ovrTarget(80, 10, 1)).toBe(85);
    expect(ovrTarget(80, 1, 1)).toBe(83);
    expect(ovrTarget(80, 4, -1)).toBe(76);
  });

  it("blends authored and target with the trust weight", () => {
    const b = blendRating({ authoredOvr: 70, leagueMedian: 80, leagueSd: 4, z: 1, rho: 0.5 });
    expect(b.zShrunk).toBeCloseTo(0.5);
    expect(b.target).toBeCloseTo(82);
    expect(b.w).toBeCloseTo(0.5);
    expect(b.finalOvr).toBeCloseTo(76);
  });

  it("caps the trust weight at 0.9", () => {
    const b = blendRating({ authoredOvr: 60, leagueMedian: 80, leagueSd: 4, z: 0, rho: 0.99 });
    expect(b.w).toBe(0.9);
    expect(b.finalOvr).toBeCloseTo(0.1 * 60 + 0.9 * 80);
  });

  it("leans more on stats for suspect rows (tau 0.35)", () => {
    const normal = blendRating({ authoredOvr: 50, leagueMedian: 75, leagueSd: 4, z: 0, rho: 0.4 });
    const suspect = blendRating({ authoredOvr: 50, leagueMedian: 75, leagueSd: 4, z: 0, rho: 0.4, suspect: true });
    expect(normal.w).toBeCloseTo(0.4);
    expect(suspect.w).toBeCloseTo(0.4 / (0.4 + 0.6 * 0.35));
    expect(suspect.w).toBeGreaterThan(normal.w);
    expect(suspect.finalOvr).toBeGreaterThan(normal.finalOvr);
  });

  it("gives no stat weight at rho 0", () => {
    const b = blendRating({ authoredOvr: 66, leagueMedian: 80, leagueSd: 4, z: 2, rho: 0 });
    expect(b.w).toBe(0);
    expect(b.finalOvr).toBe(66);
  });
});
