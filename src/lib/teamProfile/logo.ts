import { resolveTeamLogo } from "@/lib/teams/teamLogos";
import type { TeamData } from "@/store/gameStore";

import { defaultTeamLogoSrc } from "@/lib/teamProfile/clubInfo";

type AcademyLogoMetadata = {
  branding?: { current_logo_url?: string | null };
  acquisition?: { original_logo_url?: string | null };
  source_identity?: { original_logo_url?: string | null };
  current_logo_url?: string | null;
  original_logo_url?: string | null;
};

function academyLogoFromMetadata(team: TeamData): string | null {
  const academy = team.academy as AcademyLogoMetadata | null | undefined;

  return (
    academy?.branding?.current_logo_url ??
    academy?.acquisition?.original_logo_url ??
    academy?.source_identity?.original_logo_url ??
    academy?.current_logo_url ??
    academy?.original_logo_url ??
    null
  );
}

/** Best logo source for a team: backend url, academy metadata, known academy list, then the slug default. */
export function resolveTeamProfileLogo(team: TeamData): string {
  if (team.logo_url) return team.logo_url;

  const academyLogo = academyLogoFromMetadata(team);
  if (academyLogo) return academyLogo;

  if (team.team_kind === "Academy") {
    const exampleLogo = resolveTeamLogo(team.name);
    if (exampleLogo) return exampleLogo;
  }

  return defaultTeamLogoSrc(team.id);
}
