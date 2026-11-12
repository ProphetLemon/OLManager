use chrono::{NaiveDate, TimeZone};
use olm_core::clock::GameClock;
use olm_core::custom_team::{CustomTeamSpec, replace_team_with_custom};
use olm_core::domain::manager::Manager;
use olm_core::domain::player::{LolRole, Player, PlayerAttributes};
use olm_core::domain::team::Team;
use olm_core::founder_identity::{
    FounderEditError, FounderEditReason as Reason, FounderError, FounderField as Field,
    FounderIdentityOverride, FounderOverrides, FounderPhotos, apply_founder_photos,
    birth_date_bounds, fold_key, normalize_full_name, normalize_nick, rename_founder,
    set_founder_photo, validate_birth_date, validate_nationality,
};
use olm_core::founding_squad::{
    FoundingSquadError, install_founding_squad, install_founding_squad_with, plan_founding_squad,
};
use olm_core::game::Game;
use olm_core::squad_generator::{DERIVED_BUDGET_BILL_PCT, SQUAD_ROLES, squad_bill};
use serde_json::Value;

const CUSTOM: &str = "les-custom-ray";

fn today() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 8, 1).expect("date")
}

fn spec() -> CustomTeamSpec {
    CustomTeamSpec {
        name: "Rayo Esports".to_string(),
        short_name: "RAY".to_string(),
        primary_color: "#112233".to_string(),
        secondary_color: "#ffffff".to_string(),
        country: "ES".to_string(),
        logo_data_uri: None,
        founding_seed: None,
        founder_overrides: None,
        founder_photos: None,
    }
}

fn player(id: &str, team_id: Option<&str>, role: LolRole) -> Player {
    let mut player = Player::new(
        id.to_string(),
        format!("nick-{id}"),
        format!("Full {id}"),
        "2000-01-01".to_string(),
        "ES".to_string(),
        role,
        PlayerAttributes::from_array([70; 9]),
    );
    player.team_id = team_id.map(str::to_string);
    player.contract_end = Some("2028-06-30".to_string());
    player.wage = 100_000;
    player
}

fn world_on(date: NaiveDate) -> Game {
    let at = date.and_hms_opt(12, 0, 0).expect("time");
    let clock = GameClock::new(chrono::Utc.from_utc_datetime(&at));
    let manager = Manager::new(
        "manager-1".to_string(),
        "Test".to_string(),
        "Manager".to_string(),
        "1980-01-01".to_string(),
        "ES".to_string(),
    );
    let mut teams = Vec::new();
    let mut players = Vec::new();
    for t in 0..8 {
        let id = format!("les-t{t}");
        let mut team = Team::new(
            id.clone(),
            format!("Club {id}"),
            format!("T{t}X"),
            "ES".to_string(),
            String::new(),
            "Arena".to_string(),
            1_000,
        );
        team.competition_id = Some("les".to_string());
        team.wage_budget = 1_300_000;
        teams.push(team);
        for (r, role) in SQUAD_ROLES.iter().enumerate() {
            players.push(player(&format!("{id}-p{r}"), Some(&id), *role));
        }
    }
    Game::new(clock, manager, teams, players, vec![], vec![])
}

fn with_custom_club() -> Game {
    custom_club_on(today())
}

fn custom_club_on(date: NaiveDate) -> Game {
    let mut game = world_on(date);
    replace_team_with_custom(&mut game, "les", "les-t0", &spec()).expect("custom club");
    game
}

fn founders(game: &Game) -> Vec<&Player> {
    game.players
        .iter()
        .filter(|p| p.team_id.as_deref() == Some(CUSTOM))
        .collect()
}

fn only(edit: FounderIdentityOverride) -> FounderOverrides {
    FounderOverrides {
        top: Some(edit),
        ..FounderOverrides::default()
    }
}

fn nick_edit(nick: &str) -> FounderIdentityOverride {
    FounderIdentityOverride {
        nick: Some(nick.to_string()),
        ..FounderIdentityOverride::default()
    }
}

