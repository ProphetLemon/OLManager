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
/// Seconds without champion damage between a pair after which the next hit starts a new trade.
const TRADE_GAP_SEC: f64 = 5.0;

/// Game seconds that split the jungler's deaths into before 10:00, 10:00 to 20:00 and after.
const JUNGLE_PHASE_EDGES_SEC: [f64; 2] = [600.0, 1200.0];
/// Radius for counting the champions around a jungler who died (the engine's trade radius).
const GANK_CONTACT_RADIUS: f64 = LANE_CHAMPION_TRADE_RADIUS;
/// A gank episode is a stretch in which the end of the jungler's path is an enemy champion (the
/// engine's gank target, or a chase); it ends once the path has pointed elsewhere for this long.
const GANK_GAP_SEC: f64 = 8.0;
/// How near a path's end must be to a camp, a pit or a champion to count as going to it.
const DESTINATION_RADIUS: f64 = 0.06;
/// A kill of an enemy this close to the jungler, while the episode lasts, is a kill by the gank.
const GANK_KILL_RADIUS: f64 = 0.25;
/// Distance from a camp or a pit that places a jungler death or an invade there.
const JUNGLE_PLACE_RADIUS: f64 = 0.10;
const PIT_PLACE_RADIUS: f64 = OBJECTIVE_ATTEMPT_RADIUS;
/// An invade starts when the jungler is within `JUNGLE_CAMP_ENGAGE_RADIUS` of an enemy-side camp
/// and is over once he has stayed beyond `INVADE_LEAVE_RADIUS` for `INVADE_REARM_SEC`.
const INVADE_LEAVE_RADIUS: f64 = 0.15;
const INVADE_REARM_SEC: f64 = 15.0;
/// Invades that start before this game second are early invades.
const EARLY_INVADE_SEC: f64 = 240.0;

/// What the observer counted about the two junglers in one match (the sums of both).
#[derive(Debug, Clone, Default)]
struct JungleStats {
    kills: i64,
    deaths: i64,
    assists: i64,
    /// Deaths before 10:00, from 10:00 to 20:00, and after.
    deaths_by_phase: [u32; 3],
    /// Deaths by where the jungler stood (tower, scuttle, objective_pit, enemy_jungle,
    /// own_jungle, lane_gank, open), by phase, with how many of them were outnumbered.
    death_places: BTreeMap<&'static str, ([u32; 3], u32)>,
    /// Deaths that also meet a condition that overlaps the places: outnumbered, died inside an
    /// enemy tower's reach, died during a gank episode.
    death_flags: BTreeMap<&'static str, u32>,
    /// Seconds the end of the jungler's path pointed at each kind of place, by phase.
    destination_secs: BTreeMap<&'static str, [f64; 3]>,
    /// Deaths by where his path pointed in the step before (what he was walking to).
    death_destinations: BTreeMap<&'static str, u32>,
    /// Recalls started (by trigger and whether an enemy was near), recalls that reached the base,
    /// and the deaths while recalling: by trigger, enemy near at the start, channel running.
    recall_starts: BTreeMap<String, u32>,
    recalls_completed: u32,
    recall_deaths: BTreeMap<String, u32>,
    /// Where the jungler stood when he died while recalling.
    recall_death_places: BTreeMap<&'static str, u32>,
    /// Pit deaths by the objective the pit belongs to.
    pit_deaths: BTreeMap<String, u32>,
    /// Deaths by the jungler's state at the moment he died.
    death_states: BTreeMap<String, u32>,
    /// Deaths by what killed him: tower, minion, or the role of the enemy champion.
    death_killers: BTreeMap<String, u32>,
    /// Gank episodes by the jungler's state when the episode started and the phase, those in
    /// which an enemy near the jungler died to his team, and those in which the jungler died.
    gank_attempts: BTreeMap<String, [u32; 3]>,
    gank_hits: BTreeMap<String, [u32; 3]>,
    gank_deaths: BTreeMap<String, [u32; 3]>,
    /// Times he came within `JUNGLE_CAMP_ENGAGE_RADIUS` of an enemy-side camp, those before
    /// `EARLY_INVADE_SEC`, enemy-side camps he cleared, and those cleared before that second.
    invades: u32,
    early_invades: u32,
    invade_camps_cleared: u32,
    early_camps_cleared: u32,
}

