//! Measurement that starts the match engine the way the app does. The other
//! harnesses build a request by hand (no initial state, empty profiles, default
//! AI mode and policy) and drive it with `skip_to_end`; the app sends the
//! arguments the frontend captured and drives it with `tick`. This one replays
//! such a captured start many times with different seeds, through the two
//! functions the Tauri commands `sim_live_init` and `sim_live_tick` call. It
//! reads only the public state and changes no rule.
//!
//! ```text
//! CAPTURED_INIT=/path/to/init-1.json CAPTURED_N=100 CAPTURED_SEED=0 \
//!   cargo test --release -p olm_core --lib \
//!   sim_live::captured_replay_harness_tests::replay_captured_start -- --ignored --nocapture
//! ```
//!
//! Environment:
//! - `CAPTURED_INIT` (required): the args the frontend passed to
//!   `invoke("sim_live_init", args)`, saved untouched. The args wrap the request in
//!   a `request` key (`LolSimV2Client` calls `sim.init({ request })`); a file with the
//!   bare request is accepted too.
//! - `CAPTURED_N` matches (default 100), `CAPTURED_SEED` first seed number (default 0).
//! - `CAPTURED_DT` and `CAPTURED_SPEED`: the `dtSec` and `speed` of every tick call
//!   (defaults 0.05 and 12.0; see `DEFAULT_TICK_DT_SEC`).
//! - `CAPTURED_VERBOSE=1`: one line per match.
//! - `CAPTURED_EXACT=1`: one match with the captured seed and session id themselves,
//!   to compare with the result the app showed for that very match.
//!
//! The captured `initialState` (built by the TypeScript simulation) is deserialised
//! with the request, but the engine's `init` does not read it, exactly as in the app.

use std::collections::{BTreeMap, HashMap};

use serde_json::Value;

use super::*;

/// `dtSec` of a tick call. The frontend sends the real time since the last frame
/// (the previous call's duration while one is in flight), capped at
/// `BACKEND_MAX_FRAME_SEC` (0.25) and accumulated up to 0.5. When the backend keeps
/// up that is a few hundredths of a second, so the default is 0.05 real seconds:
/// at speed 12 exactly one engine step of `FIXED_STEP_SEC` (0.6 game seconds) per
/// call. The engine turns the time into fixed steps through an accumulator, so
/// the value only changes how often the state is encoded and how a stall is
/// clamped; set it from the captured `ticks-<n>.json` to follow a real session.
const DEFAULT_TICK_DT_SEC: f64 = 0.05;
/// Playback speed the frontend sends at the "12x" setting.
const DEFAULT_TICK_SPEED: f64 = 12.0;
/// Nothing in the app ends an undecided match (the frontend finishes it only when
/// `state.winner` is set, and the engine sets that only when a nexus falls), so a
/// match that reaches this game time is counted as undecided.
const GAME_LIMIT_SEC: f64 = 75.0 * 60.0;
/// Display order of the roles; roles the engine reports that are not listed come last.
const ROLE_ORDER: [&str; 5] = ["TOP", "JGL", "MID", "ADC", "SUP"];

/// Centre distance under which two champions count as overlapped.
const OVERLAP_DISTANCE: f64 = 0.03;

fn env_or<T: std::str::FromStr>(name: &str, default: T) -> T {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

/// The request the frontend sent, from the saved invoke args or from a bare request.
fn load_captured_request(path: &str) -> Result<SimLiveInitRequest, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("cannot read {path}: {e}"))?;
    let json: Value = serde_json::from_str(&text).map_err(|e| format!("{path} is not JSON: {e}"))?;
    let request = match json.get("request") {
        Some(inner) if inner.is_object() => inner.clone(),
        _ => json,
    };
    serde_json::from_value(request).map_err(|e| format!("{path} is not a sim_live_init request: {e}"))
}


/// Seconds two enemies in contact, or an intruder at a base, may go without damage before the
/// observer counts it as the action having stopped.
const IDLE_LIMIT_SEC: f64 = 3.0;
/// Radius around a champion's own spawn point that counts as the fountain.
const FOUNTAIN_RADIUS: f64 = 0.08;
/// Radius around a nexus that counts as the base of the team that owns it.
const BASE_AREA_RADIUS: f64 = 0.2;
/// The smallest reach the engine gives an attack (`attack_range.max(0.04)`).
const MIN_ATTACK_REACH: f64 = 0.04;
/// Seconds a champion may stay in the recall state with no channel in progress, or stand about
/// one spot in his own base while his team plays the plan, before the observer counts a stuck
/// state.
const STUCK_LIMIT_SEC: f64 = 30.0;
/// How far a champion may drift from where a base freeze began and still count as standing there.
const FREEZE_DRIFT: f64 = 0.05;
/// Stuck-state examples each match keeps.
const STUCK_EXAMPLES_PER_MATCH: usize = 3;

/// What the observer counted in one match.
#[derive(Debug, Clone, Default)]
struct ContactStats {
    /// Episodes of two enemy champions alive within attack range of each other for
    /// `IDLE_LIMIT_SEC` or more with no damage between them, outside the fountain.
    idle_contacts: u32,
    /// The idle contacts whose centres were within `OVERLAP_DISTANCE`: about one bubble.
    overlapped_idle_contacts: u32,
    /// Seconds spent in those episodes, from the moment each one reached the limit.
    idle_secs: f64,
    /// Recalls that completed.
    recalls_completed: u32,
    /// Completed recalls during which an enemy that could reach the recaller was in sight.
    free_recalls: u32,
    /// Episodes of an enemy inside the defender's base area, within attack range of a defending
    /// champion or a base tower, for `IDLE_LIMIT_SEC` or more with no damage taken.
    base_ignores: u32,
    /// Seconds spent in those episodes, from the moment each one reached the limit.
    base_ignore_secs: f64,
    /// The base ignores in which, besides, nobody on the intruder's team took damage for
    /// `IDLE_LIMIT_SEC`: the defenders did nothing to anyone, not only nothing to him.
    quiet_base_ignores: u32,
    /// The idle contacts by what the two champions were doing and how close they stood, when
    /// the episode reached the limit.
    idle_kinds: BTreeMap<String, u32>,
    /// The idle contacts by game minute of ten.
    idle_by_decade: [u32; 8],
    /// The base ignores by who faced the intruder (champion, tower, both), whether he stood in
    /// the zone the engine defends (0.13 from the nexus or a nexus tower) and what he was doing.
    base_kinds: BTreeMap<String, u32>,
    /// The free recalls by what the nearest reaching enemy was doing and how far he stood.
    recall_kinds: BTreeMap<String, u32>,
    /// Episodes of a champion in the recall state for `STUCK_LIMIT_SEC` or more with no channel
    /// in progress (a recall walks to its anchor first; a long walk without a channel is stuck).
    stuck_recalls: u32,
    /// The longest such episode, in seconds.
    longest_stuck_recall: f64,
    /// The stuck recalls in which the champion also stayed within `FREEZE_DRIFT` of one spot for
    /// `STUCK_LIMIT_SEC` (standing still, not walking away from a threat).
    still_recalls: u32,
    /// Episodes of a champion within `BASE_AREA_RADIUS` of his own nexus, outside the fountain,
    /// alive and not recalling, within `FREEZE_DRIFT` of one spot for `STUCK_LIMIT_SEC` or more
    /// while his team's plan is active.
    base_freezes: u32,
    /// The longest such episode, in seconds.
    longest_base_freeze: f64,
    /// The stuck recalls by how near the closest living enemy stood when the episode reached the
    /// limit and whether the recaller stood still.
    stuck_recall_kinds: BTreeMap<String, u32>,
    /// The first few stuck-state episodes of the match, for the examples.
    stuck_examples: Vec<String>,
}

