use chrono::{TimeZone, Utc};
use olm_core::clock::GameClock;
use olm_core::domain::manager::Manager;
use olm_core::domain::message::MessageCategory;
use olm_core::domain::news::{NewsArticle, NewsCategory};
use olm_core::domain::player::{
    Player, PlayerAttributes, PlayerIssueCategory, TransferOffer, TransferOfferStatus,
    WageNegotiationStatus,
};
use olm_core::domain::season::TransferWindowStatus;
use olm_core::domain::stats::LolRole;
use olm_core::domain::team::{FinancialTransactionKind, Team, TeamKind};
use olm_core::game::Game;
use olm_core::transfers::{
    TransferDestination, TransferNegotiationDecision, ai_agent_purchase, counter_offer,
    generate_incoming_transfer_offers, get_transfer_history, make_transfer_bid,
    negotiate_player_wage, project_transfer_bid_financial_impact, release_player_contract,
    respond_to_offer,
};

fn default_attrs() -> PlayerAttributes {
    PlayerAttributes {
        mental_resilience: 60,
        champion_pool: 60,
        laning: 60,
        mechanics: 60,
        macro_play: 60,
        consistency: 60,
        discipline: 60,
        teamfighting: 60,
        shotcalling: 60,
    }
}

fn make_player(id: &str) -> Player {
    let mut player = Player::new(
        id.to_string(),
        format!("{}. Test", id),
        format!("{} Test", id),
        "2000-01-01".to_string(),
        "England".to_string(),
        LolRole::Adc,
        default_attrs(),
    );
    player.team_id = Some("team-2".to_string());
    player.contract_end = Some("2028-06-30".to_string());
    player.market_value = 1_000_000;
    player.morale = 70;
    player
}

fn make_user_player(id: &str) -> Player {
    let mut player = make_player(id);
    player.team_id = Some("team-1".to_string());
    player
}

fn make_player_with_position(
    id: &str,
    role: LolRole,
    team_id: Option<&str>,
    market_value: u64,
) -> Player {
    let mut player = Player::new(
        id.to_string(),
        format!("{}. Test", id),
        format!("{} Test", id),
        "2000-01-01".to_string(),
        "England".to_string(),
        role,
        default_attrs(),
    );
    player.team_id = team_id.map(|team| team.to_string());
    player.contract_end = Some("2028-06-30".to_string());
    player.market_value = market_value;
    player.morale = 70;
    player
}

fn make_pending_incoming_offer(id: &str, fee: u64) -> TransferOffer {
    TransferOffer {
        id: id.to_string(),
        from_team_id: "team-2".to_string(),
        destination_team_id: None,
        fee,
        wage_offered: 0,
        last_manager_fee: None,
        negotiation_round: 1,
        suggested_counter_fee: None,
        players_included: vec![],
        status: TransferOfferStatus::Pending,
        date: "2026-08-01".to_string(),
        wage_negotiation_status: WageNegotiationStatus::NotStarted,
        contract_years_offered: 0,
        suggested_counter_wage: None,
        suggested_counter_years: None,
        wage_negotiation_round: 0,
    }
}

fn make_user_team(finance: i64, transfer_budget: i64) -> Team {
    let mut team = Team::new(
        "team-1".to_string(),
        "User FC".to_string(),
        "USR".to_string(),
        "England".to_string(),
        "London".to_string(),
        "User Ground".to_string(),
        25_000,
    );
    team.finance = finance;
    team.transfer_budget = transfer_budget;
    team.manager_id = Some("manager-1".to_string());
    team
}

fn make_seller_team(starting_xi_ids: Vec<String>) -> Team {
    let mut team = Team::new(
        "team-2".to_string(),
        "Seller FC".to_string(),
        "SEL".to_string(),
        "England".to_string(),
        "Liverpool".to_string(),
        "Seller Ground".to_string(),
        28_000,
    );
    // A club with no lineup at all ranks its players by OVR, so a "not in the lineup"
    // seller gets a lineup that lists somebody else.
    team.active_lineup_ids = if starting_xi_ids.is_empty() {
        vec!["seller-lineup-placeholder".to_string()]
    } else {
        starting_xi_ids
    };
    team
}

fn make_game_with_player(
    player: Player,
    seller_starting_xi_ids: Vec<String>,
    user_finance: i64,
    user_transfer_budget: i64,
) -> Game {
    let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 8, 1, 12, 0, 0).unwrap());

    let mut manager = Manager::new(
        "manager-1".to_string(),
        "Jane".to_string(),
        "Doe".to_string(),
        "1980-01-01".to_string(),
        "England".to_string(),
    );
    manager.hire("team-1".to_string());

    let mut game = Game::new(
        clock,
        manager,
        vec![
            make_user_team(user_finance, user_transfer_budget),
            make_seller_team(seller_starting_xi_ids),
        ],
        vec![player],
        vec![],
        vec![],
    );
    game.season_context.transfer_window.status = TransferWindowStatus::Open;
    game
}

fn complete_accepted_transfer(game: &mut Game, player_id: &str) {
    let offer_id = game
        .players
        .iter()
        .find(|player| player.id == player_id)
        .and_then(|player| {
            player
                .transfer_offers
                .iter()
                .find(|offer| offer.status == TransferOfferStatus::Accepted)
                .map(|offer| offer.id.clone())
        })
        .expect("accepted offer should exist");

    negotiate_player_wage(game, player_id, &offer_id, 200_000, 3)
        .expect("accepted transfer should complete after wage agreement");
}

#[test]
fn incoming_transfer_offers_do_not_arrive_when_window_is_closed() {
    let mut player = make_user_player("player-window-closed");
    player.contract_end = Some("2026-09-01".to_string());
    player.market_value = 1_200_000;

    let mut game = make_game_with_player(player, vec![], 5_000_000, 2_000_000);
    game.season_context.transfer_window.status = TransferWindowStatus::Closed;
    game.teams[1].finance = 6_000_000;
    game.teams[1].transfer_budget = 3_000_000;

    generate_incoming_transfer_offers(&mut game);

    let player = game
        .players
        .iter()
        .find(|player| player.id == "player-window-closed")
        .unwrap();
    assert!(player.transfer_offers.is_empty());
    assert!(game.messages.is_empty());
}

#[test]
fn transfer_bid_is_rejected_when_window_is_closed() {
    let player = make_player("player-bid-closed");
    let mut game = make_game_with_player(player, vec![], 5_000_000, 2_000_000);
    game.season_context.transfer_window.status = TransferWindowStatus::Closed;

    let error = make_transfer_bid(
        &mut game,
        "player-bid-closed",
        1_000_000,
        TransferDestination::Main,
        &[],
    )
    .expect_err("closed transfer window should reject bids");

    assert_eq!(error, "Transfer window is closed");
}

#[test]
fn over_budget_transfer_bid_is_rejected() {
    let player = make_player("player-over-budget");
    let mut game = make_game_with_player(player, vec![], 5_000_000, 500_000);

    let error = make_transfer_bid(
        &mut game,
        "player-over-budget",
        750_000,
        TransferDestination::Main,
        &[],
    )
    .expect_err("bid above transfer budget should be rejected");

    assert_eq!(error, "Transfer budget too low");
}

#[test]
fn expiring_contract_lowers_resistance_to_sale() {
    let mut player = make_player("player-expiring");
    player.contract_end = Some("2026-08-31".to_string());

    let mut game = make_game_with_player(player, vec![], 5_000_000, 2_000_000);

    let result = make_transfer_bid(
        &mut game,
        "player-expiring",
        1_000_000,
        TransferDestination::Main,
        &[],
    )
    .expect("bid should be evaluated");

    assert_eq!(result.decision, TransferNegotiationDecision::Accepted);
    complete_accepted_transfer(&mut game, "player-expiring");
    assert_eq!(
        game.players
            .iter()
            .find(|player| player.id == "player-expiring")
            .and_then(|player| player.team_id.as_deref()),
        Some("team-1")
    );
}

