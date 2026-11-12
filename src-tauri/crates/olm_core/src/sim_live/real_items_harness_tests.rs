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
    seed: usize,
    a_won: bool,
    minutes: f64,
    kills: f64,
    team_gold_per_min: f64,
    role_share: Vec<(String, f64)>,
    items_per_champion: f64,
    /// Kills of the winner and of the loser; `None` when the match reached the step limit.
    winner_loser_kills: Option<(i64, i64)>,
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
    let (blue_kills, red_kills) = (state.stats.blue.kills as i64, state.stats.red.kills as i64);
    let winner_loser_kills = match state.winner.as_deref() {
        Some("blue") => Some((blue_kills, red_kills)),
        Some("red") => Some((red_kills, blue_kills)),
        _ => None,
    };
    Played {
        seed: n,
        winner_loser_kills,
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
    let mut lengths: Vec<f64> = played.iter().map(|p| p.minutes).collect();
    lengths.sort_by(f64::total_cmp);
    let pick = |q: f64| lengths[((lengths.len() - 1) as f64 * q).round() as usize];
    println!("minutes p10 {:.1} p50 {:.1} p90 {:.1}", pick(0.1), pick(0.5), pick(0.9));
    println!(
        "matches of 50 minutes or more {}",
        lengths.iter().filter(|minutes| **minutes >= 50.0).count()
    );
    let decided: Vec<(i64, i64)> = played.iter().filter_map(|p| p.winner_loser_kills).collect();
    println!("undecided at the step limit {}", played.len() - decided.len());
    println!(
        "lost with a lead of 20 or more kills {} of {} decided",
        decided.iter().filter(|(winner, loser)| loser - winner >= 20).count(),
        decided.len()
    );
    for p in &played {
        if let Some((winner, loser)) = p.winner_loser_kills
            && loser - winner >= 20
        {
            println!("lost lead seed {} winner kills {winner} loser kills {loser} minutes {:.1}", p.seed, p.minutes);
        }
    }
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

/// Items in the order they are bought: boots first, then table order.
fn purchase_order(plan: &[ItemTemplate; 6]) -> Vec<&ItemTemplate> {
    let (boots, rest): (Vec<_>, Vec<_>) = plan.iter().partition(|t| is_boots_item_key(t.key));
    boots.into_iter().chain(rest).collect()
}

#[test]
#[ignore = "writes the old and new purchase sequence of every champion and role to $DUMP_PATH"]
fn dump_purchase_sequences() {
    let mut out = String::from("champion,role,pro,old_new,sequence\n");
    for id in catalogue_ids() {
        for role in ROLES {
            let old = category_plan(classify_item_build(role, &id));
            let new = champion_item_plan(role, &id);
            let pro = u8::from(!std::ptr::eq(old, new));
            for (label, plan) in [("old", old), ("new", new)] {
                let seq: Vec<String> = purchase_order(plan)
                    .iter()
                    .map(|t| format!("{}:{}:{}", t.cost, t.attack_damage, t.max_hp))
                    .collect();
                out.push_str(&format!("{id},{role},{pro},{label},{}\n", seq.join(" ")));
            }
        }
    }
    std::fs::write(std::env::var("DUMP_PATH").expect("DUMP_PATH"), out).expect("write");
}

fn champion_line(c: &ChampionRuntime) -> String {
    if c.alive {
        format!(
            "{}@{:.2},{:.2} {} {:.0}%",
            c.role,
            c.pos.x,
            c.pos.y,
            c.state,
            c.hp / c.max_hp.max(1.0) * 100.0
        )
    } else {
        format!("{}:dead(back {:.0}s)", c.role, c.respawn_at)
    }
}

/// Plays one match of the harness minute by minute and prints kills, structures, gold, where
/// the champions are and the enemy minions standing at each living structure.
///
/// ```text
/// REAL_ITEMS_TRACE_SEED=1042 REAL_ITEMS_PAIR=70,70 cargo test --release -p olm_core --lib \
///   sim_live::real_items_harness_tests::trace_real_match -- --ignored --nocapture
/// ```
#[test]
#[ignore = "measurement: traces one match with real champions"]
fn trace_real_match() {
    let n: usize = env_or("REAL_ITEMS_TRACE_SEED", 1000);
    let pair = std::env::var("REAL_ITEMS_PAIR").unwrap_or_else(|_| "70,70".to_string());
    let (a, b) = pair.split_once(',').expect("REAL_ITEMS_PAIR=a,b");
    let (team_a, team_b) = (
        Side::stat(a.parse().expect("stat a")),
        Side::stat(b.parse().expect("stat b")),
    );
    let ids = catalogue_ids();
    let a_is_blue = n.is_multiple_of(2);
    let (blue, red) = if a_is_blue { (team_a, team_b) } else { (team_b, team_a) };
    println!("seed {n}: team A (stat {a}) is {}", if a_is_blue { "blue" } else { "red" });
    let mut champions = real_lineup(n as u64, "h", &ids);
    champions.extend(real_lineup(n as u64, "a", &ids));
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
    let mut alive_before: Vec<String> = Vec::new();
    let mut last_minute = -1_i64;
    for _ in 0..(FULL_MATCH_TICKS / 10) {
        skip_to_end(
            &store,
            SimLiveSkipToEndRequest {
                session_id: session_id.clone(),
                dt_sec: 0.2,
                speed: 12.0,
                max_ticks: 10,
            },
        )
        .expect("skip");
        let sessions = store.sessions.lock().expect("lock");
        let state = &sessions[&session_id].state;
        let alive_now: Vec<String> = state
            .structures
            .iter()
            .filter(|s| s.alive && s.kind != "nexus")
            .map(|s| s.id.clone())
            .collect();
        for id in alive_before.iter().filter(|id| !alive_now.contains(id)) {
            println!(
                "  t={:.0}s {id} falls | kills {}-{} | blue [{}] | red [{}]",
                state.time_sec,
                state.stats.blue.kills,
                state.stats.red.kills,
                state.champions.iter().filter(|c| c.team == "blue").map(champion_line).collect::<Vec<_>>().join("; "),
                state.champions.iter().filter(|c| c.team == "red").map(champion_line).collect::<Vec<_>>().join("; "),
            );
        }
        alive_before = alive_now;
        let minute = (state.time_sec / 60.0) as i64;
        if minute != last_minute {
            last_minute = minute;
            let gold = |team: &str| -> i64 {
                state.champions.iter().filter(|c| c.team == team).map(|c| c.gold + c.spent_gold).sum()
            };
            let alive = |team: &str| state.champions.iter().filter(|c| c.team == team && c.alive).count();
            let piles: Vec<String> = state
                .structures
                .iter()
                .filter(|s| s.alive && s.kind == "tower")
                .filter_map(|s| {
                    let count = state
                        .minions
                        .iter()
                        .filter(|m| m.alive && m.team != s.team && dist(m.pos, s.pos) <= 0.09)
                        .count();
                    (count >= 4).then(|| format!("{}:{count}", s.id))
                })
                .collect();
            println!(
                "m{minute:02} kills {}-{} towers {}-{} gold {}-{} alive {}-{} piles [{}]",
                state.stats.blue.kills,
                state.stats.red.kills,
                state.stats.blue.towers,
                state.stats.red.towers,
                gold("blue"),
                gold("red"),
                alive("blue"),
                alive("red"),
                piles.join(" ")
            );
        }
        if state.winner.is_some() {
            println!("winner {:?} at {:.1} min", state.winner, state.time_sec / 60.0);
            break;
        }
    }
}
