use std::collections::BTreeSet;

use chrono::{NaiveDate, TimeZone, Utc};
use olm_core::champions::ChampionMetaEntry;
use olm_core::clock::GameClock;
use olm_core::domain::league::{Fixture, FixtureStatus, League, MatchType};
use olm_core::domain::manager::Manager;
use olm_core::domain::player::{LolRole, Player, PlayerAttributes};
use olm_core::domain::stats::{MatchOutcome, PlayerMatchStatsRecord, StatsState, TeamSide};
use olm_core::domain::team::Team;
use olm_core::game::Game;
use olm_core::state::StateManager;
use serde_json::Value;

use super::champion::{PlayerDirectory, build_champion_stats, get_champion_stats_internal};

const PAGE_SOURCE: &str = include_str!("../../../../src/ui-v2/pages/ChampionPageV2.tsx");

fn today() -> NaiveDate {
    NaiveDate::from_ymd_opt(2025, 6, 15).unwrap()
}

#[allow(clippy::too_many_arguments)] // test fixture: every field is a distinct stat
fn record(
    fixture: &str,
    player: &str,
    team: &str,
    champion: Option<&str>,
    result: MatchOutcome,
    kda: (u16, u16, u16),
) -> PlayerMatchStatsRecord {
    PlayerMatchStatsRecord {
        fixture_id: fixture.to_string(),
        season: 2025,
        matchday: 1,
        date: "2025-06-10".to_string(),
        match_type: MatchType::League,
        player_id: player.to_string(),
        team_id: team.to_string(),
        opponent_team_id: String::new(),
        side: TeamSide::Blue,
        result,
        role: LolRole::Mid,
        champion: champion.map(str::to_string),
        duration_seconds: 1800,
        kills: kda.0,
        deaths: kda.1,
        assists: kda.2,
        creep_score: 200,
        gold_earned: 12_000,
        damage_dealt: 25_000,
        vision_score: 30,
        wards_placed: 10,
        bans_json: "[]".to_string(),
    }
}

fn stats_of(player_matches: Vec<PlayerMatchStatsRecord>) -> StatsState {
    StatsState {
        player_matches,
        team_matches: vec![],
    }
}

fn dto(stats: &StatsState, key: &str) -> super::dto::ChampionStatsDto {
    build_champion_stats(stats, key, &PlayerDirectory::default(), today())
}

#[test]
fn a_champion_nobody_picked_has_zero_games_and_only_finite_numbers() {
    let stats = stats_of(vec![record(
        "f1",
        "p1",
        "a",
        Some("Ahri"),
        MatchOutcome::Win,
        (1, 1, 1),
    )]);

    let result = dto(&stats, "Zed");

    assert_eq!(result.total_games, 0);
    assert_eq!(result.win_rate, 0.0);
    assert_eq!(result.avg_kda, 0.0);
    assert!(result.role_distribution.is_empty());
    let json = serde_json::to_string(&result).unwrap();
    assert!(!json.contains("null"), "serde writes NaN as null: {json}");
}

#[test]
fn an_empty_stats_state_returns_zeros_not_nan() {
    let json = serde_json::to_value(dto(&StatsState::default(), "Ahri")).unwrap();

    assert_eq!(json["pick_rate"], 0.0);
    assert_eq!(json["ban_rate"], 0.0);
    assert!(!json.to_string().contains("null"));
}

