import React from "react";
import { MatchEvent, MatchSnapshot } from "@/ui-v2/_legacy/components/match/types";
import type { FixtureData, GameStateData } from "@/store/gameStore";
import {
  Circle,
  CircleOff,
  Square,
  ArrowLeftRight,
  Cross,
  Play,
  Pause,
  Flag,
  Hand,
  ArrowUpRight,
  Shield,
  CornerDownRight,
  Ruler,
  AlertTriangle,
  Zap,
  CircleDot,
} from "lucide-react";

export const EVENT_ICONS: Record<
  string,
  { icon: React.ReactNode; color: string; important: boolean }
> = {
  Goal: {
    icon: <Circle className="w-4 h-4 fill-current" />,
    color: "text-accent-700 dark:text-accent-400",
    important: true,
  },
  PenaltyGoal: {
    icon: <CircleDot className="w-4 h-4" />,
    color: "text-accent-700 dark:text-accent-400",
    important: true,
  },
  PenaltyMiss: {
    icon: <CircleOff className="w-4 h-4" />,
    color: "text-red-400",
    important: true,
  },
  YellowCard: {
    icon: <Square className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />,
    color: "text-yellow-400",
    important: true,
  },
  RedCard: {
    icon: <Square className="w-3.5 h-3.5 fill-red-500 text-red-500" />,
    color: "text-red-500",
    important: true,
  },
  SecondYellow: {
    icon: <Square className="w-3.5 h-3.5 fill-red-500 text-red-500" />,
    color: "text-red-500",
    important: true,
  },
  Substitution: {
    icon: <ArrowLeftRight className="w-4 h-4" />,
    color: "text-blue-400",
    important: true,
  },
  Injury: {
    icon: <Cross className="w-4 h-4" />,
    color: "text-red-400",
    important: true,
  },
  KickOff: {
    icon: <Play className="w-3.5 h-3.5 fill-current" />,
    color: "text-gray-700 dark:text-gray-400",
    important: true,
  },
  HalfTime: {
    icon: <Pause className="w-3.5 h-3.5" />,
    color: "text-gray-700 dark:text-gray-400",
    important: true,
  },
  SecondHalfStart: {
    icon: <Play className="w-3.5 h-3.5 fill-current" />,
    color: "text-gray-700 dark:text-gray-400",
    important: true,
  },
  FullTime: {
    icon: <Flag className="w-4 h-4" />,
    color: "text-gray-700 dark:text-gray-400",
    important: true,
  },
  ShotSaved: {
    icon: <Hand className="w-4 h-4" />,
    color: "text-green-700 dark:text-green-400",
    important: false,
  },
  ShotOffTarget: {
    icon: <ArrowUpRight className="w-4 h-4" />,
    color: "text-gray-700 dark:text-gray-500",
    important: false,
  },
  ShotBlocked: {
    icon: <Shield className="w-4 h-4" />,
    color: "text-gray-700 dark:text-gray-500",
    important: false,
  },
  Corner: {
    icon: <CornerDownRight className="w-4 h-4" />,
    color: "text-gray-700 dark:text-gray-500",
    important: false,
  },
  FreeKick: {
    icon: <Ruler className="w-4 h-4" />,
    color: "text-gray-700 dark:text-gray-500",
    important: false,
  },
  Foul: {
    icon: <AlertTriangle className="w-4 h-4" />,
    color: "text-yellow-700 dark:text-yellow-500",
    important: false,
  },
  PenaltyAwarded: {
    icon: <Zap className="w-4 h-4" />,
    color: "text-accent-700 dark:text-accent-400",
    important: true,
  },
  Kill: {
    icon: <Circle className="w-4 h-4 fill-current" />,
    color: "text-accent-700 dark:text-accent-400",
    important: true,
  },
  ObjectiveSpawned: {
    icon: <CircleDot className="w-4 h-4" />,
    color: "text-cyan-600 dark:text-cyan-400",
    important: false,
  },
  ObjectiveTaken: {
    icon: <Zap className="w-4 h-4" />,
    color: "text-amber-600 dark:text-amber-400",
    important: true,
  },
  TowerDestroyed: {
    icon: <Flag className="w-4 h-4" />,
    color: "text-orange-500",
    important: true,
  },
  InhibitorDestroyed: {
    icon: <Flag className="w-4 h-4" />,
    color: "text-red-500",
    important: true,
  },
  InhibitorRespawned: {
    icon: <CircleDot className="w-4 h-4" />,
    color: "text-emerald-500",
    important: false,
  },
  NexusTowerDestroyed: {
    icon: <Flag className="w-4 h-4" />,
    color: "text-red-500",
    important: true,
  },
  NexusDestroyed: {
    icon: <Flag className="w-4 h-4" />,
    color: "text-red-600",
    important: true,
  },
};

