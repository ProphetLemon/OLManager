import { assetUrl } from "../assetUrl";

/**
 * Resolve a team's logo path.
 *
 * Priority:
 * 1. Explicit `logoUrl` from backend (e.g. `/teams-icons/fur2025.webp`)
 * 2. Derived from `teamName`: slugify and look for `/teams-icons/{slug}.webp`.
 *
 * No hardcoded maps — works for any team. The backend is responsible for
 * providing a matching file under public/teams-icons/.
 */
export function resolveTeamLogo(teamName?: string | null, logoUrl?: string | null): string | null {
  if (logoUrl) return assetUrl(logoUrl);
  if (!teamName) return null;
  const slug = teamName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
  return slug ? assetUrl(`/teams-icons/${slug}.webp`) : null;
}

/** Minimal team shape needed to look up a logo by id. */
export interface LogoTeamRef {
  id: string;
  logo_url?: string | null;
}

/**
 * Resolve a team's logo by id, preferring the team's own `logo_url`
 * (including generated `data:` badges of user-created clubs) over any
 * id-derived path.
 *
 * `idFallback` is only used when the team is unknown or has no `logo_url`,
 * so legacy id-derived paths keep working for catalog teams.
 */
export function resolveTeamLogoById(
  teams: readonly LogoTeamRef[] | null | undefined,
  teamId: string | null | undefined,
  idFallback: () => string | null,
): string | null {
  if (!teamId) return null;
  const own = teams?.find((team) => team.id === teamId)?.logo_url;
  return own ? assetUrl(own) : idFallback();
}
