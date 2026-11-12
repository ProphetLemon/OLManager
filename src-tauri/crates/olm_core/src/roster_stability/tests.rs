//! Equivalence and failure-contract tests for `repair_team` / `repair_league`.
//!
//! The `legacy_*` functions below are the implementation as it was before repairs stopped
//! cloning the whole game for every team (copied, only renamed). The tests run both on
//! the same fixtures and require the same reports and the same resulting game.

use super::*;
use crate::clock::GameClock;
use crate::domain::league::{Fixture, FixtureStatus, League, LeagueKind, MatchType, StandingEntry};
use crate::domain::manager::Manager;
use crate::domain::team::Team;
use chrono::{TimeZone, Utc};

const REASON: RosterStabilityReason = RosterStabilityReason::BackgroundSimulation;

// ---------------------------------------------------------------------------
// Legacy reference
// ---------------------------------------------------------------------------

fn legacy_reconcile_lineup(game: &mut Game, team_id: &str, actions: &mut Vec<RepairAction>) {
    let current_date = current_date(game);
    let previous = game
        .teams
        .iter()
        .find(|team| team.id == team_id)
        .map(|team| team.active_lineup_ids.clone())
        .unwrap_or_default();
    let eligible = eligible_team_players(game, team_id, current_date);
    let lineup = REQUIRED_ROLES
        .iter()
        .filter_map(|role| {
            eligible
                .iter()
                .filter(|player| player.natural_position == *role)
                .min_by(|left, right| left.id.cmp(&right.id))
                .map(|player| player.id.clone())
        })
        .collect::<Vec<_>>();
    let eligible: Vec<Player> = eligible.into_iter().cloned().collect();
    let lineup = crate::residency::limit_lineup_ids_for(
        crate::residency::region_of_team_id(game, team_id),
        &eligible,
        team_id,
        lineup,
    );
    let lineup_set = lineup.iter().map(String::as_str).collect::<HashSet<_>>();
    let removed_ids = previous
        .iter()
        .filter(|id| !lineup_set.contains(id.as_str()))
        .cloned()
        .collect::<Vec<_>>();

    if previous != lineup {
        if let Some(team) = game.teams.iter_mut().find(|team| team.id == team_id) {
            team.active_lineup_ids = lineup.clone();
        }
        actions.push(RepairAction::ReconciledLineup {
            removed_ids,
            lineup_ids: lineup,
        });
    }
}

fn legacy_repair_team(
    game: &mut Game,
    team_id: &str,
    reason: RosterStabilityReason,
) -> Result<RosterStabilityReport, RosterStabilityError> {
    let before = evaluate_team(game, team_id, reason)?;
    let mut actions = Vec::new();
    let mut policy_exceptions = Vec::new();

    if !before.schedulable {
        return Ok(RosterStabilityReport {
            team_id: team_id.to_string(),
            reason,
            actions,
            policy_exceptions,
            after: before.clone(),
            before,
        });
    }

    let mut repaired_game = game.clone();

    renew_needed_current_players(&mut repaired_game, team_id, &mut actions);
    fill_missing_roles(&mut repaired_game, team_id, reason, &mut actions)?;
    legacy_reconcile_lineup(&mut repaired_game, team_id, &mut actions);

    let after = evaluate_team(&repaired_game, team_id, reason)?;
    if !after.match_eligible {
        return Err(error_from_evaluation(reason, &after));
    }

    if game.season_context.transfer_window.status == TransferWindowStatus::Closed
        && actions_require_transfer_window_exception(&actions)
    {
        policy_exceptions.push(POLICY_EXCEPTION_TRANSFER_WINDOW_CLOSED.to_string());
    }

    *game = repaired_game;

    Ok(RosterStabilityReport {
        team_id: team_id.to_string(),
        reason,
        actions,
        policy_exceptions,
        before,
        after,
    })
}

