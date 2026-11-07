//! Template-trigger messages must carry render-time i18n keys and params, so the
//! UI shows them in the active language instead of the stored English text.
//!
//! These tests load the real `data/messages` templates (the production path).

use olm_core::domain::message::InboxMessage;
use olm_core::messages;
use olm_core::messages::template_store::{init_senders_store, init_template_store};
use std::path::PathBuf;
use std::sync::Once;

fn load_templates() {
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../data/messages");
        init_template_store(&root.join("triggers")).expect("init template store");
        init_senders_store(&root.join("senders"));
    });
}

/// Run `build` several times (templates are picked at random) and check that every
/// message keeps its subject and body keys under `prefix` and describes the same
/// template variant.
fn assert_keyed(prefix: &str, build: impl Fn() -> InboxMessage) {
    load_templates();
    for _ in 0..40 {
        let msg = build();
        let subject = msg.subject_key.as_deref().unwrap_or_default().to_string();
        let body = msg.body_key.as_deref().unwrap_or_default().to_string();
        let variant = subject
            .strip_prefix(&format!("{prefix}."))
            .and_then(|s| s.strip_suffix(".subject"))
            .unwrap_or_else(|| panic!("subject_key {subject:?} is not under {prefix}"));
        assert_eq!(body, format!("{prefix}.{variant}.body"));
    }
}

fn param<'a>(msg: &'a InboxMessage, name: &str) -> Option<&'a str> {
    msg.i18n_params.get(name).map(String::as_str)
}

#[test]
fn pre_match_template_message_attaches_keys() {
    assert_keyed("be.msg.preMatch.templates", || {
        messages::pre_match_message("f1", "Fnatic", "t2", true, 3, "2025-08-12", "2025-08-09")
    });
}

#[test]
fn pre_match_template_message_sends_iso_date_and_venue_key() {
    load_templates();
    let home = messages::pre_match_message("f1", "Fnatic", "t2", true, 3, "2025-08-12", "d");
    let away = messages::pre_match_message("f2", "Fnatic", "t2", false, 3, "2025-08-12", "d");
    assert_eq!(param(&home, "date"), Some("2025-08-12"));
    assert_eq!(param(&home, "opponent"), Some("Fnatic"));
    assert_eq!(param(&home, "venue"), Some("be.msg.preMatch.venue.home"));
    assert_eq!(param(&away, "venue"), Some("be.msg.preMatch.venue.away"));
    assert!(!home.body.contains("Local"), "stored text must be English: {}", home.body);
}

#[test]
fn match_result_template_message_attaches_keys() {
    assert_keyed("be.msg.matchResult.templates", || {
        messages::match_result_message("f1", "KOI", "G2", 2, 1, "t1", "t2", "t1", 3, "2025-08-12")
    });
}

#[test]
fn match_result_template_message_carries_the_placeholder_params() {
    load_templates();
    let msg = messages::match_result_message("f1", "KOI", "G2", 2, 1, "t1", "t2", "t1", 3, "d");
    assert_eq!(param(&msg, "home"), Some("KOI"));
    assert_eq!(param(&msg, "away"), Some("G2"));
    assert_eq!(param(&msg, "opponent"), Some("G2"));
    assert_eq!(param(&msg, "score"), Some("KOI:2-1"));
}

// ---------------------------------------------------------------------------
// player events
// ---------------------------------------------------------------------------

use olm_core::player_events;

const PLAYER_EVENT_PREFIX: &str = "be.msg.playerEvent.templates";

#[test]
fn low_morale_template_message_attaches_keys_and_params() {
    assert_keyed(PLAYER_EVENT_PREFIX, || {
        player_events::low_morale_from_template("m1", "Caps", 31, "2025-08-12").unwrap()
    });
    let msg = player_events::low_morale_from_template("m1", "Caps", 31, "d").unwrap();
    assert_eq!(param(&msg, "player"), Some("Caps"));
    assert_eq!(param(&msg, "morale"), Some("31"));
}

#[test]
fn bench_complaint_template_message_attaches_keys_and_params() {
    assert_keyed(PLAYER_EVENT_PREFIX, || {
        player_events::bench_complaint_from_template("m1", "Caps", "2025-08-12").unwrap()
    });
    let msg = player_events::bench_complaint_from_template("m1", "Caps", "d").unwrap();
    assert_eq!(param(&msg, "player"), Some("Caps"));
}

#[test]
fn happy_player_template_message_attaches_keys_and_params() {
    assert_keyed(PLAYER_EVENT_PREFIX, || {
        player_events::happy_player_from_template("m1", "Caps", "2025-08-12").unwrap()
    });
    let msg = player_events::happy_player_from_template("m1", "Caps", "d").unwrap();
    assert_eq!(param(&msg, "morale"), Some("100"));
}

#[test]
fn contract_concern_template_message_attaches_keys_and_params() {
    assert_keyed(PLAYER_EVENT_PREFIX, || {
        player_events::contract_concern_from_template("m1", "Caps", 20, "2025-08-12").unwrap()
    });
    let msg = player_events::contract_concern_from_template("m1", "Caps", 20, "d").unwrap();
    assert_eq!(param(&msg, "days"), Some("20"));
}

// ---------------------------------------------------------------------------
// random events
// ---------------------------------------------------------------------------

use olm_core::random_events;

#[test]
fn podcast_template_message_attaches_keys_and_params() {
    assert_keyed("be.msg.allio.templates", || {
        random_events::allio_podcast_from_template("m1", "KOI", "Caps", "2025-08-12").unwrap()
    });
    let msg = random_events::allio_podcast_from_template("m1", "KOI", "Caps", "d").unwrap();
    assert_eq!(param(&msg, "team"), Some("KOI"));
    assert_eq!(param(&msg, "player"), Some("Caps"));
}

#[test]
fn rival_interest_template_message_attaches_keys_and_params() {
    assert_keyed("be.msg.rivalInterest.templates", || {
        random_events::rival_interest_from_template("m1", "Caps", "G2", "2025-08-12").unwrap()
    });
    let msg = random_events::rival_interest_from_template("m1", "Caps", "G2", "d").unwrap();
    assert_eq!(param(&msg, "player"), Some("Caps"));
    assert_eq!(param(&msg, "rival"), Some("G2"));
}
