//! The welcome message reports the real days to the season start. Own test
//! binary: the global template store is a `OnceLock` and is filled here.

use olm_core::messages;
use olm_core::messages::template_store::init_template_store;

fn init_store() {
    let dir = tempfile::tempdir().unwrap();
    let json = r#"{"id":"welcome","trigger":"select_team","sender":"board","category":"Welcome",
        "subject":"Welcome to {team}!","body":"{team} begins in {days} days."}"#;
    std::fs::write(dir.path().join("welcome.json"), json).unwrap();
    // The first test to run fills the store; the others find it set.
    let _ = init_template_store(dir.path());
}

#[test]
fn welcome_message_passes_the_real_days_to_the_season_start() {
    init_store();

    let msg = messages::welcome_message("Test FC", "team1", "2026-01-01", "en", 16);

    assert_eq!(msg.i18n_params.get("days").map(String::as_str), Some("16"));
    assert_eq!(msg.body, "Test FC begins in 16 days.");
}

#[test]
fn welcome_message_passes_the_days_as_the_plural_count_too() {
    init_store();

    let msg = messages::welcome_message("Test FC", "team1", "2026-01-01", "en", 1);

    assert_eq!(msg.i18n_params.get("count").map(String::as_str), Some("1"));
}
