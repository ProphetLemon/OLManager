//! The plan of a team that is ahead in numbers: when it starts and ends, what its champions
//! do instead of shopping, farming and defending, and the tower they may take with no wave.

use super::combat::pick_combat_target;
use super::team_push::{self, PushOrder};
use super::test_helpers::{
    empty_neutral, test_champion, test_minion, test_runtime, test_structure,
};
use super::tower_safety::{keep_out_of_bare_tower_reach, Surroundings};
use super::*;

const ROLES: [&str; 5] = ["TOP", "JGL", "MID", "ADC", "SUP"];
const NOW: f64 = LANE_COMBAT_UNLOCK_AT + 900.0;
const TOWER_AT: Vec2 = Vec2 { x: 0.50, y: 0.50 };
const TOWER_ID: &str = "red-test-tower";
/// Inside the reach of the tower, on the side of the blue base.
const UNDER_TOWER: Vec2 = Vec2 { x: 0.47, y: 0.53 };

fn lane_of(role: &str) -> &'static str {
    match role {
        "TOP" => "top",
        "MID" => "mid",
        "JGL" => "jungle",
        _ => "bot",
    }
}

/// Five champions of `team`, the first `alive` of them alive and standing at `at`; the others
/// dead and back in 40 seconds.
fn team_of(team: &str, alive: usize, at: Vec2) -> Vec<ChampionRuntime> {
    ROLES
        .iter()
        .enumerate()
        .map(|(i, role)| {
            let mut champion = test_champion(
                &format!("{team}-{role}"),
                team,
                role,
                lane_of(role),
                Vec2 { x: at.x + 0.004 * i as f64, y: at.y },
            );
            champion.has_left_base_once = true;
            if i >= alive {
                champion.alive = false;
                champion.respawn_at = NOW + 40.0;
            }
            champion
        })
        .collect()
}

/// Blue stands together at the lower left of the map, red far from the tower; one red tower
/// stands at `TOWER_AT`.
fn world(blue_alive: usize, red_alive: usize) -> RuntimeState {
    let mut champions = team_of("blue", blue_alive, Vec2 { x: 0.30, y: 0.62 });
    champions.extend(team_of("red", red_alive, Vec2 { x: 0.85, y: 0.15 }));
    let tower = test_structure(TOWER_ID, "red", "mid", TOWER_AT);
    let mut runtime = test_runtime(champions, vec![], vec![tower], empty_neutral());
    runtime.time_sec = NOW;
    runtime
}

fn blue_plan(runtime: &mut RuntimeState) -> team_push::TeamPush {
    team_push::update_team_pushes(runtime);
    runtime.team_push[0].clone()
}

fn order(dive: bool) -> PushOrder {
    PushOrder {
        structure_id: TOWER_ID.to_string(),
        structure_pos: TOWER_AT,
        dive,
        rally: None,
    }
}

#[test]
fn a_team_two_champions_up_plays_the_plan_against_the_nearest_tower() {
    let mut runtime = world(5, 3);

    let plan = blue_plan(&mut runtime);

    assert!(plan.active, "five against three did not start the plan");
    assert_eq!(plan.target_id.as_deref(), Some(TOWER_ID));
}

#[test]
fn a_team_one_champion_up_keeps_playing_its_routines() {
    let mut runtime = world(4, 3);

    assert!(!blue_plan(&mut runtime).active, "four against three started the plan");
}

#[test]
fn a_team_against_an_empty_enemy_plays_the_plan_even_alone() {
    let mut runtime = world(1, 0);

    assert!(blue_plan(&mut runtime).active, "the last champion stood by with no enemy alive");
}

#[test]
fn a_team_even_in_numbers_does_not_start_the_plan() {
    let mut runtime = world(5, 5);

    assert!(!blue_plan(&mut runtime).active, "five against five started the plan");
}

#[test]
fn the_plan_goes_on_when_the_enemy_champions_are_back_and_ends_when_the_team_is_behind() {
    let mut runtime = world(5, 3);
    assert!(blue_plan(&mut runtime).active);

    // Both dead enemies are back: five against five, the plan goes on.
    runtime.champions[8].alive = true;
    runtime.champions[9].alive = true;
    assert!(blue_plan(&mut runtime).active, "the plan ended at the first respawn, before the tower fell");

    // One of ours dies: four against five.
    runtime.champions[0].alive = false;
    runtime.champions[0].respawn_at = NOW + 40.0;
    assert!(!blue_plan(&mut runtime).active, "a team behind in numbers kept the plan");
}

