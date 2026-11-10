//! Headless detector for neutral-objective and jungler problems: runs seeded
//! matches to the end and reports solo Baron and Elder kills, champions that
//! stand still outside base, and every time the stuck trigger fired.
//!
//! Run it (release is about 5 times faster than debug):
//! `SIM_DETECT_N=100 cargo test --release -p olm_core --lib
//! sim_live::objectives_detector_tests::detect_objective_and_jungler_problems
//! -- --ignored --nocapture`
//! `SIM_DETECT_FROM` shifts the first seed so a long measurement can be split.

use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap};

use super::economy_tests::{snapshot_with, Side, FULL_MATCH_TICKS};
use super::*;

/// Ticks between two observations. Three keeps the skip-to-end macro cadence
/// (every third tick) in phase, so a sampled run equals a single skip run.
const SAMPLE_TICKS: u64 = 3;
/// A living champion outside base that moves less than this for longer than
/// `IDLE_LIMIT_SEC` is reported as idle.
const IDLE_RADIUS: f64 = 0.01;
/// A champion that hovers inside this radius (bouncing between two targets,
/// for instance) for longer than `IDLE_LIMIT_SEC` is reported as loitering.
const LOITER_RADIUS: f64 = 0.06;
const IDLE_LIMIT_SEC: f64 = 45.0;
/// Distance from the own base that still counts as "in base".
const IDLE_BASE_RADIUS: f64 = 0.10;
/// A champion that attacked within this many seconds is fighting, not idle.
const IDLE_FIGHT_WINDOW_SEC: f64 = 4.0;
/// Cell size of the stuck-position histogram.
const STUCK_CELL: f64 = 0.05;

#[derive(Clone, Debug)]
pub(super) struct StuckEvent {
    pub(super) time: f64,
    pub(super) role: String,
    pub(super) team: String,
    pub(super) pos: Vec2,
    pub(super) target: Option<Vec2>,
}

thread_local! {
    static STUCK_LOG: RefCell<Vec<StuckEvent>> = const { RefCell::new(Vec::new()) };
}

/// Called by `move_champions` (test builds only) when the stuck trigger fires.
pub(super) fn record_stuck(time: f64, champion: &ChampionRuntime, target: Option<Vec2>) {
    STUCK_LOG.with(|log| {
        log.borrow_mut().push(StuckEvent {
            time,
            role: champion.role.clone(),
            team: champion.team.clone(),
            pos: champion.pos,
            target,
        })
    });
}

fn take_stuck_log() -> Vec<StuckEvent> {
    STUCK_LOG.with(|log| std::mem::take(&mut *log.borrow_mut()))
}

/// Tracks how long one champion stayed within `IDLE_RADIUS` of an anchor.
struct IdleTracker {
    radius: f64,
    anchor: Option<(f64, Vec2)>,
}

impl IdleTracker {
    fn new(radius: f64) -> Self {
        Self {
            radius,
            anchor: None,
        }
    }

    /// Feeds one observation. Returns `(start, end)` of a finished stretch that
    /// lasted longer than `IDLE_LIMIT_SEC`; `eligible` false ends any stretch.
    fn observe(&mut self, time: f64, pos: Vec2, eligible: bool) -> Option<(f64, f64)> {
        match self.anchor {
            Some((_, anchor)) if eligible && dist(anchor, pos) <= self.radius => None,
            Some((start, _)) => {
                self.anchor = eligible.then_some((time, pos));
                (time - start > IDLE_LIMIT_SEC).then_some((start, time))
            }
            None => {
                self.anchor = eligible.then_some((time, pos));
                None
            }
        }
    }

    /// Closes the stretch still open when the match ends.
    fn finish(&mut self, time: f64) -> Option<(f64, f64)> {
        let (start, _) = self.anchor.take()?;
        (time - start > IDLE_LIMIT_SEC).then_some((start, time))
    }
}

#[derive(Clone, Debug)]
struct IdleStretch {
    kind: &'static str,
    role: String,
    state: String,
    pos: Vec2,
    start: f64,
    end: f64,
    path_empty: bool,
    /// Nearest alive Baron, Elder, dragon, herald or grubs and its distance.
    objective_alive: Option<(String, f64)>,
}