#[test]
fn wins_and_losses_average_to_the_old_sql_figures() {
    // The 4-row fixture of champion_stats_repo's own test: 2 wins, 2 losses, 5/3/7 each.
    let mut rows: Vec<_> = (0..4)
        .map(|i| {
            let result = if i < 2 {
                MatchOutcome::Win
            } else {
                MatchOutcome::Loss
            };
            record(&format!("f{i}"), "p1", "a", Some("Ahri"), result, (5, 3, 7))
        })
        .collect();
    rows.push(record(
        "f9",
        "p2",
        "b",
        Some("Zed"),
        MatchOutcome::Win,
        (1, 1, 1),
    ));
    rows.push(record("f9", "p3", "b", None, MatchOutcome::Win, (1, 1, 1)));

    let result = dto(&stats_of(rows), "Ahri");

    assert_eq!(result.total_games, 4);
    assert_eq!(result.total_wins, 2);
    assert_eq!(result.win_rate, 50.0);
    assert_eq!(result.avg_kills, 5.0);
    assert_eq!(result.avg_deaths, 3.0);
    assert_eq!(result.avg_assists, 7.0);
    assert_eq!(result.avg_kda, 4.0);
    assert_eq!(result.avg_gold, 12_000.0);
    assert_eq!(result.avg_duration, 1800.0);
    // 4 of the 6 player records, all of them counted as the SQL did.
    assert_eq!(result.pick_rate, 66.7);
    assert_eq!(result.role_distribution[0].role, "MID");
    assert_eq!(result.role_distribution[0].percentage, 100.0);
}

#[test]
fn rates_are_rounded_so_the_page_never_prints_a_long_float() {
    let rows = vec![
        record("f1", "p1", "a", Some("Ahri"), MatchOutcome::Win, (1, 1, 1)),
        record("f2", "p1", "a", Some("Ahri"), MatchOutcome::Win, (1, 1, 1)),
        record("f3", "p1", "a", Some("Ahri"), MatchOutcome::Loss, (1, 1, 1)),
    ];

    assert_eq!(dto(&stats_of(rows), "Ahri").win_rate, 66.7);
}

#[test]
fn a_deathless_champion_uses_kills_plus_assists_as_kda() {
    let rows = vec![record(
        "f1",
        "p1",
        "a",
        Some("Ahri"),
        MatchOutcome::Win,
        (6, 0, 4),
    )];

    assert_eq!(dto(&stats_of(rows), "Ahri").avg_kda, 10.0);
}

#[test]
fn the_key_matches_whatever_casing_or_alias_the_record_used() {
    let rows = vec![
        record(
            "f1",
            "p1",
            "a",
            Some("MonkeyKing"),
            MatchOutcome::Win,
            (1, 1, 1),
        ),
        record(
            "f2",
            "p1",
            "a",
            Some("monkeyking"),
            MatchOutcome::Win,
            (1, 1, 1),
        ),
    ];
    let stats = stats_of(rows);

    assert_eq!(dto(&stats, "Wukong").total_games, 2);
    assert_eq!(dto(&stats, "MONKEYKING").total_games, 2);
}

fn matchup_rows() -> Vec<PlayerMatchStatsRecord> {
    // Ahri (team a) meets Yasuo 3 times and wins all, meets Zed 3 times and loses all,
    // meets Lux twice (below the 3-game floor). Opponents sit on team b.
    let mut rows = Vec::new();
    for (opponent, count, ahri_result) in [
        ("Yasuo", 3, MatchOutcome::Win),
        ("Zed", 3, MatchOutcome::Loss),
        ("Lux", 2, MatchOutcome::Win),
    ] {
        for i in 0..count {
            let fixture = format!("{opponent}-{i}");
            rows.push(record(
                &fixture,
                "ahri-player",
                "a",
                Some("Ahri"),
                ahri_result,
                (2, 2, 2),
            ));
            rows.push(record(
                &fixture,
                "other",
                "b",
                Some(opponent),
                MatchOutcome::Loss,
                (2, 2, 2),
            ));
        }
    }
    rows
}

#[test]
fn matchups_pair_the_opposing_team_in_the_same_fixture() {
    let result = dto(&stats_of(matchup_rows()), "Ahri");

    assert_eq!(result.best_against.len(), 1);
    assert_eq!(result.best_against[0].vs_champion_key, "Yasuo");
    assert_eq!(result.best_against[0].games, 3);
    assert_eq!(result.best_against[0].win_rate, 100.0);
    assert_eq!(result.worst_against[0].vs_champion_key, "Zed");
    assert_eq!(result.worst_against[0].win_rate, 0.0);
}

