//! Headless measurement of where the gold of a live match comes from.
//!
//! `measure_match_economy` plays seeded full matches through the same
//! `skip_to_end` path the other economy tests use (or the per-frame `tick`
//! path, `ECON_HARNESS_MODE=tick`), snapshots every champion at minutes 5 to 30
//! and at the end, and prints the tables that describe the economy: gold per
//! minute by role, the share of each gold source by role and phase, creep
//! score, the gold gap between the two players of a role, kills, blue against
//! red, and the stronger team against the weaker one. Nothing here changes a
//! rule: it only reads the state and the gold ledger.
//!
//! ```text
//! ECON_HARNESS_N=300 ECON_HARNESS_SEED=0 ECON_HARNESS_PAIR=70,70 \
//!   cargo test --release -p olm_core --lib \
//!   sim_live::economy_harness_tests::measure_match_economy -- --ignored --nocapture
//! ```
//!
//! Environment: `ECON_HARNESS_N` matches (default 300), `ECON_HARNESS_SEED`
//! first seed (default 0), `ECON_HARNESS_PAIR` visible stat of team A and B
//! (default `70,70`; with unequal stats A is the stronger side and is on blue
//! in even seeds and on red in odd seeds), `ECON_HARNESS_MODE` `skip`
//! (default) or `tick`, `ECON_HARNESS_RAW` optional path for one CSV row per
//! champion per snapshot.

use std::collections::HashMap;
use std::io::Write;

use super::economy_tests::{snapshot_with, Side, FULL_MATCH_TICKS, ROLES};
use super::gold_ledger::{GoldSource, SourceTally};
use super::*;

/// Checkpoint minutes at which every champion is snapshotted.
const CHECKPOINT_MINUTES: [u32; 6] = [5, 10, 15, 20, 25, 30];

/// Simulated seconds per tick: `dt_sec` 0.2 is clamped to 0.05 and scaled by speed 12.
const TICK_SEC: f64 = 0.6;

/// Source groups the tables print, in column order.
const SOURCE_GROUPS: [(&str, &[GoldSource]); 8] = [
    ("minion", &[GoldSource::LaneMinion]),
    ("camp", &[GoldSource::JungleCamp]),
    ("kill", &[GoldSource::Kill]),
    ("assist", &[GoldSource::Assist]),
    ("tower", &[GoldSource::Tower]),
    ("dragon", &[GoldSource::Dragon]),
    ("baron", &[GoldSource::Baron]),
    (
        "other",
        &[
            GoldSource::Herald,
            GoldSource::Voidgrub,
            GoldSource::Elder,
            GoldSource::OtherObjective,
        ],
    ),
];

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Drive {
    /// `skip_to_end` in chunks: macro decisions every third tick, as the other economy tests.
    Skip,
    /// One `tick` call per step: what the watched match does.
    Tick,
}

impl Drive {
    fn from_env() -> Drive {
        match std::env::var("ECON_HARNESS_MODE").as_deref() {
            Ok("tick") => Drive::Tick,
            _ => Drive::Skip,
        }
    }

    /// Tick count of each checkpoint. `skip_to_end` decides macro actions on
    /// every third tick counted from the start of each call, so a chunk must
    /// be a multiple of three ticks for a chunked run to equal a single call.
    fn checkpoint_ticks(self) -> [u64; 6] {
        CHECKPOINT_MINUTES.map(|minute| {
            let exact = (f64::from(minute) * 60.0 / TICK_SEC).round() as u64;
            match self {
                Drive::Tick => exact,
                Drive::Skip => exact.div_ceil(3) * 3,
            }
        })
    }
}

#[derive(Clone)]
struct ChampSnap {
    blue: bool,
    role: String,
    /// Gold plus spent gold, starting purse included.
    earned: i64,
    /// Gold earned since the start of the match.
    income: i64,
    cs: i64,
    kills: i64,
    assists: i64,
    tally: SourceTally,
}

#[derive(Clone)]
struct Snap {
    time_sec: f64,
    /// Towers destroyed so far by either team.
    towers_down: i64,
    blue_kills: i64,
    red_kills: i64,
    blue_towers: i64,
    red_towers: i64,
    champs: Vec<ChampSnap>,
}

struct Trace {
    seed: usize,
    /// Whether team A (the stronger side when stats differ) played blue.
    a_is_blue: bool,
    winner_is_a: Option<bool>,
    /// One entry per checkpoint minute; `None` when the match ended before it.
    checkpoints: Vec<Option<Snap>>,
    end: Snap,
}

impl Trace {
    fn minutes(&self) -> f64 {
        self.end.time_sec / 60.0
    }
}