#[derive(Clone, Debug)]
struct ObjectiveKill {
    key: String,
    time: f64,
    team: String,
    /// Champions of each team within the attack radius, peak over the attempt.
    peak_killer_side: usize,
    peak_other_side: usize,
    /// Same count at the last sample before the kill.
    last_killer_side: usize,
    last_other_side: usize,
    killer_level: i64,
    jungler_level: i64,
    jungler_kills: i64,
    jungler_deaths: i64,
}

#[derive(Default)]
struct Attempt {
    peak: HashMap<String, usize>,
    last: HashMap<String, usize>,
}

#[derive(Default)]
struct MatchReport {
    seed: usize,
    minutes: f64,
    kills: f64,
    ended: bool,
    objective_kills: Vec<ObjectiveKill>,
    idle: Vec<IdleStretch>,
    stuck: Vec<StuckEvent>,
}

fn other_team(team: &str) -> &'static str {
    if normalized_team(team) == "blue" {
        "red"
    } else {
        "blue"
    }
}

fn near_pit(champions: &[ChampionRuntime], pos: Vec2, team: &str) -> Vec<i64> {
    champions
        .iter()
        .filter(|c| {
            c.alive && normalized_team(&c.team) == team && dist(c.pos, pos) <= OBJECTIVE_ATTEMPT_RADIUS
        })
        .map(|c| c.level)
        .collect()
}

