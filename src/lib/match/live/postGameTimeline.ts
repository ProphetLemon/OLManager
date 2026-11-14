import { sideFromText, structureLabel, type DragonKind } from "@/lib/match/live/liveEvents";
import type { KeyEvent } from "@/lib/match/live/matchRecord";
import type { Side } from "@/lib/match/live/postGame";

/**
 * The key events of a finished match as a timeline and as markers on the gold chart. Pure: events
 * in, entries out. It never writes a sentence (the screen composes it from the event's own code
 * and data) and it never claims what it cannot know: the first kill is first blood only when the
 * match was watched whole.
 */

export type TimelineKind = "firstBlood" | "kill" | "tower" | "inhibitor" | "nexus" | "dragon" | "elder" | "herald" | "grub" | "baron";

export interface TimelineEntry {
  id: string;
  t: number;
  /** The team that did it: the killer's, the one that took the objective or destroyed the structure. */
  side: Side | null;
  kind: TimelineKind;
  /** What a person looks for first: first blood, Baron, the Elder, the nexus. */
  big: boolean;
  dragonKind: DragonKind | null;
  /** Whose structure fell. */
  structureOwner: Side | null;
  /** Champion that acted, when it can be found in the roster. */
  actorId: string | null;
  event: KeyEvent;
}

export interface RosterMember {
  id: string;
  name: string;
  team: Side;
}

const BIG: ReadonlySet<TimelineKind> = new Set(["firstBlood", "baron", "elder", "nexus"]);
const DRAGON_KINDS: ReadonlySet<string> = new Set(["infernal", "ocean", "mountain", "cloud", "hextech", "chemtech"]);

const asSide = (value: unknown): Side | null => (value === "blue" || value === "red" ? value : null);

function kindOf(event: KeyEvent): TimelineKind | null {
  switch (event.code) {
    case "champion_killed":
    case "ignite_kill":
      return "kill";
    case "dragon_secured":
      return "dragon";
    case "elder_secured":
      return "elder";
    case "baron_secured":
      return "baron";
    case "herald_secured":
      return "herald";
    case "voidgrub_secured":
      return "grub";
    case "structure_destroyed": {
      const part = structureLabel(event.data?.structure ?? "").part;
      return part === "nexus" ? "nexus" : part === "inhibitor" ? "inhibitor" : "tower";
    }
    default:
      break;
  }
  if (event.code) return null;
  // A state saved before events had a code is read by its type.
  switch (event.type) {
    case "kill":
      return "kill";
    case "tower":
      return "tower";
    case "dragon":
      return "dragon";
    case "baron":
      return "baron";
    case "nexus":
      return "nexus";
    default:
      return null;
  }
}

/** The timeline of a match, in time order. `complete` says the match was watched whole, so the first kill is first blood. */
export function buildTimeline(events: readonly KeyEvent[], options: { complete: boolean; roster: readonly RosterMember[] }): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  let seenKill = false;
  [...events]
    .sort((a, b) => a.t - b.t)
    .forEach((event, index) => {
      const base = kindOf(event);
      if (!base) return;
      const first = base === "kill" && !seenKill;
      if (base === "kill") seenKill = true;
      const kind: TimelineKind = first && options.complete ? "firstBlood" : base;
      const data = event.data ?? {};
      const actor = data.actorId ?? options.roster.find((member) => member.name === data.actor)?.id ?? null;
      const dragonKind = data.dragonKind && DRAGON_KINDS.has(data.dragonKind) ? (data.dragonKind as DragonKind) : null;
      entries.push({
        id: `${event.t}-${event.code ?? event.type}-${index}`,
        t: event.t,
        side: asSide(data.team) ?? sideFromText(event.text),
        kind,
        big: BIG.has(kind),
        dragonKind,
        structureOwner: data.structure ? structureLabel(data.structure).owner : null,
        actorId: actor,
        event,
      });
    });
  return entries;
}

// ── Markers on the gold chart ───────────────────────────────────────────

export interface Marker {
  id: string;
  /** 0 to 1 across the chart. */
  left: number;
  row: "epic" | "structure";
  /** Which line of its row it sits on, 0 first. */
  level: number;
  side: Side | null;
  kind: TimelineKind;
  dragonKind: DragonKind | null;
  /** How many events it stands for; more than one for a run of structures. */
  count: number;
  entries: TimelineEntry[];
}

export interface MarkerPlan {
  markers: Marker[];
  epicLevels: number;
  structureLevels: number;
}

/** Two markers closer than this share of the chart would touch. */
export const MIN_MARKER_GAP = 0.024;

const STRUCTURE_RANK: Partial<Record<TimelineKind, number>> = { tower: 0, inhibitor: 1, nexus: 2 };
const isStructure = (kind: TimelineKind): boolean => kind in STRUCTURE_RANK;
const isEpic = (kind: TimelineKind): boolean => kind === "dragon" || kind === "elder" || kind === "herald" || kind === "grub" || kind === "baron";

/** Where each objective and structure goes on the time axis, on the fewest lines that keep them apart. */
export function placeMarkers(entries: readonly TimelineEntry[], durationSec: number, minGap = MIN_MARKER_GAP): MarkerPlan {
  const span = Math.max(1, durationSec);
  const sorted = [...entries].filter((entry) => isEpic(entry.kind) || isStructure(entry.kind)).sort((a, b) => a.t - b.t);

  const markers: Marker[] = [];
  for (const entry of sorted) {
    const left = Math.min(1, entry.t / span);
    const row = isStructure(entry.kind) ? "structure" : "epic";
    const previous = markers[markers.length - 1];
    const lastOfRow = [...markers].reverse().find((marker) => marker.row === row);
    // A run of one side's structures, close in time, is one marker with a count.
    if (row === "structure" && lastOfRow && lastOfRow.side === entry.side && left - lastOfRow.left < minGap) {
      lastOfRow.entries.push(entry);
      lastOfRow.count += 1;
      lastOfRow.left = left;
      if ((STRUCTURE_RANK[entry.kind] ?? 0) > (STRUCTURE_RANK[lastOfRow.kind] ?? 0)) lastOfRow.kind = entry.kind;
      continue;
    }
    void previous;
    markers.push({ id: entry.id, left, row, level: 0, side: entry.side, kind: entry.kind, dragonKind: entry.dragonKind, count: 1, entries: [entry] });
  }

  const ends: Record<Marker["row"], number[]> = { epic: [], structure: [] };
  for (const marker of markers) {
    const lines = ends[marker.row];
    let level = lines.findIndex((end) => end <= marker.left - minGap);
    if (level === -1) {
      level = lines.length;
      lines.push(marker.left);
    } else {
      lines[level] = marker.left;
    }
    marker.level = level;
  }
  return { markers, epicLevels: ends.epic.length, structureLevels: ends.structure.length };
}
