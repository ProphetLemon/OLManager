import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { User } from "lucide-react";

import type { GameStateData } from "@/store/gameStore";
import championsSeed from "../../../../assets/simulation/champions.json";
import {
  setPlayerChampionTrainingTarget,
  delegateChampionTraining,
  getSoloQStatuses,
  type SoloQStatus,
} from "@/services/playerService";
import { resolvePlayerPhoto } from "@/lib/players/playerPhotos";
import { ROLE_ICON_PATHS } from "@/lib/players/roleIcons";
import { resolvePlayerCurrentLolRole } from "@/lib/players/lolIdentity";
import { normalizeChampionKey } from "@/lib/champions/championIds";
import { resolveChampionTile } from "@/lib/champions/championImages";

import { Badge } from "@/ui-v2/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui-v2/components/ui/card";
import { cn } from "@/ui-v2/lib/utils";

interface SoloqTabV2Props {
  gameState: GameStateData;
  onGameUpdate: (state: GameStateData) => void;
  onSelectPlayer?: (id: string) => void;
}

const SOLOQ_TIER_CREST: Record<string, string> = {
  Challenger: "challenger",
  Grandmaster: "grandmaster",
  Master: "master",
};

const SOLOQ_TIER_COLOR: Record<string, string> = {
  Challenger: "text-yellow-300",
  Grandmaster: "text-red-300",
  Master: "text-fuchsia-300",
};

type ChampionRolesMap = Record<string, string[]>;
type UiRole = "Top" | "Jungle" | "Mid" | "ADC" | "Support";

const CHAMPION_ROLES: ChampionRolesMap =
  ((championsSeed as { data?: { roles?: ChampionRolesMap } }).data?.roles ?? {}) as ChampionRolesMap;

const ROLE_ORDER: Record<UiRole, number> = { Top: 1, Jungle: 2, Mid: 3, ADC: 4, Support: 5 };

const ROLE_ICON_URLS: Record<UiRole, string> = {
  Top: ROLE_ICON_PATHS.TOP,
  Jungle: ROLE_ICON_PATHS.JUNGLE,
  Mid: ROLE_ICON_PATHS.MID,
  ADC: ROLE_ICON_PATHS.ADC,
  Support: ROLE_ICON_PATHS.SUPPORT,
};

const CHAMPIONS_BY_ROLE = Object.entries(CHAMPION_ROLES).reduce<Record<UiRole, string[]>>(
  (acc, [champion, roles]) => {
    roles.forEach((role) => {
      const mapped = role === "Bot" ? "ADC" : role;
      if (!["Top", "Jungle", "Mid", "ADC", "Support"].includes(mapped)) return;
      const key = mapped as UiRole;
      if (!acc[key]) acc[key] = [];
      acc[key].push(champion);
    });
    return acc;
  },
  { Top: [], Jungle: [], Mid: [], ADC: [], Support: [] },
);

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeRole(role: string): UiRole {
  const key = normalizeKey(role);
  if (key === "top") return "Top";
  if (key === "jungle") return "Jungle";
  if (key === "mid") return "Mid";
  if (key === "bot" || key === "adc") return "ADC";
  return "Support";
}

function toUiRole(role: ReturnType<typeof resolvePlayerCurrentLolRole>): UiRole {
  if (role === "TOP") return "Top";
  if (role === "JUNGLE") return "Jungle";
  if (role === "MID") return "Mid";
  if (role === "ADC") return "ADC";
  return "Support";
}

function championDisplayName(championId: string): string {
  if (normalizeChampionKey(championId) === "MonkeyKing") return "Wukong";
  return championId;
}

type SoloQTier = "Challenger" | "Grandmaster" | "Master";

const DEFAULT_SOLOQ: SoloQStatus = {
  player_id: "",
  tier: "Master",
  lp: 0,
  delta: 0,
  multiplier: 0.8,
};

function getFocusMultiplier(focus: string | null | undefined): number {
  if (!focus) return 0.85;
  if (focus === "ChampionPoolPractice") return 1.25;
  if (focus === "IndividualCoaching") return 1.0;
  if (focus === "Scrims") return 0.85;
  if (focus === "MacroSystems") return 0.75;
  if (focus === "VODReview") return 0.7;
  return 0.85;
}

