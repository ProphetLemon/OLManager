/** Pure view model for a Squad player card. */
import type { PlayerData } from "@/store/types";
import { getContractRiskLevel } from "@/lib/common/contractUtils";
import type { LolRole } from "@/lib/home/scoreboard";
import { resolvePlayerLolRole } from "@/lib/players/lolIdentity";
import { calculateLolOvr } from "@/lib/players/lolPlayerStats";
import { resolvePlayerPhoto } from "@/lib/players/playerPhotos";
import { countryName } from "@/lib/common/countries";
import { activeCurrencySymbol, calcAge, formatVal } from "@/lib/formatting/valueFormatting";

export interface PlayerCardModel {
  id: string;
  name: string;
  role: LolRole;
  ovr: number;
  age: number | null;
  wage: number;
  /** Full precision with currency symbol, e.g. "€354,000". */
  wageLabel: string;
  /** Compact yearly wage for tight spots, e.g. "€354K". */
  wageCompact: string;
  energy: number;
  morale: number;
  /** Null when the save carries no fitness value; never invented. */
  fitness: number | null;
  contractEnd: string | null;
  /** Contract end as a readable date in the UI locale, e.g. "30 Nov 2028". */
  contractEndLabel: string | null;
  contractRisk: "critical" | "warning" | "ok" | null;
  isImport: boolean;
  nationalityCode: string | null;
  /** Localised country name, or null when the save has no nationality. */
  nationalityName: string | null;
  photo: string | null;
  transferListed: boolean;
}

/** Formats an ISO date (or datetime) as a short UTC calendar date; falls back to the raw day. */
function formatContractEnd(iso: string, locale: string): string {
  const day = iso.slice(0, 10);
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function shortRoleKey(role: LolRole): string {
  return `onAir.roles.${role}`;
}

export function getPlayerCardModel(
  player: PlayerData,
  ctx: { currentDate: string; locale: string; userNationality?: string },
): PlayerCardModel {
  const asOf = ctx.currentDate.slice(0, 10);
  const contractEnd = player.contract_end ?? null;
  const risk = contractEnd ? getContractRiskLevel(contractEnd, asOf) : null;
  const age = player.date_of_birth ? calcAge(player.date_of_birth, asOf) : 0;

  const nationality = player.nationality_code ?? player.nationality ?? null;

  return {
    id: player.id,
    name: player.match_name,
    role: resolvePlayerLolRole(player),
    ovr: calculateLolOvr(player),
    // calcAge returns 0 for unparseable dates.
    age: age > 0 ? age : null,
    wage: player.wage,
    wageLabel: `${activeCurrencySymbol()}${player.wage.toLocaleString(ctx.locale)}`,
    wageCompact: formatVal(player.wage),
    energy: player.condition,
    morale: player.morale,
    fitness: player.fitness ?? null,
    contractEnd,
    contractEndLabel: contractEnd ? formatContractEnd(contractEnd, ctx.locale) : null,
    contractRisk: risk === null ? null : risk === "stable" ? "ok" : risk,
    isImport: player.is_import === true,
    nationalityCode: player.nationality_code ?? null,
    nationalityName: nationality ? countryName(nationality, ctx.locale) : null,
    photo: resolvePlayerPhoto(player.id, player.match_name, player.profile_image_url),
    transferListed: player.transfer_listed === true,
  };
}