/// A champion as the previous step left it.
#[derive(Clone)]
struct PreviousChampion {
    pos: Vec2,
    hp: f64,
    last_damaged_at: f64,
}

/// One champion's stretch in the recall state with no channel in progress.
#[derive(Clone, Copy)]
struct RecallStuck {
    secs: f64,
    counted: bool,
    /// Where the champion last started standing, seconds there, and whether it was counted.
    spot: Vec2,
    still_secs: f64,
    still_counted: bool,
}

/// Reads the public state after every step and counts the moments in which the action should
/// have happened and did not. It changes nothing in the simulation.
struct ContactObserver {
    previous_time: f64,
    previous: Vec<PreviousChampion>,
    /// Seconds an idle pair has been in contact, and whether the episode was counted.
    idle_pairs: HashMap<(usize, usize), (f64, bool)>,
    /// Cumulative champion-on-champion damage of each pair, to see new damage.
    pair_damage: HashMap<(usize, usize), f64>,
    /// Per recaller: whether an enemy that could reach him has been in sight during this channel.
    recall_watch: Vec<Option<(bool, String)>>,
    /// Per intruder: seconds at a base without damage, and whether the episode was counted.
    base_idle: Vec<(f64, bool)>,
    /// Per champion: seconds in the recall state with no channel, and whether it was counted.
    recall_stuck: Vec<RecallStuck>,
    /// Per champion: where the base freeze began, seconds there, and whether it was counted.
    base_freeze: Vec<(Vec2, f64, bool)>,
    /// Set when, in the last step, an enemy first became able to stop a recall in progress.
    just_free: bool,
    stats: ContactStats,
}

impl ContactObserver {
    fn new() -> Self {
        Self {
            previous_time: 0.0,
            previous: Vec::new(),
            idle_pairs: HashMap::new(),
            pair_damage: HashMap::new(),
            recall_watch: Vec::new(),
            base_idle: Vec::new(),
            recall_stuck: Vec::new(),
            base_freeze: Vec::new(),
            just_free: false,
            stats: ContactStats::default(),
        }
    }

    fn reach(champion: &ChampionRuntime) -> f64 {
        champion.attack_range.max(MIN_ATTACK_REACH)
    }

    fn in_fountain(champion: &ChampionRuntime) -> bool {
        dist(champion.pos, base_position_for(&champion.team)) <= FOUNTAIN_RADIUS
    }

    /// True when `a` took damage from `b` (or `b` from `a`) since the previous step.
    fn damage_between(&mut self, state: &RuntimeState, a: usize, b: usize) -> bool {
        let (ca, cb) = (&state.champions[a], &state.champions[b]);
        let ledger = state.farm_ledger.damage_by_attacker_role();
        let total = ledger.get(&(ca.id.clone(), cb.role.clone())).copied().unwrap_or(0.0)
            + ledger.get(&(cb.id.clone(), ca.role.clone())).copied().unwrap_or(0.0);
        let before = self.pair_damage.insert((a, b), total).unwrap_or(0.0);
        let stamped = |victim: &ChampionRuntime, attacker: &ChampionRuntime| {
            victim.last_damaged_by_champion_id.as_deref() == Some(attacker.id.as_str())
                && victim.last_damaged_by_champion_at > self.previous_time
        };
        total > before + 1e-9 || stamped(ca, cb) || stamped(cb, ca)
    }

    fn observe(&mut self, state: &RuntimeState) {
        let now = state.time_sec;
        let dt = (now - self.previous_time).max(0.0);
        let count = state.champions.len();
        self.just_free = false;
        if self.previous.is_empty() {
            self.recall_watch = vec![None; count];
            self.base_idle = vec![(0.0, false); count];
            self.recall_stuck = state
                .champions
                .iter()
                .map(|c| RecallStuck { secs: 0.0, counted: false, spot: c.pos, still_secs: 0.0, still_counted: false })
                .collect();
            self.base_freeze = state.champions.iter().map(|c| (c.pos, 0.0, false)).collect();
        }
        self.observe_contacts(state, dt);
        self.observe_recalls(state, now);
        self.observe_bases(state, dt);
        self.observe_stuck(state, dt);
        self.previous = state
            .champions
            .iter()
            .map(|c| PreviousChampion { pos: c.pos, hp: c.hp, last_damaged_at: c.last_damaged_at })
            .collect();
        self.previous_time = now;
    }

