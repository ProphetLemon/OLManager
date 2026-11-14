import type { GoldSample, KeyEvent, MatchRecord } from "@/lib/match/live/matchRecord";
import type { PostGameChampion, PostGameState } from "@/lib/match/live/postGame";

/**
 * A finished 31:48 match for the post-game tests: blue wins, five players a side, with a gold
 * series seen minute by minute and the key events a watched match records. Each test starts from
 * these and changes what it is about.
 */

export const END_SEC = 1908;

interface Spec {
  id: string;
  name: string;
  team: "blue" | "red";
  role: string;
  kda: [number, number, number];
  cs: number;
  gold: number;
  damage: number;
  level: number;
  items: string[];
  trinket: string;
  spells: string[];
}

const SPECS: Spec[] = [
  { id: "b-top", name: "Rooster", team: "blue", role: "TOP", kda: [3, 3, 5], cs: 248, gold: 19400, damage: 14800, level: 18, items: ["black_cleaver", "plated_steelcaps", "sunfire_aegis"], trinket: "wardingtotem", spells: ["flash", "teleport"] },
  { id: "b-jgl", name: "Sheo", team: "blue", role: "JGL", kda: [5, 2, 12], cs: 88, gold: 18100, damage: 11600, level: 17, items: ["sunfire_aegis", "mercurys_treads"], trinket: "oraclelens", spells: ["flash", "smite"] },
  { id: "b-mid", name: "Nuc", team: "blue", role: "MID", kda: [5, 2, 9], cs: 284, gold: 22000, damage: 26100, level: 18, items: ["ludens_echo", "sorcerers_shoes"], trinket: "wardingtotem", spells: ["flash", "ignite"] },
  { id: "b-adc", name: "Paduck", team: "blue", role: "ADC", kda: [7, 2, 8], cs: 301, gold: 24600, damage: 34700, level: 18, items: ["kraken_slayer", "berserkers_greaves", "infinity_edge"], trinket: "wardingtotem", spells: ["flash", "heal"] },
  { id: "b-sup", name: "Trymbi", team: "blue", role: "SUP", kda: [1, 2, 17], cs: 41, gold: 14600, damage: 8800, level: 16, items: ["locket_of_the_iron_solari"], trinket: "oraclelens", spells: ["flash", "ignite"] },
  { id: "r-top", name: "Myrwn", team: "red", role: "TOP", kda: [4, 5, 3], cs: 226, gold: 19000, damage: 13900, level: 17, items: ["black_cleaver", "plated_steelcaps"], trinket: "wardingtotem", spells: ["flash", "teleport"] },
  { id: "r-jgl", name: "Elyoya", team: "red", role: "JGL", kda: [2, 5, 6], cs: 79, gold: 16400, damage: 10200, level: 17, items: ["black_cleaver"], trinket: "oraclelens", spells: ["flash", "smite"] },
  { id: "r-mid", name: "Jojopyun", team: "red", role: "MID", kda: [2, 4, 5], cs: 263, gold: 20800, damage: 20400, level: 17, items: ["ludens_echo"], trinket: "wardingtotem", spells: ["flash", "ignite"] },
  { id: "r-adc", name: "Supa", team: "red", role: "ADC", kda: [3, 4, 4], cs: 288, gold: 22500, damage: 24100, level: 18, items: ["kraken_slayer", "infinity_edge"], trinket: "wardingtotem", spells: ["flash", "heal"] },
  { id: "r-sup", name: "Alvaro", team: "red", role: "SUP", kda: [0, 3, 9], cs: 37, gold: 11800, damage: 6400, level: 16, items: [], trinket: "oraclelens", spells: ["flash", "ignite"] },
];

export function champion(spec: Spec, over: Partial<PostGameChampion> = {}): PostGameChampion {
  return {
    id: spec.id,
    name: spec.name,
    team: spec.team,
    role: spec.role,
    level: spec.level,
    kills: spec.kda[0],
    deaths: spec.kda[1],
    assists: spec.kda[2],
    cs: spec.cs,
    // Half in the purse, half spent: the screen reads gold earned as the two together.
    gold: Math.round(spec.gold / 4),
    spentGold: spec.gold - Math.round(spec.gold / 4),
    damageDealt: spec.damage,
    items: spec.items,
    trinketKey: spec.trinket,
    summonerSpells: spec.spells.map((key) => ({ key, cdUntil: 0 })),
    ...over,
  };
}

