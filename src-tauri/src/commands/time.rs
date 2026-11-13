use log::info;
use tauri::State;

use crate::application::time_advancement::advance_time_with_mode as advance_time_with_mode_service;
pub use crate::application::time_advancement::AdvanceTimeWithModeResponse;
use crate::application::advance_blockers::{advance_block, DEFAULT_ADVANCE_MODE};
use olm_core::game::Game;
use olm_core::state::StateManager;

fn advance_time_internal(state: &StateManager) -> Result<Game, String> {
    let mut current_game = state
        .get_game(|g| g.clone())
        .ok_or("No active game session".to_string())?;

    info!(
        "[cmd] advance_time: date={}",
        current_game.clock.current_date.format("%Y-%m-%d")
    );

    if current_game
        .active_league()
        .is_some_and(olm_core::end_of_season::is_league_complete)
    {
        info!("[cmd] advance_time: split finished, nothing advanced");
        return Ok(crate::client_game::game_for_client(&current_game));
    }

    let mut captures = Vec::new();
    olm_core::turn::process_day_with_capture(&mut current_game, &mut |capture| {
        captures.push(capture);
    });

    for capture in captures {
        state.append_stats_state(capture);
    }

    state.set_game(current_game.clone());
    Ok(crate::client_game::game_for_client(&current_game))
}

fn advance_time_with_mode_internal(
    state: &StateManager,
    mode: &str,
) -> Result<AdvanceTimeWithModeResponse, String> {
    advance_time_with_mode_service(state, mode)
}

/// Advance time with a specific match mode.
/// mode: "live" | "spectator" | "delegate" | "instant"
/// If mode is "live" or "spectator" and there's a user match today,
/// it sets up the live match session instead of auto-simulating.
#[tauri::command]
pub fn advance_time_with_mode(
    state: State<'_, StateManager>,
    mode: String,
) -> Result<AdvanceTimeWithModeResponse, String> {
    advance_time_with_mode_internal(&state, &mode)
}

#[tauri::command]
pub fn advance_time(state: State<'_, StateManager>) -> Result<Game, String> {
    advance_time_internal(&state)
}

pub fn compute_blocking_actions(game: &Game) -> Vec<serde_json::Value> {
    olm_core::time_blockers::compute_blocking_actions(game)
}

/// Every blocker "Continue" would hit in `mode`: the roster and contract
/// blockers plus the scrim stops the advance command itself raises.
pub fn blockers_for_advance(game: &Game, mode: &str) -> Vec<serde_json::Value> {
    let mut blockers = compute_blocking_actions(game);
    if let Some(block) = advance_block(game, mode) {
        blockers.push(block.to_blocker());
    }
    blockers
}

/// `mode` is the match mode the advance would run with; when absent the
/// frontend's Continue default applies. `include_scrim_stops` defaults to
/// true; `skip_to_match_day` never raises the scrim stops, so its pre-check
/// turns them off.
#[tauri::command]
pub fn check_blocking_actions(
    state: State<'_, StateManager>,
    mode: Option<String>,
    include_scrim_stops: Option<bool>,
) -> Result<serde_json::Value, String> {
    check_blocking_actions_internal(&state, mode.as_deref(), include_scrim_stops.unwrap_or(true))
}

fn check_blocking_actions_internal(
    state: &StateManager,
    mode: Option<&str>,
    include_scrim_stops: bool,
) -> Result<serde_json::Value, String> {
    let mode = mode.unwrap_or(DEFAULT_ADVANCE_MODE);
    log::debug!("[cmd] check_blocking_actions: mode={}", mode);
    let game = state
        .get_game(|g| g.clone())
        .ok_or("No active game session")?;

    let blockers = if include_scrim_stops {
        blockers_for_advance(&game, mode)
    } else {
        compute_blocking_actions(&game)
    };
    info!(
        "[cmd] check_blocking_actions: date={}, mode={}, blocker_count={}",
        game.clock.current_date.format("%Y-%m-%d"),
        mode,
        blockers.len()
    );
    Ok(serde_json::json!(blockers))
}

#[tauri::command]
pub fn skip_to_match_day(state: State<'_, StateManager>) -> Result<serde_json::Value, String> {
    skip_to_match_day_internal(&state)
}

/// Advances day by day until one of these happens: the user's club has a match today (it is
/// played, then the skip stops), a blocker appears, the manager is fired, the active league is
/// complete (so the end-of-split screen can take over), or 60 days have passed.
fn skip_to_match_day_internal(state: &StateManager) -> Result<serde_json::Value, String> {
    info!("[cmd] skip_to_match_day");
    let mut game = state
        .get_game(|g| g.clone())
        .ok_or("No active game session")?;

    // Precondition: manager must be employed at entry — guarantees that any later
    // `team_id.is_none()` inside the loop is a real firing transition, not a stale state.
    let user_team_id = game.manager.team_id.clone().ok_or("No team assigned")?;
    info!(
        "[cmd] skip_to_match_day: start_date={}, user_team_id={}",
        game.clock.current_date.format("%Y-%m-%d"),
        user_team_id
    );

    let mut days_skipped = 0u32;
    let mut match_simulated = false;
    loop {
        if days_skipped >= 60 {
            break;
        }

        if game
            .active_league()
            .is_some_and(olm_core::end_of_season::is_league_complete)
        {
            info!(
                "[cmd] skip_to_match_day: split finished, date={}, days_skipped={}",
                game.clock.current_date.format("%Y-%m-%d"),
                days_skipped
            );
            break;
        }

        let today = game.clock.current_date.format("%Y-%m-%d").to_string();

        let has_match = game.active_league().is_some_and(|league| {
            league.fixtures.iter().any(|fixture| {
                fixture.date == today
                    && fixture.status == olm_core::domain::league::FixtureStatus::Scheduled
                    && (fixture.home_team_id == user_team_id
                        || fixture.away_team_id == user_team_id)
            })
        });

        if has_match {
            info!(
                "[cmd] skip_to_match_day: found match_day={}, days_skipped={}",
                today, days_skipped
            );

            // The same blockers that stop a normal Continue also stop the auto-play.
            let blockers = compute_blocking_actions(&game);
            if !blockers.is_empty() {
                state.set_game(game.clone());
                return Ok(serde_json::json!({
                    "action": "blocked",
                    "game": crate::client_game::game_for_client(&game),
                    "blockers": blockers,
                    "days_skipped": days_skipped
                }));
            }

            // Play the day like any simulated matchday: the staff drafts for the user's side
            // with the shared AI draft, and results, picks, stats and messages are recorded.
            let mut captures = Vec::new();
            olm_core::turn::process_day_with_capture(&mut game, &mut |capture| {
                captures.push(capture);
            });
            for capture in captures {
                state.append_stats_state(capture);
            }
            days_skipped += 1;
            match_simulated = true;

            if game.manager.team_id.is_none() {
                state.set_game(game.clone());
                return Ok(serde_json::json!({
                    "action": "fired",
                    "game": crate::client_game::game_for_client(&game),
                    "days_skipped": days_skipped
                }));
            }
            break;
        }

        let mut captures = Vec::new();
        olm_core::turn::process_day_with_capture(&mut game, &mut |capture| {
            captures.push(capture);
        });
        for capture in captures {
            state.append_stats_state(capture);
        }
        days_skipped += 1;

        // Detect a firing that happened *during* this skip. Because the function
        // errors out above when the manager starts unemployed, seeing `team_id.is_none()`
        // here can only mean a real employed → unemployed transition.
        if game.manager.team_id.is_none() {
            info!(
                "[cmd] skip_to_match_day: manager fired after {} days",
                days_skipped
            );
            state.set_game(game.clone());
            return Ok(serde_json::json!({
                "action": "fired",
                "game": crate::client_game::game_for_client(&game),
                "days_skipped": days_skipped
            }));
        }

        // After processing, check if blocking actions arose
        let blockers = compute_blocking_actions(&game);
        if !blockers.is_empty() {
            info!(
                "[cmd] skip_to_match_day: blocked_after_days={}, date={}, blocker_count={}",
                days_skipped,
                game.clock.current_date.format("%Y-%m-%d"),
                blockers.len()
            );
            state.set_game(game.clone());
            return Ok(serde_json::json!({
                "action": "blocked",
                "game": crate::client_game::game_for_client(&game),
                "blockers": blockers,
                "days_skipped": days_skipped
            }));
        }
    }

    info!(
        "[cmd] skip_to_match_day: arrived_after_days={}, final_date={}",
        days_skipped,
        game.clock.current_date.format("%Y-%m-%d")
    );
    state.set_game(game.clone());
    Ok(serde_json::json!({
        "action": "arrived",
        "game": crate::client_game::game_for_client(&game),
        "days_skipped": days_skipped,
        "match_simulated": match_simulated
    }))
}

#[cfg(test)]
mod tests {
    use super::{
        advance_time_with_mode_internal, blockers_for_advance, check_blocking_actions_internal,
        compute_blocking_actions, skip_to_match_day_internal,
    };
    use chrono::{TimeZone, Utc};
    use olm_core::clock::GameClock;
    use olm_core::domain::league::{Fixture, FixtureStatus, LeagueKind, MatchType};
    use olm_core::domain::manager::Manager;
    use olm_core::domain::message::{InboxMessage, MessagePriority};
    use olm_core::domain::player::{LolRole, Player, PlayerAttributes};
    use olm_core::domain::stats::StatsState;
    use olm_core::domain::team::Team;
    use olm_core::game::{DayPhase, Game};
    use olm_core::state::StateManager;
    use serde_json::Value;