    /// Counts the two stuck states: a long recall with no channel, and a long stand in the own
    /// base while the team plays the plan.
    fn observe_stuck(&mut self, state: &RuntimeState, dt: f64) {
        let now = state.time_sec;
        for (i, champion) in state.champions.iter().enumerate() {
            let name = format!("{}{}", &champion.team[..1], champion.role);
            let recalling_idle = champion.alive
                && champion.state == "recall"
                && champion.recall_channel_until <= now
                && !Self::in_fountain(champion);
            let entry = &mut self.recall_stuck[i];
            if recalling_idle {
                entry.secs += dt;
                if dist(champion.pos, entry.spot) > FREEZE_DRIFT {
                    entry.spot = champion.pos;
                    entry.still_secs = 0.0;
                    entry.still_counted = false;
                } else {
                    entry.still_secs += dt;
                }
                if entry.secs >= STUCK_LIMIT_SEC {
                    self.stats.longest_stuck_recall = self.stats.longest_stuck_recall.max(entry.secs);
                    if !entry.counted {
                        entry.counted = true;
                        self.stats.stuck_recalls += 1;
                        let nearest = state
                            .champions
                            .iter()
                            .filter(|e| e.alive && normalized_team(&e.team) != normalized_team(&champion.team))
                            .map(|e| dist(e.pos, champion.pos))
                            .fold(f64::INFINITY, f64::min);
                        let band = if nearest <= 0.085 { "enemy<=0.085" } else if nearest <= 0.2 { "enemy<=0.2" } else { "no enemy near" };
                        let moving = if entry.still_secs >= STUCK_LIMIT_SEC { "still" } else { "walking" };
                        *self.stats.stuck_recall_kinds.entry(format!("{band} {moving}")).or_default() += 1;
                        if self.stats.stuck_examples.len() < STUCK_EXAMPLES_PER_MATCH {
                            self.stats.stuck_examples.push(format!(
                                "stuck recall {name} from t={:.0} at {:.2},{:.2}",
                                now - entry.secs, champion.pos.x, champion.pos.y
                            ));
                        }
                    }
                }
                if entry.still_secs >= STUCK_LIMIT_SEC && !entry.still_counted {
                    entry.still_counted = true;
                    self.stats.still_recalls += 1;
                }
            } else {
                *entry = RecallStuck { secs: 0.0, counted: false, spot: champion.pos, still_secs: 0.0, still_counted: false };
            }

            let own_base = base_position_for(&champion.team);
            let plan_active = state.team_push[usize::from(normalized_team(&champion.team) != "blue")].active;
            let at_base = champion.alive
                && !champion_is_banished(champion)
                && champion.state != "recall"
                && plan_active
                && dist(champion.pos, own_base) <= BASE_AREA_RADIUS
                && !Self::in_fountain(champion);
            let freeze = &mut self.base_freeze[i];
            if !at_base || dist(champion.pos, freeze.0) > FREEZE_DRIFT {
                *freeze = (champion.pos, 0.0, false);
                continue;
            }
            freeze.1 += dt;
            if freeze.1 >= STUCK_LIMIT_SEC {
                self.stats.longest_base_freeze = self.stats.longest_base_freeze.max(freeze.1);
                if !freeze.2 {
                    freeze.2 = true;
                    self.stats.base_freezes += 1;
                    if self.stats.stuck_examples.len() < STUCK_EXAMPLES_PER_MATCH {
                        self.stats.stuck_examples.push(format!(
                            "base freeze {name} {} from t={:.0} at {:.2},{:.2}",
                            champion.state, now - freeze.1, champion.pos.x, champion.pos.y
                        ));
                    }
                }
            }
        }
    }

    fn observe_contacts(&mut self, state: &RuntimeState, dt: f64) {
        let count = state.champions.len();
        for a in 0..count {
            for b in (a + 1)..count {
                let (ca, cb) = (&state.champions[a], &state.champions[b]);
                if normalized_team(&ca.team) == normalized_team(&cb.team) {
                    continue;
                }
                let damaged = self.damage_between(state, a, b);
                let in_contact = ca.alive
                    && cb.alive
                    && !champion_is_banished(ca)
                    && !champion_is_banished(cb)
                    && !Self::in_fountain(ca)
                    && !Self::in_fountain(cb)
                    && dist(ca.pos, cb.pos) <= Self::reach(ca).max(Self::reach(cb));
                if !in_contact || damaged {
                    self.idle_pairs.remove(&(a, b));
                    continue;
                }
                let entry = self.idle_pairs.entry((a, b)).or_insert((0.0, false));
                entry.0 += dt;
                if entry.0 >= IDLE_LIMIT_SEC {
                    if entry.1 {
                        self.stats.idle_secs += dt;
                    } else {
                        entry.1 = true;
                        self.stats.idle_contacts += 1;
                        self.stats.idle_secs += entry.0;
                        let d = dist(ca.pos, cb.pos);
                        self.stats.overlapped_idle_contacts += u32::from(d <= OVERLAP_DISTANCE);
                        let bucket = if d <= 0.02 { "d<=0.02" } else if d <= 0.04 { "d<=0.04" } else { "d>0.04" };
                        let mut states = [ca.state.as_str(), cb.state.as_str()];
                        states.sort_unstable();
                        *self
                            .stats
                            .idle_kinds
                            .entry(format!("{}+{} {bucket}", states[0], states[1]))
                            .or_default() += 1;
                        let decade = ((state.time_sec / 600.0) as usize).min(7);
                        self.stats.idle_by_decade[decade] += 1;
                    }
                }
            }
        }
    }

    fn observe_recalls(&mut self, state: &RuntimeState, now: f64) {
        for (i, champion) in state.champions.iter().enumerate() {
            let channeling = champion.alive
                && champion.state == "recall"
                && champion.recall_channel_until > now
                && !Self::in_fountain(champion);
            if channeling {
                let remaining = champion.recall_channel_until - now;
                let timers = decode_neutral_timers_state(&state.neutral_timers)
                    .unwrap_or_else(neutral_timers_default_runtime_state);
                let reaching = state
                    .champions
                    .iter()
                    .enumerate()
                    .filter(|(_, enemy)| {
                        enemy.alive
                            && !champion_is_banished(enemy)
                            && enemy.state != "recall"
                            && normalized_team(&enemy.team) != normalized_team(&champion.team)
                            && dist(enemy.pos, champion.pos) <= CHAMPION_VISION_RADIUS
                            && (dist(enemy.pos, champion.pos) - Self::reach(enemy)).max(0.0)
                                / enemy.move_speed.max(0.01)
                                <= remaining
                    })
                    .min_by(|(_, a), (_, b)| dist(a.pos, champion.pos).total_cmp(&dist(b.pos, champion.pos)));
                let watch = self.recall_watch[i].get_or_insert((false, String::new()));
                if let (Some((enemy_idx, enemy)), false) = (reaching, watch.0) {
                    self.just_free = true;
                    let d = dist(enemy.pos, champion.pos);
                    let band = if d <= Self::reach(enemy) { "in-range" } else if d <= 0.1 { "d<=0.1" } else { "d<=0.145" };
                    let rule = if combat::recall_interrupt_idx(state, enemy_idx, &timers) == Some(i) { "rule-yes" } else { "rule-no" };
                    let enemy_hp = if enemy.hp / enemy.max_hp < 0.4 { "enemy<40" } else { "enemy>=40" };
                    *watch = (true, format!("{rule} {} {band} {enemy_hp}", enemy.state));
                }
                continue;
            }
            // The channel ended: a teleport to the base is a completed recall, anything else
            // (damage, death, a new order) an interrupted one.
            if let (Some((free, kind)), Some(before)) = (self.recall_watch[i].take(), self.previous.get(i)) {
                let teleported = champion.alive
                    && dist(champion.pos, base_position_for(&champion.team)) < 0.02
                    && dist(before.pos, base_position_for(&champion.team)) > 0.05;
                if teleported {
                    self.stats.recalls_completed += 1;
                    self.stats.free_recalls += u32::from(free);
                    if free {
                        *self.stats.recall_kinds.entry(kind).or_default() += 1;
                    }
                }
            }
        }
    }

