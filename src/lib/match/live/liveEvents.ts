import type { LaneKey, TeamSide } from "@/lib/match/live/mapGeometry";

/**
 * Engine events (`{ t, text, type }`, capped at 200 by the Rust side) become
 * typed feed entries. Nothing here returns an English sentence: the entries
 * carry kinds and params, and the UI maps them to translation keys. Unknown or
 * malformed text degrades to a neutral entry; nothing throws.
 */

export interface RosterEntry {
  id: string;
  name: string;
  team: TeamSide;
}

export interface FeedSourceEvent {
  t?: number;
  text?: string;
  type?: string;
}

export interface FeedActor {
  name: string;
  /** Champion id when the name is in the roster. */
  id: string | null;
  team: TeamSide | null;
}

export type StructurePart =
  | "outer-tower"
  | "inner-tower"
  | "inhibitor-tower"
  | "nexus-tower"
  | "inhibitor"
  | "nexus"
  | "unknown";

/** A structure id read as parts; the UI turns it into words. */
export interface StructureLabel {
  id: string;
  owner: TeamSide | null;
  part: StructurePart;
  /** Lane of the structure; null for the nexus and unknown ids. */
  lane: LaneKey | null;
}

export type DragonKind = "infernal" | "ocean" | "mountain" | "cloud" | "hextech" | "chemtech";
export type NeutralObjective = "voidgrub" | "voidgrub-camp" | "herald" | "scuttle";

interface EntryBase {
  /** Stable across commits, so a list can key on it. */
  id: string;
  t: number;
  /** Event type as the engine sent it. */
  rawType: string;
  /** Team that did it, when the text names one. */
  side: TeamSide | null;
}

export interface KillEntry extends EntryBase {
  kind: "kill";
  killer: FeedActor;
  victim: FeedActor;
  /** "tower", "minion"... as the engine wrote it, lowercased. */
  cause: string | null;
  /** Killed by the ignite burn: "X ignited Y". */
  ignite: boolean;
}
export interface TowerEntry extends EntryBase {
  kind: "tower";
  structure: StructureLabel;
}
export interface NexusEntry extends EntryBase {
  kind: "nexus";
  structure: StructureLabel;
}
export interface DragonEntry extends EntryBase {
  kind: "dragon";
  /** Null when the engine named a kind this build does not know. */
  dragonKind: DragonKind | null;
}
export interface BaronEntry extends EntryBase {
  kind: "baron";
}
export interface ElderEntry extends EntryBase {
  kind: "elder";
}
export interface ObjectiveEntry extends EntryBase {
  kind: "objective";
  objective: NeutralObjective;
}
export interface NeutralEntry extends EntryBase {
  kind: "neutral";
  /** The raw engine text, for a fallback line. */
  text: string;
}

export type FeedEntry =
  | KillEntry
  | TowerEntry
  | NexusEntry
  | DragonEntry
  | BaronEntry
  | ElderEntry
  | ObjectiveEntry
  | NeutralEntry;

// ── Sides and structures ────────────────────────────────────────────────

const BLUE_TOKEN = /^(BLUE|HOME)\b/i;
const RED_TOKEN = /^(RED|AWAY)\b/i;

export function sideFromText(text: string): TeamSide | null {
  const head = text.trim();
  if (BLUE_TOKEN.test(head)) return "blue";
  if (RED_TOKEN.test(head)) return "red";
  return null;
}

function asSide(value: string | undefined): TeamSide | null {
  return value === "blue" || value === "red" ? value : null;
}

function asLane(value: string | undefined): LaneKey | null {
  return value === "top" || value === "mid" || value === "bot" ? value : null;
}

/**
 * `blue-top-outer`, `red-mid-inhib-tower`, `blue-inhib-bot`, `red-nexus-bot-tower`,
 * `blue-nexus`. Anything else comes back as `unknown` with the id kept.
 */
export function structureLabel(id: string): StructureLabel {
  const parts = id.split("-");
  const owner = asSide(parts[0]);
  const unknown: StructureLabel = { id, owner, part: "unknown", lane: null };
  if (!owner) return unknown;

  if (parts.length === 2 && parts[1] === "nexus") return { id, owner, part: "nexus", lane: null };
  if (parts.length === 4 && parts[1] === "nexus" && parts[3] === "tower") {
    const lane = asLane(parts[2]);
    return lane ? { id, owner, part: "nexus-tower", lane } : unknown;
  }
  if (parts.length === 3 && parts[1] === "inhib") {
    const lane = asLane(parts[2]);
    return lane ? { id, owner, part: "inhibitor", lane } : unknown;
  }
  const lane = asLane(parts[1]);
  if (!lane) return unknown;
  if (parts.length === 4 && parts[2] === "inhib" && parts[3] === "tower") {
    return { id, owner, part: "inhibitor-tower", lane };
  }
  if (parts.length === 3 && parts[2] === "outer") return { id, owner, part: "outer-tower", lane };
  if (parts.length === 3 && parts[2] === "inner") return { id, owner, part: "inner-tower", lane };
  return unknown;
}

