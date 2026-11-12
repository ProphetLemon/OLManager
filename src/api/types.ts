// ── Entidades ────────────────────────────────────────────────

export interface SaveFile {
  id: string
  name: string
  manager: string
  updated_at: string
}

export interface AppSettings {
  language: string
  ui_version: string
  [key: string]: unknown
}

// ── Tipos de retorno (alias a los tipos existentes del proyecto) ──

export type GameStateData = import("../store/gameStore").GameStateData
export type AdvanceTimeWithModeResponse = import("../services/advanceTimeService").AdvanceTimeWithModeResponse
export type SkipToMatchDayResponse = import("../services/advanceTimeService").SkipToMatchDayResponse
export type BlockerData = import("../services/advanceTimeService").BlockerData
export type BackendScrimContextResponse = import("../services/trainingService").BackendScrimContextResponse
export type TransferNegotiationResponseData = import("../services/transfersService").TransferNegotiationResponseData
export type TransferBidProjectionData = import("../services/transfersService").TransferBidProjectionData
export type TransferHistoryEntryData = import("../services/transfersService").TransferHistoryEntryData
export type WageNegotiationResponseData = import("../services/transfersService").WageNegotiationResponseData
export type ResolveMessageActionResult = import("../services/inboxService").ResolveMessageActionResult
export type SocialPostData = unknown
export type SocialAccountData = unknown
export type SocialTemplateData = unknown
export type AcademyAcquisitionOptionsResponseData = unknown
export type JobOpportunity = unknown
export type JobApplicationResponse = unknown
export type TeamStatsOverview = unknown
export type TeamRecentMatchEntry = unknown
export type SimLiveStateResponse = unknown
export type SimLiveDisposeResponse = unknown
export type SimLiveRunToCompletionResponse = unknown
export type SimLiveSkipToEndResponse = unknown

// ── Repositorios ─────────────────────────────────────────────

export interface SaveRepository {
  list(): Promise<SaveFile[]>
  load(id: string): Promise<GameStateData>
  create(name: string, manager: string, data: unknown): Promise<SaveFile>
  delete(id: string): Promise<void>
  clearAll(): Promise<void>
}

export interface SettingsRepository {
  load(): Promise<Partial<AppSettings>>
  save(settings: Partial<AppSettings>): Promise<void>
}

export interface TrainingRepository {
  setFocus(args: { focus: unknown; intensity: unknown }): Promise<GameStateData>
  setSchedule(args: { schedule: unknown }): Promise<GameStateData>
  setGroups(args: { groups: unknown }): Promise<GameStateData>
  setPlayerFocus(args: { playerId: string; focus: unknown }): Promise<GameStateData>
  setScrims(args: { opponentTeamIds: string[] }): Promise<GameStateData>
  setScrimPlans(args: { plans: unknown }): Promise<GameStateData>
  setScrimSlots(args: { slots: unknown }): Promise<GameStateData>
  setScrimObjective(args: { objective: unknown }): Promise<GameStateData>
  finalizeScrimSetup(): Promise<GameStateData>
  autoConfigureScrimSetup(): Promise<GameStateData>
  cancelTodaysScrims(): Promise<GameStateData>
  choosePostScrimDecision(args: { slotIndex: number; decision: unknown }): Promise<GameStateData>
  chooseDailyScrimAction(args: { slotIndex: number; action: unknown }): Promise<GameStateData>
  delegateScrimDecision(): Promise<GameStateData>
  getScrimContext(): Promise<BackendScrimContextResponse>
}

export interface TransferRepository {
  makeBid(args: { playerId: string; fee: number; destination: string; includedPlayerIds: string[] }): Promise<TransferNegotiationResponseData>
  respondToOffer(args: { playerId: string; offerId: string; accept: boolean }): Promise<GameStateData>
  counterOffer(args: { playerId: string; offerId: string; requestedFee: number; includedPlayerIds: string[] }): Promise<TransferNegotiationResponseData>
  previewBidImpact(args: { playerId: string; fee: number; destination: string }): Promise<TransferBidProjectionData>
  releaseContract(args: { playerId: string }): Promise<GameStateData>
  negotiateWage(args: { playerId: string; offerId: string; annualWage: number; contractYears: number }): Promise<WageNegotiationResponseData>
  getHistory(): Promise<TransferHistoryEntryData[]>
}

export interface InboxRepository {
  markRead(args: { messageId: string }): Promise<GameStateData>
  markAllRead(): Promise<GameStateData>
  resolveAction(args: { messageId: string; actionId: string; optionId: string }): Promise<ResolveMessageActionResult>
  clearOld(): Promise<GameStateData>
  delete(args: { messageId: string }): Promise<GameStateData>
  deleteMany(args: { messageIds: string[] }): Promise<GameStateData>
}

export interface SocialRepository {
  getFeed(): Promise<SocialPostData[]>
  createPost(args: { text: string }): Promise<GameStateData>
  getAccounts(): Promise<SocialAccountData[]>
  saveAccounts(args: { accounts: unknown }): Promise<GameStateData>
  getTemplates(): Promise<SocialTemplateData[]>
  saveTemplates(args: { templates: unknown }): Promise<GameStateData>
  relocalize(args: { language: string }): Promise<GameStateData>
}