#[test]
fn accepted_transfer_bid_can_assign_player_to_academy_and_charge_parent_club() {
    let mut player = make_player("player-academy-destination");
    player.contract_end = Some("2026-08-31".to_string());
    player.transfer_listed = true;

    let mut game = make_game_with_player(player, vec![], 5_000_000, 2_000_000);
    game.teams[0].academy_team_id = Some("team-academy".to_string());

    let mut academy = Team::new(
        "team-academy".to_string(),
        "User Academy".to_string(),
        "UAC".to_string(),
        "England".to_string(),
        "London".to_string(),
        "Academy Ground".to_string(),
        5_000,
    );
    academy.team_kind = TeamKind::Academy;
    academy.parent_team_id = Some("team-1".to_string());
    academy.finance = 100_000;
    academy.transfer_budget = 100_000;
    game.teams.push(academy);

    let academy_finance_before = game
        .teams
        .iter()
        .find(|team| team.id == "team-academy")
        .map(|team| team.finance)
        .unwrap();

    let result = make_transfer_bid(
        &mut game,
        "player-academy-destination",
        1_000_000,
        TransferDestination::Academy,
        &[],
    )
    .expect("academy destination bid should be evaluated");

    assert_eq!(result.decision, TransferNegotiationDecision::Accepted);
    complete_accepted_transfer(&mut game, "player-academy-destination");
    let player = game
        .players
        .iter()
        .find(|player| player.id == "player-academy-destination")
        .unwrap();
    assert_eq!(player.team_id.as_deref(), Some("team-academy"));
    assert_eq!(
        player.transfer_offers[0].destination_team_id.as_deref(),
        Some("team-academy")
    );
    assert_eq!(game.teams[0].finance, 4_000_000);
    assert_eq!(game.teams[0].transfer_budget, 1_000_000);
    assert_eq!(
        game.teams
            .iter()
            .find(|team| team.id == "team-academy")
            .map(|team| team.finance),
        Some(academy_finance_before)
    );
}

#[test]
fn key_player_is_harder_to_buy_than_fringe_player() {
    let mut star = make_player("player-star");
    star.attributes.laning = 88;
    star.attributes.mechanics = 86;

    let mut star_game =
        make_game_with_player(star, vec!["player-star".to_string()], 5_000_000, 2_000_000);
    let star_result = make_transfer_bid(
        &mut star_game,
        "player-star",
        1_250_000,
        TransferDestination::Main,
        &[],
    )
    .expect("star bid");

    let fringe = make_player("player-fringe");
    let mut fringe_game = make_game_with_player(fringe, vec![], 5_000_000, 2_000_000);
    let fringe_result = make_transfer_bid(
        &mut fringe_game,
        "player-fringe",
        1_250_000,
        TransferDestination::Main,
        &[],
    )
    .expect("fringe bid");

    assert_eq!(
        star_result.decision,
        TransferNegotiationDecision::CounterOffer
    );
    assert!(star_result.suggested_fee.is_some());
    assert_eq!(
        fringe_result.decision,
        TransferNegotiationDecision::Accepted
    );
}

#[test]
fn repeated_bid_advances_transfer_negotiation_round() {
    let mut player = make_player("player-repeat-bid");
    player.morale = 35;
    player.stats.appearances = 1;
    let mut game = make_game_with_player(player, vec![], 5_000_000, 2_000_000);
    game.teams[0].reputation = 700;
    game.teams[1].reputation = 350;

    let first_result = make_transfer_bid(
        &mut game,
        "player-repeat-bid",
        900_000,
        TransferDestination::Main,
        &[],
    )
    .expect("first bid");

    assert_eq!(
        first_result.decision,
        TransferNegotiationDecision::CounterOffer
    );
    assert_eq!(first_result.feedback.round, 1);
    assert_eq!(first_result.suggested_fee, Some(950_000));

    let second_result = make_transfer_bid(
        &mut game,
        "player-repeat-bid",
        950_000,
        TransferDestination::Main,
        &[],
    )
    .expect("second bid");

    assert_eq!(
        second_result.decision,
        TransferNegotiationDecision::Accepted
    );
    complete_accepted_transfer(&mut game, "player-repeat-bid");
    assert_eq!(second_result.feedback.round, 2);
    assert_eq!(
        game.players
            .iter()
            .find(|player| player.id == "player-repeat-bid")
            .and_then(|player| player.team_id.as_deref()),
        Some("team-1")
    );
}

#[test]
fn stale_outgoing_transfer_negotiation_is_withdrawn_before_new_bid() {
    let mut player = make_player("player-stale-bid");
    player.morale = 35;
    player.stats.appearances = 1;
    player.transfer_offers.push(TransferOffer {
        id: "offer-stale".to_string(),
        from_team_id: "team-1".to_string(),
        destination_team_id: None,
        fee: 1_000_000,
        wage_offered: 0,
        last_manager_fee: None,
        negotiation_round: 1,
        suggested_counter_fee: None,
        players_included: vec![],
        status: TransferOfferStatus::Pending,
        date: "2026-07-01".to_string(),
        wage_negotiation_status: WageNegotiationStatus::NotStarted,
        contract_years_offered: 0,
        suggested_counter_wage: None,
        suggested_counter_years: None,
        wage_negotiation_round: 0,
    });

    let mut game = make_game_with_player(player, vec![], 5_000_000, 2_000_000);
    game.teams[0].reputation = 700;
    game.teams[1].reputation = 350;

    let result = make_transfer_bid(
        &mut game,
        "player-stale-bid",
        900_000,
        TransferDestination::Main,
        &[],
    )
    .expect("new bid");

    assert_eq!(result.decision, TransferNegotiationDecision::CounterOffer);
    assert_eq!(result.feedback.round, 1);

    let player = game
        .players
        .iter()
        .find(|player| player.id == "player-stale-bid")
        .expect("player present");
    assert!(player.transfer_offers.iter().any(|offer| {
        offer.id == "offer-stale" && offer.status == TransferOfferStatus::Withdrawn
    }));
    assert!(player.transfer_offers.iter().any(|offer| {
        offer.id != "offer-stale"
            && offer.from_team_id == "team-1"
            && offer.status == TransferOfferStatus::Pending
            && offer.negotiation_round == 1
    }));
}

#[test]
fn club_to_club_transfer_records_non_zero_wage_and_realistic_term() {
    let mut player = make_user_player("player-c2c-terms");
    player.wage = 100_000;
    player.contract_end = Some("2028-06-30".to_string());
    player
        .transfer_offers
        .push(make_pending_incoming_offer("offer-c2c-terms", 950_000));

    let mut game = make_game_with_player(player, vec![], 5_000_000, 2_000_000);
    game.teams[1].finance = 6_000_000;
    game.teams[1].transfer_budget = 3_000_000;

    respond_to_offer(&mut game, "player-c2c-terms", "offer-c2c-terms", true)
        .expect("accepting a pending offer should execute transfer");

    let player = game
        .players
        .iter()
        .find(|player| player.id == "player-c2c-terms")
        .unwrap();
    assert_eq!(player.team_id.as_deref(), Some("team-2"));
    assert!(
        player.wage > 0,
        "transferred player wage should be non-zero"
    );

    let entry = get_transfer_history(&game)
        .into_iter()
        .find(|entry| entry.player_id == "player-c2c-terms")
        .expect("history should contain the transfer");
    assert!(
        entry.annual_wage > 0,
        "history annual_wage should be non-zero, got {}",
        entry.annual_wage
    );
    assert!(
        (1..=5).contains(&entry.contract_years),
        "history contract_years should be realistic, got {}",
        entry.contract_years
    );
    assert_eq!(
        player.wage, entry.annual_wage,
        "player wage must match history annual_wage"
    );
    assert!(
        player
            .contract_end
            .as_ref()
            .is_some_and(|contract_end| contract_end
                .starts_with(&(2026 + i32::from(entry.contract_years)).to_string())),
        "player contract_end must match history contract_years"
    );
}

