//! Assist rule of the minute-level engine: the live rule (living allies of the
//! killer within `ASSIST_RADIUS` of the victim), counted without paying gold or XP.

use super::*;

type Snap = (Side, bool, f64, f64, LolRole, u8, u8);

fn at(side: Side, alive: bool, x: f64, y: f64) -> Snap {
    (side, alive, x, y, LolRole::Mid, 1, 0)
}

/// Killer 0 and victim 1 at (0.5, 0.5); the rest are placed per test.
fn fight(extra: Vec<Snap>) -> Vec<Snap> {
    let mut snapshot = vec![
        at(Side::Home, true, 0.52, 0.5),
        at(Side::Away, true, 0.5, 0.5),
    ];
    snapshot.extend(extra);
    snapshot
}

#[test]
fn a_living_ally_in_range_gets_the_assist() {
    let snapshot = fight(vec![at(Side::Home, true, 0.5, 0.58)]);
    assert_eq!(assisting_allies(&snapshot, 0, 1), vec![2]);
}

#[test]
fn the_killer_never_assists_their_own_kill() {
    assert!(assisting_allies(&fight(vec![]), 0, 1).is_empty());
}

#[test]
fn a_dead_ally_gets_no_assist() {
    let snapshot = fight(vec![at(Side::Home, false, 0.5, 0.52)]);
    assert!(assisting_allies(&snapshot, 0, 1).is_empty());
}

#[test]
fn an_ally_out_of_range_gets_no_assist() {
    let snapshot = fight(vec![at(Side::Home, true, 0.5, 0.5 + ASSIST_RADIUS + 0.01)]);
    assert!(assisting_allies(&snapshot, 0, 1).is_empty());
}

#[test]
fn an_enemy_of_the_killer_gets_no_assist() {
    let snapshot = fight(vec![at(Side::Away, true, 0.5, 0.52)]);
    assert!(assisting_allies(&snapshot, 0, 1).is_empty());
}

#[test]
fn only_in_range_living_allies_are_credited_together() {
    let snapshot = fight(vec![
        at(Side::Home, true, 0.45, 0.5),
        at(Side::Home, true, 0.9, 0.9),
        at(Side::Home, false, 0.5, 0.5),
        at(Side::Away, true, 0.5, 0.5),
    ]);
    assert_eq!(assisting_allies(&snapshot, 0, 1), vec![2]);
}

#[test]
fn an_unknown_index_credits_nobody() {
    assert!(assisting_allies(&fight(vec![]), 0, 9).is_empty());
}

#[test]
fn a_stacked_brawl_records_assists_without_paying_for_them() {
    let mut state = super::test_support::new_match(70, 70);
    for unit in &mut state.lol_map.units {
        unit.x = 0.5;
        unit.y = 0.5;
    }
    let mut rng = super::test_support::seeded_rng(1);
    for minute in 10..20 {
        state.resolve_fights(minute, &mut rng, &mut Vec::new());
    }
    let kills: u32 = state.lol_map.units.iter().map(|u| u32::from(u.kills)).sum();
    let assists: u32 = state
        .lol_map
        .units
        .iter()
        .map(|u| u32::from(u.assists))
        .sum();
    assert!(kills > 0, "ten units on one point must trade kills");
    assert!(assists > 0, "kills in a stacked brawl are assisted");
    for unit in state.lol_map.units.iter().filter(|u| u.kills == 0) {
        // Only the starting gold: no kill gold, and no assist gold either.
        assert_eq!(unit.gold, 500.0, "assists pay no gold");
        assert_eq!(unit.xp, 0.0, "assists pay no xp");
    }
}
