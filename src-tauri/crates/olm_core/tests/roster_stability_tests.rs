use chrono::{TimeZone, Utc};
use olm_core::clock::GameClock;
use olm_core::domain::league::{
    Fixture, FixtureStatus, League, LeagueKind, MatchType, StandingEntry,
};
use olm_core::domain::manager::Manager;
use olm_core::domain::player::{Player, PlayerAttributes};
use olm_core::domain::season::TransferWindowStatus;
use olm_core::domain::stats::LolRole;
use olm_core::domain::team::{Team, TeamKind};
use olm_core::game::Game;
use olm_core::roster_stability::{
    NewGameRosterFill, RepairAction, RosterStabilityReason, evaluate_team, fill_new_game_rosters,
    repair_league, repair_team,
};
use olm_core::transfers::get_transfer_history;

fn attrs() -> PlayerAttributes {
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

fn player(id: &str, team_id: Option<&str>, role: LolRole, contract_end: Option<&str>) -> Player {
    let mut player = Player::new(
        id.to_string(),
        id.to_string(),
        format!("{id} Test"),
        "2000-01-01".to_string(),
        "Spain".to_string(),
        role,
        attrs(),
    );
    player.team_id = team_id.map(str::to_string);
    player.contract_end = contract_end.map(str::to_string);
    player.wage = 50_000;
    player.market_value = 500_000;
    player
}

fn team(id: &str, manager_id: Option<&str>, lineup: Vec<&str>) -> Team {
    let mut team = Team::new(
        id.to_string(),
        format!("{id} Esports"),
        id.chars().take(3).collect::<String>().to_uppercase(),
        "Spain".to_string(),
        "Madrid".to_string(),
        "Arena".to_string(),
        10_000,
    );
    team.manager_id = manager_id.map(str::to_string);
    team.active_lineup_ids = lineup.into_iter().map(str::to_string).collect();
    team
}

fn league_with_team(team_id: &str) -> League {
    League {
        id: "league-1".to_string(),
        name: "League One".to_string(),
        season: 2026,
        fixtures: vec![Fixture {
            id: "fixture-1".to_string(),
            matchday: 1,
            date: "2026-08-02".to_string(),
            home_team_id: team_id.to_string(),
            away_team_id: "other-ai".to_string(),
            match_type: MatchType::League,
            best_of: 1,
            status: FixtureStatus::Scheduled,
            result: None,
        }],
        standings: vec![StandingEntry::new(team_id.to_string())],
        competition_id: Some("competition-1".to_string()),
        logo: None,
        league_kind: LeagueKind::Main,
        split_index: 0,
        tier: 1,
        active: true,
    }
}

fn game_with(players: Vec<Player>, lineup: Vec<&str>) -> Game {
    let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 8, 1, 12, 0, 0).unwrap());
    let mut manager = Manager::new(
        "manager-1".to_string(),
        "Jane".to_string(),
        "Doe".to_string(),
        "1980-01-01".to_string(),
        "Spain".to_string(),
    );
    manager.hire("user-team".to_string());

    let mut game = Game::new(
        clock,
        manager,
        vec![
            team("ai-team", None, lineup),
            team("other-ai", None, vec![]),
        ],
        players,
        vec![],
        vec![],
    );
    game.leagues = vec![league_with_team("ai-team")];
    game.user_competition_id = Some("competition-1".to_string());
    game
}

fn full_roster(team_id: &str) -> Vec<Player> {
    vec![
        player("top", Some(team_id), LolRole::Top, Some("2028-06-30")),
        player("jungle", Some(team_id), LolRole::Jungle, Some("2028-06-30")),
        player("mid", Some(team_id), LolRole::Mid, Some("2028-06-30")),
        player("adc", Some(team_id), LolRole::Adc, Some("2028-06-30")),
        player(
            "support",
            Some(team_id),
            LolRole::Support,
            Some("2028-06-30"),
        ),
    ]
}

#[test]
fn valid_roster_evaluates_without_repair_actions() {
    let game = game_with(
        full_roster("ai-team"),
        vec!["top", "jungle", "mid", "adc", "support"],
    );

    let evaluation = evaluate_team(&game, "ai-team", RosterStabilityReason::PreMatch)
        .expect("team should evaluate");

    assert!(evaluation.match_eligible);
    assert_eq!(evaluation.eligible_player_count, 5);
    assert!(evaluation.missing_roles.is_empty());
    assert!(evaluation.stale_lineup_ids.is_empty());
}

#[test]
fn below_minimum_roster_is_repaired_with_generated_players() {
    let mut game = game_with(
        vec![
            player("top", Some("ai-team"), LolRole::Top, Some("2028-06-30")),
            player(
                "jungle",
                Some("ai-team"),
                LolRole::Jungle,
                Some("2028-06-30"),
            ),
            player("mid", Some("ai-team"), LolRole::Mid, Some("2028-06-30")),
            player("adc", Some("ai-team"), LolRole::Adc, Some("2028-06-30")),
        ],
        vec!["top", "jungle", "mid", "adc"],
    );

    let report = repair_team(&mut game, "ai-team", RosterStabilityReason::PreMatch)
        .expect("generated emergency player should repair below-minimum roster");
    let evaluation = evaluate_team(&game, "ai-team", RosterStabilityReason::PreMatch)
        .expect("team should evaluate after repair");

    assert!(evaluation.match_eligible);
    assert!(report.actions.iter().any(|action| matches!(
        action,
        RepairAction::GeneratedReplacement {
            role: LolRole::Support,
            ..
        }
    )));
}

#[test]
fn missing_role_prefers_role_fit_free_agent() {
    let mut players = vec![
        player("top", Some("ai-team"), LolRole::Top, Some("2028-06-30")),
        player(
            "jungle",
            Some("ai-team"),
            LolRole::Jungle,
            Some("2028-06-30"),
        ),
        player("mid", Some("ai-team"), LolRole::Mid, Some("2028-06-30")),
        player("adc", Some("ai-team"), LolRole::Adc, Some("2028-06-30")),
        player("adc2", Some("ai-team"), LolRole::Adc, Some("2028-06-30")),
        player("free-support", None, LolRole::Support, Some("2028-06-30")),
    ];
    players[5].market_value = 100_000;
    let mut game = game_with(players, vec!["top", "jungle", "mid", "adc", "adc2"]);
    game.teams[0].wage_budget = 1_000_000;

    let report = repair_team(&mut game, "ai-team", RosterStabilityReason::PreMatch)
        .expect("free support should repair role gap");

    assert_eq!(
        game.players
            .iter()
            .find(|player| player.id == "free-support")
            .unwrap()
            .team_id
            .as_deref(),
        Some("ai-team")
    );
    assert!(report.actions.iter().any(|action| matches!(
        action,
        RepairAction::AssignedFreeAgent { player_id, role: LolRole::Support } if player_id == "free-support"
    )));
}

#[test]
fn stale_lineup_ids_are_reconciled_to_current_eligible_players() {
    let mut game = game_with(
        full_roster("ai-team"),
        vec!["top", "released-player", "mid", "adc", "support"],
    );

    let report = repair_team(&mut game, "ai-team", RosterStabilityReason::LoadMigration)
        .expect("stale lineup should reconcile");
    let lineup = &game
        .teams
        .iter()
        .find(|team| team.id == "ai-team")
        .unwrap()
        .active_lineup_ids;

    assert_eq!(lineup.len(), 5);
    assert!(!lineup.iter().any(|id| id == "released-player"));
    assert!(lineup.iter().any(|id| id == "jungle"));
    assert!(
        report
            .actions
            .iter()
            .any(|action| matches!(action, RepairAction::ReconciledLineup { .. }))
    );
}

#[test]
fn closed_window_emergency_repairs_and_reports_policy_exception() {
    let mut game = game_with(
        vec![
            player("top", Some("ai-team"), LolRole::Top, Some("2028-06-30")),
            player(
                "jungle",
                Some("ai-team"),
                LolRole::Jungle,
                Some("2028-06-30"),
            ),
            player("mid", Some("ai-team"), LolRole::Mid, Some("2028-06-30")),
            player("adc", Some("ai-team"), LolRole::Adc, Some("2028-06-30")),
        ],
        vec!["top", "jungle", "mid", "adc"],
    );
    game.season_context.transfer_window.status = TransferWindowStatus::Closed;

    let report = repair_team(
        &mut game,
        "ai-team",
        RosterStabilityReason::BackgroundSimulation,
    )
    .expect("emergency policy should bypass closed transfer window");

    assert!(
        report
            .policy_exceptions
            .iter()
            .any(|exception| exception == "transfer_window_closed")
    );
}

