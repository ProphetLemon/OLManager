//! Red and blue must start every lane from the same footing: the same distance
//! along the lane path, the same view of the structures, and no move order that
//! hands one wave the first step into reach.

use super::test_helpers::{test_minion, test_runtime, test_structure, empty_neutral};
use super::*;

/// Largest gap, in map units, between a node and the mirror image of its twin.
const MIRROR_TOLERANCE: f64 = 0.02;

fn swapped(point: Vec2) -> Vec2 {
    Vec2 {
        x: point.y,
        y: point.x,
    }
}

/// The two bases are mirror images about the diagonal that swaps x and y, so
/// red must walk the line blue walks, the other way: red's node k is blue's
/// node k with x and y exchanged. A path whose nodes are not their own mirror
/// image gives each team a different lane; the top lane had red's node 4 at
/// (0.10, 0.20) where blue's mirror image was (0.43, 0.08).
#[test]
fn every_lane_path_is_walked_along_the_same_line_by_both_teams() {
    for lane in ["top", "mid", "bot"] {
        let blue = lane_path_for("blue", lane);
        let red = lane_path_for("red", lane);
        assert_eq!(blue.len(), red.len(), "{lane} paths differ in length");
        for (k, (b, r)) in blue.iter().zip(&red).enumerate() {
            let gap = dist(swapped(*b), *r);
            assert!(
                gap < MIRROR_TOLERANCE,
                "{lane} node {k}: red's node is {gap:.3} from the mirror image of blue's"
            );
        }
    }
}

/// Lane minions walk toward any enemy turret within 0.24 and stop to fight it,
/// so which wave got there first depended on the turret coordinates, which are
/// not exact mirrors of each other (the top outer turrets are 0.009 apart, the
/// bottom ones 0.017). Both are read as blue's coordinates, mirrored for red.
#[test]
fn the_lane_reads_every_red_structure_at_the_mirror_of_its_blue_twin() {
    for blue_seed in STRUCTURE_LAYOUT.iter().filter(|s| s.team == "blue") {
        let red_id = blue_seed.id.replacen("blue-", "red-", 1);
        let red_seed = STRUCTURE_LAYOUT
            .iter()
            .find(|s| s.id == red_id)
            .unwrap_or_else(|| panic!("{red_id} has no counterpart in the layout"));
        let red = test_structure(red_seed.id, "red", red_seed.lane, red_seed.pos);
        let blue = test_structure(blue_seed.id, "blue", blue_seed.lane, blue_seed.pos);
        assert!(
            dist(symmetric_structure_pos(&red), swapped(blue_seed.pos)) < 1e-9,
            "{red_id} is read at ({:.4}, {:.4}), not at the mirror of {}",
            symmetric_structure_pos(&red).x,
            symmetric_structure_pos(&red).y,
            blue_seed.id
        );
        assert!(
            dist(symmetric_structure_pos(&blue), blue_seed.pos) < 1e-9,
            "{} is moved",
            blue_seed.id
        );
    }
}

/// Blue minions come first in the list. Deciding "hold and fight" while the
/// loop moved them let a blue minion that stepped into reach freeze the red
/// minion behind it for free: the red wave stopped short and the first contact
/// of every wave happened on red's half of the lane.
#[test]
fn a_minion_stepping_into_reach_does_not_stop_the_enemy_listed_after_it() {
    let mut blue = test_minion("m-blue", "blue", "mid", Vec2 { x: 0.40, y: 0.5 });
    blue.path = vec![Vec2 { x: 0.60, y: 0.5 }];
    let mut red = test_minion("m-red", "red", "mid", Vec2 { x: 0.47, y: 0.5 });
    red.path = vec![Vec2 { x: 0.40, y: 0.5 }];
    let mut runtime = test_runtime(vec![], vec![blue, red], vec![], empty_neutral());

    move_minions(&mut runtime, 0.5);

    let (blue, red) = (&runtime.minions[0], &runtime.minions[1]);
    assert!(blue.pos.x > 0.42, "the blue minion did not move: {:.3}", blue.pos.x);
    assert!(
        red.pos.x < 0.46,
        "the red minion stood still at {:.3} because the blue one reached it first",
        red.pos.x
    );
}
