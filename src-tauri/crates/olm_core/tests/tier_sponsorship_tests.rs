use chrono::{TimeZone, Utc};
use olm_core::clock::GameClock;
use olm_core::domain::league::League;
use olm_core::domain::manager::Manager;
use olm_core::domain::team::{FinancialTransactionKind, Sponsorship, Team, TeamKind};
use olm_core::finances;
use olm_core::game::Game;
use olm_core::random_events::sponsor_offer_improves_on;
use olm_core::tier_sponsorship::{
    TIER_1_SPONSORSHIP_VALUE, TIER_2_SPONSORSHIP_VALUE, TIER_SPONSORSHIP_MONTHS,
    assign_missing_tier_sponsorships, scheduled_main_club_tiers, tier_sponsor_name,
    tier_sponsorship, tier_sponsorship_value,
};

fn make_team(id: &str) -> Team {
    let mut team = Team::new(
        id.to_string(),
        format!("Team {id}"),
        id.to_string(),
        "GB".to_string(),
        "London".to_string(),
        "Stadium".to_string(),
        10_000,
    );
    team.finance = 5_000_000;
    team
}

fn make_league(competition: &str, tier: u8, team_ids: &[&str]) -> League {
    let ids: Vec<String> = team_ids.iter().map(|id| id.to_string()).collect();
    let mut league = League::new(
        format!("league-{competition}"),
        competition.to_string(),
        2027,
        &ids,
        Some(competition.to_string()),
    );
    league.tier = tier;
    league
}

/// A world on the 1st of a month with a tier-1 club, a tier-2 club, a historical
/// roster club no league schedules and an academy sub-team of the tier-1 club.
fn make_world() -> Game {
    let clock = GameClock::new(Utc.with_ymd_and_hms(2027, 3, 1, 12, 0, 0).unwrap());
    let mut manager = Manager::new(
        "mgr".to_string(),
        "Test".to_string(),
        "Manager".to_string(),
        "1980-01-01".to_string(),
        "GB".to_string(),
    );
    manager.hire("top".to_string());
    let mut academy = make_team("top-academy");
    academy.team_kind = TeamKind::Academy;
    academy.parent_team_id = Some("top".to_string());
    let teams = vec![
        make_team("top"),
        make_team("second"),
        make_team("historic"),
        academy,
    ];
    let mut game = Game::new(clock, manager, teams, vec![], vec![], vec![]);
    game.leagues = vec![
        make_league("first-division", 1, &["top", "top-academy"]),
        make_league("second-division", 2, &["second"]),
    ];
    game
}

fn team<'a>(game: &'a Game, id: &str) -> &'a Team {
    game.teams.iter().find(|team| team.id == id).expect("team")
}

fn team_mut<'a>(game: &'a mut Game, id: &str) -> &'a mut Team {
    game.teams
        .iter_mut()
        .find(|team| team.id == id)
        .expect("team")
}

fn sponsorship_income(game: &Game, id: &str) -> i64 {
    team(game, id)
        .financial_ledger
        .iter()
        .filter(|entry| entry.kind == FinancialTransactionKind::Sponsorship)
        .map(|entry| entry.amount)
        .sum()
}

// The tier values are checked at compile time: a tier-2 deal pays something and a
// tier-1 deal never pays less.
const _: () = assert!(TIER_2_SPONSORSHIP_VALUE > 0);
const _: () = assert!(TIER_1_SPONSORSHIP_VALUE >= TIER_2_SPONSORSHIP_VALUE);

#[test]
fn tier_three_and_untiered_leagues_use_the_second_tier_value() {
    assert_eq!(tier_sponsorship_value(1), TIER_1_SPONSORSHIP_VALUE);
    for tier in [0, 2, 3, 4] {
        assert_eq!(tier_sponsorship_value(tier), TIER_2_SPONSORSHIP_VALUE);
    }
}

#[test]
fn scheduled_main_clubs_are_found_with_their_league_tier() {
    let game = make_world();

    let tiers = scheduled_main_club_tiers(&game);

    assert_eq!(tiers.get("top"), Some(&1));
    assert_eq!(tiers.get("second"), Some(&2));
    assert!(!tiers.contains_key("historic"), "no league schedules it");
    assert!(
        !tiers.contains_key("top-academy"),
        "academy sub-teams are not main clubs"
    );
}

#[test]
fn a_world_build_gives_scheduled_main_clubs_their_tier_deal_and_nobody_else() {
    let mut game = make_world();

    let assigned = assign_missing_tier_sponsorships(&mut game);

    assert_eq!(assigned, 2);
    let top = team(&game, "top")
        .sponsorship
        .as_ref()
        .expect("tier 1 deal");
    assert_eq!(top.base_value, TIER_1_SPONSORSHIP_VALUE);
    assert_eq!(top.remaining_months, TIER_SPONSORSHIP_MONTHS);
    assert!(top.bonus_criteria.is_empty());
    let second = team(&game, "second")
        .sponsorship
        .as_ref()
        .expect("tier 2 deal");
    assert_eq!(second.base_value, TIER_2_SPONSORSHIP_VALUE);
    assert!(team(&game, "historic").sponsorship.is_none());
    assert!(team(&game, "top-academy").sponsorship.is_none());
}

