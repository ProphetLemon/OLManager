import { useEffect, useMemo, useRef, useState } from "react";

import { championPlaysRole, resolveRoleTier } from "@/lib/champions/championRoleFit";
import type { GameStateData } from "@/store/gameStore";
import {
  buildChampionProfiles,
  loadChampionKits,
} from "@/ui-v2/_legacy/components/match/championProfiles";
import type { LolChampionUltimateProfile } from "@/ui-v2/_legacy/components/match/lol-prototype/backend/contract-v1";
import type { ChampionCombatProfile } from "@/ui-v2/_legacy/components/match/lol-prototype/engine/simulation";

export type SelectionRole = "TOP" | "JUNGLE" | "MID" | "ADC" | "SUPPORT";

/** What the draft picked: champion and role by player id, for both teams. */
export interface ChampionSelectionByPlayer {
  home: Record<string, string>;
  away: Record<string, string>;
  homeRoles: Record<string, SelectionRole>;
  awayRoles: Record<string, SelectionRole>;
}

/** The runtime modifier stays inside these bounds, whatever the mastery or the tier say. */
export const MODIFIER_MIN = 0.82;
export const MODIFIER_MAX = 1.25;
/** Mastery a player without an entry for the champion is assumed to have. */
const DEFAULT_MASTERY = 25;

const TIER_WEIGHT: Record<string, number> = { S: 0.08, A: 0.04, B: 0, C: -0.03, D: -0.06 };
const TIER_ORDER: Record<string, number> = { S: 0, A: 1, B: 2, C: 3, D: 4 };

type RoleLabel = "Top" | "Jungle" | "Mid" | "ADC" | "Support";

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function roleLabel(role: string): RoleLabel {
  const key = normalizeKey(role);
  if (key === "top") return "Top";
  if (key === "jungle") return "Jungle";
  if (key === "mid" || key === "middle") return "Mid";
  if (key === "adc" || key === "bot" || key === "bottom") return "ADC";
  return "Support";
}

const SELECTION_ROLE_LABEL: Record<SelectionRole, RoleLabel> = {
  TOP: "Top",
  JUNGLE: "Jungle",
  MID: "Mid",
  ADC: "ADC",
  SUPPORT: "Support",
};

/**
 * Strength modifier of each picked champion: the player's mastery of it (±14 %) plus the
 * hidden-meta tier of the champion in its role. Bounded to MODIFIER_MIN..MODIFIER_MAX.
 */
export function computeRuntimeModifiers(
  championByPlayerId: Record<string, string>,
  roleByPlayerId: Record<string, SelectionRole>,
  gameState: Pick<GameStateData, "champion_masteries" | "champion_patch"> | null | undefined,
): Record<string, number> {
  const hiddenMeta = gameState?.champion_patch?.hidden_meta ?? [];
  const masteryByPlayerChampion = new Map<string, number>();
  (gameState?.champion_masteries ?? []).forEach((entry) => {
    masteryByPlayerChampion.set(`${entry.player_id}:${normalizeKey(entry.champion_id)}`, Number(entry.mastery ?? DEFAULT_MASTERY));
  });

  const roleTierByChampion = new Map<string, string>();
  const bestTierByChampion = new Map<string, string>();
  hiddenMeta.forEach((entry) => {
    const championKey = normalizeKey(entry.champion_id);
    const tier = String(entry.tier ?? "B").toUpperCase();
    const roleKey = `${roleLabel(entry.role)}:${championKey}`;
    const previousRoleTier = roleTierByChampion.get(roleKey);
    if (!previousRoleTier || (TIER_ORDER[tier] ?? 99) < (TIER_ORDER[previousRoleTier] ?? 99)) roleTierByChampion.set(roleKey, tier);
    const previousBest = bestTierByChampion.get(championKey);
    if (!previousBest || (TIER_ORDER[tier] ?? 99) < (TIER_ORDER[previousBest] ?? 99)) bestTierByChampion.set(championKey, tier);
  });

  const next: Record<string, number> = {};
  Object.entries(championByPlayerId).forEach(([playerId, championId]) => {
    if (!championId) return;
    const championKey = normalizeKey(championId);
    const mastery = masteryByPlayerChampion.get(`${playerId}:${championKey}`) ?? DEFAULT_MASTERY;
    const masteryDelta = ((mastery - 50) / 50) * 0.14;
    const rawRole = roleByPlayerId[playerId] ?? "MID";
    const mappedRole = SELECTION_ROLE_LABEL[rawRole] ?? "Mid";
    const tier = resolveRoleTier(
      roleTierByChampion.get(`${mappedRole}:${championKey}`),
      bestTierByChampion.get(championKey),
      championPlaysRole(championId, rawRole),
    );
    const modifier = Math.max(MODIFIER_MIN, Math.min(MODIFIER_MAX, 1 + masteryDelta + (TIER_WEIGHT[tier] ?? 0)));
    // The same champion picked twice (rare) blends its two modifiers.
    next[championId] = next[championId] !== undefined ? (next[championId] + modifier) / 2 : modifier;
  });
  return next;
}

