use log::info;
use rand::RngExt;
use tauri::State;

pub use crate::application::live_match::FinishLiveMatchResponse;
use crate::application::live_match::{
    apply_match_command as apply_match_command_service,
    finish_live_match as finish_live_match_service,
    get_match_snapshot as get_match_snapshot_service,
    record_series_game as record_series_game_service, start_live_match as start_live_match_service,
    LolSimMatchReportInput,
};
use olm_core::domain::stats::MatchOutcome;
use olm_core::draft::{
    evaluate_draft_state as evaluate_draft_state_core, DraftStateEvaluation, DraftStateInput,
};
use olm_core::game::Game;
use olm_core::state::StateManager;

fn apply_delta(value: u8, delta: i16) -> u8 {
    ((value as i16) + delta).clamp(10, 100) as u8
}

fn press_effect_delta(effect_id: &str) -> Option<(&'static str, i16)> {
    match effect_id {
        "press_squad_morale_small_up" => Some(("squad", 3)),
        "press_player_pressure_small_down" => Some(("player", -2)),
        "press_no_effect" => Some(("none", 0)),
        _ => None,
    }
}

fn apply_press_conference_effects(
    game: &mut Game,
    answers: &[serde_json::Value],
    user_team_id: &str,
) -> i16 {
    let mut morale_delta: i16 = 0;

    for answer in answers {
        let effect_id = answer
            .get("effect_id")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        let Some((target, delta)) = press_effect_delta(effect_id) else {
            continue;
        };

        match target {
            "squad" => morale_delta += delta,
            "player" => {
                if let Some(player_id) = answer.get("player_id").and_then(|value| value.as_str()) {
                    if let Some(player) = game
                        .players
                        .iter_mut()
                        .find(|player| player.id == player_id)
                    {
                        player.morale = apply_delta(player.morale, delta);
                    }
                }
            }
            _ => {}
        }
    }

    morale_delta = morale_delta.clamp(-8, 8);
    if morale_delta != 0 {
        for player in game.players.iter_mut() {
            if player.team_id.as_deref() == Some(user_team_id) {
                player.morale = apply_delta(player.morale, morale_delta);
            }
        }
    }

    morale_delta
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FixtureChampionPickInput {
    pub player_id: String,
    pub champion_id: String,
}

// ---------------------------------------------------------------------------
// Live Match Commands
// ---------------------------------------------------------------------------

fn finish_live_match_internal(
    state: &StateManager,
    lol_report: Option<LolSimMatchReportInput>,
    locale: Option<&str>,
    data_base: Option<&std::path::Path>,
) -> Result<FinishLiveMatchResponse, String> {
    finish_live_match_service(state, lol_report, locale, data_base)
}

/// Start a live match for a given fixture.
/// mode: "live" | "spectator"
#[tauri::command]
pub fn start_live_match(
    state: State<'_, StateManager>,
    fixture_index: usize,
    mode: String,
    allows_extra_time: bool,
) -> Result<olm_core::engine::MatchSnapshot, String> {
    start_live_match_service(&state, fixture_index, &mode, allows_extra_time)
}

/// Evaluates a completed manual draft without serializing hidden meta or unapproved rival data.
#[tauri::command]
pub fn evaluate_draft_state(
    state: State<'_, StateManager>,
    input: DraftStateInput,
) -> Result<DraftStateEvaluation, String> {
    let game = state
        .get_game(|game: &Game| game.clone())
        .ok_or("No active game session".to_string())?;
    evaluate_draft_state_core(&game, &input)
}

/// Apply a match command (substitution, tactic change, set piece taker, etc.)
#[tauri::command]
pub fn apply_match_command(
    state: State<'_, StateManager>,
    command: olm_core::engine::MatchCommand,
) -> Result<olm_core::engine::MatchSnapshot, String> {
    apply_match_command_service(&state, command)
}

/// Get current match snapshot without advancing time.
#[tauri::command]
pub fn get_match_snapshot(
    state: State<'_, StateManager>,
) -> Result<olm_core::engine::MatchSnapshot, String> {
    get_match_snapshot_service(&state)
}

/// Finish the live match: generate report, update game state, clean up.
#[tauri::command]
pub fn finish_live_match(
    app_handle: tauri::AppHandle,
    state: State<'_, StateManager>,
    lol_report: Option<LolSimMatchReportInput>,
) -> Result<FinishLiveMatchResponse, String> {
    let settings = crate::commands::settings::get_settings(app_handle.clone()).unwrap_or_default();
    let data_base = crate::commands::competitions::resolve_data_base(&app_handle);
    finish_live_match_internal(
        &state,
        lol_report,
        Some(settings.language.as_str()),
        data_base.as_deref(),
    )
}

/// Keep a game of the user's best-of-N series that did not decide it, so that
/// `finish_live_match` stores the true series score and every game's statistics.
/// `game_number` counts from 1; recording a number again replaces that game and later ones.
#[tauri::command]
pub fn record_series_game(
    state: State<'_, StateManager>,
    game_number: u8,
    lol_report: LolSimMatchReportInput,
) -> Result<(), String> {
    record_series_game_service(&state, game_number, lol_report)
}

#[tauri::command]
pub fn record_fixture_champion_picks(
    state: State<'_, StateManager>,
    fixture_id: String,
    winner_team_id: String,
    picks: Vec<FixtureChampionPickInput>,
    bans: Vec<String>,
) -> Result<Game, String> {
    info!(
        "[cmd] record_fixture_champion_picks: fixture={}, picks={}, bans={}",
        fixture_id,
        picks.len(),
        bans.len()
    );

    let mut game = state
        .get_game(|g| g.clone())
        .ok_or("No active game session".to_string())?;

    let league = game
        .active_league_mut()
        .ok_or("No active league in game state".to_string())?;
    let fixture = league
        .fixtures
        .iter_mut()
        .find(|candidate| candidate.id == fixture_id)
        .ok_or_else(|| format!("Fixture not found: {}", fixture_id))?;
    if fixture.result.is_none() {
        return Err("Fixture has no completed result yet".to_string());
    }

    let bans_json = serde_json::to_string(&bans).unwrap_or_default();

    state.with_stats_state(|stats| {
        for record in stats
            .player_matches
            .iter_mut()
            .filter(|record| record.fixture_id == fixture_id)
        {
            record.champion = picks
                .iter()
                .find(|pick| pick.player_id == record.player_id)
                .map(|pick| pick.champion_id.clone());
            record.bans_json = bans_json.clone();
            record.result = if record.team_id == winner_team_id {
                MatchOutcome::Win
            } else {
                MatchOutcome::Loss
            };
        }
    });

    let mastery_picks: Vec<(String, String)> = picks
        .iter()
        .map(|pick| (pick.player_id.clone(), pick.champion_id.clone()))
        .collect();
    olm_core::champions::apply_match_mastery_progress(&mut game, &winner_team_id, &mastery_picks);

    state.set_game(game.clone());
    Ok(crate::client_game::game_for_client(&game))
}

/// Process press conference answers: generate news article, affect squad morale.
/// answers: array of { question_id, response_id, response_tone, response_text, question_text }
#[tauri::command]
#[allow(clippy::too_many_arguments)] // params struct would be an out-of-scope signature refactor
pub fn submit_press_conference(
    state: State<'_, StateManager>,
    answers: Vec<serde_json::Value>,
    home_team: String,
    away_team: String,
    home_score: u8,
    away_score: u8,
    user_team_name: String,
    user_team_id: String,
    prerendered_body: Option<String>,
    prerendered_headline: Option<String>,
) -> Result<serde_json::Value, String> {
    info!(
        "[cmd] submit_press_conference: {} {} - {} {}",
        home_team, home_score, away_score, away_team
    );
    let mut game = state
        .get_game(|g| g.clone())
        .ok_or("No active game session")?;

    let today = game.clock.current_date.format("%Y-%m-%d").to_string();
    let mut rng = rand::rng();

    // Build news article from press conference answers
    let mut quotes: Vec<String> = Vec::new();
    let mut morale_delta: i16 = 0;
    let mut mentioned_player_ids: Vec<String> = Vec::new();
    let has_stable_effects = answers.iter().any(|answer| {
        answer
            .get("effect_id")
            .and_then(|value| value.as_str())
            .is_some_and(|effect_id| !effect_id.is_empty())
    });

    for answer in &answers {
        let tone = answer
            .get("response_tone")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let text = answer
            .get("response_text")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let qid = answer
            .get("question_id")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        if !text.is_empty() {
            quotes.push(format!("\"{}\"", text));
        }

        // Track player mentions
        if let Some(pid) = answer.get("player_id").and_then(|v| v.as_str()) {
            if !pid.is_empty() {
                mentioned_player_ids.push(pid.to_string());
            }
        }

        if !has_stable_effects {
            // Legacy morale effects based on localized tone. Kept only for old payloads.
            match tone {
                "Humble" | "Fair" | "Positive" | "Focused" => {
                    morale_delta += rng.random_range(1..=3)
                }
                "Confident" | "Ambitious" => morale_delta += rng.random_range(2..=5),
                "Defiant" | "Frustrated" => morale_delta += rng.random_range(-2..=2),
                "Curt" | "Evasive" => morale_delta += rng.random_range(-3..=0),
                "Accept" | "Detailed" => morale_delta += rng.random_range(0..=2),
                "Deflect" => morale_delta += rng.random_range(-1..=1),
                "Praise" => morale_delta += rng.random_range(3..=6),
                "Demanding" => morale_delta += rng.random_range(-2..=3),
                _ => {}
            }
        }

        // Legacy player-focused question effects.
        if !has_stable_effects && qid == "player_focus" {
            if let Some(pid) = answer.get("player_id").and_then(|v| v.as_str()) {
                if !pid.is_empty() {
                    let player_delta: i16 = match tone {
                        "Praise" => rng.random_range(4..=8),
                        "Demanding" => rng.random_range(-3..=4),
                        "Deflect" => rng.random_range(-2..=1),
                        _ => rng.random_range(0..=3),
                    };
                    if let Some(p) = game.players.iter_mut().find(|p| p.id == pid) {
                        p.morale = ((p.morale as i16) + player_delta).clamp(10, 100) as u8;
                    }
                }
            }
        }
    }

    if has_stable_effects {
        morale_delta = apply_press_conference_effects(&mut game, &answers, &user_team_id);
    } else {
        // Apply legacy squad-wide morale effect
        morale_delta = morale_delta.clamp(-8, 8);
        if morale_delta != 0 {
            for p in game.players.iter_mut() {
                if p.team_id.as_deref() == Some(&user_team_id) {
                    p.morale = apply_delta(p.morale, morale_delta);
                }
            }
        }
    }

    // Generate news article
    let result_str = format!(
        "{} {} - {} {}",
        home_team, home_score, away_score, away_team
    );
    let headline = prerendered_headline.unwrap_or_else(|| {
        if quotes.is_empty() {
            format!("Post-Match: {} on {}", user_team_name, result_str)
        } else {
            let sources = [
                format!("{} Manager: {}", user_team_name, quotes[0]),
                format!(
                    "Press Conference: \"{}\" — {} boss",
                    quotes[0].trim_matches('"'),
                    user_team_name
                ),
            ];
            sources[rng.random_range(0..sources.len())].clone()
        }
    });

    let body = prerendered_body.unwrap_or_else(|| {
        if quotes.len() > 1 {
            format!(
                "Speaking after the {} result, the {} manager addressed the press.\n\n{}\n\n\
                The conference covered the result, tactical approach, and what lies ahead for the team.",
                result_str, user_team_name,
                quotes.iter().map(|q| format!("• {}", q)).collect::<Vec<_>>().join("\n")
            )
        } else if quotes.len() == 1 {
            format!(
                "The {} manager spoke briefly after the {} result.\n\n{}",
                user_team_name, result_str, quotes[0]
            )
        } else {
            format!(
                "The {} manager declined to speak at length after the {} result.",
                user_team_name, result_str
            )
        }
    });

    let article_id = format!("press_conf_{}", today);
    let article = olm_core::domain::news::NewsArticle::new(
        article_id,
        headline,
        body,
        "Sports Daily".to_string(),
        today.clone(),
        olm_core::domain::news::NewsCategory::MatchReport,
    )
    .with_teams(vec![user_team_id.clone()]);

    game.news.push(article);
    state.set_game(game.clone());

    Ok(serde_json::json!({
        "game": crate::client_game::game_for_client(&game),
        "morale_delta": morale_delta
    }))
}

#[cfg(test)]
mod tests {
    use super::{
        apply_press_conference_effects, finish_live_match_internal,
    };
    use crate::application::live_match::{
        record_series_game, LolSimMatchReportChampionInput, LolSimMatchReportInput, LolSimMatchReportStatsInput,
        LolSimMatchReportTeamStatsInput,
    };
    use chrono::{TimeZone, Utc};
    use olm_core::clock::GameClock;
    use olm_core::domain::league::{
        Fixture, FixtureStatus, League, LeagueKind, MatchType, StandingEntry,
    };
    use olm_core::domain::manager::Manager;
    use olm_core::domain::player::{
        LolRole, Player, PlayerAttributes,
    };
    use olm_core::domain::stats::MatchOutcome;
    use olm_core::domain::team::Team;
    use olm_core::game::Game;
    use olm_core::live_match_manager::{self, MatchMode};
    use olm_core::state::StateManager;

    fn default_attrs(position: LolRole) -> PlayerAttributes {
        let is_goalkeeper = matches!(position, LolRole::Support);

        PlayerAttributes {
            mechanics: if is_goalkeeper { 30 } else { 65 },
            laning: if is_goalkeeper { 30 } else { 65 },
            teamfighting: 65,
            macro_play: 65,
            consistency: 65,
            shotcalling: 50,
            champion_pool: 65,
            discipline: 65,
            mental_resilience: 65,
        }
    }

    fn make_player(id: &str, name: &str, team_id: &str, position: LolRole) -> Player {
        let mut player = Player::new(
            id.to_string(),
            name.to_string(),
            name.to_string(),
            "1995-01-01".to_string(),
            "England".to_string(),
            position,
            default_attrs(position),
        );
        player.team_id = Some(team_id.to_string());
        player.condition = 100;
        player.morale = 70;
        player
    }

    fn make_team(id: &str, name: &str) -> Team {
        Team::new(
            id.to_string(),
            name.to_string(),
            name[..3].to_string(),
            "England".to_string(),
            "London".to_string(),
            "Stadium".to_string(),
            40_000,
        )
    }

    fn make_squad(team_id: &str, prefix: &str) -> Vec<Player> {
        let mut players = Vec::new();
        players.push(make_player(
            &format!("{}_gk", prefix),
            &format!("{} GK", prefix),
            team_id,
            LolRole::Support,
        ));
        for index in 0..4 {
            players.push(make_player(
                &format!("{}_def{}", prefix, index),
                &format!("{} Def{}", prefix, index),
                team_id,
                LolRole::Top,
            ));
        }
        for index in 0..4 {
            players.push(make_player(
                &format!("{}_mid{}", prefix, index),
                &format!("{} Mid{}", prefix, index),
                team_id,
                LolRole::Jungle,
            ));
        }
        for index in 0..2 {
            players.push(make_player(
                &format!("{}_fwd{}", prefix, index),
                &format!("{} Fwd{}", prefix, index),
                team_id,
                LolRole::Adc,
            ));
        }
        players
    }

    fn make_game_with_round() -> Game {
        let clock = GameClock::new(Utc.with_ymd_and_hms(2025, 6, 15, 12, 0, 0).unwrap());
        let mut manager = Manager::new(
            "mgr1".to_string(),
            "Test".to_string(),
            "Manager".to_string(),
            "1980-01-01".to_string(),
            "England".to_string(),
        );
        manager.hire("team1".to_string());

        let teams = vec![
            make_team("team1", "Home FC"),
            make_team("team2", "Away FC"),
            make_team("team3", "Third FC"),
            make_team("team4", "Fourth FC"),
        ];
        let mut players = make_squad("team1", "t1");
        players.extend(make_squad("team2", "t2"));
        players.extend(make_squad("team3", "t3"));
        players.extend(make_squad("team4", "t4"));

        let league = League {
            id: "league1".to_string(),
            name: "Test League".to_string(),
            season: 1,
            competition_id: None,
            logo: None,
            league_kind: LeagueKind::Main,
            split_index: 0,
            tier: 0,
            active: false,
            fixtures: vec![Fixture {
                id: "fix1".to_string(),
                matchday: 1,
                date: "2025-06-15".to_string(),
                home_team_id: "team1".to_string(),
                away_team_id: "team2".to_string(),
                match_type: MatchType::League,
                best_of: 1,
                status: FixtureStatus::Scheduled,
                result: None,
            }],
            standings: vec![
                StandingEntry::new("team1".to_string()),
                StandingEntry::new("team2".to_string()),
                StandingEntry::new("team3".to_string()),
                StandingEntry::new("team4".to_string()),
            ],
        };

        let mut game = Game::new(clock, manager, teams, players, vec![], vec![]);
        game.leagues = vec![league];
        game
    }

    #[test]
    fn stable_press_effect_id_applies_squad_morale_once() {
        let mut game = make_game_with_round();
        apply_press_conference_effects(
            &mut game,
            &[serde_json::json!({ "effect_id": "press_squad_morale_small_up" })],
            "team1",
        );

        let team_morale: Vec<u8> = game
            .players
            .iter()
            .filter(|player| player.team_id.as_deref() == Some("team1"))
            .map(|player| player.morale)
            .collect();
        let opponent_morale: Vec<u8> = game
            .players
            .iter()
            .filter(|player| player.team_id.as_deref() == Some("team2"))
            .map(|player| player.morale)
            .collect();

        assert!(team_morale.iter().all(|morale| *morale == 73));
        assert!(opponent_morale.iter().all(|morale| *morale == 70));
    }

    #[test]
    fn stable_press_effect_id_applies_player_morale_once() {
        let mut game = make_game_with_round();
        apply_press_conference_effects(
            &mut game,
            &[
                serde_json::json!({
                    "effect_id": "press_player_pressure_small_down",
                    "player_id": "t1_mid0"
                }),
                serde_json::json!({ "effect_id": "press_no_effect", "player_id": "t1_mid0" }),
            ],
            "team1",
        );

        let focused = game
            .players
            .iter()
            .find(|player| player.id == "t1_mid0")
            .unwrap();
        let teammate = game
            .players
            .iter()
            .find(|player| player.id == "t1_mid1")
            .unwrap();

        assert_eq!(focused.morale, 68);
        assert_eq!(teammate.morale, 70);
    }

    #[test]
    fn finish_live_match_returns_completed_round_summary_response() {
        let state = StateManager::new();
        let mut game = make_game_with_round();
        let today = game.clock.current_date.format("%Y-%m-%d").to_string();
        olm_core::turn::simulate_other_matches(&mut game, &today, Some(0));

        let mut session =
            live_match_manager::create_live_match(&game, 0, MatchMode::Instant, false).unwrap();
        session.user_side = None;
        session.run_to_completion();

        state.set_game(game);
        state.set_live_match(session);

        let response = finish_live_match_internal(&state, None, None, None)
            .expect("finish live match response");

        let round_summary = response.round_summary.expect("round summary response");
        assert!(round_summary.is_complete);
        assert_eq!(round_summary.pending_fixture_count, 0);
        // The fixture builder defines one match in matchday 1; the summary includes
        // completed fixtures from that matchday, not every team in the standings.
        assert_eq!(round_summary.completed_results.len(), 1);
        assert_eq!(
            response
                .game
                .clock
                .current_date
                .format("%Y-%m-%d")
                .to_string(),
            "2025-06-16"
        );
    }
    /// The five players of a test squad that take the field, in role order.
    const SQUAD_SLOTS: [&str; 5] = ["gk", "def0", "mid0", "mid1", "fwd0"];

    fn sim_champions(
        prefix: &str,
        team: &str,
        kills: u16,
        deaths: u16,
    ) -> Vec<LolSimMatchReportChampionInput> {
        SQUAD_SLOTS
            .iter()
            .enumerate()
            .map(|(slot, name)| LolSimMatchReportChampionInput {
                id: format!("{prefix}_{name}"),
                name: format!("{prefix} {name}"),
                team: team.to_string(),
                role: "MID".to_string(),
                // The first player carries the team's kills and deaths, so a series total is
                // easy to read; everyone assists once.
                kills: if slot == 0 { kills } else { 0 },
                deaths: if slot == 0 { deaths } else { 0 },
                assists: 1,
                cs: 100,
                gold: 500,
                spent_gold: 5_000,
                damage_dealt: 1_000.0,
            })
            .collect()
    }

    fn sim_team_stats(kills: u16, deaths: u16) -> LolSimMatchReportTeamStatsInput {
        LolSimMatchReportTeamStatsInput {
            kills,
            deaths,
            gold: 40_000,
            towers: 5,
            dragons: 2,
            barons: 1,
        }
    }

    /// One game as the frontend reports it: the `blue_prefix` squad plays blue.
    fn sim_game(
        blue_prefix: &str,
        red_prefix: &str,
        winner: &str,
        blue_kills: u16,
        red_kills: u16,
    ) -> LolSimMatchReportInput {
        let mut champions = sim_champions(blue_prefix, "blue", blue_kills, red_kills);
        champions.extend(sim_champions(red_prefix, "red", red_kills, blue_kills));
        LolSimMatchReportInput {
            winner: Some(winner.to_string()),
            time_sec: 1_800.0,
            events: vec![],
            stats: LolSimMatchReportStatsInput {
                blue: sim_team_stats(blue_kills, red_kills),
                red: sim_team_stats(red_kills, blue_kills),
            },
            champions,
            blue_team_id: None,
        }
    }

    /// A live session for fixture 0 (team1 home, team2 away) with `user_team` managed.
    fn state_with_live_session(user_team: &str, best_of: u8) -> StateManager {
        let state = StateManager::new();
        let mut game = make_game_with_round();
        game.manager.hire(user_team.to_string());
        game.leagues[0].fixtures[0].best_of = best_of;
        let today = game.clock.current_date.format("%Y-%m-%d").to_string();
        olm_core::turn::simulate_other_matches(&mut game, &today, Some(0));
        let session =
            live_match_manager::create_live_match(&game, 0, MatchMode::Live, false).unwrap();
        state.set_game(game);
        state.set_live_match(session);
        state
    }

    fn played_game(state: &StateManager) -> Game {
        state.get_game(|game| game.clone()).expect("game")
    }

    fn fixture_score(game: &Game) -> (u8, u8) {
        let result = game.active_league().unwrap().fixtures[0]
            .result
            .as_ref()
            .expect("fixture result");
        (result.home_wins, result.away_wins)
    }

    fn standing<'a>(game: &'a Game, team_id: &str) -> &'a StandingEntry {
        game.active_league()
            .unwrap()
            .standings
            .iter()
            .find(|entry| entry.team_id == team_id)
            .expect("standing")
    }

    #[test]
    fn a_game_won_by_the_away_team_on_blue_is_credited_to_the_away_team() {
        let state = state_with_live_session("team2", 1);

        finish_live_match_internal(
            &state,
            Some(sim_game("t2", "t1", "blue", 10, 4)),
            None,
            None,
        )
        .expect("finish");

        let game = played_game(&state);
        assert_eq!(fixture_score(&game), (0, 1));
        assert_eq!(standing(&game, "team2").won, 1);
        assert_eq!(standing(&game, "team1").lost, 1);
    }

    #[test]
    fn team_stats_of_the_away_team_on_blue_land_on_the_away_team() {
        let state = state_with_live_session("team2", 1);

        finish_live_match_internal(
            &state,
            Some(sim_game("t2", "t1", "blue", 10, 4)),
            None,
            None,
        )
        .expect("finish");

        let rows = state.with_stats_state(|stats| stats.team_matches.clone());
        let away = rows
            .iter()
            .find(|row| row.team_id == "team2")
            .expect("away row");
        assert_eq!(
            (away.kills, away.deaths, away.result),
            (10, 4, MatchOutcome::Win)
        );
        let home = rows
            .iter()
            .find(|row| row.team_id == "team1")
            .expect("home row");
        assert_eq!(
            (home.kills, home.deaths, home.result),
            (4, 10, MatchOutcome::Loss)
        );
    }

    #[test]
    fn a_game_won_by_the_home_team_on_red_is_credited_to_the_home_team() {
        let state = state_with_live_session("team1", 1);

        finish_live_match_internal(&state, Some(sim_game("t2", "t1", "red", 4, 10)), None, None)
            .expect("finish");

        let game = played_game(&state);
        assert_eq!(fixture_score(&game), (1, 0));
        assert_eq!(standing(&game, "team1").won, 1);
    }

    #[test]
    fn a_game_with_the_home_team_on_blue_keeps_the_usual_mapping() {
        let state = state_with_live_session("team1", 1);

        finish_live_match_internal(
            &state,
            Some(sim_game("t1", "t2", "blue", 10, 4)),
            None,
            None,
        )
        .expect("finish");

        assert_eq!(fixture_score(&played_game(&state)), (1, 0));
    }
    // -----------------------------------------------------------------------
    // A best-of-N series the user plays game by game
    // -----------------------------------------------------------------------

    /// Game 1 of the sample series: team1 (home) wins on blue, 10 kills to 4.
    fn game_one() -> LolSimMatchReportInput {
        sim_game("t1", "t2", "blue", 10, 4)
    }

    /// Game 2: team2 wins on blue (team1 on red), 9 kills to 3.
    fn game_two() -> LolSimMatchReportInput {
        sim_game("t2", "t1", "blue", 9, 3)
    }

    /// Game 3: team1 wins on blue again, 12 kills to 6.
    fn game_three() -> LolSimMatchReportInput {
        sim_game("t1", "t2", "blue", 12, 6)
    }

    /// Plays a series for `user_team`: records every game but the last, then finishes with it.
    fn play_series(
        user_team: &str,
        best_of: u8,
        games: Vec<LolSimMatchReportInput>,
    ) -> StateManager {
        let state = state_with_live_session(user_team, best_of);
        let mut games = games;
        let last = games.pop().expect("a series has games");
        for (index, game) in games.into_iter().enumerate() {
            record_series_game(&state, index as u8 + 1, game).expect("record game");
        }
        finish_live_match_internal(&state, Some(last), None, None).expect("finish");
        state
    }

    #[test]
    fn a_two_one_series_stores_two_one_in_the_fixture() {
        let state = play_series("team1", 3, vec![game_one(), game_two(), game_three()]);

        assert_eq!(fixture_score(&played_game(&state)), (2, 1));
    }

    #[test]
    fn a_two_one_series_counts_every_map_in_the_standings() {
        let state = play_series("team1", 3, vec![game_one(), game_two(), game_three()]);

        let game = played_game(&state);
        let winner = standing(&game, "team1");
        let loser = standing(&game, "team2");
        assert_eq!((winner.maps_won, winner.maps_lost), (2, 1));
        assert_eq!((loser.maps_won, loser.maps_lost), (1, 2));
    }

    #[test]
    fn a_two_one_series_still_counts_as_one_played_win() {
        let state = play_series("team1", 3, vec![game_one(), game_two(), game_three()]);

        let game = played_game(&state);
        let winner = standing(&game, "team1");
        assert_eq!((winner.played, winner.won, winner.points), (1, 1, 3));
    }

    #[test]
    fn a_two_zero_sweep_gives_a_map_difference_of_two() {
        let state = play_series("team1", 3, vec![game_one(), game_three()]);

        let game = played_game(&state);
        let winner = standing(&game, "team1");
        assert_eq!(winner.maps_won - winner.maps_lost, 2);
    }

    #[test]
    fn the_users_players_season_totals_include_every_game_of_the_series() {
        let state = play_series("team1", 3, vec![game_one(), game_two(), game_three()]);

        let game = played_game(&state);
        let player = game
            .players
            .iter()
            .find(|p| p.id == "t1_gk")
            .expect("player");
        // 10 + 3 + 12 kills, one assist per game, 30 minutes per game.
        assert_eq!(
            (
                player.stats.kills,
                player.stats.assists,
                player.stats.minutes_played
            ),
            (25, 3, 90)
        );
    }

    #[test]
    fn the_series_stats_row_sums_kills_deaths_and_farm_of_every_game() {
        let state = play_series("team1", 3, vec![game_one(), game_two(), game_three()]);

        let rows = state.with_stats_state(|stats| stats.player_matches.clone());
        let row = rows
            .iter()
            .find(|row| row.player_id == "t1_gk")
            .expect("row");
        assert_eq!(
            (
                row.kills,
                row.deaths,
                row.assists,
                row.creep_score,
                row.duration_seconds
            ),
            (25, 19, 3, 300, 5_400)
        );
    }

    #[test]
    fn the_series_team_row_sums_both_teams_over_the_games() {
        let state = play_series("team1", 3, vec![game_one(), game_two(), game_three()]);

        let rows = state.with_stats_state(|stats| stats.team_matches.clone());
        let team = rows.iter().find(|row| row.team_id == "team1").expect("row");
        assert_eq!(
            (team.kills, team.deaths, team.result),
            (25, 19, MatchOutcome::Win)
        );
    }

    #[test]
    fn a_series_the_away_user_wins_credits_the_away_team() {
        // team2 (away, the user) wins games 1 and 3 and loses game 2.
        let state = play_series(
            "team2",
            3,
            vec![
                sim_game("t2", "t1", "blue", 10, 4),
                sim_game("t1", "t2", "blue", 9, 3),
                sim_game("t1", "t2", "red", 6, 12),
            ],
        );

        let game = played_game(&state);
        assert_eq!(fixture_score(&game), (1, 2));
        assert_eq!(standing(&game, "team2").maps_won, 2);
    }

    #[test]
    fn a_best_of_five_sweep_earns_the_fan_bonus() {
        let state = state_with_live_session("team1", 5);
        state.with_session_mut(|session| {
            session.game.as_mut().expect("game").manager.fan_approval = 50;
        });
        record_series_game(&state, 1, game_one()).expect("record game 1");
        record_series_game(&state, 2, game_three()).expect("record game 2");

        finish_live_match_internal(&state, Some(sim_game("t1", "t2", "blue", 8, 2)), None, None)
            .expect("finish");

        // +5 for the win and +3 for a three-game margin.
        assert_eq!(played_game(&state).manager.fan_approval, 58);
    }

    #[test]
    fn a_session_without_recorded_games_finishes_as_a_single_game() {
        let state = state_with_live_session("team1", 3);

        finish_live_match_internal(&state, Some(game_one()), None, None).expect("finish");

        assert_eq!(fixture_score(&played_game(&state)), (1, 0));
    }

    #[test]
    fn recording_a_game_again_replaces_it_instead_of_adding_a_game() {
        let state = state_with_live_session("team1", 3);
        record_series_game(&state, 1, game_one()).expect("record game 1");
        record_series_game(&state, 1, game_one()).expect("retry game 1");

        finish_live_match_internal(&state, Some(game_three()), None, None).expect("finish");

        assert_eq!(fixture_score(&played_game(&state)), (2, 0));
    }

    #[test]
    fn a_new_live_session_does_not_inherit_the_recorded_games_of_the_old_one() {
        let state = state_with_live_session("team1", 3);
        record_series_game(&state, 1, game_one()).expect("record game 1");
        let fresh = state.with_session_mut(|session| {
            let game = session.game.as_ref().expect("game");
            live_match_manager::create_live_match(game, 0, MatchMode::Live, false).unwrap()
        });
        state.set_live_match(fresh);

        finish_live_match_internal(&state, Some(game_three()), None, None).expect("finish");

        assert_eq!(fixture_score(&played_game(&state)), (1, 0));
    }

    #[test]
    fn recorded_games_that_do_not_make_a_decided_series_fall_back_to_the_last_game() {
        let state = state_with_live_session("team1", 3);
        record_series_game(&state, 1, game_one()).expect("record game 1");

        // Game 2 was lost, so 1-1 is not a finished series: the last game stands alone.
        finish_live_match_internal(&state, Some(game_two()), None, None).expect("finish");

        assert_eq!(fixture_score(&played_game(&state)), (0, 1));
    }

    #[test]
    fn a_report_less_finish_ignores_the_recorded_games() {
        let state = state_with_live_session("team1", 3);
        record_series_game(&state, 1, game_one()).expect("record game 1");
        state.with_live_match(|session| {
            session.run_to_completion();
        });

        finish_live_match_internal(&state, None, None, None).expect("finish");

        let (home, away) = fixture_score(&played_game(&state));
        assert_eq!(home + away, 1);
    }

    #[test]
    fn a_best_of_one_takes_no_recorded_game() {
        let state = state_with_live_session("team1", 1);

        assert!(record_series_game(&state, 1, game_one()).is_err());
    }

    #[test]
    fn a_game_that_decides_the_series_is_not_recorded() {
        let state = state_with_live_session("team1", 3);
        record_series_game(&state, 1, game_one()).expect("record game 1");

        assert!(record_series_game(&state, 2, game_three()).is_err());
    }

    #[test]
    fn a_game_after_the_best_of_games_is_not_recorded() {
        let state = state_with_live_session("team1", 3);

        assert!(record_series_game(&state, 4, game_one()).is_err());
    }

    #[test]
    fn a_game_recorded_before_the_ones_it_follows_is_not_recorded() {
        let state = state_with_live_session("team1", 5);

        assert!(record_series_game(&state, 2, game_one()).is_err());
    }

    #[test]
    fn game_numbers_start_at_one() {
        let state = state_with_live_session("team1", 3);

        assert!(record_series_game(&state, 0, game_one()).is_err());
    }

    #[test]
    fn recording_needs_an_active_live_match() {
        let state = StateManager::new();

        assert!(record_series_game(&state, 1, game_one()).is_err());
    }
    #[test]
    fn a_game_without_champions_is_credited_by_the_blue_team_the_frontend_names() {
        let state = state_with_live_session("team2", 1);
        let mut report = sim_game("t2", "t1", "blue", 10, 4);
        report.champions.clear();
        report.blue_team_id = Some("team2".to_string());

        finish_live_match_internal(&state, Some(report), None, None).expect("finish");

        assert_eq!(fixture_score(&played_game(&state)), (0, 1));
    }

    #[test]
    fn a_game_without_champions_or_blue_team_keeps_blue_as_home() {
        let state = state_with_live_session("team2", 1);
        let mut report = sim_game("t2", "t1", "blue", 10, 4);
        report.champions.clear();

        finish_live_match_internal(&state, Some(report), None, None).expect("finish");

        assert_eq!(fixture_score(&played_game(&state)), (1, 0));
    }

    #[test]
    fn a_blue_team_that_is_in_neither_side_of_the_fixture_falls_back_to_the_players() {
        let state = state_with_live_session("team2", 1);
        let mut report = sim_game("t2", "t1", "blue", 10, 4);
        report.blue_team_id = Some("team9".to_string());

        finish_live_match_internal(&state, Some(report), None, None).expect("finish");

        assert_eq!(fixture_score(&played_game(&state)), (0, 1));
    }
}
