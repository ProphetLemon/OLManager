use chrono::Utc;
use crate::domain::stats::StatsState;

use crate::clock::GameClock;
use crate::game::{BoardObjective, DayPhase, Game, ObjectiveType, ScoutingAssignment};

use crate::game_database::GameDatabase;
use crate::repositories::{
    champion_progression_repo, competition_repo, league_repo, manager_repo, message_repo,
    meta_repo, news_repo, objective_repo, player_repo, scouting_repo, social_repo, staff_repo,
    stats_repo, team_repo,transfer_history_repo
};

pub struct GamePersistenceWriter;

impl GamePersistenceWriter {
    pub fn write_game(
        db: &GameDatabase,
        game: &Game,
        save_id: &str,
        save_name: &str,
    ) -> Result<(), String> {
        let conn = db.conn();
        let now = Utc::now().to_rfc3339();

        meta_repo::upsert_meta(
            conn,
            &meta_repo::GameMeta {
                save_id: save_id.to_string(),
                save_name: save_name.to_string(),
                manager_id: game.manager.id.clone(),
                start_date: game.clock.start_date.to_rfc3339(),
                game_date: game.clock.current_date.to_rfc3339(),
                day_phase: game.day_phase.as_id().to_string(),
                created_at: now.clone(),
                last_played_at: now,
            },
        )?;

        manager_repo::upsert_manager(conn, &game.manager)?;
        team_repo::upsert_teams(conn, &game.teams)?;
        player_repo::upsert_players(conn, &game.players)?;
        staff_repo::upsert_staff_list(conn, &game.staff)?;
        message_repo::upsert_messages(conn, &game.messages)?;
        news_repo::upsert_news_list(conn, &game.news)?;
        social_repo::upsert_social_posts(conn, &game.social_posts)?;
        social_repo::upsert_social_accounts(conn, &game.social_accounts)?;
        social_repo::upsert_social_templates(conn, &game.social_templates)?;

        // Persist ALL leagues (not just the active one)
        for league in &game.leagues {
            let config_json = game
                .competition_configs
                .get(&league.id)
                .and_then(|config| serde_json::to_string(config).ok());
            league_repo::upsert_league(conn, league, config_json.as_deref())?;
        }

        let objective_rows: Vec<objective_repo::BoardObjectiveRow> = game
            .board_objectives
            .iter()
            .map(|objective| objective_repo::BoardObjectiveRow {
                id: objective.id.clone(),
                description: objective.description.clone(),
                target: objective.target,
                objective_type: format!("{:?}", objective.objective_type),
                met: objective.met,
            })
            .collect();
        objective_repo::upsert_objectives(conn, &objective_rows)?;

        let scouting_rows: Vec<scouting_repo::ScoutingAssignmentRow> = game
            .scouting_assignments
            .iter()
            .map(|assignment| scouting_repo::ScoutingAssignmentRow {
                id: assignment.id.clone(),
                scout_id: assignment.scout_id.clone(),
                player_id: assignment.player_id.clone(),
                days_remaining: assignment.days_remaining,
            })
            .collect();
        scouting_repo::upsert_scouting_list(conn, &scouting_rows)?;

        champion_progression_repo::upsert_state(
            conn,
            &game.champion_masteries,
            &game.champion_patch,
        )?;

        transfer_history_repo::upsert_transfer_history(conn, &game.transfer_history)?;

        Ok(())
    }
}

impl GamePersistenceWriter {
    pub fn write_stats_state(db: &GameDatabase, stats: &StatsState) -> Result<(), String> {
        stats_repo::replace_stats_state(db.conn(), stats)
    }
}

pub struct GamePersistenceReader;

