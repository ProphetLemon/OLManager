// Builds the overlay JSON from computed ops.
import { OVERLAY_SCHEMA_VERSION } from "./overlay-schema.mjs";

export const SOURCE_NAME = "Leaguepedia";
export const SOURCE_URL = "https://lol.fandom.com";

/** Stand-in licence when siteinfo is unavailable; the `licence-available` gate refuses to ship it. */
export const OFFLINE_LICENSE = Object.freeze({
  text: "unavailable (offline run without cached siteinfo)",
  url: "https://lol.fandom.com/wiki/Leaguepedia:Copyrights",
});

export function buildAttribution(license) {
  return (
    `Roster data comes from Leaguepedia (${SOURCE_URL}) contributors and is used under ${license.text || "the wiki's license"}` +
    `${license.url ? ` (${license.url})` : ""}. Each operation cites the page it was read from ` +
    `(${SOURCE_URL}/wiki/<Page_Title>); page histories list the contributors.`
  );
}

/**
 * @param {{asOf: string, license: {text: string, url: string}, coverage: string[], players: object[], staff: object[]}} input
 */
export function buildOverlay({ asOf, license, coverage, players, staff }) {
  return {
    schemaVersion: OVERLAY_SCHEMA_VERSION,
    as_of: asOf,
    source: {
      name: SOURCE_NAME,
      url: SOURCE_URL,
      license: license.text,
      license_url: license.url,
      attribution: buildAttribution(license),
    },
    coverage: [...coverage].sort(),
    players: players.map((entry) => entry.op),
    staff: staff.map((entry) => entry.op),
  };
}

export const todayUtc = () => new Date().toISOString().slice(0, 10);

/** Stable serialisation: 2-space JSON with a trailing newline. */
export function serializeOverlay(overlay) {
  return `${JSON.stringify(overlay, null, 2)}\n`;
}
