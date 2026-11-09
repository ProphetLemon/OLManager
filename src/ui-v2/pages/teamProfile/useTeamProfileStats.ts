import { useEffect, useState } from "react";

import { getApiClientSync } from "@/api/client";
import type { TeamRecentMatchEntry, TeamStatsOverview } from "@/lib/teamProfile/types";

export const TEAM_PROFILE_RECENT_MATCH_LIMIT = 5;

async function fetchTeamStatsOverview(teamId: string): Promise<TeamStatsOverview | null> {
  return (await getApiClientSync().teams.getStatsOverview({ teamId })) as TeamStatsOverview | null;
}

async function fetchTeamRecentMatches(teamId: string): Promise<TeamRecentMatchEntry[]> {
  const result = await getApiClientSync().teams.getMatchHistory({
    teamId,
    limit: TEAM_PROFILE_RECENT_MATCH_LIMIT,
  });
  return Array.isArray(result) ? (result as TeamRecentMatchEntry[]) : [];
}

interface TeamProfileStatsState {
  teamStatsOverview: TeamStatsOverview | null;
  recentMatches: TeamRecentMatchEntry[];
}

export function useTeamProfileStats(teamId: string): TeamProfileStatsState {
  const [teamStatsOverview, setTeamStatsOverview] = useState<TeamStatsOverview | null>(null);
  const [recentMatches, setRecentMatches] = useState<TeamRecentMatchEntry[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      const [overviewResult, historyResult] = await Promise.allSettled([
        fetchTeamStatsOverview(teamId),
        fetchTeamRecentMatches(teamId),
      ]);
      if (cancelled) return;

      setTeamStatsOverview(overviewResult.status === "fulfilled" ? overviewResult.value : null);
      setRecentMatches(historyResult.status === "fulfilled" ? historyResult.value : []);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [teamId]);

  return { teamStatsOverview, recentMatches };
}
