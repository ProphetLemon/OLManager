//! Headless measurement of how a stronger team uses a lead: per match the kill
//! and gold difference, who took which tower and when, Baron and Elder by side,
//! how long the stronger team had four or five champions alive against two or
//! fewer and what its champions were doing in that time, and how each lost
//! match was lost.
//!
//! Run it (release, a few minutes):
//! `LEAD_N=36 LEAD_STRONG=95 LEAD_WEAK=40 cargo test --release -p olm_core --lib
//! sim_live::lead_detector_tests::detect_wasted_leads -- --ignored --nocapture`
//! `LEAD_N` is matches per orientation (the strong team on blue, then on red).

use std::collections::{BTreeMap, HashMap};

use super::economy_tests::{snapshot_with, Side, FULL_MATCH_TICKS};
use super::*;

/// Ticks between two observations (keeps the macro cadence in phase).
const SAMPLE_TICKS: u64 = 3;
/// The stronger team has "the numbers" with at least this many alive...
const WINDOW_MIN_STRONG_ALIVE: usize = 4;
/// ...against at most this many.
const WINDOW_MAX_WEAK_ALIVE: usize = 2;
/// A champion this close to a living enemy structure counts as pushing it.
const PUSH_RADIUS: f64 = 0.12;
/// Distance from the own base that counts as "in base".
const BASE_RADIUS: f64 = 0.10;
/// A final kill lead of at least this many is a lead that should have won.
const BIG_LEAD_KILLS: i64 = 20;

struct StructureLoss {
    minute: f64,
    /// The stronger team destroyed it.
    by_strong: bool,
    kind: String,
    strong_alive: usize,
    weak_alive: usize,
    /// Champions of each team within `NEAR_RADIUS` of the structure.
    strong_near: usize,
    weak_near: usize,
}

/// A champion this close to a structure is taking part in the fight for it.
const NEAR_RADIUS: f64 = 0.30;

#[derive(Default)]
struct LeadMatch {
    seed: usize,
    strong_team: &'static str,
    winner: Option<String>,
    minutes: f64,
    /// Final kills of the stronger team minus the weaker one.
    kill_diff: i64,
    /// Total gold of the stronger team minus the weaker one at the end.
    gold_diff: f64,
    /// Structures in destruction order.
    structure_losses: Vec<StructureLoss>,
    /// Kill difference (strong minus weak) and structures destroyed by each
    /// side at minutes 10, 15, ... 40.
    timeline: Vec<(u32, i64, usize, usize)>,
    barons: (i64, i64),
    elders: (i64, i64),
    window_sec: f64,
    window_baron_alive_sec: f64,
    /// Seconds spent by the stronger team's champions in a window, by
    /// `state/place`, summed over champions.
    window_activity: BTreeMap<String, f64>,
    /// Seconds in a window while Baron or Elder was alive and at least three
    /// of the stronger team stood within the group radius of it.
    window_group_at_pit_sec: f64,
    /// Seconds in which the stronger team had at least two more champions alive,
    /// and what its champions did then (same keys as `window_activity`).
    wide_sec: f64,
    wide_activity: BTreeMap<String, f64>,
    /// Seconds the stronger team held the Baron buff, structures it destroyed
    /// meanwhile and what its champions did then.
    buff_sec: f64,
    buff_structures: usize,
    buff_activity: BTreeMap<String, f64>,
    /// What its champions did over the whole match.
    all_activity: BTreeMap<String, f64>,
}

fn other(team: &str) -> &'static str {
    if normalized_team(team) == "blue" {
        "red"
    } else {
        "blue"
    }
}

/// Where a champion stands, for the activity table.
fn place_of(
    champion: &ChampionRuntime,
    structures: &[StructureRuntime],
    timers: Option<&NeutralTimersRuntime>,
) -> &'static str {
    if dist(champion.pos, base_position_for(&champion.team)) <= BASE_RADIUS {
        return "base";
    }
    let at_pit = timers.is_some_and(|t| {
        t.entities.values().any(|timer| {
            timer.alive
                && macro_ai::is_major_objective_key(&timer.key)
                && dist(champion.pos, timer.pos) <= OBJECTIVE_ATTEMPT_RADIUS
        })
    });
    if at_pit {
        return "pit";
    }
    let pushing = structures.iter().any(|s| {
        s.alive
            && normalized_team(&s.team) != normalized_team(&champion.team)
            && dist(champion.pos, s.pos) <= PUSH_RADIUS
    });
    if pushing {
        return "enemy-structure";
    }
    "open"
}

