// The identity rules the game applies when it builds a world, ported so the pool can leave out, and the gate can catch,
// a person the game would fold away or hide. Each function names the Rust it mirrors; keep them in step.
//   - src-tauri/crates/olm_core/src/person_identity.rs: fold_name, folded_names, nationality_key, PersonKey::could_be
//   - src-tauri/crates/olm_core/src/world_catalog.rs: collapse_same_person_records (K2, "a pool add and a club record
//     that share two names" and "a free agent and a contracted record that share a name and a real birth date")

const DOB_TOLERANCE_DAYS = 62;
const PLACEHOLDER_DOB = "2002-01-01";

const NAMED_ENTITIES = { nbsp: " ", amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };

function decodeEntity(name) {
  if (name in NAMED_ENTITIES) return NAMED_ENTITIES[name];
  const match = /^#(?:[xX]([0-9a-fA-F]+)|([0-9]+))$/.exec(name);
  if (!match) return null;
  const code = match[1] ? Number.parseInt(match[1], 16) : Number.parseInt(match[2], 10);
  return Number.isInteger(code) && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : null;
}

/** HTML entities the data is known to carry, decoded; anything unknown stays (decode_entities). */
function decodeEntities(raw) {
  let out = "";
  let rest = raw;
  for (;;) {
    const start = rest.indexOf("&");
    if (start < 0) return out + rest;
    out += rest.slice(0, start);
    const tail = rest.slice(start);
    const end = tail.indexOf(";");
    const text = end > 0 && end <= 8 ? decodeEntity(tail.slice(1, end)) : null;
    if (text === null) {
      out += "&";
      rest = tail.slice(1);
    } else {
      out += text;
      rest = tail.slice(end + 1);
    }
  }
}

/** Every parenthesised part removed; a name that is nothing but a parenthesis keeps its text (strip_parenthesised). */
function stripParenthesised(name) {
  let depth = 0;
  let out = "";
  for (const c of name) {
    if (c === "(") depth += 1;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0) out += c;
  }
  return out.trim() === "" ? name : out;
}

const FOLDS = [
  ["a", "áàâãäåāăą"], ["c", "çćčĉċ"], ["d", "ďđ"], ["e", "éèêëēėęě"], ["g", "ğĝģ"], ["i", "íìîïīįı"], ["l", "łĺľ"],
  ["n", "ñńňņ"], ["o", "óòôõöøōő"], ["r", "řŕ"], ["s", "šśşș"], ["t", "ťţț"], ["u", "úùûüūůűų"], ["y", "ýÿ"], ["z", "žźż"],
];
const FOLD_CHAR = new Map(FOLDS.flatMap(([to, from]) => [...from].map((c) => [c, to])));
const ALNUM = /^[\p{L}\p{N}]$/u;

/** A name folded for identity checks: entities decoded, parentheses removed, lowercase, accents dropped, letters and digits only. */
export function foldName(name) {
  const lowered = stripParenthesised(decodeEntities(String(name ?? ""))).toLowerCase();
  let out = "";
  for (const c of lowered) {
    const folded = FOLD_CHAR.get(c) ?? c;
    if (ALNUM.test(folded)) out += folded;
  }
  return out;
}

/** Whitespace-separated words once entities are decoded and parentheses removed. */
export function nameWords(name) {
  return stripParenthesised(decodeEntities(String(name ?? ""))).split(/\s+/).filter(Boolean).length;
}

const namesOf = (record, onlyReal) => {
  const names = [];
  for (const raw of [record.match_name, record.full_name]) {
    const folded = foldName(raw);
    if (folded && (!onlyReal || nameWords(raw) >= 2) && !names.includes(folded)) names.push(folded);
  }
  return names;
};

/** The distinct non-empty folded match and full names of a record (folded_names). */
export const foldedNames = (record) => namesOf(record, false);
/** The folded names made of two or more words (folded_real_names). */
export const foldedRealNames = (record) => namesOf(record, true);

const COUNTRY_CODES = new Map(Object.entries({
  "south korea": "KR", korea: "KR", china: "CN", germany: "DE", brazil: "BR", brasil: "BR", mexico: "MX", colombia: "CO", argentina: "AR",
  spain: "ES", france: "FR", peru: "PE", denmark: "DK", venezuela: "VE", romania: "RO", taiwan: "TW", poland: "PL", "united states": "US",
  "czech republic": "CZ", sweden: "SE", chile: "CL", "hong kong": "HK", austria: "AT", belgium: "BE", portugal: "PT", greece: "GR",
  jordan: "JO", "costa rica": "CR", algeria: "DZ", turkey: "TR", hungary: "HU", netherlands: "NL", australia: "AU", norway: "NO",
}));