#[test]
fn champions_about_to_die_do_not_make_the_plan_for_the_team() {
    let mut runtime = world(5, 3);
    for champion in runtime.champions.iter_mut().take(5) {
        champion.hp = champion.max_hp * 0.2;
    }

    assert!(!blue_plan(&mut runtime).active, "five wounded champions went to a tower");
}

#[test]
fn a_team_with_the_baron_buff_and_no_disadvantage_plays_it_without_diving() {
    let mut runtime = world(4, 4);
    let mut buffs = RuntimeBuffState::default();
    team_buffs_mut(&mut buffs, "blue").baron_until = NOW + 100.0;
    set_runtime_buffs(&mut runtime, &buffs);

    let plan = blue_plan(&mut runtime);

    assert!(plan.active, "the buff holder did not push");
    assert!(!plan.dive, "the buff holder dives a tower with no wave");
}

#[test]
fn a_team_with_the_baron_buff_and_fewer_champions_does_not_push() {
    let mut runtime = world(3, 4);
    let mut buffs = RuntimeBuffState::default();
    team_buffs_mut(&mut buffs, "blue").baron_until = NOW + 100.0;
    set_runtime_buffs(&mut runtime, &buffs);

    assert!(!blue_plan(&mut runtime).active);
}

fn decide(runtime: &RuntimeState, idx: usize) -> ChampionRuntime {
    let snapshot = runtime.champions.clone();
    let mut champion = runtime.champions[idx].clone();
    macro_ai::decide_champion_state(
        &mut champion,
        runtime.time_sec,
        &runtime.minions,
        &runtime.structures,
        &snapshot,
        Some(&empty_neutral()),
        &RuntimeTeamTactics::default(),
        &RuntimeTeamBuffState::default(),
    );
    champion
}

fn rich(runtime: &mut RuntimeState, idx: usize) {
    runtime.champions[idx].gold = 100_000;
}

#[test]
fn a_champion_who_can_buy_an_item_recalls_when_his_team_does_not_push() {
    let mut runtime = world(4, 3);
    rich(&mut runtime, 0);

    assert_eq!(decide(&runtime, 0).state, "recall");
}

#[test]
fn a_champion_who_can_buy_an_item_walks_to_the_tower_when_his_team_pushes() {
    let mut runtime = world(5, 3);
    rich(&mut runtime, 0);
    runtime.champions[0].push = Some(order(true));

    let champion = decide(&runtime, 0);

    assert_eq!(champion.state, "objective", "he went shopping in the middle of the push");
    let stand = team_push::stand_position(&order(true), "blue");
    assert!(dist(*champion.target_path.last().expect("a path"), stand) < 0.02);
}

#[test]
fn the_jungler_leaves_his_camps_for_the_push() {
    let mut runtime = world(5, 3);
    runtime.champions[1].push = Some(order(true));

    let champion = decide(&runtime, 1);

    assert_eq!(champion.state, "objective");
    assert!(dist(*champion.target_path.last().expect("a path"), TOWER_AT) < 0.06);
}

#[test]
fn an_enemy_champion_hitting_the_nexus_calls_a_pusher_home() {
    let mut runtime = world(5, 3);
    let mut nexus = test_structure("blue-nexus-top-tower", "blue", "base", base_position_for("blue"));
    nexus.hp = nexus.max_hp * 0.5;
    let nexus_pos = nexus.pos;
    runtime.structures.push(nexus);
    runtime.champions[5].pos = nexus_pos;
    runtime.champions[0].push = Some(order(true));

    let champion = decide(&runtime, 0);

    assert!(
        champion.state == "recall"
            || dist(*champion.target_path.last().expect("a path"), nexus_pos) < 0.02,
        "a pusher stayed at the tower while the nexus tower fell"
    );
}

#[test]
fn a_pusher_in_reach_hits_the_tower_with_no_wave_of_his_own() {
    let mut runtime = world(5, 3);
    runtime.champions[0].pos = Vec2 { x: 0.47, y: 0.52 };
    runtime.champions[0].push = Some(order(true));

    let target = pick_combat_target(&runtime, 0, NOW, &decode_neutral_timers_state(&runtime.neutral_timers).expect("timers"));

    assert!(
        matches!(target, Some(CombatTarget::Structure(0))),
        "the pusher under the tower picked something else"
    );
}

