// Matches Leaguepedia people to game ids by page/IGN + real name + nationality, with a reviewed override file.
import { compactKey, countryToIso2, nameRelation, nameTokens } from "./text.mjs";
import { STALE_DUPLICATE_COMPETITIONS } from "./world.mjs";

/**
 * @typedef {{players?: Array<{page:string,id:string,note?:string}>, staff?: Array<{page:string,id:string,note?:string}>,
 *   rejections?: Array<{page:string,id:string,kind?:"player"|"staff",reason?:string}>}} IdMap
 */

export const EMPTY_ID_MAP = Object.freeze({ players: [], staff: [], rejections: [] });

const nameKeys = (value) => {
  const { words, parts } = nameTokens(value);
  return [[...words].sort().join(""), [...parts].sort().join("")].filter(Boolean);
};

/** Adapt a world player/staff record to the neutral shape the matcher works on. */
export const playerEntity = (p) => ({
  id: p.id,
  ign: p.match_name,
  name: p.full_name,
  nat: countryToIso2(p.nationality),
  stale: Boolean(p.competition && p.competition in STALE_DUPLICATE_COMPETITIONS),
  ref: p,
});
export const staffEntity = (s) => {
  const words = [...new Set(`${s.first_name} ${s.last_name}`.split(/\s+/).filter(Boolean))];
  return { id: s.id, ign: s.nickname, name: words.join(" "), nat: countryToIso2(s.nationality), stale: false, ref: s };
};

export function buildIndex(entities) {
  const byIgn = new Map();
  const byName = new Map();
  const push = (map, key, entity) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(entity);
  };
  for (const entity of entities) {
    push(byIgn, compactKey(entity.ign), entity);
    if (entity.name) for (const key of nameKeys(entity.name)) push(byName, key, entity);
  }
  return { byIgn, byName, byId: new Map(entities.map((e) => [e.id, e])) };
}

function classify(person, entity) {
  const lpIgns = new Set([compactKey(person.ign), compactKey(String(person.page ?? "").replace(/\s*\(.*\)$/, ""))].filter(Boolean));
  const ignEqual = lpIgns.has(compactKey(entity.ign));
  // Some records carry the IGN as "full name": that says nothing about the real name.
  const placeholderName = compactKey(entity.name) === compactKey(entity.ign);
  const relation = placeholderName ? "unknown" : nameRelation(entity.name, person.realName);
  const lpNat = countryToIso2(person.country);
  const natConflict = Boolean(entity.nat && lpNat && entity.nat !== lpNat);
  if (ignEqual && (relation === "equal" || relation === "overlap")) return { tier: "strong", confidence: "ign+name", rank: relation === "equal" ? 0 : 1 };
  if (!ignEqual && relation === "equal" && !natConflict) return { tier: "name", confidence: "name-only", rank: 0 };
  if (ignEqual && relation === "unknown" && !natConflict) return { tier: "ign", confidence: "ign-only", rank: 0 };
  if (ignEqual) return { tier: "refused", reason: relation === "conflict" ? "real name conflicts" : "nationality conflicts" };
  return { tier: "none" };
}

/** Keep the closest name matches; between duplicates prefer records outside the stale shards. */
function bestOf(found) {
  if (found.length < 2) return found;
  const bestRank = Math.min(...found.map((f) => f.rank));
  const closest = found.filter((f) => f.rank === bestRank);
  const live = closest.filter((f) => !f.entity.stale);
  return live.length > 0 ? live : closest;
}

/**
 * @param {{ign:string,page?:string|null,realName:string,country:string|null}} person
 * @param {ReturnType<typeof buildIndex>} index
 * @param {{page:string, kind:"player"|"staff", overrides:IdMap}} context
 * @returns {{status:"matched"|"ambiguous"|"refused"|"none", entity?:object, confidence?:string, candidates?:object[], reason?:string}}
 */
export function matchPerson(person, index, context) {
  const idMap = context.overrides ?? EMPTY_ID_MAP;
  const pageKey = person.page ?? person.ign;
  const pinned = (context.kind === "player" ? idMap.players : idMap.staff)?.find((entry) => entry.page === pageKey);
  const rejected = new Set(
    (idMap.rejections ?? []).filter((r) => r.page === pageKey && (r.kind ?? "player") === context.kind).map((r) => r.id),
  );
  if (pinned) {
    const entity = index.byId.get(pinned.id);
    return entity
      ? { status: "matched", entity, confidence: "override" }
      : { status: "refused", reason: `override points to unknown id ${pinned.id}` };
  }

  const candidates = new Set([...(index.byIgn.get(compactKey(person.ign)) ?? [])]);
  const pageIgn = compactKey(String(person.page ?? "").replace(/\s*\(.*\)$/, ""));
  for (const entity of index.byIgn.get(pageIgn) ?? []) candidates.add(entity);
  if (person.realName) for (const key of nameKeys(person.realName)) for (const e of index.byName.get(key) ?? []) candidates.add(e);

  const tiers = { strong: [], name: [], ign: [], refused: [] };
  for (const entity of candidates) {
    if (rejected.has(entity.id)) continue;
    const verdict = classify(person, entity);
    if (verdict.tier in tiers) tiers[verdict.tier].push({ entity, ...verdict });
  }
  for (const tier of ["strong", "name", "ign"]) {
    const found = bestOf(tiers[tier]);
    if (found.length === 1) return { status: "matched", entity: found[0].entity, confidence: found[0].confidence };
    if (found.length > 1) return { status: "ambiguous", candidates: found.map((f) => f.entity), reason: `${found.length} candidates share ${tier} match` };
  }
  if (tiers.refused.length > 0) {
    return { status: "refused", candidates: tiers.refused.map((f) => f.entity), reason: tiers.refused.map((f) => `${f.entity.id}: ${f.reason}`).join("; ") };
  }
  return { status: "none" };
}
