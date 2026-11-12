use super::macro_ai::baron_push_target_for_lane;
use super::test_helpers::{
    empty_neutral, test_champion, test_minion, test_runtime, test_structure,
};
use super::*;

#[test]
fn baron_push_targets_inhib_before_nexus() {
    let mut red_inhib = test_structure("red-inhib-bot", "red", "base", Vec2 { x: 0.91, y: 0.25 });
    red_inhib.kind = "inhib".to_string();
    let red_nexus = test_structure("red-nexus", "red", "base", Vec2 { x: 0.891, y: 0.117 });
    let target =
        baron_push_target_for_lane(&[red_inhib.clone(), red_nexus], "blue", "bot", |_, _, _| {
            true
        });
    let target = target.expect("expected Baron push to target inhibitor before nexus");
    assert!(dist(target, red_inhib.pos) < 1e-9);
}

#[test]
fn minion_can_target_inhib_after_inhib_tower_is_down() {
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

    // An allied champion stands at the inhibitor: a wave alone cannot break a base.
    let carry = test_champion("blue-TOP", "blue", "TOP", "mid", Vec2 { x: 0.77, y: 0.23 });
    let mut runtime = test_runtime(vec![carry], vec![blue], vec![red_inhib], empty_neutral());
    let hp_before = runtime.structures[0].hp;
    resolve_minion_combat(&mut runtime);
    assert!(runtime.structures[0].hp < hp_before);
}

#[test]
fn minion_cannot_target_nexus_tower_while_lane_inhib_alive() {
    let mut blue = test_minion("m-blue-1", "blue", "top", Vec2 { x: 0.846, y: 0.133 });
    blue.attack_damage = 10.0;
    blue.attack_range = 0.06;

    let mut red_nexus_top_tower = test_structure(
        "red-nexus-top-tower",
        "red",
        "base",
        Vec2 {
            x: 0.845703125,
            y: 0.1328125,
        },
    );
    red_nexus_top_tower.hp = 200.0;
    let red_inhib_top = test_structure(
        "red-inhib-top",
        "red",
        "base",
        Vec2 {
            x: 0.7545572916666666,
            y: 0.09114583333333333,
        },
    );

    let mut runtime = test_runtime(
        vec![],
        vec![blue],
        vec![red_nexus_top_tower, red_inhib_top],
        empty_neutral(),
    );
    let hp_before = runtime.structures[0].hp;
    resolve_minion_combat(&mut runtime);
    assert_eq!(runtime.structures[0].hp, hp_before);
}

#[test]
fn minion_can_target_nexus_tower_after_lane_inhib_is_down() {
    let mut blue = test_minion("m-blue-1", "blue", "top", Vec2 { x: 0.846, y: 0.133 });
    blue.attack_damage = 10.0;
    blue.attack_range = 0.06;

    let mut red_nexus_top_tower = test_structure(
        "red-nexus-top-tower",
        "red",
        "base",
        Vec2 {
            x: 0.845703125,
            y: 0.1328125,
        },
    );
    red_nexus_top_tower.hp = 200.0;

    // An allied champion stands at the tower: a wave alone cannot break a base.
    let carry = test_champion("blue-TOP", "blue", "TOP", "top", Vec2 { x: 0.83, y: 0.15 });
    let mut runtime = test_runtime(
        vec![carry],
        vec![blue],
        vec![red_nexus_top_tower],
        empty_neutral(),
    );
    let hp_before = runtime.structures[0].hp;
    resolve_minion_combat(&mut runtime);
    assert!(runtime.structures[0].hp < hp_before);
}

#[test]
fn destroying_a_tower_pays_every_member_of_the_attacking_team() {
    let mut top = test_champion("b-top", "blue", "TOP", "top", Vec2 { x: 0.2, y: 0.2 });
    let mut adc = test_champion("b-adc", "blue", "ADC", "bot", Vec2 { x: 0.6, y: 0.6 });
    adc.alive = false;
    let red = test_champion("r-top", "red", "TOP", "top", Vec2 { x: 0.3, y: 0.3 });
    let tower = test_structure("red-top-outer", "red", "top", Vec2 { x: 0.3, y: 0.3 });
    top.gold = 10;

    let mut runtime = test_runtime(vec![top, adc, red], vec![], vec![tower], empty_neutral());
    destroy_structure(&mut runtime, 0, "blue");

    let reward = economy::tower_team_gold("red-top-outer");
    assert!(reward > 0);
    assert_eq!(runtime.champions[0].gold, 10 + reward);
    assert_eq!(
        runtime.champions[1].gold, reward,
        "a dead teammate still shares tower gold"
    );
    assert_eq!(
        runtime.champions[2].gold, 0,
        "the defending team earns nothing"
    );
    assert_eq!(runtime.stats.blue.gold, 2 * reward);
    assert_eq!(runtime.stats.blue.towers, 1);
}

