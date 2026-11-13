import {
  CAMP_POINTS,
  MAP_UNITS,
  type CampPoint,
  type MapPoint,
  type StructureKind,
  type TeamSide,
} from "@/lib/match/live/mapGeometry";

/**
 * View models of what stands on the map: structures, jungle camps, wards and the team push
 * badge. Pure and tolerant: the runtime state is cast from JSON and the Rust engine sends
 * fields the TypeScript types do not list (`wards`, `teamPush`), so every field is read
 * defensively and a missing one means "absent", never an error. Nothing here returns text.
 */

// ── Input ───────────────────────────────────────────────────────────────

export interface StructureLike {
  id: string;
  team: string;
  kind: StructureKind;
  pos: MapPoint;
  hp: number;
  maxHp: number;
  alive: boolean;
}

export interface WardLike {
  id: string;
  team: string;
  pos: MapPoint;
  /** Game second at which the ward expires. */
  expiresAt?: number;
}

/** The plan of one team that is ahead in numbers (`team_push.rs`). */
export interface TeamPushLike {
  active?: boolean;
  /** The plan is the ending: the enemy nexus is the target. */
  ending?: boolean;
  /** Game second at which the advantage ends. For the ending it only rolls forward, so it is not a countdown. */
  windowEndsAt?: number;
  targetId?: string | null;
}

