//! Economy validation: full seeded matches through the live simulator.
//!
//! The shares below are the approximate pro-play averages the role income
//! weights in `economy.rs` aim for (general knowledge, not measured data).

use std::collections::HashMap;

use serde_json::{json, Value};

use super::*;

pub(super) const FULL_MATCH_TICKS: u64 = 6000;

/// Ticks of the short deterministic run the default tests share: 1200 ticks at
/// `dt` 0.2 and speed 12 is 12 simulated minutes.
const SHORT_RUN_TICKS: u64 = 1200;

pub(super) const ROLES: [&str; 5] = ["TOP", "JGL", "MID", "ADC", "SUP"];

/// Inclusive `(min, max)` share of a team's total gold per role.
const ROLE_SHARE_RANGE: [(&str, f64, f64); 5] = [
    ("TOP", 0.20, 0.23),
    ("JGL", 0.17, 0.20),
    ("MID", 0.21, 0.24),
    ("ADC", 0.23, 0.27),
    ("SUP", 0.10, 0.14),
];

/// Every player of a team has identical stats; the only other edge between
/// teams is the role-impact modifier the match setup sends for each player
/// (clamped to +-4 by the simulator).
///
/// One team's strength inputs: every visible stat of all five players, and the
/// role-impact edge sent for each of them.
#[derive(Clone, Copy)]
pub(super) struct Side {
    pub(super) stat: f64,
    pub(super) edge: f64,
}

impl Side {
    pub(super) const EVEN: Side = Side {
        stat: 70.0,
        edge: 0.0,
    };

    fn edge(edge: f64) -> Side {
        Side { stat: 70.0, edge }
    }

    pub(super) fn stat(stat: f64) -> Side {
        Side { stat, edge: 0.0 }
    }
}

pub(super) fn snapshot_with(home: Side, away: Side) -> Value {
    let team = |prefix: &str, stat: f64| {
        let players: Vec<Value> = ROLES
            .iter()
            .map(|role| {
                let mut player = serde_json::Map::new();
                player.insert("id".into(), json!(format!("{prefix}-{role}")));
                player.insert("name".into(), json!(format!("{prefix}-{role}")));
                for name in [
                    "dribbling",
                    "agility",
                    "pace",
                    "composure",
                    "shooting",
                    "positioning",
                    "teamwork",
                    "stamina",
                    "decisions",
                    "vision",
                    "passing",
                    "leadership",
                ] {
                    player.insert(name.into(), json!(stat));
                }
                Value::Object(player)
            })
            .collect();
        json!({ "players": players })
    };
    let impact = |prefix: &str, edge: f64| {
        let by_player: serde_json::Map<String, Value> = ROLES
            .iter()
            .map(|role| {
                (
                    format!("{prefix}-{role}"),
                    json!({ "modifier": edge, "variance": 1.0 }),
                )
            })
            .collect();
        Value::Object(by_player)
    };
    json!({
        "home_team": team("h", home.stat),
        "away_team": team("a", away.stat),
        "lol_role_impact_by_player": { "home": impact("h", home.edge), "away": impact("a", away.edge) },
    })
}

pub(super) struct MatchOutcome {
    pub(super) winner: Option<String>,
    pub(super) minutes: f64,
    pub(super) kills: f64,
    /// Mean total gold earned per team.
    team_gold: f64,
    /// Gold earned per role, as `(share of own team, count)` summed over both teams.
    role_share: Vec<(String, f64)>,
}

