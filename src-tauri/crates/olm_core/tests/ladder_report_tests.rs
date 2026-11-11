//! Promotion and relegation reporting: the season summary, inbox and news are built from
//! the movements in the ladder ledger. Movements are pushed directly so the reporting is
//! exercised independently of the swap itself.

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
use olm_core::ladder::{LadderMovement, LadderMovementStatus};
use olm_core::ladder_report::{UserLadderResult, announce_ladder_movements};
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

fn movement(
    lower: &str,
    upper: &str,
    promoted: &[&str],
    relegated: &[&str],
    status: LadderMovementStatus,
) -> LadderMovement {
    LadderMovement {
        link_lower: lower.to_string(),
        link_upper: upper.to_string(),
        season: 2025,
        promoted: promoted.iter().map(|s| s.to_string()).collect(),
        relegated: relegated.iter().map(|s| s.to_string()).collect(),
        status,
    }
}

/// A finished game whose ledger already holds `movements` for season 2025.
fn game_with(movements: Vec<LadderMovement>) -> Game {
    let mut game = finished_game(1);
    game.ladder.movements = movements;
    game
}

fn ladder_messages(game: &Game) -> Vec<&str> {
    game.messages
        .iter()
        .filter(|m| m.id.starts_with("ladder_"))
        .map(|m| m.id.as_str())
        .collect()
}

fn ladder_news(game: &Game) -> usize {
    game.news
        .iter()
        .filter(|n| n.id.starts_with("ladder_news_"))
        .count()
}

#[test]
fn an_ai_only_swap_is_listed_in_the_summary_with_names_and_no_user_result() {
    let mut game = game_with(vec![movement(
        "reg",
        "other",
        &["reg1"],
        &["reg4"],
        LadderMovementStatus::Applied,
    )]);

    let summary = advance_season(&mut game).summary;

    assert_eq!(summary.ladder_movements.len(), 1);
    let report = &summary.ladder_movements[0];
    assert_eq!(report.lower_competition_name, "REG");
    assert_eq!(report.promoted[0].name, "reg1");
    assert_eq!(report.relegated[0].id, "reg4");
    assert_eq!(summary.user_ladder, None);
}

#[test]
fn an_ai_only_swap_creates_news_but_no_inbox_message() {
    let mut game = game_with(vec![movement(
        "reg",
        "other",
        &["reg1"],
        &["reg4"],
        LadderMovementStatus::Applied,
    )]);

    advance_season(&mut game);

    assert_eq!((ladder_news(&game), ladder_messages(&game).len()), (1, 0));
}

#[test]
fn a_promoted_user_gets_the_result_and_a_board_message() {
    let mut game = game_with(vec![movement(
        "lec",
        "top",
        &["lec1"],
        &["top9"],
        LadderMovementStatus::Applied,
    )]);

    let summary = advance_season(&mut game).summary;

    let user = summary.user_ladder.expect("user result");
    assert_eq!(
        (
            user.result,
            user.from_competition_id,
            user.to_competition_id
        ),
        (
            UserLadderResult::Promoted,
            "lec".to_string(),
            "top".to_string()
        )
    );
    assert_eq!(
        ladder_messages(&game),
        ["ladder_user_promoted_lec_top_2025"]
    );
}

#[test]
fn a_relegated_user_gets_the_result_and_a_board_message() {
    let mut game = game_with(vec![movement(
        "low",
        "lec",
        &["low1"],
        &["lec1"],
        LadderMovementStatus::Applied,
    )]);

    let summary = advance_season(&mut game).summary;

    let user = summary.user_ladder.expect("user result");
    assert_eq!(
        (
            user.result,
            user.from_competition_id,
            user.to_competition_id
        ),
        (
            UserLadderResult::Relegated,
            "lec".to_string(),
            "low".to_string()
        )
    );
    assert_eq!(
        ladder_messages(&game),
        ["ladder_user_relegated_low_lec_2025"]
    );
}

#[test]
fn a_user_who_stays_in_a_swapping_league_gets_the_league_note() {
    let mut game = game_with(vec![movement(
        "reg",
        "lec",
        &["reg1"],
        &["lec4"],
        LadderMovementStatus::Applied,
    )]);

    let summary = advance_season(&mut game).summary;

    assert_eq!(
        summary.user_ladder.map(|u| u.result),
        Some(UserLadderResult::Stayed)
    );
    assert_eq!(ladder_messages(&game), ["ladder_swap_reg_lec_2025"]);
}

#[test]
fn skipped_and_unfilled_movements_report_their_status_but_announce_nothing() {
    let mut game = game_with(vec![
        movement("reg", "lec", &[], &[], LadderMovementStatus::SkippedLate),
        movement("low", "lec", &[], &[], LadderMovementStatus::NoEligible),
    ]);

    let summary = advance_season(&mut game).summary;

    assert_eq!(
        (
            summary.ladder_movements.len(),
            summary.user_ladder,
            ladder_news(&game),
            ladder_messages(&game).len()
        ),
        (2, None, 0, 0)
    );
}

#[test]
fn a_movement_of_another_season_is_not_in_the_summary() {
    let mut old = movement(
        "reg",
        "lec",
        &["reg1"],
        &["lec4"],
        LadderMovementStatus::Applied,
    );
    old.season = 2024;
    let mut game = game_with(vec![old]);

    let summary = advance_season(&mut game).summary;

    assert!(summary.ladder_movements.is_empty());
}

#[test]
fn announcing_twice_creates_each_message_and_article_once() {
    let mut game = game_with(vec![movement(
        "lec",
        "top",
        &["lec1"],
        &["top9"],
        LadderMovementStatus::Applied,
    )]);
    advance_season(&mut game);

    announce_ladder_movements(&mut game);
    announce_ladder_movements(&mut game);

    assert_eq!((ladder_news(&game), ladder_messages(&game).len()), (1, 1));
}

#[test]
fn a_movement_announced_by_the_turn_is_not_repeated_by_the_rollover() {
    let mut game = game_with(vec![movement(
        "lec",
        "top",
        &["lec1"],
        &["top9"],
        LadderMovementStatus::Applied,
    )]);
    announce_ladder_movements(&mut game);

    advance_season(&mut game);

    // The season rollover clears last season's news, so only the inbox message remains.
    assert_eq!(ladder_messages(&game).len(), 1);
}
