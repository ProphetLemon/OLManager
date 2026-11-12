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

use std::collections::BTreeMap;

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
            println!(
                "seed {} winner {} minutes {:.1} kills {} towers left blue {} red {} all-towers blue {} red {}",
                p.seed,
                p.winner.as_deref().unwrap_or("none"),
                p.minutes,
                p.kills,
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
    println!(
        "lost with a lead of 20 or more kills {} of {} decided",
        decided.iter().filter(|(winner, loser)| loser - winner >= 20).count(),
        decided.len()
    );
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
