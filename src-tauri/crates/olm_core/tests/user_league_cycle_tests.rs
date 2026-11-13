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
use olm_core::domain::team::{Team, TeamSeasonRecord};
use olm_core::end_of_season::{
    process_background_seasons, process_end_of_split, stamp_unmarked_career,
};
use olm_core::domain::manager::CareerSplitMark;
use olm_core::game::Game;
use olm_core::generator::definitions::{
    CompetitionManifest, PlayoffConfig, ScheduleConfig, SeasonStart, SplitConfig,
};
use olm_core::season_rollover::advance_season;
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
                        best_of: None,
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
        promotion: None,
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

/// Finished two-league game whose user league is `user_league`, with both leagues on
/// `split_index` and the two-split cycle manifests registered in the game config.
fn finished_two_league_game(user_league: &str, split_index: usize) -> Game {
    let mut game = two_league_game(4, 4, user_league);
    game.leagues = game.leagues.into_iter().map(completed).collect();
    for l in &mut game.leagues {
        l.split_index = split_index;
    }
    game.competition_configs = cycle_manifests();
    game
}

#[test]
fn advance_season_moves_both_leagues_to_the_next_split_when_the_user_is_first() {
    let mut game = finished_two_league_game("lec", 0);
    let outcome = advance_season(&mut game);
    assert!(!outcome.was_season_end);
    assert_eq!(
        (
            league_by_id(&game, "lec").split_index,
            league_by_id(&game, "reg").split_index
        ),
        (1, 1)
    );
}

#[test]
fn advance_season_moves_both_leagues_to_the_next_split_when_the_user_is_second() {
    let mut game = finished_two_league_game("reg", 0);
    let outcome = advance_season(&mut game);
    assert!(!outcome.was_season_end);
    assert_eq!(
        (
            league_by_id(&game, "lec").split_index,
            league_by_id(&game, "reg").split_index
        ),
        (1, 1)
    );
}

#[test]
fn advance_season_summarises_the_finished_split_of_the_users_league() {
    let mut game = finished_two_league_game("reg", 0);
    let outcome = advance_season(&mut game);
    assert_eq!(outcome.summary.league_name, "REG");
    assert_eq!(outcome.summary.total_teams, 4);
}

#[test]
fn advance_season_wraps_both_leagues_into_the_next_season_on_the_last_split() {
    let mut game = finished_two_league_game("reg", 1);
    let outcome = advance_season(&mut game);
    assert!(outcome.was_season_end);
    let seasons: Vec<(u32, usize)> = ["lec", "reg"]
        .into_iter()
        .map(|id| {
            (
                league_by_id(&game, id).season,
                league_by_id(&game, id).split_index,
            )
        })
        .collect();
    assert_eq!(seasons, vec![(2026, 0), (2026, 0)]);
}

#[test]
fn advance_season_without_a_manifest_runs_the_legacy_season_end() {
    let mut game = finished_two_league_game("lec", 0);
    game.competition_configs.clear();
    let outcome = advance_season(&mut game);
    assert!(outcome.was_season_end);
}

/// Tag every league with the metadata a regenerated schedule must not lose.
fn tag_leagues(game: &mut Game) {
    for (tier, l) in (1u8..).zip(game.leagues.iter_mut()) {
        l.tier = tier + 1;
        l.logo = Some(format!("{}.png", l.id));
        l.active = true;
    }
}

fn metadata(game: &Game, id: &str) -> (u8, Option<String>, bool, LeagueKind) {
    let l = league_by_id(game, id);
    (l.tier, l.logo.clone(), l.active, l.league_kind.clone())
}

#[test]
fn split_advance_keeps_tier_logo_and_active_on_every_league() {
    let mut game = finished_two_league_game("lec", 0);
    tag_leagues(&mut game);
    advance_season(&mut game);
    assert_eq!(
        (metadata(&game, "lec"), metadata(&game, "reg")),
        (
            (2, Some("lec.png".into()), true, LeagueKind::Main),
            (3, Some("reg.png".into()), true, LeagueKind::Main)
        )
    );
}

