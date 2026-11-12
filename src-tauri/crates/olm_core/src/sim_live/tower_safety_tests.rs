//! A champion stays out of an enemy tower's reach when none of his minions is there to take
//! the shots, unless his team pushes the tower together or the kill under it is nearly won.

use super::test_helpers::{empty_neutral, test_champion, test_minion, test_runtime, test_structure};
use super::tower_safety::{keep_out_of_bare_tower_reach, Surroundings};
use super::*;

const TOWER_AT: Vec2 = Vec2 { x: 0.50, y: 0.50 };
/// Inside the reach of the tower at `TOWER_AT`.
const INSIDE: Vec2 = Vec2 { x: 0.54, y: 0.50 };
/// Outside it, on the same side.
const OUTSIDE: Vec2 = Vec2 { x: 0.65, y: 0.50 };
const LANING_SEC: f64 = FIRST_WAVE_CONTEST_UNTIL + 60.0;

fn laner_at(pos: Vec2) -> ChampionRuntime {
    test_champion("laner", "blue", "MID", "mid", pos)
}

fn enemy_tower() -> StructureRuntime {
    test_structure("red-test-tower", "red", "mid", TOWER_AT)
}

fn world(champions: Vec<ChampionRuntime>, minions: Vec<MinionRuntime>) -> RuntimeState {
    let mut runtime = test_runtime(champions, minions, vec![enemy_tower()], empty_neutral());
    runtime.time_sec = LANING_SEC;
    runtime
}

fn decide(runtime: &mut RuntimeState) -> bool {
    let snapshot = runtime.champions.clone();
    keep_out_of_bare_tower_reach(
        &mut runtime.champions[0],
        &Surroundings {
            now: runtime.time_sec,
            step_sec: runtime::FIXED_STEP_SEC,
            champions: &snapshot,
            minions: &runtime.minions,
            structures: &runtime.structures,
        },
    )
}

fn heading(runtime: &RuntimeState) -> Vec2 {
    *runtime.champions[0]
        .target_path
        .last()
        .expect("the champion has a path")
}

#[test]
fn a_champion_in_reach_with_none_of_his_minions_there_walks_out() {
    let mut runtime = world(vec![laner_at(INSIDE)], vec![]);

    let changed = decide(&mut runtime);

    assert!(changed, "he stayed under the tower with nothing to shield him");
    assert!(
        dist(heading(&runtime), TOWER_AT) > TOWER_ATTACK_RANGE,
        "he is sent to {:.3} from the tower, inside its reach",
        dist(heading(&runtime), TOWER_AT)
    );
}

#[test]
fn a_minion_of_his_team_in_reach_lets_him_stay() {
    let shield = test_minion("shield", "blue", "mid", Vec2 { x: 0.53, y: 0.50 });
    let mut runtime = world(vec![laner_at(INSIDE)], vec![shield]);

    assert!(!decide(&mut runtime), "he left although his minion took the shots");
}

#[test]
fn a_minion_of_the_other_team_does_not_shield_him() {
    let enemy_minion = test_minion("theirs", "red", "mid", Vec2 { x: 0.53, y: 0.50 });
    let mut runtime = world(vec![laner_at(INSIDE)], vec![enemy_minion]);

    assert!(decide(&mut runtime), "an enemy minion was taken for a shield");
}

#[test]
fn a_tower_locked_on_him_sends_him_out_even_among_his_minions() {
    let shield = test_minion("shield", "blue", "mid", Vec2 { x: 0.53, y: 0.50 });
    let mut runtime = world(vec![laner_at(INSIDE)], vec![shield]);
    runtime.structures[0].forced_target_champion_id = Some("laner".to_string());
    runtime.structures[0].forced_target_until = runtime.time_sec + 3.0;

    assert!(
        decide(&mut runtime),
        "he stayed in reach of a tower that had picked him over the minions"
    );
}

