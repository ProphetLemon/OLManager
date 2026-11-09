use chrono::TimeZone;
use olm_core::clock::GameClock;
use olm_core::competitions::competition_id_from_team_id_known;
use olm_core::custom_team::{
    CustomTeamError, CustomTeamSpec, badge_data_uri, custom_team_allowed, custom_team_id, is_custom_team_id,
    OvrPercentiles, join_team_with_custom, league_median_profile, peer_ovr_percentiles, replace_team_with_custom,
    validate_spec,
};
use olm_core::domain::manager::Manager;
use olm_core::domain::player::{LolRole, Player, PlayerAttributes};
use olm_core::domain::staff::{Staff, StaffAttributes, StaffRole};
use olm_core::domain::team::{Team, TeamKind};
use olm_core::game::Game;
use olm_core::generator::definitions::CompetitionManifest;

const GOLDEN_UCM: &str = "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20128%20128%22%3E%3Cpath%20d%3D%22M64%206L116%2022V62C116%2092%2094%20114%2064%20124C34%20114%2012%2092%2012%2062V22Z%22%20fill%3D%22%23f97316%22%20stroke%3D%22%2318181b%22%20stroke-width%3D%226%22%2F%3E%3Ctext%20x%3D%2264%22%20y%3D%2278%22%20text-anchor%3D%22middle%22%20font-family%3D%22sans-serif%22%20font-weight%3D%22800%22%20font-size%3D%2244%22%20fill%3D%22%2318181b%22%3EUCM%3C%2Ftext%3E%3C%2Fsvg%3E";
const GOLDEN_OLMX: &str = "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20128%20128%22%3E%3Cpath%20d%3D%22M64%206L116%2022V62C116%2092%2094%20114%2064%20124C34%20114%2012%2092%2012%2062V22Z%22%20fill%3D%22%232563eb%22%20stroke%3D%22%23ffffff%22%20stroke-width%3D%226%22%2F%3E%3Ctext%20x%3D%2264%22%20y%3D%2278%22%20text-anchor%3D%22middle%22%20font-family%3D%22sans-serif%22%20font-weight%3D%22800%22%20font-size%3D%2236%22%20fill%3D%22%23ffffff%22%3EOLMX%3C%2Ftext%3E%3C%2Fsvg%3E";

fn spec() -> CustomTeamSpec {
    CustomTeamSpec {
        name: "Ray Esports".to_string(),
        short_name: "ray".to_string(),
        primary_color: "#112233".to_string(),
        secondary_color: "#FFFFFF".to_string(),
        country: "ES".to_string(),
        logo_data_uri: None,
        founding_seed: None,
        founder_overrides: None,
    }
}

fn team(id: &str, name: &str, short: &str, competition: &str) -> Team {
    let mut team = Team::new(
        id.to_string(),
        name.to_string(),
        short.to_string(),
        "ES".to_string(),
        String::new(),
        "Arena".to_string(),
        1_000,
    );
    team.competition_id = Some(competition.to_string());
    team
}

fn player(id: &str, team_id: Option<&str>) -> Player {
    let mut player = Player::new(
        id.to_string(),
        id.to_string(),
        id.to_string(),
        "2000-01-01".to_string(),
        "ES".to_string(),
        LolRole::Adc,
        PlayerAttributes {
            mechanics: 60,
            laning: 60,
            teamfighting: 60,
            macro_play: 60,
            consistency: 60,
            shotcalling: 60,
            champion_pool: 60,
            discipline: 60,
            mental_resilience: 60,
        },
    );
    player.team_id = team_id.map(str::to_string);
    player.contract_end = Some("2027-06-30".to_string());
    player.wage = 12_000;
    player
}

fn coach(id: &str, team_id: &str) -> Staff {
    let mut staff = Staff::new(
        id.to_string(),
        id.to_string(),
        id.to_string(),
        "1980-01-01".to_string(),
        StaffRole::Coach,
        StaffAttributes {
            coaching: 60,
            judging_ability: 60,
            judging_potential: 60,
            physiotherapy: 60,
        },
    );
    staff.team_id = Some(team_id.to_string());
    staff
}

