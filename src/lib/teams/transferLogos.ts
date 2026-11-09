import { resolveTeamLogo, resolveTeamLogoById, type LogoTeamRef } from "./teamLogos";

function teamLogoFromId(teamId: string): string {
  const slug = teamId.replace(/^lec-/, "");
  if (slug === "shifters") {
    return "/teams-icons/shifters.webp";
  }
  return `/team-logos/${slug}.png`;
}

/**
 * Logo for a club shown in transfer history. The team's own `logo_url`
 * (e.g. a generated badge of a user-created club) wins; id-derived paths are
 * only the fallback for catalog teams.
 */
export function resolveTransferTeamLogo(
  teams: readonly LogoTeamRef[] | null | undefined,
  teamId: string,
  teamName: string,
): string | null {
  return resolveTeamLogoById(teams, teamId, () => {
    const primary = teamLogoFromId(teamId);
    if (primary.startsWith("/team-logos/") || primary.startsWith("http")) {
      return primary;
    }
    return resolveTeamLogo(teamName);
  });
}
