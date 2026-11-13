import { markerState, type MarkerState } from "@/lib/match/live/championMarker";
import type { ContactChampion } from "@/lib/match/live/contacts";

/**
 * What a player card says, as data. The words come later from i18next and the item catalogue;
 * nothing here returns text. Tolerant: the runtime state is cast from JSON, so every optional
 * field reads as "absent" and never throws.
 */

/** A player carries six item slots. */
export const ITEM_SLOTS = 6;

export interface CardChampion extends ContactChampion {
  name: string;
  team: "blue" | "red";
  role: string;
  level: number;
  hp: number;
  maxHp: number;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  gold: number;
  spentGold: number;
  items: readonly string[];
  trinketKey?: string;
  wardCdUntil?: number;
  sweeperCdUntil?: number;
  sweeperActiveUntil?: number;
  summonerSpells?: ReadonlyArray<{ key: string; cdUntil: number }>;
  ultimate?: { cdUntil: number } | null;
}

const isTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Whole seconds until `until`, rounded up so a cooldown never reads 0 while something is left. */
const secondsLeft = (until: unknown, nowSec: number): number => (isTime(until) ? Math.max(0, Math.ceil(until - nowSec)) : 0);

// ── Cooldowns ───────────────────────────────────────────────────────────

export type CooldownKind = "ultimate" | "summoner" | "trinket";

export interface CooldownChip {
  kind: CooldownKind;
  /** The letter on the chip: R for the ultimate, the first letter of a summoner spell, W or O for the trinket. */
  letter: string;
  /** Summoner spell key, or the catalogue key of the trinket; null for the ultimate. */
  key: string | null;
  /** Whole seconds left; 0 means ready. */
  seconds: number;
}

const ULTIMATE_LETTER = "R";
const TRINKET_LETTER: Readonly<Record<string, string>> = { wardingtotem: "W", oraclelens: "O" };
const TRINKET_ITEM: Readonly<Record<string, string>> = { wardingtotem: "stealth_ward", oraclelens: "oracle_lens" };

/** Ultimate, the two summoner spells and the trinket, in that order. A cooldown the engine does not send is left out. */
export function cooldownChips(champion: CardChampion, nowSec: number): CooldownChip[] {
  const chips: CooldownChip[] = [];
  if (champion.ultimate) {
    chips.push({ kind: "ultimate", letter: ULTIMATE_LETTER, key: null, seconds: secondsLeft(champion.ultimate.cdUntil, nowSec) });
  }
  for (const spell of (champion.summonerSpells ?? []).slice(0, 2)) {
    const key = spell.key.trim().toLowerCase();
    if (!key) continue;
    chips.push({ kind: "summoner", letter: key.charAt(0).toUpperCase(), key, seconds: secondsLeft(spell.cdUntil, nowSec) });
  }
  const trinket = champion.trinketKey?.trim().toLowerCase();
  if (trinket && TRINKET_ITEM[trinket]) {
    // The lens counts down while it is active and then through its cooldown; the totem has one cooldown.
    const seconds =
      trinket === "oraclelens"
        ? secondsLeft(champion.sweeperActiveUntil, nowSec) || secondsLeft(champion.sweeperCdUntil, nowSec)
        : secondsLeft(champion.wardCdUntil, nowSec);
    chips.push({ kind: "trinket", letter: TRINKET_LETTER[trinket], key: TRINKET_ITEM[trinket], seconds });
  }
  return chips;
}

// ── Gold ────────────────────────────────────────────────────────────────

/** Gold earned: the purse plus what was spent. A record with no `spentGold` (older stored results) falls back to `gold`. */
export const totalGold = (champion: { gold?: number; spentGold?: number }): number =>
  (isTime(champion.gold) ? champion.gold : 0) + (isTime(champion.spentGold) ? champion.spentGold : 0);

export interface GoldGap {
  direction: "even" | "ahead" | "behind";
  /** Size of the gap, never negative. */
  amount: number;
}

/** The champion of the other team in the same role, or undefined when there is none. */
export function opposingChampion<T extends Pick<CardChampion, "team" | "role">>(champion: T, all: readonly T[]): T | undefined {
  return all.find((other) => other.team !== champion.team && other.role === champion.role);
}

/** Total gold against the opposing laner, or null when nobody stands opposite. */
export function goldGap(champion: CardChampion, opponent: CardChampion | undefined): GoldGap | null {
  if (!opponent) return null;
  const diff = totalGold(champion) - totalGold(opponent);
  const amount = Math.abs(Math.round(diff));
  return { direction: amount === 0 ? "even" : diff > 0 ? "ahead" : "behind", amount };
}

// ── State and description ───────────────────────────────────────────────

/** The one state a card shows: the marker's, or "lane" for a champion who is just walking. */
export type CardState = MarkerState | { kind: "lane"; seconds: 0 };

export function cardState(champion: CardChampion, fighting: boolean, nowSec: number): CardState {
  return markerState(champion, fighting, nowSec) ?? { kind: "lane", seconds: 0 };
}

export interface CardDescriptionParts {
  level: number;
  alive: boolean;
  hp: number;
  maxHp: number;
  /** Whole seconds until respawn, 0 when alive. */
  respawnSec: number;
  state: CardState;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  totalGold: number;
  gap: GoldGap | null;
  opponentRole: string | null;
  /** The items bought, in slot order, at most six. */
  itemKeys: string[];
  emptySlots: number;
  cooldowns: CooldownChip[];
}

export function cardDescriptionParts(
  champion: CardChampion,
  opponent: CardChampion | undefined,
  fighting: boolean,
  nowSec: number,
): CardDescriptionParts {
  const itemKeys = champion.items.filter((key) => typeof key === "string" && key.length > 0).slice(0, ITEM_SLOTS);
  return {
    level: champion.level,
    alive: champion.alive,
    hp: Math.max(0, Math.round(champion.hp)),
    maxHp: Math.max(0, Math.round(champion.maxHp)),
    respawnSec: champion.alive ? 0 : secondsLeft(champion.respawnAt, nowSec),
    state: cardState(champion, fighting, nowSec),
    kills: champion.kills,
    deaths: champion.deaths,
    assists: champion.assists,
    cs: champion.cs,
    totalGold: totalGold(champion),
    gap: goldGap(champion, opponent),
    opponentRole: opponent?.role ?? null,
    itemKeys,
    emptySlots: ITEM_SLOTS - itemKeys.length,
    cooldowns: cooldownChips(champion, nowSec),
  };
}