/// Three competitions of three or four teams, with players and staff on `les-b`.
fn world() -> Game {
    let clock = GameClock::new(chrono::Utc.with_ymd_and_hms(2026, 8, 1, 12, 0, 0).unwrap());
    let manager = Manager::new(
        "manager-1".to_string(),
        "Test".to_string(),
        "Manager".to_string(),
        "1980-01-01".to_string(),
        "ES".to_string(),
    );
    let mut teams = vec![
        team("les-a", "Alpha Gaming", "ALP", "les"),
        team("les-b", "Bravo Club", "BRV", "les"),
        team("les-c", "Charlie Club", "CHA", "les"),
        team("les-d", "Delta Club", "DEL", "les"),
        team("lec-g2", "G2 Esports", "G2", "lec"),
        team("lec-fnc", "Fnatic", "FNC", "lec"),
        team("lec-kc", "Karmine Corp", "KC", "lec"),
        team("emea-x", "Xeno Club", "XEN", "emea-masters"),
        team("emea-y", "Yankee Club", "YAN", "emea-masters"),
        team("emea-z", "Zulu Club", "ZUL", "emea-masters"),
    ];
    for (id, finance, reputation) in [
        ("les-a", 100, 200),
        ("les-b", 999, 999),
        ("les-c", 300, 0),
        ("les-d", 500, 400),
    ] {
        let t = teams.iter_mut().find(|t| t.id == id).unwrap();
        t.finance = finance;
        t.reputation = reputation;
    }
    let players = vec![
        player("p-b1", Some("les-b")),
        player("p-b2", Some("les-b")),
        player("p-a1", Some("les-a")),
    ];
    let staff = vec![coach("s-b1", "les-b"), coach("s-a1", "les-a")];
    Game::new(clock, manager, teams, players, staff, vec![])
}

fn manifest(tier: Option<u8>, active: bool, legacy: bool, with_split: bool) -> CompetitionManifest {
    let splits = if with_split {
        serde_json::json!([{ "name": "Spring", "season_start": { "month": 1, "day": 10 } }])
    } else {
        serde_json::json!([])
    };
    serde_json::from_value(serde_json::json!({
        "id": "les",
        "name": "LES",
        "region": "LES",
        "tier": tier,
        "active": active,
        "legacy": legacy,
        "schedule": { "format": "round_robin", "team_count": 8, "splits": splits },
    }))
    .unwrap()
}

#[test]
fn validate_spec_normalizes_a_valid_spec() {
    let result = validate_spec(&spec(), &[]).unwrap();

    assert_eq!(result.short_name, "RAY");
    assert_eq!(result.secondary_color, "#ffffff");
}

#[test]
fn validate_spec_rejects_short_name_of_five_chars() {
    let mut s = spec();
    s.short_name = "ABCDE".to_string();

    assert_eq!(
        validate_spec(&s, &[]).unwrap_err(),
        CustomTeamError::InvalidShortName
    );
}

#[test]
fn validate_spec_rejects_short_name_of_two_chars() {
    let mut s = spec();
    s.short_name = "AB".to_string();

    assert_eq!(
        validate_spec(&s, &[]).unwrap_err(),
        CustomTeamError::InvalidShortName
    );
}

#[test]
fn validate_spec_rejects_non_alphanumeric_short_name() {
    let mut s = spec();
    s.short_name = "A<B".to_string();

    assert_eq!(
        validate_spec(&s, &[]).unwrap_err(),
        CustomTeamError::InvalidShortName
    );
}

#[test]
fn validate_spec_rejects_names_outside_three_to_thirty_chars() {
    let mut s = spec();
    s.name = " ab ".to_string();
    assert_eq!(
        validate_spec(&s, &[]).unwrap_err(),
        CustomTeamError::InvalidName
    );

    s.name = "x".repeat(31);
    assert_eq!(
        validate_spec(&s, &[]).unwrap_err(),
        CustomTeamError::InvalidName
    );
}

#[test]
fn validate_spec_rejects_bad_hex_colors() {
    for bad in ["112233", "#12345", "#12345g", "#1122334", ""] {
        let mut s = spec();
        s.primary_color = bad.to_string();
        assert_eq!(
            validate_spec(&s, &[]).unwrap_err(),
            CustomTeamError::InvalidColor(bad.to_string()),
            "{bad}"
        );
    }
}