#[test]
fn generates_pending_incoming_offer_for_contract_risk_player() {
    let mut player = make_user_player("player-contract-risk");
    player.contract_end = Some("2026-09-01".to_string());
    player.market_value = 1_200_000;

    let mut game = make_game_with_player(player, vec![], 5_000_000, 2_000_000);
    game.teams[1].finance = 6_000_000;
    game.teams[1].transfer_budget = 3_000_000;

    generate_incoming_transfer_offers(&mut game);

    let player = game
        .players
        .iter()
        .find(|player| player.id == "player-contract-risk")
        .unwrap();

    assert_eq!(player.transfer_offers.len(), 1);
    assert_eq!(
        player.transfer_offers[0].status,
        TransferOfferStatus::Pending
    );
    assert_eq!(player.transfer_offers[0].from_team_id, "team-2");
    assert_eq!(player.team_id.as_deref(), Some("team-1"));
    assert!(game.messages.iter().any(|message| {
        message.category == MessageCategory::Transfer
            && message.context.player_id.as_deref() == Some("player-contract-risk")
    }));
}

#[test]
fn does_not_duplicate_pending_incoming_offer_from_same_club() {
    let mut player = make_user_player("player-duplicate");
    player.contract_end = Some("2026-09-01".to_string());
    player.transfer_offers.push(TransferOffer {
        id: "offer-stale".to_string(),
        from_team_id: "team-2".to_string(),
        destination_team_id: None,
        fee: 900_000,
        wage_offered: 0,
        last_manager_fee: None,
        negotiation_round: 1,
        suggested_counter_fee: None,
        players_included: vec![],
        status: TransferOfferStatus::Pending,
        date: "2026-07-25".to_string(),
        wage_negotiation_status: WageNegotiationStatus::NotStarted,
        contract_years_offered: 0,
        suggested_counter_wage: None,
        suggested_counter_years: None,
        wage_negotiation_round: 0,
    });

    let mut game = make_game_with_player(player, vec![], 5_000_000, 2_000_000);
    game.teams[1].finance = 6_000_000;
    game.teams[1].transfer_budget = 3_000_000;

    generate_incoming_transfer_offers(&mut game);

    let player = game
        .players
        .iter()
        .find(|player| player.id == "player-duplicate")
        .unwrap();

    assert_eq!(player.transfer_offers.len(), 1);
    assert_eq!(player.transfer_offers[0].id, "offer-stale");
    assert!(game.messages.is_empty());
}

#[test]
fn incoming_offer_messages_from_multiple_clubs_get_unique_ids() {
    let mut player = make_user_player("player-message-ids");
    player.contract_end = Some("2026-09-01".to_string());
    player.market_value = 1_200_000;

    let mut game = make_game_with_player(player, vec![], 5_000_000, 2_000_000);
    game.teams[1].finance = 6_000_000;
    game.teams[1].transfer_budget = 3_000_000;

    let mut extra_buyer = Team::new(
        "team-3".to_string(),
        "Buyer FC".to_string(),
        "BUY".to_string(),
        "England".to_string(),
        "Manchester".to_string(),
        "Buyer Ground".to_string(),
        30_000,
    );
    extra_buyer.finance = 6_000_000;
    extra_buyer.transfer_budget = 3_000_000;
    game.teams.push(extra_buyer);

    generate_incoming_transfer_offers(&mut game);

    let message_ids: Vec<&str> = game
        .messages
        .iter()
        .map(|message| message.id.as_str())
        .collect();
    let unique_message_ids: std::collections::HashSet<&str> = message_ids.iter().copied().collect();

    assert_eq!(message_ids.len(), 2);
    assert_eq!(unique_message_ids.len(), 2);
}

#[test]
fn contract_risk_player_draws_interest_before_similar_stable_player() {
    let mut risky = make_user_player("player-risky");
    risky.contract_end = Some("2026-09-01".to_string());
    risky.market_value = 1_100_000;

    let mut stable = make_user_player("player-stable");
    stable.contract_end = Some("2028-06-30".to_string());
    stable.market_value = 1_100_000;

    let mut game = make_game_with_player(risky, vec![], 5_000_000, 2_000_000);
    game.players.push(stable);
    game.teams[1].finance = 6_000_000;
    game.teams[1].transfer_budget = 3_000_000;

    generate_incoming_transfer_offers(&mut game);

    let risky = game
        .players
        .iter()
        .find(|player| player.id == "player-risky")
        .unwrap();
    let stable = game
        .players
        .iter()
        .find(|player| player.id == "player-stable")
        .unwrap();

    assert_eq!(risky.transfer_offers.len(), 1);
    assert!(stable.transfer_offers.is_empty());
}

#[test]
fn rejecting_pending_offer_closes_the_negotiation_cleanly() {
    let mut player = make_user_player("player-reject");
    player
        .transfer_offers
        .push(make_pending_incoming_offer("offer-reject", 900_000));

    let mut game = make_game_with_player(player, vec![], 5_000_000, 2_000_000);
    game.teams[1].finance = 6_000_000;
    game.teams[1].transfer_budget = 3_000_000;

    respond_to_offer(&mut game, "player-reject", "offer-reject", false)
        .expect("rejecting a pending offer should succeed");

    let player = game
        .players
        .iter()
        .find(|player| player.id == "player-reject")
        .unwrap();
    assert_eq!(player.team_id.as_deref(), Some("team-1"));
    assert_eq!(player.transfer_offers.len(), 1);
    assert_eq!(
        player.transfer_offers[0].status,
        TransferOfferStatus::Rejected
    );
}

#[test]
fn release_player_contract_records_release_penalty_ledger_entry() {
    let mut player = make_user_player("player-release");
    player.contract_end = Some("2027-08-01".to_string());
    player.wage = 120_000;

    let mut game = make_game_with_player(player, vec![], 5_000_000, 2_000_000);

    let penalty = release_player_contract(&mut game, "player-release").expect("release succeeds");

    let team = game.teams.iter().find(|team| team.id == "team-1").unwrap();
    let released = game
        .players
        .iter()
        .find(|player| player.id == "player-release")
        .unwrap();
    assert_eq!(penalty, 48_000);
    assert_eq!(team.finance, 4_952_000);
    assert_eq!(team.season_expenses, 48_000);
    assert_eq!(team.financial_ledger.len(), 1);
    assert_eq!(
        team.financial_ledger[0].kind,
        FinancialTransactionKind::ReleasePenalty
    );
    assert_eq!(team.financial_ledger[0].amount, -48_000);
    assert_eq!(team.financial_ledger[0].date, "2026-08-01");
    assert_eq!(team.financial_ledger[0].source, "transfer");
    assert_eq!(
        team.financial_ledger[0].source_id.as_deref(),
        Some("player-release")
    );
    assert!(released.team_id.is_none());
    assert_eq!(released.wage, 0);
}

#[test]
fn accepting_pending_offer_executes_transfer_even_for_reluctant_player() {
    let mut player = make_user_player("player-accept-reluctant");
    player.contract_end = Some("2028-06-30".to_string());
    player.morale = 88;
    player.stats.appearances = 28;
    player.transfer_listed = false;
    player.transfer_offers.push(make_pending_incoming_offer(
        "offer-accept-reluctant",
        950_000,
    ));

    let mut game = make_game_with_player(player, vec![], 5_000_000, 2_000_000);
    game.teams[0].reputation = 1200;
    game.teams[1].reputation = 900;
    game.teams[1].finance = 6_000_000;
    game.teams[1].transfer_budget = 3_000_000;

    respond_to_offer(
        &mut game,
        "player-accept-reluctant",
        "offer-accept-reluctant",
        true,
    )
    .expect("accepting a pending offer should execute transfer");

    let player = game
        .players
        .iter()
        .find(|player| player.id == "player-accept-reluctant")
        .unwrap();
    assert_eq!(player.team_id.as_deref(), Some("team-2"));
    assert_eq!(
        player.transfer_offers[0].status,
        TransferOfferStatus::Accepted
    );

    let seller = game.teams.iter().find(|team| team.id == "team-1").unwrap();
    let buyer = game.teams.iter().find(|team| team.id == "team-2").unwrap();
    assert_eq!(seller.finance, 5_950_000);
    assert_eq!(seller.transfer_budget, 2_570_000);
    assert_eq!(seller.financial_ledger.len(), 1);
    assert_eq!(
        seller.financial_ledger[0].kind,
        FinancialTransactionKind::TransferSale
    );
    assert_eq!(seller.financial_ledger[0].amount, 950_000);
    assert_eq!(seller.financial_ledger[0].date, "2026-08-01");
    assert_eq!(seller.financial_ledger[0].source, "transfer");
    assert_eq!(
        seller.financial_ledger[0].source_id.as_deref(),
        Some("player-accept-reluctant")
    );
    assert_eq!(buyer.finance, 5_050_000);
    assert_eq!(buyer.transfer_budget, 2_050_000);
    assert_eq!(buyer.financial_ledger.len(), 1);
    assert_eq!(
        buyer.financial_ledger[0].kind,
        FinancialTransactionKind::TransferPurchase
    );
    assert_eq!(buyer.financial_ledger[0].amount, -950_000);
    assert_eq!(buyer.financial_ledger[0].date, "2026-08-01");
    assert_eq!(buyer.financial_ledger[0].source, "transfer");
    assert_eq!(
        buyer.financial_ledger[0].source_id.as_deref(),
        Some("player-accept-reluctant")
    );
}

