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

fn enemy_laner_at(pos: Vec2) -> ChampionRuntime {
    test_champion("enemy", "red", "MID", "mid", pos)
}

#[test]
fn a_laner_does_not_stand_on_the_spot_of_an_enemy_champion() {
    let laner = test_champion("laner", "blue", "MID", "mid", Vec2 { x: 0.45, y: 0.5 });
    let spot = Vec2 { x: 0.50, y: 0.5 };
    let enemy = enemy_laner_at(Vec2 { x: 0.505, y: 0.5 });

    let stands = keep_apart_from_enemy_champions(&laner, spot, &[laner.clone(), enemy.clone()]);

    assert!(dist(stands, enemy.pos) >= LANE_ENEMY_CHAMPION_SPACING - 1e-9);
}

#[test]
fn a_laner_keeps_his_spot_when_no_enemy_champion_is_close() {
    let laner = test_champion("laner", "blue", "MID", "mid", Vec2 { x: 0.45, y: 0.5 });
    let spot = Vec2 { x: 0.50, y: 0.5 };
    let enemy = enemy_laner_at(Vec2 { x: 0.60, y: 0.5 });

    let stands = keep_apart_from_enemy_champions(&laner, spot, &[laner.clone(), enemy]);

    assert!(dist(stands, spot) < 1e-12);
}

#[test]
fn the_spacing_goes_to_the_side_of_the_laner_who_stood_there() {
    let laner = test_champion("laner", "blue", "MID", "mid", Vec2 { x: 0.45, y: 0.5 });
    let enemy = enemy_laner_at(Vec2 { x: 0.505, y: 0.5 });

    let stands = keep_apart_from_enemy_champions(&laner, Vec2 { x: 0.50, y: 0.5 }, &[enemy]);

    assert!(stands.x < 0.505, "he was pushed through the enemy instead of back");
}

fn separated_after(champions: Vec<ChampionRuntime>, steps: usize) -> RuntimeState {
    let mut runtime = test_runtime(champions, vec![], vec![], empty_neutral());
    for _ in 0..steps {
        pathing::separate_enemy_champions(&mut runtime);
    }
    runtime
}

#[test]
fn enemy_champions_on_the_same_spot_slide_apart_until_the_bubbles_do_not_overlap() {
    let at = Vec2 { x: 0.5, y: 0.5 };
    let runtime = separated_after(
        vec![
            test_champion("blue", "blue", "MID", "mid", at),
            test_champion("red", "red", "MID", "mid", at),
        ],
        40,
    );

    assert!(dist(runtime.champions[0].pos, runtime.champions[1].pos) >= pathing::ENEMY_BUBBLE_DISTANCE - 1e-9);
}

#[test]
fn allied_champions_may_stand_on_the_same_spot() {
    let at = Vec2 { x: 0.5, y: 0.5 };
    let runtime = separated_after(
        vec![
            test_champion("a", "blue", "MID", "mid", at),
            test_champion("b", "blue", "TOP", "top", at),
        ],
        40,
    );

    assert!(dist(runtime.champions[0].pos, runtime.champions[1].pos) < 0.005);
}

#[test]
fn a_champion_who_channels_a_recall_is_not_pushed() {
    let at = Vec2 { x: 0.5, y: 0.5 };
    let mut recaller = test_champion("red", "red", "MID", "mid", at);
    recaller.state = "recall".to_string();
    recaller.recall_channel_until = 100.0;
    let runtime = separated_after(vec![test_champion("blue", "blue", "MID", "mid", at), recaller], 40);

    assert!(dist(runtime.champions[1].pos, at) < 1e-9);
}