#[test]
fn inner_towers_pay_no_more_than_outer_towers() {
    assert!(
        economy::tower_team_gold("blue-mid-inner") <= economy::tower_team_gold("blue-mid-outer")
    );
    assert!(economy::tower_team_gold("blue-mid-inhib-tower") > 0);
}

// ------------------------------------------------------------ tower damage

/// Shots a lone tower needs to kill a fresh champion, shooting once per
/// cadence from `time_sec` with nothing else in range.
fn shots_to_kill(max_hp: f64, time_sec: f64) -> u32 {
    let pos = Vec2 { x: 0.5, y: 0.5 };
    let mut champion = test_champion("c", "blue", "MID", "mid", pos);
    champion.max_hp = max_hp;
    champion.hp = max_hp;
    let tower = test_structure("red-t", "red", "mid", pos);
    let mut runtime = test_runtime(vec![champion], vec![], vec![tower], empty_neutral());
    runtime.time_sec = time_sec;
    let mut shots = 0;
    while runtime.champions[0].alive && shots < 500 {
        resolve_structure_combat(&mut runtime);
        shots += 1;
        runtime.time_sec += TOWER_ATTACK_CADENCE_SEC;
    }
    shots
}

#[test]
fn tower_shot_grows_with_the_game_minute() {
    let early = structures::tower_champion_shot_damage(5.0 * 60.0, 1000.0, 0);
    let late = structures::tower_champion_shot_damage(35.0 * 60.0, 1000.0, 0);
    assert!(late > early * 1.5, "minute 5 {early:.0}, minute 35 {late:.0}");
}

#[test]
fn tower_shot_takes_a_share_of_the_targets_maximum_health() {
    let squishy = structures::tower_champion_shot_damage(900.0, 1000.0, 0);
    let tank = structures::tower_champion_shot_damage(900.0, 3000.0, 0);
    assert!(tank > squishy, "squishy {squishy:.0}, tank {tank:.0}");
}

#[test]
fn tower_shot_ramps_with_consecutive_shots_up_to_a_cap() {
    let first = structures::tower_champion_shot_damage(900.0, 1500.0, 0);
    let third = structures::tower_champion_shot_damage(900.0, 1500.0, 2);
    let capped = structures::tower_champion_shot_damage(900.0, 1500.0, 3);
    let beyond = structures::tower_champion_shot_damage(900.0, 1500.0, 9);
    assert!(third > first * 1.6, "first {first:.0}, third {third:.0}");
    assert!((capped - beyond).abs() < 1e-9);
}

#[test]
fn tower_keeps_ramping_on_the_champion_it_keeps_shooting() {
    let pos = Vec2 { x: 0.5, y: 0.5 };
    let mut champion = test_champion("c", "blue", "MID", "mid", pos);
    champion.max_hp = 100_000.0;
    champion.hp = 100_000.0;
    let tower = test_structure("red-t", "red", "mid", pos);
    let mut runtime = test_runtime(vec![champion], vec![], vec![tower], empty_neutral());
    let mut dealt = Vec::new();
    for _ in 0..4 {
        let before = runtime.champions[0].hp;
        resolve_structure_combat(&mut runtime);
        dealt.push(before - runtime.champions[0].hp);
        runtime.time_sec += TOWER_ATTACK_CADENCE_SEC;
    }
    assert!(dealt[1] > dealt[0] && dealt[2] > dealt[1], "{dealt:?}");
}

#[test]
fn tower_ramp_restarts_after_it_shoots_a_minion() {
    let pos = Vec2 { x: 0.5, y: 0.5 };
    let mut champion = test_champion("c", "blue", "MID", "mid", pos);
    champion.max_hp = 100_000.0;
    champion.hp = 100_000.0;
    let tower = test_structure("red-t", "red", "mid", pos);
    let mut runtime = test_runtime(vec![champion], vec![], vec![tower], empty_neutral());
    resolve_structure_combat(&mut runtime);
    runtime.time_sec += TOWER_ATTACK_CADENCE_SEC;
    resolve_structure_combat(&mut runtime);
    let ramped = 100_000.0 - runtime.champions[0].hp;
    runtime.time_sec += TOWER_ATTACK_CADENCE_SEC;
    runtime
        .minions
        .push(test_minion("m", "blue", "mid", Vec2 { x: 0.501, y: 0.5 }));
    resolve_structure_combat(&mut runtime);
    runtime.minions[0].alive = false;
    runtime.time_sec += TOWER_ATTACK_CADENCE_SEC;
    let before = runtime.champions[0].hp;
    resolve_structure_combat(&mut runtime);
    let restarted = before - runtime.champions[0].hp;
    assert!(restarted < ramped / 2.0, "restarted {restarted:.0}, ramped {ramped:.0}");
}

