//! The bulk SoloQ refresh must give exactly what the per-player code gave.
//!
//! The `legacy_*` functions are the previous implementation (copied, only renamed): one
//! mastery-table scan, one team scan and one `position` lookup per player.

use super::*;
use crate::clock::GameClock;
use crate::domain::manager::Manager;
use crate::domain::player::{Player, PlayerAttributes};
use crate::domain::stats::LolRole;
use crate::domain::team::{Team, TrainingFocus, TrainingIntensity, TrainingSchedule};
use chrono::{TimeZone, Utc};

// ---------------------------------------------------------------------------
// Legacy reference
// ---------------------------------------------------------------------------

fn legacy_mastery_signal_for_player(game: &Game, player_id: &str) -> f64 {
    let mut values: Vec<u8> = game
        .champion_masteries
        .iter()
        .filter(|entry| entry.player_id == player_id)
        .map(|entry| entry.mastery)
        .collect();
    if values.is_empty() {
        return 0.0;
    }
    values.sort_by_key(|value| std::cmp::Reverse(*value));
    let top = values.into_iter().take(3).collect::<Vec<_>>();
    let avg = top.iter().map(|value| f64::from(*value)).sum::<f64>() / top.len() as f64;
    (avg - 60.0).max(0.0)
}

fn legacy_soloq_grind_quality(game: &Game, player: &Player) -> f64 {
    let team = player
        .team_id
        .as_deref()
        .and_then(|team_id| game.teams.iter().find(|team| team.id == team_id));

    let focus = player
        .training_focus
        .clone()
        .or_else(|| team.map(|team| team.training_focus.clone()));
    let intensity = team
        .map(|team| team.training_intensity.clone())
        .unwrap_or_default();
    let schedule = team
        .map(|team| team.training_schedule.clone())
        .unwrap_or_default();

    soloq_focus_multiplier(focus)
        * soloq_intensity_multiplier(intensity)
        * soloq_schedule_multiplier(schedule)
}

fn legacy_soloq_points_at(game: &Game, player: &Player, day_index: i64) -> f64 {
    let ovr = f64::from(crate::potential::calculate_lol_ovr(player));
    let mastery_signal = legacy_mastery_signal_for_player(game, &player.id);
    let id_jitter = f64::from(hash_text(&player.id) % 121) - 60.0;

    let skill_base = 3520.0 + (ovr - 76.0) * 52.0 + mastery_signal * 4.0 + id_jitter;
    let skill_floor = skill_base - SOLOQ_SKILL_FLOOR_DROP;

    let grind_quality = legacy_soloq_grind_quality(game, player);
    let ramp = (day_index.max(0) as f64 / SOLOQ_TRAINING_RAMP_DAYS).min(1.0);
    let training_mod = (grind_quality - 1.0) * SOLOQ_TRAINING_SWING * ramp;

    let drift = (pseudo_random(&format!("{}:{}", player.id, day_index)) * 90.0 - 45.0).round();

    (skill_base + training_mod + drift).clamp(skill_floor, SOLOQ_POINTS_MAX)
}

fn legacy_refresh_soloq_lp(game: &mut Game) {
    let day_index = days_between(game.clock.start_date, game.clock.current_date);
    let player_ids: Vec<String> = game.players.iter().map(|p| p.id.clone()).collect();
    for player_id in &player_ids {
        let idx = game
            .players
            .iter()
            .position(|p| &p.id == player_id)
            .unwrap();
        let lp = {
            let player = &game.players[idx];
            (legacy_soloq_points_at(game, player, day_index) - SOLOQ_POINTS_BASELINE).max(0.0)
        };
        game.players[idx].soloq_lp = lp;
    }
}

fn legacy_bootstrap_champion_state(game: &mut Game) {
    bootstrap_seed_masteries(game);
    ensure_initial_patch_state(game);
    seed_initial_discovery(game);
    legacy_refresh_soloq_lp(game);
}

