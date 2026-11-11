//! Headless measurement of how two equal laners end up with different creep scores.
//!
//! `measure_lane_farming` plays seeded matches up to minute 15 through the same
//! `skip_to_end` path as the economy harness, in chunks of three ticks, and
//! prints: the creep-score gap per lane at minutes 3, 5, 8, 10 and 15; how each
//! lane's enemy minions died (laner last hit, another champion, turret, allied
//! minion) and what share of the time each laner was dead, recalling, in reach
//! of a minion or elsewhere; and whether an early lead compounds. It only reads
//! the state and the farm ledger.
//!
//! ```text
//! FARM_HARNESS_N=200 FARM_HARNESS_SEED=0 FARM_HARNESS_PAIR=70,70 \
//!   cargo test --release -p olm_core --lib \
//!   sim_live::farm_harness_tests::measure_lane_farming -- --ignored --nocapture
//! ```
//!
//! Environment: `FARM_HARNESS_N` matches (default 200), `FARM_HARNESS_SEED`
//! first seed (default 0), `FARM_HARNESS_PAIR` visible stat of blue and red
//! (default `70,70`), `FARM_HARNESS_MINUTES` last minute simulated (default 15).

use std::collections::HashMap;

use super::economy_tests::{snapshot_with, Side};
use super::farm_ledger::{arc_fraction, DamageSource, MinionKiller};
use super::*;

/// Minutes at which every laner is snapshotted.
const CHECKPOINT_MINUTES: [u32; 5] = [3, 5, 8, 10, 15];

/// Simulated seconds per tick (`dt_sec` 0.2 clamped to 0.05, speed 12).
const TICK_SEC: f64 = 0.6;

/// Ticks per sampling chunk: `skip_to_end` decides macro actions every third tick.
const CHUNK_TICKS: u64 = 3;

/// Seconds at which a laner's distance from its own base is sampled.
const ARC_SAMPLE_SECONDS: [f64; 4] = [30.0, 45.0, 60.0, 90.0];

const LANES: [(&str, &str); 3] = [("TOP", "top"), ("MID", "mid"), ("ADC", "bot")];

/// What a laner was doing during one sampled chunk.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Activity {
    Dead,
    Recalling,
    /// Alive with a visible enemy lane minion inside its farm search radius.
    InReach,
    /// Alive with no enemy lane minion inside its farm search radius.
    Elsewhere,
}

#[derive(Clone, Default)]
struct Laner {
    cs: i64,
    gold: i64,
    level: i64,
    kills: i64,
    deaths: i64,
    /// Chunks spent per `Activity`, in declaration order.
    chunks: [u32; 4],
    /// Recalls begun: because the next item was affordable, because of low
    /// health, for another reason.
    recalls: [u32; 3],
    /// Health taken by champions, minions, turrets and anything else.
    damage: [f64; 4],
    /// Health taken from champions, by the attacker's role (TOP, JGL, MID, ADC, SUP).
    damage_by_role: [f64; 5],
    /// Recall episodes that ended with the laner back in reach of the wave and
    /// the seconds they took from the start of the recall.
    away_episodes: u32,
    away_sec: f64,
}

#[derive(Clone, Default)]
struct DeathCounts {
    /// Enemy minions of this laner's lane that died, by killer.
    by_laner: u32,
    by_other_champion: u32,
    by_tower: u32,
    by_minion: u32,
    /// Hit last by this laner but killed by a turret or a minion (no credit if by a minion).
    hit_by_laner_killed_by_other: u32,
}

#[derive(Clone)]
struct LaneSnap {
    blue: Laner,
    red: Laner,
    blue_deaths: DeathCounts,
    red_deaths: DeathCounts,
}

/// Where the living minions of a lane stood, as arc fraction along the blue
/// lane path (0 blue base, 1 red base), summed over the sampled chunks.
#[derive(Clone, Copy, Default)]
struct WaveSum {
    chunks: u32,
    sum_all: f64,
    sum_blue_minions: f64,
    blue_chunks: u32,
    sum_red_minions: f64,
    red_chunks: u32,
    /// How far ahead of the middle of the lane's minions each living laner stood,
    /// toward the enemy base (arc fraction), summed over chunks.
    forward_blue: f64,
    forward_blue_chunks: u32,
    forward_red: f64,
    forward_red_chunks: u32,
}

/// Wave positions per lane over the windows 0-3, 3-5, 5-10 and 10-15 minutes.
const WAVE_WINDOWS: [(u32, u32); 4] = [(0, 3), (3, 5), (5, 10), (10, 15)];

/// Deaths of a lane's minions by minion team and killer at minute 15: (count, arc sum).
type DeathArcs = [[(u32, f64); 3]; 2];

struct FarmTrace {
    seed: usize,
    death_arcs: [DeathArcs; 3],
    waves: [[WaveSum; 4]; 3],
    /// Seconds at which each laner first had an enemy lane minion in reach, `[lane][side]`.
    first_reach: [[Option<f64>; 2]; 3],
    /// Distance walked from its own base (arc fraction, mirrored for red) at each
    /// of `ARC_SAMPLE_SECONDS`, `[lane][side][sample]`.
    arc_at: [[[Option<f64>; 4]; 2]; 3],
    /// Indexed `[checkpoint][lane]`.
    snaps: Vec<Vec<LaneSnap>>,
}

fn activity(runtime: &RuntimeState, idx: usize) -> Activity {
    let champion = &runtime.champions[idx];
    if !champion.alive {
        return Activity::Dead;
    }
    if champion.state == "recall" || champion.recall_channel_until > runtime.time_sec {
        return Activity::Recalling;
    }
    let team = normalized_team(&champion.team);
    let enemy = if team == "blue" { "red" } else { "blue" };
    let lane = normalized_lane(&champion.lane);
    let radius = laner_farm_search_radius(champion);
    let in_reach = runtime.minions.iter().any(|m| {
        combat::is_visible_lane_enemy_minion(runtime, team, lane, enemy, m)
            && dist(champion.pos, m.pos) <= radius
    });
    if in_reach {
        Activity::InReach
    } else {
        Activity::Elsewhere
    }
}

fn damage_taken(runtime: &RuntimeState, champion_id: &str) -> [f64; 4] {
    let taken = |source| {
        runtime
            .farm_ledger
            .damage()
            .get(&(champion_id.to_string(), source))
            .copied()
            .unwrap_or(0.0)
    };
    [
        taken(DamageSource::Champion),
        taken(DamageSource::Minion),
        taken(DamageSource::Tower),
        taken(DamageSource::Other),
    ]
}