fn run_detected_match(seed: usize) -> MatchReport {
    take_stuck_log();
    let store = SimLiveStoreState::default();
    let session_id = format!("objectives-{seed}");
    init(
        &store,
        SimLiveInitRequest {
            session_id: session_id.clone(),
            seed: format!("objectives-seed-{seed}"),
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

    let mut report = MatchReport {
        seed,
        ..MatchReport::default()
    };
    let mut trackers: HashMap<(String, &'static str), IdleTracker> = HashMap::new();
    let mut attempts: HashMap<String, Attempt> = HashMap::new();
    let mut previous_taken: HashMap<String, i64> = HashMap::new();
    let mut previous_buffs: HashMap<(String, &'static str), f64> = HashMap::new();
    let mut ticks = 0u64;

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
        let timers = decode_neutral_timers_state(&state.neutral_timers);
        let buffs = runtime_buffs_from_extra(state.extra.get("teamBuffs"));

        if let Some(timers) = &timers {
            for key in ["baron", "elder"] {
                let Some(timer) = timers.entities.get(key) else {
                    continue;
                };
                let taken = previous_taken.insert(key.to_string(), timer.times_taken);
                let attempt = attempts.entry(key.to_string()).or_default();
                if taken.is_some_and(|before| timer.times_taken > before) {
                    let killer_team = ["blue", "red"]
                        .into_iter()
                        .find(|team| {
                            let until = |b: &RuntimeBuffState| {
                                let t = if *team == "blue" { &b.blue } else { &b.red };
                                if key == "baron" {
                                    t.baron_until
                                } else {
                                    t.elder_until
                                }
                            };
                            until(&buffs)
                                > previous_buffs
                                    .get(&(team.to_string(), key))
                                    .copied()
                                    .unwrap_or(0.0)
                        })
                        .unwrap_or("blue");
                    let other = other_team(killer_team);
                    let jungler = state
                        .champions
                        .iter()
                        .find(|c| normalized_team(&c.team) == killer_team && c.role == "JGL");
                    let near = near_pit(&state.champions, timer.pos, killer_team);
                    report.objective_kills.push(ObjectiveKill {
                        key: key.to_string(),
                        time: now,
                        team: killer_team.to_string(),
                        peak_killer_side: attempt.peak.get(killer_team).copied().unwrap_or(0),
                        peak_other_side: attempt.peak.get(other).copied().unwrap_or(0),
                        last_killer_side: attempt.last.get(killer_team).copied().unwrap_or(0),
                        last_other_side: attempt.last.get(other).copied().unwrap_or(0),
                        killer_level: near.iter().copied().max().unwrap_or(0),
                        jungler_level: jungler.map_or(0, |j| j.level),
                        jungler_kills: jungler.map_or(0, |j| j.kills),
                        jungler_deaths: jungler.map_or(0, |j| j.deaths),
                    });
                    *attempt = Attempt::default();
                } else if !timer.alive || timer.hp >= timer.max_hp {
                    *attempt = Attempt::default();
                } else {
                    for team in ["blue", "red"] {
                        let count = near_pit(&state.champions, timer.pos, team).len();
                        let peak = attempt.peak.entry(team.to_string()).or_default();
                        *peak = (*peak).max(count);
                        attempt.last.insert(team.to_string(), count);
                    }
                }
            }
        }
        for team in ["blue", "red"] {
            let side = if team == "blue" { &buffs.blue } else { &buffs.red };
            previous_buffs.insert((team.to_string(), "baron"), side.baron_until);
            previous_buffs.insert((team.to_string(), "elder"), side.elder_until);
        }

        for champion in &state.champions {
            let base = base_position_for(&champion.team);
            let fighting = now - champion.last_damaged_at < IDLE_FIGHT_WINDOW_SEC
                || champion.attack_cd_until > now - IDLE_FIGHT_WINDOW_SEC / 2.0;
            let eligible = champion.alive
                && champion.realm_banished_until <= 0.0
                && champion.state != "recall"
                && dist(champion.pos, base) > IDLE_BASE_RADIUS
                && !fighting;
            for (kind, radius) in [("still", IDLE_RADIUS), ("loiter", LOITER_RADIUS)] {
                let tracker = trackers
                    .entry((champion.id.clone(), kind))
                    .or_insert_with(|| IdleTracker::new(radius));
                if let Some((start, end)) = tracker.observe(now, champion.pos, eligible) {
                    let objective_alive = timers.as_ref().and_then(|t| {
                        t.entities
                            .values()
                            .filter(|timer| timer.alive && is_objective_neutral_key(&timer.key))
                            .map(|timer| (timer.key.clone(), dist(champion.pos, timer.pos)))
                            .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(Ordering::Equal))
                    });
                    report.idle.push(IdleStretch {
                        kind,
                        role: champion.role.clone(),
                        state: champion.state.clone(),
                        pos: champion.pos,
                        start,
                        end,
                        path_empty: champion.target_path.is_empty(),
                        objective_alive,
                    });
                }
            }
        }

        if state.winner.is_some() {
            report.ended = true;
            break;
        }
    }

    let sessions = store.sessions.lock().expect("lock");
    let state = &sessions[&session_id].state;
    // A finished match leaves everybody standing around: only an unfinished
    // one has a meaningful open stretch.
    for champion in state.champions.iter().filter(|_| state.winner.is_none()) {
        for kind in ["still", "loiter"] {
            if let Some((start, end)) = trackers
                .get_mut(&(champion.id.clone(), kind))
                .and_then(|tracker| tracker.finish(state.time_sec))
            {
                report.idle.push(IdleStretch {
                    kind,
                    role: champion.role.clone(),
                    state: champion.state.clone(),
                    pos: champion.pos,
                    start,
                    end,
                    path_empty: champion.target_path.is_empty(),
                    objective_alive: None,
                });
            }
        }
    }
    report.minutes = state.time_sec / 60.0;
    report.kills = (state.stats.blue.kills + state.stats.red.kills) as f64;
    report.ended = state.winner.is_some();
    report.stuck = take_stuck_log();
    report
}

fn detect_batch(first_seed: usize, seeds: usize) -> Vec<MatchReport> {
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
                        .map(|n| run_detected_match(first_seed + n))
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        let mut reports: Vec<MatchReport> = handles
            .into_iter()
            .flat_map(|handle| handle.join().expect("detector worker"))
            .collect();
        reports.sort_by_key(|r| r.seed);
        reports
    })
}

fn percentile(sorted: &[f64], q: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    sorted[((sorted.len() - 1) as f64 * q).round() as usize]
}