fn legacy_process_daily_champion_system(game: &mut Game) {
    legacy_bootstrap_champion_state(game);
    apply_mastery_decay(game);
    legacy_refresh_soloq_lp(game);
    if should_roll_patch(game, &game.champion_patch) {
        apply_patch(game);
    }
    process_meta_discovery(game);
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

fn player(index: usize, team_id: Option<&str>) -> Player {
    let level = 60 + (index * 7 % 38) as u8;
    let mut player = Player::new(
        format!("p{index:03}"),
        format!("p{index:03}"),
        format!("Player {index}"),
        "2000-01-01".to_string(),
        "Spain".to_string(),
        [
            LolRole::Top,
            LolRole::Jungle,
            LolRole::Mid,
            LolRole::Adc,
            LolRole::Support,
        ][index % 5],
        PlayerAttributes {
            mental_resilience: level,
            champion_pool: level.saturating_add(3),
            laning: level,
            mechanics: level.saturating_add(5),
            macro_play: level,
            consistency: level,
            discipline: level,
            teamfighting: level,
            shotcalling: level,
        },
    );
    player.team_id = team_id.map(str::to_string);
    player.training_focus = match index % 4 {
        0 => Some(TrainingFocus::ChampionPoolPractice),
        1 => Some(TrainingFocus::Scrims),
        _ => None,
    };
    player
}

fn team(id: &str, intensity: TrainingIntensity, schedule: TrainingSchedule) -> Team {
    let mut team = Team::new(
        id.to_string(),
        format!("{id} Esports"),
        id.to_uppercase(),
        "Spain".to_string(),
        "Madrid".to_string(),
        "Arena".to_string(),
        10_000,
    );
    team.training_intensity = intensity;
    team.training_schedule = schedule;
    team.training_focus = TrainingFocus::Scrims;
    team
}

fn mastery(
    player_id: &str,
    champion: usize,
    value: u8,
    last_active_on: &str,
) -> ChampionMasteryEntry {
    ChampionMasteryEntry {
        player_id: player_id.to_string(),
        champion_id: format!("champ{champion}"),
        mastery: value,
        last_active_on: last_active_on.to_string(),
    }
}

/// 2026-08-01 is a Saturday, so the daily patch roll (Tuesdays) never fires and the
/// run is deterministic. Mastery tables per player: none, one, two, three, five with
/// ties, interleaved across players.
fn fixture() -> Game {
    let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 8, 1, 12, 0, 0).unwrap());
    let manager = Manager::new(
        "manager-1".to_string(),
        "Jane".to_string(),
        "Doe".to_string(),
        "1980-01-01".to_string(),
        "Spain".to_string(),
    );
    let teams = vec![
        team("t1", TrainingIntensity::High, TrainingSchedule::Intense),
        team("t2", TrainingIntensity::Low, TrainingSchedule::Light),
        team("t3", TrainingIntensity::Medium, TrainingSchedule::Balanced),
    ];
    let players: Vec<Player> = (0..40)
        .map(|index| {
            let team_id = match index % 5 {
                0 => Some("t1"),
                1 => Some("t2"),
                2 => Some("t3"),
                3 => Some("ghost-team"),
                _ => None,
            };
            player(index, team_id)
        })
        .collect();
    let mut game = Game::new(clock, manager, teams, players, vec![], vec![]);
    // 91 days in (a whole number of weeks, still a Saturday): the training ramp is
    // fully on, so team settings change the result.
    game.clock.current_date += chrono::Duration::days(91);
    let today = game.clock.current_date.date_naive();
    let idle_56 = (today - chrono::Duration::days(56)).to_string();
    let idle_2 = (today - chrono::Duration::days(2)).to_string();

    let counts = [0usize, 1, 2, 3, 5];
    let values = [95u8, 80, 80, 70, 60, 99, 41, 41, 41, 88];
    for index in 0..40 {
        let id = format!("p{index:03}");
        for champion in 0..counts[index % counts.len()] {
            let value = values[(index + champion * 3) % values.len()];
            // Every third entry is idle for exactly 56 days: today's decay applies.
            let last_active = if champion % 3 == 0 { &idle_56 } else { &idle_2 };
            game.champion_masteries
                .push(mastery(&id, champion, value, last_active));
        }
    }
    // Masteries of an id that is not a player.
    game.champion_masteries
        .push(mastery("nobody", 0, 99, &idle_2));
    // Seeds the patch and discovery state once, so later calls are deterministic.
    seed_champion_state(&mut game);
    game
}

