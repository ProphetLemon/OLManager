//! SoloQ inactivity decay: the bank, the offset, the day kinds and the
//! settings, driven through the real training pass and daily step.

use super::soloq_decay::settle_day;
use super::*;
use crate::clock::GameClock;
use crate::domain::manager::Manager;
use crate::domain::player::{Player, PlayerAttributes};
use crate::domain::stats::LolRole;
use crate::domain::team::{Team, TeamKind, TrainingFocus, TrainingSchedule};
use chrono::{TimeZone, Utc};

const STARTER: &str = "starter";
const RESETTER: &str = "resetter";
const FREE_AGENT: &str = "free-agent";
const RIVAL: &str = "rival";
const ACADEMY: &str = "academy-kid";

fn player(id: &str, team_id: Option<&str>) -> Player {
    let mut player = Player::new(
        id.to_string(),
        id.to_string(),
        format!("Player {id}"),
        "2000-01-01".to_string(),
        "Spain".to_string(),
        LolRole::Mid,
        PlayerAttributes {
            mental_resilience: 80,
            champion_pool: 80,
            laning: 80,
            mechanics: 80,
            macro_play: 80,
            consistency: 80,
            discipline: 80,
            teamfighting: 80,
            shotcalling: 80,
        },
    );
    player.team_id = team_id.map(str::to_string);
    player
}

fn team(id: &str, kind: TeamKind, parent: Option<&str>) -> Team {
    let mut team = Team::new(
        id.to_string(),
        format!("{id} Esports"),
        id.to_uppercase(),
        "Spain".to_string(),
        "Madrid".to_string(),
        "Arena".to_string(),
        10_000,
    );
    team.team_kind = kind;
    team.parent_team_id = parent.map(str::to_string);
    team.training_focus = TrainingFocus::Scrims;
    // Rests on Sundays only, so every other day is a training day.
    team.training_schedule = TrainingSchedule::Intense;
    team
}

/// Monday 2026-08-03. Decay is `mode`; the user manages `t1`, which has an academy.
fn game(mode: SoloQDecayMode) -> Game {
    let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 8, 3, 12, 0, 0).unwrap());
    let mut manager = Manager::new(
        "manager-1".to_string(),
        "Jane".to_string(),
        "Doe".to_string(),
        "1980-01-01".to_string(),
        "Spain".to_string(),
    );
    manager.team_id = Some("t1".to_string());
    let teams = vec![
        team("t1", TeamKind::Main, None),
        team("t1-academy", TeamKind::Academy, Some("t1")),
        team("t2", TeamKind::Main, None),
    ];
    let mut resetter = player(RESETTER, Some("t1"));
    resetter.training_focus = Some(TrainingFocus::MentalResetRecovery);
    let players = vec![
        player(STARTER, Some("t1")),
        resetter,
        player(FREE_AGENT, None),
        player(RIVAL, Some("t2")),
        player(ACADEMY, Some("t1-academy")),
    ];
    let mut game = Game::new(clock, manager, teams, players, vec![], vec![]);
    game.soloq_decay_mode = mode;
    game
}

/// One calendar day the way the turn runs it: the training pass (or a match day), the
/// daily champion step, then the clock moves on.
fn run_day(game: &mut Game, match_day: bool) {
    if match_day {
        game.soloq_day_marks.begin_match_day();
    } else {
        let weekday = game.clock.current_date.weekday().num_days_from_monday();
        crate::training::process_training(game, weekday);
    }
    process_daily_champion_system(game);
    game.clock.advance_days(1);
}

fn run_days(game: &mut Game, days: usize) {
    for _ in 0..days {
        run_day(game, false);
    }
}

fn find<'a>(game: &'a Game, id: &str) -> &'a Player {
    game.players.iter().find(|p| p.id == id).unwrap()
}

fn set_focus(game: &mut Game, id: &str, focus: Option<TrainingFocus>) {
    game.players
        .iter_mut()
        .find(|p| p.id == id)
        .unwrap()
        .training_focus = focus;
}

/// The formula LP of the day the step last ran on (the clock has moved one day on).
fn last_formula_lp(game: &Game, id: &str) -> f64 {
    let mut earlier = game.clone();
    earlier.clock.current_date -= chrono::Duration::days(1);
    let index = earlier.players.iter().position(|p| p.id == id).unwrap();
    formula_lps(&earlier)[index]
}

// ---------------------------------------------------------------------------
// Modes and saves
// ---------------------------------------------------------------------------

