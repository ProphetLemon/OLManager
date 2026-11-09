use chrono::{TimeZone, Utc};
use olm_core::clock::GameClock;
use olm_core::contracts::{
    DelegatedRenewalOptions, DelegatedRenewalResultStatus, RenewalDecision, RenewalOffer,
    delegate_renewals, evaluate_renewal_offer, process_contract_expiries, propose_renewal,
};
use olm_core::domain::manager::Manager;
use olm_core::domain::player::{
    ContractRenewalState, Player, PlayerAttributes, RenewalSessionStatus,
};
use olm_core::domain::staff::{Staff, StaffAttributes, StaffRole};
use olm_core::domain::stats::LolRole;
use olm_core::domain::team::Team;
use olm_core::game::Game;

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

fn make_player() -> Player {
    let mut player = Player::new(
        "player-1".to_string(),
        "J. Smith".to_string(),
        "John Smith".to_string(),
        "2000-01-01".to_string(),
        "England".to_string(),
        LolRole::Adc,
        default_attrs(),
    );
    player.team_id = Some("team-1".to_string());
    player.contract_end = Some("2026-10-15".to_string());
    player.wage = 12_000;
    player.morale = 75;
    player.market_value = 350_000;
    player
}

fn make_player_with(id: &str, wage: u32, contract_end: &str) -> Player {
    let mut player = make_player();
    player.id = id.to_string();
    player.match_name = id.to_string();
    player.full_name = format!("Player {}", id);
    player.wage = wage;
    player.contract_end = Some(contract_end.to_string());
    player
}

fn make_team() -> Team {
    let mut team = Team::new(
        "team-1".to_string(),
        "Alpha FC".to_string(),
        "ALP".to_string(),
        "England".to_string(),
        "London".to_string(),
        "Alpha Ground".to_string(),
        30_000,
    );
    team.manager_id = Some("manager-1".to_string());
    team.reputation = 50;
    team.wage_budget = 500_000;
    team
}

fn make_assistant_manager() -> Staff {
    let mut staff = Staff::new(
        "staff-1".to_string(),
        "Alex".to_string(),
        "Assistant".to_string(),
        "1985-01-01".to_string(),
        StaffRole::AssistantManager,
        StaffAttributes {
            coaching: 82,
            judging_ability: 76,
            judging_potential: 74,
            physiotherapy: 30,
        },
    );
    staff.team_id = Some("team-1".to_string());
    staff
}

fn make_game() -> Game {
    let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 8, 1, 12, 0, 0).unwrap());
    let mut manager = Manager::new(
        "manager-1".to_string(),
        "Jane".to_string(),
        "Doe".to_string(),
        "1980-01-01".to_string(),
        "England".to_string(),
    );
    manager.hire("team-1".to_string());

    Game::new(
        clock,
        manager,
        vec![make_team()],
        vec![make_player()],
        vec![],
        vec![],
    )
}

#[test]
fn accepted_offer_updates_wage_and_term_correctly() {
    let mut game = make_game();

    let outcome = propose_renewal(
        &mut game,
        "player-1",
        RenewalOffer {
            annual_wage: 15_000,
            contract_years: 3,
        },
    )
    .expect("renewal should succeed");

    assert!(matches!(outcome.decision, RenewalDecision::Accepted));
    assert!(outcome.feedback.is_some());
    let player = game.players.iter().find(|p| p.id == "player-1").unwrap();
    assert_eq!(player.wage, 15_000);
    assert_eq!(player.contract_end.as_deref(), Some("2029-08-01"));
}

#[test]
fn rejected_offer_leaves_state_unchanged() {
    let mut game = make_game();
    let original_wage = game.players[0].wage;
    let original_end = game.players[0].contract_end.clone();

    let outcome = propose_renewal(
        &mut game,
        "player-1",
        RenewalOffer {
            annual_wage: 7_000,
            contract_years: 1,
        },
    )
    .expect("renewal should return a decision");

    assert!(matches!(outcome.decision, RenewalDecision::Rejected));
    assert_eq!(game.players[0].wage, original_wage);
    assert_eq!(game.players[0].contract_end, original_end);
}