function expectedGainBadge(slotIndex: number, focus: string | null | undefined): {
  label: string;
  baseMult: number;
} {
  const priorityWeight = [1.0, 0.65, 0.4][slotIndex] ?? 0.35;
  const focusMult = getFocusMultiplier(focus);
  const labels = ["high", "moderate", "low"];
  return { label: labels[slotIndex] ?? "low", baseMult: priorityWeight * focusMult };
}

const TIER_SORT_WEIGHT: Record<string, number> = { S: 0, A: 1, B: 2, C: 3, D: 4 };

const SOLOQ_TIER_COLORS: Record<SoloQTier, string> = {
  Challenger: "text-yellow-400",
  Grandmaster: "text-red-400",
  Master: "text-fuchsia-400",
};

const SOLOQ_EMBLEM_URLS: Record<string, string> = {
  Challenger: "/ladder-icons/challenger.webp",
  Grandmaster: "/ladder-icons/grandmaster.webp",
  Master: "/ladder-icons/master.webp",
};

export function SoloqTabV2({ gameState, onGameUpdate, onSelectPlayer }: SoloqTabV2Props) {
  const { t } = useTranslation();
  const [submittingKey, setSubmittingKey] = useState<string | null>(null);
  const [delegating, setDelegating] = useState(false);

  const tierFromLp = (lp: number) =>
    lp >= 1300 ? "Challenger" : lp >= 800 ? "Grandmaster" : "Master";

  const globalRankings = useMemo(() => {
    const tierOrder: Record<string, number> = { Challenger: 0, Grandmaster: 1, Master: 2 };
    return [...gameState.players]
      .map((player) => {
        const lp = player.soloq_lp ?? 0;
        const tier = tierFromLp(lp);
        const team = player.team_id
          ? gameState.teams.find((t) => t.id === player.team_id)
          : undefined;
        return {
          player_id: player.id,
          player_name: player.match_name,
          team_id: player.team_id ?? null,
          team_name: team?.name ?? null,
          profile_image_url: player.profile_image_url ?? null,
          role: toUiRole(resolvePlayerCurrentLolRole(player, team)),
          lol_ovr: player.lol_ovr,
          tier,
          lp: Math.round(lp),
        };
      })
      .sort((a, b) => {
        const tierDiff = (tierOrder[a.tier] ?? 99) - (tierOrder[b.tier] ?? 99);
        return tierDiff !== 0 ? tierDiff : b.lp - a.lp;
      })
      .slice(0, 20);
  }, [gameState.players, gameState.teams]);

  // Preload champion tiles so selecting a target is instant
  useEffect(() => {
    Object.values(CHAMPIONS_BY_ROLE).flat().forEach((id) => {
      const img = new Image();
      img.src = resolveChampionTile(id) ?? "";
    });
  }, []);

  const managerTeam = useMemo(
    () => gameState.teams.find((tm) => tm.id === gameState.manager.team_id),
    [gameState.manager.team_id, gameState.teams],
  );
  const managerTeamId = managerTeam?.id ?? null;

  const ownPlayers = useMemo(() => {
    if (!managerTeamId) return [];
    const roleOf = (player: GameStateData["players"][number]) =>
      toUiRole(resolvePlayerCurrentLolRole(player, managerTeam));

    return gameState.players
      .filter((player) => player.team_id === managerTeamId)
      .sort((a, b) => {
        const roleDiff = ROLE_ORDER[roleOf(a)] - ROLE_ORDER[roleOf(b)];
        if (roleDiff !== 0) return roleDiff;
        return a.match_name.localeCompare(b.match_name);
      });
  }, [gameState.players, managerTeam, managerTeamId]);

  const masteryMap = useMemo(() => {
    const map = new Map<string, number>();
    (gameState.champion_masteries ?? []).forEach((entry) => {
      map.set(`${entry.player_id}:${normalizeKey(entry.champion_id)}`, entry.mastery);
    });
    return map;
  }, [gameState.champion_masteries]);

  const [soloqByPlayer, setSoloqByPlayer] = useState<Map<string, SoloQStatus>>(new Map());
  useEffect(() => {
    let cancelled = false;
    void getSoloQStatuses()
      .then((list) => {
        if (cancelled) return;
        setSoloqByPlayer(new Map(list.map((status) => [status.player_id, status])));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [
    gameState.clock.current_date,
    managerTeamId,
    managerTeam?.training_focus,
    managerTeam?.training_intensity,
    managerTeam?.training_schedule,
  ]);

  const patch = gameState.champion_patch;

  const discoveredSet = useMemo(
    () => new Set((patch?.discovered_champion_ids ?? []).map(normalizeKey)),
    [patch?.discovered_champion_ids],
  );

  const discoveredTierByChampion = useMemo(() => {
    const map = new Map<string, string>();
    (patch?.hidden_meta ?? []).forEach((entry) => {
      const championKey = normalizeKey(entry.champion_id);
      if (!discoveredSet.has(championKey)) return;
      const tier = (entry.tier || "C").toUpperCase();
      const previous = map.get(championKey);
      if (!previous) {
        map.set(championKey, tier);
        return;
      }
      const previousWeight = TIER_SORT_WEIGHT[previous] ?? 99;
      const currentWeight = TIER_SORT_WEIGHT[tier] ?? 99;
      if (currentWeight < previousWeight) map.set(championKey, tier);
    });
    return map;
  }, [patch?.hidden_meta, discoveredSet]);

  const discoveredTierByRoleChampion = useMemo(() => {
    const map = new Map<string, string>();
    (patch?.hidden_meta ?? []).forEach((entry) => {
      const championKey = normalizeKey(entry.champion_id);
      if (!discoveredSet.has(championKey)) return;
      const role = normalizeRole(entry.role);
      const tier = (entry.tier || "C").toUpperCase();
      const key = `${role}:${championKey}`;
      const previous = map.get(key);
      if (!previous) {
        map.set(key, tier);
        return;
      }
      const previousWeight = TIER_SORT_WEIGHT[previous] ?? 99;
      const currentWeight = TIER_SORT_WEIGHT[tier] ?? 99;
      if (currentWeight < previousWeight) map.set(key, tier);
    });
    return map;
  }, [patch?.hidden_meta, discoveredSet]);

  async function handleTrainingTargetChange(playerId: string, slotIndex: number, championId: string) {
    const key = `${playerId}:${slotIndex}`;
    setSubmittingKey(key);
    try {
      const updated = await setPlayerChampionTrainingTarget(
        playerId,
        slotIndex,
        championId.length > 0 ? championId : null,
      );
      onGameUpdate(updated);
    } finally {
      setSubmittingKey(null);
    }
  }

  async function handleDelegateTraining() {
    setDelegating(true);
    try {
      const updated = await delegateChampionTraining();
      onGameUpdate(updated);
    } finally {
      setDelegating(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4 lg:flex-row">
      <Card className="h-full shrink-0 lg:w-80">
        <CardHeader>
          <CardTitle className="font-heading text-sm uppercase tracking-widest text-muted-foreground">
            SoloQ Ranks
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto">
          <div className="space-y-2">
            {globalRankings.map((entry) => (
              <div
                key={entry.player_id}
                className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
              >
                <div className="relative size-9 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
                  <div className="flex size-full items-center justify-center bg-muted">
                    <User className="size-4 text-muted-foreground" />
                  </div>
                  {entry.profile_image_url && (
                    <img
                      alt={entry.player_name}
                      className="absolute inset-0 size-full object-cover"
                      loading="lazy"
                      src={resolvePlayerPhoto(entry.player_id, entry.player_name, entry.profile_image_url) ?? ""}
                      onError={(e) => { e.currentTarget.style.display = "none"; }}
                    />
                  )}
                  <img
                    alt={entry.role}
                    className="absolute bottom-0 left-0 size-4 rounded-tr bg-card/90 p-0.5"
                    loading="lazy"
                    src={ROLE_ICON_URLS[entry.role as keyof typeof ROLE_ICON_URLS] ?? "/role-icons/unknown.webp"}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-heading text-sm font-bold uppercase tracking-wider text-foreground">
                    {entry.player_name}
                  </p>
                  <p className="font-heading text-xs uppercase tracking-wide text-muted-foreground">
                    <span className={SOLOQ_TIER_COLOR[entry.tier] ?? "text-muted-foreground"}>{entry.tier}</span>
                    <span className="tabular-nums"> · {entry.lp} LP</span>
                  </p>
                </div>
                <img
                  alt=""
                  className="size-7 shrink-0 object-contain"
                  loading="lazy"
                  src={`/ladder-icons/${SOLOQ_TIER_CREST[entry.tier] ?? "unranked"}.webp`}
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="flex min-h-0 flex-1 flex-col">
        <CardHeader className="flex-row items-center justify-between space-y-0 shrink-0">
          <CardTitle className="font-heading text-sm uppercase tracking-widest text-muted-foreground">
            {t("champions.masteryTrainingTitle")}
          </CardTitle>
        <button
          type="button"
          onClick={handleDelegateTraining}
          disabled={delegating}
          className="rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-heading uppercase tracking-wider text-club-text transition-all hover:bg-primary/20 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {delegating ? t("champions.delegating") : t("champions.delegateToCoach")}
        </button>
      </CardHeader>
      <CardContent className="flex-1 space-y-3 overflow-y-auto scrollbar-v2">
        {ownPlayers.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">{t("meta.noPlayers")}</p>
        )}
        {ownPlayers.map((player) => {
          const role = toUiRole(resolvePlayerCurrentLolRole(player, managerTeam));
          const roleChampions = CHAMPIONS_BY_ROLE[role] ?? [];
          const sortedRoleChampions = [...roleChampions].sort((a, b) => {
            const aKey = normalizeKey(a);
            const bKey = normalizeKey(b);
            const aMastery = masteryMap.get(`${player.id}:${aKey}`) ?? 25;
            const bMastery = masteryMap.get(`${player.id}:${bKey}`) ?? 25;
            if (aMastery !== bMastery) return bMastery - aMastery;
            const aTier =
              discoveredTierByRoleChampion.get(`${role}:${aKey}`) ??
              discoveredTierByChampion.get(aKey) ??
              "";
            const bTier =
              discoveredTierByRoleChampion.get(`${role}:${bKey}`) ??
              discoveredTierByChampion.get(bKey) ??
              "";
            const aTierWeight = TIER_SORT_WEIGHT[aTier] ?? 99;
            const bTierWeight = TIER_SORT_WEIGHT[bTier] ?? 99;
            if (aTierWeight !== bTierWeight) return aTierWeight - bTierWeight;
            return a.localeCompare(b);
          });

          const targetsRaw = player.champion_training_targets ?? [];
          const legacy = player.champion_training_target ?? "";
          const targets = [targetsRaw[0] ?? legacy, targetsRaw[1] ?? "", targetsRaw[2] ?? ""];
          const effectiveFocus = player.training_focus ?? managerTeam?.training_focus ?? null;
          const soloQ = soloqByPlayer.get(player.id) ?? DEFAULT_SOLOQ;
          const soloQMult = soloQ.multiplier;

          return (
            <div
              key={player.id}
              className="cursor-pointer rounded-xl border border-border bg-muted/20 p-3 transition-all hover:border-muted-foreground/30"
              onClick={(e) => { if (!(e.target as HTMLElement).closest("select,button")) onSelectPlayer?.(player.id); }}
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="size-10 overflow-hidden rounded-lg bg-muted">
                    {resolvePlayerPhoto(player.id, player.match_name, player.profile_image_url) ? (
                      <img
                        src={
                          resolvePlayerPhoto(player.id, player.match_name, player.profile_image_url) ?? ""
                        }
                        alt={player.match_name}
                        className="size-full object-cover"
                      />
                    ) : (
                      <div className="flex size-full items-center justify-center bg-muted">
                        <User className="size-5 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="cursor-pointer text-sm font-semibold text-foreground hover:text-club-text" onClick={() => onSelectPlayer?.(player.id)}>{player.match_name}</p>
                    <div className="mt-0.5 flex size-5 items-center justify-center rounded border border-border bg-muted/70">
                      <img src={ROLE_ICON_URLS[role]} alt={role} className="size-3 object-contain" />
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-right">
                    <p className={cn("text-xs font-heading tabular-nums", SOLOQ_TIER_COLORS[soloQ.tier])}>
                      {soloQ.tier}
                    </p>
                    <p className="text-xs tabular-nums text-foreground">
                      {soloQ.lp} LP
                      <span
                        className={cn(
                          "ml-1",
                          soloQ.delta >= 0 ? "text-positive" : "text-negative",
                        )}
                      >
                        {soloQ.delta >= 0 ? `+${soloQ.delta}` : soloQ.delta}
                      </span>
                    </p>
                    <p className="text-2xs text-muted-foreground">x{soloQMult.toFixed(1)}</p>
                  </div>
                  <img
                    src={SOLOQ_EMBLEM_URLS[soloQ.tier]}
                    alt={soloQ.tier}
                    className="size-12 object-contain drop-shadow-[0_0_8px_rgba(0,0,0,0.5)]"
                  />
                </div>
              </div>

              <div className="grid gap-2 md:grid-cols-3">
                {targets.map((target, slotIndex) => {
                  const masteryValue = target
                    ? masteryMap.get(`${player.id}:${normalizeKey(target)}`) ?? 25
                    : 25;
                  const gainHint = expectedGainBadge(slotIndex, effectiveFocus);
                  const slotLabels = [t("meta.priorityHigh"), t("meta.priorityMedium"), t("meta.priorityLow")];
                  const slotDescs = [
                    t("meta.gainMaximum"),
                    t("meta.gainModerate"),
                    t("meta.gainMinimal"),
                  ];

                  return (
                    <div
                      key={`${player.id}-slot-${slotIndex}`}
                      className="relative rounded-lg border border-border bg-muted/30 p-2.5 transition-all hover:border-muted-foreground/30"
                      style={target ? { backgroundImage: `url(${resolveChampionTile(target) ?? ""})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
                    >
                      {target && <div className="absolute inset-0 rounded-lg bg-muted/80 transition-opacity duration-300" />}
                      <div className="relative z-10">
                      <div className="mb-1.5 flex items-start justify-between gap-1">
                        <div>
                          <span className="text-2xs font-heading uppercase tracking-wider text-muted-foreground">
                            P{slotIndex + 1}
                          </span>
                          <p className="text-xs font-heading uppercase tracking-wider text-foreground">
                            {slotLabels[slotIndex]}
                          </p>
                        </div>
                        <Badge variant="outline" className="text-2xs text-muted-foreground">
                          x{gainHint.baseMult.toFixed(2)}
                        </Badge>
                      </div>
                      <p className="mb-2 text-2xs text-muted-foreground">{slotDescs[slotIndex]}</p>

                      <select
                        value={target}
                        disabled={submittingKey === `${player.id}:${slotIndex}`}
                        onChange={(e) => {
                          void handleTrainingTargetChange(player.id, slotIndex, e.target.value);
                        }}
                        className="w-full rounded-md border border-border bg-muted pl-2 pr-8 py-1 text-xs text-foreground"
                      >
                        <option value="">{t("champions.noTarget")}</option>
                        {sortedRoleChampions.map((champion) => {
                          const championKey = normalizeKey(champion);
                          const mastery = masteryMap.get(`${player.id}:${championKey}`) ?? 25;
                          const discoveredTier =
                            discoveredTierByRoleChampion.get(`${role}:${championKey}`) ??
                            discoveredTierByChampion.get(championKey) ??
                            "?";
                          return (
                            <option key={`${player.id}-${slotIndex}-${champion}`} value={champion}>
                              {championDisplayName(champion)} · M{mastery} · T{discoveredTier}
                            </option>
                          );
                        })}
                      </select>

                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-500"
                          style={{ width: `${Math.min(100, masteryValue)}%` }}
                        />
                      </div>

                      <div className="mt-1 flex gap-2 text-2xs text-muted-foreground">
                        <span className="tabular-nums">M{masteryValue}</span>
                        <span className="tabular-nums">SoloQ x{soloQMult.toFixed(1)}</span>
                      </div>
                    </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
    </div>
  );
}