fn init_session(store: &SimLiveStoreState, session_id: &str, seed: &str, blue: Side, red: Side) {
    init(
        store,
        SimLiveInitRequest {
            session_id: session_id.to_string(),
            seed: seed.to_string(),
            snapshot: snapshot_with(blue, red),
            champion_by_player_id: HashMap::new(),
            champion_profiles_by_id: HashMap::new(),
            champion_ultimates_by_id: HashMap::new(),
            initial_state: None,
            ai_mode: SimulatorAiMode::default(),
            policy: SimulatorPolicyConfig::default(),
        },
    )
    .expect("init");
}

fn skip_ticks(store: &SimLiveStoreState, session_id: &str, max_ticks: u64) {
    skip_to_end(
        store,
        SimLiveSkipToEndRequest {
            session_id: session_id.to_string(),
            dt_sec: 0.2,
            speed: 12.0,
            max_ticks,
        },
    )
    .expect("skip");
}

fn has_winner(store: &SimLiveStoreState, session_id: &str) -> bool {
    store.sessions.lock().expect("lock")[session_id]
        .state
        .winner
        .is_some()
}

/// Reads every champion; `start` holds the starting `earned` of each champion
/// in order (empty for the snapshot taken before the first tick).
fn snapshot(store: &SimLiveStoreState, session_id: &str, start: &[i64]) -> Snap {
    let sessions = store.sessions.lock().expect("lock");
    let state = &sessions[session_id].state;
    Snap {
        time_sec: state.time_sec,
        towers_down: state.stats.blue.towers + state.stats.red.towers,
        blue_kills: state.stats.blue.kills,
        red_kills: state.stats.red.kills,
        blue_towers: state.stats.blue.towers,
        red_towers: state.stats.red.towers,
        champs: state
            .champions
            .iter()
            .enumerate()
            .map(|(i, c)| {
                let earned = c.gold + c.spent_gold;
                ChampSnap {
                    blue: c.team == "blue",
                    role: c.role.clone(),
                    earned,
                    income: earned - start.get(i).copied().unwrap_or(earned),
                    cs: c.cs,
                    kills: c.kills,
                    assists: c.assists,
                    tally: state.gold_ledger.tally(&c.id),
                }
            })
            .collect(),
    }
}

fn run_trace(
    seed: usize,
    drive: Drive,
    team_a: Side,
    team_b: Side,
    a_is_blue: bool,
    max_ticks: u64,
) -> Trace {
    let (blue, red) = if a_is_blue {
        (team_a, team_b)
    } else {
        (team_b, team_a)
    };
    let store = SimLiveStoreState::default();
    let session_id = format!("harness-{seed}");
    init_session(&store, &session_id, &format!("harness-seed-{seed}"), blue, red);
    let start: Vec<i64> = snapshot(&store, &session_id, &[])
        .champs
        .iter()
        .map(|c| c.earned)
        .collect();

    let mut checkpoints: Vec<Option<Snap>> = vec![None; CHECKPOINT_MINUTES.len()];
    let targets = drive.checkpoint_ticks();
    let mut done = 0u64;
    match drive {
        Drive::Skip => {
            for (i, target) in targets.iter().copied().enumerate() {
                if target > max_ticks {
                    break;
                }
                skip_ticks(&store, &session_id, target - done);
                done = target;
                if has_winner(&store, &session_id) {
                    break;
                }
                checkpoints[i] = Some(snapshot(&store, &session_id, &start));
            }
            if !has_winner(&store, &session_id) && done < max_ticks {
                skip_ticks(&store, &session_id, max_ticks - done);
            }
        }
        Drive::Tick => {
            while done < max_ticks && !has_winner(&store, &session_id) {
                tick(
                    &store,
                    SimLiveTickRequest {
                        session_id: session_id.clone(),
                        dt_sec: 0.2,
                        running: true,
                        speed: 12.0,
                    },
                )
                .expect("tick");
                done += 1;
                if let Some(i) = targets.iter().position(|&t| t == done)
                    && !has_winner(&store, &session_id)
                {
                    checkpoints[i] = Some(snapshot(&store, &session_id, &start));
                }
            }
        }
    }
    let end = snapshot(&store, &session_id, &start);
    let winner = store.sessions.lock().expect("lock")[&session_id]
        .state
        .winner
        .clone();
    Trace {
        seed,
        a_is_blue,
        winner_is_a: winner.map(|w| (w == "blue") == a_is_blue),
        checkpoints,
        end,
    }
}