#[test]
fn reasonable_counter_offer_is_accepted_and_executes_transfer() {
    let mut player = make_user_player("player-counter-accept");
    player.market_value = 1_000_000;
    player
        .transfer_offers
        .push(make_pending_incoming_offer("offer-counter-accept", 900_000));

    let mut game = make_game_with_player(player, vec![], 5_000_000, 2_000_000);
    game.teams[1].finance = 6_000_000;
    game.teams[1].transfer_budget = 3_000_000;

    let result = counter_offer(
        &mut game,
        "player-counter-accept",
        "offer-counter-accept",
        1_050_000,
        &[],
    )
    .expect("counter offer should be evaluated");

    assert_eq!(result.decision, TransferNegotiationDecision::Accepted);
    complete_accepted_transfer(&mut game, "player-counter-accept");
    let player = game
        .players
        .iter()
        .find(|player| player.id == "player-counter-accept")
        .unwrap();
    assert_eq!(player.team_id.as_deref(), Some("team-2"));
    assert_eq!(
        player.transfer_offers[0].status,
        TransferOfferStatus::Accepted
    );
    assert_eq!(
        game.teams
            .iter()
            .find(|team| team.id == "team-1")
            .unwrap()
            .finance,
        6_050_000
    );
    assert_eq!(
        game.teams
            .iter()
            .find(|team| team.id == "team-2")
            .unwrap()
            .finance,
        4_950_000
    );
}

#[test]
fn excessive_counter_offer_is_rejected_and_closes_the_negotiation() {
    let mut player = make_user_player("player-counter-reject");
    player.market_value = 1_000_000;
    player
        .transfer_offers
        .push(make_pending_incoming_offer("offer-counter-reject", 900_000));

    let mut game = make_game_with_player(player, vec![], 5_000_000, 2_000_000);
    game.teams[1].finance = 6_000_000;
    game.teams[1].transfer_budget = 3_000_000;

    let result = counter_offer(
        &mut game,
        "player-counter-reject",
        "offer-counter-reject",
        1_400_000,
        &[],
    )
    .expect("counter offer should be evaluated");

    assert_eq!(result.decision, TransferNegotiationDecision::Rejected);
    let player = game
        .players
        .iter()
        .find(|player| player.id == "player-counter-reject")
        .unwrap();
    assert_eq!(player.team_id.as_deref(), Some("team-1"));
    assert_eq!(
        player.transfer_offers[0].status,
        TransferOfferStatus::Rejected
    );
    assert_eq!(
        game.teams
            .iter()
            .find(|team| team.id == "team-1")
            .unwrap()
            .finance,
        5_000_000
    );
    assert_eq!(
        game.teams
            .iter()
            .find(|team| team.id == "team-2")
            .unwrap()
            .finance,
        6_000_000
    );
}

#[test]
fn unhappy_player_with_bigger_ambition_gap_is_easier_to_buy() {
    let mut open_player = make_player("player-open");
    open_player.contract_end = Some("2028-06-30".to_string());
    open_player.morale = 35;
    open_player.stats.appearances = 1;

    let mut open_game = make_game_with_player(open_player, vec![], 5_000_000, 2_000_000);
    open_game.teams[0].reputation = 700;
    open_game.teams[1].reputation = 350;
    let open_result = make_transfer_bid(
        &mut open_game,
        "player-open",
        1_050_000,
        TransferDestination::Main,
        &[],
    )
    .expect("open-player bid");

    let mut content_player = make_player("player-content");
    content_player.contract_end = Some("2028-06-30".to_string());
    content_player.morale = 80;
    content_player.stats.appearances = 12;

    let mut content_game = make_game_with_player(content_player, vec![], 5_000_000, 2_000_000);
    content_game.teams[0].reputation = 700;
    content_game.teams[1].reputation = 350;
    let content_result = make_transfer_bid(
        &mut content_game,
        "player-content",
        1_050_000,
        TransferDestination::Main,
        &[],
    )
    .expect("content-player bid");

    assert_eq!(open_result.decision, TransferNegotiationDecision::Accepted);
    assert_eq!(
        content_result.decision,
        TransferNegotiationDecision::Rejected
    );
}

#[test]
fn blocking_open_player_move_reduces_morale_and_creates_contract_issue() {
    let mut player = make_user_player("player-blocked");
    player.contract_end = Some("2028-06-30".to_string());
    player.morale = 42;
    player.stats.appearances = 0;
    player
        .transfer_offers
        .push(make_pending_incoming_offer("offer-blocked", 950_000));

    let mut game = make_game_with_player(player, vec![], 5_000_000, 2_000_000);
    game.teams[0].reputation = 350;
    game.teams[1].reputation = 700;
    game.teams[1].finance = 6_000_000;
    game.teams[1].transfer_budget = 3_000_000;

    respond_to_offer(&mut game, "player-blocked", "offer-blocked", false)
        .expect("rejecting a pending offer should succeed");

    let player = game
        .players
        .iter()
        .find(|player| player.id == "player-blocked")
        .unwrap();
    assert!(player.morale < 42);
    assert_eq!(
        player
            .morale_core
            .unresolved_issue
            .as_ref()
            .map(|issue| issue.category.clone()),
        Some(PlayerIssueCategory::Contract)
    );
}

#[test]
fn selling_key_player_can_reduce_remaining_starters_morale() {
    let mut key_player = make_user_player("player-key-sale");
    key_player
        .transfer_offers
        .push(make_pending_incoming_offer("offer-key-sale", 1_000_000));

    let mut teammate = make_user_player("player-teammate");
    teammate.morale = 75;

    let mut game = make_game_with_player(key_player, vec![], 5_000_000, 2_000_000);
    game.players.push(teammate);
    game.teams[0].active_lineup_ids =
        vec!["player-key-sale".to_string(), "player-teammate".to_string()];
    game.teams[1].finance = 6_000_000;
    game.teams[1].transfer_budget = 3_000_000;

    respond_to_offer(&mut game, "player-key-sale", "offer-key-sale", true)
        .expect("accepting the pending offer should succeed");

    let teammate = game
        .players
        .iter()
        .find(|player| player.id == "player-teammate")
        .unwrap();
    assert!(teammate.morale < 75);
}

