//! "Export world" in Settings: write the current teams, players and staff as one JSON file.
//!
//! The legacy `world` command module (file `world.rs`, out of the build since upstream `d3a08157`
//! and later deleted) held an `export_world_database` too, but its helpers were deleted with
//! `generator::world_io`, so it could not simply be registered again. This is the small part of it
//! that still has a home: build a
//! `WorldData` from the live game and write it under the app data directory, never the process
//! working directory.

use std::path::{Path, PathBuf};

use log::info;
use olm_core::generator::definitions::WorldData;
use olm_core::state::StateManager;
use tauri::{Manager, State};

/// Folder, inside the app data directory, that holds exported worlds.
const EXPORT_DIR: &str = "exports";

/// Where an export named `requested` lands: `<app data>/exports/<file name>`.
///
/// Only the final path component is used, so a name such as `../../x.json` or an absolute path
/// cannot write outside the exports folder. A name without an extension gets `.json`.
fn resolve_export_path(app_data_dir: &Path, requested: &str) -> Result<PathBuf, String> {
    let file_name = Path::new(requested)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty() && *name != "..")
        .ok_or_else(|| format!("Invalid export file name: {requested:?}"))?;
    let mut path = app_data_dir.join(EXPORT_DIR).join(file_name);
    if path.extension().is_none() {
        path.set_extension("json");
    }
    Ok(path)
}

fn export_world_database_internal(
    state: &StateManager,
    export_path: &Path,
) -> Result<String, String> {
    let world = state
        .get_game(|game| WorldData {
            name: "Exported World".to_string(),
            description: format!(
                "World with {} teams exported from saved game",
                game.teams.len()
            ),
            teams: game.teams.clone(),
            players: game.players.clone(),
            staff: game.staff.clone(),
        })
        .ok_or("No active game session".to_string())?;

    let json = serde_json::to_string_pretty(&world)
        .map_err(|error| format!("Failed to serialise world: {error}"))?;
    if let Some(parent) = export_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
    }
    std::fs::write(export_path, json)
        .map_err(|error| format!("Failed to write {}: {error}", export_path.display()))?;
    Ok(export_path.to_string_lossy().to_string())
}

/// Export the current world to `<app data>/exports/<export_path file name>`; returns the full path.
#[tauri::command]
pub fn export_world_database(
    app_handle: tauri::AppHandle,
    state: State<'_, StateManager>,
    export_path: String,
) -> Result<String, String> {
    info!("[cmd] export_world_database: name={export_path}");
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve the app data dir: {error}"))?;
    let target = resolve_export_path(&app_data_dir, &export_path)?;
    export_world_database_internal(&state, &target)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};
    use olm_core::clock::GameClock;
    use olm_core::domain::manager::Manager;
    use olm_core::domain::player::{LolRole, Player, PlayerAttributes};
    use olm_core::domain::team::Team;
    use olm_core::game::Game;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(label: &str) -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |elapsed| elapsed.as_nanos());
            let path = std::env::temp_dir().join(format!("olm-world-export-{label}-{nanos}"));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn game() -> Game {
        let attrs = PlayerAttributes {
            mechanics: 65,
            laning: 65,
            teamfighting: 65,
            macro_play: 65,
            consistency: 65,
            shotcalling: 65,
            champion_pool: 65,
            discipline: 65,
            mental_resilience: 65,
        };
        let mut player = Player::new(
            "p1".to_string(),
            "Nick".to_string(),
            "Nick Name".to_string(),
            "2000-01-01".to_string(),
            "GB".to_string(),
            LolRole::Jungle,
            attrs,
        );
        player.team_id = Some("team-1".to_string());
        let team = Team::new(
            "team-1".to_string(),
            "Alpha".to_string(),
            "ALP".to_string(),
            "GB".to_string(),
            "City".to_string(),
            "Ground".to_string(),
            1000,
        );
        let manager = Manager::new(
            "mgr".to_string(),
            "A".to_string(),
            "B".to_string(),
            "1980-01-01".to_string(),
            "GB".to_string(),
        );
        let clock = GameClock::new(Utc.with_ymd_and_hms(2025, 7, 1, 0, 0, 0).unwrap());
        Game::new(clock, manager, vec![team], vec![player], vec![], vec![])
    }

    #[test]
    fn a_bare_file_name_lands_in_the_exports_folder_of_the_app_data_dir() {
        let data = Path::new("/data/app");

        assert_eq!(
            resolve_export_path(data, "exported_world.json").unwrap(),
            data.join("exports").join("exported_world.json")
        );
    }

    #[test]
    fn only_the_file_name_is_kept_so_a_path_cannot_escape() {
        let data = Path::new("/data/app");

        assert_eq!(
            resolve_export_path(data, "../../etc/passwd.json").unwrap(),
            data.join("exports").join("passwd.json")
        );
        assert_eq!(
            resolve_export_path(data, "/tmp/elsewhere.json").unwrap(),
            data.join("exports").join("elsewhere.json")
        );
    }

    #[test]
    fn a_name_without_extension_gets_json_and_an_empty_name_is_refused() {
        let data = Path::new("/data/app");

        assert_eq!(
            resolve_export_path(data, "mine").unwrap(),
            data.join("exports").join("mine.json")
        );
        assert!(resolve_export_path(data, "").is_err());
        assert!(resolve_export_path(data, "..").is_err());
    }

    #[test]
    fn the_export_creates_its_folder_and_writes_a_readable_world() {
        let temp = TempDir::new("write");
        let target = resolve_export_path(&temp.0, "exported_world.json").unwrap();
        let state = StateManager::new();
        state.set_game(game());

        let written = export_world_database_internal(&state, &target).unwrap();

        assert_eq!(Path::new(&written), target);
        let world: WorldData =
            serde_json::from_str(&std::fs::read_to_string(&target).unwrap()).unwrap();
        assert_eq!(world.teams.len(), 1);
        assert_eq!(world.players[0].id, "p1");
    }

    #[test]
    fn exporting_without_a_game_is_an_error() {
        let temp = TempDir::new("nogame");
        let target = resolve_export_path(&temp.0, "w.json").unwrap();

        let error = export_world_database_internal(&StateManager::new(), &target).unwrap_err();

        assert_eq!(error, "No active game session");
        assert!(!target.exists());
    }

    #[test]
    fn a_write_failure_names_the_path() {
        let temp = TempDir::new("blocked");
        // `exports` is a file, so the folder cannot be created under it.
        std::fs::write(temp.0.join(EXPORT_DIR), "not a folder").unwrap();
        let target = resolve_export_path(&temp.0, "w.json").unwrap();
        let state = StateManager::new();
        state.set_game(game());

        let error = export_world_database_internal(&state, &target).unwrap_err();

        assert!(error.contains("Failed to create"), "{error}");
        assert!(error.contains(EXPORT_DIR), "{error}");
    }
}
