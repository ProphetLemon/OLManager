//! A live match must not play differently because of the playback speed.
//!
//! The watched match sends one `tick` per animation frame with the speed of the
//! x1 to x12 buttons. The engine runs fixed steps, so the same seed and teams
//! must give the same match whatever the speed, the frame times, the stalls and
//! the speed changes in the middle of the match.
//!
//! The reference is the x12 button with 0.05 s frames, which runs exactly one
//! step per call and therefore passes through every step of the match. Every
//! other driver lands on some of those steps; its whole state must equal the
//! reference state at the step it landed on.

use std::collections::{BTreeMap, HashMap};

use serde_json::Value;

use super::economy_fingerprint_tests::state_fingerprint;
use super::economy_tests::{Side, snapshot_with};
use super::*;

/// The step the engine is calibrated at: a 0.05 s frame at the x12 button.
const STEP_SEC: f64 = 0.05 * 12.0;
/// Longest frame the watched match sends.
const FRAME_SEC: f64 = 0.05;
/// Steps the default tests play: 500 steps are five minutes of game time.
const SHORT_STEPS: u64 = 500;
/// A stalled frame of the irregular driver, in seconds of real time.
const STALL_SEC: f64 = 2.0;
/// Calls the loops may make before the test gives up.
const MAX_CALLS: u64 = 5_000_000;
/// Margin the reference plays past the target, for a driver that overshoots with a stall.
const OVERSHOOT_STEPS: u64 = 60;

type Landings = BTreeMap<u64, Value>;

struct Played {
    /// State after the first call that reached each step count.
    landings: Landings,
    fingerprint: String,
}

/// A call's `(dt_sec, speed)`.
type Frame = (f64, f64);

fn regular(dt_sec: f64, speed: f64) -> impl FnMut(u64) -> Frame {
    move |_| (dt_sec, speed)
}

/// Frames of 0.001 to 0.05 s from a small deterministic generator, and a stall
/// of two seconds every 300th call.
fn irregular(mut seed: u64, speed: f64) -> impl FnMut(u64) -> Frame {
    move |call| {
        seed = seed
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        let unit = (seed >> 11) as f64 / (1u64 << 53) as f64;
        if call % 300 == 299 {
            (STALL_SEC, speed)
        } else {
            (0.001 + unit * (FRAME_SEC - 0.001), speed)
        }
    }
}

/// The speed values of the watched match's buttons, and a few more.
const SPEEDS: [f64; 7] = [1.0, 2.0, 4.0, 8.0, 16.0, 32.0, 48.0];

/// Every speed in turn, changed every 97 calls.
fn speed_changes() -> impl FnMut(u64) -> Frame {
    move |call| {
        let speeds = [1.0, 4.0, 8.0, 16.0, 32.0, 48.0, 12.0];
        (FRAME_SEC, speeds[(call / 97 % 7) as usize])
    }
}

/// Drops what legitimately depends on how the match is watched.
fn without_view(mut state: Value) -> Value {
    if let Value::Object(map) = &mut state {
        map.remove("speed");
        map.remove("stepAccumSec");
    }
    state
}

fn first_difference(path: &str, expected: &Value, actual: &Value) -> Option<String> {
    match (expected, actual) {
        (Value::Object(e), Value::Object(a)) => {
            for (key, e_value) in e {
                let child = format!("{path}.{key}");
                match a.get(key) {
                    Some(a_value) => {
                        if let Some(found) = first_difference(&child, e_value, a_value) {
                            return Some(found);
                        }
                    }
                    None => return Some(format!("{child} is missing")),
                }
            }
            a.keys()
                .find(|key| !e.contains_key(*key))
                .map(|key| format!("{path}.{key} is extra"))
        }
        (Value::Array(e), Value::Array(a)) => {
            if e.len() != a.len() {
                return Some(format!(
                    "{path} has {} items, expected {}",
                    a.len(),
                    e.len()
                ));
            }
            e.iter()
                .zip(a)
                .enumerate()
                .find_map(|(i, (e_item, a_item))| {
                    first_difference(&format!("{path}[{i}]"), e_item, a_item)
                })
        }
        _ => (expected != actual).then(|| format!("{path}: expected {expected}, got {actual}")),
    }
}

