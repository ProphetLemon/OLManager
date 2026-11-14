import { readTeamBuffs } from "@/lib/match/live/liveEvents";
import type { TeamSide } from "@/lib/match/live/mapGeometry";
import { newKeyEventLog, recordKeyEvents, type KeyEvent, type MatchRecord } from "@/lib/match/live/matchRecord";
import { ITEM_SLOTS, TRINKET_ITEM, totalGold } from "@/lib/match/live/playerCardView";

/**
 * The numbers of the post-game screen, as data. Pure: the finished state of the match goes in, and
 * rows, totals, bars and the MVP come out. Nothing here returns a sentence; the screen translates.
 * Whatever the engine did not send comes out as null, never as a zero a person would read as real.
 */

export type Side = TeamSide;

/** Top to bottom, as the lanes are read. */
export const ROLE_ORDER = ["TOP", "JGL", "MID", "ADC", "SUP"] as const;
const roleRank = (role: string): number => {
  const rank = ROLE_ORDER.indexOf(role as (typeof ROLE_ORDER)[number]);
  return rank === -1 ? ROLE_ORDER.length : rank;
};

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const whole = (value: unknown): number => (isNumber(value) ? Math.round(value) : 0);

export interface PostGameChampion {
  id: string;
  name: string;
  team: Side;
  role: string;
  /** A simulated result has no level, CS or items: they are left out, not zero. */
  level?: number;
  kills: number;
  deaths: number;
  assists: number;
  cs?: number;
  gold?: number;
  spentGold?: number;
  /** Damage to enemy champions. Only the Rust engine sends it. */
  damageDealt?: number;
  items?: readonly string[];
  trinketKey?: string;
  summonerSpells?: ReadonlyArray<{ key: string }>;
}

interface StatsLike {
  kills?: number;
  towers?: number;
  dragons?: number;
  barons?: number;
  gold?: number;
}

/** The finished state of a match, as far as the screen reads it. */
export interface PostGameState {
  timeSec: number;
  winner: Side | null;
  stats?: { blue?: StatsLike; red?: StatsLike };
  champions?: PostGameChampion[];
  /** The engine's own list: its last 200 events. Only used when there is no record. */
  events?: KeyEvent[];
  /** A result that names its MVP (a simulation) overrides the score used for a match played out. */
  mvpId?: string;
  /** Counts the engine's events cannot give (a simulated result knows them). */
  counts?: Partial<Record<Side, { grubs: number; heralds: number }>>;
  matchRecord?: MatchRecord;
}

export interface PlayerRow {
  id: string;
  name: string;
  side: Side;
  role: string;
  level: number | null;
  kills: number;
  deaths: number;
  assists: number;
  cs: number | null;
  /** Gold earned: the purse plus what was spent. */
  gold: number;
  damage: number | null;
  /** Null when the match has no item data at all (a simulated result). */
  items: string[] | null;
  /** Catalogue key of the trinket's icon, or null when the engine sent none. */
  trinket: string | null;
  spells: string[];
  mvp: boolean;
}

export interface TeamTotals {
  side: Side;
  won: boolean;
  kills: number;
  deaths: number;
  assists: number;
  /** Null when any player's CS is unknown. */
  cs: number | null;
  gold: number;
  /** Null when any player's damage was not sent. */
  damage: number | null;
  towers: number;
  dragons: number;
  barons: number;
  grubs: number;
  /** Null when the match was skipped or has no record: the herald events are not all known. */
  heralds: number | null;
}

export interface Scoreboard {
  winner: Side | null;
  durationSec: number;
  rows: Record<Side, PlayerRow[]>;
  totals: Record<Side, TeamTotals>;
  mvp: PlayerRow | null;
}

/** The key events the screen shows: the match's own record, or what the engine still held. */
export function keyEventsOf(state: Pick<PostGameState, "matchRecord" | "events">): KeyEvent[] {
  if (state.matchRecord) return state.matchRecord.events;
  const log = newKeyEventLog();
  recordKeyEvents(log, state.events);
  return log.events;
}

/** Winner-side score the old result screen used; kept so the same player is named. */
const mvpScore = (row: PlayerRow): number => row.kills * 3 + row.assists * 1.6 - row.deaths * 1.25 + (row.cs ?? 0) * 0.02 + row.gold * 0.001;

function rowOf(champion: PostGameChampion): PlayerRow {
  const trinket = champion.trinketKey?.trim().toLowerCase();
  return {
    id: champion.id,
    name: champion.name,
    side: champion.team,
    role: champion.role,
    level: isNumber(champion.level) ? Math.round(champion.level) : null,
    kills: whole(champion.kills),
    deaths: whole(champion.deaths),
    assists: whole(champion.assists),
    cs: isNumber(champion.cs) ? Math.round(champion.cs) : null,
    gold: Math.round(totalGold(champion)),
    damage: isNumber(champion.damageDealt) ? Math.round(champion.damageDealt) : null,
    items: champion.items ? champion.items.filter((item) => typeof item === "string" && item.trim()).slice(0, ITEM_SLOTS) : null,
    trinket: trinket ? (TRINKET_ITEM[trinket] ?? null) : null,
    spells: (champion.summonerSpells ?? []).map((spell) => spell.key.trim().toLowerCase()).filter(Boolean).slice(0, 2),
    mvp: false,
  };
}