#[test]
fn accepted_sale_reconciles_lol_lineup_slots_without_shifting_roles() {
    let mut sold_mid = make_player_with_position("sold-mid", LolRole::Mid, Some("team-1"), 900_000);
    sold_mid
        .transfer_offers
        .push(make_pending_incoming_offer("offer-sold-mid", 1_100_000));

    let mut game = make_game_with_player(sold_mid, vec![], 5_000_000, 2_000_000);
    game.players.extend([
        make_player_with_position("top", LolRole::Top, Some("team-1"), 700_000),
        make_player_with_position("jungle", LolRole::Jungle, Some("team-1"), 700_000),
        make_player_with_position("bench-mid", LolRole::Mid, Some("team-1"), 800_000),
        make_player_with_position("deft", LolRole::Adc, Some("team-1"), 950_000),
        make_player_with_position("trayton", LolRole::Support, Some("team-1"), 650_000),
    ]);
    game.teams[0].active_lineup_ids = vec![
        "top".to_string(),
        "jungle".to_string(),
        "sold-mid".to_string(),
        "deft".to_string(),
        "trayton".to_string(),
    ];
    game.teams[1].finance = 6_000_000;
    game.teams[1].transfer_budget = 3_000_000;

    respond_to_offer(&mut game, "sold-mid", "offer-sold-mid", true)
        .expect("accepting the pending offer should succeed");

    assert_eq!(
        game.teams[0].active_lineup_ids,
        vec![
            "top".to_string(),
            "jungle".to_string(),
            "bench-mid".to_string(),
            "deft".to_string(),
            "trayton".to_string(),
        ]
    );
}

#[test]
fn accepted_major_transfer_generates_news_article() {
    let mut player = make_player("player-news-major");
    player.market_value = 1_400_000;

    let mut game = make_game_with_player(player, vec![], 5_000_000, 2_000_000);

    let result = make_transfer_bid(
        &mut game,
        "player-news-major",
        1_700_000,
        TransferDestination::Main,
        &[],
    )
    .expect("major transfer bid should succeed");

    assert_eq!(result.decision, TransferNegotiationDecision::Accepted);
    complete_accepted_transfer(&mut game, "player-news-major");
    let article = game
        .news
        .iter()
        .find(|article| article.id == "transfer_news_player-news-major_team-2_team-1_2026-08-01")
        .expect("major transfer should create a news article");
    assert_eq!(article.category, NewsCategory::TransferRumour);
    assert_eq!(
        article.team_ids,
        vec!["team-2".to_string(), "team-1".to_string()]
    );
    assert_eq!(article.player_ids, vec!["player-news-major".to_string()]);
}

#[test]
fn smaller_completed_transfer_does_not_generate_news_article() {
    let mut player = make_player("player-news-small");
    player.market_value = 350_000;
    player.transfer_listed = true;

    let mut game = make_game_with_player(player, vec![], 5_000_000, 2_000_000);

    let result = make_transfer_bid(
        &mut game,
        "player-news-small",
        300_000,
        TransferDestination::Main,
        &[],
    )
    .expect("small transfer bid should succeed");

    assert_eq!(result.decision, TransferNegotiationDecision::Accepted);
    complete_accepted_transfer(&mut game, "player-news-small");
    assert!(game.news.is_empty());
}

#[test]
fn completed_transfer_news_is_not_duplicated_when_article_already_exists() {
    let mut player = make_player("player-news-dup");
    player.market_value = 1_400_000;

    let mut game = make_game_with_player(player, vec![], 5_000_000, 2_000_000);
    game.news.push(
        NewsArticle::new(
            "transfer_news_player-news-dup_team-2_team-1_2026-08-01".to_string(),
            "Existing transfer story".to_string(),
            "Existing body".to_string(),
            "League Chronicle".to_string(),
            "2026-08-01".to_string(),
            NewsCategory::TransferRumour,
        )
        .with_teams(vec!["team-2".to_string(), "team-1".to_string()])
        .with_players(vec!["player-news-dup".to_string()]),
    );

    let result = make_transfer_bid(
        &mut game,
        "player-news-dup",
        1_700_000,
        TransferDestination::Main,
        &[],
    )
    .expect("major transfer bid should succeed");

    assert_eq!(result.decision, TransferNegotiationDecision::Accepted);
    complete_accepted_transfer(&mut game, "player-news-dup");
    assert_eq!(
        game.news
            .iter()
            .filter(|article| article.id == "transfer_news_player-news-dup_team-2_team-1_2026-08-01")
            .count(),
        1
    );
}

#[test]
fn academy_sale_replenishes_roster_and_role_coverage() {
    let player = make_player("player-academy-sale");
    let mut game = make_game_with_player(player, vec![], 5_000_000, 2_000_000);
    game.teams[1].team_kind = TeamKind::Academy;

    let result = make_transfer_bid(
        &mut game,
        "player-academy-sale",
        1_500_000,
        TransferDestination::Main,
        &[],
    )
    .expect("academy transfer bid should succeed");

    assert_eq!(result.decision, TransferNegotiationDecision::Accepted);
    complete_accepted_transfer(&mut game, "player-academy-sale");
    assert_eq!(
        game.players
            .iter()
            .find(|player| player.id == "player-academy-sale")
            .and_then(|player| player.team_id.as_deref()),
        Some("team-1")
    );

    let academy_players: Vec<_> = game
        .players
        .iter()
        .filter(|player| player.team_id.as_deref() == Some("team-2"))
        .collect();

    assert!(academy_players.len() >= 5);

    let has_top = academy_players
        .iter()
        .any(|player| matches!(player.natural_position, LolRole::Top));
    let has_jungle = academy_players
        .iter()
        .any(|player| matches!(player.natural_position, LolRole::Jungle));
    let has_mid = academy_players
        .iter()
        .any(|player| matches!(player.natural_position, LolRole::Mid));
    let has_adc = academy_players
        .iter()
        .any(|player| matches!(player.natural_position, LolRole::Adc));
    let has_support = academy_players
        .iter()
        .any(|player| matches!(player.natural_position, LolRole::Support));

    assert!(has_top && has_jungle && has_mid && has_adc && has_support);
}

#[test]
fn academy_sale_routes_fee_to_parent_club_owner() {
    let mut player = make_player("player-academy-owner");
    player.transfer_listed = true;

    let mut game = make_game_with_player(player, vec![], 5_000_000, 2_000_000);
    game.teams[1].team_kind = TeamKind::Academy;
    game.teams[1].parent_team_id = Some("team-parent".to_string());

    let mut parent_club = Team::new(
        "team-parent".to_string(),
        "Parent Club".to_string(),
        "PAR".to_string(),
        "England".to_string(),
        "London".to_string(),
        "Parent Ground".to_string(),
        30_000,
    );
    parent_club.finance = 1_000_000;
    game.teams.push(parent_club);

    let academy_finance_before = game
        .teams
        .iter()
        .find(|team| team.id == "team-2")
        .map(|team| team.finance)
        .unwrap();
    let parent_finance_before = game
        .teams
        .iter()
        .find(|team| team.id == "team-parent")
        .map(|team| team.finance)
        .unwrap();

    let result = make_transfer_bid(
        &mut game,
        "player-academy-owner",
        1_200_000,
        TransferDestination::Main,
        &[],
    )
    .expect("academy transfer should succeed");

    assert_eq!(result.decision, TransferNegotiationDecision::Accepted);
    complete_accepted_transfer(&mut game, "player-academy-owner");
    let academy_finance_after = game
        .teams
        .iter()
        .find(|team| team.id == "team-2")
        .map(|team| team.finance)
        .unwrap();
    let parent_finance_after = game
        .teams
        .iter()
        .find(|team| team.id == "team-parent")
        .map(|team| team.finance)
        .unwrap();

    assert_eq!(academy_finance_after, academy_finance_before);
    assert_eq!(parent_finance_after, parent_finance_before + 1_200_000);
}

#[test]
fn incoming_offers_can_target_players_in_user_academy() {
    let mut academy_team = Team::new(
        "team-academy".to_string(),
        "User Academy".to_string(),
        "UAC".to_string(),
        "England".to_string(),
        "London".to_string(),
        "Academy Ground".to_string(),
        5_000,
    );
    academy_team.team_kind = TeamKind::Academy;
    academy_team.parent_team_id = Some("team-1".to_string());

    let mut academy_player = make_player("player-user-academy");
    academy_player.team_id = Some("team-academy".to_string());
    academy_player.contract_end = Some("2026-09-01".to_string());
    academy_player.market_value = 1_200_000;
    academy_player.transfer_listed = true;

    let mut game = make_game_with_player(academy_player, vec![], 5_000_000, 2_000_000);
    game.clock.current_date = Utc.with_ymd_and_hms(2026, 8, 3, 12, 0, 0).unwrap();
    game.teams.push(academy_team);
    game.teams[1].finance = 6_000_000;
    game.teams[1].transfer_budget = 3_000_000;

    generate_incoming_transfer_offers(&mut game);

    let academy_player = game
        .players
        .iter()
        .find(|player| player.id == "player-user-academy")
        .expect("academy player should exist");

    assert_eq!(academy_player.transfer_offers.len(), 1);
    assert_eq!(academy_player.transfer_offers[0].from_team_id, "team-2");
    assert_eq!(
        academy_player.transfer_offers[0].status,
        TransferOfferStatus::Pending
    );
}

