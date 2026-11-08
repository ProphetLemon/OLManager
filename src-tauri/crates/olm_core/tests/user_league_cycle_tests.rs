//! Playoff scheduling and split cycling must follow the user's league, wherever
//! it sits in `game.leagues`, instead of assuming it is the first (LEC) league.

use chrono::{TimeZone, Utc};
use olm_core::clock::GameClock;
use olm_core::domain::league::{
    Fixture, FixtureStatus, League, LeagueKind, MatchResult, MatchType, StandingEntry,
};
use olm_core::domain::manager::Manager;
use olm_core::domain::player::{Player, PlayerAttributes};
use olm_core::domain::stats::LolRole;
use olm_core::domain::team::Team;
use olm_core::end_of_season::{process_background_seasons, process_end_of_split};
use olm_core::game::Game;
use olm_core::generator::definitions::{
    CompetitionManifest, PlayoffConfig, ScheduleConfig, SeasonStart, SplitConfig,
};
use olm_core::turn;
use std::collections::HashMap;

const TODAY: &str = "2025-06-15";

fn attrs() -> PlayerAttributes {
    PlayerAttributes {
        mental_resilience: 60,
        champion_pool: 60,
        laning: 60,
        mechanics: 60,
        macro_play: 60,
        consistency: 60,
        discipline: 60,
        teamfighting: 60,
        shotcalling: 60,
    }
}

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
        let mut p = Player::new(
            id.clone(),
            id.clone(),
            id,
            "1995-01-01".to_string(),
            "England".to_string(),
            role,
            attrs(),
        );
        p.team_id = Some(team_id.to_string());
        p.morale = 70;
        p.condition = 100;
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

fn names(prefix: &str, count: usize) -> Vec<String> {
    (1..=count).map(|i| format!("{prefix}{i}")).collect()
}

fn completed_fixture(id: String, home: &str, away: &str, matchday: u32) -> Fixture {
    Fixture {
        id,
        matchday,
        date: "2025-06-01".to_string(),
        home_team_id: home.to_string(),
        away_team_id: away.to_string(),
        match_type: MatchType::League,
        best_of: 1,
        status: FixtureStatus::Completed,
        result: Some(MatchResult {
            home_wins: 1,
            away_wins: 0,
            ..MatchResult::default()
        }),
    }
}