fn run_traces(
    first_seed: usize,
    count: usize,
    drive: Drive,
    team_a: Side,
    team_b: Side,
) -> Vec<Trace> {
    let workers = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .min(count.max(1));
    let mut traces: Vec<Trace> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..workers)
            .map(|worker| {
                scope.spawn(move || {
                    (worker..count)
                        .step_by(workers)
                        .map(|i| {
                            let seed = first_seed + i;
                            // With unequal teams alternate the side of team A.
                            let a_is_blue = seed.is_multiple_of(2);
                            run_trace(seed, drive, team_a, team_b, a_is_blue, FULL_MATCH_TICKS)
                        })
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        handles
            .into_iter()
            .flat_map(|handle| handle.join().expect("trace worker"))
            .collect()
    });
    traces.sort_by_key(|trace| trace.seed);
    traces
}

// ---------------------------------------------------------------- statistics

/// Mean and the half-width of the normal 95% interval of the mean.
fn mean_ci(values: &[f64]) -> (f64, f64) {
    let n = values.len();
    if n == 0 {
        return (f64::NAN, f64::NAN);
    }
    let mean = values.iter().sum::<f64>() / n as f64;
    if n < 2 {
        return (mean, f64::NAN);
    }
    let variance = values.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / (n - 1) as f64;
    (mean, 1.96 * (variance / n as f64).sqrt())
}

/// Nearest-rank percentile of an ascending slice.
fn percentile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return f64::NAN;
    }
    let rank = (p * sorted.len() as f64).ceil().max(1.0) as usize;
    sorted[rank.min(sorted.len()) - 1]
}

fn ci_text(values: &[f64], decimals: usize) -> String {
    let (mean, half) = mean_ci(values);
    format!("{mean:.decimals$}±{half:.decimals$}")
}

fn tally_minus(high: &SourceTally, low: &SourceTally) -> SourceTally {
    let mut out = *high;
    for i in 0..GoldSource::COUNT {
        out.gold[i] -= low.gold[i];
        out.grants[i] -= low.grants[i];
    }
    out
}

fn group_gold(tally: &SourceTally, sources: &[GoldSource]) -> i64 {
    sources.iter().map(|s| tally.gold[s.index()]).sum()
}

fn tally_sum<'a>(tallies: impl Iterator<Item = &'a SourceTally>) -> SourceTally {
    let mut out = SourceTally::default();
    for tally in tallies {
        for i in 0..GoldSource::COUNT {
            out.gold[i] += tally.gold[i];
            out.grants[i] += tally.grants[i];
        }
    }
    out
}

// ------------------------------------------------------------------ sampling

/// The snapshot a column refers to: `Some(i)` a checkpoint, `None` the end.
fn snap_at(trace: &Trace, column: Option<usize>) -> Option<&Snap> {
    match column {
        Some(i) => trace.checkpoints[i].as_ref(),
        None => Some(&trace.end),
    }
}

fn column_label(column: Option<usize>) -> String {
    column.map_or("end".to_string(), |i| format!("m{}", CHECKPOINT_MINUTES[i]))
}

fn columns() -> Vec<Option<usize>> {
    (0..CHECKPOINT_MINUTES.len())
        .map(Some)
        .chain(std::iter::once(None))
        .collect()
}

fn team_of(snap: &Snap, blue: bool) -> impl Iterator<Item = &ChampSnap> {
    snap.champs.iter().filter(move |c| c.blue == blue)
}

// -------------------------------------------------------------------- tables

/// Gold per minute (income, starting purse excluded) per role and per team,
/// and the share of each role in its team's gold (starting purse included, as
/// the shares the economy tests guard).
fn table_gold_per_minute(traces: &[Trace]) {
    println!("\n== T1a gold per minute (income, mean+-95% CI over players; team = 5 players) ==");
    println!("{:<6}{}", "", columns().iter().map(|c| format!("{:>14}", column_label(*c))).collect::<String>());
    let mut rows: Vec<(String, Vec<String>)> = ROLES
        .iter()
        .map(|r| (r.to_string(), Vec::new()))
        .collect();
    rows.push(("TEAM".to_string(), Vec::new()));
    let mut counts = Vec::new();
    for column in columns() {
        let snaps: Vec<&Snap> = traces.iter().filter_map(|t| snap_at(t, column)).collect();
        counts.push(snaps.len());
        for (row, role) in rows.iter_mut().zip(ROLES.iter().map(|r| Some(*r)).chain([None])) {
            let samples: Vec<f64> = match role {
                Some(role) => snaps
                    .iter()
                    .flat_map(|s| s.champs.iter().filter(|c| c.role == role).map(|c| c.income as f64 / (s.time_sec / 60.0)))
                    .collect(),
                None => snaps
                    .iter()
                    .flat_map(|s| [true, false].map(|b| team_of(s, b).map(|c| c.income).sum::<i64>() as f64 / (s.time_sec / 60.0)))
                    .collect(),
            };
            row.1.push(ci_text(&samples, 0));
        }
    }
    for (name, cells) in rows {
        println!("{name:<6}{}", cells.iter().map(|c| format!("{c:>14}")).collect::<String>());
    }
    println!("{:<6}{}", "n", counts.iter().map(|c| format!("{c:>14}")).collect::<String>());

    println!("\n== T1b share of team gold per role in % (starting purse included) ==");
    println!("{:<6}{}", "", columns().iter().map(|c| format!("{:>14}", column_label(*c))).collect::<String>());
    for role in ROLES {
        let mut cells = Vec::new();
        for column in columns() {
            let samples: Vec<f64> = traces
                .iter()
                .filter_map(|t| snap_at(t, column))
                .flat_map(|s| {
                    [true, false].into_iter().filter_map(move |b| {
                        let total: i64 = team_of(s, b).map(|c| c.earned).sum();
                        team_of(s, b)
                            .find(|c| c.role == role)
                            .map(|c| 100.0 * c.earned as f64 / total.max(1) as f64)
                    })
                })
                .collect();
            cells.push(ci_text(&samples, 1));
        }
        println!("{role:<6}{}", cells.iter().map(|c| format!("{c:>14}")).collect::<String>());
    }
}