#[test]
fn new_games_should_start_on_real() {
    assert_eq!(
        game(SoloQDecayMode::Real).soloq_decay_mode,
        SoloQDecayMode::Real
    );
    let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 8, 3, 12, 0, 0).unwrap());
    let manager = Manager::new(
        "m".to_string(),
        "A".to_string(),
        "B".to_string(),
        "1980-01-01".to_string(),
        "Spain".to_string(),
    );
    let fresh = Game::new(clock, manager, vec![], vec![], vec![], vec![]);
    assert_eq!(fresh.soloq_decay_mode, SoloQDecayMode::Real);
}

#[test]
fn old_saves_should_load_as_off_with_a_full_bank_and_no_offset() {
    let mut value = serde_json::to_value(game(SoloQDecayMode::Real)).unwrap();
    let root = value.as_object_mut().unwrap();
    root.remove("soloq_decay_mode");
    for player in root["players"].as_array_mut().unwrap() {
        let player = player.as_object_mut().unwrap();
        player.remove("soloq_bank_spent");
        player.remove("soloq_decay_offset");
    }

    let loaded: Game = serde_json::from_value(value).unwrap();

    assert_eq!(loaded.soloq_decay_mode, SoloQDecayMode::Off);
    assert!(
        loaded
            .players
            .iter()
            .all(|p| p.soloq_bank_spent == 0 && p.soloq_decay_offset == 0.0)
    );
}

#[test]
fn the_day_marks_should_not_be_saved() {
    let mut game = game(SoloQDecayMode::Real);
    game.soloq_day_marks.begin_match_day();

    let value = serde_json::to_value(&game).unwrap();

    assert!(value.get("soloq_day_marks").is_none());
}

#[test]
fn presets_should_match_the_design_table() {
    let rows: Vec<(SoloQDecayMode, u32, u32, u32)> = SoloQDecayMode::ALL
        .iter()
        .map(|mode| {
            let p = mode.preset();
            (
                p.mode,
                p.decay_per_idle_day,
                p.bank_days,
                p.recovery_per_played_day,
            )
        })
        .collect();
    assert_eq!(
        rows,
        vec![
            (SoloQDecayMode::Off, 0, 0, 0),
            (SoloQDecayMode::Soft, 25, 21, 50),
            (SoloQDecayMode::Real, 50, 14, 100),
            (SoloQDecayMode::Harsh, 75, 7, 150),
        ]
    );
}

// ---------------------------------------------------------------------------
// Off changes nothing
// ---------------------------------------------------------------------------

#[test]
fn off_should_give_exactly_the_formula_lp_every_day() {
    let mut game = game(SoloQDecayMode::Off);
    // A mix of play, idle and match days for every kind of player.
    for day in 0..40 {
        run_day(&mut game, day % 9 == 4);
        for player in &game.players {
            let expected = last_formula_lp(&game, &player.id);
            assert_eq!(
                player.soloq_lp.to_bits(),
                expected.to_bits(),
                "{} day {day}",
                player.id
            );
            assert_eq!(player.soloq_decay_offset, 0.0, "{}", player.id);
            assert_eq!(player.soloq_bank_spent, 0, "{}", player.id);
        }
    }
}

#[test]
fn off_should_agree_with_the_status_and_the_tier_of_the_formula() {
    let mut game = game(SoloQDecayMode::Off);
    run_days(&mut game, 30);

    for player in &game.players {
        let day_index = days_between(game.clock.start_date, game.clock.current_date);
        let formula = (soloq_points_at(&game, player, day_index) - SOLOQ_POINTS_BASELINE).max(0.0);
        assert_eq!(
            soloq_lp_for_player(&game, player).to_bits(),
            formula.to_bits()
        );
        assert_eq!(
            soloq_status_for_player(&game, player).lp,
            formula.round() as u32
        );
    }
}

// ---------------------------------------------------------------------------
// The mechanic
// ---------------------------------------------------------------------------

#[test]
fn a_mental_reset_player_should_keep_lp_through_the_bank_and_decay_after_it() {
    let mut game = game(SoloQDecayMode::Real);

    run_days(&mut game, 14);
    let resetter = find(&game, RESETTER);
    assert_eq!(
        resetter.soloq_decay_offset, 0.0,
        "the bank absorbs 14 idle days"
    );
    assert_eq!(resetter.soloq_bank_spent, 14);

    run_day(&mut game, false);
    let resetter = find(&game, RESETTER);
    assert_eq!(
        resetter.soloq_decay_offset, 50.0,
        "the 15th idle day decays"
    );
    assert_eq!(resetter.soloq_lp, last_formula_lp(&game, RESETTER) - 50.0);
}

#[test]
fn a_starter_on_a_normal_plan_should_never_decay() {
    let mut game = game(SoloQDecayMode::Real);

    // Eight weeks, Sundays included: rest days are neutral.
    run_days(&mut game, 56);

    let starter = find(&game, STARTER);
    assert_eq!(starter.soloq_decay_offset, 0.0);
    assert_eq!(starter.soloq_bank_spent, 0);
    assert_eq!(starter.soloq_lp, last_formula_lp(&game, STARTER));
}

