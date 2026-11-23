//! A save this version cannot read stays on disk. It is listed with a status,
//! refused by the readers that need a game, and still exported, deleted or
//! replaced by a good copy. Each test starts from a folder holding saves of
//! another version and a damaged one, as left by an older or newer build.

use super::tests::sample_game;
use super::*;
use tempfile::TempDir;

// Real uuids: an import names the save it replaces through the id in its file name.
const OLD: &str = "0b8f4a52-6f3e-4d51-9a1c-2f6d1c0e9a02";
const NEW: &str = "0b8f4a52-6f3e-4d51-9a1c-2f6d1c0e9a04";
const SHORT: &str = "0b8f4a52-6f3e-4d51-9a1c-2f6d1c0e9a00";

fn with_header(version: u32) -> Vec<u8> {
    let mut bytes = version.to_le_bytes().to_vec();
    bytes.extend_from_slice(b"written by another game version");
    bytes
}

/// What each odd save holds on disk: a v2 file, a v4 file and one cut short of the header.
fn odd_saves() -> [(&'static str, Vec<u8>); 3] {
    [
        (OLD, with_header(2)),
        (NEW, with_header(4)),
        (SHORT, vec![3, 0]),
    ]
}

fn plant(sm: &mut SaveManager, id: &str, bytes: &[u8]) {
    fs::write(sm.save_path(id), bytes).unwrap();
    sm.save_index
        .record_new_save(SaveEntry {
            id: id.to_string(),
            name: format!("Career {id}"),
            manager_name: "Old Manager".to_string(),
            created_at: "2026-01-01T00:00:00+00:00".to_string(),
            last_played_at: "2026-01-02T00:00:00+00:00".to_string(),
        })
        .unwrap();
}

/// Every file in the folder with its bytes, so a test can prove nothing moved.
fn snapshot(dir: &Path) -> Vec<(String, Vec<u8>)> {
    let mut files: Vec<(String, Vec<u8>)> = fs::read_dir(dir)
        .unwrap()
        .map(|e| {
            let e = e.unwrap();
            (
                e.file_name().to_string_lossy().into_owned(),
                fs::read(e.path()).unwrap(),
            )
        })
        .collect();
    files.sort();
    files
}

/// The folder after the odd saves were planted and the app started again, the
/// start that used to delete them.
fn started_with_odd_saves() -> (TempDir, PathBuf, SaveManager) {
    let dir = tempfile::tempdir().unwrap();
    let saves_dir = dir.path().join("saves");
    let mut sm = SaveManager::init(&saves_dir).unwrap();
    for (id, bytes) in odd_saves() {
        plant(&mut sm, id, &bytes);
    }
    drop(sm);
    let sm = SaveManager::init(&saves_dir).unwrap();
    (dir, saves_dir, sm)
}

fn listing_of(sm: &SaveManager, id: &str) -> SaveListing {
    sm.list_saves_with_status()
        .into_iter()
        .find(|l| l.entry.id == id)
        .unwrap_or_else(|| panic!("{id} is not listed"))
}

#[test]
fn starting_keeps_saves_of_other_versions_and_damaged_ones_byte_for_byte() {
    let (_dir, saves_dir, _sm) = started_with_odd_saves();

    for (id, bytes) in odd_saves() {
        assert_eq!(
            fs::read(saves_dir.join(format!("{id}.olsave"))).unwrap(),
            bytes,
            "{id}"
        );
    }
}

#[test]
fn starting_keeps_the_odd_saves_in_the_list() {
    let (_dir, _saves_dir, sm) = started_with_odd_saves();

    let mut ids: Vec<&str> = sm.list_saves().iter().map(|e| e.id.as_str()).collect();
    ids.sort();
    assert_eq!(ids, vec![SHORT, OLD, NEW]);
}

#[test]
fn starting_again_changes_no_file_of_the_folder() {
    let (_dir, saves_dir, sm) = started_with_odd_saves();
    let before = snapshot(&saves_dir);
    drop(sm);

    let _again = SaveManager::init(&saves_dir).unwrap();

    assert_eq!(snapshot(&saves_dir), before);
}

#[test]
fn starting_with_every_file_present_leaves_the_index_bytes_identical() {
    let dir = tempfile::tempdir().unwrap();
    let saves_dir = dir.path().join("saves");
    let mut sm = SaveManager::init(&saves_dir).unwrap();
    sm.create_save(&sample_game(), "Main career").unwrap();
    let index = saves_dir.join("save_index.json");
    let before = fs::read(&index).unwrap();
    drop(sm);

    let _again = SaveManager::init(&saves_dir).unwrap();

    assert_eq!(fs::read(&index).unwrap(), before);
}

#[test]
fn an_entry_whose_file_is_missing_is_still_dropped_from_the_index() {
    let dir = tempfile::tempdir().unwrap();
    let saves_dir = dir.path().join("saves");
    let mut sm = SaveManager::init(&saves_dir).unwrap();
    let id = sm.create_save(&sample_game(), "Gone").unwrap();
    fs::remove_file(sm.save_path(&id)).unwrap();
    drop(sm);

    let again = SaveManager::init(&saves_dir).unwrap();

    assert!(again.list_saves().is_empty());
}

#[test]
fn the_listing_gives_each_save_its_status_and_the_number_it_read() {
    let (_dir, _saves_dir, mut sm) = started_with_odd_saves();
    let good = sm.create_save(&sample_game(), "Good").unwrap();

    let seen = |id: &str| {
        let l = listing_of(&sm, id);
        (l.status, l.format_version)
    };

    assert_eq!(seen(&good), (SaveStatus::Ok, None));
    assert_eq!(seen(OLD), (SaveStatus::OtherVersion, Some(2)));
    assert_eq!(seen(NEW), (SaveStatus::OtherVersion, Some(4)));
    assert_eq!(seen(SHORT), (SaveStatus::Unreadable, None));
}

#[test]
fn an_entry_whose_file_vanished_while_running_is_listed_as_unreadable() {
    let dir = tempfile::tempdir().unwrap();
    let mut sm = SaveManager::init(&dir.path().join("saves")).unwrap();
    let id = sm.create_save(&sample_game(), "Vanishing").unwrap();
    fs::remove_file(sm.save_path(&id)).unwrap();

    assert_eq!(listing_of(&sm, &id).status, SaveStatus::Unreadable);
}

#[test]
fn the_listing_keeps_the_entry_fields_flat_next_to_the_status() {
    let (_dir, _saves_dir, sm) = started_with_odd_saves();

    let json = serde_json::to_value(listing_of(&sm, OLD)).unwrap();

    assert_eq!(json["id"], OLD);
    assert_eq!(json["manager_name"], "Old Manager");
    assert_eq!(json["status"], "other_version");
    assert_eq!(json["format_version"], 2);
}

#[test]
fn the_index_file_does_not_store_a_status() {
    let (_dir, saves_dir, sm) = started_with_odd_saves();
    drop(sm);

    let index = fs::read_to_string(saves_dir.join("save_index.json")).unwrap();

    assert!(!index.contains("status"));
    assert!(!index.contains("format_version"));
}

#[test]
fn loading_a_save_of_another_version_is_refused_with_a_code_and_changes_nothing() {
    let (_dir, saves_dir, mut sm) = started_with_odd_saves();
    let before = snapshot(&saves_dir);

    for (id, found) in [(OLD, 2), (NEW, 4)] {
        let err = sm.load_game(id).unwrap_err();
        assert!(err.starts_with("save_incompatible:"), "{err}");
        assert!(err.contains(&found.to_string()), "{err}");
    }

    assert_eq!(snapshot(&saves_dir), before);
}

#[test]
fn loading_an_unreadable_save_is_refused_with_a_code_and_changes_nothing() {
    let (_dir, saves_dir, mut sm) = started_with_odd_saves();
    let before = snapshot(&saves_dir);

    let err = sm.load_game(SHORT).unwrap_err();

    assert!(err.starts_with("save_unreadable:"), "{err}");
    assert_eq!(snapshot(&saves_dir), before);
}

#[test]
fn a_new_game_from_a_save_of_another_version_is_refused_with_the_same_code() {
    let (_dir, saves_dir, mut sm) = started_with_odd_saves();
    let before = snapshot(&saves_dir);

    let incompatible = sm.new_game_from_save(OLD).unwrap_err();
    let unreadable = sm.new_game_from_save(SHORT).unwrap_err();

    assert!(
        incompatible.starts_with("save_incompatible:"),
        "{incompatible}"
    );
    assert!(unreadable.starts_with("save_unreadable:"), "{unreadable}");
    assert_eq!(snapshot(&saves_dir), before);
}

#[test]
fn saving_over_an_odd_save_is_refused_and_keeps_its_bytes() {
    let (_dir, saves_dir, mut sm) = started_with_odd_saves();
    let before = snapshot(&saves_dir);

    for (id, code) in [
        (OLD, "save_incompatible:"),
        (NEW, "save_incompatible:"),
        (SHORT, "save_unreadable:"),
    ] {
        let err = sm.save_game(&sample_game(), id).unwrap_err();
        assert!(err.starts_with(code), "{err}");
    }

    assert_eq!(snapshot(&saves_dir), before);
}

#[test]
fn saving_a_save_whose_file_vanished_writes_it_again() {
    let dir = tempfile::tempdir().unwrap();
    let mut sm = SaveManager::init(&dir.path().join("saves")).unwrap();
    let id = sm.create_save(&sample_game(), "Vanishing").unwrap();
    fs::remove_file(sm.save_path(&id)).unwrap();

    sm.save_game(&sample_game(), &id).unwrap();

    assert_eq!(listing_of(&sm, &id).status, SaveStatus::Ok);
}

#[test]
fn exporting_an_odd_save_copies_the_same_bytes() {
    let (_dir, _saves_dir, sm) = started_with_odd_saves();

    for (id, bytes) in odd_saves() {
        let mut out = Vec::new();
        let copied = sm.export_save(id, &mut out).unwrap();
        assert_eq!(out, bytes, "{id}");
        assert_eq!(copied, bytes.len() as u64, "{id}");
    }
}

#[test]
fn an_odd_save_gets_an_export_file_name_like_any_other() {
    let (_dir, _saves_dir, sm) = started_with_odd_saves();

    assert_eq!(
        sm.export_file_name(OLD).unwrap(),
        format!("Career {OLD}-{OLD}.olsave")
    );
}

#[test]
fn deleting_an_odd_save_removes_its_file_and_its_entry() {
    let (_dir, saves_dir, mut sm) = started_with_odd_saves();

    for (id, _) in odd_saves() {
        assert!(sm.delete_save(id).unwrap(), "{id}");
        assert!(!saves_dir.join(format!("{id}.olsave")).exists(), "{id}");
    }

    assert!(sm.list_saves().is_empty());
}

#[test]
fn the_import_preview_names_the_odd_save_a_good_copy_would_replace() {
    let (dir, _saves_dir, sm) = started_with_odd_saves();
    let good = good_copy(dir.path());

    let prepared = sm
        .prepare_import(good, Some(&format!("Career-{OLD}.olsave")))
        .unwrap();

    assert_eq!(prepared.replaces.map(|e| e.id), Some(OLD.to_string()));
}

#[test]
fn importing_a_good_copy_over_an_odd_save_without_replace_is_refused_and_keeps_it() {
    let (dir, saves_dir, mut sm) = started_with_odd_saves();
    let good = good_copy(dir.path());
    let before = snapshot(&saves_dir);

    let prepared = sm
        .prepare_import(good, Some(&format!("Career-{OLD}.olsave")))
        .unwrap();
    let err = sm.commit_import(prepared, false).unwrap_err();

    assert_eq!(err, SaveImportError::IdTaken);
    assert_eq!(snapshot(&saves_dir), before);
}

#[test]
fn importing_a_good_copy_over_an_odd_save_with_replace_recovers_it() {
    for odd in [OLD, NEW, SHORT] {
        let (dir, _saves_dir, mut sm) = started_with_odd_saves();
        let good = good_copy(dir.path());

        let prepared = sm
            .prepare_import(good, Some(&format!("Career-{odd}.olsave")))
            .unwrap();
        let entry = sm.commit_import(prepared, true).unwrap();

        assert_eq!(entry.id, odd);
        assert_eq!(entry.created_at, "2026-01-01T00:00:00+00:00", "{odd}");
        assert_eq!(listing_of(&sm, odd).status, SaveStatus::Ok, "{odd}");
        assert_eq!(
            sm.load_game(odd).unwrap().manager.last_name,
            "Smith",
            "{odd}"
        );
        assert_eq!(sm.list_saves().len(), 3, "{odd}");
    }
}

/// The bytes of a valid save made by another manager, as an older build wrote it: with no
/// id in the file, so only the file name says which save it replaces.
fn good_copy(dir: &Path) -> Vec<u8> {
    use flate2::{Compression, read::GzDecoder, write::GzEncoder};
    use std::io::Write;
    let mut source = SaveManager::init(&dir.join("pc")).unwrap();
    let id = source.create_save(&sample_game(), "Main career").unwrap();
    let stored = fs::read(source.save_path(&id)).unwrap();
    let mut json = Vec::new();
    GzDecoder::new(&stored[4..]).read_to_end(&mut json).unwrap();
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(&json).unwrap();
    let mut bytes = stored[..4].to_vec();
    bytes.extend_from_slice(&encoder.finish().unwrap());
    bytes
}

/// An entry whose path cannot be examined (a parent that is a file gives ENOTDIR, not
/// "not found"): the file may well be there, so nothing is dropped or written.
#[cfg(unix)]
mod unexaminable_path {
    use super::*;

    const ID: &str = "blocker/entry";

    fn folder_with_unexaminable_entry() -> (TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let saves_dir = dir.path().join("saves");
        let mut sm = SaveManager::init(&saves_dir).unwrap();
        sm.save_index
            .record_new_save(SaveEntry {
                id: ID.to_string(),
                name: "Unexaminable".to_string(),
                manager_name: "Old Manager".to_string(),
                created_at: "2026-01-01T00:00:00+00:00".to_string(),
                last_played_at: "2026-01-02T00:00:00+00:00".to_string(),
            })
            .unwrap();
        fs::write(saves_dir.join("blocker"), b"a file where a folder would be").unwrap();
        (dir, saves_dir)
    }

    #[test]
    fn starting_keeps_an_entry_whose_file_cannot_be_examined() {
        let (_dir, saves_dir) = folder_with_unexaminable_entry();

        let sm = SaveManager::init(&saves_dir).unwrap();

        assert_eq!(sm.list_saves().len(), 1);
    }

    #[test]
    fn an_entry_whose_file_cannot_be_examined_is_listed_as_unreadable() {
        let (_dir, saves_dir) = folder_with_unexaminable_entry();
        let sm = SaveManager::init(&saves_dir).unwrap();

        assert_eq!(listing_of(&sm, ID).status, SaveStatus::Unreadable);
    }

    #[test]
    fn saving_over_an_entry_whose_file_cannot_be_examined_is_refused_before_any_write() {
        let (_dir, saves_dir) = folder_with_unexaminable_entry();
        let mut sm = SaveManager::init(&saves_dir).unwrap();
        let before = snapshot(&saves_dir);

        let err = sm.save_game(&sample_game(), ID).unwrap_err();

        assert!(err.starts_with("save_unreadable:"), "{err}");
        assert_eq!(snapshot(&saves_dir), before);
    }
}
