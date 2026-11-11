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

/// Template id behind a message's subject key, e.g. `victory_2`.
fn result_variant(msg: &InboxMessage) -> String {
    msg.subject_key
        .as_deref()
        .and_then(|key| key.strip_prefix("be.msg.matchResult.templates."))
        .and_then(|key| key.strip_suffix(".subject"))
        .unwrap_or_else(|| panic!("unexpected subject_key {:?}", msg.subject_key))
        .to_string()
}

/// Every series score the engine stores in `MatchResult` (`home_wins`, `away_wins`) for
/// best of one and best of three, with the user's club on either side. The headline
/// template must name the outcome from the user's club side and never be a draw.
#[test]
fn match_result_headline_names_the_outcome_for_the_user_club() {
    load_templates();
    let series: [(u8, u8); 6] = [(1, 0), (0, 1), (2, 0), (2, 1), (1, 2), (0, 2)];
    for (home_wins, away_wins) in series {
        for user_is_home in [true, false] {
            let user_team = if user_is_home { "t1" } else { "t2" };
            let user_won = if user_is_home {
                home_wins > away_wins
            } else {
                away_wins > home_wins
            };
            let expected = if user_won { "victory_" } else { "defeat_" };
            for _ in 0..60 {
                let msg = messages::match_result_message(
                    "f1", "KOI", "G2", home_wins, away_wins, "t1", "t2", user_team, 3, "d",
                );
                let variant = result_variant(&msg);
                assert!(
                    variant.starts_with(expected),
                    "{home_wins}-{away_wins} with the user {}: got {variant}, wanted {expected}*",
                    if user_is_home { "at home" } else { "away" },
                );
            }
        }
    }
}

/// Render a stored `be.msg.*` key from a locale file the way i18next does for plain
/// `{{name}}` placeholders.
fn render_locale_key(lang: &str, key: &str, msg: &InboxMessage) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(format!("../../../src/i18n/locales/{lang}.json"));
    let locale: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path).expect("read locale")).unwrap();
    let mut node = &locale;
    for part in key.split('.') {
        node = &node[part];
    }
    let mut text = node
        .as_str()
        .unwrap_or_else(|| panic!("{lang}: no key {key}"))
        .to_string();
    for (name, value) in &msg.i18n_params {
        text = text.replace(&format!("{{{{{name}}}}}"), value);
    }
    text
}

/// The player sees the locale text, not the stored English fallback. For every series the
/// engine stores, with the user's club on either side, the rendered Spanish and English
/// headline and body name each team at most once and show the score from the side the
/// sentence states: fixture order for "<home> h-a <away>", the user's own wins first otherwise.
#[test]
fn match_result_locale_text_names_each_team_once_with_the_right_score() {
    load_templates();
    let series: [(u8, u8); 6] = [(1, 0), (0, 1), (2, 0), (2, 1), (1, 2), (0, 2)];
    for (home_wins, away_wins) in series {
        for user_is_home in [true, false] {
            let user_team = if user_is_home { "t1" } else { "t2" };
            let (user_wins, opp_wins) = if user_is_home {
                (home_wins, away_wins)
            } else {
                (away_wins, home_wins)
            };
            for _ in 0..40 {
                let msg = messages::match_result_message(
                    "f1",
                    "Alpha Squad",
                    "Beta Club",
                    home_wins,
                    away_wins,
                    "t1",
                    "t2",
                    user_team,
                    3,
                    "d",
                );
                for lang in ["en", "es"] {
                    for (field, key) in [
                        ("subject", msg.subject_key.clone().unwrap()),
                        ("body", msg.body_key.clone().unwrap()),
                    ] {
                        let text = render_locale_key(lang, &key, &msg);
                        let ctx = format!(
                            "{lang} {field} {key} {home_wins}-{away_wins} home={user_is_home}: {text}"
                        );
                        assert!(!text.contains("{{"), "unresolved placeholder, {ctx}");
                        for team in ["Alpha Squad", "Beta Club"] {
                            assert!(text.matches(team).count() <= 1, "{team} named twice, {ctx}");
                        }
                        let fixture_order =
                            format!("Alpha Squad {home_wins}-{away_wins} Beta Club");
                        let reversed = format!("Alpha Squad {away_wins}-{home_wins} Beta Club");
                        if home_wins != away_wins {
                            assert!(
                                !text.contains(&reversed),
                                "score from the wrong side, {ctx}"
                            );
                        }
                        let user_form = format!("{user_wins}-{opp_wins}");
                        assert!(
                            text.contains(&fixture_order) || text.contains(&user_form),
                            "no score from the stated side, {ctx}"
                        );
                    }
                }
            }
        }
    }
}

/// A message built from the real templates keeps what the hard-coded one carries: the
/// fixture id, the score context the inbox detail pane reads, the "View standings" action
/// and a High priority for a defeat.
#[test]
fn match_result_template_message_carries_context_action_and_priority() {
    use olm_core::domain::message::{ActionType, MessagePriority};
    load_templates();
    for (home_wins, away_wins, priority) in [
        (2, 1, MessagePriority::Normal),
        (1, 2, MessagePriority::High),
    ] {
        for _ in 0..40 {
            let msg = messages::match_result_message(
                "f1", "KOI", "G2", home_wins, away_wins, "t1", "t2", "t1", 3, "d",
            );
            assert!(msg.subject_key.is_some(), "must be the template path");
            assert_eq!(msg.priority, priority);
            assert_eq!(msg.context.fixture_id.as_deref(), Some("f1"));
            let result = msg
                .context
                .match_result
                .as_ref()
                .expect("match_result context");
            assert_eq!(
                (result.home_team_id.as_str(), result.away_team_id.as_str()),
                ("t1", "t2")
            );
            assert_eq!(
                (result.home_goals, result.away_goals),
                (home_wins, away_wins)
            );
            let standings = msg.actions.iter().find(|a| a.id == "view_standings");
            let standings = standings.expect("view_standings action");
            assert!(
                matches!(&standings.action_type, ActionType::NavigateTo { route } if route == "/dashboard?tab=Competitions")
            );
        }
    }
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

#[test]
fn media_story_template_message_attaches_keys_and_params() {
    assert_keyed("be.msg.mediaStory.templates", || {
        random_events::media_story_from_template("m1", "KOI", "Caps", "2025-08-12").unwrap()
    });
    let msg = random_events::media_story_from_template("m1", "KOI", "Caps", "d").unwrap();
    assert_eq!(param(&msg, "team"), Some("KOI"));
    assert_eq!(param(&msg, "player"), Some("Caps"));
}

#[test]
fn stream_template_message_attaches_keys_and_params() {
    assert_keyed("be.msg.yuste.templates", || {
        random_events::yuste_stream_from_template("m1", "KOI", "Caps", "2025-08-12").unwrap()
    });
    let msg = random_events::yuste_stream_from_template("m1", "KOI", "Caps", "d").unwrap();
    assert_eq!(param(&msg, "team"), Some("KOI"));
    assert_eq!(param(&msg, "player"), Some("Caps"));
}

#[test]
fn stream_template_message_fills_the_team_placeholder_in_the_stored_text() {
    load_templates();
    for _ in 0..40 {
        let msg = random_events::yuste_stream_from_template("m1", "KOI", "Caps", "d").unwrap();
        assert!(!msg.body.contains("{team}"), "unfilled placeholder: {}", msg.body);
    }
}