#[test]
fn a_teammates_champion_is_not_a_matchup() {
    let mut rows = Vec::new();
    for i in 0..3 {
        let fixture = format!("f{i}");
        rows.push(record(
            &fixture,
            "p1",
            "a",
            Some("Ahri"),
            MatchOutcome::Win,
            (1, 1, 1),
        ));
        rows.push(record(
            &fixture,
            "p2",
            "a",
            Some("Lulu"),
            MatchOutcome::Win,
            (1, 1, 1),
        ));
    }

    let result = dto(&stats_of(rows), "Ahri");

    assert!(result.best_against.is_empty() && result.worst_against.is_empty());
}

#[test]
fn bans_count_distinct_fixtures_over_all_player_records() {
    let mut rows = Vec::new();
    for fixture in ["f1", "f2"] {
        for player in ["p1", "p2"] {
            let mut r = record(
                fixture,
                player,
                "a",
                Some("Lux"),
                MatchOutcome::Win,
                (1, 1, 1),
            );
            r.bans_json = r#"["Ahri","Zed"]"#.to_string();
            rows.push(r);
        }
    }
    rows.push(record(
        "f3",
        "p1",
        "a",
        Some("Lux"),
        MatchOutcome::Win,
        (1, 1, 1),
    ));

    let result = dto(&stats_of(rows), "ahri");

    assert_eq!(result.total_games, 0);
    // 2 fixtures banned it, over 5 player records.
    assert_eq!(result.ban_rate, 40.0);
}

#[test]
fn top_players_need_three_games_and_carry_their_names() {
    let mut rows = Vec::new();
    for i in 0..3 {
        rows.push(record(
            &format!("a{i}"),
            "veteran",
            "a",
            Some("Ahri"),
            MatchOutcome::Win,
            (4, 2, 2),
        ));
    }
    rows.push(record(
        "b0",
        "rookie",
        "a",
        Some("Ahri"),
        MatchOutcome::Win,
        (4, 2, 2),
    ));
    let state = StateManager::new();
    state.set_game(named_game());
    state.set_stats_state(stats_of(rows));

    let result = get_champion_stats_internal(&state, "Ahri").unwrap();

    assert_eq!(result.top_players.len(), 1);
    assert_eq!(result.top_players[0].player_id, "veteran");
    assert_eq!(result.top_players[0].player_name, "Veteran Match");
    assert_eq!(result.top_players[0].team_name, "Alpha");
    assert_eq!(result.top_players[0].avg_kda, 3.0);
}

#[test]
fn weekly_history_keeps_the_last_ten_game_weeks_oldest_first() {
    let mut recent = record("f1", "p1", "a", Some("Ahri"), MatchOutcome::Win, (1, 1, 1));
    recent.date = "2025-06-10".to_string();
    let mut older = record("f2", "p1", "a", Some("Ahri"), MatchOutcome::Loss, (1, 1, 1));
    older.date = "2025-05-20T08:00:00+00:00".to_string();
    let mut ancient = record("f3", "p1", "a", Some("Ahri"), MatchOutcome::Win, (1, 1, 1));
    ancient.date = "2024-01-01".to_string();

    let result = dto(&stats_of(vec![recent, older, ancient]), "Ahri");

    let labels: Vec<_> = result
        .weekly_history
        .iter()
        .map(|w| w.week_label.as_str())
        .collect();
    assert_eq!(labels, ["2025-W20", "2025-W23"]);
    assert_eq!(result.weekly_history[1].win_rate, 100.0);
}

#[test]
fn asking_without_a_game_is_an_error_not_an_empty_page() {
    let state = StateManager::new();

    assert!(get_champion_stats_internal(&state, "Ahri").is_err());
}

