//! Move a save between devices by hand: export it to a file the user picks, or
//! import a picked file. The native pickers and the file access (including
//! Android content URIs) live in the thin commands at the bottom; everything
//! decided here goes through `SaveManager`, which is tested on its own.

use std::io::Read;
use std::sync::Mutex;

use olm_core::db::save_index::SaveEntry;
use olm_core::db::save_manager::{PreparedImport, SaveImportError, SaveManager};
use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_plugin_fs::{FsExt, OpenOptions};

use crate::SaveManagerState;

/// The validated import waiting for the user to confirm (or refuse) a replacement.
#[derive(Default)]
pub struct ImportStage(pub Mutex<Option<PreparedImport>>);

/// What the UI needs to ask about a staged import.
#[derive(Debug, Serialize)]
pub struct ImportPreview {
    pub name: String,
    pub manager_name: String,
    /// The save this import would overwrite, when its id is already in the list.
    pub replaces: Option<SaveEntry>,
}

impl From<&PreparedImport> for ImportPreview {
    fn from(prepared: &PreparedImport) -> Self {
        Self {
            name: prepared.name.clone(),
            manager_name: prepared.manager_name.clone(),
            replaces: prepared.replaces.clone(),
        }
    }
}

/// Errors cross the IPC boundary as `<code>|<message>`: the UI localizes the code.
fn import_error(error: SaveImportError) -> String {
    format!("{}|{}", error.code(), error)
}

fn stage_bytes(
    sm: &SaveManager,
    stage: &ImportStage,
    bytes: Vec<u8>,
    file_hint: Option<&str>,
) -> Result<ImportPreview, String> {
    let prepared = sm.prepare_import(bytes, file_hint).map_err(import_error)?;
    let preview = ImportPreview::from(&prepared);
    *stage.0.lock().map_err(|e| format!("Lock error: {e}"))? = Some(prepared);
    Ok(preview)
}

fn commit_staged(
    sm: &mut SaveManager,
    stage: &ImportStage,
    replace: bool,
) -> Result<SaveEntry, String> {
    let mut slot = stage.0.lock().map_err(|e| format!("Lock error: {e}"))?;
    let prepared = slot
        .take()
        .ok_or_else(|| "storage|There is no import waiting for confirmation".to_string())?;
    match sm.commit_import(prepared.clone(), replace) {
        Ok(entry) => Ok(entry),
        Err(error) => {
            // A refused replacement stays staged so the user can still confirm it.
            if error == SaveImportError::IdTaken {
                *slot = Some(prepared);
            }
            Err(import_error(error))
        }
    }
}

/// Name of the picked file, when the platform exposes one. A content URI keeps the
/// name as its last path segment, still percent-encoded.
fn picked_file_name(path: &FilePath) -> Option<String> {
    match path {
        FilePath::Path(p) => p.file_name().map(|n| n.to_string_lossy().into_owned()),
        FilePath::Url(u) => u
            .path_segments()
            .and_then(|mut segments| segments.next_back())
            .map(str::to_owned),
    }
}

/// Ask where to save a save, then copy it there byte for byte.
/// Returns the chosen target, or `None` when the user closed the dialog.
#[tauri::command]
pub async fn export_save_file(
    app: AppHandle,
    sm_state: State<'_, SaveManagerState>,
    save_id: String,
) -> Result<Option<String>, String> {
    let file_name = sm_state
        .0
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?
        .export_file_name(&save_id)?;

    let Some(target) = app
        .dialog()
        .file()
        .set_file_name(file_name)
        .blocking_save_file()
    else {
        return Ok(None);
    };

    let mut write_options = OpenOptions::new();
    write_options.write(true).create(true).truncate(true);
    let mut out = app
        .fs()
        .open(target.clone(), write_options)
        .map_err(|e| format!("Failed to open the target file: {e}"))?;
    sm_state
        .0
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?
        .export_save(&save_id, &mut out)?;
    out.sync_all()
        .map_err(|e| format!("Failed to finish writing the target file: {e}"))?;

    Ok(Some(target.to_string()))
}