const DEFAULT_DISPLAY = {
  icon: <Circle className="w-3 h-3" />,
  color: "text-gray-700 dark:text-gray-400",
  important: false,
};

export function getEventDisplay(evt: MatchEvent) {
  return EVENT_ICONS[evt.event_type] || DEFAULT_DISPLAY;
}

export function getPlayerName(
  snapshot: MatchSnapshot,
  playerId: string | null,
): string {
  if (!playerId) return "";
  for (const p of snapshot.home_team.players) {
    if (p.id === playerId) return p.name;
  }
  for (const p of snapshot.away_team.players) {
    if (p.id === playerId) return p.name;
  }
  // Also check bench players
  if (snapshot.home_bench) {
    for (const p of snapshot.home_bench) {
      if (p.id === playerId) return p.name;
    }
  }
  if (snapshot.away_bench) {
    for (const p of snapshot.away_bench) {
      if (p.id === playerId) return p.name;
    }
  }
  return playerId;
}

export function phaseLabel(phase: string): string {
  switch (phase) {
    case "PreGame":
      return "Draft";
    case "PreKickOff":
      return "Pre-Match";
    case "FirstHalf":
      return "1st Half";
    case "HalfTime":
      return "Half Time";
    case "SecondHalf":
      return "2nd Half";
    case "FullTime":
      return "Full Time";
    case "ExtraTimeFirstHalf":
      return "ET 1st Half";
    case "ExtraTimeHalfTime":
      return "ET Half Time";
    case "ExtraTimeSecondHalf":
      return "ET 2nd Half";
    case "ExtraTimeEnd":
      return "ET End";
    case "PenaltyShootout":
      return "Penalties";
    case "Live":
      return "Live";
    case "Finished":
      return "Final";
    default:
      return phase;
  }
}

export function calcOvr(attrs: Record<string, number>): number {
  // Use the 9 visible LoL stats (same as calculate_lol_ovr in Rust)
  const stats = [
    attrs.mechanics,
    attrs.laning,
    attrs.teamfighting,
    attrs.macro_play,
    attrs.consistency,
    attrs.shotcalling,
    attrs.champion_pool,
    attrs.discipline,
    attrs.mental_resilience,
  ];
  const valid = stats.filter((v) => v != null);
  if (valid.length === 0) return 0;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}

/** Fixtures of the league the user plays in; the backend indexes fixtures in that same league. */
export function userLeagueFixtures(gameState: GameStateData | null): FixtureData[] | undefined {
  const userLeague = gameState?.user_competition_id
    ? gameState.leagues?.find((league) => league.competition_id === gameState.user_competition_id)
    : undefined;
  return (userLeague ?? gameState?.leagues?.[0])?.fixtures;
}

export function resolveMatchFixture(
  gameState: GameStateData | null,
  snapshot: MatchSnapshot | null,
  fixtureIndex?: number,
): FixtureData | null {
  const fixtures = userLeagueFixtures(gameState);
  if (!fixtures || !snapshot) return null;

  if (
    typeof fixtureIndex === "number" &&
    fixtureIndex >= 0 &&
    fixtureIndex < fixtures.length
  ) {
    return fixtures[fixtureIndex];
  }

  return (
    fixtures.find(
      (fixture) =>
        fixture.home_team_id === snapshot.home_team.id &&
        fixture.away_team_id === snapshot.away_team.id,
    ) || null
  );
}
