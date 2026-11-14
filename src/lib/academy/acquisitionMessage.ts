/**
 * Maps the backend's academy blocked reason and region code to i18n keys.
 * The backend sends stable codes for the tier and region rules and English text
 * for the rest; unknown values fall back to the generic "no options" copy.
 */

export const ACADEMY_BLOCKED_NOT_TOP_LEAGUE = "ACADEMY_PARENT_NOT_TOP_LEAGUE";
export const ACADEMY_BLOCKED_NO_REGION_CANDIDATES = "ACADEMY_NO_REGION_CANDIDATES";

export type AcademyMessage = {
  key: string;
  params?: Record<string, string>;
};

const REGION_KEYS: Record<string, string> = {
  EMEA: "youthAcademy.regions.EMEA",
  KR: "youthAcademy.regions.KR",
  CN: "youthAcademy.regions.CN",
  NA: "youthAcademy.regions.NA",
  BR: "youthAcademy.regions.BR",
  LATAM: "youthAcademy.regions.LATAM",
  APAC: "youthAcademy.regions.APAC",
};

/** i18n key of a region code, or `null` when the code is unknown or absent. */
export function academyRegionKey(region: string | null | undefined): string | null {
  if (!region) return null;
  return REGION_KEYS[region.toUpperCase()] ?? null;
}

/** Message for a blocked acquisition, or `null` when the reason has no mapping. */
export function academyBlockedMessage(
  reason: string | null | undefined,
  regionLabel: string | null,
): AcademyMessage | null {
  switch (reason) {
    case ACADEMY_BLOCKED_NOT_TOP_LEAGUE:
      return { key: "youthAcademy.blocked.notTopLeague" };
    case ACADEMY_BLOCKED_NO_REGION_CANDIDATES:
      return {
        key: "youthAcademy.blocked.noRegionCandidates",
        params: { region: regionLabel ?? "" },
      };
    case "Academy can only be acquired for a main team":
      return { key: "youthAcademy.blocked.notMainTeam" };
    case "Insufficient funds for all eligible academy acquisition options":
      return { key: "youthAcademy.blocked.insufficientFunds" };
    default:
      return null;
  }
}
