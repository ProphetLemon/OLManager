//! The gold ledger must account for every unit of gold and stay out of the
//! serialized state. The proof that it does not change the simulation is the
//! fingerprint comparison in `economy_fingerprint_tests.rs`.

use std::collections::HashMap;

use super::economy_tests::{snapshot_with, Side};
use super::gold_ledger::{GoldLedger, GoldSource};
use super::*;

/// 12 simulated minutes: 1200 ticks of 0.6 s.
const TWELVE_MINUTES_TICKS: u64 = 1200;

fn run_until(seed: &str, ticks: u64) -> (SimLiveStoreState, String, HashMap<String, i64>) {
    let store = SimLiveStoreState::default();
    let session_id = format!("ledger-{seed}");
    init(
        &store,
        SimLiveInitRequest {
            session_id: session_id.clone(),
            seed: seed.to_string(),
            snapshot: snapshot_with(Side::EVEN, Side::EVEN),
            champion_by_player_id: HashMap::new(),
            champion_profiles_by_id: HashMap::new(),
            champion_ultimates_by_id: HashMap::new(),
            initial_state: None,
            ai_mode: SimulatorAiMode::default(),
            policy: SimulatorPolicyConfig::default(),
        },
    )
    .expect("init");
    let start_gold: HashMap<String, i64> = store.sessions.lock().expect("lock")[&session_id]
        .state
        .champions
        .iter()
        .map(|c| (c.id.clone(), c.gold + c.spent_gold))
        .collect();
    skip_to_end(
        &store,
        SimLiveSkipToEndRequest {
            session_id: session_id.clone(),
            dt_sec: 0.2,
            speed: 12.0,
            max_ticks: ticks,
        },
    )
    .expect("skip");
    (store, session_id, start_gold)
}

#[test]
fn ledger_accounts_for_all_gold_earned_by_every_champion() {
    for seed in ["ledger-a", "ledger-b"] {
        let (store, session_id, start_gold) = run_until(seed, TWELVE_MINUTES_TICKS);
        let sessions = store.sessions.lock().expect("lock");
        let state = &sessions[&session_id].state;
        for champion in &state.champions {
            let earned = champion.gold + champion.spent_gold - start_gold[&champion.id];
            let ledgered = state.gold_ledger.tally(&champion.id).total();
            assert_eq!(
                ledgered, earned,
                "{seed}: {} earned {earned} but the ledger holds {ledgered}",
                champion.id
            );
        }
    }
}

#[test]
fn ledger_matches_the_team_gold_counter() {
    let (store, session_id, start_gold) = run_until("ledger-team", TWELVE_MINUTES_TICKS);
    let sessions = store.sessions.lock().expect("lock");
    let state = &sessions[&session_id].state;
    for (team, counter) in [("blue", state.stats.blue.gold), ("red", state.stats.red.gold)] {
        let start: i64 = state
            .champions
            .iter()
            .filter(|c| c.team == team)
            .map(|c| start_gold[&c.id])
            .sum();
        let ledgered: i64 = state
            .champions
            .iter()
            .filter(|c| c.team == team)
            .map(|c| state.gold_ledger.tally(&c.id).total())
            .sum();
        assert_eq!(counter, 2500 + ledgered, "{team} team counter");
        assert_eq!(start, 2500, "{team} starting gold");
    }
}

#[test]
fn ledger_sees_minions_camps_and_kills_in_twelve_minutes() {
    let (store, session_id, _) = run_until("ledger-sources", TWELVE_MINUTES_TICKS);
    let sessions = store.sessions.lock().expect("lock");
    let state = &sessions[&session_id].state;
    for source in [GoldSource::LaneMinion, GoldSource::JungleCamp] {
        let gold: i64 = state
            .champions
            .iter()
            .map(|c| state.gold_ledger.tally(&c.id).gold[source.index()])
            .sum();
        assert!(gold > 0, "no {} gold in 12 minutes", source.label());
    }
}

#[test]
fn ledger_is_not_part_of_the_serialized_state() {
    let (store, session_id, _) = run_until("ledger-serde", 60);
    let sessions = store.sessions.lock().expect("lock");
    let encoded = serde_json::to_string(&sessions[&session_id].state).expect("encode");
    assert!(!encoded.to_lowercase().contains("ledger"));
}

#[test]
fn record_ignores_empty_grants_and_counts_the_others() {
    let mut ledger = GoldLedger::default();
    ledger.record("x", GoldSource::Kill, 0);
    ledger.record("x", GoldSource::Kill, 250);
    ledger.record("x", GoldSource::Kill, 300);
    ledger.record("x", GoldSource::Tower, 125);
    let tally = ledger.tally("x");
    assert_eq!(tally.gold[GoldSource::Kill.index()], 550);
    assert_eq!(tally.grants[GoldSource::Kill.index()], 2);
    assert_eq!(tally.total(), 675);
    assert_eq!(ledger.tally("nobody").total(), 0);
}

#[test]
fn every_source_has_a_distinct_slot() {
    let mut seen = [false; GoldSource::COUNT];
    for source in GoldSource::ALL {
        assert!(!seen[source.index()], "{} repeated", source.label());
        seen[source.index()] = true;
    }
}
