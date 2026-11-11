//! Texts of the start-up question, read from the game's own locale files.
//!
//! The locale JSON files are embedded at build time and parsed only when the
//! question is about to be shown, so a start that does not ask pays nothing.

use serde_json::Value;

const LOCALES: [(&str, &str); 8] = [
    ("en", include_str!("../../../src/i18n/locales/en.json")),
    ("es", include_str!("../../../src/i18n/locales/es.json")),
    ("fr", include_str!("../../../src/i18n/locales/fr.json")),
    ("de", include_str!("../../../src/i18n/locales/de.json")),
    ("it", include_str!("../../../src/i18n/locales/it.json")),
    ("pt", include_str!("../../../src/i18n/locales/pt.json")),
    ("pt-BR", include_str!("../../../src/i18n/locales/pt-BR.json")),
    ("tr", include_str!("../../../src/i18n/locales/tr.json")),
];

/// Keys of the question, all under `linuxRender.dialog` in the locale files.
const KEYS: [&str; 9] = [
    "title",
    "intro",
    "fast",
    "fastHint",
    "compat",
    "compatHint",
    "remember",
    "rememberHint",
    "button",
];

/// Everything the question window shows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DialogTexts {
    pub title: String,
    pub intro: String,
    pub fast: String,
    pub fast_hint: String,
    pub compat: String,
    pub compat_hint: String,
    pub remember: String,
    pub remember_hint: String,
    pub button: String,
}

fn parse_locale(code: &str) -> Value {
    LOCALES
        .iter()
        .find(|(name, _)| *name == code)
        .and_then(|(_, json)| serde_json::from_str(json).ok())
        .unwrap_or(Value::Null)
}

fn lookup(tree: &Value, key: &str) -> Option<String> {
    tree.get("linuxRender")?
        .get("dialog")?
        .get(key)?
        .as_str()
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

impl DialogTexts {
    /// Texts for a supported locale code; a key missing there falls back to
    /// English, and to the key name if English lacks it too.
    pub fn load(code: &str) -> Self {
        let wanted = parse_locale(code);
        let english = if code == "en" { Value::Null } else { parse_locale("en") };
        Self::from_trees(&wanted, &english)
    }

    fn from_trees(wanted: &Value, english: &Value) -> Self {
        let mut texts = KEYS.map(|key| {
            lookup(wanted, key)
                .or_else(|| lookup(english, key))
                .unwrap_or_else(|| key.to_string())
        });
        let [title, intro, fast, fast_hint, compat, compat_hint, remember, remember_hint, button] =
            &mut texts;
        Self {
            title: std::mem::take(title),
            intro: std::mem::take(intro),
            fast: std::mem::take(fast),
            fast_hint: std::mem::take(fast_hint),
            compat: std::mem::take(compat),
            compat_hint: std::mem::take(compat_hint),
            remember: std::mem::take(remember),
            remember_hint: std::mem::take(remember_hint),
            button: std::mem::take(button),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_locale_defines_every_dialog_key() {
        for (code, _) in LOCALES {
            let tree = parse_locale(code);
            for key in KEYS {
                assert!(lookup(&tree, key).is_some(), "{code} lacks linuxRender.dialog.{key}");
            }
        }
    }

    #[test]
    fn spanish_texts_differ_from_english() {
        assert_ne!(DialogTexts::load("es").title, DialogTexts::load("en").title);
    }

    #[test]
    fn missing_key_falls_back_to_english() {
        let english = parse_locale("en");
        let sparse: Value = serde_json::json!({ "linuxRender": { "dialog": { "title": "T" } } });
        let texts = DialogTexts::from_trees(&sparse, &english);
        assert_eq!(texts.title, "T");
        assert_eq!(texts.intro, DialogTexts::load("en").intro);
    }

    #[test]
    fn unknown_locale_code_yields_english() {
        assert_eq!(DialogTexts::load("xx"), DialogTexts::load("en"));
    }
}