fn run_lead_match(n: usize, strong_on_blue: bool, strong: Side, weak: Side) -> LeadMatch {
    let (home, away) = if strong_on_blue { (strong, weak) } else { (weak, strong) };
    let strong_team = if strong_on_blue { "blue" } else { "red" };
    let store = SimLiveStoreState::default();
    let session_id = format!("lead-{n}");
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

    let mut report = LeadMatch {
        seed: n,
        strong_team,
        ..LeadMatch::default()
    };
    let mut dead: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut ticks = 0u64;
    let mut last_time = 0.0;
    while ticks < FULL_MATCH_TICKS {
        let step = skip_to_end(
            &store,
            SimLiveSkipToEndRequest {
                session_id: session_id.clone(),
                dt_sec: 0.2,
                speed: 12.0,
                max_ticks: SAMPLE_TICKS,
            },
        )
        .expect("skip");
        ticks += step.ticks;
        let sessions = store.sessions.lock().expect("lock");
        let state = &sessions[&session_id].state;
        let now = state.time_sec;
        let dt = now - last_time;
        last_time = now;
        let timers = decode_neutral_timers_state(&state.neutral_timers);

        let alive = |team: &str| {
            state
                .champions
                .iter()
                .filter(|c| c.alive && normalized_team(&c.team) == team)
                .count()
        };
        let (strong_alive, weak_alive) = (alive(strong_team), alive(other(strong_team)));
        for s in state.structures.iter().filter(|s| !s.alive) {
            if dead.insert(s.id.clone()) {
                let near = |team: &str| {
                    state
                        .champions
                        .iter()
                        .filter(|c| {
                            c.alive
                                && normalized_team(&c.team) == team
                                && dist(c.pos, s.pos) <= NEAR_RADIUS
                        })
                        .count()
                };
                let buff_now = {
                    let b = runtime_buffs_from_extra(state.extra.get("teamBuffs"));
                    let side = if strong_team == "blue" { &b.blue } else { &b.red };
                    side.baron_until > now
                };
                if buff_now && normalized_team(&s.team) != strong_team {
                    report.buff_structures += 1;
                }
                report.structure_losses.push(StructureLoss {
                    minute: now / 60.0,
                    by_strong: normalized_team(&s.team) != strong_team,
                    kind: s.kind.clone(),
                    strong_alive,
                    weak_alive,
                    strong_near: near(strong_team),
                    weak_near: near(other(strong_team)),
                });
            }
        }
        let minute_mark = (now / 60.0) as u32;
        if minute_mark >= 10
            && minute_mark % 5 == 0
            && report.timeline.last().is_none_or(|(m, ..)| *m < minute_mark)
        {
            let kills = |team: &str| {
                if team == "blue" { state.stats.blue.kills } else { state.stats.red.kills }
            };
            let destroyed = |by_strong: bool| {
                report.structure_losses.iter().filter(|l| l.by_strong == by_strong).count()
            };
            report.timeline.push((
                minute_mark,
                kills(strong_team) - kills(other(strong_team)),
                destroyed(true),
                destroyed(false),
            ));
        }

        let buffs = runtime_buffs_from_extra(state.extra.get("teamBuffs"));
        let strong_side = if strong_team == "blue" { &buffs.blue } else { &buffs.red };
        let buffed = strong_side.baron_until > now && dt > 0.0;
        if buffed {
            report.buff_sec += dt;
        }
        let wide = strong_alive >= weak_alive + 2 && dt > 0.0;
        if wide {
            report.wide_sec += dt;
        }
        if dt > 0.0 {
            for champion in state
                .champions
                .iter()
                .filter(|c| c.alive && normalized_team(&c.team) == strong_team)
            {
                let key = format!(
                    "{}/{}",
                    champion.state,
                    place_of(champion, &state.structures, timers.as_ref())
                );
                *report.all_activity.entry(key.clone()).or_default() += dt;
                if buffed {
                    *report.buff_activity.entry(key.clone()).or_default() += dt;
                }
                if wide {
                    *report.wide_activity.entry(key).or_default() += dt;
                }
            }
        }
        if strong_alive >= WINDOW_MIN_STRONG_ALIVE && weak_alive <= WINDOW_MAX_WEAK_ALIVE && dt > 0.0 {
            report.window_sec += dt;
            let major_alive = timers.as_ref().and_then(|t| {
                t.entities
                    .values()
                    .find(|timer| timer.alive && macro_ai::is_major_objective_key(&timer.key))
            });
            if let Some(timer) = major_alive {
                report.window_baron_alive_sec += dt;
                if macro_ai::major_objective_group_ready(&state.champions, strong_team, timer.pos) {
                    report.window_group_at_pit_sec += dt;
                }
            }
            for champion in state
                .champions
                .iter()
                .filter(|c| c.alive && normalized_team(&c.team) == strong_team)
            {
                let place = place_of(champion, &state.structures, timers.as_ref());
                *report
                    .window_activity
                    .entry(format!("{}/{}", champion.state, place))
                    .or_default() += dt;
            }
        }
        if state.winner.is_some() {
            break;
        }
    }

    let sessions = store.sessions.lock().expect("lock");
    let state = &sessions[&session_id].state;
    let stats = |team: &str| {
        if team == "blue" {
            &state.stats.blue
        } else {
            &state.stats.red
        }
    };
    let gold = |team: &str| {
        state
            .champions
            .iter()
            .filter(|c| normalized_team(&c.team) == team)
            .map(|c| (c.gold + c.spent_gold) as f64)
            .sum::<f64>()
    };
    report.winner = state.winner.clone();
    report.minutes = state.time_sec / 60.0;
    report.kill_diff = stats(strong_team).kills - stats(other(strong_team)).kills;
    report.gold_diff = gold(strong_team) - gold(other(strong_team));
    report.barons = (stats(strong_team).barons, stats(other(strong_team)).barons);
    let elder_buff = |team: &str| {
        let buffs = runtime_buffs_from_extra(state.extra.get("teamBuffs"));
        let side = if team == "blue" { &buffs.blue } else { &buffs.red };
        side.elder_until > 0.0
    };
    report.elders = (
        i64::from(elder_buff(strong_team)),
        i64::from(elder_buff(other(strong_team))),
    );
    report
}

