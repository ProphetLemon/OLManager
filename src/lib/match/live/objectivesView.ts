import { DRAGON_KINDS, readTeamBuffs, type DragonKind } from "@/lib/match/live/liveEvents";
import { PITS, type MapPoint, type TeamSide } from "@/lib/match/live/mapGeometry";

/**
 * View models of the two objective pits on the map and of the team bar. Pure,
 * and tolerant: the runtime state is cast from JSON, so every field is read
 * defensively and a missing one degrades to "unknown" or "absent", never throws.
 * Nothing here returns text.
 */

/** Length of the buffs, for a shrinking bar: the engine constants (`runtime.rs`). */
export const BARON_BUFF_SEC = 180;
export const ELDER_BUFF_SEC = 150;
/** A dragon needs this many stacks of one team for the next one to be the soul. */
export const SOUL_STACKS = 4;
/** The engine stores this when a timer has no next spawn. */
const NO_SPAWN_FALLBACK = 9_000_000;
const TOP_ORDER = ["voidgrubs", "herald", "baron"] as const;

// ── Input ───────────────────────────────────────────────────────────────

export interface TimerLike {
  alive?: boolean;
  hp?: number;
  maxHp?: number;
  nextSpawnAt?: number | null;
  unlocked?: boolean;
}

export interface ObjectivesStateLike {
  timeSec: number;
  objectives?: {
    dragon?: {
      alive?: boolean;
      nextSpawnAt?: number | null;
      currentKind?: string;
      soulRiftKind?: string;
      homeStacks?: number;
      awayStacks?: number;
      soulClaimedBy?: string | null;
    };
    baron?: { alive?: boolean; nextSpawnAt?: number | null };
  };
  neutralTimers?: {
    dragonSoulUnlocked?: boolean;
    elderUnlocked?: boolean;
    dragonCurrentKind?: string;
    /** The soul kind is rolled when the second dragon falls; the engine also keeps it here. */
    dragonSoulRiftKind?: string;
    entities?: Partial<Record<string, TimerLike>>;
  };
  stats?: Partial<Record<TeamSide, { kills?: number; towers?: number; dragons?: number; barons?: number; gold?: number }>>;
  /** Carrier of the rift herald charge; the engine removes both once it is used. */
  heraldCarrierId?: string | null;
  heraldTeam?: string | null;
}

// ── Helpers ─────────────────────────────────────────────────────────────

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const asSide = (value: unknown): TeamSide | null => {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return text === "blue" || text === "red" ? text : null;
};

export function asDragonKind(value: unknown): DragonKind | null {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return DRAGON_KINDS.find((kind) => kind === text) ?? null;
}

const hpPercent = (timer: TimerLike | undefined): number | null =>
  timer && isNumber(timer.hp) && isNumber(timer.maxHp) && timer.maxHp > 0
    ? Math.round(Math.max(0, Math.min(1, timer.hp / timer.maxHp)) * 100)
    : null;

function spawnAt(...values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    if (isNumber(value) && value < NO_SPAWN_FALLBACK) return value;
  }
  return null;
}

// ── Pits ────────────────────────────────────────────────────────────────

export type PitEntity = "dragon" | "elder" | "voidgrubs" | "herald" | "baron";

/** What the pit shows: HP while it is up, otherwise a countdown. Never a 0:00 countdown for something that is up. */
export type PitStatus =
  | { state: "alive"; hpPct: number | null }
  | { state: "countdown"; seconds: number }
  | { state: "none" };

export type SoulView =
  /** A team has the soul. */
  | { state: "claimed"; side: TeamSide; kind: DragonKind | null }
  /** A team is one dragon away from the soul. */
  | { state: "open"; sides: TeamSide[]; kind: DragonKind | null };

export interface HeraldCarrier {
  side: TeamSide;
  championId: string | null;
}

export interface PitView {
  id: "dragon" | "top";
  /** Position in the 1000 unit space of the overlay. */
  pos: MapPoint;
  entity: PitEntity;
  /** Kind of the dragon in the pit; null for every other entity. */
  dragonKind: DragonKind | null;
  status: PitStatus;
  /** Dragon pit only. */
  soul: SoulView | null;
  /** Top pit only. */
  heraldCarrier: HeraldCarrier | null;
}

export function statusOf(timer: TimerLike | undefined, fallbackNext: number | null | undefined, now: number): PitStatus {
  if (timer?.alive) return { state: "alive", hpPct: hpPercent(timer) };
  const next = spawnAt(timer?.nextSpawnAt, fallbackNext);
  return next === null ? { state: "none" } : { state: "countdown", seconds: Math.max(0, next - now) };
}

function soulOf(state: ObjectivesStateLike): SoulView | null {
  const dragon = state.objectives?.dragon;
  const blue = readTeamBuffs(state, "blue");
  const red = readTeamBuffs(state, "red");
  const rift = asDragonKind(dragon?.soulRiftKind) ?? asDragonKind(state.neutralTimers?.dragonSoulRiftKind);
  const claimedBy = dragon?.soulClaimedBy === "Home" ? "blue" : dragon?.soulClaimedBy === "Away" ? "red" : null;
  const holder: TeamSide | null = blue.soulKind ? "blue" : red.soulKind ? "red" : claimedBy;
  if (holder) {
    const own = asDragonKind(holder === "blue" ? blue.soulKind : red.soulKind);
    return { state: "claimed", side: holder, kind: own ?? rift };
  }
  const stacks: Record<TeamSide, number> = {
    blue: Math.max(isNumber(dragon?.homeStacks) ? dragon.homeStacks : 0, blue.dragonStacks),
    red: Math.max(isNumber(dragon?.awayStacks) ? dragon.awayStacks : 0, red.dragonStacks),
  };
  const sides = (["blue", "red"] as const).filter((side) => stacks[side] >= SOUL_STACKS - 1);
  return sides.length > 0 ? { state: "open", sides, kind: rift } : null;
}

