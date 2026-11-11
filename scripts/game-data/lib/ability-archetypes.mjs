// Classification of champion abilities into a small closed vocabulary of archetypes. Pure functions, no I/O.
//
// The vocabulary holds only effects a spectator can see and an engine with positions, health, damage and time can act
// on. Slows, silences, plain damage, steroids and vision are deliberately absent: an ability with only those has an
// empty list. Input is untrusted JSON: every field is read defensively.

/** The closed vocabulary, in the order archetypes are listed in the output. */
export const ARCHETYPES = {
  ally_shield: "Gives another allied champion a shield.",
  ally_heal: "Restores health to another allied champion.",
  self_shield: "Shields only the caster.",
  self_heal: "Heals only the caster (drains and sustain abilities included).",
  dash: "Moves the caster quickly over a short distance (dashes, leaps, blinks, shadow swaps).",
  engage: "A gap closer or long-range tool whose purpose is to start a fight on an enemy, with crowd control on arrival.",
  hard_cc: "Stops an enemy from acting: stun, root, knock-up or knock-back, suppression, charm, fear, taunt, sleep, polymorph.",
  poke: "Damage from well beyond attack range that needs no commitment.",
  execute: "Damage that grows with the target's missing health, or kills below a threshold.",
  stealth: "Invisibility or camouflage.",
  untargetable: "The caster or an ally cannot be targeted or damaged for a moment (stasis, invulnerability, attaching to an ally).",
  global: "Reaches across the map (an ability can be global and something else).",
};

export const ARCHETYPE_NAMES = Object.keys(ARCHETYPES);
export const RANGE_CLASSES = ["self", "melee", "short", "medium", "long", "global"];
export const SLOTS = ["Q", "W", "E", "R"];

/** Range thresholds in game units, applied to the kit's range at the middle rank. A range up to `selfMax` is self-cast. */
export const RANGE_THRESHOLDS = Object.freeze({ selfMax: 25, meleeMax: 350, shortMax: 700, mediumMax: 1200, globalMin: 10000 });
/** An ability needs at least this range (and some damage) to count as poke by the keyword rules. */
export const POKE_MIN_RANGE = 900;

/** Words that mark an effect as reaching an ally. */
const ALLY_WORDS = /\b(allies|allied|ally|friendly|friends?|teammates?|another champion|other champions?|nearby champions?)\b/;
/** Words that mark an effect as hitting the caster. */
const SELF_WORDS = /\b(herself|himself|itself|themselves|themself|oneself|her own|his own|their own)\b/;