#[test]
fn counter_offer_returns_understandable_feedback() {
    let mut game = make_game();

    let outcome = propose_renewal(
        &mut game,
        "player-1",
        RenewalOffer {
            annual_wage: 13_000,
            contract_years: 2,
        },
    )
    .expect("renewal should return a counter offer");

    assert!(matches!(outcome.decision, RenewalDecision::CounterOffer));
    assert_eq!(outcome.suggested_wage, Some(14_000));
    assert_eq!(outcome.suggested_years, Some(3));
    let feedback = outcome.feedback.expect("feedback should be present");
    assert_eq!(feedback.round, 1);
    assert!(feedback.tension > 0);
}

#[test]
fn high_value_star_expects_more_than_fringe_player() {
    let current_date = Utc
        .with_ymd_and_hms(2026, 8, 1, 12, 0, 0)
        .unwrap()
        .date_naive();
    let team = make_team();

    let mut star = make_player();
    star.contract_end = Some("2028-08-01".to_string());
    star.market_value = 2_500_000;
    star.attributes.mechanics = 88;
    star.attributes.laning = 90;

    let mut fringe = make_player();
    fringe.contract_end = Some("2028-08-01".to_string());
    fringe.market_value = 80_000;
    fringe.attributes.mechanics = 50;
    fringe.attributes.laning = 48;

    let offer = RenewalOffer {
        annual_wage: 14_000,
        contract_years: 3,
    };

    let star_outcome = evaluate_renewal_offer(&star, &team, current_date, &offer);
    let fringe_outcome = evaluate_renewal_offer(&fringe, &team, current_date, &offer);

    assert!(matches!(fringe_outcome.decision, RenewalDecision::Accepted));
    assert!(matches!(
        star_outcome.decision,
        RenewalDecision::CounterOffer
    ));
    assert!(star_outcome.suggested_wage > fringe_outcome.suggested_wage);
}

#[test]
fn low_morale_player_becomes_harder_to_renew_than_content_player() {
    let current_date = Utc
        .with_ymd_and_hms(2026, 8, 1, 12, 0, 0)
        .unwrap()
        .date_naive();
    let team = make_team();

    let mut content_player = make_player();
    content_player.contract_end = Some("2028-08-01".to_string());
    content_player.morale = 85;

    let mut unhappy_player = make_player();
    unhappy_player.contract_end = Some("2028-08-01".to_string());
    unhappy_player.morale = 35;

    let offer = RenewalOffer {
        annual_wage: 13_000,
        contract_years: 3,
    };

    let content_outcome = evaluate_renewal_offer(&content_player, &team, current_date, &offer);
    let unhappy_outcome = evaluate_renewal_offer(&unhappy_player, &team, current_date, &offer);

    assert!(matches!(
        content_outcome.decision,
        RenewalDecision::Accepted
    ));
    assert!(matches!(
        unhappy_outcome.decision,
        RenewalDecision::CounterOffer
    ));
}

#[test]
fn shorter_remaining_term_increases_renewal_demands() {
    let current_date = Utc
        .with_ymd_and_hms(2026, 8, 1, 12, 0, 0)
        .unwrap()
        .date_naive();
    let team = make_team();

    let mut secure_player = make_player();
    secure_player.contract_end = Some("2028-08-01".to_string());

    let mut expiring_player = make_player();
    expiring_player.contract_end = Some("2026-10-01".to_string());

    let offer = RenewalOffer {
        annual_wage: 13_000,
        contract_years: 3,
    };

    let secure_outcome = evaluate_renewal_offer(&secure_player, &team, current_date, &offer);
    let expiring_outcome = evaluate_renewal_offer(&expiring_player, &team, current_date, &offer);

    assert!(matches!(secure_outcome.decision, RenewalDecision::Accepted));
    assert!(matches!(
        expiring_outcome.decision,
        RenewalDecision::CounterOffer
    ));
}

#[test]
fn low_manager_trust_player_can_refuse_manual_renewal_even_at_fair_terms() {
    let mut game = make_game();
    game.players[0].morale_core.manager_trust = 18;

    let outcome = propose_renewal(
        &mut game,
        "player-1",
        RenewalOffer {
            annual_wage: 15_000,
            contract_years: 3,
        },
    )
    .expect("renewal should produce an outcome");

    assert!(matches!(outcome.decision, RenewalDecision::Rejected));
}

