import type { JSX } from "react";
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
import { useTranslation } from "react-i18next";

import type { GameStateData } from "@/store/gameStore";
import {
  DEFAULT_LOL_TACTICS,
  ROLE_ORDER,
  computeCoherenceBreakdown,
  computeRoleModifiers,
  type DraftRole,
} from "@/lib/teams/lolTactics";
import type { LolTacticsData } from "@/store/types";
import { resolveActiveLineupIds } from "@/store/types";
import { calculateLolOvr } from "@/lib/players/lolPlayerStats";
import { resolvePlayerPhoto } from "@/lib/players/playerPhotos";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/ui-v2/components/ui/card";
import { cn } from "@/ui-v2/lib/utils";
import { ROLE_ICON_PATHS } from "@/lib/players/roleIcons";
import { formatDecimal } from "@/lib/formatting/decimalFormatting";

// ─── Types ────────────────────────────────────────────────────────────

type StrongSide = LolTacticsData["strong_side"];
type GameTiming = LolTacticsData["game_timing"];
type JungleStyle = LolTacticsData["jungle_style"];
type JunglePathing = LolTacticsData["jungle_pathing"];
type FightPlan = LolTacticsData["fight_plan"];
type SupportRoaming = LolTacticsData["support_roaming"];

interface TacticOption<T extends string> {
  value: T;
  labelKey: string;
  labelDefault: string;
  descriptionKey: string;
  descriptionDefault: string;
  icon: JSX.Element;
}

// ─── Role constants ───────────────────────────────────────────────────

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

// ─── Option data arrays (static — not localized) ──────────────────────