/// Share of each gold source in the income of a role, by phase.
fn table_source_shares(traces: &[Trace]) {
    // (label, low column, high column); `None` low is the start of the match.
    let phases: [(&str, Option<usize>, Option<usize>); 3] = [
        ("0-15", None, Some(2)),
        ("15-25", Some(2), Some(4)),
        ("25-end", Some(4), None),
    ];
    for (label, low, high) in phases {
        println!("\n== T2 source share of income in % by role, phase {label} (mean+-95% CI over players) ==");
        println!("{:<6}{}{:>10}", "", SOURCE_GROUPS.iter().map(|(n, _)| format!("{n:>12}")).collect::<String>(), "gold/min");
        let rows: Vec<Option<&str>> = ROLES.iter().map(|r| Some(*r)).chain([None]).collect();
        for role in rows {
            let mut shares: Vec<Vec<f64>> = vec![Vec::new(); SOURCE_GROUPS.len()];
            let mut rates: Vec<f64> = Vec::new();
            for trace in traces {
                let Some(hi) = snap_at(trace, high) else {
                    continue;
                };
                let lo = match low {
                    Some(column) => match snap_at(trace, Some(column)) {
                        Some(snap) => Some(snap),
                        None => continue,
                    },
                    None => None,
                };
                let minutes = (hi.time_sec - lo.map_or(0.0, |s| s.time_sec)) / 60.0;
                for blue in [true, false] {
                    let pick = |snap: &Snap| -> Vec<SourceTally> {
                        team_of(snap, blue)
                            .filter(|c| role.is_none_or(|r| c.role == r))
                            .map(|c| c.tally)
                            .collect()
                    };
                    let high_tallies = pick(hi);
                    let low_tallies = lo.map(pick).unwrap_or_else(|| vec![SourceTally::default(); high_tallies.len()]);
                    // One sample per player for a role row, one per team for the ALL row.
                    let diffs: Vec<SourceTally> = high_tallies.iter().zip(&low_tallies).map(|(h, l)| tally_minus(h, l)).collect();
                    let groups: Vec<SourceTally> = if role.is_some() { diffs } else { vec![tally_sum(diffs.iter())] };
                    for diff in groups {
                        let total = diff.total();
                        if total <= 0 {
                            continue;
                        }
                        rates.push(total as f64 / minutes);
                        for (i, (_, sources)) in SOURCE_GROUPS.iter().enumerate() {
                            shares[i].push(100.0 * group_gold(&diff, sources) as f64 / total as f64);
                        }
                    }
                }
            }
            let name = role.unwrap_or("TEAM");
            println!(
                "{name:<6}{}{:>10.0}",
                shares.iter().map(|v| format!("{:>12}", ci_text(v, 1))).collect::<String>(),
                mean_ci(&rates).0
            );
        }
    }
}

