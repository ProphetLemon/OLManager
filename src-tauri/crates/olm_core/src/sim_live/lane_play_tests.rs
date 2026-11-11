//! How the laners stand and what they farm once the first wave has been
//! fought over.

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
