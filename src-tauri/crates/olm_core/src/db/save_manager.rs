use chrono::Utc;
use log::{debug, info};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use crate::game::Game;

use crate::db::save_index::SaveEntry;
use crate::db::save_index_manager::SaveIndexManager;

/// Current save format version. Increment when breaking changes are made.
const FORMAT_VERSION: u32 = 3;

/// Manages save sessions: creating, loading, saving, deleting, and listing.
pub struct SaveManager {
    saves_dir: PathBuf,
    save_index: SaveIndexManager,
}

impl SaveManager {
    /// Initialize the SaveManager, loading or rebuilding the save index.
    pub fn init(saves_dir: &Path) -> Result<Self, String> {
        fs::create_dir_all(saves_dir)
            .map_err(|e| format!("Failed to create saves directory: {}", e))?;
        let save_index = SaveIndexManager::init(saves_dir)?;

        let mut mgr = Self {
            saves_dir: saves_dir.to_path_buf(),
            save_index,
        };

        // Prune entries whose .olsave files have wrong format version
        mgr.prune_incompatible_saves();

        Ok(mgr)
    }

    /// Remove save entries whose .olsave files have an incompatible format version.
    fn prune_incompatible_saves(&mut self) {
        let to_remove: Vec<String> = self
            .save_index
            .list_saves()
            .iter()
            .filter(|entry| {
                let path = self.save_path(&entry.id);
                if !path.exists() {
                    return true;
                }
                match Self::read_olsave_version(&path) {
                    Ok(v) => v != FORMAT_VERSION,
                    Err(_) => true,
                }
            })
            .map(|entry| entry.id.clone())
            .collect();

        for id in &to_remove {
            let path = self.save_path(id);
            let _ = fs::remove_file(&path);
            let _ = self.save_index.remove_save(id);
        }
    }

    /// Read only the format version from an .olsave file (first 4 bytes).
    fn read_olsave_version(path: &Path) -> Result<u32, String> {
        let mut file = fs::File::open(path).map_err(|e| format!("Failed to open: {}", e))?;
        let mut buf = [0u8; 4];
        file.read_exact(&mut buf)
            .map_err(|e| format!("Failed to read version: {}", e))?;
        Ok(u32::from_le_bytes(buf))
    }

    /// List all save entries.
    pub fn list_saves(&self) -> &[SaveEntry] {
        self.save_index.list_saves()
    }

    /// Path to the .olsave file for a given save_id.
    fn save_path(&self, save_id: &str) -> PathBuf {
        self.saves_dir.join(format!("{}.olsave", save_id))
    }

    /// Write a Game to a .olsave file at the given path using atomic tmp+rename.
    /// Format: FORMAT_VERSION (u32 LE) + gzipped JSON of the Game.
    fn write_olsave(path: &Path, game: &Game) -> Result<(), String> {
        let tmp_path = path.with_extension("olsave.tmp");

        // Serialize to JSON, then gzip
        use flate2::Compression;
        use flate2::write::GzEncoder;
        use std::io::Write;

        let json = serde_json::to_string(game)
            .map_err(|e| format!("Failed to JSON-serialize game: {e}"))?;

        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder
            .write_all(json.as_bytes())
            .map_err(|e| format!("Failed to gzip game: {e}"))?;
        let compressed = encoder
            .finish()
            .map_err(|e| format!("Failed to finalize gzip: {e}"))?;

        let mut file = fs::File::create(&tmp_path)
            .map_err(|e| format!("Failed to create temp file: {}", e))?;

        // Write format version (u32, little-endian)
        file.write_all(&FORMAT_VERSION.to_le_bytes())
            .map_err(|e| format!("Failed to write format version: {}", e))?;

        // Write compressed JSON
        file.write_all(&compressed)
            .map_err(|e| format!("Failed to write game data: {}", e))?;

        file.flush()
            .map_err(|e| format!("Failed to flush: {}", e))?;

        // Atomic rename: tmp → target
        fs::rename(&tmp_path, path).map_err(|e| format!("Failed to rename temp file: {}", e))?;

        Ok(())
    }