#[test]
fn closed_window_expired_bench_without_repair_does_not_report_policy_exception() {
    let mut players = full_roster("ai-team");
    players.push(player(
        "expired-bench",
        Some("ai-team"),
        LolRole::Support,
        Some("2026-07-31"),
    ));
    let mut game = game_with(players, vec!["top", "jungle", "mid", "adc", "support"]);
    game.season_context.transfer_window.status = TransferWindowStatus::Closed;

    let report = repair_team(
        &mut game,
        "ai-team",
        RosterStabilityReason::BackgroundSimulation,
    )
    .expect("eligible active roster should remain a no-op despite expired bench players");

    assert!(report.before.match_eligible);
    assert!(report.after.match_eligible);
    assert!(report.actions.is_empty());
    assert!(
        !report
            .policy_exceptions
            .iter()
            .any(|exception| exception == "transfer_window_closed")
    );
}

#[test]
fn free_agent_starvation_uses_deterministic_generated_replacement() {
    let mut game = game_with(
        vec![
            player("top", Some("ai-team"), LolRole::Top, Some("2028-06-30")),
            player(
                "jungle",
                Some("ai-team"),
                LolRole::Jungle,
                Some("2028-06-30"),
            ),
            player("mid", Some("ai-team"), LolRole::Mid, Some("2028-06-30")),
            player(
                "support",
                Some("ai-team"),
                LolRole::Support,
                Some("2028-06-30"),
            ),
        ],
        vec!["top", "jungle", "mid", "support"],
    );

    let report = repair_team(&mut game, "ai-team", RosterStabilityReason::PreMatch)
        .expect("generated ADC should repair free-agent starvation");

    assert!(game.players.iter().any(|player| {
        player.id == "emergency-ai-team-prematch-adc"
            && player.team_id.as_deref() == Some("ai-team")
            && player.natural_position == LolRole::Adc
    }));
    assert!(report.actions.iter().any(|action| matches!(
        action,
        RepairAction::GeneratedReplacement { player_id, role: LolRole::Adc } if player_id == "emergency-ai-team-prematch-adc"
    )));
}

#[test]
fn generated_replacement_collision_uses_next_deterministic_id() {
    let mut game = game_with(
        vec![
            player("top", Some("ai-team"), LolRole::Top, Some("2028-06-30")),
            player(
                "jungle",
                Some("ai-team"),
                LolRole::Jungle,
                Some("2028-06-30"),
            ),
            player("mid", Some("ai-team"), LolRole::Mid, Some("2028-06-30")),
            player(
                "support",
                Some("ai-team"),
                LolRole::Support,
                Some("2028-06-30"),
            ),
            player(
                "emergency-ai-team-prematch-adc",
                Some("other-ai"),
                LolRole::Adc,
                Some("2028-06-30"),
            ),
        ],
        vec!["top", "jungle", "mid", "support"],
    );

    let report = repair_team(&mut game, "ai-team", RosterStabilityReason::PreMatch)
        .expect("ID collision should still make deterministic repair progress");

    assert!(game.players.iter().any(|player| {
        player.id == "emergency-ai-team-prematch-adc-2"
            && player.team_id.as_deref() == Some("ai-team")
            && player.natural_position == LolRole::Adc
    }));
    assert!(report.actions.iter().any(|action| matches!(
        action,
        RepairAction::GeneratedReplacement { player_id, role: LolRole::Adc } if player_id == "emergency-ai-team-prematch-adc-2"
    )));
}

#[test]
fn generated_replacement_wrong_role_collision_uses_next_deterministic_id() {
    let mut game = game_with(
        vec![
            player("top", Some("ai-team"), LolRole::Top, Some("2028-06-30")),
            player(
                "jungle",
                Some("ai-team"),
                LolRole::Jungle,
                Some("2028-06-30"),
            ),
            player("mid", Some("ai-team"), LolRole::Mid, Some("2028-06-30")),
            player(
                "support",
                Some("ai-team"),
                LolRole::Support,
                Some("2028-06-30"),
            ),
            player(
                "emergency-ai-team-prematch-adc",
                Some("ai-team"),
                LolRole::Support,
                Some("2028-06-30"),
            ),
        ],
        vec![
            "top",
            "jungle",
            "mid",
            "support",
            "emergency-ai-team-prematch-adc",
        ],
    );

    let report = repair_team(&mut game, "ai-team", RosterStabilityReason::PreMatch)
        .expect("wrong-role ID collision should still make deterministic repair progress");

    assert!(game.players.iter().any(|player| {
        player.id == "emergency-ai-team-prematch-adc-2"
            && player.team_id.as_deref() == Some("ai-team")
            && player.natural_position == LolRole::Adc
    }));
    assert!(report.actions.iter().any(|action| matches!(
        action,
        RepairAction::GeneratedReplacement { player_id, role: LolRole::Adc } if player_id == "emergency-ai-team-prematch-adc-2"
    )));
}

#[test]
fn generated_replacement_uses_plausible_name_not_emergency_placeholder() {
    let mut game = game_with(
        vec![
            player("top", Some("ai-team"), LolRole::Top, Some("2028-06-30")),
            player(
                "jungle",
                Some("ai-team"),
                LolRole::Jungle,
                Some("2028-06-30"),
            ),
            player("mid", Some("ai-team"), LolRole::Mid, Some("2028-06-30")),
            player(
                "support",
                Some("ai-team"),
                LolRole::Support,
                Some("2028-06-30"),
            ),
        ],
        vec!["top", "jungle", "mid", "support"],
    );

    let report = repair_team(&mut game, "ai-team", RosterStabilityReason::PreMatch)
        .expect("generated ADC should repair free-agent starvation");

    let generated = game
        .players
        .iter()
        .find(|player| {
            player.team_id.as_deref() == Some("ai-team")
                && player.natural_position == LolRole::Adc
                && player.id.starts_with("emergency-")
        })
        .expect("generated replacement should exist");

    assert!(
        !generated.full_name.starts_with("Emergency "),
        "full_name should not be an emergency placeholder, got {}",
        generated.full_name
    );
    assert!(
        !generated.match_name.starts_with("Emergency "),
        "match_name should not be an emergency placeholder, got {}",
        generated.match_name
    );
    assert!(
        report.actions.iter().any(|action| matches!(
            action,
            RepairAction::GeneratedReplacement {
                role: LolRole::Adc,
                ..
            }
        )),
        "repair should report a generated ADC replacement"
    );
}

#[test]
fn eligible_free_agent_precludes_generated_replacement() {
    let mut players = vec![
        player("top", Some("ai-team"), LolRole::Top, Some("2028-06-30")),
        player(
            "jungle",
            Some("ai-team"),
            LolRole::Jungle,
            Some("2028-06-30"),
        ),
        player("mid", Some("ai-team"), LolRole::Mid, Some("2028-06-30")),
        player("adc", Some("ai-team"), LolRole::Adc, Some("2028-06-30")),
        player("adc2", Some("ai-team"), LolRole::Adc, Some("2028-06-30")),
        player("free-support", None, LolRole::Support, Some("2028-06-30")),
    ];
    players[5].market_value = 100_000;
    let mut game = game_with(players, vec!["top", "jungle", "mid", "adc", "adc2"]);
    game.teams[0].wage_budget = 1_000_000;

    let report = repair_team(&mut game, "ai-team", RosterStabilityReason::PreMatch)
        .expect("free support should repair role gap without generating a player");

    assert!(
        report.actions.iter().any(|action| matches!(
            action,
            RepairAction::AssignedFreeAgent { player_id, role: LolRole::Support } if player_id == "free-support"
        )),
        "repair should assign the eligible free agent"
    );
    assert!(
        !report
            .actions
            .iter()
            .any(|action| matches!(action, RepairAction::GeneratedReplacement { .. })),
        "no generated replacement should occur when an eligible free agent is available"
    );
    assert!(
        !game
            .players
            .iter()
            .any(|player| player.team_id.as_deref() == Some("ai-team")
                && player.natural_position == LolRole::Support
                && player.id.starts_with("emergency-")),
        "no emergency support player should be created"
    );
}