fn edit_error(result: Result<impl std::fmt::Debug, FoundingSquadError>) -> FounderEditError {
    match result.expect_err("the edit must be rejected") {
        FoundingSquadError::Edit(error) => error,
        other => panic!("expected an edit error, got {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// Nick rules
// ---------------------------------------------------------------------------

#[test]
fn nick_accepts_letters_digits_and_the_allowed_punctuation() {
    assert_eq!(normalize_nick("Ray_01.x-y").as_deref(), Ok("Ray_01.x-y"));
}

#[test]
fn nick_accepts_unicode_letters() {
    assert_eq!(normalize_nick("Ñandú").as_deref(), Ok("Ñandú"));
    assert_eq!(normalize_nick("Müller").as_deref(), Ok("Müller"));
}

#[test]
fn nick_is_trimmed() {
    assert_eq!(normalize_nick("  Zed \t").as_deref(), Ok("Zed"));
}

#[test]
fn nick_accepts_exactly_the_length_limits() {
    assert_eq!(normalize_nick("ab").as_deref(), Ok("ab"));
    assert_eq!(
        normalize_nick(&"a".repeat(16)).as_deref(),
        Ok("aaaaaaaaaaaaaaaa")
    );
}

#[test]
fn nick_rejects_one_char_below_the_minimum() {
    assert_eq!(normalize_nick("a"), Err(Reason::TooShort));
}

#[test]
fn nick_rejects_one_char_above_the_maximum() {
    assert_eq!(normalize_nick(&"a".repeat(17)), Err(Reason::TooLong));
}

#[test]
fn nick_counts_characters_not_bytes() {
    assert_eq!(
        normalize_nick(&"ñ".repeat(16)).as_deref(),
        Ok("ññññññññññññññññ")
    );
}

#[test]
fn nick_rejects_whitespace_only_input() {
    assert_eq!(normalize_nick("   \t "), Err(Reason::Empty));
    assert_eq!(normalize_nick(""), Err(Reason::Empty));
}

#[test]
fn nick_rejects_emoji() {
    assert_eq!(normalize_nick("zed😀"), Err(Reason::InvalidCharacter));
}

#[test]
fn nick_rejects_inner_spaces_and_other_punctuation() {
    assert_eq!(normalize_nick("zed zed"), Err(Reason::InvalidCharacter));
    assert_eq!(normalize_nick("zed!"), Err(Reason::InvalidCharacter));
    assert_eq!(normalize_nick("a@b"), Err(Reason::InvalidCharacter));
}

#[test]
fn nick_rejects_control_characters() {
    assert_eq!(normalize_nick("ze\u{0}d"), Err(Reason::InvalidCharacter));
    assert_eq!(normalize_nick("ze\nd"), Err(Reason::InvalidCharacter));
}

#[test]
fn nick_composes_decomposed_letters_to_nfc() {
    assert_eq!(
        normalize_nick("N\u{0303}andu\u{0301}").as_deref(),
        Ok("Ñandú")
    );
}

#[test]
fn nick_rejects_a_combining_mark_that_cannot_compose() {
    assert_eq!(normalize_nick("q\u{0301}x"), Err(Reason::InvalidCharacter));
}

// ---------------------------------------------------------------------------
// Full name rules
// ---------------------------------------------------------------------------

#[test]
fn full_name_accepts_letters_spaces_apostrophes_and_hyphens() {
    assert_eq!(
        normalize_full_name("Ana María D'Arcy-Núñez").as_deref(),
        Ok("Ana María D'Arcy-Núñez")
    );
}

#[test]
fn full_name_is_trimmed_and_collapses_spaces() {
    assert_eq!(
        normalize_full_name("  Jean    Luc  ").as_deref(),
        Ok("Jean Luc")
    );
}

#[test]
fn full_name_accepts_exactly_the_length_limits() {
    assert_eq!(normalize_full_name("Al").as_deref(), Ok("Al"));
    let longest = format!("{} {}", "a".repeat(19), "b".repeat(20));
    assert_eq!(
        normalize_full_name(&longest).as_deref(),
        Ok(longest.as_str())
    );
}

#[test]
fn full_name_rejects_one_char_outside_the_limits() {
    assert_eq!(normalize_full_name("A"), Err(Reason::TooShort));
    assert_eq!(normalize_full_name(&"a".repeat(41)), Err(Reason::TooLong));
}

#[test]
fn full_name_length_is_measured_after_collapsing_spaces() {
    let spaced = format!("{}      {}", "a".repeat(19), "b".repeat(20));
    assert_eq!(
        normalize_full_name(&spaced).map(|name| name.chars().count()),
        Ok(40)
    );
}

#[test]
fn full_name_rejects_digits_emoji_and_underscores() {
    assert_eq!(normalize_full_name("Ana 2"), Err(Reason::InvalidCharacter));
    assert_eq!(normalize_full_name("Ana 😀"), Err(Reason::InvalidCharacter));
    assert_eq!(
        normalize_full_name("Ana_Ruiz"),
        Err(Reason::InvalidCharacter)
    );
}

#[test]
fn full_name_rejects_tabs_and_non_breaking_spaces_inside() {
    assert_eq!(
        normalize_full_name("Ana\tRuiz"),
        Err(Reason::InvalidCharacter)
    );
    assert_eq!(
        normalize_full_name("Ana\u{a0}Ruiz"),
        Err(Reason::InvalidCharacter)
    );
}

#[test]
fn full_name_rejects_whitespace_only_input() {
    assert_eq!(normalize_full_name("    "), Err(Reason::Empty));
}

#[test]
fn full_name_is_nfc_normalized() {
    assert_eq!(
        normalize_full_name("Mun\u{0303}oz Mu\u{0308}ller").as_deref(),
        Ok("Muñoz Müller")
    );
}

// ---------------------------------------------------------------------------
// Folding, nationality, birth date
// ---------------------------------------------------------------------------

#[test]
fn fold_key_ignores_case_and_accents() {
    assert_eq!(fold_key("Ñandú"), fold_key("NANDU"));
    assert_eq!(fold_key("Müller"), fold_key("muller"));
    assert_eq!(fold_key("Łukasz"), fold_key("lukasz"));
    assert_eq!(fold_key("Straße"), fold_key("STRASSE"));
    assert_eq!(fold_key("Bjørn"), fold_key("bjorn"));
}

#[test]
fn fold_key_matches_composed_and_decomposed_forms() {
    assert_eq!(fold_key("N\u{0303}"), fold_key("Ñ"));
}

#[test]
fn fold_key_keeps_distinct_names_apart() {
    assert_ne!(fold_key("Nandu"), fold_key("Nandi"));
}

#[test]
fn nationality_must_be_a_region_code() {
    let codes = vec!["ES".to_string(), "FR".to_string()];
    assert_eq!(validate_nationality(" fr ", &codes).as_deref(), Ok("FR"));
    assert_eq!(validate_nationality("KR", &codes), Err(Reason::NotInRegion));
    assert_eq!(
        validate_nationality("Spain", &codes),
        Err(Reason::NotInRegion)
    );
    assert_eq!(validate_nationality("  ", &codes), Err(Reason::Empty));
}

fn day(text: &str) -> NaiveDate {
    NaiveDate::parse_from_str(text, "%Y-%m-%d").expect("date")
}

/// Generated birth date used by the unit tests: 23 on 2026-08-01.
const ANCHOR: &str = "2003-03-15";

#[test]
fn birth_date_accepts_the_bounds_of_the_generated_age() {
    // 23 from 2002-08-02 (turned 24 the day before) to 2003-08-01.
    for ok in ["2002-08-02", "2003-03-15", "2003-08-01"] {
        assert_eq!(
            validate_birth_date(ok, today(), ANCHOR).as_deref(),
            Ok(ok),
            "{ok}"
        );
    }
}

#[test]
fn birth_date_rejects_one_day_outside_the_generated_age() {
    for bad in ["2002-08-01", "2003-08-02"] {
        assert_eq!(
            validate_birth_date(bad, today(), ANCHOR),
            Err(Reason::AgeChanged),
            "{bad}"
        );
    }
}

#[test]
fn birth_date_rejects_other_ages_and_future_dates() {
    for bad in ["1990-01-01", "2007-08-01", "1998-08-02", "2030-01-01"] {
        assert_eq!(
            validate_birth_date(bad, today(), ANCHOR),
            Err(Reason::AgeChanged),
            "{bad}"
        );
    }
}

#[test]
fn birth_date_must_be_a_strict_iso_date() {
    for bad in [
        "2000-02-30",
        "2000-1-1",
        "01/01/2000",
        "abc",
        "2000-01-01T00:00:00",
    ] {
        assert_eq!(
            validate_birth_date(bad, today(), ANCHOR),
            Err(Reason::InvalidDate),
            "{bad}"
        );
    }
    assert_eq!(
        validate_birth_date("  ", today(), ANCHOR),
        Err(Reason::Empty)
    );
}

#[test]
fn birth_date_bounds_are_accepted_and_their_neighbours_rejected() {
    // Includes leap days on both sides and a birthday today.
    let cases = [
        ("2026-08-01", "2003-03-15"),
        ("2026-08-01", "2007-08-01"),
        ("2028-02-29", "2005-02-28"),
        ("2028-02-29", "2004-02-29"),
        ("2028-02-29", "2001-03-01"),
        ("2027-03-01", "2004-02-29"),
        ("2027-02-28", "2004-02-29"),
        ("2026-12-31", "2000-02-29"),
        ("2029-03-01", "2008-03-01"),
    ];
    for (today_text, anchor_text) in cases {
        let (today, anchor) = (day(today_text), day(anchor_text));
        let (min, max) = birth_date_bounds(today, anchor);
        assert!(min <= anchor && anchor <= max, "{today_text} {anchor_text}");
        let check = |date: NaiveDate| validate_birth_date(&date.to_string(), today, anchor_text);
        assert!(check(min).is_ok(), "{today_text} {anchor_text}: min {min}");
        assert!(check(max).is_ok(), "{today_text} {anchor_text}: max {max}");
        assert_eq!(
            check(min.pred_opt().expect("day")),
            Err(Reason::AgeChanged),
            "{today_text} {anchor_text}: min-1"
        );
        assert_eq!(
            check(max.succ_opt().expect("day")),
            Err(Reason::AgeChanged),
            "{today_text} {anchor_text}: max+1"
        );
    }
}

#[test]
fn birth_date_bounds_span_about_one_year() {
    let (min, max) = birth_date_bounds(today(), day(ANCHOR));
    assert_eq!((min, max), (day("2002-08-02"), day("2003-08-01")));
}

#[test]
fn a_leap_day_birth_date_keeps_the_age_on_leap_day() {
    // Turns 24 on 2028-02-29 itself.
    let today = day("2028-02-29");
    assert_eq!(
        validate_birth_date("2004-02-29", today, "2004-02-28").as_deref(),
        Ok("2004-02-29")
    );
    assert_eq!(
        validate_birth_date("2004-03-01", today, "2004-02-28"),
        Err(Reason::AgeChanged)
    );
}

// ---------------------------------------------------------------------------
// Overrides at creation
// ---------------------------------------------------------------------------

#[test]
fn an_old_payload_without_overrides_still_parses() {
    let json = r##"{"name":"Rayo","short_name":"RAY","primary_color":"#112233","secondary_color":"#ffffff","country":"ES"}"##;
    let parsed: CustomTeamSpec = serde_json::from_str(json).expect("old payload");
    assert_eq!(parsed.founder_overrides, None);
    assert_eq!(parsed.founder_photos, None);
}

#[test]
fn a_payload_with_partial_overrides_parses() {
    let json = r##"{"name":"Rayo","short_name":"RAY","primary_color":"#112233","secondary_color":"#ffffff","country":"ES","founder_overrides":{"mid":{"nick":"Zed"},"top":{}}}"##;
    let parsed: CustomTeamSpec = serde_json::from_str(json).expect("payload");
    let overrides = parsed.founder_overrides.expect("overrides");
    assert_eq!(overrides.mid.expect("mid").nick.as_deref(), Some("Zed"));
    assert_eq!(overrides.top, Some(FounderIdentityOverride::default()));
    assert_eq!(overrides.jungle, None);
}

#[test]
fn no_overrides_leaves_the_generated_squad_untouched() {
    let mut plain = with_custom_club();
    let mut empty = with_custom_club();
    install_founding_squad(&mut plain, "les", CUSTOM, Some("ES"), 21).expect("plain");
    install_founding_squad_with(
        &mut empty,
        "les",
        CUSTOM,
        Some("ES"),
        21,
        &FounderOverrides::default(),
    )
    .expect("empty");
    let a = serde_json::to_value(founders(&plain)).expect("json");
    let b = serde_json::to_value(founders(&empty)).expect("json");
    assert_eq!(a, b);
}

#[test]
fn overrides_replace_the_identity_of_that_role_only() {
    let mut game = with_custom_club();
    let edit = FounderIdentityOverride {
        nick: Some("  Zed_01 ".to_string()),
        full_name: Some("Ana   María  Núñez".to_string()),
        nationality: Some("fr".to_string()),
        birth_date: Some(birth_bounds(5, LolRole::Top).0),
    };
    install_founding_squad_with(&mut game, "les", CUSTOM, Some("ES"), 5, &only(edit))
        .expect("squad");
    let top = founders(&game)
        .into_iter()
        .find(|p| p.natural_position == LolRole::Top)
        .expect("top");
    assert_eq!(top.match_name, "Zed_01");
    assert_eq!(top.full_name, "Ana María Núñez");
    assert_eq!(top.nationality, "FR");
    assert_eq!(top.date_of_birth, birth_bounds(5, LolRole::Top).0);
    let untouched = founders(&game)
        .into_iter()
        .filter(|p| p.natural_position != LolRole::Top)
        .all(|p| p.match_name != "Zed_01");
    assert!(untouched);
}

#[test]
fn overrides_never_change_stats_role_or_potential() {
    let mut plain = with_custom_club();
    let mut edited = with_custom_club();
    install_founding_squad(&mut plain, "les", CUSTOM, Some("ES"), 9).expect("plain");
    let edit = FounderIdentityOverride {
        nick: Some("Zed".to_string()),
        birth_date: Some(birth_bounds(9, LolRole::Top).1),
        ..FounderIdentityOverride::default()
    };
    install_founding_squad_with(&mut edited, "les", CUSTOM, Some("ES"), 9, &only(edit))
        .expect("edited");
    for (before, after) in founders(&plain).into_iter().zip(founders(&edited)) {
        assert_eq!(before.attributes.as_array(), after.attributes.as_array());
        assert_eq!(before.natural_position, after.natural_position);
        assert_eq!(before.potential_base, after.potential_base);
        assert_eq!(before.lol_ovr, after.lol_ovr);
    }
}

#[test]
fn the_wage_budget_is_derived_after_the_edits() {
    let mut game = with_custom_club();
    let edits = FounderOverrides {
        top: Some(FounderIdentityOverride {
            birth_date: Some(birth_bounds(3, LolRole::Top).0),
            ..FounderIdentityOverride::default()
        }),
        support: Some(FounderIdentityOverride {
            birth_date: Some(birth_bounds(3, LolRole::Support).1),
            ..FounderIdentityOverride::default()
        }),
        ..FounderOverrides::default()
    };
    let outcome = install_founding_squad_with(&mut game, "les", CUSTOM, Some("ES"), 3, &edits)
        .expect("squad");
    let squad: Vec<Player> = founders(&game).into_iter().cloned().collect();
    let bill = squad_bill(&squad);
    assert_eq!(
        outcome.wage_budget,
        olm_core::squad_generator::wage_budget_for_bill(bill)
    );
    // The bill sits at 95% of the budget, less the rounding up to 10k.
    assert!(bill * 100 <= outcome.wage_budget * DERIVED_BUDGET_BILL_PCT);
    assert!(outcome.wage_budget - bill * 100 / DERIVED_BUDGET_BILL_PCT < 10_000);
    let club = game.teams.iter().find(|t| t.id == CUSTOM).expect("club");
    assert_eq!(club.wage_budget, outcome.wage_budget);
}

#[test]
fn an_override_equal_to_the_generated_value_is_accepted() {
    let game = with_custom_club();
    let plan = plan_founding_squad(
        &game,
        "les",
        CUSTOM,
        Some("ES"),
        4,
        &FounderOverrides::default(),
    )
    .expect("plan");
    let own = plan.players[0].match_name.clone();
    let again = plan_founding_squad(&game, "les", CUSTOM, Some("ES"), 4, &only(nick_edit(&own)));
    assert!(again.is_ok());
}

#[test]
fn a_taken_nick_is_rejected_ignoring_case_and_accents() {
    let mut game = with_custom_club();
    game.players
        .push(player("old-1", Some("les-t1"), LolRole::Mid));
    game.players[0].match_name = "Peñarol".to_string();
    for typed in ["Peñarol", "PEÑAROL", "penarol", "Pen\u{0303}arol"] {
        let error = edit_error(plan_founding_squad(
            &game,
            "les",
            CUSTOM,
            Some("ES"),
            2,
            &only(nick_edit(typed)),
        ));
        assert_eq!(
            error,
            FounderEditError {
                role: LolRole::Top,
                field: Field::Nick,
                reason: Reason::Taken
            },
            "{typed}"
        );
    }
}

#[test]
fn a_released_players_name_is_taken() {
    let mut game = with_custom_club();
    let mut released = player("released-1", None, LolRole::Adc);
    released.match_name = "Pelayo".to_string();
    released.full_name = "Pelayo Ruiz".to_string();
    game.players.push(released);
    let nick = edit_error(plan_founding_squad(
        &game,
        "les",
        CUSTOM,
        Some("ES"),
        2,
        &only(nick_edit("pelayo")),
    ));
    assert_eq!(nick.reason, Reason::Taken);
    let name = edit_error(plan_founding_squad(
        &game,
        "les",
        CUSTOM,
        Some("ES"),
        2,
        &only(FounderIdentityOverride {
            full_name: Some("PELAYO  RUIZ".to_string()),
            ..FounderIdentityOverride::default()
        }),
    ));
    assert_eq!((name.field, name.reason), (Field::FullName, Reason::Taken));
}

#[test]
fn two_founders_cannot_share_a_nick() {
    let game = with_custom_club();
    let edits = FounderOverrides {
        top: Some(nick_edit("Zed")),
        jungle: Some(nick_edit("ZED")),
        ..FounderOverrides::default()
    };
    let error = edit_error(plan_founding_squad(
        &game,
        "les",
        CUSTOM,
        Some("ES"),
        2,
        &edits,
    ));
    assert_eq!(
        error,
        FounderEditError {
            role: LolRole::Jungle,
            field: Field::Nick,
            reason: Reason::Taken
        }
    );
}

#[test]
fn a_founder_cannot_take_another_generated_founders_name() {
    let game = with_custom_club();
    let plan = plan_founding_squad(
        &game,
        "les",
        CUSTOM,
        Some("ES"),
        6,
        &FounderOverrides::default(),
    )
    .expect("plan");
    let other_full = plan.players[1].full_name.clone();
    let error = edit_error(plan_founding_squad(
        &game,
        "les",
        CUSTOM,
        Some("ES"),
        6,
        &only(FounderIdentityOverride {
            full_name: Some(other_full),
            ..FounderIdentityOverride::default()
        }),
    ));
    assert_eq!(
        (error.field, error.reason),
        (Field::FullName, Reason::Taken)
    );
}

#[test]
fn a_nationality_outside_the_region_is_rejected_not_defaulted() {
    let mut game = with_custom_club();
    let before = game.players.len();
    let error = edit_error(install_founding_squad_with(
        &mut game,
        "les",
        CUSTOM,
        Some("ES"),
        2,
        &only(FounderIdentityOverride {
            nationality: Some("KR".to_string()),
            ..FounderIdentityOverride::default()
        }),
    ));
    assert_eq!(
        error,
        FounderEditError {
            role: LolRole::Top,
            field: Field::Nationality,
            reason: Reason::NotInRegion
        }
    );
    assert_eq!(
        game.players.len(),
        before,
        "a rejected edit leaves the game untouched"
    );
}

#[test]
fn a_birth_date_that_changes_the_age_is_rejected() {
    let game = with_custom_club();
    let error = edit_error(plan_founding_squad(
        &game,
        "les",
        CUSTOM,
        Some("ES"),
        2,
        &FounderOverrides {
            support: Some(FounderIdentityOverride {
                birth_date: Some("1990-01-01".to_string()),
                ..FounderIdentityOverride::default()
            }),
            ..FounderOverrides::default()
        },
    ));
    assert_eq!(
        error,
        FounderEditError {
            role: LolRole::Support,
            field: Field::BirthDate,
            reason: Reason::AgeChanged
        }
    );
}

#[test]
fn an_invalid_nick_names_the_role_and_the_field() {
    let game = with_custom_club();
    let error = edit_error(plan_founding_squad(
        &game,
        "les",
        CUSTOM,
        Some("ES"),
        2,
        &only(nick_edit("x")),
    ));
    assert_eq!(
        error,
        FounderEditError {
            role: LolRole::Top,
            field: Field::Nick,
            reason: Reason::TooShort
        }
    );
}

#[test]
fn the_wire_error_is_a_tagged_json_object() {
    let error = FounderError::InvalidField(FounderEditError {
        role: LolRole::Top,
        field: Field::FullName,
        reason: Reason::InvalidCharacter,
    });
    assert_eq!(
        error.to_wire(),
        r#"{"kind":"invalid_field","role":"TOP","field":"full_name","reason":"invalid_character"}"#
    );
    assert_eq!(
        FounderError::NotAFounder {
            player_id: "p1".to_string()
        }
        .to_wire(),
        r#"{"kind":"not_a_founder","player_id":"p1"}"#
    );
}

// ---------------------------------------------------------------------------
// In-game rename
// ---------------------------------------------------------------------------

fn game_with_founders() -> Game {
    let mut game = with_custom_club();
    install_founding_squad(&mut game, "les", CUSTOM, Some("ES"), 8).expect("squad");
    game.manager.team_id = Some(CUSTOM.to_string());
    game
}

fn founder_id(game: &Game, role: LolRole) -> String {
    founders(game)
        .into_iter()
        .find(|p| p.natural_position == role)
        .map(|p| p.id.clone())
        .expect("founder")
}

#[test]
fn a_valid_rename_changes_the_nick_and_the_full_name() {
    let mut game = game_with_founders();
    let id = founder_id(&game, LolRole::Mid);
    rename_founder(&mut game, &id, Some(" Zed "), Some("Ana   Ruiz")).expect("rename");
    let renamed = game.players.iter().find(|p| p.id == id).expect("player");
    assert_eq!(renamed.match_name, "Zed");
    assert_eq!(renamed.full_name, "Ana Ruiz");
}

#[test]
fn a_rename_can_change_only_one_name() {
    let mut game = game_with_founders();
    let id = founder_id(&game, LolRole::Adc);
    let full_before = game
        .players
        .iter()
        .find(|p| p.id == id)
        .expect("p")
        .full_name
        .clone();
    rename_founder(&mut game, &id, Some("Zed"), None).expect("rename");
    let renamed = game.players.iter().find(|p| p.id == id).expect("player");
    assert_eq!(
        (renamed.match_name.as_str(), renamed.full_name.as_str()),
        ("Zed", full_before.as_str())
    );
}

#[test]
fn a_rename_to_the_players_own_name_in_another_case_is_accepted() {
    let mut game = game_with_founders();
    let id = founder_id(&game, LolRole::Top);
    let nick = game
        .players
        .iter()
        .find(|p| p.id == id)
        .expect("p")
        .match_name
        .to_uppercase();
    assert!(rename_founder(&mut game, &id, Some(&nick), None).is_ok());
}

#[test]
fn a_rename_leaves_wage_stats_and_team_alone() {
    let mut game = game_with_founders();
    let id = founder_id(&game, LolRole::Jungle);
    let before = game.players.iter().find(|p| p.id == id).expect("p").clone();
    rename_founder(&mut game, &id, Some("Zed"), Some("Ana Ruiz")).expect("rename");
    let after = game.players.iter().find(|p| p.id == id).expect("p");
    assert_eq!(
        (
            before.wage,
            before.market_value,
            before.lol_ovr,
            &before.team_id,
            &before.date_of_birth
        ),
        (
            after.wage,
            after.market_value,
            after.lol_ovr,
            &after.team_id,
            &after.date_of_birth
        )
    );
}

#[test]
fn a_rename_rejects_a_player_who_is_not_a_founder() {
    let mut game = game_with_founders();
    let error = rename_founder(&mut game, "les-t1-p0", Some("Zed"), None).expect_err("real player");
    assert_eq!(
        error,
        FounderError::NotAFounder {
            player_id: "les-t1-p0".to_string()
        }
    );
    assert_eq!(
        game.players
            .iter()
            .find(|p| p.id == "les-t1-p0")
            .expect("p")
            .match_name,
        "nick-les-t1-p0"
    );
}

#[test]
fn a_rename_rejects_a_generated_player_on_another_club() {
    let mut game = game_with_founders();
    let id = founder_id(&game, LolRole::Support);
    game.players
        .iter_mut()
        .find(|p| p.id == id)
        .expect("p")
        .team_id = Some("les-t1".to_string());
    assert_eq!(
        rename_founder(&mut game, &id, Some("Zed"), None),
        Err(FounderError::NotAFounder { player_id: id })
    );
}

#[test]
fn a_rename_rejects_a_released_founder() {
    let mut game = game_with_founders();
    let id = founder_id(&game, LolRole::Support);
    game.players
        .iter_mut()
        .find(|p| p.id == id)
        .expect("p")
        .team_id = None;
    assert!(matches!(
        rename_founder(&mut game, &id, Some("Zed"), None),
        Err(FounderError::NotAFounder { .. })
    ));
}

#[test]
fn a_rename_rejects_everyone_when_the_manager_has_no_custom_club() {
    let mut game = game_with_founders();
    let id = founder_id(&game, LolRole::Mid);
    game.manager.team_id = Some("les-t1".to_string());
    assert!(matches!(
        rename_founder(&mut game, &id, Some("Zed"), None),
        Err(FounderError::NotAFounder { .. })
    ));
    game.manager.team_id = None;
    assert!(matches!(
        rename_founder(&mut game, &id, Some("Zed"), None),
        Err(FounderError::NotAFounder { .. })
    ));
}

#[test]
fn a_rename_rejects_an_unknown_player() {
    let mut game = game_with_founders();
    assert_eq!(
        rename_founder(&mut game, "nope", Some("Zed"), None),
        Err(FounderError::PlayerNotFound {
            player_id: "nope".to_string()
        })
    );
}

#[test]
fn a_rename_rejects_a_duplicate_nick_ignoring_case_and_accents() {
    let mut game = game_with_founders();
    let id = founder_id(&game, LolRole::Mid);
    game.players
        .iter_mut()
        .find(|p| p.id == "les-t2-p1")
        .expect("p")
        .match_name = "Ñandú".to_string();
    let error = rename_founder(&mut game, &id, Some("NANDU"), None).expect_err("duplicate");
    assert_eq!(
        error,
        FounderError::InvalidField(FounderEditError {
            role: LolRole::Mid,
            field: Field::Nick,
            reason: Reason::Taken
        })
    );
}

#[test]
fn a_rename_rejects_the_nick_of_a_released_player() {
    let mut game = game_with_founders();
    let id = founder_id(&game, LolRole::Mid);
    let mut released = player("released-2", None, LolRole::Top);
    released.match_name = "Pelayo".to_string();
    game.players.push(released);
    assert!(matches!(
        rename_founder(&mut game, &id, Some("pelayo"), None),
        Err(FounderError::InvalidField(FounderEditError {
            reason: Reason::Taken,
            ..
        }))
    ));
}

#[test]
fn a_rename_rejects_the_full_name_of_another_founder() {
    let mut game = game_with_founders();
    let mid = founder_id(&game, LolRole::Mid);
    let top = founder_id(&game, LolRole::Top);
    let top_full = game
        .players
        .iter()
        .find(|p| p.id == top)
        .expect("p")
        .full_name
        .to_uppercase();
    let error = rename_founder(&mut game, &mid, None, Some(&top_full)).expect_err("duplicate");
    assert!(matches!(
        error,
        FounderError::InvalidField(FounderEditError {
            field: Field::FullName,
            reason: Reason::Taken,
            ..
        })
    ));
}

#[test]
fn a_rename_with_one_invalid_name_changes_nothing() {
    let mut game = game_with_founders();
    let id = founder_id(&game, LolRole::Mid);
    let before = game.players.iter().find(|p| p.id == id).expect("p").clone();
    let error = rename_founder(&mut game, &id, Some("Zed"), Some("Ana 2")).expect_err("invalid");
    assert!(matches!(
        error,
        FounderError::InvalidField(FounderEditError {
            field: Field::FullName,
            reason: Reason::InvalidCharacter,
            ..
        })
    ));
    let after = game.players.iter().find(|p| p.id == id).expect("p");
    assert_eq!(
        (&before.match_name, &before.full_name),
        (&after.match_name, &after.full_name)
    );
}

#[test]
fn a_rename_without_names_is_rejected() {
    let mut game = game_with_founders();
    let id = founder_id(&game, LolRole::Mid);
    assert_eq!(
        rename_founder(&mut game, &id, None, None),
        Err(FounderError::NothingToChange)
    );
}

// ---------------------------------------------------------------------------
// Plan equals install
// ---------------------------------------------------------------------------

#[test]
fn the_plan_equals_the_installed_squad_for_several_seeds() {
    for seed in [1_u64, 7, 99, 12_345, 4_000_000_000] {
        let mut game = with_custom_club();
        let plan = plan_founding_squad(
            &game,
            "les",
            CUSTOM,
            Some("ES"),
            seed,
            &FounderOverrides::default(),
        )
        .expect("plan");
        let planned = serde_json::to_value(&plan.players).expect("json");
        let outcome =
            install_founding_squad(&mut game, "les", CUSTOM, Some("ES"), seed).expect("install");
        let installed = serde_json::to_value(founders(&game)).expect("json");
        assert_eq!(planned, installed, "seed {seed}");
        assert_eq!(plan.wage_budget, outcome.wage_budget, "seed {seed}");
    }
}

#[test]
fn planning_does_not_touch_the_game() {
    let game = with_custom_club();
    let before = serde_json::to_value(&game.players).expect("json");
    let moved = game.moved_player_ids.len();
    plan_founding_squad(
        &game,
        "les",
        CUSTOM,
        Some("ES"),
        5,
        &FounderOverrides::default(),
    )
    .expect("plan");
    assert_eq!(before, serde_json::to_value(&game.players).expect("json"));
    assert_eq!(moved, game.moved_player_ids.len());
}

#[test]
fn the_summary_hides_potential_and_reports_the_bill() {
    let game = with_custom_club();
    let plan = plan_founding_squad(
        &game,
        "les",
        CUSTOM,
        Some("ES"),
        5,
        &FounderOverrides::default(),
    )
    .expect("plan");
    let summary = plan.summary();
    assert_eq!(summary.players.len(), 5);
    assert_eq!(summary.bill, squad_bill(&plan.players));
    assert_eq!(summary.wage_budget, plan.wage_budget);
    let json = serde_json::to_string(&summary).expect("json");
    assert!(
        !json.contains("potential"),
        "the summary must not leak potential: {json}"
    );
    assert!(summary.players.iter().all(|p| (19..=27).contains(&p.age)));
}

// ---------------------------------------------------------------------------
// Repricing neutrality and letter requirement
// ---------------------------------------------------------------------------

#[test]
fn a_nick_without_a_letter_is_rejected() {
    for nick in ["..", "--", "12", "_1"] {
        assert_eq!(
            normalize_nick(nick),
            Err(Reason::InvalidCharacter),
            "{nick}"
        );
    }
}

#[test]
fn a_full_name_without_a_letter_is_rejected() {
    for name in ["--", "'-'", "- -"] {
        assert_eq!(
            normalize_full_name(name),
            Err(Reason::InvalidCharacter),
            "{name}"
        );
    }
}

#[test]
fn a_no_op_nationality_edit_leaves_wage_and_value_unchanged() {
    let mut plain = with_custom_club();
    install_founding_squad_with(
        &mut plain,
        "les",
        CUSTOM,
        Some("ES"),
        7,
        &FounderOverrides::default(),
    )
    .expect("plain");
    let edits = FounderOverrides {
        top: Some(same_nationality(&plain, LolRole::Top)),
        mid: Some(same_nationality(&plain, LolRole::Mid)),
        support: Some(same_nationality(&plain, LolRole::Support)),
        ..FounderOverrides::default()
    };
    let mut edited = with_custom_club();
    install_founding_squad_with(&mut edited, "les", CUSTOM, Some("ES"), 7, &edits).expect("edited");
    let key = |g: &Game| {
        founders(g)
            .into_iter()
            .map(|p| (p.wage, p.market_value))
            .collect::<Vec<_>>()
    };
    assert_eq!(key(&plain), key(&edited));
}

fn same_nationality(game: &Game, role: LolRole) -> FounderIdentityOverride {
    let nationality = founders(game)
        .into_iter()
        .find(|p| p.natural_position == role)
        .map(|p| p.nationality.clone())
        .expect("founder");
    FounderIdentityOverride {
        nationality: Some(nationality),
        ..FounderIdentityOverride::default()
    }
}

// ---------------------------------------------------------------------------
// Age lock and economic neutrality
// ---------------------------------------------------------------------------

/// `(birth_date_min, birth_date_max)` of the generated `role` founder.
fn birth_bounds(seed: u64, role: LolRole) -> (String, String) {
    let plan = plan_founding_squad(
        &with_custom_club(),
        "les",
        CUSTOM,
        Some("ES"),
        seed,
        &FounderOverrides::default(),
    )
    .expect("plan");
    let summary = plan.summary();
    let founder = summary
        .players
        .iter()
        .find(|p| p.role == role)
        .expect("founder");
    (
        founder.birth_date_min.clone(),
        founder.birth_date_max.clone(),
    )
}

/// A founder as JSON without the four editable identity fields.
fn without_identity(player: &Player) -> Value {
    let mut value = serde_json::to_value(player).expect("json");
    let object = value.as_object_mut().expect("object");
    for field in ["match_name", "full_name", "nationality", "date_of_birth"] {
        assert!(object.remove(field).is_some(), "{field}");
    }
    value
}

/// Edits every founder, each with a different combination of fields.
fn edits_for(game: &Game, seed: u64, variant: usize) -> FounderOverrides {
    let plan = plan_founding_squad(
        game,
        "les",
        CUSTOM,
        Some("ES"),
        seed,
        &FounderOverrides::default(),
    )
    .expect("plan");
    let summary = plan.summary();
    let edit_for = |role: LolRole, slot: usize| {
        let founder = summary.players.iter().find(|p| p.role == role)?;
        let pick_max = (variant + slot).is_multiple_of(2);
        let mut edit = FounderIdentityOverride::default();
        if (variant + slot) % 3 != 1 {
            edit.nick = Some(format!("Edit{variant}x{slot}"));
        }
        if (variant + slot) % 3 != 2 {
            edit.full_name = Some(format!(
                "Nueva D\u{2019}Prueba {}",
                ["Uno", "Dos", "Tres", "Cuatro", "Cinco"][slot]
            ));
        }
        if (variant + slot).is_multiple_of(2) {
            edit.nationality =
                Some(["FR", "DE", "PT", "IT", "ES"][(variant + slot) % 5].to_string());
        }
        edit.birth_date = Some(if pick_max {
            founder.birth_date_max.clone()
        } else {
            founder.birth_date_min.clone()
        });
        Some(edit)
    };
    FounderOverrides {
        top: edit_for(LolRole::Top, 0),
        jungle: edit_for(LolRole::Jungle, 1),
        mid: edit_for(LolRole::Mid, 2),
        adc: edit_for(LolRole::Adc, 3),
        support: edit_for(LolRole::Support, 4),
    }
}

fn assert_edits_are_economically_neutral(date: NaiveDate) {
    for seed in 0..8u64 {
        for variant in 0..3usize {
            let game = custom_club_on(date);
            let plain = plan_founding_squad(
                &game,
                "les",
                CUSTOM,
                Some("ES"),
                seed,
                &FounderOverrides::default(),
            )
            .expect("plain");
            let edits = edits_for(&game, seed, variant);
            let edited = plan_founding_squad(&game, "les", CUSTOM, Some("ES"), seed, &edits)
                .unwrap_or_else(|e| panic!("{date} seed {seed} variant {variant}: {e:?}"));
            assert_eq!(edited.bill(), plain.bill(), "{date} seed {seed}");
            assert_eq!(edited.wage_budget, plain.wage_budget, "{date} seed {seed}");
            let mut changed = false;
            for (before, after) in plain.players.iter().zip(&edited.players) {
                assert_eq!(
                    without_identity(before),
                    without_identity(after),
                    "{date} seed {seed} variant {variant}: {}",
                    before.id
                );
                changed |= before.match_name != after.match_name
                    || before.full_name != after.full_name
                    || before.nationality != after.nationality
                    || before.date_of_birth != after.date_of_birth;
            }
            assert!(changed, "the edits must really change the identity");
        }
    }
}

#[test]
fn identity_edits_change_no_economic_or_competitive_field() {
    assert_edits_are_economically_neutral(today());
}

#[test]
fn identity_edits_are_neutral_when_the_game_starts_on_a_leap_day() {
    assert_edits_are_economically_neutral(day("2028-02-29"));
}

#[test]
fn identity_edits_are_neutral_the_day_after_a_leap_day() {
    assert_edits_are_economically_neutral(day("2028-03-01"));
}

#[test]
fn a_birth_date_one_day_past_the_bounds_is_rejected_on_install() {
    let (min, max) = birth_bounds(4, LolRole::Mid);
    let past_max = day(&max).succ_opt().expect("day").to_string();
    let before_min = day(&min).pred_opt().expect("day").to_string();
    for bad in [past_max, before_min] {
        let game = with_custom_club();
        let error = edit_error(plan_founding_squad(
            &game,
            "les",
            CUSTOM,
            Some("ES"),
            4,
            &FounderOverrides {
                mid: Some(FounderIdentityOverride {
                    birth_date: Some(bad.clone()),
                    ..FounderIdentityOverride::default()
                }),
                ..FounderOverrides::default()
            },
        ));
        assert_eq!(
            error,
            FounderEditError {
                role: LolRole::Mid,
                field: Field::BirthDate,
                reason: Reason::AgeChanged
            },
            "{bad}"
        );
    }
}

#[test]
fn the_preview_bounds_keep_the_age_and_name_the_generated_date() {
    let plan = plan_founding_squad(
        &with_custom_club(),
        "les",
        CUSTOM,
        Some("ES"),
        11,
        &FounderOverrides::default(),
    )
    .expect("plan");
    for founder in plan.summary().players {
        let (dob, min, max) = (
            day(&founder.date_of_birth),
            day(&founder.birth_date_min),
            day(&founder.birth_date_max),
        );
        assert!(min <= dob && dob <= max, "{}", founder.id);
        assert!((max - min).num_days() <= 366, "{}", founder.id);
    }
}

#[test]
fn full_name_normalizes_typographic_apostrophes() {
    for quote in ['\u{2019}', '\u{2018}', '\u{02BC}'] {
        assert_eq!(
            normalize_full_name(&format!("Conan O{quote}Brien")).as_deref(),
            Ok("Conan O'Brien"),
            "{quote:?}"
        );
    }
}

#[test]
fn fold_key_treats_typographic_and_ascii_apostrophes_alike() {
    for quote in ['\u{2019}', '\u{2018}', '\u{02BC}'] {
        assert_eq!(
            fold_key(&format!("Conan O{quote}Brien")),
            fold_key("conan o'brien"),
            "{quote:?}"
        );
    }
}

#[test]
fn a_typographic_apostrophe_is_stored_as_ascii_on_install() {
    let mut game = with_custom_club();
    let edit = FounderIdentityOverride {
        full_name: Some("Mar\u{00ED}a D\u{2019}Arc".to_string()),
        ..FounderIdentityOverride::default()
    };
    install_founding_squad_with(&mut game, "les", CUSTOM, Some("ES"), 5, &only(edit))
        .expect("squad");
    let top = founders(&game)
        .into_iter()
        .find(|p| p.natural_position == LolRole::Top)
        .expect("top");
    assert_eq!(top.full_name, "María D'Arc");
}

// ---------------------------------------------------------------------------
// Founder photos
// ---------------------------------------------------------------------------

fn photo_uri(width: u32, height: u32, pixel: [u8; 4]) -> String {
    use base64::Engine as _;
    let data: Vec<u8> = (0..width * height).flat_map(|_| pixel).collect();
    let mut out = Vec::new();
    let mut encoder = png::Encoder::new(&mut out, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().expect("header");
    writer.write_image_data(&data).expect("pixels");
    writer.finish().expect("finish");
    format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(out)
    )
}

fn founder_ids(game: &Game) -> Vec<String> {
    founders(game).iter().map(|p| p.id.clone()).collect()
}

fn photo_of(game: &Game, role: LolRole) -> Option<String> {
    founders(game)
        .into_iter()
        .find(|p| p.natural_position == role)
        .and_then(|p| p.profile_image_url.clone())
}

#[test]
fn a_payload_with_photos_parses_per_role() {
    let json = r##"{"name":"Rayo","short_name":"RAY","primary_color":"#112233","secondary_color":"#ffffff","country":"ES","founder_photos":{"mid":"data:image/png;base64,AAAA"}}"##;

    let parsed: CustomTeamSpec = serde_json::from_str(json).expect("payload");

    let photos = parsed.founder_photos.expect("photos");
    assert_eq!(photos.mid.as_deref(), Some("data:image/png;base64,AAAA"));
    assert_eq!(photos.top, None);
}

#[test]
fn a_photo_is_stored_normalized_in_the_founder_of_its_role() {
    let mut game = with_custom_club();
    install_founding_squad(&mut game, "les", CUSTOM, Some("ES"), 7).expect("squad");
    let ids = founder_ids(&game);
    let photos = FounderPhotos {
        mid: Some(photo_uri(400, 200, [9, 8, 7, 255])),
        ..FounderPhotos::default()
    };

    apply_founder_photos(&mut game, &ids, &photos).expect("photos");

    let stored = photo_of(&game, LolRole::Mid).expect("mid photo");
    assert_eq!(
        Some(stored),
        Some(olm_core::custom_logo::normalize_portrait(photos.mid.as_deref().unwrap()).unwrap())
    );
}

#[test]
fn founders_without_a_photo_keep_the_default_avatar() {
    let mut game = with_custom_club();
    install_founding_squad(&mut game, "les", CUSTOM, Some("ES"), 7).expect("squad");
    let ids = founder_ids(&game);
    let photos = FounderPhotos {
        mid: Some(photo_uri(50, 50, [1, 1, 1, 255])),
        ..FounderPhotos::default()
    };

    apply_founder_photos(&mut game, &ids, &photos).expect("photos");

    for role in [
        LolRole::Top,
        LolRole::Jungle,
        LolRole::Adc,
        LolRole::Support,
    ] {
        assert_eq!(photo_of(&game, role), None, "{role:?}");
    }
}

#[test]
fn a_photo_that_is_not_an_image_is_rejected_and_nothing_is_stored() {
    let mut game = with_custom_club();
    install_founding_squad(&mut game, "les", CUSTOM, Some("ES"), 7).expect("squad");
    let ids = founder_ids(&game);
    let photos = FounderPhotos {
        top: Some(photo_uri(50, 50, [1, 1, 1, 255])),
        support: Some("data:image/svg+xml;base64,PHN2Zy8+".to_string()),
        ..FounderPhotos::default()
    };

    let error = apply_founder_photos(&mut game, &ids, &photos).expect_err("rejected");

    assert_eq!(error.role, LolRole::Support);
    assert_eq!(error.reason, olm_core::custom_logo::LogoError::NotPng);
    assert_eq!(photo_of(&game, LolRole::Top), None);
}

#[test]
fn a_photo_rejection_travels_as_a_wire_error_with_the_role_and_reason() {
    let error = FounderError::InvalidPhoto(olm_core::founder_identity::FounderPhotoError {
        role: LolRole::Support,
        reason: olm_core::custom_logo::LogoError::TooLarge,
    });

    let wire: Value = serde_json::from_str(&error.to_wire()).expect("json");

    assert_eq!(wire["kind"], "invalid_photo");
    assert_eq!(wire["role"], "SUPPORT");
    assert_eq!(wire["reason"], "too_large");
}

#[test]
fn photos_only_reach_the_given_players() {
    let mut game = with_custom_club();
    install_founding_squad(&mut game, "les", CUSTOM, Some("ES"), 7).expect("squad");
    let photos = FounderPhotos {
        top: Some(photo_uri(50, 50, [1, 1, 1, 255])),
        ..FounderPhotos::default()
    };

    apply_founder_photos(&mut game, &[], &photos).expect("nothing to give");

    assert_eq!(photo_of(&game, LolRole::Top), None);
}

// ---------------------------------------------------------------------------
// Changing a founder's photo in a running game
// ---------------------------------------------------------------------------

fn stored_photo(game: &Game, id: &str) -> Option<String> {
    game.players
        .iter()
        .find(|p| p.id == id)
        .and_then(|p| p.profile_image_url.clone())
}

#[test]
fn a_founder_gets_a_normalized_photo_after_the_game_exists() {
    let mut game = game_with_founders();
    let id = founder_id(&game, LolRole::Mid);
    let uri = photo_uri(400, 200, [9, 8, 7, 255]);

    set_founder_photo(&mut game, &id, Some(&uri)).expect("photo");

    assert_eq!(
        stored_photo(&game, &id),
        Some(olm_core::custom_logo::normalize_portrait(&uri).unwrap())
    );
}

#[test]
fn a_new_photo_replaces_the_previous_one() {
    let mut game = game_with_founders();
    let id = founder_id(&game, LolRole::Top);
    let first = photo_uri(50, 50, [1, 1, 1, 255]);
    let second = photo_uri(60, 60, [200, 100, 50, 255]);
    set_founder_photo(&mut game, &id, Some(&first)).expect("first");

    set_founder_photo(&mut game, &id, Some(&second)).expect("second");

    assert_eq!(
        stored_photo(&game, &id),
        Some(olm_core::custom_logo::normalize_portrait(&second).unwrap())
    );
}

#[test]
fn removing_the_photo_returns_the_founder_to_the_default_avatar() {
    let mut game = game_with_founders();
    let id = founder_id(&game, LolRole::Adc);
    set_founder_photo(&mut game, &id, Some(&photo_uri(50, 50, [1, 1, 1, 255]))).expect("photo");

    set_founder_photo(&mut game, &id, None).expect("remove");

    assert_eq!(stored_photo(&game, &id), None);
}

#[test]
fn a_photo_change_touches_nothing_but_the_photo() {
    let mut game = game_with_founders();
    let id = founder_id(&game, LolRole::Mid);
    let mut expected = game.players.clone();

    set_founder_photo(&mut game, &id, Some(&photo_uri(50, 50, [1, 1, 1, 255]))).expect("photo");

    let photo = stored_photo(&game, &id);
    expected
        .iter_mut()
        .find(|p| p.id == id)
        .expect("founder")
        .profile_image_url = photo;
    assert_eq!(
        serde_json::to_value(&game.players).unwrap(),
        serde_json::to_value(&expected).unwrap()
    );
}

#[test]
fn a_photo_for_a_player_of_another_club_is_refused_and_changes_nothing() {
    let mut game = game_with_founders();

    let error = set_founder_photo(&mut game, "les-t1-p0", Some(&photo_uri(50, 50, [1, 1, 1, 255])))
        .expect_err("real player");

    assert_eq!(
        error,
        FounderError::NotAFounder {
            player_id: "les-t1-p0".to_string()
        }
    );
    assert_eq!(stored_photo(&game, "les-t1-p0"), None);
}

#[test]
fn a_released_founder_cannot_get_a_photo() {
    let mut game = game_with_founders();
    let id = founder_id(&game, LolRole::Support);
    game.players
        .iter_mut()
        .find(|p| p.id == id)
        .expect("p")
        .team_id = None;

    assert!(matches!(
        set_founder_photo(&mut game, &id, Some(&photo_uri(50, 50, [1, 1, 1, 255]))),
        Err(FounderError::NotAFounder { .. })
    ));
    assert_eq!(stored_photo(&game, &id), None);
}

#[test]
fn a_photo_for_an_unknown_player_is_refused() {
    let mut game = game_with_founders();

    assert_eq!(
        set_founder_photo(&mut game, "nope", None),
        Err(FounderError::PlayerNotFound {
            player_id: "nope".to_string()
        })
    );
}

#[test]
fn a_photo_that_is_not_an_image_is_refused_and_the_previous_one_stays() {
    let mut game = game_with_founders();
    let id = founder_id(&game, LolRole::Support);
    set_founder_photo(&mut game, &id, Some(&photo_uri(50, 50, [1, 1, 1, 255]))).expect("photo");
    let before = stored_photo(&game, &id);

    let error = set_founder_photo(&mut game, &id, Some("data:image/svg+xml;base64,PHN2Zy8+"))
        .expect_err("rejected");

    assert_eq!(
        error,
        FounderError::InvalidPhoto(olm_core::founder_identity::FounderPhotoError {
            role: LolRole::Support,
            reason: olm_core::custom_logo::LogoError::NotPng,
        })
    );
    assert_eq!(stored_photo(&game, &id), before);
}