fn print_report(reports: &[MatchReport]) {
    let n = reports.len();
    let mut minutes: Vec<f64> = reports.iter().map(|r| r.minutes).collect();
    minutes.sort_by(|a, b| a.partial_cmp(b).unwrap_or(Ordering::Equal));
    let kills = reports.iter().map(|r| r.kills).sum::<f64>() / n as f64;
    let unfinished = reports.iter().filter(|r| !r.ended).count();
    println!(
        "matches {n} | minutes mean {:.1} p10 {:.1} p50 {:.1} p90 {:.1} max {:.1} | kills/match {kills:.1} | never ended {unfinished}",
        minutes.iter().sum::<f64>() / n as f64,
        percentile(&minutes, 0.1),
        percentile(&minutes, 0.5),
        percentile(&minutes, 0.9),
        percentile(&minutes, 1.0),
    );

    for key in ["baron", "elder"] {
        let kills: Vec<&ObjectiveKill> = reports
            .iter()
            .flat_map(|r| r.objective_kills.iter())
            .filter(|k| k.key == key)
            .collect();
        let solo = kills.iter().filter(|k| k.peak_killer_side <= 1).count();
        let at_most_two = kills.iter().filter(|k| k.peak_killer_side <= 2).count();
        let last_solo = kills.iter().filter(|k| k.last_killer_side <= 1).count();
        let losing_jungler = kills
            .iter()
            .filter(|k| k.jungler_deaths >= k.jungler_kills + 3)
            .count();
        let matches_with = reports
            .iter()
            .filter(|r| r.objective_kills.iter().any(|k| k.key == key))
            .count();
        println!(
            "{key}: {} kills in {matches_with} matches | killer side peak <=1 (solo): {solo} | <=2: {at_most_two} | at the last sample <=1: {last_solo} | killing jungler deaths >= kills+3: {losing_jungler}",
            kills.len()
        );
        for (seed, kill) in reports.iter().flat_map(|r| {
            r.objective_kills
                .iter()
                .filter(|k| k.key == key)
                .map(move |k| (r.seed, k))
        }) {
            println!(
                "  seed {seed} {:>5.1} min {} peak {}v{} last {}v{} killer lvl {} | jgl lvl {} {}/{}",
                kill.time / 60.0,
                kill.team,
                kill.peak_killer_side,
                kill.peak_other_side,
                kill.last_killer_side,
                kill.last_other_side,
                kill.killer_level,
                kill.jungler_level,
                kill.jungler_kills,
                kill.jungler_deaths
            );
        }
    }

    for kind in ["still", "loiter"] {
        let radius = if kind == "still" { IDLE_RADIUS } else { LOITER_RADIUS };
        let stretches: Vec<(usize, &IdleStretch)> = reports
            .iter()
            .flat_map(|r| r.idle.iter().map(move |s| (r.seed, s)))
            .filter(|(_, s)| s.kind == kind)
            .collect();
        println!(
            "{kind}: living champions outside base, not fighting, not recalling, inside {radius} for over {IDLE_LIMIT_SEC} s:"
        );
        let mut by_role: BTreeMap<&str, (usize, f64)> = BTreeMap::new();
        for (_, stretch) in &stretches {
            let entry = by_role.entry(stretch.role.as_str()).or_default();
            entry.0 += 1;
            entry.1 += stretch.end - stretch.start;
        }
        for (role, (count, seconds)) in &by_role {
            println!(
                "  {role}: {count} stretches, {seconds:.0} s total, mean {:.0} s",
                seconds / *count as f64
            );
        }
        let jungler: Vec<&(usize, &IdleStretch)> =
            stretches.iter().filter(|(_, s)| s.role == "JGL").collect();
        let matches = jungler
            .iter()
            .map(|(seed, _)| *seed)
            .collect::<std::collections::BTreeSet<_>>()
            .len();
        let near_objective = jungler
            .iter()
            .filter(|(_, s)| {
                s.objective_alive
                    .as_ref()
                    .is_some_and(|(_, d)| *d <= OBJECTIVE_ASSIST_RADIUS)
            })
            .count();
        let empty_path = jungler.iter().filter(|(_, s)| s.path_empty).count();
        println!(
            "  jungler: {} stretches in {matches} of {n} matches; within the assist radius of an alive objective {near_objective}; empty path at the end {empty_path}",
            jungler.len()
        );
        let mut cells: BTreeMap<(i64, i64), usize> = BTreeMap::new();
        for (_, stretch) in &jungler {
            *cells
                .entry((
                    (stretch.pos.x / STUCK_CELL).floor() as i64,
                    (stretch.pos.y / STUCK_CELL).floor() as i64,
                ))
                .or_default() += 1;
        }
        let mut cells: Vec<_> = cells.into_iter().collect();
        cells.sort_by_key(|(_, count)| std::cmp::Reverse(*count));
        for ((cx, cy), count) in cells.iter().take(5) {
            println!(
                "  jungler cell x {:.2} y {:.2}: {count}",
                *cx as f64 * STUCK_CELL,
                *cy as f64 * STUCK_CELL
            );
        }
        for (seed, stretch) in jungler.iter().take(12).map(|entry| **entry) {
            println!(
                "  seed {seed} JGL {:.1}-{:.1} min at ({:.2},{:.2}) state {} path_empty {} objective {:?}",
                stretch.start / 60.0,
                stretch.end / 60.0,
                stretch.pos.x,
                stretch.pos.y,
                stretch.state,
                stretch.path_empty,
                stretch.objective_alive
            );
        }
    }

    let stuck: Vec<&StuckEvent> = reports.iter().flat_map(|r| r.stuck.iter()).collect();
    let mut by_role: BTreeMap<&str, usize> = BTreeMap::new();
    let mut by_cell: BTreeMap<(i64, i64), usize> = BTreeMap::new();
    let (mut upper_right, mut after_25_min) = (0, 0);
    for event in &stuck {
        *by_role.entry(event.role.as_str()).or_default() += 1;
        *by_cell
            .entry((
                (event.pos.x / STUCK_CELL).floor() as i64,
                (event.pos.y / STUCK_CELL).floor() as i64,
            ))
            .or_default() += 1;
        if event.pos.x >= 0.55 && event.pos.y <= 0.45 {
            upper_right += 1;
        }
        if (25.0 * 60.0..=30.0 * 60.0).contains(&event.time) {
            after_25_min += 1;
        }
    }
    println!(
        "stuck trigger fired {} times ({:.1} per match), by role {by_role:?}; upper right (x>=0.55, y<=0.45): {upper_right}; between minute 25 and 30: {after_25_min}",
        stuck.len(),
        stuck.len() as f64 / n as f64
    );
    let mut cells: Vec<_> = by_cell.into_iter().collect();
    cells.sort_by_key(|(_, count)| std::cmp::Reverse(*count));
    for ((cx, cy), count) in cells.iter().take(10) {
        println!(
            "  stuck cell x {:.2}-{:.2} y {:.2}-{:.2}: {count}",
            *cx as f64 * STUCK_CELL,
            (*cx + 1) as f64 * STUCK_CELL,
            *cy as f64 * STUCK_CELL,
            (*cy + 1) as f64 * STUCK_CELL
        );
    }
    for event in stuck
        .iter()
        .filter(|e| e.pos.x >= 0.55 && e.pos.y <= 0.45)
        .take(10)
    {
        println!(
            "  upper right: {:.1} min {} {} at ({:.3},{:.3}) target {:?}",
            event.time / 60.0,
            event.team,
            event.role,
            event.pos.x,
            event.pos.y,
            event.target.map(|t| (t.x, t.y))
        );
    }
}