#[test]
fn three_allies_at_the_tower_are_a_push_and_stay() {
    let mut allies: Vec<ChampionRuntime> = ["a", "b"]
        .into_iter()
        .map(|id| {
            test_champion(id, "blue", "TOP", "mid", Vec2 { x: 0.55, y: 0.51 })
        })
        .collect();
    allies.insert(0, laner_at(INSIDE));
    let mut runtime = world(allies, vec![]);

    assert!(!decide(&mut runtime), "a group of three left the tower alone");
}

#[test]
fn a_nearly_dead_enemy_in_reach_is_worth_the_shots() {
    let mut victim = test_champion("victim", "red", "MID", "mid", Vec2 { x: 0.56, y: 0.50 });
    victim.hp = victim.max_hp * 0.15;
    let mut runtime = world(vec![laner_at(INSIDE), victim], vec![]);

    assert!(!decide(&mut runtime), "he gave up a kill that was one hit away");
}

#[test]
fn a_nearly_dead_champion_does_not_dive_for_a_kill() {
    let mut victim = test_champion("victim", "red", "MID", "mid", Vec2 { x: 0.56, y: 0.50 });
    victim.hp = victim.max_hp * 0.15;
    let mut weak = laner_at(INSIDE);
    weak.hp = weak.max_hp * 0.2;
    let mut runtime = world(vec![weak, victim], vec![]);

    assert!(decide(&mut runtime), "a champion at 20% health dived under a tower");
}

#[test]
fn a_destination_inside_the_reach_is_replaced_by_its_edge() {
    let mut runtime = world(vec![laner_at(OUTSIDE)], vec![]);
    runtime.champions[0].target_path = vec![INSIDE];
    runtime.champions[0].target_path_index = 0;

    let changed = decide(&mut runtime);

    assert!(changed, "he was left to walk under the tower");
    assert!(dist(heading(&runtime), TOWER_AT) > TOWER_ATTACK_RANGE);
}

#[test]
fn a_destination_outside_the_reach_is_left_alone() {
    let mut runtime = world(vec![laner_at(OUTSIDE)], vec![]);
    runtime.champions[0].target_path = vec![Vec2 { x: 0.70, y: 0.52 }];
    runtime.champions[0].target_path_index = 0;

    assert!(!decide(&mut runtime));
}

#[test]
fn a_champion_channelling_a_recall_is_left_where_he_stands() {
    let mut recalling = laner_at(INSIDE);
    recalling.state = "recall".to_string();
    recalling.recall_channel_until = LANING_SEC + 3.0;
    let mut runtime = world(vec![recalling], vec![]);

    assert!(!decide(&mut runtime));
}

/// The wave front is the middle of the two waves' fronts. With the allied wave dead and the
/// enemy wave under its tower, that middle is inside the tower's reach with nothing to shield
/// the laner who stands there to farm.
#[test]
fn the_farm_anchor_of_a_wave_pushed_under_the_tower_is_outside_its_reach() {
    let mut pushed = test_minion("pushed", "red", "mid", Vec2 { x: 0.53, y: 0.50 });
    pushed.path_index = 4;
    let runtime = world(vec![laner_at(OUTSIDE)], vec![pushed]);

    let anchor = lane_farm_anchor_pos_v2(
        &runtime.champions[0],
        runtime.time_sec,
        &runtime.champions,
        &runtime.minions,
        &runtime.structures,
    );

    assert!(
        dist(anchor, TOWER_AT) > TOWER_ATTACK_RANGE,
        "the anchor is {:.3} from the tower, inside its reach",
        dist(anchor, TOWER_AT)
    );
}

