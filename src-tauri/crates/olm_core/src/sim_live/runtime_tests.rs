use std::collections::HashMap;

use super::combat::pick_combat_target;
use super::test_helpers::{test_champion, test_minion, test_runtime, test_structure};
use super::*;

#[test]
fn nav_grid_routes_around_walls_for_champion_paths() {
    let start = Vec2 { x: 0.60, y: 0.70 };
    let end = Vec2 { x: 0.74, y: 0.70 };

    let path = nav_grid().find_path(start, end);

    assert!(path.len() > 1, "expected non-trivial path around wall");
    assert!(
        path.iter().all(|p| !active_nav_walls()
            .iter()
            .any(|w| point_in_polygon(*p, &w.points))),
        "path should not contain blocked wall nodes"
    );
}

#[test]
fn bot_lane_waypoints_do_not_cross_closed_walls() {
    let path = lane_path_for("blue", "bot");
    let walls = active_nav_walls();
    assert!(path.len() >= 2, "bot lane path should have segments");

    for seg in path.windows(2) {
        let a = seg[0];
        let b = seg[1];
        for step in 0..=24 {
            let t = step as f64 / 24.0;
            let p = Vec2 {
                x: a.x + (b.x - a.x) * t,
                y: a.y + (b.y - a.y) * t,
            };
            assert!(
                !walls.iter().any(|w| point_in_polygon(p, &w.points)),
                "bot lane segment intersects closed wall at ({:.4},{:.4})",
                p.x,
                p.y
            );
        }
    }
}

#[test]
fn minion_holds_position_when_enemy_lane_combat_is_nearby() {
    let neutral = NeutralTimersRuntime {
        dragon_soul_unlocked: false,
        elder_unlocked: false,
        entities: HashMap::new(),
        extra: HashMap::new(),
    };

    let mut blue = test_minion("m-blue-1", "blue", "mid", Vec2 { x: 0.5, y: 0.5 });
    blue.path = vec![Vec2 { x: 0.5, y: 0.5 }, Vec2 { x: 0.7, y: 0.5 }];
    blue.path_index = 1;

    let mut red = test_minion("m-red-1", "red", "mid", Vec2 { x: 0.54, y: 0.5 });
    red.path = vec![Vec2 { x: 0.54, y: 0.5 }, Vec2 { x: 0.3, y: 0.5 }];
    red.path_index = 1;

    let start_pos = blue.pos;
    let mut runtime = test_runtime(vec![], vec![blue, red], vec![], neutral);

    move_minions(&mut runtime, 0.05);

    assert!(dist(runtime.minions[0].pos, start_pos) < 1e-6);
}

#[test]
fn minion_moves_toward_nearby_structure_blocker_before_attack_range() {
    let neutral = NeutralTimersRuntime {
        dragon_soul_unlocked: false,
        elder_unlocked: false,
        entities: HashMap::new(),
        extra: HashMap::new(),
    };

    let mut blue = test_minion("m-blue-1", "blue", "bot", Vec2 { x: 0.82, y: 0.31 });
    blue.path = vec![blue.pos, Vec2 { x: 0.89, y: 0.12 }];
    blue.path_index = 1;

    let red_inhib_tower = test_structure(
        "red-bot-inhib-tower",
        "red",
        "bot",
        Vec2 {
            x: 0.912109375,
            y: 0.3125,
        },
    );

    let start_distance = dist(blue.pos, red_inhib_tower.pos);
    let mut runtime = test_runtime(vec![], vec![blue], vec![red_inhib_tower], neutral);

    move_minions(&mut runtime, 0.5);

    assert!(
        dist(runtime.minions[0].pos, runtime.structures[0].pos) < start_distance,
        "minion should move toward the physical structure blocker instead of lane path"
    );
}

#[test]
fn minion_prioritizes_minion_over_structure_when_both_in_range() {
    let neutral = NeutralTimersRuntime {
        dragon_soul_unlocked: false,
        elder_unlocked: false,
        entities: HashMap::new(),
        extra: HashMap::new(),
    };

    let mut blue = test_minion("m-blue-1", "blue", "mid", Vec2 { x: 0.5, y: 0.5 });
    blue.attack_damage = 10.0;
    blue.attack_range = 0.06;

    let red_minion = test_minion("m-red-1", "red", "mid", Vec2 { x: 0.53, y: 0.5 });
    let mut red_tower = test_structure("red-mid-outer", "red", "mid", Vec2 { x: 0.535, y: 0.5 });
    red_tower.hp = 100.0;

    let mut runtime = test_runtime(vec![], vec![blue, red_minion], vec![red_tower], neutral);

    let tower_hp_before = runtime.structures[0].hp;
    let minion_hp_before = runtime.minions[1].hp;
    resolve_minion_combat(&mut runtime);

    assert_eq!(runtime.structures[0].hp, tower_hp_before);
    assert!(runtime.minions[1].hp < minion_hp_before);
}

