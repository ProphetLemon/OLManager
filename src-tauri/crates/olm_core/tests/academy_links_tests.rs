//! Real-club academies (ACADEMY-COPIES): a tier-1 club funds a link to a real tier-2
//! `Main` club of its region instead of a generated copy. Worlds that already hold
//! `TeamKind::Academy` copies stay on the legacy path (see `academy_tests.rs`).

use chrono::{TimeZone, Utc};
use olm_core::academy::{BLOCKED_NOT_TOP_LEAGUE, BLOCKED_NO_REGION_CANDIDATES};
use olm_core::academy_link::{
    acquire_linked_club, dissolve_links_of_promoted_clubs, linked_club_id, linked_club_report,
    world_has_academy_copies,
};
use olm_core::clock::GameClock;
use olm_core::domain::league::{League, StandingEntry};
use olm_core::domain::manager::Manager;
use olm_core::domain::player::{LolRole, Player, PlayerAttributes};
use olm_core::domain::team::{FinancialTransactionKind, Team, TeamKind};
use olm_core::game::Game;

fn team(id: &str, competition: &str, finance: i64) -> Team {
    let mut team = Team::new(
        id.to_string(),
        format!("{id} Esports"),
        id.to_uppercase(),
        "ES".to_string(),
        "City".to_string(),
        "Arena".to_string(),
        10_000,
    );
    team.finance = finance;
    team.competition_id = Some(competition.to_string());
    team
}

