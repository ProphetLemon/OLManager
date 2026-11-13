//! Per-role reference of the watched-match engine: full seeded matches, started the
//! way the app starts them, reduced to creep score per minute, assists, kills and
//! deaths per role plus the match duration. It reads only the final state and
//! changes no rule. The numbers are the live reference the background engine's
//! assists and creep score are calibrated against.
//!
//! ```text
//! ROLE_REF_CAPTURES=/path/init-1.json,/path/init-5.json ROLE_REF_N=300 ROLE_REF_SEED=400 \
//!   ROLE_REF_EVEN=400 \
//!   cargo test --release -p olm_core --lib \
//!   sim_live::role_reference_tests::print_live_role_reference -- --ignored --nocapture
//! ```
//!
//! Environment:
//! - `ROLE_REF_CAPTURES`: comma-separated `sim_live_init` args saved from the app (the same
//!   files `captured_replay_harness_tests` reads); empty means none.
//! - `ROLE_REF_N`: matches per capture (default 100).
//! - `ROLE_REF_EVEN`: matches from a hand-built start with two even teams (default 0).
//! - `ROLE_REF_SEED`: first seed number (default 400).
//!
//! Every match is driven by `tick` at `dt` 0.05 and speed 12 (one engine step per call), the
//! calls the Tauri command `sim_live_tick` makes.

use std::collections::{BTreeMap, HashMap};

use serde_json::Value;

use super::economy_tests::{ROLES, Side, snapshot_with};
use super::*;

/// A match that reaches this game time is counted as undecided and stops.
const GAME_LIMIT_SEC: f64 = 75.0 * 60.0;

/// What one champion did in one match.
struct Line {
    role: String,
    cs: f64,
    assists: f64,
    kills: f64,
    deaths: f64,
    minutes: f64,
}

struct Played {
    minutes: f64,
    decided: bool,
    lines: Vec<Line>,
}

fn env_or<T: std::str::FromStr>(name: &str, default: T) -> T {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

/// The request the frontend sent, from the saved invoke args or from a bare request.
fn load_captured_request(path: &str) -> Result<SimLiveInitRequest, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("cannot read {path}: {e}"))?;
    let json: Value =
        serde_json::from_str(&text).map_err(|e| format!("{path} is not JSON: {e}"))?;
    let request = match json.get("request") {
        Some(inner) if inner.is_object() => inner.clone(),
        _ => json,
    };
    serde_json::from_value(request)
        .map_err(|e| format!("{path} is not a sim_live_init request: {e}"))
}

/// Two even teams with no champion profiles: the start the economy harnesses build by hand.
fn even_request() -> SimLiveInitRequest {
    SimLiveInitRequest {
        session_id: "role-ref-even".to_string(),
        seed: "role-ref-even".to_string(),
        snapshot: snapshot_with(Side::EVEN, Side::EVEN),
        champion_by_player_id: HashMap::new(),
        champion_profiles_by_id: HashMap::new(),
        champion_ultimates_by_id: HashMap::new(),
        initial_state: None,
        ai_mode: SimulatorAiMode::default(),
        policy: SimulatorPolicyConfig::default(),
    }
}

