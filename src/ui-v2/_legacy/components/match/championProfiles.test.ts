// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildKits } from "../../../../../scripts/game-data/lib/ddragon-transform.mjs";
import {
  buildChampionCombatProfile,
  buildChampionProfiles,
  type ChampionKitsById,
} from "@/ui-v2/_legacy/components/match/championProfiles";

// A Data Dragon response, as the old live view fetched it at match start.
const DD_CHAMPION = { id: "Ahri", tags: ["Mage", "Assassin"], stats: { hp: 590, attackrange: 550 } };
const DD_DETAIL = {
  id: "Ahri",
  spells: [
    { id: "AhriQ", name: "Orb", description: "q", tooltip: "q", image: { full: "AhriQ.png" } },
    { id: "AhriW", name: "Fox-Fire", description: "w", tooltip: "w", image: { full: "AhriW.png" } },
    { id: "AhriE", name: "Charm", description: "e", tooltip: "e", image: { full: "AhriE.png" } },
    { id: "AhriR", name: "Spirit Rush", description: "Dashes forward and fires bolts", tooltip: "Dashes <status>forward</status>", image: { full: "AhriR.png" } },
  ],
};

/** The profile code removed from LolMatchLive.tsx, kept here as the reference the local data must reproduce. */
function oldProfile(data: typeof DD_CHAMPION, runtimeMod: number) {
  const attackType = data.stats.attackrange >= 300 || data.tags.includes("Marksman") ? "ranged" : "melee";
  const rangeBase = data.stats.attackrange >= 300 ? 0.056 : 0.049;
  return {
    baseHp: Math.round(data.stats.hp * runtimeMod),
    attackType,
    attackRange: rangeBase * Math.max(0.92, Math.min(1.08, 1 + (runtimeMod - 1) * 0.35)),
  };
}

function kitsFor(extra: Record<string, unknown> = {}): ChampionKitsById {
  const full = {
    data: {
      Ahri: { ...DD_CHAMPION, key: "103", name: "Ahri", title: "", partype: "Mana", passive: { name: "P", description: "", image: { full: "P.png" } }, spells: DD_DETAIL.spells, ...extra },
    },
  };
  return buildKits(full, ["Ahri"]).champions as unknown as ChampionKitsById;
}

describe("buildChampionCombatProfile", () => {
  it.each([0.82, 1, 1.13, 1.25])("matches the profile the old Data Dragon code built (modifier %s)", (mod) => {
    const kit = kitsFor().Ahri;
    expect(buildChampionCombatProfile(kit, mod)).toEqual(oldProfile(DD_CHAMPION, mod));
  });

  it("treats a marksman with a short range as ranged and a short-range fighter as melee", () => {
    const marksman = { tags: ["Marksman"], stats: { hp: 600, attackrange: 175 }, ultimate: { archetype: "burst", icon: "" } };
    const fighter = { tags: ["Fighter"], stats: { hp: 600, attackrange: 175 }, ultimate: { archetype: "burst", icon: "" } };
    expect(buildChampionCombatProfile(marksman, 1).attackType).toBe("ranged");
    expect(buildChampionCombatProfile(fighter, 1).attackType).toBe("melee");
  });
});

describe("buildChampionProfiles", () => {
  it("builds profiles and the ultimate (archetype and local icon) from the local kits", () => {
    const { profiles, ultimates } = buildChampionProfiles(kitsFor(), ["Ahri"], { Ahri: 1.1 });
    expect(profiles.Ahri).toEqual(oldProfile(DD_CHAMPION, 1.1));
    // Same classifier text the old code used: name plus the raw tooltip.
    expect(ultimates.Ahri).toEqual({ archetype: "engage", icon: "/lol-ultimate-icons/AhriR.png" });
    expect(ultimates.Ahri.icon.startsWith("/")).toBe(true);
  });

  it("uses a modifier of 1 when the champion has none, and skips champions the kits lack", () => {
    const { profiles, ultimates } = buildChampionProfiles(kitsFor(), ["Ahri", "Nobody"], {});
    expect(profiles.Ahri.baseHp).toBe(590);
    expect(Object.keys(profiles)).toEqual(["Ahri"]);
    expect(Object.keys(ultimates)).toEqual(["Ahri"]);
  });
});