fn laner_of(runtime: &RuntimeState, role: &str, blue: bool) -> usize {
    runtime
        .champions
        .iter()
        .position(|c| c.role == role && (c.team == "blue") == blue)
        .expect("laner exists")
}

fn deaths_of(runtime: &RuntimeState, laner_id: &str, lane: &str, laner_is_blue: bool) -> DeathCounts {
    let mut counts = DeathCounts::default();
    for (key, tally) in runtime.farm_ledger.deaths() {
        let n = tally.count;
        // The laner farms the minions of the other team in its own lane.
        if key.lane != lane || key.minion_is_blue == laner_is_blue {
            continue;
        }
        let mine = key.last_hit_by.as_deref() == Some(laner_id);
        match key.killer {
            MinionKiller::Champion if mine => counts.by_laner += n,
            MinionKiller::Champion => counts.by_other_champion += n,
            MinionKiller::Tower => counts.by_tower += n,
            MinionKiller::Minion => counts.by_minion += n,
        }
        if mine && key.killer != MinionKiller::Champion {
            counts.hit_by_laner_killed_by_other += n;
        }
    }
    counts
}

fn take_snapshot(runtime: &RuntimeState, chunks: &[[[u32; 4]; 2]; 3], recalls: &[[[u32; 3]; 2]; 3], away: &[[(Option<f64>, u32, f64); 2]; 3]) -> Vec<LaneSnap> {
    LANES
        .iter()
        .enumerate()
        .map(|(lane_slot, (role, lane))| {
            let laner = |blue: bool| {
                let idx = laner_of(runtime, role, blue);
                let c = &runtime.champions[idx];
                (
                    Laner {
                        cs: c.cs,
                        gold: c.gold + c.spent_gold,
                        level: c.level,
                        kills: c.kills,
                        deaths: c.deaths,
                        chunks: chunks[lane_slot][usize::from(!blue)],
                        recalls: recalls[lane_slot][usize::from(!blue)],
                        damage: damage_taken(runtime, &c.id),
                        damage_by_role: ["TOP", "JGL", "MID", "ADC", "SUP"].map(|role| {
                            runtime
                                .farm_ledger
                                .damage_by_attacker_role()
                                .get(&(c.id.clone(), role.to_string()))
                                .copied()
                                .unwrap_or(0.0)
                        }),
                        away_episodes: away[lane_slot][usize::from(!blue)].1,
                        away_sec: away[lane_slot][usize::from(!blue)].2,
                    },
                    deaths_of(runtime, &c.id, lane, blue),
                )
            };
            let (blue, blue_deaths) = laner(true);
            let (red, red_deaths) = laner(false);
            LaneSnap {
                blue,
                red,
                blue_deaths,
                red_deaths,
            }
        })
        .collect()
}

