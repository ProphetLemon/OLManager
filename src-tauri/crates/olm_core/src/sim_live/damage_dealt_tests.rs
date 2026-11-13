//! Damage dealt to champions: every champion counts what it takes off enemy champions, the
//! count never feeds back into the simulation, and old states load with zero.

use std::collections::HashMap;

use super::economy_tests::{snapshot_with, Side, FULL_MATCH_TICKS};
use super::test_helpers::{empty_neutral, test_champion, test_runtime};
use super::*;

fn duel(attacker_first: bool, defender_hp: f64) -> (RuntimeState, usize, usize) {
    let mut attacker = test_champion("att", "blue", "MID", "mid", Vec2 { x: 0.50, y: 0.50 });
    let mut defender = test_champion("def", "red", "MID", "mid", Vec2 { x: 0.51, y: 0.50 });
    defender.max_hp = 100_000.0;
    defender.hp = defender_hp;
    attacker.attack_damage = 50.0;
    let champions = if attacker_first {
        vec![attacker, defender]
    } else {
        vec![defender, attacker]
    };
    let (a, d) = if attacker_first { (0, 1) } else { (1, 0) };
    (test_runtime(champions, vec![], vec![], empty_neutral()), a, d)
}

#[test]
fn an_attack_adds_the_hit_to_the_attackers_damage_dealt() {
    for attacker_first in [true, false] {
        let (mut runtime, a, d) = duel(attacker_first, 100_000.0);
        attack_enemy_champion(&mut runtime, a, d);
        let taken = 100_000.0 - runtime.champions[d].hp;
        assert!(taken > 0.0);
        assert!(
            (runtime.champions[a].damage_dealt - taken).abs() < 1e-9,
            "attacker_first={attacker_first}: dealt {} but the defender lost {taken}",
            runtime.champions[a].damage_dealt
        );
        assert_eq!(runtime.champions[d].damage_dealt, 0.0);
    }
}

#[test]
fn overkill_is_not_counted_as_damage_dealt() {
    let (mut runtime, a, d) = duel(true, 3.0);
    attack_enemy_champion(&mut runtime, a, d);
    assert!(!runtime.champions[d].alive);
    assert_eq!(runtime.champions[a].damage_dealt, 3.0);
}

#[test]
fn the_ignite_burn_counts_for_the_champion_that_lit_it() {
    let mut source = test_champion("src", "blue", "MID", "mid", Vec2 { x: 0.50, y: 0.50 });
    source.alive = true;
    let mut target = test_champion("tgt", "red", "MID", "mid", Vec2 { x: 0.90, y: 0.90 });
    target.hp = 80.0;
    target.ignite_dot_until = 10_000.0;
    target.ignite_source_id = Some("src".to_string());
    let mut runtime = test_runtime(vec![source, target], vec![], vec![], empty_neutral());
    tick_ignite_dot_effects(&mut runtime, 1.0);
    let burned = 80.0 - runtime.champions[1].hp;
    assert!(burned > 0.0);
    assert!((runtime.champions[0].damage_dealt - burned).abs() < 1e-9);
}

#[test]
fn a_champion_state_without_the_field_loads_with_zero_damage() {
    let champion = test_champion("c", "blue", "MID", "mid", Vec2 { x: 0.5, y: 0.5 });
    let mut value = serde_json::to_value(&champion).expect("serialize");
    assert!(value.as_object_mut().expect("object").remove("damageDealt").is_some());
    let loaded: ChampionRuntime = serde_json::from_value(value).expect("old state loads");
    assert_eq!(loaded.damage_dealt, 0.0);
}

fn play(seed: &str) -> RuntimeState {
    let store = SimLiveStoreState::default();
    let session_id = format!("damage-{seed}");
    init(
        &store,
        SimLiveInitRequest {
            session_id: session_id.clone(),
            seed: seed.to_string(),
            snapshot: snapshot_with(Side::EVEN, Side::EVEN),
            champion_by_player_id: HashMap::new(),
            champion_profiles_by_id: HashMap::new(),
            champion_ultimates_by_id: HashMap::new(),
            initial_state: None,
            ai_mode: SimulatorAiMode::default(),
            policy: SimulatorPolicyConfig::default(),
        },
    )
    .expect("init");
    skip_to_end(
        &store,
        SimLiveSkipToEndRequest {
            session_id: session_id.clone(),
            dt_sec: 0.2,
            speed: 12.0,
            max_ticks: FULL_MATCH_TICKS,
        },
    )
    .expect("skip");
    let sessions = store.sessions.lock().expect("lock");
    sessions[&session_id].state.clone()
}

#[test]
fn a_full_match_reports_damage_for_every_champion_that_fought() {
    let state = play("damage-full-match");
    assert!(state.stats.blue.kills + state.stats.red.kills > 0);
    for champion in &state.champions {
        assert!(champion.damage_dealt >= 0.0, "{} dealt a negative total", champion.id);
    }
    let total: f64 = state.champions.iter().map(|c| c.damage_dealt).sum();
    assert!(total > 0.0, "nobody dealt damage in a whole match");
    let with_kills = state.champions.iter().filter(|c| c.kills > 0);
    for champion in with_kills {
        assert!(champion.damage_dealt > 0.0, "{} has kills but no damage", champion.id);
    }
}