#[test]
fn validate_spec_rejects_empty_country() {
    let mut s = spec();
    s.country = "  ".to_string();

    assert_eq!(
        validate_spec(&s, &[]).unwrap_err(),
        CustomTeamError::MissingCountry
    );
}

#[test]
fn validate_spec_rejects_duplicate_name_ignoring_case() {
    let other = team("t1", "RAY ESPORTS", "ZZZ", "les");

    assert_eq!(
        validate_spec(&spec(), &[&other]).unwrap_err(),
        CustomTeamError::DuplicateName
    );
}

#[test]
fn validate_spec_rejects_duplicate_short_name() {
    let other = team("t1", "Other Club", "RAY", "lec");

    assert_eq!(
        validate_spec(&spec(), &[&other]).unwrap_err(),
        CustomTeamError::DuplicateShortName
    );
}

#[test]
fn validate_spec_ignores_academy_teams() {
    let mut academy = team("t1", "Ray Esports", "RAY", "les");
    academy.team_kind = TeamKind::Academy;

    assert!(validate_spec(&spec(), &[&academy]).is_ok());
}

#[test]
fn replace_accepts_the_replaced_clubs_own_name() {
    let mut game = world();
    let mut s = spec();
    s.name = "Bravo Club".to_string();
    s.short_name = "BRV".to_string();

    assert!(replace_team_with_custom(&mut game, "les", "les-b", &s).is_ok());
}

#[test]
fn replace_rejects_a_name_used_by_another_competition() {
    let mut game = world();
    let mut s = spec();
    s.name = "g2 esports".to_string();

    assert_eq!(
        replace_team_with_custom(&mut game, "les", "les-b", &s).unwrap_err(),
        CustomTeamError::DuplicateName
    );
}

#[test]
fn is_custom_team_id_matches_generated_ids_only() {
    assert!(is_custom_team_id(&custom_team_id("les", "RAY")));
    assert!(is_custom_team_id(&custom_team_id("emea-masters", "R-4Y")));
    assert!(!is_custom_team_id("les-fnc"));
}

#[test]
fn custom_team_id_keeps_competition_prefix_resolvable() {
    let known = vec!["les".to_string(), "emea-masters".to_string()];

    let id = custom_team_id("les", "RAY");
    let dashed = custom_team_id("emea-masters", "R-4Y");

    assert_eq!(id, "les-custom-ray");
    assert_eq!(competition_id_from_team_id_known(&id, &known), Some("les"));
    assert_eq!(
        competition_id_from_team_id_known(&dashed, &known),
        Some("emea-masters")
    );
}

#[test]
fn league_median_profile_ignores_zero_values_and_averages_even_counts() {
    let mut a = team("a", "A", "AAA", "les");
    let mut b = team("b", "B", "BBB", "les");
    let mut c = team("c", "C", "CCC", "les");
    let mut d = team("d", "D", "DDD", "les");
    (a.finance, b.finance, c.finance, d.finance) = (100, 0, 300, 201);
    (a.reputation, b.reputation, c.reputation, d.reputation) = (10, 20, 0, 0);

    let profile = league_median_profile(&[&a, &b, &c, &d]);

    assert_eq!(
        profile.finance, 201,
        "zero ignored: median of 100, 201, 300"
    );
    assert_eq!(profile.reputation, 15, "even count: mean of 10 and 20");
}

#[test]
fn league_median_profile_means_the_two_middle_values_for_even_counts() {
    let mut a = team("a", "A", "AAA", "les");
    let mut b = team("b", "B", "BBB", "les");
    (a.reputation, b.reputation) = (301, 400);

    let profile = league_median_profile(&[&a, &b]);

    assert_eq!(profile.reputation, 350);
}

#[test]
fn league_median_profile_falls_back_to_team_defaults() {
    let mut a = team("a", "A", "AAA", "les");
    a.finance = 0;
    let defaults = Team::new(
        String::new(),
        String::new(),
        String::new(),
        String::new(),
        String::new(),
        String::new(),
        0,
    );

    let profile = league_median_profile(&[&a]);

    assert_eq!(profile.finance, defaults.finance);
    assert_eq!(league_median_profile(&[]).reputation, defaults.reputation);
}

