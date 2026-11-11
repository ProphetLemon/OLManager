//! Headless measurement of what enemy champions do inside a tower's range and
//! what the tower does to them.
//!
//! `measure_tower_pressure` plays seeded full matches one tick at a time and
//! prints: the stretches an enemy champion spends inside the attack range of a
//! living tower (all of them, the ones with no minion in that range, and the
//! ones shielded by minions), what the tower did tick by tick during them, the
//! shots a tower needs to kill a champion and the share of his health one shot
//! takes at minutes 5, 15, 25 and 35, where a champion's maximum health and
//! attack damage come from (base, levels, items), deaths to towers, and the
//! ten longest stretches. It only reads the state and the tower ledger.
//!
//! ```text
//! TOWER_HARNESS_N=100 TOWER_HARNESS_SEED=0 TOWER_HARNESS_PAIR=70,70 \
//!   cargo test --release -p olm_core --lib \
//!   sim_live::tower_harness_tests::measure_tower_pressure -- --ignored --nocapture
//! ```
//!
//! Environment: `TOWER_HARNESS_N` matches (default 100), `TOWER_HARNESS_SEED`
//! first seed (default 0), `TOWER_HARNESS_PAIR` visible stat of team A and B
//! (default `70,70`; with unequal stats A is blue in even seeds and red in odd
//! seeds), `TOWER_HARNESS_ROSTER` `plain` (default; no champion ids, so every
//! champion gets the default build of his role) or `tanks` (a tank top laner
//! and a tank jungler on both sides), `TOWER_HARNESS_MODE` `tick` (default;
//! macro decisions every tick, as a watched match) or `skip` (every third tick,
//! as `skip_to_end` and the strength tests), `TOWER_HARNESS_SPEED` simulated
//! seconds per tick divided by 0.05 (default 12, the speed the other tests
//! use), `TOWER_HARNESS_RAW` optional path for one CSV row per stretch.

use std::collections::HashMap;
use std::fmt::Write as _;
use std::io::Write as _;

use super::economy_tests::{snapshot_with, Side};
use super::test_helpers::{empty_neutral, test_champion, test_runtime, test_structure};
use super::*;

/// Match minutes at which every champion is snapshotted.
const SNAPSHOT_MINUTES: [u32; 4] = [5, 15, 25, 35];

/// Minutes of the shots-to-kill table.
const KILL_TABLE_MINUTES: [u32; 3] = [15, 25, 35];

/// Longest simulated match, in seconds.
const MAX_MATCH_SEC: f64 = 7200.0;

/// A bare stretch longer than this is a defect (target of the task).
const LONG_STRETCH_SEC: f64 = 20.0;

/// Longest silence between two shots at the same champion that still counts as
/// "the tower shoots him the whole time" (one cadence plus one coarse tick).
const CONTINUOUS_FIRE_GAP_SEC: f64 = 2.4;

/// Seconds into a stretch at which the defenders are described.
const DEFENDER_CAPTURE_SEC: f64 = 6.0;

/// Radius around the tower inside which a defender is listed.
const DEFENDER_LIST_RADIUS: f64 = 0.20;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Roster {
    Plain,
    Tanks,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Drive {
    /// `tick`: what the watched match does.
    Tick,
    /// `skip_to_end`: macro decisions every third tick.
    Skip,
}

#[derive(Clone, Copy)]
struct Config {
    roster: Roster,
    drive: Drive,
    /// Speed of the request; one tick lasts `0.05 * speed` simulated seconds.
    speed: f64,
}

impl Config {
    fn dt(self) -> f64 {
        0.05 * self.speed
    }
}

fn env_or<T: std::str::FromStr>(name: &str, default: T) -> T {
    std::env::var(name)
        .ok()
        .and_then(|raw| raw.trim().parse().ok())
        .unwrap_or(default)
}

fn config_from_env() -> Config {
    let roster = match std::env::var("TOWER_HARNESS_ROSTER").as_deref() {
        Ok("tanks") => Roster::Tanks,
        _ => Roster::Plain,
    };
    let drive = match std::env::var("TOWER_HARNESS_MODE").as_deref() {
        Ok("skip") => Drive::Skip,
        _ => Drive::Tick,
    };
    let speed: f64 = env_or("TOWER_HARNESS_SPEED", 12.0);
    Config {
        roster,
        drive,
        speed,
    }
}

// ------------------------------------------------------------------ driving

fn tank_roster() -> (
    HashMap<String, String>,
    HashMap<String, LolChampionCombatProfileInput>,
) {
    let mut champions = HashMap::new();
    for prefix in ["h", "a"] {
        champions.insert(format!("{prefix}-TOP"), "ornn".to_string());
        champions.insert(format!("{prefix}-JGL"), "sejuani".to_string());
    }
    let profile = |base_hp: f64| LolChampionCombatProfileInput {
        base_hp,
        attack_type: "melee".to_string(),
        attack_range: 0.049,
    };
    let profiles = HashMap::from([
        ("ornn".to_string(), profile(660.0)),
        ("sejuani".to_string(), profile(640.0)),
    ]);
    (champions, profiles)
}

fn new_session(seed: &str, blue: Side, red: Side, roster: Roster) -> SimLiveSession {
    let (champion_by_player_id, champion_profiles_by_id) = match roster {
        Roster::Plain => (HashMap::new(), HashMap::new()),
        Roster::Tanks => tank_roster(),
    };
    init_session_from_request(&SimLiveInitRequest {
        session_id: format!("tower-{seed}"),
        seed: seed.to_string(),
        snapshot: snapshot_with(blue, red),
        champion_by_player_id,
        champion_profiles_by_id,
        champion_ultimates_by_id: HashMap::new(),
        initial_state: None,
        ai_mode: SimulatorAiMode::default(),
        policy: SimulatorPolicyConfig::default(),
    })
    .expect("init")
}

/// One simulation step with the same call order as `tick` or `skip_to_end`.
fn step(
    runtime: &mut RuntimeState,
    session: &mut SimLiveSession,
    cfg: Config,
    tick_index: u64,
) {
    runtime.speed = cfg.speed;
    runtime.running = true;
    runtime.time_sec += cfg.dt();
    session.tick_index = session.tick_index.saturating_add(1);
    spawn_waves_if_due(runtime, session);
    move_champions(runtime, cfg.dt());
    match cfg.drive {
        Drive::Tick => {
            maybe_deploy_rift_herald_charge(runtime);
            place_wards(runtime);
            process_sweepers(runtime);
        }
        Drive::Skip => {
            if tick_index.is_multiple_of(3) {
                place_wards(runtime);
                process_sweepers(runtime);
            }
        }
    }
    move_minions(runtime, cfg.dt());
    resolve_minion_combat(runtime);
    resolve_champion_combat(runtime);
    resolve_structure_combat(runtime);
    tick_neutral_timers(runtime);
    cleanup_tick(runtime);
}

/// Plays one match, calling `observe` after every tick. Returns the final state.
fn drive_match(
    seed: &str,
    blue: Side,
    red: Side,
    cfg: Config,
    mut observe: impl FnMut(&RuntimeState),
) -> RuntimeState {
    let mut session = new_session(seed, blue, red, cfg.roster);
    let mut runtime = session.state.clone();
    runtime.lane_combat_state_by_champion = session.lane_combat_state_by_champion.clone();
    runtime.ai_mode = session.ai_mode;
    runtime.policy = session.policy.clone();
    if cfg.drive == Drive::Skip {
        runtime
            .extra
            .insert(SKIP_FAST_MODE_EXTRA_KEY.to_string(), Value::Bool(true));
    }
    observe(&runtime);
    let mut ticks = 0u64;
    while runtime.winner.is_none() && runtime.time_sec < MAX_MATCH_SEC {
        step(&mut runtime, &mut session, cfg, ticks);
        ticks += 1;
        observe(&runtime);
        // The driver of `skip_to_end` keeps the session's combat state between calls.
        session.lane_combat_state_by_champion = runtime.lane_combat_state_by_champion.clone();
    }
    runtime
}

// -------------------------------------------------------------- observation

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Exposure {
    /// In range of a living enemy tower that has a minion of the champion's team in range.
    Shielded,
    /// In range of a living enemy tower with no minion of the champion's team in range.
    Bare,
}

/// Why a champion in range was not shot on a tick.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Silence {
    ShotHim,
    ShotOtherChampion,
    ShotMinion,
    Cooldown,
    ReadyButIdle,
}