/// One jungler as the observer follows him.
#[derive(Debug, Clone, Default)]
struct JungleTrack {
    was_alive: bool,
    gank_active: bool,
    gank_last_contact: f64,
    gank_hit: bool,
    /// The jungler's state and the phase when the open episode started.
    gank_start: (String, usize),
    /// When he was last in the recall state.
    last_recall_at: f64,
    invading: bool,
    invade_out_since: f64,
    /// Where his path pointed in the last step he was alive.
    last_destination: &'static str,
    /// His state and whether a recall channel was running in the last step he was alive.
    last_state: String,
    last_channeling: bool,
    /// How the open recall started: his health was at or under the recall trigger ("low_hp") or
    /// not ("item_or_other"), and whether an enemy champion stood in the trade radius then.
    recall_trigger: &'static str,
    recall_enemy_near: bool,
}

/// The fixed map facts and the per-jungler tracks the jungle counters need.
struct JungleWatch {
    /// Jungle camp keys with their positions (scuttle crabs are left out: they have no side).
    camps: Vec<(String, Vec2)>,
    pits: Vec<(String, Vec2)>,
    tracks: Vec<JungleTrack>,
}

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
    /// Voidgrubs that expired with health left: (stacks before, stacks gained) for blue and red.
    grub_expiries: Vec<GrubExpiry>,
    /// Rift Heralds deployed: whether the carrier was the jungler, and the lane of the summon.
    herald_deploys: Vec<(bool, String)>,
    /// Rift Heralds secured, and seconds from each one secured to its deployment.
    herald_secured: u32,
    herald_waits: Vec<f64>,
    /// Trades started (first champion damage between a pair after `TRADE_GAP_SEC` without any),
    /// and those started with the attacker inside the reach of an enemy tower.
    trade_starts: u32,
    trade_starts_in_tower_reach: u32,
    /// What the two junglers did and how they died.
    jungle: JungleStats,
}

