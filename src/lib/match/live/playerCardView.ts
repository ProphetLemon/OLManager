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
  ultimate?: { cdUntil: number; icon?: string; archetype?: string } | null;
}

const isTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Whole seconds until `until`, rounded up so a cooldown never reads 0 while something is left. */
const secondsLeft = (until: unknown, nowSec: number): number => (isTime(until) ? Math.max(0, Math.ceil(until - nowSec)) : 0);

// ── Cooldowns ───────────────────────────────────────────────────────────

export type CooldownKind = "ultimate" | "summoner" | "trinket";

/** What a cooldown chip shows: ready to use, counting down, or not yet unlocked (the ultimate before its level). */
export type CooldownState = "ready" | "waiting" | "locked";

/** The level at which a champion learns the ultimate; the engine casts none before it (`ULTIMATE_UNLOCK_LEVEL`). */
export const ULTIMATE_UNLOCK_LEVEL = 6;

export interface CooldownChip {
  kind: CooldownKind;
  state: CooldownState;
  /** The letter of a summoner spell and the ultimate's last resort, on the chip when no icon shows; empty for a trinket. */
  letter: string;
  /** Summoner spell key, or the catalogue key of the trinket; null for the ultimate. */
  key: string | null;
  /** Whole seconds left; 0 when ready or locked. */
  seconds: number;
  /** Image of the ultimate or the trinket; null when the engine sent none and for a summoner spell. */
  icon: string | null;
  /** The ultimate's archetype, for the glyph that stands in for a missing icon. */
  archetype: string | null;
  /** The level that unlocks the ultimate; only on a locked chip. */
  unlockLevel: number | null;
}

const ULTIMATE_LETTER = "R";
const TRINKET_ITEM: Readonly<Record<string, string>> = { wardingtotem: "stealth_ward", oraclelens: "oracle_lens" };

const stateOf = (seconds: number): CooldownState => (seconds > 0 ? "waiting" : "ready");
const textOrNull = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

/** Ultimate, the two summoner spells and the trinket, in that order. A cooldown the engine does not send is left out. */
export function cooldownChips(champion: CardChampion, nowSec: number): CooldownChip[] {
  const chips: CooldownChip[] = [];
  if (champion.ultimate) {
    // Before the unlock level the engine sends a cooldown of 0, which would read as "ready".
    const locked = !(champion.level >= ULTIMATE_UNLOCK_LEVEL);
    const seconds = locked ? 0 : secondsLeft(champion.ultimate.cdUntil, nowSec);
    chips.push({
      kind: "ultimate",
      state: locked ? "locked" : stateOf(seconds),
      letter: ULTIMATE_LETTER,
      key: null,
      seconds,
      icon: textOrNull(champion.ultimate.icon),
      archetype: textOrNull(champion.ultimate.archetype),
      unlockLevel: locked ? ULTIMATE_UNLOCK_LEVEL : null,
    });
  }
  for (const spell of (champion.summonerSpells ?? []).slice(0, 2)) {
    const key = spell.key.trim().toLowerCase();
    if (!key) continue;
    const seconds = secondsLeft(spell.cdUntil, nowSec);
    chips.push({
      kind: "summoner",
      state: stateOf(seconds),
      letter: key.charAt(0).toUpperCase(),
      key,
      seconds,
      icon: null,
      archetype: null,
      unlockLevel: null,
    });
  }
  const trinket = champion.trinketKey?.trim().toLowerCase();
  if (trinket && TRINKET_ITEM[trinket]) {
    // The lens counts down while it is active and then through its cooldown; the totem has one cooldown.
    const seconds =
      trinket === "oraclelens"
        ? secondsLeft(champion.sweeperActiveUntil, nowSec) || secondsLeft(champion.sweeperCdUntil, nowSec)
        : secondsLeft(champion.wardCdUntil, nowSec);
    chips.push({
      kind: "trinket",
      state: stateOf(seconds),
      letter: "",
      key: TRINKET_ITEM[trinket],
      seconds,
      icon: `/lol-item-icons/${TRINKET_ITEM[trinket]}.png`,
      archetype: null,
      unlockLevel: null,
    });
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
