//! Four-team single-elimination playoff bracket (semifinals 1v4 and 2v3, then
//! the final) and the LES season that uses it through the override layer.

use chrono::{Datelike, Duration, NaiveDate, TimeZone, Utc};
use olm_core::clock::GameClock;
use olm_core::competition_overrides;
use olm_core::competitions::load_competition_manifest;
use olm_core::domain::league::{
    Fixture, FixtureStatus, League, LeagueKind, MatchResult, MatchType, StandingEntry,
};
use olm_core::domain::manager::Manager;
use olm_core::domain::player::{Player, PlayerAttributes};
use olm_core::domain::stats::LolRole;
use olm_core::domain::team::Team;
use olm_core::end_of_season::{effective_final_position, is_league_complete, process_end_of_split};
use olm_core::game::Game;
use olm_core::generator::definitions::CompetitionManifest;
use olm_core::schedule::generate_schedule_from_config;
use olm_core::turn;
use std::path::Path;

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
            "Spain".to_string(),
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
        "Spain".to_string(),
        "Madrid".to_string(),
        "Stadium".to_string(),
        40_000,
    )
}

fn team_ids(count: usize) -> Vec<String> {
    (1..=count).map(|i| format!("les{i}")).collect()
}

fn game_with(ids: &[String], clock: chrono::DateTime<Utc>) -> Game {
    let teams: Vec<Team> = ids.iter().map(|t| team(t)).collect();
    let players: Vec<Player> = ids.iter().flat_map(|t| squad(t)).collect();
    let mut manager = Manager::new(
        "mgr1".to_string(),
        "Test".to_string(),
        "Manager".to_string(),
        "1980-01-01".to_string(),
        "Spain".to_string(),
    );
    manager.hire(ids[0].clone());
    Game::new(
        GameClock::new(clock),
        manager,
        teams,
        players,
        vec![],
        vec![],
    )
}

fn manifest_with(split_names: &[&str], playoffs: &str) -> CompetitionManifest {
    let splits: Vec<String> = split_names
        .iter()
        .map(|name| {
            format!(
                r#"{{"name":"{name}","best_of":1,"season_start":{{"month":8,"day":1}},"playoffs":{playoffs}}}"#
            )
        })
        .collect();
    serde_json::from_str(&format!(
        r#"{{"id":"les","name":"LES","region":"ES","teams_file":"t.json","players_file":"p.json",
            "schedule":{{"format":"single_round_robin","team_count":8,"preseason_friendlies":0,
            "splits":[{}]}}}}"#,
        splits.join(",")
    ))
    .expect("manifest parses")
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

