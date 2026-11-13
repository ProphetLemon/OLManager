import { getApiClientSync } from "../api/client";
import type {
  AcademyAcquisitionOptionData,
  AcademyAcquisitionOptionsResponseData,
  AcquireAcademyTeamRequestData,
  GameStateData,
} from "../store/gameStore";

type BackendAcademyAcquisitionOption = {
  source_team_id: string;
  name: string;
  short_name: string;
  logo_url?: string | null;
  erl_league_id: string;
  erl_league_name: string;
  country_code: string;
  assignment_rule: "Domestic" | "Fallback";
  fallback_reason?: string | null;
  reputation: number;
  development_level: number;
  acquisition_cost: number;
};

type BackendAcademyAcquisitionOptionsResponse = {
  parent_team_id: string;
  acquisition_allowed: boolean;
  blocked_reason?: string | null;
  options?: BackendAcademyAcquisitionOption[];
};

function normalizeAcademyOption(
  option: BackendAcademyAcquisitionOption,
): AcademyAcquisitionOptionData {
  return {
    source_team_id: option.source_team_id,
    source_team_name: option.name,
    source_team_short_name: option.short_name,
    source_team_logo_url: option.logo_url ?? null,
    erl_league_id: option.erl_league_id,
    league_name: option.erl_league_name,
    country: option.country_code,
    region: "EMEA",
    assignment_rule: option.assignment_rule,
    fallback_reason: option.fallback_reason ?? null,
    reputation: option.reputation,
    development_level: option.development_level,
    acquisition_cost: option.acquisition_cost,
    rebrand_allowed: true,
    source_identity: {
      source_team_id: option.source_team_id,
      original_name: option.name,
      original_short_name: option.short_name,
      original_logo_url: option.logo_url ?? null,
    },
  };
}

function normalizeAcademyAcquisitionOptionsResponse(
  response: BackendAcademyAcquisitionOptionsResponse,
): AcademyAcquisitionOptionsResponseData {
  return {
    parent_team_id: response.parent_team_id,
    acquisition_allowed: Boolean(response.acquisition_allowed),
    blocked_reason: response.blocked_reason ?? null,
    options: Array.isArray(response.options)
      ? response.options.map(normalizeAcademyOption)
      : [],
  };
}

export async function getAcademyAcquisitionOptions(
  parentTeamId: string,
): Promise<AcademyAcquisitionOptionsResponseData> {
  const response = await getApiClientSync().academy.getAcquisitionOptions({ parentTeamId });
  return normalizeAcademyAcquisitionOptionsResponse(response as BackendAcademyAcquisitionOptionsResponse);
}

export async function acquireAcademyTeam(
  request: AcquireAcademyTeamRequestData,
): Promise<GameStateData> {
  return getApiClientSync().academy.acquire({
    request: {
      parentTeamId: request.parent_team_id,
      sourceTeamId: request.source_team_id,
      customName: request.custom_name ?? undefined,
      customShortName: request.custom_short_name ?? undefined,
      customLogoUrl: request.custom_logo_url ?? undefined,
    },
  });
}

export async function promoteAcademyPlayer(playerId: string): Promise<GameStateData> {
  return getApiClientSync().academy.promotePlayer({ playerId });
}

export async function demoteMainPlayerToAcademy(playerId: string): Promise<GameStateData> {
  return getApiClientSync().academy.demotePlayer({ playerId });
}
