import championRelationships from "../../../data/champions/champion-relationships.v1.json";

interface ChampionRelationshipsDataset {
  schemaVersion: 1;
  dataset: "champion-relationships";
  counters: Array<{ source: string; target: string; value: number }>;
}

function canonicalChampionId(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized === "wukong" || normalized === "monkeyking" ? "monkeyking" : normalized;
}

const COUNTER_VALUES = new Map(
  (championRelationships as ChampionRelationshipsDataset).counters.map((relationship) => [
    `${relationship.source}::${relationship.target}`,
    relationship.value,
  ]),
);

export function getChampionCounterValue(allyChampionId: string, enemyChampionId: string): number {
  return COUNTER_VALUES.get(`${canonicalChampionId(allyChampionId)}::${canonicalChampionId(enemyChampionId)}`) ?? 0;
}

const LANE_GROUPS: Record<string, number> = {
  TOP: 0,
  JUNGLE: 1,
  MID: 2,
  // Bot (ADC) and Support share the bot lane because it is a 2v2 lane.
  ADC: 3,
  SUPPORT: 3,
};

function laneGroup(role: string | null | undefined): number | undefined {
  return role ? LANE_GROUPS[role.toUpperCase()] : undefined;
}

/** Counters only apply between lane opponents. An unknown role keeps the counter. Mirrors `are_lane_opponents` in olm_core. */
export function areLaneOpponents(roleA: string | null | undefined, roleB: string | null | undefined): boolean {
  const laneA = laneGroup(roleA);
  const laneB = laneGroup(roleB);
  return laneA === undefined || laneB === undefined || laneA === laneB;
}

/** Counter value of `ally` over `enemy`, or 0 when their roles place them in different lanes. */
export function laneCounterValue(
  allyChampionId: string,
  allyRole: string | null | undefined,
  enemyChampionId: string,
  enemyRole: string | null | undefined,
): number {
  return areLaneOpponents(allyRole, enemyRole) ? getChampionCounterValue(allyChampionId, enemyChampionId) : 0;
}

/** Whether a champion not yet picked could play a role in the given lane. No hints or an unknown role count as a fit. */
export function championFitsLane(roleHints: readonly string[], role: string | null | undefined): boolean {
  return roleHints.length === 0 || roleHints.some((hint) => areLaneOpponents(hint, role));
}