#[test]
fn rejected_free_agent_does_not_block_later_eligible_free_agent() {
    // ai-team is missing support. Two free-agent supports exist in deterministic
    // order. The first is too expensive for the wage policy, the second is
    // affordable. The repair must exhaust the realistic options and sign the
    // later eligible candidate instead of generating a fallback.
    //
    // Use Emergency (cap = 1) so that if a rejected candidate incorrectly
    // consumed a transfer slot, the later eligible free agent would be blocked
    // and the test would fail. PreMatch (cap = 2) was too weak: an erroneous
    // consume of one slot would still leave room for the second signing.
    let mut players = vec![
        player("top", Some("ai-team"), LolRole::Top, Some("2028-06-30")),
        player(
            "jungle",
            Some("ai-team"),
            LolRole::Jungle,
            Some("2028-06-30"),
        ),
        player("mid", Some("ai-team"), LolRole::Mid, Some("2028-06-30")),
        player("adc", Some("ai-team"), LolRole::Adc, Some("2028-06-30")),
        player(
            "a-expensive-support",
            None,
            LolRole::Support,
            Some("2028-06-30"),
        ),
        player(
            "b-affordable-support",
            None,
            LolRole::Support,
            Some("2028-06-30"),
        ),
    ];
    players[4].market_value = 3_000_000;
    players[5].market_value = 100_000;
    let mut game = game_with(players, vec!["top", "jungle", "mid", "adc"]);
    // On the LEC wage scale the 100k support asks about 144k, the 3M one about 3.6M.
    game.teams[0].wage_budget = 400_000;

    let report = repair_team(&mut game, "ai-team", RosterStabilityReason::Emergency)
        .expect("later eligible free agent should repair role gap");

    assert_eq!(
        game.players
            .iter()
            .find(|player| player.id == "b-affordable-support")
            .unwrap()
            .team_id
            .as_deref(),
        Some("ai-team"),
        "the eligible later free agent should be assigned"
    );
    assert!(
        game.players
            .iter()
            .find(|player| player.id == "a-expensive-support")
            .unwrap()
            .team_id
            .is_none(),
        "the rejected earlier free agent should remain unsigned"
    );
    assert!(
        report.actions.iter().any(|action| matches!(
            action,
            RepairAction::AssignedFreeAgent { player_id, role: LolRole::Support }
                if player_id == "b-affordable-support"
        )),
        "repair should report assigning the eligible free agent"
    );
    assert!(
        !report
            .actions
            .iter()
            .any(|action| matches!(action, RepairAction::GeneratedReplacement { .. })),
        "no generated replacement should occur when a later eligible free agent exists"
    );
    assert!(
        !game
            .players
            .iter()
            .any(|player| player.team_id.as_deref() == Some("ai-team")
                && player.natural_position == LolRole::Support
                && player.id.starts_with("emergency-")),
        "no emergency support player should be created"
    );
    assert_eq!(
        game.ai_transfer_cap_counts
            .get("ai-team")
            .map(|state| state.emergency_count)
            .unwrap_or(0),
        1,
        "only the successful signing should consume the emergency cap; rejected candidates must not"
    );
}

#[test]
fn generated_fallback_used_when_no_safe_real_acquisition_exists() {
    // ai-team is missing ADC. No free agents exist, and the only ADC in the league
    // belongs to other-ai. Emergency roster repair deliberately does not invoke the
    // strategic AI club-to-club flow inline, so a deterministic generated fallback
    // must be used instead of poaching the opponent.
    let mut game = game_with(
        vec![
            player("top", Some("ai-team"), LolRole::Top, Some("2028-06-30")),
            player(
                "jungle",
                Some("ai-team"),
                LolRole::Jungle,
                Some("2028-06-30"),
            ),
            player("mid", Some("ai-team"), LolRole::Mid, Some("2028-06-30")),
            player(
                "support",
                Some("ai-team"),
                LolRole::Support,
                Some("2028-06-30"),
            ),
            // other-ai has a full roster; its only ADC must not be poached.
            player("o-top", Some("other-ai"), LolRole::Top, Some("2028-06-30")),
            player(
                "o-jungle",
                Some("other-ai"),
                LolRole::Jungle,
                Some("2028-06-30"),
            ),
            player("o-mid", Some("other-ai"), LolRole::Mid, Some("2028-06-30")),
            player("o-adc", Some("other-ai"), LolRole::Adc, Some("2028-06-30")),
            player(
                "o-support",
                Some("other-ai"),
                LolRole::Support,
                Some("2028-06-30"),
            ),
        ],
        vec!["top", "jungle", "mid", "support"],
    );
    game.season_context.transfer_window.status = TransferWindowStatus::Closed;

    let report = repair_team(&mut game, "ai-team", RosterStabilityReason::PreMatch)
        .expect("generated ADC should repair the roster without unsafe poaching");

    assert!(
        report.actions.iter().any(|action| matches!(
            action,
            RepairAction::GeneratedReplacement {
                role: LolRole::Adc,
                ..
            }
        )),
        "repair should generate an ADC replacement"
    );
    assert!(
        !report
            .actions
            .iter()
            .any(|action| matches!(action, RepairAction::AssignedFreeAgent { .. })),
        "no free agent should be assigned when none exists"
    );
    let o_adc = game
        .players
        .iter()
        .find(|player| player.id == "o-adc")
        .expect("other-ai's ADC should still exist");
    assert_eq!(
        o_adc.team_id.as_deref(),
        Some("other-ai"),
        "other-ai's only ADC must not be poached during emergency repair"
    );
}

#[test]
fn duplicate_lineup_ids_are_not_match_eligible_until_reconciled() {
    let mut game = game_with(
        full_roster("ai-team"),
        vec!["top", "top", "mid", "adc", "support"],
    );

    let before = evaluate_team(&game, "ai-team", RosterStabilityReason::PreMatch)
        .expect("team should evaluate");
    let report = repair_team(&mut game, "ai-team", RosterStabilityReason::PreMatch)
        .expect("duplicate lineup ids should reconcile");
    let after = evaluate_team(&game, "ai-team", RosterStabilityReason::PreMatch)
        .expect("team should evaluate after repair");

    assert!(!before.match_eligible);
    assert!(after.match_eligible);
    assert_eq!(after.stale_lineup_ids, Vec::<String>::new());
    assert!(report.actions.iter().any(|action| matches!(
        action,
        RepairAction::ReconciledLineup { lineup_ids, .. } if lineup_ids == &vec![
            "top".to_string(),
            "jungle".to_string(),
            "mid".to_string(),
            "adc".to_string(),
            "support".to_string(),
        ]
    )));
}

#[test]
fn short_non_empty_lineup_is_not_match_eligible_until_reconciled() {
    let mut game = game_with(full_roster("ai-team"), vec!["top", "jungle", "mid", "adc"]);

    let before = evaluate_team(&game, "ai-team", RosterStabilityReason::PreMatch)
        .expect("team should evaluate");
    let report = repair_team(&mut game, "ai-team", RosterStabilityReason::PreMatch)
        .expect("short non-empty lineup should reconcile");
    let after = evaluate_team(&game, "ai-team", RosterStabilityReason::PreMatch)
        .expect("team should evaluate after repair");

    assert!(!before.match_eligible);
    assert!(after.match_eligible);
    assert_eq!(after.eligible_player_count, 5);
    assert!(report.actions.iter().any(|action| matches!(
        action,
        RepairAction::ReconciledLineup { lineup_ids, .. } if lineup_ids.len() == 5
    )));
}

#[test]
fn empty_lineup_is_not_match_eligible_until_reconciled() {
    let mut game = game_with(full_roster("ai-team"), vec![]);

    let before = evaluate_team(&game, "ai-team", RosterStabilityReason::PreMatch)
        .expect("team should evaluate");
    let report = repair_team(&mut game, "ai-team", RosterStabilityReason::PreMatch)
        .expect("empty lineup should reconcile when a lineup is required");
    let after = evaluate_team(&game, "ai-team", RosterStabilityReason::PreMatch)
        .expect("team should evaluate after repair");

    assert!(!before.match_eligible);
    assert!(after.match_eligible);
    assert_eq!(after.stale_lineup_ids, Vec::<String>::new());
    assert!(report.actions.iter().any(|action| matches!(
        action,
        RepairAction::ReconciledLineup { lineup_ids, .. } if lineup_ids == &vec![
            "top".to_string(),
            "jungle".to_string(),
            "mid".to_string(),
            "adc".to_string(),
            "support".to_string(),
        ]
    )));
}

