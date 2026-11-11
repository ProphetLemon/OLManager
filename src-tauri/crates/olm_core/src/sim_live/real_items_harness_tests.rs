//! Measurement of what the item build change does to a match with real
//! champions. The economy harness and the strength sweep play matches with no
//! champion ids, so every player there buys its role's class table; this one
//! gives every player a champion that plays its role, so the item choice runs
//! through the per-champion build. It reads only the public state and changes no
//! rule.
//!
//! ```text
//! REAL_ITEMS_N=100 REAL_ITEMS_SEED=0 REAL_ITEMS_PAIR=70,70 \
//!   cargo test --release -p olm_core --lib \
//!   sim_live::real_items_harness_tests::measure_real_lineups -- --ignored --nocapture
//! ```
//!
//! Environment: `REAL_ITEMS_N` matches (default 100), `REAL_ITEMS_SEED` first
//! seed (default 0), `REAL_ITEMS_PAIR` visible stat of team A and B (default
//! `70,70`; A is on blue in even seeds and on red in odd ones).

use std::collections::HashMap;

use super::champion_fit::champion_plays_role;
use super::economy_tests::{snapshot_with, Side, FULL_MATCH_TICKS, ROLES};
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

fn env_or<T: std::str::FromStr>(name: &str, default: T) -> T {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

/// Deterministic pick, independent of the order the platform iterates in.
fn mix(mut x: u64) -> u64 {
    x = x.wrapping_add(0x9E37_79B9_7F4A_7C15);
    x = (x ^ (x >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    x = (x ^ (x >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    x ^ (x >> 31)
}

/// One champion per player, each on one of its roles, drawn from the seed.
fn real_lineup(seed: u64, prefix: &str, ids: &[String]) -> HashMap<String, String> {
    ROLES
        .iter()
        .enumerate()
        .map(|(slot, role)| {
            let eligible: Vec<&String> = ids
                .iter()
                .filter(|id| champion_plays_role(id, role) == Some(true))
                .collect();
            let draw = mix(seed * 31 + slot as u64 * 7 + u64::from(prefix == "a"));
            (
                format!("{prefix}-{role}"),
                eligible[draw as usize % eligible.len()].clone(),
            )
        })
        .collect()
}

struct Played {
    a_won: bool,
    minutes: f64,
    kills: f64,
    team_gold_per_min: f64,
    role_share: Vec<(String, f64)>,
    items_per_champion: f64,
}

fn play(n: usize, team_a: Side, team_b: Side, ids: &[String]) -> Played {
    let a_is_blue = n.is_multiple_of(2);
    let (blue, red) = if a_is_blue { (team_a, team_b) } else { (team_b, team_a) };
    let mut champions = real_lineup(n as u64, "h", ids);
    champions.extend(real_lineup(n as u64, "a", ids));
    let store = SimLiveStoreState::default();
    let session_id = format!("real-items-{n}");
    init(
        &store,
        SimLiveInitRequest {
            session_id: session_id.clone(),
            seed: format!("real-items-seed-{n}"),
            snapshot: snapshot_with(blue, red),
            champion_by_player_id: champions,
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
    let state = &sessions[&session_id].state;
    let earned = |c: &ChampionRuntime| (c.gold + c.spent_gold) as f64;
    let team_total = |team: &str| -> f64 {
        state.champions.iter().filter(|c| c.team == team).map(earned).sum()
    };
    let (blue_total, red_total) = (team_total("blue"), team_total("red"));
    let minutes = state.time_sec / 60.0;
    let a_team = if a_is_blue { "blue" } else { "red" };
    Played {
        a_won: state.winner.as_deref() == Some(a_team),
        minutes,
        kills: (state.stats.blue.kills + state.stats.red.kills) as f64,
        team_gold_per_min: (blue_total + red_total) / 2.0 / minutes,
        role_share: state
            .champions
            .iter()
            .map(|c| {
                let total = if c.team == "blue" { blue_total } else { red_total };
                (c.role.clone(), earned(c) / total.max(1.0))
            })
            .collect(),
        items_per_champion: state.champions.iter().map(|c| c.items.len() as f64).sum::<f64>()
            / state.champions.len() as f64,
    }
}

#[test]
#[ignore = "measurement: plays N full matches with real champions; prints length, kills, gold and role shares"]
fn measure_real_lineups() {
    let n: usize = env_or("REAL_ITEMS_N", 100);
    let first: usize = env_or("REAL_ITEMS_SEED", 0);
    let pair = std::env::var("REAL_ITEMS_PAIR").unwrap_or_else(|_| "70,70".to_string());
    let (a, b) = pair.split_once(',').expect("REAL_ITEMS_PAIR=a,b");
    let team_a = Side::stat(a.parse().expect("stat a"));
    let team_b = Side::stat(b.parse().expect("stat b"));
    let ids = catalogue_ids();

    let workers = std::thread::available_parallelism().map(|c| c.get()).unwrap_or(4).min(n);
    let played: Vec<Played> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..workers)
            .map(|worker| {
                let ids = &ids;
                scope.spawn(move || {
                    (worker..n)
                        .step_by(workers)
                        .map(|i| play(first + i, team_a, team_b, ids))
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        handles
            .into_iter()
            .flat_map(|handle| handle.join().expect("match worker"))
            .collect()
    });

    let mean = |f: &dyn Fn(&Played) -> f64| played.iter().map(f).sum::<f64>() / played.len() as f64;
    println!("real lineups, {} matches, pair {pair}, first seed {first}", played.len());
    println!("minutes {:.2}", mean(&|p| p.minutes));
    println!("kills {:.2}", mean(&|p| p.kills));
    println!("team gold per minute {:.1}", mean(&|p| p.team_gold_per_min));
    println!("items per champion at the end {:.2}", mean(&|p| p.items_per_champion));
    println!(
        "team A wins {} of {} ({:.1}%)",
        played.iter().filter(|p| p.a_won).count(),
        played.len(),
        played.iter().filter(|p| p.a_won).count() as f64 / played.len() as f64 * 100.0
    );
    for role in ROLES {
        let shares: Vec<f64> = played
            .iter()
            .flat_map(|p| p.role_share.iter().filter(|(r, _)| r == role).map(|(_, s)| *s))
            .collect();
        println!("role share {role} {:.1}%", shares.iter().sum::<f64>() / shares.len() as f64 * 100.0);
    }
}
