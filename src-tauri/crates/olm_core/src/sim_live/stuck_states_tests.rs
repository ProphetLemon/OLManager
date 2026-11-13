//! The two stuck states the replay found: a recaller that never channels, and a pusher that
//! shuffles near his own base because an enemy minion out of reach keeps redirecting his walk.

use super::combat::{pick_combat_target, resolve_champion_combat};
use super::team_push::PushOrder;
use super::test_helpers::{empty_neutral, test_champion, test_minion, test_runtime, test_structure};
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

/// A blue pusher at `at`, walking to `stand` on the plan of the team, with a red minion `gap`
/// away to the east that he can see but not reach.
fn pusher_with_minion_out_of_reach(gap: f64) -> (RuntimeState, Vec2) {
    let at = Vec2 { x: 0.30, y: 0.62 };
    let stand = Vec2 { x: 0.20, y: 0.75 };
    let mut pusher = test_champion("blue-TOP", "blue", "TOP", "top", at);
    pusher.state = "objective".to_string();
    pusher.has_left_base_once = true;
    pusher.push = Some(PushOrder {
        structure_id: "red-test-tower".to_string(),
        structure_pos: Vec2 { x: 0.80, y: 0.20 },
        dive: false,
        rally: None,
    });
    pusher.target_path = vec![stand];
    let minion = test_minion("red-minion", "red", "top", Vec2 { x: at.x + gap, y: at.y });
    let tower = test_structure("red-test-tower", "red", "top", Vec2 { x: 0.80, y: 0.20 });
    let mut runtime = test_runtime(vec![pusher], vec![minion], vec![tower], empty_neutral());
    runtime.time_sec = NOW;
    (runtime, stand)
}

#[test]
fn a_pusher_does_not_walk_off_his_plan_after_a_minion_out_of_reach() {
    let (mut runtime, stand) = pusher_with_minion_out_of_reach(0.09);
    let neutral = empty_neutral();
    assert!(
        matches!(pick_combat_target(&runtime, 0, NOW, &neutral), Some(CombatTarget::Minion(_))),
        "the scenario needs the minion to be his combat target"
    );

    resolve_champion_combat(&mut runtime);

    let path = &runtime.champions[0].target_path;
    assert!(
        path.len() == 1 && dist(path[0], stand) < 1e-9,
        "the minion out of reach redirected the pusher's walk to {path:?}"
    );
}

#[test]
fn a_pusher_still_hits_a_minion_in_reach() {
    let (mut runtime, _) = pusher_with_minion_out_of_reach(0.03);
    let hp_before = runtime.minions[0].hp;

    resolve_champion_combat(&mut runtime);

    assert!(runtime.minions[0].hp < hp_before, "the pusher did not hit the minion in reach");
}

/// The champions of a recall in which a red champion stands `gap` east of the blue recaller: near
/// enough to stop the channel (0.085) and not hitting.
fn with_enemy_near(recaller: &ChampionRuntime, gap: f64) -> Vec<ChampionRuntime> {
    let enemy = test_champion(
        "red-ADC",
        "red",
        "ADC",
        "bot",
        Vec2 { x: recaller.pos.x + gap, y: recaller.pos.y },
    );
    vec![recaller.clone(), enemy]
}

fn recaller_at_his_anchor() -> ChampionRuntime {
    let spot = Vec2 { x: 0.30, y: 0.62 };
    let mut recaller = test_champion("blue-ADC", "blue", "ADC", "bot", spot);
    recaller.state = "recall".to_string();
    recaller.recall_anchor = Some(spot);
    recaller
}

#[test]
fn a_recaller_with_an_enemy_too_near_waits_before_he_channels() {
    let mut recaller = recaller_at_his_anchor();
    let team = with_enemy_near(&recaller, 0.05);

    tick_recall(&mut recaller, NOW, &team, &[], &[], &mut Vec::new());

    assert!(recaller.recall_channel_until <= NOW, "he channelled with the enemy at 0.05");
}

#[test]
fn a_recaller_with_an_enemy_too_near_channels_after_the_patience() {
    let mut recaller = recaller_at_his_anchor();
    let team = with_enemy_near(&recaller, 0.05);
    tick_recall(&mut recaller, NOW, &team, &[], &[], &mut Vec::new());
    // He walked to the fallback anchor and the enemy stayed beside him.
    let later = NOW + RECALL_BLOCKED_PATIENCE_SEC + 0.6;
    recaller.pos = recaller.recall_anchor.expect("the walk has an anchor");
    let team = with_enemy_near(&recaller, 0.05);

    tick_recall(&mut recaller, later, &team, &[], &[], &mut Vec::new());

    assert!(
        recaller.recall_channel_until > later,
        "the recaller stayed in the recall state with no channel after the patience"
    );
}
