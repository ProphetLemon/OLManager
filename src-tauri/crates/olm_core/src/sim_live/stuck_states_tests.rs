//! The stuck states the replay found: a recaller that never channels.

use super::test_helpers::test_champion;
use super::*;

const NOW: f64 = LANE_COMBAT_UNLOCK_AT + 900.0;

#[test]
fn a_recaller_that_stopped_short_of_a_drifted_anchor_starts_to_channel() {
    let spot = Vec2 { x: 0.60, y: 0.68 };
    let mut jungler = test_champion("blue-JGL", "blue", "JGL", "jungle", spot);
    jungler.state = "recall".to_string();
    // The anchor drifted 0.015 from where the walk was aimed: more than the old arrival radius
    // (0.012), less than the repath hysteresis (0.018), so no new walk starts.
    jungler.recall_anchor = Some(Vec2 { x: spot.x + 0.015, y: spot.y });
    jungler.target_path = vec![spot];
    let team = [jungler.clone()];
    let mut events = Vec::new();

    tick_recall(&mut jungler, NOW, &team, &[], &[], &mut events);

    assert!(
        jungler.recall_channel_until > NOW,
        "the recaller stood 0.015 from the anchor with no walk and no channel"
    );
}
