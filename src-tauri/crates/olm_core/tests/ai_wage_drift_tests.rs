//! Characterization of the two AI paths that grow a tier-1 club's wage bill through a
//! season (measured by `world_wage_drift_measure`): the daily free-agent signing that tops
//! a roster up to seven players without releasing anyone
//! (`transfers::simulate_ai_free_agent_signings`), and the renewal at the player's expected
//! wage. Both are bounded by the board's wage policy (110% of the wage budget), so the drift
//! is a design outcome of a data wage budget that is larger than the five-man build-time
//! roster's bill, not a runaway.

use chrono::{TimeZone, Utc};
use olm_core::ai_renewals::conclude_ai_renewals;
use olm_core::clock::GameClock;
use olm_core::contract_wage_policy::annual_team_wage_bill;
use olm_core::contracts::expected_wage;
use olm_core::domain::league::League;
use olm_core::domain::manager::Manager;
use olm_core::domain::player::{
    ContractRenewalState, LolRole, Player, PlayerAttributes, RenewalSessionStatus,
};
use olm_core::domain::season::TransferWindowStatus;
use olm_core::domain::team::Team;
use olm_core::game::Game;
use olm_core::transfers::generate_incoming_transfer_offers;

const ROLES: [LolRole; 5] = [
    LolRole::Top,
    LolRole::Jungle,
    LolRole::Mid,
    LolRole::Adc,
    LolRole::Support,
];
const CLUB: &str = "elite";

fn club(wage_budget: i64) -> Team {
    let mut team = Team::new(
        CLUB.to_string(),
        "Elite Esports".to_string(),
        "ELI".to_string(),
        "ES".to_string(),
        "City".to_string(),
        "Arena".to_string(),
        10_000,
    );
    team.finance = 10_000_000;
    team.transfer_budget = 5_000_000;
    team.wage_budget = wage_budget;
    team.reputation = 900;
    team.competition_id = Some("lec".to_string());
    team
}

fn player(id: &str, team_id: Option<&str>, role: LolRole, wage: u32, value: u64) -> Player {
    let ovr = 75;
    let attrs = PlayerAttributes {
        mechanics: ovr,
        laning: ovr,
        teamfighting: ovr,
        macro_play: ovr,
        consistency: ovr,
        shotcalling: ovr,
        champion_pool: ovr,
        discipline: ovr,
        mental_resilience: ovr,
    };
    let mut player = Player::new(
        id.to_string(),
        id.to_string(),
        id.to_string(),
        "2002-01-01".to_string(),
        "ES".to_string(),
        role,
        attrs,
    );
    player.team_id = team_id.map(str::to_string);
    player.contract_end = team_id.map(|_| "2028-11-30".to_string());
    player.wage = wage;
    player.market_value = value;
    player.condition = 100;
    player.lol_ovr = ovr;
    player
}

/// One AI tier-1 club with a five-man roster (one player per role, the build-time shape
/// of a tier-1 club), three free agents on the market, the user's own club elsewhere and
/// the transfer window open.
fn world(wage_budget: i64) -> Game {
    let mut manager = Manager::new(
        "m".to_string(),
        "T".to_string(),
        "M".to_string(),
        "1985-01-01".to_string(),
        "ES".to_string(),
    );
    manager.hire("user".to_string());
    let mut user = club(5_000_000);
    user.id = "user".to_string();
    user.manager_id = Some("m".to_string());
    user.competition_id = Some("lcs".to_string());
    let mut players: Vec<Player> = ROLES
        .iter()
        .enumerate()
        .map(|(i, role)| player(&format!("p{i}"), Some(CLUB), *role, 300_000, 400_000))
        .collect();
    for (i, role) in [LolRole::Top, LolRole::Jungle, LolRole::Mid]
        .iter()
        .enumerate()
    {
        players.push(player(&format!("fa{i}"), None, *role, 0, 200_000));
    }
    let mut game = Game::new(
        GameClock::new(Utc.with_ymd_and_hms(2026, 3, 16, 12, 0, 0).unwrap()),
        manager,
        vec![club(wage_budget), user],
        players,
        vec![],
        vec![],
    );
    let mut league = League::new(
        "league-lec".to_string(),
        "LEC".to_string(),
        2026,
        &[CLUB.to_string()],
        Some("lec".to_string()),
    );
    league.tier = 1;
    game.leagues = vec![league];
    game.season_context.transfer_window.status = TransferWindowStatus::Open;
    game
}