#[test]
#[ignore = "slow: about 100 full matches sampled every 1.8 s (minutes in release); run when changing objectives, the jungler or pathing"]
fn detect_objective_and_jungler_problems() {
    let n = env_count("SIM_DETECT_N", 100);
    let first = env_count("SIM_DETECT_FROM", 0);
    let reports = detect_batch(first, n);
    print_report(&reports);
}

fn env_count(name: &str, default: usize) -> usize {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

fn at(x: f64, y: f64) -> Vec2 {
    Vec2 { x, y }
}

#[test]
fn idle_tracker_reports_a_stretch_longer_than_the_limit() {
    let mut tracker = IdleTracker::new(IDLE_RADIUS);
    assert_eq!(tracker.observe(0.0, at(0.5, 0.5), true), None);
    assert_eq!(tracker.observe(30.0, at(0.505, 0.5), true), None);
    assert_eq!(tracker.observe(50.0, at(0.505, 0.5), true), None);
    assert_eq!(tracker.observe(60.0, at(0.7, 0.5), true), Some((0.0, 60.0)));
}

#[test]
fn idle_tracker_ignores_short_stretches_and_fights() {
    let mut tracker = IdleTracker::new(IDLE_RADIUS);
    tracker.observe(0.0, at(0.5, 0.5), true);
    assert_eq!(tracker.observe(30.0, at(0.5, 0.5), false), None);
    assert_eq!(tracker.observe(40.0, at(0.5, 0.5), true), None);
    assert_eq!(tracker.finish(60.0), None);
}

#[test]
fn idle_tracker_closes_the_open_stretch_at_the_end_of_the_match() {
    let mut tracker = IdleTracker::new(IDLE_RADIUS);
    tracker.observe(10.0, at(0.5, 0.5), true);
    assert_eq!(tracker.finish(100.0), Some((10.0, 100.0)));
}