export const champions = (over: Partial<PostGameChampion> = {}): PostGameChampion[] => SPECS.map((spec) => champion(spec, over));

/** Gold difference at each minute (blue minus red), 0 to 31. */
const DIFF = [0, -150, -100, 350, 900, 1200, 1000, 1500, 1800, 2000, 1700, 2100, 2500, 2000, 2900, 3500, 3900, 5000, 6240, 7140, 7000, 6600, 6900, 6300, 5800, 5100, 5300, 5600, 6000, 5400, 6900, 7000];

export function goldSamples(minutes = DIFF.length): GoldSample[] {
  const samples: GoldSample[] = DIFF.slice(0, minutes).map((diff, minute) => ({
    minute,
    timeSec: minute * 60 + 1,
    diff,
    players: Object.fromEntries(SPECS.map((spec) => [spec.id, Math.round((spec.gold * (minute + 1)) / DIFF.length)])),
  }));
  samples.push({
    minute: Math.floor(END_SEC / 60),
    timeSec: END_SEC,
    diff: 8200,
    players: Object.fromEntries(SPECS.map((spec) => [spec.id, spec.gold])),
  });
  return samples;
}

const kill = (t: number, killer: string, victim: string, team: "blue" | "red"): KeyEvent => ({
  t,
  text: `${team.toUpperCase()} ${killer} killed ${victim}`,
  type: "kill",
  code: "champion_killed",
  data: { team, actor: killer, target: victim },
});
const dragon = (t: number, team: "blue" | "red", dragonKind: string): KeyEvent => ({
  t,
  text: `${team.toUpperCase()} secured the ${dragonKind} dragon`,
  type: "dragon",
  code: "dragon_secured",
  data: { team, dragonKind },
});
const structure = (t: number, team: "blue" | "red", id: string): KeyEvent => ({
  t,
  text: `${team.toUpperCase()} destroyed ${id}`,
  type: id.endsWith("nexus") ? "nexus" : "tower",
  code: "structure_destroyed",
  data: { team, structure: id },
});

export const KEY_EVENTS: KeyEvent[] = [
  kill(140, "Paduck", "Supa", "blue"),
  kill(221, "Sheo", "Alvaro", "blue"),
  dragon(428, "blue", "ocean"),
  dragon(730, "red", "cloud"),
  structure(768, "red", "blue-bot-outer"),
  { t: 785, text: "BLUE voidgrub", type: "info", code: "voidgrub_secured", data: { team: "blue" } },
  structure(881, "blue", "red-top-outer"),
  { t: 920, text: "RED herald", type: "info", code: "herald_secured", data: { team: "red" } },
  kill(1072, "Myrwn", "Rooster", "red"),
  dragon(1094, "blue", "mountain"),
  { t: 1776, text: "BLUE baron", type: "baron", code: "baron_secured", data: { team: "blue" } },
  structure(1862, "blue", "red-inhib-mid"),
  structure(1894, "blue", "red-nexus-bot-tower"),
  structure(END_SEC, "blue", "red-nexus"),
];

export const matchRecord = (over: Partial<MatchRecord> = {}): MatchRecord => ({
  gold: goldSamples(),
  events: KEY_EVENTS,
  skippedAtSec: null,
  ...over,
});

export function finishedMatch(over: Partial<PostGameState> = {}): PostGameState {
  return {
    timeSec: END_SEC,
    winner: "blue",
    stats: {
      blue: { kills: 21, towers: 7, dragons: 4, barons: 1, gold: 98700 },
      red: { kills: 11, towers: 2, dragons: 1, barons: 0, gold: 90500 },
    },
    champions: champions(),
    events: [],
    matchRecord: matchRecord(),
    ...over,
  };
}