const sum = (rows: readonly PlayerRow[], pick: (row: PlayerRow) => number): number => rows.reduce((total, row) => total + pick(row), 0);

function heraldCount(state: PostGameState, side: Side): number | null {
  const counted = state.counts?.[side]?.heralds;
  if (isNumber(counted)) return counted;
  const record = state.matchRecord;
  if (!record || record.skippedAtSec !== null) return null;
  return record.events.filter((event) => event.code === "herald_secured" && event.data?.team === side).length;
}

function totalsOf(state: PostGameState, side: Side, rows: readonly PlayerRow[]): TeamTotals {
  const stats = state.stats?.[side];
  return {
    side,
    won: state.winner === side,
    kills: isNumber(stats?.kills) ? Math.round(stats.kills) : sum(rows, (row) => row.kills),
    deaths: sum(rows, (row) => row.deaths),
    assists: sum(rows, (row) => row.assists),
    cs: rows.length > 0 && rows.every((row) => row.cs !== null) ? sum(rows, (row) => row.cs ?? 0) : null,
    gold: sum(rows, (row) => row.gold),
    damage: rows.length > 0 && rows.every((row) => row.damage !== null) ? sum(rows, (row) => row.damage ?? 0) : null,
    towers: whole(stats?.towers),
    dragons: whole(stats?.dragons),
    barons: whole(stats?.barons),
    grubs: state.counts?.[side]?.grubs ?? readTeamBuffs(state, side).voidgrubStacks,
    heralds: heraldCount(state, side),
  };
}

export function buildScoreboard(state: PostGameState): Scoreboard {
  const all = (state.champions ?? []).map(rowOf);
  const rows: Record<Side, PlayerRow[]> = {
    blue: all.filter((row) => row.side === "blue").sort((a, b) => roleRank(a.role) - roleRank(b.role)),
    red: all.filter((row) => row.side === "red").sort((a, b) => roleRank(a.role) - roleRank(b.role)),
  };
  const winners = state.winner ? rows[state.winner] : [];
  const named = state.mvpId ? all.find((row) => row.id === state.mvpId) : undefined;
  const mvp = named ?? [...winners].sort((a, b) => mvpScore(b) - mvpScore(a))[0] ?? null;
  if (mvp) mvp.mvp = true;
  return {
    winner: state.winner,
    durationSec: isNumber(state.timeSec) ? Math.max(0, Math.floor(state.timeSec)) : 0,
    rows,
    totals: { blue: totalsOf(state, "blue", rows.blue), red: totalsOf(state, "red", rows.red) },
    mvp,
  };
}

// ── Bars ────────────────────────────────────────────────────────────────

export type BarMetric = "damage" | "gold";

export interface BarRow {
  id: string;
  name: string;
  side: Side;
  value: number;
  /** Share of the team's total, 0 to 1. */
  share: number;
  /** Against the biggest bar of both teams, 0 to 1. */
  width: number;
}

export interface BarGroup {
  side: Side;
  total: number;
  rows: BarRow[];
}

export interface BarChart {
  groups: BarGroup[];
  max: number;
  top: BarRow;
}

/** The bars of one stat for both teams, or null when it cannot be drawn without a made-up value. */
export function barChart(board: Scoreboard, metric: BarMetric): BarChart | null {
  const value = (row: PlayerRow): number | null => (metric === "damage" ? row.damage : row.gold);
  const everyone = [...board.rows.blue, ...board.rows.red];
  if (everyone.length === 0 || everyone.some((row) => value(row) === null)) return null;
  const max = Math.max(1, ...everyone.map((row) => value(row) ?? 0));
  const groups = (["blue", "red"] as const).map<BarGroup>((side) => {
    const total = board.rows[side].reduce((acc, row) => acc + (value(row) ?? 0), 0);
    const rows = [...board.rows[side]]
      .sort((a, b) => (value(b) ?? 0) - (value(a) ?? 0))
      .map<BarRow>((row) => ({
        id: row.id,
        name: row.name,
        side,
        value: value(row) ?? 0,
        share: total > 0 ? (value(row) ?? 0) / total : 0,
        width: (value(row) ?? 0) / max,
      }));
    return { side, total, rows };
  });
  const top = groups.flatMap((group) => group.rows).sort((a, b) => b.value - a.value)[0];
  return { groups, max, top };
}

/** A player's gold earned at a minute of the match, or null when nobody saw that minute. */
export function goldAtMinute(record: MatchRecord | null | undefined, playerId: string, minute: number): number | null {
  const sample = record?.gold.find((candidate) => candidate.minute === minute);
  const gold = sample?.players[playerId];
  return isNumber(gold) ? gold : null;
}
