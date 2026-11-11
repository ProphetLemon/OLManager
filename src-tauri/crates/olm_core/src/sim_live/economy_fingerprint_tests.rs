//! Behaviour fingerprint of full seeded matches.
//!
//! The fingerprint holds everything the economy changes can move (winner,
//! duration, kills, and the final gold, kills, deaths, assists, creep score and
//! level of every champion). It is used to prove that a change which is meant
//! to be invisible to the simulation, such as the gold ledger, really is: run
//! the ignored test on both sides of the change and compare the two outputs.

use std::collections::HashMap;

use super::economy_tests::{snapshot_with, Side, FULL_MATCH_TICKS};
use super::*;

/// Seeds with even teams, then seeds with an 80 against 60 pairing.
const EVEN_SEEDS: usize = 24;
const UNEVEN_SEEDS: usize = 8;

/// One line per match, built only from state that exists before the ledger.
fn fingerprint_match(label: &str, n: usize, home: Side, away: Side, max_ticks: u64) -> String {
    let store = SimLiveStoreState::default();
    let session_id = format!("fingerprint-{label}-{n}");
    init(
        &store,
        SimLiveInitRequest {
            session_id: session_id.clone(),
            seed: format!("fingerprint-seed-{n}"),
            snapshot: snapshot_with(home, away),
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
            max_ticks,
        },
    )
    .expect("skip");
    let sessions = store.sessions.lock().expect("lock");
    let state = &sessions[&session_id].state;
    let champions: Vec<String> = state
        .champions
        .iter()
        .map(|c| {
            format!(
                "{}:{}/{}/{}/{}/cs{}/l{}",
                c.id,
                c.gold + c.spent_gold,
                c.kills,
                c.deaths,
                c.assists,
                c.cs,
                c.level
            )
        })
        .collect();
    format!(
        "{label} {n} winner={:?} t={:.3} kills={}+{} towers={}+{} {}",
        state.winner,
        state.time_sec,
        state.stats.blue.kills,
        state.stats.red.kills,
        state.stats.blue.towers,
        state.stats.red.towers,
        champions.join(" ")
    )
}

fn fingerprints(max_ticks: u64, even: usize, uneven: usize) -> Vec<String> {
    let jobs: Vec<(&'static str, usize, Side, Side)> = (0..even)
        .map(|n| ("even", n, Side::EVEN, Side::EVEN))
        .chain((0..uneven).map(|n| ("uneven", n, Side::stat(80.0), Side::stat(60.0))))
        .collect();
    let workers = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .min(jobs.len().max(1));
    let mut lines: Vec<String> = std::thread::scope(|scope| {
        let jobs = &jobs;
        let handles: Vec<_> = (0..workers)
            .map(|worker| {
                scope.spawn(move || {
                    (worker..jobs.len())
                        .step_by(workers)
                        .map(|i| {
                            let (label, n, home, away) = jobs[i];
                            fingerprint_match(label, n, home, away, max_ticks)
                        })
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        handles
            .into_iter()
            .flat_map(|handle| handle.join().expect("fingerprint worker"))
            .collect()
    });
    lines.sort();
    lines
}

#[test]
fn fingerprint_of_a_short_run_is_repeatable() {
    let first = fingerprints(300, 2, 1);
    let second = fingerprints(300, 2, 1);
    assert_eq!(first, second);
}

/// Prints one line per match; compare the output before and after a change
/// that must not alter the simulation:
/// `cargo test --release -p olm_core --lib sim_live::economy_fingerprint_tests::print_match_fingerprints -- --ignored --nocapture`
#[test]
#[ignore = "slow: 32 full matches; run explicitly to prove a change leaves the simulation untouched"]
fn print_match_fingerprints() {
    for line in fingerprints(FULL_MATCH_TICKS, EVEN_SEEDS, UNEVEN_SEEDS) {
        println!("FP {line}");
    }
}