fn legacy_repair_league(
    game: &mut Game,
    reason: RosterStabilityReason,
) -> Result<Vec<RosterStabilityReport>, RosterStabilityError> {
    let mut team_ids = game
        .teams
        .iter()
        .filter(|team| is_schedulable_ai_main_team(game, &team.id))
        .map(|team| team.id.clone())
        .collect::<Vec<_>>();
    team_ids.sort();

    let mut repaired_game = game.clone();
    let mut reports = Vec::new();
    for team_id in team_ids {
        reports.push(legacy_repair_team(&mut repaired_game, &team_id, reason)?);
    }

    *game = repaired_game;
    Ok(reports)
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ROLES: [LolRole; 5] = [
    LolRole::Top,
    LolRole::Jungle,
    LolRole::Mid,
    LolRole::Adc,
    LolRole::Support,
];
const VALID: &str = "2027-12-31";
const EXPIRED: &str = "2026-07-31";

fn player(id: &str, team_id: Option<&str>, role: LolRole, contract_end: Option<&str>) -> Player {
    let attr = |value| PlayerAttributes {
        mental_resilience: value,
        champion_pool: value,
        laning: value,
        mechanics: value,
        macro_play: value,
        consistency: value,
        discipline: value,
        teamfighting: value,
        shotcalling: value,
    };
    let mut player = Player::new(
        id.to_string(),
        id.to_string(),
        format!("{id} Test"),
        "2000-01-01".to_string(),
        "Spain".to_string(),
        role,
        attr(60),
    );
    player.team_id = team_id.map(str::to_string);
    player.contract_end = contract_end.map(str::to_string);
    player.wage = 50_000;
    player.market_value = 500_000;
    player
}

fn team(id: &str, manager_id: Option<&str>, lineup: &[&str]) -> Team {
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
    team.active_lineup_ids = lineup.iter().map(|id| id.to_string()).collect();
    team
}

/// Five players, one per role, named `{team}-{role index}` plus an optional extra.
fn roster(team_id: &str, contract_end: &str) -> Vec<Player> {
    ROLES
        .iter()
        .enumerate()
        .map(|(index, role)| {
            player(
                &format!("{team_id}-{index}"),
                Some(team_id),
                *role,
                Some(contract_end),
            )
        })
        .collect()
}

fn canonical_lineup(team_id: &str) -> Vec<String> {
    (0..5).map(|index| format!("{team_id}-{index}")).collect()
}

fn league(team_ids: &[&str], competition: &str, kind: LeagueKind) -> League {
    League {
        id: format!("league-{competition}"),
        name: format!("League {competition}"),
        season: 2026,
        fixtures: vec![Fixture {
            id: format!("fixture-{competition}"),
            matchday: 1,
            date: "2026-08-02".to_string(),
            home_team_id: team_ids[0].to_string(),
            away_team_id: team_ids[1].to_string(),
            match_type: MatchType::League,
            best_of: 1,
            status: FixtureStatus::Scheduled,
            result: None,
        }],
        standings: team_ids
            .iter()
            .map(|id| StandingEntry::new(id.to_string()))
            .collect(),
        competition_id: Some(competition.to_string()),
        logo: None,
        league_kind: kind,
        split_index: 0,
        tier: 1,
        active: true,
    }
}

fn build_game(teams: Vec<Team>, players: Vec<Player>, leagues: Vec<League>) -> Game {
    let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 8, 1, 12, 0, 0).unwrap());
    let mut manager = Manager::new(
        "manager-1".to_string(),
        "Jane".to_string(),
        "Doe".to_string(),
        "1980-01-01".to_string(),
        "Spain".to_string(),
    );
    manager.hire("user-team".to_string());
    let mut game = Game::new(clock, manager, teams, players, vec![], vec![]);
    game.leagues = leagues;
    game.user_competition_id = Some("competition-1".to_string());
    game
}

/// Every team keeps its roster; two have a lineup that differs from the canonical one.
fn lineup_only_game() -> Game {
    let ids = ["aa", "bb", "cc", "dd", "ee"];
    let mut players = Vec::new();
    let mut teams = Vec::new();
    for id in ids {
        players.extend(roster(id, VALID));
        // An extra bench player whose id sorts after the starter of the same role.
        players.push(player(
            &format!("{id}-9"),
            Some(id),
            LolRole::Top,
            Some(VALID),
        ));
        teams.push(team(id, None, &[]));
    }
    // aa: canonical already; bb: reversed; cc: stale id; dd: bench player instead of the
    // starting top; ee: empty (never set).
    teams[0].active_lineup_ids = canonical_lineup("aa");
    teams[1].active_lineup_ids = canonical_lineup("bb").into_iter().rev().collect();
    teams[2].active_lineup_ids = vec!["ghost".to_string()];
    teams[3].active_lineup_ids = vec![
        "dd-9".to_string(),
        "dd-1".to_string(),
        "dd-2".to_string(),
        "dd-3".to_string(),
        "dd-4".to_string(),
    ];
    teams.push(team("managed", Some("user-manager"), &[]));
    players.extend(roster("managed", VALID));
    teams.push(team("outside", None, &[]));
    players.extend(roster("outside", VALID));
    players.push(player("free-agent-top", None, LolRole::Top, None));
    build_game(
        teams,
        players,
        vec![
            league(&ids, "competition-1", LeagueKind::Main),
            league(&["managed", "outside"], "competition-2", LeagueKind::Main),
        ],
    )
}

