import type { JSX } from "react";
import type { TFunction } from "i18next";
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Brain,
  Compass,
  Crosshair,
  Feather,
  Flame,
  Scale,
  Shield,
  Zap,
} from "lucide-react";
import type {
  GameStateData,
  LolTacticsData,
  PlayerSelectionOptions,
} from "@/store/gameStore";
import { resolveActiveLineupIds } from "@/store/types";
import { useTranslation } from "react-i18next";
import {
  DEFAULT_LOL_TACTICS,
  ROLE_ORDER,
  computeCoherenceBreakdown,
  computeRoleModifiers,
  type DraftRole,
} from "@/lib/teams/lolTactics";
import { calculateLolOvr } from "@/lib/players/lolPlayerStats";
import { Card, CardBody, CardHeader } from "@/ui-v2/_legacy/components/ui";
import { resolvePlayerPhoto } from "@/lib/players/playerPhotos";
import { cn } from "@/ui-v2/lib/utils";
import { ROLE_ICON_PATHS } from "@/lib/players/roleIcons";
import { formatDecimal } from "@/lib/formatting/decimalFormatting";

interface TacticsTabProps {
  gameState: GameStateData;
  onSelectPlayer: (id: string, options?: PlayerSelectionOptions) => void;
  onGameUpdate: (g: GameStateData) => void;
}

type StrongSide = LolTacticsData["strong_side"];
type GameTiming = LolTacticsData["game_timing"];
type JungleStyle = LolTacticsData["jungle_style"];
type JunglePathing = LolTacticsData["jungle_pathing"];
type FightPlan = LolTacticsData["fight_plan"];
type SupportRoaming = LolTacticsData["support_roaming"];

const ROLE_META: Record<DraftRole, { nameKey: string; icon: string; defaultName: string }> = {
  TOP: { nameKey: "tactics.lol.roles.TOP", icon: "🛡️", defaultName: "Top lane" },
  JUNGLE: { nameKey: "tactics.lol.roles.JUNGLE", icon: "🌲", defaultName: "Jungle" },
  MID: { nameKey: "tactics.lol.roles.MID", icon: "⚡", defaultName: "Mid lane" },
  ADC: { nameKey: "tactics.lol.roles.ADC", icon: "🎯", defaultName: "Bot lane (ADC)" },
  SUPPORT: { nameKey: "tactics.lol.roles.SUPPORT", icon: "🤝", defaultName: "Support" },
};

const ROLE_ICON_URLS: Record<string, string> = {
  TOP: ROLE_ICON_PATHS.TOP,
  JUNGLE: ROLE_ICON_PATHS.JUNGLE,
  MID: ROLE_ICON_PATHS.MID,
  ADC: ROLE_ICON_PATHS.ADC,
  SUPPORT: ROLE_ICON_PATHS.SUPPORT,
};

type LocalizedOption<T extends string> = {
  value: T;
  labelKey: string;
  labelDefault: string;
  descriptionKey: string;
  descriptionDefault: string;
  icon: JSX.Element;
};

const STRONG_SIDE_OPTIONS: Array<LocalizedOption<StrongSide>> = [
  {
    value: "Top",
    labelKey: "tactics.lol.options.strongSide.Top.label",
    labelDefault: "Top",
    icon: <Shield className="h-4 w-4" />,
    descriptionKey: "tactics.lol.options.strongSide.Top.description",
    descriptionDefault: "Play for top: priority resources and ganks on top side.",
  },
  {
    value: "Mid",
    labelKey: "tactics.lol.options.strongSide.Mid.label",
    labelDefault: "Mid",
    icon: <Brain className="h-4 w-4" />,
    descriptionKey: "tactics.lol.options.strongSide.Mid.description",
    descriptionDefault: "Mid is the map axis: tempo control and rotations.",
  },
  {
    value: "Bot",
    labelKey: "tactics.lol.options.strongSide.Bot.label",
    labelDefault: "Bot",
    icon: <Crosshair className="h-4 w-4" />,
    descriptionKey: "tactics.lol.options.strongSide.Bot.description",
    descriptionDefault: "Invest in bot lane to scale for fights and objectives.",
  },
];

