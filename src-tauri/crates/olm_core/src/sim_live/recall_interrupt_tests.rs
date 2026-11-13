//! A recall that an enemy champion can reach is stopped: damage cancels a recall, so the champion
//! who sees one and has nothing bigger at hand goes and hits it. Each test builds the smallest
//! world in which the rule decides the outcome; in such a world (no minions, no towers) the
//! ordinary laning rules never open a trade.

use super::combat::{pick_combat_target, recall_interrupt_idx};
use super::test_helpers::{empty_neutral, test_champion, test_runtime, test_structure};
use super::*;

fn champion(id: &str, team: &str, role: &str, pos: Vec2) -> ChampionRuntime {
    let mut champion = test_champion(id, team, role, "mid", pos);
    champion.max_hp = 1000.0;
    champion.hp = 1000.0;
    champion
}

/// A red champion in the middle of a recall channel that ends `channel_left` seconds from now.
fn recaller_at(pos: Vec2, runtime_time: f64, channel_left: f64) -> ChampionRuntime {
    let mut recaller = champion("red-mid", "red", "MID", pos);
    recaller.state = "recall".to_string();
    recaller.recall_channel_until = runtime_time + channel_left;
    recaller
}

fn at(x: f64) -> Vec2 {
    Vec2 { x, y: 0.5 }
}

fn world(champions: Vec<ChampionRuntime>) -> RuntimeState {
    test_runtime(champions, vec![], vec![], empty_neutral())
}

fn picks_the_recaller(runtime: &RuntimeState) -> bool {
    matches!(
        pick_combat_target(runtime, 0, runtime.time_sec, &empty_neutral()),
        Some(CombatTarget::Champion(1))
    )
}

#[test]
fn a_champion_in_reach_of_a_recaller_hits_it_and_the_recall_is_cancelled() {
    let mut runtime = world(vec![champion("blue-mid", "blue", "MID", at(0.5)), champion("x", "red", "MID", at(0.9))]);
    runtime.champions[1] = recaller_at(at(0.52), runtime.time_sec, 5.0);

    resolve_champion_combat(&mut runtime);

    assert_eq!(runtime.champions[1].state, "lane", "the recall went on");
    assert!(runtime.champions[1].hp < 1000.0, "the recaller was not hit");
}

#[test]
fn a_champion_who_sees_a_recall_he_can_reach_walks_to_it() {
    let mut runtime = world(vec![champion("blue-mid", "blue", "MID", at(0.5)), champion("x", "red", "MID", at(0.9))]);
    runtime.champions[1] = recaller_at(at(0.6), runtime.time_sec, 5.0);

    resolve_champion_combat(&mut runtime);

    let heading = runtime.champions[0].target_path.last().copied();
    assert_eq!(heading.map(|p| (p.x - 0.6).abs() < 0.01), Some(true), "he did not head for the recaller");
}

#[test]
fn a_recall_that_ends_before_he_can_arrive_is_left_alone() {
    let mut runtime = world(vec![champion("blue-mid", "blue", "MID", at(0.5)), champion("x", "red", "MID", at(0.9))]);
    runtime.champions[1] = recaller_at(at(0.64), runtime.time_sec, 0.8);

    assert!(recall_interrupt_idx(&runtime, 0, &empty_neutral()).is_none());
}

#[test]
fn a_champion_with_little_health_does_not_go_for_a_recaller() {
    let mut runtime = world(vec![champion("blue-mid", "blue", "MID", at(0.5)), champion("x", "red", "MID", at(0.9))]);
    runtime.champions[0].hp = 200.0;
    runtime.champions[1] = recaller_at(at(0.55), runtime.time_sec, 5.0);

    assert!(!picks_the_recaller(&runtime));
}

#[test]
fn a_champion_does_not_walk_into_the_group_that_guards_a_recaller() {
    let mut runtime = world(vec![
        champion("blue-mid", "blue", "MID", at(0.5)),
        champion("x", "red", "MID", at(0.9)),
        champion("red-top", "red", "TOP", at(0.56)),
        champion("red-adc", "red", "ADC", at(0.57)),
    ]);
    runtime.champions[1] = recaller_at(at(0.55), runtime.time_sec, 5.0);

    assert!(!picks_the_recaller(&runtime));
}

#[test]
fn a_champion_does_not_dive_a_tower_to_stop_a_recall() {
    let mut runtime = world(vec![champion("blue-mid", "blue", "MID", at(0.5)), champion("x", "red", "MID", at(0.9))]);
    runtime.champions[1] = recaller_at(at(0.56), runtime.time_sec, 5.0);
    runtime.structures.push(test_structure("red-mid-outer", "red", "mid", at(0.6)));

    assert!(recall_interrupt_idx(&runtime, 0, &empty_neutral()).is_none());
}
