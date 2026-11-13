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

// D3: a jungler's Herald goes to a lane chosen by the state of the enemy towers.

fn herald_ready_runtime(
    carrier_lane: &str,
    carrier_pos: Vec2,
    towers: Vec<StructureRuntime>,
) -> RuntimeState {
    let mut carrier = test_champion("jgl", "blue", "JGL", carrier_lane, carrier_pos);
    carrier.hp = 100.0;
    let mut runtime = test_runtime(vec![carrier], vec![], towers, empty_neutral());
    set_rift_herald_charge(&mut runtime, "blue", "jgl");
    runtime
}

fn red_tower(id: &str, lane: &str, pos: Vec2, hp: f64) -> StructureRuntime {
    let mut tower = test_structure(id, "red", lane, pos);
    tower.hp = hp;
    tower.max_hp = 1000.0;
    tower
}

fn deployed_lane(runtime: &RuntimeState) -> Option<String> {
    runtime
        .minions
        .iter()
        .find(|minion| minion.summon_kind.as_deref() == Some("herald"))
        .map(|minion| minion.lane.clone())
}

#[test]
fn a_junglers_herald_goes_to_the_lane_whose_enemy_tower_has_the_least_health() {
    let at = Vec2 { x: 0.50, y: 0.50 };
    let mut runtime = herald_ready_runtime(
        "bot",
        at,
        vec![
            red_tower("red-top-outer", "top", Vec2 { x: 0.52, y: 0.50 }, 900.0),
            red_tower("red-mid-outer", "mid", Vec2 { x: 0.50, y: 0.52 }, 300.0),
            red_tower("red-bot-outer", "bot", Vec2 { x: 0.48, y: 0.50 }, 900.0),
        ],
    );

    maybe_deploy_rift_herald_charge(&mut runtime);

    assert_eq!(deployed_lane(&runtime).as_deref(), Some("mid"));
}

#[test]
fn a_junglers_herald_breaks_a_health_tie_by_the_lane_nearest_to_him() {
    let at = Vec2 { x: 0.50, y: 0.50 };
    let mut runtime = herald_ready_runtime(
        "bot",
        at,
        vec![
            red_tower("red-top-outer", "top", Vec2 { x: 0.56, y: 0.50 }, 600.0),
            red_tower("red-mid-outer", "mid", Vec2 { x: 0.50, y: 0.53 }, 600.0),
            red_tower("red-bot-outer", "bot", Vec2 { x: 0.50, y: 0.58 }, 600.0),
        ],
    );

    maybe_deploy_rift_herald_charge(&mut runtime);

    assert_eq!(deployed_lane(&runtime).as_deref(), Some("mid"));
}

#[test]
fn a_lanes_outermost_standing_tower_is_the_one_that_counts() {
    let at = Vec2 { x: 0.50, y: 0.50 };
    let mut outer = red_tower("red-top-outer", "top", Vec2 { x: 0.52, y: 0.50 }, 800.0);
    outer.alive = true;
    let inner = red_tower("red-top-inner", "top", Vec2 { x: 0.54, y: 0.50 }, 100.0);
    let mut runtime = herald_ready_runtime(
        "bot",
        at,
        vec![
            outer,
            inner,
            red_tower("red-bot-outer", "bot", Vec2 { x: 0.48, y: 0.50 }, 500.0),
        ],
    );

    maybe_deploy_rift_herald_charge(&mut runtime);

    assert_eq!(deployed_lane(&runtime).as_deref(), Some("bot"));
}

#[test]
fn a_laners_herald_keeps_his_own_lane() {
    let at = Vec2 { x: 0.50, y: 0.50 };
    let mut runtime = herald_ready_runtime(
        "top",
        at,
        vec![
            red_tower("red-top-outer", "top", Vec2 { x: 0.52, y: 0.50 }, 900.0),
            red_tower("red-mid-outer", "mid", Vec2 { x: 0.50, y: 0.52 }, 300.0),
        ],
    );
    runtime.champions[0].role = "TOP".to_string();

    maybe_deploy_rift_herald_charge(&mut runtime);

    assert_eq!(deployed_lane(&runtime).as_deref(), Some("top"));
}
