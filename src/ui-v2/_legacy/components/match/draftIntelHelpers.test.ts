import { describe, expect, it } from "vitest";
import {
  championFitsFreeRole,
  computeBanRecommendationScore,
  freeRolesForSelections,
  rankBanCandidates,
  resolveMasterySampleSide,
} from "@/ui-v2/_legacy/components/match/draftIntelHelpers";

describe("rankBanCandidates", () => {
  it("uses unified ban scoring for ranking", () => {
    const ranked = rankBanCandidates({
      available: [
        { championId: "A", roleHints: ["MID"] },
        { championId: "B", roleHints: ["TOP"] },
      ],
      enemyCoveredRoles: new Set<string>(),
      resolveEnemyMastery: (id) => (id === "A" ? 90 : 60),
      resolveMetaScore: (id) => (id === "A" ? 10 : 20),
      resolveScoringContext: (candidate) => ({
        draftHashSeed: `seed-${candidate.championId}`,
      }),
    });

    const scoreA = computeBanRecommendationScore({
      enemyMastery: 90,
      metaScore: 10,
      tier: "C",
      roleHints: ["MID"],
      roleAlreadyCovered: false,
      enemyJungleLocked: false,
      isFlexThreat: false,
      isSpecialThreat: false,
      draftHashSeed: "seed-A",
    });
    const scoreB = computeBanRecommendationScore({
      enemyMastery: 60,
      metaScore: 20,
      tier: "S",
      roleHints: ["TOP"],
      roleAlreadyCovered: false,
      enemyJungleLocked: false,
      isFlexThreat: false,
      isSpecialThreat: false,
      draftHashSeed: "seed-B",
    });

    expect(ranked[0].championId).toBe(scoreA > scoreB ? "A" : "B");
    expect(ranked[0].score).toBeCloseTo(Math.max(scoreA, scoreB), 6);
  });

  it("filters fully covered role-only threats when alternatives exist", () => {
    const ranked = rankBanCandidates({
      available: [
        { championId: "A", roleHints: ["MID"] },
        { championId: "B", roleHints: ["JUNGLE"] },
      ],
      enemyCoveredRoles: new Set<string>(["MID"]),
      resolveEnemyMastery: (id) => (id === "A" ? 96 : 50),
      resolveMetaScore: () => 10,
      resolveScoringContext: (candidate) => ({
        draftHashSeed: `covered-${candidate.championId}`,
      }),
    });

    expect(ranked.map((item) => item.championId)).toEqual(["B"]);
  });

  it("applies jungle lock guardrail consistently", () => {
    const ranked = rankBanCandidates({
      available: [
        { championId: "J", roleHints: ["JUNGLE"] },
        { championId: "F", roleHints: ["JUNGLE", "MID"] },
      ],
      enemyCoveredRoles: new Set<string>(["JUNGLE"]),
      resolveEnemyMastery: () => 85,
      resolveMetaScore: () => 16,
      resolveScoringContext: (candidate) => ({
        draftHashSeed: `jungle-${candidate.championId}`,
      }),
    });

    expect(ranked[0].championId).toBe("F");
  });
});

describe("resolveMasterySampleSide", () => {
  it("samples the opposing side during a ban step", () => {
    expect(resolveMasterySampleSide({ type: "ban", side: "blue" }, "blue")).toBe("red");
    expect(resolveMasterySampleSide({ type: "ban", side: "red" }, "red")).toBe("blue");
  });

  it("samples the acting side during a pick step", () => {
    expect(resolveMasterySampleSide({ type: "pick", side: "blue" }, "red")).toBe("blue");
  });

  it("falls back to the controlled side without a step", () => {
    expect(resolveMasterySampleSide(null, "red")).toBe("red");
  });
});

const ROLES = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"];

describe("freeRolesForSelections", () => {
  it("returns every role when nothing is picked", () => {
    expect([...freeRolesForSelections([], ROLES)].sort()).toEqual([...ROLES].sort());
  });

  it("frees roles that a flexible pick can leave open", () => {
    const free = freeRolesForSelections([["MID"], ["MID", "TOP"]], ROLES);
    expect(free.has("MID")).toBe(false);
    expect(free.has("TOP")).toBe(false);
    expect(free.has("JUNGLE")).toBe(true);
  });

  it("keeps a role free when a flexible pick can move away", () => {
    const free = freeRolesForSelections([["MID", "TOP"]], ROLES);
    expect(free.has("MID")).toBe(true);
    expect(free.has("TOP")).toBe(true);
  });
});

describe("championFitsFreeRole", () => {
  it("rejects champions whose roles are all covered", () => {
    expect(championFitsFreeRole(["MID"], new Set(["TOP", "JUNGLE"]))).toBe(false);
    expect(championFitsFreeRole(["MID", "TOP"], new Set(["TOP"]))).toBe(true);
  });
});

describe("rankBanCandidates with enemyFreeRoles", () => {
  it("hard-excludes champions with no free role even if they are the only strong ones", () => {
    const ranked = rankBanCandidates({
      available: [
        { championId: "MidOnly", roleHints: ["MID"] },
        { championId: "Flex", roleHints: ["MID", "TOP"] },
      ],
      enemyCoveredRoles: new Set(["MID"]),
      enemyFreeRoles: new Set(["TOP", "JUNGLE", "ADC", "SUPPORT"]),
      resolveEnemyMastery: () => 99,
      resolveMetaScore: (id) => (id === "MidOnly" ? 30 : 5),
    });
    expect(ranked.map((r) => r.championId)).toEqual(["Flex"]);
  });

  it("does not fall back to covered-role champions when none fit", () => {
    const ranked = rankBanCandidates({
      available: [{ championId: "MidOnly", roleHints: ["MID"] }],
      enemyCoveredRoles: new Set(["MID"]),
      enemyFreeRoles: new Set(["TOP"]),
      resolveEnemyMastery: () => 90,
      resolveMetaScore: () => 20,
    });
    expect(ranked).toEqual([]);
  });
});