/** A nationality as a comparable key; empty, "Generated" and one-letter junk are unknown (nationality_key). */
export function nationalityKey(raw) {
  const trimmed = String(raw ?? "").trim();
  const lower = trimmed.toLowerCase();
  if ([...trimmed].length < 2 || lower === "generated") return "";
  return COUNTRY_CODES.get(lower) ?? trimmed.toUpperCase();
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** Days since the epoch for a "%Y-%m-%d" or "%B %d, %Y" date, or null (parse_date_of_birth). */
function parseDob(raw) {
  const text = String(raw ?? "").trim();
  let year;
  let month;
  let day;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (m) [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /^([A-Za-z]+) (\d{1,2}), (\d{4})$/.exec(text))) {
    month = MONTHS.indexOf(m[1].toLowerCase()) + 1;
    [day, year] = [Number(m[2]), Number(m[3])];
  } else return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (month < 1 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { days: Math.round(date.getTime() / 86_400_000), iso: date.toISOString().slice(0, 10) };
}

/** The birth date a record really carries: readable and not the catalog's 2002-01-01 placeholder (real_birth_date). */
export function realBirthDate(raw) {
  const parsed = parseDob(raw);
  return parsed && parsed.iso !== PLACEHOLDER_DOB ? parsed : null;
}

/** PersonKey::could_be: `rule` is "strict" (a record is dropped on it) or "loose" (a record is only hidden from the AI). */
export function couldBeSamePerson(a, b, rule) {
  const namesA = foldedNames(a);
  if (!namesA.some((name) => foldedNames(b).includes(name))) return false;
  const [natA, natB] = [nationalityKey(a.nationality), nationalityKey(b.nationality)];
  if (natA && natB && natA !== natB) return false;
  const [realA, realB] = [foldedRealNames(a), foldedRealNames(b)];
  const sharesReal = () => realA.some((name) => realB.includes(name));
  const [bornA, bornB] = [realBirthDate(a.date_of_birth), realBirthDate(b.date_of_birth)];
  if (bornA && bornB) return Math.abs(bornA.days - bornB.days) <= DOB_TOLERANCE_DAYS;
  if (!bornA && !bornB) return sharesReal();
  return rule === "strict" ? sharesReal() : realA.length === 0 || realB.length === 0 || sharesReal();
}

/**
 * The players on a club once the roster overlay ops are applied: the game's records with a team, minus those a
 * `retire` removes or a `move` frees, plus the `add`s that carry a team. These are the "rostered" records the world build
 * compares a free agent with.
 * @param {Array<{id: string, team_id: string|null}>} worldPlayers
 * @param {Array<object>} ops overlay player ops (`move`, `retire`, `add`), pool adds included: they have no team and change nothing
 */
export function contractedPlayers(worldPlayers, ops) {
  const byId = new Map(worldPlayers.map((p) => [p.id, { ...p }]));
  for (const op of ops) {
    if (op.op === "retire") byId.delete(op.id);
    else if (op.op === "move" && byId.has(op.id)) byId.get(op.id).team_id = op.team_id ?? null;
    else if (op.op === "add" && op.player && !byId.has(op.player.id)) byId.set(op.player.id, { ...op.player });
  }
  return [...byId.values()].filter((p) => p.team_id);
}

/**
 * A check for the pool adds the world build folds into a record on a club (K2) or hides from the AI signing guard, built once
 * from the records on a club and every pool add, because K2 counts the persons a free agent fits as union-find roots:
 * records on one club that share a name are one person, and a pool add that shares two names with two records makes them one.
 * @param {PersonRecord[]} contracted the players on a club once the roster overlay is applied (`contractedPlayers`)
 * @param {PersonRecord[]} poolRecords every pool add (teamless), the candidates included
 * @returns {(candidate: PersonRecord) => {rule: "K2-two-names"|"K2-name-and-birth-date"|"AI-loose", with: string}|null}
 */
export function worldBuildChecker(contracted, poolRecords) {
  const size = contracted.length + poolRecords.length;
  const parent = Array.from({ length: size }, (_, i) => i);
  const find = (i) => {
    let node = i;
    while (parent[node] !== node) {
      parent[node] = parent[parent[node]];
      node = parent[node];
    }
    return node;
  };
  const union = (a, b) => {
    parent[find(b)] = find(a);
  };
  const names = contracted.map(foldedNames);
  const byName = new Map();
  const byClubName = new Map();
  contracted.forEach((record, index) => {
    for (const name of names[index]) {
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(index);
      // Records on one club that share a folded name are one person written twice.
      const clubKey = `${record.team_id}\u0000${name}`;
      if (byClubName.has(clubKey)) union(byClubName.get(clubKey), index);
      else byClubName.set(clubKey, index);
    }
  });
  // A pool add and a record on a club that share two folded names are one person.
  poolRecords.forEach((record, k) => {
    const shared = new Map();
    for (const name of foldedNames(record)) for (const other of byName.get(name) ?? []) shared.set(other, (shared.get(other) ?? 0) + 1);
    for (const [other, count] of shared) if (count >= 2) union(other, contracted.length + k);
  });

  return (candidate) => {
    const candidateNames = foldedNames(candidate);
    const at = (name) => byName.get(name) ?? [];
    const shared = new Map();
    for (const name of candidateNames) for (const other of at(name)) if (contracted[other].id !== candidate.id) shared.set(other, (shared.get(other) ?? 0) + 1);
    for (const [other, count] of shared) if (count >= 2) return { rule: "K2-two-names", with: contracted[other].id };
    // A free agent and the one person on a club that shares a name and the same real birth date.
    const born = realBirthDate(candidate.date_of_birth);
    if (born) {
      const roots = new Map();
      for (const name of candidateNames) {
        for (const other of at(name)) {
          if (contracted[other].id !== candidate.id && realBirthDate(contracted[other].date_of_birth)?.days === born.days) roots.set(find(other), other);
        }
      }
      if (roots.size === 1) return { rule: "K2-name-and-birth-date", with: contracted[[...roots.values()][0]].id };
    }
    // The AI signing guard: could be the same person under the loose rule.
    for (const name of candidateNames) {
      for (const other of at(name)) if (contracted[other].id !== candidate.id && couldBeSamePerson(candidate, contracted[other], "loose")) return { rule: "AI-loose", with: contracted[other].id };
    }
    return null;
  };
}

/** One check, for a single candidate: `worldBuildChecker` with the candidate as the only pool add unless `poolRecords` says more. */
export function foldedByWorldBuild(candidate, contracted, poolRecords = [candidate]) {
  return worldBuildChecker(contracted, poolRecords)(candidate);
}
