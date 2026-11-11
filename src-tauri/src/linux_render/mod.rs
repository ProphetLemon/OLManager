//! Linux start-up choice of WebKitGTK's rendering backend.
//!
//! WebKitGTK reads `WEBKIT_DISABLE_DMABUF_RENDERER` once, when the first web
//! view is created, and any value other than `0` disables its accelerated
//! backing store. So the decision is taken before `tauri::Builder` runs, from
//! the variable as the user set it and from the saved `linux_render_mode`
//! setting. When the setting is `ask`, a small native GTK window asks.
//!
//! The decision (`decide`), the language pick and the settings file handling
//! are plain functions that need no display; only `dialog` touches GTK.

mod dialog;
mod texts;

use crate::commands::settings::{AppSettings, RenderChoice};
use serde_json::Value;
use std::path::{Path, PathBuf};
use texts::DialogTexts;

/// Environment variable WebKitGTK reads to disable its accelerated renderer.
pub const DMABUF_ENV: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";

/// Must match the `identifier` in `tauri.conf.json`: Tauri's `app_data_dir`
/// on Linux is `<data dir>/<identifier>`.
const APP_IDENTIFIER: &str = "com.openleaguemanager.olmanager";

/// Key of the choice inside the saved settings file.
const SETTING_KEY: &str = "linux_render_mode";

/// Rendering backend the webview will use.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RenderMode {
    /// Variable not set: WebKitGTK uses its accelerated path.
    Accelerated,
    /// Variable set to `1` by the app: the slower, more compatible path.
    Compatibility,
}

impl RenderMode {
    fn label(self) -> &'static str {
        match self {
            Self::Accelerated => "accelerated",
            Self::Compatibility => "compatibility",
        }
    }

    fn choice(self) -> RenderChoice {
        match self {
            Self::Accelerated => RenderChoice::Accelerated,
            Self::Compatibility => RenderChoice::Compatibility,
        }
    }
}

/// What the start-up has to do before the webview exists.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartupPlan {
    /// The user set the variable (any value): leave it, show nothing.
    UserEnvironment,
    /// A saved choice settles it.
    Saved(RenderMode),
    /// Nothing settles it: show the question.
    Ask,
}

/// Pure decision from the saved choice and the variable as the user set it.
pub fn decide(saved: RenderChoice, user_value: Option<&str>) -> StartupPlan {
    match (user_value, saved) {
        (Some(_), _) => StartupPlan::UserEnvironment,
        (None, RenderChoice::Accelerated) => StartupPlan::Saved(RenderMode::Accelerated),
        (None, RenderChoice::Compatibility) => StartupPlan::Saved(RenderMode::Compatibility),
        (None, RenderChoice::Ask) => StartupPlan::Ask,
    }
}

/// How the question ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Answer {
    /// The button was pressed.
    Chosen { mode: RenderMode, remember: bool },
    /// The window was closed without pressing the button.
    Dismissed,
    /// The window could not be shown; the text says why.
    Unavailable(String),
}

/// Why the app started in the mode it did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Reason {
    Environment,
    SavedChoice,
    AnsweredNow { remembered: bool },
    ClosedWithoutAnswer,
    QuestionUnavailable(String),
}

/// Outcome of the start-up, ready to be logged.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StartupReport {
    /// `None` when the user's own variable decides.
    pub mode: Option<RenderMode>,
    pub reason: Reason,
    /// Set when a remembered choice could not be written.
    pub save_error: Option<String>,
}

impl StartupReport {
    /// The single line that says the mode and the reason.
    pub fn line(&self) -> String {
        let mode = match self.mode {
            Some(mode) => mode.label(),
            None => "as set by the user",
        };
        let reason = match &self.reason {
            Reason::Environment => format!("{DMABUF_ENV} is set in the environment"),
            Reason::SavedChoice => "saved choice".to_string(),
            Reason::AnsweredNow { remembered: true } => "answered now, remembered".to_string(),
            Reason::AnsweredNow { remembered: false } => "answered now, this start only".to_string(),
            Reason::ClosedWithoutAnswer => "question closed without an answer".to_string(),
            Reason::QuestionUnavailable(why) => format!("question unavailable: {why}"),
        };
        format!("Linux rendering: {mode} ({reason})")
    }
}