const GAME_TIMING_OPTIONS: Array<LocalizedOption<GameTiming>> = [
  {
    value: "Early",
    labelKey: "tactics.lol.options.gameTiming.Early.label",
    labelDefault: "Early game",
    icon: <Flame className="h-4 w-4 text-red-500" />,
    descriptionKey: "tactics.lol.options.gameTiming.Early.description",
    descriptionDefault: "Look for a lead before minute 14 with an aggressive pace.",
  },
  {
    value: "Mid",
    labelKey: "tactics.lol.options.gameTiming.Mid.label",
    labelDefault: "Mid game",
    icon: <Scale className="h-4 w-4 text-accent-500" />,
    descriptionKey: "tactics.lol.options.gameTiming.Mid.description",
    descriptionDefault: "Power spike in mid game with objective setups.",
  },
  {
    value: "Late",
    labelKey: "tactics.lol.options.gameTiming.Late.label",
    labelDefault: "Late game",
    icon: <Feather className="h-4 w-4 text-blue-500" />,
    descriptionKey: "tactics.lol.options.gameTiming.Late.description",
    descriptionDefault: "Prioritize scaling and execution in extended teamfights.",
  },
];

const JUNGLE_STYLE_OPTIONS: Array<LocalizedOption<JungleStyle>> = [
  {
    value: "Ganker",
    labelKey: "tactics.lol.options.jungleStyle.Ganker.label",
    labelDefault: "Gank",
    icon: <Crosshair className="h-4 w-4" />,
    descriptionKey: "tactics.lol.options.jungleStyle.Ganker.description",
    descriptionDefault: "Lane pressure jungle: punish mistakes early.",
  },
  {
    value: "Invader",
    labelKey: "tactics.lol.options.jungleStyle.Invader.label",
    labelDefault: "Invade",
    icon: <Zap className="h-4 w-4" />,
    descriptionKey: "tactics.lol.options.jungleStyle.Invader.description",
    descriptionDefault: "Enter enemy jungle to deny resources and vision.",
  },
  {
    value: "Farmer",
    labelKey: "tactics.lol.options.jungleStyle.Farmer.label",
    labelDefault: "Farm",
    icon: <Feather className="h-4 w-4" />,
    descriptionKey: "tactics.lol.options.jungleStyle.Farmer.description",
    descriptionDefault: "Maximize farm to hit mid/late game stronger.",
  },
  {
    value: "Enabler",
    labelKey: "tactics.lol.options.jungleStyle.Enabler.label",
    labelDefault: "Enable",
    icon: <Brain className="h-4 w-4" />,
    descriptionKey: "tactics.lol.options.jungleStyle.Enabler.description",
    descriptionDefault: "Jungle enables carries with cover and tempo.",
  },
];

const JUNGLE_PATHING_OPTIONS: Array<LocalizedOption<JunglePathing>> = [
  {
    value: "TopToBot",
    labelKey: "tactics.lol.options.junglePathing.TopToBot.label",
    labelDefault: "Top -> Bot",
    icon: <ArrowDown className="h-4 w-4" />,
    descriptionKey: "tactics.lol.options.junglePathing.TopToBot.description",
    descriptionDefault: "Open top side to end pathing toward bot side.",
  },
  {
    value: "BotToTop",
    labelKey: "tactics.lol.options.junglePathing.BotToTop.label",
    labelDefault: "Bot -> Top",
    icon: <ArrowUp className="h-4 w-4" />,
    descriptionKey: "tactics.lol.options.junglePathing.BotToTop.description",
    descriptionDefault: "Open bot side to impact top in early windows.",
  },
];

const FIGHT_PLAN_OPTIONS: Array<LocalizedOption<FightPlan>> = [
  {
    value: "FrontToBack",
    labelKey: "tactics.lol.options.fightPlan.FrontToBack.label",
    labelDefault: "Front to back",
    icon: <Shield className="h-4 w-4" />,
    descriptionKey: "tactics.lol.options.fightPlan.FrontToBack.description",
    descriptionDefault: "Structured teamfight: front line protects the carry.",
  },
  {
    value: "Pick",
    labelKey: "tactics.lol.options.fightPlan.Pick.label",
    labelDefault: "Pick",
    icon: <Crosshair className="h-4 w-4" />,
    descriptionKey: "tactics.lol.options.fightPlan.Pick.description",
    descriptionDefault: "Play vision and picks to fight with an advantage.",
  },
  {
    value: "Dive",
    labelKey: "tactics.lol.options.fightPlan.Dive.label",
    labelDefault: "Dive",
    icon: <Zap className="h-4 w-4" />,
    descriptionKey: "tactics.lol.options.fightPlan.Dive.description",
    descriptionDefault: "Explosive entries to enemy backline to remove carries.",
  },
  {
    value: "Siege",
    labelKey: "tactics.lol.options.fightPlan.Siege.label",
    labelDefault: "Siege",
    icon: <Brain className="h-4 w-4" />,
    descriptionKey: "tactics.lol.options.fightPlan.Siege.description",
    descriptionDefault: "Range and structure pressure without overextending.",
  },
];