#[test]
fn replace_team_removes_replaced_and_releases_players_and_staff() {
    let mut game = world();
    let before = game.teams.len();

    let outcome = replace_team_with_custom(&mut game, "les", "les-b", &spec()).unwrap();

    assert_eq!(game.teams.len(), before);
    assert!(game.teams.iter().all(|t| t.id != "les-b"));
    assert_eq!(game.removed_team_ids, vec!["les-b".to_string()]);
    assert_eq!(outcome.team_id, "les-custom-ray");
    assert_eq!(outcome.released_player_ids, vec!["p-b1", "p-b2"]);
    assert_eq!(outcome.released_staff_ids, vec!["s-b1"]);
    for id in ["p-b1", "p-b2"] {
        let p = game.players.iter().find(|p| p.id == id).unwrap();
        assert_eq!(p.team_id, None);
        assert!(game.moved_player_ids.contains(id));
    }
    let untouched = game.players.iter().find(|p| p.id == "p-a1").unwrap();
    assert_eq!(untouched.team_id.as_deref(), Some("les-a"));
    assert_eq!(
        game.staff.iter().find(|s| s.id == "s-b1").unwrap().team_id,
        None
    );
}

#[test]
fn replace_team_leaves_released_player_contracts_to_the_free_agent_pass() {
    let mut game = world();

    replace_team_with_custom(&mut game, "les", "les-b", &spec()).unwrap();

    let released = game.players.iter().find(|p| p.id == "p-b1").unwrap();
    assert_eq!(released.wage, 12_000);
    assert_eq!(released.contract_end.as_deref(), Some("2027-06-30"));
}

#[test]
fn replace_team_builds_the_club_from_the_league_median() {
    let mut game = world();

    replace_team_with_custom(&mut game, "les", "les-b", &spec()).unwrap();

    let custom = game
        .teams
        .iter()
        .find(|t| t.id == "les-custom-ray")
        .unwrap();
    // Peers (les-a, les-c, les-d): finance 100/300/500, reputation 200/0/400.
    assert_eq!(custom.finance, 300);
    assert_eq!(custom.reputation, 300);
    assert_eq!(custom.competition_id.as_deref(), Some("les"));
    assert_eq!(custom.team_kind, TeamKind::Main);
    assert_eq!(custom.name, "Ray Esports");
    assert_eq!(custom.colors.primary, "#112233");
    assert_eq!(custom.founded_year, 2026);
    assert!(custom.sponsorship.is_none());
    assert!(
        custom
            .logo_url
            .as_deref()
            .is_some_and(|logo| logo.starts_with("data:image/svg+xml"))
    );
}

#[test]
fn replace_team_clears_links_to_the_replaced_team() {
    let mut game = world();
    let mut academy = team("les-b-acad", "Bravo Academy", "BRA", "les");
    academy.team_kind = TeamKind::Academy;
    academy.parent_team_id = Some("les-b".to_string());
    game.teams.push(academy);
    let mut sister = team("les-e", "Echo Club", "ECH", "les");
    sister.academy_team_id = Some("les-b".to_string());
    sister.parent_team_id = Some("les-b".to_string());
    game.teams.push(sister);

    replace_team_with_custom(&mut game, "les", "les-b", &spec()).unwrap();

    let academy = game.teams.iter().find(|t| t.id == "les-b-acad").unwrap();
    assert_eq!(academy.parent_team_id.as_deref(), Some("les-custom-ray"));
    let sister = game.teams.iter().find(|t| t.id == "les-e").unwrap();
    assert_eq!(sister.academy_team_id, None);
    assert_eq!(sister.parent_team_id, None);
}

/// An unparented seed academy named after the replaced club, with one player
/// and one staff member, as the academy bootstrap leaves it.
fn orphan_seed_academy(game: &mut Game) {
    let mut academy = team("academy-les-bravo-club", "Bravo Club", "BRV", "les");
    academy.competition_id = None;
    academy.team_kind = TeamKind::Academy;
    academy.reputation = 6_000;
    game.teams.push(academy);
    game.players
        .push(player("p-acad1", Some("academy-les-bravo-club")));
    game.staff.push(coach("s-acad1", "academy-les-bravo-club"));
}