/// Single round robin where every fixture is completed (home side wins) except
/// the last one, which is scheduled on `TODAY` so that `process_day` plays it.
fn league(id: &str, team_ids: &[String], split_index: usize) -> League {
    let mut fixtures = Vec::new();
    let mut standings: Vec<StandingEntry> = team_ids
        .iter()
        .map(|t| StandingEntry::new(t.clone()))
        .collect();
    for (i, home) in team_ids.iter().enumerate() {
        for away in &team_ids[i + 1..] {
            let matchday = fixtures.len() as u32 + 1;
            fixtures.push(completed_fixture(
                format!("{id}-{home}-{away}"),
                home,
                away,
                matchday,
            ));
            for s in &mut standings {
                if s.team_id == *home {
                    s.record_result(1, 0);
                } else if s.team_id == *away {
                    s.record_result(0, 1);
                }
            }
        }
    }
    // Leave the final fixture unplayed: it is the one played on the test day.
    let last = fixtures.last_mut().expect("league has fixtures");
    last.date = TODAY.to_string();
    last.status = FixtureStatus::Scheduled;
    last.result = None;
    let (home, away) = (last.home_team_id.clone(), last.away_team_id.clone());
    for s in &mut standings {
        if s.team_id == home {
            s.won -= 1;
            s.played -= 1;
            s.points -= 3;
            s.maps_won -= 1;
        } else if s.team_id == away {
            s.lost -= 1;
            s.played -= 1;
            s.maps_lost -= 1;
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

fn manifest(id: &str, split_names: &[&str], playoff_teams: Option<u32>) -> CompetitionManifest {
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
            splits: split_names
                .iter()
                .map(|name| SplitConfig {
                    name: name.to_string(),
                    season_start: SeasonStart { month: 8, day: 1 },
                    superweek_offsets: vec![],
                    best_of: 1,
                    playoffs: playoff_teams.map(|teams| PlayoffConfig {
                        format: "single_elimination".to_string(),
                        teams,
                    }),
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
        legacy: false,
        active: true,
    }
}

/// Two-league game: `lec` (first, `lec_teams`) and `reg` (second, `reg_teams`),
/// with the manager employed by the first team of `user_league`.
fn two_league_game(lec_teams: usize, reg_teams: usize, user_league: &str) -> Game {
    let lec_ids = names("lec", lec_teams);
    let reg_ids = names("reg", reg_teams);
    let user_team = if user_league == "lec" {
        lec_ids[0].clone()
    } else {
        reg_ids[0].clone()
    };
    let all: Vec<&String> = lec_ids.iter().chain(reg_ids.iter()).collect();
    let teams: Vec<Team> = all.iter().map(|t| team(t)).collect();
    let players: Vec<Player> = all.iter().flat_map(|t| squad(t)).collect();
    let date = Utc.with_ymd_and_hms(2025, 6, 15, 12, 0, 0).unwrap();
    let mut manager = Manager::new(
        "mgr1".to_string(),
        "Test".to_string(),
        "Manager".to_string(),
        "1980-01-01".to_string(),
        "England".to_string(),
    );
    manager.hire(user_team);
    let mut game = Game::new(
        GameClock::new(date),
        manager,
        teams,
        players,
        vec![],
        vec![],
    );
    game.leagues = vec![league("lec", &lec_ids, 0), league("reg", &reg_ids, 0)];
    game.user_competition_id = Some(user_league.to_string());
    game
}

fn playoff_count(league: &League) -> usize {
    league
        .fixtures
        .iter()
        .filter(|f| f.match_type == MatchType::Playoffs)
        .count()
}

fn league_by_id<'a>(game: &'a Game, id: &str) -> &'a League {
    game.leagues
        .iter()
        .find(|l| l.id == id)
        .expect("league should exist")
}

#[test]
fn playoffs_are_scheduled_for_the_users_league_when_it_is_not_first() {
    let mut game = two_league_game(6, 6, "reg");
    turn::process_day(&mut game);
    assert_eq!(playoff_count(league_by_id(&game, "reg")), 2);
}

#[test]
fn playoffs_for_a_non_first_user_league_leave_the_first_league_untouched() {
    let mut game = two_league_game(6, 6, "reg");
    turn::process_day(&mut game);
    assert_eq!(playoff_count(league_by_id(&game, "lec")), 0);
}

#[test]
fn first_league_still_finishes_its_regular_season_in_the_background() {
    let mut game = two_league_game(6, 6, "reg");
    turn::process_day(&mut game);
    let lec = league_by_id(&game, "lec");
    assert!(
        lec.fixtures
            .iter()
            .all(|f| f.status == FixtureStatus::Completed)
    );
}

#[test]
fn users_league_is_not_simulated_in_the_background_when_it_is_not_first() {
    // The user's fixture is played through the matchday path exactly once, so
    // every team plays each opponent once and no standing double-counts.
    let mut game = two_league_game(6, 6, "reg");
    turn::process_day(&mut game);
    let reg = league_by_id(&game, "reg");
    assert!(reg.standings.iter().all(|s| s.played == 5));
}

#[test]
fn lec_user_game_schedules_lec_playoffs_and_not_the_background_league() {
    let mut game = two_league_game(6, 6, "lec");
    turn::process_day(&mut game);
    assert_eq!(playoff_count(league_by_id(&game, "lec")), 2);
    assert_eq!(playoff_count(league_by_id(&game, "reg")), 0);
}

#[test]
fn lec_user_game_still_simulates_the_background_league() {
    let mut game = two_league_game(6, 6, "lec");
    turn::process_day(&mut game);
    let reg = league_by_id(&game, "reg");
    assert!(
        reg.fixtures
            .iter()
            .all(|f| f.status == FixtureStatus::Completed)
    );
}

#[test]
fn split_config_with_eight_playoff_teams_schedules_the_eight_team_bracket() {
    let mut game = two_league_game(6, 8, "reg");
    game.competition_configs.insert(
        "reg".to_string(),
        manifest("reg", &["Split One", "Split Two"], Some(8)),
    );
    turn::process_day(&mut game);
    assert_eq!(playoff_count(league_by_id(&game, "reg")), 4);
}

#[test]
fn split_without_playoff_config_keeps_the_lec_name_based_defaults() {
    let mut game = two_league_game(6, 8, "reg");
    game.competition_configs.insert(
        "reg".to_string(),
        manifest("reg", &["Winter", "Summer"], None),
    );
    turn::process_day(&mut game);
    // "Winter" without playoff config keeps the LEC 8-seed bracket.
    assert_eq!(playoff_count(league_by_id(&game, "reg")), 4);
}

fn completed(mut league: League) -> League {
    for f in &mut league.fixtures {
        f.status = FixtureStatus::Completed;
        f.result = Some(MatchResult {
            home_wins: 1,
            away_wins: 0,
            ..MatchResult::default()
        });
    }
    league
}

fn cycle_manifests() -> HashMap<String, CompetitionManifest> {
    ["lec", "reg"]
        .into_iter()
        .map(|id| (id.to_string(), manifest(id, &["Spring", "Summer"], None)))
        .collect()
}

#[test]
fn background_seasons_cycle_the_first_league_when_the_user_is_second() {
    let mut game = two_league_game(4, 4, "reg");
    game.leagues = game.leagues.into_iter().map(completed).collect();
    process_background_seasons(&mut game, &cycle_manifests());
    assert_eq!(league_by_id(&game, "lec").split_index, 1);
}

#[test]
fn background_seasons_never_cycle_the_users_league() {
    let mut game = two_league_game(4, 4, "reg");
    game.leagues = game.leagues.into_iter().map(completed).collect();
    let before = league_by_id(&game, "reg").clone();
    process_background_seasons(&mut game, &cycle_manifests());
    let after = league_by_id(&game, "reg");
    assert_eq!(
        (after.split_index, after.fixtures.len()),
        (before.split_index, before.fixtures.len())
    );
}

#[test]
fn end_of_split_regenerates_only_the_users_league() {
    let mut game = two_league_game(4, 4, "reg");
    game.leagues = game.leagues.into_iter().map(completed).collect();
    game.leagues[1].split_index = 1;
    process_end_of_split(&mut game, &cycle_manifests()["reg"]);
    assert!(
        league_by_id(&game, "reg")
            .fixtures
            .iter()
            .all(|f| f.status == FixtureStatus::Scheduled)
    );
    assert!(
        league_by_id(&game, "lec")
            .fixtures
            .iter()
            .all(|f| f.status == FixtureStatus::Completed)
    );
}
