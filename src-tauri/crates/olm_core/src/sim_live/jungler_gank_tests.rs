//! A jungler whose decision walked him to an enemy laner fights him when the kill is credible,
//! even while a camp of his own is alive or about to spawn. Combat used to answer "nothing" for
//! any jungler with a camp pending, so he stood beside the laner and took damage for nothing.

use super::combat::{own_jungle_camps_available_or_pending, pick_combat_target};
use super::test_helpers::{test_champion, test_runtime};
use super::*;

const NOW: f64 = LANE_COMBAT_UNLOCK_AT + 900.0;

fn at(x: f64, y: f64) -> Vec2 {
    Vec2 { x, y }
}

/// A blue jungler and a red mid laner at 40% health, 0.05 apart in the middle of the map, and
/// the default jungle with every camp alive.
fn gank_world() -> (RuntimeState, NeutralTimersRuntime) {
    let mut jungler = test_champion("blue-JGL", "blue", "JGL", "jungle", at(0.50, 0.50));
    jungler.max_hp = 100.0;
    jungler.hp = 100.0;
    let mut laner = test_champion("red-MID", "red", "MID", "mid", at(0.55, 0.50));
    laner.max_hp = 100.0;
    laner.hp = 40.0;
    let mut timers = neutral_timers_default_runtime_state();
    for timer in timers.entities.values_mut() {
        timer.alive = true;
        timer.unlocked = true;
    }
    let mut runtime = test_runtime(vec![jungler, laner], vec![], vec![], timers.clone());
    runtime.time_sec = NOW;
    (runtime, timers)
}

#[test]
fn a_jungler_with_a_camp_pending_still_hits_the_laner_he_can_kill() {
    let (runtime, timers) = gank_world();
    assert!(
        own_jungle_camps_available_or_pending(&timers, "blue", NOW),
        "the scenario needs a camp of his own pending"
    );

    let target = pick_combat_target(&runtime, 0, NOW, &timers);

    assert!(
        matches!(target, Some(CombatTarget::Champion(1))),
        "the jungler ignored a credible kill beside him"
    );
}

#[test]
fn a_jungler_beside_a_camp_he_can_hit_farms_it_before_the_laner() {
    let (runtime, timers) = gank_world();
    let camp = timers
        .entities
        .values()
        .find(|t| t.key == "blue-buff-blue")
        .map(|t| t.pos)
        .expect("a camp");
    let mut runtime = runtime;
    runtime.champions[0].pos = camp;
    runtime.champions[1].pos = Vec2 { x: camp.x + 0.05, y: camp.y };

    let target = pick_combat_target(&runtime, 0, NOW, &timers);

    assert!(matches!(target, Some(CombatTarget::Neutral(_))), "he left the camp under his hands");
}
