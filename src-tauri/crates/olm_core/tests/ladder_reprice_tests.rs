//! Clubs that change league are repriced toward the median club of the new league.
//! `reg` (tier 2) feeds `lec` (tier 1); the `lec` clubs are rich, the `reg` ones are not.

mod common;

use common::*;
use olm_core::domain::team::{Sponsorship, Team};
use olm_core::game::Game;
use olm_core::ladder_reprice::reprice_moved_clubs;
use olm_core::season_rollover::advance_season;

#[derive(Debug, Clone, PartialEq, Eq)]
struct Economy {
    reputation: u32,
    finance: i64,
    wage_budget: i64,
    transfer_budget: i64,
}

fn economy(game: &Game, team_id: &str) -> Economy {
    let team = game.teams.iter().find(|t| t.id == team_id).expect("team");
    Economy {
        reputation: team.reputation,
        finance: team.finance,
        wage_budget: team.wage_budget,
        transfer_budget: team.transfer_budget,
    }
}

fn set_economy(team: &mut Team, reputation: u32, finance: i64, wage: i64, transfer: i64) {
    team.reputation = reputation;
    team.finance = finance;
    team.wage_budget = wage;
    team.transfer_budget = transfer;
}

/// `lec`: reputation 1000, 10M cash, 5M wages, 2M transfers. `reg`: 300, 2M, 1M, 400k.
fn rich_and_poor(user: &str) -> Game {
    let mut game = plain_game(user);
    for team in &mut game.teams {
        if team.competition_id.as_deref() == Some("lec") {
            set_economy(team, 1_000, 10_000_000, 5_000_000, 2_000_000);
        } else {
            set_economy(team, 300, 2_000_000, 1_000_000, 400_000);
        }
    }
    game
}

fn ids(list: &[&str]) -> Vec<String> {
    list.iter().map(|id| (*id).to_string()).collect()
}

/// The state right after a swap that moved `reg1` up and `lec4` down.
fn after_swap(user: &str) -> Game {
    let mut game = rich_and_poor(user);
    for team in &mut game.teams {
        match team.id.as_str() {
            "reg1" => team.competition_id = Some("lec".to_string()),
            "lec4" => team.competition_id = Some("reg".to_string()),
            _ => {}
        }
    }
    game
}

fn reprice(game: &mut Game) {
    reprice_moved_clubs(game, &ids(&["reg1"]), &ids(&["lec4"]), "reg", "lec");
}

const UNMOVED: [&str; 6] = ["lec1", "lec2", "lec3", "reg2", "reg3", "reg4"];

#[test]
fn a_promoted_club_steps_toward_the_upper_league_median() {
    let mut game = after_swap("lec1");
    reprice(&mut game);

    assert_eq!(
        economy(&game, "reg1"),
        Economy {
            reputation: 650,
            finance: 6_000_000,
            wage_budget: 3_000_000,
            transfer_budget: 1_200_000,
        }
    );
}

#[test]
fn a_relegated_club_steps_toward_the_lower_league_median_and_keeps_its_cash() {
    let mut game = after_swap("lec1");
    reprice(&mut game);

    assert_eq!(
        economy(&game, "lec4"),
        Economy {
            reputation: 650,
            finance: 10_000_000,
            wage_budget: 3_000_000,
            transfer_budget: 1_200_000,
        }
    );
}

#[test]
fn the_treasury_top_up_is_a_ledger_entry_outside_the_season_totals() {
    let mut game = after_swap("lec1");
    reprice(&mut game);

    let promoted = game.teams.iter().find(|t| t.id == "reg1").expect("team");
    let entry = promoted.financial_ledger.last().expect("ledger entry");
    assert_eq!(
        (entry.source.as_str(), entry.amount, promoted.season_income),
        ("ladder", 4_000_000, 0)
    );
}