// ── Single events ───────────────────────────────────────────────────────

const KILL_VERB = /\s+(?:killed|slain|eliminated|ignited)\s+/gi;
const CAUSE_TAIL = /^(.*?)\s+\(([^()]+)\)\s*$/;
const DRAGON_KINDS: readonly DragonKind[] = ["infernal", "ocean", "mountain", "cloud", "hextech", "chemtech"];

function actor(name: string, roster: readonly RosterEntry[]): FeedActor {
  const wanted = name.trim().toLowerCase();
  const hit = roster.find((r) => r.name.trim().toLowerCase() === wanted);
  return { name: name.trim(), id: hit?.id ?? null, team: hit?.team ?? null };
}

/** The roster decides where "A killed B" splits when a name holds a verb. */
function splitKill(text: string, roster: readonly RosterEntry[]): { killer: string; victim: string; cause: string | null; ignite: boolean } | null {
  const tail = CAUSE_TAIL.exec(text);
  const body = tail ? tail[1] : text;
  const cause = tail ? tail[2].trim().toLowerCase() : null;
  const known = new Set(roster.map((r) => r.name.trim().toLowerCase()));
  let first: { killer: string; victim: string; verb: string } | null = null;
  for (const match of body.matchAll(KILL_VERB)) {
    const at = match.index ?? 0;
    const killer = body.slice(0, at).trim();
    const victim = body.slice(at + match[0].length).trim();
    if (!killer || !victim) continue;
    const verb = match[0].trim().toLowerCase();
    const candidate = { killer, victim, verb };
    if (known.has(killer.toLowerCase()) && known.has(victim.toLowerCase())) {
      first = candidate;
      break;
    }
    first ??= candidate;
  }
  if (!first) return null;
  const ignite = first.verb === "ignited";
  return { killer: first.killer, victim: first.victim, cause: ignite ? null : cause, ignite };
}

function neutralObjective(text: string): NeutralObjective | null {
  if (/voidgrub/i.test(text)) return /camp/i.test(text) ? "voidgrub-camp" : "voidgrub";
  if (/herald/i.test(text)) return "herald";
  if (/scuttle/i.test(text)) return "scuttle";
  return null;
}

function entryId(t: number, rawType: string, text: string): string {
  return `${rawType}|${t}|${text}`;
}

export function parseEvent(ev: FeedSourceEvent | null | undefined, roster: readonly RosterEntry[] = []): FeedEntry {
  const text = typeof ev?.text === "string" ? ev.text : "";
  const rawType = typeof ev?.type === "string" ? ev.type : "";
  const t = typeof ev?.t === "number" && Number.isFinite(ev.t) ? ev.t : 0;
  const side = sideFromText(text);
  const base = { id: entryId(t, rawType, text), t, rawType, side };
  const neutral: NeutralEntry = { ...base, kind: "neutral", text };

  switch (rawType) {
    case "kill": {
      const split = splitKill(text, roster);
      if (!split) return neutral;
      const killer = actor(split.killer, roster);
      const victim = actor(split.victim, roster);
      return { ...base, kind: "kill", side: killer.team, killer, victim, cause: split.cause, ignite: split.ignite };
    }
    case "tower":
    case "nexus": {
      const target = / destroyed\s+(\S+)\s*$/i.exec(text)?.[1];
      if (!target) return neutral;
      const structure = structureLabel(target);
      return rawType === "nexus" ? { ...base, kind: "nexus", structure } : { ...base, kind: "tower", structure };
    }
    case "dragon": {
      if (/\belder\b/i.test(text)) return { ...base, kind: "elder" };
      const named = /\bsecured\s+(\w+)\s+dragon\b/i.exec(text)?.[1]?.toLowerCase();
      if (!named) return neutral;
      const dragonKind = DRAGON_KINDS.find((kind) => kind === named) ?? null;
      return { ...base, kind: "dragon", dragonKind };
    }
    case "baron":
      return { ...base, kind: "baron" };
    case "info": {
      const objective = neutralObjective(text);
      return objective ? { ...base, kind: "objective", objective } : neutral;
    }
    default:
      return neutral;
  }
}