#[test]
fn manager_block_prevents_manual_renewal_until_it_expires() {
    let mut game = make_game();
    game.players[0].morale_core.renewal_state = Some(ContractRenewalState {
        status: RenewalSessionStatus::Blocked,
        manager_blocked_until: Some("2026-09-01".to_string()),
        last_attempt_date: None,
        last_assistant_attempt_date: None,
        last_outcome: None,
        conversation_round: 0,
    });

    let outcome = propose_renewal(
        &mut game,
        "player-1",
        RenewalOffer {
            annual_wage: 16_000,
            contract_years: 3,
        },
    )
    .expect("renewal should produce an outcome");

    assert!(matches!(outcome.decision, RenewalDecision::Rejected));
    assert_eq!(outcome.session_status, RenewalSessionStatus::Blocked);
    assert!(outcome.is_terminal);
}

#[test]
fn stale_manual_renewal_talks_cool_off_and_restart_from_round_one() {
    let mut game = make_game();
    game.players[0].morale_core.renewal_state = Some(ContractRenewalState {
        status: RenewalSessionStatus::Open,
        manager_blocked_until: None,
        last_attempt_date: Some("2026-08-10".to_string()),
        last_assistant_attempt_date: None,
        last_outcome: None,
        conversation_round: 3,
    });
    game.clock = GameClock::new(Utc.with_ymd_and_hms(2026, 8, 26, 12, 0, 0).unwrap());

    let outcome = propose_renewal(
        &mut game,
        "player-1",
        RenewalOffer {
            annual_wage: 13_000,
            contract_years: 2,
        },
    )
    .expect("renewal should produce an outcome");

    assert!(outcome.cooled_off);
    let feedback = outcome.feedback.expect("feedback should be present");
    assert_eq!(feedback.round, 1);

    let renewal_state = game.players[0]
        .morale_core
        .renewal_state
        .as_ref()
        .expect("renewal state should be stored");
    assert_eq!(renewal_state.conversation_round, 1);
    assert_eq!(
        renewal_state.last_attempt_date.as_deref(),
        Some("2026-08-26")
    );
}

#[test]
fn assistant_can_complete_routine_delegate_renewal_even_when_manager_trust_is_low() {
    let mut game = make_game();
    game.staff.push(make_assistant_manager());
    game.players[0].morale_core.manager_trust = 24;
    game.players[0].morale = 74;

    let report = delegate_renewals(
        &mut game,
        DelegatedRenewalOptions {
            player_ids: Some(vec!["player-1".to_string()]),
            max_wage_increase_pct: 35,
            max_contract_years: 3,
        },
    )
    .expect("assistant delegation should return a report");

    assert_eq!(report.success_count, 1);
    assert_eq!(report.failure_count, 0);
    assert_eq!(report.stalled_count, 0);
    assert_eq!(report.cases.len(), 1);
    assert_eq!(report.cases[0].player_id, "player-1");
    assert_eq!(
        report.cases[0].status,
        DelegatedRenewalResultStatus::Successful
    );

    let player = game
        .players
        .iter()
        .find(|player| player.id == "player-1")
        .unwrap();
    assert_eq!(player.contract_end.as_deref(), Some("2029-08-01"));
    assert!(player.wage >= 14_000);

    let report_message = game
        .messages
        .iter()
        .find(|message| message.id.starts_with("delegated_renewals_"))
        .expect("assistant delegation should create an inbox report");
    assert_eq!(
        report_message.subject_key.as_deref(),
        Some("be.msg.delegatedRenewals.subject")
    );
    assert_eq!(
        report_message.body_key.as_deref(),
        Some("be.msg.delegatedRenewals.body")
    );
    assert_eq!(
        report_message.sender_key.as_deref(),
        Some("be.sender.assistantManager")
    );
    let structured_report = report_message
        .context
        .delegated_renewal_report
        .as_ref()
        .expect("assistant report should carry structured i18n-safe case data");
    assert_eq!(structured_report.success_count, 1);
    assert_eq!(structured_report.cases.len(), 1);
    assert_eq!(structured_report.cases[0].status, "successful");
}

