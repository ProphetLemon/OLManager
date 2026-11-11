// Pure transformation of Riot Data Dragon JSON into the game's item catalogue and champion kits. No I/O.
//
// Input is untrusted: callers pass parsed JSON, and every field is read defensively. Nothing here evaluates data.

export const SUMMONERS_RIFT_MAP = "11";
/** Item ids at or above this value are mode-specific copies of a shop item ("32" or "66" + the original id). */
export const VARIANT_ID_FLOOR = 100000;
/** The catalogue key style of `public/lol-item-icons`: lowercase, apostrophes dropped, other runs of symbols as `_`. */
export const ITEM_ICON_DIR = "/lol-item-icons";
export const ULTIMATE_ICON_DIR = "/lol-ultimate-icons";

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " " };

/** Removes Data Dragon markup (`<attention>75</attention>`, `<br>`) and decodes the basic entities. */
export function stripMarkup(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (entity) => ENTITIES[entity])
    .replace(/\s+/g, " ")
    .trim();
}

/** Stable key for an item name: `Infinity Edge` -> `infinity_edge`, `Guinsoo's Rageblade` -> `guinsoos_rageblade`. */
export function itemKey(name) {
  return stripMarkup(name)
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Stat lines of the item description: `<stats><attention>75</attention> Attack Damage<br>...</stats>` becomes
 * [{ value: "75", stat: "Attack Damage" }, ...]. Data Dragon's `stats` object has no ability haste, lifesteal text or
 * mana regeneration, but the description does.
 */
export function parseStatLines(description) {
  if (typeof description !== "string") return [];
  const block = /<stats>([\s\S]*?)<\/stats>/i.exec(description)?.[1];
  if (!block) return [];
  const lines = [];
  for (const part of block.split(/<br\s*\/?>/i)) {
    const match = /<attention>([^<]*)<\/attention>\s*([^<]*)/i.exec(part);
    if (!match) continue;
    const value = stripMarkup(match[1]);
    const stat = stripMarkup(match[2]);
    if (value && stat) lines.push({ value, stat });
  }
  return lines;
}

function hasTag(entry, tag) {
  return Array.isArray(entry.tags) && entry.tags.includes(tag);
}

/** Why an item is left out of the catalogue, or null when it is kept. First matching reason wins. */
export function dropReason(id, entry) {
  if (!entry || typeof entry !== "object" || !entry.maps?.[SUMMONERS_RIFT_MAP]) return "other-mode";
  if (Number(id) >= VARIANT_ID_FLOOR) return "mode-variant-id";
  if (entry.hideFromAll) return "hidden";
  if (entry.requiredChampion) return "champion-only";
  if (entry.requiredAlly) return "ally-required";
  if (entry.gold?.purchasable !== true || entry.inStore === false) return "not-purchasable";
  return null;
}

function isStarter(entry) {
  if (!hasTag(entry, "Lane") && !hasTag(entry, "Jungle")) return false;
  if (hasTag(entry, "Consumable") || hasTag(entry, "Trinket") || hasTag(entry, "GoldPer")) return false;
  if (entry.from?.length) return false;
  if ((entry.gold?.total ?? Infinity) > 500) return false;
  return (entry.into?.length ?? 0) <= 1;
}

/**
 * Item catalogue from Data Dragon `item.json`. Filter, in order (each dropped item counts under its first reason):
 * not on Summoner's Rift (`maps.11`), id >= 100000 (mode copies), `hideFromAll`, `requiredChampion`, `requiredAlly`,
 * `gold.purchasable` false or `inStore` false. Items sharing a name keep the lowest id.
 * Returns { items, filter: { rule, kept, dropped, droppedByReason, duplicateNames } }.
 */
export function buildItems(itemJson) {
  const data = itemJson?.data && typeof itemJson.data === "object" ? itemJson.data : {};
  const droppedByReason = {};
  const candidates = [];
  for (const [id, entry] of Object.entries(data)) {
    const reason = dropReason(id, entry);
    if (reason) droppedByReason[reason] = (droppedByReason[reason] ?? 0) + 1;
    else candidates.push([id, entry]);
  }
  candidates.sort((a, b) => Number(a[0]) - Number(b[0]));
  const byName = new Map();
  const duplicateNames = [];
  for (const [id, entry] of candidates) {
    const name = stripMarkup(entry.name);
    if (byName.has(name)) {
      droppedByReason["duplicate-name"] = (droppedByReason["duplicate-name"] ?? 0) + 1;
      duplicateNames.push({ name, kept: byName.get(name)[0], dropped: id });
    } else byName.set(name, [id, entry]);
  }
  const items = [];
  const keys = new Map();
  for (const [name, [id, entry]] of byName) {
    const key = itemKey(name);
    if (!key) throw new Error(`item ${id} has no usable name`);
    if (keys.has(key)) throw new Error(`items ${keys.get(key)} and ${id} share the key ${key}`);
    keys.set(key, id);
    const tags = Array.isArray(entry.tags) ? [...entry.tags] : [];
    const consumable = entry.consumed === true || tags.includes("Consumable");
    const trinket = tags.includes("Trinket");
    items.push({
      id: Number(id),
      key,
      name,
      cost: entry.gold?.total ?? 0,
      baseCost: entry.gold?.base ?? 0,
      sellValue: entry.gold?.sell ?? 0,
      stats: { ...(entry.stats ?? {}) },
      statLines: parseStatLines(entry.description),
      tags,
      buildsFrom: (entry.from ?? []).map(Number),
      buildsInto: (entry.into ?? []).map(Number),
      depth: entry.depth ?? 1,
      boots: false,
      starter: isStarter(entry),
      consumable,
      trinket,
      support: tags.includes("GoldPer") && tags.includes("Lane"),
      icon: `${ITEM_ICON_DIR}/${key}.png`,
    });
  }
  const kept = new Set(items.map((item) => item.id));
  // Recipes must only name catalogue items: the dropped copies and removed items leave dangling ids otherwise.
  for (const item of items) {
    item.buildsFrom = item.buildsFrom.filter((id) => kept.has(id));
    item.buildsInto = item.buildsInto.filter((id) => kept.has(id));
  }
  items.sort((a, b) => a.id - b.id);
  // Boots are the Boots tag plus anything built from boots (Gunmetal Greaves carries no Boots tag).
  const bootIds = new Set(items.filter((item) => item.tags.includes("Boots")).map((item) => item.id));
  for (let grew = true; grew; ) {
    grew = false;
    for (const item of items) {
      if (!bootIds.has(item.id) && item.buildsFrom.some((id) => bootIds.has(id))) {
        bootIds.add(item.id);
        grew = true;
      }
    }
  }
  for (const item of items) item.boots = bootIds.has(item.id);
  const total = Object.keys(data).length;
  return {
    items,
    filter: {
      rule: "maps.11 is true; id < 100000; not hideFromAll; no requiredChampion; no requiredAlly; gold.purchasable is true and inStore is not false; one entry per name (lowest id)",
      total,
      kept: items.length,
      dropped: total - items.length,
      droppedByReason,
      duplicateNames,
    },
  };
}

/**
 * Ultimate archetype from the ability name and tooltip, by keyword matching. Moved unchanged from LolMatchLive.tsx:
 * the text is the raw tooltip (markup and placeholders included), exactly what the live view classified at match start.
 */
export function classifyUltimateArchetype(name, description) {
  const text = `${name} ${description}`.toLowerCase();
  if (text.includes("execute") || text.includes("missing health") || text.includes("below")) return "execute";
  if (text.includes("global") || text.includes("map") || text.includes("long range") || text.includes("anywhere")) return "global";
  if (text.includes("dash") || text.includes("leap") || text.includes("charge") || text.includes("knockup") || text.includes("pull")) return "engage";
  if (text.includes("heal") || text.includes("shield") || text.includes("invulner") || text.includes("stasis") || text.includes("untarget")) return "defensive";
  if (text.includes("zone") || text.includes("field") || text.includes("storm") || text.includes("area") || text.includes("aoe")) return "zone";
  if (text.includes("transform") || text.includes("form")) return "sustain";
  return "burst";
}

const SLOTS = ["Q", "W", "E", "R"];

function numbers(value) {
  return Array.isArray(value) ? value.map((entry) => (typeof entry === "number" ? entry : Number(entry) || 0)) : [];
}

function buildAbility(spell, slot) {
  return {
    slot,
    id: spell?.id ?? "",
    name: stripMarkup(spell?.name),
    description: stripMarkup(spell?.description),
    cooldown: numbers(spell?.cooldown),
    cost: numbers(spell?.cost),
    costType: stripMarkup(spell?.costType),
    range: numbers(spell?.range),
    maxRank: spell?.maxrank ?? 0,
    image: spell?.image?.full ?? "",
  };
}

/**
 * Champion kits from Data Dragon `championFull.json`, keyed by Data Dragon id (`MonkeyKing`, not `Wukong`).
 * `catalogueIds` is the game's own list (assets/simulation/champion-list.json); `inCatalogue` marks membership.
 * Throws for a champion without four abilities: the live view reads `abilities[3]` as the ultimate.
 * Returns { champions, report: { total, inCatalogue, notInCatalogue, missingFromData } }.
 */
export function buildKits(championFull, catalogueIds) {
  const data = championFull?.data && typeof championFull.data === "object" ? championFull.data : {};
  const catalogue = new Set(catalogueIds);
  const champions = {};
  for (const id of Object.keys(data).sort()) {
    const raw = data[id];
    const spells = Array.isArray(raw.spells) ? raw.spells : [];
    if (spells.length !== 4) throw new Error(`champion ${id} has ${spells.length} abilities, expected 4`);
    const abilities = spells.map((spell, index) => buildAbility(spell, SLOTS[index]));
    const ultimateRaw = spells[3];
    const tooltip = typeof ultimateRaw.tooltip === "string" && ultimateRaw.tooltip !== "" ? ultimateRaw.tooltip : (ultimateRaw.description ?? "");
    const image = abilities[3].image;
    champions[id] = {
      id,
      key: Number(raw.key),
      name: raw.name,
      title: raw.title ?? "",
      inCatalogue: catalogue.has(id),
      tags: Array.isArray(raw.tags) ? [...raw.tags] : [],
      resource: raw.partype ?? "",
      attackRange: raw.stats?.attackrange ?? 0,
      stats: { ...(raw.stats ?? {}) },
      passive: {
        name: stripMarkup(raw.passive?.name),
        description: stripMarkup(raw.passive?.description),
        image: raw.passive?.image?.full ?? "",
      },
      abilities,
      ultimate: {
        archetype: classifyUltimateArchetype(ultimateRaw.name ?? "", tooltip),
        icon: image ? `${ULTIMATE_ICON_DIR}/${image}` : "",
      },
    };
  }
  const ids = Object.keys(champions);
  return {
    champions,
    report: {
      total: ids.length,
      inCatalogue: ids.filter((id) => champions[id].inCatalogue).length,
      notInCatalogue: ids.filter((id) => !champions[id].inCatalogue),
      missingFromData: [...catalogue].filter((id) => !(id in champions)).sort(),
    },
  };
}

/** Header shared by both files. `date` is the day the raw data was first downloaded (kept in the cache), not today. */
export function buildHeader({ patch, date, kind, locale = "en_US" }) {
  return {
    schema: `olm.${kind}.v1`,
    patch,
    date,
    locale,
    source: "Riot Games Data Dragon (https://ddragon.leagueoflegends.com), static game data",
    generator: "scripts/game-data/ddragon.mjs",
  };
}
