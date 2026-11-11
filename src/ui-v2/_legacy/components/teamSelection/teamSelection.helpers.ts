import { invoke } from "@tauri-apps/api/core";
import type { LeagueSelectionData, GameStateData } from "@/store/gameStore";
import type { CustomTeamSpec } from "@/store/types";
import { activeCurrencySymbol } from "@/lib/formatting/valueFormatting";

export function formatFinance(val: number): string {
  if (val >= 1_000_000) return `${activeCurrencySymbol()}${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `${activeCurrencySymbol()}${(val / 1_000).toFixed(0)}K`;
  return `${activeCurrencySymbol()}${val}`;
}

export function getReputationLabel(rep: number): { labelKey: string; variant: "default" | "secondary" | "destructive" } {
  if (rep >= 750) return { labelKey: "teamSelect.repWorldClass", variant: "secondary" };
  if (rep >= 600) return { labelKey: "teamSelect.repStrong", variant: "default" };
  if (rep >= 400) return { labelKey: "teamSelect.repAverage", variant: "secondary" };
  return { labelKey: "teamSelect.repDeveloping", variant: "destructive" };
}

export function getTeamLogoPath(teamId: string, logoUrl?: string | null): string {
  if (logoUrl) return logoUrl;
  const slug = teamId.replace(/^[a-z0-9]+-/i, "");
  if (slug === "shifters")
    return "/teams-icons/shifters.webp";
  return `/teams-icons/${slug}.webp`;
}

export async function loadLeagueSelectionData(): Promise<LeagueSelectionData> {
  return invoke<LeagueSelectionData>("get_league_selection_data");
}

/**
 * Confirm the managed club. When `customTeam` is set, `teamId` is the league
 * slot the new club replaces. The key is omitted when absent so existing
 * callers keep sending exactly `{ teamId, lang }`.
 */
export async function selectTeam(
  teamId: string,
  lang?: string,
  customTeam?: CustomTeamSpec,
): Promise<GameStateData> {
  return invoke<GameStateData>("select_team", {
    teamId,
    lang: lang ?? "en",
    ...(customTeam ? { customTeam } : {}),
  });
}

/**
 * Confirm a custom club that joins the league as an extra club and replaces
 * nobody: no `teamId`, the competition travels as `joinsCompetitionId`.
 */
export async function joinLeagueWithCustomTeam(
  competitionId: string,
  lang: string | undefined,
  customTeam: CustomTeamSpec,
): Promise<GameStateData> {
  return invoke<GameStateData>("select_team", {
    lang: lang ?? "en",
    joinsCompetitionId: competitionId,
    customTeam,
  });
}
