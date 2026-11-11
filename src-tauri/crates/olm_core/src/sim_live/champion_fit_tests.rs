//! Champion catalogue data in the live simulator: roles and class tags.

use std::collections::HashMap;

use super::champion_fit::{champion_info, champion_plays_role, OFF_ROLE_EDGE_PENALTY};
use super::strength_tests::{hit_damage, with_scores};
use super::economy_tests::{batch_size, snapshot_with, Side, FULL_MATCH_TICKS, ROLES};
use super::*;

fn catalogue_ids() -> Vec<String> {
    let list: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../../assets/simulation/champion-list.json"
    ))
    .expect("champion list");
    list["champions"]
        .as_array()
        .expect("champions")
        .iter()
        .map(|entry| entry["id"].as_str().expect("id").to_string())
        .collect()
}

fn lineup(prefix: &str, jungler: &str) -> HashMap<String, String> {
    let picks = ["Aatrox", jungler, "Orianna", "Jinx", "Thresh"];
    ROLES
        .iter()
        .zip(picks)
        .map(|(role, champion)| (format!("{prefix}-{role}"), champion.to_string()))
        .collect()
}

fn init_request(
    session_id: &str,
    seed: String,
    champions: HashMap<String, String>,
) -> SimLiveInitRequest {
    SimLiveInitRequest {
        session_id: session_id.to_string(),
        seed,
        snapshot: snapshot_with(Side::EVEN, Side::EVEN),
        champion_by_player_id: champions,
        champion_profiles_by_id: HashMap::new(),
        champion_ultimates_by_id: HashMap::new(),
        initial_state: None,
        ai_mode: SimulatorAiMode::default(),
        policy: SimulatorPolicyConfig::default(),
    }
}

fn role_edges(champions: HashMap<String, String>) -> HashMap<String, f64> {
    let store = SimLiveStoreState::default();
    init(&store, init_request("fit-edges", "fit-edges".to_string(), champions)).expect("init");
    let sessions = store.sessions.lock().expect("lock");
    sessions["fit-edges"]
        .state
        .champions
        .iter()
        .map(|c| (c.id.clone(), c.role_edge))
        .collect()
}

#[test]
fn every_catalogue_champion_has_roles_and_class_tags() {
    for id in catalogue_ids() {
        let info = champion_info(&id).unwrap_or_else(|| panic!("{id} missing from the catalogue"));
        assert!(!info.tags.is_empty(), "{id} has no class tags");
        assert!(
            ROLES.iter().any(|role| champion_plays_role(&id, role) == Some(true)),
            "{id} has no role"
        );
    }
}

#[test]
fn a_champion_outside_its_roles_loses_role_edge_in_the_match() {
    // Gnar is a top laner only.
    let edges = role_edges(lineup("h", "Gnar"));
    assert_eq!(edges["h-JGL"], -OFF_ROLE_EDGE_PENALTY);
}

#[test]
fn a_champion_in_one_of_its_roles_keeps_its_role_edge() {
    let edges = role_edges(lineup("h", "LeeSin"));
    assert!(edges.values().all(|edge| *edge == 0.0), "{edges:?}");
}

#[test]
fn an_unknown_champion_is_not_penalised() {
    let edges = role_edges(lineup("h", "NotAChampion"));
    assert_eq!(edges["h-JGL"], 0.0);
}

#[test]
fn off_role_duel_deals_less_damage_than_an_even_champion() {
    let even = with_scores(70.0);
    let mut off_role = with_scores(70.0);
    off_role.role_edge = -OFF_ROLE_EDGE_PENALTY;
    let ratio = hit_damage(&off_role, &even) / hit_damage(&even, &even);
    assert!((0.85..=0.92).contains(&ratio), "damage dealt ratio {ratio:.3}");
}

#[test]
fn off_role_duel_takes_more_damage_than_an_even_champion() {
    let even = with_scores(70.0);
    let mut off_role = with_scores(70.0);
    off_role.role_edge = -OFF_ROLE_EDGE_PENALTY;
    let ratio = hit_damage(&even, &off_role) / hit_damage(&even, &even);
    assert!((1.08..=1.18).contains(&ratio), "damage taken ratio {ratio:.3}");
}