/// Path of the saved settings file, derived the way Tauri derives `app_data_dir`.
pub fn settings_file_path() -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join(APP_IDENTIFIER).join("settings.json"))
}

fn read_settings_value(path: &Path) -> Option<Value> {
    let json = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<Value>(&json).ok().filter(Value::is_object)
}

/// Saved choice of a settings file. A missing or unreadable file, invalid
/// JSON, a missing field or an unknown value all mean `ask`.
fn read_saved_choice(settings: Option<&Value>) -> RenderChoice {
    settings
        .and_then(|value| value.get(SETTING_KEY))
        .map(RenderChoice::from_value)
        .unwrap_or_default()
}

const SUPPORTED_LANGUAGES: [&str; 8] = ["en", "es", "fr", "de", "it", "pt", "pt-BR", "tr"];

/// Maps a language tag (`es`, `pt_BR.UTF-8`, `de_DE@euro`) to a supported
/// locale code; `None` when the language is not one of the eight.
fn normalize_language(tag: &str) -> Option<&'static str> {
    let base = tag.split(['.', '@']).next().unwrap_or("");
    let mut parts = base.split(['_', '-']);
    let language = parts.next()?.to_ascii_lowercase();
    let region = parts.next().map(str::to_ascii_uppercase);
    if language == "pt" {
        return Some(if region.as_deref() == Some("BR") { "pt-BR" } else { "pt" });
    }
    SUPPORTED_LANGUAGES.iter().copied().find(|code| *code == language)
}

/// Language of the question: the saved one, else the system's, else English.
fn pick_language(saved: Option<&str>, system: Option<&str>) -> &'static str {
    saved
        .and_then(normalize_language)
        .or_else(|| system.and_then(normalize_language))
        .unwrap_or("en")
}

/// First non-empty of `LC_ALL`, `LC_MESSAGES`, `LANG`.
fn system_locale() -> Option<String> {
    ["LC_ALL", "LC_MESSAGES", "LANG"]
        .iter()
        .filter_map(|name| std::env::var(name).ok())
        .find(|value| !value.is_empty())
}