export interface StructuresStateLike {
  timeSec: number;
  structures: readonly StructureLike[];
  neutralTimers?: { entities?: Partial<Record<string, { alive?: boolean }>> };
  wards?: readonly WardLike[];
  /** Blue first, red second. */
  teamPush?: ReadonlyArray<TeamPushLike | null | undefined>;
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const sideOf = (team: string): TeamSide => (String(team).trim().toLowerCase() === "red" ? "red" : "blue");

// ── Structures ──────────────────────────────────────────────────────────

export interface StructureView {
  id: string;
  team: TeamSide;
  kind: StructureKind;
  /** Engine position, 0..1. */
  pos: MapPoint;
  dead: boolean;
  /** Share of health left, from 0 to 1. Null unless the structure is standing and damaged. */
  hpShare: number | null;
}

export function structureViews(state: Pick<StructuresStateLike, "structures">): StructureView[] {
  return state.structures.map((structure) => {
    const damaged = structure.alive && structure.maxHp > 0 && structure.hp < structure.maxHp;
    return {
      id: structure.id,
      team: sideOf(structure.team),
      kind: structure.kind,
      pos: structure.pos,
      dead: !structure.alive,
      hpShare: damaged ? Math.max(0, Math.min(1, structure.hp / structure.maxHp)) : null,
    };
  });
}

// ── Camps ───────────────────────────────────────────────────────────────

/** The neutral timer that belongs to each camp of the layout. */
export const CAMP_TIMER_KEY: Readonly<Record<string, string>> = {
  "blue-blue-buff": "blue-buff-blue",
  "red-blue-buff": "blue-buff-red",
  "blue-red-buff": "red-buff-blue",
  "red-red-buff": "red-buff-red",
  "blue-wolves": "wolves-blue",
  "red-wolves": "wolves-red",
  "blue-raptors": "raptors-blue",
  "red-raptors": "raptors-red",
  "blue-gromp": "gromp-blue",
  "red-gromp": "gromp-red",
  "blue-krugs": "krugs-blue",
  "red-krugs": "krugs-red",
  "river-scuttle-top": "scuttle-top",
  "river-scuttle-bot": "scuttle-bot",
};

export interface CampView {
  id: string;
  side: CampPoint["side"];
  /** Engine position, 0..1. */
  pos: MapPoint;
  /** Up (a monster stands there) or cleared (waiting to respawn). */
  alive: boolean;
}

/** Camps whose timer the engine reports. A camp with no timer is left out rather than guessed. */
export function campViews(state: Pick<StructuresStateLike, "neutralTimers">): CampView[] {
  const entities = state.neutralTimers?.entities;
  if (!entities) return [];
  const views: CampView[] = [];
  for (const camp of CAMP_POINTS) {
    const timer = entities[CAMP_TIMER_KEY[camp.id] ?? ""];
    if (!timer) continue;
    views.push({
      id: camp.id,
      side: camp.side,
      pos: { x: camp.x / MAP_UNITS, y: camp.y / MAP_UNITS },
      alive: Boolean(timer.alive),
    });
  }
  return views;
}

// ── Wards ───────────────────────────────────────────────────────────────

export interface WardView {
  id: string;
  team: TeamSide;
  pos: MapPoint;
}

/** Wards of both teams that have not expired. */
export function wardViews(state: Pick<StructuresStateLike, "wards" | "timeSec">): WardView[] {
  return (state.wards ?? [])
    .filter((ward) => !isNumber(ward.expiresAt) || ward.expiresAt > state.timeSec)
    .map((ward) => ({ id: ward.id, team: sideOf(ward.team), pos: ward.pos }));
}

// ── Team push ───────────────────────────────────────────────────────────

/** A countdown to the end of the advantage, no end known, or the final push at the nexus. */
export type PushMode = "countdown" | "open" | "ending";

export interface PushBadgeView {
  team: TeamSide;
  targetId: string;
  targetKind: StructureKind;
  /** Engine position of the structure the team is going for, 0..1. */
  target: MapPoint;
  mode: PushMode;
  /** Seconds left of the advantage; only meaningful in `countdown` mode. */
  remainingSec: number;
}

const TEAM_ORDER: readonly TeamSide[] = ["blue", "red"];

/** One badge per team that plays the plan and whose target still stands. */
export function pushBadges(state: StructuresStateLike): PushBadgeView[] {
  const byId = new Map(state.structures.map((structure) => [structure.id, structure]));
  const badges: PushBadgeView[] = [];
  TEAM_ORDER.forEach((team, index) => {
    const plan = state.teamPush?.[index];
    if (!plan?.active || !plan.targetId) return;
    const target = byId.get(plan.targetId);
    if (!target || !target.alive) return;
    const remaining = isNumber(plan.windowEndsAt) ? plan.windowEndsAt - state.timeSec : 0;
    badges.push({
      team,
      targetId: target.id,
      targetKind: target.kind,
      target: target.pos,
      mode: plan.ending ? "ending" : remaining > 0 ? "countdown" : "open",
      remainingSec: Math.max(0, remaining),
    });
  });
  return badges;
}

/** Clear space kept between the badge and the edge of the map, in pixels. */
export const PUSH_BADGE_MARGIN_PX = 4;
/** Clear space between the badge and the structure it points at, in pixels. */
export const PUSH_BADGE_GAP_PX = 4;

export interface BadgeBox {
  w: number;
  h: number;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * Centre of the badge in pixels. It prefers to sit above its structure, then below, then to
 * the right and to the left, and takes the first place where the whole badge fits inside the
 * map. When no place fits (a small map) it slides the badge back inside the margin on every
 * edge, choosing a side that leaves the structure uncovered. So a push on the left or bottom
 * edge is never half clipped.
 */
export function placePushBadge(target: MapPoint, targetRadiusPx: number, badge: BadgeBox, sizePx: number): MapPoint {
  const cx = target.x * sizePx;
  const cy = target.y * sizePx;
  const halfW = badge.w / 2;
  const halfH = badge.h / 2;
  const reach = targetRadiusPx + PUSH_BADGE_GAP_PX;
  const inside = (value: number, half: number) =>
    Math.min(Math.max(value, PUSH_BADGE_MARGIN_PX + half), Math.max(PUSH_BADGE_MARGIN_PX + half, sizePx - PUSH_BADGE_MARGIN_PX - half));

  const wanted: MapPoint[] = [
    { x: cx, y: cy - reach - halfH },
    { x: cx, y: cy + reach + halfH },
    { x: cx + reach + halfW, y: cy },
    { x: cx - reach - halfW, y: cy },
  ];
  const slid = wanted.map((point) => ({ x: inside(point.x, halfW), y: inside(point.y, halfH) }));

  const fitting = slid.findIndex((point, i) => point.x === wanted[i].x && point.y === wanted[i].y);
  const clear = slid.findIndex((point) => Math.abs(point.x - cx) >= reach + halfW || Math.abs(point.y - cy) >= reach + halfH);
  const chosen = slid[fitting !== -1 ? fitting : clear !== -1 ? clear : 0];
  return { x: round1(chosen.x), y: round1(chosen.y) };
}