// ── The feed ────────────────────────────────────────────────────────────

/** Engine types the feed leaves out: spawns and recalls are not news. */
const SILENT_TYPES = new Set(["spawn", "recall"]);

/**
 * Newest first. Unparseable kill, tower, dragon, baron and nexus events stay as
 * neutral entries (the engine said they matter); spawn, recall and `info`
 * events that are not an objective are dropped. Ids repeat when the engine logs
 * the same line twice in one tick, so a counter keeps them unique and stable.
 */
export function parseFeed(
  events: readonly FeedSourceEvent[] | null | undefined,
  roster: readonly RosterEntry[] = [],
  limit = 8,
): FeedEntry[] {
  if (!events || events.length === 0 || limit <= 0) return [];
  const seen = new Map<string, number>();
  const entries: FeedEntry[] = [];
  for (const ev of events) {
    const entry = parseEvent(ev, roster);
    const count = seen.get(entry.id) ?? 0;
    seen.set(entry.id, count + 1);
    if (SILENT_TYPES.has(entry.rawType) || (entry.kind === "neutral" && entry.rawType === "info")) continue;
    entries.push(count === 0 ? entry : { ...entry, id: `${entry.id}#${count}` });
  }
  return entries.reverse().slice(0, limit);
}

// ── Team buffs ──────────────────────────────────────────────────────────

export interface TeamBuffs {
  /** Game second at which the Baron buff ends; 0 when never taken. */
  baronUntil: number;
  elderUntil: number;
  /** Void grub stacks, 0 to 3. */
  voidgrubStacks: number;
  /** Dragon kinds taken, oldest first. */
  dragonHistory: string[];
  dragonStacks: number;
  soulKind: string | null;
}

const VOIDGRUB_CAP = 3;

/**
 * Void grubs from the events, used only when the runtime sends no stack count.
 * Each "secured voidgrub" line is one grub (a plural line is a whole camp); a
 * "cleared voidgrub camp" with no grub lines before it is a full camp. Capped
 * at 3 like the engine.
 */
export function countVoidgrubs(events: readonly FeedSourceEvent[] | null | undefined, side: TeamSide): number {
  if (!events) return 0;
  let grubs = 0;
  let camps = 0;
  for (const ev of events) {
    const text = typeof ev?.text === "string" ? ev.text : "";
    if (!/voidgrub/i.test(text) || sideFromText(text) !== side) continue;
    if (/cleared/i.test(text)) {
      camps += 1;
    } else if (/secured/i.test(text)) {
      const amount = /(\d+)\s*voidgrub/i.exec(text)?.[1];
      grubs += amount ? Number(amount) : /voidgrubs/i.test(text) ? VOIDGRUB_CAP : 1;
    }
  }
  return Math.min(VOIDGRUB_CAP, grubs > 0 ? grubs : camps > 0 ? VOIDGRUB_CAP : 0);
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function finite(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

/**
 * Buffs of one team from a runtime state. The Rust side sends snake_case fields
 * under `teamBuffs` (older builds: `team_buffs`, or nested in `extra`); anything
 * missing reads as zero, and the grub count falls back to the events.
 */
export function readTeamBuffs(state: unknown, side: TeamSide): TeamBuffs {
  const root = record(state);
  const holder =
    record(root?.teamBuffs) ?? record(root?.team_buffs) ?? record(record(root?.extra)?.teamBuffs) ?? null;
  const buffs = record(holder?.[side]);
  const events = Array.isArray(root?.events) ? (root.events as FeedSourceEvent[]) : undefined;
  const grubs = finite(buffs?.voidgrub_stacks, buffs?.voidgrubStacks);
  const history = buffs?.dragon_history ?? buffs?.dragonHistory;
  const soul = buffs?.soul_kind ?? buffs?.soulKind;
  return {
    baronUntil: finite(buffs?.baron_until, buffs?.baronUntil) ?? 0,
    elderUntil: finite(buffs?.elder_until, buffs?.elderUntil) ?? 0,
    voidgrubStacks: Math.max(0, Math.min(VOIDGRUB_CAP, grubs ?? countVoidgrubs(events, side))),
    dragonHistory: Array.isArray(history) ? history.filter((k): k is string => typeof k === "string") : [],
    dragonStacks: finite(buffs?.dragon_stacks, buffs?.dragonStacks) ?? 0,
    soulKind: typeof soul === "string" && soul.length > 0 ? soul : null,
  };
}
