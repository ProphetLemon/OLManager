import { resolveTeamLogoById, type LogoTeamRef } from "@/lib/teams/teamLogos";

function idDerivedLogo(teamId: string): string {
  const slug = teamId.replace(/^lec-/, "");
  if (slug === "shifters") {
    return "/teams-icons/shifters.webp";
  }
  return `/teams-icons/${slug}.webp`;
}

/** Scrim opponent logo: the team's own `logo_url` first, id-derived path as fallback. */
export function scrimOpponentLogo(
  teams: readonly LogoTeamRef[] | null | undefined,
  teamId: string,
): string {
  return resolveTeamLogoById(teams, teamId, () => idDerivedLogo(teamId)) ?? idDerivedLogo(teamId);
}