#[test]
fn match_days_and_rest_days_should_leave_the_bank_untouched() {
    let mut game = game(SoloQDecayMode::Real);
    run_days(&mut game, 3); // Mon-Wed: the resetter spends 3 bank days.
    assert_eq!(find(&game, RESETTER).soloq_bank_spent, 3);

    // Four match days: neutral for everyone, the resetter included.
    for _ in 0..4 {
        run_day(&mut game, true);
    }
    assert_eq!(find(&game, RESETTER).soloq_bank_spent, 3);

    // Run to a Sunday (a rest day): the starter's day is a neutral Rest.
    while game.clock.current_date.weekday().num_days_from_monday() != 6 {
        run_day(&mut game, false);
    }
    run_day(&mut game, false);
    assert_eq!(find(&game, STARTER).soloq_bank_spent, 0);
}

#[test]
fn a_free_agent_should_be_idle_and_decay_after_the_bank() {
    let mut game = game(SoloQDecayMode::Real);

    run_days(&mut game, 14);
    assert_eq!(find(&game, FREE_AGENT).soloq_decay_offset, 0.0);
    assert_eq!(find(&game, FREE_AGENT).soloq_bank_spent, 14);

    run_days(&mut game, 2);
    assert_eq!(find(&game, FREE_AGENT).soloq_decay_offset, 100.0);
}

#[test]
fn a_returning_player_should_win_the_lp_back_and_refill_the_bank() {
    let mut game = game(SoloQDecayMode::Real);
    run_days(&mut game, 20); // 14 bank days, then 6 decay days: offset 300.
    assert_eq!(find(&game, RESETTER).soloq_decay_offset, 300.0);

    // Back on a normal plan: -100 offset and +1 bank per played day. The first day back
    // is a Sunday, a neutral rest day, so four days make three played ones.
    set_focus(&mut game, RESETTER, None);
    run_days(&mut game, 4);
    let resetter = find(&game, RESETTER);
    assert_eq!(resetter.soloq_decay_offset, 0.0);
    assert_eq!(resetter.soloq_bank_spent, 11);

    run_days(&mut game, 20);
    assert_eq!(find(&game, RESETTER).soloq_bank_spent, 0);
    assert_eq!(find(&game, RESETTER).soloq_decay_offset, 0.0);
}

#[test]
fn the_offset_should_stop_at_the_lp_above_the_floor_and_lp_should_floor_at_zero() {
    let mut game = game(SoloQDecayMode::Harsh);
    // A very long absence: far more decay than the player has LP to lose.
    run_days(&mut game, 120);

    let free_agent = find(&game, FREE_AGENT);
    let formula = last_formula_lp(&game, FREE_AGENT);
    assert!(free_agent.soloq_decay_offset > 0.0);
    assert!(
        free_agent.soloq_decay_offset <= formula.max(free_agent.soloq_decay_offset),
        "the offset never exceeds what it was capped at"
    );
    assert_eq!(free_agent.soloq_lp, 0.0, "Master 0 LP is the floor");
    assert!(game.players.iter().all(|p| p.soloq_lp >= 0.0));
}

#[test]
fn a_decay_day_should_never_push_the_offset_above_the_formula_lp() {
    let preset = SoloQDecayMode::Harsh.preset();
    let mut p = player("capped", None);
    p.soloq_bank_spent = 7;

    let kind = settle_day(&mut p, SoloQDayKind::Idle, 120.0, &preset);
    assert_eq!((kind, p.soloq_decay_offset), (SoloQDayKind::Decay, 75.0));

    settle_day(&mut p, SoloQDayKind::Idle, 120.0, &preset);
    assert_eq!(
        p.soloq_decay_offset, 120.0,
        "capped at the LP above the floor"
    );

    settle_day(&mut p, SoloQDayKind::Idle, 120.0, &preset);
    assert_eq!(
        p.soloq_decay_offset, 120.0,
        "stays capped on further decay days"
    );

    // The formula LP falling below the offset never lowers it on a decay day.
    settle_day(&mut p, SoloQDayKind::Idle, 50.0, &preset);
    assert_eq!(p.soloq_decay_offset, 120.0);
}

#[test]
fn a_player_at_the_floor_should_recover_in_a_few_played_days() {
    let mut game = game(SoloQDecayMode::Real);
    run_days(&mut game, 120);
    assert_eq!(find(&game, FREE_AGENT).soloq_lp, 0.0);

    // Signed to the user's team and on a normal plan.
    game.players
        .iter_mut()
        .find(|p| p.id == FREE_AGENT)
        .unwrap()
        .team_id = Some("t1".to_string());
    run_days(&mut game, 10);

    let signed = find(&game, FREE_AGENT);
    assert_eq!(signed.soloq_decay_offset, 0.0);
    assert_eq!(signed.soloq_lp, last_formula_lp(&game, FREE_AGENT));
}