/// Adds teams that need renewals, a signing or generated players, and a lineup change.
fn roster_changing_game() -> Game {
    let mut game = lineup_only_game();
    let mut extra_players = Vec::new();
    let mut extra_teams = Vec::new();
    // ff: all five expired (renewals), gg: no jungle (signing / generated), hh: nobody.
    extra_players.extend(roster("ff", EXPIRED));
    extra_players.extend(
        roster("gg", VALID)
            .into_iter()
            .filter(|p| p.natural_position != LolRole::Jungle),
    );
    extra_players.push(player("free-agent-jungle", None, LolRole::Jungle, None));
    for id in ["ff", "gg", "hh"] {
        extra_teams.push(team(id, None, &[]));
    }
    game.teams.extend(extra_teams);
    game.players.extend(extra_players);
    game.leagues[0]
        .standings
        .extend(["ff", "gg", "hh"].map(|id| StandingEntry::new(id.to_string())));
    game
}

/// `hh` has no player and every id its generated replacements could take is already
/// used, so repairing it fails. The teams before it in order would otherwise change.
fn failing_game() -> Game {
    let mut game = lineup_only_game();
    game.teams.push(team("zz", None, &[]));
    game.leagues[0]
        .standings
        .push(StandingEntry::new("zz".to_string()));
    for role in ROLES {
        let base = generated_player_id("zz", REASON, role);
        game.players
            .push(player(&base, Some("elsewhere"), role, Some(VALID)));
        for collision in 2..=(MAX_GENERATED_PLAYER_ID_COLLISIONS + 1) {
            game.players.push(player(
                &format!("{base}-{collision}"),
                Some("elsewhere"),
                role,
                Some(VALID),
            ));
        }
    }
    game
}

fn snapshot(game: &Game) -> serde_json::Value {
    serde_json::to_value(game).expect("serialise game")
}