    fn observe_bases(&mut self, state: &RuntimeState, dt: f64) {
        for (i, intruder) in state.champions.iter().enumerate() {
            let Some(nexus) = state
                .structures
                .iter()
                .find(|s| s.kind == "nexus" && normalized_team(&s.team) != normalized_team(&intruder.team))
            else {
                continue;
            };
            let damaged = self.previous.get(i).is_some_and(|before| {
                intruder.hp < before.hp - 0.5 || intruder.last_damaged_at > before.last_damaged_at
            });
            let defender_team = normalized_team(&nexus.team);
            let champion_faces = state.champions.iter().any(|c| {
                c.alive
                    && !champion_is_banished(c)
                    && c.state != "recall"
                    && normalized_team(&c.team) == defender_team
                    && dist(c.pos, intruder.pos) <= Self::reach(c)
            });
            let tower_faces = state.structures.iter().any(|s| {
                s.alive
                    && s.kind == "tower"
                    && normalized_team(&s.team) == defender_team
                    && dist(s.pos, nexus.pos) <= BASE_AREA_RADIUS
                    && dist(s.pos, intruder.pos) <= TOWER_ATTACK_RANGE
            });
            let facing = intruder.alive
                && !champion_is_banished(intruder)
                && dist(intruder.pos, nexus.pos) <= BASE_AREA_RADIUS
                && (champion_faces || tower_faces);
            if !facing || damaged {
                self.base_idle[i] = (0.0, false);
                continue;
            }
            let entry = &mut self.base_idle[i];
            entry.0 += dt;
            if entry.0 >= IDLE_LIMIT_SEC {
                if entry.1 {
                    self.stats.base_ignore_secs += dt;
                } else {
                    entry.1 = true;
                    self.stats.base_ignores += 1;
                    self.stats.base_ignore_secs += entry.0;
                    let quiet = state.champions.iter().all(|c| {
                        normalized_team(&c.team) != normalized_team(&intruder.team)
                            || state.time_sec - c.last_damaged_at >= IDLE_LIMIT_SEC
                    });
                    self.stats.quiet_base_ignores += u32::from(quiet);
                    let timers = decode_neutral_timers_state(&state.neutral_timers)
                        .unwrap_or_else(neutral_timers_default_runtime_state);
                    // What the first defender in reach picks as target and whether he can swing.
                    let defender_view = state
                        .champions
                        .iter()
                        .enumerate()
                        .find(|(_, c)| {
                            c.alive
                                && !champion_is_banished(c)
                                && c.state != "recall"
                                && normalized_team(&c.team) == defender_team
                                && dist(c.pos, intruder.pos) <= Self::reach(c)
                        })
                        .map(|(idx, c)| {
                            let target = match combat::pick_combat_target(state, idx, state.time_sec, &timers) {
                                Some(CombatTarget::Champion(e)) if e == i => "intruder",
                                Some(CombatTarget::Champion(_)) => "other-champion",
                                Some(CombatTarget::Minion(_)) => "minion",
                                Some(CombatTarget::Structure(_)) => "structure",
                                Some(CombatTarget::Neutral(_)) => "neutral",
                                None => "none",
                            };
                            format!("{} {target} {}", c.state, if c.attack_cd_until <= state.time_sec { "ready" } else { "cooling" })
                        })
                        .unwrap_or_default();
                    let who = match (champion_faces, tower_faces) {
                        (true, true) => "champion+tower",
                        (true, false) => "champion",
                        _ => "tower",
                    };
                    let engine_zone = state.structures.iter().any(|s| {
                        s.alive
                            && normalized_team(&s.team) == defender_team
                            && (s.kind == "nexus" || (s.kind == "tower" && s.id.contains("nexus")))
                            && dist(s.pos, intruder.pos) <= NEXUS_DEFENSE_THREAT_RADIUS
                    });
                    *self
                        .stats
                        .base_kinds
                        .entry(format!(
                            "{who} {} [{defender_view}]",
                            if engine_zone { "engine-zone" } else { "outer" },
                        ))
                        .or_default() += 1;
                }
            }
        }
    }
}

struct Played {
    seed: usize,
    winner: Option<String>,
    minutes: f64,
    kills: f64,
    winner_loser_kills: Option<(i64, i64)>,
    /// Game second at which blue / red had destroyed every enemy tower.
    cleared_at: [Option<f64>; 2],
    /// Towers still standing at the end: blue, red.
    towers_standing: [f64; 2],
    /// Towers each side destroyed, from the engine's own counters: blue, red.
    towers_destroyed: [f64; 2],
    /// Level of each champion at the end, as (team, role, level).
    levels: Vec<(String, String, i64)>,
    /// Moments in which the action stopped, from the observer.
    contact: ContactStats,
}

impl Played {
    /// The team that destroyed all enemy towers first, with the game second.
    fn first_clear(&self) -> Option<(&'static str, f64)> {
        match self.cleared_at {
            [Some(blue), Some(red)] if blue <= red => Some(("blue", blue)),
            [Some(_), Some(red)] => Some(("red", red)),
            [Some(blue), None] => Some(("blue", blue)),
            [None, Some(red)] => Some(("red", red)),
            [None, None] => None,
        }
    }

    /// Minutes from the first all-towers moment to the end of the match, when decided.
    fn clear_to_end_min(&self) -> Option<f64> {
        let (_, at) = self.first_clear()?;
        self.winner.as_ref()?;
        Some((self.minutes - at / 60.0).max(0.0))
    }
}

fn alive_towers(state: &RuntimeState, team: &str) -> usize {
    state
        .structures
        .iter()
        .filter(|s| s.kind == "tower" && s.team == team && s.alive)
        .count()
}

fn play(n: usize, template: &SimLiveInitRequest, dt_sec: f64, speed: f64, exact: bool) -> Played {
    let mut request = template.clone();
    // The exact replay changes nothing, so it plays the very match the app played.
    if !exact {
        request.session_id = format!("captured-replay-{n}");
        request.seed = format!("{}-{n}", template.seed);
    }
    let session_id = request.session_id.clone();
    let store = SimLiveStoreState::default();
    init(&store, request).expect("init");

    let mut cleared_at: [Option<f64>; 2] = [None, None];
    let mut observer = ContactObserver::new();
    loop {
        tick(
            &store,
            SimLiveTickRequest {
                session_id: session_id.clone(),
                dt_sec,
                running: true,
                speed,
            },
        )
        .expect("tick");
        let sessions = store.sessions.lock().expect("lock");
        let state = &sessions[&session_id].state;
        observer.observe(state);
        // Blue clears the red towers and the other way round.
        for (slot, enemy) in [(0, "red"), (1, "blue")] {
            if cleared_at[slot].is_none()
                && alive_towers(state, enemy) == 0
                && state.structures.iter().any(|s| s.kind == "tower" && s.team == enemy)
            {
                cleared_at[slot] = Some(state.time_sec);
            }
        }
        if state.winner.is_some() || state.time_sec >= GAME_LIMIT_SEC {
            break;
        }
    }

    let sessions = store.sessions.lock().expect("lock");
    let state = &sessions[&session_id].state;
    let (blue_kills, red_kills) = (state.stats.blue.kills, state.stats.red.kills);
    let winner_loser_kills = match state.winner.as_deref() {
        Some("blue") => Some((blue_kills, red_kills)),
        Some("red") => Some((red_kills, blue_kills)),
        _ => None,
    };
    Played {
        seed: n,
        winner: state.winner.clone(),
        minutes: state.time_sec / 60.0,
        kills: (blue_kills + red_kills) as f64,
        winner_loser_kills,
        cleared_at,
        towers_standing: [alive_towers(state, "blue") as f64, alive_towers(state, "red") as f64],
        towers_destroyed: [state.stats.blue.towers as f64, state.stats.red.towers as f64],
        levels: state
            .champions
            .iter()
            .map(|c| (c.team.clone(), c.role.clone(), c.level))
            .collect(),
        contact: observer.stats.clone(),
    }
}