#[test]
fn assigning_leaves_an_existing_deal_alone() {
    let mut game = make_world();
    let existing = Sponsorship {
        sponsor_name: "Existing Sponsor".to_string(),
        base_value: 123_000,
        remaining_months: 2,
        bonus_criteria: vec![],
    };
    team_mut(&mut game, "top").sponsorship = Some(existing.clone());

    assign_missing_tier_sponsorships(&mut game);

    assert_eq!(team(&game, "top").sponsorship, Some(existing));
}

#[test]
fn the_sponsor_name_is_the_same_on_every_call() {
    assert_eq!(tier_sponsor_name("top"), tier_sponsor_name("top"));
    assert_eq!(tier_sponsorship("top", 1), tier_sponsorship("top", 1));
}

#[test]
fn the_paid_amount_is_the_tier_value_for_every_sponsor_name() {
    // Every name the generator can pick, found by trying many club ids.
    let mut names = std::collections::BTreeSet::new();
    for index in 0..500 {
        names.insert(tier_sponsor_name(&format!("club-{index}")));
    }
    assert!(names.len() > 1, "the generator uses several names");

    for name in names {
        for tier in [1, 2] {
            let mut deal = tier_sponsorship("any", tier);
            deal.sponsor_name = name.to_string();
            assert_eq!(
                finances::calc_sponsorship_income(None, &[], &deal),
                tier_sponsorship_value(tier),
                "{name} must not change what a tier {tier} deal pays"
            );
        }
    }
}

#[test]
fn the_monthly_step_pays_a_tier_deal_a_twelfth_of_its_value() {
    let mut game = make_world();
    assign_missing_tier_sponsorships(&mut game);

    finances::process_monthly_finances(&mut game);

    assert_eq!(
        sponsorship_income(&game, "top"),
        (TIER_1_SPONSORSHIP_VALUE as f64 / 12.0).round() as i64
    );
    assert_eq!(
        sponsorship_income(&game, "second"),
        (TIER_2_SPONSORSHIP_VALUE as f64 / 12.0).round() as i64
    );
    assert_eq!(
        team(&game, "top")
            .sponsorship
            .as_ref()
            .unwrap()
            .remaining_months,
        11
    );
}

#[test]
fn a_deal_that_ends_is_renewed_at_the_clubs_current_tier_the_same_month() {
    let mut game = make_world();
    // The club holds a last-month tier-2 deal but has since been promoted to tier 1.
    team_mut(&mut game, "top").sponsorship = Some(Sponsorship {
        remaining_months: 1,
        ..tier_sponsorship("top", 2)
    });

    finances::process_monthly_finances(&mut game);

    let renewed = team(&game, "top")
        .sponsorship
        .as_ref()
        .expect("a renewed deal");
    assert_eq!(renewed.base_value, TIER_1_SPONSORSHIP_VALUE);
    assert_eq!(renewed.remaining_months, TIER_SPONSORSHIP_MONTHS);
}

#[test]
fn the_last_month_of_a_deal_is_still_paid() {
    let mut game = make_world();
    team_mut(&mut game, "second").sponsorship = Some(Sponsorship {
        remaining_months: 1,
        ..tier_sponsorship("second", 2)
    });

    finances::process_monthly_finances(&mut game);

    assert_eq!(
        sponsorship_income(&game, "second"),
        (TIER_2_SPONSORSHIP_VALUE as f64 / 12.0).round() as i64
    );
}

#[test]
fn a_club_with_no_deal_gets_one_on_the_first_and_is_paid_that_month() {
    let mut game = make_world();
    assert!(team(&game, "second").sponsorship.is_none());

    finances::process_monthly_finances(&mut game);

    let deal = team(&game, "second")
        .sponsorship
        .as_ref()
        .expect("a new deal");
    assert_eq!(deal.base_value, TIER_2_SPONSORSHIP_VALUE);
    assert_eq!(deal.remaining_months, TIER_SPONSORSHIP_MONTHS - 1);
    assert_eq!(
        sponsorship_income(&game, "second"),
        (TIER_2_SPONSORSHIP_VALUE as f64 / 12.0).round() as i64
    );
}

#[test]
fn clubs_no_league_schedules_and_academy_teams_never_get_a_deal() {
    let mut game = make_world();

    finances::process_monthly_finances(&mut game);

    assert!(team(&game, "historic").sponsorship.is_none());
    assert!(team(&game, "top-academy").sponsorship.is_none());
    assert_eq!(sponsorship_income(&game, "historic"), 0);
}

fn deal_worth(base_value: i64) -> Sponsorship {
    Sponsorship {
        sponsor_name: "Current".to_string(),
        base_value,
        remaining_months: 6,
        bonus_criteria: vec![],
    }
}

#[test]
fn a_random_offer_below_the_current_deal_is_not_generated() {
    assert!(!sponsor_offer_improves_on(
        Some(&deal_worth(1_000_000)),
        624_000
    ));
}

#[test]
fn a_random_offer_equal_to_the_current_deal_is_not_generated() {
    assert!(!sponsor_offer_improves_on(
        Some(&deal_worth(1_000_000)),
        1_000_000
    ));
}

#[test]
fn a_random_offer_above_the_current_deal_is_generated() {
    assert!(sponsor_offer_improves_on(
        Some(&deal_worth(1_000_000)),
        1_040_000
    ));
}

#[test]
fn any_random_offer_is_generated_when_the_club_has_no_deal() {
    assert!(sponsor_offer_improves_on(None, 624_000));
}