#[test]
fn replace_team_hands_the_replaced_clubs_academy_to_the_custom_club() {
    let mut game = world();
    orphan_seed_academy(&mut game);

    let outcome = replace_team_with_custom(&mut game, "les", "les-b", &spec()).unwrap();

    let academy = game
        .teams
        .iter()
        .find(|t| t.id == "academy-les-bravo-club")
        .unwrap();
    assert_eq!(academy.parent_team_id.as_deref(), Some("les-custom-ray"));
    assert_eq!(academy.name, "Ray Esports Academy");
    assert_eq!(academy.team_kind, TeamKind::Academy);
    let custom = game
        .teams
        .iter()
        .find(|t| t.id == "les-custom-ray")
        .unwrap();
    assert_eq!(
        custom.academy_team_id.as_deref(),
        Some("academy-les-bravo-club")
    );
    assert!(game.teams.iter().all(|t| t.name != "Bravo Club"));
    assert_eq!(outcome.released_player_ids, vec!["p-b1", "p-b2"]);
}

#[test]
fn replace_team_keeps_the_inherited_academys_people() {
    let mut game = world();
    orphan_seed_academy(&mut game);

    replace_team_with_custom(&mut game, "les", "les-b", &spec()).unwrap();

    let player = game.players.iter().find(|p| p.id == "p-acad1").unwrap();
    assert_eq!(player.team_id.as_deref(), Some("academy-les-bravo-club"));
    let member = game.staff.iter().find(|s| s.id == "s-acad1").unwrap();
    assert_eq!(member.team_id.as_deref(), Some("academy-les-bravo-club"));
    assert!(
        !game
            .removed_team_ids
            .contains(&"academy-les-bravo-club".to_string())
    );
}

#[test]
fn replace_team_dissolves_the_orphan_academy_when_the_custom_club_has_one() {
    let mut game = world();
    orphan_seed_academy(&mut game);
    let mut own = team("own-acad", "Ray Youth", "RYY", "les");
    own.team_kind = TeamKind::Academy;
    own.parent_team_id = Some("les-custom-ray".to_string());
    game.teams.push(own);

    let outcome = replace_team_with_custom(&mut game, "les", "les-b", &spec()).unwrap();

    assert!(game.teams.iter().all(|t| t.id != "academy-les-bravo-club"));
    assert!(
        game.removed_team_ids
            .contains(&"academy-les-bravo-club".to_string())
    );
    let player = game.players.iter().find(|p| p.id == "p-acad1").unwrap();
    assert_eq!(player.team_id, None);
    assert!(game.moved_player_ids.contains("p-acad1"));
    assert_eq!(
        game.staff
            .iter()
            .find(|s| s.id == "s-acad1")
            .unwrap()
            .team_id,
        None
    );
    assert!(outcome.released_player_ids.contains(&"p-acad1".to_string()));
    assert!(outcome.released_staff_ids.contains(&"s-acad1".to_string()));
    let own = game.teams.iter().find(|t| t.id == "own-acad").unwrap();
    assert_eq!(own.parent_team_id.as_deref(), Some("les-custom-ray"));
}

#[test]
fn replace_team_rejects_unknown_academy_and_wrong_competition_ids() {
    let mut game = world();
    let mut academy = team("les-acad", "Les Academy", "LAC", "les");
    academy.team_kind = TeamKind::Academy;
    game.teams.push(academy);

    assert_eq!(
        replace_team_with_custom(&mut game, "les", "nope", &spec()).unwrap_err(),
        CustomTeamError::ReplacedTeamNotFound("nope".to_string())
    );
    assert_eq!(
        replace_team_with_custom(&mut game, "les", "les-acad", &spec()).unwrap_err(),
        CustomTeamError::NotCustomizableTeamKind
    );
    assert_eq!(
        replace_team_with_custom(&mut game, "les", "lec-g2", &spec()).unwrap_err(),
        CustomTeamError::ReplacedTeamNotInCompetition
    );
    assert!(game.removed_team_ids.is_empty());
}