impl GamePersistenceReader {
    pub fn read_game(db: &GameDatabase) -> Result<Game, String> {
        log::info!("[GamePersistenceReader] read_game: start");
        let conn = db.conn();

        log::info!("[GamePersistenceReader] read_game: loading meta...");
        let meta = meta_repo::load_meta(conn)?
            .ok_or_else(|| "No game_meta found in database".to_string())?;
        log::info!(
            "[GamePersistenceReader] read_game: meta loaded, save_id={}",
            meta.save_id
        );

        let start_date = chrono::DateTime::parse_from_rfc3339(&meta.start_date)
            .map_err(|error| format!("Invalid start_date: {}", error))?
            .with_timezone(&Utc);
        let game_date = chrono::DateTime::parse_from_rfc3339(&meta.game_date)
            .map_err(|error| format!("Invalid game_date: {}", error))?
            .with_timezone(&Utc);

        let mut clock = GameClock::new(start_date);
        clock.current_date = game_date;

        log::info!("[GamePersistenceReader] read_game: loading manager...");
        let manager = manager_repo::load_manager(conn, &meta.manager_id)?
            .ok_or_else(|| format!("Manager '{}' not found", meta.manager_id))?;
        log::info!("[GamePersistenceReader] read_game: loading teams...");
        let teams = team_repo::load_all_teams(conn).map_err(|e| format!("teams: {}", e))?;
        log::info!("[GamePersistenceReader] read_game: loading players...");
        let players = player_repo::load_all_players(conn).map_err(|e| format!("players: {}", e))?;
        log::info!(
            "[GamePersistenceReader] read_game: players loaded: {}",
            players.len()
        );
        log::info!("[GamePersistenceReader] read_game: loading staff...");
        let staff = staff_repo::load_all_staff(conn).map_err(|e| format!("staff: {}", e))?;
        let messages = message_repo::load_all_messages(conn).map_err(|e| format!("messages: {}", e))?;
        let news = news_repo::load_all_news(conn).map_err(|e| format!("news: {}", e))?;
        let social_posts = social_repo::load_all_social_posts(conn).map_err(|e| format!("social_posts: {}", e))?;
        let social_accounts = social_repo::load_social_accounts(conn).map_err(|e| format!("social_accounts: {}", e))?;
        let social_templates = social_repo::load_social_templates(conn).map_err(|e| format!("social_templates: {}", e))?;
        // Load ALL competitions (background leagues survive save/load)
        let (all_leagues, config_jsons) = competition_repo::load_competitions(conn).map_err(|e| format!("competitions: {}", e))?;

        // Parse schedule_config JSON strings into CompetitionManifest objects.
        // Old saves stored bare ScheduleConfig — wrap them in a minimal manifest.
        use crate::generator::definitions::{CompetitionManifest, ScheduleConfig};
        let mut competition_configs = std::collections::HashMap::new();
        for (cid, json_str) in &config_jsons {
            let manifest = match serde_json::from_str::<CompetitionManifest>(json_str) {
                Ok(m) => m,
                Err(_) => {
                    // Old format: just a ScheduleConfig. Build a minimal manifest.
                    if let Ok(config) = serde_json::from_str::<ScheduleConfig>(json_str) {
                        // We don't have the real name here, but the league struct in the
                        // DB has it on its own `name` field, so this is only used for
                        // schedule config lookups.
                        CompetitionManifest {
                            id: cid.clone(),
                            name: cid.clone(),
                            region: String::new(),
                            full_name: None,
                            country: None,
                            tier: None,
                            logo: None,
                            schedule: config,
                            teams_file: "teams.json".to_string(),
                            players_file: "players.json".to_string(),
                            staff_file: None,
                            championships_file: None,
                            erls: Vec::new(),
                            reputation: None,
                            nearby_country_codes: Vec::new(),
                            promotion: None,
                            legacy: false,
                        }
                    } else {
                        continue;
                    }
                }
            };
            competition_configs.insert(cid.clone(), manifest);
        }

        let league = league_repo::load_league(conn)?;
        log::info!(
            "[GamePersistenceReader] read_game: {} competitions loaded, {} configs",
            all_leagues.len(),
            competition_configs.len()
        );

        log::info!("[GamePersistenceReader] read_game: loading objectives...");
        let objective_rows = objective_repo::load_all_objectives(conn)?;
        log::info!(
            "[GamePersistenceReader] read_game: objectives loaded: {}",
            objective_rows.len()
        );
        let board_objectives: Vec<BoardObjective> = objective_rows
            .into_iter()
            .map(|objective| BoardObjective {
                id: objective.id,
                description: objective.description,
                target: objective.target,
                objective_type: parse_objective_type(&objective.objective_type),
                met: objective.met,
            })
            .collect();

        log::info!("[GamePersistenceReader] read_game: loading scouting...");
        let scouting_rows = scouting_repo::load_all_scouting(conn).map_err(|e| format!("scouting: {}", e))?;
        log::info!(

        let (champion_masteries, champion_patch) = champion_progression_repo::load_state(conn)
            .map_err(|e| format!("champion_progression: {}", e))?
            .unwrap_or_else(|| (vec![], crate::champions::ChampionPatchState::default()));

        let transfer_history = transfer_history_repo::load_transfer_history(conn).map_err(|e| format!("transfer_history: {}", e))?;
        log::info!(
            "[GamePersistenceReader] read_game: transfer history entries: {}",
            transfer_history.entries.len()
        );

        let mut game = Game {
            clock,
            day_phase: DayPhase::from_id(&meta.day_phase),
            manager,
            teams,
            players,
            staff,
            messages,
            news,
            social_posts,
            social_accounts,
            social_templates,
            leagues: all_leagues,
            user_competition_id: None,
            scouting_assignments,
            board_objectives,
            season_context: crate::domain::season::SeasonContext::default(),
            days_since_last_job_offer: None,
            champion_masteries,
            champion_patch,
            competition_configs,
            transfer_history,
        };
        // Derive user_competition_id from the manager's team
        game.user_competition_id = game
            .teams
            .iter()
            .find(|t| t.manager_id.as_deref() == Some(&game.manager.id))
            .and_then(|t| t.competition_id.clone());
        crate::season_context::refresh_game_context(&mut game);

        Ok(game)
    }
}

#[cfg(test)]
mod tests {
    use super::{GamePersistenceReader, GamePersistenceWriter};
    use crate::game_database::GameDatabase;
    use chrono::{TimeZone, Utc};
    use crate::champions::{
        ChampionMasteryEntry, ChampionMetaEntry, ChampionPatchChange, ChampionPatchNote,
        ChampionPatchState,
    };
    use crate::clock::GameClock;
    use crate::game::Game;

