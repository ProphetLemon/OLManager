use std::collections::HashMap;

use super::*;

pub(super) const DEFAULT_TEST_HP: f64 = 100.0;

pub(super) fn test_champion(
    id: &str,
    team: &str,
    role: &str,
    lane: &str,
    pos: Vec2,
) -> ChampionRuntime {
    ChampionRuntime {
        id: id.to_string(),
        name: id.to_string(),
        champion_id: String::new(),
        team: team.to_string(),
        role: role.to_string(),
        lane: lane.to_string(),
        pos,
        hp: DEFAULT_TEST_HP,
        max_hp: DEFAULT_TEST_HP,
        alive: true,
        respawn_at: 0.0,
        attack_cd_until: 0.0,
        move_speed: 0.07,
        attack_range: 0.055,
        attack_type: "ranged".to_string(),
        attack_damage: 10.0,
        target_path: Vec::new(),
        target_path_index: 0,
        next_decision_at: 0.0,
        kills: 0,
        deaths: 0,
        assists: 0,
        gold: 0,
        spent_gold: 0,
        xp: 0,
        level: 1,
        cs: 0,
        has_left_base_once: false,
        last_support_cs_at: -999.0,
        items: Vec::new(),
        gameplay_score: 70.0,
        iq_score: 70.0,
        competitive_score: 70.0,
        role_edge: 0.0,
        staff_execution: 1.0,
        summoner_spells: vec![
            RuntimeSummonerSpellSlot {
                key: "Flash".to_string(),
                cd_until: 0.0,
            },
            RuntimeSummonerSpellSlot {
                key: "Ignite".to_string(),
                cd_until: 0.0,
            },
        ],
        ultimate: Some(RuntimeUltimateSlot {
            archetype: "burst".to_string(),
            icon: String::new(),
            cd_until: 0.0,
        }),
        ignite_dot_until: 0.0,
        ignite_source_id: None,
        last_damaged_by_champion_id: None,
        last_damaged_by_champion_at: -999.0,
        last_damaged_at: -999.0,
        state: "lane".to_string(),
        recall_anchor: None,
        recall_channel_until: 0.0,
        realm_banished_until: 0.0,
        realm_return_pos: None,
        ward_cd_until: 0.0,
        sweeper_cd_until: 0.0,
        sweeper_active_until: 0.0,
        trinket_key: TRINKET_WARDING_TOTEM.to_string(),
        trinket_swapped: false,
        support_roam_uses: 0,
        support_roam_cd_until: 0.0,
        support_last_roam_role: String::new(),
        path_stuck_for_sec: 0.0,
        forced_lane_recall_cd_until: 0.0,
        debug_ai_decision: String::new(),
    }
}

pub(super) fn test_minion(id: &str, team: &str, lane: &str, pos: Vec2) -> MinionRuntime {
    MinionRuntime {
        id: id.to_string(),
        team: team.to_string(),
        lane: lane.to_string(),
        pos,
        hp: 20.0,
        max_hp: 20.0,
        alive: true,
        kind: "melee".to_string(),
        last_hit_by_champion_id: None,
        owner_champion_id: None,
        summon_kind: None,
        summon_expires_at: 0.0,
        attack_cd_until: 0.0,
        move_speed: 0.06,
        attack_range: 0.04,
        attack_damage: 6.0,
        path: vec![pos],
        path_index: 0,
    }
}

pub(super) fn test_structure(id: &str, team: &str, lane: &str, pos: Vec2) -> StructureRuntime {
    StructureRuntime {
        id: id.to_string(),
        team: team.to_string(),
        lane: lane.to_string(),
        kind: "tower".to_string(),
        pos,
        hp: 1000.0,
        max_hp: 1000.0,
        alive: true,
        attack_cd_until: 0.0,
        forced_target_champion_id: None,
        forced_target_until: 0.0,
        ramp_target_id: None,
        ramp_shots: 0,
        ramp_last_shot_at: 0.0,
    }
}

pub(super) fn test_runtime(
    champions: Vec<ChampionRuntime>,
    minions: Vec<MinionRuntime>,
    structures: Vec<StructureRuntime>,
    neutral_timers: NeutralTimersRuntime,
) -> RuntimeState {
    RuntimeState {
        time_sec: LANE_COMBAT_UNLOCK_AT + 1.0,
        running: true,
        speed: 1.0,
        ai_mode: SimulatorAiMode::Rules,
        policy: SimulatorPolicyConfig::default(),
        winner: None,
        show_walls: false,
        champions,
        minions,
        structures,
        wards: Vec::new(),
        objectives: json!({}),
        neutral_timers: serde_json::to_value(neutral_timers).unwrap_or(json!({})),
        stats: RuntimeStats {
            blue: RuntimeTeamStats {
                kills: 0,
                towers: 0,
                dragons: 0,
                barons: 0,
                gold: 0,
            },
            red: RuntimeTeamStats {
                kills: 0,
                towers: 0,
                dragons: 0,
                barons: 0,
                gold: 0,
            },
        },
        events: Vec::new(),
        lane_combat_state_by_champion: HashMap::new(),
        gold_ledger: GoldLedger::default(),
        farm_ledger: FarmLedger::default(),
        tower_ledger: TowerLedger::default(),
        extra: HashMap::new(),
    }
}

pub(super) fn test_neutral_timer(key: &str, pos: Vec2, alive: bool) -> NeutralTimerRuntime {
    NeutralTimerRuntime {
        key: key.to_string(),
        label: key.to_string(),
        alive,
        hp: 1000.0,
        max_hp: 1000.0,
        next_spawn_at: None,
        first_spawn_at: 0.0,
        respawn_delay_sec: Some(120.0),
        one_shot: false,
        window_close_at: None,
        combat_grace_until: None,
        unlocked: true,
        last_spawn_at: Some(0.0),
        last_taken_at: None,
        times_spawned: 1,
        times_taken: 0,
        pos,
        extra: HashMap::new(),
    }
}

pub(super) fn empty_neutral() -> NeutralTimersRuntime {
    NeutralTimersRuntime {
        dragon_soul_unlocked: false,
        elder_unlocked: false,
        entities: HashMap::new(),
        extra: HashMap::new(),
    }
}