    /// Read a Game from a .olsave file.
    fn read_olsave(path: &Path) -> Result<Game, String> {
        let file_size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        let bytes = fs::read(path).unwrap_or_default();

        if bytes.len() < 4 {
            return Err(format!(
                "Save file too small: {} bytes (path={:?})",
                bytes.len(),
                path
            ));
        }

        // Read format version (u32, little-endian)
        let version_bytes: [u8; 4] = bytes[0..4].try_into().unwrap();
        let version = u32::from_le_bytes(version_bytes);

        // Dump first bytes for debugging
        let hex_preview: Vec<String> = bytes
            .iter()
            .take(32)
            .map(|b| format!("{:02x}", b))
            .collect();
        let hex_str = hex_preview.join(" ");

        if version != FORMAT_VERSION {
            return Err(format!(
                "Unsupported save format version: {}. Expected: {} (file={}B, hex={})",
                version, FORMAT_VERSION, file_size, hex_str
            ));
        }

        // Decompress gzipped JSON and deserialize
        let game: Game = match (|| -> Result<Game, String> {
            use flate2::read::GzDecoder;
            use std::io::Read;

            let mut decoder = GzDecoder::new(&bytes[4..]);
            let mut json_str = String::new();
            decoder
                .read_to_string(&mut json_str)
                .map_err(|e| format!("Failed to decompress save: {e}"))?;

            serde_json::from_str(&json_str).map_err(|e| format!("Failed to parse JSON save: {e}"))
        })() {
            Ok(g) => g,
            Err(e) => {
                return Err(format!(
                    "Failed to load game (v={}, file={}B, path={:?}, hex={}): {}",
                    version, file_size, path, hex_str, e
                ));
            }
        };

        Ok(game)
    }

    /// Create a new save from the current in-memory Game state.
    /// Returns the save_id.
    pub fn create_save(&mut self, game: &Game, save_name: &str) -> Result<String, String> {
        // Self-test: verify JSON roundtrip before writing to disk
        let json = serde_json::to_string(game)
            .map_err(|e| format!("[serde-test] JSON serialize failed: {e}"))?;
        let back: Game = serde_json::from_str(&json).map_err(|e| {
            format!(
                "[serde-test] JSON deserialize failed ({}B JSON): {e}",
                json.len()
            )
        })?;
        if back.clock.current_date != game.clock.current_date {
            return Err("[serde-test] roundtrip mismatch: clock.current_date differs".into());
        }
        let save_id = uuid::Uuid::new_v4().to_string();
        let save_path = self.save_path(&save_id);

        debug!(
            "[save_manager] creating save {} at {:?}",
            save_id, save_path
        );

        Self::write_olsave(&save_path, game)?;

        let now = Utc::now().to_rfc3339();
        let manager_name = game.manager.display_name();

        let entry = SaveEntry {
            id: save_id.clone(),
            name: save_name.to_string(),
            manager_name,
            created_at: now.clone(),
            last_played_at: now,
        };

        self.save_index.record_new_save(entry)?;

        info!("[save_manager] created save {}", save_id);
        Ok(save_id)
    }

    /// Save the current Game state to an existing save.
    pub fn save_game(&mut self, game: &Game, save_id: &str) -> Result<(), String> {
        let entry = self
            .save_index
            .find(save_id)
            .ok_or_else(|| format!("Save '{}' not found", save_id))?;

        let save_path = self.save_path(save_id);
        let save_name = entry.name.clone();

        Self::write_olsave(&save_path, game)?;

        let now = Utc::now().to_rfc3339();
        let manager_name = game.manager.display_name();

        self.save_index.update_save(SaveEntry {
            id: save_id.to_string(),
            name: save_name,
            manager_name,
            created_at: entry.created_at.clone(),
            last_played_at: now,
        })?;

        info!("[save_manager] saved game to {}", save_id);
        Ok(())
    }