fn action_kinds(reports: &[RosterStabilityReport]) -> HashSet<&'static str> {
    reports
        .iter()
        .flat_map(|report| report.actions.iter())
        .map(|action| match action {
            RepairAction::RenewedContract { .. } => "renewed",
            RepairAction::AssignedFreeAgent { .. } => "assigned",
            RepairAction::GeneratedReplacement { .. } => "generated",
            RepairAction::ReconciledLineup { .. } => "reconciled",
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Same behaviour as the legacy implementation
// ---------------------------------------------------------------------------

#[test]
fn repair_league_should_match_legacy_when_only_lineups_change() {
    let mut new_game = lineup_only_game();
    let mut old_game = new_game.clone();

    let new_reports = repair_league(&mut new_game, REASON).expect("new repair");
    let old_reports = legacy_repair_league(&mut old_game, REASON).expect("legacy repair");

    assert_eq!(new_reports, old_reports);
}

#[test]
fn repair_league_should_leave_the_same_game_as_legacy_when_only_lineups_change() {
    let mut new_game = lineup_only_game();
    let mut old_game = new_game.clone();

    repair_league(&mut new_game, REASON).expect("new repair");
    legacy_repair_league(&mut old_game, REASON).expect("legacy repair");

    assert_eq!(snapshot(&new_game), snapshot(&old_game));
}

#[test]
fn lineup_only_fixture_should_exercise_reconciliation_and_nothing_else() {
    let mut game = lineup_only_game();

    let reports = repair_league(&mut game, REASON).expect("repair");

    assert_eq!(action_kinds(&reports), HashSet::from(["reconciled"]));
}

#[test]
fn repair_league_should_match_legacy_when_rosters_change() {
    let mut new_game = roster_changing_game();
    let mut old_game = new_game.clone();

    let new_reports = repair_league(&mut new_game, REASON).expect("new repair");
    let old_reports = legacy_repair_league(&mut old_game, REASON).expect("legacy repair");

    assert_eq!(new_reports, old_reports);
    assert_eq!(snapshot(&new_game), snapshot(&old_game));
}

#[test]
fn roster_changing_fixture_should_exercise_every_repair_route() {
    let mut game = roster_changing_game();

    let reports = repair_league(&mut game, REASON).expect("repair");

    let kinds = action_kinds(&reports);
    assert!(kinds.contains("renewed"), "{kinds:?}");
    assert!(kinds.contains("reconciled"), "{kinds:?}");
    assert!(
        kinds.contains("assigned") || kinds.contains("generated"),
        "{kinds:?}"
    );
}

#[test]
fn repair_team_should_match_legacy_for_every_team() {
    for team_id in [
        "aa", "bb", "cc", "dd", "ee", "ff", "gg", "hh", "managed", "outside",
    ] {
        let mut new_game = roster_changing_game();
        let mut old_game = new_game.clone();

        let new_result = repair_team(&mut new_game, team_id, REASON);
        let old_result = legacy_repair_team(&mut old_game, team_id, REASON);

        assert_eq!(new_result, old_result, "report of {team_id}");
        assert_eq!(
            snapshot(&new_game),
            snapshot(&old_game),
            "game after {team_id}"
        );
    }
}

#[test]
fn repair_team_should_match_legacy_with_the_transfer_window_closed() {
    use crate::domain::season::TransferWindowStatus;
    let mut new_game = roster_changing_game();
    new_game.season_context.transfer_window.status = TransferWindowStatus::Closed;
    let mut old_game = new_game.clone();

    let new_result = repair_team(&mut new_game, "ff", REASON);
    let old_result = legacy_repair_team(&mut old_game, "ff", REASON);

    assert_eq!(new_result, old_result);
    assert_eq!(snapshot(&new_game), snapshot(&old_game));
}

#[test]
fn repair_team_should_report_an_unknown_team_like_legacy() {
    let mut new_game = lineup_only_game();
    let mut old_game = new_game.clone();

    let new_result = repair_team(&mut new_game, "nobody", REASON);
    let old_result = legacy_repair_team(&mut old_game, "nobody", REASON);

    assert!(new_result.is_err());
    assert_eq!(new_result, old_result);
}

// ---------------------------------------------------------------------------
// Failure contract
// ---------------------------------------------------------------------------

#[test]
fn repair_league_should_return_the_legacy_error_when_a_team_cannot_be_repaired() {
    let mut new_game = failing_game();
    let mut old_game = new_game.clone();

    let new_result = repair_league(&mut new_game, REASON);
    let old_result = legacy_repair_league(&mut old_game, REASON);

    assert_eq!(new_result.as_ref().unwrap_err().team_id, "zz");
    assert_eq!(new_result, old_result);
}

#[test]
fn repair_league_should_leave_the_game_unchanged_when_a_team_cannot_be_repaired() {
    let mut game = failing_game();
    let before = snapshot(&game);

    let result = repair_league(&mut game, REASON);

    assert!(result.is_err());
    assert_eq!(snapshot(&game), before);
}

#[test]
fn repair_team_should_leave_the_game_unchanged_when_the_team_cannot_be_repaired() {
    let mut game = failing_game();
    let before = snapshot(&game);

    let result = repair_team(&mut game, "zz", REASON);

    assert!(result.is_err());
    assert_eq!(snapshot(&game), before);
}

// ---------------------------------------------------------------------------
// No whole-game copy on the common day
// ---------------------------------------------------------------------------

#[test]
fn repair_league_should_edit_the_game_in_place_when_only_lineups_change() {
    let mut game = lineup_only_game();
    let players_before = game.players.as_ptr();
    let teams_before = game.teams.as_ptr();

    repair_league(&mut game, REASON).expect("repair");

    assert_eq!(
        (game.players.as_ptr(), game.teams.as_ptr()),
        (players_before, teams_before)
    );
}

#[test]
fn repair_team_should_edit_the_game_in_place_when_only_the_lineup_changes() {
    let mut game = lineup_only_game();
    let players_before = game.players.as_ptr();

    repair_team(&mut game, "bb", REASON).expect("repair");

    assert_eq!(game.players.as_ptr(), players_before);
}

#[test]
fn schedulable_ids_should_match_the_per_team_check() {
    let game = roster_changing_game();

    let expected = {
        let mut ids = game
            .teams
            .iter()
            .filter(|team| is_schedulable_ai_main_team(&game, &team.id))
            .map(|team| team.id.clone())
            .collect::<Vec<_>>();
        ids.sort();
        ids
    };

    assert_eq!(schedulable_ai_main_team_ids(&game), expected);
}
