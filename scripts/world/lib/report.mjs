// Markdown review report: everything a maintainer must read before committing an overlay.
const md = (text) => String(text ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

function opLine(entry) {
  return `- \`${entry.op.op}\` ${md(entry.note)} - [evidence](${entry.op.evidence})`;
}

export function renderReport({ asOf, license, selected, world, teamRows, unmapped, unreadable, ops, gates, issues, clientStats, warnings }) {
  const lines = [];
  lines.push(`# Roster refresh review (as of ${asOf})`, "");
  lines.push(`- Source: Leaguepedia, license: ${md(license.text)} ${license.url}`);
  lines.push(`- Competitions: ${selected.join(", ")}`);
  lines.push(`- Requests: ${clientStats.network} live, ${clientStats.cacheHits} cached, ${clientStats.retries} retries`);
  lines.push(`- Operations: ${ops.players.length} player, ${ops.staff.length} staff`, "");

  lines.push("## Gates", "", "| Gate | Scope | Result | Detail |", "| --- | --- | --- | --- |");
  for (const g of gates.results) lines.push(`| ${g.name} | ${g.scope} | ${g.ok ? "pass" : "FAIL"} | ${md(g.detail)} |`);
  lines.push("");

  for (const competition of selected) {
    const rows = teamRows.filter((r) => r.competition === competition);
    const prefix = (entry) => entry.competition === competition;
    lines.push(`## ${competition}`, "");
    lines.push("| Game team | Leaguepedia page | LP players | Matched | New | Ambiguous | Refused | Review | State |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const r of rows) lines.push(`| ${md(r.name)} | ${md(r.title ?? "-")} | ${r.lpPlayers} | ${r.matched} | ${r.added} | ${r.ambiguous} | ${r.refused} | ${r.review} | ${md(r.state)} |`);
    lines.push("");
    const playerOps = ops.players.filter(prefix);
    const staffOps = ops.staff.filter(prefix);
    lines.push(`### Player operations (${playerOps.length})`, "", ...(playerOps.length ? playerOps.map(opLine) : ["_none_"]), "");
    lines.push(`### Staff operations (${staffOps.length})`, "", ...(staffOps.length ? staffOps.map(opLine) : ["_none_"]), "");
  }

  const isReview = (i) => i.kind === "needs-review" || i.kind === "staff-review";
  lines.push("## Needs review", "", "Name-only and IGN-only matches. They produce no operation until `scripts/world/id-map.json` pins them or both sides know the same date of birth.", "");
  const review = issues.filter(isReview);
  lines.push(...(review.length ? review.map((i) => `- ${md(i.subject)}${i.team ? ` @ ${md(i.team)}` : ""}: ${md(i.detail)}`) : ["_none_"]), "");

  lines.push("## Skipped and ambiguous", "");
  const rest = [...issues.filter((i) => i.level !== "info" && !isReview(i)), ...ops.skipped];
  lines.push(...(rest.length ? rest.map((i) => `- **${i.kind}** ${md(i.subject)}${i.team ? ` @ ${md(i.team)}` : ""}: ${md(i.detail)}`) : ["_none_"]), "");

  const notes = issues.filter((i) => i.level === "info");
  lines.push("## Staff role policy notes", "", `Role changes the staff policy refused (${notes.length}); roles never change into or away from Assistant.`, "");
  lines.push(...notes.map((i) => `- ${md(i.subject)}: ${md(i.detail)}`), "");

  lines.push("## Team mapping", "");
  lines.push(`- Unmapped teams (skipped, never guessed): ${unmapped.length}`);
  for (const t of unmapped) lines.push(`  - ${md(t.name)} (${t.id}): ${md(t.reason)}`);
  lines.push(`- Unreadable pages: ${unreadable.length}`);
  for (const t of unreadable) lines.push(`  - ${md(t.title)}: ${md(t.reason)}`);
  lines.push("");

  lines.push("## Duplicates in the bundled world", "");
  lines.push(`- Player ids present in several shards (the game keeps both records): ${world.duplicates.players.length}`);
  for (const d of world.duplicates.players) lines.push(`  - ${d.id}: ${d.shards.join(", ")}`);
  lines.push(`- Staff ids present in several shards: ${world.duplicates.staff.length}`, "");

  if (warnings.length) lines.push("## Warnings", "", ...warnings.map((w) => `- ${md(w)}`), "");
  return `${lines.join("\n")}\n`;
}