const SHIELD = /\bshield(?:s|ed|ing)?\b/;
const HEAL = /\b(?:heal(?:s|ed|ing)?\b|restor(?:e|es|ed|ing)\b[^.]{0,40}\bhealth|recover(?:s|ed|ing)?\b[^.]{0,40}\bhealth|drain(?:s|ed|ing)?\b[^.]{0,40}\bhealth|life ?steal\b)/;
const HEAL_NEGATIVE = /(?:heal(?:ing)? reduction|reduces? (?:their )?healing|reduced healing|healing (?:and|or) shield(?:ing)? (?:received|reduction))/g;
const DASH = /\b(?:dash(?:es|ed|ing)?|leap(?:s|ed|ing)?|blink(?:s|ed|ing)?|lunge(?:s|d)?|vault(?:s|ed|ing)?|swaps? (?:places|positions)|shadow swap|flips?|hurls? (?:herself|himself|itself)|launches (?:herself|himself|itself)|teleports? (?:herself|himself|to))\b/;
const HARD_CC = /\b(?:stun(?:s|ned|ning)?|root(?:s|ed|ing)?|snare[sd]?|ensnare[sd]?|immobili[sz](?:e|es|ed|ing)|knock(?:s|ed|ing)?\b[^.]{0,30}\b(?:up|back|aside|away|airborne|into the air)|(?:knock\w*|pop\w*|toss\w*|launch\w*|throw\w*|hurl\w*)\b[^.]{0,30}\binto the air|drag(?:s|ged|ging)?|airborne|suppress(?:es|ed|ing)?|charm(?:s|ed|ing)?|fear(?:s|ed|ing)?|terrif(?:y|ies|ied)|flee|taunt(?:s|ed|ing)?|put(?:s)? (?:\w+ )?to sleep|asleep|sleep|polymorph(?:s|ed)?|petrif(?:y|ies|ied)|pull(?:s|ed|ing)? (?:all |the |nearby |an |each |every )?(?:enem(?:y|ies)|champions?|targets?|them|him|her|units?)|yank(?:s|ed)?)\b/;
const EXECUTE = /(?:missing health|execut(?:e|es|ed|ion)\b|below \d+% (?:of )?(?:their |its |the target's |his |her )?(?:maximum |max )?health|(?:maximum |max )?health (?:is )?below|lowest health|kills? (?:the |any )?(?:target|enemy|champion)s?[^.]{0,40}(?:below|under)|% (?:of )?(?:their |its )?(?:max(?:imum)? )?health or less)/;
const STEALTH = /\b(?:invisib(?:le|ility)|stealth(?:ed)?|camouflage[sd]?|become[s]? unseen|unseen|conceal(?:s|ed)?)\b/;
const UNTARGETABLE = /\b(?:untargetable|invulnerab(?:le|ility)|stasis|cannot be targeted|can't be targeted|immune to all damage|banish(?:es|ed)? (?:herself|himself|itself))/;
const GLOBAL_TEXT = /\b(?:anywhere on the map|across the map|global(?:ly)?|entire map|any location on the map|anywhere on the rift|map-wide|map wide)\b/;
const DAMAGE = /\bdamag(?:e|es|ed|ing)\b/;

/** Lowercases and keeps what the patterns need. */
function normalise(description) {
  return typeof description === "string" ? description.toLowerCase().replace(/\s+/g, " ").trim() : "";
}

/** The kit's number at the middle rank of a list, or null when the list is empty or holds no finite number. */
function middle(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const value = list[Math.floor((list.length - 1) / 2)];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Cooldown in seconds at the middle rank (rank 3 of 5, rank 2 of 3); null when the ability has no cooldown. */
export function cooldownAtMiddleRank(cooldowns) {
  const value = middle(cooldowns);
  return value !== null && value > 0 ? value : null;
}

/** Range in game units at the middle rank, or null. */
export function rangeAtMiddleRank(ranges) {
  return middle(ranges);
}

/**
 * One of RANGE_CLASSES from the kit's range at the middle rank. A map-wide text, or a `global` archetype passed in
 * `archetypes`, gives `global`. Data Dragon also uses huge placeholder ranges (25000) for abilities without a targeting
 * range; without a map-wide effect those are classed `long` and the curated file corrects them.
 */
export function classifyRange(ranges, description = "", archetypes = []) {
  if (archetypes.includes("global") || GLOBAL_TEXT.test(normalise(description))) return "global";
  const value = rangeAtMiddleRank(ranges);
  if (value === null || value <= RANGE_THRESHOLDS.selfMax) return "self";
  if (value <= RANGE_THRESHOLDS.meleeMax) return "melee";
  if (value <= RANGE_THRESHOLDS.shortMax) return "short";
  if (value <= RANGE_THRESHOLDS.mediumMax) return "medium";
  return "long";
}

/**
 * Keyword rules over one ability. `ability` is `{ description, range }` (the kit's fields). Returns the archetypes in
 * vocabulary order. These rules are a first pass: Data Dragon's summaries are short, so the curated file corrects them.
 */
export function classifyAbilityText(ability) {
  const text = normalise(ability?.description);
  const found = new Set();
  const ranges = Array.isArray(ability?.range) ? ability.range : [];
  const range = rangeAtMiddleRank(ranges) ?? 0;
  const ally = ALLY_WORDS.test(text);
  const reflexive = SELF_WORDS.test(text);

  const shieldText = text.replace(/\b(?:enemies'|enemy|enemy champions'|their|its) shields?\b/g, " ");
  if (SHIELD.test(shieldText)) {
    if (ally) found.add("ally_shield");
    if (!ally || reflexive) found.add("self_shield");
  }
  const healText = text.replace(HEAL_NEGATIVE, " ");
  if (HEAL.test(healText)) {
    if (ally) found.add("ally_heal");
    if (!ally || reflexive || /\bdrain|\bsteal/.test(healText)) found.add("self_heal");
  }
  const dash = DASH.test(text);
  const hardCc = HARD_CC.test(text);
  if (dash) found.add("dash");
  if (hardCc) found.add("hard_cc");
  if (dash && hardCc) found.add("engage");
  if (EXECUTE.test(text) && (DAMAGE.test(text) || /\bkill|\bexecut/.test(text))) found.add("execute");
  if (STEALTH.test(text)) found.add("stealth");
  if (UNTARGETABLE.test(text)) found.add("untargetable");
  // Data Dragon's huge ranges are placeholders as often as real map-wide reach, so `global` comes from the text alone.
  const global = GLOBAL_TEXT.test(text);
  if (global) found.add("global");
  if (!global && !dash && DAMAGE.test(text) && range >= POKE_MIN_RANGE && range < RANGE_THRESHOLDS.globalMin) found.add("poke");

  return ARCHETYPE_NAMES.filter((name) => found.has(name));
}

/** A curated entry is a list of archetypes, or `{ archetypes?, rangeClass? }`. */
export function curatedParts(entry) {
  if (Array.isArray(entry)) return { archetypes: entry, rangeClass: undefined };
  return { archetypes: entry?.archetypes, rangeClass: entry?.rangeClass };
}

/** Rejects a curated file that names an unknown champion, slot or archetype, or repeats what the rules already say. */
export function validateCurated(curated, kitChampions, ruleOutput) {
  const overrides = curated?.overrides;
  if (typeof overrides !== "object" || overrides === null || Array.isArray(overrides)) throw new Error("curated file has no `overrides` object");
  for (const [championId, slots] of Object.entries(overrides)) {
    if (!Object.hasOwn(kitChampions, championId)) throw new Error(`curated entry names unknown champion ${championId}`);
    if (typeof slots !== "object" || slots === null || Array.isArray(slots)) throw new Error(`curated entry ${championId} is not an object`);
    for (const [slot, entry] of Object.entries(slots)) {
      if (!SLOTS.includes(slot)) throw new Error(`curated entry ${championId} names unknown slot ${slot}`);
      const { archetypes: list, rangeClass } = curatedParts(entry);
      if (list === undefined && rangeClass === undefined) throw new Error(`curated entry ${championId}.${slot} sets nothing`);
      if (rangeClass !== undefined) {
        if (!RANGE_CLASSES.includes(rangeClass)) throw new Error(`curated entry ${championId}.${slot} names unknown range class ${String(rangeClass)}`);
        if (rangeClass === ruleOutput(championId, slot).rangeClass) throw new Error(`curated entry ${championId}.${slot} range class equals the rule output; remove it`);
      }
      if (list === undefined) continue;
      if (!Array.isArray(list)) throw new Error(`curated entry ${championId}.${slot} archetypes is not a list`);
      for (const name of list) {
        if (!ARCHETYPE_NAMES.includes(name)) throw new Error(`curated entry ${championId}.${slot} names unknown archetype ${String(name)}`);
      }
      if (new Set(list).size !== list.length) throw new Error(`curated entry ${championId}.${slot} repeats an archetype`);
      const fromRules = ruleOutput(championId, slot).archetypes;
      const sorted = ARCHETYPE_NAMES.filter((name) => list.includes(name));
      if (sorted.length === fromRules.length && sorted.every((name, i) => name === fromRules[i])) {
        throw new Error(`curated entry ${championId}.${slot} equals the rule output; remove it`);
      }
    }
  }
}

/**
 * Builds the abilities file from the kits file and the curated overrides. Returns `{ file, report }`; `report` has the
 * champion count per archetype and how many abilities the rules got right alone.
 */
export function buildAbilities({ kits, curated }) {
  const kitChampions = kits?.champions;
  if (typeof kitChampions !== "object" || kitChampions === null) throw new Error("kits file has no champions");
  const bySlot = (championId, slot) => kitChampions[championId].abilities.find((ability) => ability.slot === slot);
  const ruleOutput = (championId, slot) => {
    const ability = bySlot(championId, slot) ?? {};
    const archetypes = classifyAbilityText(ability);
    return { archetypes, rangeClass: classifyRange(ability.range, ability.description, archetypes) };
  };
  validateCurated(curated, kitChampions, ruleOutput);

  const champions = {};
  const championsPerArchetype = Object.fromEntries(ARCHETYPE_NAMES.map((name) => [name, 0]));
  let abilityCount = 0;
  let curatedCount = 0;
  for (const championId of Object.keys(kitChampions).sort()) {
    const kitAbilities = kitChampions[championId].abilities;
    if (!Array.isArray(kitAbilities) || kitAbilities.length !== SLOTS.length || kitAbilities.some((ability, i) => ability.slot !== SLOTS[i])) {
      throw new Error(`champion ${championId} does not have abilities Q, W, E, R in order`);
    }
    const seen = new Set();
    champions[championId] = kitAbilities.map((ability) => {
      const entry = curated.overrides[championId]?.[ability.slot];
      const override = entry === undefined ? undefined : curatedParts(entry);
      const archetypes = override?.archetypes ? ARCHETYPE_NAMES.filter((name) => override.archetypes.includes(name)) : classifyAbilityText(ability);
      for (const name of archetypes) seen.add(name);
      abilityCount += 1;
      if (override) curatedCount += 1;
      return {
        slot: ability.slot,
        name: ability.name,
        archetypes,
        cooldownSec: cooldownAtMiddleRank(ability.cooldown),
        rangeClass: override?.rangeClass ?? classifyRange(ability.range, ability.description, archetypes),
        origin: override ? "curated" : "rule",
      };
    });
    for (const name of seen) championsPerArchetype[name] += 1;
  }

  const file = {
    schema: "olm.champion-abilities.v1",
    patch: kits.patch,
    date: kits.date,
    source: "assets/simulation/champion-kits.v1.json (Riot Games Data Dragon ability descriptions) plus scripts/game-data/ability-archetypes.curated.json",
    generator: "scripts/game-data/abilities.mjs",
    cooldownSec: "Cooldown in seconds at the middle rank of the kit's list (rank 3 of 5, rank 2 of 3); null when that cooldown is 0.",
    rangeClass: {
      rule: "Kit range at the middle rank, in game units; a map-wide text promotes it to global.",
      thresholds: { ...RANGE_THRESHOLDS },
      classes: {
        self: `up to ${RANGE_THRESHOLDS.selfMax}`,
        melee: `up to ${RANGE_THRESHOLDS.meleeMax}`,
        short: `up to ${RANGE_THRESHOLDS.shortMax}`,
        medium: `up to ${RANGE_THRESHOLDS.mediumMax}`,
        long: `below ${RANGE_THRESHOLDS.globalMin}`,
        global: `${RANGE_THRESHOLDS.globalMin} or more`,
      },
    },
    pokeMinRange: POKE_MIN_RANGE,
    origin: { rule: "the keyword rules alone produced the archetypes", curated: "scripts/game-data/ability-archetypes.curated.json set or corrected them" },
    archetypes: { ...ARCHETYPES },
    champions,
  };
  const report = {
    champions: Object.keys(champions).length,
    abilities: abilityCount,
    curated: curatedCount,
    ruleOnly: abilityCount - curatedCount,
    championsPerArchetype,
  };
  return { file, report };
}