#[test]
fn custom_team_error_converts_to_its_display_string() {
    let message: String = CustomTeamError::DuplicateName.into();

    assert_eq!(message, CustomTeamError::DuplicateName.to_string());
}

#[test]
fn badge_data_uri_matches_golden_for_three_char_short_name() {
    assert_eq!(badge_data_uri("UCM", "#f97316", "#18181b"), GOLDEN_UCM);
}

#[test]
fn badge_data_uri_matches_golden_for_four_char_short_name() {
    assert_eq!(badge_data_uri("OLMX", "#2563eb", "#ffffff"), GOLDEN_OLMX);
}

#[test]
fn badge_data_uri_contains_no_unescaped_angle_brackets_in_text() {
    let uri = badge_data_uri("A<B", "#000000", "#ffffff");
    let payload = uri.trim_start_matches("data:image/svg+xml;utf8,");

    assert!(!payload.contains('<'));
    assert!(payload.contains("%26lt%3BB") || payload.contains("A%26lt%3B"));
}

#[test]
fn custom_team_allowed_is_false_for_tier_one() {
    assert!(!custom_team_allowed(&manifest(Some(1), true, false, true)));
}

#[test]
fn custom_team_allowed_is_false_without_a_tier() {
    assert!(!custom_team_allowed(&manifest(None, true, false, true)));
}

#[test]
fn custom_team_allowed_is_false_for_legacy_inactive_or_unscheduled_leagues() {
    assert!(!custom_team_allowed(&manifest(Some(2), true, true, true)));
    assert!(!custom_team_allowed(&manifest(Some(2), false, false, true)));
    assert!(!custom_team_allowed(&manifest(Some(2), true, false, false)));
}

#[test]
fn custom_team_allowed_is_true_for_a_tier_two_league_with_splits() {
    assert!(custom_team_allowed(&manifest(Some(2), true, false, true)));
}

fn rated_player(id: &str, team_id: Option<&str>, value: u8) -> Player {
    let mut p = player(id, team_id);
    p.attributes = PlayerAttributes {
        mechanics: value,
        laning: value,
        teamfighting: value,
        macro_play: value,
        consistency: value,
        shotcalling: value,
        champion_pool: value,
        discipline: value,
        mental_resilience: value,
    };
    p
}

/// `teams` Main clubs with `per_team` players each; OVR runs 60, 61, 62...
fn peer_world(teams: usize, per_team: usize) -> (Vec<Team>, Vec<Player>) {
    let clubs: Vec<Team> = (0..teams)
        .map(|i| team(&format!("t{i}"), &format!("Club {i}"), &format!("C{i}"), "les"))
        .collect();
    let mut players = Vec::new();
    for i in 0..teams {
        for j in 0..per_team {
            let ovr = 60 + (i * per_team + j) as u8;
            players.push(rated_player(&format!("p{i}-{j}"), Some(&format!("t{i}")), ovr));
        }
    }
    (clubs, players)
}

#[test]
fn peer_percentiles_are_measured_from_rostered_main_players() {
    let (clubs, players) = peer_world(5, 5);
    let peers: Vec<&Team> = clubs.iter().collect();
    let result = peer_ovr_percentiles(&peers, &players);
    // OVR 60..=84, 25 values: rank q*24 above 60.
    assert_eq!(
        (result.p10, result.p25, result.p50, result.p75, result.p90),
        (62, 66, 72, 78, 82)
    );
    assert!(result.from_peers);
}

#[test]
fn peer_percentiles_fall_back_with_fewer_than_four_peers() {
    let (clubs, players) = peer_world(3, 10);
    let peers: Vec<&Team> = clubs.iter().collect();
    assert_eq!(peer_ovr_percentiles(&peers, &players), OvrPercentiles::FALLBACK);
}

#[test]
fn peer_percentiles_fall_back_with_too_few_players() {
    let (clubs, players) = peer_world(4, 4);
    let peers: Vec<&Team> = clubs.iter().collect();
    assert_eq!(peer_ovr_percentiles(&peers, &players), OvrPercentiles::FALLBACK);
}