#[test]
fn season_wrap_keeps_tier_logo_and_active_on_every_league() {
    let mut game = finished_two_league_game("reg", 1);
    tag_leagues(&mut game);
    advance_season(&mut game);
    assert_eq!(
        (metadata(&game, "lec"), metadata(&game, "reg")),
        (
            (2, Some("lec.png".into()), true, LeagueKind::Main),
            (3, Some("reg.png".into()), true, LeagueKind::Main)
        )
    );
}

fn history_competition(game: &Game, team_id: &str) -> Option<String> {
    game.teams
        .iter()
        .find(|t| t.id == team_id)
        .and_then(|t| t.history.iter().find(|r| r.season == 2025))
        .and_then(|r| r.competition_id.clone())
}

#[test]
fn season_wrap_stamps_the_users_league_on_its_team_history() {
    let mut game = finished_two_league_game("lec", 1);
    advance_season(&mut game);
    assert_eq!(history_competition(&game, "lec1").as_deref(), Some("lec"));
}

#[test]
fn season_wrap_stamps_the_background_league_on_its_team_history() {
    let mut game = finished_two_league_game("lec", 1);
    advance_season(&mut game);
    assert_eq!(history_competition(&game, "reg1").as_deref(), Some("reg"));
}

#[test]
fn old_team_history_without_competition_id_deserializes() {
    let record: TeamSeasonRecord = serde_json::from_str(
        r#"{"season":2024,"league_position":2,"played":10,"won":6,"lost":4,
            "kills_for":14,"kills_against":9}"#,
    )
    .expect("old save record should load");
    assert_eq!(record.competition_id, None);
}

#[test]
fn background_roll_gives_the_team_its_real_position_over_a_zero_placeholder() {
    let mut game = finished_two_league_game("lec", 1);
    let last_team = game
        .teams
        .iter_mut()
        .find(|t| t.id == "reg4")
        .expect("reg4 exists");
    // `ensure_team_season_record` pre-creates the record with position 0 during the
    // parallel background simulation.
    last_team.history.push(TeamSeasonRecord {
        season: 2025,
        league_position: 0,
        played: 3,
        won: 0,
        lost: 3,
        kills_for: 0,
        kills_against: 3,
        competition_id: None,
    });
    process_background_seasons(&mut game, &cycle_manifests());
    let team = game.teams.iter().find(|t| t.id == "reg4").unwrap();
    assert_eq!(team.history[0].league_position, 4);
}

/// The user's row of the running table of `lec`, the league the manager's club plays in.
fn user_row(game: &Game) -> &StandingEntry {
    league_by_id(game, "lec")
        .standings
        .iter()
        .find(|s| s.team_id == "lec1")
        .expect("user club row")
}

/// What the Manager tab shows: the career totals plus the user's row of the running table.
fn career_plus_running_table(game: &Game) -> (u32, u32, u32) {
    let stats = &game.manager.career_stats;
    let row = user_row(game);
    (
        stats.matches_managed + row.won + row.lost,
        stats.wins + row.won,
        stats.losses + row.lost,
    )
}

fn play_split(game: &mut Game, won: u32, lost: u32) {
    let lec = game
        .leagues
        .iter_mut()
        .find(|l| l.id == "lec")
        .expect("lec league");
    let row = lec
        .standings
        .iter_mut()
        .find(|s| s.team_id == "lec1")
        .expect("user club row");
    row.won = won;
    row.lost = lost;
    row.played = won + lost;
    for fixture in &mut lec.fixtures {
        fixture.status = FixtureStatus::Completed;
    }
}

