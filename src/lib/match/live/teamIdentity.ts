/**
 * Short code and name of a team for the score bar and the end panel. Pure: the screen passes the
 * teams it knows and gets a tag back. The tag comes from the game's own team list when the name is
 * there, then from the well-known tags of the league, and last from the name itself.
 */

export interface TeamIdentity {
  /** Short code, "EMB". */
  tag: string;
  name: string;
}

export interface KnownTeam {
  name: string;
  short_name: string;
}

/** Tags of the league's clubs, for names that are not in the game's team list. */
const KNOWN_TAGS: Readonly<Record<string, string>> = {
  g2esports: "G2",
  fnatic: "FNC",
  teamvitality: "VIT",
  teamheretics: "HRTS",
  skgaming: "SK",
  movistarkoi: "MKOI",
  mkoi: "MKOI",
  koi: "MKOI",
  madlionskoi: "MKOI",
  teambds: "SHFT",
  shifters: "SHFT",
  giantx: "GX",
  natusvincere: "NAVI",
  karminecorp: "KC",
};

const normalizeKey = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/** "Embers Esports" gives "EEMB"-style codes from the first two words; one word gives its first four letters. */
export function tagFromName(name: string): string {
  const parts = name
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length >= 2) return `${parts[0].slice(0, 1)}${parts[1].slice(0, 3)}`.toUpperCase();
  return (parts[0] ?? name).slice(0, 4).toUpperCase();
}

export function teamIdentity(name: string, teams?: readonly KnownTeam[] | null): TeamIdentity {
  const key = normalizeKey(name);
  const listed = teams?.find((team) => normalizeKey(team.name) === key);
  const listedTag = listed?.short_name?.trim();
  if (listedTag) return { tag: listedTag, name };
  return { tag: KNOWN_TAGS[key] ?? tagFromName(name), name };
}
