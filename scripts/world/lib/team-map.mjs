// Game team id -> Leaguepedia page title. Built once with --build-team-map, reviewed by a human, then committed.
import fs from "node:fs";
import { resolveTitles } from "./mediawiki-client.mjs";

const BATCH_SIZE = 50;

export function loadTeamMap(file) {
  if (!fs.existsSync(file)) return { schemaVersion: 1, teams: {} };
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Alternative page-title spellings tried for teams whose exact name has no page. */
export function titleVariants(name) {
  const stripped = name.replace(/\s+(e-?sports?|gaming|team)$/i, "").trim();
  const variants = [stripped, `${stripped} Esports`, `${stripped} Gaming`];
  return [...new Set(variants)].filter((v) => v && v !== name);
}

const chunk = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

async function resolveAll(client, titles) {
  const resolved = new Map();
  for (const batch of chunk([...new Set(titles)].filter((t) => t && !t.includes("|")), BATCH_SIZE)) {
    for (const [requested, result] of await resolveTitles(client, batch)) resolved.set(requested, result);
  }
  return resolved;
}

/**
 * Resolve every covered team to a Leaguepedia page (batched, redirects followed) and flag ambiguity.
 * Entries marked `manual: true` in `existing` are kept untouched.
 */
export async function buildTeamMap({ client, world, competitions, existing = { teams: {} } }) {
  const wanted = world.competitions.filter((c) => competitions.includes(c.id));
  const teams = wanted.flatMap((c) => c.teamIds.map((id) => world.teams.get(id)));
  const pending = teams.filter((t) => !existing.teams?.[t.id]?.manual);

  const first = await resolveAll(client, pending.map((t) => t.name));
  const missing = pending.filter((t) => !first.get(t.name)?.isTeam);
  const second = await resolveAll(client, missing.flatMap((t) => titleVariants(t.name)));

  const found = new Map();
  for (const team of pending) {
    const exact = first.get(team.name);
    if (exact?.isTeam) {
      found.set(team.id, { title: exact.title, via: exact.redirected ? "redirect" : "exact" });
      continue;
    }
    const variant = titleVariants(team.name).map((v) => second.get(v)).find((r) => r?.isTeam);
    if (variant) found.set(team.id, { title: variant.title, via: "variant" });
  }

  const usedBy = new Map();
  for (const [teamId, { title }] of found) usedBy.set(title, [...(usedBy.get(title) ?? []), teamId]);

  const out = {};
  for (const team of teams.sort((a, b) => a.competition.localeCompare(b.competition) || a.id.localeCompare(b.id))) {
    const kept = existing.teams?.[team.id];
    if (kept?.manual) {
      out[team.id] = kept;
      continue;
    }
    const base = { title: null, name: team.name, competition: team.competition };
    const hit = found.get(team.id);
    if (!hit) out[team.id] = { ...base, reason: first.get(team.name)?.missing === false ? `"${first.get(team.name).title}" exists but is not a team page` : "no Leaguepedia team page found for this name" };
    else if (usedBy.get(hit.title).length > 1) out[team.id] = { ...base, reason: `ambiguous: "${hit.title}" also resolved for ${usedBy.get(hit.title).filter((id) => id !== team.id).join(", ")}` };
    else out[team.id] = { ...base, title: hit.title, via: hit.via };
  }
  return { schemaVersion: 1, teams: out };
}

export function summarizeTeamMap(teamMap) {
  const byCompetition = {};
  for (const entry of Object.values(teamMap.teams)) {
    const bucket = (byCompetition[entry.competition] ??= { mapped: 0, unmapped: 0 });
    bucket[entry.title ? "mapped" : "unmapped"] += 1;
  }
  return byCompetition;
}
