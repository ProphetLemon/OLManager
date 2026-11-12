//! A laner backs off from a trade once it has cost him enough health and he is not winning it.

use super::test_helpers::{empty_neutral, test_champion, test_runtime};
use super::trading::{trade_floor_reached, TRADE_FLOOR_HP_RATIO};
use super::*;

fn laner(id: &str, team: &str, role: &str, pos: Vec2, hp_ratio: f64) -> ChampionRuntime {
    let mut champion = test_champion(id, team, role, "mid", pos);
    champion.max_hp = 1000.0;
    champion.hp = 1000.0 * hp_ratio;
    champion
}

fn floor_reached(blue_hp: f64, red_hp: f64) -> bool {
    let blue = laner("b", "blue", "MID", Vec2 { x: 0.5, y: 0.5 }, blue_hp);
    let red = laner("r", "red", "MID", Vec2 { x: 0.52, y: 0.5 }, red_hp);
    trade_floor_reached(&blue, &red, &[blue.clone(), red.clone()], &[])
}

#[test]
fn a_laner_below_the_floor_who_is_not_ahead_backs_off() {
    assert!(floor_reached(TRADE_FLOOR_HP_RATIO - 0.1, 0.60));
}

#[test]
fn a_laner_above_the_floor_keeps_trading() {
    assert!(!floor_reached(TRADE_FLOOR_HP_RATIO + 0.1, 0.60));
}

#[test]
fn a_laner_below_the_floor_who_is_clearly_ahead_keeps_trading() {
    assert!(!floor_reached(0.50, 0.30));
}

#[test]
fn a_jungler_is_not_held_to_the_floor() {
    let jungler = laner("j", "blue", "JGL", Vec2 { x: 0.5, y: 0.5 }, 0.3);
    let red = laner("r", "red", "MID", Vec2 { x: 0.52, y: 0.5 }, 0.9);
    assert!(!trade_floor_reached(&jungler, &red, &[jungler.clone(), red.clone()], &[]));
}

#[test]
fn more_allies_than_enemies_at_the_fight_keep_it_going() {
    let blue = laner("b", "blue", "MID", Vec2 { x: 0.5, y: 0.5 }, 0.45);
    let ally = laner("a", "blue", "TOP", Vec2 { x: 0.51, y: 0.5 }, 0.9);
    let red = laner("r", "red", "MID", Vec2 { x: 0.52, y: 0.5 }, 0.6);
    let all = [blue.clone(), ally, red.clone()];
    assert!(!trade_floor_reached(&blue, &red, &all, &[]));
}

/// Two laners in reach of each other; the blue one was hit by the red one a moment ago, so the
/// retaliation rule picks him as the target whatever the open-trade evaluation says.
fn exchange(blue_hp: f64) -> RuntimeState {
    let mut blue = laner("b", "blue", "MID", Vec2 { x: 0.5, y: 0.5 }, blue_hp);
    let red = laner("r", "red", "MID", Vec2 { x: 0.52, y: 0.5 }, 0.9);
    blue.last_damaged_by_champion_id = Some("r".to_string());
    let mut runtime = test_runtime(vec![blue, red], vec![], vec![], empty_neutral());
    runtime.champions[0].last_damaged_by_champion_at = runtime.time_sec;
    runtime
}

#[test]
fn a_laner_who_is_hit_back_at_full_health_retaliates() {
    let mut runtime = exchange(0.9);

    resolve_champion_combat(&mut runtime);

    assert!(runtime.champions[1].hp < 900.0, "the retaliation did not land");
}

#[test]
fn a_laner_below_the_floor_does_not_retaliate_but_backs_off() {
    let mut runtime = exchange(0.45);

    resolve_champion_combat(&mut runtime);

    assert_eq!(
        runtime.champions[1].hp, 900.0,
        "the red laner was hit by a laner who was past the floor"
    );
    assert!(
        runtime.lane_combat_state_by_champion.contains_key("b"),
        "the blue laner did not disengage"
    );
}