#[test]
fn lineup_missing_required_role_is_not_match_eligible_until_reconciled() {
    let mut players = full_roster("ai-team");
    players.push(player(
        "adc2",
        Some("ai-team"),
        LolRole::Adc,
        Some("2028-06-30"),
    ));
    let mut game = game_with(players, vec!["top", "jungle", "mid", "adc", "adc2"]);

    let before = evaluate_team(&game, "ai-team", RosterStabilityReason::PreMatch)
        .expect("team should evaluate");
    let report = repair_team(&mut game, "ai-team", RosterStabilityReason::PreMatch)
        .expect("lineup missing support should reconcile");
    let after = evaluate_team(&game, "ai-team", RosterStabilityReason::PreMatch)
        .expect("team should evaluate after repair");

    assert!(!before.match_eligible);
    assert!(after.match_eligible);
    assert!(report.actions.iter().any(|action| matches!(
        action,
        RepairAction::ReconciledLineup { removed_ids, lineup_ids }
            if removed_ids == &vec!["adc2".to_string()]
                && lineup_ids == &vec![
                    "top".to_string(),
                    "jungle".to_string(),
                    "mid".to_string(),
                    "adc".to_string(),
                    "support".to_string(),
                ]
    )));
}

#[test]
fn generated_replacement_id_exhaustion_returns_error_without_mutating_game() {
    let mut players = vec![
        player("top", Some("ai-team"), LolRole::Top, Some("2028-06-30")),
        player(
            "jungle",
            Some("ai-team"),
            LolRole::Jungle,
            Some("2028-06-30"),
        ),
        player("mid", Some("ai-team"), LolRole::Mid, Some("2028-06-30")),
        player(
            "support",
            Some("ai-team"),
            LolRole::Support,
            Some("2028-06-30"),
        ),
    ];
    players.push(player(
        "emergency-ai-team-prematch-adc",
        Some("other-ai"),
        LolRole::Adc,
        Some("2028-06-30"),
    ));
    for suffix in 2..=17 {
        players.push(player(
            &format!("emergency-ai-team-prematch-adc-{suffix}"),
            Some("other-ai"),
            LolRole::Adc,
            Some("2028-06-30"),
        ));
    }
    let mut game = game_with(players, vec!["top", "jungle", "mid", "support"]);
    let original_players = game
        .players
        .iter()
        .map(|player| {
            (
                player.id.clone(),
                player.team_id.clone(),
                player.contract_end.clone(),
                player.natural_position,
            )
        })
        .collect::<Vec<_>>();
    let original_lineup = game
        .teams
        .iter()
        .find(|team| team.id == "ai-team")
        .unwrap()
        .active_lineup_ids
        .clone();

    let error = repair_team(&mut game, "ai-team", RosterStabilityReason::PreMatch)
        .expect_err("exhausted generated IDs should return a fatal domain error");

    assert_eq!(error.reason, RosterStabilityReason::PreMatch);
    assert_eq!(error.missing_roles, vec![LolRole::Adc]);
    assert_eq!(
        game.players
            .iter()
            .map(|player| {
                (
                    player.id.clone(),
                    player.team_id.clone(),
                    player.contract_end.clone(),
                    player.natural_position,
                )
            })
            .collect::<Vec<_>>(),
        original_players
    );
    assert_eq!(
        game.teams
            .iter()
            .find(|team| team.id == "ai-team")
            .unwrap()
            .active_lineup_ids,
        original_lineup
    );
}

#[test]
fn repair_league_repairs_all_schedulable_ai_main_teams() {
    let mut game = game_with(
        vec![
            player("top", Some("ai-team"), LolRole::Top, Some("2028-06-30")),
            player(
                "jungle",
                Some("ai-team"),
                LolRole::Jungle,
                Some("2028-06-30"),
            ),
            player("mid", Some("ai-team"), LolRole::Mid, Some("2028-06-30")),
            player("adc", Some("ai-team"), LolRole::Adc, Some("2028-06-30")),
        ],
        vec!["top", "jungle", "mid", "adc"],
    );

    let reports = repair_league(&mut game, RosterStabilityReason::LoadMigration)
        .expect("league repair should repair schedulable AI teams through the PR1 seam");
    let evaluation = evaluate_team(&game, "ai-team", RosterStabilityReason::LoadMigration)
        .expect("team should evaluate after repair");

    assert_eq!(reports.len(), 2);
    assert!(reports.iter().any(|report| report.team_id == "ai-team"
        && report.reason == RosterStabilityReason::LoadMigration));
    assert!(evaluation.match_eligible);
}

#[test]
fn repair_league_error_does_not_commit_partial_team_repairs() {
    let mut players = vec![
        player("top", Some("ai-team"), LolRole::Top, Some("2028-06-30")),
        player(
            "jungle",
            Some("ai-team"),
            LolRole::Jungle,
            Some("2028-06-30"),
        ),
        player("mid", Some("ai-team"), LolRole::Mid, Some("2028-06-30")),
        player("adc", Some("ai-team"), LolRole::Adc, Some("2028-06-30")),
        player(
            "other-top",
            Some("other-ai"),
            LolRole::Top,
            Some("2028-06-30"),
        ),
        player(
            "other-jungle",
            Some("other-ai"),
            LolRole::Jungle,
            Some("2028-06-30"),
        ),
        player(
            "other-mid",
            Some("other-ai"),
            LolRole::Mid,
            Some("2028-06-30"),
        ),
        player(
            "other-support",
            Some("other-ai"),
            LolRole::Support,
            Some("2028-06-30"),
        ),
    ];
    players.push(player(
        "emergency-other-ai-load-migration-adc",
        Some("ai-team"),
        LolRole::Adc,
        Some("2028-06-30"),
    ));
    for suffix in 2..=17 {
        players.push(player(
            &format!("emergency-other-ai-load-migration-adc-{suffix}"),
            Some("ai-team"),
            LolRole::Adc,
            Some("2028-06-30"),
        ));
    }
    let mut game = game_with(players, vec!["top", "jungle", "mid", "adc"]);
    let original_players = game
        .players
        .iter()
        .map(|player| {
            (
                player.id.clone(),
                player.team_id.clone(),
                player.contract_end.clone(),
                player.natural_position,
            )
        })
        .collect::<Vec<_>>();
    let original_teams = game
        .teams
        .iter()
        .map(|team| (team.id.clone(), team.active_lineup_ids.clone()))
        .collect::<Vec<_>>();

    let error = repair_league(&mut game, RosterStabilityReason::LoadMigration)
        .expect_err("league repair should fail atomically when any team cannot be repaired");

    assert_eq!(error.team_id, "other-ai");
    assert_eq!(error.missing_roles, vec![LolRole::Adc]);
    assert_eq!(
        game.players
            .iter()
            .map(|player| {
                (
                    player.id.clone(),
                    player.team_id.clone(),
                    player.contract_end.clone(),
                    player.natural_position,
                )
            })
            .collect::<Vec<_>>(),
        original_players
    );
    assert_eq!(
        game.teams
            .iter()
            .map(|team| (team.id.clone(), team.active_lineup_ids.clone()))
            .collect::<Vec<_>>(),
        original_teams
    );
}

#[test]
fn evaluate_team_missing_team_uses_supplied_reason() {
    let game = game_with(
        full_roster("ai-team"),
        vec!["top", "jungle", "mid", "adc", "support"],
    );

    let error = evaluate_team(&game, "missing-team", RosterStabilityReason::LoadMigration)
        .expect_err("missing team should include caller context in error");

    assert_eq!(error.reason, RosterStabilityReason::LoadMigration);
    assert_eq!(error.team_id, "missing-team");
}

// ---------------------------------------------------------------------------
// Phase 3 — Load / rehydration tests
// ---------------------------------------------------------------------------

#[test]
fn load_migration_repairs_ai_team_with_four_players_and_stale_lineup() {
    // GIVEN an existing save state with a non-player team
    // that has only 4 players and stale lineup IDs
    let mut game = game_with(
        vec![
            player("top", Some("ai-team"), LolRole::Top, Some("2028-06-30")),
            player(
                "jungle",
                Some("ai-team"),
                LolRole::Jungle,
                Some("2028-06-30"),
            ),
            player("mid", Some("ai-team"), LolRole::Mid, Some("2028-06-30")),
            player("adc", Some("ai-team"), LolRole::Adc, Some("2028-06-30")),
        ],
        vec!["top", "stale-player-id", "mid", "adc"],
    );

    // Before repair: not match eligible, stale lineup
    let before = evaluate_team(&game, "ai-team", RosterStabilityReason::LoadMigration)
        .expect("team should evaluate before repair");
    assert!(!before.match_eligible);
    assert!(
        before
            .stale_lineup_ids
            .contains(&"stale-player-id".to_string())
    );

    // WHEN repair_league runs with LoadMigration reason
    let reports = repair_league(&mut game, RosterStabilityReason::LoadMigration)
        .expect("load migration should repair the league");

    // THEN the team is match eligible (5 players, valid lineup)
    let after = evaluate_team(&game, "ai-team", RosterStabilityReason::LoadMigration)
        .expect("team should evaluate after repair");
    assert!(after.match_eligible);
    assert_eq!(after.eligible_player_count, 5);
    assert!(after.stale_lineup_ids.is_empty());

    // AND the report captures the repair actions
    let ai_report = reports
        .iter()
        .find(|r| r.team_id == "ai-team")
        .expect("ai-team should have a report");
    assert!(
        !ai_report.actions.is_empty(),
        "load migration repair should produce actions"
    );

    // AND the stale lineup ID is gone
    let lineup = game
        .teams
        .iter()
        .find(|t| t.id == "ai-team")
        .unwrap()
        .active_lineup_ids
        .clone();
    assert_eq!(lineup.len(), 5);
    assert!(
        !lineup.contains(&"stale-player-id".to_string()),
        "stale player should be removed from lineup"
    );
}