/// Creep score, minions that paid gold, and the gold a paid minion yields.
fn table_creep_score(traces: &[Trace]) {
    println!("\n== T3 creep score per minute and gold per lane minion by role ==");
    println!(
        "{:<6}{:>16}{:>16}{:>16}{:>14}{:>14}",
        "", "cs/min m15", "cs/min end", "lane min/min end", "gold/minion", "camp g/min"
    );
    for role in ROLES {
        let at15: Vec<f64> = traces
            .iter()
            .filter_map(|t| snap_at(t, Some(2)))
            .flat_map(|s| s.champs.iter().filter(|c| c.role == role).map(|c| c.cs as f64 / (s.time_sec / 60.0)))
            .collect();
        let at_end: Vec<f64> = traces
            .iter()
            .flat_map(|t| t.end.champs.iter().filter(|c| c.role == role).map(|c| c.cs as f64 / t.minutes()))
            .collect();
        let lane_rate: Vec<f64> = traces
            .iter()
            .flat_map(|t| t.end.champs.iter().filter(|c| c.role == role).map(|c| c.tally.grants[GoldSource::LaneMinion.index()] as f64 / t.minutes()))
            .collect();
        let camp_rate: Vec<f64> = traces
            .iter()
            .flat_map(|t| t.end.champs.iter().filter(|c| c.role == role).map(|c| c.tally.gold[GoldSource::JungleCamp.index()] as f64 / t.minutes()))
            .collect();
        let pooled = tally_sum(traces.iter().flat_map(|t| t.end.champs.iter().filter(|c| c.role == role).map(|c| &c.tally)));
        let per_minion = pooled.gold[GoldSource::LaneMinion.index()] as f64 / pooled.grants[GoldSource::LaneMinion.index()].max(1) as f64;
        println!(
            "{role:<6}{:>16}{:>16}{:>16}{:>14.1}{:>14}",
            ci_text(&at15, 2),
            ci_text(&at_end, 2),
            ci_text(&lane_rate, 2),
            per_minion,
            ci_text(&camp_rate, 1)
        );
    }
}

/// An ADC lead: `(lead, [minion, camp, kill+assist, tower/dragon/baron, other], creep score gap)`.
type LeadRow = (f64, [f64; 5], f64);

/// Distribution of the gold gap between the two players of a role.
fn table_pair_gaps(traces: &[Trace]) {
    println!("\n== T4a |gold gap| between the two players of a role (earned gold, starting purse cancels) ==");
    println!("{:<6}{:>4}{:>12}{:>6}{:>9}{:>8}{:>8}{:>8}{:>8}{:>14}", "role", "min", "towers", "n", "median", "p75", "p90", "p95", "max", ">=1000");
    for role in ROLES {
        for column in [1usize, 2] {
            for fallen in [false, true] {
                let mut gaps: Vec<f64> = traces
                    .iter()
                    .filter_map(|t| snap_at(t, Some(column)))
                    .filter(|s| (s.towers_down > 0) == fallen)
                    .filter_map(|s| {
                        let gold = |blue: bool| team_of(s, blue).find(|c| c.role == role).map(|c| c.earned);
                        Some((gold(true)? - gold(false)?).abs() as f64)
                    })
                    .collect();
                gaps.sort_by(f64::total_cmp);
                let big = gaps.iter().filter(|g| **g >= 1000.0).count();
                println!(
                    "{role:<6}{:>4}{:>12}{:>6}{:>9.0}{:>8.0}{:>8.0}{:>8.0}{:>8.0}{:>14}",
                    CHECKPOINT_MINUTES[column],
                    if fallen { "tower down" } else { "none down" },
                    gaps.len(),
                    percentile(&gaps, 0.5),
                    percentile(&gaps, 0.75),
                    percentile(&gaps, 0.9),
                    percentile(&gaps, 0.95),
                    gaps.last().copied().unwrap_or(f64::NAN),
                    format!("{big} ({:.1}%)", 100.0 * big as f64 / gaps.len().max(1) as f64)
                );
            }
        }
    }

    println!("\n== T4b the owner's case: an ADC leads by 1000+ at minute 15 with no tower down ==");
    let at15: Vec<&Snap> = traces.iter().filter_map(|t| snap_at(t, Some(2))).collect();
    let no_tower: Vec<&Snap> = at15.iter().copied().filter(|s| s.towers_down == 0).collect();
    let mut lead_rows: Vec<LeadRow> = Vec::new(); // (lead, [minion, camp, kill+assist, team objectives, other], cs diff)
    for snap in &no_tower {
        let adc = |blue: bool| team_of(snap, blue).find(|c| c.role == "ADC");
        let (Some(b), Some(r)) = (adc(true), adc(false)) else { continue };
        let lead = (b.earned - r.earned).abs() as f64;
        if lead < 1000.0 {
            continue;
        }
        let (win, lose) = if b.earned > r.earned { (b, r) } else { (r, b) };
        let part = |sources: &[GoldSource]| (group_gold(&win.tally, sources) - group_gold(&lose.tally, sources)) as f64;
        lead_rows.push((
            lead,
            [
                part(&[GoldSource::LaneMinion]),
                part(&[GoldSource::JungleCamp]),
                part(&[GoldSource::Kill, GoldSource::Assist]),
                part(&[GoldSource::Tower, GoldSource::Dragon, GoldSource::Baron]),
                part(&[GoldSource::Herald, GoldSource::Voidgrub, GoldSource::Elder, GoldSource::OtherObjective]),
            ],
            (win.cs - lose.cs) as f64,
        ));
    }
    let total15 = at15.len();
    println!(
        "matches reaching m15: {total15}; with no tower down: {}; ADC lead >= 1000 among those: {} ({:.1}% of no-tower matches, {:.1}% of all matches reaching m15)",
        no_tower.len(),
        lead_rows.len(),
        100.0 * lead_rows.len() as f64 / no_tower.len().max(1) as f64,
        100.0 * lead_rows.len() as f64 / total15.max(1) as f64,
    );
    if !lead_rows.is_empty() {
        let col = |f: &dyn Fn(&LeadRow) -> f64| lead_rows.iter().map(f).collect::<Vec<_>>();
        println!(
            "mean lead {:.0}: lane minions {:+.0}, camps {:+.0}, kills+assists {:+.0}, tower/dragon/baron {:+.0}, herald/grubs/other {:+.0}; creep score gap {:+.1}",
            mean_ci(&col(&|r| r.0)).0,
            mean_ci(&col(&|r| r.1[0])).0,
            mean_ci(&col(&|r| r.1[1])).0,
            mean_ci(&col(&|r| r.1[2])).0,
            mean_ci(&col(&|r| r.1[3])).0,
            mean_ci(&col(&|r| r.1[4])).0,
            mean_ci(&col(&|r| r.2)).0,
        );
        let kill_free = lead_rows.iter().filter(|r| r.1[2].abs() < 1.0).count();
        println!("of those, leads with equal kill+assist gold: {kill_free}; leads where minions are more than half of the lead: {}", lead_rows.iter().filter(|r| r.1[0] > 0.5 * r.0).count());
    }
}

