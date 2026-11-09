//! The ladder ledger is written by the real rollover paths: a user split end, a user
//! season wrap and a background league roll each record exactly once.

use chrono::{TimeZone, Utc};
use olm_core::clock::GameClock;
use olm_core::domain::league::{
    Fixture, FixtureStatus, League, LeagueKind, MatchResult, MatchType, StandingEntry,
};
use olm_core::domain::manager::Manager;
use olm_core::domain::player::{Player, PlayerAttributes};
use olm_core::domain::stats::LolRole;
use olm_core::domain::team::Team;
use olm_core::game::Game;
use olm_core::generator::definitions::{
    CompetitionManifest, ScheduleConfig, SeasonStart, SplitConfig,
};
use olm_core::season_rollover::advance_season;
use std::collections::HashMap;

fn squad(team_id: &str) -> Vec<Player> {
    [
        ("top", LolRole::Top),
        ("jungle", LolRole::Jungle),
        ("mid", LolRole::Mid),
        ("adc", LolRole::Adc),
        ("sup", LolRole::Support),
    ]
    .into_iter()
    .map(|(tag, role)| {
        let id = format!("{team_id}_{tag}");
        let attrs = PlayerAttributes {
            mental_resilience: 60,
            champion_pool: 60,
            laning: 60,
            mechanics: 60,
            macro_play: 60,
            consistency: 60,
            discipline: 60,
            teamfighting: 60,
            shotcalling: 60,
        };
        let mut p = Player::new(
            id.clone(),
            id.clone(),
            id,
            "1995-01-01".to_string(),
            "England".to_string(),
            role,
            attrs,
        );
        p.team_id = Some(team_id.to_string());
        p
    })
    .collect()
}

fn team(id: &str) -> Team {
    Team::new(
        id.to_string(),
        id.to_string(),
        id[..3].to_string(),
        "England".to_string(),
        "London".to_string(),
        "Stadium".to_string(),
        40_000,
    )
}

/// Fully played single round robin; the home side of every fixture wins.
fn finished_league(id: &str, team_ids: &[String], split_index: usize) -> League {
    let mut fixtures = Vec::new();
    let mut standings: Vec<StandingEntry> = team_ids
        .iter()
        .map(|t| StandingEntry::new(t.clone()))
        .collect();
    for (i, home) in team_ids.iter().enumerate() {
        for away in &team_ids[i + 1..] {
            fixtures.push(Fixture {
                id: format!("{id}-{home}-{away}"),
                matchday: fixtures.len() as u32 + 1,
                date: "2025-06-01".to_string(),
                home_team_id: home.clone(),
                away_team_id: away.clone(),
                match_type: MatchType::League,
                best_of: 1,
                status: FixtureStatus::Completed,
                result: Some(MatchResult {
                    home_wins: 1,
                    away_wins: 0,
                    ..MatchResult::default()
                }),
            });
            for s in &mut standings {
                if s.team_id == *home {
                    s.record_result(1, 0);
                } else if s.team_id == *away {
                    s.record_result(0, 1);
                }
            }
        }
    }
    League {
        id: id.to_string(),
        name: id.to_uppercase(),
        season: 2025,
        split_index,
        fixtures,
        standings,
        competition_id: Some(id.to_string()),
        league_kind: LeagueKind::Main,
        ..Default::default()
    }
}

fn manifest(id: &str) -> CompetitionManifest {
    CompetitionManifest {
        id: id.to_string(),
        name: id.to_uppercase(),
        full_name: None,
        region: "EU".to_string(),
        country: None,
        tier: None,
        logo: None,
        schedule: ScheduleConfig {
            format: "single_round_robin".to_string(),
            team_count: 0,
            splits: ["Spring", "Summer"]
                .into_iter()
                .map(|name| SplitConfig {
                    name: name.to_string(),
                    season_start: SeasonStart { month: 8, day: 1 },
                    superweek_offsets: vec![],
                    best_of: 1,
                    playoffs: None,
                })
                .collect(),
            preseason_friendlies: 0,
        },
        teams_file: "teams.json".to_string(),
        players_file: "players.json".to_string(),
        staff_file: None,
        championships_file: None,
        erls: vec![],
        reputation: None,
        nearby_country_codes: vec![],
        promotion: None,
        legacy: false,
        active: true,
    }
}