#[test]
fn load_migration_does_not_generate_emergency_players_for_user_team() {
    // GIVEN a user-managed team and an AI team, both with 4 players
    let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 8, 1, 12, 0, 0).unwrap());
    let mut manager = Manager::new(
        "mgr-1".to_string(),
        "Test".to_string(),
        "User".to_string(),
        "1980-01-01".to_string(),
        "Spain".to_string(),
    );
    manager.hire("user-team".to_string());

    let mut game = Game::new(
        clock,
        manager,
        vec![
            team(
                "user-team",
                Some("mgr-1"),
                vec!["top", "jungle", "mid", "adc"],
            ),
            team("ai-team", None, vec!["a-top", "a-jungle", "a-mid", "a-adc"]),
        ],
        vec![
            // User team players — only 4, missing support
            player("top", Some("user-team"), LolRole::Top, Some("2028-06-30")),
            player(
                "jungle",
                Some("user-team"),
                LolRole::Jungle,
                Some("2028-06-30"),
            ),
            player("mid", Some("user-team"), LolRole::Mid, Some("2028-06-30")),
            player("adc", Some("user-team"), LolRole::Adc, Some("2028-06-30")),
            // AI team players — only 4, missing support
            player("a-top", Some("ai-team"), LolRole::Top, Some("2028-06-30")),
            player(
                "a-jungle",
                Some("ai-team"),
                LolRole::Jungle,
                Some("2028-06-30"),
            ),
            player("a-mid", Some("ai-team"), LolRole::Mid, Some("2028-06-30")),
            player("a-adc", Some("ai-team"), LolRole::Adc, Some("2028-06-30")),
        ],
        vec![],
        vec![],
    );
    game.leagues = vec![league_with_team("ai-team")];
    game.leagues[0]
        .standings
        .push(StandingEntry::new("user-team".to_string()));
    game.user_competition_id = Some("competition-1".to_string());

    // Verify user team is ineligible before (no repair expected for user teams)
    let user_before = evaluate_team(&game, "user-team", RosterStabilityReason::LoadMigration)
        .expect("user team should evaluate");
    assert!(!user_before.match_eligible);

    // WHEN repair_league runs with LoadMigration
    let reports = repair_league(&mut game, RosterStabilityReason::LoadMigration)
        .expect("load migration should succeed");

    // THEN the AI team is repaired and match eligible
    let ai_after = evaluate_team(&game, "ai-team", RosterStabilityReason::LoadMigration)
        .expect("ai-team should evaluate");
    assert!(
        ai_after.match_eligible,
        "AI team should be eligible after load migration"
    );
    assert_eq!(ai_after.eligible_player_count, 5);

    // AND the user team did NOT receive emergency generated players
    let user_emergency: Vec<_> = game
        .players
        .iter()
        .filter(|p| p.team_id.as_deref() == Some("user-team"))
        .filter(|p| p.id.starts_with("emergency-"))
        .collect();
    assert!(
        user_emergency.is_empty(),
        "user team should not get emergency generated players"
    );

    // AND repair_league report includes ai-team but NOT user-team
    assert!(
        reports.iter().any(|r| r.team_id == "ai-team"),
        "ai-team should have a repair report"
    );
    assert!(
        !reports.iter().any(|r| r.team_id == "user-team"),
        "user-team should not appear in repair reports"
    );
}

// ---------------------------------------------------------------------------
// Phase 3 — Pre-match / simulation precondition tests
// ---------------------------------------------------------------------------

#[test]
fn pre_match_repair_fixes_invalid_ai_opponent() {
    // GIVEN a scheduled match where the opponent AI team has an invalid roster
    // (missing support role)
    let mut game = game_with(
        vec![
            player("top", Some("ai-team"), LolRole::Top, Some("2028-06-30")),
            player(
                "jungle",
                Some("ai-team"),
                LolRole::Jungle,
                Some("2028-06-30"),
            ),
            player("mid", Some("ai-team"), LolRole::Mid, Some("2028-06-30")),
            player("adc", Some("ai-team"), LolRole::Adc, Some("2028-06-30")),
            // opponent (other-ai) is missing support
            player("o-top", Some("other-ai"), LolRole::Top, Some("2028-06-30")),
            player(
                "o-jungle",
                Some("other-ai"),
                LolRole::Jungle,
                Some("2028-06-30"),
            ),
            player("o-mid", Some("other-ai"), LolRole::Mid, Some("2028-06-30")),
            player("o-adc", Some("other-ai"), LolRole::Adc, Some("2028-06-30")),
        ],
        vec!["top", "jungle", "mid", "adc", "adc"], // ai-team has adc-duplicate lineup
    );
    // Make other-ai schedulable in the league
    game.leagues[0]
        .standings
        .push(StandingEntry::new("other-ai".to_string()));
    game.leagues[0].fixtures.push(Fixture {
        id: "fixture-2".to_string(),
        matchday: 1,
        date: "2026-08-02".to_string(),
        home_team_id: "other-ai".to_string(),
        away_team_id: "ai-team".to_string(),
        match_type: MatchType::League,
        best_of: 1,
        status: FixtureStatus::Scheduled,
        result: None,
    });

    // Before: other-ai is not match eligible (missing support)
    let other_before = evaluate_team(&game, "other-ai", RosterStabilityReason::PreMatch)
        .expect("other-ai should evaluate");
    assert!(!other_before.match_eligible);

    // WHEN pre-match repair runs on the opponent
    let report = repair_team(&mut game, "other-ai", RosterStabilityReason::PreMatch)
        .expect("pre-match repair should fix opponent roster");

    // THEN the opponent is match eligible
    let other_after = evaluate_team(&game, "other-ai", RosterStabilityReason::PreMatch)
        .expect("other-ai should evaluate after repair");
    assert!(
        other_after.match_eligible,
        "opponent should be eligible after pre-match repair"
    );
    assert_eq!(other_after.eligible_player_count, 5);
    assert!(
        other_after.missing_roles.is_empty(),
        "all roles should be covered after pre-match repair"
    );

    // AND the repair action captures a generated replacement for the missing role
    assert!(
        report.actions.iter().any(|a| matches!(
            a,
            RepairAction::GeneratedReplacement {
                role: LolRole::Support,
                ..
            }
        )),
        "repair should generate a support replacement for the opponent"
    );
}

#[test]
fn pre_match_repair_exhaustion_returns_fatal_error() {
    // GIVEN an opponent AI team with an invalid roster
    // AND all emergency generated player IDs are exhausted for the missing role
    let mut players = vec![
        player("o-top", Some("other-ai"), LolRole::Top, Some("2028-06-30")),
        player(
            "o-jungle",
            Some("other-ai"),
            LolRole::Jungle,
            Some("2028-06-30"),
        ),
        player("o-mid", Some("other-ai"), LolRole::Mid, Some("2028-06-30")),
        player(
            "o-support",
            Some("other-ai"),
            LolRole::Support,
            Some("2028-06-30"),
        ),
    ];
    // Exhaust all emergency ID slots for other-ai prematch adc
    players.push(player(
        "emergency-other-ai-prematch-adc",
        Some("ai-team"),
        LolRole::Adc,
        Some("2028-06-30"),
    ));
    for suffix in 2..=17 {
        players.push(player(
            &format!("emergency-other-ai-prematch-adc-{suffix}"),
            Some("ai-team"),
            LolRole::Adc,
            Some("2028-06-30"),
        ));
    }

    let mut game = game_with(players, vec![]);
    game.leagues[0]
        .standings
        .push(StandingEntry::new("other-ai".to_string()));

    // WHEN repair_team is called with PreMatch reason
    let error = repair_team(&mut game, "other-ai", RosterStabilityReason::PreMatch)
        .expect_err("exhausted emergency IDs should return a fatal domain error");

    // THEN the error identifies the team and the unmet invariant
    assert_eq!(
        error.team_id, "other-ai",
        "error should identify the failing team"
    );
    assert_eq!(
        error.reason,
        RosterStabilityReason::PreMatch,
        "error should preserve the PreMatch reason"
    );
    assert_eq!(
        error.missing_roles,
        vec![LolRole::Adc],
        "error should identify the missing role"
    );
    // AND no emergency player for the exhausted role was added
    assert!(
        !game.players.iter().any(|p| {
            p.id.starts_with("emergency-other-ai-prematch-adc")
                && p.team_id.as_deref() == Some("other-ai")
        }),
        "no emergency ADC should have been added to other-ai"
    );
}