#[test]
fn ai_free_agent_signing_prioritizes_missing_role() {
    let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 8, 1, 12, 0, 0).unwrap());

    let mut manager = Manager::new(
        "manager-1".to_string(),
        "Jane".to_string(),
        "Doe".to_string(),
        "1980-01-01".to_string(),
        "England".to_string(),
    );
    manager.hire("team-1".to_string());

    let mut user_team = make_user_team(5_000_000, 2_000_000);
    user_team.team_kind = TeamKind::Main;

    let mut ai_team = Team::new(
        "team-2".to_string(),
        "AI FC".to_string(),
        "AIF".to_string(),
        "England".to_string(),
        "Manchester".to_string(),
        "AI Ground".to_string(),
        20_000,
    );
    ai_team.team_kind = TeamKind::Main;
    ai_team.finance = 5_000_000;
    ai_team.transfer_budget = 3_000_000;
    // Room for the 1.05M adc (asks about 1.27M on the LEC wage scale) but not for the 1.6M mid.
    ai_team.wage_budget = 2_000_000;

    let players = vec![
        make_player_with_position("ai-top", LolRole::Top, Some("team-2"), 900_000),
        make_player_with_position("ai-jungle", LolRole::Jungle, Some("team-2"), 850_000),
        make_player_with_position("ai-mid", LolRole::Mid, Some("team-2"), 920_000),
        make_player_with_position("ai-support", LolRole::Support, Some("team-2"), 870_000),
        make_player_with_position("fa-mid-premium", LolRole::Mid, None, 1_600_000),
        make_player_with_position("fa-adc-needed", LolRole::Adc, None, 1_050_000),
    ];

    let mut game = Game::new(
        clock,
        manager,
        vec![user_team, ai_team],
        players,
        vec![],
        vec![],
    );
    game.season_context.transfer_window.status = TransferWindowStatus::Open;

    generate_incoming_transfer_offers(&mut game);

    let ai_adc_signed = game
        .players
        .iter()
        .find(|player| player.id == "fa-adc-needed")
        .and_then(|player| player.team_id.as_deref());
    let ai_mid_signed = game
        .players
        .iter()
        .find(|player| player.id == "fa-mid-premium")
        .and_then(|player| player.team_id.as_deref());

    assert_eq!(ai_adc_signed, Some("team-2"));
    assert_ne!(ai_mid_signed, Some("team-2"));

    let ai_team = game.teams.iter().find(|team| team.id == "team-2").unwrap();
    assert_eq!(ai_team.financial_ledger.len(), 1);
    assert_eq!(
        ai_team.financial_ledger[0].kind,
        FinancialTransactionKind::TransferPurchase
    );
    assert_eq!(ai_team.financial_ledger[0].amount, -210_000);
}

#[test]
fn ai_club_transfer_prioritizes_missing_role() {
    let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 8, 1, 12, 0, 0).unwrap());

    let mut manager = Manager::new(
        "manager-1".to_string(),
        "Jane".to_string(),
        "Doe".to_string(),
        "1980-01-01".to_string(),
        "England".to_string(),
    );
    manager.hire("team-1".to_string());

    let mut user_team = make_user_team(5_000_000, 2_000_000);
    user_team.team_kind = TeamKind::Main;

    let mut ai_buyer = Team::new(
        "team-2".to_string(),
        "Buyer FC".to_string(),
        "BUY".to_string(),
        "England".to_string(),
        "Leeds".to_string(),
        "Buyer Ground".to_string(),
        25_000,
    );
    ai_buyer.team_kind = TeamKind::Main;
    ai_buyer.finance = 6_000_000;
    ai_buyer.transfer_budget = 3_500_000;
    // The 0.95M adc asks about 1.16M a year on the LEC wage scale; the 1.5M mid would not fit.
    ai_buyer.wage_budget = 2_000_000;

    let mut seller_team = Team::new(
        "team-3".to_string(),
        "Seller City".to_string(),
        "SEL".to_string(),
        "England".to_string(),
        "Bristol".to_string(),
        "Seller Ground".to_string(),
        22_000,
    );
    seller_team.team_kind = TeamKind::Main;
    seller_team.finance = 4_000_000;
    seller_team.transfer_budget = 2_000_000;
    // A lineup that lists nobody on the market, so neither seller counts as a key player.
    seller_team.active_lineup_ids = vec!["seller-lineup-placeholder".to_string()];

    let mut seller_mid = make_player_with_position(
        "seller-mid-premium",
        LolRole::Mid,
        Some("team-3"),
        1_500_000,
    );
    seller_mid.transfer_listed = true;
    let mut seller_adc =
        make_player_with_position("seller-adc-needed", LolRole::Adc, Some("team-3"), 950_000);
    seller_adc.transfer_listed = true;

    let players = vec![
        make_player_with_position("buyer-top", LolRole::Top, Some("team-2"), 900_000),
        make_player_with_position("buyer-jungle", LolRole::Jungle, Some("team-2"), 880_000),
        make_player_with_position("buyer-mid", LolRole::Mid, Some("team-2"), 920_000),
        make_player_with_position("buyer-support", LolRole::Support, Some("team-2"), 870_000),
        seller_mid,
        seller_adc,
    ];

    let mut game = Game::new(
        clock,
        manager,
        vec![user_team, ai_buyer, seller_team],
        players,
        vec![],
        vec![],
    );
    game.season_context.transfer_window.status = TransferWindowStatus::Open;

    generate_incoming_transfer_offers(&mut game);

    let adc_team = game
        .players
        .iter()
        .find(|player| player.id == "seller-adc-needed")
        .and_then(|player| player.team_id.as_deref());
    let mid_team = game
        .players
        .iter()
        .find(|player| player.id == "seller-mid-premium")
        .and_then(|player| player.team_id.as_deref());

    assert_eq!(adc_team, Some("team-2"));
    assert_eq!(mid_team, Some("team-3"));

    let buyer = game.teams.iter().find(|team| team.id == "team-2").unwrap();
    let seller = game.teams.iter().find(|team| team.id == "team-3").unwrap();
    assert_eq!(buyer.financial_ledger.len(), 1);
    assert_eq!(
        buyer.financial_ledger[0].kind,
        FinancialTransactionKind::TransferPurchase
    );
    assert_eq!(buyer.financial_ledger[0].amount, -779_000);
    assert_eq!(seller.financial_ledger.len(), 1);
    assert_eq!(
        seller.financial_ledger[0].kind,
        FinancialTransactionKind::TransferSale
    );
    assert_eq!(seller.financial_ledger[0].amount, 779_000);
}

// ---------------------------------------------------------------------------
// Tests: release_player_contract — was_released flag & academy scenarios
// ---------------------------------------------------------------------------

#[test]
fn release_player_contract_sets_was_released_flag() {
    let mut player = make_user_player("release-test-1");
    player.wage = 100_000; // non-zero wage so penalty logic is exercised

    let mut game = make_game_with_player(player, vec![], 10_000_000, 5_000_000);

    let penalty =
        release_player_contract(&mut game, "release-test-1").expect("release should succeed");

    assert!(
        penalty > 0,
        "release penalty should be > 0 for non-zero wage"
    );

    let released = game
        .players
        .iter()
        .find(|p| p.id == "release-test-1")
        .expect("released player should still be in game");

    assert!(
        released.was_released,
        "was_released should be true after release"
    );
    assert!(
        released.team_id.is_none(),
        "team_id should be None after release"
    );
    assert!(
        released.contract_end.is_none(),
        "contract_end should be None after release"
    );
    assert_eq!(released.wage, 0, "wage should be 0 after release");
    assert!(!released.transfer_listed, "should not be transfer listed");
    assert!(!released.loan_listed, "should not be loan listed");
    assert!(
        released.transfer_offers.is_empty(),
        "transfer offers should be cleared"
    );
    assert!(
        game.moved_player_ids.contains("release-test-1"),
        "released player should be recorded as moved"
    );
}

