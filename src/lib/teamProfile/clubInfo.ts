import type { TeamData } from "@/store/gameStore";

import type { TeamProfileViewModel } from "@/lib/teamProfile/types";

type TeamAcademyMetadata = {
  branding?: { current_logo_url?: string | null };
  acquisition?: { original_logo_url?: string | null };
  source_identity?: { original_logo_url?: string | null };
  current_logo_url?: string | null;
  original_logo_url?: string | null;
  erl_assignment?: { erl_league_id?: string };
};

/** Display name of the ERL an academy team plays in, or null for non-academy teams. */
export function resolveErlLeagueName(team: TeamData): string | null {
  if (team.team_kind !== "Academy") return null;

  const erlLeagueId = (team.academy as TeamAcademyMetadata | null | undefined)
    ?.erl_assignment?.erl_league_id;
  if (!erlLeagueId) return null;

  const normalized = erlLeagueId.toLowerCase();
  if (normalized === "liga-espanola" || normalized === "les") return "LES";
  if (normalized === "lfl") return "LFL";
  if (normalized === "prime-league" || normalized === "primeleague" || normalized === "prm") {
    return "Prime League";
  }

  return null;
}

/** Win rate over decided games as a whole-number percentage string. */
export function formatWinRate(won: number, lost: number): string {
  const decisiveGames = won + lost;
  return decisiveGames > 0 ? `${Math.round((won / decisiveGames) * 100)}%` : "0%";
}

export function formatLeaguePosition(viewModel: Pick<TeamProfileViewModel, "leaguePos">): string {
  return viewModel.leaguePos > 0 ? `#${viewModel.leaguePos}` : "—";
}

export function defaultTeamLogoSrc(teamId: string): string {
  const slug = teamId.replace(/^lec-/, "");
  return `/teams-icons/${slug}.webp`;
}
