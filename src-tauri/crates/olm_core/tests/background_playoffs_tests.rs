//! Background leagues (every league except the user's) run their own playoffs
//! and roll to the next split the day they finish, without the user advancing
//! the season.

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
use olm_core::generator::definitions::CompetitionManifest;
use olm_core::turn;

const TODAY: &str = "2025-06-15";
const USER_TEAM: &str = "usr1";
const BG_ID: &str = "bg";
const FOUR_TEAM: &str = r#"{"format":"single_elimination","teams":4}"#;
const SIX_TEAM: &str = r#"{"format":"double_elimination","teams":6}"#;

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

fn bg_team_ids(count: usize) -> Vec<String> {
    (1..=count).map(|i| format!("bg{i}")).collect()
}

/// Manifest whose splits start on the given months (day 1), all with `playoffs`.
fn manifest(id: &str, split_months: &[(&str, u32)], playoffs: &str) -> CompetitionManifest {
    let splits: Vec<String> = split_months
        .iter()
        .map(|(name, month)| {
            format!(
                r#"{{"name":"{name}","best_of":1,"season_start":{{"month":{month},"day":1}},"playoffs":{playoffs}}}"#
            )
        })
        .collect();
    serde_json::from_str(&format!(
        r#"{{"id":"{id}","name":"{id}","region":"ES","teams_file":"t.json","players_file":"p.json",
            "schedule":{{"format":"single_round_robin","team_count":8,"preseason_friendlies":0,
            "splits":[{}]}}}}"#,
        splits.join(",")
    ))
    .expect("manifest parses")
}