fn lp_bits(game: &Game) -> Vec<(String, u64)> {
    game.players
        .iter()
        .map(|player| (player.id.clone(), player.soloq_lp.to_bits()))
        .collect()
}

fn mastery_rows(game: &Game) -> Vec<(String, String, u8, String)> {
    game.champion_masteries
        .iter()
        .map(|entry| {
            (
                entry.player_id.clone(),
                entry.champion_id.clone(),
                entry.mastery,
                entry.last_active_on.clone(),
            )
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn fixture_should_cover_varied_lp_values() {
    let mut game = fixture();

    refresh_soloq_lp(&mut game);

    let distinct = lp_bits(&game)
        .into_iter()
        .map(|(_, bits)| bits)
        .collect::<HashSet<_>>();
    assert!(distinct.len() > 20, "{} distinct values", distinct.len());
}

#[test]
fn mastery_signal_from_top_should_match_the_table_scan_for_every_player() {
    let game = fixture();
    let top = top_masteries_by_player(&game);

    for player in &game.players {
        let bulk = top
            .get(player.id.as_str())
            .map_or(0.0, |(top, len)| mastery_signal_from_top(&top[..*len]));
        assert_eq!(
            bulk.to_bits(),
            legacy_mastery_signal_for_player(&game, &player.id).to_bits(),
            "{}",
            player.id
        );
    }
}

#[test]
fn mastery_signal_for_player_should_match_the_previous_scan() {
    let game = fixture();

    for player in &game.players {
        assert_eq!(
            mastery_signal_for_player(&game, &player.id).to_bits(),
            legacy_mastery_signal_for_player(&game, &player.id).to_bits(),
            "{}",
            player.id
        );
    }
}

#[test]
fn soloq_points_at_should_match_the_previous_formula() {
    let game = fixture();

    for player in &game.players {
        for day_index in [0, 1, 30, 90] {
            assert_eq!(
                soloq_points_at(&game, player, day_index).to_bits(),
                legacy_soloq_points_at(&game, player, day_index).to_bits(),
                "{} day {day_index}",
                player.id
            );
        }
    }
}

#[test]
fn refresh_soloq_lp_should_match_the_per_player_loop() {
    let mut new_game = fixture();
    let mut old_game = new_game.clone();

    refresh_soloq_lp(&mut new_game);
    legacy_refresh_soloq_lp(&mut old_game);

    assert_eq!(lp_bits(&new_game), lp_bits(&old_game));
}

#[test]
fn bootstrap_champion_state_should_match_the_previous_result() {
    let mut new_game = fixture();
    let mut old_game = new_game.clone();

    bootstrap_champion_state(&mut new_game);
    legacy_bootstrap_champion_state(&mut old_game);

    assert_eq!(
        (lp_bits(&new_game), mastery_rows(&new_game)),
        (lp_bits(&old_game), mastery_rows(&old_game))
    );
}

#[test]
fn process_daily_champion_system_should_match_the_previous_result() {
    let mut new_game = fixture();
    let mut old_game = new_game.clone();

    process_daily_champion_system(&mut new_game);
    legacy_process_daily_champion_system(&mut old_game);

    assert_eq!(
        (lp_bits(&new_game), mastery_rows(&new_game)),
        (lp_bits(&old_game), mastery_rows(&old_game))
    );
}

#[test]
fn process_daily_champion_system_should_apply_mastery_decay_before_rating() {
    let mut game = fixture();
    let before = mastery_rows(&game);

    process_daily_champion_system(&mut game);

    assert_ne!(mastery_rows(&game), before, "the 56-day idle entries decay");
}

#[test]
fn refresh_soloq_lp_should_use_the_first_team_when_ids_repeat() {
    let mut new_game = fixture();
    new_game
        .teams
        .push(team("t1", TrainingIntensity::Low, TrainingSchedule::Light));
    let mut old_game = new_game.clone();

    refresh_soloq_lp(&mut new_game);
    legacy_refresh_soloq_lp(&mut old_game);

    assert_eq!(lp_bits(&new_game), lp_bits(&old_game));
}
