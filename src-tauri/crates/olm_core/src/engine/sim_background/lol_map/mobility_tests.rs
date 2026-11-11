//! Lane geometry and unit mobility of the minute-level engine, exercised the
//! way the shipped callers run it (`MatchConfig::default()`, real rosters).

use super::test_support::*;
use super::*;

/// Distance within which two opposing units trade damage in `resolve_fights`.
const FIGHT_RANGE: f64 = 0.095;

#[test]
fn laners_meet_their_own_opponent_early() {
    // The Away top and bot laners used to walk the wrong lane (the routes were
    // rotated 180 degrees instead of mirrored), so no pair of opposing laners
    // ever met in its lane. [PLACEHOLDER] 8 minutes to reach the lane.
    for seed in 0..2 {
        let mut state = new_match(70, 70);
        let mut rng = seeded_rng(seed);
        let mut closest = [f64::MAX; 3];
        for _ in 0..8 {
            state.step_minute(&mut rng);
            for (slot, role) in [LolRole::Top, LolRole::Mid, LolRole::Adc]
                .iter()
                .enumerate()
            {
                let home = unit(&state, Side::Home, *role);
                let away = unit(&state, Side::Away, *role);
                closest[slot] = closest[slot].min(distance((home.x, home.y), (away.x, away.y)));
            }
        }
        for (slot, role) in [LolRole::Top, LolRole::Mid, LolRole::Adc]
            .iter()
            .enumerate()
        {
            assert!(
                closest[slot] <= FIGHT_RANGE,
                "seed {seed}: {role:?} laners never got within {FIGHT_RANGE} (closest {:.3})",
                closest[slot]
            );
        }
    }
}

#[test]
fn no_unit_is_stuck_short_of_its_target() {
    // Walls used to freeze units for the rest of the game: a unit
    // far from its target that did not move for four consecutive minutes.
    let mut state = new_match(70, 70);
    let mut rng = seeded_rng(1);
    let mut still_minutes = [0u8; 10];
    let mut last: Vec<(f64, f64)> = state.lol_map.units.iter().map(|u| (u.x, u.y)).collect();
    for minute in 1..=25 {
        state.step_minute(&mut rng);
        for (i, u) in state.lol_map.units.iter().enumerate() {
            let moved = distance(last[i], (u.x, u.y));
            let short_of_target = distance((u.x, u.y), (u.target_x, u.target_y)) > 0.05;
            if u.alive && moved < 0.002 && short_of_target {
                still_minutes[i] += 1;
            } else {
                still_minutes[i] = 0;
            }
            assert!(
                still_minutes[i] < 4,
                "minute {minute}: {:?} {:?} is frozen at ({:.2},{:.2}) short of ({:.2},{:.2})",
                u.side,
                u.role,
                u.x,
                u.y,
                u.target_x,
                u.target_y
            );
            last[i] = (u.x, u.y);
        }
    }
}