/// Single round robin, every fixture completed (home side wins) except the last,
/// which is scheduled on `TODAY` so that the background simulation plays it.
fn nearly_finished_league(ids: &[String]) -> League {
    let mut fixtures = Vec::new();
    let mut standings: Vec<StandingEntry> =
        ids.iter().map(|t| StandingEntry::new(t.clone())).collect();
    for (i, home) in ids.iter().enumerate() {
        for away in &ids[i + 1..] {
            let matchday = fixtures.len() as u32 + 1;
            fixtures.push(Fixture {
                id: format!("{BG_ID}-{home}-{away}"),
                matchday,
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
        id: BG_ID.to_string(),
        name: "Background".to_string(),
        season: 2025,
        fixtures,
        standings,
        competition_id: Some(BG_ID.to_string()),
        league_kind: LeagueKind::Main,
        ..Default::default()
    }
}

/// A user in their own competition (no fixtures) plus a background league of
/// `bg_teams` clubs on its last regular-season matchday.
fn game_with_background(bg_teams: usize, manifest: CompetitionManifest) -> Game {
    let bg_ids = bg_team_ids(bg_teams);
    let mut ids = bg_ids.clone();
    ids.push(USER_TEAM.to_string());
    let teams: Vec<Team> = ids.iter().map(|t| team(t)).collect();
    let players: Vec<Player> = ids.iter().flat_map(|t| squad(t)).collect();
    let mut manager = Manager::new(
        "mgr1".to_string(),
        "Test".to_string(),
        "Manager".to_string(),
        "1980-01-01".to_string(),
        "Spain".to_string(),
    );
    manager.hire(USER_TEAM.to_string());
    let mut game = Game::new(
        GameClock::new(Utc.with_ymd_and_hms(2025, 6, 15, 12, 0, 0).unwrap()),
        manager,
        teams,
        players,
        vec![],
        vec![],
    );
    let user_league = League {
        id: "user".to_string(),
        name: "User".to_string(),
        season: 2025,
        standings: vec![StandingEntry::new(USER_TEAM.to_string())],
        competition_id: Some("user".to_string()),
        league_kind: LeagueKind::Main,
        ..Default::default()
    };
    game.leagues = vec![user_league, nearly_finished_league(&bg_ids)];
    game.user_competition_id = Some("user".to_string());
    game.competition_configs
        .insert("user".to_string(), manifest_for_user());
    game.competition_configs.insert(BG_ID.to_string(), manifest);
    game
}

fn manifest_for_user() -> CompetitionManifest {
    manifest("user", &[("Spring", 8)], SIX_TEAM)
}

fn playoff_fixtures(league: &League) -> Vec<&Fixture> {
    league
        .fixtures
        .iter()
        .filter(|f| f.match_type == MatchType::Playoffs)
        .collect()
}

/// What `run_until_rolled` saw while the user never advanced the season.
struct BackgroundRun {
    /// Last state of the background league that still had playoff fixtures.
    last_playoff_state: Option<League>,
    /// First state of the background league after its regular season ended.
    first_playoff_state: Option<League>,
    /// Day count on which the league was replaced by its next split, if it was.
    rolled_on_day: Option<usize>,
}

/// Plays days one by one and watches the background league (index 1).
fn run_until_rolled(game: &mut Game, max_days: usize) -> BackgroundRun {
    let started_season = game.leagues[1].season;
    let started_split = game.leagues[1].split_index;
    let mut run = BackgroundRun {
        last_playoff_state: None,
        first_playoff_state: None,
        rolled_on_day: None,
    };
    for day in 1..=max_days {
        turn::process_day(game);
        let league = &game.leagues[1];
        if league.season != started_season || league.split_index != started_split {
            run.rolled_on_day = Some(day);
            break;
        }
        if !playoff_fixtures(league).is_empty() {
            if run.first_playoff_state.is_none() {
                run.first_playoff_state = Some(league.clone());
            }
            run.last_playoff_state = Some(league.clone());
        }
    }
    run
}

fn four_team_game() -> Game {
    game_with_background(8, manifest(BG_ID, &[("Spring", 8)], FOUR_TEAM))
}

#[test]
fn background_league_with_four_team_playoffs_produces_a_champion_without_user_advance() {
    let mut game = four_team_game();
    let run = run_until_rolled(&mut game, 40);

    assert!(run.rolled_on_day.is_some(), "league never rolled");
    let last = run.last_playoff_state.expect("playoffs were scheduled");
    let playoffs = playoff_fixtures(&last);
    let first_round = playoffs
        .iter()
        .map(|f| f.matchday)
        .min()
        .expect("playoffs exist");
    // Two semifinals, then the final that was pending when the league last looked unfinished.
    assert_eq!(playoffs.len(), 3);
    let semis: Vec<&&Fixture> = playoffs
        .iter()
        .filter(|f| f.matchday == first_round)
        .collect();
    assert!(semis.iter().all(|f| f.status == FixtureStatus::Completed));
    let final_fixture = playoffs
        .iter()
        .find(|f| f.matchday == first_round + 1)
        .expect("a final was scheduled");
    let semi_winners: Vec<String> = semis
        .iter()
        .map(|f| {
            let r = f.result.as_ref().expect("semifinal played");
            if r.home_wins > r.away_wins {
                f.home_team_id.clone()
            } else {
                f.away_team_id.clone()
            }
        })
        .collect();
    assert!(semi_winners.contains(&final_fixture.home_team_id));
    assert!(semi_winners.contains(&final_fixture.away_team_id));
}

#[test]
fn background_league_with_six_team_playoffs_produces_a_champion_without_user_advance() {
    let mut game = game_with_background(8, manifest(BG_ID, &[("Summer", 8)], SIX_TEAM));
    let run = run_until_rolled(&mut game, 80);

    assert!(run.rolled_on_day.is_some(), "league never rolled");
    let last = run.last_playoff_state.expect("playoffs were scheduled");
    // The six-seed bracket opens with two series, and later rounds were scheduled
    // as the earlier ones finished.
    let playoffs = playoff_fixtures(&last);
    let first_round = playoffs
        .iter()
        .map(|f| f.matchday)
        .min()
        .expect("playoffs exist");
    let opening = playoffs
        .iter()
        .filter(|f| f.matchday == first_round)
        .count();
    assert_eq!(opening, 2);
    assert!(playoffs.iter().any(|f| f.matchday > first_round));
}

#[test]
fn background_playoffs_do_not_change_regular_season_standings() {
    let mut game = four_team_game();
    let run = run_until_rolled(&mut game, 40);

    let first = run.first_playoff_state.expect("playoffs were scheduled");
    let last = run.last_playoff_state.expect("playoffs were scheduled");
    assert!(
        playoff_fixtures(&last)
            .iter()
            .any(|f| f.status == FixtureStatus::Completed),
        "at least one playoff series was played"
    );
    let table = |league: &League| -> Vec<(String, u32, u32, u32)> {
        league
            .standings
            .iter()
            .map(|s| (s.team_id.clone(), s.played, s.won, s.points))
            .collect()
    };
    assert_eq!(table(&first), table(&last));
    assert!(last.standings.iter().all(|s| s.played == 7));
}

#[test]
fn completed_background_league_rolls_the_day_it_finishes() {
    // Four clubs cannot fill a six-seed bracket, so the league ends with its regular season.
    let mut game = game_with_background(4, manifest(BG_ID, &[("Spring", 8)], SIX_TEAM));
    let before = game.leagues[1].season;

    turn::process_day(&mut game);

    let league = &game.leagues[1];
    assert_eq!(league.season, before + 1, "rolled on the final matchday");
    assert!(
        league
            .fixtures
            .iter()
            .all(|f| f.status == FixtureStatus::Scheduled)
    );
    assert_eq!(
        game.leagues[0].season, before,
        "the user's league is untouched"
    );
}

#[test]
fn rolled_background_league_next_fixtures_are_in_the_future() {
    // The second split's calendar window (March) already closed when the first one ends.
    let mut game = game_with_background(
        4,
        manifest(BG_ID, &[("Winter", 8), ("Spring", 3)], SIX_TEAM),
    );

    turn::process_day(&mut game);

    let league = &game.leagues[1];
    assert_eq!(league.split_index, 1, "advanced to the second split");
    assert!(!league.fixtures.is_empty());
    assert!(
        league.fixtures.iter().all(|f| f.date.as_str() > TODAY),
        "no fixture is dated today or earlier: {:?}",
        league.fixtures.iter().map(|f| &f.date).min()
    );
}

#[test]
fn background_roll_is_idempotent() {
    let mut game = game_with_background(4, manifest(BG_ID, &[("Spring", 8)], SIX_TEAM));
    turn::process_day(&mut game);
    let rolled_ids: Vec<String> = game.leagues[1]
        .fixtures
        .iter()
        .map(|f| f.id.clone())
        .collect();
    let history_len = game
        .teams
        .iter()
        .find(|t| t.id == "bg1")
        .map(|t| t.history.len())
        .expect("team exists");

    for _ in 0..3 {
        turn::process_day(&mut game);
    }

    let ids_after: Vec<String> = game.leagues[1]
        .fixtures
        .iter()
        .map(|f| f.id.clone())
        .collect();
    assert_eq!(ids_after, rolled_ids, "rolled league was not regenerated");
    assert_eq!(game.leagues[1].season, 2026);
    let history_after = game
        .teams
        .iter()
        .find(|t| t.id == "bg1")
        .map(|t| t.history.len())
        .expect("team exists");
    assert_eq!(history_after, history_len, "season recorded once");
}
