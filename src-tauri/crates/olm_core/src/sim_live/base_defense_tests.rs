//! Defending the base against a wave takes a few champions, not the whole team,
//! and the defenders clear the wave whatever lane it comes from.

use super::combat::pick_combat_target;
use super::test_helpers::{
    empty_neutral, test_champion, test_minion, test_runtime, test_structure,
};
use super::*;

const ROLES: [&str; 5] = ["JGL", "TOP", "MID", "ADC", "SUP"];

fn tower_pos() -> Vec2 {
    let base = base_position_for("blue");
    Vec2 {
        x: base.x + 0.04,
        y: base.y - 0.04,
    }
}

/// Blue champions spread along a line away from the blue nexus tower, the
/// first one closest to it.
fn blue_team() -> Vec<ChampionRuntime> {
    let tower = tower_pos();
    ROLES
        .iter()
        .enumerate()
        .map(|(i, role)| {
            let mut champion = test_champion(
                &format!("blue-{role}"),
                "blue",
                role,
                match *role {
                    "TOP" => "top",
                    "MID" => "mid",
                    "JGL" => "jungle",
                    _ => "bot",
                },
                Vec2 {
                    x: tower.x + 0.08 * (i + 1) as f64,
                    y: tower.y - 0.05 * (i + 1) as f64,
                },
            );
            champion.hp = champion.max_hp;
            champion
        })
        .collect()
}

fn red_champion_at(pos: Vec2) -> ChampionRuntime {
    test_champion("red-TOP", "red", "TOP", "top", pos)
}

fn nexus_tower() -> StructureRuntime {
    test_structure("blue-nexus-top-tower", "blue", "base", tower_pos())
}

fn red_minion_at_the_tower() -> MinionRuntime {
    let mut minion = test_minion("red-top-1", "red", "top", tower_pos());
    minion.pos = Vec2 {
        x: tower_pos().x + 0.03,
        y: tower_pos().y,
    };
    minion
}

fn defends(champions: &[ChampionRuntime], idx: usize, minions: &[MinionRuntime]) -> bool {
    let snapshot = champions.to_vec();
    let mut champion = champions[idx].clone();
    macro_ai::decide_champion_state(
        &mut champion,
        LANE_COMBAT_UNLOCK_AT + 600.0,
        minions,
        &[nexus_tower()],
        &snapshot,
        Some(&empty_neutral()),
        &RuntimeTeamTactics::default(),
        &RuntimeTeamBuffState::default(),
    );
    // A defender walks to the tower, or recalls when he is too far to walk.
    champion.state == "recall"
        || (champion.state == "objective"
            && champion
                .target_path
                .last()
                .is_some_and(|target| dist(*target, tower_pos()) < 0.01))
}

#[test]
fn two_champions_defend_the_base_against_a_wave_with_no_enemy_champion() {
    let mut champions = blue_team();
    champions.push(red_champion_at(Vec2 { x: 0.9, y: 0.1 }));
    let minions = [red_minion_at_the_tower()];

    let defenders: Vec<&str> = (0..5)
        .filter(|&idx| defends(&champions, idx, &minions))
        .map(|idx| champions[idx].role.as_str())
        .collect();

    assert_eq!(defenders, ["JGL", "TOP"], "the two nearest champions defend");
}

#[test]
fn the_whole_team_defends_when_an_enemy_champion_is_at_the_tower() {
    let mut champions = blue_team();
    champions.push(red_champion_at(tower_pos()));

    let defenders = (0..5)
        .filter(|&idx| defends(&champions, idx, &[]))
        .count();

    assert_eq!(defenders, 5);
}

#[test]
fn a_dead_champion_does_not_take_a_defender_slot() {
    let mut champions = blue_team();
    champions[0].alive = false;
    champions.push(red_champion_at(Vec2 { x: 0.9, y: 0.1 }));
    let minions = [red_minion_at_the_tower()];

    let defenders: Vec<&str> = (0..5)
        .filter(|&idx| champions[idx].alive && defends(&champions, idx, &minions))
        .map(|idx| champions[idx].role.as_str())
        .collect();

    assert_eq!(defenders, ["TOP", "MID"]);
}

#[test]
fn a_defender_clears_a_wave_from_another_lane() {
    let tower = tower_pos();
    let mut mid = test_champion(
        "blue-MID",
        "blue",
        "MID",
        "mid",
        Vec2 {
            x: tower.x + 0.03,
            y: tower.y + 0.03,
        },
    );
    mid.state = "objective".to_string();
    let runtime = test_runtime(
        vec![mid, red_champion_at(Vec2 { x: 0.9, y: 0.1 })],
        vec![red_minion_at_the_tower()],
        vec![nexus_tower()],
        empty_neutral(),
    );

    let target = pick_combat_target(&runtime, 0, runtime.time_sec, &empty_neutral());

    assert!(
        matches!(target, Some(CombatTarget::Minion(0))),
        "a mid champion ignored a top lane minion at his own nexus tower"
    );
}

#[test]
fn a_laner_far_from_the_base_does_not_chase_a_wave_there() {
    let mut mid = test_champion("blue-MID", "blue", "MID", "mid", Vec2 { x: 0.5, y: 0.5 });
    mid.state = "lane".to_string();
    let runtime = test_runtime(
        vec![mid, red_champion_at(Vec2 { x: 0.9, y: 0.1 })],
        vec![red_minion_at_the_tower()],
        vec![nexus_tower()],
        empty_neutral(),
    );

    let target = pick_combat_target(&runtime, 0, runtime.time_sec, &empty_neutral());

    assert!(!matches!(target, Some(CombatTarget::Minion(_))));
}

#[test]
fn a_defender_does_not_turn_to_the_wave_while_an_enemy_champion_is_in_reach() {
    let tower = tower_pos();
    let mut mid = test_champion(
        "blue-MID",
        "blue",
        "MID",
        "mid",
        Vec2 {
            x: tower.x + 0.03,
            y: tower.y + 0.03,
        },
    );
    mid.state = "objective".to_string();
    let enemy = red_champion_at(Vec2 {
        x: tower.x + 0.06,
        y: tower.y + 0.03,
    });
    let runtime = test_runtime(
        vec![mid, enemy],
        vec![red_minion_at_the_tower()],
        vec![nexus_tower()],
        empty_neutral(),
    );

    let target = pick_combat_target(&runtime, 0, runtime.time_sec, &empty_neutral());

    assert!(!matches!(target, Some(CombatTarget::Minion(0))));
}