#[test]
fn minion_cannot_target_inhib_while_inhib_tower_alive() {
    let neutral = NeutralTimersRuntime {
        dragon_soul_unlocked: false,
        elder_unlocked: false,
        entities: HashMap::new(),
        extra: HashMap::new(),
    };

    let mut blue = test_minion("m-blue-1", "blue", "mid", Vec2 { x: 0.79, y: 0.22 });
    blue.attack_damage = 10.0;
    blue.attack_range = 0.06;

    let mut red_inhib = test_structure(
        "red-inhib-mid",
        "red",
        "base",
        Vec2 {
            x: 0.7832,
            y: 0.2240,
        },
    );
    red_inhib.kind = "inhib".to_string();
    red_inhib.hp = 200.0;
    let red_inhib_tower = test_structure(
        "red-mid-inhib-tower",
        "red",
        "mid",
        Vec2 {
            x: 0.740234375,
            y: 0.26171875,
        },
    );

    let mut runtime = test_runtime(
        vec![],
        vec![blue],
        vec![red_inhib, red_inhib_tower],
        neutral,
    );
    let hp_before = runtime.structures[0].hp;

    resolve_minion_combat(&mut runtime);

    assert_eq!(runtime.structures[0].hp, hp_before);
}

#[test]
fn kill_rewards_reduce_when_ahead_killer_farms_behind_target() {
    let mut killer = test_champion("jgl-blue", "blue", "JGL", "bot", Vec2 { x: 0.5, y: 0.5 });
    killer.kills = 10;
    killer.deaths = 1;
    killer.level = 13;

    let mut victim = test_champion("jgl-red", "red", "JGL", "bot", Vec2 { x: 0.52, y: 0.5 });
    victim.kills = 1;
    victim.deaths = 8;
    victim.level = 10;

    let (gold, xp) = champion_kill_rewards(&killer, &victim);
    assert!(gold < CHAMPION_KILL_GOLD);
    assert!(xp < CHAMPION_KILL_XP);
}

#[test]
fn kill_rewards_increase_for_shutdown() {
    let mut killer = test_champion("top-blue", "blue", "TOP", "top", Vec2 { x: 0.5, y: 0.5 });
    killer.kills = 1;
    killer.deaths = 4;
    killer.level = 9;

    let mut victim = test_champion("mid-red", "red", "MID", "mid", Vec2 { x: 0.52, y: 0.5 });
    victim.kills = 9;
    victim.deaths = 1;
    victim.level = 13;

    let (gold, xp) = champion_kill_rewards(&killer, &victim);
    assert!(gold > CHAMPION_KILL_GOLD);
    assert!(xp > CHAMPION_KILL_XP);
}

#[test]
fn respawn_scales_with_level_and_time() {
    let early_low = champion_respawn_seconds(3, 12.0 * 60.0);
    let late_high = champion_respawn_seconds(15, 33.0 * 60.0);
    assert!(late_high > early_low);
    assert!(late_high <= 58.0);
}

#[test]
fn support_roam_after_minute_ten_rotates_not_same_lane_forever() {
    let neutral = NeutralTimersRuntime {
        dragon_soul_unlocked: false,
        elder_unlocked: false,
        entities: HashMap::new(),
        extra: HashMap::new(),
    };

    let mut sup = test_champion("sup-blue", "blue", "SUP", "bot", Vec2 { x: 0.52, y: 0.70 });
    sup.support_last_roam_role = "MID".to_string();
    sup.support_roam_cd_until = 0.0;

    let mut top = test_champion("top-blue", "blue", "TOP", "top", Vec2 { x: 0.20, y: 0.32 });
    top.hp = 40.0;
    let mut mid = test_champion("mid-blue", "blue", "MID", "mid", Vec2 { x: 0.52, y: 0.52 });
    mid.hp = 35.0;
    let mut adc = test_champion("adc-blue", "blue", "ADC", "bot", Vec2 { x: 0.72, y: 0.80 });
    adc.hp = 85.0;

    let mut runtime = test_runtime(vec![sup.clone(), top, mid, adc], vec![], vec![], neutral);
    runtime.time_sec = SUPPORT_OPEN_ROAM_AT_SEC + 20.0;
    let timers = decode_neutral_timers_state(&runtime.neutral_timers)
        .unwrap_or_else(neutral_timers_default_runtime_state);

    let champions_snapshot = runtime.champions.clone();
    decide_champion_state(
        &mut runtime.champions[0],
        runtime.time_sec,
        &runtime.minions,
        &runtime.structures,
        &champions_snapshot,
        Some(&timers),
        &RuntimeTeamTactics::default(),
        &RuntimeTeamBuffState::default(),
    );

    assert_eq!(runtime.champions[0].state, "objective");
    assert_ne!(runtime.champions[0].support_last_roam_role, "MID");
}

