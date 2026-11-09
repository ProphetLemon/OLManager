import type { ChampionMasteryEntryData, PlayerMatchHistoryEntryData } from "@/store/gameStore";
import { fallbackChampionForRole } from "@/lib/players/lolIdentity";

export type LolRole = "TOP" | "JUNGLE" | "MID" | "ADC" | "SUPPORT";

export type ChampionPerformance = Map<string, { wr: number; games: number }>;

export interface TopChampionMastery {
  championId: string;
  championName: string;
  mastery: number;
  rank: "insignia" | 1 | 2 | 3;
  wr: number;
  games: number;
}

export function buildChampionPerformanceMap(
  history: PlayerMatchHistoryEntryData[],
): ChampionPerformance {
  const bucket = new Map<string, { wins: number; games: number }>();

  history.forEach((entry) => {
    const championId = entry.championId;
    if (!championId) return;

    const current = bucket.get(championId) ?? { wins: 0, games: 0 };
    current.games += 1;
    if (entry.result === "Win") current.wins += 1;
    bucket.set(championId, current);
  });

  return new Map(
    [...bucket.entries()].map(([championId, value]) => [
      championId,
      {
        games: value.games,
        wr: value.games > 0 ? Number(((value.wins / value.games) * 100).toFixed(1)) : 0,
      },
    ]),
  );
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function buildTopChampionMasteries(
  playerId: string,
  role: LolRole,
  championPerformance: ChampionPerformance,
  persistedMasteries: ChampionMasteryEntryData[],
  visibleChampionCount = 4,
): TopChampionMastery[] {
  const championByKey = new Map<string, { championId: string; mastery: number }>();

  for (const entry of persistedMasteries) {
    if (entry.player_id !== playerId || !entry.champion_id) continue;
    championByKey.set(normalizeKey(entry.champion_id), {
      championId: entry.champion_id,
      mastery: entry.mastery,
    });
  }

  const hasHistory = [...championByKey.values()].some(
    (entry) => (championPerformance.get(entry.championId)?.games ?? 0) > 0,
  );
  const gamesOf = (championId: string) => championPerformance.get(championId)?.games ?? 0;
  const champions = [...championByKey.values()].sort((a, b) =>
    hasHistory
      ? gamesOf(b.championId) - gamesOf(a.championId) || b.mastery - a.mastery
      : b.mastery - a.mastery,
  );

  const statsOf = (championId: string) => ({
    wr: championPerformance.get(championId)?.wr ?? 0,
    games: championPerformance.get(championId)?.games ?? 0,
  });

  if (champions.length === 0) {
    const fallbackChampion = fallbackChampionForRole(playerId, role);
    if (!fallbackChampion) return [];
    return [
      {
        championId: fallbackChampion,
        championName: fallbackChampion,
        mastery: 100,
        rank: "insignia",
        ...statsOf(fallbackChampion),
      },
    ];
  }

  const [insignia, ...others] = champions;
  const rest = others.slice(0, Math.max(0, Math.max(1, visibleChampionCount) - 1));

  return [
    {
      championId: insignia.championId,
      championName: insignia.championId,
      mastery: insignia.mastery,
      rank: "insignia",
      ...statsOf(insignia.championId),
    },
    ...rest.map((entry, idx) => ({
      championId: entry.championId,
      championName: entry.championId,
      mastery: entry.mastery,
      rank: (idx + 1) as 1 | 2 | 3,
      ...statsOf(entry.championId),
    })),
  ];
}
