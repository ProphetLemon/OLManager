//! Player ratings must reach the minute-level engine: it used to copy only the
//! player id and condition, so a 95 and a 40 rated roster produced identical
//! matches.

use super::test_support::*;
use super::*;
use crate::engine::event::EventType;

/// Plays `minutes` of a match and returns `(kills, objectives)` per side as
/// `[home, away]`.
fn early_game(home: u8, away: u8, seed: u64, minutes: u8) -> ([u32; 2], [u32; 2]) {
    let mut state = new_match(home, away);
    let mut rng = seeded_rng(seed);
    for _ in 0..minutes {
        state.step_minute(&mut rng);
    }
    let mut kills = [0u32; 2];
    let mut objectives = [0u32; 2];
    for event in &state.events {
        let slot = usize::from(event.side == Side::Away);
        match event.event_type {
            EventType::Kill => kills[slot] += 1,
            EventType::ObjectiveTaken => objectives[slot] += 1,
            _ => {}
        }
    }
    (kills, objectives)
}

/// Sums `(strong, weak)` kills and objectives over `seeds` matches played in
/// both orientations, so a side or seed bias cancels out.
fn strong_vs_weak(strong: u8, weak: u8, seeds: u64, minutes: u8) -> ((u32, u32), (u32, u32)) {
    let (mut kills, mut objectives) = ((0, 0), (0, 0));
    for seed in 0..seeds {
        let (k, o) = early_game(strong, weak, seed, minutes);
        kills = (kills.0 + k[0], kills.1 + k[1]);
        objectives = (objectives.0 + o[0], objectives.1 + o[1]);
        let (k, o) = early_game(weak, strong, seed, minutes);
        kills = (kills.0 + k[1], kills.1 + k[0]);
        objectives = (objectives.0 + o[1], objectives.1 + o[0]);
    }
    (kills, objectives)
}

#[test]
fn stronger_roster_wins_the_fights() {
    // 16 matches per orientation, 25 minutes. [PLACEHOLDER] The old engine
    // produced about one kill per match, so the totals below could not be met.
    let ((strong, weak), _) = strong_vs_weak(85, 55, 16, 25);
    assert!(
        strong + weak >= 16 * 2 * 6,
        "fights must happen: only {} kills in 32 matches",
        strong + weak
    );
    assert!(
        strong * 2 >= weak * 3,
        "an 85 roster should out-kill a 55 roster at least 3:2, got {strong}:{weak}"
    );
}

#[test]
fn stronger_roster_controls_more_objectives() {
    let (_, (strong, weak)) = strong_vs_weak(90, 50, 16, 30);
    assert!(
        strong > weak,
        "a 90 roster should take more objectives than a 50 roster, got {strong}:{weak}"
    );
}
