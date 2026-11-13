//! The nine attributes of a player reach the match under the names the app's snapshot uses.
//! Before, only twelve football-style keys were read, which the app does not send, so every
//! player of the watched match was a 70.

use super::economy_tests::{snapshot_with, Side, FULL_MATCH_TICKS};
use super::*;

const APP_NAMES: [&str; 9] = [
    "mechanics",
    "laning",
    "teamfighting",
    "macro_play",
    "consistency",
    "shotcalling",
    "champion_pool",
    "discipline",
    "mental_resilience",
];

fn app_player(value: f64) -> Value {
    let mut player = serde_json::Map::new();
    player.insert("id".into(), json!("p"));
    for name in APP_NAMES {
        player.insert(name.into(), json!(value));
    }
    Value::Object(player)
}

fn visible(player: Value) -> [f64; 9] {
    let snapshot = json!({ "home_team": { "players": [player] } });
    let players = snapshot_team_players(&snapshot, "home_team");
    let stats = player_visible_stats(&players[0]);
    [stats.0, stats.1, stats.2, stats.3, stats.4, stats.5, stats.6, stats.7, stats.8]
}

#[test]
fn a_player_with_the_apps_attribute_names_at_90_is_a_90() {
    assert_eq!(visible(app_player(90.0)), [90.0; 9]);
}

#[test]
fn a_player_with_the_apps_attribute_names_at_60_is_a_60() {
    assert_eq!(visible(app_player(60.0)), [60.0; 9]);
}

#[test]
fn a_player_with_no_attribute_of_the_app_keeps_the_derivation_from_the_old_keys() {
    let player = json!({ "id": "p", "dribbling": 90, "agility": 90, "pace": 90, "composure": 90 });
    let stats = visible(player);
    // mechanics is the mean of dribbling, agility, pace and composure.
    assert_eq!(stats[0], 90.0);
    // laning mixes in shooting and positioning, which default to 70.
    assert_eq!(stats[1], (70.0 + 70.0 + 90.0 + 90.0) / 4.0);
}

#[test]
fn an_attribute_the_snapshot_lacks_comes_from_the_old_keys_and_the_others_from_the_app() {
    let player = json!({ "id": "p", "mechanics": 95, "dribbling": 90, "agility": 90, "pace": 90, "composure": 90 });
    let stats = visible(player);
    assert_eq!(stats[0], 95.0, "the reported mechanics was ignored");
    assert_eq!(stats[1], (70.0 + 70.0 + 90.0 + 90.0) / 4.0, "the missing laning was not derived");
}

/// A snapshot the way the app builds one: attributes under the app's names only.
fn app_snapshot(home: f64, away: f64) -> Value {
    let mut snapshot = snapshot_with(Side::EVEN, Side::EVEN);
    for (team, value) in [("home_team", home), ("away_team", away)] {
        let players = snapshot[team]["players"].as_array_mut().expect("players");
        for player in players {
            let id = player["id"].clone();
            let name = player["name"].clone();
            *player = app_player(value);
            player["id"] = id;
            player["name"] = name;
        }
    }
    snapshot
}

fn home_wins_of(home: f64, away: f64, seeds: usize) -> usize {
    let workers = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(seeds.max(1));
    std::thread::scope(|scope| {
        let handles: Vec<_> = (0..workers)
            .map(|worker| {
                scope.spawn(move || {
                    (worker..seeds)
                        .step_by(workers)
                        .filter(|n| home_wins_seed(home, away, *n))
                        .count()
                })
            })
            .collect();
        handles.into_iter().map(|handle| handle.join().expect("match worker")).sum()
    })
}

fn home_wins_seed(home: f64, away: f64, n: usize) -> bool {
    let store = SimLiveStoreState::default();
    let session_id = format!("attributes-{n}");
    init(
        &store,
        SimLiveInitRequest {
            session_id: session_id.clone(),
            seed: format!("attributes-seed-{n}"),
            snapshot: app_snapshot(home, away),
            champion_by_player_id: HashMap::new(),
            champion_profiles_by_id: HashMap::new(),
            champion_ultimates_by_id: HashMap::new(),
            initial_state: None,
            ai_mode: SimulatorAiMode::default(),
            policy: SimulatorPolicyConfig::default(),
        },
    )
    .expect("init");
    skip_to_end(
        &store,
        SimLiveSkipToEndRequest {
            session_id: session_id.clone(),
            dt_sec: 0.2,
            speed: 12.0,
            max_ticks: FULL_MATCH_TICKS,
        },
    )
    .expect("skip");
    let sessions = store.sessions.lock().expect("lock");
    sessions[&session_id].state.winner.as_deref() == Some("blue")
}

/// Seeds of the strength check. The win rate of the team of 90s is 88 to 90% (85 and 86 of 96 on
/// the engine before and after SIM-16), so the old 7 of 8 (87.5%) was a coin flip on 8 seeds.
/// The check keeps the same share (84 of 96) on the first 96 seeds, which the cores play at once.
const STRENGTH_SEEDS: usize = 96;
const STRENGTH_MIN_WINS: usize = 84;

#[test]
fn a_team_of_90s_beats_a_team_of_60s_in_a_snapshot_with_the_apps_names() {
    let won = home_wins_of(90.0, 60.0, STRENGTH_SEEDS);
    assert!(won >= STRENGTH_MIN_WINS, "the team of 90s won only {won} of {STRENGTH_SEEDS} against 60s");
}

#[test]
fn the_same_two_teams_swapped_give_the_opposite_result() {
    let seeds = 8;
    let won = home_wins_of(60.0, 90.0, seeds);
    assert!(won <= 1, "the team of 60s won {won} of {seeds} against 90s");
}

/// Prints how often the team of 90s wins against the team of 60s over `ECON_N` seeds (default 72).
#[test]
#[ignore = "measurement report; run with --ignored --nocapture (ECON_N sets the match count)"]
fn print_strength_win_rate() {
    let seeds = super::economy_tests::batch_size(72);
    let won = home_wins_of(90.0, 60.0, seeds);
    println!("the team of 90s won {won} of {seeds} against 60s ({:.1}%)", won as f64 / seeds as f64 * 100.0);
}
