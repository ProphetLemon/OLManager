import championsSeed from "../../../assets/simulation/champions.json";

type MatchRole = "TOP" | "JUNGLE" | "MID" | "ADC" | "SUPPORT";

const SEED_ROLE_TO_MATCH_ROLE: Record<string, MatchRole> = {
  top: "TOP",
  jungle: "JUNGLE",
  mid: "MID",
  bot: "ADC",
  adc: "ADC",
  support: "SUPPORT",
};

function normalizeChampionKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const ROLES_BY_CHAMPION = new Map<string, Set<MatchRole>>();
Object.entries(championsSeed.data?.roles ?? {}).forEach(([championId, roles]) => {
  const mapped = (roles as string[])
    .map((role) => SEED_ROLE_TO_MATCH_ROLE[role.toLowerCase()])
    .filter((role): role is MatchRole => role !== undefined);
  if (mapped.length > 0) ROLES_BY_CHAMPION.set(normalizeChampionKey(championId), new Set(mapped));
});

/** Whether the catalogue lists `role` for the champion; null when the champion or its roles are unknown. */
export function championPlaysRole(championId: string, role: MatchRole): boolean | null {
  const roles = ROLES_BY_CHAMPION.get(normalizeChampionKey(championId));
  return roles ? roles.has(role) : null;
}

/**
 * Meta tier a champion brings to a role. A tier listed for that role wins; otherwise the champion's
 * best tier in any role applies, except off its role, where it does not carry over and the neutral
 * tier B applies.
 */
export function resolveRoleTier(
  roleTier: string | undefined,
  bestTier: string | undefined,
  playsRole: boolean | null,
): string {
  return roleTier ?? (playsRole === false ? "B" : bestTier) ?? "B";
}