/// Keys of the page's `Stats` interface, top level and for each nested `{ ... }[]` shape.
fn page_interface_keys() -> (
    BTreeSet<String>,
    std::collections::BTreeMap<String, BTreeSet<String>>,
) {
    let start = PAGE_SOURCE
        .find("interface Stats {")
        .expect("Stats interface");
    let body = &PAGE_SOURCE[start + "interface Stats {".len()..];
    let body = &body[..body.find("\n}\n").expect("end of Stats")];
    let mut top = BTreeSet::new();
    let mut nested = std::collections::BTreeMap::new();
    // Split the body into top-level fields: `;` and `,` only separate fields outside `{ ... }`.
    let mut depth = 0;
    let mut current = String::new();
    let mut fields: Vec<String> = Vec::new();
    for ch in body.chars() {
        match ch {
            '{' => depth += 1,
            '}' => depth -= 1,
            ';' | ',' if depth == 0 => {
                fields.push(std::mem::take(&mut current));
                continue;
            }
            _ => {}
        }
        current.push(ch);
    }
    fields.push(current);
    for field in fields {
        let Some((name, ty)) = field.trim().split_once(':') else {
            continue;
        };
        let name = name.trim().to_string();
        if let (Some(open), Some(close)) = (ty.find('{'), ty.rfind('}')) {
            let inner: BTreeSet<String> = ty[open + 1..close]
                .split(';')
                .filter_map(|entry| entry.split_once(':'))
                .map(|(key, _)| key.trim().to_string())
                .collect();
            nested.insert(name.clone(), inner);
        }
        top.insert(name);
    }
    (top, nested)
}

fn keys_of(value: &Value) -> BTreeSet<String> {
    value.as_object().expect("object").keys().cloned().collect()
}

#[test]
fn serialized_keys_equal_the_champion_page_stats_interface() {
    let mut rows = matchup_rows();
    for i in 0..3 {
        rows.push(record(
            &format!("w{i}"),
            "veteran",
            "a",
            Some("Ahri"),
            MatchOutcome::Win,
            (4, 2, 2),
        ));
    }
    let json = serde_json::to_value(dto(&stats_of(rows), "Ahri")).unwrap();
    let (top, nested) = page_interface_keys();

    assert!(top.len() > 15, "parsed {} keys from the page", top.len());
    assert_eq!(keys_of(&json), top);
    for (field, expected) in nested {
        let first = json[&field]
            .as_array()
            .and_then(|rows| rows.first())
            .unwrap_or_else(|| {
                panic!("`{field}` is empty in the fixture, so its keys are untested")
            });
        assert_eq!(keys_of(first), expected, "keys of `{field}`");
    }
}

fn named_game() -> Game {
    let clock = GameClock::new(Utc.with_ymd_and_hms(2025, 6, 15, 12, 0, 0).unwrap());
    let manager = Manager::new(
        "mgr".to_string(),
        "Test".to_string(),
        "Manager".to_string(),
        "1980-01-01".to_string(),
        "ES".to_string(),
    );
    let team = Team::new(
        "a".to_string(),
        "Alpha".to_string(),
        "ALP".to_string(),
        "ES".to_string(),
        "City".to_string(),
        "Ground".to_string(),
        1000,
    );
    let mut veteran = player("veteran", "a", LolRole::Mid);
    veteran.match_name = "Veteran Match".to_string();
    let rookie = player("rookie", "a", LolRole::Mid);
    Game::new(
        clock,
        manager,
        vec![team],
        vec![veteran, rookie],
        vec![],
        vec![],
    )
}

fn player(id: &str, team_id: &str, role: LolRole) -> Player {
    let attrs = PlayerAttributes {
        mechanics: 60,
        laning: 60,
        teamfighting: 60,
        macro_play: 60,
        consistency: 60,
        shotcalling: 60,
        champion_pool: 60,
        discipline: 60,
        mental_resilience: 60,
    };
    let mut player = Player::new(
        id.to_string(),
        id.to_string(),
        id.to_string(),
        "2000-01-01".to_string(),
        "ES".to_string(),
        role,
        attrs,
    );
    player.team_id = Some(team_id.to_string());
    player.natural_position = role;
    player.position = role;
    player
}

