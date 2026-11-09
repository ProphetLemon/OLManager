import { BASE_POSITION, JUNGLE_ROUTE, LANE_PATH_BLUE, OBJECTIVES, ROLE_OFFSET, getStructures } from "@/ui-v2/_legacy/components/match/lol-prototype/assets/map";
import type { MatchSnapshot } from "@/ui-v2/_legacy/components/match/types";
import { JUNGLE_CAMPS_LAYOUT } from "@/lib/match/lolMapLayout";
import { NavGrid } from "@/ui-v2/_legacy/components/match/lol-prototype/engine/navigation";
import type {
  AttackType,
  ChampionState,
  LaneId,
  MatchState,
  MinionState,
  NeutralTimerKey,
  NeutralTimerState,
  RoleId,
  SimEvent,
  StructureState,
  TeamId,
  Vec2,
} from "@/ui-v2/_legacy/components/match/lol-prototype/engine/types";

export interface ChampionCombatProfile {
  baseHp: number;
  attackType: AttackType;
  attackRange: number;
}

const CHAMPION_KILL_GOLD = 300;
const CHAMPION_ASSIST_GOLD_TOTAL = 150;
const CHAMPION_KILL_XP = 220;
const ASSIST_RADIUS = 0.11;
// Team-wide objective gold, mirroring the authoritative Rust simulator
// (olm_core sim_live::economy). Baron paid 80 gold to one champion and towers
// paid nothing before. [PLACEHOLDER] pending playtest.
export const BARON_TEAM_GOLD = 300;
export function towerTeamGold(structureId: string) {
  if (structureId.endsWith("-outer")) return 125;
  if (structureId.endsWith("-inner")) return 100;
  return 90;
}
const MINION_GOLD = { melee: 22, ranged: 16, summon: 0 } as const;
const MINION_XP = { melee: 58, ranged: 32, summon: 0 } as const;
const MINION_PROFILE = {
  melee: { maxHp: 118, moveSpeed: 0.068, attackRange: 0.035, attackDamage: 6, attackCadence: 1.05 },
  ranged: { maxHp: 92, moveSpeed: 0.071, attackRange: 0.055, attackDamage: 7, attackCadence: 1.14 },
  summon: { maxHp: 74, moveSpeed: 0.073, attackRange: 0.045, attackDamage: 5, attackCadence: 1.12 },
} as const;
const MINION_DAMAGE_TO_MINION_MULTIPLIER = 0.52;
const CHAMPION_DAMAGE_TO_MINION_MULTIPLIER = 0.36;
const MINION_FIRST_WAVE_AT = 30;
const LANE_COMBAT_UNLOCK_AT = MINION_FIRST_WAVE_AT + 8;
const FIRST_WAVE_CONTEST_UNTIL = MINION_FIRST_WAVE_AT + 45;
const LOCAL_COMBAT_ENGAGE_RADIUS = 0.16;
const LOCAL_STRUCTURE_ENGAGE_RADIUS = 0.12;
const LANE_STRUCTURE_PRESSURE_RADIUS = 0.12;
const LANE_CHAMPION_TRADE_RADIUS = 0.19;
const LANE_CHASE_LEASH_RADIUS = 0.11;
const TRADE_RETREAT_HP_RATIO = 0.36;
const TRADE_HP_DISADVANTAGE_ALLOWANCE = 0.2;
const LANE_LOCAL_PRESSURE_RADIUS = 0.1;
const JUNGLE_CAMP_ENGAGE_RADIUS = 0.09;
const STUCK_PROGRESS_WINDOW_SEC = 1.4;
const STUCK_MIN_PROGRESS = 0.004;
const STUCK_MIN_REMAINING_DELTA = 0.004;
const STUCK_REPATH_COOLDOWN_SEC = 2.2;
const STUCK_BYPASS_STRIKES = 3;
const STUCK_BYPASS_COOLDOWN_SEC = 8;
const LANE_REENGAGE_COOLDOWN_SEC = 2.8;
const LANE_RECENT_TRADE_LOCK_SEC = 1.7;
const LANE_MINION_CONTEXT_RADIUS = 0.105;
const LANE_CHASE_MINION_CONTEXT_RADIUS = 0.12;
const LANE_EMPTY_ANCHOR_PROGRESS_MAX_INDEX = 4;
const LANE_FALLBACK_TOWER_OFFSET = 0.019;
const LANE_HEALTHY_RETREAT_HP_RATIO = 0.6;
const LANE_STRONG_UNFAVORABLE_PRESSURE_DELTA = 0.7;
const RECALL_TRIGGER_HP_RATIO = 0.34;
const RECALL_CHANNEL_SEC = 6.5;
const RECALL_REACH_BUFFER_SEC = 0.8;
const RECALL_SAFE_ENEMY_RADIUS = 0.2;
const TOWER_PLATING_DROP_AT = 14 * 60;
const PRE14_TOWER_DAMAGE_MULTIPLIER = 0.28;
const JUNGLE_INITIAL_SPAWN_AT = MINION_FIRST_WAVE_AT;
const SCUTTLE_INITIAL_SPAWN_AT = 210;
const OBJECTIVE_ATTEMPT_RADIUS = 0.12;
const OBJECTIVE_ASSIST_RADIUS = 0.24;
const MID_ROAM_WINDOW_SEC = 36;
const MID_KILL_ROAM_BONUS_SEC = 30;
const MINION_DAMAGE_TO_CHAMPION_MULTIPLIER = 0.44;
const TOWER_SHOT_DAMAGE = 32;
const TOWER_AGGRO_LOCK_SEC = 2.6;
const JUNGLE_GANK_WINDOW_RADIUS = 0.22;
const CHAMPION_SOFT_COLLISION_RADIUS = 0.012;
const CHAMPION_SOFT_COLLISION_RADIUS_SUP_JGL = 0.015;
const CHAMPION_SOFT_COLLISION_PUSH = 0.55;
const BARON_BUFF_DURATION_SEC = 180;
const BARON_MINION_AURA_RADIUS = 0.16;
const BARON_MINION_STRUCTURE_RANGE = 0.09;
const MINION_STRUCTURE_AGGRO_RADIUS = 0.24;
const MINION_STRUCTURE_BLOCKER_ATTACK_RADIUS = 0.13;
const BARON_MINION_COMBAT_RANGE_BONUS = 0.018;
const BARON_MINION_STRUCTURE_DAMAGE_MULTIPLIER = 2.35;
const BARON_MINION_MINION_DAMAGE_MULTIPLIER = 1.65;
const BARON_MINION_CHAMPION_DAMAGE_MULTIPLIER = 1.2;
const BARON_MINION_MOVE_SPEED_MULTIPLIER = 1.12;
const BARON_MINION_TOWER_DAMAGE_TAKEN_MULTIPLIER = 0.55;

const LANER_FARM_SEARCH_RADIUS: Record<Exclude<RoleId, "JGL">, number> = {
  TOP: 0.14,
  MID: 0.15,
  ADC: 0.145,
  SUP: 0.12,
};

type LanerCombatState = {
  lastDisengageAt: number;
  reengageAt: number;
  recentTradeUntil: number;
};

const LANE_ROLE_PROFILE: Record<Exclude<RoleId, "JGL">, { chaseLeash: number; approachLeash: number; retreatHp: number; outnumberTolerance: number }> = {
  TOP: { chaseLeash: 0.11, approachLeash: 0.062, retreatHp: 0.34, outnumberTolerance: 0.25 },
  MID: { chaseLeash: 0.1, approachLeash: 0.058, retreatHp: 0.36, outnumberTolerance: 0.2 },
  ADC: { chaseLeash: 0.095, approachLeash: 0.058, retreatHp: 0.44, outnumberTolerance: 0.08 },
  SUP: { chaseLeash: 0.09, approachLeash: 0.055, retreatHp: 0.41, outnumberTolerance: 0.08 },
};

const JUNGLE_CAMP_KEYS: NeutralTimerKey[] = [
  "blue-buff-blue",
  "blue-buff-red",
  "red-buff-blue",
  "red-buff-red",
  "wolves-blue",
  "wolves-red",
  "raptors-blue",
  "raptors-red",
  "gromp-blue",
  "gromp-red",
  "krugs-blue",
  "krugs-red",
  "scuttle-top",
  "scuttle-bot",
];

const JUNGLE_ROUTE_BY_TIMER: Record<TeamId, NeutralTimerKey[]> = {
  blue: ["blue-buff-blue", "gromp-blue", "wolves-blue", "raptors-blue", "red-buff-blue", "krugs-blue", "scuttle-top", "scuttle-bot"],
  red: ["red-buff-red", "krugs-red", "raptors-red", "wolves-red", "blue-buff-red", "gromp-red", "scuttle-bot", "scuttle-top"],
};

const JUNGLE_ROUTE_BY_START: Record<TeamId, Record<"blue" | "red", NeutralTimerKey[]>> = {
  blue: {
    blue: ["blue-buff-blue", "gromp-blue", "wolves-blue", "raptors-blue", "red-buff-blue", "krugs-blue", "scuttle-top", "scuttle-bot"],
    red: ["red-buff-blue", "krugs-blue", "raptors-blue", "wolves-blue", "blue-buff-blue", "gromp-blue", "scuttle-bot", "scuttle-top"],
  },
  red: {
    blue: ["blue-buff-red", "gromp-red", "wolves-red", "raptors-red", "red-buff-red", "krugs-red", "scuttle-bot", "scuttle-top"],
    red: ["red-buff-red", "krugs-red", "raptors-red", "wolves-red", "blue-buff-red", "gromp-red", "scuttle-top", "scuttle-bot"],
  },
};

const JUNGLE_CAMP_PROFILE: Partial<Record<NeutralTimerKey, { maxHp: number; gold: number; xp: number }>> = {
  "blue-buff-blue": { maxHp: 470, gold: 95, xp: 150 },
  "blue-buff-red": { maxHp: 470, gold: 95, xp: 150 },
  "red-buff-blue": { maxHp: 500, gold: 95, xp: 155 },
  "red-buff-red": { maxHp: 500, gold: 95, xp: 155 },
  "wolves-blue": { maxHp: 380, gold: 70, xp: 110 },
  "wolves-red": { maxHp: 380, gold: 70, xp: 110 },
  "raptors-blue": { maxHp: 390, gold: 72, xp: 115 },
  "raptors-red": { maxHp: 390, gold: 72, xp: 115 },
  "gromp-blue": { maxHp: 520, gold: 82, xp: 128 },
  "gromp-red": { maxHp: 520, gold: 82, xp: 128 },
  "krugs-blue": { maxHp: 560, gold: 86, xp: 132 },
  "krugs-red": { maxHp: 560, gold: 86, xp: 132 },
  "scuttle-top": { maxHp: 560, gold: 70, xp: 110 },
  "scuttle-bot": { maxHp: 560, gold: 70, xp: 110 },
};

function isJungleCampKey(key: NeutralTimerKey) {
  return JUNGLE_CAMP_KEYS.includes(key);
}

function neutralDefaultMaxHp(key: NeutralTimerKey) {
  if (key === "dragon") return 3600;
  if (key === "baron") return 9000;
  if (key === "herald") return 5500;
  if (key === "voidgrubs") return 2800;
  if (key === "elder") return 7200;
  return JUNGLE_CAMP_PROFILE[key]?.maxHp ?? 1200;
}

const CAMP_POSITIONS = new Map(JUNGLE_CAMPS_LAYOUT.map((camp) => [camp.id, { x: camp.x, y: camp.y }]));
const VOIDGRUBS_SOFT_CLOSE_AT = 14 * 60 + 45;
const VOIDGRUBS_HARD_CLOSE_AT = 14 * 60 + 55;
const HERALD_SOFT_CLOSE_AT = 19 * 60 + 45;
const HERALD_HARD_CLOSE_AT = 19 * 60 + 55;

const NEUTRAL_TIMER_TEMPLATE: Record<NeutralTimerKey, Omit<NeutralTimerState, "alive" | "hp" | "nextSpawnAt" | "lastSpawnAt" | "lastTakenAt" | "timesSpawned" | "timesTaken">> = {
  "blue-buff-blue": {
    key: "blue-buff-blue",
    label: "Blue Blue Buff",
    firstSpawnAt: JUNGLE_INITIAL_SPAWN_AT,
    maxHp: neutralDefaultMaxHp("blue-buff-blue"),
    respawnDelaySec: 5 * 60,
    oneShot: false,
    windowCloseAt: null,
    combatGraceUntil: null,
    unlocked: true,
    pos: CAMP_POSITIONS.get("blue-blue-buff") ?? { x: 0.25, y: 0.46 },
  },
  "blue-buff-red": {
    key: "blue-buff-red",
    label: "Red Blue Buff",
    firstSpawnAt: JUNGLE_INITIAL_SPAWN_AT,
    maxHp: neutralDefaultMaxHp("blue-buff-red"),
    respawnDelaySec: 5 * 60,
    oneShot: false,
    windowCloseAt: null,
    combatGraceUntil: null,
    unlocked: true,
    pos: CAMP_POSITIONS.get("red-blue-buff") ?? { x: 0.48, y: 0.26 },
  },
  "red-buff-blue": {
    key: "red-buff-blue",
    label: "Blue Red Buff",
    firstSpawnAt: JUNGLE_INITIAL_SPAWN_AT,
    maxHp: neutralDefaultMaxHp("red-buff-blue"),
    respawnDelaySec: 5 * 60,
    oneShot: false,
    windowCloseAt: null,
    combatGraceUntil: null,
    unlocked: true,
    pos: CAMP_POSITIONS.get("blue-red-buff") ?? { x: 0.53, y: 0.74 },
  },
  "red-buff-red": {
    key: "red-buff-red",
    label: "Red Red Buff",
    firstSpawnAt: JUNGLE_INITIAL_SPAWN_AT,
    maxHp: neutralDefaultMaxHp("red-buff-red"),
    respawnDelaySec: 5 * 60,
    oneShot: false,
    windowCloseAt: null,
    combatGraceUntil: null,
    unlocked: true,
    pos: CAMP_POSITIONS.get("red-red-buff") ?? { x: 0.75, y: 0.54 },
  },
  "wolves-blue": {
    key: "wolves-blue",
    label: "Blue Wolves",
    firstSpawnAt: JUNGLE_INITIAL_SPAWN_AT,
    maxHp: neutralDefaultMaxHp("wolves-blue"),
    respawnDelaySec: 135,
    oneShot: false,
    windowCloseAt: null,
    combatGraceUntil: null,
    unlocked: true,
    pos: CAMP_POSITIONS.get("blue-wolves") ?? { x: 0.26, y: 0.56 },
  },
  "wolves-red": {
    key: "wolves-red",
    label: "Red Wolves",
    firstSpawnAt: JUNGLE_INITIAL_SPAWN_AT,
    maxHp: neutralDefaultMaxHp("wolves-red"),
    respawnDelaySec: 135,
    oneShot: false,
    windowCloseAt: null,
    combatGraceUntil: null,
    unlocked: true,
    pos: CAMP_POSITIONS.get("red-wolves") ?? { x: 0.53, y: 0.35 },
  },
  "raptors-blue": {
    key: "raptors-blue",
    label: "Blue Raptors",
    firstSpawnAt: JUNGLE_INITIAL_SPAWN_AT,
    maxHp: neutralDefaultMaxHp("raptors-blue"),
    respawnDelaySec: 135,
    oneShot: false,
    windowCloseAt: null,
    combatGraceUntil: null,
    unlocked: true,
    pos: CAMP_POSITIONS.get("blue-raptors") ?? { x: 0.48, y: 0.64 },
  },
  "raptors-red": {
    key: "raptors-red",
    label: "Red Raptors",
    firstSpawnAt: JUNGLE_INITIAL_SPAWN_AT,
    maxHp: neutralDefaultMaxHp("raptors-red"),
    respawnDelaySec: 135,
    oneShot: false,
    windowCloseAt: null,
    combatGraceUntil: null,
    unlocked: true,
    pos: CAMP_POSITIONS.get("red-raptors") ?? { x: 0.75, y: 0.44 },
  },
  "gromp-blue": {
    key: "gromp-blue",
    label: "Blue Gromp",
    firstSpawnAt: JUNGLE_INITIAL_SPAWN_AT,
    maxHp: neutralDefaultMaxHp("gromp-blue"),
    respawnDelaySec: 135,
    oneShot: false,
    windowCloseAt: null,
    combatGraceUntil: null,
    unlocked: true,
    pos: CAMP_POSITIONS.get("blue-gromp") ?? { x: 0.15, y: 0.43 },
  },
  "gromp-red": {
    key: "gromp-red",
    label: "Red Gromp",
    firstSpawnAt: JUNGLE_INITIAL_SPAWN_AT,
    maxHp: neutralDefaultMaxHp("gromp-red"),
    respawnDelaySec: 135,
    oneShot: false,
    windowCloseAt: null,
    combatGraceUntil: null,
    unlocked: true,
    pos: CAMP_POSITIONS.get("red-gromp") ?? { x: 0.44, y: 0.17 },
  },
  "krugs-blue": {
    key: "krugs-blue",
    label: "Blue Krugs",
    firstSpawnAt: JUNGLE_INITIAL_SPAWN_AT,
    maxHp: neutralDefaultMaxHp("krugs-blue"),
    respawnDelaySec: 135,
    oneShot: false,
    windowCloseAt: null,
    combatGraceUntil: null,
    unlocked: true,
    pos: CAMP_POSITIONS.get("blue-krugs") ?? { x: 0.57, y: 0.83 },
  },
  "krugs-red": {
    key: "krugs-red",
    label: "Red Krugs",
    firstSpawnAt: JUNGLE_INITIAL_SPAWN_AT,
    maxHp: neutralDefaultMaxHp("krugs-red"),
    respawnDelaySec: 135,
    oneShot: false,
    windowCloseAt: null,
    combatGraceUntil: null,
    unlocked: true,
    pos: CAMP_POSITIONS.get("red-krugs") ?? { x: 0.85, y: 0.57 },
  },
  "scuttle-top": {
    key: "scuttle-top",
    label: "Scuttle Top",
    firstSpawnAt: SCUTTLE_INITIAL_SPAWN_AT,
    maxHp: neutralDefaultMaxHp("scuttle-top"),
    respawnDelaySec: 150,
    oneShot: false,
    windowCloseAt: null,
    combatGraceUntil: null,
    unlocked: true,
    pos: CAMP_POSITIONS.get("river-scuttle-top") ?? { x: 0.285, y: 0.348 },
  },
  "scuttle-bot": {
    key: "scuttle-bot",
    label: "Scuttle Bot",
    firstSpawnAt: SCUTTLE_INITIAL_SPAWN_AT,
    maxHp: neutralDefaultMaxHp("scuttle-bot"),
    respawnDelaySec: 150,
    oneShot: false,
    windowCloseAt: null,
    combatGraceUntil: null,
    unlocked: true,
    pos: CAMP_POSITIONS.get("river-scuttle-bot") ?? { x: 0.7, y: 0.642 },
  },
  dragon: {
    key: "dragon",
    label: "Dragon",
    firstSpawnAt: 5 * 60,
    maxHp: neutralDefaultMaxHp("dragon"),
    respawnDelaySec: 5 * 60,
    oneShot: false,
    windowCloseAt: null,
    combatGraceUntil: null,
    unlocked: true,
    pos: OBJECTIVES.dragon,
  },
  voidgrubs: {
    key: "voidgrubs",
    label: "Voidgrubs",
    firstSpawnAt: 8 * 60,
    maxHp: neutralDefaultMaxHp("voidgrubs"),
    respawnDelaySec: null,
    oneShot: true,
    windowCloseAt: VOIDGRUBS_SOFT_CLOSE_AT,
    combatGraceUntil: VOIDGRUBS_HARD_CLOSE_AT,
    unlocked: true,
    pos: OBJECTIVES.baron,
  },
  herald: {
    key: "herald",
    label: "Rift Herald",
    firstSpawnAt: 15 * 60,
    maxHp: neutralDefaultMaxHp("herald"),
    respawnDelaySec: null,
    oneShot: true,
    windowCloseAt: HERALD_SOFT_CLOSE_AT,
    combatGraceUntil: HERALD_HARD_CLOSE_AT,
    unlocked: true,
    pos: OBJECTIVES.baron,
  },
  baron: {
    key: "baron",
    label: "Baron",
    firstSpawnAt: 20 * 60,
    maxHp: neutralDefaultMaxHp("baron"),
    respawnDelaySec: 6 * 60,
    oneShot: false,
    windowCloseAt: null,
    combatGraceUntil: null,
    unlocked: true,
    pos: OBJECTIVES.baron,
  },
  elder: {
    key: "elder",
    label: "Elder Dragon",
    firstSpawnAt: 0,
    maxHp: neutralDefaultMaxHp("elder"),
    respawnDelaySec: 6 * 60,
    oneShot: false,
    windowCloseAt: null,
    combatGraceUntil: null,
    unlocked: false,
    pos: OBJECTIVES.dragon,
  },
};

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
function dist(a: Vec2, b: Vec2) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalize(v: Vec2) {
  const m = Math.hypot(v.x, v.y);
  if (m < 1e-6) return { x: 1, y: 0 };
  return { x: v.x / m, y: v.y / m };
}

