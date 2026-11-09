use olm_core::news::{
    league_roundup_article, season_preview_article, standings_update_article,
    title_race_storyline_article, unbeaten_streak_storyline_article, weekly_digest_article,
};

fn assert_lol_news_copy(text: &str) {
    let visible_text = text
        .replace("{{homeGoals}}", "")
        .replace("{{awayGoals}}", "");
    let lower = visible_text.to_lowercase();
    for forbidden in [
        "football",
        "goal",
        "goals",
        "premier division",
        "pitch",
        "club",
        "unbeaten",
        "scoring charts",
    ] {
        assert!(
            !lower.contains(forbidden),
            "expected LoL news/social copy without football-era term '{forbidden}', got: {visible_text}"
        );
    }
}

#[test]
fn league_roundup_and_standings_use_lol_esports_framing() {
    let results = vec![
        ("Alpha Esports".to_string(), 2, "Beta Gaming".to_string(), 0),
        (
            "Gamma Esports".to_string(),
            1,
            "Delta Gaming".to_string(),
            2,
        ),
    ];
    let standings = vec![
        ("Alpha Esports".to_string(), 12, 5),
        ("Beta Gaming".to_string(), 10, -1),
    ];

    let roundup = league_roundup_article(4, &results, "2026-04-25");
    let standings_article = standings_update_article(4, &standings, "2026-04-25");

    assert!(roundup.body.contains("maps played across 2 series"));
    assert!(roundup.body.contains("Alpha Esports 2 - 0 Beta Gaming"));
    assert!(
        roundup.headline.contains("Maps")
            || roundup.headline.contains("Series")
            || roundup.headline.contains("Drafts"),
        "expected LoL round-up framing, got: {}",
        roundup.headline
    );
    assert!(
        [
            Some("be.source.riftWire"),
            Some("be.source.riftHerald"),
            Some("be.source.leaguePulse"),
        ]
        .contains(&roundup.source_key.as_deref())
    );
    assert_eq!(roundup.i18n_params.get("totalMaps"), Some(&"5".to_string()));
    assert_lol_news_copy(&roundup.headline);
    assert_lol_news_copy(&roundup.body);
    assert_lol_news_copy(&roundup.source);

    assert!(standings_article.body.contains("league table"));
    assert!(standings_article.body.contains("map differential"));
    assert!(
        standings_article.headline.contains("Standings")
            || standings_article.headline.contains("League Table")
            || standings_article.headline.contains("Power Rankings"),
        "expected standings/power-ranking framing, got: {}",
        standings_article.headline
    );
    assert!(
        [
            Some("be.source.riftWire"),
            Some("be.source.riftHerald"),
            Some("be.source.leaguePulse"),
        ]
        .contains(&standings_article.source_key.as_deref())
    );
    assert_lol_news_copy(&standings_article.headline);
    assert_lol_news_copy(&standings_article.body);
    assert_lol_news_copy(&standings_article.source);
}

#[test]
fn season_digest_and_storylines_use_lol_social_media_copy() {
    let teams = vec!["Alpha Esports".to_string(), "Beta Gaming".to_string()];
    let preview = season_preview_article(&teams, "2026-04-25");
    let digest = weekly_digest_article(
        "digest",
        "2026-04-20",
        "Alpha Esports",
        "Kai",
        9,
        3,
        "2026-04-25",
    );
    let title_race = title_race_storyline_article(
        "race",
        "team1",
        "Alpha Esports",
        "team2",
        "Beta Gaming",
        1,
        "2026-04-25",
    );
    let streak =
        unbeaten_streak_storyline_article("streak", "team1", "Alpha Esports", 5, "2026-04-25");

    assert!(preview.body.contains("teams entering the split"));
    assert!(preview.body.contains("draft prep"));
    assert_eq!(preview.source_key.as_deref(), Some("be.source.riftHerald"));
    assert_lol_news_copy(&preview.headline);
    assert_lol_news_copy(&preview.body);
    assert_lol_news_copy(&preview.source);

    assert!(digest.body.contains("power rankings"));
    assert!(digest.body.contains("kill participation charts"));
    assert_eq!(
        digest.i18n_params.get("topPerformer"),
        Some(&"Kai".to_string())
    );
    assert!(!digest.i18n_params.contains_key("topScorer"));
    assert_lol_news_copy(&digest.headline);
    assert_lol_news_copy(&digest.body);

    assert!(title_race.headline.contains("Top Spot"));
    assert!(title_race.body.contains("playoff race"));
    assert_lol_news_copy(&title_race.headline);
    assert_lol_news_copy(&title_race.body);

    assert!(streak.headline.contains("Series Run"));
    assert!(streak.body.contains("series without a loss"));
    assert_lol_news_copy(&streak.headline);
    assert_lol_news_copy(&streak.body);
}

#[test]
fn backend_news_locales_avoid_obvious_football_framing() {
    let locales = [
        ("de", include_str!("../../../../src/i18n/locales/de.json")),
        ("en", include_str!("../../../../src/i18n/locales/en.json")),
        ("es", include_str!("../../../../src/i18n/locales/es.json")),
        ("fr", include_str!("../../../../src/i18n/locales/fr.json")),
        ("it", include_str!("../../../../src/i18n/locales/it.json")),
        (
            "pt-BR",
            include_str!("../../../../src/i18n/locales/pt-BR.json"),
        ),
        ("pt", include_str!("../../../../src/i18n/locales/pt.json")),
    ];

    for (locale_name, locale_json) in locales {
        let locale: serde_json::Value = serde_json::from_str(locale_json)
            .unwrap_or_else(|err| panic!("{locale_name} locale should parse: {err}"));
        let backend = &locale["be"];
        let mut visible_values = Vec::new();
        collect_string_values(&backend["source"], &mut visible_values);
        collect_string_values(&backend["news"], &mut visible_values);
        let serialized = visible_values.join("\n");

        assert_lol_news_copy(&serialized);
        assert!(
            serialized.contains("maps"),
            "{locale_name} backend news locale should mention maps"
        );
        assert!(
            serialized.contains("split"),
            "{locale_name} backend news locale should mention split"
        );
        assert!(
            serialized.contains("draft"),
            "{locale_name} backend news locale should mention draft"
        );
    }
}

fn collect_string_values(value: &serde_json::Value, values: &mut Vec<String>) {
    match value {
        serde_json::Value::String(text) => values.push(text.clone()),
        serde_json::Value::Array(items) => {
            for item in items {
                collect_string_values(item, values);
            }
        }
        serde_json::Value::Object(map) => {
            for item in map.values() {
                collect_string_values(item, values);
            }
        }
        _ => {}
    }
}