#[test]
fn peer_percentiles_ignore_academies_and_free_agents() {
    let (mut clubs, mut players) = peer_world(5, 5);
    clubs[0].team_kind = TeamKind::Academy;
    players.push(rated_player("free", None, 99));
    let peers: Vec<&Team> = clubs.iter().collect();
    // Four Main peers remain with 20 players; the free agent never counts.
    let result = peer_ovr_percentiles(&peers, &players);
    assert!(result.from_peers);
    assert!(result.p90 < 99);
    assert!(result.p10 >= 65);
}

#[test]
fn fallback_window_is_ordered_and_inside_60_to_78() {
    let f = OvrPercentiles::FALLBACK;
    assert!(f.p10 == 60 && f.p90 == 78);
    assert!(f.p10 <= f.p25 && f.p25 <= f.p50 && f.p50 <= f.p75 && f.p75 <= f.p90);
    assert!(!f.from_peers);
}

fn logo_uri(width: u32, height: u32) -> String {
    use base64::Engine as _;
    let mut out = Vec::new();
    let mut encoder = png::Encoder::new(&mut out, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().unwrap();
    let data: Vec<u8> = (0..width * height).flat_map(|_| [200, 30, 30, 255]).collect();
    writer.write_image_data(&data).unwrap();
    writer.finish().unwrap();
    format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(out)
    )
}

#[test]
fn a_spec_payload_without_a_logo_still_parses() {
    let json = r##"{"name":"Ray Esports","short_name":"RAY","primary_color":"#112233","secondary_color":"#ffffff","country":"ES"}"##;

    let parsed: CustomTeamSpec = serde_json::from_str(json).unwrap();

    assert_eq!(parsed.logo_data_uri, None);
}

#[test]
fn a_spec_payload_carries_the_logo_field() {
    let json = r##"{"name":"Ray Esports","short_name":"RAY","primary_color":"#112233","secondary_color":"#ffffff","country":"ES","logo_data_uri":"data:image/png;base64,AA=="}"##;

    let parsed: CustomTeamSpec = serde_json::from_str(json).unwrap();

    assert_eq!(parsed.logo_data_uri.as_deref(), Some("data:image/png;base64,AA=="));
}

#[test]
fn replace_team_stores_the_uploaded_logo_instead_of_the_generated_badge() {
    let mut game = world();
    let mut s = spec();
    s.logo_data_uri = Some(logo_uri(512, 512));

    replace_team_with_custom(&mut game, "les", "les-b", &s).unwrap();

    let custom = game.teams.iter().find(|t| t.id == "les-custom-ray").unwrap();
    let logo = custom.logo_url.as_deref().unwrap();
    assert!(logo.starts_with("data:image/png;base64,"));
    assert_eq!(logo, olm_core::custom_logo::normalize_logo(&logo_uri(512, 512)).unwrap());
}

#[test]
fn replace_team_keeps_the_generated_badge_without_an_uploaded_logo() {
    let mut game = world();

    replace_team_with_custom(&mut game, "les", "les-b", &spec()).unwrap();

    let custom = game.teams.iter().find(|t| t.id == "les-custom-ray").unwrap();
    assert!(custom.logo_url.as_deref().unwrap().starts_with("data:image/svg+xml"));
}

#[test]
fn replace_team_rejects_an_invalid_logo_before_changing_anything() {
    let mut game = world();
    let mut s = spec();
    s.logo_data_uri = Some("data:image/svg+xml;base64,PHN2Zy8+".to_string());

    let error = replace_team_with_custom(&mut game, "les", "les-b", &s).unwrap_err();

    assert_eq!(
        error,
        CustomTeamError::InvalidLogo(olm_core::custom_logo::LogoError::NotPng)
    );
    assert!(game.teams.iter().any(|t| t.id == "les-b"));
    assert!(!game.teams.iter().any(|t| t.id == "les-custom-ray"));
    assert!(game.moved_player_ids.is_empty());
}