fn player(id: &str, team_id: &str, role: LolRole, market_value: u64) -> Player {
    let mut player = Player::new(
        id.to_string(),
        id.to_string(),
        id.to_string(),
        "2002-01-01".to_string(),
        "ES".to_string(),
        role,
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
    player.team_id = Some(team_id.to_string());
    player.contract_end = Some("2027-06-30".to_string());
    player.wage = 9_000;
    player.market_value = market_value;
    player
}

fn league(competition: &str, tier: u8, members: &[&str]) -> League {
    let ids: Vec<String> = members.iter().map(|id| id.to_string()).collect();
    let mut league = League::new(
        format!("league-{competition}"),
        competition.to_uppercase(),
        2026,
        &ids,
        Some(competition.to_string()),
    );
    league.tier = tier;
    league
}

/// `koi` (user, LEC, tier 1) with real tier-2 clubs in `les` (EMEA) and `lckcl` (KR).
fn new_world() -> Game {
    let mut manager = Manager::new(
        "manager-1".to_string(),
        "Test".to_string(),
        "Manager".to_string(),
        "1985-01-01".to_string(),
        "ES".to_string(),
    );
    manager.hire("koi".to_string());
    let mut koi = team("koi", "lec", 5_000_000);
    koi.manager_id = Some(manager.id.clone());
    let teams = vec![
        koi,
        team("les-alpha", "les", 300_000),
        team("les-beta", "les", 200_000),
        team("les-custom-ray", "les", 100_000),
        team("cl-rookies", "lckcl", 100_000),
    ];
    let mut players = Vec::new();
    for club in ["les-alpha", "les-beta", "cl-rookies", "koi"] {
        for (index, role) in [LolRole::Top, LolRole::Jungle, LolRole::Mid]
            .into_iter()
            .enumerate()
        {
            players.push(player(&format!("{club}-p{index}"), club, role, 100_000));
        }
    }
    let mut game = Game::new(
        GameClock::new(Utc.with_ymd_and_hms(2026, 3, 15, 12, 0, 0).unwrap()),
        manager,
        teams,
        players,
        vec![],
        vec![],
    );
    game.leagues = vec![
        league("lec", 1, &["koi"]),
        league("les", 2, &["les-alpha", "les-beta", "les-custom-ray"]),
        league("lckcl", 2, &["cl-rookies"]),
    ];
    game
}

fn option_ids(game: &Game) -> Vec<String> {
    let mut ids: Vec<String> = linked_club_report(game, "koi")
        .options
        .into_iter()
        .map(|option| option.source_team_id)
        .collect();
    ids.sort();
    ids
}

#[test]
fn a_world_without_academy_copies_is_not_legacy() {
    assert!(!world_has_academy_copies(&new_world()));
}

#[test]
fn a_world_holding_any_academy_copy_is_legacy() {
    let mut game = new_world();
    let mut copy = team("academy-les-fenix", "les", 0);
    copy.team_kind = TeamKind::Academy;
    game.teams.push(copy);

    assert!(world_has_academy_copies(&game));
}

#[test]
fn options_are_the_real_tier_two_clubs_of_the_parents_region() {
    let game = new_world();

    assert_eq!(option_ids(&game), ["les-alpha", "les-beta"]);
}

#[test]
fn options_keep_the_clubs_own_name_logo_and_league() {
    let mut game = new_world();
    game.teams[1].logo_url = Some("logos/alpha.svg".to_string());

    let report = linked_club_report(&game, "koi");
    let alpha = report
        .options
        .iter()
        .find(|option| option.source_team_id == "les-alpha")
        .expect("alpha is offered");

    assert_eq!(alpha.name, "les-alpha Esports");
    assert_eq!(alpha.logo_url.as_deref(), Some("logos/alpha.svg"));
    assert_eq!(alpha.erl_league_id, "les");
    assert_eq!(report.region.as_deref(), Some("EMEA"));
    assert_eq!(report.blocked_reason, None);
}

#[test]
fn custom_clubs_and_clubs_with_a_parent_are_not_offered() {
    let mut game = new_world();
    game.teams[2].parent_team_id = Some("someone-else".to_string());

    assert_eq!(option_ids(&game), ["les-alpha"]);
}

#[test]
fn the_fee_is_the_formula_or_a_quarter_of_the_squad_value_whichever_is_higher() {
    let mut game = new_world();
    let formula = linked_club_report(&game, "koi")
        .options
        .iter()
        .find(|option| option.source_team_id == "les-beta")
        .map(|option| option.acquisition_cost)
        .expect("beta is offered");
    assert!(formula > 0);

    // Squad worth 8 million: a quarter is 2 million, far above the league formula.
    for player in game
        .players
        .iter_mut()
        .filter(|player| player.team_id.as_deref() == Some("les-alpha"))
    {
        player.market_value = 8_000_000 / 3 + 1;
    }
    let alpha_fee = linked_club_report(&game, "koi")
        .options
        .iter()
        .find(|option| option.source_team_id == "les-alpha")
        .map(|option| option.acquisition_cost)
        .expect("alpha is offered");

    assert!(alpha_fee >= 2_000_000, "fee was {alpha_fee}");
    assert_eq!(formula, 100_000 + 3 * 40_000 + 2 * 20_000);
}

#[test]
fn acquire_links_both_ids_books_the_fee_and_keeps_the_club_intact() {
    let mut game = new_world();
    let fee = linked_club_report(&game, "koi")
        .options
        .iter()
        .find(|option| option.source_team_id == "les-alpha")
        .map(|option| option.acquisition_cost)
        .expect("alpha is offered");
    let teams_before = game.teams.len();

    acquire_linked_club(&mut game, "koi", "les-alpha").expect("link");

    let koi = game.teams.iter().find(|t| t.id == "koi").expect("koi");
    let alpha = game.teams.iter().find(|t| t.id == "les-alpha").expect("alpha");
    assert_eq!(koi.academy_team_id.as_deref(), Some("les-alpha"));
    assert_eq!(alpha.parent_team_id.as_deref(), Some("koi"));
    assert_eq!(game.teams.len(), teams_before, "no copy is created");
    assert_eq!(alpha.team_kind, TeamKind::Main);
    assert_eq!(alpha.name, "les-alpha Esports");
    assert_eq!(alpha.finance, 300_000);
    assert_eq!(alpha.competition_id.as_deref(), Some("les"));
    assert_eq!(koi.finance, 5_000_000 - fee);
    let entry = koi.financial_ledger.last().expect("fee booked");
    assert_eq!(entry.kind, FinancialTransactionKind::AcademyAcquisition);
    assert_eq!(entry.amount, -fee);
    assert_eq!(linked_club_id(&game, "koi").as_deref(), Some("les-alpha"));
}

#[test]
fn a_club_has_one_parent() {
    let mut game = new_world();
    acquire_linked_club(&mut game, "koi", "les-alpha").expect("first link");
    let mut rival = team("rival", "lec", 5_000_000);
    rival.reputation = 1;
    game.teams.push(rival);
    game.leagues[0].standings.push(StandingEntry::new("rival".to_string()));

    let second = acquire_linked_club(&mut game, "rival", "les-alpha");

    assert!(second.is_err());
    let alpha = game.teams.iter().find(|t| t.id == "les-alpha").expect("alpha");
    assert_eq!(alpha.parent_team_id.as_deref(), Some("koi"));
}

#[test]
fn a_parent_cannot_fund_a_second_academy() {
    let mut game = new_world();
    acquire_linked_club(&mut game, "koi", "les-alpha").expect("first link");

    assert!(acquire_linked_club(&mut game, "koi", "les-beta").is_err());
}

#[test]
fn acquire_without_funds_changes_nothing() {
    let mut game = new_world();
    game.teams[0].finance = 1_000;

    let result = acquire_linked_club(&mut game, "koi", "les-alpha");

    assert!(result.is_err());
    assert_eq!(game.teams[0].academy_team_id, None);
    assert_eq!(game.teams[0].finance, 1_000);
}

#[test]
fn a_club_outside_the_parents_region_cannot_be_acquired() {
    let mut game = new_world();

    assert!(acquire_linked_club(&mut game, "koi", "cl-rookies").is_err());
}

#[test]
fn a_tier_two_parent_is_blocked_as_not_top_league() {
    let mut game = new_world();
    game.leagues[0].tier = 2;

    let report = linked_club_report(&game, "koi");

    assert_eq!(report.blocked_reason.as_deref(), Some(BLOCKED_NOT_TOP_LEAGUE));
    assert!(report.options.is_empty());
}

#[test]
fn a_region_with_no_free_tier_two_club_gets_the_region_reason() {
    let mut game = new_world();
    game.teams[1].parent_team_id = Some("x".to_string());
    game.teams[2].parent_team_id = Some("x".to_string());

    let report = linked_club_report(&game, "koi");

    assert_eq!(
        report.blocked_reason.as_deref(),
        Some(BLOCKED_NO_REGION_CANDIDATES)
    );
}

#[test]
fn promotion_to_tier_one_dissolves_the_link_and_tells_the_user() {
    let mut game = new_world();
    acquire_linked_club(&mut game, "koi", "les-alpha").expect("link");
    // The ladder moved the club up: its league is now tier 1.
    game.teams.iter_mut().find(|t| t.id == "les-alpha").unwrap().competition_id =
        Some("lec".to_string());
    game.leagues[0].standings.push(StandingEntry::new("les-alpha".to_string()));
    let messages_before = game.messages.len();

    dissolve_links_of_promoted_clubs(&mut game, &["les-alpha".to_string()]);

    let koi = game.teams.iter().find(|t| t.id == "koi").expect("koi");
    let alpha = game.teams.iter().find(|t| t.id == "les-alpha").expect("alpha");
    assert_eq!(koi.academy_team_id, None);
    assert_eq!(alpha.parent_team_id, None);
    assert_eq!(game.messages.len(), messages_before + 1);
    let message = game.messages.last().expect("message");
    assert_eq!(
        message.subject_key.as_deref(),
        Some("be.msg.academyLinkDissolved.subject")
    );
}

#[test]
fn promotion_of_an_unlinked_club_touches_nothing() {
    let mut game = new_world();
    acquire_linked_club(&mut game, "koi", "les-alpha").expect("link");
    let messages_before = game.messages.len();

    dissolve_links_of_promoted_clubs(&mut game, &["les-beta".to_string()]);

    let koi = game.teams.iter().find(|t| t.id == "koi").expect("koi");
    assert_eq!(koi.academy_team_id.as_deref(), Some("les-alpha"));
    assert_eq!(game.messages.len(), messages_before);
}

// ---------------------------------------------------------------------------
// Season and squad (AC2)
// ---------------------------------------------------------------------------

use olm_core::custom_team::{CustomTeamSpec, replace_team_with_custom};
use olm_core::time_blockers::compute_blocking_actions;

fn blocker_ids(game: &Game) -> Vec<String> {
    compute_blocking_actions(game)
        .iter()
        .filter_map(|blocker| blocker["id"].as_str().map(str::to_string))
        .collect()
}

#[test]
fn the_role_coverage_blocker_reads_the_linked_club_roster() {
    let mut game = new_world();
    acquire_linked_club(&mut game, "koi", "les-alpha").expect("link");

    // The linked club only fields Top, Jungle and Mid.
    assert!(blocker_ids(&game).contains(&"academy_missing_roles".to_string()));

    game.players.push(player("alpha-adc", "les-alpha", LolRole::Adc, 1));
    game.players.push(player("alpha-sup", "les-alpha", LolRole::Support, 1));
    assert!(!blocker_ids(&game).contains(&"academy_missing_roles".to_string()));
}

#[test]
fn a_custom_club_replacing_the_linked_club_dissolves_the_link() {
    let mut game = new_world();
    acquire_linked_club(&mut game, "koi", "les-alpha").expect("link");
    let spec = CustomTeamSpec {
        name: "Ray Esports".to_string(),
        short_name: "ray".to_string(),
        primary_color: "#112233".to_string(),
        secondary_color: "#FFFFFF".to_string(),
        country: "ES".to_string(),
        logo_data_uri: None,
        founding_seed: None,
        founder_overrides: None,
        founder_photos: None,
    };

    replace_team_with_custom(&mut game, "les", Some(2), "les-alpha", &spec).expect("replace");

    let koi = game.teams.iter().find(|t| t.id == "koi").expect("koi");
    assert_eq!(koi.academy_team_id, None);
    assert!(!game.teams.iter().any(|t| t.parent_team_id.as_deref() == Some("koi")));
}

#[test]
fn a_custom_club_replacing_the_parent_frees_the_linked_club() {
    let mut game = new_world();
    acquire_linked_club(&mut game, "koi", "les-alpha").expect("link");
    let spec = CustomTeamSpec {
        name: "Ray Esports".to_string(),
        short_name: "ray".to_string(),
        primary_color: "#112233".to_string(),
        secondary_color: "#FFFFFF".to_string(),
        country: "ES".to_string(),
        logo_data_uri: None,
        founding_seed: None,
        founder_overrides: None,
        founder_photos: None,
    };

    replace_team_with_custom(&mut game, "lec", Some(1), "koi", &spec).expect("replace");

    let alpha = game.teams.iter().find(|t| t.id == "les-alpha").expect("alpha");
    assert_eq!(alpha.parent_team_id, None);
}
