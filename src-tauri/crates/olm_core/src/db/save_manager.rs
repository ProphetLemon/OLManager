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

/// Why a save file could not be imported. Nothing is written when one is returned.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SaveImportError {
    /// The file is empty or shorter than the format header.
    TooSmall,
    /// The header names a format this game version does not read.
    WrongVersion { found: u32, expected: u32 },
    /// The header is right but the body is not a gzipped game.
    Corrupt(String),
    /// Writing to the saves folder failed.
    Storage(String),
    /// The id is already in the list and the caller did not ask to replace it.
    IdTaken,
}

impl SaveImportError {
    /// Stable machine code the UI maps to a localized message.
    pub fn code(&self) -> &'static str {
        match self {
            Self::TooSmall => "too_small",
            Self::WrongVersion { .. } => "wrong_version",
            Self::Corrupt(_) => "corrupt",
            Self::Storage(_) => "storage",
            Self::IdTaken => "id_taken",
        }
    }
}

impl std::fmt::Display for SaveImportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TooSmall => write!(f, "The file is too small to be a save"),
            Self::WrongVersion { found, expected } => write!(
                f,
                "The file is from another game version (save format {found}, this version reads {expected})"
            ),
            Self::Corrupt(why) => write!(f, "The file is not a readable save: {why}"),
            Self::Storage(why) => write!(f, "Could not store the save: {why}"),
            Self::IdTaken => write!(f, "A save with this id already exists"),
        }
    }
}

impl std::error::Error for SaveImportError {}

/// A validated save file waiting to be committed to the saves folder.
#[derive(Debug, Clone)]
pub struct PreparedImport {
    pub id: String,
    pub name: String,
    pub manager_name: String,
    /// The entry this import would overwrite, when its id is already in the list.
    pub replaces: Option<SaveEntry>,
    bytes: Vec<u8>,
}

