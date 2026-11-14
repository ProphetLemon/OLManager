//! Per-role parity between the live engine (`sim_live`, the match the user watches) and the
//! background engine (`engine::simulate_lol`, every unwatched match) on the same two rosters and
//! the same seed numbers. It reads only the public results and changes no rule, so later rounds
//! can see when the two drift apart.
//!
//! ```text
//! CAPTURED_INIT=/path/to/init-1.json CAPTURED_N=100 CAPTURED_SEED=0 \
//!   cargo test --release -p olm_core --lib \
//!   sim_live::engine_parity_tests::print_per_role_parity -- --ignored --nocapture
//! ```
//!
//! The rosters are the captured init's `snapshot.home_team` (blue in the live engine) and
//! `snapshot.away_team` (red). Both engines play the same players: the live engine through the
//! captured start, the background engine through `TeamData` built from the same snapshot, with
//! the default `MatchConfig`. Seed number `i` is `StdRng::seed_from_u64(i)` there and
//! `<captured seed>-<i>` in the live replay. Gold is earned gold (current plus spent) in both.

use std::collections::BTreeMap;

use rand::SeedableRng;
use rand::rngs::StdRng;
use serde_json::Value;

use crate::engine::{DraftStrategy, MatchConfig, PlayerData, TeamData, simulate_lol};

use super::*;

const TICK_DT_SEC: f64 = 0.05;
const TICK_SPEED: f64 = 12.0;
/// A live match that reaches this game time without a winner is stopped and still counted.
const GAME_LIMIT_SEC: f64 = 75.0 * 60.0;
const ROLE_ORDER: [&str; 5] = ["TOP", "JGL", "MID", "ADC", "SUP"];

/// One player's line in one match.
#[derive(Clone, Copy, Default)]
struct Line {
    kills: f64,
    deaths: f64,
    assists: f64,
    cs: f64,
    gold: f64,
}

