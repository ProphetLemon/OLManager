import type { ChampionCombatProfile } from "@/ui-v2/_legacy/components/match/lol-prototype/engine/simulation";
import type { LolChampionUltimateProfile } from "@/ui-v2/_legacy/components/match/lol-prototype/backend/contract-v1";

/** The part of a champion kit (assets/simulation/champion-kits.v1.json) the watched match reads. */
export interface ChampionKitProfileSource {
  tags: string[];
  stats: { hp: number; attackrange: number };
  ultimate: { archetype: string; icon: string };
}

export type ChampionKitsById = Record<string, ChampionKitProfileSource>;

/** The kits file is local data, loaded as its own chunk when a match starts. No network request. */
export async function loadChampionKits(): Promise<ChampionKitsById> {
  const file = await import("../../../../../assets/simulation/champion-kits.v1.json");
  return file.champions as unknown as ChampionKitsById;
}

export function attackTypeFromStats(attackRange: number, tags: string[]) {
  if (attackRange >= 300) return "ranged" as const;
  if (tags.includes("Marksman")) return "ranged" as const;
  return "melee" as const;
}

export function normalizeAttackRange(attackRange: number) {
  // Compact ranged vs melee spacing for this prototype:
  // ranged should have some advantage, but not excessive standoff distance.
  if (attackRange >= 300) return 0.056;
  return 0.049;
}

/** Combat profile of one champion: base health and range scaled by the meta and mastery modifier. */
export function buildChampionCombatProfile(kit: ChampionKitProfileSource, runtimeMod: number): ChampionCombatProfile {
  const attackType = attackTypeFromStats(kit.stats.attackrange, kit.tags ?? []);
  const baseHp = Math.round(kit.stats.hp * runtimeMod);
  const rangeBase = normalizeAttackRange(kit.stats.attackrange);
  const attackRange = rangeBase * Math.max(0.92, Math.min(1.08, 1 + (runtimeMod - 1) * 0.35));
  return { baseHp, attackType, attackRange };
}

/** Profiles and ultimates of the picked champions. A champion the kits do not know gets neither. */
export function buildChampionProfiles(
  kits: ChampionKitsById,
  championIds: string[],
  runtimeModifierByChampionId: Record<string, number>,
) {
  const profiles: Record<string, ChampionCombatProfile> = {};
  const ultimates: Record<string, LolChampionUltimateProfile> = {};
  for (const championId of championIds) {
    const kit = kits[championId];
    if (!kit) continue;
    profiles[championId] = buildChampionCombatProfile(kit, runtimeModifierByChampionId[championId] ?? 1);
    if (kit.ultimate?.icon) ultimates[championId] = { archetype: kit.ultimate.archetype, icon: kit.ultimate.icon };
  }
  return { profiles, ultimates };
}