#[test]
fn the_tier_and_the_status_should_follow_the_displayed_lp() {
    let mut game = game(SoloQDecayMode::Real);
    run_days(&mut game, 120);
    let free_agent = find(&game, FREE_AGENT);

    let status = soloq_status_for_player(&game, free_agent);

    assert_eq!(status.lp, 0);
    assert_eq!(status.tier, "Master");
    assert_eq!(soloq_lp_for_player(&game, free_agent), 0.0);
}

#[test]
fn the_decay_should_be_deterministic() {
    // The training pass rolls attribute gains from an unseeded generator, so the days
    // are marked by hand: what is under test is the decay step.
    let run = || {
        let mut game = game(SoloQDecayMode::Real);
        for day in 0..45 {
            if day % 8 == 3 {
                game.soloq_day_marks.begin_match_day();
            } else {
                game.soloq_day_marks.begin_training();
                game.soloq_day_marks
                    .mark_training(STARTER, SoloQDayKind::Played);
                game.soloq_day_marks
                    .mark_training(ACADEMY, SoloQDayKind::Rest);
                game.soloq_day_marks
                    .mark_training(RESETTER, SoloQDayKind::Idle);
            }
            process_daily_champion_system(&mut game);
            game.clock.advance_days(1);
        }
        game
    };
    let (first, second) = (run(), run());

    let snapshot = |game: &Game| {
        (game
            .players
            .iter()
            .map(|p| {
                (
                    p.soloq_lp.to_bits(),
                    p.soloq_bank_spent,
                    p.soloq_decay_offset.to_bits(),
                )
            })
            .collect::<Vec<_>>(),)
    };
    assert_eq!(snapshot(&first), snapshot(&second));
    assert!(
        first.players.iter().any(|p| p.soloq_decay_offset > 0.0),
        "the run does decay"
    );
}

// ---------------------------------------------------------------------------
// Switching modes
// ---------------------------------------------------------------------------

#[test]
fn turning_decay_on_should_start_everyone_with_a_full_bank_and_no_offset() {
    let mut game = game(SoloQDecayMode::Off);
    run_days(&mut game, 30);
    let before = find(&game, FREE_AGENT).soloq_lp;

    set_soloq_decay_mode(&mut game, SoloQDecayMode::Real);

    let free_agent = find(&game, FREE_AGENT);
    assert_eq!(
        (free_agent.soloq_bank_spent, free_agent.soloq_decay_offset),
        (0, 0.0)
    );
    assert!(
        before > 0.0 && free_agent.soloq_lp > 0.0,
        "nothing drops the same day"
    );
}

#[test]
fn turning_decay_off_should_give_the_formula_lp_back_at_once() {
    let mut game = game(SoloQDecayMode::Real);
    run_days(&mut game, 40);
    assert!(find(&game, FREE_AGENT).soloq_decay_offset > 0.0);

    let settings = set_soloq_decay_mode(&mut game, SoloQDecayMode::Off);

    assert_eq!(settings.mode, SoloQDecayMode::Off);
    let free_agent = find(&game, FREE_AGENT);
    assert_eq!(free_agent.soloq_decay_offset, 0.0);
    let day_index = days_between(game.clock.start_date, game.clock.current_date);
    let formula = (soloq_points_at(&game, free_agent, day_index) - SOLOQ_POINTS_BASELINE).max(0.0);
    assert_eq!(free_agent.soloq_lp.to_bits(), formula.to_bits());
}

#[test]
fn moving_between_active_modes_should_keep_each_players_state() {
    let mut game = game(SoloQDecayMode::Real);
    run_days(&mut game, 20);
    let offset = find(&game, FREE_AGENT).soloq_decay_offset;

    set_soloq_decay_mode(&mut game, SoloQDecayMode::Harsh);

    assert_eq!(find(&game, FREE_AGENT).soloq_decay_offset, offset);
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// What the commands return
// ---------------------------------------------------------------------------

#[test]
fn the_settings_should_list_the_mode_and_all_four_presets() {
    let game = game(SoloQDecayMode::Soft);

    let value = serde_json::to_value(soloq_decay_settings(&game)).unwrap();

    assert_eq!(value["mode"], "Soft");
    let presets = value["presets"].as_array().unwrap();
    assert_eq!(presets.len(), 4);
    assert_eq!(
        presets[2],
        serde_json::json!({
            "mode": "Real",
            "decay_per_idle_day": 50,
            "bank_days": 14,
            "recovery_per_played_day": 100,
        })
    );
}
