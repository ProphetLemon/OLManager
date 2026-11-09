import type { TFunction } from "i18next";

import type { GameStateData, PlayerData, TeamData } from "@/store/gameStore";

export interface TeamProfileProps {
  team: TeamData;
  gameState: GameStateData;
  isOwnTeam: boolean;
  onClose: () => void;
  onSelectPlayer?: (id: string) => void;
}

export type TeamProfileTranslate = TFunction;

export type LeagueStanding = GameStateData["leagues"][number]["standings"][number];

export interface TeamProfileViewModel {
  roster: PlayerData[];
  avgOvr: number;
  totalWages: number;
  totalValue: number;
  manager: GameStateData["manager"] | null;
  leaguePos: number;
  standings: LeagueStanding | null;
}

export interface TeamStatsOverview {
  matchesPlayed: number;
  wins: number;
  losses: number;
  metrics: {
    kills: { total: number; perMatch: number | null };
    deaths: { total: number; perMatch: number | null };
    goldEarned: { total: number; perMatch: number | null };
    damageToChampions: { total: number; perMatch: number | null };
    objectives: { total: number; perMatch: number | null };
    averageGameDurationSeconds: { total: number; perMatch: number | null };
  };
}

export interface TeamRecentMatchEntry {
  fixtureId: string;
  date: string;
  competition: string;
  matchday: number;
  opponentTeamId: string;
  opponentName: string;
  side: "Blue" | "Red";
  result: "Win" | "Loss";
  gameDurationSeconds: number;
  kills: number;
  deaths: number;
  goldEarned: number;
  damageToChampions: number;
  objectives: number;
}