const SILENCE_LABELS: [&str; 5] = [
    "shot him",
    "shot another champion",
    "shot a minion",
    "cooldown",
    "ready but idle",
];

impl Silence {
    fn index(self) -> usize {
        self as usize
    }
}

#[derive(Clone, Copy, Debug)]
struct TickObs {
    t: f64,
    exposure: Exposure,
    silence: Silence,
    hp: f64,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum End {
    DiedToTower,
    DiedOther,
    Left,
    TowerFell,
    /// The match ended while he was in range.
    MatchEnd,
    /// A bare or shielded part that continued as the other kind.
    ChangedKind,
}

const END_LABELS: [&str; 6] = [
    "died to tower",
    "died other",
    "left",
    "tower fell",
    "match end",
    "changed kind",
];

impl End {
    fn index(self) -> usize {
        self as usize
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Kind {
    Any,
    Bare,
    Shielded,
}

/// One maximal run of ticks of one kind.
#[derive(Clone, Debug)]
struct Stretch {
    kind: Kind,
    start_t: f64,
    dur: f64,
    silence: [u32; 5],
    /// Longest silence between two shots at him inside the stretch, counting
    /// from the start of the stretch and to its end.
    max_gap: f64,
    end: End,
    hp_start: f64,
    hp_end: f64,
}

/// Facts kept about the stretches that may end up among the longest.
#[derive(Clone, Debug, Default)]
struct StretchDetail {
    who: String,
    items: String,
    state: String,
    /// The champion's macro state when the stretch began.
    start_state: String,
    /// Own champions within 0.15 of the tower, himself excluded, when the stretch began.
    allies_near: usize,
    /// Enemy champions of the tower within 0.15 of it, alive, when the stretch began.
    defenders_near: usize,
    hp_frac_start: f64,
    max_hp: f64,
    attack_damage: f64,
    defenders: String,
    minions_with_him: usize,
    tower_minions: usize,
}

#[derive(Clone, Debug)]
struct FinishedStretch {
    stretch: Stretch,
    /// Filled for `Kind::Any` stretches only.
    detail: Option<StretchDetail>,
    /// Bare and shielded parts of an `Any` stretch.
    parts: Vec<Stretch>,
}

struct OpenRun {
    ticks: Vec<TickObs>,
    towers: Vec<usize>,
    killed_by_tower: bool,
    detail: StretchDetail,
    captured: bool,
}

#[derive(Clone, Debug)]
struct ChampionRow {
    role: String,
    tank: bool,
    base_hp: f64,
    base_ad: f64,
    max_hp: f64,
    attack_damage: f64,
    level: i64,
    items: usize,
    first_shot_share: f64,
    shots_to_kill: u32,
}

struct Tracker {
    open: Vec<Option<OpenRun>>,
    stretches: Vec<FinishedStretch>,
    base_hp: Vec<f64>,
    base_ad: Vec<f64>,
    snapshots: Vec<Vec<ChampionRow>>,
    next_snapshot: usize,
    shots_at_champions: u32,
    shots_at_minions: u32,
    tower_kills: u32,
    first_tower_sec: Option<f64>,
    /// Damage of every tower shot at a champion by phase: shots, sum, max.
    champion_shot_damage: [(u32, f64, f64); 3],
    cfg: Config,
}

impl Tracker {
    fn new(cfg: Config) -> Tracker {
        Tracker {
            open: Vec::new(),
            stretches: Vec::new(),
            base_hp: Vec::new(),
            base_ad: Vec::new(),
            snapshots: vec![Vec::new(); SNAPSHOT_MINUTES.len()],
            next_snapshot: 0,
            shots_at_champions: 0,
            shots_at_minions: 0,
            tower_kills: 0,
            first_tower_sec: None,
            champion_shot_damage: [(0, 0.0, 0.0); 3],
            cfg,
        }
    }
}

fn is_tank(champion: &ChampionRuntime) -> bool {
    matches!(
        classify_item_build(&champion.role, &champion.champion_id),
        ItemBuildCategory::Tank
    )
}

/// Shots a lone tower needs to kill a fresh champion of `max_hp` at `time_sec`,
/// shooting once per cadence with nothing else in range, and the share of his
/// health the first shot takes.
fn probe_shots_to_kill(max_hp: f64, time_sec: f64) -> (u32, f64) {
    let pos = Vec2 { x: 0.5, y: 0.5 };
    let mut champion = test_champion("probe", "blue", "MID", "mid", pos);
    champion.max_hp = max_hp;
    champion.hp = max_hp;
    let tower = test_structure("red-probe", "red", "mid", pos);
    let mut runtime = test_runtime(vec![champion], vec![], vec![tower], empty_neutral());
    runtime.time_sec = time_sec;
    let mut shots = 0u32;
    let mut first_share = 0.0;
    while runtime.champions[0].alive && shots < 500 {
        resolve_structure_combat(&mut runtime);
        shots += 1;
        if shots == 1 {
            first_share = (max_hp - runtime.champions[0].hp) / max_hp;
        }
        runtime.time_sec += TOWER_ATTACK_CADENCE_SEC;
    }
    (shots, first_share)
}

fn champion_row(tracker: &Tracker, idx: usize, champion: &ChampionRuntime, time_sec: f64) -> ChampionRow {
    let (shots_to_kill, first_shot_share) = probe_shots_to_kill(champion.max_hp, time_sec);
    ChampionRow {
        role: champion.role.clone(),
        tank: is_tank(champion),
        base_hp: tracker.base_hp[idx],
        base_ad: tracker.base_ad[idx],
        max_hp: champion.max_hp,
        attack_damage: champion.attack_damage,
        level: champion.level,
        items: champion.items.len(),
        first_shot_share,
        shots_to_kill,
    }
}

fn dist_to(a: Vec2, b: Vec2) -> f64 {
    dist(a, b)
}

/// Living towers of the other team whose range holds `pos`.
fn towers_in_range(runtime: &RuntimeState, team: &str, pos: Vec2) -> Vec<usize> {
    runtime
        .structures
        .iter()
        .enumerate()
        .filter(|(_, s)| {
            s.alive
                && s.kind == "tower"
                && normalized_team(&s.team) != normalized_team(team)
                && dist_to(s.pos, pos) <= TOWER_ATTACK_RANGE
        })
        .map(|(i, _)| i)
        .collect()
}

fn minions_of_team_in_range(runtime: &RuntimeState, team: &str, tower: &StructureRuntime) -> usize {
    runtime
        .minions
        .iter()
        .filter(|m| {
            m.alive
                && normalized_team(&m.team) == normalized_team(team)
                && dist_to(m.pos, tower.pos) <= TOWER_ATTACK_RANGE
        })
        .count()
}

fn describe_defenders(runtime: &RuntimeState, champion: &ChampionRuntime, tower: &StructureRuntime) -> String {
    let mut parts = Vec::new();
    for other in &runtime.champions {
        if normalized_team(&other.team) == normalized_team(&champion.team) {
            continue;
        }
        let d = dist_to(other.pos, tower.pos);
        if !other.alive {
            parts.push(format!("{} dead", other.role));
        } else if d <= DEFENDER_LIST_RADIUS {
            parts.push(format!(
                "{} {} d{:.2} hp{:.0}%",
                other.role,
                other.state,
                d,
                100.0 * other.hp / other.max_hp.max(1.0)
            ));
        }
    }
    parts.join("; ")
}

fn summarise(ticks: &[TickObs], kind: Kind, end: End, dt: f64) -> Stretch {
    let mut silence = [0u32; 5];
    let mut max_gap = 0.0f64;
    let mut last_shot_t = ticks[0].t - dt;
    for tick in ticks {
        silence[tick.silence.index()] += 1;
        if tick.silence == Silence::ShotHim {
            max_gap = max_gap.max(tick.t - last_shot_t);
            last_shot_t = tick.t;
        }
    }
    let last = ticks[ticks.len() - 1];
    max_gap = max_gap.max(last.t - last_shot_t);
    Stretch {
        kind,
        start_t: ticks[0].t - dt,
        dur: ticks.len() as f64 * dt,
        silence,
        max_gap,
        end,
        hp_start: ticks[0].hp,
        hp_end: last.hp,
    }
}

fn finish_run(run: OpenRun, end: End, dt: f64) -> FinishedStretch {
    let mut parts = Vec::new();
    let mut from = 0;
    while from < run.ticks.len() {
        let exposure = run.ticks[from].exposure;
        let mut to = from;
        while to + 1 < run.ticks.len() && run.ticks[to + 1].exposure == exposure {
            to += 1;
        }
        let kind = if exposure == Exposure::Bare {
            Kind::Bare
        } else {
            Kind::Shielded
        };
        let part_end = if to + 1 == run.ticks.len() {
            end
        } else {
            End::ChangedKind
        };
        parts.push(summarise(&run.ticks[from..=to], kind, part_end, dt));
        from = to + 1;
    }
    FinishedStretch {
        stretch: summarise(&run.ticks, Kind::Any, end, dt),
        detail: Some(run.detail),
        parts,
    }
}

fn observe(runtime: &RuntimeState, tracker: &mut Tracker) {
    let dt = tracker.cfg.dt();
    if tracker.open.is_empty() {
        tracker.open = (0..runtime.champions.len()).map(|_| None).collect();
        tracker.base_hp = runtime.champions.iter().map(|c| c.max_hp).collect();
        tracker.base_ad = runtime.champions.iter().map(|c| c.attack_damage).collect();
        return;
    }
    if tracker.first_tower_sec.is_none() && runtime.stats.blue.towers + runtime.stats.red.towers > 0 {
        tracker.first_tower_sec = Some(runtime.time_sec);
    }
    let shots = runtime.tower_ledger.shots();
    for shot in shots {
        match shot.victim {
            TowerVictim::Champion(_) => {
                tracker.shots_at_champions += 1;
                let phase = &mut tracker.champion_shot_damage[phase_of(runtime.time_sec)];
                phase.0 += 1;
                phase.1 += shot.damage;
                phase.2 = phase.2.max(shot.damage);
                if shot.killed {
                    tracker.tower_kills += 1;
                }
            }
            TowerVictim::Minion => tracker.shots_at_minions += 1,
        }
    }

    for (ci, champion) in runtime.champions.iter().enumerate() {
        let killed_now = shots
            .iter()
            .any(|s| s.killed && s.victim == TowerVictim::Champion(ci));
        let eligible = (champion.alive || killed_now) && !champion_is_banished(champion);
        let towers = if eligible {
            towers_in_range(runtime, &champion.team, champion.pos)
        } else {
            Vec::new()
        };
        if towers.is_empty() {
            if let Some(run) = tracker.open[ci].take() {
                let end = if !champion.alive {
                    if run.killed_by_tower {
                        End::DiedToTower
                    } else {
                        End::DiedOther
                    }
                } else if run.towers.iter().all(|&t| !runtime.structures[t].alive) {
                    End::TowerFell
                } else {
                    End::Left
                };
                tracker.stretches.push(finish_run(run, end, dt));
            }
            continue;
        }

        let bare = towers
            .iter()
            .any(|&t| minions_of_team_in_range(runtime, &champion.team, &runtime.structures[t]) == 0);
        let exposure = if bare { Exposure::Bare } else { Exposure::Shielded };
        let tower_shots: Vec<&TowerShot> = shots
            .iter()
            .filter(|s| towers.contains(&s.structure_idx))
            .collect();
        let silence = if tower_shots
            .iter()
            .any(|s| s.victim == TowerVictim::Champion(ci))
        {
            Silence::ShotHim
        } else if tower_shots
            .iter()
            .any(|s| matches!(s.victim, TowerVictim::Champion(_)))
        {
            Silence::ShotOtherChampion
        } else if !tower_shots.is_empty() {
            Silence::ShotMinion
        } else if towers
            .iter()
            .all(|&t| runtime.structures[t].attack_cd_until > runtime.time_sec)
        {
            Silence::Cooldown
        } else {
            Silence::ReadyButIdle
        };
        let obs = TickObs {
            t: runtime.time_sec,
            exposure,
            silence,
            hp: champion.hp.max(0.0),
        };
        let run = tracker.open[ci].get_or_insert_with(|| OpenRun {
            ticks: Vec::new(),
            towers: Vec::new(),
            killed_by_tower: false,
            detail: StretchDetail::default(),
            captured: false,
        });
        run.ticks.push(obs);
        run.towers = towers.clone();
        run.killed_by_tower |= killed_now;
        let tower = &runtime.structures[towers[0]];
        let captured_due = !run.captured && run.ticks.len() as f64 * dt >= DEFENDER_CAPTURE_SEC;
        if run.ticks.len() == 1 {
            run.detail.start_state = champion.state.split("->").next().unwrap_or("").to_string();
            run.detail.hp_frac_start = champion.hp / champion.max_hp.max(1.0);
            run.detail.allies_near = runtime
                .champions
                .iter()
                .filter(|o| {
                    o.id != champion.id
                        && o.alive
                        && normalized_team(&o.team) == normalized_team(&champion.team)
                        && dist_to(o.pos, tower.pos) <= 0.15
                })
                .count();
            run.detail.defenders_near = runtime
                .champions
                .iter()
                .filter(|o| {
                    o.alive
                        && normalized_team(&o.team) != normalized_team(&champion.team)
                        && dist_to(o.pos, tower.pos) <= 0.15
                })
                .count();
        }
        if run.ticks.len() == 1 || captured_due {
            let (start_state, allies_near, defenders_near, hp_frac_start) = (
                std::mem::take(&mut run.detail.start_state),
                run.detail.allies_near,
                run.detail.defenders_near,
                run.detail.hp_frac_start,
            );
            run.detail = StretchDetail {
                start_state,
                allies_near,
                defenders_near,
                hp_frac_start,
                who: format!(
                    "{} {} lvl{}",
                    if champion.team == "blue" { "blue" } else { "red" },
                    champion.role,
                    champion.level
                ),
                items: champion.items.join(","),
                state: format!("{} / {}", champion.state, champion.debug_ai_decision),
                max_hp: champion.max_hp,
                attack_damage: champion.attack_damage,
                defenders: describe_defenders(runtime, champion, tower),
                minions_with_him: runtime
                    .minions
                    .iter()
                    .filter(|m| {
                        m.alive
                            && normalized_team(&m.team) == normalized_team(&champion.team)
                            && dist_to(m.pos, tower.pos) <= TOWER_ATTACK_RANGE
                    })
                    .count(),
                tower_minions: runtime
                    .minions
                    .iter()
                    .filter(|m| {
                        m.alive
                            && normalized_team(&m.team) != normalized_team(&champion.team)
                            && dist_to(m.pos, tower.pos) <= TOWER_ATTACK_RANGE
                    })
                    .count(),
            };
            run.captured |= captured_due;
        }
    }

    if tracker.next_snapshot < SNAPSHOT_MINUTES.len()
        && runtime.time_sec >= f64::from(SNAPSHOT_MINUTES[tracker.next_snapshot]) * 60.0
    {
        let rows: Vec<ChampionRow> = runtime
            .champions
            .iter()
            .enumerate()
            .map(|(i, c)| champion_row(tracker, i, c, runtime.time_sec))
            .collect();
        tracker.snapshots[tracker.next_snapshot] = rows;
        tracker.next_snapshot += 1;
    }
}

// ------------------------------------------------------------------- traces

struct MatchTrace {
    seed: usize,
    minutes: f64,
    kills: i64,
    towers_destroyed: i64,
    first_tower_min: Option<f64>,
    deaths: i64,
    tower_kills: u32,
    shots_at_champions: u32,
    shots_at_minions: u32,
    locks: (u32, u32),
    champion_shot_damage: [(u32, f64, f64); 3],
    winner_is_a: Option<bool>,
    stretches: Vec<FinishedStretch>,
    snapshots: Vec<Vec<ChampionRow>>,
}

fn run_trace(seed: usize, team_a: Side, team_b: Side, cfg: Config) -> MatchTrace {
    let a_is_blue = seed.is_multiple_of(2);
    let (blue, red) = if a_is_blue {
        (team_a, team_b)
    } else {
        (team_b, team_a)
    };
    let mut tracker = Tracker::new(cfg);
    let final_state = drive_match(&format!("tower-seed-{seed}"), blue, red, cfg, |rt| {
        observe(rt, &mut tracker)
    });
    // Close the stretches still open when the match ended.
    let dt = cfg.dt();
    let open = std::mem::take(&mut tracker.open);
    for run in open.into_iter().flatten() {
        tracker.stretches.push(finish_run(run, End::MatchEnd, dt));
    }
    let blue_won = final_state.winner.as_deref().map(|w| w == "blue");
    MatchTrace {
        seed,
        minutes: final_state.time_sec / 60.0,
        kills: final_state.stats.blue.kills + final_state.stats.red.kills,
        towers_destroyed: final_state.stats.blue.towers + final_state.stats.red.towers,
        first_tower_min: tracker.first_tower_sec.map(|s| s / 60.0),
        deaths: final_state.champions.iter().map(|c| c.deaths).sum(),
        tower_kills: tracker.tower_kills,
        shots_at_champions: tracker.shots_at_champions,
        shots_at_minions: tracker.shots_at_minions,
        locks: final_state.tower_ledger.lock_counts(),
        champion_shot_damage: tracker.champion_shot_damage,
        winner_is_a: blue_won.map(|b| b == a_is_blue),
        stretches: tracker.stretches,
        snapshots: tracker.snapshots,
    }
}

fn run_traces(first_seed: usize, count: usize, team_a: Side, team_b: Side, cfg: Config) -> Vec<MatchTrace> {
    let workers = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .min(count.max(1));
    let mut traces: Vec<MatchTrace> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..workers)
            .map(|worker| {
                scope.spawn(move || {
                    (worker..count)
                        .step_by(workers)
                        .map(|i| run_trace(first_seed + i, team_a, team_b, cfg))
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

// --------------------------------------------------------------- statistics

fn percentile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return f64::NAN;
    }
    let rank = ((p * sorted.len() as f64).ceil() as usize).clamp(1, sorted.len());
    sorted[rank - 1]
}

fn sorted(values: impl Iterator<Item = f64>) -> Vec<f64> {
    let mut v: Vec<f64> = values.collect();
    v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    v
}

fn mean(values: &[f64]) -> f64 {
    if values.is_empty() {
        f64::NAN
    } else {
        values.iter().sum::<f64>() / values.len() as f64
    }
}

fn phase_of(start_t: f64) -> usize {
    match start_t / 60.0 {
        m if m < 15.0 => 0,
        m if m < 25.0 => 1,
        _ => 2,
    }
}

const PHASE_LABELS: [&str; 3] = ["0-15", "15-25", "25-end"];

// ------------------------------------------------------------------- tables

fn stretches_of<'a>(traces: &'a [MatchTrace], kind: Kind) -> Vec<&'a Stretch> {
    let mut out = Vec::new();
    for trace in traces {
        for finished in &trace.stretches {
            if kind == Kind::Any {
                out.push(&finished.stretch);
            } else {
                out.extend(finished.parts.iter().filter(|p| p.kind == kind));
            }
        }
    }
    out
}

fn table_stretch_lengths(traces: &[MatchTrace]) {
    println!("\n== Stretch lengths in seconds (maximal runs of ticks inside a living enemy tower's range) ==");
    println!("kind      phase    count  per-match  median     p90     p99     max");
    for (label, kind) in [
        ("any", Kind::Any),
        ("bare", Kind::Bare),
        ("shielded", Kind::Shielded),
    ] {
        let all = stretches_of(traces, kind);
        for phase in 0..4 {
            let durs = sorted(
                all.iter()
                    .filter(|s| phase == 3 || phase_of(s.start_t) == phase)
                    .map(|s| s.dur),
            );
            let name = if phase == 3 { "all" } else { PHASE_LABELS[phase] };
            println!(
                "{label:<9} {name:<7} {:>6} {:>10.2} {:>7.1} {:>7.1} {:>7.1} {:>7.1}",
                durs.len(),
                durs.len() as f64 / traces.len() as f64,
                percentile(&durs, 0.5),
                percentile(&durs, 0.9),
                percentile(&durs, 0.99),
                percentile(&durs, 1.0),
            );
        }
    }
}

fn table_tower_behaviour(traces: &[MatchTrace]) {
    println!("\n== What the towers did on every tick a champion was in range (share of ticks) ==");
    println!("kind      phase    ticks   {}", SILENCE_LABELS.join(" | "));
    for (label, kind) in [("bare", Kind::Bare), ("shielded", Kind::Shielded)] {
        let all = stretches_of(traces, kind);
        for phase in 0..4 {
            let mut counts = [0u64; 5];
            for s in all.iter().filter(|s| phase == 3 || phase_of(s.start_t) == phase) {
                for (i, c) in s.silence.iter().enumerate() {
                    counts[i] += u64::from(*c);
                }
            }
            let total: u64 = counts.iter().sum();
            let name = if phase == 3 { "all" } else { PHASE_LABELS[phase] };
            let shares: Vec<String> = counts
                .iter()
                .map(|&c| format!("{:5.1}%", 100.0 * c as f64 / total.max(1) as f64))
                .collect();
            println!("{label:<9} {name:<7} {total:>6}   {}", shares.join("  | "));
        }
    }
}

fn table_bare_outcomes(traces: &[MatchTrace]) {
    println!("\n== Bare stretches: how they ended, shots at him, and the long ones (> {LONG_STRETCH_SEC} s) ==");
    let bare = stretches_of(traces, Kind::Bare);
    let n = bare.len().max(1) as f64;
    for (i, label) in END_LABELS.iter().enumerate() {
        let count = bare.iter().filter(|s| s.end.index() == i).count();
        println!("ended {label:<14} {count:>6} ({:.1}%)", 100.0 * count as f64 / n);
    }
    let shots = sorted(bare.iter().map(|s| f64::from(s.silence[Silence::ShotHim.index()])));
    println!(
        "shots at him per bare stretch: mean {:.2} median {:.0} p90 {:.0} max {:.0}",
        mean(&shots),
        percentile(&shots, 0.5),
        percentile(&shots, 0.9),
        percentile(&shots, 1.0)
    );
    let long: Vec<&&Stretch> = bare.iter().filter(|s| s.dur > LONG_STRETCH_SEC).collect();
    let exempt = long
        .iter()
        .filter(|s| {
            s.max_gap <= CONTINUOUS_FIRE_GAP_SEC
                && matches!(s.end, End::DiedToTower | End::Left | End::DiedOther)
        })
        .count();
    println!(
        "long bare stretches: {} in {} matches ({} exempt: shot the whole time and he died or left); violations: {}",
        long.len(),
        traces.len(),
        exempt,
        long.len() - exempt
    );
    let mut by_end = [0usize; 6];
    for s in &long {
        by_end[s.end.index()] += 1;
    }
    let ends: Vec<String> = END_LABELS
        .iter()
        .zip(by_end)
        .filter(|(_, c)| *c > 0)
        .map(|(l, c)| format!("{l} {c}"))
        .collect();
    println!("long bare stretches ended: {}", ends.join(", "));
}

fn table_tower_deaths(traces: &[MatchTrace]) {
    println!("\n== Champions killed by a tower: what they were doing when the stretch began ==");
    let deaths: Vec<&FinishedStretch> = traces
        .iter()
        .flat_map(|t| t.stretches.iter())
        .filter(|f| f.stretch.end == End::DiedToTower)
        .collect();
    if deaths.is_empty() {
        println!("none");
        return;
    }
    let mut states: HashMap<String, usize> = HashMap::new();
    for f in &deaths {
        let state = f.detail.as_ref().map(|d| d.start_state.clone()).unwrap_or_default();
        *states.entry(state).or_default() += 1;
    }
    let mut states: Vec<(String, usize)> = states.into_iter().collect();
    states.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    let listed: Vec<String> = states
        .iter()
        .map(|(s, c)| format!("{s} {c} ({:.0}%)", 100.0 * *c as f64 / deaths.len() as f64))
        .collect();
    println!("{} deaths; state at the start: {}", deaths.len(), listed.join(", "));
    let durs = sorted(deaths.iter().map(|f| f.stretch.dur));
    println!(
        "stretch length at death: median {:.1} s, p90 {:.1} s, max {:.1} s",
        percentile(&durs, 0.5),
        percentile(&durs, 0.9),
        percentile(&durs, 1.0)
    );
    let allies = sorted(deaths.iter().map(|f| f.detail.as_ref().map_or(0, |d| d.allies_near) as f64));
    let defenders = sorted(deaths.iter().map(|f| f.detail.as_ref().map_or(0, |d| d.defenders_near) as f64));
    let hp = sorted(deaths.iter().map(|f| f.detail.as_ref().map_or(0.0, |d| d.hp_frac_start)));
    println!(
        "own champions near at the start: median {:.0} (mean {:.1}); defenders near: median {:.0} (mean {:.1}); health at the start: median {:.0}%",
        percentile(&allies, 0.5),
        mean(&allies),
        percentile(&defenders, 0.5),
        mean(&defenders),
        100.0 * percentile(&hp, 0.5)
    );
    let shielded: usize = deaths
        .iter()
        .filter(|f| f.parts.iter().any(|p| p.kind == Kind::Shielded))
        .count();
    println!(
        "{shielded} of them also spent time shielded by minions inside the same stretch"
    );
}

fn rows_at<'a>(traces: &'a [MatchTrace], snapshot: usize) -> Vec<&'a ChampionRow> {
    traces
        .iter()
        .flat_map(|t| t.snapshots[snapshot].iter())
        .collect()
}

fn class_label(row: &ChampionRow) -> String {
    if row.tank {
        format!("{}*", row.role)
    } else {
        row.role.clone()
    }
}

fn table_health_and_damage(traces: &[MatchTrace]) {
    println!("\n== Maximum health and attack damage by role: base + levels + items (means) ==");
    println!("a star after the role is a tank build. levels = (level-1) x {CHAMPION_LEVEL_UP_HP_GAIN} hp and x {CHAMPION_LEVEL_UP_AD_GAIN} ad");
    println!("minute class   n   level items |  max hp = base + levels + items | attack damage = base + levels + items | items hp / levels hp");
    for (si, minute) in SNAPSHOT_MINUTES.iter().enumerate() {
        let rows = rows_at(traces, si);
        let mut labels: Vec<String> = rows.iter().map(|r| class_label(r)).collect();
        labels.sort();
        labels.dedup();
        for label in labels {
            let group: Vec<&&ChampionRow> = rows.iter().filter(|r| class_label(r) == label).collect();
            let f = |g: &dyn Fn(&ChampionRow) -> f64| mean(&group.iter().map(|r| g(r)).collect::<Vec<_>>());
            let level = f(&|r| r.level as f64);
            let items = f(&|r| r.items as f64);
            let max_hp = f(&|r| r.max_hp);
            let base_hp = f(&|r| r.base_hp);
            let levels_hp = f(&|r| (r.level - 1) as f64 * CHAMPION_LEVEL_UP_HP_GAIN);
            let items_hp = max_hp - base_hp - levels_hp;
            let ad = f(&|r| r.attack_damage);
            let base_ad = f(&|r| r.base_ad);
            let levels_ad = f(&|r| (r.level - 1) as f64 * CHAMPION_LEVEL_UP_AD_GAIN);
            let items_ad = ad - base_ad - levels_ad;
            println!(
                "{minute:>6} {label:<6} {:>3} {level:>6.1} {items:>5.1} | {max_hp:>7.0} = {base_hp:>4.0} + {levels_hp:>5.0} + {items_hp:>5.0} | {ad:>6.0} = {base_ad:>4.1} + {levels_ad:>4.0} + {items_ad:>4.0} | {:.2}",
                group.len(),
                items_hp / levels_hp.max(1.0)
            );
        }
    }
}

fn table_shots_to_kill(traces: &[MatchTrace]) {
    println!("\n== Shots a lone tower needs to kill a champion of the snapshot's maximum health ==");
    println!("a star after the role is a tank build. first shot = share of maximum health taken by the first shot");
    println!("minute class    n  shots mean  p90  max | first shot share mean");
    for (si, minute) in SNAPSHOT_MINUTES.iter().enumerate() {
        let rows = rows_at(traces, si);
        let mut labels: Vec<String> = rows.iter().map(|r| class_label(r)).collect();
        labels.sort();
        labels.dedup();
        for label in labels {
            let group: Vec<&&ChampionRow> = rows.iter().filter(|r| class_label(r) == label).collect();
            let shots = sorted(group.iter().map(|r| f64::from(r.shots_to_kill)));
            let share = mean(&group.iter().map(|r| r.first_shot_share).collect::<Vec<_>>());
            let marker = if KILL_TABLE_MINUTES.contains(minute) { "" } else { " (not in the target)" };
            println!(
                "{minute:>6} {label:<6} {:>4} {:>10.1} {:>4.0} {:>4.0} | {:>6.1}%{marker}",
                group.len(),
                mean(&shots),
                percentile(&shots, 0.9),
                percentile(&shots, 1.0),
                100.0 * share
            );
        }
        // The target is stated for non-tank and tank champions as classes.
        for (name, tank) in [("non-tank", false), ("tank", true)] {
            let group: Vec<&&ChampionRow> = rows.iter().filter(|r| r.tank == tank).collect();
            if group.is_empty() {
                continue;
            }
            let shots = sorted(group.iter().map(|r| f64::from(r.shots_to_kill)));
            println!(
                "{minute:>6} {name:<8}{:>4} {:>9.1} {:>4.0} {:>4.0}   (class summary)",
                group.len(),
                mean(&shots),
                percentile(&shots, 0.9),
                percentile(&shots, 1.0),
            );
        }
    }
}

fn table_match_level(traces: &[MatchTrace]) {
    println!("\n== Per match ==");
    let n = traces.len() as f64;
    let col = |f: &dyn Fn(&MatchTrace) -> f64| mean(&traces.iter().map(f).collect::<Vec<_>>());
    let minutes = sorted(traces.iter().map(|t| t.minutes));
    println!(
        "matches {} | minutes mean {:.1} median {:.1} min {:.1} max {:.1}",
        traces.len(),
        col(&|t| t.minutes),
        percentile(&minutes, 0.5),
        percentile(&minutes, 0.0),
        percentile(&minutes, 1.0)
    );
    println!(
        "kills {:.1} | towers destroyed {:.1} | first tower minute {:.1} (in {} matches)",
        col(&|t| t.kills as f64),
        col(&|t| t.towers_destroyed as f64),
        mean(&traces.iter().filter_map(|t| t.first_tower_min).collect::<Vec<_>>()),
        traces.iter().filter(|t| t.first_tower_min.is_some()).count()
    );
    let deaths: f64 = traces.iter().map(|t| t.deaths as f64).sum();
    let tower_kills: f64 = traces.iter().map(|t| f64::from(t.tower_kills)).sum();
    println!(
        "deaths {:.1} per match | deaths to towers {:.2} per match = {:.1}% of all deaths",
        deaths / n,
        tower_kills / n,
        100.0 * tower_kills / deaths.max(1.0)
    );
    println!(
        "tower shots per match: at champions {:.0}, at minions {:.0}",
        col(&|t| f64::from(t.shots_at_champions)),
        col(&|t| f64::from(t.shots_at_minions))
    );
    let locks: f64 = traces.iter().map(|t| f64::from(t.locks.0)).sum();
    let unusable: f64 = traces.iter().map(|t| f64::from(t.locks.1)).sum();
    println!(
        "aggro locks per match {:.1}, of which the attacker stood outside the tower's range {:.1} ({:.0}%)",
        locks / n,
        unusable / n,
        100.0 * unusable / locks.max(1.0)
    );
    for (phase, label) in PHASE_LABELS.iter().enumerate() {
        let shots: u32 = traces.iter().map(|t| t.champion_shot_damage[phase].0).sum();
        let sum: f64 = traces.iter().map(|t| t.champion_shot_damage[phase].1).sum();
        let max = traces
            .iter()
            .map(|t| t.champion_shot_damage[phase].2)
            .fold(0.0, f64::max);
        println!(
            "tower shots at champions, minutes {label}: {shots} shots, mean damage {:.1}, max {:.1}",
            sum / f64::from(shots.max(1)),
            max
        );
    }
    let a_wins = traces.iter().filter(|t| t.winner_is_a == Some(true)).count();
    let decided = traces.iter().filter(|t| t.winner_is_a.is_some()).count();
    println!("team A won {a_wins} of {decided} decided matches");
}

fn table_longest(traces: &[MatchTrace], top: usize) {
    println!("\n== The {top} longest stretches ==");
    let mut all: Vec<(&MatchTrace, &FinishedStretch)> = traces
        .iter()
        .flat_map(|t| t.stretches.iter().map(move |s| (t, s)))
        .collect();
    all.sort_by(|a, b| {
        b.1.stretch
            .dur
            .partial_cmp(&a.1.stretch.dur)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    for (trace, finished) in all.into_iter().take(top) {
        let s = &finished.stretch;
        let d = finished.detail.clone().unwrap_or_default();
        let bare: f64 = finished
            .parts
            .iter()
            .filter(|p| p.kind == Kind::Bare)
            .map(|p| p.dur)
            .sum();
        let mut shots = String::new();
        for (i, label) in SILENCE_LABELS.iter().enumerate() {
            let _ = write!(shots, "{label} {} | ", s.silence[i]);
        }
        println!(
            "seed {} minute {:.1} {} for {:.1} s ({:.1} s bare), ended: {}; hp {:.0} -> {:.0} of {:.0}, ad {:.0}, items [{}]; ticks: {}\n    he was: {}; allied minions near the tower {}, tower's minions {}\n    defenders: {}",
            trace.seed,
            s.start_t / 60.0,
            d.who,
            s.dur,
            bare,
            END_LABELS[s.end.index()],
            s.hp_start,
            s.hp_end,
            d.max_hp,
            d.attack_damage,
            d.items,
            shots,
            d.state,
            d.minions_with_him,
            d.tower_minions,
            d.defenders
        );
    }
}

fn write_raw(path: &str, traces: &[MatchTrace]) {
    let mut file = std::fs::File::create(path).expect("raw csv");
    writeln!(file, "seed,kind,start_min,dur_sec,end,max_gap_sec,shots_at_him,hp_start,hp_end").expect("write");
    for trace in traces {
        for finished in &trace.stretches {
            for s in std::iter::once(&finished.stretch).chain(finished.parts.iter()) {
                writeln!(
                    file,
                    "{},{:?},{:.2},{:.1},{},{:.1},{},{:.0},{:.0}",
                    trace.seed,
                    s.kind,
                    s.start_t / 60.0,
                    s.dur,
                    END_LABELS[s.end.index()],
                    s.max_gap,
                    s.silence[Silence::ShotHim.index()],
                    s.hp_start,
                    s.hp_end
                )
                .expect("write");
            }
        }
    }
}

fn parse_pair(raw: &str) -> (Side, Side) {
    let mut parts = raw.split(',').filter_map(|p| p.trim().parse::<f64>().ok());
    let a = parts.next().unwrap_or(70.0);
    let b = parts.next().unwrap_or(a);
    (Side::stat(a), Side::stat(b))
}

#[test]
#[ignore = "measurement: plays full seeded matches tick by tick; see the module docs for the environment"]
fn measure_tower_pressure() {
    let cfg = config_from_env();
    let n: usize = env_or("TOWER_HARNESS_N", 100);
    let first_seed: usize = env_or("TOWER_HARNESS_SEED", 0);
    let pair = std::env::var("TOWER_HARNESS_PAIR").unwrap_or_else(|_| "70,70".to_string());
    let (team_a, team_b) = parse_pair(&pair);
    println!(
        "tower harness: {n} matches from seed {first_seed}, pair {pair}, roster {:?}, drive {:?}, dt {:.2} s",
        cfg.roster, cfg.drive, cfg.dt()
    );
    let traces = run_traces(first_seed, n, team_a, team_b, cfg);
    table_match_level(&traces);
    table_stretch_lengths(&traces);
    table_tower_behaviour(&traces);
    table_bare_outcomes(&traces);
    table_tower_deaths(&traces);
    table_health_and_damage(&traces);
    table_shots_to_kill(&traces);
    table_longest(&traces, 10);
    if let Ok(path) = std::env::var("TOWER_HARNESS_RAW") {
        write_raw(&path, &traces);
    }
}

// ------------------------------------------------------------ default tests

/// The harness driver must play exactly the match `tick` plays.
#[test]
fn driver_in_tick_mode_matches_the_tick_function() {
    let cfg = Config {
        roster: Roster::Plain,
        drive: Drive::Tick,
        speed: 12.0,
    };
    let driven = drive_match("tower-driver-check", Side::EVEN, Side::EVEN, cfg, |_| {});
    let store = SimLiveStoreState::default();
    init(
        &store,
        SimLiveInitRequest {
            session_id: "check".to_string(),
            seed: "tower-driver-check".to_string(),
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
    let ticks = (driven.time_sec / cfg.dt()).round() as u64;
    for _ in 0..ticks {
        tick(
            &store,
            SimLiveTickRequest {
                session_id: "check".to_string(),
                dt_sec: 0.2,
                running: true,
                speed: 12.0,
            },
        )
        .expect("tick");
    }
    let sessions = store.sessions.lock().expect("lock");
    let played = &sessions["check"].state;
    assert_eq!(played.winner, driven.winner);
    assert!((played.time_sec - driven.time_sec).abs() < 1e-6);
    assert_eq!(
        (played.stats.blue.kills, played.stats.red.kills),
        (driven.stats.blue.kills, driven.stats.red.kills)
    );
}

/// The skip driver must play exactly the match `skip_to_end` plays.
#[test]
fn driver_in_skip_mode_matches_skip_to_end() {
    let cfg = Config {
        roster: Roster::Plain,
        drive: Drive::Skip,
        speed: 12.0,
    };
    let driven = drive_match("tower-driver-check", Side::EVEN, Side::EVEN, cfg, |_| {});
    let store = SimLiveStoreState::default();
    init(
        &store,
        SimLiveInitRequest {
            session_id: "check".to_string(),
            seed: "tower-driver-check".to_string(),
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
            session_id: "check".to_string(),
            dt_sec: 0.2,
            speed: 12.0,
            max_ticks: 6000,
        },
    )
    .expect("skip");
    let sessions = store.sessions.lock().expect("lock");
    let played = &sessions["check"].state;
    assert_eq!(played.winner, driven.winner);
    assert!((played.time_sec - driven.time_sec).abs() < 1e-6);
    assert_eq!(
        (played.stats.blue.kills, played.stats.red.kills),
        (driven.stats.blue.kills, driven.stats.red.kills)
    );
}

#[test]
fn ledger_counts_every_tower_shot_at_a_champion() {
    let pos = Vec2 { x: 0.5, y: 0.5 };
    let champion = test_champion("c", "blue", "MID", "mid", pos);
    let tower = test_structure("red-t", "red", "mid", pos);
    let mut runtime = test_runtime(vec![champion], vec![], vec![tower], empty_neutral());
    resolve_structure_combat(&mut runtime);
    let shots = runtime.tower_ledger.shots();
    assert_eq!(shots.len(), 1);
    assert_eq!(shots[0].victim, TowerVictim::Champion(0));
    assert!((shots[0].hp_before - DEFAULT_TEST_HP_FOR_LEDGER).abs() < 1e-9);
}

/// The probe reports a number of shots that matches the ledger's own count.
#[test]
fn probe_counts_shots_until_the_champion_dies() {
    let (shots, share) = probe_shots_to_kill(1000.0, 600.0);
    assert!(shots >= 2, "a 1000 hp champion fell in {shots} shots");
    assert!(share > 0.0 && share < 1.0);
}

const DEFAULT_TEST_HP_FOR_LEDGER: f64 = super::test_helpers::DEFAULT_TEST_HP;
