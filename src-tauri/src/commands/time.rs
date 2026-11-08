use log::info;
use tauri::State;

use crate::application::time_advancement::advance_time_with_mode as advance_time_with_mode_service;
pub use crate::application::time_advancement::AdvanceTimeWithModeResponse;
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

#[tauri::command]
pub fn check_blocking_actions(state: State<'_, StateManager>) -> Result<serde_json::Value, String> {
    log::debug!("[cmd] check_blocking_actions");
    let game = state
        .get_game(|g| g.clone())
        .ok_or("No active game session")?;

    let blockers = compute_blocking_actions(&game);
    info!(
        "[cmd] check_blocking_actions: date={}, blocker_count={}",
        game.clock.current_date.format("%Y-%m-%d"),
        blockers.len()
    );
    Ok(serde_json::json!(blockers))
}

#[tauri::command]
pub fn skip_to_match_day(state: State<'_, StateManager>) -> Result<serde_json::Value, String> {
    skip_to_match_day_internal(&state)
}

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
        advance_time_with_mode_internal, compute_blocking_actions, skip_to_match_day_internal,
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

    #[test]
    fn advance_time_with_mode_advances_phase_before_processing_non_match_day() {
        let state = StateManager::new();
        let game = make_game(11);
        let start_date = game.clock.current_date;
        state.set_game(game);

        let response =
            advance_time_with_mode_internal(&state, "delegate").expect("phase advance response");

        assert_eq!(response.action, "phase_advanced");
        let game = response.game.expect("game response");
        assert_eq!(game.day_phase, DayPhase::ScrimBlock);
        assert_eq!(game.clock.current_date, start_date);
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
    fn advance_time_with_mode_processes_day_from_evening_phase() {
        let state = StateManager::new();
        let mut game = make_game(11);
        let start_date = game.clock.current_date;
        game.day_phase = DayPhase::Evening;
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
        assert_eq!(released.action, "phase_advanced");
        assert_eq!(scrim_phase(&state), DayPhase::ReviewBlock);
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
        assert_eq!(released.action, "phase_advanced");
        assert_eq!(scrim_phase(&state), DayPhase::ReviewBlock);
    }

    #[test]
    fn scrim_context_offers_the_review_in_review_block_too() {
        let state = make_manual_scrim_day();
        advance_time_with_mode_internal(&state, "instant").expect("morning advance");
        let mut game = state.get_game(|g| g.clone()).expect("game");
        game.day_phase = DayPhase::ReviewBlock;
        state.set_game(game);

        assert_eq!(
            today_can_review(&state),
            (true, "PlayedNeedsReview".to_string())
        );
    }
}