fn play(n: usize, template: &SimLiveInitRequest) -> Played {
    let mut request = template.clone();
    request.session_id = format!("role-ref-{n}");
    request.seed = format!("{}-{n}", template.seed);
    let session_id = request.session_id.clone();
    let store = SimLiveStoreState::default();
    init(&store, request).expect("init");
    loop {
        tick(
            &store,
            SimLiveTickRequest {
                session_id: session_id.clone(),
                dt_sec: 0.05,
                running: true,
                speed: 12.0,
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
    let minutes = state.time_sec / 60.0;
    Played {
        minutes,
        decided: state.winner.is_some(),
        lines: state
            .champions
            .iter()
            .map(|c| Line {
                role: c.role.clone(),
                cs: c.cs as f64,
                assists: c.assists as f64,
                kills: c.kills as f64,
                deaths: c.deaths as f64,
                minutes,
            })
            .collect(),
    }
}

/// Plays seeds `first..first + count` of one start across the available cores.
fn play_batch(template: &SimLiveInitRequest, first: usize, count: usize) -> Vec<Played> {
    let workers = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .min(count.max(1));
    let mut played: Vec<(usize, Played)> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..workers)
            .map(|worker| {
                scope.spawn(move || {
                    (worker..count)
                        .step_by(workers)
                        .map(|i| (i, play(first + i, template)))
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        handles
            .into_iter()
            .flat_map(|handle| handle.join().expect("role reference worker"))
            .collect()
    });
    played.sort_by_key(|(i, _)| *i);
    played.into_iter().map(|(_, p)| p).collect()
}

fn mean(values: &[f64]) -> f64 {
    if values.is_empty() {
        0.0
    } else {
        values.iter().sum::<f64>() / values.len() as f64
    }
}

fn quantile(sorted: &[f64], q: f64) -> f64 {
    match sorted.len() {
        0 => 0.0,
        len => sorted[((len - 1) as f64 * q).round() as usize],
    }
}

fn print_table(label: &str, played: &[Played]) {
    let mut minutes: Vec<f64> = played.iter().map(|p| p.minutes).collect();
    minutes.sort_by(f64::total_cmp);
    let decided = played.iter().filter(|p| p.decided).count();
    let kills_per_match = mean(
        &played
            .iter()
            .map(|p| p.lines.iter().map(|l| l.kills).sum::<f64>())
            .collect::<Vec<_>>(),
    );
    println!(
        "== {label}: {} matches, {decided} decided, duration mean {:.2} min (p10 {:.1} p50 {:.1} p90 {:.1}), kills per match {:.2}",
        played.len(),
        mean(&minutes),
        quantile(&minutes, 0.1),
        quantile(&minutes, 0.5),
        quantile(&minutes, 0.9),
        kills_per_match
    );
    println!("role   cs/min  cs/match  assists  kills  deaths");
    let mut by_role: BTreeMap<usize, Vec<&Line>> = BTreeMap::new();
    for line in played.iter().flat_map(|p| p.lines.iter()) {
        let slot = ROLES
            .iter()
            .position(|r| *r == line.role)
            .unwrap_or(ROLES.len());
        by_role.entry(slot).or_default().push(line);
    }
    for (slot, lines) in by_role {
        let pick = |f: fn(&Line) -> f64| mean(&lines.iter().map(|l| f(l)).collect::<Vec<_>>());
        let cs_per_min = mean(
            &lines
                .iter()
                .map(|l| l.cs / l.minutes.max(1.0))
                .collect::<Vec<_>>(),
        );
        println!(
            "{:<5} {:>7.2} {:>9.1} {:>8.2} {:>6.2} {:>7.2}",
            ROLES.get(slot).copied().unwrap_or("?"),
            cs_per_min,
            pick(|l| l.cs),
            pick(|l| l.assists),
            pick(|l| l.kills),
            pick(|l| l.deaths),
        );
    }
}

#[test]
#[ignore = "measurement report: full live matches take minutes; run with --ignored --nocapture"]
fn print_live_role_reference() {
    let first: usize = env_or("ROLE_REF_SEED", 400);
    let per_capture: usize = env_or("ROLE_REF_N", 100);
    let even: usize = env_or("ROLE_REF_EVEN", 0);
    let captures: Vec<String> = std::env::var("ROLE_REF_CAPTURES")
        .unwrap_or_default()
        .split(',')
        .filter(|path| !path.trim().is_empty())
        .map(|path| path.trim().to_string())
        .collect();

    let mut everything: Vec<Played> = Vec::new();
    for path in &captures {
        let template = load_captured_request(path).expect("captured start");
        let played = play_batch(&template, first, per_capture);
        print_table(path, &played);
        everything.extend(played);
    }
    if even > 0 {
        let played = play_batch(&even_request(), first, even);
        print_table("even synthetic start", &played);
        everything.extend(played);
    }
    if !everything.is_empty() {
        print_table("ALL STARTS POOLED", &everything);
    }
}