fn mean_of(values: &[f64]) -> f64 {
    if values.is_empty() {
        0.0
    } else {
        values.iter().sum::<f64>() / values.len() as f64
    }
}

/// Value at quantile `q` of an ascending list; 0 when empty.
fn quantile(sorted: &[f64], q: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    sorted[((sorted.len() - 1) as f64 * q).round() as usize]
}

#[test]
#[ignore = "measurement: replays a captured match start N times; set CAPTURED_INIT to the saved sim_live_init args"]
fn replay_captured_start() {
    let path = std::env::var("CAPTURED_INIT")
        .expect("CAPTURED_INIT must be the path of the captured sim_live_init args (init-<n>.json)");
    let template = load_captured_request(&path).unwrap_or_else(|e| panic!("{e}"));
    let n: usize = env_or("CAPTURED_N", 100);
    let first: usize = env_or("CAPTURED_SEED", 0);
    let dt_sec: f64 = env_or("CAPTURED_DT", DEFAULT_TICK_DT_SEC);
    let speed: f64 = env_or("CAPTURED_SPEED", DEFAULT_TICK_SPEED);
    let verbose = env_or("CAPTURED_VERBOSE", 0_u8) != 0;
    let exact = env_or("CAPTURED_EXACT", 0_u8) != 0;
    let n = if exact { 1 } else { n };
    assert!(n > 0, "CAPTURED_N must be at least 1");
    assert!(dt_sec > 0.0 && speed > 0.0, "CAPTURED_DT and CAPTURED_SPEED must be positive");

    let workers = std::thread::available_parallelism().map(|c| c.get()).unwrap_or(4).min(n);
    let mut played: Vec<Played> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..workers)
            .map(|worker| {
                let template = &template;
                scope.spawn(move || {
                    (worker..n)
                        .step_by(workers)
                        .map(|i| play(first + i, template, dt_sec, speed, exact))
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        handles
            .into_iter()
            .flat_map(|handle| handle.join().expect("match worker"))
            .collect()
    });
    played.sort_by_key(|p| p.seed);

    if verbose {
        for p in &played {
            let clear = |slot: usize| {
                p.cleared_at[slot].map_or("-".to_string(), |s| format!("{:.1}", s / 60.0))
            };
            let (winner_kills, loser_kills) = p.winner_loser_kills.unwrap_or((0, 0));
            println!(
                "seed {} winner {} minutes {:.1} kills {} (winner {} loser {}) towers left blue {} red {} all-towers blue {} red {}",
                p.seed,
                p.winner.as_deref().unwrap_or("none"),
                p.minutes,
                p.kills,
                winner_kills,
                loser_kills,
                p.towers_standing[0],
                p.towers_standing[1],
                clear(0),
                clear(1),
            );
        }
    }

    println!(
        "captured start {path}, {} matches, first seed {first}, tick dt {dt_sec} speed {speed}",
        played.len()
    );
    println!("minutes {:.2}", mean_of(&played.iter().map(|p| p.minutes).collect::<Vec<_>>()));
    println!("kills {:.2}", mean_of(&played.iter().map(|p| p.kills).collect::<Vec<_>>()));
    let mut lengths: Vec<f64> = played.iter().map(|p| p.minutes).collect();
    lengths.sort_by(f64::total_cmp);
    println!(
        "minutes p10 {:.1} p50 {:.1} p90 {:.1}",
        quantile(&lengths, 0.1),
        quantile(&lengths, 0.5),
        quantile(&lengths, 0.9)
    );
    println!(
        "matches of 50 minutes or more {}",
        lengths.iter().filter(|minutes| **minutes >= 50.0).count()
    );
    let decided: Vec<(i64, i64)> = played.iter().filter_map(|p| p.winner_loser_kills).collect();
    println!("undecided at the step limit {}", played.len() - decided.len());
    for lead in [10, 15, 20] {
        println!(
            "lost with a lead of {lead} or more kills {} of {} decided",
            decided.iter().filter(|(winner, loser)| loser - winner >= lead).count(),
            decided.len()
        );
    }
    let blue_wins = played.iter().filter(|p| p.winner.as_deref() == Some("blue")).count();
    println!(
        "blue wins {} of {} ({:.1}%)",
        blue_wins,
        played.len(),
        blue_wins as f64 / played.len() as f64 * 100.0
    );

    for (slot, team) in [(0, "blue"), (1, "red")] {
        let minutes: Vec<f64> = played.iter().filter_map(|p| p.cleared_at[slot]).map(|s| s / 60.0).collect();
        println!(
            "{team} destroyed all enemy towers in {} matches, mean minute {:.1}",
            minutes.len(),
            mean_of(&minutes)
        );
    }
    let mut tail: Vec<f64> = played.iter().filter_map(Played::clear_to_end_min).collect();
    tail.sort_by(f64::total_cmp);
    println!(
        "minutes from the first all-towers moment to the end: {} matches, mean {:.1}, p90 {:.1}, over 5 minutes in {}",
        tail.len(),
        mean_of(&tail),
        quantile(&tail, 0.9),
        tail.iter().filter(|minutes| **minutes > 5.0).count()
    );
    let against_the_towers = played
        .iter()
        .filter(|p| match (p.first_clear(), p.winner.as_deref()) {
            (Some((first_team, _)), Some(winner)) => first_team != winner,
            _ => false,
        })
        .count();
    println!("won by the team that did not destroy all towers first {against_the_towers}");
    for (slot, team) in [(0, "blue"), (1, "red")] {
        println!(
            "{team} final towers standing {:.2}, destroyed by it {:.2}",
            mean_of(&played.iter().map(|p| p.towers_standing[slot]).collect::<Vec<_>>()),
            mean_of(&played.iter().map(|p| p.towers_destroyed[slot]).collect::<Vec<_>>()),
        );
    }

    let total = |f: &dyn Fn(&ContactStats) -> f64| played.iter().map(|p| f(&p.contact)).sum::<f64>();
    let matches = played.len() as f64;
    println!(
        "idle contacts {} ({:.2} per match), idle seconds {:.0}",
        total(&|c| f64::from(c.idle_contacts)),
        total(&|c| f64::from(c.idle_contacts)) / matches,
        total(&|c| c.idle_secs),
    );
    println!(
        "overlapped idle contacts {} ({:.2} per match)",
        total(&|c| f64::from(c.overlapped_idle_contacts)),
        total(&|c| f64::from(c.overlapped_idle_contacts)) / matches,
    );
    let mut kinds: BTreeMap<&str, u32> = BTreeMap::new();
    for p in &played {
        for (kind, n) in &p.contact.idle_kinds {
            *kinds.entry(kind.as_str()).or_default() += n;
        }
    }
    let mut kinds: Vec<(&str, u32)> = kinds.into_iter().collect();
    kinds.sort_by_key(|(_, n)| std::cmp::Reverse(*n));
    println!(
        "idle contacts by kind: {}",
        kinds.iter().take(10).map(|(k, n)| format!("{k} {n}")).collect::<Vec<_>>().join("; ")
    );
    let tally = |pick: &dyn Fn(&ContactStats) -> &BTreeMap<String, u32>| {
        let mut kinds: BTreeMap<&str, u32> = BTreeMap::new();
        for p in &played {
            for (kind, n) in pick(&p.contact) {
                *kinds.entry(kind.as_str()).or_default() += n;
            }
        }
        let mut kinds: Vec<(&str, u32)> = kinds.into_iter().collect();
        kinds.sort_by_key(|(_, n)| std::cmp::Reverse(*n));
        kinds.iter().take(10).map(|(k, n)| format!("{k} {n}")).collect::<Vec<_>>().join("; ")
    };
    println!("base ignores by kind: {}", tally(&|c| &c.base_kinds));
    println!("free recalls by kind: {}", tally(&|c| &c.recall_kinds));
    println!(
        "idle contacts by ten minutes: {:?}",
        (0..8).map(|d| played.iter().map(|p| p.contact.idle_by_decade[d]).sum::<u32>()).collect::<Vec<_>>()
    );
    println!(
        "free recalls {} of {} completed ({:.2} per match)",
        total(&|c| f64::from(c.free_recalls)),
        total(&|c| f64::from(c.recalls_completed)),
        total(&|c| f64::from(c.free_recalls)) / matches,
    );
    println!(
        "base ignores {} ({:.2} per match), base ignore seconds {:.0}, of which quiet {}",
        total(&|c| f64::from(c.base_ignores)),
        total(&|c| f64::from(c.base_ignores)) / matches,
        total(&|c| c.base_ignore_secs),
        total(&|c| f64::from(c.quiet_base_ignores)),
    );

    println!(
        "stuck recalls {} ({:.3} per match), standing still {}, longest {:.0} s",
        total(&|c| f64::from(c.stuck_recalls)),
        total(&|c| f64::from(c.stuck_recalls)) / matches,
        total(&|c| f64::from(c.still_recalls)),
        played.iter().map(|p| p.contact.longest_stuck_recall).fold(0.0, f64::max),
    );
    println!(
        "base freezes {} ({:.3} per match), longest {:.0} s",
        total(&|c| f64::from(c.base_freezes)),
        total(&|c| f64::from(c.base_freezes)) / matches,
        played.iter().map(|p| p.contact.longest_base_freeze).fold(0.0, f64::max),
    );
    println!("stuck recalls by kind: {}", tally(&|c| &c.stuck_recall_kinds));
    for p in played.iter().filter(|p| !p.contact.stuck_examples.is_empty()).take(6) {
        println!("stuck examples seed {}: {}", p.seed, p.contact.stuck_examples.join("; "));
    }

    let mut levels: BTreeMap<(String, String), Vec<f64>> = BTreeMap::new();
    for p in &played {
        for (team, role, level) in &p.levels {
            levels.entry((team.clone(), role.clone())).or_default().push(*level as f64);
        }
    }
    let role_rank = |role: &str| ROLE_ORDER.iter().position(|r| *r == role).unwrap_or(ROLE_ORDER.len());
    for team in ["blue", "red"] {
        let mut roles: Vec<&String> = levels.keys().filter(|(t, _)| t == team).map(|(_, r)| r).collect();
        roles.sort_by_key(|r| (role_rank(r), (*r).clone()));
        let line: Vec<String> = roles
            .iter()
            .map(|role| {
                let values = &levels[&(team.to_string(), (*role).clone())];
                format!("{role} {:.1}", mean_of(values))
            })
            .collect();
        println!("{team} final level: {}", line.join(", "));
    }
}

/// Plays one seed of a captured start and, from the moment one team has destroyed every enemy
/// tower, prints every `CAPTURED_TRACE_EVERY` seconds (default 20) where the champions are, the
/// plan of each team, the health of the nexuses and inhibitors, and every death.
///
/// ```text
/// CAPTURED_INIT=init-1.json CAPTURED_TRACE_SEED=89 cargo test --release -p olm_core --lib \
///   sim_live::captured_replay_harness_tests::trace_captured_ending -- --ignored --nocapture
/// ```
#[test]
#[ignore = "measurement: traces the end of one captured-start match"]
fn trace_captured_ending() {
    let path = std::env::var("CAPTURED_INIT").expect("CAPTURED_INIT");
    let template = load_captured_request(&path).unwrap_or_else(|e| panic!("{e}"));
    let n: usize = env_or("CAPTURED_TRACE_SEED", 0);
    let every: f64 = env_or("CAPTURED_TRACE_EVERY", 20.0);
    let mut request = template.clone();
    request.session_id = format!("captured-replay-{n}");
    request.seed = format!("{}-{n}", template.seed);
    let session_id = request.session_id.clone();
    let store = SimLiveStoreState::default();
    init(&store, request).expect("init");
    let mut tracing_from: Option<f64> = None;
    let mut next_print = 0.0;
    let mut alive_before: Vec<bool> = Vec::new();
    loop {
        tick(
            &store,
            SimLiveTickRequest {
                session_id: session_id.clone(),
                dt_sec: DEFAULT_TICK_DT_SEC,
                running: true,
                speed: DEFAULT_TICK_SPEED,
            },
        )
        .expect("tick");
        let sessions = store.sessions.lock().expect("lock");
        let state = &sessions[&session_id].state;
        let now = state.time_sec;
        if tracing_from.is_none()
            && ["red", "blue"].iter().any(|t| alive_towers(state, t) == 0)
        {
            tracing_from = Some(now);
            println!("first team with every enemy tower down at {:.1} min (towers left blue {} red {})", now / 60.0, alive_towers(state, "blue"), alive_towers(state, "red"));
        }
        if alive_before.is_empty() {
            alive_before = state.champions.iter().map(|c| c.alive).collect();
        }
        if tracing_from.is_some() {
            for (i, c) in state.champions.iter().enumerate() {
                if alive_before[i] && !c.alive {
                    println!("  t={now:.0} {}{} dies", &c.team[..1], c.role);
                }
            }
        }
        alive_before = state.champions.iter().map(|c| c.alive).collect();
        if tracing_from.is_some() && now >= next_print {
            next_print = now + every;
            let structure = |id: &str| {
                state.structures.iter().find(|s| s.id == id).map_or("?".to_string(), |s| {
                    if s.alive { format!("{:.0}", s.hp) } else { "x".to_string() }
                })
            };
            let line: Vec<String> = state
                .champions
                .iter()
                .map(|c| {
                    if c.alive {
                        format!(
                            "{}{} {} {:.0}% @{:.2},{:.2}{}",
                            &c.team[..1],
                            c.role,
                            c.state,
                            c.hp / c.max_hp.max(1.0) * 100.0,
                            c.pos.x,
                            c.pos.y,
                            if c.push.is_some() { " P" } else { "" }
                        )
                    } else {
                        format!("{}{} dead({:.0}s)", &c.team[..1], c.role, c.respawn_at - now)
                    }
                })
                .collect();
            println!(
                "t={now:.0} nexus b {} r {} | inhibs b {}/{}/{} r {}/{}/{} | nexus towers b {}/{} r {}/{} | plan b {} r {}\n    {}",
                structure("blue-nexus"), structure("red-nexus"),
                structure("blue-inhib-top"), structure("blue-inhib-mid"), structure("blue-inhib-bot"),
                structure("red-inhib-top"), structure("red-inhib-mid"), structure("red-inhib-bot"),
                structure("blue-nexus-top-tower"), structure("blue-nexus-bot-tower"),
                structure("red-nexus-top-tower"), structure("red-nexus-bot-tower"),
                state.team_push[0].active, state.team_push[1].active,
                line.join("; ")
            );
        }
        if state.winner.is_some() || now >= GAME_LIMIT_SEC {
            println!("winner {:?} at {:.1} min", state.winner, now / 60.0);
            break;
        }
    }
}

/// Plays one seed of a captured start to `CAPTURED_PROBE_AT` seconds and prints, for each
/// champion, the combat target and whether it is in reach.
#[test]
#[ignore = "measurement: prints the combat target of every champion at one moment of a captured-start match"]
fn probe_captured_targets() {
    let path = std::env::var("CAPTURED_INIT").expect("CAPTURED_INIT");
    let template = load_captured_request(&path).unwrap_or_else(|e| panic!("{e}"));
    let n: usize = env_or("CAPTURED_TRACE_SEED", 0);
    let at: f64 = env_or("CAPTURED_PROBE_AT", 1800.0);
    let mut request = template.clone();
    request.session_id = format!("captured-replay-{n}");
    request.seed = format!("{}-{n}", template.seed);
    let session_id = request.session_id.clone();
    let store = SimLiveStoreState::default();
    init(&store, request).expect("init");
    loop {
        tick(
            &store,
            SimLiveTickRequest {
                session_id: session_id.clone(),
                dt_sec: DEFAULT_TICK_DT_SEC,
                running: true,
                speed: DEFAULT_TICK_SPEED,
            },
        )
        .expect("tick");
        let sessions = store.sessions.lock().expect("lock");
        let state = &sessions[&session_id].state;
        if state.time_sec < at && state.winner.is_none() {
            continue;
        }
        let timers = decode_neutral_timers_state(&state.neutral_timers)
            .unwrap_or_else(neutral_timers_default_runtime_state);
        println!("t={:.0} winner {:?}", state.time_sec, state.winner);
        for (idx, c) in state.champions.iter().enumerate() {
            if !c.alive {
                println!("{}{} dead", &c.team[..1], c.role);
                continue;
            }
            let target = combat::pick_combat_target(state, idx, state.time_sec, &timers);
            let what = match &target {
                Some(CombatTarget::Champion(e)) => {
                    let enemy = &state.champions[*e];
                    format!("champion {}{} d{:.3} range {:.3} hp {:.0}%", &enemy.team[..1], enemy.role, dist(c.pos, enemy.pos), c.attack_range, enemy.hp / enemy.max_hp * 100.0)
                }
                Some(CombatTarget::Minion(m)) => format!("minion d{:.3}", dist(c.pos, state.minions[*m].pos)),
                Some(CombatTarget::Structure(s)) => format!("structure {}", state.structures[*s].id),
                Some(CombatTarget::Neutral(k)) => format!("neutral {k}"),
                None => "none".to_string(),
            };
            println!(
                "{}{} {} {:.0}% @{:.2},{:.2} cd {:.1} -> {what}",
                &c.team[..1], c.role, c.state, c.hp / c.max_hp.max(1.0) * 100.0, c.pos.x, c.pos.y, c.attack_cd_until - state.time_sec
            );
        }
        break;
    }
}

/// Plays one seed of a captured start and prints each moment an idle contact, a free recall or
/// a base ignore is counted, with what the champions involved were doing and the combat target
/// the engine picks for each of them.
///
/// ```text
/// CAPTURED_INIT=init-1.json CAPTURED_TRACE_SEED=3 CAPTURED_TRACE_KIND=idle cargo test --release \
///   -p olm_core --lib sim_live::captured_replay_harness_tests::trace_captured_contacts \
///   -- --ignored --nocapture
/// ```
/// `CAPTURED_TRACE_KIND` is `idle`, `recall` or `base`; `CAPTURED_TRACE_MAX` caps the lines.
#[test]
#[ignore = "measurement: traces the idle contacts, free recalls and base ignores of one captured-start match"]
fn trace_captured_contacts() {
    let path = std::env::var("CAPTURED_INIT").expect("CAPTURED_INIT");
    let template = load_captured_request(&path).unwrap_or_else(|e| panic!("{e}"));
    let n: usize = env_or("CAPTURED_TRACE_SEED", 0);
    let kind: String = env_or("CAPTURED_TRACE_KIND", "idle".to_string());
    let max_lines: usize = env_or("CAPTURED_TRACE_MAX", 40);
    // Only episodes whose kind contains this text (the kinds the replay prints).
    let filter: String = env_or("CAPTURED_TRACE_FILTER", String::new());
    let mut request = template.clone();
    request.session_id = format!("captured-replay-{n}");
    request.seed = format!("{}-{n}", template.seed);
    let session_id = request.session_id.clone();
    let store = SimLiveStoreState::default();
    init(&store, request).expect("init");
    let mut observer = ContactObserver::new();
    let mut printed = 0;
    let matching = |kinds: &BTreeMap<String, u32>| -> u32 {
        kinds.iter().filter(|(k, _)| k.contains(filter.as_str())).map(|(_, n)| *n).sum()
    };
    let (mut idle_match, mut base_match) = (0, 0);
    loop {
        tick(
            &store,
            SimLiveTickRequest {
                session_id: session_id.clone(),
                dt_sec: DEFAULT_TICK_DT_SEC,
                running: true,
                speed: DEFAULT_TICK_SPEED,
            },
        )
        .expect("tick");
        let sessions = store.sessions.lock().expect("lock");
        let state = &sessions[&session_id].state;
        observer.observe(state);
        let stats = &observer.stats;
        let fresh = match kind.as_str() {
            "recall" => observer.just_free,
            "base" => matching(&stats.base_kinds) != base_match,
            _ => matching(&stats.idle_kinds) != idle_match,
        };
        (idle_match, base_match) = (matching(&stats.idle_kinds), matching(&stats.base_kinds));
        if fresh && printed < max_lines {
            printed += 1;
            let timers = decode_neutral_timers_state(&state.neutral_timers)
                .unwrap_or_else(neutral_timers_default_runtime_state);
            println!("--- t={:.0} ({kind})", state.time_sec);
            for (idx, c) in state.champions.iter().enumerate() {
                if !c.alive {
                    continue;
                }
                let others_close = state
                    .champions
                    .iter()
                    .any(|o| o.id != c.id && o.alive && dist(o.pos, c.pos) <= 0.3);
                if !others_close {
                    continue;
                }
                let target = combat::pick_combat_target(state, idx, state.time_sec, &timers);
                let what = match &target {
                    Some(CombatTarget::Champion(e)) => {
                        let enemy = &state.champions[*e];
                        format!("champion {}{} d{:.3}", &enemy.team[..1], enemy.role, dist(c.pos, enemy.pos))
                    }
                    Some(CombatTarget::Minion(m)) => format!("minion d{:.3}", dist(c.pos, state.minions[*m].pos)),
                    Some(CombatTarget::Structure(s)) => format!("structure {}", state.structures[*s].id),
                    Some(CombatTarget::Neutral(k)) => format!("neutral {k}"),
                    None => "none".to_string(),
                };
                println!(
                    "  {}{} {} {:.0}% @{:.3},{:.3} range {:.3} cd {:.1} next {:.1} lastdmg {:.1} by {:?} push {} -> {what}",
                    &c.team[..1], c.role, c.state, c.hp / c.max_hp.max(1.0) * 100.0, c.pos.x, c.pos.y,
                    c.attack_range, c.attack_cd_until - state.time_sec, c.next_decision_at - state.time_sec,
                    state.time_sec - c.last_damaged_at, c.last_damaged_by_champion_id.as_deref().unwrap_or("-"),
                    c.push.is_some(),
                );
            }
        }
        if state.winner.is_some() || state.time_sec >= GAME_LIMIT_SEC || printed >= max_lines {
            break;
        }
    }
}

/// Plays one seed of a captured start and prints, every step between `CAPTURED_FOLLOW_FROM` and
/// `CAPTURED_FOLLOW_TO` game seconds, where the champions named in `CAPTURED_FOLLOW` (for example
/// `rSUP,bSUP`) are, what they do, the end of their path and the combat target the engine picks.
#[test]
#[ignore = "measurement: follows named champions of one captured-start match step by step"]
fn follow_captured_champions() {
    let path = std::env::var("CAPTURED_INIT").expect("CAPTURED_INIT");
    let template = load_captured_request(&path).unwrap_or_else(|e| panic!("{e}"));
    let n: usize = env_or("CAPTURED_TRACE_SEED", 0);
    let from: f64 = env_or("CAPTURED_FOLLOW_FROM", 0.0);
    let to: f64 = env_or("CAPTURED_FOLLOW_TO", 60.0);
    let names: String = env_or("CAPTURED_FOLLOW", "bTOP".to_string());
    let mut request = template.clone();
    request.session_id = format!("captured-replay-{n}");
    request.seed = format!("{}-{n}", template.seed);
    let session_id = request.session_id.clone();
    let store = SimLiveStoreState::default();
    init(&store, request).expect("init");
    loop {
        tick(
            &store,
            SimLiveTickRequest {
                session_id: session_id.clone(),
                dt_sec: DEFAULT_TICK_DT_SEC,
                running: true,
                speed: DEFAULT_TICK_SPEED,
            },
        )
        .expect("tick");
        let sessions = store.sessions.lock().expect("lock");
        let state = &sessions[&session_id].state;
        let now = state.time_sec;
        if now < from {
            continue;
        }
        if now > to || state.winner.is_some() {
            break;
        }
        let timers = decode_neutral_timers_state(&state.neutral_timers)
            .unwrap_or_else(neutral_timers_default_runtime_state);
        for (idx, c) in state.champions.iter().enumerate() {
            if !names.split(',').any(|name| name == format!("{}{}", &c.team[..1], c.role)) {
                continue;
            }
            let target = combat::pick_combat_target(state, idx, now, &timers);
            let what = match &target {
                Some(CombatTarget::Champion(e)) => {
                    let enemy = &state.champions[*e];
                    format!("champion {}{} d{:.3} ({})", &enemy.team[..1], enemy.role, dist(c.pos, enemy.pos), enemy.state)
                }
                Some(CombatTarget::Minion(m)) => format!("minion d{:.3}", dist(c.pos, state.minions[*m].pos)),
                Some(CombatTarget::Structure(s)) => format!("structure {}", state.structures[*s].id),
                Some(CombatTarget::Neutral(k)) => format!("neutral {k}"),
                None => "none".to_string(),
            };
            let end = c.target_path.iter().map(|p| format!("{:.3},{:.3}", p.x, p.y)).collect::<Vec<_>>().join(">")
                + &format!("#{}", c.target_path_index);
            let order = c.push.as_ref().map_or("-".to_string(), |o| {
                format!("{}@{:.3},{:.3}{}", o.structure_id, o.structure_pos.x, o.structure_pos.y,
                    o.rally.map_or(String::new(), |r| format!(" rally {:.3},{:.3}", r.x, r.y)))
            });
            let anchor = c.recall_anchor.map_or("-".to_string(), |a| format!("{:.4},{:.4} d{:.4}", a.x, a.y, dist(c.pos, a)));
            println!(
                "t={now:.1} {}{} {} {} {:.0}% @{:.4},{:.4} path->{end} cd {:.1} chan {:.1} anchor {anchor} stuck {:.1} order {order} -> {what}",
                &c.team[..1], c.role, if c.alive { "alive" } else { "dead" }, c.state,
                c.hp / c.max_hp.max(1.0) * 100.0, c.pos.x, c.pos.y,
                c.attack_cd_until - now, c.recall_channel_until - now, c.path_stuck_for_sec,
            );
        }
    }
}