export interface SoloQStatus {
  player_id: string
  tier: "Challenger" | "Grandmaster" | "Master"
  lp: number
  delta: number
  multiplier: number
}

/** Per-save SoloQ inactivity decay (contract with `set_soloq_decay_mode`). */
export type SoloQDecayMode = "Off" | "Soft" | "Real" | "Harsh"

export interface SoloQDecayPreset {
  mode: SoloQDecayMode
  decay_per_idle_day: number
  bank_days: number
  recovery_per_played_day: number
}

export interface SoloQDecaySettings {
  mode: SoloQDecayMode
  presets: SoloQDecayPreset[]
}

export type SoloQDayKind = "Played" | "Idle" | "Decay" | "Match" | "Rest"

/** One day of a followed player's SoloQ record (contract with `get_soloq_history`). */
export interface SoloQHistoryDay {
  /** YYYY-MM-DD */
  date: string
  /** Displayed LP. */
  lp: number
  /** LP before decay. */
  formula_lp: number
  /** The effective TrainingFocus (same ids as `PlayerData.training_focus`), or null when the player had no team. */
  focus: string | null
  kind: SoloQDayKind
  /** Grace days left after this day. */
  bank: number
}

export interface SoloQHistory {
  player_id: string
  /** False when no history is kept for this player. */
  followed: boolean
  decay_mode: SoloQDecayMode
  bank_days: number
  bank_max: number
  offset_lp: number
  /** Oldest first, at most 90. */
  days: SoloQHistoryDay[]
}

export interface PlayerRepository {
  startPotentialResearch(args: { playerId: string }): Promise<GameStateData>
  setChampionTrainingTarget(args: { playerId: string; priorityIndex: number; championId: string }): Promise<GameStateData>
  delegateChampionTraining(): Promise<GameStateData>
  getSoloQStatuses(): Promise<SoloQStatus[]>
  getSoloQDecaySettings(): Promise<SoloQDecaySettings>
  setSoloQDecayMode(args: { mode: SoloQDecayMode }): Promise<SoloQDecaySettings>
  getSoloQHistory(args: { playerId: string }): Promise<SoloQHistory>
}

export interface StaffRepository {
  hire(args: { staffId: string }): Promise<GameStateData>
  release(args: { staffId: string }): Promise<GameStateData>
}

export interface AcademyRepository {
  getAcquisitionOptions(args: { parentTeamId: string }): Promise<AcademyAcquisitionOptionsResponseData>
  acquire(args: { request: unknown }): Promise<GameStateData>
  promotePlayer(args: { playerId: string }): Promise<GameStateData>
  demotePlayer(args: { playerId: string }): Promise<GameStateData>
  getCreationOptions(args: { parentTeamId: string }): Promise<AcademyAcquisitionOptionsResponseData>
  create(args: { parentTeamId: string; sourceTeamId: string }): Promise<GameStateData>
}

export interface ScoutingRepository {
  sendScout(args: { scoutId: string; playerId: string }): Promise<GameStateData>
}

export interface TimeRepository {
  advance(args: { mode: unknown }): Promise<AdvanceTimeWithModeResponse>
  checkBlockers(args?: { mode?: string; includeScrimStops?: boolean }): Promise<BlockerData[]>
  skipToMatchDay(): Promise<SkipToMatchDayResponse>
}

export interface JobRepository {
  getAvailable(): Promise<JobOpportunity[]>
  apply(args: { teamId: string }): Promise<JobApplicationResponse>
}

export interface TeamRepository {
  getStatsOverview(args: { teamId: string }): Promise<TeamStatsOverview | null>
  getMatchHistory(args: { teamId: string; limit: number }): Promise<TeamRecentMatchEntry[] | null>
}

export interface SimRepository {
  init(args: { request: unknown }): Promise<SimLiveStateResponse>
  tick(args: { request: unknown }): Promise<SimLiveStateResponse>
  reset(args: { request: unknown }): Promise<SimLiveStateResponse>
  dispose(args: { request: unknown }): Promise<SimLiveDisposeResponse>
  runToCompletion(args: { request: unknown }): Promise<SimLiveRunToCompletionResponse>
  skipToEnd(args: { request: unknown }): Promise<SimLiveSkipToEndResponse>
}

export interface ServerCommandRepository {
  selectTeam(saveId: string, teamId: string): Promise<void>
  advance(saveId: string): Promise<GameStateData>
  bugReport(args: { contextJson: string; saveJson: string }): Promise<string>
  debugLog(message: string): Promise<void>
  exitToMenu(): Promise<void>
}

// ── Cliente único ────────────────────────────────────────────

export interface ApiClient {
  saves: SaveRepository
  settings: SettingsRepository
  training: TrainingRepository
  transfers: TransferRepository
  inbox: InboxRepository
  social: SocialRepository
  players: PlayerRepository
  staff: StaffRepository
  academy: AcademyRepository
  scouting: ScoutingRepository
  time: TimeRepository
  jobs: JobRepository
  teams: TeamRepository
  sim: SimRepository
  serverCommands: ServerCommandRepository
}