    fn default_attrs() -> PlayerAttributes {
        PlayerAttributes {
            mechanics: 60,
            laning: 60,
            teamfighting: 60,
            macro_play: 60,
            consistency: 60,
            shotcalling: 60,
            champion_pool: 60,
            discipline: 60,
            mental_resilience: 60,
        }
    }

    fn make_player(id: &str, name: &str, team_id: &str, position: LolRole) -> Player {
        let mut player = Player::new(
            id.to_string(),
            name.to_string(),
            name.to_string(),
            "2000-01-01".to_string(),
            "England".to_string(),
            position,
            default_attrs(),
        );
        player.team_id = Some(team_id.to_string());
        player
    }

    fn make_game(roster_size: usize) -> Game {
        let clock = GameClock::new(Utc.with_ymd_and_hms(2025, 6, 15, 12, 0, 0).unwrap());
        let mut manager = Manager::new(
            "mgr1".to_string(),
            "Alex".to_string(),
            "Manager".to_string(),
            "1980-01-01".to_string(),
            "England".to_string(),
        );
        manager.hire("team1".to_string());

        let players: Vec<Player> = (1..=roster_size)
            .map(|idx| {
                let position = if idx == 1 {
                    LolRole::Support
                } else if idx <= 5 {
                    LolRole::Top
                } else if idx == 6 {
                    LolRole::Mid
                } else if idx <= 9 {
                    LolRole::Jungle
                } else {
                    LolRole::Adc
                };

                make_player(
                    &format!("p{}", idx),
                    &format!("Player {}", idx),
                    "team1",
                    position,
                )
            })
            .collect();

        let mut team = Team::new(
            "team1".to_string(),
            "Test FC".to_string(),
            "TST".to_string(),
            "England".to_string(),
            "Testville".to_string(),
            "Test Ground".to_string(),
            20_000,
        );
        team.active_lineup_ids = players
            .iter()
            .take(11)
            .map(|player| player.id.clone())
            .collect();

        Game::new(clock, manager, vec![team], players, vec![], vec![])
    }

    fn make_game_with_matchday() -> Game {
        let mut game = make_game(22);
        let today = game.clock.current_date.format("%Y-%m-%d").to_string();
        let mut opponent_team = Team::new(
            "team2".to_string(),
            "Rival FC".to_string(),
            "RIV".to_string(),
            "England".to_string(),
            "Rivaltown".to_string(),
            "Rival Ground".to_string(),
            21_000,
        );
        opponent_team.active_lineup_ids = game
            .players
            .iter()
            .skip(11)
            .take(11)
            .map(|p| p.id.clone())
            .collect();
        game.teams.push(opponent_team);

        for player in game.players.iter_mut().skip(11) {
            player.team_id = Some("team2".to_string());
        }

        game.teams[0].active_lineup_ids =
            game.players.iter().take(11).map(|p| p.id.clone()).collect();
        game.leagues = vec![olm_core::domain::league::League {
            id: "league-1".to_string(),
            name: "League".to_string(),
            season: 2025,
            competition_id: None,
            logo: None,
            league_kind: LeagueKind::Main,
            split_index: 0,
            tier: 0,
            active: false,
            fixtures: vec![Fixture {
                id: "fixture-1".to_string(),
                matchday: 1,
                date: today,
                home_team_id: "team1".to_string(),
                away_team_id: "team2".to_string(),
                match_type: MatchType::League,
                best_of: 1,
                status: FixtureStatus::Scheduled,
                result: None,
            }],
            standings: vec![
                olm_core::domain::league::StandingEntry::new("team1".to_string()),
                olm_core::domain::league::StandingEntry::new("team2".to_string()),
            ],
        }];
        game
    }

    fn make_message(id: &str, priority: MessagePriority, read: bool) -> InboxMessage {
        let mut message = InboxMessage::new(
            id.to_string(),
            "Subject".to_string(),
            "Body".to_string(),
            "Board".to_string(),
            "2025-06-15".to_string(),
        )
        .with_priority(priority);
        message.read = read;
        message
    }