const SUPPORT_ROAMING_OPTIONS: Array<LocalizedOption<SupportRoaming>> = [
  {
    value: "Lane",
    labelKey: "tactics.lol.options.supportRoaming.Lane.label",
    labelDefault: "Play lane",
    icon: <Shield className="h-4 w-4" />,
    descriptionKey: "tactics.lol.options.supportRoaming.Lane.description",
    descriptionDefault: "Support prioritizes bot 2v2, peel, and wave control.",
  },
  {
    value: "RoamMid",
    labelKey: "tactics.lol.options.supportRoaming.RoamMid.label",
    labelDefault: "Roam mid",
    icon: <Compass className="h-4 w-4" />,
    descriptionKey: "tactics.lol.options.supportRoaming.RoamMid.description",
    descriptionDefault: "After reset, roam mid for picks and vision control.",
  },
  {
    value: "RoamTop",
    labelKey: "tactics.lol.options.supportRoaming.RoamTop.label",
    labelDefault: "Roam top",
    icon: <ArrowUpRight className="h-4 w-4" />,
    descriptionKey: "tactics.lol.options.supportRoaming.RoamTop.description",
    descriptionDefault: "Early top rotations for dives, grubs, and map tempo.",
  },
];

function positionToRole(position: string): DraftRole | null {
  const normalized = position.toUpperCase().replace(/[^A-Z]/g, "");
  if (normalized === "TOP") return "TOP";
  if (normalized === "JUNGLE") return "JUNGLE";
  if (normalized === "MID") return "MID";
  if (normalized === "ADC") return "ADC";
  if (normalized === "SUPPORT") return "SUPPORT";
  return null;
}

function ImageWithFallback({ playerId, playerName, gameState }: { playerId: string; playerName: string; gameState: GameStateData }) {
  const player = gameState.players.find(p => p.id === playerId || p.match_name === playerName);
  const photo = resolvePlayerPhoto(playerId, playerName, player?.profile_image_url);
  return (
    <img
      src={photo ?? "/default/defaultplayer.webp"}
      alt={playerName}
      className="h-10 w-10 shrink-0 rounded object-cover"
      onError={(e) => {
        const img = e.currentTarget;
        img.onerror = null;
        img.src = "/default/defaultplayer.webp";
      }}
      loading="lazy"
    />
  );
}

function Section<T extends string>({
  title,
  options,
  value,
  onChange,
}: {
  title: string;
  options: Array<{ value: T; label: string; icon: JSX.Element; description: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <Card accent="primary">
      <CardHeader className="text-base">{title}</CardHeader>
      <CardBody className="p-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                className={cn(
                  "rounded-xl border-2 px-3 py-3 text-left transition-all",
                  active
                    ? "border-primary bg-primary/10 shadow-md shadow-primary/10"
                    : "border-border hover:border-muted-foreground/30",
                )}
                onClick={() => onChange(option.value)}
              >
                <span className="mb-1 block text-base text-muted-foreground">{option.icon}</span>
                <span className="block font-heading text-sm font-bold uppercase tracking-wider text-foreground">
                  {option.label}
                </span>
                <span className="mt-1 block text-xs leading-tight text-muted-foreground">
                  {option.description}
                </span>
              </button>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}