/// Kills, what a kill pays by role, and the share of gold from kills and assists.
fn table_kills(traces: &[Trace]) {
    println!("\n== T5 kills and assists ==");
    let kills: Vec<f64> = traces.iter().map(|t| (t.end.blue_kills + t.end.red_kills) as f64).collect();
    let assists: Vec<f64> = traces.iter().map(|t| t.end.champs.iter().map(|c| c.assists).sum::<i64>() as f64).collect();
    let minutes: Vec<f64> = traces.iter().map(Trace::minutes).collect();
    println!(
        "per match: {} minutes, {} kills, {} assists",
        ci_text(&minutes, 1),
        ci_text(&kills, 1),
        ci_text(&assists, 1)
    );
    println!("{:<6}{:>12}{:>14}{:>14}{:>18}", "role", "kills/match", "gold/kill", "gold/assist", "kill+assist % of income");
    for role in ROLES {
        let champs = || traces.iter().flat_map(|t| t.end.champs.iter().filter(|c| c.role == role));
        let pooled = tally_sum(champs().map(|c| &c.tally));
        let k = GoldSource::Kill.index();
        let a = GoldSource::Assist.index();
        let per_match_kills: Vec<f64> = champs().map(|c| c.kills as f64).collect();
        let share: Vec<f64> = champs()
            .filter(|c| c.income > 0)
            .map(|c| 100.0 * (c.tally.gold[k] + c.tally.gold[a]) as f64 / c.income as f64)
            .collect();
        println!(
            "{role:<6}{:>12}{:>14.0}{:>14.0}{:>18}",
            ci_text(&per_match_kills, 2),
            pooled.gold[k] as f64 / pooled.grants[k].max(1) as f64,
            pooled.gold[a] as f64 / pooled.grants[a].max(1) as f64,
            ci_text(&share, 1)
        );
    }
    let team_share: Vec<f64> = traces
        .iter()
        .flat_map(|t| {
            [true, false].map(|b| {
                let income: i64 = team_of(&t.end, b).map(|c| c.income).sum();
                let ka: i64 = team_of(&t.end, b).map(|c| c.tally.gold[GoldSource::Kill.index()] + c.tally.gold[GoldSource::Assist.index()]).sum();
                100.0 * ka as f64 / income.max(1) as f64
            })
        })
        .collect();
    println!("share of a team's income from kills and assists: {}%", ci_text(&team_share, 1));
}

