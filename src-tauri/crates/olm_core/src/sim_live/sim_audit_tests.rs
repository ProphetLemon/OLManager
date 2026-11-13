//! Three rule defects the sim audit found in the live engine, each with the test that fails
//! without its fix: the Voidgrub tie, the tower term of the trade score, and the Herald lane.

use super::objectives::{VoidgrubExpirationInput, resolve_voidgrub_expiration_effect};
use super::test_helpers::{empty_neutral, test_champion, test_runtime, test_structure};
use super::*;

// D1: unclaimed Voidgrubs never favour a side on a tie.

fn expiry(blue_stacks: i64, red_stacks: i64) -> Option<(&'static str, i64)> {
    resolve_voidgrub_expiration_effect(true, VoidgrubExpirationInput { blue_stacks, red_stacks })
        .map(|effect| (effect.winner_team, effect.stacks_to_award))
}

#[test]
fn unclaimed_voidgrubs_go_to_nobody_when_neither_side_took_one() {
    assert_eq!(expiry(0, 0), None);
}

#[test]
fn unclaimed_voidgrubs_go_to_nobody_when_both_sides_took_the_same_number() {
    assert_eq!(expiry(1, 1), None);
}

#[test]
fn unclaimed_voidgrubs_go_to_the_side_that_took_more() {
    assert_eq!(expiry(1, 0), Some(("blue", 2)));
    assert_eq!(expiry(0, 2), Some(("red", 1)));
}

#[test]
fn voidgrubs_that_did_not_expire_with_health_left_award_nothing() {
    let none = resolve_voidgrub_expiration_effect(
        false,
        VoidgrubExpirationInput { blue_stacks: 1, red_stacks: 0 },
    );
    assert!(none.is_none());
}

#[test]
fn a_zero_to_zero_expiry_in_the_running_engine_leaves_both_sides_without_stacks() {
    let mut neutral = empty_neutral();
    let mut grubs = super::test_helpers::test_neutral_timer("voidgrubs", Vec2 { x: 0.3, y: 0.3 }, true);
    grubs.combat_grace_until = Some(10.0);
    neutral.entities.insert("voidgrubs".to_string(), grubs);
    let mut runtime = test_runtime(vec![], vec![], vec![], neutral);
    runtime.time_sec = 20.0;

    tick_neutral_timers(&mut runtime);

    let buffs = runtime_buffs_from_extra(runtime.extra.get("teamBuffs"));
    assert_eq!((buffs.blue.voidgrub_stacks, buffs.red.voidgrub_stacks), (0, 0));
}

// D2: the enemy tower term of the trade score applies.

#[test]
fn the_nearest_enemy_lane_tower_is_found_by_its_real_kind() {
    let blue = test_champion("b", "blue", "MID", "mid", Vec2 { x: 0.50, y: 0.50 });
    let tower = test_structure("red-mid-outer", "red", "mid", Vec2 { x: 0.60, y: 0.50 });
    let distance =
        trading::nearest_enemy_lane_tower_distance(&blue, Vec2 { x: 0.52, y: 0.50 }, &[tower]);
    assert!((distance - 0.08).abs() < 1e-9, "distance {distance}");
}