/// Ask for a save file and validate it. Nothing is written: the UI confirms the
/// import (and any replacement) with `confirm_import_save`.
#[tauri::command]
pub async fn pick_import_save(
    app: AppHandle,
    sm_state: State<'_, SaveManagerState>,
    stage: State<'_, ImportStage>,
) -> Result<Option<ImportPreview>, String> {
    let mut dialog = app.dialog().file();
    // Android filters by MIME type, which `.olsave` does not have: leave it unfiltered there.
    #[cfg(desktop)]
    {
        dialog = dialog.add_filter("OLManager save", &["olsave"]);
    }
    let Some(picked) = dialog.blocking_pick_file() else {
        return Ok(None);
    };

    let hint = picked_file_name(&picked);
    let mut read_options = OpenOptions::new();
    read_options.read(true);
    let mut file = app
        .fs()
        .open(picked, read_options)
        .map_err(|e| format!("storage|Failed to open the picked file: {e}"))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .map_err(|e| format!("storage|Failed to read the picked file: {e}"))?;

    let sm = sm_state
        .0
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?;
    stage_bytes(&sm, &stage, bytes, hint.as_deref()).map(Some)
}

/// Store the import staged by `pick_import_save`; `replace` allows overwriting a save
/// that has the same id (the imported copy wins).
#[tauri::command]
pub async fn confirm_import_save(
    sm_state: State<'_, SaveManagerState>,
    stage: State<'_, ImportStage>,
    replace: bool,
) -> Result<SaveEntry, String> {
    let mut sm = sm_state
        .0
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?;
    commit_staged(&mut sm, &stage, replace)
}

/// Drop a staged import the user decided against.
#[tauri::command]
pub async fn cancel_import_save(stage: State<'_, ImportStage>) -> Result<(), String> {
    stage
        .0
        .lock()
        .map_err(|e| format!("Lock error: {e}"))?
        .take();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn sample_save_bytes(dir: &std::path::Path) -> (Vec<u8>, String) {
        let mut source = SaveManager::init(&dir.join("source")).unwrap();
        let start = chrono::Utc.with_ymd_and_hms(2026, 8, 20, 12, 0, 0).unwrap();
        let manager = olm_core::domain::manager::Manager::new(
            "m-1".to_string(),
            "Test".to_string(),
            "Manager".to_string(),
            "1980-01-01".to_string(),
            "GB".to_string(),
        );
        let game = olm_core::game::Game::new(
            olm_core::clock::GameClock::new(start),
            manager,
            vec![],
            vec![],
            vec![],
            vec![],
        );
        let id = source.create_save(&game, "Career").unwrap();
        let hint = source.export_file_name(&id).unwrap();
        let mut bytes = Vec::new();
        source.export_save(&id, &mut bytes).unwrap();
        (bytes, hint)
    }

    #[test]
    fn a_refused_replacement_stays_staged_and_can_be_confirmed() {
        let dir = tempfile::tempdir().unwrap();
        let (bytes, hint) = sample_save_bytes(dir.path());
        let mut sm = SaveManager::init(&dir.path().join("target")).unwrap();
        let stage = ImportStage::default();
        stage_bytes(&sm, &stage, bytes.clone(), Some(&hint)).unwrap();
        commit_staged(&mut sm, &stage, false).unwrap();
        stage_bytes(&sm, &stage, bytes, Some(&hint)).unwrap();

        let refused = commit_staged(&mut sm, &stage, false).unwrap_err();
        let replaced = commit_staged(&mut sm, &stage, true);

        assert!(refused.starts_with("id_taken|"));
        assert!(replaced.is_ok());
        assert_eq!(sm.list_saves().len(), 1);
    }

    #[test]
    fn a_file_that_is_not_a_save_is_refused_with_a_code_and_stages_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let sm = SaveManager::init(&dir.path().join("target")).unwrap();
        let stage = ImportStage::default();

        let error = stage_bytes(&sm, &stage, vec![9, 0, 0, 0, 1], None).unwrap_err();

        assert!(error.starts_with("wrong_version|"));
        assert!(stage.0.lock().unwrap().is_none());
    }

    #[test]
    fn confirming_with_nothing_staged_fails() {
        let dir = tempfile::tempdir().unwrap();
        let mut sm = SaveManager::init(&dir.path().join("target")).unwrap();

        assert!(commit_staged(&mut sm, &ImportStage::default(), false).is_err());
    }
}