fn init_match(store: &SimLiveStoreState, session_id: &str, seed: &str, home: Side, away: Side) {
    init(
        store,
        SimLiveInitRequest {
            session_id: session_id.to_string(),
            seed: seed.to_string(),
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
}

/// Plays one seeded match with the given frames until `max_steps` or a winner.
fn play(
    seed: usize,
    home: Side,
    away: Side,
    max_steps: u64,
    mut frame: impl FnMut(u64) -> Frame,
) -> Played {
    let store = SimLiveStoreState::default();
    let session_id = format!("fixed-step-{seed}");
    init_match(
        &store,
        &session_id,
        &format!("fixed-step-seed-{seed}"),
        home,
        away,
    );

    let mut landings = Landings::new();
    for call in 0..MAX_CALLS {
        let (dt_sec, speed) = frame(call);
        let state = tick(
            &store,
            SimLiveTickRequest {
                session_id: session_id.clone(),
                dt_sec,
                running: true,
                speed,
            },
        )
        .expect("tick")
        .state;
        let steps = (state["timeSec"].as_f64().expect("timeSec") / STEP_SEC).round() as u64;
        let finished = !state["winner"].is_null();
        if steps > 0 {
            landings.entry(steps).or_insert_with(|| without_view(state));
        }
        if finished || steps >= max_steps {
            let sessions = store.sessions.lock().expect("lock");
            return Played {
                landings,
                fingerprint: state_fingerprint(&sessions[&session_id].state),
            };
        }
    }
    panic!("seed {seed}: no winner and fewer than {max_steps} steps after {MAX_CALLS} calls");
}

/// Every state the driver landed on equals the reference state of that step.
fn assert_same_match(label: &str, reference: &Played, other: &Played, min_landings: usize) {
    assert!(
        other.landings.len() >= min_landings,
        "{label}: landed on only {} steps",
        other.landings.len()
    );
    for (steps, state) in &other.landings {
        let expected = reference
            .landings
            .get(steps)
            .unwrap_or_else(|| panic!("{label}: landed on step {steps}, the reference never did"));
        if let Some(found) = first_difference("state", expected, state) {
            panic!("{label}: the state at step {steps} differs from the x12 reference: {found}");
        }
    }
}

fn reference(seed: usize, home: Side, away: Side, steps: u64) -> Played {
    play(
        seed,
        home,
        away,
        steps + OVERSHOOT_STEPS,
        regular(FRAME_SEC, 12.0),
    )
}

#[test]
fn every_playback_speed_plays_the_same_match() {
    let reference = reference(1, Side::EVEN, Side::EVEN, SHORT_STEPS);
    for speed in SPEEDS {
        let played = play(
            1,
            Side::EVEN,
            Side::EVEN,
            SHORT_STEPS,
            regular(FRAME_SEC, speed),
        );
        assert_same_match(&format!("x{speed} 0.05 s frames"), &reference, &played, 40);
    }
    let sixty_hz = play(
        1,
        Side::EVEN,
        Side::EVEN,
        SHORT_STEPS,
        regular(1.0 / 60.0, 4.0),
    );
    assert_same_match("x4 60 Hz frames", &reference, &sixty_hz, 40);
}

#[test]
fn irregular_frames_and_stalls_play_the_same_match() {
    let reference = reference(2, Side::EVEN, Side::EVEN, SHORT_STEPS);
    for (seed, speed) in [(7, 12.0), (11, 4.0), (13, 1.0), (23, 48.0)] {
        let played = play(
            2,
            Side::EVEN,
            Side::EVEN,
            SHORT_STEPS,
            irregular(seed, speed),
        );
        assert_same_match(
            &format!("x{speed} irregular frames"),
            &reference,
            &played,
            20,
        );
    }
}

#[test]
fn changing_the_speed_in_the_middle_plays_the_same_match() {
    let reference = reference(3, Side::EVEN, Side::EVEN, SHORT_STEPS);
    let played = play(3, Side::EVEN, Side::EVEN, SHORT_STEPS, speed_changes());
    assert_same_match("speed changes", &reference, &played, 20);
}

// ------------------------------------------------------------ the accumulator

fn started(session_id: &str) -> SimLiveStoreState {
    let store = SimLiveStoreState::default();
    init_match(
        &store,
        session_id,
        "fixed-step-mechanics",
        Side::EVEN,
        Side::EVEN,
    );
    store
}

/// `(game steps run so far, game seconds collected towards the next step)`.
fn tick_progress(
    store: &SimLiveStoreState,
    session_id: &str,
    dt_sec: f64,
    speed: f64,
) -> (u64, f64) {
    let state = tick(
        store,
        SimLiveTickRequest {
            session_id: session_id.to_string(),
            dt_sec,
            running: true,
            speed,
        },
    )
    .expect("tick")
    .state;
    (
        (state["timeSec"].as_f64().expect("timeSec") / STEP_SEC).round() as u64,
        state["stepAccumSec"].as_f64().expect("stepAccumSec"),
    )
}

#[test]
fn the_step_constant_of_the_tests_is_the_engine_step() {
    assert_eq!(STEP_SEC, runtime::FIXED_STEP_SEC);
}

#[test]
fn the_response_names_the_step_and_how_far_into_it_the_match_is() {
    let store = started("response");
    let state = tick(
        &store,
        SimLiveTickRequest {
            session_id: "response".to_string(),
            dt_sec: 0.05,
            running: true,
            speed: 1.0,
        },
    )
    .expect("tick")
    .state;
    assert_eq!(state["stepSec"].as_f64(), Some(STEP_SEC));
    assert!((state["stepAccumSec"].as_f64().expect("accum") - 0.05).abs() < 1e-12);
}

#[test]
fn a_slow_speed_runs_no_step_until_a_whole_step_has_accumulated() {
    let store = started("slow");
    for call in 1..=11 {
        let (steps, accum) = tick_progress(&store, "slow", FRAME_SEC, 1.0);
        assert_eq!(steps, 0, "call {call} ran a step");
        assert!(
            (accum - FRAME_SEC * call as f64).abs() < 1e-9,
            "call {call}: {accum}"
        );
    }
    // Twelve frames of 0.05 s are one step, give or take the rounding of the sums.
    let (mut steps, mut accum) = tick_progress(&store, "slow", FRAME_SEC, 1.0);
    if steps == 0 {
        (steps, accum) = tick_progress(&store, "slow", FRAME_SEC, 1.0);
    }
    assert_eq!(steps, 1);
    assert!(accum < FRAME_SEC + 1e-9, "left {accum}");
}

#[test]
fn a_fast_speed_runs_every_step_the_frame_covers() {
    let store = started("fast");
    let (steps, accum) = tick_progress(&store, "fast", FRAME_SEC, 48.0);
    assert_eq!(steps, 4);
    assert!(accum.abs() < 1e-9, "left {accum}");
}

#[test]
fn what_is_left_over_waits_for_the_next_tick() {
    let store = started("leftover");
    // 1.05 s of game time per call: one step now with 0.45 s towards the next.
    let (steps, accum) = tick_progress(&store, "leftover", 0.05, 21.0);
    assert_eq!(steps, 1);
    assert!((accum - 0.45).abs() < 1e-9, "left {accum}");
    let (steps, accum) = tick_progress(&store, "leftover", 0.05, 21.0);
    assert_eq!(steps, 3);
    assert!((accum - 0.3).abs() < 1e-9, "left {accum}");
}

#[test]
fn no_time_or_a_pause_runs_no_step_and_keeps_the_accumulator() {
    let store = started("pause");
    tick_progress(&store, "pause", FRAME_SEC, 1.0);
    let (steps, accum) = tick_progress(&store, "pause", 0.0, 12.0);
    assert_eq!((steps, accum), (0, FRAME_SEC));
    let paused = tick(
        &store,
        SimLiveTickRequest {
            session_id: "pause".to_string(),
            dt_sec: FRAME_SEC,
            running: false,
            speed: 12.0,
        },
    )
    .expect("tick")
    .state;
    assert_eq!(paused["timeSec"].as_f64(), Some(0.0));
    assert_eq!(paused["stepAccumSec"].as_f64(), Some(FRAME_SEC));
}

#[test]
fn a_stall_runs_a_bounded_number_of_steps_and_the_rest_follows() {
    let store = started("stall");
    // Two seconds at speed 48 is 160 steps; one tick runs at most 100.
    let (steps, accum) = tick_progress(&store, "stall", STALL_SEC, 48.0);
    assert_eq!(steps, 100);
    assert!((accum - 60.0 * STEP_SEC).abs() < 1e-6, "left {accum}");
    let (steps, accum) = tick_progress(&store, "stall", 0.001, 48.0);
    assert_eq!(steps, 160);
    assert!(accum < STEP_SEC, "left {accum}");
}

#[test]
fn a_stall_longer_than_the_accumulator_drops_the_excess() {
    let store = started("flood");
    let (steps, accum) = tick_progress(&store, "flood", STALL_SEC, 100_000.0);
    assert_eq!(steps, 100);
    // The cap is two ticks of steps; one was run and the other waits.
    assert!((accum - 100.0 * STEP_SEC).abs() < 1e-6, "left {accum}");
}

#[test]
fn reset_empties_the_accumulator() {
    let store = started("reset");
    tick_progress(&store, "reset", FRAME_SEC, 1.0);
    let state = reset(
        &store,
        SimLiveResetRequest {
            session_id: "reset".to_string(),
            seed: "another".to_string(),
            initial_state: None,
            ai_mode: SimulatorAiMode::default(),
            policy: None,
        },
    )
    .expect("reset")
    .state;
    assert_eq!(state["stepAccumSec"].as_f64(), Some(0.0));
}

fn skipped(speed: f64, max_ticks: u64) -> SimLiveSkipToEndResponse {
    let store = started("skip");
    skip_to_end(
        &store,
        SimLiveSkipToEndRequest {
            session_id: "skip".to_string(),
            dt_sec: 0.2,
            speed,
            max_ticks,
        },
    )
    .expect("skip")
}

#[test]
fn skip_to_end_runs_the_same_steps_at_every_speed() {
    let at_twelve = skipped(12.0, 90);
    assert_eq!(at_twelve.ticks, 90);
    for speed in [1.0, 4.0, 48.0] {
        let other = skipped(speed, 90);
        assert_eq!(
            other.elapsed_simulated_sec, at_twelve.elapsed_simulated_sec,
            "x{speed}"
        );
        if let Some(found) = first_difference(
            "state",
            &without_view(at_twelve.state.clone()),
            &without_view(other.state),
        ) {
            panic!("skip at x{speed} differs from skip at x12: {found}");
        }
    }
}

#[test]
fn run_to_completion_runs_one_step_per_tick_at_speed_12() {
    let response = run_to_completion(
        &SimLiveStoreState::default(),
        SimLiveRunToCompletionRequest {
            seed: "fixed-step-mechanics".to_string(),
            snapshot: snapshot_with(Side::EVEN, Side::EVEN),
            champion_by_player_id: HashMap::new(),
            champion_profiles_by_id: HashMap::new(),
            champion_ultimates_by_id: HashMap::new(),
            ai_mode: SimulatorAiMode::default(),
            policy: SimulatorPolicyConfig::default(),
            dt_sec: 0.2,
            speed: 12.0,
            max_ticks: 40,
        },
    )
    .expect("run");
    assert_eq!(response.ticks, 40);
    assert_eq!(
        response.elapsed_simulated_sec,
        skipped(12.0, 40).elapsed_simulated_sec
    );
}

/// Full matches, even and uneven: the final state of every driver is the one of
/// the reference. Run with
/// `cargo test --release -p olm_core --lib sim_live::fixed_step_tests::full_matches_end_the_same_at_every_speed -- --ignored --nocapture`.
#[test]
#[ignore = "slow: full matches at every speed; run explicitly to prove the playback speed changes nothing"]
fn full_matches_end_the_same_at_every_speed() {
    let jobs = [
        (0, Side::EVEN, Side::EVEN),
        (1, Side::EVEN, Side::EVEN),
        (2, Side::EVEN, Side::EVEN),
        (3, Side::stat(80.0), Side::stat(60.0)),
    ];
    for (seed, home, away) in jobs {
        let reference = play(seed, home, away, u64::MAX, regular(FRAME_SEC, 12.0));
        println!("FULL seed {seed} reference {}", reference.fingerprint);
        let check = |label: String, played: Played| {
            println!("FULL seed {seed} {label} {}", played.fingerprint);
            assert_eq!(
                played.fingerprint, reference.fingerprint,
                "seed {seed} {label}: the match ended differently"
            );
            assert_same_match(&format!("seed {seed} {label}"), &reference, &played, 1);
        };
        for speed in SPEEDS {
            let played = play(seed, home, away, u64::MAX, regular(FRAME_SEC, speed));
            check(format!("x{speed}"), played);
        }
        check(
            "x12 irregular".to_string(),
            play(seed, home, away, u64::MAX, irregular(17, 12.0)),
        );
        check(
            "x1 irregular".to_string(),
            play(seed, home, away, u64::MAX, irregular(19, 1.0)),
        );
        check(
            "speed changes".to_string(),
            play(seed, home, away, u64::MAX, speed_changes()),
        );
    }
}

/// The same seeds driven the way the watched match drives them at speed 12 (`tick`,
/// one 0.05 s frame per call) and by `skip_to_end`, one line each. Compare the
/// output before and after a change that must not alter the simulation, or one
/// path against the other: `cargo test --release -p olm_core --lib
/// sim_live::fixed_step_tests::print_tick_and_skip_fingerprints -- --ignored --nocapture`.
#[test]
#[ignore = "slow: 16 full matches; run explicitly to compare the two ways of driving a match"]
fn print_tick_and_skip_fingerprints() {
    for seed in 0..8 {
        let (home, away) = if seed < 6 {
            (Side::EVEN, Side::EVEN)
        } else {
            (Side::stat(80.0), Side::stat(60.0))
        };
        let ticked = play(seed, home, away, u64::MAX, regular(FRAME_SEC, 12.0));
        println!("TICK {seed} {}", ticked.fingerprint);

        let store = SimLiveStoreState::default();
        init_match(
            &store,
            "skip",
            &format!("fixed-step-seed-{seed}"),
            home,
            away,
        );
        skip_to_end(
            &store,
            SimLiveSkipToEndRequest {
                session_id: "skip".to_string(),
                dt_sec: 0.2,
                speed: 12.0,
                max_ticks: 6000,
            },
        )
        .expect("skip");
        let sessions = store.sessions.lock().expect("lock");
        println!("SKIP {seed} {}", state_fingerprint(&sessions["skip"].state));
    }
}
