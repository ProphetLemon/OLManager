import { invoke } from "@tauri-apps/api/core"
import type { ApiClient } from "../types"

export const tauriAdapter: ApiClient = {
  saves: {
    list: () => invoke("get_saves"),
    load: (id) => invoke("load_game", { saveId: id }),
    create: (name, manager, data) => invoke("start_new_game_lightweight", { name, manager, ...(data as Record<string, unknown>) }),
    delete: (id) => invoke("delete_save", { saveId: id }),
    clearAll: () => invoke("clear_all_saves"),
  },

  settings: {
    load: () => invoke("get_settings"),
    save: (settings) => invoke("save_settings", { settings }),
  },

  training: {
    setFocus: (args) => invoke("set_training", args),
    setSchedule: (args) => invoke("set_training_schedule", args),
    setGroups: (args) => invoke("set_training_groups", args),
    setPlayerFocus: (args) => invoke("set_player_training_focus", args),
    setScrims: (args) => invoke("set_weekly_scrims", args),
    setScrimPlans: (args) => invoke("set_weekly_scrim_plans", args),
    setScrimSlots: (args) => invoke("set_weekly_scrim_slots", args),
    setScrimObjective: (args) => invoke("set_weekly_scrim_objective", args),
    finalizeScrimSetup: () => invoke("finalize_weekly_scrim_setup"),
    autoConfigureScrimSetup: () => invoke("auto_configure_weekly_scrim_setup"),
    cancelTodaysScrims: () => invoke("cancel_todays_scrims"),
    choosePostScrimDecision: (args) => invoke("choose_post_scrim_decision", args),
    chooseDailyScrimAction: (args) => invoke("choose_daily_scrim_action", args),
    delegateScrimDecision: () => invoke("delegate_scrim_decision"),
    getScrimContext: () => invoke("get_scrim_context"),
  },

  transfers: {
    makeBid: (args) => invoke("make_transfer_bid", args),
    respondToOffer: (args) => invoke("respond_to_offer", args),
    counterOffer: (args) => invoke("counter_offer", args),
    previewBidImpact: (args) => invoke("preview_transfer_bid_financial_impact", args),
    releaseContract: (args) => invoke("release_player_contract", args),
    negotiateWage: (args) => invoke("negotiate_player_wage", args),
    getHistory: () => invoke("get_transfer_history_cmd"),
  },

  inbox: {
    markRead: (args) => invoke("mark_message_read", args),
    markAllRead: () => invoke("mark_all_messages_read"),
    resolveAction: (args) => invoke("resolve_message_action", args),
    clearOld: () => invoke("clear_old_messages"),
    delete: (args) => invoke("delete_message", args),
    deleteMany: (args) => invoke("delete_messages", args),
  },

  social: {
    getFeed: () => invoke("get_social_feed"),
    createPost: (args) => invoke("create_manager_social_post", args),
    getAccounts: () => invoke("get_social_accounts"),
    saveAccounts: (args) => invoke("save_social_accounts", args),
    getTemplates: () => invoke("get_social_templates"),
    saveTemplates: (args) => invoke("save_social_templates", args),
    relocalize: (args) => invoke("relocalize_social_feed", args),
  },

  players: {
    startPotentialResearch: (args) => invoke("start_potential_research", args),
    setChampionTrainingTarget: (args) => invoke("set_player_champion_training_target", args),
    delegateChampionTraining: () => invoke("delegate_champion_training"),
    getSoloQStatuses: () => invoke("get_soloq_statuses"),
    getSoloQDecaySettings: () => invoke("get_soloq_decay_settings"),
    setSoloQDecayMode: (args) => invoke("set_soloq_decay_mode", args),
  },

  staff: {
    hire: (args) => invoke("hire_staff", args),
    release: (args) => invoke("release_staff", args),
  },

  academy: {
    getAcquisitionOptions: (args) => invoke("get_academy_acquisition_options", args),
    acquire: (args) => invoke("acquire_academy_team", args),
    promotePlayer: (args) => invoke("promote_academy_player", args),
    demotePlayer: (args) => invoke("demote_main_player_to_academy", args),
    getCreationOptions: (args) => invoke("get_academy_creation_options", args),
    create: (args) => invoke("create_academy", args),
  },

  scouting: {
    sendScout: (args) => invoke("send_scout", args),
  },

  time: {
    advance: (args) => invoke("advance_time_with_mode", args),
    checkBlockers: (args) => invoke("check_blocking_actions", args ?? {}),
    skipToMatchDay: () => invoke("skip_to_match_day"),
  },

  jobs: {
    getAvailable: () => invoke("get_available_jobs"),
    apply: (args) => invoke("apply_for_job", args),
  },

  teams: {
    getStatsOverview: (args) => invoke("get_team_stats_overview", args),
    getMatchHistory: (args) => invoke("get_team_match_history", args),
  },

  sim: {
    init: (args) => invoke("sim_live_init", args),
    tick: (args) => invoke("sim_live_tick", args),
    reset: (args) => invoke("sim_live_reset", args),
    dispose: (args) => invoke("sim_live_dispose", args),
    runToCompletion: (args) => invoke("sim_live_run_to_completion", args),
    skipToEnd: (args) => invoke("sim_live_skip_to_end", args),
  },

  serverCommands: {
    selectTeam: () => Promise.reject(new Error("[TauriAdapter] selectTeam no disponible en desktop")),
    advance: () => Promise.reject(new Error("[TauriAdapter] advance no disponible en desktop")),
    bugReport: (args) => invoke("export_bug_report", args),
    debugLog: (msg) => { console.debug("[desktop]", msg); return Promise.resolve() },
    exitToMenu: () => Promise.reject(new Error("[TauriAdapter] exitToMenu no aplica en desktop")),
  },
}