    /// Load a Game from a save file.
    pub fn load_game(&mut self, save_id: &str) -> Result<Game, String> {
        info!("[save_manager] load_game: start for {}", save_id);
        let _entry = self
            .save_index
            .find(save_id)
            .ok_or_else(|| format!("Save '{}' not found", save_id))?
            .clone();

        let save_path = self.save_path(save_id);
        info!("[save_manager] load_game: loading from {:?}", save_path);

        let mut game = Self::read_olsave(&save_path)?;

        // Migration: re-derive `competition_id` for leagues where it was
        // lost (old saves before the field existed).  Try to find any team
        // in the league's standings that has a known competition_id and
        // propagate it back to the league.
        for league in &mut game.leagues {
            if league.competition_id.is_some() {
                continue;
            }
            if let Some(tid) = league.standings.first().map(|s| s.team_id.as_str())
                && let Some(cid) = game
                    .teams
                    .iter()
                    .find(|t| t.id == tid)
                    .and_then(|t| t.competition_id.clone())
                {
                    league.competition_id = Some(cid);
                    info!(
                        "[save_manager] migrated competition_id={:?} for league '{}'",
                        league.competition_id, league.name
                    );
                }
        }

        // Migration: saves from before the import rule treat everyone on a team
        // as a resident of that team's league region (runs once per game).
        let grandfathered = crate::residency::grandfather_rostered_players(&mut game);
        crate::residency::refresh_import_flags(&mut game);
        if grandfathered > 0 {
            info!(
                "[save_manager] grandfathered residency for {} rostered players",
                grandfathered
            );
        }

        info!(
            "[save_manager] load_game: loaded, players={}, teams={}",
            game.players.len(),
            game.teams.len()
        );

        Ok(game)
    }

    /// Delete a save (removes .olsave file and index entry).
    pub fn delete_save(&mut self, save_id: &str) -> Result<bool, String> {
        if self.save_index.find(save_id).is_none() {
            return Ok(false);
        }

        let save_path = self.save_path(save_id);
        if save_path.exists() {
            fs::remove_file(&save_path)
                .map_err(|e| format!("Failed to delete save file: {}", e))?;
            debug!("[save_manager] deleted file {:?}", save_path);
        }

        // Also clean up any leftover .olsave.tmp files
        let tmp_path = save_path.with_extension("olsave.tmp");
        if tmp_path.exists() {
            let _ = fs::remove_file(&tmp_path);
        }

        self.save_index.remove_save(save_id)?;
        info!("[save_manager] deleted save {}", save_id);
        Ok(true)
    }

