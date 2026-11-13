export type TeamId = "blue" | "red";
export type RoleId = "TOP" | "JGL" | "MID" | "ADC" | "SUP";
export type LaneId = "top" | "mid" | "bot";
export type AttackType = "melee" | "ranged";

export interface Vec2 {
  x: number;
  y: number;
}

export interface SummonerSpellState {
  key: string;
  cdUntil: number;
}

export interface UltimateState {
  archetype: string;
  icon: string;
  cdUntil: number;
}

export interface ChampionState {
  id: string;
  name: string;
  team: TeamId;
  role: RoleId;
  lane: LaneId;
  pos: Vec2;
  hp: number;
  maxHp: number;
  alive: boolean;
  respawnAt: number;
  attackCdUntil: number;
  moveSpeed: number;
  attackRange: number;
  attackType: AttackType;
  attackDamage: number;
  targetPath: Vec2[];
  targetPathIndex: number;
  nextDecisionAt: number;
  kills: number;
  deaths: number;
  assists: number;
  gold: number;
  spentGold: number;
  /** Damage dealt to enemy champions. Sent by the Rust engine only. */
  damageDealt?: number;
  xp: number;
  level: number;
  cs: number;
  items: string[];
  trinketKey?: string;
  wardCdUntil?: number;
  sweeperCdUntil?: number;
  sweeperActiveUntil?: number;
  summonerSpells?: SummonerSpellState[];
  ultimate?: UltimateState | null;
  lastDamagedByChampionId: string | null;
  lastDamagedAt: number;
  /** Game second of the last hit by an enemy champion (not towers, minions or ignite). Sent by the Rust engine only. */
  lastDamagedByChampionAt?: number;
  state: "lane" | "fight" | "objective" | "recall";
  recallAnchor: Vec2 | null;
  recallChannelUntil: number;
  realmBanishedUntil?: number;
  debugPathIssue?: string | null;
}

export interface MinionState {
  id: string;
  team: TeamId;
  lane: LaneId;
  pos: Vec2;
  hp: number;
  maxHp: number;
  alive: boolean;
  kind: "melee" | "ranged" | "summon";
  lastHitByChampionId: string | null;
  ownerChampionId?: string | null;
  summonKind?: string | null;
  summonExpiresAt?: number;
  debugTargetStructureId?: string | null;
  debugPhysicalBlockerId?: string | null;
  debugRedirectToStructure?: boolean;
  debugStructureDistance?: number | null;
  attackCdUntil: number;
  moveSpeed: number;
  attackRange: number;
  attackDamage: number;
  path: Vec2[];
  pathIndex: number;
}

export interface StructureState {
  id: string;
  team: TeamId;
  lane: LaneId | "base";
  kind: "tower" | "inhib" | "nexus";
  pos: Vec2;
  hp: number;
  maxHp: number;
  alive: boolean;
  attackCdUntil: number;
  /** Tower shot ramp, sent by the Rust engine only: the id it last shot (can be a minion). */
  rampTargetId?: string | null;
  /** Consecutive shots on `rampTargetId` before the latest one. */
  rampShots?: number;
  /** Game second of the latest shot. */
  rampLastShotAt?: number;
}

export interface ObjectiveState {
  key: "dragon" | "baron";
  pos: Vec2;
  alive: boolean;
  nextSpawnAt: number;
  currentKind?: string;
  firstKind?: string;
  secondKind?: string;
  soulRiftKind?: string;
  homeStacks?: number;
  awayStacks?: number;
  soulClaimedBy?: "Home" | "Away" | null;
}

export type NeutralTimerKey =
  | "blue-buff-blue"
  | "blue-buff-red"
  | "red-buff-blue"
  | "red-buff-red"
  | "wolves-blue"
  | "wolves-red"
  | "raptors-blue"
  | "raptors-red"
  | "gromp-blue"
  | "gromp-red"
  | "krugs-blue"
  | "krugs-red"
  | "scuttle-top"
  | "scuttle-bot"
  | "dragon"
  | "voidgrubs"
  | "herald"
  | "baron"
  | "elder";

export interface NeutralTimerState {
  key: NeutralTimerKey;
  label: string;
  alive: boolean;
  hp: number;
  maxHp: number;
  nextSpawnAt: number | null;
  firstSpawnAt: number;
  respawnDelaySec: number | null;
  oneShot: boolean;
  windowCloseAt: number | null;
  combatGraceUntil: number | null;
  unlocked: boolean;
  lastSpawnAt: number | null;
  lastTakenAt: number | null;
  timesSpawned: number;
  timesTaken: number;
  pos: Vec2;
  dragonCurrentKind?: string;
}

export interface NeutralTimersState {
  dragonSoulUnlocked: boolean;
  elderUnlocked: boolean;
  dragonCurrentKind?: string;
  entities: Record<NeutralTimerKey, NeutralTimerState>;
}

export interface TeamStats {
  kills: number;
  towers: number;
  dragons: number;
  barons: number;
  gold: number;
}

export interface WardState {
  id: string;
  team: TeamId;
  ownerChampionId: string;
  pos: Vec2;
  expiresAt: number;
}

export interface SimEvent {
  t: number;
  text: string;
  type:
    | "kill"
    | "tower"
    | "dragon"
    | "baron"
    | "nexus"
    | "spawn"
    | "recall"
    | "info";
}

export interface MatchState {
  timeSec: number;
  running: boolean;
  winner: TeamId | null;
  champions: ChampionState[];
  minions: MinionState[];
  structures: StructureState[];
  wards?: WardState[];
  objectives: Record<"dragon" | "baron", ObjectiveState>;
  neutralTimers: NeutralTimersState;
  stats: Record<TeamId, TeamStats>;
  events: SimEvent[];
  showWalls: boolean;
}