#[test]
fn clubs_that_did_not_move_are_unchanged() {
    let mut game = after_swap("lec1");
    let before: Vec<_> = UNMOVED.iter().map(|id| economy(&game, id)).collect();
    reprice(&mut game);

    let after: Vec<_> = UNMOVED.iter().map(|id| economy(&game, id)).collect();
    assert_eq!(before, after);
}

#[test]
fn a_promoted_club_already_above_the_median_is_not_lowered() {
    let mut game = after_swap("lec1");
    for team in &mut game.teams {
        if team.id == "reg1" {
            set_economy(team, 2_000, 50_000_000, 9_000_000, 4_000_000);
        }
    }
    let before = economy(&game, "reg1");
    reprice(&mut game);

    assert_eq!(economy(&game, "reg1"), before);
}

#[test]
fn a_relegated_club_already_below_the_median_is_not_raised() {
    let mut game = after_swap("lec1");
    for team in &mut game.teams {
        if team.id == "lec4" {
            set_economy(team, 100, 500_000, 200_000, 50_000);
        }
    }
    let before = economy(&game, "lec4");
    reprice(&mut game);

    assert_eq!(economy(&game, "lec4"), before);
}

#[test]
fn a_relegated_club_loses_a_fifth_of_its_sponsorship() {
    let mut game = after_swap("lec1");
    for team in &mut game.teams {
        if team.id == "lec4" {
            team.sponsorship = Some(Sponsorship {
                sponsor_name: "Acme".to_string(),
                base_value: 1_000_000,
                remaining_months: 12,
                bonus_criteria: vec![],
            });
        }
    }
    reprice(&mut game);

    let relegated = game.teams.iter().find(|t| t.id == "lec4").expect("team");
    assert_eq!(
        relegated.sponsorship.as_ref().map(|s| s.base_value),
        Some(800_000)
    );
}

#[test]
fn a_destination_league_without_peers_leaves_the_club_unchanged() {
    let mut game = after_swap("lec1");
    game.teams
        .retain(|t| !matches!(t.id.as_str(), "lec1" | "lec2" | "lec3"));
    let before = economy(&game, "reg1");
    reprice(&mut game);

    assert_eq!(economy(&game, "reg1"), before);
}

#[test]
fn a_promoted_user_gets_a_happier_board() {
    let mut game = after_swap("reg1");
    game.manager.satisfaction = 50;
    reprice(&mut game);

    assert_eq!(game.manager.satisfaction, 60);
}

#[test]
fn a_relegated_user_gets_an_unhappier_board() {
    let mut game = after_swap("lec4");
    game.manager.satisfaction = 50;
    reprice(&mut game);

    assert_eq!(game.manager.satisfaction, 35);
}

#[test]
fn board_satisfaction_stays_inside_zero_to_one_hundred() {
    let mut up = after_swap("reg1");
    up.manager.satisfaction = 95;
    reprice(&mut up);
    let mut down = after_swap("lec4");
    down.manager.satisfaction = 5;
    reprice(&mut down);

    assert_eq!(
        (up.manager.satisfaction, down.manager.satisfaction),
        (100, 0)
    );
}

#[test]
fn a_user_who_did_not_move_keeps_their_satisfaction() {
    let mut game = after_swap("lec1");
    game.manager.satisfaction = 50;
    reprice(&mut game);

    assert_eq!(game.manager.satisfaction, 50);
}

#[test]
fn the_season_wrap_reprices_the_moved_clubs() {
    // The user is in a third league, so only the swap touches the two clubs.
    let mut game = rich_and_poor("lec1");
    game.teams.push(team("xyz1", "xyz"));
    game.teams.push(team("xyz2", "xyz"));
    game.leagues
        .push(finished_league("xyz", 1, &["xyz1", "xyz2"]));
    game.competition_configs
        .insert("xyz".to_string(), manifest("xyz", 1, None));
    game.manager.team_id = Some("xyz1".to_string());
    game.user_competition_id = Some("xyz".to_string());
    advance_season(&mut game);

    assert_eq!(
        (
            economy(&game, "reg1").reputation,
            economy(&game, "lec4").reputation
        ),
        (650, 650)
    );
}
