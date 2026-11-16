// Builds `nationality` entries for assets/world/catalog-corrections.json from a SAVED Leaguepedia join.
// Pure: it reads nothing and makes no request. The CLI (../nationality-corrections.mjs) supplies the saved rows.
import { compactKey, countryToIso2, nameRelation } from "./text.mjs";

/** Confirmation tiers that clear the bar: the in-game name AND the real name agree with exactly one Leaguepedia row. */
export const CONFIRMED_TIERS = Object.freeze(["A", "A2"]);

const byKey = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.field < b.field ? -1 : a.field > b.field ? 1 : 0);

/** Evidence text for one Leaguepedia Players page. */
export function evidenceUrl(leaguepediaId, queried) {
  const page = encodeURI(String(leaguepediaId).replace(/ /g, "_")).replace(/[?#&]/g, encodeURIComponent);
  return `https://lol.fandom.com/wiki/${page} (Leaguepedia Players, queried ${queried})`;
}

/** Existing entries plus new ones, one per (id, field), sorted by id then field. */
export function mergeCorrections(existing, added) {
  const seen = new Set();
  const merged = [];
  for (const entry of [...existing, ...added]) {
    const key = `${entry.id}\u0000${entry.field}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }
  return merged.sort(byKey);
}

const decode = (text) =>
  String(text ?? "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));

const rowCountry = (row) => row.NationalityPrimary || row.Country || "";
const RANK = { equal: 0, overlap: 1, unknown: 2, conflict: 3 };

/** The Leaguepedia row a join entry came from: same ID (case/space-insensitive), same country, best real-name match. */
function findRow(rows, inGameName, fullName, country) {
  const key = compactKey(inGameName);
  const candidates = rows
    .filter((row) => compactKey(row.ID) === key && rowCountry(row) === country)
    .map((row) => ({ row, rank: RANK[nameRelation(decode(row.Name), fullName)] }))
    .sort((a, b) => a.rank - b.rank || (a.row.ID < b.row.ID ? -1 : a.row.ID > b.row.ID ? 1 : 0));
  return candidates[0]?.row ?? null;
}

/**
 * @param {{
 *   detail: Array<[string, string, string, string, string, number]>,   // [tier, id, in-game name, real name, country, rows with that ID]
 *   rows: Array<{ID: string, Name: string, Country: string, NationalityPrimary?: string}>,
 *   players: Array<{id: string, match_name: string, full_name: string, nationality: string, team_id: string|null, shard: string}>,
 *   existing?: object[], queried: string }} input
 */
export function buildNationalityCorrections({ detail, rows, players, existing = [], queried }) {
  const shipped = new Map(players.map((p) => [p.id, p]));
  const taken = new Set(existing.filter((c) => c.field === "nationality").map((c) => c.id));
  const skipped = [];
  const written = [];
  const perTier = {};
  const done = new Set();

  for (const [tier, id, inGameName, fullName, country] of detail) {
    if (!CONFIRMED_TIERS.includes(tier) || done.has(id)) continue;
    done.add(id);
    const skip = (reason) => skipped.push({ id, name: inGameName, tier, reason });
    const player = shipped.get(id);
    if (!player) skip("id is not in the shipped players");
    else if (player.nationality !== "") skip(`player already has nationality '${player.nationality}'`);
    else if (taken.has(id)) skip("an existing correction already sets this nationality");
    else if (country.includes("|")) skip(`join is ambiguous between countries '${country}'`);
    else {
      const iso = countryToIso2(country);
      const row = findRow(rows, inGameName, fullName, country);
      if (!iso) skip(`no ISO-2 code for country '${country}'`);
      else if (!row) skip(`no Leaguepedia row for '${inGameName}' with country '${country}'`);
      else {
        perTier[tier] = (perTier[tier] ?? 0) + 1;
        written.push({
          id,
          match_name: player.match_name,
          full_name: player.full_name,
          leaguepedia_name: decode(row.Name),
          country,
          iso,
          tier,
          team_id: player.team_id,
          entry: { id, field: "nationality", from: "", to: iso, evidence: evidenceUrl(row.ID, queried) },
        });
      }
    }
  }

  written.sort((a, b) => byKey(a.entry, b.entry));
  const entries = mergeCorrections(existing, written.map((w) => w.entry));
  return { entries, report: { perTier, skipped, written } };
}

/** Markdown table for a human spot-check of what the generator wrote. */
export function reviewListMarkdown({ report }) {
  const cell = (value) => String(value ?? "").replace(/\|/g, "\\|");
  const tiers = Object.entries(report.perTier).map(([tier, count]) => `${tier} ${count}`).join(", ");
  const lines = [
    `${report.written.length} nationality corrections (${tiers}), ${report.skipped.length} skipped.`,
    "",
    "| id | match_name | full_name | Leaguepedia name | country | ISO-2 | tier | team |",
    "|---|---|---|---|---|---|---|---|",
    ...report.written.map(
      (w) => `| ${[w.id, w.match_name, w.full_name, w.leaguepedia_name, w.country, w.iso, w.tier, w.team_id ?? "free agent"].map(cell).join(" | ")} |`,
    ),
  ];
  if (report.skipped.length) {
    lines.push("", "Skipped:", ...report.skipped.map((s) => `- ${s.id} (${s.name}, tier ${s.tier}): ${s.reason}`));
  }
  return `${lines.join("\n")}\n`;
}