#[derive(Debug, thiserror::Error)]
enum SaveError {
    #[error("settings file: {0}")]
    Io(#[from] std::io::Error),
    #[error("settings file is not a JSON object, left untouched")]
    NotAnObject,
    #[error("settings could not be serialised: {0}")]
    Serialise(#[from] serde_json::Error),
}

/// Writes the remembered choice into the settings file, keeping every other
/// field. With no file yet it writes the full defaults, because the other
/// settings have no serde default and a file holding only this field would
/// not load. A file that is not a JSON object is never overwritten.
fn save_choice(path: &Path, mode: RenderMode) -> Result<(), SaveError> {
    let mut settings = if path.exists() {
        let json = std::fs::read_to_string(path)?;
        serde_json::from_str::<Value>(&json).map_err(|_| SaveError::NotAnObject)?
    } else {
        serde_json::to_value(AppSettings::default())?
    };
    let object = settings.as_object_mut().ok_or(SaveError::NotAnObject)?;
    object.insert(SETTING_KEY.to_string(), serde_json::to_value(mode.choice())?);

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(&settings)?)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// Runs the whole start-up decision. `ask` shows the question and is called
/// only when the plan is `Ask`, with the texts already in the right language.
pub fn startup_with<F>(
    settings_path: Option<&Path>,
    user_value: Option<&str>,
    system_locale: Option<&str>,
    ask: F,
) -> StartupReport
where
    F: FnOnce(&DialogTexts) -> Answer,
{
    let settings = settings_path.and_then(read_settings_value);
    let saved = read_saved_choice(settings.as_ref());

    match decide(saved, user_value) {
        StartupPlan::UserEnvironment => StartupReport {
            mode: None,
            reason: Reason::Environment,
            save_error: None,
        },
        StartupPlan::Saved(mode) => StartupReport {
            mode: Some(mode),
            reason: Reason::SavedChoice,
            save_error: None,
        },
        StartupPlan::Ask => {
            let saved_language = settings
                .as_ref()
                .and_then(|value| value.get("language"))
                .and_then(Value::as_str);
            let texts = DialogTexts::load(pick_language(saved_language, system_locale));
            match ask(&texts) {
                Answer::Chosen { mode, remember } => {
                    let save_error = match (remember, settings_path) {
                        (true, Some(path)) => save_choice(path, mode).err().map(|e| e.to_string()),
                        (true, None) => Some("settings directory unknown".to_string()),
                        (false, _) => None,
                    };
                    StartupReport {
                        mode: Some(mode),
                        reason: Reason::AnsweredNow {
                            remembered: remember && save_error.is_none(),
                        },
                        save_error,
                    }
                }
                Answer::Dismissed => StartupReport {
                    mode: Some(RenderMode::Accelerated),
                    reason: Reason::ClosedWithoutAnswer,
                    save_error: None,
                },
                Answer::Unavailable(why) => StartupReport {
                    mode: Some(RenderMode::Accelerated),
                    reason: Reason::QuestionUnavailable(why),
                    save_error: None,
                },
            }
        }
    }
}

/// Decides, asks if needed, and applies the result to the process
/// environment. Must run first thing in `run()`, on the main thread, before
/// the first web view exists.
pub fn apply_at_startup() -> StartupReport {
    let path = settings_file_path();
    let user_value = std::env::var(DMABUF_ENV).ok();
    let locale = system_locale();
    let report = startup_with(path.as_deref(), user_value.as_deref(), locale.as_deref(), dialog::ask);
    if report.mode == Some(RenderMode::Compatibility) {
        std::env::set_var(DMABUF_ENV, "1");
    }
    report
}

#[cfg(test)]
mod tests {
    use super::*;

    fn never_asked(_: &DialogTexts) -> Answer {
        panic!("the question must not be shown");
    }

    fn settings_in(dir: &tempfile::TempDir, contents: &str) -> PathBuf {
        let path = dir.path().join("settings.json");
        std::fs::write(&path, contents).unwrap();
        path
    }

    #[test]
    fn user_variable_wins_over_every_saved_choice() {
        for saved in [RenderChoice::Ask, RenderChoice::Accelerated, RenderChoice::Compatibility] {
            assert_eq!(decide(saved, Some("0")), StartupPlan::UserEnvironment);
            assert_eq!(decide(saved, Some("1")), StartupPlan::UserEnvironment);
        }
    }

    #[test]
    fn saved_accelerated_sets_nothing() {
        assert_eq!(
            decide(RenderChoice::Accelerated, None),
            StartupPlan::Saved(RenderMode::Accelerated)
        );
    }

    #[test]
    fn saved_compatibility_selects_compatibility() {
        assert_eq!(
            decide(RenderChoice::Compatibility, None),
            StartupPlan::Saved(RenderMode::Compatibility)
        );
    }

    #[test]
    fn saved_ask_shows_the_question() {
        assert_eq!(decide(RenderChoice::Ask, None), StartupPlan::Ask);
    }

    #[test]
    fn saved_language_beats_the_system_language() {
        assert_eq!(pick_language(Some("fr"), Some("de_DE.UTF-8")), "fr");
    }

    #[test]
    fn system_language_is_used_without_a_saved_one() {
        assert_eq!(pick_language(None, Some("de_DE.UTF-8")), "de");
    }

    #[test]
    fn brazilian_portuguese_maps_to_pt_br_and_other_portuguese_to_pt() {
        assert_eq!(pick_language(None, Some("pt_BR.UTF-8")), "pt-BR");
        assert_eq!(pick_language(None, Some("pt_PT")), "pt");
    }

    #[test]
    fn unsupported_or_missing_language_falls_back_to_english() {
        assert_eq!(pick_language(None, Some("C")), "en");
        assert_eq!(pick_language(Some("ja"), Some("POSIX")), "en");
        assert_eq!(pick_language(None, None), "en");
    }

    #[test]
    fn unsupported_saved_language_falls_through_to_the_system_one() {
        assert_eq!(pick_language(Some("ja"), Some("it_IT.UTF-8")), "it");
    }

    #[test]
    fn missing_invalid_or_fieldless_settings_read_as_ask() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("settings.json");
        assert_eq!(read_saved_choice(read_settings_value(&missing).as_ref()), RenderChoice::Ask);
        let invalid = settings_in(&dir, "{ not json");
        assert_eq!(read_saved_choice(read_settings_value(&invalid).as_ref()), RenderChoice::Ask);
        let fieldless = settings_in(&dir, r#"{"theme":"dark"}"#);
        assert_eq!(read_saved_choice(read_settings_value(&fieldless).as_ref()), RenderChoice::Ask);
    }

    #[test]
    fn saved_compatibility_is_read_from_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = settings_in(&dir, r#"{"linux_render_mode":"compatibility"}"#);
        assert_eq!(
            read_saved_choice(read_settings_value(&path).as_ref()),
            RenderChoice::Compatibility
        );
    }

    #[test]
    fn startup_with_user_variable_shows_no_question() {
        let dir = tempfile::tempdir().unwrap();
        let path = settings_in(&dir, "{}");
        let report = startup_with(Some(&path), Some("1"), None, never_asked);
        assert_eq!(report.mode, None);
        assert_eq!(report.reason, Reason::Environment);
    }

    #[test]
    fn startup_with_saved_choice_shows_no_question() {
        let dir = tempfile::tempdir().unwrap();
        let path = settings_in(&dir, r#"{"linux_render_mode":"compatibility"}"#);
        let report = startup_with(Some(&path), None, None, never_asked);
        assert_eq!(report.mode, Some(RenderMode::Compatibility));
        assert_eq!(report.reason, Reason::SavedChoice);
    }

    #[test]
    fn answer_without_remember_applies_now_and_saves_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let report = startup_with(Some(&path), None, None, |_| Answer::Chosen {
            mode: RenderMode::Compatibility,
            remember: false,
        });
        assert_eq!(report.mode, Some(RenderMode::Compatibility));
        assert_eq!(report.reason, Reason::AnsweredNow { remembered: false });
        assert!(!path.exists());
    }

    #[test]
    fn remembered_answer_keeps_the_other_fields_of_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = settings_in(&dir, r#"{"theme":"light","language":"es","currency":"USD"}"#);
        let report = startup_with(Some(&path), None, None, |_| Answer::Chosen {
            mode: RenderMode::Compatibility,
            remember: true,
        });
        assert_eq!(report.reason, Reason::AnsweredNow { remembered: true });
        let saved: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(saved["theme"], "light");
        assert_eq!(saved["language"], "es");
        assert_eq!(saved["currency"], "USD");
        assert_eq!(saved[SETTING_KEY], "compatibility");
    }

    #[test]
    fn remembered_answer_without_a_file_writes_settings_that_load() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("settings.json");
        startup_with(Some(&path), None, None, |_| Answer::Chosen {
            mode: RenderMode::Accelerated,
            remember: true,
        });
        let loaded: AppSettings = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(loaded.linux_render_mode, RenderChoice::Accelerated);
    }

    #[test]
    fn unwritable_settings_keep_the_choice_for_this_start_only() {
        let dir = tempfile::tempdir().unwrap();
        let path = settings_in(&dir, "not json at all");
        let report = startup_with(Some(&path), None, None, |_| Answer::Chosen {
            mode: RenderMode::Compatibility,
            remember: true,
        });
        assert_eq!(report.mode, Some(RenderMode::Compatibility));
        assert_eq!(report.reason, Reason::AnsweredNow { remembered: false });
        assert!(report.save_error.is_some());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "not json at all");
    }

    #[test]
    fn closed_window_means_accelerated_and_saves_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let report = startup_with(Some(&path), None, None, |_| Answer::Dismissed);
        assert_eq!(report.mode, Some(RenderMode::Accelerated));
        assert!(!path.exists());
    }

    #[test]
    fn unavailable_question_starts_accelerated_with_the_reason() {
        let report = startup_with(None, None, None, |_| Answer::Unavailable("no display".into()));
        assert_eq!(report.mode, Some(RenderMode::Accelerated));
        assert!(report.line().contains("no display"));
    }

    #[test]
    fn question_is_given_the_texts_of_the_saved_language() {
        let dir = tempfile::tempdir().unwrap();
        let path = settings_in(&dir, r#"{"language":"es"}"#);
        let mut title = String::new();
        startup_with(Some(&path), None, Some("de_DE.UTF-8"), |texts| {
            title = texts.title.clone();
            Answer::Dismissed
        });
        assert_eq!(title, DialogTexts::load("es").title);
        assert_ne!(title, DialogTexts::load("de").title);
    }
}