#[test]
fn release_player_contract_rejects_non_academy_player_without_contract() {
    let mut player = make_user_player("release-no-contract");
    player.contract_end = None; // no active contract
    player.wage = 100_000;

    let mut game = make_game_with_player(player, vec![], 10_000_000, 5_000_000);

    let err = release_player_contract(&mut game, "release-no-contract")
        .expect_err("release without contract should fail for non-academy player");

    assert_eq!(err, "Player has no active contract");
}

#[test]
fn release_academy_player_without_parent_team_id_succeeds() {
    let mut player = make_player("academy-no-parent");
    player.team_id = Some("academy-team".to_string());
    player.contract_end = Some("2028-06-30".to_string());
    player.wage = 50_000;

    let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 8, 1, 12, 0, 0).unwrap());

    let mut manager = Manager::new(
        "manager-1".to_string(),
        "Jane".to_string(),
        "Doe".to_string(),
        "1980-01-01".to_string(),
        "England".to_string(),
    );
    manager.hire("team-1".to_string());

    let mut user_team = make_user_team(10_000_000, 5_000_000);
    user_team.academy_team_id = Some("academy-team".to_string());

    let mut academy_team = Team::new(
        "academy-team".to_string(),
        "Test Academy".to_string(),
        "TAC".to_string(),
        "England".to_string(),
        "London".to_string(),
        "Academy Ground".to_string(),
        5_000,
    );
    academy_team.team_kind = TeamKind::Academy;
    // Intentionally do NOT set parent_team_id — this is the bug scenario
    academy_team.finance = 1_000_000;

    let mut game = Game::new(
        clock,
        manager,
        vec![user_team, academy_team],
        vec![player],
        vec![],
        vec![],
    );
    game.season_context.transfer_window.status = TransferWindowStatus::Open;

    let _penalty = release_player_contract(&mut game, "academy-no-parent")
        .expect("academy player without parent_team_id should be releasable");

    let released = game
        .players
        .iter()
        .find(|p| p.id == "academy-no-parent")
        .expect("released player should exist");

    assert!(released.was_released);
    assert!(released.team_id.is_none());
}

#[test]
fn release_academy_player_without_contract_end_succeeds() {
    let mut player = make_player("academy-no-contract");
    player.team_id = Some("academy-team".to_string());
    player.contract_end = None; // youth intake — no contract
    player.wage = 0;

    let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 8, 1, 12, 0, 0).unwrap());

    let mut manager = Manager::new(
        "manager-1".to_string(),
        "Jane".to_string(),
        "Doe".to_string(),
        "1980-01-01".to_string(),
        "England".to_string(),
    );
    manager.hire("team-1".to_string());

    let mut user_team = make_user_team(10_000_000, 5_000_000);
    user_team.academy_team_id = Some("academy-team".to_string());

    let mut academy_team = Team::new(
        "academy-team".to_string(),
        "Test Academy".to_string(),
        "TAC".to_string(),
        "England".to_string(),
        "London".to_string(),
        "Academy Ground".to_string(),
        5_000,
    );
    academy_team.team_kind = TeamKind::Academy;
    academy_team.parent_team_id = Some("team-1".to_string());
    academy_team.finance = 1_000_000;

    let mut game = Game::new(
        clock,
        manager,
        vec![user_team, academy_team],
        vec![player],
        vec![],
        vec![],
    );
    game.season_context.transfer_window.status = TransferWindowStatus::Open;

    let _penalty = release_player_contract(&mut game, "academy-no-contract")
        .expect("academy player without contract_end should be releasable");

    let released = game
        .players
        .iter()
        .find(|p| p.id == "academy-no-contract")
        .expect("released player should exist");

    assert!(released.was_released);
    assert!(released.team_id.is_none());
}

fn make_ai_team(id: &str) -> Team {
    let mut team = Team::new(
        id.to_string(),
        format!("{} FC", id),
        id.chars().take(3).collect::<String>().to_uppercase(),
        "England".to_string(),
        "London".to_string(),
        "Arena".to_string(),
        50_000,
    );
    team.finance = 10_000_000;
    team.transfer_budget = 5_000_000;
    team.reputation = 50;
    team
}

fn make_free_agent(id: &str, role: LolRole) -> Player {
    let mut player = Player::new(
        id.to_string(),
        format!("{}. Free", id),
        format!("{} Free", id),
        "2000-01-01".to_string(),
        "England".to_string(),
        role,
        default_attrs(),
    );
    player.team_id = None;
    player.contract_end = None;
    player.market_value = 500_000;
    player.wage = 100_000;
    player.morale = 70;
    player
}

fn make_game_with_free_agent(free_agent: Player) -> Game {
    make_game_with_free_agents(vec![free_agent])
}

fn make_game_with_free_agents(free_agents: Vec<Player>) -> Game {
    let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 8, 1, 12, 0, 0).unwrap());
    let mut manager = Manager::new(
        "manager-1".to_string(),
        "Jane".to_string(),
        "Doe".to_string(),
        "1980-01-01".to_string(),
        "England".to_string(),
    );
    manager.hire("team-user".to_string());

    let mut team = make_ai_team("team-ai");
    // On the LEC wage scale a 1M free agent asks about 1.2M a year.
    team.wage_budget = 5_000_000;

    let mut game = Game::new(clock, manager, vec![team], free_agents, vec![], vec![]);
    game.season_context.transfer_window.status = TransferWindowStatus::Open;
    game
}

fn make_user_game_with_free_agent(free_agent: Player) -> Game {
    let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 8, 1, 12, 0, 0).unwrap());
    let mut manager = Manager::new(
        "manager-1".to_string(),
        "Jane".to_string(),
        "Doe".to_string(),
        "1980-01-01".to_string(),
        "England".to_string(),
    );
    manager.hire("team-1".to_string());

    let mut game = Game::new(
        clock,
        manager,
        vec![make_user_team(500_000, 100_000), make_seller_team(vec![])],
        vec![free_agent],
        vec![],
        vec![],
    );
    game.season_context.transfer_window.status = TransferWindowStatus::Open;
    game
}

#[test]
fn free_agent_bid_is_accepted_even_with_low_budget() {
    let mut free_agent = make_free_agent("fa-low-budget", LolRole::Adc);
    free_agent.market_value = 2_000_000;
    let mut game = make_user_game_with_free_agent(free_agent);

    let result = make_transfer_bid(
        &mut game,
        "fa-low-budget",
        1_500_000,
        TransferDestination::Main,
        &[],
    )
    .expect("free agent bid should be accepted regardless of transfer budget");

    assert_eq!(result.decision, TransferNegotiationDecision::Accepted);

    let player = game
        .players
        .iter()
        .find(|p| p.id == "fa-low-budget")
        .expect("player should exist");
    assert!(
        player
            .transfer_offers
            .iter()
            .any(|o| o.from_team_id == "team-1" && o.status == TransferOfferStatus::Accepted),
        "accepted free-agent offer should be created"
    );
    assert_eq!(game.teams[0].finance, 500_000);
    assert_eq!(game.teams[0].transfer_budget, 100_000);
}

#[test]
fn project_free_agent_bid_financial_impact_uses_zero_fee() {
    let mut free_agent = make_free_agent("fa-zero-fee", LolRole::Adc);
    free_agent.market_value = 5_000_000;
    let game = make_user_game_with_free_agent(free_agent);

    let projection = project_transfer_bid_financial_impact(
        &game,
        "fa-zero-fee",
        3_000_000,
        TransferDestination::Main,
    )
    .expect("projection should succeed for free agent");

    assert_eq!(
        projection.transfer_budget_after, projection.transfer_budget_before,
        "transfer budget should not be reduced for free agents"
    );
    assert_eq!(
        projection.finance_after, projection.finance_before,
        "club balance should not be reduced for free agents"
    );
    assert!(!projection.exceeds_transfer_budget);
    assert!(!projection.exceeds_finance);
}

