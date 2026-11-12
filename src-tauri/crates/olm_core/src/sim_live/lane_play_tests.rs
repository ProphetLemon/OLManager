//! How the solo laners and the support stand and what they farm once the first
//! wave has been fought over.

use super::combat::{pick_combat_target, support_leaves_minions_to_adc};
use super::test_helpers::{empty_neutral, test_champion, test_minion, test_runtime};
use super::*;

/// A moment well after the first wave window (`FIRST_WAVE_CONTEST_UNTIL`).
const MID_LANING_SEC: f64 = FIRST_WAVE_CONTEST_UNTIL + 60.0;

fn lane_minion(id: &str, team: &str, lane: &str, pos: Vec2, path_index: usize) -> MinionRuntime {
    let mut minion = test_minion(id, team, lane, pos);
    minion.path_index = path_index;
    minion
}

/// MID has always played around the wave front after the opening; TOP and ADC
/// held a node-based anchor 0.06 to 0.09 behind it, out of reach of the enemy
/// wave, and only took what was pushed onto them. Which laner got those minions
/// then followed the push of the minion war, not the players.
#[test]
fn every_solo_laner_stands_at_the_wave_front_after_the_opening() {
    for (role, lane) in [("TOP", "top"), ("MID", "mid"), ("ADC", "bot")] {
        let laner = test_champion("laner", "blue", role, lane, Vec2 { x: 0.5, y: 0.5 });
        let minions = vec![
            lane_minion("a", "blue", lane, Vec2 { x: 0.17, y: 0.16 }, 4),
            lane_minion("b", "red", lane, Vec2 { x: 0.19, y: 0.18 }, 4),
        ];
        let runtime = test_runtime(vec![laner], minions, vec![], empty_neutral());
        let champion = &runtime.champions[0];

        let stands = lane_farm_anchor_pos_v2(
            champion,
            MID_LANING_SEC,
            &runtime.champions,
            &runtime.minions,
            &runtime.structures,
        );
        let wave_front = lane_wave_front_pos(champion, &runtime.minions, &runtime.structures);

        assert!(
            dist(stands, wave_front) < 1e-9,
            "{role} stands {:.3} from the wave front",
            dist(stands, wave_front)
        );
    }
}

fn bot_lane_with_support(adc_state: &str, adc_alive: bool, gap: f64) -> RuntimeState {
    let mut support = test_champion("sup", "blue", "SUP", "bot", Vec2 { x: 0.50, y: 0.50 });
    support.attack_damage = 30.0;
    let mut adc = test_champion("adc", "blue", "ADC", "bot", Vec2 { x: 0.50 + gap, y: 0.50 });
    adc.state = adc_state.to_string();
    adc.alive = adc_alive;
    let mut weak_minion = lane_minion("m", "red", "bot", Vec2 { x: 0.53, y: 0.50 }, 3);
    weak_minion.hp = 3.0;
    test_runtime(vec![support, adc], vec![weak_minion], vec![], empty_neutral())
}

/// A support is paid for one lane minion in `SUPPORT_CS_MIN_INTERVAL_SEC`, so
/// the minions it killed in between paid nobody and were taken from the ADC.
#[test]
fn a_support_next_to_its_adc_does_not_pick_the_minion_to_kill() {
    let runtime = bot_lane_with_support("lane", true, 0.02);

    let target = pick_combat_target(&runtime, 0, MID_LANING_SEC, &empty_neutral());

    assert!(
        !matches!(target, Some(CombatTarget::Minion(_))),
        "the support went for a minion with its ADC beside it"
    );
}

#[test]
fn a_support_with_no_adc_to_leave_the_minions_to_still_takes_them() {
    for (state, alive, gap) in [("lane", false, 0.02), ("recall", true, 0.02), ("lane", true, 0.5)] {
        let runtime = bot_lane_with_support(state, alive, gap);

        let target = pick_combat_target(&runtime, 0, MID_LANING_SEC, &empty_neutral());

        assert!(
            matches!(target, Some(CombatTarget::Minion(_))),
            "ADC state {state}, alive {alive}, {gap} away: the support left the minion alone"
        );
    }
}

#[test]
fn only_a_support_leaves_the_minions_to_the_adc() {
    let runtime = bot_lane_with_support("lane", true, 0.02);
    let mut other = runtime.champions[0].clone();
    other.role = "TOP".to_string();

    assert!(support_leaves_minions_to_adc(&runtime, &runtime.champions[0]));
    assert!(!support_leaves_minions_to_adc(&runtime, &other));
}