/// Two five-player teams, one fixture today, and a champion pool that is not the test ids of the
/// engine's own tests: ids the way the game data writes them.
fn background_game() -> (Game, Vec<String>) {
    let clock = GameClock::new(Utc.with_ymd_and_hms(2025, 6, 15, 12, 0, 0).unwrap());
    let manager = Manager::new(
        "mgr".to_string(),
        "Test".to_string(),
        "Manager".to_string(),
        "1980-01-01".to_string(),
        "ES".to_string(),
    );
    let roles = [
        LolRole::Top,
        LolRole::Jungle,
        LolRole::Mid,
        LolRole::Adc,
        LolRole::Support,
    ];
    let mut teams = Vec::new();
    let mut players = Vec::new();
    for id in ["team1", "team2"] {
        let mut team = Team::new(
            id.to_string(),
            id.to_string(),
            id.to_uppercase(),
            "ES".to_string(),
            "City".to_string(),
            "Ground".to_string(),
            1000,
        );
        for (i, role) in roles.iter().enumerate() {
            let p = player(&format!("{id}-p{i}"), id, *role);
            team.active_lineup_ids.push(p.id.clone());
            players.push(p);
        }
        teams.push(team);
    }
    let mut game = Game::new(clock, manager, teams, players, vec![], vec![]);
    let pool = [
        ("top", ["Aatrox", "Garen", "Darius", "Camille"]),
        ("jungle", ["LeeSin", "MonkeyKing", "Elise", "Nidalee"]),
        ("mid", ["Ahri", "Zed", "Yasuo", "Lux"]),
        ("adc", ["Jinx", "Kaisa", "Ezreal", "Caitlyn"]),
        ("support", ["Lulu", "Thresh", "Nami", "Leona"]),
    ];
    let mut ids = Vec::new();
    for (role, champions) in pool {
        for champion in champions {
            ids.push(champion.to_string());
            game.champion_patch.hidden_meta.push(ChampionMetaEntry {
                champion_id: champion.to_string(),
                role: role.to_string(),
                tier: "A".to_string(),
            });
        }
    }
    game.leagues = vec![League::new(
        "league".to_string(),
        "League".to_string(),
        2025,
        &["team1".to_string(), "team2".to_string()],
        None,
    )];
    game.active_league_mut().unwrap().fixtures.push(Fixture {
        id: "fix-1".to_string(),
        matchday: 1,
        date: "2025-06-15".to_string(),
        home_team_id: "team1".to_string(),
        away_team_id: "team2".to_string(),
        match_type: MatchType::League,
        best_of: 1,
        status: FixtureStatus::Scheduled,
        result: None,
    });
    (game, ids)
}

#[test]
fn a_background_match_reaches_the_command_through_the_real_recording_path() {
    let (mut game, pool) = background_game();
    let mut captures = Vec::new();
    olm_core::turn::simulate_other_matches_with_capture(&mut game, "2025-06-15", None, &mut |c| {
        captures.push(c)
    });
    let state = StateManager::new();
    state.set_game(game);
    for capture in captures {
        state.append_stats_state(capture);
    }

    // Ask with the ids the page would send (the champion pool's own ids), never one read back from a record.
    let results: Vec<_> = pool
        .iter()
        .map(|key| {
            (
                key.clone(),
                get_champion_stats_internal(&state, key).unwrap(),
            )
        })
        .collect();

    let games: u32 = results.iter().map(|(_, r)| r.total_games).sum();
    assert_eq!(
        games, 10,
        "every one of the 10 player records belongs to one pool champion"
    );
    let (picked_key, picked) = results.iter().find(|(_, r)| r.total_games > 0).unwrap();
    assert!(picked.pick_rate > 0.0);
    assert_eq!(picked.weekly_history.len(), 1);
    assert_eq!(
        get_champion_stats_internal(&state, &picked_key.to_lowercase())
            .unwrap()
            .total_games,
        picked.total_games,
        "the key's casing does not change the answer"
    );
    let never_picked = results.iter().find(|(_, r)| r.total_games == 0).unwrap();
    assert_eq!(never_picked.1.win_rate, 0.0);
    assert!(
        results.iter().any(|(_, r)| r.ban_rate > 0.0),
        "the 10 bans are counted"
    );
    assert!(
        !serde_json::to_string(&results.iter().map(|(_, r)| r).collect::<Vec<_>>())
            .unwrap()
            .contains("null")
    );
}
