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

/// A defender who will not trade with the enemy champion he picked used to back away and
/// do nothing else: five champions stood on their nexus tower for seven minutes with 195
/// enemy minions piled at it (seed 1120 of the real-lineups harness, 3 kills won against 23).
#[test]
fn a_defender_who_declines_a_trade_clears_the_wave_at_his_tower() {
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
    mid.state = "lane".to_string();
    let mut runtime = test_runtime(
        vec![mid, red_champion_at(Vec2 { x: tower.x + 0.05, y: tower.y + 0.03 })],
        vec![red_minion_at_the_tower()],
        vec![nexus_tower()],
        empty_neutral(),
    );
    let before = runtime.minions[0].hp;
    let enemy_pos = runtime.champions[1].pos;

    let now = runtime.time_sec;
    combat::decline_trade(&mut runtime, 0, enemy_pos, now);

    assert!(runtime.minions[0].hp < before, "the defender did not hit the wave");
}

#[test]
fn a_laner_who_declines_a_trade_away_from_his_base_backs_away() {
    let mut mid = test_champion("blue-MID", "blue", "MID", "mid", Vec2 { x: 0.5, y: 0.5 });
    mid.state = "lane".to_string();
    let enemy = red_champion_at(Vec2 { x: 0.52, y: 0.5 });
    let mut runtime = test_runtime(
        vec![mid, enemy],
        vec![test_minion("red-mid-1", "red", "mid", Vec2 { x: 0.51, y: 0.5 })],
        vec![nexus_tower()],
        empty_neutral(),
    );
    let before = runtime.minions[0].hp;
    let enemy_pos = runtime.champions[1].pos;

    let now = runtime.time_sec;
    combat::decline_trade(&mut runtime, 0, enemy_pos, now);

    assert_eq!(runtime.minions[0].hp, before, "a laner far from his base hit a minion instead of backing away");
}

/// A match was lost by a team with 34 kills to 3: both its nexus towers were down, four enemy
/// champions hit the nexus, and its champions stood 0.2 from it because only nexus towers
/// called the team home.
#[test]
fn the_team_defends_the_nexus_when_both_nexus_towers_are_down() {
    let mut nexus = test_structure("blue-nexus", "blue", "base", tower_pos());
    nexus.kind = "nexus".to_string();
    let mut champions = blue_team();
    champions.push(red_champion_at(tower_pos()));
    let snapshot = champions.clone();

    let defenders = (0..5)
        .filter(|&idx| {
            let mut champion = champions[idx].clone();
            macro_ai::decide_champion_state(
                &mut champion,
                LANE_COMBAT_UNLOCK_AT + 600.0,
                &[],
                std::slice::from_ref(&nexus),
                &snapshot,
                Some(&empty_neutral()),
                &RuntimeTeamTactics::default(),
                &RuntimeTeamBuffState::default(),
            );
            champion.state == "recall"
                || (champion.state == "objective"
                    && champion
                        .target_path
                        .last()
                        .is_some_and(|target| dist(*target, tower_pos()) < 0.01))
        })
        .count();

    assert_eq!(defenders, 5, "the team stood by while an enemy champion hit its nexus");
}

/// Seed 1120 of the 95 vs 40 harness: five blue champions at their nexus, one wounded red
/// champion hitting it, and the blue top laner declined the trade because the intruder stood
/// beyond his lane's chase leash; the nexus fell with 23 kills to 2 for the team that lost it.
fn nexus_siege(attacker_role: &str) -> RuntimeState {
    let tower = tower_pos();
    let mut defender = test_champion(
        "blue-TOP",
        "blue",
        attacker_role,
        "top",
        Vec2 { x: tower.x + 0.02, y: tower.y + 0.02 },
    );
    defender.state = "lane".to_string();
    let mut intruder = red_champion_at(Vec2 { x: tower.x + 0.04, y: tower.y + 0.03 });
    intruder.hp = intruder.max_hp * 0.46;
    // A second defender: they fight where they outnumber the intruder.
    let mut partner = test_champion(
        "blue-MID",
        "blue",
        "MID",
        "mid",
        Vec2 { x: tower.x + 0.025, y: tower.y + 0.03 },
    );
    partner.state = "lane".to_string();
    test_runtime(vec![defender, intruder, partner], vec![], vec![nexus_tower()], empty_neutral())
}

#[test]
fn a_champion_picks_the_enemy_champion_hitting_his_nexus_over_a_minion() {
    let mut runtime = nexus_siege("TOP");
    runtime.minions.push(red_minion_at_the_tower());

    let target = pick_combat_target(&runtime, 0, runtime.time_sec, &empty_neutral());

    assert!(matches!(target, Some(CombatTarget::Champion(1))), "the defender looked away from the intruder");
}

#[test]
fn a_wounded_champion_does_not_go_for_the_intruder() {
    let mut runtime = nexus_siege("TOP");
    runtime.champions[0].hp = runtime.champions[0].max_hp * 0.2;

    assert_eq!(combat::base_intruder_idx(&runtime, 0), None);
}

#[test]
fn a_defender_hits_the_intruder_instead_of_backing_off_the_laning_rules() {
    let mut runtime = nexus_siege("TOP");
    // Far from the lane he would defend, the intruder is past the chase leash.
    let before = runtime.champions[1].hp;

    resolve_champion_combat(&mut runtime);

    assert!(runtime.champions[1].hp < before, "the defender declined to fight at his own nexus");
}

/// A group destroying the nexus is not fought by the champions who come back one at a time
/// from the fountain: with the intruders as many as the defenders, or more, nobody goes.
#[test]
fn a_defender_does_not_go_for_an_intruder_who_has_as_many_champions_as_his_side() {
    let mut runtime = nexus_siege("TOP");
    // The partner is gone: one defender, one intruder.
    runtime.champions.pop();

    assert_eq!(combat::base_intruder_idx(&runtime, 0), None);
}

#[test]
fn defenders_who_outnumber_the_intruders_go_for_them() {
    let runtime = nexus_siege("TOP");

    assert_eq!(combat::base_intruder_idx(&runtime, 0), Some(1));
}