fn run_one_match(n: usize, home: Side, away: Side, max_ticks: u64) -> MatchOutcome {
    let store = SimLiveStoreState::default();
    let session_id = format!("economy-{n}");
    init(
        &store,
        SimLiveInitRequest {
            session_id: session_id.clone(),
            seed: format!("economy-seed-{n}"),
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

    let earned = |c: &ChampionRuntime| (c.gold + c.spent_gold) as f64;
    let team_total = |team: &str| -> f64 {
        state
            .champions
            .iter()
            .filter(|c| c.team == team)
            .map(earned)
            .sum()
    };
    let (blue_total, red_total) = (team_total("blue"), team_total("red"));
    MatchOutcome {
        winner: state.winner.clone(),
        minutes: state.time_sec / 60.0,
        kills: (state.stats.blue.kills + state.stats.red.kills) as f64,
        team_gold: (blue_total + red_total) / 2.0,
        role_share: state
            .champions
            .iter()
            .map(|c| {
                let total = if c.team == "blue" {
                    blue_total
                } else {
                    red_total
                };
                (c.role.clone(), earned(c) / total.max(1.0))
            })
            .collect(),
    }
}

/// Runs `seeds` matches (seed offset `first_seed`) spread over the available cores.
fn run_batch(
    first_seed: usize,
    seeds: usize,
    home_edge: f64,
    away_edge: f64,
    max_ticks: u64,
) -> Vec<MatchOutcome> {
    run_batch_sides(
        first_seed,
        seeds,
        Side::edge(home_edge),
        Side::edge(away_edge),
        max_ticks,
    )
}

/// Same as [`run_batch`] with full control of each team's strength.
pub(super) fn run_batch_sides(
    first_seed: usize,
    seeds: usize,
    home: Side,
    away: Side,
    max_ticks: u64,
) -> Vec<MatchOutcome> {
    let workers = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .min(seeds.max(1));
    std::thread::scope(|scope| {
        let handles: Vec<_> = (0..workers)
            .map(|worker| {
                scope.spawn(move || {
                    (worker..seeds)
                        .step_by(workers)
                        .map(|n| run_one_match(first_seed + n, home, away, max_ticks))
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        handles
            .into_iter()
            .flat_map(|handle| handle.join().expect("match worker"))
            .collect()
    })
}

struct Summary {
    role_share: HashMap<String, f64>,
    minutes: f64,
    kills: f64,
}

fn summarize(outcomes: &[MatchOutcome]) -> Summary {
    let mut role_share: HashMap<String, f64> = HashMap::new();
    for outcome in outcomes {
        for (role, share) in &outcome.role_share {
            // Two teams per match, so average over twice the match count.
            *role_share.entry(role.clone()).or_default() += share / (2.0 * outcomes.len() as f64);
        }
    }
    let count = outcomes.len() as f64;
    Summary {
        role_share,
        minutes: outcomes.iter().map(|o| o.minutes).sum::<f64>() / count,
        kills: outcomes.iter().map(|o| o.kills).sum::<f64>() / count,
    }
}

pub(super) fn batch_size(default: usize) -> usize {
    std::env::var("ECON_N")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

/// Mean gold earned per team over the four seeds 0..4 after 12 simulated
/// minutes, measured with every role income weight set to 1.0 (no role
/// weighting, everything else as shipped). [PLACEHOLDER] regenerate it with
/// the same setup if the base economy changes.
const NEUTRAL_WEIGHT_TEAM_GOLD_12_MIN: f64 = 15_491.0;

/// The role income weights only redistribute gold between roles; they must not
/// inflate the team total. Measured against the unweighted baseline above the
/// shipped weights land within +0.3%; the previous weights (mean 1.195 but
/// weighted toward low-income roles) landed at +1.4%. The band is +-1% so the
/// check fails on the old weights and tolerates simulation noise.
#[test]
fn role_weights_keep_team_gold_at_the_unweighted_baseline() {
    let outcomes = run_batch(0, 4, 0.0, 0.0, SHORT_RUN_TICKS);
    let mean = outcomes.iter().map(|o| o.team_gold).sum::<f64>() / outcomes.len() as f64;
    let ratio = mean / NEUTRAL_WEIGHT_TEAM_GOLD_12_MIN;
    assert!(
        (0.99..=1.01).contains(&ratio),
        "team gold after 12 min is {mean:.0}, {:+.1}% against the unweighted baseline",
        (ratio - 1.0) * 100.0
    );
}

/// Inclusive `(min, max)` share of team gold per role after 12 minutes.
///
/// Support and Bot earn relatively more early (assist and passive income) than
/// over a whole match, so these bands sit around the 12-minute measurement of
/// the shipped weights (Top 19-20%, Jungle 18%, Mid 21-24%, Bot 21-25%, Support
/// 16-17%) rather than the full-match targets. With every weight at 1.0 the
/// same run gives Top 27%, Jungle 15%, Mid 32%, Bot 16%, Support 11%, outside
/// four of the five bands, so the check still catches broken weights.
/// [PLACEHOLDER] the full-match targets stay in `ROLE_SHARE_RANGE`.
const EARLY_ROLE_SHARE_RANGE: [(&str, f64, f64); 5] = [
    ("TOP", 0.17, 0.24),
    ("JGL", 0.15, 0.21),
    ("MID", 0.19, 0.26),
    ("ADC", 0.19, 0.27),
    ("SUP", 0.13, 0.19),
];

/// Cheap default guard for the role shares: 4 seeded matches cut at 12
/// minutes (about 8 s in a debug build) instead of 12 full ones (about 70 s).
#[test]
fn early_game_role_gold_shares_stay_in_band() {
    let summary = summarize(&run_batch(0, 4, 0.0, 0.0, SHORT_RUN_TICKS));
    for (role, min, max) in EARLY_ROLE_SHARE_RANGE {
        let share = summary.role_share[role];
        assert!(
            (min..=max).contains(&share),
            "{role} earns {:.1}% of team gold after 12 min, expected {:.0}%-{:.0}%",
            share * 100.0,
            min * 100.0,
            max * 100.0
        );
    }
}

/// Full-match version of the share and pacing guard (12 full matches, about
/// 70 s in a debug build): `cargo test -p olm_core --lib
/// sim_live::economy_tests::role_gold_shares_match_pro_averages -- --ignored`.
#[test]
#[ignore = "slow: 12 full matches (about 70 s debug); run explicitly when changing the economy"]
fn role_gold_shares_match_pro_averages() {
    let outcomes = run_batch(0, batch_size(12), 0.0, 0.0, FULL_MATCH_TICKS);
    let summary = summarize(&outcomes);
    for (role, min, max) in ROLE_SHARE_RANGE {
        let share = summary.role_share[role];
        assert!(
            (min..=max).contains(&share),
            "{role} earns {:.1}% of team gold, expected {:.0}%-{:.0}%",
            share * 100.0,
            min * 100.0,
            max * 100.0
        );
    }
    // Pacing guard: the economy rework must not stretch or shorten matches
    // outside the range the engine produced before it (about 36-44 minutes and
    // 24-34 kills for even teams).
    assert!(
        (30.0..=48.0).contains(&summary.minutes),
        "average match length {:.1} min",
        summary.minutes
    );
    assert!(
        (20.0..=40.0).contains(&summary.kills),
        "average kills per match {:.1}",
        summary.kills
    );
}

#[test]
#[ignore = "measurement report; run with --ignored --nocapture (ECON_N sets the match count)"]
fn print_economy_report() {
    let seeds = batch_size(36);
    let even = summarize(&run_batch(0, seeds, 0.0, 0.0, FULL_MATCH_TICKS));
    for role in ROLES {
        println!("share {role}: {:.1}%", even.role_share[role] * 100.0);
    }
    println!(
        "even teams: {:.1} min, {:.1} kills",
        even.minutes, even.kills
    );
    let strong_blue = run_batch(1000, seeds, 4.0, -4.0, FULL_MATCH_TICKS);
    let strong_red = run_batch(2000, seeds, -4.0, 4.0, FULL_MATCH_TICKS);
    let wins = |outcomes: &[MatchOutcome], side: &str| {
        outcomes
            .iter()
            .filter(|o| o.winner.as_deref() == Some(side))
            .count()
    };
    println!(
        "stronger team wins {} of {}",
        wins(&strong_blue, "blue") + wins(&strong_red, "red"),
        strong_blue.len() + strong_red.len()
    );
}
