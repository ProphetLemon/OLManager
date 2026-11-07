// Parsers for the Leaguepedia pages the refresh tool reads (rendered action=parse HTML + player wikitext).
import { JSDOM } from "jsdom";

export const WIKI_BASE = "https://lol.fandom.com/wiki/";

export function pageUrl(title) {
  return WIKI_BASE + encodeURIComponent(String(title).replace(/ /g, "_")).replace(/%2F/g, "/").replace(/%28/g, "(").replace(/%29/g, ")");
}

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const documentOf = (html) => new JSDOM(`<body>${html}</body>`).window.document;

/** Rendered text of an element without the hidden sort-key spans Leaguepedia injects. */
function visibleText(element) {
  const copy = element.cloneNode(true);
  for (const hidden of copy.querySelectorAll('[style*="display:none"], .toggle-section-hidden')) hidden.remove();
  return clean(copy.textContent);
}

// --- Sections -----------------------------------------------------------------------------------

/**
 * Pick the section indexes of the current player table ("Active") and the current staff table
 * ("Organization" > "Current") from a `prop=sections` response.
 */
export function findTeamSections(sections) {
  const active =
    sections.find((s) => s.line === "Active") ?? sections.find((s) => s.line === "Player Roster") ?? null;
  const organization = sections.find((s) => s.line === "Organization");
  let staff = null;
  if (organization) {
    staff = sections.find((s) => s.line === "Current" && String(s.number).startsWith(`${organization.number}.`)) ?? null;
  }
  if (!staff && active) {
    staff = sections.find((s) => s.line === "Current" && Number(s.index) > Number(active.index)) ?? null;
  }
  return { active: active ? String(active.index) : null, staff: staff ? String(staff.index) : null };
}

// --- Active roster ------------------------------------------------------------------------------

const POSITION_BY_ROLE = {
  "top laner": "Top",
  jungler: "Jungle",
  "mid laner": "Mid",
  "bot laner": "ADC",
  support: "Support",
};
const POSITION_BY_SUFFIX = { top: "Top", jun: "Jungle", mid: "Mid", bot: "ADC", sup: "Support" };

/**
 * Classify a Leaguepedia roster role label.
 * `starter` and `sub` are authoritative members of the roster; `trainee` and `inactive` are not.
 */
export function classifyRole(label) {
  const text = clean(label);
  const lower = text.toLowerCase();
  if (POSITION_BY_ROLE[lower]) return { kind: "starter", position: POSITION_BY_ROLE[lower], label: text };
  const match = lower.match(/^(sub|trn|ia)\/(\w+)$/);
  if (match) {
    const kinds = { sub: "sub", trn: "trainee", ia: "inactive" };
    return { kind: kinds[match[1]], position: POSITION_BY_SUFFIX[match[2]] ?? null, label: text };
  }
  return { kind: "unknown", position: null, label: text };
}

/** @returns {Array<{ign:string,page:string,realName:string,country:string|null,kind:string,position:string|null,roleLabel:string,contractEnd:string|null,joined:string|null}>} */
export function parseActiveRoster(html) {
  const doc = documentOf(html);
  const table = doc.querySelector("table.team-members-current");
  if (!table) return [];
  const players = [];
  for (const row of table.querySelectorAll("tr")) {
    const playerCell = row.querySelector("td.team-members-player");
    if (!playerCell) continue;
    const page = clean(playerCell.getAttribute("data-player-id") ?? playerCell.textContent);
    const ign = clean(playerCell.querySelector("a")?.textContent ?? page.replace(/\s*\(.*\)$/, ""));
    const role = classifyRole(row.querySelector("td.team-members-role .markup-object-name")?.textContent ?? "");
    const contract = clean(row.querySelector("td.team-members-date-contract")?.textContent);
    const exactJoin = row.querySelector('td[class*="team-members-date-with"] [class*="ofl-toggle-"][class*="-2"]');
    players.push({
      ign,
      page,
      realName: clean(row.querySelector("td.team-members-irlname")?.textContent).replace(/\s*\(.*\)$/, ""),
      country: row.querySelector(".country-sprite")?.getAttribute("title") ?? null,
      kind: role.kind,
      position: role.position,
      roleLabel: role.label,
      contractEnd: /^\d{4}-\d{2}-\d{2}$/.test(contract) ? contract : null,
      joined: clean(exactJoin?.textContent).match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null,
    });
  }
  return players;
}

// --- Staff ---------------------------------------------------------------------------------------

/** @returns {Array<{ign:string,page:string|null,realName:string,country:string|null,roleLabel:string,inactive:boolean}>} */
export function parseStaffTable(html) {
  const doc = documentOf(html);
  const table = doc.querySelector("table.listplayer-table");
  if (!table) return [];
  const staff = [];
  for (const row of table.querySelectorAll("tr")) {
    const cells = row.querySelectorAll("td");
    if (cells.length < 4) continue;
    const link = cells[1].querySelector("a");
    const roleLabel = clean(cells[3].querySelector("b")?.textContent ?? visibleText(cells[3]));
    staff.push({
      ign: visibleText(cells[1]),
      page: link ? clean(link.getAttribute("title")) : null,
      realName: visibleText(cells[2]).replace(/\s*\(.*\)$/, ""),
      country: cells[0].querySelector(".country-sprite")?.getAttribute("title") ?? null,
      roleLabel,
      inactive: /\b(inactive|former)\b/i.test(roleLabel),
    });
  }
  return staff;
}

// --- Player pages --------------------------------------------------------------------------------

export function isDisambiguation(wikitext) {
  return /\{\{\s*DisambigPage/i.test(wikitext ?? "");
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** Parse the `{{Infobox Player}}` template parameters of a player page. */
export function parseInfobox(wikitext) {
  const match = String(wikitext ?? "").match(/\{\{\s*Infobox Player\s*\n([\s\S]*?)\n\}\}/);
  if (!match) return null;
  const params = {};
  for (const line of match[1].split("\n")) {
    const m = line.match(/^\|([\w-]+)=(.*)$/);
    if (m) params[m[1]] = m[2].trim();
  }
  const month = MONTHS.indexOf(String(params.birth_date_month ?? "").toLowerCase()) + 1 || Number(params.birth_date_month) || 0;
  const year = Number(params.birth_date_year) || 0;
  const day = Number(params.birth_date_day) || 0;
  return {
    id: params.id ?? null,
    name: params.name ?? null,
    country: params.country ?? null,
    isRetired: /^yes$/i.test(params.isretired ?? ""),
    role: params.role ?? null,
    birthDate: year && month && day ? `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : null,
  };
}

/**
 * Parse the lead sentence of a player page ("... esports player, currently mid laner for X").
 * @returns {{state: "currently"|"previously"|"retired"|null, teamText: string|null}}
 */
export function parseIntro(html) {
  const text = clean(documentOf(html).body.textContent);
  const match = text.match(/esports (?:player|coach|[a-z ]+?)[^.]{0,80}?\b(currently|previously|retired)\b([^.]{0,160})/);
  if (!match) return { state: null, teamText: null };
  return { state: match[1], teamText: clean(match[2]) || null };
}

/** Team name at the end of "mid laner for Cloud9" / "substitute top laner for Natus Vincere". */
export function teamNameFromIntro(teamText) {
  const match = String(teamText ?? "").match(/\bfor\s+(.+?)\s*$/);
  return match ? clean(match[1]) : null;
}
