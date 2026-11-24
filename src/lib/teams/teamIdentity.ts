import type { TeamData } from "../../store/gameStore";
import { resolveTeamLogo } from "./teamLogos";

/** How a team is drawn next to a rival or a score: its name, its tag and its real logo (null when none resolves). */
export interface TeamIdentity {
  name: string;
  tag: string;
  logoUrl: string | null;
}

/** The logo follows `lib/home/scoreboard.ts`: by short name first, then by name. */
export function teamIdentity(team: Pick<TeamData, "name" | "short_name" | "logo_url">): TeamIdentity {
  return {
    name: team.name,
    tag: team.short_name || team.name,
    logoUrl: resolveTeamLogo(team.short_name ?? team.name, team.logo_url) ?? resolveTeamLogo(team.name, team.logo_url),
  };
}

export function teamIdentityById(teams: readonly TeamData[], id: string | null | undefined): TeamIdentity | null {
  const team = id ? teams.find((candidate) => candidate.id === id) : undefined;
  return team ? teamIdentity(team) : null;
}