/// Team A against team B over a whole match: blue against red for even
/// teams, the stronger side against the weaker one otherwise.
fn table_team_comparison(traces: &[Trace], names: (&str, &str)) {
    let (name_a, name_b) = names;
    println!("\n== T6 {name_a} against {name_b} (team A = {name_a}) ==");
    let a_won = traces.iter().filter(|t| t.winner_is_a == Some(true)).count();
    let decided = traces.iter().filter(|t| t.winner_is_a.is_some()).count();
    let rate = a_won as f64 / decided.max(1) as f64;
    let half = 1.96 * (rate * (1.0 - rate) / decided.max(1) as f64).sqrt();
    println!(
        "{name_a} wins {a_won} of {decided} decided matches: {:.1}% (95% interval {:.1}-{:.1}%)",
        100.0 * rate,
        100.0 * (rate - half),
        100.0 * (rate + half)
    );
    println!("{:<10}{}", "", columns().iter().map(|c| format!("{:>16}", column_label(*c))).collect::<String>());
    let team_income = |snap: &Snap, blue: bool| team_of(snap, blue).map(|c| c.income).sum::<i64>() as f64;
    for (label, a) in [(name_a, true), (name_b, false)] {
        let mut cells = Vec::new();
        for column in columns() {
            let samples: Vec<f64> = traces
                .iter()
                .filter_map(|t| snap_at(t, column).map(|s| team_income(s, t.a_is_blue == a) / (s.time_sec / 60.0)))
                .collect();
            cells.push(ci_text(&samples, 0));
        }
        println!("{:<10}{}", format!("{label} g/min"), cells.iter().map(|c| format!("{c:>16}")).collect::<String>());
    }
    let mut lead_cells = Vec::new();
    let mut lead_pct = Vec::new();
    for column in columns() {
        let mut gold_lead = Vec::new();
        let mut pct = Vec::new();
        for trace in traces {
            let Some(snap) = snap_at(trace, column) else { continue };
            let a_gold = team_income(snap, trace.a_is_blue);
            let b_gold = team_income(snap, !trace.a_is_blue);
            gold_lead.push(a_gold - b_gold);
            pct.push(100.0 * (a_gold - b_gold) / b_gold.max(1.0));
        }
        lead_cells.push(ci_text(&gold_lead, 0));
        lead_pct.push(ci_text(&pct, 1));
    }
    println!("{:<10}{}", format!("{name_a}-{name_b}"), lead_cells.iter().map(|c| format!("{c:>16}")).collect::<String>());
    println!("{:<10}{}", "lead %", lead_pct.iter().map(|c| format!("{c:>16}")).collect::<String>());

    let per_team = |a: bool, f: &dyn Fn(&Trace, bool) -> f64| traces.iter().map(|t| f(t, t.a_is_blue == a)).collect::<Vec<f64>>();
    let kills = |t: &Trace, blue: bool| if blue { t.end.blue_kills } else { t.end.red_kills } as f64;
    let towers = |t: &Trace, blue: bool| if blue { t.end.blue_towers } else { t.end.red_towers } as f64;
    println!(
        "kills/match {name_a} {} {name_b} {}; towers destroyed {name_a} {} {name_b} {}",
        ci_text(&per_team(true, &kills), 1),
        ci_text(&per_team(false, &kills), 1),
        ci_text(&per_team(true, &towers), 1),
        ci_text(&per_team(false, &towers), 1)
    );
    println!("whole-match source share of team income in %:");
    println!("{:<10}{}", "", SOURCE_GROUPS.iter().map(|(n, _)| format!("{n:>12}")).collect::<String>());
    for (label, a) in [(name_a, true), (name_b, false)] {
        let cells: Vec<String> = SOURCE_GROUPS
            .iter()
            .map(|(_, sources)| {
                let samples: Vec<f64> = traces
                    .iter()
                    .filter_map(|t| {
                        let blue = t.a_is_blue == a;
                        let tally = tally_sum(team_of(&t.end, blue).map(|c| &c.tally));
                        (tally.total() > 0).then(|| 100.0 * group_gold(&tally, sources) as f64 / tally.total() as f64)
                    })
                    .collect();
                format!("{:>12}", ci_text(&samples, 1))
            })
            .collect();
        println!("{label:<10}{}", cells.concat());
    }
    println!("role g/min at the end (income):");
    for (label, a) in [(name_a, true), (name_b, false)] {
        let cells: Vec<String> = ROLES
            .iter()
            .map(|role| {
                let samples: Vec<f64> = traces
                    .iter()
                    .filter_map(|t| team_of(&t.end, t.a_is_blue == a).find(|c| c.role == *role).map(|c| c.income as f64 / t.minutes()))
                    .collect();
                format!("{role} {:>11}", ci_text(&samples, 0))
            })
            .collect();
        println!("{label:<10}{}", cells.join("  "));
    }
}