/// Stacks of both sides when the unclaimed Voidgrubs expired, and what each side gained.
#[derive(Debug, Clone, Copy)]
struct GrubExpiry {
    before: [i64; 2],
    gained: [i64; 2],
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
    /// Voidgrub stacks (blue, red) and the Herald's carrier id as the previous step left them.
    previous_grub_stacks: [i64; 2],
    previous_herald_carrier: Option<String>,
    herald_secured_at: Option<f64>,
    herald_minions_seen: usize,
    /// Per pair of champions: damage each dealt the other so far, and when damage last passed.
    trade_watch: HashMap<(usize, usize), ([f64; 2], f64)>,
    jungle: Option<JungleWatch>,
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
            previous_grub_stacks: [0, 0],
            previous_herald_carrier: None,
            herald_secured_at: None,
            herald_minions_seen: 0,
            trade_watch: HashMap::new(),
            jungle: None,
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
        self.observe_audit(state);
        self.observe_jungle(state);
        self.previous = state
            .champions
            .iter()
            .map(|c| PreviousChampion { pos: c.pos, hp: c.hp, last_damaged_at: c.last_damaged_at })
            .collect();
        self.previous_time = now;
    }

    /// Counts the three things the sim audit fixes: the Voidgrub stacks handed out at expiry, the
    /// lane and carrier of each Herald, and the trades started inside an enemy tower's reach.
    fn observe_audit(&mut self, state: &RuntimeState) {
        let now = state.time_sec;
        let buffs = runtime_buffs_from_extra(state.extra.get("teamBuffs"));
        let stacks = [buffs.blue.voidgrub_stacks, buffs.red.voidgrub_stacks];
        let role_of = |id: &str| state.champions.iter().find(|c| c.id == id).map(|c| c.role.as_str());

        for event in state.events.iter().rev().take_while(|event| event.t > self.previous_time) {
            match event.code {
                Some(EventCode::NeutralDespawned)
                    if event.data.objective.as_deref() == Some("voidgrubs") =>
                {
                    self.stats.grub_expiries.push(GrubExpiry {
                        before: self.previous_grub_stacks,
                        gained: [
                            stacks[0] - self.previous_grub_stacks[0],
                            stacks[1] - self.previous_grub_stacks[1],
                        ],
                    });
                }
                Some(EventCode::HeraldSecured) => {
                    self.stats.herald_secured += 1;
                    self.herald_secured_at = Some(event.t);
                }
                Some(EventCode::HeraldDeployed) => {
                    let jungler = self
                        .previous_herald_carrier
                        .as_deref()
                        .and_then(role_of)
                        .is_some_and(|role| role == "JGL");
                    let lane = state
                        .minions
                        .iter()
                        .filter(|m| m.id.starts_with("herald-"))
                        .nth(self.herald_minions_seen)
                        .map_or("?".to_string(), |m| m.lane.clone());
                    self.stats.herald_deploys.push((jungler, lane));
                    if let Some(at) = self.herald_secured_at.take() {
                        self.stats.herald_waits.push(event.t - at);
                    }
                }
                _ => {}
            }
        }
        self.herald_minions_seen = state.minions.iter().filter(|m| m.id.starts_with("herald-")).count();
        self.previous_grub_stacks = stacks;
        self.previous_herald_carrier = state
            .extra
            .get("heraldCarrierId")
            .and_then(Value::as_str)
            .map(str::to_string);

        let ledger = state.farm_ledger.damage_by_attacker_role();
        for a in 0..state.champions.len() {
            for b in (a + 1)..state.champions.len() {
                let (ca, cb) = (&state.champions[a], &state.champions[b]);
                if normalized_team(&ca.team) == normalized_team(&cb.team) {
                    continue;
                }
                let totals = [
                    ledger.get(&(ca.id.clone(), cb.role.clone())).copied().unwrap_or(0.0),
                    ledger.get(&(cb.id.clone(), ca.role.clone())).copied().unwrap_or(0.0),
                ];
                let entry = self.trade_watch.entry((a, b)).or_insert((totals, f64::NEG_INFINITY));
                let dealt = [totals[0] - entry.0[0], totals[1] - entry.0[1]];
                entry.0 = totals;
                if dealt[0] <= 1e-9 && dealt[1] <= 1e-9 {
                    continue;
                }
                let started = now - entry.1 >= TRADE_GAP_SEC;
                entry.1 = now;
                if !started {
                    continue;
                }
                let attacker = if dealt[0] >= dealt[1] { ca } else { cb };
                let in_reach = state.structures.iter().any(|tower| {
                    tower.alive
                        && tower.kind == "tower"
                        && normalized_team(&tower.team) != normalized_team(&attacker.team)
                        && dist(tower.pos, attacker.pos) <= TOWER_ATTACK_RANGE
                });
                self.stats.trade_starts += 1;
                self.stats.trade_starts_in_tower_reach += u32::from(in_reach);
            }
        }
    }

    /// Counts the jungler's deaths (when, where, by what), his gank episodes and his invades.
    fn observe_jungle(&mut self, state: &RuntimeState) {
        let now = state.time_sec;
        let mut watch = self.jungle.take().unwrap_or_else(|| {
            let timers = decode_neutral_timers_state(&state.neutral_timers);
            let entities = timers.iter().flat_map(|t| t.entities.values());
            JungleWatch {
                camps: entities
                    .clone()
                    .filter(|t| macro_ai::is_jungle_camp_key(&t.key) && !macro_ai::is_objective_neutral_key(&t.key))
                    .map(|t| (t.key.clone(), t.pos))
                    .collect(),
                pits: entities
                    .filter(|t| macro_ai::is_objective_neutral_key(&t.key))
                    .map(|t| (t.key.clone(), t.pos))
                    .collect(),
                tracks: state
                    .champions
                    .iter()
                    .map(|_| JungleTrack { was_alive: true, last_recall_at: f64::NEG_INFINITY, ..JungleTrack::default() })
                    .collect(),
            }
        });
        let previous_time = self.previous_time;
        let fresh: Vec<&RuntimeEvent> =
            state.events.iter().rev().take_while(|event| event.t > previous_time).collect();
        let stats = &mut self.stats.jungle;
        for (idx, jungler) in state.champions.iter().enumerate().filter(|(_, c)| c.role == "JGL") {
            let team = normalized_team(&jungler.team);
            let own_suffix = if team == "blue" { "-blue" } else { "-red" };
            let side_camp = |key: &str| key.ends_with("-blue") || key.ends_with("-red");
            let track = &mut watch.tracks[idx];
            let recalling = jungler.state == "recall";
            if recalling && jungler.alive {
                track.last_recall_at = now;
            }
            let was_recalling = track.last_state == "recall";
            let enemy_in_reach = |pos: Vec2| {
                state.champions.iter().any(|c| c.alive && normalized_team(&c.team) != team && dist(c.pos, pos) <= GANK_CONTACT_RADIUS)
            };
            if jungler.alive && recalling && !was_recalling {
                track.recall_trigger = if jungler.hp <= jungler.max_hp * RECALL_TRIGGER_HP_RATIO { "low_hp" } else { "item_or_other" };
                track.recall_enemy_near = enemy_in_reach(jungler.pos);
                let key = format!("{}, {}", track.recall_trigger, if track.recall_enemy_near { "enemy near" } else { "no enemy near" });
                *stats.recall_starts.entry(key).or_default() += 1;
            }
            if jungler.alive && was_recalling && !recalling && dist(jungler.pos, base_position_for(&jungler.team)) <= FOUNTAIN_RADIUS {
                stats.recalls_completed += 1;
            }

            // Invades: standing at a camp on the enemy side of the jungle.
            if jungler.alive && !recalling {
                let nearest = watch
                    .camps
                    .iter()
                    .filter(|(key, _)| side_camp(key) && !key.ends_with(own_suffix))
                    .map(|(_, pos)| dist(jungler.pos, *pos))
                    .fold(f64::INFINITY, f64::min);
                if !track.invading && nearest <= JUNGLE_CAMP_ENGAGE_RADIUS {
                    track.invading = true;
                    track.invade_out_since = 0.0;
                    stats.invades += 1;
                    stats.early_invades += u32::from(now < EARLY_INVADE_SEC);
                } else if track.invading && nearest > INVADE_LEAVE_RADIUS {
                    if track.invade_out_since <= 0.0 {
                        track.invade_out_since = now;
                    } else if now - track.invade_out_since >= INVADE_REARM_SEC {
                        track.invading = false;
                    }
                } else {
                    track.invade_out_since = 0.0;
                }
            }
            for event in &fresh {
                if event.code == Some(EventCode::CampCleared)
                    && event.data.actor_id.as_deref() == Some(jungler.id.as_str())
                    && event.data.objective.as_deref().is_some_and(|key| side_camp(key) && !key.ends_with(own_suffix))
                {
                    stats.invade_camps_cleared += 1;
                    stats.early_camps_cleared += u32::from(now < EARLY_INVADE_SEC);
                }
            }

            // Where the jungler is going, by the end of his path, and gank episodes.
            let phase_now = JUNGLE_PHASE_EDGES_SEC.iter().filter(|edge| now >= **edge).count();
            let step = (now - previous_time).max(0.0);
            let toward = |pos: Vec2| jungler.target_path.last().is_some_and(|end| dist(*end, pos) <= DESTINATION_RADIUS);
            let destination = if !jungler.alive {
                "dead"
            } else if recalling {
                "recall"
            } else if jungler.target_path.is_empty() {
                "none"
            } else if watch.pits.iter().any(|(_, pos)| toward(*pos)) {
                "pit"
            } else if watch.camps.iter().any(|(key, pos)| side_camp(key) && key.ends_with(own_suffix) && toward(*pos)) {
                "own_camp"
            } else if watch.camps.iter().any(|(key, pos)| side_camp(key) && !key.ends_with(own_suffix) && toward(*pos)) {
                "enemy_camp"
            } else if state.champions.iter().any(|c| c.alive && normalized_team(&c.team) != team && toward(c.pos)) {
                "enemy_champion"
            } else if state.champions.iter().any(|c| {
                c.alive && c.id != jungler.id && normalized_team(&c.team) == team && toward(c.pos)
            }) {
                "ally_champion"
            } else if toward(base_position_for(&jungler.team)) {
                "base"
            } else {
                "other"
            };
            stats.destination_secs.entry(destination).or_default()[phase_now] += step;
            let walking_to = track.last_destination;
            if jungler.alive {
                track.last_destination = destination;
            }
            // A gank is a path that ends at an enemy laner (the junglers are left out: a chase of
            // the enemy jungler is not a gank).
            let contact = jungler.alive
                && !jungler.target_path.is_empty()
                && state.champions.iter().any(|c| c.alive && c.role != "JGL" && normalized_team(&c.team) != team && toward(c.pos));
            if contact {
                if !track.gank_active {
                    track.gank_active = true;
                    track.gank_hit = false;
                    track.gank_start = (jungler.state.clone(), phase_now);
                    stats.gank_attempts.entry(jungler.state.clone()).or_default()[phase_now] += 1;
                }
                track.gank_last_contact = now;
            }
            if track.gank_active && !track.gank_hit {
                let scored = fresh.iter().any(|event| {
                    event.code == Some(EventCode::ChampionKilled)
                        && state.champions.iter().any(|victim| {
                            event.data.target_id.as_deref() == Some(victim.id.as_str())
                                && normalized_team(&victim.team) != team
                                && dist(victim.pos, jungler.pos) <= GANK_KILL_RADIUS
                        })
                        && state.champions.iter().any(|killer| {
                            event.data.actor_id.as_deref() == Some(killer.id.as_str())
                                && normalized_team(&killer.team) == team
                        })
                });
                if scored {
                    track.gank_hit = true;
                    stats.gank_hits.entry(track.gank_start.0.clone()).or_default()[track.gank_start.1] += 1;
                }
            }
            let in_gank = track.gank_active;
            if track.gank_active && !contact && now - track.gank_last_contact > GANK_GAP_SEC {
                track.gank_active = false;
            }

            // Deaths: where, when, by what.
            if track.was_alive && !jungler.alive {
                let by_tower = state
                    .tower_ledger
                    .shots()
                    .iter()
                    .any(|shot| shot.killed && matches!(shot.victim, TowerVictim::Champion(victim) if victim == idx));
                let credited = fresh.iter().find(|event| {
                    matches!(event.code, Some(EventCode::ChampionKilled | EventCode::IgniteKill))
                        && event.data.target_id.as_deref() == Some(jungler.id.as_str())
                });
                let killer = if by_tower {
                    "tower".to_string()
                } else {
                    match credited {
                        Some(event) => match event.data.cause.as_deref() {
                            Some(cause) => cause.to_string(),
                            None => state
                                .champions
                                .iter()
                                .find(|c| event.data.actor_id.as_deref() == Some(c.id.as_str()))
                                .map_or("unknown".to_string(), |c| format!("enemy {}", c.role)),
                        },
                        None => "uncredited".to_string(),
                    }
                };
                let near = |pos: Vec2, radius: f64| dist(jungler.pos, pos) <= radius;
                let enemies = state
                    .champions
                    .iter()
                    .filter(|c| c.alive && normalized_team(&c.team) != team && near(c.pos, GANK_CONTACT_RADIUS))
                    .count();
                let allies = 1 + state
                    .champions
                    .iter()
                    .filter(|c| {
                        c.alive && c.id != jungler.id && normalized_team(&c.team) == team && near(c.pos, GANK_CONTACT_RADIUS)
                    })
                    .count();
                let laner_near = state.champions.iter().any(|c| {
                    c.alive && c.role != "JGL" && normalized_team(&c.team) != team && near(c.pos, GANK_CONTACT_RADIUS)
                });
                let outnumbered = enemies >= 2 && enemies > allies;
                let pit_key = watch
                    .pits
                    .iter()
                    .filter(|(_, pos)| near(*pos, PIT_PLACE_RADIUS))
                    .min_by(|a, b| dist(jungler.pos, a.1).total_cmp(&dist(jungler.pos, b.1)))
                    .map(|(key, _)| key.as_str());
                let place = if killer == "tower" {
                    "tower"
                } else if pit_key.is_some_and(|key| key.starts_with("scuttle")) {
                    "scuttle"
                } else if pit_key.is_some() {
                    "objective_pit"
                } else if watch
                    .camps
                    .iter()
                    .any(|(key, pos)| side_camp(key) && !key.ends_with(own_suffix) && near(*pos, JUNGLE_PLACE_RADIUS))
                {
                    "enemy_jungle"
                } else if watch.camps.iter().any(|(key, pos)| key.ends_with(own_suffix) && near(*pos, JUNGLE_PLACE_RADIUS)) {
                    "own_jungle"
                } else if laner_near {
                    "lane_gank"
                } else {
                    "open"
                };
                if place == "objective_pit"
                    && let Some(key) = pit_key
                {
                    *stats.pit_deaths.entry(key.to_string()).or_default() += 1;
                }
                let phase = phase_now;
                stats.deaths_by_phase[phase] += 1;
                let entry = stats.death_places.entry(place).or_default();
                entry.0[phase] += 1;
                entry.1 += u32::from(outnumbered);
                if outnumbered {
                    *stats.death_flags.entry("outnumbered").or_default() += 1;
                }
                if state.structures.iter().any(|tower| {
                    tower.alive
                        && tower.kind == "tower"
                        && normalized_team(&tower.team) != team
                        && near(tower.pos, TOWER_ATTACK_RANGE)
                }) {
                    *stats.death_flags.entry("in_enemy_tower_reach").or_default() += 1;
                }
                if in_gank {
                    *stats.death_flags.entry("during_gank_episode").or_default() += 1;
                    stats.gank_deaths.entry(track.gank_start.0.clone()).or_default()[track.gank_start.1] += 1;
                }
                if now - track.last_recall_at <= 10.0 {
                    *stats.death_flags.entry("within_10s_of_recall").or_default() += 1;
                }
                *stats.death_destinations.entry(walking_to).or_default() += 1;
                if was_recalling {
                    let key = format!(
                        "{}, {}, {}",
                        track.recall_trigger,
                        if track.recall_enemy_near { "enemy near at start" } else { "no enemy near at start" },
                        if track.last_channeling { "channeling" } else { "walking to the anchor" }
                    );
                    *stats.recall_deaths.entry(key).or_default() += 1;
                    *stats.recall_death_places.entry(place).or_default() += 1;
                }
                *stats.death_states.entry(jungler.state.clone()).or_default() += 1;
                *stats.death_killers.entry(killer).or_default() += 1;
                track.gank_active = false;
                track.invading = false;
            }
            track.was_alive = jungler.alive;
            if jungler.alive {
                track.last_state.clone_from(&jungler.state);
                track.last_channeling = jungler.recall_channel_until > now;
            }
        }
        self.jungle = Some(watch);
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
    /// Champion deaths in the match, from every cause.
    deaths: i64,
    /// Deaths a tower dealt the last shot of.
    tower_deaths: u32,
    /// Of those, deaths with no minion of the victim's team in the tower's reach: a dive
    /// without a wave to take the shots.
    tower_deaths_bare: u32,
    /// Of the bare ones, deaths of a champion with a push order, and of a champion with
    /// three or more allied champions near the tower.
    bare_pushing: u32,
    bare_grouped: u32,
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
    let (mut tower_deaths, mut tower_deaths_bare) = (0_u32, 0_u32);
    let (mut bare_pushing, mut bare_grouped) = (0_u32, 0_u32);
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
        // One call runs exactly one engine step at the default dt and speed, and the ledger
        // keeps the shots of the last step, so no kill is missed or counted twice.
        for shot in state.tower_ledger.shots().iter().filter(|shot| shot.killed) {
            if let TowerVictim::Champion(victim) = shot.victim {
                let team = normalized_team(&state.champions[victim].team);
                let origin = symmetric_structure_pos(&state.structures[shot.structure_idx]);
                tower_deaths += 1;
                let covered = state.minions.iter().any(|minion| {
                    minion.alive
                        && normalized_team(&minion.team) == team
                        && dist(minion.pos, origin) <= TOWER_ATTACK_RANGE
                });
                if !covered {
                    tower_deaths_bare += 1;
                    let victim = &state.champions[victim];
                    if victim.push.is_some() {
                        bare_pushing += 1;
                    }
                    let near = state
                        .champions
                        .iter()
                        .filter(|ally| {
                            ally.alive
                                && ally.id != victim.id
                                && normalized_team(&ally.team) == team
                                && dist(ally.pos, origin) <= TOWER_ATTACK_RANGE + 0.06
                        })
                        .count();
                    if near >= 3 {
                        bare_grouped += 1;
                    }
                }
            }
        }
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
    observer.stats.jungle.kills = state.champions.iter().filter(|c| c.role == "JGL").map(|c| c.kills).sum();
    observer.stats.jungle.deaths = state.champions.iter().filter(|c| c.role == "JGL").map(|c| c.deaths).sum();
    observer.stats.jungle.assists = state.champions.iter().filter(|c| c.role == "JGL").map(|c| c.assists).sum();
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
        deaths: state.champions.iter().map(|c| c.deaths).sum(),
        tower_deaths,
        tower_deaths_bare,
        bare_pushing,
        bare_grouped,
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

    let deaths: i64 = played.iter().map(|p| p.deaths).sum();
    let tower_deaths: u32 = played.iter().map(|p| p.tower_deaths).sum();
    let tower_deaths_bare: u32 = played.iter().map(|p| p.tower_deaths_bare).sum();
    println!(
        "deaths to towers {tower_deaths} of {deaths} ({:.1}%), of them without an allied minion in the tower's reach {tower_deaths_bare}",
        100.0 * f64::from(tower_deaths) / deaths.max(1) as f64
    );
    println!(
        "bare tower deaths: with a push order {}, with three or more allied champions near {}",
        played.iter().map(|p| p.bare_pushing).sum::<u32>(),
        played.iter().map(|p| p.bare_grouped).sum::<u32>()
    );

    let grubs: Vec<GrubExpiry> = played.iter().flat_map(|p| p.contact.grub_expiries.iter().copied()).collect();
    let ties: Vec<&GrubExpiry> = grubs.iter().filter(|g| g.before[0] == g.before[1]).collect();
    let sum = |list: &[&GrubExpiry], side: usize| list.iter().map(|g| g.gained[side]).sum::<i64>();
    let led: Vec<&GrubExpiry> = grubs.iter().filter(|g| g.before[0] != g.before[1]).collect();
    println!(
        "voidgrub expiries {} ({:.2} per match): ties {} (0-0 {}), stacks gained in ties blue {} red {}; leader cases {}, stacks gained blue {} red {}",
        grubs.len(),
        grubs.len() as f64 / matches,
        ties.len(),
        ties.iter().filter(|g| g.before == [0, 0]).count(),
        sum(&ties, 0),
        sum(&ties, 1),
        led.len(),
        sum(&led, 0),
        sum(&led, 1),
    );
    let deploys: Vec<&(bool, String)> = played.iter().flat_map(|p| p.contact.herald_deploys.iter()).collect();
    let lane_count = |jungler: bool, lane: &str| deploys.iter().filter(|(j, l)| *j == jungler && l == lane).count();
    println!(
        "heralds secured {}, deployed {} ({:.2} per match); jungler deploys {} (top {} mid {} bot {}), laner deploys {} (top {} mid {} bot {}); mean secured-to-deployed {:.1} s",
        played.iter().map(|p| p.contact.herald_secured).sum::<u32>(),
        deploys.len(),
        deploys.len() as f64 / matches,
        deploys.iter().filter(|(j, _)| *j).count(),
        lane_count(true, "top"),
        lane_count(true, "mid"),
        lane_count(true, "bot"),
        deploys.iter().filter(|(j, _)| !*j).count(),
        lane_count(false, "top"),
        lane_count(false, "mid"),
        lane_count(false, "bot"),
        mean_of(&played.iter().flat_map(|p| p.contact.herald_waits.iter().copied()).collect::<Vec<_>>()),
    );
    println!(
        "trades started {} ({:.2} per match), inside an enemy tower's reach {} ({:.1}%)",
        total(&|c| f64::from(c.trade_starts)),
        total(&|c| f64::from(c.trade_starts)) / matches,
        total(&|c| f64::from(c.trade_starts_in_tower_reach)),
        100.0 * total(&|c| f64::from(c.trade_starts_in_tower_reach)) / total(&|c| f64::from(c.trade_starts)).max(1.0),
    );


    let jungle = |f: &dyn Fn(&JungleStats) -> f64| played.iter().map(|p| f(&p.contact.jungle)).sum::<f64>();
    let jungler_matches = played.iter().map(|p| p.levels.iter().filter(|(_, role, _)| role == "JGL").count()).sum::<usize>().max(1) as f64;
    println!(
        "jungler per jungler-match ({jungler_matches} of them): kills {:.2} deaths {:.2} assists {:.2}",
        jungle(&|j| j.kills as f64) / jungler_matches,
        jungle(&|j| j.deaths as f64) / jungler_matches,
        jungle(&|j| j.assists as f64) / jungler_matches,
    );
    println!(
        "jungler deaths by phase (before 10:00, 10-20, after 20): {:.2} / {:.2} / {:.2} per jungler-match",
        jungle(&|j| f64::from(j.deaths_by_phase[0])) / jungler_matches,
        jungle(&|j| f64::from(j.deaths_by_phase[1])) / jungler_matches,
        jungle(&|j| f64::from(j.deaths_by_phase[2])) / jungler_matches,
    );
    let jungle_tally = |pick: &dyn Fn(&JungleStats) -> Vec<(String, u32)>| {
        let mut sums: BTreeMap<String, u32> = BTreeMap::new();
        for p in &played {
            for (key, n) in pick(&p.contact.jungle) {
                *sums.entry(key).or_default() += n;
            }
        }
        let mut sums: Vec<(String, u32)> = sums.into_iter().collect();
        sums.sort_by_key(|(_, n)| std::cmp::Reverse(*n));
        sums.iter().map(|(k, n)| format!("{k} {n}")).collect::<Vec<_>>().join("; ")
    };
    println!(
        "jungler deaths by place: {}",
        jungle_tally(&|j| j.death_places.iter().map(|(k, (n, _))| (k.to_string(), n.iter().sum())).collect())
    );
    for (label, phase) in [("before 10:00", 0), ("10-20", 1), ("after 20", 2)] {
        println!(
            "jungler deaths by place {label}: {}",
            jungle_tally(&|j| j.death_places.iter().map(|(k, (n, _))| (k.to_string(), n[phase])).collect())
        );
    }
    println!(
        "jungler deaths by place, outnumbered only: {}",
        jungle_tally(&|j| j.death_places.iter().map(|(k, (_, o))| (k.to_string(), *o)).collect())
    );
    println!("jungler pit deaths by objective: {}", jungle_tally(&|j| j.pit_deaths.iter().map(|(k, n)| (k.clone(), *n)).collect()));
    for (label, phase) in [("before 10:00", 0), ("10-20", 1), ("after 20", 2)] {
        let mut kinds: BTreeMap<&str, f64> = BTreeMap::new();
        for p in &played {
            for (kind, secs) in &p.contact.jungle.destination_secs {
                *kinds.entry(kind).or_default() += secs[phase];
            }
        }
        let total: f64 = kinds.values().sum::<f64>().max(1.0);
        let mut kinds: Vec<(&str, f64)> = kinds.into_iter().collect();
        kinds.sort_by(|a, b| b.1.total_cmp(&a.1));
        println!(
            "jungler path ends {label}: {}",
            kinds.iter().map(|(k, secs)| format!("{k} {:.0}%", 100.0 * secs / total)).collect::<Vec<_>>().join("; ")
        );
    }
    println!("jungler death flags: {}", jungle_tally(&|j| j.death_flags.iter().map(|(k, n)| (k.to_string(), *n)).collect()));
    println!(
        "jungler recalls started {} ({:.2} per jungler-match), reached the base {}; died while recalling {} ({:.1}% of his deaths)",
        jungle(&|j| j.recall_starts.values().sum::<u32>() as f64),
        jungle(&|j| j.recall_starts.values().sum::<u32>() as f64) / jungler_matches,
        jungle(&|j| f64::from(j.recalls_completed)),
        jungle(&|j| j.recall_deaths.values().sum::<u32>() as f64),
        100.0 * jungle(&|j| j.recall_deaths.values().sum::<u32>() as f64) / jungle(&|j| j.deaths as f64).max(1.0),
    );
    println!("jungler recalls started by trigger: {}", jungle_tally(&|j| j.recall_starts.iter().map(|(k, n)| (k.clone(), *n)).collect()));
    println!("jungler deaths while recalling: {}", jungle_tally(&|j| j.recall_deaths.iter().map(|(k, n)| (k.clone(), *n)).collect()));
    println!("jungler deaths while recalling, by place: {}", jungle_tally(&|j| j.recall_death_places.iter().map(|(k, n)| (k.to_string(), *n)).collect()));
    println!("jungler deaths by what the path pointed at: {}", jungle_tally(&|j| j.death_destinations.iter().map(|(k, n)| (k.to_string(), *n)).collect()));
    println!("jungler deaths by state: {}", jungle_tally(&|j| j.death_states.iter().map(|(k, n)| (k.clone(), *n)).collect()));
    println!("jungler deaths by killer: {}", jungle_tally(&|j| j.death_killers.iter().map(|(k, n)| (k.clone(), *n)).collect()));
    let gank_total = |pick: &dyn Fn(&JungleStats) -> &BTreeMap<String, [u32; 3]>, state: Option<&str>, phase: Option<usize>| {
        played
            .iter()
            .flat_map(|p| pick(&p.contact.jungle).iter())
            .filter(|(key, _)| state.is_none_or(|wanted| key.as_str() == wanted))
            .map(|(_, by_phase)| phase.map_or(by_phase.iter().sum::<u32>(), |i| by_phase[i]))
            .sum::<u32>()
    };
    let mut gank_states: Vec<String> = played
        .iter()
        .flat_map(|p| p.contact.jungle.gank_attempts.keys().cloned())
        .collect();
    gank_states.sort();
    gank_states.dedup();
    println!("jungler gank episodes (path ends at an enemy laner), per jungler-match {:.2}", f64::from(gank_total(&|j| &j.gank_attempts, None, None)) / jungler_matches);
    for state in &gank_states {
        for (label, phase) in [("all", None), ("before 10:00", Some(0)), ("10-20", Some(1)), ("after 20", Some(2))] {
            let (attempts, hits, deaths) = (
                gank_total(&|j| &j.gank_attempts, Some(state), phase),
                gank_total(&|j| &j.gank_hits, Some(state), phase),
                gank_total(&|j| &j.gank_deaths, Some(state), phase),
            );
            println!(
                "  started in state {state}, {label}: {attempts} episodes, with a kill {hits} ({:.1}%), jungler died {deaths} ({:.1}%)",
                100.0 * f64::from(hits) / f64::from(attempts.max(1)),
                100.0 * f64::from(deaths) / f64::from(attempts.max(1)),
            );
        }
    }
    println!(
        "jungler came near an enemy camp {} times ({:.2} per jungler-match), before 4:00 {}; enemy-side camps cleared {}, before 4:00 {}",
        jungle(&|j| f64::from(j.invades)),
        jungle(&|j| f64::from(j.invades)) / jungler_matches,
        jungle(&|j| f64::from(j.early_invades)),
        jungle(&|j| f64::from(j.invade_camps_cleared)),
        jungle(&|j| f64::from(j.early_camps_cleared)),
    );

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