fn roster(game: &Game) -> usize {
    game.players
        .iter()
        .filter(|p| p.team_id.as_deref() == Some(CLUB))
        .count()
}

/// Runs the daily market step a few times, as consecutive days would.
fn run_market(game: &mut Game) {
    for _ in 0..6 {
        game.ai_transfer_cap_counts.clear();
        generate_incoming_transfer_offers(game);
    }
}

#[test]
fn a_five_man_tier_one_club_fills_its_bench_to_seven_without_releasing_anyone() {
    let mut game = world(2_700_000);
    let bill_before = annual_team_wage_bill(&game, CLUB);

    run_market(&mut game);

    assert_eq!(roster(&game), 7, "the club stops at seven players");
    for id in ["p0", "p1", "p2", "p3", "p4"] {
        let kept = game.players.iter().find(|p| p.id == id).unwrap();
        assert_eq!(kept.team_id.as_deref(), Some(CLUB), "{id} is not released");
    }
    let signed_wages: i64 = game
        .players
        .iter()
        .filter(|p| p.id.starts_with("fa") && p.team_id.as_deref() == Some(CLUB))
        .map(|p| i64::from(p.wage))
        .sum();
    assert_eq!(
        annual_team_wage_bill(&game, CLUB),
        bill_before + signed_wages,
        "the whole wage of both signings is added to the bill"
    );
    assert_eq!(
        game.players
            .iter()
            .filter(|p| p.id.starts_with("fa") && p.team_id.is_none())
            .count(),
        1,
        "the third free agent stays on the market"
    );
}

#[test]
fn a_bench_signing_costs_the_free_agents_expected_wage_about_a_starters() {
    let mut game = world(2_700_000);
    let today = game.clock.current_date.date_naive();
    let team = game.teams[0].clone();
    let free_agent = game.players.iter().find(|p| p.id == "fa0").unwrap().clone();
    let expected = expected_wage(&free_agent, &team, today);

    run_market(&mut game);

    let signed = game.players.iter().find(|p| p.id == "fa0").unwrap();
    assert_eq!(signed.team_id.as_deref(), Some(CLUB));
    assert_eq!(signed.wage, expected);
    assert!(
        signed.wage >= 250_000,
        "a 200k-value free agent costs about the 300k a starter earns, got {}",
        signed.wage
    );
}

#[test]
fn a_club_whose_bill_has_no_room_under_the_soft_cap_signs_nobody() {
    // Bill 1.5M against a 1.3M budget: over budget, so only the small legacy grace is left.
    let mut game = world(1_300_000);
    let bill_before = annual_team_wage_bill(&game, CLUB);

    run_market(&mut game);

    assert_eq!(roster(&game), 5);
    assert_eq!(annual_team_wage_bill(&game, CLUB), bill_before);
}

#[test]
fn the_free_agent_top_up_never_lifts_the_bill_past_110_percent_of_the_wage_budget() {
    for budget in [1_700_000_i64, 1_900_000, 2_100_000, 2_700_000] {
        let mut game = world(budget);
        run_market(&mut game);
        let bill = annual_team_wage_bill(&game, CLUB);
        assert!(
            bill <= budget * 110 / 100,
            "budget {budget}: the top-up led to a bill of {bill}"
        );
    }
}

#[test]
fn an_ai_renewal_pays_the_expected_wage_a_raise_of_about_a_fifth() {
    let mut game = world(2_700_000);
    game.players.retain(|p| !p.id.starts_with("fa"));
    {
        let renewing = game.players.iter_mut().find(|p| p.id == "p0").unwrap();
        renewing.contract_end = Some("2026-04-05".to_string());
        renewing.morale_core.renewal_state = Some(ContractRenewalState {
            status: RenewalSessionStatus::Open,
            ..ContractRenewalState::default()
        });
    }
    let today = game.clock.current_date.date_naive();
    let team = game.teams[0].clone();
    let before = game.players.iter().find(|p| p.id == "p0").unwrap().clone();
    let expected = expected_wage(&before, &team, today);

    conclude_ai_renewals(&mut game);

    let after = game.players.iter().find(|p| p.id == "p0").unwrap();
    assert_eq!(after.wage, expected, "the renewal pays the expected wage");
    let ratio = f64::from(after.wage) / f64::from(before.wage);
    assert!(
        (1.10..=1.30).contains(&ratio),
        "a 24-year-old in his final weeks gets a raise of about 15-25%, got x{ratio:.2}"
    );
    assert_ne!(
        after.contract_end, before.contract_end,
        "the contract is extended"
    );
}