fn run_farm_trace(seed: usize, blue: Side, red: Side, last_minute: u32) -> FarmTrace {
    let store = SimLiveStoreState::default();
    let session_id = format!("farm-{seed}");
    init(
        &store,
        SimLiveInitRequest {
            session_id: session_id.clone(),
            seed: format!("farm-seed-{seed}"),
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
    let checkpoint_ticks: Vec<u64> = CHECKPOINT_MINUTES
        .iter()
        .map(|m| ((f64::from(*m) * 60.0 / TICK_SEC).round() as u64).div_ceil(CHUNK_TICKS) * CHUNK_TICKS)
        .collect();
    let last_tick = (f64::from(last_minute) * 60.0 / TICK_SEC).round() as u64;
    let mut chunks = [[[0u32; 4]; 2]; 3];
    let mut waves = [[WaveSum::default(); 4]; 3];
    let mut recalls = [[[0u32; 3]; 2]; 3];
    let mut was_recalling = [[false; 2]; 3];
    let mut first_reach = [[None::<f64>; 2]; 3];
    // Per laner: when the open recall began, finished episodes, their seconds.
    let mut away = [[(None::<f64>, 0u32, 0.0f64); 2]; 3];
    let mut arc_at = [[[None::<f64>; 4]; 2]; 3];
    let mut snaps = Vec::new();
    let mut done = 0u64;
    while done < last_tick && snaps.len() < CHECKPOINT_MINUTES.len() {
        skip_to_end(
            &store,
            SimLiveSkipToEndRequest {
                session_id: session_id.clone(),
                dt_sec: 0.2,
                speed: 12.0,
                max_ticks: CHUNK_TICKS,
            },
        )
        .expect("skip");
        done += CHUNK_TICKS;
        let mut sessions = store.sessions.lock().expect("lock");
        if let Ok(only) = std::env::var("FARM_HARNESS_ONLY") {
            let rt = &mut sessions.get_mut(&session_id).expect("session").state;
            for c in &mut rt.champions {
                if !only.split(',').any(|r| r == c.role) {
                    c.alive = false;
                    c.hp = 0.0;
                    c.respawn_at = 1.0e9;
                }
            }
        }
        let runtime = &sessions[&session_id].state;
        if runtime.winner.is_some() {
            break;
        }
        for (lane_slot, (role, _)) in LANES.iter().enumerate() {
            for (side_slot, blue) in [true, false].into_iter().enumerate() {
                let idx = laner_of(runtime, role, blue);
                let act = activity(runtime, idx);
                chunks[lane_slot][side_slot][act as usize] += 1;
                if act == Activity::InReach && first_reach[lane_slot][side_slot].is_none() {
                    first_reach[lane_slot][side_slot] = Some(runtime.time_sec);
                }
                let walked = {
                    let a = arc_fraction(runtime.champions[idx].pos, lane_path_blue(LANES[lane_slot].1));
                    if blue { a } else { 1.0 - a }
                };
                for (slot, at) in ARC_SAMPLE_SECONDS.iter().enumerate() {
                    if runtime.time_sec >= *at && arc_at[lane_slot][side_slot][slot].is_none() {
                        arc_at[lane_slot][side_slot][slot] = Some(walked);
                    }
                }
                let c = &runtime.champions[idx];
                let recalling = c.alive && c.state == "recall";
                if recalling && away[lane_slot][side_slot].0.is_none() {
                    away[lane_slot][side_slot].0 = Some(runtime.time_sec);
                }
                if let Some(began) = away[lane_slot][side_slot].0
                    && !recalling
                    && act == Activity::InReach
                {
                    let cell = &mut away[lane_slot][side_slot];
                    cell.0 = None;
                    cell.1 += 1;
                    cell.2 += runtime.time_sec - began;
                }
                if recalling && !was_recalling[lane_slot][side_slot] {
                    let kind = if champion_can_afford_next_item(c) {
                        0
                    } else if c.hp / c.max_hp.max(1.0) <= RECALL_TRIGGER_HP_RATIO {
                        1
                    } else {
                        2
                    };
                    recalls[lane_slot][side_slot][kind] += 1;
                }
                was_recalling[lane_slot][side_slot] = recalling;
            }
        }
        let minute = runtime.time_sec / 60.0;
        for (lane_slot, (_, lane)) in LANES.iter().enumerate() {
            let path = lane_path_blue(lane);
            for (w, (from, to)) in WAVE_WINDOWS.iter().enumerate() {
                if minute < f64::from(*from) || minute >= f64::from(*to) {
                    continue;
                }
                let sum = &mut waves[lane_slot][w];
                let lane_minions: Vec<f64> = runtime
                    .minions
                    .iter()
                    .filter(|m| m.alive && m.kind != "summon" && normalized_lane(&m.lane) == *lane)
                    .map(|m| arc_fraction(m.pos, path))
                    .collect();
                if !lane_minions.is_empty() {
                    let centre = mean(&lane_minions);
                    for blue in [true, false] {
                        let c = &runtime.champions[laner_of(runtime, LANES[lane_slot].0, blue)];
                        if !c.alive {
                            continue;
                        }
                        let a = arc_fraction(c.pos, path);
                        if blue {
                            sum.forward_blue += a - centre;
                            sum.forward_blue_chunks += 1;
                        } else {
                            sum.forward_red += centre - a;
                            sum.forward_red_chunks += 1;
                        }
                    }
                }
                for m in runtime.minions.iter().filter(|m| m.alive && m.kind != "summon" && normalized_lane(&m.lane) == *lane) {
                    let f = arc_fraction(m.pos, path);
                    sum.sum_all += f;
                    sum.chunks += 1;
                    if normalized_team(&m.team) == "blue" {
                        sum.sum_blue_minions += f;
                        sum.blue_chunks += 1;
                    } else {
                        sum.sum_red_minions += f;
                        sum.red_chunks += 1;
                    }
                }
            }
        }
        if checkpoint_ticks.get(snaps.len()) == Some(&done) {
            snaps.push(take_snapshot(runtime, &chunks, &recalls, &away));
        }
    }
    let death_arcs = {
        let sessions = store.sessions.lock().expect("lock");
        let runtime = &sessions[&session_id].state;
        let mut arcs = [DeathArcs::default(); 3];
        for (key, tally) in runtime.farm_ledger.deaths() {
            let lane_slot = LANES.iter().position(|(_, l)| *l == key.lane).expect("lane");
            let killer = match key.killer {
                MinionKiller::Champion => 0,
                MinionKiller::Tower => 1,
                MinionKiller::Minion => 2,
            };
            let cell = &mut arcs[lane_slot][usize::from(!key.minion_is_blue)][killer];
            cell.0 += tally.count;
            cell.1 += tally.arc_sum;
        }
        arcs
    };
    FarmTrace { seed, death_arcs, waves, first_reach, arc_at, snaps }
}

fn run_farm_traces(first_seed: usize, count: usize, blue: Side, red: Side, last_minute: u32) -> Vec<FarmTrace> {
    let workers = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .min(count.max(1));
    let mut traces: Vec<FarmTrace> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..workers)
            .map(|worker| {
                scope.spawn(move || {
                    (worker..count)
                        .step_by(workers)
                        .map(|i| run_farm_trace(first_seed + i, blue, red, last_minute))
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        handles
            .into_iter()
            .flat_map(|handle| handle.join().expect("farm worker"))
            .collect()
    });
    traces.sort_by_key(|trace| trace.seed);
    traces
}

// ---------------------------------------------------------------- statistics

fn percentile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return f64::NAN;
    }
    let rank = (p * sorted.len() as f64).ceil() as usize;
    sorted[rank.clamp(1, sorted.len()) - 1]
}

fn mean(values: &[f64]) -> f64 {
    values.iter().sum::<f64>() / values.len().max(1) as f64
}

fn pearson(xs: &[f64], ys: &[f64]) -> f64 {
    let (mx, my) = (mean(xs), mean(ys));
    let cov: f64 = xs.iter().zip(ys).map(|(x, y)| (x - mx) * (y - my)).sum();
    let vx: f64 = xs.iter().map(|x| (x - mx).powi(2)).sum();
    let vy: f64 = ys.iter().map(|y| (y - my).powi(2)).sum();
    cov / (vx * vy).sqrt()
}

fn sorted_abs(values: impl Iterator<Item = f64>) -> Vec<f64> {
    let mut v: Vec<f64> = values.map(f64::abs).collect();
    v.sort_by(|a, b| a.total_cmp(b));
    v
}

fn reached(traces: &[FarmTrace], checkpoint: usize) -> Vec<&FarmTrace> {
    traces.iter().filter(|t| t.snaps.len() > checkpoint).collect()
}

// ------------------------------------------------------------------- tables

/// Creep-score gap (blue minus red) per lane and checkpoint.
fn table_cs_gap(traces: &[FarmTrace]) {
    println!("\n== F1 creep-score gap of the two laners of a lane (n = matches reaching the minute) ==");
    println!("{:<5}{:>4}{:>6}{:>9}{:>8}{:>8}{:>8}{:>8}{:>9}", "lane", "min", "n", "mean cs", "|gap|50", "|gap|75", "|gap|90", "mean gap", "blue>red");
    for (lane_slot, (role, _)) in LANES.iter().enumerate() {
        for (cp, minute) in CHECKPOINT_MINUTES.iter().enumerate() {
            let rows = reached(traces, cp);
            let gaps: Vec<f64> = rows
                .iter()
                .map(|t| (t.snaps[cp][lane_slot].blue.cs - t.snaps[cp][lane_slot].red.cs) as f64)
                .collect();
            let cs: Vec<f64> = rows
                .iter()
                .flat_map(|t| [t.snaps[cp][lane_slot].blue.cs as f64, t.snaps[cp][lane_slot].red.cs as f64])
                .collect();
            let abs = sorted_abs(gaps.iter().copied());
            let blue_ahead = gaps.iter().filter(|g| **g > 0.0).count() as f64 / gaps.len().max(1) as f64;
            println!(
                "{role:<5}{minute:>4}{:>6}{:>9.1}{:>8.0}{:>8.0}{:>8.0}{:>8.1}{:>8.0}%",
                rows.len(),
                mean(&cs),
                percentile(&abs, 0.5),
                percentile(&abs, 0.75),
                percentile(&abs, 0.9),
                mean(&gaps),
                100.0 * blue_ahead
            );
        }
    }
}

/// How the enemy minions of a lane died by minute 15, and where the laner was.
fn table_mechanism(traces: &[FarmTrace], checkpoint: usize) {
    let rows = reached(traces, checkpoint);
    println!(
        "\n== F2 at minute {}: how a laner's lane minions died (mean per laner) and what the laner did (% of chunks), n={} ==",
        CHECKPOINT_MINUTES[checkpoint],
        rows.len()
    );
    println!(
        "{:<5}{:<5}{:>7}{:>8}{:>8}{:>8}{:>8}{:>9}{:>8}{:>8}{:>9}{:>10}{:>7}{:>7}{:>8}{:>7}{:>7}",
        "lane", "side", "cs", "laner", "other", "tower", "minion", "stolen*", "dead%", "recall%", "inreach%", "elsewhere%", "kills", "deaths", "rc:gold", "rc:hp", "rc:oth"
    );
    for (lane_slot, (role, _)) in LANES.iter().enumerate() {
        for blue in [true, false] {
            let pick = |t: &FarmTrace| {
                let s = &t.snaps[checkpoint][lane_slot];
                if blue { (s.blue.clone(), s.blue_deaths.clone()) } else { (s.red.clone(), s.red_deaths.clone()) }
            };
            let data: Vec<(Laner, DeathCounts)> = rows.iter().map(|t| pick(t)).collect();
            let avg = |f: &dyn Fn(&(Laner, DeathCounts)) -> f64| mean(&data.iter().map(f).collect::<Vec<_>>());
            let total_chunks = |d: &(Laner, DeathCounts)| d.0.chunks.iter().sum::<u32>() as f64;
            let share = |i: usize| 100.0 * avg(&|d| f64::from(d.0.chunks[i])) / avg(&|d| total_chunks(d)).max(1.0);
            println!(
                "{role:<5}{:<5}{:>7.1}{:>8.1}{:>8.1}{:>8.1}{:>8.1}{:>9.1}{:>8.1}{:>8.1}{:>9.1}{:>10.1}{:>7.2}{:>7.2}{:>8.2}{:>7.2}{:>7.2}",
                if blue { "blue" } else { "red" },
                avg(&|d| d.0.cs as f64),
                avg(&|d| f64::from(d.1.by_laner)),
                avg(&|d| f64::from(d.1.by_other_champion)),
                avg(&|d| f64::from(d.1.by_tower)),
                avg(&|d| f64::from(d.1.by_minion)),
                avg(&|d| f64::from(d.1.hit_by_laner_killed_by_other)),
                share(Activity::Dead as usize),
                share(Activity::Recalling as usize),
                share(Activity::InReach as usize),
                share(Activity::Elsewhere as usize),
                avg(&|d| d.0.kills as f64),
                avg(&|d| d.0.deaths as f64),
                avg(&|d| f64::from(d.0.recalls[0])),
                avg(&|d| f64::from(d.0.recalls[1])),
                avg(&|d| f64::from(d.0.recalls[2])),
            );
        }
    }
    println!("(stolen* = minions the laner hit last that a turret or an allied minion then killed)");
}

/// Where a laner's health went, and what a recall cost it.
fn table_health_and_recalls(traces: &[FarmTrace], checkpoint: usize) {
    let rows = reached(traces, checkpoint);
    println!(
        "\n== F8 at minute {}: health taken per laner (mean) and what a recall costs, n={} ==",
        CHECKPOINT_MINUTES[checkpoint],
        rows.len()
    );
    println!(
        "{:<5}{:<5}{:>10}{:>9}{:>8}{:>8}{:>10}{:>11}{:>12}{:>13}",
        "lane", "side", "champion", "minion", "tower", "other", "recalls", "episodes", "away s/rc", "away % time"
    );
    println!("      (champion damage by attacker role TOP/JGL/MID/ADC/SUP on the next line of each row)");
    for (lane_slot, (role, _)) in LANES.iter().enumerate() {
        for blue in [true, false] {
            let data: Vec<Laner> = rows
                .iter()
                .map(|t| {
                    let s = &t.snaps[checkpoint][lane_slot];
                    if blue { s.blue.clone() } else { s.red.clone() }
                })
                .collect();
            let avg = |f: &dyn Fn(&Laner) -> f64| mean(&data.iter().map(f).collect::<Vec<_>>());
            let episodes = avg(&|l| f64::from(l.away_episodes));
            let away_total = avg(&|l| l.away_sec);
            println!(
                "{role:<5}{:<5}{:>10.0}{:>9.0}{:>8.0}{:>8.0}{:>10.2}{:>11.2}{:>12.1}{:>12.1}%",
                if blue { "blue" } else { "red" },
                avg(&|l| l.damage[0]),
                avg(&|l| l.damage[1]),
                avg(&|l| l.damage[2]),
                avg(&|l| l.damage[3]),
                avg(&|l| f64::from(l.recalls.iter().sum::<u32>())),
                episodes,
                away_total / episodes.max(1e-9),
                100.0 * away_total / (f64::from(CHECKPOINT_MINUTES[checkpoint]) * 60.0),
            );
            println!(
                "            by attacker {:>6.0}{:>6.0}{:>6.0}{:>6.0}{:>6.0}",
                avg(&|l| l.damage_by_role[0]),
                avg(&|l| l.damage_by_role[1]),
                avg(&|l| l.damage_by_role[2]),
                avg(&|l| l.damage_by_role[3]),
                avg(&|l| l.damage_by_role[4]),
            );
        }
    }
}

/// Where the minions of each lane stood (0 blue base, 1 red base) and where the
/// two teams' minions were, per window.
fn table_wave_position(traces: &[FarmTrace]) {
    println!("\n== F4 position of living lane minions along the lane (0 blue base, 1 red base); mean over matches ==");
    println!("{:<5}{:>10}{:>10}{:>10}{:>10}   (all minions | blue minions | red minions)", "lane", "0-3", "3-5", "5-10", "10-15");
    for (lane_slot, (role, _)) in LANES.iter().enumerate() {
        let cell = |w: usize, f: &dyn Fn(&WaveSum) -> (f64, u32)| {
            let (s, n) = traces.iter().fold((0.0, 0u32), |(s, n), t| {
                let (a, b) = f(&t.waves[lane_slot][w]);
                (s + a, n + b)
            });
            s / f64::from(n.max(1))
        };
        for (label, f) in [
            ("all", (&|w: &WaveSum| (w.sum_all, w.chunks)) as &dyn Fn(&WaveSum) -> (f64, u32)),
            ("blue", &|w: &WaveSum| (w.sum_blue_minions, w.blue_chunks)),
            ("red", &|w: &WaveSum| (w.sum_red_minions, w.red_chunks)),
            ("blue laner ahead of wave centre", &|w: &WaveSum| (w.forward_blue, w.forward_blue_chunks)),
            ("red laner ahead of wave centre", &|w: &WaveSum| (w.forward_red, w.forward_red_chunks)),
        ] {
            println!(
                "{role:<5}{:>10.3}{:>10.3}{:>10.3}{:>10.3}   {label}",
                cell(0, f),
                cell(1, f),
                cell(2, f),
                cell(3, f)
            );
        }
    }
}

/// Where lane minions died along the lane, by whose minion and what killed it
/// (end of the simulated span, all of it up to the last minute simulated).
fn table_death_positions(traces: &[FarmTrace]) {
    println!("\n== F5 where lane minions died: count per match and mean position (0 blue base, 1 red base) ==");
    println!("{:<5}{:<14}{:>20}{:>20}{:>20}", "lane", "minion team", "champion (n @arc)", "tower (n @arc)", "minion (n @arc)");
    for (lane_slot, (role, _)) in LANES.iter().enumerate() {
        for (team_slot, team) in ["blue minions", "red minions"].iter().enumerate() {
            let cells: Vec<String> = (0..3)
                .map(|killer| {
                    let (n, sum) = traces.iter().fold((0u32, 0.0), |(n, s), t| {
                        let c = t.death_arcs[lane_slot][team_slot][killer];
                        (n + c.0, s + c.1)
                    });
                    format!("{:.1} @{:.3}", f64::from(n) / traces.len().max(1) as f64, sum / f64::from(n.max(1)))
                })
                .collect();
            println!("{role:<5}{team:<14}{:>20}{:>20}{:>20}", cells[0], cells[1], cells[2]);
        }
    }
}

/// Whether an early lead compounds into the minute-15 creep-score gap.
fn table_compounding(traces: &[FarmTrace]) {
    println!("\n== F3 does an early lead compound? (blue minus red, per lane, matches reaching minute 15) ==");
    let m5 = 1;
    let m8 = 2;
    let m15 = CHECKPOINT_MINUTES.len() - 1;
    let rows = reached(traces, m15);
    println!(
        "{:<5}{:>12}{:>12}{:>12}{:>12}{:>12}{:>14}{:>14}",
        "lane", "r(cs3,cs15)", "r(cs5,cs15)", "r(cs8,cs15)", "r(lvl5,cs15)", "r(gold5,cs15)", "same sign 5/15", "same sign 8/15"
    );
    for (lane_slot, (role, _)) in LANES.iter().enumerate() {
        let gap = |cp: usize, f: &dyn Fn(&Laner) -> f64| -> Vec<f64> {
            rows.iter()
                .map(|t| f(&t.snaps[cp][lane_slot].blue) - f(&t.snaps[cp][lane_slot].red))
                .collect()
        };
        let cs = |l: &Laner| l.cs as f64;
        let cs15 = gap(m15, &cs);
        let same_sign = |cp: usize| -> f64 {
            let early = gap(cp, &cs);
            let decided: Vec<(f64, f64)> = early
                .iter()
                .zip(&cs15)
                .filter(|(a, b)| **a != 0.0 && **b != 0.0)
                .map(|(a, b)| (*a, *b))
                .collect();
            100.0 * decided.iter().filter(|(a, b)| (a > &0.0) == (b > &0.0)).count() as f64 / decided.len().max(1) as f64
        };
        println!(
            "{role:<5}{:>12.2}{:>12.2}{:>12.2}{:>12.2}{:>12.2}{:>13.0}%{:>13.0}%",
            pearson(&gap(0, &cs), &cs15),
            pearson(&gap(m5, &cs), &cs15),
            pearson(&gap(m8, &cs), &cs15),
            pearson(&gap(m5, &|l| l.level as f64), &cs15),
            pearson(&gap(m5, &|l| l.gold as f64), &cs15),
            same_sign(m5),
            same_sign(m8),
        );
    }
    println!("\n  kills/deaths by minute 15 per laner (mean) and creep score of a laner by whether it died before minute 5:");
    for (lane_slot, (role, _)) in LANES.iter().enumerate() {
        let all: Vec<&Laner> = rows
            .iter()
            .flat_map(|t| [&t.snaps[m15][lane_slot].blue, &t.snaps[m15][lane_slot].red])
            .collect();
        let early: Vec<(&Laner, &Laner)> = rows
            .iter()
            .flat_map(|t| {
                [
                    (&t.snaps[m5][lane_slot].blue, &t.snaps[m15][lane_slot].blue),
                    (&t.snaps[m5][lane_slot].red, &t.snaps[m15][lane_slot].red),
                ]
            })
            .collect();
        let died: Vec<f64> = early.iter().filter(|(a, _)| a.deaths > 0).map(|(_, b)| b.cs as f64).collect();
        let alive: Vec<f64> = early.iter().filter(|(a, _)| a.deaths == 0).map(|(_, b)| b.cs as f64).collect();
        println!(
            "  {role}: kills {:.2} deaths {:.2}; cs15 {:.1} (n={}) if died before m5, {:.1} (n={}) if not",
            mean(&all.iter().map(|l| l.kills as f64).collect::<Vec<_>>()),
            mean(&all.iter().map(|l| l.deaths as f64).collect::<Vec<_>>()),
            mean(&died),
            died.len(),
            mean(&alive),
            alive.len()
        );
    }
}

/// What explains the minute-15 creep-score gap: correlation of the gap with the
/// gap in time spent in each activity, and the farming rate while in reach.
fn table_gap_mediators(traces: &[FarmTrace]) {
    let m15 = CHECKPOINT_MINUTES.len() - 1;
    let rows = reached(traces, m15);
    println!("\n== F6 what explains the minute-15 cs gap (blue minus red per lane): correlation with the gap in chunks spent ==");
    println!("{:<5}{:>8}{:>10}{:>10}{:>12}{:>12}{:>16}{:>16}", "lane", "r(dead)", "r(recall)", "r(inreach)", "r(elsewhere)", "r(away)", "cs per inreach", "cs/min inreach");
    for (lane_slot, (role, _)) in LANES.iter().enumerate() {
        let gap = |f: &dyn Fn(&Laner) -> f64| -> Vec<f64> {
            rows.iter().map(|t| f(&t.snaps[m15][lane_slot].blue) - f(&t.snaps[m15][lane_slot].red)).collect()
        };
        let cs = gap(&|l| l.cs as f64);
        let r = |i: usize| pearson(&gap(&|l| f64::from(l.chunks[i])), &cs);
        let away = pearson(&gap(&|l| f64::from(l.chunks[0] + l.chunks[1] + l.chunks[3])), &cs);
        let per_reach: Vec<f64> = rows
            .iter()
            .flat_map(|t| [&t.snaps[m15][lane_slot].blue, &t.snaps[m15][lane_slot].red])
            .map(|l| l.cs as f64 / f64::from(l.chunks[2].max(1)))
            .collect();
        println!(
            "{role:<5}{:>8.2}{:>10.2}{:>10.2}{:>12.2}{:>12.2}{:>16.2}{:>16.1}",
            r(0), r(1), r(2), r(3), away, mean(&per_reach), mean(&per_reach) * 60.0 / (CHUNK_TICKS as f64 * TICK_SEC)
        );
    }
}

/// When each laner first had an enemy lane minion in reach, per lane and side:
/// the first-contact race. Blue and red should reach the first wave together.
fn table_first_contact(traces: &[FarmTrace]) {
    println!("\n== F7 first contact: second at which the laner first has an enemy lane minion in reach ==");
    println!("{:<5}{:>10}{:>10}{:>12}{:>12}{:>14}", "lane", "blue mean", "red mean", "blue first", "red first", "blue earlier");
    for (lane_slot, (role, _)) in LANES.iter().enumerate() {
        let pairs: Vec<(f64, f64)> = traces
            .iter()
            .filter_map(|t| Some((t.first_reach[lane_slot][0]?, t.first_reach[lane_slot][1]?)))
            .collect();
        let blue_first = pairs.iter().filter(|(b, r)| b < r).count();
        let red_first = pairs.iter().filter(|(b, r)| r < b).count();
        println!(
            "{role:<5}{:>10.1}{:>10.1}{:>11.0}%{:>11.0}%{:>14.1}",
            mean(&pairs.iter().map(|p| p.0).collect::<Vec<_>>()),
            mean(&pairs.iter().map(|p| p.1).collect::<Vec<_>>()),
            100.0 * blue_first as f64 / pairs.len().max(1) as f64,
            100.0 * red_first as f64 / pairs.len().max(1) as f64,
            mean(&pairs.iter().map(|p| p.1 - p.0).collect::<Vec<_>>()),
        );
    }
    println!("\n  distance walked from its own base (fraction of the path) at 30 / 45 / 60 / 90 s, mean over matches");
    for (lane_slot, (role, _)) in LANES.iter().enumerate() {
        for (side_slot, side) in ["blue", "red"].iter().enumerate() {
            let cells: Vec<String> = (0..ARC_SAMPLE_SECONDS.len())
                .map(|slot| {
                    let v: Vec<f64> = traces.iter().filter_map(|t| t.arc_at[lane_slot][side_slot][slot]).collect();
                    format!("{:.3}", mean(&v))
                })
                .collect();
            println!("  {role:<5}{side:<5}{}", cells.join(" / "));
        }
    }
}

#[test]
#[ignore = "measurement: run with --ignored --nocapture, see the module docs"]
fn measure_lane_farming() {
    let count: usize = std::env::var("FARM_HARNESS_N").ok().and_then(|v| v.parse().ok()).unwrap_or(200);
    let first_seed: usize = std::env::var("FARM_HARNESS_SEED").ok().and_then(|v| v.parse().ok()).unwrap_or(0);
    let last_minute: u32 = std::env::var("FARM_HARNESS_MINUTES").ok().and_then(|v| v.parse().ok()).unwrap_or(15);
    let pair = std::env::var("FARM_HARNESS_PAIR").unwrap_or_else(|_| "70,70".to_string());
    let stats: Vec<f64> = pair.split(',').filter_map(|s| s.trim().parse().ok()).collect();
    let (blue, red) = (Side::stat(stats[0]), Side::stat(stats[1]));
    println!("FARM matches={count} first_seed={first_seed} blue_stat={} red_stat={} last_minute={last_minute}", stats[0], stats[1]);
    let started = std::time::Instant::now();
    let traces = run_farm_traces(first_seed, count, blue, red, last_minute);
    println!("FARM played {} matches in {:.0} s", traces.len(), started.elapsed().as_secs_f64());
    table_cs_gap(&traces);
    table_mechanism(&traces, CHECKPOINT_MINUTES.len() - 1);
    table_mechanism(&traces, 1);
    table_compounding(&traces);
    table_wave_position(&traces);
    table_death_positions(&traces);
    table_gap_mediators(&traces);
    table_first_contact(&traces);
    table_health_and_recalls(&traces, CHECKPOINT_MINUTES.len() - 1);
}

#[test]
#[ignore = "debug trace"]
fn debug_trace_mid() {
    let seed: usize = std::env::var("FARM_SEED").ok().and_then(|v| v.parse().ok()).unwrap_or(0);
    let from: f64 = std::env::var("FARM_FROM").ok().and_then(|v| v.parse().ok()).unwrap_or(0.0);
    let to: f64 = std::env::var("FARM_TO").ok().and_then(|v| v.parse().ok()).unwrap_or(6.0);
    let role = std::env::var("FARM_ROLE").unwrap_or_else(|_| "MID".to_string());
    let store = SimLiveStoreState::default();
    let id = "dbg".to_string();
    init(&store, SimLiveInitRequest {
        session_id: id.clone(), seed: format!("farm-seed-{seed}"), snapshot: snapshot_with(Side::EVEN, Side::EVEN),
        champion_by_player_id: HashMap::new(), champion_profiles_by_id: HashMap::new(), champion_ultimates_by_id: HashMap::new(),
        initial_state: None, ai_mode: SimulatorAiMode::default(), policy: SimulatorPolicyConfig::default(),
    }).expect("init");
    let lane = LANES.iter().find(|(r, _)| *r == role).map(|(_, l)| *l).unwrap_or("mid");
    let path = lane_path_blue(lane);
    loop {
        skip_to_end(&store, SimLiveSkipToEndRequest { session_id: id.clone(), dt_sec: 0.2, speed: 12.0, max_ticks: CHUNK_TICKS }).expect("skip");
        let mut sessions = store.sessions.lock().expect("lock");
        if let Ok(only) = std::env::var("FARM_ONLY") {
            for c in &mut sessions.get_mut(&id).expect("session").state.champions {
                if !only.split(',').any(|r| r == c.role) {
                    c.alive = false;
                    c.hp = 0.0;
                    c.respawn_at = 1.0e9;
                }
            }
        }
        let rt = &sessions[&id].state;
        let minute = rt.time_sec / 60.0;
        if minute > to { break; }
        if minute < from { continue; }
        let tick = (rt.time_sec / 1.8).round() as u64;
        if !tick.is_multiple_of(3) { continue; }
        let mut line = format!("{:6.1}s", rt.time_sec);
        for blue in [true, false] {
            let i = laner_of(rt, &role, blue);
            let c = &rt.champions[i];
            let act = ["dead", "recall", "reach", "else"][activity(rt, i) as usize];
            line += &format!(" | {} a{:.2} hp{:3.0} {:<6} {:<5} cs{:3} dec:{}", if blue {"B"} else {"R"}, arc_fraction(c.pos, path), c.hp, act, c.state, c.cs, c.debug_ai_decision.chars().take(18).collect::<String>());
        }
        let wave = |blue: bool| {
            let v: Vec<&MinionRuntime> = rt.minions.iter().filter(|m| m.alive && normalized_lane(&m.lane) == lane && (normalized_team(&m.team) == "blue") == blue).collect();
            let hp: f64 = v.iter().map(|m| m.hp).sum();
            let a = v.iter().map(|m| arc_fraction(m.pos, path)).sum::<f64>() / v.len().max(1) as f64;
            (v.len(), hp, a)
        };
        let (bn, bh, ba) = wave(true);
        let (rn, rh, ra) = wave(false);
        line += &format!(" || minions B {bn:2}/{bh:4.0}hp@{ba:.2} R {rn:2}/{rh:4.0}hp@{ra:.2}");
        println!("{line}");
    }
}

#[test]
#[ignore = "debug: minion war without champions"]
fn debug_minion_war_without_champions() {
    let n: usize = std::env::var("FARM_HARNESS_N").ok().and_then(|v| v.parse().ok()).unwrap_or(20);
    let minutes: f64 = std::env::var("FARM_HARNESS_MINUTES").ok().and_then(|v| v.parse().ok()).unwrap_or(5.0);
    let mut totals: HashMap<(&'static str, bool, MinionKiller), (u32, f64)> = HashMap::new();
    for seed in 0..n {
        let store = SimLiveStoreState::default();
        let id = "war".to_string();
        init(&store, SimLiveInitRequest {
            session_id: id.clone(), seed: format!("farm-seed-{seed}"), snapshot: snapshot_with(Side::EVEN, Side::EVEN),
            champion_by_player_id: HashMap::new(), champion_profiles_by_id: HashMap::new(), champion_ultimates_by_id: HashMap::new(),
            initial_state: None, ai_mode: SimulatorAiMode::default(), policy: SimulatorPolicyConfig::default(),
        }).expect("init");
        loop {
            {
                let mut sessions = store.sessions.lock().expect("lock");
                let rt = &mut sessions.get_mut(&id).expect("session").state;
                for c in &mut rt.champions {
                    c.alive = false;
                    c.hp = 0.0;
                    c.respawn_at = 1.0e9;
                }
                if rt.time_sec > minutes * 60.0 {
                    for (key, tally) in rt.farm_ledger.deaths() {
                        let e = totals.entry((key.lane, key.minion_is_blue, key.killer)).or_default();
                        e.0 += tally.count;
                        e.1 += tally.arc_sum;
                    }
                    break;
                }
            }
            skip_to_end(&store, SimLiveSkipToEndRequest { session_id: id.clone(), dt_sec: 0.2, speed: 12.0, max_ticks: CHUNK_TICKS }).expect("skip");
        }
    }
    println!("minion war without champions, {n} matches, {minutes} min: deaths per match (count @mean arc)");
    for lane in ["top", "mid", "bot"] {
        for blue in [true, false] {
            let cells: Vec<String> = [MinionKiller::Tower, MinionKiller::Minion]
                .iter()
                .map(|k| {
                    let (c, a) = totals.get(&(lane, blue, *k)).copied().unwrap_or((0, 0.0));
                    format!("{:.1} @{:.3}", f64::from(c) / n as f64, a / f64::from(c.max(1)))
                })
                .collect();
            println!("{lane:<4}{:<13} tower {:>14}  minion {:>14}", if blue { "blue minions" } else { "red minions" }, cells[0], cells[1]);
        }
    }
}

#[test]
#[ignore = "debug: where a laner loses health"]
fn debug_hp_loss() {
    let seed: usize = std::env::var("FARM_SEED").ok().and_then(|v| v.parse().ok()).unwrap_or(0);
    let role = std::env::var("FARM_ROLE").unwrap_or_else(|_| "TOP".to_string());
    let red = std::env::var("FARM_RED").is_ok();
    let to: f64 = std::env::var("FARM_TO").ok().and_then(|v| v.parse().ok()).unwrap_or(8.0);
    let store = SimLiveStoreState::default();
    let id = "hp".to_string();
    init(&store, SimLiveInitRequest {
        session_id: id.clone(), seed: format!("farm-seed-{seed}"), snapshot: snapshot_with(Side::EVEN, Side::EVEN),
        champion_by_player_id: HashMap::new(), champion_profiles_by_id: HashMap::new(), champion_ultimates_by_id: HashMap::new(),
        initial_state: None, ai_mode: SimulatorAiMode::default(), policy: SimulatorPolicyConfig::default(),
    }).expect("init");
    let mut prev_hp = -1.0;
    loop {
        skip_to_end(&store, SimLiveSkipToEndRequest { session_id: id.clone(), dt_sec: 0.2, speed: 12.0, max_ticks: 1 }).expect("skip");
        let sessions = store.sessions.lock().expect("lock");
        let rt = &sessions[&id].state;
        if rt.time_sec / 60.0 > to { break; }
        let i = laner_of(rt, &role, !red);
        let c = &rt.champions[i];
        if prev_hp >= 0.0 && prev_hp - c.hp > 4.0 && c.alive {
            let team = normalized_team(&c.team);
            let enemy = if team == "blue" { "red" } else { "blue" };
            let near_min = rt.minions.iter().filter(|m| m.alive && normalized_team(&m.team) == enemy && dist(m.pos, c.pos) <= 0.06).count();
            let near_min_lane = rt.minions.iter().filter(|m| m.alive && normalized_team(&m.team) == enemy && normalized_lane(&m.lane) == normalized_lane(&c.lane) && dist(m.pos, c.pos) <= 0.06).count();
            let own_min = rt.minions.iter().filter(|m| m.alive && normalized_team(&m.team) == team && dist(m.pos, c.pos) <= 0.08).count();
            let tower = rt.structures.iter().filter(|s| s.alive && s.kind == "tower" && normalized_team(&s.team) == enemy && dist(s.pos, c.pos) <= 0.085).count();
            let champs: Vec<String> = rt.champions.iter().filter(|e| e.alive && normalized_team(&e.team) == enemy && dist(e.pos, c.pos) <= 0.19).map(|e| format!("{}@{:.2}", e.role, dist(e.pos, c.pos))).collect();
            println!("{:6.1}s hp {:5.0}->{:5.0}/{:3.0} lvl{} enemy minions near {near_min} (own lane {near_min_lane}) own minions near {own_min} enemy towers {tower} enemy champs {:?} state {}", rt.time_sec, prev_hp, c.hp, c.max_hp, c.level, champs, c.state);
        }
        prev_hp = c.hp;
    }
}

// --------------------------------------------------------- default (cheap) tests

/// Plays `ticks` ticks of an even match and returns the finished runtime.
fn short_run(seed: &str, ticks: u64) -> RuntimeState {
    let store = SimLiveStoreState::default();
    init(
        &store,
        SimLiveInitRequest {
            session_id: "farm-short".to_string(),
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
    skip_to_end(
        &store,
        SimLiveSkipToEndRequest {
            session_id: "farm-short".to_string(),
            dt_sec: 0.2,
            speed: 12.0,
            max_ticks: ticks,
        },
    )
    .expect("skip");
    let sessions = store.sessions.lock().expect("lock");
    sessions["farm-short"].state.clone()
}

/// Creep score a laner may hold from neutral camps by minute 15.
const OFF_ROLE_CAMP_CS_SLACK: i64 = 6;

#[test]
fn farm_ledger_holds_a_death_for_every_creep_score() {
    let runtime = short_run("farm-ledger-seed", 900);
    // Jungle camps also add creep score (all of the jungler's, a few of a laner's
    // when it helps a neutral objective); the ledger does not see them.
    for champion in runtime.champions.iter().filter(|c| c.role != "JGL") {
        let credited: u32 = runtime
            .farm_ledger
            .deaths()
            .iter()
            .filter(|(key, _)| {
                key.last_hit_by.as_deref() == Some(champion.id.as_str()) && key.killer != MinionKiller::Minion
            })
            .map(|(_, tally)| tally.count)
            .sum();
        assert!(
            i64::from(credited) + OFF_ROLE_CAMP_CS_SLACK >= champion.cs,
            "{} has {} creep score but the ledger holds {credited} champion or turret kills",
            champion.id,
            champion.cs
        );
    }
    assert!(runtime.champions.iter().any(|c| c.cs > 0), "the run farmed nothing");
}

#[test]
fn arc_fraction_runs_from_zero_at_the_blue_base_to_one_at_the_red_base() {
    let path = lane_path_blue("mid");
    assert!(arc_fraction(path[0], path) < 1e-9);
    assert!((arc_fraction(path[path.len() - 1], path) - 1.0).abs() < 1e-9);
}

/// Distance of every node of `lane`'s path from the base of the team that walks
/// it, as a fraction of the path, for blue and for red (red walks it reversed).
fn node_distances_from_own_base(lane: &str) -> (Vec<f64>, Vec<f64>) {
    let fractions = |team: &str| -> Vec<f64> {
        let path = lane_path_for(team, lane);
        let mut walked = vec![0.0];
        for pair in path.windows(2) {
            let last = *walked.last().expect("non-empty");
            walked.push(last + dist(pair[0], pair[1]));
        }
        let total = *walked.last().expect("non-empty");
        walked.iter().map(|w| w / total).collect()
    };
    (fractions("blue"), fractions("red"))
}

/// Anchors, the first-wave approach and the wave front are chosen by node index,
/// so node k must sit equally far from the blue base on the blue path and from
/// the red base on the red path. In the mid lane it did not: node 1 was 13% of
/// the way from the blue base and 24% from the red base, which put the red
/// laner in front of the wave first and handed it the lane (98% of matches).
#[test]
fn mid_lane_node_k_is_equally_far_from_both_bases() {
    let (blue, red) = node_distances_from_own_base("mid");
    for (k, (b, r)) in blue.iter().zip(&red).enumerate() {
        assert!((b - r).abs() < 0.01, "mid node {k}: {b:.3} from the blue base but {r:.3} from the red base");
    }
}

#[test]
#[ignore = "debug: where the two waves of a lane meet when no champion plays"]
fn debug_wave_meeting_without_champions() {
    let seed: usize = std::env::var("FARM_SEED").ok().and_then(|v| v.parse().ok()).unwrap_or(0);
    let lane = std::env::var("FARM_LANE").unwrap_or_else(|_| "top".to_string());
    let to: f64 = std::env::var("FARM_TO").ok().and_then(|v| v.parse().ok()).unwrap_or(120.0);
    let store = SimLiveStoreState::default();
    let id = "meet".to_string();
    init(&store, SimLiveInitRequest {
        session_id: id.clone(), seed: format!("farm-seed-{seed}"), snapshot: snapshot_with(Side::EVEN, Side::EVEN),
        champion_by_player_id: HashMap::new(), champion_profiles_by_id: HashMap::new(), champion_ultimates_by_id: HashMap::new(),
        initial_state: None, ai_mode: SimulatorAiMode::default(), policy: SimulatorPolicyConfig::default(),
    }).expect("init");
    let path = lane_path_blue(&lane);
    loop {
        {
            let mut sessions = store.sessions.lock().expect("lock");
            let rt = &mut sessions.get_mut(&id).expect("session").state;
            for c in &mut rt.champions {
                c.alive = false;
                c.hp = 0.0;
                c.respawn_at = 1.0e9;
            }
            if rt.time_sec > to {
                break;
            }
            let wave = |blue: bool| {
                let v: Vec<&MinionRuntime> = rt.minions.iter().filter(|m| m.alive && m.kind != "summon" && normalized_lane(&m.lane) == lane && (normalized_team(&m.team) == "blue") == blue).collect();
                let hp: f64 = v.iter().map(|m| m.hp).sum();
                let a = v.iter().map(|m| arc_fraction(m.pos, path)).sum::<f64>() / v.len().max(1) as f64;
                (v.len(), hp, a)
            };
            let (bn, bh, ba) = wave(true);
            let (rn, rh, ra) = wave(false);
            println!("{:6.1}s  blue {bn:2} minions {bh:5.0}hp @{ba:.3}   red {rn:2} minions {rh:5.0}hp @{ra:.3}", rt.time_sec);
        }
        skip_to_end(&store, SimLiveSkipToEndRequest { session_id: id.clone(), dt_sec: 0.2, speed: 12.0, max_ticks: CHUNK_TICKS }).expect("skip");
    }
}