/// The penalised team's jungler plays `Gnar` (top only) against `LeeSin`; every
/// other champion is on role and the same on both sides. `manual_edge` replaces
/// the shipped penalty with a fixed role edge on a legal jungler (used by the sweep).
fn run_penalised(n: usize, penalised_on_blue: bool, manual_edge: Option<f64>) -> bool {
    let n = n + seed_base();
    let jungler = if manual_edge.is_some() { "LeeSin" } else { "Gnar" };
    let (blue, red) = if penalised_on_blue {
        (lineup("h", jungler), lineup("a", "LeeSin"))
    } else {
        (lineup("h", "LeeSin"), lineup("a", jungler))
    };
    let mut champions = blue;
    champions.extend(red);
    let store = SimLiveStoreState::default();
    let session_id = format!("fit-{n}");
    init(&store, init_request(&session_id, format!("fit-seed-{n}"), champions)).expect("init");
    if let Some(edge) = manual_edge {
        let target = if penalised_on_blue { "h-JGL" } else { "a-JGL" };
        let mut sessions = store.sessions.lock().expect("lock");
        let state = &mut sessions.get_mut(&session_id).expect("session").state;
        state
            .champions
            .iter_mut()
            .find(|c| c.id == target)
            .expect("jungler")
            .role_edge = -edge;
    }
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
    let winner = sessions[&session_id].state.winner.clone();
    winner.as_deref() == Some(if penalised_on_blue { "blue" } else { "red" })
}

/// First seed of the sweep (`SWEEP_SEED_BASE`, default 0), so one measurement can be split into runs.
fn seed_base() -> usize {
    std::env::var("SWEEP_SEED_BASE")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0)
}

/// Matches won by the team with one off-role jungler, `per_side` matches
/// with it on blue and `per_side` with it on red, spread over the cores.
fn penalised_wins(per_side: usize, manual_edge: Option<f64>) -> usize {
    let total = per_side * 2;
    let workers = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .min(total);
    std::thread::scope(|scope| {
        let handles: Vec<_> = (0..workers)
            .map(|worker| {
                scope.spawn(move || {
                    (worker..total)
                        .step_by(workers)
                        .filter(|n| run_penalised(*n, *n < per_side, manual_edge))
                        .count()
                })
            })
            .collect();
        handles
            .into_iter()
            .map(|handle| handle.join().expect("match worker"))
            .sum()
    })
}

/// Measurement behind `OFF_ROLE_EDGE_PENALTY`: even teams, one jungler off role,
/// the penalised team's win rate over `2 * ECON_N` seeded matches (default 160
/// per side, 320 in all). `SWEEP_PENALTIES` lists the role-edge penalties to run
/// (default `0,1,2,3,4`; the word `shipped` runs the real Gnar-in-the-jungle path)
/// and `SWEEP_SEED_BASE` shifts the seeds so a long measurement can be split.
/// Run it in release: `cargo test --release -p olm_core --lib
/// sim_live::champion_fit_tests::off_role_penalty_sweep -- --ignored --nocapture`.
#[test]
#[ignore = "slow: several hundred full matches per penalty; run when changing the off-role penalty"]
fn off_role_penalty_sweep() {
    let per_side = batch_size(160);
    let wanted = std::env::var("SWEEP_PENALTIES").unwrap_or_else(|_| "0,1,2,3,4".to_string());
    for item in wanted.split(',') {
        let (label, manual) = match item.trim() {
            "shipped" => (format!("shipped path (penalty {OFF_ROLE_EDGE_PENALTY})"), None),
            value => {
                let penalty: f64 = value.parse().expect("penalty");
                (format!("role edge -{penalty:.0} on one jungler"), Some(penalty))
            }
        };
        let wins = penalised_wins(per_side, manual);
        println!(
            "{label}: {wins} wins of {} matches ({:.1}%)",
            per_side * 2,
            wins as f64 / (per_side * 2) as f64 * 100.0
        );
    }
}