/// Single round robin, every fixture completed (home side wins) except the
/// last, which is scheduled on `TODAY` so that `process_day` plays it.
fn nearly_finished_league(ids: &[String]) -> League {
    let mut fixtures = Vec::new();
    let mut standings: Vec<StandingEntry> =
        ids.iter().map(|t| StandingEntry::new(t.clone())).collect();
    for (i, home) in ids.iter().enumerate() {
        for away in &ids[i + 1..] {
            let matchday = fixtures.len() as u32 + 1;
            fixtures.push(completed_fixture(
                format!("les-{home}-{away}"),
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
        id: "les".to_string(),
        name: "LES".to_string(),
        season: 2025,
        fixtures,
        standings,
        competition_id: Some("les".to_string()),
        league_kind: LeagueKind::Main,
        ..Default::default()
    }
}

fn four_team_game(split_name: &str, playoffs: &str) -> Game {
    let ids = team_ids(8);
    let date = Utc.with_ymd_and_hms(2025, 6, 15, 12, 0, 0).unwrap();
    let mut game = game_with(&ids, date);
    game.leagues = vec![nearly_finished_league(&ids)];
    game.user_competition_id = Some("les".to_string());
    game.competition_configs
        .insert("les".to_string(), manifest_with(&[split_name], playoffs));
    game
}

const FOUR_TEAM: &str = r#"{"format":"single_elimination","teams":4}"#;

fn playoff_fixtures(league: &League) -> Vec<&Fixture> {
    league
        .fixtures
        .iter()
        .filter(|f| f.match_type == MatchType::Playoffs)
        .collect()
}

fn play_days(game: &mut Game, days: usize) {
    for _ in 0..days {
        turn::process_day(game);
    }
}

fn winner(fixture: &Fixture) -> String {
    let result = fixture.result.as_ref().expect("fixture was played");
    if result.home_wins > result.away_wins {
        fixture.home_team_id.clone()
    } else {
        fixture.away_team_id.clone()
    }
}

#[test]
fn four_team_bracket_opens_with_semifinals_one_v_four_and_two_v_three() {
    let mut game = four_team_game("Spring", FOUR_TEAM);
    play_days(&mut game, 1);
    let league = &game.leagues[0];
    let seeds: Vec<String> = league
        .sorted_standings()
        .iter()
        .map(|s| s.team_id.clone())
        .collect();
    let mut pairs: Vec<(String, String)> = playoff_fixtures(league)
        .iter()
        .map(|f| (f.home_team_id.clone(), f.away_team_id.clone()))
        .collect();
    let mut expected = vec![
        (seeds[0].clone(), seeds[3].clone()),
        (seeds[1].clone(), seeds[2].clone()),
    ];
    pairs.sort();
    expected.sort();
    assert_eq!(pairs, expected);
}

#[test]
fn four_team_bracket_plays_semifinals_as_best_of_five_by_default() {
    let mut game = four_team_game("Spring", FOUR_TEAM);
    play_days(&mut game, 1);
    let bo: Vec<u8> = playoff_fixtures(&game.leagues[0])
        .iter()
        .map(|f| f.best_of)
        .collect();
    assert_eq!(bo, vec![5, 5]);
}

#[test]
fn four_team_bracket_honours_a_configured_best_of() {
    let mut game = four_team_game(
        "Spring",
        r#"{"format":"single_elimination","teams":4,"best_of":3}"#,
    );
    play_days(&mut game, 1);
    let bo: Vec<u8> = playoff_fixtures(&game.leagues[0])
        .iter()
        .map(|f| f.best_of)
        .collect();
    assert_eq!(bo, vec![3, 3]);
}

#[test]
fn four_team_final_pairs_the_two_semifinal_winners_a_week_later() {
    let mut game = four_team_game("Summer", FOUR_TEAM);
    play_days(&mut game, 12);
    let league = &game.leagues[0];
    let playoffs = playoff_fixtures(league);
    assert_eq!(playoffs.len(), 3);
    let (semis, final_round): (Vec<&Fixture>, Vec<&Fixture>) = playoffs
        .iter()
        .partition(|f| f.matchday == playoffs[0].matchday);
    let mut finalists = vec![
        final_round[0].home_team_id.clone(),
        final_round[0].away_team_id.clone(),
    ];
    let mut semi_winners: Vec<String> = semis.iter().map(|f| winner(f)).collect();
    finalists.sort();
    semi_winners.sort();
    assert_eq!(finalists, semi_winners);
}

#[test]
fn four_team_final_is_scheduled_once_and_ends_the_bracket() {
    let mut game = four_team_game("Summer", FOUR_TEAM);
    play_days(&mut game, 30);
    let league = &game.leagues[0];
    assert_eq!(playoff_fixtures(league).len(), 3);
    assert!(is_league_complete(league));
}

#[test]
fn four_team_final_is_best_of_five() {
    let mut game = four_team_game("Winter", FOUR_TEAM);
    play_days(&mut game, 12);
    let league = &game.leagues[0];
    let last = playoff_fixtures(league)
        .into_iter()
        .max_by_key(|f| f.matchday)
        .expect("final exists")
        .best_of;
    assert_eq!(last, 5);
}

#[test]
fn four_team_fixture_ids_carry_the_bracket_marker() {
    let mut game = four_team_game("Spring", FOUR_TEAM);
    play_days(&mut game, 1);
    assert!(playoff_fixtures(&game.leagues[0]).iter().all(|f| {
        f.id.starts_with(olm_core::schedule::FOUR_TEAM_PLAYOFF_ID_PREFIX)
    }));
}

#[test]
fn double_elimination_playoffs_keep_unmarked_fixture_ids() {
    let mut game = four_team_game("Spring", "null");
    game.leagues[0] = nearly_finished_league(&team_ids(8));
    play_days(&mut game, 1);
    assert!(playoff_fixtures(&game.leagues[0]).iter().all(|f| {
        !f.id
            .starts_with(olm_core::schedule::FOUR_TEAM_PLAYOFF_ID_PREFIX)
    }));
}

fn playoff_fixture(id: &str, matchday: u32, home: &str, away: &str, home_wins: u8) -> Fixture {
    Fixture {
        id: id.to_string(),
        matchday,
        date: "2025-06-20".to_string(),
        home_team_id: home.to_string(),
        away_team_id: away.to_string(),
        match_type: MatchType::Playoffs,
        best_of: 5,
        status: FixtureStatus::Completed,
        result: Some(MatchResult {
            home_wins,
            away_wins: 3 - home_wins.min(3),
            ..MatchResult::default()
        }),
    }
}

/// Eight teams ranked les1..les8 by wins; semis les1-les4 (les4 wins) and
/// les2-les3 (les2 wins); final les4-les2 (les2 wins).
fn decided_bracket() -> League {
    let ids = team_ids(8);
    let mut standings: Vec<StandingEntry> =
        ids.iter().map(|t| StandingEntry::new(t.clone())).collect();
    for (rank, entry) in standings.iter_mut().enumerate() {
        for _ in 0..(8 - rank) {
            entry.record_result(1, 0);
        }
    }
    League {
        id: "les".to_string(),
        name: "LES".to_string(),
        season: 2025,
        standings,
        fixtures: vec![
            playoff_fixture("po4-a", 29, "les1", "les4", 0),
            playoff_fixture("po4-b", 29, "les2", "les3", 3),
            playoff_fixture("po4-c", 30, "les4", "les2", 1),
        ],
        ..Default::default()
    }
}

#[test]
fn final_winner_takes_first_place() {
    assert_eq!(effective_final_position(&decided_bracket(), "les2"), 1);
}

#[test]
fn losing_finalist_takes_second_place() {
    assert_eq!(effective_final_position(&decided_bracket(), "les4"), 2);
}

#[test]
fn semifinal_losers_take_third_and_fourth_by_regular_season_seed() {
    let league = decided_bracket();
    assert_eq!(
        (
            effective_final_position(&league, "les1"),
            effective_final_position(&league, "les3")
        ),
        (3, 4)
    );
}

#[test]
fn teams_outside_the_bracket_keep_their_standings_place() {
    let league = decided_bracket();
    assert_eq!(effective_final_position(&league, "les6"), 6);
}

// ---------------------------------------------------------------------------
// The LES season, driven by the bundled override over the real manifest.
// ---------------------------------------------------------------------------

fn les_manifest() -> CompetitionManifest {
    let base = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../data/competitions");
    load_competition_manifest(&base, "les").expect("LES manifest loads")
}

fn date(fixture: &Fixture) -> NaiveDate {
    NaiveDate::parse_from_str(&fixture.date, "%Y-%m-%d").expect("fixture date")
}

fn league_dates(league: &League) -> Vec<NaiveDate> {
    league
        .fixtures
        .iter()
        .filter(|f| f.match_type == MatchType::League)
        .map(date)
        .collect()
}

#[test]
fn bundled_override_gives_the_les_three_splits() {
    let manifest = les_manifest();
    let names: Vec<&str> = manifest
        .schedule
        .splits
        .iter()
        .map(|s| s.name.as_str())
        .collect();
    assert_eq!(names, vec!["Winter", "Spring", "Summer"]);
}

#[test]
fn bundled_override_applies_the_four_team_playoffs_to_every_split() {
    let manifest = les_manifest();
    assert!(manifest.schedule.splits.iter().all(|s| {
        s.playoffs
            .as_ref()
            .is_some_and(|p| p.teams == 4 && p.format == "single_elimination")
    }));
}

#[test]
fn every_les_split_is_a_seven_round_single_round_robin() {
    let manifest = les_manifest();
    let ids = team_ids(8);
    let counts: Vec<usize> = (0..3)
        .map(|split| {
            generate_schedule_from_config(&manifest, 2026, &ids, split)
                .fixtures
                .iter()
                .filter(|f| f.match_type == MatchType::League)
                .count()
        })
        .collect();
    assert_eq!(counts, vec![28, 28, 28]);
}

#[test]
fn les_regular_seasons_run_over_seven_rounds() {
    let manifest = les_manifest();
    let ids = team_ids(8);
    let league = generate_schedule_from_config(&manifest, 2026, &ids, 0);
    let rounds: std::collections::BTreeSet<NaiveDate> = league_dates(&league).into_iter().collect();
    assert_eq!(rounds.len(), 7);
}

#[test]
fn les_splits_are_sequential_with_room_for_two_playoff_rounds() {
    let manifest = les_manifest();
    let ids = team_ids(8);
    let mut gaps_ok = Vec::new();
    for split in 0..3 {
        let this = generate_schedule_from_config(&manifest, 2026, &ids, split);
        let last = league_dates(&this).into_iter().max().expect("fixtures");
        let (next_year, next_split) = if split == 2 {
            (2027, 0)
        } else {
            (2026, split + 1)
        };
        let next = generate_schedule_from_config(&manifest, next_year, &ids, next_split);
        let next_first = league_dates(&next).into_iter().min().expect("fixtures");
        // Semifinals the day after the last round, the final a week later.
        let final_day = last + Duration::days(1) + Duration::days(7);
        gaps_ok.push(final_day < next_first);
    }
    assert_eq!(gaps_ok, vec![true, true, true]);
}

#[test]
fn les_winter_starts_in_january_spring_in_april_and_summer_in_july() {
    let manifest = les_manifest();
    let months: Vec<u32> = manifest
        .schedule
        .splits
        .iter()
        .map(|s| s.season_start.month)
        .collect();
    assert_eq!(months, vec![1, 4, 7]);
}

#[test]
fn bundled_overrides_pass_validation_against_the_les_manifest() {
    let base = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../data/competitions");
    let manifests = olm_core::competitions::scan_raw_competitions(&base);
    assert_eq!(
        competition_overrides::bundled().validate(&manifests),
        Vec::<String>::new()
    );
}

#[test]
fn a_les_user_plays_a_split_with_playoffs_and_the_next_split_starts() {
    let manifest = les_manifest();
    let ids = team_ids(8);
    let league = generate_schedule_from_config(&manifest, 2026, &ids, 0);
    let first_day = league_dates(&league).into_iter().min().expect("fixtures");
    let start = Utc
        .with_ymd_and_hms(2026, first_day.month(), first_day.day(), 12, 0, 0)
        .unwrap()
        - Duration::days(1);
    let mut game = game_with(&ids, start);
    game.leagues = vec![league];
    game.user_competition_id = Some("les".to_string());
    game.competition_configs
        .insert("les".to_string(), manifest.clone());

    for _ in 0..120 {
        if is_league_complete(&game.leagues[0]) {
            break;
        }
        turn::process_day(&mut game);
    }

    let league = &game.leagues[0];
    assert!(is_league_complete(league), "split should finish");
    let playoffs = playoff_fixtures(league);
    assert_eq!(playoffs.len(), 3, "two semifinals and a final");
    let champion = winner(
        playoffs
            .iter()
            .max_by_key(|f| f.matchday)
            .expect("final exists"),
    );
    assert_eq!(effective_final_position(league, &champion), 1);

    game.leagues[0].split_index += 1;
    process_end_of_split(&mut game, &manifest);
    let next = &game.leagues[0];
    assert_eq!(next.split_index, 1);
    assert_eq!(
        next.fixtures
            .iter()
            .filter(|f| f.match_type == MatchType::League)
            .count(),
        28
    );
}

/// Matchday (1-based) on which `club` has no regular-season fixture.
fn bye_matchday(league: &League, club: &str) -> u32 {
    let rounds = league
        .fixtures
        .iter()
        .filter(|f| f.match_type == MatchType::League)
        .map(|f| f.matchday)
        .max()
        .expect("fixtures");
    let resting: Vec<u32> = (1..=rounds)
        .filter(|day| {
            !league.fixtures.iter().any(|f| {
                f.match_type == MatchType::League
                    && f.matchday == *day
                    && (f.home_team_id == club || f.away_team_id == club)
            })
        })
        .collect();
    assert_eq!(resting.len(), 1, "{club} must rest exactly once");
    resting[0]
}

/// The club that joined the league is the last team of the list, and the
/// split calendar is regenerated from the same list every time. Its bye must
/// not fall on the same matchday in every split and season.
#[test]
fn the_joined_club_does_not_rest_on_the_same_matchday_in_every_split() {
    let manifest = les_manifest();
    let ids = team_ids(9);
    let joined = ids.last().expect("nine clubs").clone();
    let byes: Vec<u32> = [(2026, 0), (2026, 1), (2026, 2), (2027, 0)]
        .into_iter()
        .map(|(year, split)| {
            bye_matchday(
                &generate_schedule_from_config(&manifest, year, &ids, split),
                &joined,
            )
        })
        .collect();
    eprintln!("[bye] joined club rests on matchdays {byes:?}");
    let distinct: std::collections::BTreeSet<u32> = byes.iter().copied().collect();
    assert_eq!(distinct.len(), byes.len(), "a bye matchday repeats: {byes:?}");
}

#[test]
fn rotating_the_odd_league_schedule_keeps_the_standings_order() {
    let manifest = les_manifest();
    let ids = team_ids(9);
    let league = generate_schedule_from_config(&manifest, 2026, &ids, 1);
    let standings: Vec<&str> = league.standings.iter().map(|s| s.team_id.as_str()).collect();
    let expected: Vec<&str> = ids.iter().map(String::as_str).collect();
    assert_eq!(standings, expected);
}

// A league must never read as complete while a playoff round is still due: the
// advance guard refuses to move the clock once it does.

fn finished_series_report(home_wins: u8, away_wins: u8) -> olm_core::engine::report::MatchReport {
    olm_core::engine::report::MatchReport {
        home_wins,
        away_wins,
        home_stats: Default::default(),
        away_stats: Default::default(),
        events: vec![],
        kill_feed: vec![],
        player_stats: Default::default(),
        home_possession: 50.0,
        total_minutes: 90,
        game_duration_seconds: 90 * 60,
        ended_by: olm_core::engine::report::MatchReportEndReason::TimeLimit,
    }
}

/// Plays every fixture scheduled today the way a live match does: each report is
/// applied on its own and `finish_live_match_day` closes the day.
fn play_today_as_live_matches(game: &mut Game) {
    let today = game.clock.current_date.format("%Y-%m-%d").to_string();
    let due: Vec<(usize, String, String)> = game.leagues[0]
        .fixtures
        .iter()
        .enumerate()
        .filter(|(_, f)| f.date == today && f.status == FixtureStatus::Scheduled)
        .map(|(i, f)| (i, f.home_team_id.clone(), f.away_team_id.clone()))
        .collect();
    assert!(!due.is_empty(), "a fixture is due today");
    for (index, home, away) in due {
        turn::apply_match_report(game, index, &home, &away, &finished_series_report(3, 0));
    }
    turn::finish_live_match_day(game);
}

fn pending_playoff_count(league: &League) -> usize {
    playoff_fixtures(league)
        .iter()
        .filter(|f| f.status != FixtureStatus::Completed)
        .count()
}

#[test]
fn day_loop_does_not_report_complete_after_the_last_regular_fixture() {
    let mut game = four_team_game("Spring", FOUR_TEAM);
    play_days(&mut game, 1);
    let league = &game.leagues[0];
    assert_eq!(pending_playoff_count(league), 2, "semifinals are scheduled");
    assert!(!is_league_complete(league));
}

#[test]
fn day_loop_does_not_report_complete_after_the_last_semifinal() {
    let mut game = four_team_game("Spring", FOUR_TEAM);
    play_days(&mut game, 1);
    for _ in 0..30 {
        let semis_done = playoff_fixtures(&game.leagues[0])
            .iter()
            .filter(|f| f.status == FixtureStatus::Completed)
            .count()
            >= 2;
        if semis_done {
            break;
        }
        play_days(&mut game, 1);
    }
    let league = &game.leagues[0];
    assert_eq!(playoff_fixtures(league).len(), 3, "the final is scheduled");
    assert_eq!(pending_playoff_count(league), 1);
    assert!(!is_league_complete(league));
}

#[test]
fn day_loop_reports_complete_only_once_the_final_is_played() {
    let mut game = four_team_game("Spring", FOUR_TEAM);
    for _ in 0..30 {
        play_days(&mut game, 1);
        let league = &game.leagues[0];
        if is_league_complete(league) {
            assert_eq!(playoff_fixtures(league).len(), 3);
            assert_eq!(pending_playoff_count(league), 0);
            return;
        }
    }
    panic!("the split never finished");
}

#[test]
fn live_path_does_not_report_complete_after_the_last_regular_fixture() {
    let mut game = four_team_game("Spring", FOUR_TEAM);
    play_today_as_live_matches(&mut game);
    let league = &game.leagues[0];
    assert_eq!(pending_playoff_count(league), 2, "semifinals are scheduled");
    assert!(!is_league_complete(league));
}

#[test]
fn live_path_does_not_report_complete_after_the_last_semifinal() {
    let mut game = four_team_game("Spring", FOUR_TEAM);
    play_today_as_live_matches(&mut game);
    while pending_playoff_count(&game.leagues[0]) == 2 {
        let today = game.clock.current_date.format("%Y-%m-%d").to_string();
        let semis_today = game.leagues[0]
            .fixtures
            .iter()
            .any(|f| f.date == today && f.status == FixtureStatus::Scheduled);
        if semis_today {
            play_today_as_live_matches(&mut game);
        } else {
            play_days(&mut game, 1);
        }
    }
    let league = &game.leagues[0];
    assert_eq!(playoff_fixtures(league).len(), 3, "the final is scheduled");
    assert_eq!(pending_playoff_count(league), 1);
    assert!(!is_league_complete(league));
}