#[test]
fn background_simulation_repair_fixes_all_ai_teams() {
    // GIVEN background league teams with incomplete rosters
    let mut game = game_with(
        vec![
            player("top", Some("ai-team"), LolRole::Top, Some("2028-06-30")),
            player(
                "jungle",
                Some("ai-team"),
                LolRole::Jungle,
                Some("2028-06-30"),
            ),
            player("mid", Some("ai-team"), LolRole::Mid, Some("2028-06-30")),
            player("adc", Some("ai-team"), LolRole::Adc, Some("2028-06-30")),
            // other-ai is missing support
            player("o-top", Some("other-ai"), LolRole::Top, Some("2028-06-30")),
            player(
                "o-jungle",
                Some("other-ai"),
                LolRole::Jungle,
                Some("2028-06-30"),
            ),
            player("o-mid", Some("other-ai"), LolRole::Mid, Some("2028-06-30")),
            player("o-adc", Some("other-ai"), LolRole::Adc, Some("2028-06-30")),
        ],
        vec!["top", "jungle", "mid", "adc"],
    );
    // Make other-ai schedulable
    game.leagues[0]
        .standings
        .push(StandingEntry::new("other-ai".to_string()));

    // Verify both teams are ineligible before repair
    let ai_before = evaluate_team(
        &game,
        "ai-team",
        RosterStabilityReason::BackgroundSimulation,
    )
    .expect("ai-team should evaluate");
    assert!(!ai_before.match_eligible);
    let other_before = evaluate_team(
        &game,
        "other-ai",
        RosterStabilityReason::BackgroundSimulation,
    )
    .expect("other-ai should evaluate");
    assert!(!other_before.match_eligible);

    // WHEN repair_league runs with BackgroundSimulation reason
    let reports = repair_league(&mut game, RosterStabilityReason::BackgroundSimulation)
        .expect("background simulation repair should succeed");

    // THEN all AI teams are match eligible
    let ai_after = evaluate_team(
        &game,
        "ai-team",
        RosterStabilityReason::BackgroundSimulation,
    )
    .expect("ai-team should evaluate after repair");
    assert!(
        ai_after.match_eligible,
        "ai-team should be eligible after background simulation repair"
    );
    assert_eq!(
        ai_after.eligible_player_count, 5,
        "ai-team should have 5 eligible players"
    );

    let other_after = evaluate_team(
        &game,
        "other-ai",
        RosterStabilityReason::BackgroundSimulation,
    )
    .expect("other-ai should evaluate after repair");
    assert!(
        other_after.match_eligible,
        "other-ai should be eligible after background simulation repair"
    );
    assert_eq!(
        other_after.eligible_player_count, 5,
        "other-ai should have 5 eligible players"
    );

    // AND both AI teams report repair actions
    assert!(
        reports.iter().any(|r| r.team_id == "ai-team"),
        "ai-team should have a repair report"
    );
    assert!(
        reports.iter().any(|r| r.team_id == "other-ai"),
        "other-ai should have a repair report"
    );
}

#[test]
fn repair_assigns_free_agent_with_non_zero_wage_and_term() {
    let mut players = vec![
        player("top", Some("ai-team"), LolRole::Top, Some("2028-06-30")),
        player(
            "jungle",
            Some("ai-team"),
            LolRole::Jungle,
            Some("2028-06-30"),
        ),
        player("mid", Some("ai-team"), LolRole::Mid, Some("2028-06-30")),
        player("adc", Some("ai-team"), LolRole::Adc, Some("2028-06-30")),
        player("adc2", Some("ai-team"), LolRole::Adc, Some("2028-06-30")),
        player("free-support", None, LolRole::Support, Some("2028-06-30")),
    ];
    // The wage sits above the LEC-scale floor of a 2M player (about 2.4M), so only the
    // multipliers move it.
    players[5].wage = 2_500_000;
    players[5].market_value = 2_000_000;
    players[5].morale = 40;
    players[5].date_of_birth = "2002-01-01".to_string();
    let mut game = game_with(players, vec!["top", "jungle", "mid", "adc", "adc2"]);
    game.teams[0].reputation = 30;
    game.teams[0].wage_budget = 5_000_000;

    repair_team(&mut game, "ai-team", RosterStabilityReason::PreMatch)
        .expect("free support should repair role gap");

    let assigned = game
        .players
        .iter()
        .find(|player| player.id == "free-support")
        .unwrap();
    assert_eq!(assigned.team_id.as_deref(), Some("ai-team"));
    // 2_500_000 * 1.05 (age <= 27) * 1.10 (morale <= 50) * 1.18 (market_value >= 2M)
    // * 1.05 (reputation < 40) = 3_578_000 after rounding.
    assert_eq!(assigned.wage, 3_578_000);
    assert!(assigned.contract_end.is_some());
}

#[test]
fn repair_assigns_free_agent_with_history_terms_matching_player_state() {
    let mut players = vec![
        player("top", Some("ai-team"), LolRole::Top, Some("2028-06-30")),
        player(
            "jungle",
            Some("ai-team"),
            LolRole::Jungle,
            Some("2028-06-30"),
        ),
        player("mid", Some("ai-team"), LolRole::Mid, Some("2028-06-30")),
        player("adc", Some("ai-team"), LolRole::Adc, Some("2028-06-30")),
        player("adc2", Some("ai-team"), LolRole::Adc, Some("2028-06-30")),
        player("free-support", None, LolRole::Support, Some("2028-06-30")),
    ];
    players[5].wage = 120_000;
    players[5].market_value = 600_000;
    let mut game = game_with(players, vec!["top", "jungle", "mid", "adc", "adc2"]);
    game.teams[0].wage_budget = 1_000_000;

    repair_team(&mut game, "ai-team", RosterStabilityReason::ContractExpired)
        .expect("free support should repair role gap");

    let assigned = game
        .players
        .iter()
        .find(|player| player.id == "free-support")
        .unwrap();
    let entry = get_transfer_history(&game)
        .into_iter()
        .find(|entry| entry.player_id == "free-support")
        .expect("repair signing should be recorded in transfer history");
    assert_eq!(
        assigned.wage, entry.annual_wage,
        "player wage and history annual_wage must match"
    );
    assert!(
        entry.contract_years > 0,
        "history contract_years should be realistic, got {}",
        entry.contract_years
    );
    assert!(
        assigned
            .contract_end
            .as_ref()
            .is_some_and(|contract_end| contract_end
                .starts_with(&(2026 + i32::from(entry.contract_years)).to_string())),
        "player contract_end must match history contract_years"
    );
}

fn elite_game_with_low_impact_free_agent(reason: RosterStabilityReason) -> (Game, String) {
    let mut players = vec![
        player("top", Some("ai-team"), LolRole::Top, Some("2028-06-30")),
        player(
            "jungle",
            Some("ai-team"),
            LolRole::Jungle,
            Some("2028-06-30"),
        ),
        player("mid", Some("ai-team"), LolRole::Mid, Some("2028-06-30")),
        player("adc", Some("ai-team"), LolRole::Adc, Some("2028-06-30")),
    ];
    let mut free_agent = player("free-support", None, LolRole::Support, Some("2028-06-30"));
    free_agent.wage = 30_000;
    free_agent.market_value = 100_000;
    free_agent.lol_ovr = 60;
    players.push(free_agent);

    let mut game = game_with(players, vec!["top", "jungle", "mid", "adc"]);
    game.teams[0].reputation = 1_200;
    game.teams[0].competition_id = Some("competition-1".to_string());
    game.teams[0].wage_budget = 500_000;
    game.leagues = vec![League {
        id: "league-1".to_string(),
        name: "League One".to_string(),
        season: 2026,
        fixtures: vec![Fixture {
            id: "fixture-1".to_string(),
            matchday: 1,
            date: "2026-08-02".to_string(),
            home_team_id: "ai-team".to_string(),
            away_team_id: "other-ai".to_string(),
            match_type: MatchType::League,
            best_of: 1,
            status: FixtureStatus::Scheduled,
            result: None,
        }],
        standings: vec![StandingEntry::new("ai-team".to_string())],
        competition_id: Some("competition-1".to_string()),
        logo: None,
        league_kind: LeagueKind::Main,
        split_index: 0,
        tier: 1,
        active: true,
    }];

    if let RosterStabilityReason::Emergency = reason {
        // ensure the generated player ID namespace is free so we can tell
        // whether the free agent was actually assigned vs. a generated fallback
        game.players
            .retain(|p| !p.id.starts_with("emergency-ai-team"));
    }

    (game, "free-support".to_string())
}