    fn blocker_by_id<'a>(blockers: &'a [Value], id: &str) -> Option<&'a Value> {
        blockers
            .iter()
            .find(|blocker| blocker.get("id").and_then(Value::as_str) == Some(id))
    }

    #[test]
    fn advance_time_records_match_history_in_active_stats_state() {
        let state = StateManager::new();
        state.set_game(make_game_with_matchday());
        state.set_stats_state(StatsState::default());

        let advanced = super::advance_time_internal(&state).unwrap();
        let stats = state.get_stats_state(|current| current.clone()).unwrap();

        assert_eq!(
            advanced.clock.current_date.date_naive(),
            Utc.with_ymd_and_hms(2025, 6, 16, 12, 0, 0)
                .unwrap()
                .date_naive()
        );
        assert!(
            !stats.player_matches.is_empty(),
            "expected player match history to be recorded"
        );
        assert_eq!(stats.team_matches.len(), 2);
        assert_eq!(stats.player_matches[0].fixture_id, "fixture-1");
    }

    #[test]
    fn skip_to_match_day_simulates_the_users_match_with_an_auto_draft() {
        let state = StateManager::new();
        state.set_game(make_game_with_matchday());
        state.set_stats_state(StatsState::default());

        let response = skip_to_match_day_internal(&state).expect("skip response");

        assert_eq!(response["action"], "arrived");
        assert_eq!(response["match_simulated"], true);
        let game = state.get_game(|g| g.clone()).unwrap();
        let fixture = &game.leagues[0].fixtures[0];
        assert_eq!(fixture.status, FixtureStatus::Completed);
        assert!(fixture.result.is_some());
        assert_eq!(
            game.clock.current_date.date_naive(),
            Utc.with_ymd_and_hms(2025, 6, 16, 12, 0, 0)
                .unwrap()
                .date_naive()
        );
        let stats = state.get_stats_state(|current| current.clone()).unwrap();
        assert_eq!(stats.team_matches.len(), 2);
        assert!(stats
            .player_matches
            .iter()
            .all(|record| record.fixture_id == "fixture-1"));
        assert!(!stats.player_matches.is_empty());
    }

    #[test]
    fn skip_to_match_day_passes_the_clubs_bye_and_plays_its_next_match() {
        let state = StateManager::new();
        let mut game = make_game_with_matchday();
        let bye_day = game.clock.current_date.format("%Y-%m-%d").to_string();
        let club_day = "2025-06-18".to_string();
        let mut third_team = Team::new(
            "team3".to_string(),
            "Third FC".to_string(),
            "THI".to_string(),
            "England".to_string(),
            "Thirdtown".to_string(),
            "Third Ground".to_string(),
            21_000,
        );
        let third_players: Vec<Player> = (1..=11)
            .map(|idx| {
                let position = match idx {
                    1 => LolRole::Support,
                    2..=5 => LolRole::Top,
                    6 => LolRole::Mid,
                    7..=9 => LolRole::Jungle,
                    _ => LolRole::Adc,
                };
                make_player(&format!("t{idx}"), &format!("Third {idx}"), "team3", position)
            })
            .collect();
        third_team.active_lineup_ids = third_players.iter().map(|p| p.id.clone()).collect();
        game.teams.push(third_team);
        game.players.extend(third_players);
        // The league plays today without the club (its bye); the club plays on the 18th.
        let fixtures = &mut game.leagues[0].fixtures;
        fixtures[0].date = club_day;
        fixtures.push(scrim_week_fixture("bye-day", &bye_day, "team2", "team3"));
        state.set_game(game);
        state.set_stats_state(StatsState::default());

        let response = skip_to_match_day_internal(&state).expect("skip response");

        assert_eq!(response["action"], "arrived");
        assert_eq!(response["match_simulated"], true);
        let game = state.get_game(|g| g.clone()).unwrap();
        let fixtures = &game.leagues[0].fixtures;
        assert_eq!(fixtures[1].status, FixtureStatus::Completed);
        assert_eq!(fixtures[0].status, FixtureStatus::Completed);
        assert_eq!(
            game.clock.current_date.date_naive(),
            Utc.with_ymd_and_hms(2025, 6, 19, 12, 0, 0).unwrap().date_naive()
        );
    }

    #[test]
    fn skip_to_match_day_does_not_play_the_match_while_blockers_remain() {
        let state = StateManager::new();
        let mut game = make_game_with_matchday();
        game.players
            .retain(|player| player.team_id.as_deref() != Some("team1") || player.id == "p1");
        game.teams[0].active_lineup_ids = vec!["p1".to_string()];
        state.set_game(game);

        let response = skip_to_match_day_internal(&state).expect("skip response");

        assert_eq!(response["action"], "blocked");
        let game = state.get_game(|g| g.clone()).unwrap();
        assert_eq!(game.leagues[0].fixtures[0].status, FixtureStatus::Scheduled);
    }

    #[test]
    fn skip_to_match_day_does_not_advance_a_finished_split() {
        let state = StateManager::new();
        let mut game = make_game_with_matchday();
        game.leagues[0].fixtures[0].status = FixtureStatus::Completed;
        assert!(olm_core::end_of_season::is_league_complete(&game.leagues[0]));
        let start = game.clock.current_date;
        state.set_game(game);

        let response = skip_to_match_day_internal(&state).expect("skip response");

        assert_eq!(response["action"], "arrived");
        assert_eq!(response["days_skipped"], 0);
        assert_eq!(response["match_simulated"], false);
        let game = state.get_game(|g| g.clone()).unwrap();
        assert_eq!(game.clock.current_date, start);
    }

    fn make_finished_split_game() -> Game {
        let mut game = make_game_with_matchday();
        game.leagues[0].fixtures[0].status = FixtureStatus::Completed;
        assert!(olm_core::end_of_season::is_league_complete(&game.leagues[0]));
        game
    }

    #[test]
    fn advance_time_with_mode_refuses_while_the_split_is_over() {
        for mode in ["delegate", "live", "spectator", "instant"] {
            for phase in [DayPhase::Morning, DayPhase::ScrimBlock] {
                let state = StateManager::new();
                let mut game = make_finished_split_game();
                game.day_phase = phase.clone();
                let start = game.clock.current_date;
                let messages = game.messages.len();
                state.set_game(game);
                state.set_stats_state(StatsState::default());

                let response = advance_time_with_mode_internal(&state, mode).expect("response");

                assert_eq!(response.action, "season_complete", "mode {mode}, phase {phase:?}");
                assert!(response.snapshot.is_none());
                let returned = response.game.expect("current game");
                assert_eq!(returned.clock.current_date, start);
                let game = state.get_game(|g| g.clone()).unwrap();
                assert_eq!(game.clock.current_date, start);
                assert_eq!(game.day_phase, phase);
                assert_eq!(game.messages.len(), messages);
                assert_eq!(game.leagues[0].fixtures[0].status, FixtureStatus::Completed);
                assert!(state.take_live_match().is_none());
            }
        }
    }

    #[test]
    fn advance_time_refuses_while_the_split_is_over() {
        let state = StateManager::new();
        let game = make_finished_split_game();
        let start = game.clock.current_date;
        let messages = game.messages.len();
        state.set_game(game);
        state.set_stats_state(StatsState::default());

        let returned = super::advance_time_internal(&state).expect("current game");

        assert_eq!(returned.clock.current_date, start);
        let game = state.get_game(|g| g.clone()).unwrap();
        assert_eq!(game.clock.current_date, start);
        assert_eq!(game.messages.len(), messages);
        let stats = state.get_stats_state(|current| current.clone()).unwrap();
        assert!(stats.team_matches.is_empty());
    }

    #[test]
    fn skip_to_match_day_stops_on_the_day_the_split_finishes() {
        let state = StateManager::new();
        let mut game = make_game_with_matchday();
        let mut third_team = Team::new(
            "team3".to_string(),
            "Third FC".to_string(),
            "THI".to_string(),
            "England".to_string(),
            "Thirdtown".to_string(),
            "Third Ground".to_string(),
            21_000,
        );
        let third_players: Vec<Player> = (1..=11)
            .map(|idx| {
                let position = match idx {
                    1 => LolRole::Support,
                    2..=5 => LolRole::Top,
                    6 => LolRole::Mid,
                    7..=9 => LolRole::Jungle,
                    _ => LolRole::Adc,
                };
                make_player(&format!("t{idx}"), &format!("Third {idx}"), "team3", position)
            })
            .collect();
        third_team.active_lineup_ids = third_players.iter().map(|p| p.id.clone()).collect();
        game.teams.push(third_team);
        game.players.extend(third_players);
        // The club has played both of its matches; only team2 v team3 is left, three days ahead.
        let league = &mut game.leagues[0];
        league
            .standings
            .push(olm_core::domain::league::StandingEntry::new("team3".to_string()));
        league.fixtures[0].status = FixtureStatus::Completed;
        let mut club_vs_third = scrim_week_fixture("fixture-2", "2025-06-12", "team1", "team3");
        club_vs_third.status = FixtureStatus::Completed;
        league.fixtures.push(club_vs_third);
        league
            .fixtures
            .push(scrim_week_fixture("fixture-3", "2025-06-18", "team2", "team3"));
        assert!(!olm_core::end_of_season::is_league_complete(&game.leagues[0]));
        state.set_game(game);
        state.set_stats_state(StatsState::default());

        let response = skip_to_match_day_internal(&state).expect("skip response");

        assert_eq!(response["action"], "arrived");
        assert_eq!(response["days_skipped"], 4);
        assert_eq!(response["match_simulated"], false);
        let game = state.get_game(|g| g.clone()).unwrap();
        assert_eq!(game.leagues[0].fixtures[2].status, FixtureStatus::Completed);
        assert!(olm_core::end_of_season::is_league_complete(&game.leagues[0]));
        assert_eq!(
            game.clock.current_date.date_naive(),
            Utc.with_ymd_and_hms(2025, 6, 19, 12, 0, 0).unwrap().date_naive()
        );
    }

    #[test]
    fn healthy_squad_with_no_urgent_messages_has_no_blockers() {
        let game = make_game(11);

        let blockers = compute_blocking_actions(&game);

        assert!(blockers.is_empty());
    }

    #[test]
    fn missing_lol_roles_trigger_main_role_coverage_blocker() {
        let mut game = make_game(5);
        game.players.truncate(5);
        game.teams[0].active_lineup_ids = game
            .players
            .iter()
            .map(|player| player.id.clone())
            .collect();

        let blockers = compute_blocking_actions(&game);

        let role_blocker =
            blocker_by_id(&blockers, "main_missing_roles").expect("missing role blocker");
        assert_eq!(
            role_blocker.get("severity").and_then(Value::as_str),
            Some("warn")
        );
        assert_eq!(
            role_blocker.get("tab").and_then(Value::as_str),
            Some("Squad")
        );
        let text = role_blocker.get("text").and_then(Value::as_str).unwrap();
        assert!(text.contains("JUNGLE"));
        assert!(text.contains("MID"));
        assert!(text.contains("ADC"));
        let roles = role_blocker
            .pointer("/params/roles")
            .and_then(Value::as_str)
            .expect("the blocker carries the missing roles for the interface");
        assert!(roles.contains("JUNGLE") && roles.contains("MID") && roles.contains("ADC"));
    }

    #[test]
    fn a_roster_under_five_players_reports_its_size_for_the_interface() {
        let mut game = make_game(5);
        game.players.truncate(4);

        let blockers = compute_blocking_actions(&game);

        let blocker = blocker_by_id(&blockers, "main_roster_minimum").expect("roster blocker");
        assert_eq!(blocker.pointer("/params/count").and_then(Value::as_u64), Some(4));
    }

    #[test]
    fn incomplete_lineup_is_not_reported_when_a_partial_saved_lineup_can_be_filled_by_healthy_players(
    ) {
        let mut game = make_game(11);
        game.teams[0].active_lineup_ids = vec![
            "p1".to_string(),
            "p2".to_string(),
            "p3".to_string(),
            "p4".to_string(),
            "p5".to_string(),
            "p6".to_string(),
            "p7".to_string(),
            "p8".to_string(),
        ];

        let blockers = compute_blocking_actions(&game);

        assert!(blocker_by_id(&blockers, "incomplete_lineup").is_none());
    }

    #[test]
    fn only_unread_urgent_messages_produce_message_blockers() {
        let mut game = make_game(11);
        game.messages = vec![
            make_message("urgent-1", MessagePriority::Urgent, false),
            make_message("urgent-2", MessagePriority::Urgent, false),
            make_message("urgent-read", MessagePriority::Urgent, true),
            make_message("high", MessagePriority::High, false),
        ];

        let blockers = compute_blocking_actions(&game);

        assert_eq!(blockers.len(), 1);
        let urgent = blocker_by_id(&blockers, "urgent_messages").unwrap();
        assert_eq!(urgent.get("severity").and_then(Value::as_str), Some("info"));
        assert_eq!(urgent.get("tab").and_then(Value::as_str), Some("Inbox"));
        assert_eq!(
            urgent.get("text").and_then(Value::as_str),
            Some("2 urgent unread message(s)")
        );
        assert_eq!(
            urgent.pointer("/params/count").and_then(Value::as_u64),
            Some(2),
            "the interface words the blocker from the count, not from the English text"
        );
    }

    #[test]
    fn key_player_contract_risk_triggers_squad_blocker() {
        let mut game = make_game(11);

        let first_key_player = game
            .players
            .iter_mut()
            .find(|player| player.id == "p10")
            .unwrap();
        first_key_player.contract_end = Some("2025-07-15".to_string());
        first_key_player.wage = 35_000;
        first_key_player.attributes.laning = 94;
        first_key_player.attributes.mechanics = 90;

        let second_key_player = game
            .players
            .iter_mut()
            .find(|player| player.id == "p11")
            .unwrap();
        second_key_player.contract_end = Some("2025-07-15".to_string());
        second_key_player.wage = 25_000;
        second_key_player.attributes.laning = 91;
        second_key_player.attributes.mechanics = 89;

        let blockers = compute_blocking_actions(&game);

        let contract_blocker = blocker_by_id(&blockers, "key_contract_risk").unwrap();
        assert_eq!(
            contract_blocker.get("severity").and_then(Value::as_str),
            Some("warn")
        );
        assert_eq!(
            contract_blocker.get("tab").and_then(Value::as_str),
            Some("Squad")
        );

        let text = contract_blocker
            .get("text")
            .and_then(Value::as_str)
            .unwrap();
        assert!(text.contains("Player 10"));
        assert!(text.contains("Player 11"));
        let players = contract_blocker
            .pointer("/params/players")
            .and_then(Value::as_str)
            .unwrap();
        assert!(players.contains("Player 10") && players.contains("Player 11"));
    }

    #[test]
    fn large_at_risk_wage_share_triggers_finance_blocker() {
        let mut game = make_game(11);
        game.teams[0].wage_budget = 50_000;

        let first_risk = game
            .players
            .iter_mut()
            .find(|player| player.id == "p10")
            .unwrap();
        first_risk.contract_end = Some("2025-07-15".to_string());
        first_risk.wage = 35_000;

        let second_risk = game
            .players
            .iter_mut()
            .find(|player| player.id == "p11")
            .unwrap();
        second_risk.contract_end = Some("2025-07-15".to_string());
        second_risk.wage = 25_000;

        let blockers = compute_blocking_actions(&game);

        let finance_blocker = blocker_by_id(&blockers, "contract_wage_risk").unwrap();
        assert_eq!(
            finance_blocker.get("severity").and_then(Value::as_str),
            Some("warn")
        );
        assert_eq!(
            finance_blocker.get("tab").and_then(Value::as_str),
            Some("Finances")
        );

        let text = finance_blocker.get("text").and_then(Value::as_str).unwrap();
        assert!(text.contains("60000"));
        assert!(text.contains("wage budget"));
        assert_eq!(
            finance_blocker.pointer("/params/amount").and_then(Value::as_u64),
            Some(60_000)
        );
    }

    fn make_round_summary_game() -> Game {
        let clock = GameClock::new(Utc.with_ymd_and_hms(2025, 6, 15, 12, 0, 0).unwrap());
        let mut manager = Manager::new(
            "mgr1".to_string(),
            "Alex".to_string(),
            "Manager".to_string(),
            "1980-01-01".to_string(),
            "England".to_string(),
        );
        manager.hire("team1".to_string());

        let teams = vec![
            Team::new(
                "team1".to_string(),
                "Test FC".to_string(),
                "TST".to_string(),
                "England".to_string(),
                "Testville".to_string(),
                "Test Ground".to_string(),
                20_000,
            ),
            Team::new(
                "team2".to_string(),
                "Rival FC".to_string(),
                "RIV".to_string(),
                "England".to_string(),
                "Rivaltown".to_string(),
                "Rival Ground".to_string(),
                20_000,
            ),
            Team::new(
                "team3".to_string(),
                "Third FC".to_string(),
                "THI".to_string(),
                "England".to_string(),
                "Thirdtown".to_string(),
                "Third Ground".to_string(),
                20_000,
            ),
            Team::new(
                "team4".to_string(),
                "Fourth FC".to_string(),
                "FOU".to_string(),
                "England".to_string(),
                "Fourthtown".to_string(),
                "Fourth Ground".to_string(),
                20_000,
            ),
        ];

        let mut players = Vec::new();
        for (team_id, prefix) in [
            ("team1", "a"),
            ("team2", "b"),
            ("team3", "c"),
            ("team4", "d"),
        ] {
            players.push(make_player(
                &format!("{}-gk", prefix),
                &format!("{} GK", prefix),
                team_id,
                LolRole::Support,
            ));
            for idx in 0..4 {
                players.push(make_player(
                    &format!("{}-def{}", prefix, idx),
                    &format!("{} Def{}", prefix, idx),
                    team_id,
                    LolRole::Top,
                ));
            }
            for idx in 0..4 {
                players.push(make_player(
                    &format!("{}-mid{}", prefix, idx),
                    &format!("{} Mid{}", prefix, idx),
                    team_id,
                    LolRole::Jungle,
                ));
            }
            for idx in 0..2 {
                players.push(make_player(
                    &format!("{}-fwd{}", prefix, idx),
                    &format!("{} Fwd{}", prefix, idx),
                    team_id,
                    LolRole::Adc,
                ));
            }
        }

        let league = olm_core::domain::league::League {
            id: "league1".to_string(),
            name: "Test League".to_string(),
            season: 1,
            competition_id: None,
            logo: None,
            league_kind: LeagueKind::Main,
            split_index: 0,
            tier: 0,
            active: false,
            fixtures: vec![
                olm_core::domain::league::Fixture {
                    id: "fix1".to_string(),
                    matchday: 1,
                    date: "2025-06-15".to_string(),
                    home_team_id: "team1".to_string(),
                    away_team_id: "team2".to_string(),
                    match_type: MatchType::League,
                    best_of: 1,
                    status: FixtureStatus::Scheduled,
                    result: None,
                },
                Fixture {
                    id: "fix2".to_string(),
                    matchday: 1,
                    date: "2025-06-15".to_string(),
                    home_team_id: "team3".to_string(),
                    away_team_id: "team4".to_string(),
                    match_type: MatchType::League,
                    best_of: 1,
                    status: olm_core::domain::league::FixtureStatus::Scheduled,
                    result: None,
                },
            ],
            standings: vec![
                olm_core::domain::league::StandingEntry::new("team1".to_string()),
                olm_core::domain::league::StandingEntry::new("team2".to_string()),
                olm_core::domain::league::StandingEntry::new("team3".to_string()),
                olm_core::domain::league::StandingEntry::new("team4".to_string()),
            ],
        };

        let mut game = Game::new(clock, manager, teams, players, vec![], vec![]);
        game.leagues = vec![league];
        game
    }

    #[test]
    fn advance_time_with_mode_live_returns_partial_round_summary() {
        let state = StateManager::new();
        state.set_game(make_round_summary_game());

        let response =
            advance_time_with_mode_internal(&state, "live").expect("live advance response");

        assert_eq!(response.action, "live_match");
        let round_summary = response.round_summary.expect("round summary");
        assert!(!round_summary.is_complete);
        assert_eq!(round_summary.pending_fixture_count, 1);
        assert_eq!(round_summary.completed_results.len(), 1);
    }

    #[test]
    fn advance_time_with_mode_delegate_returns_completed_round_summary() {
        let state = StateManager::new();
        state.set_game(make_round_summary_game());

        let response =
            advance_time_with_mode_internal(&state, "delegate").expect("delegate advance response");

        assert_eq!(response.action, "advanced");
        let round_summary = response.round_summary.expect("round summary");
        assert!(round_summary.is_complete);
        assert_eq!(round_summary.pending_fixture_count, 0);
        assert_eq!(round_summary.completed_results.len(), 2);
    }

    /// Round-summary game with a champion pool, every team's lineup saved in lane order
    /// (`<p>-def0` Top, `<p>-mid0` Jungle, `<p>-def1` Mid, `<p>-fwd0` Adc, `<p>-gk` Support)
    /// and the user's fixture set to `best_of`.
    fn make_delegated_draft_game(best_of: u8) -> Game {
        let mut game = make_round_summary_game();
        let lineup = [
            ("def0", LolRole::Top),
            ("mid0", LolRole::Jungle),
            ("def1", LolRole::Mid),
            ("fwd0", LolRole::Adc),
            ("gk", LolRole::Support),
        ];
        for (team_id, prefix) in [
            ("team1", "a"),
            ("team2", "b"),
            ("team3", "c"),
            ("team4", "d"),
        ] {
            let ids: Vec<String> = lineup
                .iter()
                .map(|(suffix, role)| {
                    let id = format!("{prefix}-{suffix}");
                    if let Some(player) = game.players.iter_mut().find(|p| p.id == id) {
                        player.natural_position = *role;
                        player.position = *role;
                    }
                    id
                })
                .collect();
            if let Some(team) = game.teams.iter_mut().find(|t| t.id == team_id) {
                team.active_lineup_ids = ids;
            }
        }
        game.champion_patch.hidden_meta = ["top", "jungle", "mid", "adc", "support"]
            .iter()
            .flat_map(|role| {
                (0..4).map(move |index| olm_core::champions::ChampionMetaEntry {
                    champion_id: format!("{role}-{index}"),
                    role: (*role).to_string(),
                    tier: if index == 0 { "S" } else { "A" }.to_string(),
                })
            })
            .collect();
        if let Some(league) = game.leagues.first_mut() {
            league.fixtures[0].best_of = best_of;
        }
        game
    }

    fn user_fixture_records(state: &StateManager) -> Vec<olm_core::domain::stats::PlayerMatchStatsRecord> {
        state
            .get_stats_state(|stats| {
                stats
                    .player_matches
                    .iter()
                    .filter(|record| record.fixture_id == "fix1")
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }

    #[test]
    fn delegated_match_records_champions_and_bans_in_its_stats() {
        let state = StateManager::new();
        state.set_game(make_delegated_draft_game(1));

        advance_time_with_mode_internal(&state, "delegate").expect("delegate advance response");

        let records = user_fixture_records(&state);
        assert_eq!(records.len(), 10);
        assert!(records.iter().all(|record| record.champion.is_some()));
        assert!(
            records
                .iter()
                .all(|record| !record.bans_json.is_empty() && record.bans_json != "[]")
        );
    }

    #[test]
    fn delegated_match_grants_champion_mastery_to_the_users_players() {
        let state = StateManager::new();
        state.set_game(make_delegated_draft_game(1));

        advance_time_with_mode_internal(&state, "delegate").expect("delegate advance response");

        let user_players_with_mastery = state
            .get_game(|game| {
                game.champion_masteries
                    .iter()
                    .filter(|entry| entry.player_id.starts_with("a-"))
                    .count()
            })
            .expect("game");
        assert_eq!(user_players_with_mastery, 5);
    }

    #[test]
    fn delegated_best_of_three_ends_with_the_winner_on_two_wins() {
        let state = StateManager::new();
        state.set_game(make_delegated_draft_game(3));

        advance_time_with_mode_internal(&state, "delegate").expect("delegate advance response");

        let (home_wins, away_wins) = state
            .get_game(|game| {
                let result = game.leagues[0].fixtures[0]
                    .result
                    .as_ref()
                    .expect("user fixture result");
                (result.home_wins, result.away_wins)
            })
            .expect("game");
        assert_eq!(home_wins.max(away_wins), 2);
    }

    #[test]
    fn delegated_match_is_applied_to_the_standings_once() {
        let state = StateManager::new();
        state.set_game(make_delegated_draft_game(1));

        advance_time_with_mode_internal(&state, "delegate").expect("delegate advance response");

        let played: Vec<u32> = state
            .get_game(|game| {
                ["team1", "team2"]
                    .iter()
                    .filter_map(|id| {
                        game.leagues[0]
                            .standings
                            .iter()
                            .find(|entry| entry.team_id == *id)
                            .map(|entry| entry.played)
                    })
                    .collect()
            })
            .expect("game");
        assert_eq!(played, [1, 1]);
        assert_eq!(user_fixture_records(&state).len(), 10);
    }

    #[test]
    fn delegated_match_plays_the_saved_lineup_not_the_stronger_bench() {
        let state = StateManager::new();
        let mut game = make_delegated_draft_game(1);
        let saved = game.teams[0].active_lineup_ids.clone();
        for player in game
            .players
            .iter_mut()
            .filter(|player| player.team_id.as_deref() == Some("team1"))
        {
            let strong = !saved.contains(&player.id);
            let value = if strong { 95 } else { 40 };
            player.attributes.mechanics = value;
            player.attributes.laning = value;
            player.attributes.teamfighting = value;
        }
        state.set_game(game);

        advance_time_with_mode_internal(&state, "delegate").expect("delegate advance response");

        let mut played: Vec<String> = user_fixture_records(&state)
            .into_iter()
            .filter(|record| record.team_id == "team1")
            .map(|record| record.player_id)
            .collect();
        played.sort();
        let mut expected = saved;
        expected.sort();
        assert_eq!(played, expected);
    }

    #[test]
    fn advance_time_with_mode_ends_a_day_without_scrims_in_one_advance() {
        let state = StateManager::new();
        let game = make_game(11);
        let start_date = game.clock.current_date;
        state.set_game(game);

        let response =
            advance_time_with_mode_internal(&state, "delegate").expect("day advance response");

        assert_eq!(response.action, "advanced");
        let game = response.game.expect("game response");
        assert_eq!(game.day_phase, DayPhase::Morning);
        assert_eq!(
            game.clock.current_date,
            start_date + chrono::Duration::days(1)
        );
    }

    #[test]
    fn advance_time_with_mode_resolves_scrims_when_entering_scrim_block() {
        let state = StateManager::new();
        let mut game = make_game(22);
        game.clock.current_date = Utc.with_ymd_and_hms(2025, 6, 18, 12, 0, 0).unwrap();
        game.teams[0].scrim_weekly_slots = 2;
        game.teams[0].weekly_scrim_plan_team_ids = vec![vec!["team2".to_string()]];

        let mut opponent_team = Team::new(
            "team2".to_string(),
            "Rival FC".to_string(),
            "RIV".to_string(),
            "England".to_string(),
            "Rivaltown".to_string(),
            "Rival Ground".to_string(),
            21_000,
        );
        opponent_team.active_lineup_ids = game
            .players
            .iter()
            .skip(11)
            .take(11)
            .map(|player| player.id.clone())
            .collect();
        for player in game.players.iter_mut().skip(11) {
            player.team_id = Some("team2".to_string());
        }
        game.teams.push(opponent_team);
        state.set_game(game);

        let response = advance_time_with_mode_internal(&state, "delegate")
            .expect("scrim block phase response");

        assert_eq!(response.action, "phase_advanced");
        let game = response.game.expect("game response");
        assert_eq!(game.day_phase, DayPhase::ScrimBlock);
        assert_eq!(game.teams[0].scrim_reports.len(), 1);
        assert_eq!(game.teams[0].scrim_reports[0].opponent_team_id, "team2");
    }

    #[test]
    fn advance_time_with_mode_processes_day_from_the_scrim_phase() {
        let state = StateManager::new();
        let mut game = make_game(11);
        let start_date = game.clock.current_date;
        game.day_phase = DayPhase::ScrimBlock;
        state.set_game(game);

        let response =
            advance_time_with_mode_internal(&state, "delegate").expect("day advance response");

        assert_eq!(response.action, "advanced");
        let game = response.game.expect("game response");
        assert_eq!(game.day_phase, DayPhase::Morning);
        assert_eq!(
            game.clock.current_date,
            start_date + chrono::Duration::days(1)
        );
    }

    /// Wednesday with two daily scrim blocks planned against "team2", at Morning.
    fn make_manual_scrim_day() -> StateManager {
        let state = StateManager::new();
        let mut game = make_game(22);
        game.clock.current_date = Utc.with_ymd_and_hms(2025, 6, 18, 12, 0, 0).unwrap();
        game.teams[0].scrim_weekly_slots = 2;
        game.teams[0].weekly_scrim_plan_team_ids =
            vec![vec!["team2".to_string()], vec!["team3".to_string()]];

        let mut opponent_team = Team::new(
            "team2".to_string(),
            "Rival FC".to_string(),
            "RIV".to_string(),
            "England".to_string(),
            "Rivaltown".to_string(),
            "Rival Ground".to_string(),
            21_000,
        );
        opponent_team.active_lineup_ids = game
            .players
            .iter()
            .skip(11)
            .take(11)
            .map(|player| player.id.clone())
            .collect();
        for player in game.players.iter_mut().skip(11) {
            player.team_id = Some("team2".to_string());
        }
        game.teams.push(opponent_team);
        // Block B needs a different opponent: the same team cannot be scrimmed twice a week.
        game.teams.push(Team::new(
            "team3".to_string(),
            "Third FC".to_string(),
            "THI".to_string(),
            "England".to_string(),
            "Thirdtown".to_string(),
            "Third Ground".to_string(),
            21_000,
        ));
        state.set_game(game);
        state
    }

    /// Forces the unresolved report of `slot_index` to a win so the daily flow is deterministic.
    fn force_scrim_win(state: &StateManager, slot_index: u8) {
        let mut game = state.get_game(|g| g.clone()).expect("game");
        let report = game.teams[0]
            .scrim_reports
            .iter_mut()
            .find(|report| report.slot_index == slot_index)
            .expect("report for slot");
        report.won = Some(true);
        state.set_game(game);
    }

    fn today_can_review(state: &StateManager) -> (bool, String) {
        let context = crate::commands::squad::get_scrim_context_internal(state).expect("context");
        (context.today.can_review, context.today.state)
    }

    fn scrim_phase(state: &StateManager) -> DayPhase {
        state.get_game(|g| g.day_phase.clone()).expect("game")
    }

    #[test]
    fn manual_scrim_day_continue_to_block_two_never_deadlocks() {
        use crate::commands::squad::choose_daily_scrim_action_internal as choose;
        let state = make_manual_scrim_day();

        let first = advance_time_with_mode_internal(&state, "instant").expect("morning advance");
        assert_eq!(first.action, "phase_advanced");
        assert_eq!(scrim_phase(&state), DayPhase::ScrimBlock);
        force_scrim_win(&state, 0);

        // The player must be able to decide in the very phase that blocks.
        assert_eq!(
            today_can_review(&state),
            (true, "PlayedNeedsReview".to_string())
        );
        let blocked = advance_time_with_mode_internal(&state, "instant").expect("blocked");
        assert_eq!(blocked.action, "blocked_scrim_decision");
        assert_eq!(scrim_phase(&state), DayPhase::ScrimBlock);

        // Block B is played right after the decision, still in ScrimBlock.
        choose(&state, 0, "ContinueToBlock2".to_string()).expect("continue to block B");
        let game = state.get_game(|g| g.clone()).expect("game");
        assert_eq!(game.teams[0].scrim_reports.len(), 2);
        assert!(game.teams[0].scrim_reports[0].post_decision.is_some());
        assert_eq!(
            today_can_review(&state),
            (true, "PlayedNeedsReview".to_string())
        );
        let blocked_b = advance_time_with_mode_internal(&state, "instant").expect("blocked B");
        assert_eq!(blocked_b.action, "blocked_scrim_decision");

        // Closing the day with block B's decision releases the block.
        choose(&state, 1, "DayOff".to_string()).expect("close the day");
        let released = advance_time_with_mode_internal(&state, "instant").expect("released");
        assert_eq!(released.action, "advanced");
        assert_eq!(scrim_phase(&state), DayPhase::Morning);
    }

    #[test]
    fn manual_scrim_day_offer_rest_releases_the_block_without_a_second_scrim() {
        use crate::commands::squad::choose_daily_scrim_action_internal as choose;
        let state = make_manual_scrim_day();

        advance_time_with_mode_internal(&state, "instant").expect("morning advance");
        force_scrim_win(&state, 0);
        let blocked = advance_time_with_mode_internal(&state, "instant").expect("blocked");
        assert_eq!(blocked.action, "blocked_scrim_decision");

        choose(&state, 0, "OfferRest".to_string()).expect("offer rest");
        let game = state.get_game(|g| g.clone()).expect("game");
        assert_eq!(game.teams[0].scrim_reports.len(), 1);

        let released = advance_time_with_mode_internal(&state, "instant").expect("released");
        assert_eq!(released.action, "advanced");
        assert_eq!(scrim_phase(&state), DayPhase::Morning);
    }

    #[test]
    fn manual_scrim_day_cancel_follow_up_is_accepted_after_a_lost_first_block() {
        use crate::commands::squad::choose_daily_scrim_action_internal as choose;
        let state = make_manual_scrim_day();

        advance_time_with_mode_internal(&state, "instant").expect("morning advance");
        let mut game = state.get_game(|g| g.clone()).expect("game");
        game.teams[0].scrim_reports[0].won = Some(false);
        state.set_game(game);

        // The UI keeps "cancel scrims" local and then offers these three follow-ups.
        choose(&state, 0, "VodReview".to_string()).expect("cancel follow-up");
        let game = state.get_game(|g| g.clone()).expect("game");
        assert!(game.teams[0].scrim_reports[0].post_decision.is_some());
    }

    #[test]
    fn manual_scrim_day_won_second_block_only_closes_the_day_with_day_off() {
        use crate::commands::squad::choose_daily_scrim_action_internal as choose;
        let state = make_manual_scrim_day();

        advance_time_with_mode_internal(&state, "instant").expect("morning advance");
        force_scrim_win(&state, 0);
        choose(&state, 0, "ContinueToBlock2".to_string()).expect("continue to block B");
        force_scrim_win(&state, 1);

        let rejected = choose(&state, 1, "VodReview".to_string()).unwrap_err();
        assert!(rejected.contains("Block2GoodDecision"), "{rejected}");
        choose(&state, 1, "DayOff".to_string()).expect("close the day");
    }

    #[test]
    fn scrim_context_offers_the_review_in_a_game_saved_in_a_removed_phase() {
        let state = make_manual_scrim_day();
        advance_time_with_mode_internal(&state, "instant").expect("morning advance");
        let mut game = state.get_game(|g| g.clone()).expect("game");
        game.day_phase = DayPhase::from_id("ReviewBlock");
        assert_eq!(game.day_phase, DayPhase::ScrimBlock);
        state.set_game(game);

        assert_eq!(
            today_can_review(&state),
            (true, "PlayedNeedsReview".to_string())
        );
    }

    #[test]
    fn a_day_without_scrims_or_a_match_ends_in_one_advance() {
        let state = StateManager::new();
        let mut game = make_game(11);
        // Monday: the weekly scrim slots start on Wednesday.
        game.clock.current_date = Utc.with_ymd_and_hms(2025, 6, 16, 12, 0, 0).unwrap();
        state.set_game(game);

        let response = advance_time_with_mode_internal(&state, "instant").expect("advance");

        assert_eq!(response.action, "advanced");
        let game = response.game.expect("game");
        assert_eq!(game.day_phase, DayPhase::Morning);
        assert_eq!(game.clock.current_date.format("%Y-%m-%d").to_string(), "2025-06-17");
    }

    #[test]
    fn a_day_with_scrims_goes_to_the_scrim_phase_and_then_to_the_next_day() {
        use crate::commands::squad::choose_daily_scrim_action_internal as choose;
        let state = make_manual_scrim_day();

        let first = advance_time_with_mode_internal(&state, "instant").expect("morning advance");
        assert_eq!(first.action, "phase_advanced");
        assert_eq!(scrim_phase(&state), DayPhase::ScrimBlock);

        let blocked = advance_time_with_mode_internal(&state, "instant").expect("blocked");
        assert_eq!(blocked.action, "blocked_scrim_decision");
        assert_eq!(scrim_phase(&state), DayPhase::ScrimBlock);

        force_scrim_win(&state, 0);
        choose(&state, 0, "OfferRest".to_string()).expect("decide");
        let next = advance_time_with_mode_internal(&state, "instant").expect("next day");

        assert_eq!(next.action, "advanced");
        let game = next.game.expect("game");
        assert_eq!(game.day_phase, DayPhase::Morning);
        assert_eq!(game.clock.current_date.format("%Y-%m-%d").to_string(), "2025-06-19");
    }

    #[test]
    fn an_old_save_in_a_removed_phase_ends_its_day_with_one_advance() {
        for id in ["ReviewBlock", "TrainingBlock", "Evening"] {
            let state = StateManager::new();
            let mut game = make_game(11);
            game.day_phase = DayPhase::from_id(id);
            state.set_game(game);

            let response = advance_time_with_mode_internal(&state, "instant").expect(id);

            assert_eq!(response.action, "advanced", "{id}");
            assert_eq!(response.game.expect("game").day_phase, DayPhase::Morning, "{id}");
        }
    }

    #[test]
    fn skip_to_match_day_from_either_phase_reaches_the_match_day() {
        for phase in [DayPhase::Morning, DayPhase::ScrimBlock] {
            let state = StateManager::new();
            let mut game = make_game_with_matchday();
            game.clock.current_date = Utc.with_ymd_and_hms(2025, 6, 15, 12, 0, 0).unwrap();
            let fixture_day = game.clock.current_date + chrono::Duration::days(2);
            game.leagues[0].fixtures[0].date = fixture_day.format("%Y-%m-%d").to_string();
            game.day_phase = phase.clone();
            state.set_game(game);
            state.set_stats_state(StatsState::default());

            let response = skip_to_match_day_internal(&state).expect("skip");

            assert_eq!(response["action"], "arrived", "{phase:?}");
            assert_eq!(response["match_simulated"], true, "{phase:?}");
        }
    }

    /// A week of the same game, Monday 30 June to Sunday 6 July (it crosses a month end): Wednesday
    /// and Thursday have two scrim blocks each, the other five days are rest days, and the club's
    /// next match is the following Thursday.
    fn make_scrim_week_game() -> Game {
        let mut game = make_game_with_matchday();
        game.clock.current_date = Utc.with_ymd_and_hms(2025, 6, 30, 12, 0, 0).unwrap();
        game.leagues[0].fixtures[0].date = "2025-07-10".to_string();
        // The daily random events skip a day whose message id is already in the inbox; the
        // media story moves morale, so a week would otherwise depend on the dice.
        for day in 0..7 {
            let date = (game.clock.current_date + chrono::Duration::days(day))
                .format("%Y-%m-%d")
                .to_string();
            for kind in ["sponsor", "media", "community", "fan_petition", "rival_interest", "allio", "yuste"] {
                game.messages.push(make_message(
                    &format!("{kind}_{date}"),
                    MessagePriority::Low,
                    true,
                ));
            }
        }
        game.teams[0].scrim_weekly_slots = 4;
        game.teams[0].weekly_scrim_plan_team_ids = ["team2", "team3", "team4", "team5"]
            .iter()
            .map(|id| vec![id.to_string()])
            .collect();
        for (id, name) in [("team3", "Third"), ("team4", "Fourth"), ("team5", "Fifth")] {
            game.teams.push(Team::new(
                id.to_string(),
                format!("{name} FC"),
                name[..3].to_uppercase(),
                "England".to_string(),
                format!("{name}town"),
                format!("{name} Ground"),
                21_000,
            ));
        }
        game
    }

    /// The five-phase sequence that existed before the day was reduced to two phases, rebuilt
    /// from the same building blocks, so a week can be played both ways. `old_phase` counts the
    /// presses of the day: 0 Morning, 1 ScrimBlock, 2 ReviewBlock, 3 TrainingBlock, 4 Evening.
    fn press_old_flow(state: &StateManager, old_phase: &mut u8) -> String {
        use crate::application::advance_blockers::{advance_block, scheduled_user_fixture_index};
        use chrono::Datelike;
        let mut game = state.get_game(|g| g.clone()).expect("game");
        let today = game.clock.current_date.format("%Y-%m-%d").to_string();
        if scheduled_user_fixture_index(&game, &today).is_some() {
            *old_phase = 0;
            return advance_time_with_mode_internal(state, "instant").expect("match day").action;
        }
        game.day_phase = if *old_phase == 0 { DayPhase::Morning } else { DayPhase::ScrimBlock };
        if *old_phase < 4 {
            // Only Morning (setup) and ScrimBlock (decision) ever blocked.
            if *old_phase <= 1 {
                if let Some(block) = advance_block(&game, "instant") {
                    state.set_game(game);
                    return block.action().to_string();
                }
            }
            if *old_phase == 0 {
                let weekday = game.clock.current_date.weekday().num_days_from_monday();
                olm_core::training::process_scrim_block(&mut game, weekday);
            }
            *old_phase += 1;
            state.set_game(game);
            return "phase_advanced".to_string();
        }
        olm_core::turn::process_day_with_capture(&mut game, &mut |_| {});
        *old_phase = 0;
        state.set_game(game);
        "advanced".to_string()
    }

    /// Plays the first unresolved scrim review of today the way a player would: block A of a
    /// day continues to block B, block B closes the day.
    fn decide_today(state: &StateManager) {
        use crate::commands::squad::choose_daily_scrim_action_internal as choose;
        let game = state.get_game(|g| g.clone()).expect("game");
        let today = game.clock.current_date.format("%Y-%m-%d").to_string();
        let slot = game.teams[0]
            .scrim_reports
            .iter()
            .find(|report| report.date == today && report.post_decision.is_none())
            .expect("an unresolved report")
            .slot_index;
        force_scrim_win(state, slot);
        let action = if slot % 2 == 0 { "ContinueToBlock2" } else { "DayOff" };
        choose(state, slot, action.to_string()).expect("decision");
    }

    /// Plays seven days and returns how many presses each day took.
    fn play_week(state: &StateManager, old_flow: bool) -> Vec<u32> {
        let mut old_phase = 0u8;
        let mut presses = Vec::new();
        for _ in 0..7 {
            let start = state.get_game(|g| g.clock.current_date).expect("game");
            let mut count = 0;
            for _ in 0..12 {
                let action = if old_flow {
                    press_old_flow(state, &mut old_phase)
                } else {
                    advance_time_with_mode_internal(state, "instant").expect("press").action
                };
                match action.as_str() {
                    "blocked_scrim_decision" => decide_today(state),
                    "advanced" | "phase_advanced" => count += 1,
                    other => panic!("unexpected action {other}"),
                }
                if state.get_game(|g| g.clock.current_date).expect("game") != start {
                    break;
                }
            }
            presses.push(count);
        }
        presses
    }

    /// The game as data, without the phase and without what the game draws from an unseeded
    /// random generator, so two runs of the same flow give the same value: the attribute and
    /// fitness training rolls, board targets, champion mastery and patch, AI lineups, transfer
    /// offers, and every message but the weekly scrim summary and the mood report.
    fn comparable(state: &StateManager) -> Value {
        let game = state.get_game(|g| g.clone()).expect("game");
        let mut value = serde_json::to_value(&game).expect("serialize");
        let root = value.as_object_mut().expect("object");
        for key in ["day_phase", "board_objectives", "champion_masteries", "champion_patch"] {
            root.remove(key);
        }
        for player in root["players"].as_array_mut().expect("players") {
            let player = player.as_object_mut().expect("player");
            for key in ["attributes", "fitness", "champion_training_targets", "transfer_offers"] {
                player.remove(key);
            }
        }
        for team in root["teams"].as_array_mut().expect("teams") {
            team.as_object_mut().expect("team").remove("active_lineup_ids");
        }
        let messages = root["messages"].as_array_mut().expect("messages");
        messages.retain(|message| {
            matches!(
                message["subject_key"].as_str(),
                Some("be.msg.scrimWeekly.subject" | "be.msg.moodReport.subject")
            )
        });
        for message in messages {
            message.as_object_mut().expect("message").remove("id");
        }
        value
    }

    /// Every path at which two JSON values differ, with both sides (at most 40 entries).
    fn collect_differences(old: &Value, new: &Value, path: &str, out: &mut Vec<String>) {
        collect_differences_cap(old, new, path, out, 40)
    }

    fn collect_differences_cap(old: &Value, new: &Value, path: &str, out: &mut Vec<String>, cap: usize) {
        if out.len() >= cap {
            return;
        }
        match (old, new) {
            (Value::Object(a), Value::Object(b)) => {
                for key in a.keys().chain(b.keys().filter(|key| !a.contains_key(*key))) {
                    let child = format!("{path}.{key}");
                    match (a.get(key), b.get(key)) {
                        (Some(x), Some(y)) => collect_differences_cap(x, y, &child, out, cap),
                        (x, y) => out.push(format!("{child}: old={x:?} new={y:?}")),
                    }
                }
            }
            (Value::Array(a), Value::Array(b)) if a.len() == b.len() => {
                for (index, (x, y)) in a.iter().zip(b).enumerate() {
                    collect_differences_cap(x, y, &format!("{path}[{index}]"), out, cap);
                }
            }
            _ if old != new => out.push(format!("{path}: old={old} new={new}")),
            _ => {}
        }
    }

    fn week_played(old_flow: bool) -> (StateManager, Vec<u32>) {
        let state = StateManager::new();
        state.set_game(make_scrim_week_game());
        state.set_stats_state(StatsState::default());
        let presses = play_week(&state, old_flow);
        (state, presses)
    }

    fn assert_same_week(old: &StateManager, new: &StateManager) {
        let mut differences = Vec::new();
        collect_differences(&comparable(old), &comparable(new), "game", &mut differences);
        assert!(differences.is_empty(), "the weeks differ at:\n{}", differences.join("\n"));
    }

    #[test]
    fn two_weeks_played_with_the_same_flow_compare_equal() {
        // Guards the comparison below: whatever it leaves in must not depend on the random rolls.
        let (first, _) = week_played(false);
        let (second, _) = week_played(false);
        assert_same_week(&first, &second);
    }

    #[test]
    fn a_week_played_with_the_new_flow_is_the_same_game_as_with_the_old_flow() {
        let (old_state, old_presses) = week_played(true);
        let (new_state, new_presses) = week_played(false);

        // Mon..Sun: the old day took five presses; the new one takes one, or two on the scrim days.
        assert_eq!(old_presses, vec![5, 5, 5, 5, 5, 5, 5]);
        assert_eq!(new_presses, vec![1, 1, 2, 2, 1, 1, 1]);
        let game = new_state.get_game(|g| g.clone()).expect("game");
        assert_eq!(game.clock.current_date.format("%Y-%m-%d").to_string(), "2025-07-07");
        assert_eq!(game.teams[0].scrim_reports.len(), 4);
        assert!(game.teams[0].scrim_reports.iter().all(|r| r.post_decision.is_some()));

        assert_same_week(&old_state, &new_state);
    }

    fn blocker_ids(blockers: &[Value]) -> Vec<String> {
        blockers
            .iter()
            .filter_map(|blocker| blocker["id"].as_str().map(str::to_string))
            .collect()
    }

    /// A game on the Wednesday that opens the weekly scrim window, nothing planned.
    fn scrim_week_fixture(id: &str, date: &str, home: &str, away: &str) -> Fixture {
        Fixture {
            id: id.to_string(),
            matchday: 1,
            date: date.to_string(),
            home_team_id: home.to_string(),
            away_team_id: away.to_string(),
            match_type: MatchType::League,
            best_of: 1,
            status: FixtureStatus::Scheduled,
            result: None,
        }
    }

    fn game_with_league_fixtures(mut game: Game, fixtures: Vec<Fixture>) -> Game {
        game.leagues = vec![olm_core::domain::league::League {
            id: "league-1".to_string(),
            name: "League".to_string(),
            season: 2025,
            competition_id: None,
            logo: None,
            league_kind: LeagueKind::Main,
            split_index: 0,
            tier: 0,
            active: false,
            fixtures,
            standings: Vec::new(),
        }];
        game
    }

    /// Wednesday 2025-06-18, scrims unplanned, and the club plays on Sunday
    /// 2025-06-22: an ordinary week with a match to prepare for.
    fn make_unplanned_scrim_window_game() -> Game {
        let mut game = make_game(11);
        game.clock.current_date = Utc.with_ymd_and_hms(2025, 6, 18, 12, 0, 0).unwrap();
        game_with_league_fixtures(
            game,
            vec![scrim_week_fixture("md-sun", "2025-06-22", "team1", "team2")],
        )
    }

    /// The same Wednesday, but the club rests: the league plays on Sunday
    /// without it (a bye in an odd-sized league).
    fn make_bye_week_scrim_window_game() -> Game {
        let mut game = make_unplanned_scrim_window_game();
        game.leagues[0].fixtures =
            vec![scrim_week_fixture("md-sun", "2025-06-22", "team2", "team3")];
        game
    }

    fn scrim_blocker_ids(game: &Game, mode: &str) -> Vec<String> {
        blocker_ids(&blockers_for_advance(game, mode))
            .into_iter()
            .filter(|id| id.starts_with("scrim_"))
            .collect()
    }

    #[test]
    fn advance_blockers_report_scrim_setup_in_the_normal_case() {
        let game = make_unplanned_scrim_window_game();
        assert_eq!(scrim_blocker_ids(&game, "live"), vec!["scrim_setup_required"]);
    }

    #[test]
    fn advance_blockers_skip_scrim_setup_in_a_week_the_club_rests() {
        let game = make_bye_week_scrim_window_game();
        assert!(scrim_blocker_ids(&game, "live").is_empty());
    }

    #[test]
    fn advance_blockers_let_continue_through_a_week_the_club_rests() {
        let state = StateManager::new();
        state.set_game(make_bye_week_scrim_window_game());
        let response = advance_time_with_mode_internal(&state, "live").expect("advance");
        assert_eq!(response.action, "advanced");
    }

    #[test]
    fn advance_blockers_report_scrim_setup_when_the_club_plays_later_in_the_week() {
        let mut game = make_bye_week_scrim_window_game();
        game.leagues[0]
            .fixtures
            .push(scrim_week_fixture("md-fri", "2025-06-20", "team1", "team2"));
        assert_eq!(scrim_blocker_ids(&game, "live"), vec!["scrim_setup_required"]);
    }

    #[test]
    fn advance_blockers_report_scrim_setup_for_a_playoff_match_this_week() {
        let mut game = make_bye_week_scrim_window_game();
        let mut playoff = scrim_week_fixture("po-sat", "2025-06-21", "team1", "team3");
        playoff.match_type = MatchType::Playoffs;
        game.leagues[0].fixtures.push(playoff);
        assert_eq!(scrim_blocker_ids(&game, "live"), vec!["scrim_setup_required"]);
    }

    #[test]
    fn advance_blockers_skip_scrim_setup_in_the_bye_week_even_if_the_next_match_is_later() {
        let mut game = make_bye_week_scrim_window_game();
        let mut next = scrim_week_fixture("md-next", "2025-06-29", "team1", "team2");
        next.matchday = 2;
        game.leagues[0].fixtures.push(next);
        assert!(scrim_blocker_ids(&game, "live").is_empty());
    }

    #[test]
    fn advance_blockers_report_scrim_setup_when_the_club_already_played_this_week() {
        let mut game = make_bye_week_scrim_window_game();
        let mut played = scrim_week_fixture("md-mon", "2025-06-16", "team1", "team2");
        played.status = FixtureStatus::Completed;
        game.leagues[0].fixtures.push(played);
        assert_eq!(
            scrim_blocker_ids(&game, "live"),
            vec!["scrim_setup_required"]
        );
    }

    #[test]
    fn advance_blockers_report_scrim_setup_in_a_week_without_fixtures() {
        let mut game = make_unplanned_scrim_window_game();
        game.leagues[0].fixtures = vec![scrim_week_fixture(
            "md-next",
            "2025-06-29",
            "team1",
            "team2",
        )];
        assert_eq!(
            scrim_blocker_ids(&game, "live"),
            vec!["scrim_setup_required"]
        );
    }

    #[test]
    fn advance_blockers_report_scrim_setup_when_only_others_play_playoffs() {
        let mut game = make_unplanned_scrim_window_game();
        let mut playoff = scrim_week_fixture("po-sat", "2025-06-21", "team2", "team3");
        playoff.match_type = MatchType::Playoffs;
        game.leagues[0].fixtures = vec![playoff];
        assert_eq!(
            scrim_blocker_ids(&game, "live"),
            vec!["scrim_setup_required"]
        );
    }

    #[test]
    fn advance_blockers_report_scrim_setup_when_the_club_plays_the_matchday_in_another_week() {
        let mut game = make_bye_week_scrim_window_game();
        game.leagues[0].fixtures.push(scrim_week_fixture(
            "md-next",
            "2025-06-29",
            "team1",
            "team2",
        ));
        assert_eq!(
            scrim_blocker_ids(&game, "live"),
            vec!["scrim_setup_required"]
        );
    }

    #[test]
    fn advance_blockers_report_scrim_setup_when_the_game_has_no_league() {
        let mut game = make_unplanned_scrim_window_game();
        game.leagues.clear();
        assert_eq!(
            scrim_blocker_ids(&game, "live"),
            vec!["scrim_setup_required"]
        );
    }

    #[test]
    fn advance_blockers_skip_scrim_setup_on_a_match_day() {
        let mut game = make_game_with_matchday();
        game.clock.current_date = Utc.with_ymd_and_hms(2025, 6, 18, 12, 0, 0).unwrap();
        game.leagues[0].fixtures[0].date = "2025-06-18".to_string();
        assert!(scrim_blocker_ids(&game, "live").is_empty());
    }

    #[test]
    fn advance_blockers_skip_scrim_setup_when_delegating() {
        let game = make_unplanned_scrim_window_game();
        assert!(scrim_blocker_ids(&game, "delegate").is_empty());
    }

    #[test]
    fn advance_blockers_skip_scrim_setup_for_an_unemployed_manager() {
        let mut game = make_unplanned_scrim_window_game();
        game.manager.team_id = None;
        assert!(blockers_for_advance(&game, "delegate").is_empty());
        assert!(scrim_blocker_ids(&game, "live").is_empty());
    }

    #[test]
    fn advance_blockers_skip_scrim_setup_once_the_week_has_an_objective() {
        let mut game = make_unplanned_scrim_window_game();
        game.teams[0].scrim_weekly_objective = Some(olm_core::domain::team::ScrimFocus::Macro);
        assert!(scrim_blocker_ids(&game, "live").is_empty());
    }

    #[test]
    fn advance_blockers_report_an_unresolved_review_in_the_scrim_block() {
        let state = make_manual_scrim_day();
        advance_time_with_mode_internal(&state, "instant").expect("morning advance");
        let game = state.get_game(|g| g.clone()).expect("game");
        assert_eq!(game.day_phase, DayPhase::ScrimBlock);
        assert_eq!(
            scrim_blocker_ids(&game, "live"),
            vec!["scrim_decision_required"]
        );
        // The decision blocks in delegate mode too: only the setup is delegable.
        assert_eq!(
            scrim_blocker_ids(&game, "delegate"),
            vec!["scrim_decision_required"]
        );
    }

    #[test]
    fn advance_blockers_report_no_decision_once_the_review_is_resolved() {
        let state = make_manual_scrim_day();
        advance_time_with_mode_internal(&state, "instant").expect("morning advance");
        force_scrim_win(&state, 0);
        crate::commands::squad::choose_daily_scrim_action_internal(
            &state,
            0,
            "OfferRest".to_string(),
        )
        .expect("offer rest");
        let game = state.get_game(|g| g.clone()).expect("game");
        assert!(scrim_blocker_ids(&game, "live").is_empty());
    }

    #[test]
    fn advance_blockers_report_no_scrim_setup_in_the_scrim_phase() {
        let mut game = make_unplanned_scrim_window_game();
        game.day_phase = DayPhase::ScrimBlock;
        assert!(scrim_blocker_ids(&game, "live").is_empty());
    }

    #[test]
    fn advance_blockers_agree_with_the_advance_command() {
        let state = StateManager::new();
        state.set_game(make_unplanned_scrim_window_game());
        assert_eq!(
            scrim_blocker_ids(&state.get_game(|g| g.clone()).expect("game"), "live"),
            vec!["scrim_setup_required"]
        );
        let response = advance_time_with_mode_internal(&state, "live").expect("blocked setup");
        assert_eq!(response.action, "blocked_scrim_setup");

        let state = make_manual_scrim_day();
        advance_time_with_mode_internal(&state, "instant").expect("morning advance");
        let game = state.get_game(|g| g.clone()).expect("game");
        assert_eq!(scrim_blocker_ids(&game, "live"), vec!["scrim_decision_required"]);
        let response = advance_time_with_mode_internal(&state, "live").expect("blocked decision");
        assert_eq!(response.action, "blocked_scrim_decision");
    }

    #[test]
    fn advance_blockers_check_does_not_mutate_the_game() {
        let state = StateManager::new();
        state.set_game(make_unplanned_scrim_window_game());
        let before = state.get_game(|g| g.day_phase.clone()).expect("game");
        check_blocking_actions_internal(&state, Some("live"), true).expect("check");
        let after = state.get_game(|g| g.day_phase.clone()).expect("game");
        assert_eq!(before, after);
    }

    #[test]
    fn check_blocking_actions_defaults_to_the_live_mode_when_none_is_given() {
        let state = StateManager::new();
        state.set_game(make_unplanned_scrim_window_game());
        let default = check_blocking_actions_internal(&state, None, true).expect("default");
        let live = check_blocking_actions_internal(&state, Some("live"), true).expect("live");
        assert_eq!(default, live);
        assert!(blocker_ids(default.as_array().expect("array"))
            .contains(&"scrim_setup_required".to_string()));
    }

    #[test]
    fn check_blocking_actions_drops_the_scrim_setup_when_the_mode_is_delegate() {
        let state = StateManager::new();
        state.set_game(make_unplanned_scrim_window_game());
        let delegated = check_blocking_actions_internal(&state, Some("delegate"), true).expect("delegate");
        assert!(!blocker_ids(delegated.as_array().expect("array"))
            .contains(&"scrim_setup_required".to_string()));
    }

    #[test]
    fn check_blocking_actions_can_leave_the_scrim_stops_out_for_skip_to_match_day() {
        let state = StateManager::new();
        state.set_game(make_unplanned_scrim_window_game());
        let without = check_blocking_actions_internal(&state, Some("live"), false).expect("skip");
        assert!(!blocker_ids(without.as_array().expect("array"))
            .contains(&"scrim_setup_required".to_string()));
    }
}
