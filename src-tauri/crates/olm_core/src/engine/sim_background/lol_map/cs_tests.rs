//! Creep score counter of the minute-level engine: fed by the lane wave share
//! and by jungle clearing, never by gold, and it pays nothing.

use super::test_support::new_match;
use super::*;

fn jungler(state: &LiveMatchState) -> &LolUnitState {
    super::test_support::unit(state, Side::Home, LolRole::Jungle)
}

#[test]
fn a_carry_takes_more_of_a_shared_wave_than_the_support() {
    let mut state = new_match(70, 70);
    let anchor = (0.5, 0.5);
    for unit in &mut state.lol_map.units {
        unit.x = anchor.0;
        unit.y = anchor.1;
    }
    distribute_wave_income(&mut state.lol_map.units, Side::Home, anchor, 100.0);
    let cs = |role| super::test_support::unit(&state, Side::Home, role).cs;
    assert!(cs(LolRole::Adc) > cs(LolRole::Support) * 5.0);
    assert!(cs(LolRole::Top) > 0.0);
}

#[test]
fn lane_cs_grows_with_the_wave_pool_and_not_with_gold() {
    let mut state = new_match(70, 70);
    let anchor = (0.5, 0.5);
    for unit in &mut state.lol_map.units {
        unit.x = 9.0;
        unit.y = 9.0;
    }
    let top = state
        .lol_map
        .units
        .iter()
        .position(|u| u.side == Side::Home && u.role == LolRole::Top)
        .expect("top exists");
    state.lol_map.units[top].x = anchor.0;
    state.lol_map.units[top].y = anchor.1;
    state.lol_map.units[top].gold = 5_000.0;
    distribute_wave_income(&mut state.lol_map.units, Side::Home, anchor, 10.0);
    let small = state.lol_map.units[top].cs;
    distribute_wave_income(&mut state.lol_map.units, Side::Home, anchor, 10.0);
    assert!((state.lol_map.units[top].cs - 2.0 * small).abs() < 1e-9);
    assert!(
        (small - 10.0 / WAVE_GOLD_PER_CS).abs() < 1e-9,
        "unit gold is not an input"
    );
}

#[test]
fn a_jungler_clears_camps_when_no_objective_calls() {
    let mut state = new_match(70, 70);
    state.lol_map.objectives.dragon.alive = false;
    state.lol_map.objectives.herald.alive = false;
    state.lol_map.objectives.baron.alive = false;
    state.lol_map.objectives.grubs.alive = false;
    let gold = jungler(&state).gold;
    state.tick_jungle_farming(5);
    assert_eq!(jungler(&state).cs, JUNGLE_CLEAR_CS_PER_MINUTE);
    assert_eq!(jungler(&state).gold, gold, "camp clearing pays no gold");
}

#[test]
fn a_jungler_on_an_objective_or_dead_clears_nothing() {
    let mut state = new_match(70, 70);
    state.lol_map.objectives.grubs.alive = true;
    state.tick_jungle_farming(5);
    assert_eq!(jungler(&state).cs, 0.0);

    state.lol_map.objectives.dragon.alive = false;
    state.lol_map.objectives.herald.alive = false;
    state.lol_map.objectives.baron.alive = false;
    state.lol_map.objectives.grubs.alive = false;
    for unit in &mut state.lol_map.units {
        if unit.role == LolRole::Jungle {
            unit.alive = false;
        }
    }
    state.tick_jungle_farming(5);
    assert_eq!(jungler(&state).cs, 0.0);
}

#[test]
fn laners_are_not_credited_by_jungle_clearing() {
    let mut state = new_match(70, 70);
    state.lol_map.objectives.dragon.alive = false;
    state.lol_map.objectives.herald.alive = false;
    state.lol_map.objectives.baron.alive = false;
    state.lol_map.objectives.grubs.alive = false;
    state.tick_jungle_farming(5);
    let others: f64 = state
        .lol_map
        .units
        .iter()
        .filter(|u| u.role != LolRole::Jungle)
        .map(|u| u.cs)
        .sum();
    assert_eq!(others, 0.0);
}