fn lead_batch(per_orientation: usize, strong: Side, weak: Side) -> Vec<LeadMatch> {
    let jobs: Vec<(usize, bool)> = (0..per_orientation)
        .map(|i| (1000 + i, true))
        .chain((0..per_orientation).map(|i| (2000 + i, false)))
        .collect();
    let workers = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .min(jobs.len().max(1));
    let jobs = &jobs;
    std::thread::scope(|scope| {
        let handles: Vec<_> = (0..workers)
            .map(|worker| {
                scope.spawn(move || {
                    (worker..jobs.len())
                        .step_by(workers)
                        .map(|i| run_lead_match(jobs[i].0, jobs[i].1, strong, weak))
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        let mut all: Vec<LeadMatch> = handles
            .into_iter()
            .flat_map(|handle| handle.join().expect("lead worker"))
            .collect();
        all.sort_by_key(|m| m.seed);
        all
    })
}

fn print_lead_report(label: &str, matches: &[LeadMatch]) {
    let n = matches.len();
    let won = |m: &LeadMatch| m.winner.as_deref() == Some(m.strong_team);
    let wins = matches.iter().filter(|m| won(m)).count();
    let big: Vec<&LeadMatch> = matches.iter().filter(|m| m.kill_diff >= BIG_LEAD_KILLS).collect();
    let big_lost = big.iter().filter(|m| !won(m)).count();
    println!(
        "== {label}: stronger wins {wins} of {n} ({:.0}%) | minutes {:.1} | kill diff {:.1} | big leads (>= {BIG_LEAD_KILLS} kills) {} of which lost {big_lost}",
        wins as f64 / n as f64 * 100.0,
        matches.iter().map(|m| m.minutes).sum::<f64>() / n as f64,
        matches.iter().map(|m| m.kill_diff as f64).sum::<f64>() / n as f64,
        big.len(),
    );
    let blue_wins = matches
        .iter()
        .filter(|m| m.winner.as_deref() == Some("blue"))
        .count();
    println!(
        "   blue wins {blue_wins} of {n} ({:.0}%), matches never ended {}",
        blue_wins as f64 / n as f64 * 100.0,
        matches.iter().filter(|m| m.winner.is_none()).count()
    );
    let mean = |f: fn(&LeadMatch) -> f64| matches.iter().map(f).sum::<f64>() / n as f64;
    println!(
        "   barons strong/weak {}/{} | windows (4-5 alive vs <= 2): mean {:.0} s per match, of which a major objective alive {:.0} s and a group of the strong team at it {:.0} s",
        matches.iter().map(|m| m.barons.0).sum::<i64>(),
        matches.iter().map(|m| m.barons.1).sum::<i64>(),
        mean(|m| m.window_sec),
        mean(|m| m.window_baron_alive_sec),
        mean(|m| m.window_group_at_pit_sec),
    );
    let mut activity: BTreeMap<&str, f64> = BTreeMap::new();
    for m in matches {
        for (key, sec) in &m.window_activity {
            *activity.entry(key.as_str()).or_default() += sec;
        }
    }
    let total: f64 = activity.values().sum();
    let mut rows: Vec<_> = activity.into_iter().collect();
    rows.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(Ordering::Equal));
    println!("   what the stronger team's champions did in those windows (share of champion-seconds):");
    for (key, sec) in rows.iter().take(8) {
        println!("     {key:<24} {:>5.1}%", sec / total.max(1.0) * 100.0);
    }
    println!(
        "   seconds with >= 2 more champions alive than the enemy: mean {:.0} per match ({:.0}% of the match)",
        mean(|m| m.wide_sec),
        matches.iter().map(|m| m.wide_sec).sum::<f64>()
            / matches.iter().map(|m| m.minutes * 60.0).sum::<f64>().max(1.0)
            * 100.0
    );
    println!(
        "   Baron buff held {:.0} s per match; structures destroyed under it {:.2} per match ({:.2} per 180 s of buff)",
        mean(|m| m.buff_sec),
        mean(|m| m.buff_structures as f64),
        matches.iter().map(|m| m.buff_structures as f64).sum::<f64>()
            / (matches.iter().map(|m| m.buff_sec).sum::<f64>() / 180.0).max(1e-9)
    );
    for (title, pick) in [
        ("with >= 2 more alive", (|m: &LeadMatch| &m.wide_activity) as fn(&LeadMatch) -> &BTreeMap<String, f64>),
        ("while holding the Baron buff", |m: &LeadMatch| &m.buff_activity),
        ("over the whole match", |m: &LeadMatch| &m.all_activity),
    ] {
        let mut activity: BTreeMap<&str, f64> = BTreeMap::new();
        for m in matches {
            for (key, sec) in pick(m) {
                *activity.entry(key.as_str()).or_default() += sec;
            }
        }
        let total: f64 = activity.values().sum();
        let mut rows: Vec<_> = activity.into_iter().collect();
        rows.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(Ordering::Equal));
        println!("   stronger team's champions, {title}:");
        for (key, sec) in rows.iter().take(9) {
            println!("     {key:<28} {:>5.1}%", sec / total.max(1.0) * 100.0);
        }
    }
    for (title, lost) in [("in matches it won", false), ("in matches it lost", true)] {
        let subset: Vec<&LeadMatch> = matches.iter().filter(|m| won(m) != lost).collect();
        let total: f64 = subset.iter().flat_map(|m| m.all_activity.values()).sum();
        let share = |key: &str| {
            subset.iter().filter_map(|m| m.all_activity.get(key)).sum::<f64>() / total.max(1.0)
                * 100.0
        };
        println!(
            "   stronger team {title} ({} matches): objective/base {:.1}% | objective/pit {:.1}% | lane/enemy-structure {:.1}% | objective/enemy-structure {:.1}% | recall/open {:.1}%",
            subset.len(),
            share("objective/base"),
            share("objective/pit"),
            share("lane/enemy-structure"),
            share("objective/enemy-structure"),
            share("recall/open"),
        );
    }
    let towers = |m: &LeadMatch, strong: bool| {
        m.structure_losses
            .iter()
            .filter(|l| l.by_strong == strong && l.kind == "tower")
            .count()
    };
    println!(
        "   towers destroyed per match: stronger {:.1} weaker {:.1}",
        matches.iter().map(|m| towers(m, true)).sum::<usize>() as f64 / n as f64,
        matches.iter().map(|m| towers(m, false)).sum::<usize>() as f64 / n as f64,
    );
    // Who fought for the structures the weaker team destroyed, and what the
    // stronger team's champions did meanwhile.
    for by_strong in [true, false] {
        let losses: Vec<&StructureLoss> = matches
            .iter()
            .flat_map(|m| m.structure_losses.iter())
            .filter(|l| l.by_strong == by_strong && l.kind != "nexus")
            .collect();
        let mean = |f: fn(&StructureLoss) -> usize| {
            losses.iter().map(|l| f(l) as f64).sum::<f64>() / losses.len().max(1) as f64
        };
        println!(
            "   structures destroyed by the {} team: {} | alive strong/weak at that moment {:.1}/{:.1} | within {NEAR_RADIUS} of it strong/weak {:.1}/{:.1} | with no strong champion near {}",
            if by_strong { "stronger" } else { "weaker" },
            losses.len(),
            mean(|l| l.strong_alive),
            mean(|l| l.weak_alive),
            mean(|l| l.strong_near),
            mean(|l| l.weak_near),
            losses.iter().filter(|l| l.strong_near == 0).count(),
        );
    }
    for minute in [10, 15, 20, 25, 30, 35, 40] {
        let rows: Vec<&(u32, i64, usize, usize)> = matches
            .iter()
            .filter_map(|m| m.timeline.iter().find(|(t, ..)| *t == minute))
            .collect();
        let count = rows.len().max(1) as f64;
        println!(
            "   minute {minute}: {} matches running | kill diff {:+.1} | structures destroyed by stronger {:.1} by weaker {:.1}",
            rows.len(),
            rows.iter().map(|r| r.1 as f64).sum::<f64>() / count,
            rows.iter().map(|r| r.2 as f64).sum::<f64>() / count,
            rows.iter().map(|r| r.3 as f64).sum::<f64>() / count,
        );
    }
    for m in matches.iter().filter(|m| !won(m)) {
        let first_enemy_tower = m
            .structure_losses
            .iter()
            .find(|l| l.by_strong)
            .map_or(-1.0, |l| l.minute);
        let timeline: Vec<String> = m
            .timeline
            .iter()
            .map(|(t, k, s, w)| format!("{t}m {k:+}k {s}/{w}"))
            .collect();
        println!(
            "   LOST seed {} ({}) {:.1} min | kills {:+} | gold {:+.0} | towers strong {} weak {} | structures strong {} weak {} | barons {}/{} | window {:.0} s (baron alive {:.0}, group {:.0}) | first enemy structure at {:.1} min | winner {:?}\n        timeline {}",
            m.seed,
            m.strong_team,
            m.minutes,
            m.kill_diff,
            m.gold_diff,
            towers(m, true),
            towers(m, false),
            m.structure_losses.iter().filter(|l| l.by_strong).count(),
            m.structure_losses.iter().filter(|l| !l.by_strong).count(),
            m.barons.0,
            m.barons.1,
            m.window_sec,
            m.window_baron_alive_sec,
            m.window_group_at_pit_sec,
            first_enemy_tower,
            m.winner,
            timeline.join(" | ")
        );
    }
}

fn env_side(name: &str, default: f64) -> f64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

#[test]
#[ignore = "slow: 2 x LEAD_N full matches (minutes in release); run when changing macro play"]
fn detect_wasted_leads() {
    let n = std::env::var("LEAD_N")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(36);
    let strong = env_side("LEAD_STRONG", 95.0);
    let weak = env_side("LEAD_WEAK", 40.0);
    let matches = lead_batch(n, Side::stat(strong), Side::stat(weak));
    print_lead_report(&format!("{strong} vs {weak}"), &matches);
}

#[test]
fn place_of_tells_base_pit_and_open_ground_apart() {
    let mut champion = super::test_helpers::test_champion(
        "c",
        "blue",
        "MID",
        "mid",
        base_position_for("blue"),
    );
    assert_eq!(place_of(&champion, &[], None), "base");
    champion.pos = Vec2 { x: 0.5, y: 0.5 };
    assert_eq!(place_of(&champion, &[], None), "open");
}

/// Prints what both teams do every `LEAD_TRACE_STEP` seconds of one match, for
/// reading a lost lead by eye: `LEAD_TRACE_SEED=2002 LEAD_TRACE_FROM=18
/// LEAD_TRACE_TO=34` (minutes). Seeds 1000.. put the stronger team on blue,
/// 2000.. on red.
#[test]
#[ignore = "diagnostic: prints one match; needs LEAD_TRACE_SEED"]
fn trace_one_match() {
    let Some(seed) = std::env::var("LEAD_TRACE_SEED").ok().and_then(|v| v.parse::<usize>().ok())
    else {
        return;
    };
    let from = env_side("LEAD_TRACE_FROM", 0.0) * 60.0;
    let to = env_side("LEAD_TRACE_TO", 60.0) * 60.0;
    let step = env_side("LEAD_TRACE_STEP", 20.0);
    let strong_on_blue = seed < 2000;
    let (home, away) = if strong_on_blue {
        (Side::stat(95.0), Side::stat(40.0))
    } else {
        (Side::stat(40.0), Side::stat(95.0))
    };
    let strong_team = if strong_on_blue { "blue" } else { "red" };
    let store = SimLiveStoreState::default();
    let session_id = format!("trace-{seed}");
    init(
        &store,
        SimLiveInitRequest {
            session_id: session_id.clone(),
            seed: format!("economy-seed-{seed}"),
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
    let mut next_print = from;
    let mut ticks = 0u64;
    while ticks < FULL_MATCH_TICKS {
        let tick = skip_to_end(
            &store,
            SimLiveSkipToEndRequest {
                session_id: session_id.clone(),
                dt_sec: 0.2,
                speed: 12.0,
                max_ticks: SAMPLE_TICKS,
            },
        )
        .expect("skip");
        ticks += tick.ticks;
        let sessions = store.sessions.lock().expect("lock");
        let state = &sessions[&session_id].state;
        if state.time_sec >= to || state.winner.is_some() {
            break;
        }
        if state.time_sec < next_print {
            continue;
        }
        next_print += step;
        let timers = decode_neutral_timers_state(&state.neutral_timers);
        let describe = |team: &str| -> String {
            state
                .champions
                .iter()
                .filter(|c| normalized_team(&c.team) == team)
                .map(|c| {
                    if c.alive {
                        format!(
                            "{}{}:{}/{} ({:.2},{:.2}) {:.0}%",
                            if c.attack_cd_until > state.time_sec { "*" } else { "" },
                            c.role,
                            c.state,
                            place_of(c, &state.structures, timers.as_ref()),
                            c.pos.x,
                            c.pos.y,
                            c.hp / c.max_hp * 100.0
                        )
                    } else {
                        format!("{}:dead {:.0}s", c.role, c.respawn_at - state.time_sec)
                    }
                })
                .collect::<Vec<_>>()
                .join(" | ")
        };
        let alive_structures = |team: &str| {
            state
                .structures
                .iter()
                .filter(|s| s.alive && normalized_team(&s.team) == team)
                .count()
        };
        let damaged: Vec<String> = state
            .structures
            .iter()
            .filter(|s| s.alive && s.hp < s.max_hp)
            .map(|s| format!("{} {:.0}%", s.id, s.hp / s.max_hp * 100.0))
            .collect();
        println!("          damaged: {}", damaged.join(", "));
        println!(
            "{:5.1} min  STRONG({strong_team}) structures {} :: {}\n          weak structures {} :: {}",
            state.time_sec / 60.0,
            alive_structures(strong_team),
            describe(strong_team),
            alive_structures(other(strong_team)),
            describe(other(strong_team)),
        );
    }
}
