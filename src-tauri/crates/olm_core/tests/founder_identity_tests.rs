use chrono::{NaiveDate, TimeZone};
use olm_core::clock::GameClock;
use olm_core::custom_team::{CustomTeamSpec, replace_team_with_custom};
use olm_core::domain::manager::Manager;
use olm_core::domain::player::{LolRole, Player, PlayerAttributes};
use olm_core::domain::team::Team;
use olm_core::founder_identity::{
    FounderEditError, FounderEditReason as Reason, FounderError, FounderField as Field,
    FounderIdentityOverride, FounderOverrides, fold_key, normalize_full_name, normalize_nick,
    rename_founder, validate_birth_date, validate_nationality,
};
use olm_core::founding_squad::{
    FoundingSquadError, install_founding_squad, install_founding_squad_with, plan_founding_squad,
};
use olm_core::game::Game;
use olm_core::squad_generator::{DERIVED_BUDGET_BILL_PCT, SQUAD_ROLES, squad_bill};
use olm_core::wage_scale::scale_wage_for_market_value;

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
        founding_seed: None,
        founder_overrides: None,
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

fn world() -> Game {
    let clock = GameClock::new(chrono::Utc.with_ymd_and_hms(2026, 8, 1, 12, 0, 0).unwrap());
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
    let mut game = world();
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

#[test]
fn birth_date_accepts_the_age_limits() {
    // Today is 2026-08-01: 19 on his birthday, 27 the day before turning 28.
    assert_eq!(
        validate_birth_date("2007-08-01", today()).as_deref(),
        Ok("2007-08-01")
    );
    assert_eq!(
        validate_birth_date("1998-08-02", today()).as_deref(),
        Ok("1998-08-02")
    );
}

#[test]
fn birth_date_rejects_one_day_outside_the_age_limits() {
    assert_eq!(
        validate_birth_date("2007-08-02", today()),
        Err(Reason::TooYoung)
    );
    assert_eq!(
        validate_birth_date("1998-08-01", today()),
        Err(Reason::TooOld)
    );
}

#[test]
fn birth_date_rejects_future_dates() {
    assert_eq!(
        validate_birth_date("2030-01-01", today()),
        Err(Reason::TooYoung)
    );
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
            validate_birth_date(bad, today()),
            Err(Reason::InvalidDate),
            "{bad}"
        );
    }
    assert_eq!(validate_birth_date("  ", today()), Err(Reason::Empty));
}

// ---------------------------------------------------------------------------
// Overrides at creation
// ---------------------------------------------------------------------------

#[test]
fn an_old_payload_without_overrides_still_parses() {
    let json = r##"{"name":"Rayo","short_name":"RAY","primary_color":"#112233","secondary_color":"#ffffff","country":"ES"}"##;
    let parsed: CustomTeamSpec = serde_json::from_str(json).expect("old payload");
    assert_eq!(parsed.founder_overrides, None);
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
        birth_date: Some("2003-03-15".to_string()),
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
    assert_eq!(top.date_of_birth, "2003-03-15");
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
        birth_date: Some("2000-06-01".to_string()),
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
fn a_birth_date_edit_reprices_the_founder_above_the_wage_floor() {
    for dob in ["2007-08-01", "1998-08-02", "2002-01-01", "2004-12-31"] {
        let mut game = with_custom_club();
        let edit = FounderIdentityOverride {
            birth_date: Some(dob.to_string()),
            ..FounderIdentityOverride::default()
        };
        install_founding_squad_with(&mut game, "les", CUSTOM, Some("ES"), 3, &only(edit))
            .expect(dob);
        for p in founders(&game) {
            assert!(
                p.wage >= scale_wage_for_market_value(p.market_value),
                "{dob}: {} wage {} below the floor of {}",
                p.id,
                p.wage,
                p.market_value
            );
        }
    }
}

#[test]
fn a_younger_birth_date_raises_the_market_value() {
    let value_at = |dob: &str| {
        let mut game = with_custom_club();
        let edit = FounderIdentityOverride {
            birth_date: Some(dob.to_string()),
            ..FounderIdentityOverride::default()
        };
        install_founding_squad_with(&mut game, "les", CUSTOM, Some("ES"), 3, &only(edit))
            .expect(dob);
        founders(&game)
            .into_iter()
            .find(|p| p.natural_position == LolRole::Top)
            .map(|p| p.market_value)
            .expect("top")
    };
    assert!(value_at("2007-08-01") > value_at("1998-08-02"));
}

#[test]
fn the_wage_budget_is_derived_after_the_edits() {
    let mut game = with_custom_club();
    let edits = FounderOverrides {
        top: Some(FounderIdentityOverride {
            birth_date: Some("2007-08-01".to_string()),
            ..FounderIdentityOverride::default()
        }),
        support: Some(FounderIdentityOverride {
            birth_date: Some("1998-08-02".to_string()),
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
fn an_out_of_band_birth_date_is_rejected() {
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
            reason: Reason::TooOld
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

#[test]
fn an_older_birth_date_does_not_raise_the_wage() {
    let mut plain = with_custom_club();
    install_founding_squad_with(
        &mut plain,
        "les",
        CUSTOM,
        Some("ES"),
        6,
        &FounderOverrides::default(),
    )
    .expect("plain");
    let edit = FounderIdentityOverride {
        birth_date: Some("1999-01-01".to_string()),
        ..FounderIdentityOverride::default()
    };
    let mut edited = with_custom_club();
    install_founding_squad_with(&mut edited, "les", CUSTOM, Some("ES"), 6, &only(edit))
        .expect("edited");
    let wage_of = |g: &Game| {
        founders(g)
            .into_iter()
            .find(|p| p.natural_position == LolRole::Top)
            .map(|p| p.wage)
            .expect("top")
    };
    let youngest = {
        let mut game = with_custom_club();
        let edit = FounderIdentityOverride {
            birth_date: Some("2007-08-01".to_string()),
            ..FounderIdentityOverride::default()
        };
        install_founding_squad_with(&mut game, "les", CUSTOM, Some("ES"), 6, &only(edit))
            .expect("young");
        wage_of(&game)
    };
    assert!(wage_of(&edited) <= youngest);
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