/// Maximum health of a non-tank champion in 200 seeded matches reaches about
/// 1,300, 1,700 and 2,150 on average at minutes 15, 25 and 35; the values below
/// are the high end. A tank with Warmog's goes beyond 3,000.
#[test]
fn tower_kills_a_non_tank_champion_in_at_most_eight_shots_at_every_stage() {
    for (minute, max_hp) in [(15.0, 1500.0), (25.0, 1900.0), (35.0, 2400.0)] {
        let shots = shots_to_kill(max_hp, minute * 60.0);
        assert!(shots <= 8, "minute {minute}: {shots} shots for {max_hp} hp");
    }
}

#[test]
fn tower_kills_a_tank_in_at_most_fourteen_shots_but_later_than_a_carry() {
    for minute in [15.0, 25.0, 35.0] {
        let tank = shots_to_kill(3200.0, minute * 60.0);
        let carry = shots_to_kill(1500.0, minute * 60.0);
        assert!(tank <= 14, "minute {minute}: {tank} shots for the tank");
        assert!(tank > carry, "minute {minute}: tank {tank}, carry {carry}");
    }
}

#[test]
fn a_dive_without_minions_is_over_in_seconds_even_at_minute_five() {
    let shots = shots_to_kill(650.0, 5.0 * 60.0);
    assert!(
        f64::from(shots) * TOWER_ATTACK_CADENCE_SEC <= 10.0,
        "{shots} shots"
    );
}

/// Saves written before the ramp existed have no ramp fields.
#[test]
fn structures_saved_without_ramp_fields_still_load() {
    let tower = test_structure("red-t", "red", "mid", Vec2 { x: 0.5, y: 0.5 });
    let mut value = serde_json::to_value(&tower).expect("encode");
    let object = value.as_object_mut().expect("object");
    for key in ["rampTargetId", "rampShots", "rampLastShotAt"] {
        object.remove(key);
    }
    let loaded: StructureRuntime = serde_json::from_value(value).expect("old save loads");
    assert_eq!(loaded.ramp_shots, 0);
    assert!(loaded.ramp_target_id.is_none());
}

// ------------------------------------------------------------- tower aggro

/// A defending tower at the middle of the map with its own team's champion
/// beside it, and `attackers` of the other team at the given distances.
fn aggro_scene(attacker_distances: &[f64]) -> RuntimeState {
    let pos = Vec2 { x: 0.5, y: 0.5 };
    let mut champions = vec![test_champion(
        "victim",
        "red",
        "MID",
        "mid",
        Vec2 { x: 0.505, y: 0.5 },
    )];
    for (i, d) in attacker_distances.iter().enumerate() {
        let mut attacker = test_champion(
            &format!("attacker-{i}"),
            "blue",
            "MID",
            "mid",
            Vec2 { x: 0.5 + d, y: 0.5 },
        );
        attacker.max_hp = 100_000.0;
        attacker.hp = 100_000.0;
        champions.push(attacker);
    }
    let tower = test_structure("red-t", "red", "mid", pos);
    let mut runtime = test_runtime(champions, vec![], vec![tower], empty_neutral());
    runtime.champions[0].max_hp = 100_000.0;
    runtime.champions[0].hp = 100_000.0;
    runtime
}

fn lock_on(runtime: &mut RuntimeState, attacker_idx: usize) {
    let attacker = runtime.champions[attacker_idx].clone();
    let victim = runtime.champions[0].clone();
    let now = runtime.time_sec;
    mark_tower_aggro_on_champion_attack(runtime, &attacker, &victim, now);
}

#[test]
fn an_attacker_outside_the_towers_range_does_not_steal_the_lock() {
    let mut runtime = aggro_scene(&[0.05, 0.09]);
    lock_on(&mut runtime, 1);
    lock_on(&mut runtime, 2);
    assert_eq!(
        runtime.structures[0].forced_target_champion_id.as_deref(),
        Some("attacker-0"),
        "a lock on a champion the tower cannot reach replaced the usable one"
    );
}