#[test]
fn renewal_is_blocked_when_offer_pushes_healthy_club_far_over_soft_cap() {
    let mut game = make_game();
    game.teams[0].wage_budget = 200_000;

    let err = propose_renewal(
        &mut game,
        "player-1",
        RenewalOffer {
            annual_wage: 250_000,
            contract_years: 3,
        },
    )
    .expect_err("renewal should be blocked by wage policy");

    assert!(err.contains("board wage policy"));
}

#[test]
fn expired_contract_preserves_non_zero_wage() {
    let mut game = make_game();
    game.players[0].wage = 1_500_000;
    game.players[0].contract_end = Some("2026-07-31".to_string());

    process_contract_expiries(&mut game);

    let player = game
        .players
        .iter()
        .find(|player| player.id == "player-1")
        .unwrap();
    assert!(player.team_id.is_none());
    assert!(player.contract_end.is_none());
    assert!(
        player.wage > 0,
        "expired player should retain non-zero wage, got {}",
        player.wage
    );
}

#[test]
fn expired_contract_wage_reflects_expected_wage_multipliers() {
    let mut game = make_game();
    // The wage sits above the LEC-scale floor of a 2M player (about 2.4M), so only the
    // multipliers move it.
    game.players[0].wage = 2_500_000;
    game.players[0].market_value = 2_000_000;
    game.players[0].morale = 40;
    game.players[0].date_of_birth = "2002-01-01".to_string();
    game.players[0].contract_end = Some("2026-07-31".to_string());
    game.teams[0].reputation = 30;

    process_contract_expiries(&mut game);

    let player = game
        .players
        .iter()
        .find(|player| player.id == "player-1")
        .unwrap();
    // 2_500_000 * 1.05 (age <= 27) * 1.10 (morale <= 50) * 1.18 (market_value >= 2M)
    // * 1.05 (reputation < 40) * 1.10 (remaining_days <= 180) = 3_936_000 after rounding.
    assert_eq!(player.wage, 3_936_000);
}

#[test]
fn expired_contract_wage_floor_is_previous_wage() {
    let mut game = make_game();
    game.players[0].wage = 1_500_000;
    game.players[0].market_value = 100_000;
    game.players[0].morale = 80;
    game.players[0].date_of_birth = "1990-01-01".to_string();
    game.players[0].contract_end = Some("2026-07-31".to_string());
    game.teams[0].reputation = 50;

    process_contract_expiries(&mut game);

    let player = game
        .players
        .iter()
        .find(|player| player.id == "player-1")
        .unwrap();
    // Multipliers would push computed wage below the previous wage, so the max()
    // floor preserves the original asking baseline.
    assert_eq!(player.wage, 1_500_000);
}

#[test]
fn renewal_blocks_large_worsening_for_legacy_over_budget_saves() {
    let mut game = make_game();
    game.teams[0].wage_budget = 50_000;
    game.players[0].wage = 48_000;
    game.players
        .push(make_player_with("player-2", 40_000, "2027-06-30"));

    let err = propose_renewal(
        &mut game,
        "player-1",
        RenewalOffer {
            annual_wage: 120_000,
            contract_years: 3,
        },
    )
    .expect_err("large worsening should still be blocked");

    assert!(err.contains("board wage policy"));
}

#[test]
fn expected_wage_of_a_star_without_a_wage_follows_the_lec_scale() {
    // Gumayusi-like: OVR 91, 370k market value, wage 0, mid-contract at a rich club.
    let mut star = make_player_with("star", 0, "2027-11-30");
    star.market_value = 370_000;
    let team = make_team();
    let today = chrono::NaiveDate::from_ymd_opt(2026, 11, 7).unwrap();

    let wage = olm_core::contracts::expected_wage(&star, &team, today);

    assert!(
        (450_000..=550_000).contains(&wage),
        "expected wage {wage} is outside 450k-550k"
    );
}

#[test]
fn expected_wage_keeps_the_minimum_for_a_worthless_player() {
    let mut rookie = make_player_with("rookie", 0, "2027-11-30");
    rookie.market_value = 0;
    let today = chrono::NaiveDate::from_ymd_opt(2026, 11, 7).unwrap();

    let wage = olm_core::contracts::expected_wage(&rookie, &make_team(), today);

    assert!((25_000..=30_000).contains(&wage), "got {wage}");
}