function dragonPit(state: ObjectivesStateLike): PitView {
  const timers = state.neutralTimers;
  const entities = timers?.entities;
  const dragonObjective = state.objectives?.dragon;
  const elder = entities?.elder;
  const elderUp = Boolean(timers?.elderUnlocked || elder?.unlocked);
  const soul = soulOf(state);

  if (elderUp) {
    return {
      id: "dragon",
      pos: PITS.dragon,
      entity: "elder",
      dragonKind: null,
      status: statusOf(elder, null, state.timeSec),
      soul,
      heraldCarrier: null,
    };
  }
  const kind = asDragonKind(dragonObjective?.currentKind) ?? asDragonKind(timers?.dragonCurrentKind);
  const timer = entities?.dragon;
  return {
    id: "dragon",
    pos: PITS.dragon,
    entity: "dragon",
    dragonKind: kind,
    status: statusOf(timer ?? (dragonObjective ? { alive: dragonObjective.alive } : undefined), dragonObjective?.nextSpawnAt, state.timeSec),
    soul,
    heraldCarrier: null,
  };
}

function heraldCarrierOf(state: ObjectivesStateLike): HeraldCarrier | null {
  const side = asSide(state.heraldTeam);
  if (!side) return null;
  return { side, championId: typeof state.heraldCarrierId === "string" && state.heraldCarrierId ? state.heraldCarrierId : null };
}

function topPit(state: ObjectivesStateLike): PitView {
  const entities = state.neutralTimers?.entities;
  const now = state.timeSec;
  const base = { id: "top", pos: PITS.top, dragonKind: null, soul: null, heraldCarrier: heraldCarrierOf(state) } as const;

  // Grubs, then the herald, then Baron: the first one that is up.
  for (const entity of TOP_ORDER) {
    const timer = entities?.[entity];
    if (timer?.alive) return { ...base, entity, status: statusOf(timer, null, now) };
  }
  // Nothing is up: count down to the next one to appear.
  let next: { entity: PitEntity; at: number } | null = null;
  for (const entity of TOP_ORDER) {
    const at = spawnAt(entities?.[entity]?.nextSpawnAt);
    if (at !== null && (!next || at < next.at)) next = { entity, at };
  }
  if (next) return { ...base, entity: next.entity, status: { state: "countdown", seconds: Math.max(0, next.at - now) } };

  // Older state without the timers: the baron objective is all there is.
  const baron = state.objectives?.baron;
  return { ...base, entity: "baron", status: statusOf(baron?.alive ? { alive: true } : undefined, baron?.nextSpawnAt, now) };
}

/** The dragon pit, then the top pit. */
export function pitViews(state: ObjectivesStateLike): PitView[] {
  return [dragonPit(state), topPit(state)];
}

// ── Team bar ────────────────────────────────────────────────────────────

/** One of the four dragon pips: the kind taken, `unknown` when the count is known but not the kind, null when empty. */
export type DragonPip = DragonKind | "unknown" | null;

export interface BuffView {
  /** Seconds left, always above 0. */
  remainingSec: number;
  totalSec: number;
}

export interface TeamBarSide {
  side: TeamSide;
  kills: number;
  /** Towers this team destroyed. */
  towers: number;
  gold: number;
  barons: number;
  /** Void grub stacks, 0 to 3. */
  grubs: number;
  dragons: number;
  /** Always four entries, oldest dragon first. */
  dragonPips: DragonPip[];
  soulKind: DragonKind | null;
  /** Null when never taken or already over. */
  baronBuff: BuffView | null;
  elderBuff: BuffView | null;
}

export interface TeamBarView {
  blue: TeamBarSide;
  red: TeamBarSide;
}

const PIP_COUNT = 4;

function buffOf(until: number, now: number, totalSec: number): BuffView | null {
  const remaining = Math.max(0, until - now);
  return remaining > 0 ? { remainingSec: remaining, totalSec } : null;
}

function barSide(state: ObjectivesStateLike, side: TeamSide): TeamBarSide {
  const stats = state.stats?.[side];
  const buffs = readTeamBuffs(state, side);
  const dragons = isNumber(stats?.dragons) ? stats.dragons : buffs.dragonStacks;
  const pips: DragonPip[] = [];
  for (let index = 0; index < PIP_COUNT; index += 1) {
    const named = buffs.dragonHistory[index];
    pips.push(named !== undefined ? (asDragonKind(named) ?? "unknown") : index < dragons ? "unknown" : null);
  }
  return {
    side,
    kills: isNumber(stats?.kills) ? stats.kills : 0,
    towers: isNumber(stats?.towers) ? stats.towers : 0,
    gold: isNumber(stats?.gold) ? stats.gold : 0,
    barons: isNumber(stats?.barons) ? stats.barons : 0,
    grubs: buffs.voidgrubStacks,
    dragons,
    dragonPips: pips,
    soulKind: asDragonKind(buffs.soulKind),
    baronBuff: buffOf(buffs.baronUntil, state.timeSec, BARON_BUFF_SEC),
    elderBuff: buffOf(buffs.elderUntil, state.timeSec, ELDER_BUFF_SEC),
  };
}

export function teamBarView(state: ObjectivesStateLike): TeamBarView {
  return { blue: barSide(state, "blue"), red: barSide(state, "red") };
}