#[test]
fn ai_free_agent_signing_records_non_zero_wage_and_term() {
    let free_agent = make_free_agent("fa-wage-term", LolRole::Adc);
    let mut game = make_game_with_free_agent(free_agent);

    let signed = ai_agent_purchase(&mut game, "team-ai", "ADC");
    assert!(signed, "AI should sign the free agent");

    let player = game
        .players
        .iter()
        .find(|player| player.id == "fa-wage-term")
        .unwrap();
    assert_eq!(player.team_id.as_deref(), Some("team-ai"));
    assert!(player.wage > 0, "player wage should be non-zero");

    let history = get_transfer_history(&game);
    let entry = history
        .iter()
        .find(|entry| entry.player_id == "fa-wage-term")
        .expect("history should contain the free-agent signing");
    assert!(
        entry.annual_wage > 0,
        "history annual_wage should be non-zero, got {}",
        entry.annual_wage
    );
    assert!(
        (1..=5).contains(&entry.contract_years),
        "history contract_years should be realistic, got {}",
        entry.contract_years
    );
    assert_eq!(
        player.wage, entry.annual_wage,
        "player wage must match history annual_wage"
    );
    assert!(
        player
            .contract_end
            .as_ref()
            .is_some_and(|contract_end| contract_end
                .starts_with(&(2026 + i32::from(entry.contract_years)).to_string())),
        "player contract_end must match history contract_years"
    );
}

#[test]
fn ai_free_agent_signing_applies_non_zero_wage_floor_for_new_player() {
    let mut free_agent = Player::new(
        "fa-zero-wage".to_string(),
        "Zero Wage".to_string(),
        "Zero Wage".to_string(),
        "2000-01-01".to_string(),
        "England".to_string(),
        LolRole::Adc,
        default_attrs(),
    );
    free_agent.team_id = None;
    free_agent.contract_end = None;
    free_agent.market_value = 500_000;
    free_agent.morale = 70;

    let mut game = make_game_with_free_agent(free_agent);

    assert!(ai_agent_purchase(&mut game, "team-ai", "ADC"));

    let player = game
        .players
        .iter()
        .find(|player| player.id == "fa-zero-wage")
        .unwrap();
    let entry = get_transfer_history(&game)
        .into_iter()
        .find(|entry| entry.player_id == "fa-zero-wage")
        .unwrap();

    assert!(player.wage > 0, "signed player wage should be non-zero");
    assert!(
        entry.annual_wage > 0,
        "history annual_wage should be non-zero"
    );
    assert_eq!(player.wage, entry.annual_wage);
}

#[test]
fn ai_free_agent_signing_matches_player_state_to_history() {
    let free_agent = make_free_agent("fa-state-match", LolRole::Top);
    let mut game = make_game_with_free_agent(free_agent);

    ai_agent_purchase(&mut game, "team-ai", "TOP");

    let player = game
        .players
        .iter()
        .find(|player| player.id == "fa-state-match")
        .unwrap();
    let entry = get_transfer_history(&game)
        .into_iter()
        .find(|entry| entry.player_id == "fa-state-match")
        .unwrap();
    assert_eq!(player.wage, entry.annual_wage);
    assert!(entry.contract_years > 0);
    assert!(
        player
            .contract_end
            .as_ref()
            .is_some_and(|contract_end| contract_end
                .starts_with(&(2026 + i32::from(entry.contract_years)).to_string())),
        "player contract_end must match history contract_years"
    );
}

#[test]
fn ai_agent_purchase_respects_daily_cap() {
    let free_agents = vec![
        make_free_agent("fa-cap-1", LolRole::Top),
        make_free_agent("fa-cap-2", LolRole::Top),
        make_free_agent("fa-cap-3", LolRole::Top),
    ];
    let mut game = make_game_with_free_agents(free_agents);

    assert!(ai_agent_purchase(&mut game, "team-ai", "TOP"));
    assert!(ai_agent_purchase(&mut game, "team-ai", "TOP"));
    assert!(
        !ai_agent_purchase(&mut game, "team-ai", "TOP"),
        "third same-day purchase should be blocked by daily cap"
    );
}

#[test]
fn rejected_ai_agent_purchase_does_not_consume_daily_cap() {
    let mut low_impact = make_free_agent("fa-low-impact-cap", LolRole::Top);
    low_impact.lol_ovr = 60;
    low_impact.market_value = 100_000;
    let mut game = make_game_with_free_agent(low_impact);

    game.teams[0].wage_budget = 10_000;

    assert!(
        !ai_agent_purchase(&mut game, "team-ai", "TOP"),
        "free agent should be rejected by signing policy"
    );

    game.teams[0].wage_budget = 10_000_000;

    let mut strong_one = make_free_agent("fa-cap-valid-1", LolRole::Top);
    strong_one.lol_ovr = 95;
    strong_one.market_value = 2_000_000;
    let mut strong_two = make_free_agent("fa-cap-valid-2", LolRole::Top);
    strong_two.lol_ovr = 94;
    strong_two.market_value = 1_900_000;
    game.players.push(strong_one);
    game.players.push(strong_two);

    assert!(ai_agent_purchase(&mut game, "team-ai", "TOP"));
    assert!(
        ai_agent_purchase(&mut game, "team-ai", "TOP"),
        "two valid signings should remain available after the rejected attempt"
    );
}

#[test]
fn ai_free_agent_signing_respects_reputation_gate_for_tier_one() {
    let mut free_agent = make_free_agent("fa-low-impact", LolRole::Top);
    free_agent.lol_ovr = 60;
    free_agent.market_value = 100_000;
    let mut game = make_game_with_free_agent(free_agent);

    let mut team = game.teams.remove(0);
    team.reputation = 1_200;
    team.competition_id = Some("comp-1".to_string());
    team.wage_budget = 1_000_000;
    game.teams.push(team);

    game.leagues.push(olm_core::domain::league::League {
        id: "league-1".to_string(),
        name: "League One".to_string(),
        season: 2026,
        competition_id: Some("comp-1".to_string()),
        logo: None,
        league_kind: olm_core::domain::league::LeagueKind::Main,
        fixtures: vec![],
        standings: vec![olm_core::domain::league::StandingEntry::new(
            "team-ai".to_string(),
        )],
        split_index: 0,
        tier: 1,
        active: true,
    });

    // Seed a recent incoming offer on a dummy user-team player so that
    // generate_incoming_transfer_offers takes the early return path that
    // invokes simulate_ai_free_agent_signings.
    let user_player_id = "user-player".to_string();
    game.players.push({
        let mut p = Player::new(
            user_player_id.clone(),
            "User Player".to_string(),
            "User Player".to_string(),
            "2000-01-01".to_string(),
            "England".to_string(),
            LolRole::Mid,
            default_attrs(),
        );
        p.team_id = Some("team-user".to_string());
        p.contract_end = Some("2028-06-30".to_string());
        p.transfer_offers.push(TransferOffer {
            id: "offer-1".to_string(),
            from_team_id: "team-ai".to_string(),
            destination_team_id: Some("team-user".to_string()),
            fee: 1_000_000,
            wage_offered: 100_000,
            last_manager_fee: None,
            negotiation_round: 1,
            suggested_counter_fee: None,
            players_included: vec![],
            status: TransferOfferStatus::Pending,
            date: game.clock.current_date.format("%Y-%m-%d").to_string(),
            wage_negotiation_status: WageNegotiationStatus::Pending,
            contract_years_offered: 2,
            suggested_counter_wage: None,
            suggested_counter_years: None,
            wage_negotiation_round: 1,
        });
        p
    });

    generate_incoming_transfer_offers(&mut game);

    let signed = game
        .players
        .iter()
        .find(|p| p.id == "fa-low-impact")
        .unwrap();
    assert_ne!(
        signed.team_id.as_deref(),
        Some("team-ai"),
        "tier-1 high-reputation team should reject low-impact free agent"
    );
}