/// What one engine reported for one match: a line per role slot and the match length in minutes.
struct Outcome {
    lines: Vec<(&'static str, Line)>,
    minutes: f64,
}

fn env_or<T: std::str::FromStr>(name: &str, default: T) -> T {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

fn load_request(path: &str) -> SimLiveInitRequest {
    let text = std::fs::read_to_string(path).unwrap_or_else(|e| panic!("cannot read {path}: {e}"));
    let json: Value = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{path} is not JSON: {e}"));
    let request = match json.get("request") {
        Some(inner) if inner.is_object() => inner.clone(),
        _ => json,
    };
    serde_json::from_value(request).unwrap_or_else(|e| panic!("{path} is not a sim_live_init request: {e}"))
}

fn roster(snapshot: &Value, side: &str, id: &str) -> TeamData {
    let players = snapshot[side]["players"]
        .as_array()
        .unwrap_or_else(|| panic!("snapshot.{side}.players is missing"))
        .iter()
        .map(|player| serde_json::from_value::<PlayerData>(player.clone()).expect("a roster player"))
        .collect();
    TeamData {
        id: id.to_string(),
        name: id.to_string(),
        draft_strategy: DraftStrategy::default(),
        players,
    }
}

fn role_slot(role: &str) -> Option<&'static str> {
    let upper = role.to_uppercase();
    match upper.as_str() {
        "TOP" => Some("TOP"),
        "JGL" | "JUNGLE" => Some("JGL"),
        "MID" => Some("MID"),
        "ADC" => Some("ADC"),
        "SUP" | "SUPPORT" => Some("SUP"),
        _ => None,
    }
}

fn play_live(template: &SimLiveInitRequest, n: usize) -> Outcome {
    let mut request = template.clone();
    request.session_id = format!("parity-live-{n}");
    request.seed = format!("{}-{n}", template.seed);
    let session_id = request.session_id.clone();
    let store = SimLiveStoreState::default();
    init(&store, request).expect("init");
    loop {
        tick(
            &store,
            SimLiveTickRequest {
                session_id: session_id.clone(),
                dt_sec: TICK_DT_SEC,
                running: true,
                speed: TICK_SPEED,
            },
        )
        .expect("tick");
        let sessions = store.sessions.lock().expect("lock");
        let state = &sessions[&session_id].state;
        if state.winner.is_some() || state.time_sec >= GAME_LIMIT_SEC {
            break;
        }
    }
    let sessions = store.sessions.lock().expect("lock");
    let state = &sessions[&session_id].state;
    Outcome {
        lines: state
            .champions
            .iter()
            .filter_map(|c| {
                let slot = role_slot(&c.role)?;
                Some((
                    slot,
                    Line {
                        kills: c.kills as f64,
                        deaths: c.deaths as f64,
                        assists: c.assists as f64,
                        cs: c.cs as f64,
                        gold: (c.gold + c.spent_gold) as f64,
                    },
                ))
            })
            .collect(),
        minutes: state.time_sec / 60.0,
    }
}

fn play_background(home: &TeamData, away: &TeamData, n: usize) -> Outcome {
    let mut rng = StdRng::seed_from_u64(n as u64);
    let report = simulate_lol(home, away, &MatchConfig::default(), &mut rng);
    Outcome {
        lines: report
            .player_stats
            .values()
            .filter_map(|stats| {
                let slot = role_slot(&format!("{:?}", stats.role?))?;
                Some((
                    slot,
                    Line {
                        kills: f64::from(stats.kills),
                        deaths: f64::from(stats.deaths),
                        assists: f64::from(stats.assists),
                        cs: f64::from(stats.creep_score),
                        gold: f64::from(stats.gold_earned),
                    },
                ))
            })
            .collect(),
        minutes: f64::from(report.game_duration_seconds) / 60.0,
    }
}

/// Mean line per role slot over the matches, and the mean match length.
fn per_role(outcomes: &[Outcome]) -> (BTreeMap<&'static str, (Line, f64)>, f64) {
    let mut total: BTreeMap<&'static str, (Line, f64)> = BTreeMap::new();
    for outcome in outcomes {
        for (slot, line) in &outcome.lines {
            let entry = total.entry(slot).or_default();
            entry.0.kills += line.kills;
            entry.0.deaths += line.deaths;
            entry.0.assists += line.assists;
            entry.0.cs += line.cs;
            entry.0.gold += line.gold;
            entry.1 += 1.0;
        }
    }
    let minutes = outcomes.iter().map(|o| o.minutes).sum::<f64>() / outcomes.len().max(1) as f64;
    let means = total
        .into_iter()
        .map(|(slot, (sum, count))| {
            let c = count.max(1.0);
            (
                slot,
                (
                    Line {
                        kills: sum.kills / c,
                        deaths: sum.deaths / c,
                        assists: sum.assists / c,
                        cs: sum.cs / c,
                        gold: sum.gold / c,
                    },
                    count,
                ),
            )
        })
        .collect();
    (means, minutes)
}

fn print_engine(name: &str, outcomes: &[Outcome]) {
    let (means, minutes) = per_role(outcomes);
    println!("{name}: {} matches, mean length {minutes:.2} min", outcomes.len());
    println!("  role   kills  deaths  assists     cs      gold");
    for slot in ROLE_ORDER {
        if let Some((line, _)) = means.get(slot) {
            println!(
                "  {slot:<4} {:>6.2} {:>7.2} {:>8.2} {:>6.1} {:>9.0}",
                line.kills, line.deaths, line.assists, line.cs, line.gold
            );
        }
    }
}

#[test]
#[ignore = "measurement: per-role K/D/A, CS and gold of the live and the background engine on one captured roster pair; set CAPTURED_INIT"]
fn print_per_role_parity() {
    let path = std::env::var("CAPTURED_INIT")
        .expect("CAPTURED_INIT must be the path of the captured sim_live_init args (init-<n>.json)");
    let template = load_request(&path);
    let n: usize = env_or("CAPTURED_N", 100);
    let first: usize = env_or("CAPTURED_SEED", 0);
    assert!(n > 0, "CAPTURED_N must be at least 1");
    let home = roster(&template.snapshot, "home_team", "blue");
    let away = roster(&template.snapshot, "away_team", "red");

    let workers = std::thread::available_parallelism().map(|c| c.get()).unwrap_or(4).min(n);
    let (live, background): (Vec<_>, Vec<_>) = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..workers)
            .map(|worker| {
                let (template, home, away) = (&template, &home, &away);
                scope.spawn(move || {
                    (worker..n)
                        .step_by(workers)
                        .map(|i| (play_live(template, first + i), play_background(home, away, first + i)))
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        handles
            .into_iter()
            .flat_map(|handle| handle.join().expect("worker"))
            .unzip()
    });

    println!("parity on {path}, seeds {first}..{}", first + n);
    print_engine("live", &live);
    print_engine("background", &background);
    println!("  role  live/background ratio: kills deaths assists cs gold");
    let (a, _) = per_role(&live);
    let (b, _) = per_role(&background);
    for slot in ROLE_ORDER {
        if let (Some((x, _)), Some((y, _))) = (a.get(slot), b.get(slot)) {
            let ratio = |p: f64, q: f64| if q > 0.0 { p / q } else { f64::NAN };
            println!(
                "  {slot:<4} {:>6.2} {:>6.2} {:>7.2} {:>5.2} {:>5.2}",
                ratio(x.kills, y.kills),
                ratio(x.deaths, y.deaths),
                ratio(x.assists, y.assists),
                ratio(x.cs, y.cs),
                ratio(x.gold, y.gold)
            );
        }
    }
}