/// Pull a save id and a display name out of a file name such as `My career-<uuid>.olsave`.
fn parse_file_hint(hint: &str) -> (Option<String>, Option<String>) {
    // A hyphenated uuid is 36 ASCII bytes and holds no character a file manager
    // percent-encodes, so it can be found in a raw content-URI segment too.
    let found = hint.char_indices().find_map(|(at, _)| {
        let window = hint.get(at..at + 36)?;
        let id = uuid::Uuid::parse_str(window).ok()?;
        Some((at, id.hyphenated().to_string()))
    });
    let Some((at, id)) = found else {
        return (None, None);
    };
    let name = hint[..at].trim_matches(|c: char| "-_ []()".contains(c));
    let name = (!name.is_empty() && !name.contains('%')).then(|| name.to_string());
    (Some(id), name)
}

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

        // Migration: stamp the career mark on saves from before splits were tracked, so
        // each later split is counted once. The totals themselves are left as saved.
        crate::end_of_season::stamp_unmarked_career(&mut game);

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

    /// Name for the exported file: `<save name>-<id>.olsave`, safe on every platform.
    pub fn export_file_name(&self, save_id: &str) -> Result<String, String> {
        let entry = self
            .save_index
            .find(save_id)
            .ok_or_else(|| format!("Save '{}' not found", save_id))?;
        let cleaned: String = entry
            .name
            .chars()
            .map(|c| if c.is_alphanumeric() || " -_".contains(c) { c } else { '_' })
            .take(60)
            .collect();
        let cleaned = cleaned.trim();
        let stem = if cleaned.is_empty() { "save" } else { cleaned };
        Ok(format!("{stem}-{}.olsave", entry.id))
    }

    /// Copy the stored bytes of a save to `out` without re-encoding them.
    pub fn export_save<W: std::io::Write>(
        &self,
        save_id: &str,
        out: &mut W,
    ) -> Result<u64, String> {
        if self.save_index.find(save_id).is_none() {
            return Err(format!("Save '{}' not found", save_id));
        }
        let mut file = fs::File::open(self.save_path(save_id))
            .map_err(|e| format!("Failed to open save: {}", e))?;
        let copied = std::io::copy(&mut file, out)
            .map_err(|e| format!("Failed to write exported save: {}", e))?;
        info!("[save_manager] exported save {} ({} bytes)", save_id, copied);
        Ok(copied)
    }

    /// Validate a save file without touching the saves folder.
    /// `file_hint` is the picked file's name, when the platform gives one.
    pub fn prepare_import(
        &self,
        bytes: Vec<u8>,
        file_hint: Option<&str>,
    ) -> Result<PreparedImport, SaveImportError> {
        let header: [u8; 4] = bytes
            .get(..4)
            .and_then(|h| h.try_into().ok())
            .ok_or(SaveImportError::TooSmall)?;
        let found = u32::from_le_bytes(header);
        if found != FORMAT_VERSION {
            return Err(SaveImportError::WrongVersion {
                found,
                expected: FORMAT_VERSION,
            });
        }

        use flate2::read::GzDecoder;
        let mut json = String::new();
        GzDecoder::new(&bytes[4..])
            .read_to_string(&mut json)
            .map_err(|e| SaveImportError::Corrupt(format!("decompress: {e}")))?;
        let game: Game = serde_json::from_str(&json)
            .map_err(|e| SaveImportError::Corrupt(format!("parse: {e}")))?;

        let (hinted_id, hinted_name) = file_hint.map(parse_file_hint).unwrap_or_default();
        let id = hinted_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let replaces = self.save_index.find(&id).cloned();
        let manager_name = game.manager.display_name();
        let name = hinted_name
            .or_else(|| replaces.as_ref().map(|e| e.name.clone()))
            .unwrap_or_else(|| format!("{manager_name}'s Career"));

        Ok(PreparedImport {
            id,
            name,
            manager_name,
            replaces,
            bytes,
        })
    }

    /// Store a prepared import and list it. An id already in the list needs `replace`.
    pub fn commit_import(
        &mut self,
        prepared: PreparedImport,
        replace: bool,
    ) -> Result<SaveEntry, SaveImportError> {
        let existing = self.save_index.find(&prepared.id).cloned();
        if existing.is_some() && !replace {
            return Err(SaveImportError::IdTaken);
        }

        let path = self.save_path(&prepared.id);
        let tmp_path = path.with_extension("olsave.tmp");
        let storage = |what: &str, e: std::io::Error| SaveImportError::Storage(format!("{what}: {e}"));
        fs::write(&tmp_path, &prepared.bytes).map_err(|e| storage("write", e))?;
        if let Err(e) = fs::rename(&tmp_path, &path) {
            let _ = fs::remove_file(&tmp_path);
            return Err(storage("rename", e));
        }

        let now = Utc::now().to_rfc3339();
        let entry = SaveEntry {
            id: prepared.id,
            name: prepared.name,
            manager_name: prepared.manager_name,
            created_at: existing
                .as_ref()
                .map_or_else(|| now.clone(), |e| e.created_at.clone()),
            last_played_at: now,
        };
        let indexed = if existing.is_some() {
            self.save_index.update_save(entry.clone())
        } else {
            self.save_index.record_new_save(entry.clone())
        };
        if let Err(e) = indexed {
            if existing.is_none() {
                let _ = fs::remove_file(&path);
            }
            return Err(SaveImportError::Storage(e));
        }

        info!("[save_manager] imported save {}", entry.id);
        Ok(entry)
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
        // The splits already played in the source save are not this career's.
        crate::end_of_season::start_career_at_running_split(&mut game);

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
            ladder: Default::default(),
            soloq_decay_mode: Default::default(),
            soloq_history: Default::default(),
            soloq_day_marks: Default::default(),
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
    fn a_save_stored_in_a_removed_day_phase_loads_in_the_scrim_phase() {
        for id in ["ReviewBlock", "TrainingBlock", "Evening"] {
            let mut value = serde_json::to_value(sample_game()).unwrap();
            value["day_phase"] = serde_json::json!(id);

            let loaded: Game = serde_json::from_value(value).unwrap();

            assert_eq!(loaded.day_phase, crate::game::DayPhase::ScrimBlock, "{id}");
        }
    }

    #[test]
    fn old_save_without_ladder_field_deserializes() {
        let mut value = serde_json::to_value(sample_game()).unwrap();
        value.as_object_mut().unwrap().remove("ladder");

        let loaded: Game = serde_json::from_value(value).unwrap();

        assert!(loaded.ladder.tallies.is_empty() && loaded.ladder.outcomes.is_empty());
    }

    #[test]
    fn test_game_roundtrip_preserves_ladder() {
        let dir = tempfile::tempdir().unwrap();
        let mut sm = SaveManager::init(&dir.path().join("saves")).unwrap();
        let mut game = sample_game();
        game.ladder.outcomes.push(crate::ladder::SeasonOutcome {
            competition_id: "les".to_string(),
            season: 2026,
            champion_id: Some("les-a".to_string()),
            ..Default::default()
        });

        let save_id = sm.create_save(&game, "Ladder").unwrap();
        let loaded = sm.load_game(&save_id).unwrap();

        assert_eq!(
            loaded.ladder.outcome("les", 2026).and_then(|o| o.champion_id.as_deref()),
            Some("les-a")
        );
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

    fn save_file_bytes(sm: &SaveManager, id: &str) -> Vec<u8> {
        fs::read(sm.save_path(id)).unwrap()
    }

    fn olsave_with_version(version: u32, body: &[u8]) -> Vec<u8> {
        let mut bytes = version.to_le_bytes().to_vec();
        bytes.extend_from_slice(body);
        bytes
    }

    fn dir_listing(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    /// Two managers, as if two devices: returns (source, its save id, target).
    fn two_devices() -> (tempfile::TempDir, SaveManager, String, SaveManager) {
        let dir = tempfile::tempdir().unwrap();
        let mut source = SaveManager::init(&dir.path().join("pc")).unwrap();
        let id = source.create_save(&sample_game(), "Main career").unwrap();
        let target = SaveManager::init(&dir.path().join("phone")).unwrap();
        (dir, source, id, target)
    }

    fn exported(sm: &SaveManager, id: &str) -> Vec<u8> {
        let mut out = Vec::new();
        sm.export_save(id, &mut out).unwrap();
        out
    }

    #[test]
    fn export_writes_the_stored_bytes_unchanged() {
        let (_dir, source, id, _target) = two_devices();

        assert_eq!(exported(&source, &id), save_file_bytes(&source, &id));
    }

    #[test]
    fn export_of_an_unknown_save_fails() {
        let (_dir, source, _id, _target) = two_devices();

        assert!(source.export_save("nope", &mut Vec::new()).is_err());
    }

    #[test]
    fn export_file_name_carries_the_save_id_and_drops_unsafe_characters() {
        let dir = tempfile::tempdir().unwrap();
        let mut sm = SaveManager::init(&dir.path().join("saves")).unwrap();
        let id = sm.create_save(&sample_game(), "a/b:c*d?").unwrap();

        let name = sm.export_file_name(&id).unwrap();

        assert_eq!(name, format!("a_b_c_d_-{id}.olsave"));
    }

    #[test]
    fn importing_an_exported_file_lists_the_same_career() {
        let (_dir, source, id, mut target) = two_devices();
        let hint = source.export_file_name(&id).unwrap();

        let prepared = target.prepare_import(exported(&source, &id), Some(&hint)).unwrap();
        let entry = target.commit_import(prepared, false).unwrap();

        assert_eq!(entry.id, id);
        assert_eq!(entry.name, "Main career");
        assert_eq!(target.list_saves().len(), 1);
        assert_eq!(target.load_game(&id).unwrap().manager.last_name, "Smith");
    }

    #[test]
    fn import_without_a_file_name_gets_a_fresh_id_and_the_manager_name() {
        let (_dir, source, id, mut target) = two_devices();

        let prepared = target.prepare_import(exported(&source, &id), None).unwrap();
        let entry = target.commit_import(prepared, false).unwrap();

        assert_ne!(entry.id, id);
        assert_eq!(entry.name, "John Smith's Career");
        assert_eq!(save_file_bytes(&target, &entry.id), save_file_bytes(&source, &id));
    }

    #[test]
    fn an_imported_save_survives_the_next_start() {
        let (dir, source, id, mut target) = two_devices();
        let prepared = target.prepare_import(exported(&source, &id), None).unwrap();
        let entry = target.commit_import(prepared, false).unwrap();
        drop(target);

        let reopened = SaveManager::init(&dir.path().join("phone")).unwrap();

        assert_eq!(reopened.list_saves().len(), 1);
        assert_eq!(reopened.list_saves()[0].id, entry.id);
    }

    #[test]
    fn a_file_from_another_format_version_is_refused_and_nothing_changes() {
        let (_dir, _source, _id, target) = two_devices();
        let before = dir_listing(&target.saves_dir);
        let bytes = olsave_with_version(FORMAT_VERSION + 1, b"whatever");

        let err = target.prepare_import(bytes, None).unwrap_err();

        assert_eq!(
            err,
            SaveImportError::WrongVersion { found: FORMAT_VERSION + 1, expected: FORMAT_VERSION }
        );
        assert!(target.list_saves().is_empty());
        assert_eq!(dir_listing(&target.saves_dir), before);
    }

    #[test]
    fn a_wrong_version_message_says_the_file_is_from_another_game_version() {
        let (_dir, _source, _id, target) = two_devices();

        let err = target
            .prepare_import(olsave_with_version(1, b"x"), None)
            .unwrap_err();

        assert!(err.to_string().contains("another game version"));
    }

    #[test]
    fn a_file_shorter_than_the_header_is_refused() {
        let (_dir, _source, _id, target) = two_devices();

        assert_eq!(
            target.prepare_import(vec![3, 0], None).unwrap_err(),
            SaveImportError::TooSmall
        );
        assert_eq!(
            target.prepare_import(Vec::new(), None).unwrap_err(),
            SaveImportError::TooSmall
        );
    }

    #[test]
    fn a_right_version_with_garbage_after_it_is_refused_as_corrupt() {
        let (_dir, _source, _id, target) = two_devices();
        let before = dir_listing(&target.saves_dir);

        let err = target
            .prepare_import(olsave_with_version(FORMAT_VERSION, b"not gzip at all"), None)
            .unwrap_err();

        assert_eq!(err.code(), "corrupt");
        assert_eq!(dir_listing(&target.saves_dir), before);
    }

    #[test]
    fn a_gzip_of_json_that_is_not_a_game_is_refused_as_corrupt() {
        use flate2::{Compression, write::GzEncoder};
        use std::io::Write;
        let (_dir, _source, _id, target) = two_devices();
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(b"{\"hello\":1}").unwrap();
        let bytes = olsave_with_version(FORMAT_VERSION, &encoder.finish().unwrap());

        let err = target.prepare_import(bytes, None).unwrap_err();

        assert_eq!(err.code(), "corrupt");
    }

    #[test]
    fn a_truncated_export_is_refused_as_corrupt() {
        let (_dir, source, id, target) = two_devices();
        let mut bytes = exported(&source, &id);
        bytes.truncate(bytes.len() / 2);

        let err = target.prepare_import(bytes, None).unwrap_err();

        assert_eq!(err.code(), "corrupt");
    }

    #[test]
    fn preparing_an_import_writes_nothing() {
        let (_dir, source, id, target) = two_devices();
        let before = dir_listing(&target.saves_dir);

        target.prepare_import(exported(&source, &id), None).unwrap();

        assert_eq!(dir_listing(&target.saves_dir), before);
        assert!(target.list_saves().is_empty());
    }

    #[test]
    fn an_id_already_in_the_list_is_reported_before_anything_is_replaced() {
        let (_dir, source, id, _target) = two_devices();
        let hint = source.export_file_name(&id).unwrap();

        let prepared = source.prepare_import(exported(&source, &id), Some(&hint)).unwrap();

        assert_eq!(prepared.replaces.map(|e| e.id), Some(id));
    }

    #[test]
    fn committing_over_an_existing_id_without_replace_is_refused_and_keeps_the_old_save() {
        let (_dir, mut source, id, _target) = two_devices();
        let hint = source.export_file_name(&id).unwrap();
        let old = save_file_bytes(&source, &id);
        let prepared = source.prepare_import(exported(&source, &id), Some(&hint)).unwrap();

        let err = source.commit_import(prepared, false).unwrap_err();

        assert_eq!(err, SaveImportError::IdTaken);
        assert_eq!(save_file_bytes(&source, &id), old);
    }

    #[test]
    fn replacing_makes_the_imported_copy_win_without_adding_an_entry() {
        let (_dir, mut source, id, mut target) = two_devices();
        let hint = source.export_file_name(&id).unwrap();
        let mut played = source.load_game(&id).unwrap();
        played.manager.reputation = 777;
        source.save_game(&played, &id).unwrap();
        let newer = exported(&source, &id);
        let stale = target.prepare_import(save_file_bytes(&source, &id), Some(&hint)).unwrap();
        target.commit_import(stale, false).unwrap();
        let mut later = target.load_game(&id).unwrap();
        later.manager.reputation = 1;
        target.save_game(&later, &id).unwrap();

        let prepared = target.prepare_import(newer, Some(&hint)).unwrap();
        target.commit_import(prepared, true).unwrap();

        assert_eq!(target.list_saves().len(), 1);
        assert_eq!(target.load_game(&id).unwrap().manager.reputation, 777);
    }

    #[test]
    fn file_hints_yield_an_id_and_a_name_only_when_they_carry_them() {
        let id = "0b8f4a52-6f3e-4d51-9a1c-2f6d1c0e9a77";

        assert_eq!(
            parse_file_hint(&format!("My career-{id}.olsave")),
            (Some(id.to_string()), Some("My career".to_string()))
        );
        assert_eq!(parse_file_hint(&format!("{id}.olsave")), (Some(id.to_string()), None));
        assert_eq!(parse_file_hint("backup.olsave"), (None, None));
        assert_eq!(
            parse_file_hint(&format!("My%20career-{id}.olsave")),
            (Some(id.to_string()), None)
        );
    }
}