export interface ChampionProfilesState {
  championByPlayerId: Record<string, string>;
  championProfilesById: Record<string, ChampionCombatProfile>;
  championUltimatesById: Record<string, LolChampionUltimateProfile>;
  /** True once the load settled, whether it worked or failed. The simulation is built after that, once. */
  profilesReady: boolean;
}

const NO_PROFILES: Record<string, ChampionCombatProfile> = {};
const NO_ULTIMATES: Record<string, LolChampionUltimateProfile> = {};

/**
 * Loads the combat profiles of the picked champions from the local kits (no network).
 * It loads once per set of picks: a later change of the game state or of the selection
 * object never reloads, so the simulation is never rebuilt mid-game.
 */
export function useChampionProfiles(
  gameState: GameStateData | null,
  championSelections: ChampionSelectionByPlayer | null | undefined,
): ChampionProfilesState {
  const championByPlayerId = useMemo<Record<string, string>>(
    () => (championSelections ? { ...championSelections.home, ...championSelections.away } : {}),
    [championSelections],
  );
  // Same picks, same key: the effect below does not run again for a new selection object.
  const picksKey = useMemo(
    () => JSON.stringify(Object.entries(championByPlayerId).filter(([, id]) => Boolean(id)).sort(([a], [b]) => a.localeCompare(b))),
    [championByPlayerId],
  );

  const latest = useRef({ gameState, championSelections, championByPlayerId });
  latest.current = { gameState, championSelections, championByPlayerId };

  const [loaded, setLoaded] = useState<{ key: string; profiles: Record<string, ChampionCombatProfile>; ultimates: Record<string, LolChampionUltimateProfile> } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const settle = (profiles: Record<string, ChampionCombatProfile>, ultimates: Record<string, LolChampionUltimateProfile>) => {
      if (!cancelled) setLoaded({ key: picksKey, profiles, ultimates });
    };

    const picked = Array.from(new Set(Object.values(latest.current.championByPlayerId).filter(Boolean)));
    if (picked.length === 0) {
      settle(NO_PROFILES, NO_ULTIMATES);
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        const kits = await loadChampionKits();
        const { gameState: gs, championSelections: sel, championByPlayerId: byPlayer } = latest.current;
        const roles = { ...(sel?.homeRoles ?? {}), ...(sel?.awayRoles ?? {}) };
        const { profiles, ultimates } = buildChampionProfiles(kits, picked, computeRuntimeModifiers(byPlayer, roles, gs));
        settle(profiles, ultimates);
      } catch {
        settle(NO_PROFILES, NO_ULTIMATES);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [picksKey]);

  const ready = loaded?.key === picksKey;
  return {
    championByPlayerId,
    championProfilesById: ready ? loaded.profiles : NO_PROFILES,
    championUltimatesById: ready ? loaded.ultimates : NO_ULTIMATES,
    profilesReady: ready,
  };
}
