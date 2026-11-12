export type SoloQTier = "Challenger" | "Grandmaster" | "Master" | "Unranked";

/**
 * Tier of an LP value. 0 LP is the floor of the ladder and reads Master ("Master 0 LP"); only a
 * missing value is Unranked.
 */
export function tierFromLp(lp?: number | null): SoloQTier {
  if (lp === null || lp === undefined || Number.isNaN(lp)) return "Unranked";
  if (lp >= 1300) return "Challenger";
  if (lp >= 800) return "Grandmaster";
  return "Master";
}

export const SOLOQ_EMBLEM_URLS: Record<string, string> = {
  Challenger: "/ladder-icons/challenger.webp",
  Grandmaster: "/ladder-icons/grandmaster.webp",
  Master: "/ladder-icons/master.webp",
  Unranked: "/ladder-icons/unranked.webp",
};

export const SOLOQ_TIER_COLORS: Record<string, string> = {
  Challenger: "text-yellow-400",
  Grandmaster: "text-red-400",
  Master: "text-fuchsia-400",
  Unranked: "text-zinc-400",
};
