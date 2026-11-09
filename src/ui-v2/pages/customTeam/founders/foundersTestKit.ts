import type {
  FounderIdentityOverride,
  FounderOverrides,
  FounderRole,
  FounderSummary,
  FoundingSquadSummary,
} from "@/lib/customTeam/founders";

/** Test double for the founding squad commands; not imported by production code. */

const ROLES: FounderRole[] = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"];
const KEYS = ["top", "jungle", "mid", "adc", "support"] as const;

export const ALLOWED_NATIONALITIES = ["ES", "FR", "PT"];

/** Nicks the fake backend reports as taken. */
export const TAKEN_NICK = "Taken";

function generatedFounder(role: FounderRole, index: number, seed: number): FounderSummary {
  return {
    id: `gen-ray-${role.toLowerCase()}-1`,
    role,
    nick: `Gen${role[0]}${index}s${seed % 1000}`,
    full_name: `Player ${role.toLowerCase()} ${seed % 1000}`,
    nationality: "ES",
    date_of_birth: "2004-06-15",
    age: 20,
    birth_date_min: "2004-01-01",
    birth_date_max: "2004-12-31",
    ovr: 60 + index,
    attributes: {
      mechanics: 60,
      laning: 61,
      teamfighting: 62,
      macro_play: 63,
      consistency: 64,
      shotcalling: 65,
      champion_pool: 66,
      discipline: 67,
      mental_resilience: 68,
    },
    wage: 120000 + index * 1000,
    contract_end: "2028-06-30",
    market_value: 500000,
  };
}

export function squadFor(seed: number, overrides: FounderOverrides = {}): FoundingSquadSummary {
  const players = ROLES.map((role, index) => {
    const base = generatedFounder(role, index, seed);
    const edit: FounderIdentityOverride | undefined = overrides[KEYS[index]];
    return {
      ...base,
      nick: edit?.nick ?? base.nick,
      full_name: edit?.full_name ?? base.full_name,
      nationality: edit?.nationality ?? base.nationality,
      date_of_birth: edit?.birth_date ?? base.date_of_birth,
    };
  });
  return {
    players,
    wage_budget: 900000,
    bill: players.reduce((sum, player) => sum + player.wage, 0),
    allowed_nationalities: ALLOWED_NATIONALITIES,
  };
}

export interface PreviewCall {
  competitionId: string;
  /** Absent when the club joins the league. */
  replacedTeamId?: string;
  shortName: string;
  seed: number;
  founderOverrides: FounderOverrides | null;
}

/** Fake `invoke`: previews squads, rejecting a taken nick like the backend does. */
export function previewInvoke(calls: PreviewCall[] = []) {
  return async (command: string, args?: unknown): Promise<unknown> => {
    if (command !== "preview_founding_squad") return undefined;
    const call = args as PreviewCall;
    calls.push(call);
    for (const [index, key] of KEYS.entries()) {
      if (call.founderOverrides?.[key]?.nick === TAKEN_NICK) {
        throw JSON.stringify({
          kind: "invalid_field",
          role: ROLES[index],
          field: "nick",
          reason: "taken",
        });
      }
    }
    return squadFor(call.seed, call.founderOverrides ?? {});
  };
}