const GAME_TIMING_OPTIONS: Array<TacticOption<GameTiming>> = [
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
    icon: <Scale className="h-4 w-4 text-amber-500" />,
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

const STRONG_SIDE_OPTIONS: Array<TacticOption<StrongSide>> = [
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

const JUNGLE_STYLE_OPTIONS: Array<TacticOption<JungleStyle>> = [
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

const JUNGLE_PATHING_OPTIONS: Array<TacticOption<JunglePathing>> = [
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

const FIGHT_PLAN_OPTIONS: Array<TacticOption<FightPlan>> = [
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

const SUPPORT_ROAMING_OPTIONS: Array<TacticOption<SupportRoaming>> = [
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

// ─── Sub-components ───────────────────────────────────────────────────

function positionToRole(position: string): DraftRole | null {
  const normalized = position.toUpperCase().replace(/[^A-Z]/g, "");
  if (normalized === "TOP") return "TOP";
  if (normalized === "JUNGLE") return "JUNGLE";
  if (normalized === "MID") return "MID";
  if (normalized === "ADC") return "ADC";
  if (normalized === "SUPPORT") return "SUPPORT";
  return null;
}

function ImageWithFallback({
  playerId,
  playerName,
  gameState,
}: {
  playerId: string;
  playerName: string;
  gameState: GameStateData;
}) {
  const player = gameState.players.find(
    (p) => p.id === playerId || p.match_name === playerName,
  );
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
  saving,
}: {
  title: string;
  options: Array<{ value: T; label: string; icon: JSX.Element; description: string }>;
  value: T;
  onChange: (value: T) => void;
  saving: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-sm uppercase tracking-widest text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                disabled={saving}
                onClick={() => onChange(option.value)}
                className={cn(
                  "rounded-xl border-2 p-3 text-left transition-all",
                  active
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-primary/50",
                  saving && "pointer-events-none opacity-60",
                )}
              >
                <div className="mb-1 text-muted-foreground">{option.icon}</div>
                <p className="font-heading text-sm font-bold uppercase tracking-wider text-foreground">
                  {option.label}
                </p>
                <p className="mt-1 text-xs leading-tight text-muted-foreground">
                  {option.description}
                </p>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Props ────────────────────────────────────────────────────────────

interface TacticsTabV2Props {
  gameState: GameStateData;
  onGameUpdate: (state: GameStateData) => void;
}

// ─── Main Component ───────────────────────────────────────────────────

export function TacticsTabV2({ gameState, onGameUpdate }: TacticsTabV2Props) {
  const { t, i18n } = useTranslation();
  const myTeam = gameState.teams.find(
    (team) => team.id === gameState.manager.team_id,
  );

  // ─── State ─────────────────────────────────────────────────────────
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

  // Sync state when team/tactics change externally
  useEffect(() => {
    setTactics(initial);
  }, [initial]);

  // ─── Localized options (useMemo) ──────────────────────────────────
  const buildOptions = <T extends string,>(items: Array<TacticOption<T>>) =>
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

  // ─── Role labels ──────────────────────────────────────────────────
  const roleMetaLabels = useMemo(() => {
    return ROLE_ORDER.reduce(
      (acc, role) => {
        acc[role] = t(ROLE_META[role].nameKey, ROLE_META[role].defaultName);
        return acc;
      },
      {} as Record<DraftRole, string>,
    );
  }, [t]);

  // ─── Derived data (all useMemo) ───────────────────────────────────
  const roleModifiers = useMemo(() => computeRoleModifiers(tactics), [tactics]);
  const coherence = useMemo(() => computeCoherenceBreakdown(tactics), [tactics]);
  const coherenceScore = useMemo(
    () => coherence.reduce((sum, item) => sum + item.delta, 0),
    [coherence],
  );

  const roleImpactRows = useMemo(() => {
    if (!myTeam) return [];

    const teamPlayers = gameState.players.filter(
      (player) => player.team_id === myTeam.id,
    );
    const starterIds = new Set(resolveActiveLineupIds(myTeam));

    const startersFirst = [
      ...teamPlayers.filter((player) => starterIds.has(player.id)),
      ...teamPlayers.filter((player) => !starterIds.has(player.id)),
    ];

    const pickedByRole = new Map<DraftRole, (typeof gameState.players)[number]>();
    startersFirst.forEach((player) => {
      const role = positionToRole(player.position);
      if (!role || pickedByRole.has(role)) return;
      pickedByRole.set(role, player);
    });

    return ROLE_ORDER.map((role) => {
      const player = pickedByRole.get(role) ?? null;
      const base = player ? Math.round(calculateLolOvr(player)) : 70;
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

  // ─── Edge: no active team ─────────────────────────────────────────
  if (!myTeam) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="font-heading text-sm font-bold uppercase tracking-wider text-muted-foreground">
              {t("common.noTeam", { defaultValue: "Sin equipo activo" })}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Persist function ─────────────────────────────────────────────
  async function persist(next: LolTacticsData): Promise<void> {
    setTactics(next); // optimistic UI
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
      // No rollback — optimistic UI stays on user's choice
    } finally {
      setSaving(false);
    }
  }

  // ─── SVG coherence ring helpers ───────────────────────────────────
  const ringSize = 64;
  const ringStrokeWidth = 6;
  const ringRadius = (ringSize - ringStrokeWidth) / 2;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const normalizedPct = Math.max(
    0,
    Math.min(100, ((coherenceScore + 2) / 4) * 100),
  );
  const ringFillLen = (normalizedPct / 100) * ringCircumference;
  const ringColor =
    coherenceScore >= 1
      ? "#22c55e"
      : coherenceScore >= 0
        ? "#eab308"
        : "#ef4444";
  const coherenceLabelKey =
    coherenceScore >= 1
      ? "tactics.lol.coherence.high"
      : coherenceScore >= 0
        ? "tactics.lol.coherence.medium"
        : "tactics.lol.coherence.low";

  // ─── Render ───────────────────────────────────────────────────────
  return (
    <div className="mx-auto flex max-h-full w-full max-w-7xl flex-col gap-4 overflow-hidden p-6">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 xl:grid-cols-[1.6fr_1fr]">
        {/* ── Left column: 6 tactic sections ────────────────────────── */}
        <div className="flex flex-col gap-4 overflow-y-auto">
          <Section<GameTiming>
            title={t("tactics.lol.sections.gameTiming", "Game timing")}
            options={gameTimingOptions}
            value={tactics.game_timing}
            onChange={(value) =>
              void persist({ ...tactics, game_timing: value })
            }
            saving={saving}
          />

          <Section<StrongSide>
            title={t("tactics.lol.sections.strongSide", "Strong side")}
            options={strongSideOptions}
            value={tactics.strong_side}
            onChange={(value) =>
              void persist({ ...tactics, strong_side: value })
            }
            saving={saving}
          />

          <Section<JungleStyle>
            title={t("tactics.lol.sections.jungleStyle", "Jungle style")}
            options={jungleStyleOptions}
            value={tactics.jungle_style}
            onChange={(value) =>
              void persist({ ...tactics, jungle_style: value })
            }
            saving={saving}
          />

          <Section<JunglePathing>
            title={t("tactics.lol.sections.junglePathing", "Jungle pathing")}
            options={junglePathingOptions}
            value={tactics.jungle_pathing}
            onChange={(value) =>
              void persist({ ...tactics, jungle_pathing: value })
            }
            saving={saving}
          />

          <Section<FightPlan>
            title={t("tactics.lol.sections.fightPlan", "Fight plan")}
            options={fightPlanOptions}
            value={tactics.fight_plan}
            onChange={(value) =>
              void persist({ ...tactics, fight_plan: value })
            }
            saving={saving}
          />

          <Section<SupportRoaming>
            title={t("tactics.lol.sections.supportRoaming", "Support roaming")}
            options={supportRoamingOptions}
            value={tactics.support_roaming}
            onChange={(value) =>
              void persist({ ...tactics, support_roaming: value })
            }
            saving={saving}
          />
        </div>

        {/* ── Right column: Sidebar (sticky) ─────────────────────────── */}
        <aside className="sticky top-2 max-h-dvh overflow-hidden">
          <Card className="h-full">
            <CardHeader>
              <CardTitle className="font-heading text-sm uppercase tracking-widest text-muted-foreground">
                {t("tactics.lol.impactAndCoherence")}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto">
              {/* ── SVG Coherence Ring ──────────────────────────────── */}
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex items-center gap-3">
                  <svg
                    width={ringSize}
                    height={ringSize}
                    viewBox={`0 0 ${ringSize} ${ringSize}`}
                    className="shrink-0"
                  >
                    <circle
                      cx={ringSize / 2}
                      cy={ringSize / 2}
                      r={ringRadius}
                      fill="none"
                      strokeWidth={ringStrokeWidth}
                      className="stroke-muted"
                    />
                    <circle
                      cx={ringSize / 2}
                      cy={ringSize / 2}
                      r={ringRadius}
                      fill="none"
                      stroke={ringColor}
                      strokeWidth={ringStrokeWidth}
                      strokeDasharray={`${ringFillLen} ${ringCircumference - ringFillLen}`}
                      strokeDashoffset={0}
                      transform={`rotate(-90 ${ringSize / 2} ${ringSize / 2})`}
                      className="transition-all duration-500"
                    />
                  </svg>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t("tactics.lol.coherenceLabel")}
                    </p>
                    <p className="text-lg font-heading font-bold text-foreground">
                      {t(coherenceLabelKey)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("tactics.lol.score")}: {coherenceScore > 0 ? "+" : ""}
                      {formatDecimal(coherenceScore, 2, i18n.language)}
                    </p>
                  </div>
                </div>
              </div>

              {/* ── Coherence Breakdown ──────────────────────────────── */}
              <div className="mt-3 space-y-2">
                {coherence.map((item) => (
                  <div
                    key={item.labelKey}
                    className="flex items-start justify-between gap-2 text-xs"
                  >
                    <span className="text-muted-foreground">
                      {t(item.labelKey)}
                    </span>
                    <span
                      className={cn(
                        "font-heading font-bold",
                        item.delta >= 0
                          ? "text-positive"
                          : "text-negative",
                      )}
                    >
                      {item.delta > 0 ? "+" : ""}
                      {formatDecimal(item.delta, 2, i18n.language)}
                    </span>
                  </div>
                ))}
              </div>

              {/* ── Role Impact ──────────────────────────────────────── */}
              <div className="mt-4 border-t border-border pt-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t("tactics.lol.roleImpact")}
                </p>
                <div className="mt-2 space-y-2.5">
                  {roleImpactRows.map((row) => (
                    <div
                      key={row.role}
                      className="rounded-xl border border-border bg-muted/30 px-3 py-2.5"
                    >
                      <div className="flex items-center justify-between gap-3">
                        {/* Left side: role icon + photo + name */}
                        <div className="flex min-w-0 items-center gap-2.5">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted">
                            <img
                              src={ROLE_ICON_URLS[row.role]}
                              alt={roleMetaLabels[row.role]}
                              className="h-4 w-4 object-contain opacity-90"
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
                            <p className="truncate font-heading text-sm font-bold text-foreground">
                              {row.playerName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {Math.round(row.base)} OVR ·{" "}
                              {roleMetaLabels[row.role]}
                            </p>
                          </div>
                        </div>

                        {/* Right side: modifier bar + effective OVR */}
                        <div className="shrink-0 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <div className="flex items-center gap-0.5">
                              {/* Negative side */}
                              <div className="flex h-1.5 w-12 justify-end overflow-hidden rounded-l-full bg-muted">
                                {row.modifier < 0 && (
                                  <div
                                    className="h-full rounded-l-full bg-negative transition-all duration-500"
                                    style={{
                                      width: `${(Math.abs(row.modifier) / maxAbsModifier) * 100}%`,
                                    }}
                                  />
                                )}
                              </div>
                              {/* Center zero line */}
                              <div className="h-3 w-0.5 shrink-0 rounded-full bg-border" />
                              {/* Positive side */}
                              <div className="flex h-1.5 w-12 overflow-hidden rounded-r-full bg-muted">
                                {row.modifier >= 0 && (
                                  <div
                                    className="h-full rounded-r-full bg-positive transition-all duration-500"
                                    style={{
                                      width: `${(row.modifier / maxAbsModifier) * 100}%`,
                                    }}
                                  />
                                )}
                              </div>
                            </div>
                            <p
                              className={cn(
                                "font-heading text-xl font-black leading-none",
                                row.modifier >= 0
                                  ? "text-positive"
                                  : "text-negative",
                              )}
                            >
                              {row.modifier >= 0 ? "+" : ""}
                              {formatDecimal(row.modifier, 1, i18n.language)}
                            </p>
                          </div>
                          <p className="text-2xs text-muted-foreground">
                            ±{formatDecimal(row.variance, 1, i18n.language)}{" "}
                            {t("tactics.lol.variance")}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Tip ─────────────────────────────────────────────── */}
              <p className="mt-4 text-xs text-muted-foreground">
                {t("tactics.lol.tip")}
              </p>
            </CardContent>
          </Card>
        </aside>
      </div>

      {/* ── Saving / auto-save indicator ─────────────────────────────── */}
      <p className="px-1 text-xs text-muted-foreground">
        {saving ? t("common.saving") : t("tactics.lol.autoSave")}
      </p>
    </div>
  );
}