/// Two finished leagues, `lec` (the user's) and `reg` (background), on `split_index`.
fn finished_game(split_index: usize) -> Game {
    let lec: Vec<String> = (1..=4).map(|i| format!("lec{i}")).collect();
    let reg: Vec<String> = (1..=4).map(|i| format!("reg{i}")).collect();
    let all: Vec<&String> = lec.iter().chain(reg.iter()).collect();
    let mut manager = Manager::new(
        "mgr1".to_string(),
        "Test".to_string(),
        "Manager".to_string(),
        "1980-01-01".to_string(),
        "England".to_string(),
    );
    manager.hire(lec[0].clone());
    let mut game = Game::new(
        GameClock::new(Utc.with_ymd_and_hms(2025, 6, 15, 12, 0, 0).unwrap()),
        manager,
        all.iter().map(|t| team(t)).collect(),
        all.iter().flat_map(|t| squad(t)).collect(),
        vec![],
        vec![],
    );
    game.leagues = vec![
        finished_league("lec", &lec, split_index),
        finished_league("reg", &reg, split_index),
    ];
    game.user_competition_id = Some("lec".to_string());
    game.competition_configs = ["lec", "reg"]
        .into_iter()
        .map(|id| (id.to_string(), manifest(id)))
        .collect::<HashMap<_, _>>();
    game
}

#[test]
fn a_user_split_end_adds_to_the_tally_of_the_users_league_only() {
    let mut game = finished_game(0);
    advance_season(&mut game);
    assert_eq!(
        game.ladder
            .tallies
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        vec!["lec", "reg"]
    );
}

#[test]
fn a_user_split_end_writes_no_outcome() {
    let mut game = finished_game(0);
    advance_season(&mut game);
    assert!(game.ladder.outcomes.is_empty());
}

#[test]
fn a_user_season_wrap_writes_exactly_one_outcome_for_the_users_league() {
    let mut game = finished_game(1);
    advance_season(&mut game);
    let lec: Vec<_> = game
        .ladder
        .outcomes
        .iter()
        .filter(|o| o.competition_id == "lec")
        .collect();
    assert_eq!(lec.len(), 1);
}

#[test]
fn a_background_season_roll_writes_exactly_one_outcome() {
    let mut game = finished_game(1);
    advance_season(&mut game);
    let reg: Vec<_> = game
        .ladder
        .outcomes
        .iter()
        .filter(|o| o.competition_id == "reg")
        .collect();
    assert_eq!(reg.len(), 1);
}

#[test]
fn a_season_wrap_clears_the_tallies() {
    let mut game = finished_game(1);
    advance_season(&mut game);
    assert!(game.ladder.tallies.is_empty());
}

#[test]
fn the_outcome_names_the_table_leader_and_orders_every_team() {
    let mut game = finished_game(1);
    advance_season(&mut game);
    let outcome = game.ladder.outcome("reg", 2025).expect("outcome");
    assert_eq!(
        (outcome.champion_id.as_deref(), outcome.final_order.len()),
        (Some("reg1"), 4)
    );
}

#[test]
fn a_full_season_of_two_splits_sums_both_splits_into_the_outcome() {
    let mut game = finished_game(0);
    advance_season(&mut game);
    // Replay the finished split on the regenerated leagues, then wrap the season.
    let lec: Vec<String> = (1..=4).map(|i| format!("lec{i}")).collect();
    let reg: Vec<String> = (1..=4).map(|i| format!("reg{i}")).collect();
    game.leagues = vec![
        finished_league("lec", &lec, 1),
        finished_league("reg", &reg, 1),
    ];
    advance_season(&mut game);
    let outcome = game.ladder.outcome("lec", 2025).expect("outcome");
    // lec1 wins all three games in each of the two splits: 2 x 9 points.
    assert_eq!(outcome.season_table[0].points, 18);
}