#[test]
fn emergency_repair_allows_low_impact_free_agent_at_tier_one() {
    let (mut game, fa_id) = elite_game_with_low_impact_free_agent(RosterStabilityReason::Emergency);

    repair_team(&mut game, "ai-team", RosterStabilityReason::Emergency)
        .expect("emergency repair should succeed");

    let assigned = game.players.iter().find(|p| p.id == fa_id).unwrap();
    assert_eq!(assigned.team_id.as_deref(), Some("ai-team"));
    assert!(assigned.wage > 0);
    assert!(assigned.contract_end.is_some());

    let entry = get_transfer_history(&game)
        .into_iter()
        .find(|entry| entry.player_id == fa_id)
        .expect("emergency repair signing should appear in history");
    assert_eq!(entry.annual_wage, assigned.wage);
    assert!(entry.contract_years > 0);
    assert!(
        assigned
            .contract_end
            .as_ref()
            .is_some_and(|contract_end| contract_end
                .starts_with(&(2026 + i32::from(entry.contract_years)).to_string())),
        "player contract_end must match history contract_years"
    );
}

#[test]
fn non_emergency_repair_rejects_low_impact_free_agent_at_tier_one() {
    let (mut game, fa_id) =
        elite_game_with_low_impact_free_agent(RosterStabilityReason::BackgroundSimulation);

    repair_team(
        &mut game,
        "ai-team",
        RosterStabilityReason::BackgroundSimulation,
    )
    .expect("repair should fall back to generated replacement");

    let free_agent = game.players.iter().find(|p| p.id == fa_id).unwrap();
    assert_ne!(
        free_agent.team_id.as_deref(),
        Some("ai-team"),
        "low-impact free agent should be rejected by non-emergency repair"
    );

    assert!(
        game.players.iter().any(|p| {
            p.team_id.as_deref() == Some("ai-team") && p.natural_position == LolRole::Support
        }),
        "a replacement support should still be on the team"
    );
}

fn short_roster(team_id: &str) -> Vec<Player> {
    vec![
        player("top", Some(team_id), LolRole::Top, Some("2028-06-30")),
        player("mid", Some(team_id), LolRole::Mid, Some("2028-06-30")),
        player("adc", Some(team_id), LolRole::Adc, Some("2028-06-30")),
    ]
}

fn player_snapshot(game: &Game) -> Vec<(String, Option<String>, Option<String>)> {
    game.players
        .iter()
        .map(|p| (p.id.clone(), p.team_id.clone(), p.contract_end.clone()))
        .collect()
}

fn team_role_ids(game: &Game, team_id: &str, role: LolRole) -> Vec<String> {
    game.players
        .iter()
        .filter(|p| p.team_id.as_deref() == Some(team_id) && p.natural_position == role)
        .map(|p| p.id.clone())
        .collect()
}

#[test]
fn new_game_fill_assigns_free_agents_by_natural_position_in_id_order() {
    let mut players = short_roster("ai-team");
    players.push(player("fa-jungle-b", None, LolRole::Jungle, None));
    players.push(player("fa-jungle-a", None, LolRole::Jungle, None));
    players.push(player("fa-support", None, LolRole::Support, None));
    players.push(player("fa-top", None, LolRole::Top, None));
    let mut game = game_with(players, vec![]);
    game.teams[1].team_kind = TeamKind::Academy;

    let fills = fill_new_game_rosters(&mut game);

    assert_eq!(
        fills,
        vec![
            NewGameRosterFill {
                team_id: "ai-team".to_string(),
                player_id: "fa-jungle-a".to_string(),
                role: LolRole::Jungle,
                generated: false,
            },
            NewGameRosterFill {
                team_id: "ai-team".to_string(),
                player_id: "fa-support".to_string(),
                role: LolRole::Support,
                generated: false,
            },
        ]
    );
    let filled = game.players.iter().find(|p| p.id == "fa-jungle-a").unwrap();
    assert_eq!(filled.team_id.as_deref(), Some("ai-team"));
    assert_eq!(filled.contract_end.as_deref(), Some("2027-11-30"));
    let untouched = game.players.iter().find(|p| p.id == "fa-jungle-b").unwrap();
    assert_eq!(untouched.team_id, None);
    let spare_top = game.players.iter().find(|p| p.id == "fa-top").unwrap();
    assert_eq!(spare_top.team_id, None);
}

#[test]
fn new_game_fill_makes_the_team_match_eligible_without_side_effects() {
    let mut players = short_roster("ai-team");
    players.push(player("fa-jungle", None, LolRole::Jungle, None));
    players.push(player("fa-support", None, LolRole::Support, None));
    let mut game = game_with(players, vec![]);

    fill_new_game_rosters(&mut game);

    let evaluation = evaluate_team(&game, "ai-team", RosterStabilityReason::LoadMigration).unwrap();
    assert!(evaluation.missing_roles.is_empty());
    assert!(get_transfer_history(&game).is_empty());
    assert!(game.messages.is_empty());
}

#[test]
fn new_game_fill_also_fills_the_user_managed_team() {
    let mut players = short_roster("ai-team");
    players.push(player("fa-jungle", None, LolRole::Jungle, None));
    players.push(player("fa-support", None, LolRole::Support, None));
    let mut game = game_with(players, vec![]);
    game.teams[1].team_kind = TeamKind::Academy;
    game.teams[0].manager_id = Some("manager-1".to_string());

    let fills = fill_new_game_rosters(&mut game);

    assert_eq!(fills.len(), 2);
    assert_eq!(
        team_role_ids(&game, "ai-team", LolRole::Jungle),
        vec!["fa-jungle"]
    );
    assert_eq!(
        team_role_ids(&game, "ai-team", LolRole::Support),
        vec!["fa-support"]
    );
}

#[test]
fn new_game_fill_leaves_a_full_team_untouched() {
    let mut players = full_roster("ai-team");
    players.push(player("fa-top", None, LolRole::Top, None));
    let mut game = game_with(players, vec![]);
    game.teams[1].team_kind = TeamKind::Academy;
    let before = player_snapshot(&game);

    let fills = fill_new_game_rosters(&mut game);

    assert!(fills.is_empty());
    assert_eq!(player_snapshot(&game), before);
}

#[test]
fn new_game_fill_generates_a_player_when_the_pool_lacks_the_role() {
    let mut players = full_roster("ai-team");
    players.retain(|p| p.id != "support");
    players.push(player("fa-top", None, LolRole::Top, None));
    let mut game = game_with(players, vec![]);
    game.teams[1].team_kind = TeamKind::Academy;

    let fills = fill_new_game_rosters(&mut game);

    assert_eq!(fills.len(), 1);
    assert!(fills[0].generated);
    assert_eq!(fills[0].role, LolRole::Support);
    assert!(fills[0].player_id.starts_with("emergency-"));
    assert_eq!(
        team_role_ids(&game, "ai-team", LolRole::Support),
        vec![fills[0].player_id.clone()]
    );
}

#[test]
fn new_game_fill_ignores_released_and_expired_free_agents() {
    let mut players = short_roster("ai-team");
    players.push(player("fa-support", None, LolRole::Support, None));
    players[3].was_released = true;
    players.push(player(
        "fa-jungle",
        None,
        LolRole::Jungle,
        Some("2020-01-01"),
    ));
    let mut game = game_with(players, vec![]);
    game.teams[1].team_kind = TeamKind::Academy;

    let fills = fill_new_game_rosters(&mut game);

    assert_eq!(fills.len(), 2);
    assert!(fills.iter().all(|fill| fill.generated));
}