    /// Create a new game by loading an existing save, stripping session data,
    /// and resetting the clock. Returns the loaded Game with clean session state.
    /// This does NOT create a new save — the caller should use `create_save` afterwards.
    pub fn new_game_from_save(&mut self, source_save_id: &str) -> Result<Game, String> {
        let mut game = self.load_game(source_save_id)?;

        // Strip session-specific data
        game.messages.clear();
        game.news.clear();
        game.scouting_assignments.clear();
        game.board_objectives.clear();

        // Reset clock to start date
        game.clock.current_date = game.clock.start_date;
        game.day_phase = crate::game::DayPhase::Morning;

        // Reset manager
        game.manager.satisfaction = 100;
        game.manager.fan_approval = 50;
        game.manager.career_stats = Default::default();
        game.manager.career_history.clear();

        // Reset team season data
        for team in &mut game.teams {
            team.form.clear();
            team.season_income = 0;
            team.season_expenses = 0;
        }

        // Reset player stats
        for player in &mut game.players {
            player.stats = Default::default();
            player.transfer_listed = false;
            player.loan_listed = false;
            player.transfer_offers.clear();
        }

        // Clear league (will be regenerated)
        game.leagues.clear();

        info!(
            "[save_manager] created new game template from save {}",
            source_save_id
        );
        Ok(game)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::GameClock;
    use crate::domain::manager::Manager;
    use crate::domain::player::{Player, PlayerAttributes};
    use crate::domain::staff::{Staff, StaffAttributes, StaffRole};
    use crate::domain::team::Team;
    use crate::game::BoardObjective;
    use chrono::TimeZone;

    fn sample_game() -> Game {
        let start = Utc.with_ymd_and_hms(2026, 7, 1, 0, 0, 0).unwrap();
        let mut clock = GameClock::new(start);
        clock.current_date = Utc.with_ymd_and_hms(2026, 8, 15, 0, 0, 0).unwrap();

        let mut manager = Manager::new(
            "mgr-user".to_string(),
            "John".to_string(),
            "Smith".to_string(),
            "1990-01-15".to_string(),
            "British".to_string(),
        );
        manager.hire("team-001".to_string());

        let team = Team::new(
            "team-001".to_string(),
            "London FC".to_string(),
            "LFC".to_string(),
            "GB".to_string(),
            "London".to_string(),
            "London Stadium".to_string(),
            50000,
        );

        let player = Player::new(
            "p-001".to_string(),
            "J. Doe".to_string(),
            "John Doe".to_string(),
            "2000-01-01".to_string(),
            "GB".to_string(),
            crate::domain::stats::LolRole::Mid,
            PlayerAttributes {
                mechanics: 68,
                laning: 60,
                teamfighting: 80,
                macro_play: 78,
                consistency: 70,
                shotcalling: 45,
                champion_pool: 72,
                discipline: 60,
                mental_resilience: 75,
            },
        );

        let staff = Staff::new(
            "staff-001".to_string(),
            "Alice".to_string(),
            "Coach".to_string(),
            "1980-05-10".to_string(),
            StaffRole::Coach,
            StaffAttributes {
                coaching: 75,
                judging_ability: 60,
                judging_potential: 55,
                physiotherapy: 40,
            },
        );

        Game {
            clock,
            day_phase: crate::game::DayPhase::Morning,
            manager,
            teams: vec![team],
            players: vec![player],
            staff: vec![staff],
            messages: vec![],
            news: vec![],
            social_posts: vec![],
            social_accounts: vec![],
            social_templates: vec![],
            leagues: vec![],
            user_competition_id: None,
            scouting_assignments: vec![],
            board_objectives: vec![],
            season_context: crate::domain::season::SeasonContext::default(),
            days_since_last_job_offer: None,
            champion_masteries: vec![],
            champion_patch: Default::default(),
            stats_state: Default::default(),
            competition_configs: std::collections::HashMap::new(),
            transfer_history: Default::default(),
            ai_transfer_cap_counts: Default::default(),
            ai_transfer_cap_last_reset_date: None,
            sent_contract_warning_ids: Default::default(),
            moved_player_ids: Default::default(),
            retired_player_ids: Default::default(),
            world_overlay_as_of: None,
            residency_initialized: false,
            removed_team_ids: Default::default(),
        }
    }

    #[test]
    fn test_init_creates_directory() {
        let dir = tempfile::tempdir().unwrap();
        let saves_dir = dir.path().join("saves");

        let sm = SaveManager::init(&saves_dir).unwrap();
        assert!(saves_dir.exists());
        assert!(sm.list_saves().is_empty());
    }

    #[test]
    fn test_create_and_list_save() {
        let dir = tempfile::tempdir().unwrap();
        let saves_dir = dir.path().join("saves");

        let mut sm = SaveManager::init(&saves_dir).unwrap();
        let game = sample_game();

        let save_id = sm.create_save(&game, "John's Career").unwrap();
        assert!(!save_id.is_empty());

        let saves = sm.list_saves();
        assert_eq!(saves.len(), 1);
        assert_eq!(saves[0].name, "John's Career");
        assert_eq!(saves[0].manager_name, "John Smith");
    }

    #[test]
    fn test_create_and_load_game() {
        let dir = tempfile::tempdir().unwrap();
        let saves_dir = dir.path().join("saves");

        let mut sm = SaveManager::init(&saves_dir).unwrap();
        let game = sample_game();

        let save_id = sm.create_save(&game, "Test Career").unwrap();
        let loaded = sm.load_game(&save_id).unwrap();

        assert_eq!(loaded.manager.id, "mgr-user");
        assert_eq!(loaded.manager.first_name, "John");
        assert_eq!(loaded.manager.last_name, "Smith");
        assert_eq!(loaded.teams.len(), 1);
        assert_eq!(loaded.teams[0].name, "London FC");
        assert_eq!(loaded.players.len(), 1);
        assert_eq!(loaded.staff.len(), 1);
        assert_eq!(loaded.clock.start_date, game.clock.start_date);
        assert_eq!(loaded.clock.current_date, game.clock.current_date);
    }

    #[test]
    fn test_save_game_updates_existing() {
        let dir = tempfile::tempdir().unwrap();
        let saves_dir = dir.path().join("saves");

        let mut sm = SaveManager::init(&saves_dir).unwrap();
        let mut game = sample_game();

        let save_id = sm.create_save(&game, "Career").unwrap();

        // Advance the game
        game.clock.advance_days(7);
        game.manager.reputation = 999;

        sm.save_game(&game, &save_id).unwrap();

        let saves = sm.list_saves();
        assert_eq!(saves.len(), 1);

        // Reload and verify
        let loaded = sm.load_game(&save_id).unwrap();
        assert_eq!(loaded.manager.reputation, 999);
    }

    #[test]
    fn test_delete_save() {
        let dir = tempfile::tempdir().unwrap();
        let saves_dir = dir.path().join("saves");

        let mut sm = SaveManager::init(&saves_dir).unwrap();
        let game = sample_game();

        let save_id = sm.create_save(&game, "To Delete").unwrap();
        assert_eq!(sm.list_saves().len(), 1);

        let deleted = sm.delete_save(&save_id).unwrap();
        assert!(deleted);
        assert!(sm.list_saves().is_empty());

        // File should be gone
        let save_path = saves_dir.join(format!("{}.olsave", save_id));
        assert!(!save_path.exists());
    }

    #[test]
    fn test_delete_nonexistent_save() {
        let dir = tempfile::tempdir().unwrap();
        let saves_dir = dir.path().join("saves");

        let mut sm = SaveManager::init(&saves_dir).unwrap();
        let deleted = sm.delete_save("nonexistent").unwrap();
        assert!(!deleted);
    }

    #[test]
    fn test_load_nonexistent_save() {
        let dir = tempfile::tempdir().unwrap();
        let saves_dir = dir.path().join("saves");

        let mut sm = SaveManager::init(&saves_dir).unwrap();
        let result = sm.load_game("nonexistent");
        assert!(result.is_err());
    }

    #[test]
    fn test_save_to_nonexistent_save() {
        let dir = tempfile::tempdir().unwrap();
        let saves_dir = dir.path().join("saves");

        let mut sm = SaveManager::init(&saves_dir).unwrap();
        let game = sample_game();
        let result = sm.save_game(&game, "nonexistent");
        assert!(result.is_err());
    }

    #[test]
    fn test_multiple_saves() {
        let dir = tempfile::tempdir().unwrap();
        let saves_dir = dir.path().join("saves");

        let mut sm = SaveManager::init(&saves_dir).unwrap();
        let game = sample_game();

        let id1 = sm.create_save(&game, "Career 1").unwrap();
        let id2 = sm.create_save(&game, "Career 2").unwrap();
        let id3 = sm.create_save(&game, "Career 3").unwrap();

        assert_eq!(sm.list_saves().len(), 3);
        assert_ne!(id1, id2);
        assert_ne!(id2, id3);

        // Delete one
        sm.delete_save(&id2).unwrap();
        assert_eq!(sm.list_saves().len(), 2);

        // Others still loadable
        sm.load_game(&id1).unwrap();
        sm.load_game(&id3).unwrap();
    }

    #[test]
    fn test_index_persists_across_reinit() {
        let dir = tempfile::tempdir().unwrap();
        let saves_dir = dir.path().join("saves");

        // Create a save
        {
            let mut sm = SaveManager::init(&saves_dir).unwrap();
            let game = sample_game();
            sm.create_save(&game, "Persistent Career").unwrap();
        }

        // Re-init — should find the save in the index
        let sm = SaveManager::init(&saves_dir).unwrap();
        assert_eq!(sm.list_saves().len(), 1);
        assert_eq!(sm.list_saves()[0].name, "Persistent Career");
    }

    #[test]
    fn test_game_roundtrip_preserves_all_fields() {
        let dir = tempfile::tempdir().unwrap();
        let saves_dir = dir.path().join("saves");

        let mut sm = SaveManager::init(&saves_dir).unwrap();
        let mut game = sample_game();
        game.board_objectives.push(BoardObjective {
            id: "obj-001".to_string(),
            description: "Finish top 4".to_string(),
            target: 4,
            objective_type: crate::game::ObjectiveType::LeaguePosition,
            met: false,
        });

        let save_id = sm.create_save(&game, "Roundtrip").unwrap();
        let loaded = sm.load_game(&save_id).unwrap();

        assert_eq!(loaded.board_objectives.len(), 1);
        assert_eq!(loaded.board_objectives[0].description, "Finish top 4");
    }

    #[test]
    fn test_game_roundtrip_preserves_world_overlay_state() {
        let dir = tempfile::tempdir().unwrap();
        let mut sm = SaveManager::init(&dir.path().join("saves")).unwrap();
        let mut game = sample_game();
        game.retired_player_ids = vec!["p-retired".to_string()];
        game.world_overlay_as_of = Some("2026-11-07".to_string());
        game.moved_player_ids.insert("p-moved".to_string());

        let save_id = sm.create_save(&game, "Overlay").unwrap();
        let loaded = sm.load_game(&save_id).unwrap();

        assert_eq!(loaded.retired_player_ids, vec!["p-retired".to_string()]);
        assert_eq!(loaded.world_overlay_as_of.as_deref(), Some("2026-11-07"));
        assert!(loaded.moved_player_ids.contains("p-moved"));
    }

    #[test]
    fn test_game_saved_before_world_overlay_still_loads() {
        let mut value = serde_json::to_value(sample_game()).unwrap();
        let object = value.as_object_mut().unwrap();
        object.remove("retired_player_ids");
        object.remove("world_overlay_as_of");

        let loaded: Game = serde_json::from_value(value).unwrap();

        assert!(loaded.retired_player_ids.is_empty());
        assert_eq!(loaded.world_overlay_as_of, None);
    }

    #[test]
    fn test_game_roundtrip_preserves_removed_team_ids() {
        let dir = tempfile::tempdir().unwrap();
        let mut sm = SaveManager::init(&dir.path().join("saves")).unwrap();
        let mut game = sample_game();
        game.removed_team_ids = vec!["les-old".to_string(), "les-older".to_string()];

        let save_id = sm.create_save(&game, "Removed").unwrap();
        let loaded = sm.load_game(&save_id).unwrap();

        assert_eq!(
            loaded.removed_team_ids,
            vec!["les-old".to_string(), "les-older".to_string()]
        );
    }

    #[test]
    fn test_game_saved_before_custom_team_still_loads() {
        let mut value = serde_json::to_value(sample_game()).unwrap();
        value.as_object_mut().unwrap().remove("removed_team_ids");

        let loaded: Game = serde_json::from_value(value).unwrap();

        assert!(loaded.removed_team_ids.is_empty());
    }

    #[test]
    fn test_new_game_from_save_strips_session_data() {
        let dir = tempfile::tempdir().unwrap();
        let saves_dir = dir.path().join("saves");

        let mut sm = SaveManager::init(&saves_dir).unwrap();
        let mut game = sample_game();

        game.clock.advance_days(30);
        game.board_objectives.push(BoardObjective {
            id: "obj-1".to_string(),
            description: "Win".to_string(),
            target: 10,
            objective_type: crate::game::ObjectiveType::Wins,
            met: false,
        });
        game.manager.reputation = 999;

        let save_id = sm.create_save(&game, "Source Save").unwrap();

        let new_game = sm.new_game_from_save(&save_id).unwrap();

        assert!(new_game.messages.is_empty());
        assert!(new_game.news.is_empty());
        assert!(new_game.board_objectives.is_empty());
        assert!(new_game.leagues.is_empty());

        assert_eq!(new_game.clock.current_date, new_game.clock.start_date);

        assert_eq!(new_game.teams.len(), 1);
        assert_eq!(new_game.teams[0].name, "London FC");
        assert_eq!(new_game.players.len(), 1);

        assert_eq!(new_game.manager.satisfaction, 100);
        assert_eq!(new_game.manager.fan_approval, 50);
    }

    #[test]
    fn test_new_game_from_nonexistent_save() {
        let dir = tempfile::tempdir().unwrap();
        let saves_dir = dir.path().join("saves");

        let mut sm = SaveManager::init(&saves_dir).unwrap();
        let result = sm.new_game_from_save("nonexistent");
        assert!(result.is_err());
    }

    #[test]
    fn test_unknown_format_version_rejected() {
        use std::io::Write;

        let dir = tempfile::tempdir().unwrap();
        let saves_dir = dir.path().join("saves");
        fs::create_dir(&saves_dir).unwrap();

        // Write a file with wrong version
        let path = saves_dir.join("bad.olsave");
        let mut f = fs::File::create(&path).unwrap();
        f.write_all(&0xFFu32.to_le_bytes()).unwrap();

        let result = SaveManager::read_olsave(&path);
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .contains("Unsupported save format version")
        );
    }

    #[test]
    fn test_corrupt_file_rejected() {
        use std::io::Write;

        let dir = tempfile::tempdir().unwrap();
        let saves_dir = dir.path().join("saves");
        fs::create_dir(&saves_dir).unwrap();

        // Write garbage
        let path = saves_dir.join("corrupt.olsave");
        let mut f = fs::File::create(&path).unwrap();
        f.write_all(&1u32.to_le_bytes()).unwrap();
        f.write_all(b"garbage data that is not valid bincode")
            .unwrap();
        drop(f);

        let result = SaveManager::read_olsave(&path);
        assert!(result.is_err());
    }
}