#[test]
fn the_lock_outlasts_four_tower_shots() {
    let mut runtime = aggro_scene(&[0.05]);
    runtime
        .minions
        .push(test_minion("m", "blue", "mid", Vec2 { x: 0.505, y: 0.505 }));
    runtime.minions[0].hp = 100_000.0;
    runtime.minions[0].max_hp = 100_000.0;
    lock_on(&mut runtime, 1);
    let mut shots_at_champion = 0;
    for _ in 0..4 {
        resolve_structure_combat(&mut runtime);
        if runtime
            .tower_ledger
            .shots()
            .iter()
            .any(|s| s.victim == TowerVictim::Champion(1))
        {
            shots_at_champion += 1;
        }
        runtime.time_sec += TOWER_ATTACK_CADENCE_SEC;
    }
    assert_eq!(shots_at_champion, 4, "the tower went back to the minion too early");
}

#[test]
fn the_tower_goes_back_to_minions_when_the_lock_has_expired() {
    let mut runtime = aggro_scene(&[0.05]);
    runtime
        .minions
        .push(test_minion("m", "blue", "mid", Vec2 { x: 0.505, y: 0.505 }));
    runtime.minions[0].hp = 100_000.0;
    runtime.minions[0].max_hp = 100_000.0;
    lock_on(&mut runtime, 1);
    runtime.time_sec += TOWER_AGGRO_LOCK_SEC + 0.1;
    resolve_structure_combat(&mut runtime);
    assert!(runtime
        .tower_ledger
        .shots()
        .iter()
        .all(|s| s.victim == TowerVictim::Minion));
}

/// Towers fell far too slowly (a match went on for 45 to 60 minutes): a fortification took
/// 90% of the damage before minute 20 and 35% after minute 35, then half of it until minute 25.
/// Measured with real champions, taking it off shortens a 70 vs 70 match by 2 to 3 minutes, so a
/// tower now takes all the damage it is dealt at any minute.
#[test]
fn a_tower_takes_all_the_damage_it_is_dealt_at_any_minute() {
    for minute in [1, 5, 15, 30, 50] {
        let tower = test_structure("red-test-tower", "red", "mid", Vec2 { x: 0.6, y: 0.4 });
        let mut runtime = test_runtime(vec![], vec![], vec![tower], empty_neutral());
        runtime.time_sec = f64::from(minute) * 60.0;
        apply_damage_to_structure(&mut runtime, 0, 100.0, "blue");
        assert_eq!(runtime.structures[0].hp, 900.0, "minute {minute}");
    }
}

#[test]
fn every_red_structure_stands_at_the_mirror_image_of_its_blue_counterpart() {
    let structures = create_structures();
    let pos_of = |id: &str| -> (f64, f64) {
        let structure = structures
            .iter()
            .find(|s| s["id"] == id)
            .unwrap_or_else(|| panic!("no structure {id}"));
        (
            structure["pos"]["x"].as_f64().expect("x"),
            structure["pos"]["y"].as_f64().expect("y"),
        )
    };
    for structure in structures.iter().filter(|s| s["team"] == "red") {
        let id = structure["id"].as_str().expect("id");
        let (rx, ry) = pos_of(id);
        let (bx, by) = pos_of(&id.replacen("red-", "blue-", 1));
        assert!(
            (rx - by).abs() < 1e-9 && (ry - bx).abs() < 1e-9,
            "{id} is at ({rx:.4}, {ry:.4}), its blue counterpart at ({bx:.4}, {by:.4})"
        );
    }
}

fn base_structure(id: &str) -> StructureRuntime {
    test_structure(id, "red", "base", Vec2 { x: 0.85, y: 0.13 })
}

#[test]
fn a_wave_alone_cannot_break_an_inhibitor_the_nexus_or_the_towers_that_guard_them() {
    for id in ["red-inhib-top", "red-top-inhib-tower", "red-nexus", "red-nexus-top-tower"] {
        assert!(wave_alone_cannot_break(&[], &base_structure(id), "blue"), "{id}");
    }
}

#[test]
fn a_wave_breaks_the_other_towers_alone() {
    for id in ["red-top-outer", "red-top-inner"] {
        assert!(!wave_alone_cannot_break(&[], &base_structure(id), "blue"), "{id}");
    }
}

#[test]
fn a_wave_breaks_the_base_when_one_of_its_champions_is_at_it() {
    let champion = test_champion("blue-TOP", "blue", "TOP", "top", Vec2 { x: 0.8, y: 0.16 });
    assert!(!wave_alone_cannot_break(std::slice::from_ref(&champion), &base_structure("red-nexus"), "blue"));
    let mut dead = champion;
    dead.alive = false;
    assert!(wave_alone_cannot_break(&[dead], &base_structure("red-nexus"), "blue"));
}