#[test]
fn teleport_uses_allied_lane_tower_from_base() {
    let neutral = NeutralTimersRuntime {
        dragon_soul_unlocked: false,
        elder_unlocked: false,
        entities: HashMap::new(),
        extra: HashMap::new(),
    };

    let mut top = test_champion("top-blue", "blue", "TOP", "top", base_position_for("blue"));
    top.summoner_spells = vec![RuntimeSummonerSpellSlot {
        key: "Teleport".to_string(),
        cd_until: 0.0,
    }];

    let target_tower = test_structure("blue-top-outer", "blue", "top", Vec2 { x: 0.11, y: 0.56 });
    let mut runtime = test_runtime(vec![top], vec![], vec![target_tower.clone()], neutral);
    runtime.time_sec = SUMMONER_TP_UNLOCK_AT_SEC + 10.0;

    resolve_champion_combat(&mut runtime);

    assert!(dist(runtime.champions[0].pos, target_tower.pos) < 0.0001);
    let tp_cd = runtime.champions[0]
        .summoner_spells
        .iter()
        .find(|spell| spell.key == "Teleport")
        .map(|spell| spell.cd_until)
        .unwrap_or(0.0);
    assert!(tp_cd > runtime.time_sec);
}

#[test]
fn teleport_uses_allied_lane_minion_when_no_tower_available() {
    let neutral = NeutralTimersRuntime {
        dragon_soul_unlocked: false,
        elder_unlocked: false,
        entities: HashMap::new(),
        extra: HashMap::new(),
    };

    let mut top = test_champion("top-blue", "blue", "TOP", "top", base_position_for("blue"));
    top.summoner_spells = vec![RuntimeSummonerSpellSlot {
        key: "Teleport".to_string(),
        cd_until: 0.0,
    }];

    let lane_minion = test_minion("blue-top-m1", "blue", "top", Vec2 { x: 0.19, y: 0.35 });
    let mut runtime = test_runtime(vec![top], vec![lane_minion.clone()], vec![], neutral);
    runtime.time_sec = SUMMONER_TP_UNLOCK_AT_SEC + 10.0;

    resolve_champion_combat(&mut runtime);

    assert!(dist(runtime.champions[0].pos, lane_minion.pos) < 0.0001);
}

#[test]
fn champion_levels_up_when_xp_threshold_reached() {
    let neutral = NeutralTimersRuntime {
        dragon_soul_unlocked: false,
        elder_unlocked: false,
        entities: HashMap::new(),
        extra: HashMap::new(),
    };

    let champion = test_champion("mid-blue", "blue", "MID", "mid", Vec2 { x: 0.5, y: 0.5 });
    let mut runtime = test_runtime(vec![champion], vec![], vec![], neutral);
    let champion_id = runtime.champions[0].id.clone();

    add_gold_xp_to_champion(&mut runtime, &champion_id, 0, 700);

    assert!(runtime.champions[0].level >= 3);
    assert!(runtime.champions[0].max_hp > 100.0);
}

#[test]
fn nexus_is_not_targetable_while_nexus_towers_alive() {
    let neutral = NeutralTimersRuntime {
        dragon_soul_unlocked: false,
        elder_unlocked: false,
        entities: HashMap::new(),
        extra: HashMap::new(),
    };

    let laner = test_champion("mid-blue", "blue", "MID", "mid", Vec2 { x: 0.885, y: 0.12 });
    let mut nexus = test_structure(
        "red-nexus",
        "red",
        "base",
        Vec2 {
            x: 0.8912760416666666,
            y: 0.1171875,
        },
    );
    nexus.kind = "nexus".to_string();
    let nexus_tower = test_structure(
        "red-nexus-top-tower",
        "red",
        "base",
        Vec2 {
            x: 0.845703125,
            y: 0.1328125,
        },
    );

    let runtime = test_runtime(
        vec![laner],
        vec![],
        vec![nexus, nexus_tower],
        neutral.clone(),
    );
    let target = pick_combat_target(&runtime, 0, runtime.time_sec, &neutral);

    assert!(
        !matches!(target, Some(CombatTarget::Structure(idx)) if runtime.structures[idx].kind == "nexus")
    );
}