function championMaxHpFromBase(baseHp: number) {
  return clamp(Math.round(baseHp / 4), 120, 240);
}

function championDamageToMinionMultiplier(role: RoleId) {
  if (role === "MID") return CHAMPION_DAMAGE_TO_MINION_MULTIPLIER + 0.12;
  if (role === "ADC") return CHAMPION_DAMAGE_TO_MINION_MULTIPLIER + 0.08;
  if (role === "SUP") return CHAMPION_DAMAGE_TO_MINION_MULTIPLIER - 0.1;
  return CHAMPION_DAMAGE_TO_MINION_MULTIPLIER;
}

function hashSeed(seed: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a: number) {
  return () => {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class PrototypeSimulation {
  state: MatchState;
  private rng: () => number;
  private waveSpawnAt = MINION_FIRST_WAVE_AT;
  private nextMinionId = 0;
  private championStuckState = new Map<string, {
    sampleAt: number;
    samplePos: Vec2;
    sampleRemaining: number;
    cooldownUntil: number;
    noProgressStrikes: number;
    obstacleSignature: string | null;
    bypassCooldownUntil: number;
  }>();
  private jungleCampFocusByChampion = new Map<string, NeutralTimerKey>();
  private jungleRouteIndexByChampion = new Map<string, number>();
  private jungleStartByTeam: Record<TeamId, "blue" | "red"> = { blue: "blue", red: "red" };
  private laneCombatStateByChampion = new Map<string, LanerCombatState>();
  private midRoamUntilByChampion = new Map<string, number>();
  private midKillAdvantageUntilByChampion = new Map<string, number>();
  private towerForcedTargetById = new Map<string, string>();
  private towerForcedUntilById = new Map<string, number>();
  private baronBuffByChampion = new Map<string, { until: number; deathsAtGrant: number }>();

  constructor(
    private nav: NavGrid,
    private snapshot: MatchSnapshot,
    seed = "default-seed",
    private championByPlayerId: Record<string, string> = {},
    private championProfilesById: Record<string, ChampionCombatProfile> = {},
  ) {
    this.rng = mulberry32(hashSeed(seed));
    this.state = this.createInitialState();
  }

  reset(seed: string) {
    this.rng = mulberry32(hashSeed(seed));
    this.waveSpawnAt = MINION_FIRST_WAVE_AT;
    this.nextMinionId = 0;
    this.championStuckState.clear();
    this.jungleCampFocusByChampion.clear();
    this.jungleRouteIndexByChampion.clear();
    this.jungleStartByTeam = { blue: "blue", red: "red" };
    this.laneCombatStateByChampion.clear();
    this.midRoamUntilByChampion.clear();
    this.midKillAdvantageUntilByChampion.clear();
    this.towerForcedTargetById.clear();
    this.towerForcedUntilById.clear();
    this.baronBuffByChampion.clear();
    this.state = this.createInitialState();
  }

  setRunning(running: boolean) {
    this.state.running = running;
  }

  toggleWalls() {
    this.state.showWalls = !this.state.showWalls;
  }

  private laneOf(role: RoleId): LaneId {
    if (role === "TOP") return "top";
    if (role === "MID") return "mid";
    return "bot";
  }

  private xpToNextLevel(level: number) {
    return 110 + level * 70;
  }

  private addGold(ch: ChampionState, amount: number) {
    if (amount <= 0) return;
    ch.gold += amount;
    this.state.stats[ch.team].gold += amount;
  }

  private addTeamGold(team: TeamId, amount: number, aliveOnly: boolean) {
    this.state.champions
      .filter((c) => c.team === team && (c.alive || !aliveOnly))
      .forEach((c) => this.addGold(c, amount));
  }

  private addXp(ch: ChampionState, amount: number) {
    if (amount <= 0) return;
    ch.xp += amount;
    while (ch.level < 18 && ch.xp >= this.xpToNextLevel(ch.level)) {
      ch.xp -= this.xpToNextLevel(ch.level);
      ch.level += 1;
      ch.maxHp += 18;
      ch.attackDamage += 2.2;
      ch.hp = Math.min(ch.maxHp, ch.hp + ch.maxHp * 0.22);
      this.log(`${ch.name} reached level ${ch.level}`, "info");
    }
  }

  private grantBaronBuff(team: TeamId) {
    const until = this.state.timeSec + BARON_BUFF_DURATION_SEC;
    this.state.champions
      .filter((ch) => ch.alive && ch.team === team)
      .forEach((ch) => this.baronBuffByChampion.set(ch.id, { until, deathsAtGrant: ch.deaths }));
  }

  private championHasBaronBuff(ch: ChampionState, now = this.state.timeSec) {
    const buff = this.baronBuffByChampion.get(ch.id);
    return Boolean(ch.alive && buff && buff.until > now && buff.deathsAtGrant === ch.deaths);
  }

  private hasBaronAuraForMinion(minion: MinionState, now = this.state.timeSec) {
    return this.state.champions.some(
      (ch) => ch.team === minion.team && this.championHasBaronBuff(ch, now) && dist(ch.pos, minion.pos) <= BARON_MINION_AURA_RADIUS,
    );
  }

  private minionAttackRange(minion: MinionState, target: "structure" | "unit", now = this.state.timeSec) {
    if (!this.hasBaronAuraForMinion(minion, now)) return minion.attackRange;
    if (target === "structure") return Math.max(minion.attackRange, BARON_MINION_STRUCTURE_RANGE);
    return minion.attackRange + BARON_MINION_COMBAT_RANGE_BONUS;
  }

  private minionMoveSpeed(minion: MinionState, now = this.state.timeSec) {
    return this.hasBaronAuraForMinion(minion, now)
      ? minion.moveSpeed * BARON_MINION_MOVE_SPEED_MULTIPLIER
      : minion.moveSpeed;
  }

  private minionDamageMultiplier(minion: MinionState, target: "structure" | "minion" | "champion", now = this.state.timeSec) {
    if (!this.hasBaronAuraForMinion(minion, now)) return 1;
    if (target === "structure") return BARON_MINION_STRUCTURE_DAMAGE_MULTIPLIER;
    if (target === "minion") return BARON_MINION_MINION_DAMAGE_MULTIPLIER;
    return BARON_MINION_CHAMPION_DAMAGE_MULTIPLIER;
  }

  private nearbyChampions(team: TeamId, pos: Vec2, radius: number, aliveOnly = true) {
    return this.state.champions.filter((c) => c.team === team && (!aliveOnly || c.alive) && dist(c.pos, pos) <= radius);
  }

  private towerDamageMultiplier(target: StructureState, now: number) {
    const pre14Plating = now < TOWER_PLATING_DROP_AT && target.kind === "tower" && target.lane !== "base";
    return pre14Plating ? PRE14_TOWER_DAMAGE_MULTIPLIER : 1;
  }

  private parseJungleStartSignal(value: unknown): "blue" | "red" | null {
    if (typeof value !== "string") return null;
    const normalized = value.toLowerCase().replace(/[_\s-]/g, "");
    if (normalized.includes("red") || normalized.includes("bot") || normalized.includes("krug")) return "red";
    if (normalized.includes("blue") || normalized.includes("top") || normalized.includes("gromp")) return "blue";
    return null;
  }

  private resolveJungleStartBuff(team: TeamId): "blue" | "red" {
    const teamData = team === "blue" ? this.snapshot.home_team : this.snapshot.away_team;
    const dynamicTeamData = teamData as unknown as Record<string, unknown>;
    const dynamicSnapshot = this.snapshot as unknown as Record<string, unknown>;
    const fromSignals = [
      dynamicTeamData.jungle_start,
      dynamicTeamData.jungleStart,
      dynamicTeamData.jungle_path_start,
      dynamicTeamData.first_buff,
      dynamicTeamData.firstBuff,
      (dynamicTeamData.tactics as Record<string, unknown> | undefined)?.jungle_start,
      (dynamicTeamData.tactics as Record<string, unknown> | undefined)?.first_buff,
      (dynamicSnapshot.prematch_tactics as Record<string, unknown> | undefined)?.[team === "blue" ? "home_jungle_start" : "away_jungle_start"],
      (dynamicSnapshot.lol_tactics as Record<string, unknown> | undefined)?.[team === "blue" ? "home_jungle_start" : "away_jungle_start"],
    ];
    for (const candidate of fromSignals) {
      const parsed = this.parseJungleStartSignal(candidate);
      if (parsed) return parsed;
    }

    const style = teamData.draft_strategy;
    if (style === "HighPress" || style === "Attacking" || style === "Counter") return "red";
    if (style === "Defensive" || style === "Possession") return "blue";
    return team === "blue" ? "blue" : "red";
  }

  private jungleRouteForChampion(ch: ChampionState) {
    const start = this.jungleStartByTeam[ch.team] ?? "blue";
    return JUNGLE_ROUTE_BY_START[ch.team][start] ?? JUNGLE_ROUTE_BY_TIMER[ch.team];
  }

  private distributeMinionXp(dead: MinionState) {
    const nearby = this.nearbyChampions(dead.team === "blue" ? "red" : "blue", dead.pos, 0.12);
    if (!nearby.length) return;
    const each = MINION_XP[dead.kind] / nearby.length;
    nearby.forEach((ch) => this.addXp(ch, each));
  }

  private registerMinionDeath(minion: MinionState, killerChampionId: string | null) {
    if (!minion.alive) return;
    minion.alive = false;
    minion.lastHitByChampionId = killerChampionId;
    this.distributeMinionXp(minion);
    if (!killerChampionId) return;
    const killer = this.state.champions.find((c) => c.id === killerChampionId && c.alive);
    if (!killer) return;
    this.addGold(killer, MINION_GOLD[minion.kind]);
  }

  private shouldAvoidDive(ch: ChampionState, targetPos: Vec2) {
    const nextLaneStructure = this.nextEnemyStructureForLane(ch.team, ch.lane, ch.pos);
    if (nextLaneStructure && dist(nextLaneStructure.pos, targetPos) > 0.08) {
      const alliedMinionsNearNextStructure = this.state.minions.some(
        (m) => m.alive && m.team === ch.team && m.lane === ch.lane && dist(m.pos, nextLaneStructure.pos) <= 0.09,
      );
      if (!alliedMinionsNearNextStructure) return true;
    }

    const tower = this.state.structures.find(
      (s) => s.alive && s.team !== ch.team && s.kind === "tower" && dist(s.pos, targetPos) <= 0.095,
    );
    if (!tower) return false;
    const alliedMinionsNearTower = this.state.minions.filter((m) => m.alive && m.team === ch.team && dist(m.pos, tower.pos) <= 0.085).length;
    const allyNearby = this.nearbyChampions(ch.team, targetPos, 0.12).length;
    const enemyNearby = this.nearbyChampions(ch.team === "blue" ? "red" : "blue", targetPos, 0.12).length;
    const lowHp = ch.hp / ch.maxHp < 0.48;
    return lowHp || alliedMinionsNearTower === 0 || allyNearby < enemyNearby;
  }

  private enemyTowerForPos(ch: ChampionState, pos: Vec2) {
    return this.state.structures.find(
      (s) => s.alive && s.team !== ch.team && s.kind === "tower" && s.lane === ch.lane && dist(s.pos, pos) <= 0.095,
    ) ?? null;
  }

  private canTowerDiveChampion(ch: ChampionState, target: ChampionState) {
    const tower = this.enemyTowerForPos(ch, target.pos);
    if (!tower) return true;

    const allyHelp = this.state.champions.filter((u) => u.alive && u.team === ch.team && u.id !== ch.id && dist(u.pos, target.pos) <= 0.1).length;
    const targetLow = target.hp / target.maxHp <= 0.26;

    const hitsToKill = Math.max(1, Math.ceil(target.hp / Math.max(ch.attackDamage, 1)));
    const estimatedKillTime = hitsToKill * 0.85;
    const estimatedTowerShots = Math.max(1, Math.ceil(estimatedKillTime / 1.0));
    const requiredHp = TOWER_SHOT_DAMAGE * Math.min(2, estimatedTowerShots) + 10;
    const canTank = ch.hp >= requiredHp;

    return canTank && (targetLow || allyHelp >= 1);
  }

  private markTowerAggroOnChampionAttack(attacker: ChampionState, victim: ChampionState, now: number) {
    const defendingTowers = this.state.structures.filter(
      (s) => s.alive && s.team === victim.team && s.kind === "tower" && dist(s.pos, victim.pos) <= 0.09 && dist(s.pos, attacker.pos) <= 0.1,
    );
    defendingTowers.forEach((tower) => {
      this.towerForcedTargetById.set(tower.id, attacker.id);
      this.towerForcedUntilById.set(tower.id, now + TOWER_AGGRO_LOCK_SEC);
    });
  }

  private isObjectiveNeutralKey(key: NeutralTimerKey) {
    return key === "dragon" || key === "baron" || key === "herald" || key === "voidgrubs" || key === "elder";
  }

  private objectiveAdjacentLanes(key: NeutralTimerKey): LaneId[] {
    if (key === "dragon" || key === "elder" || key === "scuttle-bot") return ["mid", "bot"];
    return ["mid", "top"];
  }

  private nearbyNeutralObjective(ch: ChampionState) {
    return (Object.values(this.state.neutralTimers.entities) as NeutralTimerState[])
      .filter((timer) => timer.alive && this.isObjectiveNeutralKey(timer.key) && dist(ch.pos, timer.pos) <= OBJECTIVE_ATTEMPT_RADIUS)
      .sort((a, b) => dist(ch.pos, a.pos) - dist(ch.pos, b.pos))[0] ?? null;
  }

  private activeObjectiveAttemptForTeam(team: TeamId) {
    const alliedJungler = this.state.champions.find((c) => c.alive && c.team === team && c.role === "JGL");
    if (!alliedJungler) return null;
    const enemyTeam: TeamId = team === "blue" ? "red" : "blue";
    const attempts = (Object.values(this.state.neutralTimers.entities) as NeutralTimerState[])
      .filter((timer) => timer.alive && this.isObjectiveNeutralKey(timer.key))
      .map((timer) => {
        const d = dist(alliedJungler.pos, timer.pos);
        const enemyContest = this.state.champions.some((enemy) => enemy.alive && enemy.team === enemyTeam && dist(enemy.pos, timer.pos) <= OBJECTIVE_ASSIST_RADIUS);
        const isDamaged = timer.hp <= timer.maxHp * 0.9;
        return { timer, d, contestWindow: enemyContest || isDamaged };
      })
      .filter((entry) => entry.d <= OBJECTIVE_ASSIST_RADIUS && entry.contestWindow)
      .sort((a, b) => a.d - b.d);
    return attempts[0]?.timer ?? null;
  }

  private shouldAssistObjectiveAttempt(ch: ChampionState) {
    if (ch.role === "JGL") return false;
    const attempt = this.activeObjectiveAttemptForTeam(ch.team);
    if (!attempt) return false;
    if (!this.objectiveAdjacentLanes(attempt.key).includes(ch.lane)) return false;
    const enemyTeam: TeamId = ch.team === "blue" ? "red" : "blue";
    const nearbyContestants = this.state.champions.filter((u) => u.alive && u.team === enemyTeam && dist(u.pos, attempt.pos) <= OBJECTIVE_ASSIST_RADIUS).length;
    if (nearbyContestants === 0 && attempt.hp > attempt.maxHp * 0.82) return false;
    return true;
  }

  private contestedDragonAttemptForTeam(team: TeamId) {
    const dragon = this.state.neutralTimers.entities.dragon;
    if (!dragon?.alive) return null;
    const alliedJungler = this.state.champions.find((c) => c.alive && c.team === team && c.role === "JGL");
    if (!alliedJungler) return null;
    if (dist(alliedJungler.pos, dragon.pos) > OBJECTIVE_ASSIST_RADIUS) return null;
    const enemyTeam: TeamId = team === "blue" ? "red" : "blue";
    const enemyContestants = this.state.champions.filter(
      (enemy) => enemy.alive && enemy.team === enemyTeam && dist(enemy.pos, dragon.pos) <= OBJECTIVE_ASSIST_RADIUS,
    ).length;
    if (enemyContestants === 0) return null;
    const dragonBeingDone = dragon.hp <= dragon.maxHp * 0.97 || dist(alliedJungler.pos, dragon.pos) <= OBJECTIVE_ATTEMPT_RADIUS;
    if (!dragonBeingDone) return null;
    return dragon;
  }

  private shouldHardAssistContestedDragon(ch: ChampionState) {
    if (ch.role !== "ADC" && ch.role !== "SUP") return false;
    if (ch.lane !== "bot") return false;
    return Boolean(this.contestedDragonAttemptForTeam(ch.team));
  }

  private hasCredibleKillChance(ch: ChampionState, enemy: ChampionState) {
    if (!enemy.alive || enemy.team === ch.team) return false;
    const rangeGate = ch.role === "JGL" ? 0.14 : LANE_CHAMPION_TRADE_RADIUS;
    if (dist(ch.pos, enemy.pos) > rangeGate) return false;
    if (ch.hp / ch.maxHp <= 0.24) return false;
    if (this.shouldAvoidDive(ch, enemy.pos)) return false;
    if (ch.role !== "JGL" && !this.canOpenTradeWindow(ch, enemy)) return false;

    const allyPressure = this.state.champions.filter((u) => u.alive && u.team === ch.team && dist(u.pos, enemy.pos) <= 0.12).length;
    const enemyPressure = this.state.champions.filter((u) => u.alive && u.team === enemy.team && dist(u.pos, enemy.pos) <= 0.12).length;
    const ttkEnemy = enemy.hp / Math.max(ch.attackDamage, 1);
    const ttkSelf = ch.hp / Math.max(enemy.attackDamage, 1);
    const lowEnemy = enemy.hp / enemy.maxHp <= 0.48;
    return (ttkEnemy <= ttkSelf * 0.95 || lowEnemy) && allyPressure + 0.5 >= enemyPressure;
  }

  private enemyIsOverextendedInLane(forTeam: TeamId, lane: LaneId, enemyPos: Vec2) {
    const lanePath = this.lanePath(forTeam, lane);
    const idx = this.closestLanePathIndex(enemyPos, lanePath);
    return idx <= 2;
  }

  private hasRoamKillChance(ch: ChampionState, lane: LaneId) {
    const enemyTeam: TeamId = ch.team === "blue" ? "red" : "blue";
    const enemies = this.state.champions.filter((u) => u.alive && u.team === enemyTeam && u.lane === lane);
    if (!enemies.length) return false;
    const allies = this.state.champions.filter((u) => u.alive && u.team === ch.team && u.lane === lane).length;
    return enemies.some((enemy) => {
      const lowHp = enemy.hp / enemy.maxHp <= 0.56;
      const overextended = this.enemyIsOverextendedInLane(ch.team, lane, enemy.pos);
      return (lowHp || overextended) && (allies >= 1 || ch.hp / ch.maxHp >= 0.55);
    });
  }

  private nearbyJungleLaneKillTarget(ch: ChampionState) {
    if (ch.role !== "JGL") return null;
    const enemyTeam: TeamId = ch.team === "blue" ? "red" : "blue";
    const options = (["top", "mid", "bot"] as LaneId[])
      .flatMap((lane) => {
        if (!this.hasRoamKillChance(ch, lane)) return [];
        const target = this.state.champions
          .filter((enemy) => enemy.alive && enemy.team === enemyTeam && enemy.lane === lane)
          .sort((a, b) => a.hp - b.hp || dist(ch.pos, a.pos) - dist(ch.pos, b.pos))[0];
        if (!target) return [];
        const lanePath = this.lanePath(ch.team, lane);
        const laneEntry = lanePath[Math.min(3, lanePath.length - 1)] ?? target.pos;
        const proximity = Math.min(dist(ch.pos, target.pos), dist(ch.pos, laneEntry));
        if (proximity > JUNGLE_GANK_WINDOW_RADIUS) return [];
        return [{ target, proximity }];
      })
      .sort((a, b) => a.proximity - b.proximity || a.target.hp - b.target.hp);
    return options[0]?.target ?? null;
  }

  private enemyPressuringAlliedTower(ch: ChampionState) {
    const enemyTeam: TeamId = ch.team === "blue" ? "red" : "blue";
    const alliedTowers = this.state.structures.filter((s) => s.alive && s.team === ch.team && s.kind === "tower");
    if (!alliedTowers.length) return null;
    return this.state.champions
      .filter((enemy) => {
        if (!enemy.alive || enemy.team !== enemyTeam || dist(ch.pos, enemy.pos) > LANE_CHAMPION_TRADE_RADIUS) return false;
        return alliedTowers.some((tower) => tower.lane === enemy.lane && dist(enemy.pos, tower.pos) <= 0.095);
      })
      .sort((a, b) => a.hp - b.hp || dist(ch.pos, a.pos) - dist(ch.pos, b.pos))[0] ?? null;
  }

  private hasLocalNumbersAdvantage(ch: ChampionState, pos: Vec2, radius = 0.11) {
    const allyChampions = this.state.champions.filter((u) => u.alive && u.team === ch.team && dist(u.pos, pos) <= radius).length;
    const enemyChampions = this.state.champions.filter((u) => u.alive && u.team !== ch.team && dist(u.pos, pos) <= radius).length;
    return allyChampions > enemyChampions;
  }

  private isLocalCombatTarget(
    ch: ChampionState,
    target:
      | { kind: "champion"; target: ChampionState }
      | { kind: "minion"; target: MinionState }
      | { kind: "structure"; target: StructureState }
      | { kind: "neutral"; target: NeutralTimerState },
  ) {
    const targetDistance = dist(ch.pos, target.target.pos);
    if (targetDistance > LOCAL_COMBAT_ENGAGE_RADIUS) return false;
    if (target.kind === "structure" && targetDistance > LOCAL_STRUCTURE_ENGAGE_RADIUS) return false;
    if (target.kind === "neutral") {
      const maxNeutralRange = this.isObjectiveNeutralKey(target.target.key) ? OBJECTIVE_ATTEMPT_RADIUS : JUNGLE_CAMP_ENGAGE_RADIUS;
      if (targetDistance > maxNeutralRange) return false;
    }
    return true;
  }

  private shouldHoldBaronSiege(ch: ChampionState, now = this.state.timeSec) {
    if (!this.championHasBaronBuff(ch, now)) return false;
    if (ch.role === "JGL") return false;

    const nextStructure = this.nextEnemyStructureForLane(ch.team, ch.lane, ch.pos);
    if (!nextStructure) return false;

    const nearEnemyStructure = dist(ch.pos, nextStructure.pos) <= 0.18;
    if (!nearEnemyStructure) return false;

    const alliedWaveAtStructure = this.state.minions.some(
      (m) => m.alive && m.team === ch.team && m.lane === ch.lane && dist(m.pos, nextStructure.pos) <= 0.12,
    );
    if (alliedWaveAtStructure) return false;

    const lanePath = this.lanePath(ch.team, ch.lane);
    const championIdx = this.closestLanePathIndex(ch.pos, lanePath);
    const alliedFrontIdx = this.state.minions
      .filter((m) => m.alive && m.team === ch.team && m.lane === ch.lane)
      .reduce((best, m) => Math.max(best, m.pathIndex), 1);

    return championIdx >= alliedFrontIdx;
  }

  private pickCombatTarget(ch: ChampionState, now: number):
    | { kind: "champion"; target: ChampionState }
    | { kind: "minion"; target: MinionState }
    | { kind: "structure"; target: StructureState }
    | { kind: "neutral"; target: NeutralTimerState }
    | null {
    const enemyTeam: TeamId = ch.team === "blue" ? "red" : "blue";

    if (this.shouldHoldBaronSiege(ch, now)) {
      const nearbyWaveTarget = this.state.minions
        .filter((m) => m.alive && m.team === enemyTeam && m.lane === ch.lane && dist(ch.pos, m.pos) <= this.lanerFarmSearchRadius(ch))
        .sort((a, b) => a.hp - b.hp || dist(ch.pos, a.pos) - dist(ch.pos, b.pos))[0];
      return nearbyWaveTarget ? { kind: "minion", target: nearbyWaveTarget } : null;
    }

    const killWindowEnemy = this.state.champions
      .filter((enemy) => enemy.alive && enemy.team === enemyTeam && this.hasCredibleKillChance(ch, enemy))
      .sort((a, b) => a.hp - b.hp || dist(ch.pos, a.pos) - dist(ch.pos, b.pos))[0];
    if (killWindowEnemy) return { kind: "champion", target: killWindowEnemy };

    if (ch.role === "JGL") {
      const nearbyCamp = this.nearbyNeutralCamp(ch);
      if (nearbyCamp) return { kind: "neutral", target: nearbyCamp };
      const nearbyObjective = this.nearbyNeutralObjective(ch);
      if (nearbyObjective) return { kind: "neutral", target: nearbyObjective };
      const nearbyEnemyChampion = this.state.champions
        .filter((enemy) => enemy.alive && enemy.team === enemyTeam && dist(ch.pos, enemy.pos) <= 0.13)
        .sort((a, b) => dist(ch.pos, a.pos) - dist(ch.pos, b.pos))[0];
      if (nearbyEnemyChampion) return { kind: "champion", target: nearbyEnemyChampion };
      return null;
    }

    if (now < LANE_COMBAT_UNLOCK_AT) {
      const earlyLaneMinion = this.state.minions
        .filter((m) => m.alive && m.team === enemyTeam && m.lane === ch.lane && dist(ch.pos, m.pos) <= 0.12)
        .sort((a, b) => a.hp - b.hp || dist(ch.pos, a.pos) - dist(ch.pos, b.pos))[0];
      if (earlyLaneMinion) return { kind: "minion", target: earlyLaneMinion };
      return null;
    }

    const recallingEnemy = this.state.champions
      .filter((enemy) => enemy.alive && enemy.team === enemyTeam && enemy.state === "recall" && dist(ch.pos, enemy.pos) <= LOCAL_COMBAT_ENGAGE_RADIUS)
      .sort((a, b) => dist(ch.pos, a.pos) - dist(ch.pos, b.pos))[0];
    if (recallingEnemy && this.inLaneTradeContext(ch, recallingEnemy.pos, true)) {
      return { kind: "champion", target: recallingEnemy };
    }

    const threateningEnemy = this.state.champions
      .filter((enemy) => {
        if (!enemy.alive || enemy.team !== enemyTeam || dist(ch.pos, enemy.pos) > 0.12) return false;
        return this.state.champions.some(
          (ally) =>
            ally.alive &&
            ally.team === ch.team &&
            dist(ally.pos, ch.pos) <= 0.12 &&
            ally.lastDamagedByChampionId === enemy.id &&
            now - ally.lastDamagedAt <= 2.4,
        );
      })
      .sort((a, b) => dist(ch.pos, a.pos) - dist(ch.pos, b.pos))[0];
    if (threateningEnemy && this.canOpenTradeWindow(ch, threateningEnemy)) {
      return { kind: "champion", target: threateningEnemy };
    }

    if (this.shouldHardAssistContestedDragon(ch)) {
      const dragon = this.state.neutralTimers.entities.dragon;
      const dragonContestant = this.state.champions
        .filter(
          (enemy) => enemy.alive
            && enemy.team === enemyTeam
            && dist(enemy.pos, dragon.pos) <= OBJECTIVE_ASSIST_RADIUS
            && dist(ch.pos, enemy.pos) <= LOCAL_COMBAT_ENGAGE_RADIUS,
        )
        .sort((a, b) => dist(ch.pos, a.pos) - dist(ch.pos, b.pos))[0];
      if (dragonContestant) return { kind: "champion", target: dragonContestant };
      if (dragon.alive && dist(ch.pos, dragon.pos) <= OBJECTIVE_ATTEMPT_RADIUS) {
        return { kind: "neutral", target: dragon };
      }
      // Preserve objective rotation pathing: avoid wave-farm target lock while dragon is contested.
      return null;
    }

    const towerPressuringEnemy = this.enemyPressuringAlliedTower(ch);
    if (towerPressuringEnemy) return { kind: "champion", target: towerPressuringEnemy };

    const numbersAdvantageEnemy = this.state.champions
      .filter(
        (enemy) =>
          enemy.alive
          && enemy.team === enemyTeam
          && enemy.lane === ch.lane
          && dist(ch.pos, enemy.pos) <= LANE_CHAMPION_TRADE_RADIUS
          && this.hasLocalNumbersAdvantage(ch, enemy.pos)
          && this.canOpenTradeWindow(ch, enemy),
      )
      .sort((a, b) => a.hp - b.hp || dist(ch.pos, a.pos) - dist(ch.pos, b.pos))[0];
    if (numbersAdvantageEnemy) return { kind: "champion", target: numbersAdvantageEnemy };

    const lastHit = this.state.minions
      .filter(
        (m) =>
          m.alive &&
          m.team === enemyTeam &&
          m.lane === ch.lane &&
          dist(ch.pos, m.pos) <= this.lanerFarmSearchRadius(ch) &&
          m.hp <= ch.attackDamage * championDamageToMinionMultiplier(ch.role) * 1.08,
      )
      .sort((a, b) => a.hp - b.hp || dist(ch.pos, a.pos) - dist(ch.pos, b.pos))[0];
    if (lastHit) return { kind: "minion", target: lastHit };

    const laneSkirmishEnemy = this.state.champions
      .filter(
        (enemy) =>
          enemy.alive &&
          enemy.team === enemyTeam &&
          enemy.lane === ch.lane &&
          dist(ch.pos, enemy.pos) <= LANE_CHAMPION_TRADE_RADIUS &&
          this.canOpenTradeWindow(ch, enemy),
      )
      .sort((a, b) => dist(ch.pos, a.pos) - dist(ch.pos, b.pos))[0];
    if (laneSkirmishEnemy) return { kind: "champion", target: laneSkirmishEnemy };

    if (this.shouldAssistObjectiveAttempt(ch)) {
      const nearbyObjective = this.nearbyNeutralObjective(ch);
      if (nearbyObjective) return { kind: "neutral", target: nearbyObjective };
    }

    const pressureCandidate = this.nextEnemyStructureForLane(ch.team, ch.lane, ch.pos);
    const pressureStructure = pressureCandidate && pressureCandidate.team === enemyTeam
      ? (() => {
        if ((ch.role as RoleId) !== "JGL") {
          if (dist(ch.pos, pressureCandidate.pos) > LANE_STRUCTURE_PRESSURE_RADIUS) return null;
          const hasAlliedWaveAtStructure = this.state.minions.some(
            (m) => m.alive && m.team === ch.team && m.lane === ch.lane && dist(m.pos, pressureCandidate.pos) <= 0.1,
          );
          if (!hasAlliedWaveAtStructure) return null;
          const enemyWaveAtStructure = this.state.minions.filter(
            (m) => m.alive && m.team !== ch.team && m.lane === ch.lane && dist(m.pos, pressureCandidate.pos) <= 0.08,
          ).length;
          if (enemyWaveAtStructure >= 2) return null;
        }
        return pressureCandidate;
      })()
      : null;
    if (pressureStructure) return { kind: "structure", target: pressureStructure };

    const waveFront = this.laneWaveFrontPos(ch);
    const farmingMinion = this.state.minions
      .filter(
        (m) =>
          m.alive &&
          m.team === enemyTeam &&
          m.lane === ch.lane &&
          dist(ch.pos, m.pos) <= this.lanerFarmSearchRadius(ch),
      )
      .sort((a, b) => dist(waveFront, a.pos) - dist(waveFront, b.pos) || dist(ch.pos, a.pos) - dist(ch.pos, b.pos))[0];
    if (farmingMinion) return { kind: "minion", target: farmingMinion };

    const nearestStructure = pressureCandidate && pressureCandidate.team === enemyTeam
      ? (() => {
        // Laners should pressure structures only when truly nearby and with allied wave support.
        if ((ch.role as RoleId) !== "JGL") {
          if (dist(ch.pos, pressureCandidate.pos) > LANE_STRUCTURE_PRESSURE_RADIUS) return null;
          const hasAlliedWaveAtStructure = this.state.minions.some(
            (m) => m.alive && m.team === ch.team && m.lane === ch.lane && dist(m.pos, pressureCandidate.pos) <= 0.09,
          );
          if (!hasAlliedWaveAtStructure) return null;
        }
        return pressureCandidate;
      })()
      : null;
    const nearestMinion = this.state.minions
      .filter((m) => m.alive && m.team === enemyTeam && m.lane === ch.lane)
      .sort((a, b) => dist(ch.pos, a.pos) - dist(ch.pos, b.pos))[0];
    const nearestEnemyChampion = this.state.champions
      .filter((enemy) => enemy.alive && enemy.team === enemyTeam && enemy.lane === ch.lane && this.canOpenTradeWindow(ch, enemy))
      .sort((a, b) => dist(ch.pos, a.pos) - dist(ch.pos, b.pos))[0];
    const nearbyCamp = this.nearbyNeutralCamp(ch);

    const candidates: Array<{
      kind: "champion" | "minion" | "structure" | "neutral";
      target: ChampionState | MinionState | StructureState | NeutralTimerState;
      d: number;
    }> = [];
    if (nearbyCamp) candidates.push({ kind: "neutral", target: nearbyCamp, d: dist(ch.pos, nearbyCamp.pos) - 0.015 });
    if (nearestEnemyChampion) candidates.push({ kind: "champion", target: nearestEnemyChampion, d: dist(ch.pos, nearestEnemyChampion.pos) });
    if (nearestMinion) candidates.push({ kind: "minion", target: nearestMinion, d: dist(ch.pos, nearestMinion.pos) });
    if (nearestStructure) candidates.push({ kind: "structure", target: nearestStructure, d: dist(ch.pos, nearestStructure.pos) });

    if (!candidates.length) return null;
    const selected = candidates.sort((a, b) => a.d - b.d)[0];
    if (selected.kind === "champion") return { kind: "champion", target: selected.target as ChampionState };
    if (selected.kind === "minion") return { kind: "minion", target: selected.target as MinionState };
    if (selected.kind === "neutral") return { kind: "neutral", target: selected.target as NeutralTimerState };
    return { kind: "structure", target: selected.target as StructureState };
  }

  private createInitialState(): MatchState {
    const champions: ChampionState[] = [];
    const seedTeam = (team: TeamId, players: MatchSnapshot["home_team"]["players"]) => {
      const ordered: RoleId[] = ["TOP", "JGL", "MID", "ADC", "SUP"];
      players.slice(0, 5).forEach((p, i) => {
        const role = ordered[i];
        const b = BASE_POSITION[team];
        const o = ROLE_OFFSET[role];
        const championId = this.championByPlayerId[p.id];
        const combatProfile = championId ? this.championProfilesById[championId] : undefined;
        const attackType: AttackType = combatProfile?.attackType ?? "melee";
        const maxHp = championMaxHpFromBase(combatProfile?.baseHp ?? 560);
        const attackRange = combatProfile?.attackRange ?? (attackType === "ranged" ? 0.056 : 0.049);
        champions.push({
          id: p.id,
          name: p.name,
          team,
          role,
          lane: this.laneOf(role),
          pos: { x: b.x + o.x, y: b.y + o.y },
          hp: maxHp,
          maxHp,
          alive: true,
          respawnAt: 0,
          attackCdUntil: 0,
          moveSpeed: 0.043 + this.rng() * 0.008,
          attackRange,
          attackType,
          attackDamage: 14 + this.rng() * 5,
          targetPath: [],
          targetPathIndex: 0,
          nextDecisionAt: 0,
          kills: 0,
          deaths: 0,
          assists: 0,
          gold: 500,
          spentGold: 0,
          xp: 0,
          level: 1,
          cs: 0,
          items: [],
          lastDamagedByChampionId: null,
          lastDamagedAt: -999,
          state: "lane",
          recallAnchor: null,
          recallChannelUntil: 0,
        });
      });
    };
    seedTeam("blue", this.snapshot.home_team.players);
    seedTeam("red", this.snapshot.away_team.players);
    this.jungleStartByTeam = {
      blue: this.resolveJungleStartBuff("blue"),
      red: this.resolveJungleStartBuff("red"),
    };

    const structures: StructureState[] = getStructures().map((s) => ({
      id: s.id,
      team: s.team,
      lane: s.lane,
      kind: s.kind as StructureState["kind"],
      pos: s.pos,
      hp: s.kind === "nexus" ? 2300 : s.kind === "inhib" ? 1500 : 1400,
      maxHp: s.kind === "nexus" ? 2300 : s.kind === "inhib" ? 1500 : 1400,
      alive: true,
      attackCdUntil: 0,
    }));

    const pushEvent = (events: SimEvent[], text: string, type: SimEvent["type"]) => {
      events.unshift({ t: 0, text, type });
    };

    const events: SimEvent[] = [];
    pushEvent(events, "Match started", "info");
    const neutralTimers = this.buildNeutralTimersState();

    return {
      timeSec: 0,
      running: true,
      winner: null,
      champions,
      minions: [],
      structures,
      objectives: {
        dragon: { key: "dragon", pos: OBJECTIVES.dragon, alive: false, nextSpawnAt: 5 * 60 },
        baron: { key: "baron", pos: OBJECTIVES.baron, alive: false, nextSpawnAt: 20 * 60 },
      },
      neutralTimers,
      stats: {
        blue: { kills: 0, towers: 0, dragons: 0, barons: 0, gold: 2500 },
        red: { kills: 0, towers: 0, dragons: 0, barons: 0, gold: 2500 },
      },
      events,
      showWalls: false,
    };
  }

  private log(text: string, type: SimEvent["type"]) {
    this.state.events.unshift({ t: this.state.timeSec, text, type });
    this.state.events = this.state.events.slice(0, 80);
  }

  private lanePath(team: TeamId, lane: LaneId) {
    return team === "blue" ? LANE_PATH_BLUE[lane] : [...LANE_PATH_BLUE[lane]].reverse();
  }

  private setChampionPath(ch: ChampionState, target: Vec2, minTargetDelta = 0.018, force = false) {
    const currentTarget = ch.targetPath[ch.targetPath.length - 1];
    const shouldRepath =
      force ||
      !currentTarget ||
      ch.targetPath.length === 0 ||
      ch.targetPathIndex >= ch.targetPath.length - 1 ||
      dist(currentTarget, target) > minTargetDelta;
    if (!shouldRepath) return;
    const rawPath = this.nav.findPath(ch.pos, target);
    const path = [...rawPath];

    // Drop trivial first node equal to current position to avoid repath-reset loops.
    while (path.length > 1 && dist(path[0], ch.pos) < 0.0095) {
      path.shift();
    }

    // Safety fallback: if nav collapses to a single node while target is still far,
    // force a direct step so champions don't freeze due grid snapping anomalies.
    if (path.length <= 1 && dist(ch.pos, target) > 0.012) {
      ch.targetPath = [target];
      ch.targetPathIndex = 0;
      return;
    }

    ch.targetPath = path;
    ch.targetPathIndex = 0;
  }

  private laneAnchorPos(ch: ChampionState) {
    const lanePath = this.lanePath(ch.team, ch.lane);
    const anchorIdx = this.chooseLaneAnchorIndex(ch, lanePath);
    return lanePath[anchorIdx];
  }

  private lanePreWaveHoldPos(ch: ChampionState) {
    const lanePath = this.lanePath(ch.team, ch.lane);
    const alliedLaneTower = this.state.structures
      .filter((s) => s.alive && s.team === ch.team && s.kind === "tower" && s.lane === ch.lane)
      .sort((a, b) => this.closestLanePathIndex(b.pos, lanePath) - this.closestLanePathIndex(a.pos, lanePath))[0];
    if (alliedLaneTower) {
      // Pre-wave hold should be in front of allied outer lane tower to contest first wave.
      return this.laneFallbackPosFromTower(ch, alliedLaneTower, false);
    }
    return lanePath[Math.min(2, lanePath.length - 1)] ?? lanePath[0];
  }

  private laneRoleProfile(ch: ChampionState) {
    return LANE_ROLE_PROFILE[ch.role as Exclude<RoleId, "JGL">];
  }

  private isFirstWaveContestActive(ch: ChampionState) {
    if (ch.role === "JGL") return false;
    return this.state.timeSec >= MINION_FIRST_WAVE_AT && this.state.timeSec <= FIRST_WAVE_CONTEST_UNTIL;
  }

  private lanerFarmSearchRadius(ch: ChampionState) {
    if (ch.role === "JGL") return 0.13;
    return LANER_FARM_SEARCH_RADIUS[ch.role as Exclude<RoleId, "JGL">];
  }

  private alliedAliveLaneTowers(ch: ChampionState) {
    const lanePath = this.lanePath(ch.team, ch.lane);
    return this.state.structures
      .filter((s): s is StructureState => s.alive && s.team === ch.team && s.kind === "tower" && s.lane === ch.lane)
      .map((tower) => ({ tower, pathIndex: this.closestLanePathIndex(tower.pos, lanePath) }))
      .sort((a, b) => a.pathIndex - b.pathIndex);
  }

  private shouldAllowEmergencyRetreat(ch: ChampionState, threatPos: Vec2) {
    if (ch.role === "JGL") return false;
    const profile = this.laneRoleProfile(ch);
    const hpRatio = ch.hp / ch.maxHp;
    if (hpRatio <= profile.retreatHp) return true;

    const pressure = this.lanePressureAt(ch, threatPos);
    const stronglyUnfavorable =
      pressure.enemyScore >= pressure.allyScore + profile.outnumberTolerance + LANE_STRONG_UNFAVORABLE_PRESSURE_DELTA
      || pressure.enemyChampions >= pressure.allyChampions + 1;
    if (!stronglyUnfavorable) return false;
    return hpRatio < LANE_HEALTHY_RETREAT_HP_RATIO || pressure.enemyChampions >= pressure.allyChampions + 2;
  }

  private pickAlliedLaneFallbackTower(ch: ChampionState, threatPos: Vec2, allowEmergencyRetreat: boolean) {
    const lanePath = this.lanePath(ch.team, ch.lane);
    const towers = this.alliedAliveLaneTowers(ch);
    if (!towers.length) return null;

    const threatIndex = this.closestLanePathIndex(threatPos, lanePath);
    let selected = [...towers]
      .filter((entry) => entry.pathIndex <= threatIndex + 1)
      .sort((a, b) => b.pathIndex - a.pathIndex)[0];

    if (!selected) {
      selected = [...towers].sort(
        (a, b) => dist(threatPos, a.tower.pos) - dist(threatPos, b.tower.pos) || b.pathIndex - a.pathIndex,
      )[0];
    }

    if (!selected || allowEmergencyRetreat || towers.length < 2) return selected;

    const laneDefenseBand = [...towers].sort((a, b) => b.pathIndex - a.pathIndex).slice(0, 2);
    const minSafeBandIndex = Math.min(...laneDefenseBand.map((entry) => entry.pathIndex));
    if (selected.pathIndex >= minSafeBandIndex) return selected;

    return (
      towers
        .filter((entry) => entry.pathIndex >= minSafeBandIndex)
        .sort(
          (a, b) => Math.abs(a.pathIndex - minSafeBandIndex) - Math.abs(b.pathIndex - minSafeBandIndex)
            || b.pathIndex - a.pathIndex,
        )[0]
      ?? selected
    );
  }

  private laneFallbackPosFromTower(ch: ChampionState, tower: StructureState, towardBase: boolean) {
    const lanePath = this.lanePath(ch.team, ch.lane);
    const towerIdx = this.closestLanePathIndex(tower.pos, lanePath);
    const laneTarget = towardBase
      ? lanePath[Math.max(0, towerIdx - 1)] ?? BASE_POSITION[ch.team]
      : lanePath[Math.min(lanePath.length - 1, towerIdx + 1)] ?? lanePath[towerIdx] ?? tower.pos;
    const dir = normalize({ x: laneTarget.x - tower.pos.x, y: laneTarget.y - tower.pos.y });
    const offset = towardBase ? LANE_FALLBACK_TOWER_OFFSET : LANE_FALLBACK_TOWER_OFFSET * 1.25;
    return {
      x: clamp(tower.pos.x + dir.x * offset, 0.01, 0.99),
      y: clamp(tower.pos.y + dir.y * offset, 0.01, 0.99),
    };
  }

  private laneRetreatAnchorPos(ch: ChampionState, threatPos: Vec2) {
    if (ch.role === "JGL") return { ...BASE_POSITION[ch.team] };
    if (this.isFirstWaveContestActive(ch) && ch.hp / ch.maxHp >= 0.45) {
      // Manual fix: first wave should always be contested in lane unless critically low.
      return this.laneFarmAnchorPos(ch);
    }
    const farmAnchor = this.laneFarmAnchorPos(ch);
    const emergency = this.shouldAllowEmergencyRetreat(ch, threatPos);
    const fallbackTower = this.pickAlliedLaneFallbackTower(ch, threatPos, emergency);
    if (!fallbackTower) return farmAnchor;

    const towerFallback = this.laneFallbackPosFromTower(ch, fallbackTower.tower, emergency);
    if (emergency) return towerFallback;

    const lanePath = this.lanePath(ch.team, ch.lane);
    const farmIdx = this.closestLanePathIndex(farmAnchor, lanePath);
    const towerIdx = this.closestLanePathIndex(towerFallback, lanePath);
    return towerIdx < farmIdx ? farmAnchor : towerFallback;
  }

  private nearestEnemyChampion(ch: ChampionState, radius = Number.POSITIVE_INFINITY) {
    const enemyTeam: TeamId = ch.team === "blue" ? "red" : "blue";
    return this.state.champions
      .filter((enemy) => enemy.alive && enemy.team === enemyTeam && dist(ch.pos, enemy.pos) <= radius)
      .sort((a, b) => dist(ch.pos, a.pos) - dist(ch.pos, b.pos))[0] ?? null;
  }

  private shouldRecallInPlace(ch: ChampionState) {
    const nearest = this.nearestEnemyChampion(ch, RECALL_SAFE_ENEMY_RADIUS);
    if (!nearest) return true;
    const d = dist(ch.pos, nearest.pos);
    const enemyReachTime = d / Math.max(nearest.moveSpeed, 0.01);
    return enemyReachTime > RECALL_CHANNEL_SEC + RECALL_REACH_BUFFER_SEC;
  }

  private pickRecallAnchor(ch: ChampionState) {
    if (this.shouldRecallInPlace(ch)) return { ...ch.pos };
    const threat = this.nearestEnemyChampion(ch, RECALL_SAFE_ENEMY_RADIUS) ?? this.nearestEnemyChampion(ch);
    if (threat) {
      if (ch.role === "JGL") {
        const awayFromThreat = normalize({ x: ch.pos.x - threat.pos.x, y: ch.pos.y - threat.pos.y });
        const towardBase = normalize({ x: BASE_POSITION[ch.team].x - ch.pos.x, y: BASE_POSITION[ch.team].y - ch.pos.y });
        const blended = normalize({
          x: awayFromThreat.x * 0.8 + towardBase.x * 0.2,
          y: awayFromThreat.y * 0.8 + towardBase.y * 0.2,
        });
        return {
          x: clamp(ch.pos.x + blended.x * 0.045, 0.01, 0.99),
          y: clamp(ch.pos.y + blended.y * 0.045, 0.01, 0.99),
        };
      }
      return this.laneRetreatAnchorPos(ch, threat.pos);
    }
    if (ch.role !== "JGL") return this.laneRetreatAnchorPos(ch, ch.pos);
    return { ...BASE_POSITION[ch.team] };
  }

  private recallFallbackTowardBase(ch: ChampionState) {
    const towardBase = normalize({
      x: BASE_POSITION[ch.team].x - ch.pos.x,
      y: BASE_POSITION[ch.team].y - ch.pos.y,
    });
    const step = ch.role === "JGL" ? 0.05 : 0.04;
    return {
      x: clamp(ch.pos.x + towardBase.x * step, 0.01, 0.99),
      y: clamp(ch.pos.y + towardBase.y * step, 0.01, 0.99),
    };
  }

  private startRecall(ch: ChampionState) {
    if (ch.state === "recall") return;
    ch.state = "recall";
    ch.recallAnchor = this.pickRecallAnchor(ch);
    ch.recallChannelUntil = 0;
    ch.targetPath = [];
    ch.targetPathIndex = 0;
  }

  private cancelRecall(ch: ChampionState, now: number) {
    if (ch.state !== "recall") return;
    const wasChanneling = ch.recallChannelUntil > now;
    ch.state = "lane";
    ch.recallAnchor = null;
    ch.recallChannelUntil = 0;
    if (wasChanneling) {
      this.log(`${ch.name} recall interrupted`, "recall");
    }
  }

  private tickRecall(ch: ChampionState, now: number) {
    if (ch.state !== "recall") return false;

    if (ch.recallChannelUntil > 0 && now >= ch.recallChannelUntil) {
      ch.pos = { ...BASE_POSITION[ch.team] };
      ch.hp = ch.maxHp;
      ch.state = "lane";
      ch.recallAnchor = null;
      ch.recallChannelUntil = 0;
      this.log(`${ch.name} recalled`, "recall");
      return false;
    }

    if (ch.recallChannelUntil > now) {
      return true;
    }

    const anchor = ch.recallAnchor ?? { ...ch.pos };
    if (dist(ch.pos, anchor) > 0.012) {
      this.setChampionPath(ch, anchor, 0.006, true);
      return true;
    }

    if (!this.shouldRecallInPlace(ch)) {
      const fallbackAnchor = this.recallFallbackTowardBase(ch);
      ch.recallAnchor = fallbackAnchor;
      this.setChampionPath(ch, fallbackAnchor, 0.006, true);
      return true;
    }

    ch.recallChannelUntil = now + RECALL_CHANNEL_SEC;
    ch.targetPath = [];
    ch.targetPathIndex = 0;
    this.log(`${ch.name} started recall`, "recall");
    return true;
  }

  private laneCombatState(ch: ChampionState): LanerCombatState {
    let state = this.laneCombatStateByChampion.get(ch.id);
    if (!state) {
      state = { lastDisengageAt: -999, reengageAt: -999, recentTradeUntil: -999 };
      this.laneCombatStateByChampion.set(ch.id, state);
    }
    return state;
  }

  private markLaneDisengage(ch: ChampionState, now: number) {
    if (ch.role === "JGL") return;
    const state = this.laneCombatState(ch);
    state.lastDisengageAt = now;
    state.reengageAt = Math.max(state.reengageAt, now + LANE_REENGAGE_COOLDOWN_SEC);
    state.recentTradeUntil = Math.max(state.recentTradeUntil, now + LANE_RECENT_TRADE_LOCK_SEC);
  }

  private markLaneTradeHit(ch: ChampionState, now: number) {
    if (ch.role === "JGL") return;
    const state = this.laneCombatState(ch);
    state.recentTradeUntil = Math.max(state.recentTradeUntil, now + LANE_RECENT_TRADE_LOCK_SEC);
  }

  private laneTradeCooldownActive(ch: ChampionState, now: number) {
    if (ch.role === "JGL") return false;
    const state = this.laneCombatState(ch);
    return now < state.reengageAt;
  }

  private laneRecentTradeLockActive(ch: ChampionState, now: number) {
    if (ch.role === "JGL") return false;
    const state = this.laneCombatState(ch);
    return now < state.recentTradeUntil;
  }

  private laneMinionContextDistance(ch: ChampionState, pos: Vec2) {
    const nearest = this.state.minions
      .filter((m) => m.alive && m.lane === ch.lane)
      .sort((a, b) => dist(pos, a.pos) - dist(pos, b.pos))[0];
    if (!nearest) return Number.POSITIVE_INFINITY;
    return dist(pos, nearest.pos);
  }

  private inLaneTradeContext(ch: ChampionState, pos: Vec2, forChase = false) {
    if (ch.role === "JGL") return true;
    const profile = this.laneRoleProfile(ch);
    const laneAnchor = this.laneAnchorPos(ch);
    const waveFront = this.laneWaveFrontPos(ch);
    const anchorBudget = profile.chaseLeash * (forChase ? 1.05 : 0.92);
    const waveBudget = profile.chaseLeash * (forChase ? 1.15 : 1.0);
    const minionBudget = forChase ? LANE_CHASE_MINION_CONTEXT_RADIUS : LANE_MINION_CONTEXT_RADIUS;
    if (dist(pos, laneAnchor) > anchorBudget) return false;
    if (dist(pos, waveFront) > waveBudget) return false;
    if (this.laneMinionContextDistance(ch, pos) > minionBudget) return false;
    return true;
  }

  private canChampionTradeInLaneContext(ch: ChampionState, enemy: ChampionState, now: number) {
    if (ch.role === "JGL") return true;
    const clearWinCondition = this.shouldCommitAllInTrade(ch, enemy);
    if ((this.laneTradeCooldownActive(ch, now) || this.laneRecentTradeLockActive(ch, now)) && !clearWinCondition) return false;
    if (!this.inLaneTradeContext(ch, ch.pos)) return false;
    if (!this.inLaneTradeContext(ch, enemy.pos, true)) return false;
    return true;
  }

  private issueLaneDisengage(ch: ChampionState, now: number, threatPos: Vec2 = ch.pos) {
    if (ch.role === "JGL") {
      const jungleFallback = this.pickJungleFarmPos(ch, now);
      if (jungleFallback) {
        this.setChampionPath(ch, jungleFallback, 0.012, true);
        return;
      }
    }
    if (ch.role !== "JGL") {
      this.markLaneDisengage(ch, now);
    }
    ch.state = "lane";
    this.setChampionPath(ch, this.laneRetreatAnchorPos(ch, threatPos), 0.008, true);
  }

  private laneWaveFrontPos(ch: ChampionState) {
    const alliedLaneWave = this.state.minions
      .filter((m) => m.alive && m.team === ch.team && m.lane === ch.lane)
      .sort((a, b) => b.pathIndex - a.pathIndex)
      .slice(0, 3);
    const enemyLaneWave = this.state.minions
      .filter((m) => m.alive && m.team !== ch.team && m.lane === ch.lane)
      .sort((a, b) => b.pathIndex - a.pathIndex)
      .slice(0, 3);

    const alliedWave = alliedLaneWave.length
      ? {
          x: alliedLaneWave.reduce((acc, m) => acc + m.pos.x, 0) / alliedLaneWave.length,
          y: alliedLaneWave.reduce((acc, m) => acc + m.pos.y, 0) / alliedLaneWave.length,
        }
      : null;
    const nearbyEnemyWave = enemyLaneWave.length
      ? {
          x: enemyLaneWave.reduce((acc, m) => acc + m.pos.x, 0) / enemyLaneWave.length,
          y: enemyLaneWave.reduce((acc, m) => acc + m.pos.y, 0) / enemyLaneWave.length,
        }
      : null;

    if (alliedWave && nearbyEnemyWave) {
      return {
        x: (alliedWave.x + nearbyEnemyWave.x) / 2,
        y: (alliedWave.y + nearbyEnemyWave.y) / 2,
      };
    }
    if (alliedWave) return alliedWave;
    if (nearbyEnemyWave) return nearbyEnemyWave;
    return this.laneAnchorPos(ch);
  }

  private lanePressureAt(ch: ChampionState, pos: Vec2, radius = LANE_LOCAL_PRESSURE_RADIUS) {
    const allyChampions = this.state.champions.filter((u) => u.alive && u.team === ch.team && dist(u.pos, pos) <= radius).length;
    const enemyChampions = this.state.champions.filter((u) => u.alive && u.team !== ch.team && dist(u.pos, pos) <= radius).length;
    const allyLaneMinions = this.state.minions.filter((m) => m.alive && m.team === ch.team && m.lane === ch.lane && dist(m.pos, pos) <= radius).length;
    const enemyLaneMinions = this.state.minions.filter((m) => m.alive && m.team !== ch.team && m.lane === ch.lane && dist(m.pos, pos) <= radius).length;
    const allyScore = allyChampions * 1.25 + allyLaneMinions * 0.48;
    const enemyScore = enemyChampions * 1.25 + enemyLaneMinions * 0.48;
    return { allyChampions, enemyChampions, allyLaneMinions, enemyLaneMinions, allyScore, enemyScore };
  }

  private isDeepEnemyTowerZone(ch: ChampionState, targetPos: Vec2) {
    const enemyTower = this.state.structures.find(
      (s) => s.alive && s.team !== ch.team && s.kind === "tower" && s.lane === ch.lane && dist(s.pos, targetPos) <= 0.1,
    );
    if (!enemyTower) return false;
    const alliedWaveNearTower = this.state.minions.filter((m) => m.alive && m.team === ch.team && m.lane === ch.lane && dist(m.pos, enemyTower.pos) <= 0.085).length;
    return alliedWaveNearTower < 2;
  }

  private isInsideLanerTradeLeash(ch: ChampionState, targetPos: Vec2) {
    const profile = this.laneRoleProfile(ch);
    const laneAnchor = this.laneAnchorPos(ch);
    const waveFront = this.laneWaveFrontPos(ch);
    return dist(targetPos, laneAnchor) <= profile.chaseLeash && dist(targetPos, waveFront) <= profile.chaseLeash * 1.15;
  }

  private shouldForceLanerDisengage(ch: ChampionState, targetPos: Vec2, enemy?: ChampionState) {
    if (ch.role === "JGL") return false;
    const profile = this.laneRoleProfile(ch);
    const hpRatio = ch.hp / ch.maxHp;
    if (hpRatio <= profile.retreatHp) return true;
    if (!this.isInsideLanerTradeLeash(ch, targetPos)) return true;
    if (this.isDeepEnemyTowerZone(ch, targetPos)) return true;
    if (this.shouldAvoidDive(ch, targetPos)) return true;

    const pressure = this.lanePressureAt(ch, targetPos);
    if (pressure.enemyScore > pressure.allyScore + profile.outnumberTolerance) return true;
    if (enemy) {
      const enemyHpRatio = enemy.hp / enemy.maxHp;
      if (hpRatio + TRADE_HP_DISADVANTAGE_ALLOWANCE < enemyHpRatio) return true;
    }
    return false;
  }

  private canOpenTradeWindow(ch: ChampionState, enemy: ChampionState) {
    if (ch.role === "JGL") return true;
    if (dist(ch.pos, enemy.pos) > LANE_CHAMPION_TRADE_RADIUS) return false;
    if (!this.canChampionTradeInLaneContext(ch, enemy, this.state.timeSec)) return false;
    if (this.shouldForceLanerDisengage(ch, enemy.pos, enemy)) return false;

    const hpRatio = ch.hp / ch.maxHp;
    const enemyHpRatio = enemy.hp / enemy.maxHp;
    const pressure = this.lanePressureAt(ch, enemy.pos);
    const numbersAdvantage = pressure.allyChampions > pressure.enemyChampions;
    if (numbersAdvantage && hpRatio + 0.02 >= enemyHpRatio && hpRatio >= 0.32) return true;

    const allyMinionsNearFight = this.state.minions.filter(
      (m) => m.alive && m.team === ch.team && m.lane === ch.lane && dist(m.pos, enemy.pos) <= 0.1,
    ).length;
    const enemyMinionsNearFight = this.state.minions.filter(
      (m) => m.alive && m.team !== ch.team && m.lane === ch.lane && dist(m.pos, enemy.pos) <= 0.1,
    ).length;
    const totalWaveContext = allyMinionsNearFight + enemyMinionsNearFight;
    if (totalWaveContext < 1) return false;
    if (this.isFirstWaveContestActive(ch) && (allyMinionsNearFight < 2 || enemyMinionsNearFight < 2)) return false;
    if (allyMinionsNearFight === 0) {
      const lowEnemyWindow = enemy.hp / enemy.maxHp <= 0.34;
      const hpSafeToTrade = ch.hp / ch.maxHp >= 0.5;
      if (!(lowEnemyWindow && hpSafeToTrade)) return false;
    }

    const hpAdvantage = hpRatio + 0.08 >= enemyHpRatio;
    const wavePressure = pressure.allyLaneMinions >= pressure.enemyLaneMinions;
    const scorePressure = pressure.allyScore >= pressure.enemyScore - 0.05;
    return hpAdvantage && wavePressure && scorePressure;
  }

  private laneFarmAnchorPos(ch: ChampionState) {
    const laneAnchor = this.laneAnchorPos(ch);
    const waveFront = this.laneWaveFrontPos(ch);

    if (this.isFirstWaveContestActive(ch)) {
      const toWave = normalize({ x: waveFront.x - laneAnchor.x, y: waveFront.y - laneAnchor.y });
      const contestAdvance = Math.max(0.014, Math.min(this.laneRoleProfile(ch).approachLeash * 0.95, dist(laneAnchor, waveFront) * 0.6));
      return {
        x: clamp(laneAnchor.x + toWave.x * contestAdvance, 0.01, 0.99),
        y: clamp(laneAnchor.y + toWave.y * contestAdvance, 0.01, 0.99),
      };
    }

    if (ch.role === "SUP") {
      const alliedAdc = this.state.champions.find((ally) => ally.alive && ally.team === ch.team && ally.role === "ADC");
      if (alliedAdc) {
        const toWave = normalize({ x: waveFront.x - alliedAdc.pos.x, y: waveFront.y - alliedAdc.pos.y });
        const tethered = {
          x: alliedAdc.pos.x - toWave.x * 0.012,
          y: alliedAdc.pos.y - toWave.y * 0.012,
        };
        if (dist(tethered, waveFront) <= 0.14) return tethered;
      }
    }

    const toWave = normalize({ x: waveFront.x - laneAnchor.x, y: waveFront.y - laneAnchor.y });
    const roleLeash = this.laneRoleProfile(ch).approachLeash;
    const alliedLaneTower = this.state.structures
      .filter((s) => s.alive && s.team === ch.team && s.kind === "tower" && s.lane === ch.lane)
      .sort((a, b) => dist(ch.pos, a.pos) - dist(ch.pos, b.pos))[0];
    const waveAtOwnTower = Boolean(alliedLaneTower) && dist(waveFront, alliedLaneTower.pos) <= 0.11;

    if (waveAtOwnTower && alliedLaneTower && ch.role !== "SUP") {
      const toWaveFromTower = normalize({ x: waveFront.x - alliedLaneTower.pos.x, y: waveFront.y - alliedLaneTower.pos.y });
      const frontOffset = clamp(ch.attackRange * 0.7, 0.02, 0.034);
      return {
        x: clamp(alliedLaneTower.pos.x + toWaveFromTower.x * frontOffset, 0.01, 0.99),
        y: clamp(alliedLaneTower.pos.y + toWaveFromTower.y * frontOffset, 0.01, 0.99),
      };
    }

    const emergencyFarmBoost = waveAtOwnTower ? 1.55 : 1;
    const advance = Math.min(roleLeash * emergencyFarmBoost, Math.max(0.01, dist(laneAnchor, waveFront) * 0.7));
    return {
      x: laneAnchor.x + toWave.x * advance,
      y: laneAnchor.y + toWave.y * advance,
    };
  }

  private baronSiegeAnchorPos(ch: ChampionState) {
    const lanePath = this.lanePath(ch.team, ch.lane);
    const alliedLaneMinions = this.state.minions
      .filter((m) => m.alive && m.team === ch.team && m.lane === ch.lane)
      .sort((a, b) => b.pathIndex - a.pathIndex || dist(ch.pos, a.pos) - dist(ch.pos, b.pos));
    if (!alliedLaneMinions.length) return null;

    const front = alliedLaneMinions[0];
    const safeOffset = ch.attackType === "ranged" ? 2 : 1;
    const anchorIdx = clamp(front.pathIndex - safeOffset, 1, lanePath.length - 1);
    const anchor = lanePath[anchorIdx] ?? front.pos;

    const nextStructure = this.nextEnemyStructureForLane(ch.team, ch.lane, ch.pos);
    if (nextStructure) {
      const waveAtStructure = alliedLaneMinions.some((m) => dist(m.pos, nextStructure.pos) <= 0.1);
      const championAheadOfWave = this.closestLanePathIndex(ch.pos, lanePath) > front.pathIndex + 1;
      if (!waveAtStructure || championAheadOfWave) return anchor;
    }

    return this.laneFarmAnchorPos(ch);
  }

  private shouldDisengageChampionTrade(ch: ChampionState, enemy: ChampionState) {
    if (ch.role === "JGL") return false;

    if (this.shouldForceLanerDisengage(ch, enemy.pos, enemy)) return true;

    const selfHpRatio = ch.hp / ch.maxHp;
    const enemyHpRatio = enemy.hp / enemy.maxHp;
    if (selfHpRatio < TRADE_RETREAT_HP_RATIO) return true;
    if (selfHpRatio + TRADE_HP_DISADVANTAGE_ALLOWANCE < enemyHpRatio) return true;

    const allyChampions = this.state.champions.filter((u) => u.alive && u.team === ch.team && dist(u.pos, enemy.pos) <= 0.11).length;
    const enemyChampions = this.state.champions.filter((u) => u.alive && u.team !== ch.team && dist(u.pos, enemy.pos) <= 0.11).length;
    const allyLaneMinions = this.state.minions.filter((m) => m.alive && m.team === ch.team && m.lane === ch.lane && dist(m.pos, enemy.pos) <= 0.085).length;
    const enemyLaneMinions = this.state.minions.filter((m) => m.alive && m.team !== ch.team && m.lane === ch.lane && dist(m.pos, enemy.pos) <= 0.085).length;

    const alliedPressure = allyChampions + allyLaneMinions * 0.5;
    const enemyPressure = enemyChampions + enemyLaneMinions * 0.5;
    if (enemyPressure > alliedPressure + 0.7) return true;

    const laneAnchor = this.laneAnchorPos(ch);
    if (dist(enemy.pos, laneAnchor) > LANE_CHASE_LEASH_RADIUS && enemyPressure >= alliedPressure) return true;

    return false;
  }

  private shouldCommitAllInTrade(ch: ChampionState, enemy: ChampionState) {
    if (ch.role === "JGL") return true;
    const selfHp = ch.hp / ch.maxHp;
    const enemyHp = enemy.hp / enemy.maxHp;
    if (enemyHp <= 0.2 && selfHp >= 0.25) return true;
    const pressure = this.lanePressureAt(ch, enemy.pos);
    if (pressure.allyChampions > pressure.enemyChampions && selfHp >= 0.32) return true;
    return pressure.allyScore >= pressure.enemyScore + 0.9 && selfHp >= enemyHp;
  }

  private laneTradeApproachPos(ch: ChampionState, enemy: ChampionState) {
    const anchor = this.laneFarmAnchorPos(ch);
    const leash = this.laneRoleProfile(ch).approachLeash;
    const enemyFromAnchor = normalize({ x: enemy.pos.x - anchor.x, y: enemy.pos.y - anchor.y });
    const desiredSpacing = Math.max(0.025, ch.attackRange * 0.9);

    const ideal = {
      x: enemy.pos.x - enemyFromAnchor.x * desiredSpacing,
      y: enemy.pos.y - enemyFromAnchor.y * desiredSpacing,
    };

    const deltaFromAnchor = { x: ideal.x - anchor.x, y: ideal.y - anchor.y };
    const distFromAnchor = Math.hypot(deltaFromAnchor.x, deltaFromAnchor.y);
    if (distFromAnchor <= leash) return ideal;

    const capped = normalize(deltaFromAnchor);
    return {
      x: anchor.x + capped.x * leash,
      y: anchor.y + capped.y * leash,
    };
  }

  private updateStuckRecovery(ch: ChampionState, now: number) {
    const finalTarget = ch.targetPath[ch.targetPath.length - 1];
    const hasActivePath = Boolean(finalTarget) && ch.targetPathIndex < ch.targetPath.length;
    if (!hasActivePath || !finalTarget) {
      this.championStuckState.delete(ch.id);
      return;
    }

    const remaining = dist(ch.pos, finalTarget);
    if (remaining <= 0.02) {
      this.championStuckState.delete(ch.id);
      return;
    }

    const previous = this.championStuckState.get(ch.id);
    if (!previous) {
      this.championStuckState.set(ch.id, {
        sampleAt: now,
        samplePos: { ...ch.pos },
        sampleRemaining: remaining,
        cooldownUntil: 0,
        noProgressStrikes: 0,
        obstacleSignature: null,
        bypassCooldownUntil: 0,
      });
      return;
    }

    const elapsed = now - previous.sampleAt;
    if (elapsed < STUCK_PROGRESS_WINDOW_SEC) return;

    const progress = dist(previous.samplePos, ch.pos);
    const remainingDelta = previous.sampleRemaining - remaining;

    const quant = (value: number) => Math.round(value * 1000) / 1000;
    const nextNode = ch.targetPath[Math.min(ch.targetPathIndex, ch.targetPath.length - 1)] ?? finalTarget;
    const obstacleSignature = `${quant(nextNode.x)}:${quant(nextNode.y)}->${quant(finalTarget.x)}:${quant(finalTarget.y)}`;

    if (progress < STUCK_MIN_PROGRESS && remainingDelta < STUCK_MIN_REMAINING_DELTA && now >= previous.cooldownUntil) {
      const sameObstacle = previous.obstacleSignature === obstacleSignature;
      const noProgressStrikes = sameObstacle ? previous.noProgressStrikes + 1 : 1;
      const canBypass = ch.role === "JGL" && noProgressStrikes >= STUCK_BYPASS_STRIKES && now >= previous.bypassCooldownUntil;

      if (canBypass) {
        ch.targetPath = [{ ...finalTarget }];
        ch.targetPathIndex = 0;
        this.championStuckState.set(ch.id, {
          sampleAt: now,
          samplePos: { ...ch.pos },
          sampleRemaining: remaining,
          cooldownUntil: now + STUCK_REPATH_COOLDOWN_SEC,
          noProgressStrikes: 0,
          obstacleSignature: null,
          bypassCooldownUntil: now + STUCK_BYPASS_COOLDOWN_SEC,
        });
        return;
      }

      this.setChampionPath(ch, finalTarget, 0, true);
      this.championStuckState.set(ch.id, {
        sampleAt: now,
        samplePos: { ...ch.pos },
        sampleRemaining: remaining,
        cooldownUntil: now + STUCK_REPATH_COOLDOWN_SEC,
        noProgressStrikes,
        obstacleSignature,
        bypassCooldownUntil: previous.bypassCooldownUntil,
      });
      return;
    }

    this.championStuckState.set(ch.id, {
      sampleAt: now,
      samplePos: { ...ch.pos },
      sampleRemaining: remaining,
      cooldownUntil: previous.cooldownUntil,
      noProgressStrikes: 0,
      obstacleSignature: null,
      bypassCooldownUntil: previous.bypassCooldownUntil,
    });
  }

  private spawnFormationPosition(path: Vec2[], kind: MinionState["kind"], slot: number): Vec2 {
    const origin = path[0];
    const next = path[1] ?? path[0];
    const direction = normalize({ x: next.x - origin.x, y: next.y - origin.y });
    const perpendicular = { x: -direction.y, y: direction.x };
    const row = kind === "melee" ? 0 : 1;
    const column = slot - 1;
    const depth = row * 0.0105 + Math.abs(column) * 0.002;
    const lateral = column * 0.0048;
    return {
      x: clamp(origin.x - direction.x * depth + perpendicular.x * lateral, 0.01, 0.99),
      y: clamp(origin.y - direction.y * depth + perpendicular.y * lateral, 0.01, 0.99),
    };
  }

  private styleAggro(team: TeamId) {
    const style = team === "blue" ? this.snapshot.home_team.draft_strategy : this.snapshot.away_team.draft_strategy;
    switch (style) {
      case "HighPress": return 1.12;
      case "Attacking": return 1.08;
      case "Possession": return 1.04;
      case "Defensive": return 0.9;
      case "Counter": return 0.96;
      default: return 1.0;
    }
  }

  private chooseLaneAnchorIndex(ch: ChampionState, lanePath: Vec2[]) {
    const alliedLaneMinions = this.state.minions
      .filter((m) => m.alive && m.team === ch.team && m.lane === ch.lane)
      .sort((a, b) => b.pathIndex - a.pathIndex);

    // Follow own wave when available, keeping a small safety offset behind.
    if (alliedLaneMinions.length) {
      const front = alliedLaneMinions[0];
      const offset = 1;
      return clamp(front.pathIndex - offset, 1, lanePath.length - 1);
    }

    // If no allied wave is present, move toward enemy lane units to force lane confrontation.
    const enemyLaneUnits = this.state.minions
      .filter((m) => m.alive && m.team !== ch.team && m.lane === ch.lane)
      .sort((a, b) => dist(ch.pos, a.pos) - dist(ch.pos, b.pos));
    if (enemyLaneUnits.length) {
      const enemyIndex = this.closestLanePathIndex(enemyLaneUnits[0].pos, lanePath);
      const alliedLaneTower = this.state.structures
        .filter((s) => s.alive && s.team === ch.team && s.kind === "tower" && s.lane === ch.lane)
        .sort((a, b) => dist(ch.pos, a.pos) - dist(ch.pos, b.pos))[0];
      const waveAtOwnTower = Boolean(alliedLaneTower) && dist(enemyLaneUnits[0].pos, alliedLaneTower.pos) <= 0.11;
      const offset = waveAtOwnTower ? 0 : 1;
      return clamp(enemyIndex - offset, 1, lanePath.length - 1);
    }

    // If lane is temporarily empty, hold a conservative anchor instead of blind advancing.
    const currentIndex = this.closestLanePathIndex(ch.pos, lanePath);
    const laneState = this.styleAggro(ch.team);
    const aggressiveStep = laneState > 1.08 ? 1 : 0;
    const idleAnchor = 1 + aggressiveStep;

    const enemyLaneTower = this.state.structures
      .filter((s) => s.alive && s.team !== ch.team && s.kind === "tower" && s.lane === ch.lane)
      .sort((a, b) => this.closestLanePathIndex(a.pos, lanePath) - this.closestLanePathIndex(b.pos, lanePath))[0];
    const pressureHoldIdx = enemyLaneTower
      ? clamp(this.closestLanePathIndex(enemyLaneTower.pos, lanePath) - 2, idleAnchor, lanePath.length - 1)
      : idleAnchor;

    if (this.state.timeSec >= LANE_COMBAT_UNLOCK_AT + 6 && ch.hp / ch.maxHp >= 0.58) {
      const nearbyEnemyChampions = this.state.champions.filter(
        (enemy) => enemy.alive && enemy.team !== ch.team && enemy.lane === ch.lane && dist(enemy.pos, ch.pos) <= 0.14,
      ).length;
      if (nearbyEnemyChampions === 0) {
        const forwardTowardPressure = Math.min(pressureHoldIdx, currentIndex + 1);
        const cappedForward = Math.min(forwardTowardPressure, LANE_EMPTY_ANCHOR_PROGRESS_MAX_INDEX);
        return clamp(Math.max(idleAnchor, cappedForward), 1, lanePath.length - 1);
      }
    }

    const cappedCurrent = Math.min(currentIndex, LANE_EMPTY_ANCHOR_PROGRESS_MAX_INDEX);
    return clamp(Math.max(idleAnchor, cappedCurrent), 1, lanePath.length - 1);
  }

  private closestLanePathIndex(pos: Vec2, lanePath: Vec2[]) {
    let bestIdx = 1;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 1; i < lanePath.length; i += 1) {
      const d = dist(pos, lanePath[i]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  private waveIntervalSec(atTimeSec: number) {
    if (atTimeSec < 14 * 60) return 30;
    if (atTimeSec < 30 * 60) return 25;
    return 20;
  }

  private buildNeutralTimersState() {
    const entities = Object.fromEntries(
      (Object.keys(NEUTRAL_TIMER_TEMPLATE) as NeutralTimerKey[]).map((key) => {
        const template = NEUTRAL_TIMER_TEMPLATE[key];
        return [
          key,
          {
            ...template,
            alive: false,
            hp: template.maxHp,
            nextSpawnAt: template.unlocked ? template.firstSpawnAt : null,
            lastSpawnAt: null,
            lastTakenAt: null,
            timesSpawned: 0,
            timesTaken: 0,
          },
        ];
      }),
    ) as MatchState["neutralTimers"]["entities"];
    return {
      dragonSoulUnlocked: false,
      elderUnlocked: false,
      entities,
    } as MatchState["neutralTimers"];
  }

  private markNeutralTaken(key: NeutralTimerKey, killer?: ChampionState) {
    const timer = this.state.neutralTimers.entities[key];
    if (!timer || !timer.alive) return;
    timer.alive = false;
    timer.hp = 0;
    timer.lastTakenAt = this.state.timeSec;
    timer.timesTaken += 1;
    timer.nextSpawnAt = timer.oneShot || timer.respawnDelaySec == null ? null : this.state.timeSec + timer.respawnDelaySec;

    if (killer && isJungleCampKey(key)) {
      const reward = JUNGLE_CAMP_PROFILE[key];
      if (reward) {
        this.addGold(killer, reward.gold);
        this.addXp(killer, reward.xp);
      }
      this.log(`${killer.name} cleared ${timer.label}`, "info");
      return;
    }

    if (killer && key === "dragon") {
      this.state.stats[killer.team].dragons += 1;
      this.addGold(killer, 55);
      this.addXp(killer, 110);
      this.log(`${killer.team.toUpperCase()} secured dragon`, "dragon");
      return;
    }

    if (killer && key === "baron") {
      this.state.stats[killer.team].barons += 1;
      this.grantBaronBuff(killer.team);
      this.addTeamGold(killer.team, BARON_TEAM_GOLD, true);
      this.addXp(killer, 140);
      this.log(`${killer.team.toUpperCase()} secured baron`, "baron");
      return;
    }

    if (killer && this.isObjectiveNeutralKey(key)) {
      this.addGold(killer, 45);
      this.addXp(killer, 90);
      this.log(`${killer.team.toUpperCase()} secured ${timer.label}`, "info");
    }
  }

  private spawnNeutralTimerIfDue(key: NeutralTimerKey, now: number) {
    const timer = this.state.neutralTimers.entities[key];
    if (!timer || timer.alive || timer.nextSpawnAt == null || now < timer.nextSpawnAt || !timer.unlocked) return;
    timer.alive = true;
    timer.hp = timer.maxHp;
    timer.lastSpawnAt = timer.nextSpawnAt;
    timer.timesSpawned += 1;
    this.log(`${timer.label} spawned`, "spawn");
  }

  private pickJungleFarmPos(ch: ChampionState, now: number): Vec2 | null {
    const route = this.jungleRouteForChampion(ch);
    const currentFocus = this.jungleCampFocusByChampion.get(ch.id);
    if (currentFocus) {
      const currentTimer = this.state.neutralTimers.entities[currentFocus];
      if (currentTimer?.alive) return currentTimer.pos;
      this.jungleCampFocusByChampion.delete(ch.id);
      const prevIdx = route.findIndex((key) => key === currentFocus);
      if (prevIdx >= 0) {
        this.jungleRouteIndexByChampion.set(ch.id, (prevIdx + 1) % route.length);
      }
    }

    const baseIdx = this.jungleRouteIndexByChampion.get(ch.id) ?? 0;
    for (let i = 0; i < route.length; i += 1) {
      const idx = (baseIdx + i) % route.length;
      const key = route[idx];
      const timer = this.state.neutralTimers.entities[key];
      if (timer?.alive) {
        this.jungleCampFocusByChampion.set(ch.id, key);
        this.jungleRouteIndexByChampion.set(ch.id, idx);
        return timer.pos;
      }
    }

    // If all camps are down, path to next soonest spawn on route.
    const pending = route
      .map((key) => this.state.neutralTimers.entities[key])
      .filter((timer): timer is MatchState["neutralTimers"]["entities"][NeutralTimerKey] => Boolean(timer && timer.nextSpawnAt != null))
      .sort((a, b) => (a.nextSpawnAt ?? Number.POSITIVE_INFINITY) - (b.nextSpawnAt ?? Number.POSITIVE_INFINITY));
    const next = pending[0];
    if (!next) return null;
    this.jungleCampFocusByChampion.set(ch.id, next.key);
    const idx = route.findIndex((key) => key === next.key);
    if (idx >= 0) this.jungleRouteIndexByChampion.set(ch.id, idx);
    void now;
    return next.pos;
  }

  private nearbyNeutralCamp(ch: ChampionState) {
    if (ch.role !== "JGL") return null;
    const camps = (Object.values(this.state.neutralTimers.entities) as NeutralTimerState[])
      .filter((timer) => isJungleCampKey(timer.key) && timer.alive && dist(timer.pos, ch.pos) <= JUNGLE_CAMP_ENGAGE_RADIUS)
      .sort((a, b) => dist(a.pos, ch.pos) - dist(b.pos, ch.pos));
    return camps[0] ?? null;
  }

  private pickMacroObjectivePos(ch: ChampionState, now: number): Vec2 | null {
    if (ch.role !== "JGL") return null;
    const timers = this.state.neutralTimers.entities;
    const objectiveLeadTime = 35;
    const candidates: NeutralTimerKey[] = ["elder", "baron", "herald", "voidgrubs", "dragon", "scuttle-top", "scuttle-bot"];

    for (const key of candidates) {
      const timer = timers[key];
      if (!timer || !timer.unlocked) continue;
      if (timer.alive) return timer.pos;
      if (timer.nextSpawnAt != null && timer.nextSpawnAt >= now && timer.nextSpawnAt - now <= objectiveLeadTime) return timer.pos;
    }
    return null;
  }

  private enemyMidUnavailable(ch: ChampionState) {
    if (ch.role !== "MID") return false;
    const enemyTeam: TeamId = ch.team === "blue" ? "red" : "blue";
    const enemyMid = this.state.champions.find((enemy) => enemy.team === enemyTeam && enemy.role === "MID");
    if (!enemyMid || !enemyMid.alive || enemyMid.state === "recall") return true;
    const midLane = this.lanePath(ch.team, "mid");
    const enemyMidIdx = this.closestLanePathIndex(enemyMid.pos, midLane);
    return enemyMidIdx <= 1;
  }

  private shouldMidHardPush(ch: ChampionState, now: number) {
    if (ch.role !== "MID") return false;
    const roamTimer = this.midRoamUntilByChampion.get(ch.id) ?? -999;
    const killTimer = this.midKillAdvantageUntilByChampion.get(ch.id) ?? -999;
    const roamOpportunity = this.enemyMidUnavailable(ch) || now <= roamTimer || now <= killTimer;
    if (!roamOpportunity) return false;
    const enemyMidMinions = this.state.minions.filter((m) => m.alive && m.team !== ch.team && m.lane === "mid").length;
    return enemyMidMinions > 0;
  }

  private midRoamTargetLane(ch: ChampionState): LaneId | null {
    const enemyTeam: TeamId = ch.team === "blue" ? "red" : "blue";
    const scoreLane = (lane: LaneId) => {
      if (!this.hasRoamKillChance(ch, lane)) return -999;
      const enemyLaneChampions = this.state.champions.filter((u) => u.alive && u.team === enemyTeam && u.lane === lane);
      if (!enemyLaneChampions.length) return -999;
      const allyLaneChampions = this.state.champions.filter((u) => u.alive && u.team === ch.team && u.lane === lane).length;
      const avgEnemyHp = enemyLaneChampions.reduce((acc, u) => acc + u.hp / u.maxHp, 0) / enemyLaneChampions.length;
      const nearestEnemyDist = enemyLaneChampions.sort((a, b) => dist(ch.pos, a.pos) - dist(ch.pos, b.pos))[0];
      const travelPenalty = nearestEnemyDist ? dist(ch.pos, nearestEnemyDist.pos) * 2.4 : 0.4;
      return (1 - avgEnemyHp) * 1.3 + allyLaneChampions * 0.35 - enemyLaneChampions.length * 0.15 - travelPenalty;
    };

    const topScore = scoreLane("top");
    const botScore = scoreLane("bot");
    if (topScore <= -900 && botScore <= -900) return null;
    if (topScore === botScore) return ch.team === "blue" ? "bot" : "top";
    return topScore > botScore ? "top" : "bot";
  }

  private midRoamDestination(ch: ChampionState, lane: LaneId): Vec2 {
    const enemyTeam: TeamId = ch.team === "blue" ? "red" : "blue";
    const enemyLaneTarget = this.state.champions
      .filter((u) => u.alive && u.team === enemyTeam && u.lane === lane)
      .sort((a, b) => a.hp - b.hp || dist(ch.pos, a.pos) - dist(ch.pos, b.pos))[0];
    if (enemyLaneTarget) return enemyLaneTarget.pos;
    const lanePath = this.lanePath(ch.team, lane);
    return lanePath[Math.min(3, lanePath.length - 1)] ?? lanePath[1] ?? lanePath[0];
  }

  private spawnWave() {
    const makeMinion = (team: TeamId, lane: LaneId, kind: MinionState["kind"], slot: number): MinionState => {
      const path = this.lanePath(team, lane);
      const profile = MINION_PROFILE[kind];
      return {
        id: `m-${this.nextMinionId++}`,
        team,
        lane,
        pos: this.spawnFormationPosition(path, kind, slot),
        hp: profile.maxHp,
        maxHp: profile.maxHp,
        alive: true,
        kind,
        lastHitByChampionId: null,
        attackCdUntil: 0,
        debugTargetStructureId: null,
        debugPhysicalBlockerId: null,
        debugRedirectToStructure: false,
        debugStructureDistance: null,
        moveSpeed: profile.moveSpeed,
        attackRange: profile.attackRange,
        attackDamage: profile.attackDamage,
        path,
        pathIndex: 1,
      };
    };
    for (const lane of ["top", "mid", "bot"] as LaneId[]) {
      for (let i = 0; i < 3; i += 1) {
        this.state.minions.push(makeMinion("blue", lane, "melee", i));
        this.state.minions.push(makeMinion("red", lane, "melee", i));
      }
      for (let i = 0; i < 3; i += 1) {
        this.state.minions.push(makeMinion("blue", lane, "ranged", i));
        this.state.minions.push(makeMinion("red", lane, "ranged", i));
      }
    }
    this.log("Minion wave spawned", "spawn");
  }

  private moveEntity(pos: Vec2, target: Vec2, speed: number, dt: number) {
    const dd = dist(pos, target);
    if (dd < 1e-5) return;
    const step = Math.min(speed * dt, dd);
    pos.x += ((target.x - pos.x) / dd) * step;
    pos.y += ((target.y - pos.y) / dd) * step;
  }

  private championSoftCollisionRadius(a: ChampionState, b: ChampionState) {
    const hasSupOrJgl = a.role === "SUP" || a.role === "JGL" || b.role === "SUP" || b.role === "JGL";
    return hasSupOrJgl ? CHAMPION_SOFT_COLLISION_RADIUS_SUP_JGL : CHAMPION_SOFT_COLLISION_RADIUS;
  }

  private applyChampionSoftSeparation(ch: ChampionState, dt: number) {
    for (const other of this.state.champions) {
      if (!other.alive || other.id <= ch.id) continue;
      const minDist = this.championSoftCollisionRadius(ch, other);
      const delta = { x: other.pos.x - ch.pos.x, y: other.pos.y - ch.pos.y };
      const d = Math.hypot(delta.x, delta.y);
      if (d >= minDist) continue;

      const overlap = minDist - d;
      const maxPush = Math.min(overlap * CHAMPION_SOFT_COLLISION_PUSH, dt * 0.02);
      let dir = d > 1e-6 ? { x: delta.x / d, y: delta.y / d } : null;
      if (!dir) {
        const axis = ch.id < other.id ? 1 : -1;
        dir = { x: axis, y: 0 };
      }

      const chIsSupOrJgl = ch.role === "SUP" || ch.role === "JGL";
      const otherIsSupOrJgl = other.role === "SUP" || other.role === "JGL";
      const chShare = chIsSupOrJgl && !otherIsSupOrJgl ? 0.62 : !chIsSupOrJgl && otherIsSupOrJgl ? 0.38 : 0.5;
      const otherShare = 1 - chShare;

      ch.pos.x = clamp(ch.pos.x - dir.x * maxPush * chShare, 0.01, 0.99);
      ch.pos.y = clamp(ch.pos.y - dir.y * maxPush * chShare, 0.01, 0.99);
      other.pos.x = clamp(other.pos.x + dir.x * maxPush * otherShare, 0.01, 0.99);
      other.pos.y = clamp(other.pos.y + dir.y * maxPush * otherShare, 0.01, 0.99);
    }
  }

  private decideChampion(ch: ChampionState) {
    if (!ch.alive) return;
    const now = this.state.timeSec;
    if (ch.hp / ch.maxHp < RECALL_TRIGGER_HP_RATIO && ch.state !== "recall") {
      this.startRecall(ch);
    }

    if (ch.state === "recall") return;

    if (ch.role === "MID" && ch.lane !== "mid") {
      const roamExpiresAt = this.midRoamUntilByChampion.get(ch.id) ?? -999;
      if (now > roamExpiresAt || ch.hp / ch.maxHp < 0.36) {
        ch.lane = "mid";
      }
    }

    const macroObjectivePos = this.pickMacroObjectivePos(ch, now);
    if (macroObjectivePos) {
      ch.state = "objective";
      this.setChampionPath(ch, macroObjectivePos, 0.012);
      return;
    }

    if (this.shouldAssistObjectiveAttempt(ch)) {
      const attempt = this.activeObjectiveAttemptForTeam(ch.team);
      if (attempt) {
        ch.state = "objective";
        this.setChampionPath(ch, attempt.pos, 0.01);
        return;
      }
    }

    if (this.shouldHardAssistContestedDragon(ch)) {
      const dragon = this.contestedDragonAttemptForTeam(ch.team);
      if (dragon) {
        ch.state = "objective";
        this.setChampionPath(ch, dragon.pos, 0.011, true);
        return;
      }
    }

    ch.state = "lane";
    if (ch.role === "JGL") {
      const laneKillTarget = this.nearbyJungleLaneKillTarget(ch);
      if (laneKillTarget) {
        this.setChampionPath(ch, laneKillTarget.pos, 0.012, true);
        return;
      }

      const jungleTarget = this.pickJungleFarmPos(ch, now);
      if (jungleTarget) {
        this.setChampionPath(ch, jungleTarget, 0.014);
        return;
      }

      const route = JUNGLE_ROUTE[ch.team];
      const offset = ch.team === "blue" ? 0 : 2;
      const target = route[(Math.floor(this.state.timeSec / 12) + offset) % route.length];
      this.setChampionPath(ch, target, 0.016);
      return;
    }

    if (ch.role === "MID" && ch.lane === "mid") {
      if (this.shouldMidHardPush(ch, now)) {
        const enemyMidTower = this.state.structures
          .filter((s) => s.alive && s.team !== ch.team && s.kind === "tower" && s.lane === "mid")
          .sort((a, b) => dist(ch.pos, a.pos) - dist(ch.pos, b.pos))[0];
        const pushPos = enemyMidTower ? enemyMidTower.pos : this.laneWaveFrontPos(ch);
        this.setChampionPath(ch, pushPos, 0.008);
        return;
      }

      const roamOpportunity = this.enemyMidUnavailable(ch) || now <= (this.midKillAdvantageUntilByChampion.get(ch.id) ?? -999);
      if (roamOpportunity) {
        const targetLane = this.midRoamTargetLane(ch);
        if (!targetLane) {
          this.setChampionPath(ch, this.laneFarmAnchorPos(ch), 0.012);
          return;
        }
        ch.lane = targetLane;
        this.midRoamUntilByChampion.set(ch.id, now + MID_ROAM_WINDOW_SEC);
        this.setChampionPath(ch, this.midRoamDestination(ch, targetLane), 0.01, true);
        return;
      }
    }

    if (now < LANE_COMBAT_UNLOCK_AT) {
      this.setChampionPath(ch, this.lanePreWaveHoldPos(ch), 0.008, true);
      return;
    }

    if (this.championHasBaronBuff(ch, now)) {
      const siegeAnchor = this.baronSiegeAnchorPos(ch);
      if (siegeAnchor) {
        this.setChampionPath(ch, siegeAnchor, 0.01);
        return;
      }
    }

    this.setChampionPath(ch, this.laneFarmAnchorPos(ch), 0.012);
  }

  private tickChampions(dt: number) {
    const now = this.state.timeSec;
    for (const ch of this.state.champions) {
      if (!ch.alive) {
        this.championStuckState.delete(ch.id);
        this.laneCombatStateByChampion.delete(ch.id);
        if (now >= ch.respawnAt) {
          ch.alive = true;
          ch.hp = ch.maxHp;
          ch.pos = { ...BASE_POSITION[ch.team] };
          ch.state = "lane";
          ch.recallAnchor = null;
          ch.recallChannelUntil = 0;
        }
        continue;
      }

      if (now >= ch.nextDecisionAt) {
        this.decideChampion(ch);
        ch.nextDecisionAt = now + 0.8;
      }

      if (ch.state === "recall") {
        this.tickRecall(ch, now);
      }

      const node = ch.targetPath[ch.targetPathIndex];
      if (node) {
        this.moveEntity(ch.pos, node, ch.moveSpeed, dt);
        if (dist(ch.pos, node) < 0.01 && ch.targetPathIndex < ch.targetPath.length - 1) {
          ch.targetPathIndex += 1;
        }
      }
      this.applyChampionSoftSeparation(ch, dt);
      this.updateStuckRecovery(ch, now);

      if (ch.state === "recall") {
        this.tickRecall(ch, now);
        if (ch.state === "recall") {
          continue;
        }
      }

      const target = this.pickCombatTarget(ch, now);
      if (!target) continue;
      if (!this.isLocalCombatTarget(ch, target)) continue;

      if (target.kind === "champion" && ch.role !== "JGL" && !this.canOpenTradeWindow(ch, target.target)) {
        this.issueLaneDisengage(ch, now, target.target.pos);
        continue;
      }

      if (target.kind === "champion" && this.shouldDisengageChampionTrade(ch, target.target)) {
        this.issueLaneDisengage(ch, now, target.target.pos);
        continue;
      }

      if (target.kind === "champion" && !this.canTowerDiveChampion(ch, target.target)) {
        this.issueLaneDisengage(ch, now, target.target.pos);
        continue;
      }

      if (this.shouldAvoidDive(ch, target.target.pos)) {
        this.issueLaneDisengage(ch, now, target.target.pos);
        continue;
      }

      if (dist(ch.pos, target.target.pos) > ch.attackRange) {
        if (target.kind === "champion" && ch.role !== "JGL") {
          if (this.shouldForceLanerDisengage(ch, target.target.pos, target.target) || !this.inLaneTradeContext(ch, target.target.pos, true)) {
            this.issueLaneDisengage(ch, now, target.target.pos);
            continue;
          }
          this.setChampionPath(ch, this.laneTradeApproachPos(ch, target.target), 0.008);
          continue;
        }
        this.setChampionPath(ch, target.target.pos, 0.01);
        continue;
      }

      if (now < ch.attackCdUntil) continue;

      if (target.kind === "champion") {
        target.target.hp -= ch.attackDamage;
        target.target.lastDamagedByChampionId = ch.id;
        target.target.lastDamagedAt = now;
        this.markTowerAggroOnChampionAttack(ch, target.target, now);
        this.cancelRecall(target.target, now);
        this.markLaneTradeHit(ch, now);
        ch.attackCdUntil = now + 0.85;

        if (target.target.alive && ch.role !== "JGL" && !this.shouldCommitAllInTrade(ch, target.target)) {
          this.issueLaneDisengage(ch, now, target.target.pos);
        }

        if (target.target.hp <= 0 && target.target.alive) {
          target.target.alive = false;
          target.target.deaths += 1;
          target.target.respawnAt = now + 12;
          ch.kills += 1;
          this.state.stats[ch.team].kills += 1;
          this.addGold(ch, CHAMPION_KILL_GOLD);
          this.addXp(ch, CHAMPION_KILL_XP);

          const assisters = this.state.champions.filter(
            (ally) => ally.alive && ally.team === ch.team && ally.id !== ch.id && dist(ally.pos, target.target.pos) <= ASSIST_RADIUS,
          );
          if (assisters.length) {
            const sharedGold = CHAMPION_ASSIST_GOLD_TOTAL / assisters.length;
            const sharedXp = CHAMPION_KILL_XP * 0.5 / assisters.length;
            assisters.forEach((assist) => {
              assist.assists += 1;
              this.addGold(assist, sharedGold);
              this.addXp(assist, sharedXp);
            });
          }

          const defenders = this.state.champions.filter(
            (enemyChampion) => enemyChampion.alive && enemyChampion.team === target.target.team && dist(enemyChampion.pos, target.target.pos) <= ASSIST_RADIUS,
          );
          if (defenders.length) {
            const consolationXp = CHAMPION_KILL_XP * 0.15 / defenders.length;
            defenders.forEach((defender) => this.addXp(defender, consolationXp));
          }

          this.log(`${ch.name} killed ${target.target.name}`, "kill");
          if (ch.role === "MID") {
            this.midKillAdvantageUntilByChampion.set(ch.id, now + MID_KILL_ROAM_BONUS_SEC);
          }
        }
        continue;
      }

      if (target.kind === "minion") {
        target.target.hp -= ch.attackDamage * championDamageToMinionMultiplier(ch.role);
        ch.attackCdUntil = now + 0.75;
        if (target.target.hp <= 0) this.registerMinionDeath(target.target, ch.id);
        continue;
      }

      if (target.kind === "neutral") {
        target.target.hp -= ch.attackDamage * 1.08;
        ch.attackCdUntil = now + 0.78;
        if (target.target.hp <= 0) {
          this.markNeutralTaken(target.target.key, ch);
        }
        continue;
      }

      const structureDamage = ch.attackDamage * this.towerDamageMultiplier(target.target, now);
      target.target.hp -= structureDamage;
      ch.attackCdUntil = now + 0.9;
      if (target.target.hp <= 0 && target.target.alive) {
        target.target.alive = false;
        if (target.target.kind === "tower") {
          this.state.stats[ch.team].towers += 1;
          this.addTeamGold(ch.team, towerTeamGold(target.target.id), false);
        }
        this.log(`${ch.name} destroyed ${target.target.id}`, target.target.kind === "nexus" ? "nexus" : "tower");
        if (target.target.kind === "nexus") {
          this.state.winner = ch.team;
          this.state.running = false;
        }
      }
    }
  }

  private nearestEnemyMinion(m: MinionState, range: number) {
    const candidates = this.state.minions.filter((e) => e.alive && e.team !== m.team && e.lane === m.lane && dist(m.pos, e.pos) < range);
    if (!candidates.length) return null;
    if (m.kind === "ranged") {
      return candidates.sort((a, b) => a.hp - b.hp || dist(m.pos, a.pos) - dist(m.pos, b.pos))[0];
    }
    return candidates.sort((a, b) => dist(m.pos, a.pos) - dist(m.pos, b.pos))[0];
  }

  private isRelevantEnemyLaneStructure(structure: StructureState, lane: LaneId) {
    if (!structure.alive) return false;
    if (structure.kind === "nexus") return true;
    if (structure.lane === lane) return true;
    if (structure.kind === "tower" && structure.lane === "base") return true;
    if (structure.kind === "inhib" && structure.lane === "base") {
      return structure.id.includes(`-${lane}`);
    }
    return false;
  }

  private laneStructureBucket(structure: StructureState, lane: LaneId) {
    if (structure.kind === "tower" && structure.lane === lane) return 0;
    if (structure.kind === "inhib" && structure.lane === "base" && structure.id.includes(`-${lane}`)) return 1;
    if (structure.kind === "tower" && structure.lane === "base") return 2;
    if (structure.kind === "nexus") return 3;
    return 99;
  }

  private nextEnemyStructureForLane(team: TeamId, lane: LaneId, fromPos: Vec2) {
    const enemyTeam: TeamId = team === "blue" ? "red" : "blue";
    const lanePath = this.lanePath(team, lane);

    const candidates = this.state.structures
      .filter((s) => s.team === enemyTeam)
      .filter((s) => this.isRelevantEnemyLaneStructure(s, lane))
      .map((s) => {
        const idx = this.closestLanePathIndex(s.pos, lanePath);
        const bucket = this.laneStructureBucket(s, lane);
        return {
          structure: s,
          idx,
          bucket,
          distance: dist(fromPos, s.pos),
        };
      });

    if (!candidates.length) return null;
    const activeBucket = Math.min(...candidates.map((c) => c.bucket));
    const stageCandidates = candidates.filter((c) => c.bucket === activeBucket);

    stageCandidates.sort((a, b) => {
      if (activeBucket === 0) return a.idx - b.idx || a.distance - b.distance;
      if (activeBucket === 1) return a.distance - b.distance;
      return a.distance - b.distance;
    });

    return stageCandidates[0]?.structure ?? null;
  }

  private nearestEnemyChampionForMinion(m: MinionState, range: number) {
    return this.state.champions
      .filter((enemy) => enemy.alive && enemy.team !== m.team && enemy.lane === m.lane && dist(m.pos, enemy.pos) < range)
      .sort((a, b) => a.hp - b.hp || dist(m.pos, a.pos) - dist(m.pos, b.pos))[0] ?? null;
  }

  private mandatoryEnemyStructuresForLane(team: TeamId, lane: LaneId) {
    const enemyTeam: TeamId = team === "blue" ? "red" : "blue";
    return this.state.structures
      .filter((s) => s.team === enemyTeam && this.isRelevantEnemyLaneStructure(s, lane))
      .map((s) => ({ structure: s, bucket: this.laneStructureBucket(s, lane) }))
      .filter((entry) => entry.bucket < 99);
  }

  private minionStructureTarget(minion: MinionState) {
    const nearbyPhysicalBlocker = this.nearbyPhysicalStructureBlocker(minion);
    if (nearbyPhysicalBlocker) return nearbyPhysicalBlocker;

    const mandatory = this.mandatoryEnemyStructuresForLane(minion.team, minion.lane);
    if (!mandatory.length) return null;

    const activeBucket = Math.min(...mandatory.map((entry) => entry.bucket));
    const activeStructures = mandatory.filter((entry) => entry.bucket === activeBucket).map((entry) => entry.structure);

    const aggroStructure = activeStructures
      .filter((s) => dist(minion.pos, s.pos) <= MINION_STRUCTURE_AGGRO_RADIUS)
      .sort((a, b) => dist(minion.pos, a.pos) - dist(minion.pos, b.pos))[0];

    if (aggroStructure) return aggroStructure;
    return this.nextEnemyStructureForLane(minion.team, minion.lane, minion.pos);
  }

  private nearbyPhysicalStructureBlocker(minion: MinionState) {
    return this.state.structures
      .filter((s) => s.alive && s.team !== minion.team && s.kind !== "nexus" && dist(minion.pos, s.pos) <= MINION_STRUCTURE_AGGRO_RADIUS)
      .sort((a, b) => {
        const distanceA = dist(minion.pos, a.pos);
        const distanceB = dist(minion.pos, b.pos);
        const priorityA = a.kind === "tower" ? 0 : 1;
        const priorityB = b.kind === "tower" ? 0 : 1;
        const blockerScoreA = distanceA + priorityA * 0.035;
        const blockerScoreB = distanceB + priorityB * 0.035;
        return blockerScoreA - blockerScoreB;
      })[0] ?? null;
  }

  private shouldMinionMoveDirectlyToStructure(minion: MinionState, targetStruct: StructureState) {
    const targetIdx = this.closestLanePathIndex(targetStruct.pos, minion.path);
    const reachedStructureApproach = minion.pathIndex >= Math.max(1, targetIdx - 1);
    const closeEnoughToStructure = dist(minion.pos, targetStruct.pos) <= 0.18;
    return reachedStructureApproach || closeEnoughToStructure;
  }

  private tickMinions(dt: number) {
    const now = this.state.timeSec;
    for (const m of this.state.minions) {
      if (!m.alive) continue;
      const targetStruct = this.minionStructureTarget(m);
      const targetStructBucket = targetStruct ? this.laneStructureBucket(targetStruct, m.lane) : 99;
      const structureDistance = targetStruct ? dist(m.pos, targetStruct.pos) : Number.POSITIVE_INFINITY;
      const physicalBlocker = this.nearbyPhysicalStructureBlocker(m);
      m.debugTargetStructureId = targetStruct?.id ?? null;
      m.debugPhysicalBlockerId = physicalBlocker?.id ?? null;
      m.debugStructureDistance = Number.isFinite(structureDistance) ? structureDistance : null;
      m.debugRedirectToStructure = false;
      const structureAttackRange = targetStruct && targetStruct.kind !== "nexus"
        ? Math.max(this.minionAttackRange(m, "structure", now), MINION_STRUCTURE_BLOCKER_ATTACK_RADIUS)
        : this.minionAttackRange(m, "structure", now);
      if (targetStruct && structureDistance <= structureAttackRange) {
        if (now >= m.attackCdUntil) {
          targetStruct.hp -= m.attackDamage * this.minionDamageMultiplier(m, "structure", now) * this.towerDamageMultiplier(targetStruct, now);
          m.attackCdUntil = now + MINION_PROFILE[m.kind].attackCadence;
          if (targetStruct.hp <= 0 && targetStruct.alive) {
            targetStruct.alive = false;
            if (targetStruct.kind === "tower") {
              this.state.stats[m.team].towers += 1;
              this.addTeamGold(m.team, towerTeamGold(targetStruct.id), false);
            }
            this.log(`${m.team.toUpperCase()} destroyed ${targetStruct.id}`, targetStruct.kind === "nexus" ? "nexus" : "tower");
            if (targetStruct.kind === "nexus") {
              this.state.winner = m.team;
              this.state.running = false;
            }
          }
        }
        continue;
      }

      const enemyMinion = this.nearestEnemyMinion(m, this.minionAttackRange(m, "unit", now));
      if (enemyMinion) {
        if (now >= m.attackCdUntil) {
          enemyMinion.hp -= m.attackDamage * this.minionDamageMultiplier(m, "minion", now) * MINION_DAMAGE_TO_MINION_MULTIPLIER;
          m.attackCdUntil = now + MINION_PROFILE[m.kind].attackCadence;
          if (enemyMinion.hp <= 0) this.registerMinionDeath(enemyMinion, null);
        }
        continue;
      }

      const enemyChampion = this.nearestEnemyChampionForMinion(m, this.minionAttackRange(m, "unit", now));
      if (enemyChampion) {
        if (now >= m.attackCdUntil) {
          enemyChampion.hp -= m.attackDamage * this.minionDamageMultiplier(m, "champion", now) * MINION_DAMAGE_TO_CHAMPION_MULTIPLIER;
          enemyChampion.lastDamagedByChampionId = null;
          enemyChampion.lastDamagedAt = now;
          this.cancelRecall(enemyChampion, now);
          m.attackCdUntil = now + MINION_PROFILE[m.kind].attackCadence;
          if (enemyChampion.hp <= 0 && enemyChampion.alive) {
            enemyChampion.alive = false;
            enemyChampion.deaths += 1;
            enemyChampion.respawnAt = now + 12;
          }
        }
        continue;
      }

      const next = m.path[m.pathIndex] ?? m.path[m.path.length - 1];
      const nearPathEnd = m.pathIndex >= m.path.length - 2;
      const stalledAtPathEnd = m.pathIndex >= m.path.length - 1 && dist(m.pos, next) <= 0.012;
      const baseStructurePhase = targetStructBucket >= 1 && targetStructBucket <= 2;
      const shouldRedirectToStructure = Boolean(
        targetStruct
        && (
          physicalBlocker === targetStruct
          || baseStructurePhase
          || this.shouldMinionMoveDirectlyToStructure(m, targetStruct)
          || (nearPathEnd && (stalledAtPathEnd || dist(next, targetStruct.pos) > 0.06))
        ),
      );
      m.debugRedirectToStructure = shouldRedirectToStructure;
      const moveTarget = shouldRedirectToStructure && targetStruct ? targetStruct.pos : next;
      this.moveEntity(m.pos, moveTarget, this.minionMoveSpeed(m, now), dt);
      if (!shouldRedirectToStructure && dist(m.pos, next) < 0.01 && m.pathIndex < m.path.length - 1) {
        m.pathIndex += 1;
      }
    }

    this.state.minions = this.state.minions.filter((m) => m.alive && m.pathIndex < m.path.length);
  }

  private tickStructures(dt: number) {
    const now = this.state.timeSec;
    for (const s of this.state.structures) {
      if (!s.alive || s.kind === "nexus") continue;
      if (now < s.attackCdUntil) continue;

       const forcedTargetId = this.towerForcedTargetById.get(s.id);
       const forcedUntil = this.towerForcedUntilById.get(s.id) ?? -999;
       if (forcedTargetId && now <= forcedUntil) {
         const forcedChampion = this.state.champions.find((c) => c.alive && c.id === forcedTargetId && c.team !== s.team && dist(c.pos, s.pos) < 0.08);
         if (forcedChampion) {
           forcedChampion.hp -= TOWER_SHOT_DAMAGE;
           this.cancelRecall(forcedChampion, now);
           if (forcedChampion.hp <= 0 && forcedChampion.alive) {
             forcedChampion.alive = false;
             forcedChampion.deaths += 1;
             forcedChampion.respawnAt = now + 12;
           }
           s.attackCdUntil = now + 1.0;
           continue;
         }
       }
       if (!forcedTargetId || now > forcedUntil) {
         this.towerForcedTargetById.delete(s.id);
         this.towerForcedUntilById.delete(s.id);
       }

      const minion = this.state.minions.find((m) => m.alive && m.team !== s.team && dist(m.pos, s.pos) < 0.08);
      if (minion) {
        minion.hp -= 24 * (this.hasBaronAuraForMinion(minion, now) ? BARON_MINION_TOWER_DAMAGE_TAKEN_MULTIPLIER : 1);
        s.attackCdUntil = now + 1.0;
        if (minion.hp <= 0) this.registerMinionDeath(minion, null);
        continue;
      }

      const champ = this.state.champions.find((c) => c.alive && c.team !== s.team && dist(c.pos, s.pos) < 0.08);
      if (champ) {
        champ.hp -= TOWER_SHOT_DAMAGE;
        this.cancelRecall(champ, now);
        if (champ.hp <= 0 && champ.alive) {
          champ.alive = false;
          champ.deaths += 1;
          champ.respawnAt = now + 12;
        }
        s.attackCdUntil = now + 1.0;
      }
    }
    void dt;
  }

  private tickNeutralTimers() {
    const now = this.state.timeSec;
    const timers = this.state.neutralTimers.entities;

    if (this.state.neutralTimers.elderUnlocked && !timers.elder.unlocked) {
      timers.elder.unlocked = true;
      timers.elder.nextSpawnAt = now + 6 * 60;
    }

    for (const key of Object.keys(timers) as NeutralTimerKey[]) {
      this.spawnNeutralTimerIfDue(key, now);
      const timer = timers[key];
      if (!timer.alive || timer.combatGraceUntil == null) continue;
      if (now >= timer.combatGraceUntil) {
        timer.alive = false;
        timer.hp = 0;
        timer.nextSpawnAt = null;
        this.log(`${timer.label} despawned`, "info");
      }
    }

    this.state.objectives.dragon.alive = timers.dragon.alive;
    this.state.objectives.dragon.nextSpawnAt = timers.dragon.nextSpawnAt ?? Number.POSITIVE_INFINITY;
    this.state.objectives.baron.alive = timers.baron.alive;
    this.state.objectives.baron.nextSpawnAt = timers.baron.nextSpawnAt ?? Number.POSITIVE_INFINITY;
  }

  private tickObjectives() {
    const timers = this.state.neutralTimers.entities;
    if (!this.state.neutralTimers.dragonSoulUnlocked) {
      const blueSoul = this.state.stats.blue.dragons >= 4;
      const redSoul = this.state.stats.red.dragons >= 4;
      if (blueSoul || redSoul) {
        this.state.neutralTimers.dragonSoulUnlocked = true;
        this.state.neutralTimers.elderUnlocked = true;
        this.markNeutralTaken("dragon");
        timers.dragon.nextSpawnAt = null;
        this.log(`${blueSoul ? "BLUE" : "RED"} unlocked dragon soul`, "dragon");
      }
    }
  }

  tick(dtRaw: number, speed: number) {
    if (!this.state.running) return;
    const dt = clamp(dtRaw, 0, 0.05) * speed;
    this.state.timeSec += dt;

    while (this.state.timeSec >= this.waveSpawnAt) {
      this.spawnWave();
      this.waveSpawnAt += this.waveIntervalSec(this.waveSpawnAt);
    }

    this.tickChampions(dt);
    this.tickMinions(dt);
    this.tickStructures(dt);
    this.tickNeutralTimers();
    this.tickObjectives();
  }
}