#[test]
fn new_game_fill_is_deterministic_and_does_not_share_a_free_agent_between_teams() {
    let mut players = vec![
        player("fa-top-1", None, LolRole::Top, None),
        player("fa-top-2", None, LolRole::Top, None),
    ];
    for team_id in ["ai-team", "other-ai"] {
        players.push(player(
            &format!("{team_id}-jg"),
            Some(team_id),
            LolRole::Jungle,
            Some("2028-06-30"),
        ));
        players.push(player(
            &format!("{team_id}-mid"),
            Some(team_id),
            LolRole::Mid,
            Some("2028-06-30"),
        ));
        players.push(player(
            &format!("{team_id}-adc"),
            Some(team_id),
            LolRole::Adc,
            Some("2028-06-30"),
        ));
        players.push(player(
            &format!("{team_id}-sup"),
            Some(team_id),
            LolRole::Support,
            Some("2028-06-30"),
        ));
    }
    let mut first = game_with(players.clone(), vec![]);
    let mut second = game_with(players, vec![]);

    let fills = fill_new_game_rosters(&mut first);
    fill_new_game_rosters(&mut second);

    assert_eq!(
        team_role_ids(&first, "ai-team", LolRole::Top),
        vec!["fa-top-1"]
    );
    assert_eq!(
        team_role_ids(&first, "other-ai", LolRole::Top),
        vec!["fa-top-2"]
    );
    assert_eq!(fills.len(), 2);
    assert_eq!(player_snapshot(&first), player_snapshot(&second));
}

fn rated(mut player: Player, level: u8, wage: u32) -> Player {
    player.attributes = PlayerAttributes {
        mental_resilience: level,
        champion_pool: level,
        laning: level,
        mechanics: level,
        macro_play: level,
        consistency: level,
        discipline: level,
        teamfighting: level,
        shotcalling: level,
    };
    player.wage = wage;
    player
}

fn new_game_fill_game(free_agents: Vec<Player>) -> Game {
    let mut players = full_roster("ai-team");
    players.retain(|p| p.id != "support");
    players.extend(free_agents);
    let mut game = game_with(players, vec![]);
    game.teams[1].team_kind = TeamKind::Academy;
    game.teams[0].wage_budget = 400_000;
    game
}

#[test]
fn new_game_fill_picks_the_best_affordable_free_agent_over_a_lower_id_weaker_one() {
    let mut game = new_game_fill_game(vec![
        rated(player("fa-a", None, LolRole::Support, None), 50, 40_000),
        rated(player("fa-b", None, LolRole::Support, None), 80, 40_000),
        rated(player("fa-c", None, LolRole::Support, None), 65, 40_000),
    ]);

    let fills = fill_new_game_rosters(&mut game);

    assert_eq!(fills.len(), 1);
    assert_eq!(fills[0].player_id, "fa-b");
    assert!(!fills[0].generated);
}

#[test]
fn new_game_fill_skips_an_over_budget_star_for_an_affordable_player() {
    let mut game = new_game_fill_game(vec![
        rated(player("fa-star", None, LolRole::Support, None), 95, 900_000),
        rated(player("fa-solid", None, LolRole::Support, None), 70, 40_000),
        rated(player("fa-weak", None, LolRole::Support, None), 55, 30_000),
    ]);

    let fills = fill_new_game_rosters(&mut game);

    assert_eq!(fills[0].player_id, "fa-solid");
    let star = game.players.iter().find(|p| p.id == "fa-star").unwrap();
    assert_eq!(star.team_id, None);
}

#[test]
fn new_game_fill_takes_the_cheapest_free_agent_when_nobody_is_affordable() {
    let mut game = new_game_fill_game(vec![
        rated(player("fa-a", None, LolRole::Support, None), 90, 900_000),
        rated(player("fa-b", None, LolRole::Support, None), 60, 700_000),
        rated(player("fa-c", None, LolRole::Support, None), 75, 800_000),
    ]);

    let fills = fill_new_game_rosters(&mut game);

    assert_eq!(fills[0].player_id, "fa-b");
    assert!(!fills[0].generated);
}

#[test]
fn new_game_fill_spends_the_budget_across_roles_in_one_team() {
    // Budget 200k (soft cap 220k) with 150k already on payroll: only one 60k
    // signing fits, so the second role falls back to the cheapest player.
    let mut players = short_roster("ai-team");
    players.push(rated(
        player("fa-jg-star", None, LolRole::Jungle, None),
        90,
        60_000,
    ));
    players.push(rated(
        player("fa-sup-star", None, LolRole::Support, None),
        85,
        60_000,
    ));
    players.push(rated(
        player("fa-sup-cheap", None, LolRole::Support, None),
        50,
        20_000,
    ));
    // On the LEC wage scale the stars (50k market value) ask about 85k and the cheap
    // player (10k) about 37k, so a 250k budget (soft cap 275k) leaves room for one star.
    for (id, market_value) in [("fa-jg-star", 50_000), ("fa-sup-star", 50_000), ("fa-sup-cheap", 10_000)] {
        players.iter_mut().find(|p| p.id == id).unwrap().market_value = market_value;
    }
    let mut game = game_with(players, vec![]);
    game.teams[0].wage_budget = 250_000;
    game.teams[1].team_kind = TeamKind::Academy;

    let fills = fill_new_game_rosters(&mut game);

    let ids: Vec<&str> = fills.iter().map(|f| f.player_id.as_str()).collect();
    assert_eq!(ids, vec!["fa-jg-star", "fa-sup-cheap"]);
}

fn unsigned_star(id: &str, role: LolRole, level: u8, market_value: u64) -> Player {
    // Free agents in the shipped data carry no wage; a real signing pays the
    // expected wage derived from the market value.
    let mut star = rated(player(id, None, role, None), level, 0);
    star.market_value = market_value;
    star
}

#[test]
fn new_game_fill_counts_an_earlier_fill_at_its_expected_wage_against_the_budget() {
    // Payroll 60k, budget 170k (soft cap 187k). A 2M-value free agent costs
    // about 124k, so exactly one such signing fits; the second role must see
    // the first and settle for the cheap player.
    let mut players = short_roster("ai-team");
    for p in players.iter_mut() {
        p.wage = 20_000;
    }
    players.push(unsigned_star("fa-jg-star", LolRole::Jungle, 90, 2_000_000));
    players.push(unsigned_star(
        "fa-sup-star",
        LolRole::Support,
        85,
        2_000_000,
    ));
    players.push(unsigned_star("fa-sup-cheap", LolRole::Support, 50, 100_000));
    let mut game = game_with(players, vec![]);
    game.teams[1].team_kind = TeamKind::Academy;
    game.teams[0].wage_budget = 180_000;

    let fills = fill_new_game_rosters(&mut game);

    let ids: Vec<&str> = fills.iter().map(|f| f.player_id.as_str()).collect();
    assert_eq!(ids, vec!["fa-jg-star", "fa-sup-cheap"]);
}

#[test]
fn new_game_fill_orders_teams_by_reputation_so_the_stronger_club_picks_first() {
    let mut players = vec![
        rated(player("fa-top-low", None, LolRole::Top, None), 50, 30_000),
        rated(player("fa-top-high", None, LolRole::Top, None), 85, 30_000),
    ];
    for team_id in ["ai-team", "other-ai"] {
        for (suffix, role) in [
            ("jg", LolRole::Jungle),
            ("mid", LolRole::Mid),
            ("adc", LolRole::Adc),
            ("sup", LolRole::Support),
        ] {
            players.push(player(
                &format!("{team_id}-{suffix}"),
                Some(team_id),
                role,
                Some("2028-06-30"),
            ));
        }
    }
    let mut game = game_with(players, vec![]);
    game.teams[0].reputation = 400;
    game.teams[1].reputation = 900;

    fill_new_game_rosters(&mut game);

    assert_eq!(
        team_role_ids(&game, "other-ai", LolRole::Top),
        vec!["fa-top-high"]
    );
    assert_eq!(
        team_role_ids(&game, "ai-team", LolRole::Top),
        vec!["fa-top-low"]
    );
}

#[test]
fn new_game_fill_treats_the_user_team_like_any_other_team() {
    let mut game = new_game_fill_game(vec![
        rated(player("fa-a", None, LolRole::Support, None), 50, 40_000),
        rated(player("fa-b", None, LolRole::Support, None), 80, 40_000),
    ]);
    game.teams[0].manager_id = Some("manager-1".to_string());

    let fills = fill_new_game_rosters(&mut game);

    assert_eq!(fills[0].player_id, "fa-b");
}

#[test]
fn new_game_fill_by_level_is_reproducible() {
    let free_agents = vec![
        rated(player("fa-a", None, LolRole::Support, None), 70, 40_000),
        rated(player("fa-b", None, LolRole::Support, None), 70, 40_000),
    ];
    let mut first = new_game_fill_game(free_agents.clone());
    let mut second = new_game_fill_game(free_agents);

    let first_fills = fill_new_game_rosters(&mut first);
    let second_fills = fill_new_game_rosters(&mut second);

    assert_eq!(first_fills, second_fills);
    assert_eq!(first_fills[0].player_id, "fa-a");
}