#[test]
fn a_pusher_far_from_the_tower_picks_no_structure() {
    let mut runtime = world(5, 3);
    runtime.champions[0].push = Some(order(true));

    let target = pick_combat_target(&runtime, 0, NOW, &decode_neutral_timers_state(&runtime.neutral_timers).expect("timers"));

    assert!(!matches!(target, Some(CombatTarget::Structure(_))));
}

fn dive_world(dive: bool, allies: usize, enemy_near: bool) -> RuntimeState {
    let mut runtime = world(allies.max(1), if enemy_near { 5 } else { 3 });
    for idx in 0..allies {
        runtime.champions[idx].pos = Vec2 { x: UNDER_TOWER.x + 0.003 * idx as f64, y: UNDER_TOWER.y };
        runtime.champions[idx].push = Some(order(dive));
    }
    if enemy_near {
        runtime.champions[5].pos = Vec2 { x: 0.52, y: 0.50 };
    }
    runtime
}

fn leaves_the_tower(runtime: &mut RuntimeState) -> bool {
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

#[test]
fn two_pushers_take_a_bare_tower_when_no_enemy_champion_is_near_it() {
    let mut runtime = dive_world(true, 2, false);

    assert!(!leaves_the_tower(&mut runtime), "the pair left a tower nobody defends");
}

#[test]
fn a_lone_pusher_does_not_dive_a_bare_tower() {
    let mut runtime = dive_world(true, 1, false);
    runtime.minions.push(test_minion("far", "red", "mid", Vec2 { x: 0.9, y: 0.9 }));

    assert!(leaves_the_tower(&mut runtime), "one champion stood under a tower alone");
}

#[test]
fn pushers_do_not_dive_a_tower_an_enemy_champion_stands_at() {
    let mut runtime = dive_world(true, 2, true);

    assert!(leaves_the_tower(&mut runtime), "the pair dived a tower with a defender at it");
}

#[test]
fn a_team_pushing_for_its_buff_keeps_out_of_a_bare_tower() {
    let mut runtime = dive_world(false, 2, false);

    assert!(leaves_the_tower(&mut runtime), "the buff holders dived without a wave");
}

/// The world of the ending: the red nexus is open (no nexus tower is left) and nothing else stands.
fn open_nexus_world(blue_alive: usize, red_alive: usize) -> RuntimeState {
    let mut runtime = world(blue_alive, red_alive);
    let mut nexus = test_structure("red-nexus", "red", "base", Vec2 { x: 0.85, y: 0.15 });
    nexus.kind = "nexus".to_string();
    nexus.hp = 5500.0;
    nexus.max_hp = 5500.0;
    runtime.structures = vec![nexus];
    runtime
}

#[test]
fn a_team_that_is_not_ahead_goes_for_the_enemy_nexus_when_it_is_open() {
    let mut runtime = open_nexus_world(5, 5);

    let plan = blue_plan(&mut runtime);

    assert!(plan.active && plan.ending, "five against five left an open nexus alone");
    assert_eq!(plan.target_id.as_deref(), Some("red-nexus"));
}

#[test]
fn a_team_one_champion_short_still_goes_for_the_open_nexus() {
    let mut runtime = open_nexus_world(4, 5);

    assert!(blue_plan(&mut runtime).ending, "four against five did not try the open nexus");
}

#[test]
fn a_team_outnumbered_by_two_does_not_go_for_the_open_nexus() {
    let mut runtime = open_nexus_world(3, 5);

    assert!(!blue_plan(&mut runtime).ending);
}

#[test]
fn the_nexus_is_not_the_plan_while_a_nexus_tower_stands() {
    let mut runtime = open_nexus_world(5, 5);
    runtime.structures.push(test_structure("red-nexus-top-tower", "red", "base", Vec2 { x: 0.82, y: 0.18 }));

    assert!(!blue_plan(&mut runtime).ending, "the team went for a nexus that cannot be hit");
}

#[test]
fn the_team_gathers_at_the_rally_point_before_it_goes_in() {
    let mut runtime = open_nexus_world(5, 5);
    team_push::update_team_pushes(&mut runtime);
    let order = team_push::orders(&runtime)[0].clone().expect("an order");

    let rally = order.rally.expect("the team goes to the rally point first");
    assert!(dist(rally, order.structure_pos) > 0.2, "the rally point is at the nexus");

    // Four of them are there: the team goes in.
    for champion in runtime.champions.iter_mut().take(4) {
        champion.pos = rally;
    }
    team_push::update_team_pushes(&mut runtime);
    let order = team_push::orders(&runtime)[0].clone().expect("an order");
    assert!(order.rally.is_none(), "the team stayed at the rally point with four there");
}