#[test]
fn career_totals_keep_every_split_of_a_three_split_season() {
    let mut game = two_league_game(4, 4, "lec");
    game.competition_configs = ["lec", "reg"]
        .into_iter()
        .map(|id| {
            (
                id.to_string(),
                manifest(id, &["Winter", "Spring", "Summer"], None),
            )
        })
        .collect();
    let tables = [(5, 2), (3, 4), (6, 1)];
    let (mut matches, mut wins, mut losses) = (0, 0, 0);

    for (split, (won, lost)) in tables.into_iter().enumerate() {
        play_split(&mut game, won, lost);
        matches += won + lost;
        wins += won;
        losses += lost;
        assert_eq!(
            career_plus_running_table(&game),
            (matches, wins, losses),
            "before the end of split {split}"
        );

        advance_season(&mut game);

        assert_eq!(
            career_plus_running_table(&game),
            (matches, wins, losses),
            "after the end of split {split}"
        );
    }

    let career = &game.manager.career_stats;
    assert_eq!(
        (career.matches_managed, career.wins, career.losses),
        (matches, wins, losses),
        "career totals after the season wrap"
    );
    let stint = &game.manager.career_history[0];
    assert_eq!(
        (stint.matches, stint.wins, stint.losses),
        (matches, wins, losses),
        "career history entry of the club after the season wrap"
    );
}

/// Sets the user's club on top of the running `lec` table, or last in it.
fn set_user_table_position(game: &mut Game, first: bool) {
    let lec = game
        .leagues
        .iter_mut()
        .find(|l| l.id == "lec")
        .expect("lec league");
    for row in &mut lec.standings {
        row.points = match (row.team_id == "lec1", first) {
            (true, true) => 9,
            (true, false) => 0,
            (false, true) => 0,
            (false, false) => 3,
        };
    }
}

fn two_split_game() -> Game {
    let mut game = two_league_game(4, 4, "lec");
    game.competition_configs = ["lec", "reg"]
        .into_iter()
        .map(|id| (id.to_string(), manifest(id, &["Winter", "Spring"], None)))
        .collect();
    game
}

#[test]
fn a_title_in_the_first_split_counts_when_the_second_split_ends_lower() {
    let mut game = two_split_game();

    play_split(&mut game, 5, 2);
    set_user_table_position(&mut game, true);
    advance_season(&mut game);
    play_split(&mut game, 1, 6);
    set_user_table_position(&mut game, false);
    advance_season(&mut game);

    let career = &game.manager.career_stats;
    assert_eq!(career.trophies, 1, "trophies of the season");
    assert_eq!(career.best_finish, Some(1), "best finish of the season");
}

#[test]
fn a_title_in_the_last_split_counts_after_a_lower_first_split() {
    let mut game = two_split_game();

    play_split(&mut game, 3, 4);
    set_user_table_position(&mut game, false);
    advance_season(&mut game);
    play_split(&mut game, 4, 3);
    set_user_table_position(&mut game, true);
    advance_season(&mut game);

    let career = &game.manager.career_stats;
    assert_eq!(career.trophies, 1);
    assert_eq!(career.best_finish, Some(1));
}

#[test]
fn an_unmarked_mid_season_save_keeps_its_totals_and_counts_later_splits_once() {
    let mut game = two_split_game();
    play_split(&mut game, 5, 2);
    advance_season(&mut game);
    // A save written before splits were tracked: no mark, and the totals are whatever
    // the save held, which the loader cannot tell apart from a counted career.
    game.manager.career_stats.counted_through = None;
    let before = (
        game.manager.career_stats.matches_managed,
        game.manager.career_stats.wins,
        game.manager.career_stats.losses,
    );

    stamp_unmarked_career(&mut game);
    stamp_unmarked_career(&mut game);

    let career = &game.manager.career_stats;
    assert_eq!(
        (career.matches_managed, career.wins, career.losses),
        before,
        "totals after loading"
    );
    assert_eq!(
        career.counted_through,
        Some(CareerSplitMark { season: 2025, splits: 1 })
    );

    play_split(&mut game, 3, 4);
    advance_season(&mut game);

    let career = &game.manager.career_stats;
    assert_eq!(
        (career.matches_managed, career.wins, career.losses),
        (before.0 + 7, before.1 + 3, before.2 + 4),
        "totals after the next split end"
    );
}