export default function TacticsTab({
  gameState,
  onSelectPlayer: _onSelectPlayer,
  onGameUpdate,
}: TacticsTabProps): JSX.Element {
  const { t } = useTranslation();
  const myTeam = gameState.teams.find(
    (team) => team.id === gameState.manager.team_id,
  );

  const initial = useMemo<LolTacticsData>(() => {
    if (!myTeam?.lol_tactics) return DEFAULT_LOL_TACTICS;
    return {
      strong_side: myTeam.lol_tactics.strong_side,
      game_timing: myTeam.lol_tactics.game_timing,
      jungle_style: myTeam.lol_tactics.jungle_style,
      jungle_pathing: myTeam.lol_tactics.jungle_pathing,
      fight_plan: myTeam.lol_tactics.fight_plan,
      support_roaming: myTeam.lol_tactics.support_roaming ?? "Lane",
    };
  }, [myTeam?.lol_tactics]);

  const [tactics, setTactics] = useState<LolTacticsData>(initial);
  const [saving, setSaving] = useState(false);

  const roleMetaLabels = useMemo(() => {
    return ROLE_ORDER.reduce(
      (acc, role) => {
        acc[role] = t(ROLE_META[role].nameKey, ROLE_META[role].defaultName);
        return acc;
      },
      {} as Record<DraftRole, string>,
    );
  }, [t]);

  const buildOptions = <T extends string,>(items: Array<LocalizedOption<T>>) =>
    items.map((item) => ({
      value: item.value,
      icon: item.icon,
      label: t(item.labelKey, item.labelDefault),
      description: t(item.descriptionKey, item.descriptionDefault),
    }));

  const gameTimingOptions = useMemo(() => buildOptions(GAME_TIMING_OPTIONS), [t]);
  const strongSideOptions = useMemo(() => buildOptions(STRONG_SIDE_OPTIONS), [t]);
  const jungleStyleOptions = useMemo(() => buildOptions(JUNGLE_STYLE_OPTIONS), [t]);
  const junglePathingOptions = useMemo(() => buildOptions(JUNGLE_PATHING_OPTIONS), [t]);
  const fightPlanOptions = useMemo(() => buildOptions(FIGHT_PLAN_OPTIONS), [t]);
  const supportRoamingOptions = useMemo(() => buildOptions(SUPPORT_ROAMING_OPTIONS), [t]);

  useEffect(() => {
    setTactics(initial);
  }, [initial]);

  const roleModifiers = useMemo(() => computeRoleModifiers(tactics), [tactics]);
  const coherence = useMemo(() => computeCoherenceBreakdown(tactics), [tactics]);
  const coherenceScore = useMemo(
    () => coherence.reduce((sum, item) => sum + item.delta, 0),
    [coherence],
  );

  const roleImpactRows = useMemo(() => {
    if (!myTeam) return [];

    const teamPlayers = gameState.players.filter((player) => player.team_id === myTeam.id);
    const starterIds = new Set(resolveActiveLineupIds(myTeam));

    const startersFirst = [
      ...teamPlayers.filter((player) => starterIds.has(player.id)),
      ...teamPlayers.filter((player) => !starterIds.has(player.id)),
    ];

    const pickedByRole = new Map<DraftRole, GameStateData["players"][number]>();
    startersFirst.forEach((player) => {
      const role = positionToRole(player.position);
      if (!role || pickedByRole.has(role)) return;
      pickedByRole.set(role, player);
    });

    return ROLE_ORDER.map((role) => {
      const player = pickedByRole.get(role) ?? null;
      const base = player ? calculateLolOvr(player) : 70;
      const modifier = roleModifiers[role] * 1.8;
      const variance = Math.max(0.5, Math.abs(roleModifiers[role]) * 0.6 + 0.6);
      const effective = base + modifier;
      return {
        role,
        playerId: player?.id ?? null,
        playerName: player?.match_name ?? t("tactics.lol.noStarter"),
        profileImageUrl: player?.profile_image_url ?? null,
        base,
        modifier,
        variance,
        effective,
      };
    });
  }, [gameState.players, myTeam, roleModifiers, t]);

  const maxAbsModifier = useMemo(
    () => Math.max(1, ...roleImpactRows.map((r) => Math.abs(r.modifier))),
    [roleImpactRows],
  );

  if (!myTeam) {
    return (
      <p className="text-muted-foreground">{t("common.noTeam")}</p>
    );
  }

  async function persist(next: LolTacticsData): Promise<void> {
    setTactics(next);
    setSaving(true);
    try {
      const updated = await invoke<GameStateData>("set_lol_tactics", {
        lolTactics: {
          strong_side: next.strong_side,
          game_timing: next.game_timing,
          jungle_style: next.jungle_style,
          jungle_pathing: next.jungle_pathing,
          fight_plan: next.fight_plan,
          support_roaming: next.support_roaming,
        },
      });
      onGameUpdate(updated);
    } catch (error) {
      console.error("Failed to set lol tactics:", error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[1.6fr_1fr]">
        <div className="flex flex-col gap-4">
          <details className="group">
            <summary className={cn(
              "flex cursor-pointer list-none items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm font-heading font-bold uppercase tracking-wider text-foreground transition-colors hover:bg-muted [&::-webkit-details-marker]:hidden"
            )}>
              <span className="flex-1">{t("tactics.lol.gamePlan")}</span>
              <svg
                className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180"
                xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </summary>
            <div className="mt-2 rounded-xl border border-border bg-card p-4 text-sm leading-relaxed text-muted-foreground">
              {t("tactics.lol.gamePlanDescription")}
            </div>
          </details>

          <Card accent="primary" className="xl:hidden">
            <CardHeader>{t("tactics.lol.impactAndCoherence")}</CardHeader>
            <CardBody className="p-4">
              <CoherenceSummary
                coherenceScore={coherenceScore}
                coherence={coherence}
                roleImpactRows={roleImpactRows}
                roleMetaLabels={roleMetaLabels}
                maxAbsModifier={maxAbsModifier}
                gameState={gameState}
                t={t}
              />
            </CardBody>
          </Card>

          <Section<GameTiming>
            title={t("tactics.lol.sections.gameTiming", "Game timing")}
            value={tactics.game_timing}
            onChange={(value) =>
              void persist({
                ...tactics,
                game_timing: value,
              })
            }
            options={gameTimingOptions}
          />

          <Section<StrongSide>
            title={t("tactics.lol.sections.strongSide", "Strong side")}
            value={tactics.strong_side}
            onChange={(value) =>
              void persist({
                ...tactics,
                strong_side: value,
              })
            }
            options={strongSideOptions}
          />

          <Section<JungleStyle>
            title={t("tactics.lol.sections.jungleStyle", "Jungle style")}
            value={tactics.jungle_style}
            onChange={(value) =>
              void persist({
                ...tactics,
                jungle_style: value,
              })
            }
            options={jungleStyleOptions}
          />

          <Section<JunglePathing>
            title={t("tactics.lol.sections.junglePathing", "Jungle pathing")}
            value={tactics.jungle_pathing}
            onChange={(value) =>
              void persist({
                ...tactics,
                jungle_pathing: value,
              })
            }
            options={junglePathingOptions}
          />

          <Section<FightPlan>
            title={t("tactics.lol.sections.fightPlan", "Fight plan")}
            value={tactics.fight_plan}
            onChange={(value) =>
              void persist({
                ...tactics,
                fight_plan: value,
              })
            }
            options={fightPlanOptions}
          />

          <Section<SupportRoaming>
            title={t("tactics.lol.sections.supportRoaming", "Support roaming")}
            value={tactics.support_roaming}
            onChange={(value) =>
              void persist({
                ...tactics,
                support_roaming: value,
              })
            }
            options={supportRoamingOptions}
          />
        </div>

        <aside className="sticky top-2">
          <Card>
            <CardHeader>{t("tactics.lol.impactAndCoherence")}</CardHeader>
            <CardBody className="p-4">
              <CoherenceSummary
                coherenceScore={coherenceScore}
                coherence={coherence}
                roleImpactRows={roleImpactRows}
                roleMetaLabels={roleMetaLabels}
                maxAbsModifier={maxAbsModifier}
                gameState={gameState}
                t={t}
              />
            </CardBody>
          </Card>
        </aside>
      </div>

      <p className="text-xs text-muted-foreground px-1">
        {saving
          ? t("common.saving")
          : t("tactics.lol.autoSave")}
      </p>
    </div>
  );
}

function CoherenceSummary({
  coherenceScore,
  coherence,
  roleImpactRows,
  roleMetaLabels,
  maxAbsModifier,
  gameState,
  t,
}: {
  coherenceScore: number;
  coherence: ReturnType<typeof computeCoherenceBreakdown>;
  roleImpactRows: Array<{
    role: string;
    playerId: string | null;
    playerName: string;
    base: number;
    modifier: number;
    variance: number;
  }>;
  roleMetaLabels: Record<string, string>;
  maxAbsModifier: number;
  gameState: GameStateData;
  t: TFunction;
}) {
  const { i18n } = useTranslation();
  const size = 64;
  const strokeWidth = 6;
  const radius = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * radius;
  const normalizedPct = Math.max(0, Math.min(100, ((coherenceScore + 2) / 4) * 100));
  const fillLen = (normalizedPct / 100) * circ;
  const scoreColor = coherenceScore >= 1 ? "#22c55e" : coherenceScore >= 0 ? "#eab308" : "#ef4444";
  const label = coherenceScore >= 1
    ? t("tactics.lol.coherence.high")
    : coherenceScore >= 0
      ? t("tactics.lol.coherence.medium")
      : t("tactics.lol.coherence.low");

  return (
    <>
      <div className="rounded-lg border border-border bg-muted p-3">
        <div className="flex items-center gap-3">
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
            <circle cx={size/2} cy={size/2} r={radius} fill="none" strokeWidth={strokeWidth} className="stroke-muted" />
            <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke={scoreColor} strokeWidth={strokeWidth}
              strokeDasharray={`${fillLen} ${circ - fillLen}`}
              strokeDashoffset={0}
              transform={`rotate(-90 ${size/2} ${size/2})`}
              className="transition-all duration-500"
            />
          </svg>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("tactics.lol.coherenceLabel")}
            </p>
            <p className="text-lg font-heading font-bold text-foreground">{label}</p>
            <p className="text-xs text-muted-foreground">
              {t("tactics.lol.score")}: {coherenceScore > 0 ? "+" : ""}{formatDecimal(coherenceScore, 2, i18n.language)}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {coherence.map((item) => (
          <div key={item.labelKey} className="flex items-start justify-between gap-2 text-xs">
            <span className="text-muted-foreground">{t(item.labelKey)}</span>
            <span
              className={cn(
                "font-heading font-bold",
                item.delta >= 0 ? "text-emerald-400" : "text-rose-400",
              )}
            >
              {item.delta > 0 ? "+" : ""}
              {formatDecimal(item.delta, 2, i18n.language)}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-4 border-t border-border pt-3">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {t("tactics.lol.roleImpact")}
        </p>
        <div className="mt-2 space-y-2.5">
          {roleImpactRows.map((row) => (
            <div
              key={row.role}
              className="rounded-xl border border-border bg-card px-3 py-2.5"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted">
                    <img
                      src={ROLE_ICON_URLS[row.role as DraftRole]}
                      alt={roleMetaLabels[row.role]}
                      className="w-4 h-4 object-contain opacity-90"
                      loading="lazy"
                    />
                  </div>

                  {row.playerId ? (
                    <ImageWithFallback
                      playerId={row.playerId}
                      playerName={row.playerName}
                      gameState={gameState}
                    />
                  ) : (
                    <div className="h-10 w-10 shrink-0 rounded bg-muted" />
                  )}

                  <div className="min-w-0">
                    <p className="truncate text-sm font-heading font-bold text-foreground">
                      {row.playerName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {Math.round(row.base)} OVR · {roleMetaLabels[row.role]}
                    </p>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="flex items-center gap-1.5 justify-end">
                    <div className="flex items-center gap-0.5">
                      <div className="w-12 h-1.5 bg-muted rounded-l-full overflow-hidden flex justify-end">
                        {row.modifier < 0 && (
                          <div
                            className="h-full bg-rose-400 rounded-l-full transition-all duration-500"
                            style={{ width: `${(Math.abs(row.modifier) / maxAbsModifier) * 100}%` }}
                          />
                        )}
                      </div>
                      <div className="w-0.5 h-3 bg-muted rounded-full shrink-0" />
                      <div className="w-12 h-1.5 bg-muted rounded-r-full overflow-hidden">
                        {row.modifier >= 0 && (
                          <div
                            className="h-full bg-emerald-400 rounded-r-full transition-all duration-500"
                            style={{ width: `${(row.modifier / maxAbsModifier) * 100}%` }}
                          />
                        )}
                      </div>
                    </div>
                    <p
                      className={cn(
                        "text-xl leading-none font-heading font-black",
                        row.modifier >= 0 ? "text-emerald-400" : "text-rose-400",
                      )}
                    >
                      {row.modifier >= 0 ? "+" : ""}
                      {formatDecimal(row.modifier, 1, i18n.language)}
                    </p>
                  </div>
                  <p className="text-2xs text-muted-foreground">
                    ±{formatDecimal(row.variance, 1, i18n.language)} {t("tactics.lol.variance")}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        {t("tactics.lol.tip")}
      </p>
    </>
  );
}
