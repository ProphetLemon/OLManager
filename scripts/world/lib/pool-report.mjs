// The "Active-pros pool" section of the review report: what the pool adds, what it left out and why.
import { evenSample } from "./pool-scope.mjs";
import { PLACEHOLDER_RATING, compare } from "./pool.mjs";

const md = (text) => String(text ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
const sorted = (map) => [...map].sort((a, b) => b[1] - a[1] || compare(String(a[0]), String(b[0])));
const table = (rows, head) => [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${row.map(md).join(" | ")} |`)];
const countTable = (map, label) => table(sorted(map), [label, "people"]);

/** Most lines one refusal reason lists before saying how many more there are. */
export const REFUSED_LINES_PER_REASON = 40;
export const SAMPLE_PLAYERS_PER_REGION = 5;
export const SAMPLE_STAFF_PER_REGION = 2;

/**
 * Why a named person is or is not in the pool.
 * @returns {{page: string, included: boolean, id: string|null, verdict: string, entries: object[]}}
 */
export function explainProbe({ probe, tournaments, classes, entryCount, cap, since, selection }) {
  const status = selection.statuses.get(probe.page);
  const byPage = new Map(tournaments.map((t) => [t.page, t]));
  const entries = (probe.entries ?? []).map((entry) => {
    const t = byPage.get(entry.page);
    if (!t) return { page: entry.page, role: entry.role, outsideWindow: true, verdict: `outside the window (started before ${since})` };
    const recommended = Boolean(classes.get(t.page)?.recommended);
    const entriesInTournament = entryCount.get(t.page) ?? 0;
    const capped = recommended && t.qualifier && entriesInTournament > cap;
    return {
      page: t.page, name: t.name, league: t.league, level: t.level, qualifier: t.qualifier, role: entry.role, rosterEntries: entriesInTournament, recommended, capped,
      verdict: !recommended ? "not in the recommended filter" : capped ? `open qualifier: ${entriesInTournament} roster entries, over the cap of ${cap}` : "counts",
    };
  });
  const counting = entries.filter((e) => e.verdict === "counts");
  let verdict;
  if (status?.state === "added") verdict = `included as ${status.id}`;
  else if (status) verdict = `left out: ${status.reason}`;
  else if (probe.entries === null) verdict = "unknown: his roster entries could not be read";
  else if (entries.length === 0) verdict = "left out: Leaguepedia has no tournament roster entry for this page";
  else if (counting.length === 0) verdict = "left out: none of his tournaments counts (outside the window, outside the recommended filter, or an open qualifier over the cap)";
  else verdict = "left out: he has counting tournaments, but the people query did not return him (retired, or no Players page)";
  return { page: probe.page, included: status?.state === "added", id: status?.state === "added" ? status.id : null, verdict, entries };
}

/** Counts of the added people, from the `pool` metadata every op carries. */
export function summarizePool(selection) {
  const players = selection.players.map((e) => e.person);
  const staff = selection.staff.map((e) => e.person);
  const tally = (list, pick) => {
    const map = new Map();
    for (const person of list) bump(map, pick(person) || "(none)");
    return map;
  };
  return {
    players: players.length,
    staff: staff.length,
    playersByRole: tally(players, (p) => p.position),
    playersByRegion: tally(players, (p) => p.region),
    playersByLevel: tally(players, (p) => p.bestLevel),
    playersByTier: tally(players, (p) => `tier ${p.tier}`),
    staffByKind: tally(selection.staff, (e) => `${e.role} (${e.person.staffLabel})`),
    staffByRegion: tally(staff, (p) => p.region),
    staffByLevel: tally(staff, (p) => p.bestLevel),
  };
}

/**
 * @param {object} pool
 * @param {{since: string, cap: number}} pool.settings
 * @param {object} pool.inputs result of fetchPoolInputs (or an equivalent)
 * @param {ReturnType<import("./pool.mjs").selectPool>} pool.selection
 * @param {{players: number, staff: number, overlayBytes: number}} pool.limits
 * @param {number} pool.bytes size of the serialised overlay
 * @param {ReturnType<typeof explainProbe>|null} pool.probe
 */
export function renderPoolSection({ settings, inputs, selection, limits, bytes, probe }) {
  const lines = ["## Active-pros pool", ""];
  const { counts } = selection;
  const summary = summarizePool(selection);
  lines.push(`- Scope: \`recommended\` tournament filter, tournaments starting on or after ${settings.since}, people with a Leaguepedia Players page who are not retired, qualifier-flagged tournaments only up to ${settings.cap} roster entries.`);
  lines.push(`- Result: ${summary.players} players and ${summary.staff} staff added as teamless free agents (limits ${limits.players} and ${limits.staff}); overlay ${bytes} bytes (the app rejects more than ${limits.overlayBytes}).`);
  lines.push(`- Ratings are a placeholder (\`pool.rating: "${PLACEHOLDER_RATING}"\`): the game's median per position shifted by tier (1 top flight, 2 official circuit, 3 recurring seasonal league). A4 replaces them from stats.`);
  lines.push(`- Wage, market value and contract are the roster refresh's empty values (0, 0, ""); the game decides them when it accepts teamless adds (A5).`);
  lines.push(`- Games per player: ${inputs.games ? "from scoreboard rows in the window" : "unavailable (null)"}. Tournament lists are summarised as counts, leagues and levels.`, "");

  lines.push("### Funnel", "");
  lines.push(...table([
    ["people with a roster entry in the filter", counts.considered],
    ["no Players page", counts.noPage],
    ["already in the game (matcher and id-map.json)", counts.inGame],
    ["on a team the game has (roster overlay handles them)", counts.onGameTeam],
    ["added or moved by this run's roster overlay", counts.handledByRoster],
    ["ambiguous with a game record", counts.uncertain],
    ["staff label that is not a game role", counts.nonSportingStaff],
    ["no usable position", counts.noPosition],
    ["ambiguous inside the pool", counts.duplicates],
    ["id collision", counts.collisions],
    ["added", summary.players + summary.staff],
  ], ["step", "people"]), "");

  lines.push("### By role, region, level and staff kind", "");
  lines.push("Players by position (Leaguepedia label; Bot is the game's ADC)", "", ...countTable(summary.playersByRole, "position"), "");
  lines.push("Players by region", "", ...countTable(summary.playersByRegion, "region"), "");
  lines.push("Players by best tournament level", "", ...countTable(summary.playersByLevel, "level"), "");
  lines.push("Players by tier", "", ...countTable(summary.playersByTier, "tier"), "");
  lines.push("Staff by game role (Leaguepedia label)", "", ...countTable(summary.staffByKind, "kind"), "");
  lines.push("Staff by region", "", ...countTable(summary.staffByRegion, "region"), "");
  lines.push("Staff by best tournament level", "", ...countTable(summary.staffByLevel, "level"), "");

  const view = inputs.view;
  lines.push("### Qualifier cap", "");
  lines.push(`Qualifier-flagged tournaments of the filter with at most ${settings.cap} roster entries count (promotions, closed stages); the rest are open qualifiers and are left out.`, "");
  lines.push(`- kept: ${view.kept.length} tournaments, ${view.keptEntries} roster entries`);
  lines.push(`- left out: ${view.capped.length} tournaments, ${view.cappedEntries} roster entries (an upper bound on the people lost, since people repeat across tournaments)`, "");
  lines.push(...table([...view.kept].sort((a, b) => b.entries - a.entries || compare(a.name, b.name)).slice(0, 15).map((t) => ["kept", t.name, t.league, t.entries]), ["", "tournament", "league", "roster entries"]), "");
  lines.push(...table([...view.capped].sort((a, b) => b.entries - a.entries || compare(a.name, b.name)).slice(0, 15).map((t) => ["left out", t.name, t.league, t.entries]), ["", "tournament", "league", "roster entries"]), "");

  lines.push("### Sample per region", "");
  const regions = [...new Set([...summary.playersByRegion.keys(), ...summary.staffByRegion.keys()])].sort(compare);
  for (const region of regions) {
    const players = evenSample(selection.players.filter((e) => e.person.region === region), SAMPLE_PLAYERS_PER_REGION);
    const staff = evenSample(selection.staff.filter((e) => e.person.region === region), SAMPLE_STAFF_PER_REGION);
    lines.push(`**${md(region)}**`, "");
    for (const e of players) lines.push(`- player ${md(e.person.profile.ign)} (${md(e.page)}): ${e.role}, tier ${e.person.tier}, ${md(e.person.profile.country || "no country")}, ${e.person.entries} roster entries, last ${md(e.person.lastStart)}`);
    for (const e of staff) lines.push(`- staff ${md(e.person.profile.ign)} (${md(e.page)}): ${e.role} (${md(e.person.staffLabel)}), tier ${e.person.tier}, ${md(e.person.profile.country || "no country")}, ${e.person.entries} roster entries`);
    lines.push("");
  }

  if (probe) {
    lines.push(`### Probe: ${md(probe.page)}`, "", `- ${probe.included ? "included" : "not included"}: ${md(probe.verdict)}`);
    const outside = probe.entries.filter((e) => e.outsideWindow);
    if (outside.length) lines.push(`  - ${outside.length} roster entries are in tournaments that started before ${settings.since}; they do not count`);
    for (const e of probe.entries.filter((x) => !x.outsideWindow)) {
      lines.push(`  - ${md(e.name ?? e.page)}${e.league ? ` (${md(e.league)}; level ${md(e.level || "-")}${e.qualifier ? "; qualifier-flagged" : ""}; ${e.rosterEntries} roster entries; role ${md(e.role)})` : ""}: ${md(e.verdict)}`);
    }
    lines.push("");
  }

  lines.push("### Refused and ambiguous", "", "People the pool left out because a human has to decide or the data is not enough. Nothing here is added.", "");
  const byReason = new Map();
  for (const item of selection.refused) {
    if (!byReason.has(item.code)) byReason.set(item.code, []);
    byReason.get(item.code).push(item);
  }
  if (byReason.size === 0) lines.push("_none_", "");
  for (const [code, items] of [...byReason].sort(([a], [b]) => compare(a, b))) {
    lines.push(`**${code}** (${items.length})`, "");
    for (const item of items.slice(0, REFUSED_LINES_PER_REASON)) lines.push(`- ${item.kind} ${md(item.page)}: ${md(item.reason)}`);
    if (items.length > REFUSED_LINES_PER_REASON) lines.push(`- ... and ${items.length - REFUSED_LINES_PER_REASON} more`);
    lines.push("");
  }
  return lines;
}