#[test]
fn the_farm_anchor_stays_at_the_wave_while_his_own_minions_hold_the_tower() {
    let mut pushed = test_minion("pushed", "red", "mid", Vec2 { x: 0.53, y: 0.50 });
    pushed.path_index = 4;
    let mut own = test_minion("own", "blue", "mid", Vec2 { x: 0.55, y: 0.50 });
    own.path_index = 4;
    let runtime = world(vec![laner_at(OUTSIDE)], vec![pushed, own]);

    let anchor = lane_farm_anchor_pos_v2(
        &runtime.champions[0],
        runtime.time_sec,
        &runtime.champions,
        &runtime.minions,
        &runtime.structures,
    );

    assert!(
        dist(anchor, TOWER_AT) <= TOWER_ATTACK_RANGE,
        "the anchor left the wave although his minions shielded him"
    );
}

#[test]
fn walking_to_a_spot_under_the_tower_ends_at_its_edge() {
    let mut runtime = world(vec![laner_at(OUTSIDE)], vec![]);
    runtime.champions[0].target_path = vec![TOWER_AT];
    runtime.champions[0].target_path_index = 0;
    runtime.champions[0].next_decision_at = runtime.time_sec + 1000.0;

    for _ in 0..60 {
        runtime.time_sec += runtime::FIXED_STEP_SEC;
        move_champions(&mut runtime, runtime::FIXED_STEP_SEC);
    }

    assert!(
        dist(runtime.champions[0].pos, TOWER_AT) > TOWER_ATTACK_RANGE,
        "he walked to {:.3} from the tower",
        dist(runtime.champions[0].pos, TOWER_AT)
    );
}

#[test]
fn a_step_that_would_cross_the_reach_walks_him_around_it() {
    let mut runtime = world(vec![laner_at(Vec2 { x: 0.405, y: 0.50 })], vec![]);
    runtime.champions[0].target_path = vec![Vec2 { x: 0.62, y: 0.50 }];
    runtime.champions[0].target_path_index = 0;

    let changed = decide(&mut runtime);

    assert!(changed, "he was left to walk through the tower's reach");
    let detour = runtime.champions[0].target_path[0];
    assert!(
        dist(detour, TOWER_AT) > TOWER_ATTACK_RANGE,
        "his detour is {:.3} from the tower, inside its reach",
        dist(detour, TOWER_AT)
    );
    assert!((detour.y - 0.50).abs() > 0.02, "he is not turned aside: {detour:?}");
    assert_eq!(heading(&runtime).x, 0.62, "he lost his destination");
}

#[test]
fn a_walk_past_the_tower_ends_on_the_other_side_of_it() {
    let mut runtime = world(vec![laner_at(Vec2 { x: 0.395, y: 0.50 })], vec![]);
    runtime.champions[0].target_path = vec![Vec2 { x: 0.62, y: 0.50 }];
    runtime.champions[0].target_path_index = 0;
    runtime.champions[0].next_decision_at = runtime.time_sec + 1000.0;
    let mut closest = f64::INFINITY;

    for _ in 0..80 {
        runtime.time_sec += runtime::FIXED_STEP_SEC;
        move_champions(&mut runtime, runtime::FIXED_STEP_SEC);
        closest = closest.min(dist(runtime.champions[0].pos, TOWER_AT));
    }

    assert!(closest > TOWER_ATTACK_RANGE, "he came {closest:.3} from the tower");
    assert!(
        runtime.champions[0].pos.x > TOWER_AT.x + 0.05,
        "he stopped at {:?}, short of the other side",
        runtime.champions[0].pos
    );
}

#[test]
fn a_walk_that_stays_outside_the_reach_is_not_held() {
    let mut runtime = world(vec![laner_at(Vec2 { x: 0.40, y: 0.30 })], vec![]);
    runtime.champions[0].target_path = vec![Vec2 { x: 0.62, y: 0.30 }];
    runtime.champions[0].target_path_index = 0;

    assert!(!decide(&mut runtime));
}

#[test]
fn a_recalling_champion_who_has_not_begun_to_channel_walks_out_of_reach() {
    let mut recalling = laner_at(INSIDE);
    recalling.state = "recall".to_string();
    let mut runtime = world(vec![recalling], vec![]);

    assert!(decide(&mut runtime), "a recall began under a tower that would cancel it");
}
