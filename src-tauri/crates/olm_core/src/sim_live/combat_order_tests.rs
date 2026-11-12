//! Who acts first in a step must not always be the same team.

use super::combat::combat_order;
use super::test_helpers::{empty_neutral, test_champion, test_runtime};
use super::*;

const STEP: f64 = runtime::FIXED_STEP_SEC;

#[test]
fn the_order_is_reversed_on_every_other_step() {
    assert_eq!(combat_order(4, 10.0 * STEP), vec![0, 1, 2, 3]);
    assert_eq!(combat_order(4, 11.0 * STEP), vec![3, 2, 1, 0]);
}

/// Two laners one hit from dying (and healthy enough not to back off) and in reach of each other: the one who acts first kills the
/// other before he can answer.
fn duel_at(step: f64) -> RuntimeState {
    let mut blue = test_champion("b", "blue", "MID", "mid", Vec2 { x: 0.5, y: 0.5 });
    let mut red = test_champion("r", "red", "MID", "mid", Vec2 { x: 0.52, y: 0.5 });
    for champion in [&mut blue, &mut red] {
        champion.max_hp = 100.0;
        champion.hp = 90.0;
        champion.attack_damage = 500.0;
    }
    blue.last_damaged_by_champion_id = Some("r".to_string());
    red.last_damaged_by_champion_id = Some("b".to_string());
    let mut runtime = test_runtime(vec![blue, red], vec![], vec![], empty_neutral());
    runtime.time_sec = step * STEP;
    for champion in &mut runtime.champions {
        champion.last_damaged_by_champion_at = runtime.time_sec;
    }
    runtime
}

#[test]
fn on_an_even_step_the_first_listed_champion_takes_the_kill() {
    let mut runtime = duel_at(100.0);

    resolve_champion_combat(&mut runtime);

    assert!(runtime.champions[0].alive, "the first champion died before he acted");
    assert!(!runtime.champions[1].alive, "the second champion survived");
}

#[test]
fn on_an_odd_step_the_last_listed_champion_takes_the_kill() {
    let mut runtime = duel_at(101.0);

    resolve_champion_combat(&mut runtime);

    assert!(!runtime.champions[0].alive, "the first champion survived");
    assert!(runtime.champions[1].alive, "the second champion died before he acted");
}