#[test]
fn validate_spec_returns_the_normalized_logo() {
    let mut s = spec();
    s.logo_data_uri = Some(logo_uri(1024, 512));

    let validated = validate_spec(&s, &[]).unwrap();

    assert_eq!(
        validated.logo_data_uri,
        Some(olm_core::custom_logo::normalize_logo(&logo_uri(1024, 512)).unwrap())
    );
}

#[test]
fn the_invalid_logo_error_names_its_reason() {
    let error = CustomTeamError::InvalidLogo(olm_core::custom_logo::LogoError::TooBigDimensions);

    assert_eq!(error.to_string(), "Invalid club logo: too_big_dimensions");
}

#[test]
fn join_team_adds_a_club_and_releases_nobody() {
    let mut game = world();
    let teams_before = game.teams.len();
    let players_before: Vec<_> = game
        .players
        .iter()
        .map(|p| (p.id.clone(), p.team_id.clone()))
        .collect();

    let outcome = join_team_with_custom(&mut game, "les", &spec()).unwrap();

    assert_eq!(game.teams.len(), teams_before + 1);
    assert_eq!(outcome.team_id, "les-custom-ray");
    assert!(outcome.released_player_ids.is_empty());
    assert!(outcome.released_staff_ids.is_empty());
    assert!(game.removed_team_ids.is_empty());
    assert!(game.moved_player_ids.is_empty());
    for id in ["les-a", "les-b", "les-c", "les-d"] {
        assert!(game.teams.iter().any(|t| t.id == id), "{id} must stay");
    }
    let players_after: Vec<_> = game
        .players
        .iter()
        .map(|p| (p.id.clone(), p.team_id.clone()))
        .collect();
    assert_eq!(players_after, players_before);
    assert_eq!(game.staff.iter().filter(|s| s.team_id.is_some()).count(), 2);
}

#[test]
fn join_team_builds_the_club_from_the_median_of_every_league_club() {
    let mut game = world();

    join_team_with_custom(&mut game, "les", &spec()).unwrap();

    let custom = game
        .teams
        .iter()
        .find(|t| t.id == "les-custom-ray")
        .unwrap();
    // All four clubs count: finance 100/300/500/999 (median 400), reputation
    // 200/0/400/999 with the zero ignored (median 400).
    assert_eq!(custom.finance, 400);
    assert_eq!(custom.reputation, 400);
    assert_eq!(custom.competition_id.as_deref(), Some("les"));
    assert_eq!(custom.team_kind, TeamKind::Main);
    assert_eq!(custom.academy_team_id, None);
    assert!(custom.sponsorship.is_none());
    assert_eq!(custom.founded_year, 2026);
    assert!(
        custom
            .logo_url
            .as_deref()
            .is_some_and(|logo| logo.starts_with("data:image/svg+xml"))
    );
}

#[test]
fn join_team_matches_the_replace_install_for_identity_and_look() {
    let mut joined = world();
    let mut replaced = world();

    join_team_with_custom(&mut joined, "les", &spec()).unwrap();
    replace_team_with_custom(&mut replaced, "les", "les-b", &spec()).unwrap();

    let find = |game: &Game| {
        game.teams
            .iter()
            .find(|t| t.id == "les-custom-ray")
            .cloned()
            .unwrap()
    };
    let (a, b) = (find(&joined), find(&replaced));
    assert_eq!(
        (a.name, a.short_name, a.country, a.logo_url, a.colors.primary),
        (b.name, b.short_name, b.country, b.logo_url, b.colors.primary)
    );
}

#[test]
fn join_team_validates_names_against_every_club() {
    let mut game = world();
    let mut clash = spec();
    clash.name = "bravo club".to_string();

    // Unlike replace mode, no club is removed, so the name of a rival stays taken.
    assert_eq!(
        join_team_with_custom(&mut game, "les", &clash).unwrap_err(),
        CustomTeamError::DuplicateName
    );
    assert_eq!(game.teams.len(), 10);
}

#[test]
fn join_team_refuses_a_competition_without_clubs() {
    let mut game = world();

    assert_eq!(
        join_team_with_custom(&mut game, "nowhere", &spec()).unwrap_err(),
        CustomTeamError::UnknownCompetition("nowhere".to_string())
    );
    assert_eq!(game.teams.len(), 10);
}