fn write_raw(path: &str, traces: &[Trace]) {
    let mut file = std::fs::File::create(path).expect("raw file");
    let mut header = String::from("seed,a_is_blue,snapshot,time_sec,towers_down,team,role,earned,income,cs,kills,assists");
    for source in GoldSource::ALL {
        header.push_str(&format!(",gold_{0},n_{0}", source.label()));
    }
    writeln!(file, "{header}").expect("write");
    for trace in traces {
        let named = trace
            .checkpoints
            .iter()
            .enumerate()
            .filter_map(|(i, s)| s.as_ref().map(|s| (format!("m{}", CHECKPOINT_MINUTES[i]), s)))
            .chain(std::iter::once(("end".to_string(), &trace.end)));
        for (name, snap) in named {
            for c in &snap.champs {
                let mut row = format!(
                    "{},{},{},{:.1},{},{},{},{},{},{},{},{}",
                    trace.seed,
                    trace.a_is_blue,
                    name,
                    snap.time_sec,
                    snap.towers_down,
                    if c.blue { "blue" } else { "red" },
                    c.role,
                    c.earned,
                    c.income,
                    c.cs,
                    c.kills,
                    c.assists
                );
                for i in 0..GoldSource::COUNT {
                    row.push_str(&format!(",{},{}", c.tally.gold[i], c.tally.grants[i]));
                }
                writeln!(file, "{row}").expect("write");
            }
        }
    }
}

fn env_or<T: std::str::FromStr>(name: &str, default: T) -> T {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

/// Plays `ECON_HARNESS_N` matches and prints every table.
#[test]
#[ignore = "measurement: 300 full matches take about 6 min in release on 6 cores; see the module docs"]
fn measure_match_economy() {
    let count: usize = env_or("ECON_HARNESS_N", 300);
    let first_seed: usize = env_or("ECON_HARNESS_SEED", 0);
    let drive = Drive::from_env();
    let pair = std::env::var("ECON_HARNESS_PAIR").unwrap_or_else(|_| "70,70".to_string());
    let stats: Vec<f64> = pair.split(',').filter_map(|s| s.trim().parse().ok()).collect();
    let (stat_a, stat_b) = (stats[0], stats[1]);
    println!(
        "HARNESS matches={count} first_seed={first_seed} mode={drive:?} team_a_stat={stat_a} team_b_stat={stat_b}"
    );
    let started = std::time::Instant::now();
    let traces = run_traces(first_seed, count, drive, Side::stat(stat_a), Side::stat(stat_b));
    println!("HARNESS played {} matches in {:.0} s", traces.len(), started.elapsed().as_secs_f64());
    if let Ok(path) = std::env::var("ECON_HARNESS_RAW") {
        write_raw(&path, &traces);
        println!("HARNESS raw rows written to {path}");
    }
    table_gold_per_minute(&traces);
    table_source_shares(&traces);
    table_creep_score(&traces);
    table_pair_gaps(&traces);
    table_kills(&traces);
    if (stat_a - stat_b).abs() < f64::EPSILON {
        table_team_comparison(&traces, ("blue", "red"));
    } else {
        table_team_comparison(&traces, ("stronger", "weaker"));
    }
}

// --------------------------------------------------------- default (cheap) tests

#[test]
fn skip_checkpoints_are_multiples_of_three_ticks() {
    let ticks = Drive::Skip.checkpoint_ticks();
    assert!(ticks.iter().all(|t| t % 3 == 0), "{ticks:?}");
    assert_eq!(Drive::Tick.checkpoint_ticks(), [500, 1000, 1500, 2000, 2500, 3000]);
}

#[test]
fn chunked_skip_run_equals_a_single_call() {
    let one_shot = |ticks: &[u64]| -> Vec<(i64, i64, i64)> {
        let store = SimLiveStoreState::default();
        init_session(&store, "chunk", "chunk-seed", Side::EVEN, Side::EVEN);
        for chunk in ticks {
            skip_ticks(&store, "chunk", *chunk);
        }
        snapshot(&store, "chunk", &[])
            .champs
            .iter()
            .map(|c| (c.earned, c.cs, c.kills))
            .collect()
    };
    assert_eq!(one_shot(&[600]), one_shot(&[201, 399]));
}

#[test]
fn snapshot_sources_add_up_to_income() {
    let trace = run_trace(7, Drive::Skip, Side::EVEN, Side::EVEN, true, 700);
    for snap in trace.checkpoints.iter().flatten().chain([&trace.end]) {
        for champ in &snap.champs {
            assert_eq!(champ.tally.total(), champ.income, "{} {}", champ.role, snap.time_sec);
        }
    }
}

#[test]
fn percentile_uses_nearest_rank() {
    let values: Vec<f64> = (1..=10).map(f64::from).collect();
    assert_eq!(percentile(&values, 0.5), 5.0);
    assert_eq!(percentile(&values, 0.9), 9.0);
    assert_eq!(percentile(&values, 1.0), 10.0);
    assert!(percentile(&[], 0.5).is_nan());
}

#[test]
fn mean_ci_of_a_constant_series_has_no_spread() {
    let (mean, half) = mean_ci(&[4.0, 4.0, 4.0, 4.0]);
    assert_eq!((mean, half), (4.0, 0.0));
}