    fn sample_game() -> Game {
        let start = Utc.with_ymd_and_hms(2026, 7, 1, 0, 0, 0).unwrap();
        let manager = crate::domain::manager::Manager::new(
            "mgr-test".to_string(),
            "John".to_string(),
            "Smith".to_string(),
            "1990-01-01".to_string(),
            "AR".to_string(),
        );

        Game::new(
            GameClock::new(start),
            manager,
            vec![],
            vec![],
            vec![],
            vec![],
        )
    }

    #[test]
    fn test_champion_progression_roundtrip_is_preserved() {
        let db = GameDatabase::open_in_memory().unwrap();
        let mut game = sample_game();

        game.champion_masteries = vec![
            ChampionMasteryEntry {
                player_id: "p-001".to_string(),
                champion_id: "Ahri".to_string(),
                mastery: 74,
                last_active_on: "2026-07-07".to_string(),
            },
            ChampionMasteryEntry {
                player_id: "p-002".to_string(),
                champion_id: "LeeSin".to_string(),
                mastery: 88,
                last_active_on: "2026-07-09".to_string(),
            },
        ];

        game.champion_patch = ChampionPatchState {
            current_patch: 7,
            current_patch_label: "2026.7".to_string(),
            patch_year: 2026,
            patch_index_in_year: 7,
            last_patch_date: Some("2026-07-10".to_string()),
            hidden_meta: vec![ChampionMetaEntry {
                champion_id: "Ahri".to_string(),
                role: "Mid".to_string(),
                tier: "S".to_string(),
            }],
            patch_notes: vec![ChampionPatchNote {
                champion_id: "Ahri".to_string(),
                role: "Mid".to_string(),
                change: ChampionPatchChange::Buff,
            }],
            discovered_champion_ids: vec!["Ahri".to_string(), "LeeSin".to_string()],
            rng_seed: 42,
        };

        GamePersistenceWriter::write_game(&db, &game, "save-1", "Career").unwrap();
        let loaded = GamePersistenceReader::read_game(&db).unwrap();

        assert_eq!(loaded.champion_masteries.len(), 2);
        assert_eq!(loaded.champion_masteries[0].champion_id, "Ahri");
        assert_eq!(loaded.champion_masteries[0].mastery, 74);
        assert_eq!(loaded.champion_masteries[1].champion_id, "LeeSin");
        assert_eq!(loaded.champion_masteries[1].mastery, 88);

        assert_eq!(loaded.champion_patch.current_patch, 7);
        assert_eq!(loaded.champion_patch.current_patch_label, "2026.7");
        assert_eq!(loaded.champion_patch.patch_year, 2026);
        assert_eq!(loaded.champion_patch.patch_index_in_year, 7);
        assert_eq!(
            loaded.champion_patch.last_patch_date.as_deref(),
            Some("2026-07-10")
        );
        assert_eq!(loaded.champion_patch.hidden_meta.len(), 1);
        assert_eq!(loaded.champion_patch.hidden_meta[0].tier, "S");
        assert_eq!(loaded.champion_patch.patch_notes.len(), 1);
        assert!(matches!(
            loaded.champion_patch.patch_notes[0].change,
            ChampionPatchChange::Buff
        ));
        assert_eq!(loaded.champion_patch.discovered_champion_ids.len(), 2);
        assert_eq!(loaded.champion_patch.rng_seed, 42);
    }

    #[test]
    fn test_champion_progression_defaults_when_absent() {
        let db = GameDatabase::open_in_memory().unwrap();
        let game = sample_game();

        GamePersistenceWriter::write_game(&db, &game, "save-1", "Career").unwrap();
        db.conn()
            .execute("DELETE FROM champion_progression_state", [])
            .unwrap();

        let loaded = GamePersistenceReader::read_game(&db).unwrap();

        assert!(loaded.champion_masteries.is_empty());
        assert_eq!(loaded.champion_patch.current_patch, 0);
        assert!(loaded.champion_patch.hidden_meta.is_empty());
        assert!(loaded.champion_patch.patch_notes.is_empty());
        assert!(loaded.champion_patch.discovered_champion_ids.is_empty());
    }
}

impl GamePersistenceReader {
    pub fn read_stats_state(db: &GameDatabase) -> Result<StatsState, String> {
        stats_repo::load_stats_state(db.conn())
    }
}

fn parse_objective_type(value: &str) -> ObjectiveType {
    match value {
        "LeaguePosition" => ObjectiveType::LeaguePosition,
        "Wins" => ObjectiveType::Wins,
        "GoalsScored" => ObjectiveType::GoalsScored,
        _ => ObjectiveType::Wins,
    }
}


