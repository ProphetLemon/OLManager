use crate::contract_wage_policy::{
    AiTransferKind, SigningIntent, ai_signing_policy, ai_transfer_cap_try_consume,
};
use crate::domain::player::{Player, PlayerAttributes};
use crate::domain::season::TransferWindowStatus;
use crate::domain::stats::LolRole;
use crate::domain::team::TeamKind;
use crate::game::Game;
use crate::player_rating::natural_ovr;
use crate::transfers::record_transfer;
use chrono::{Datelike, NaiveDate};
use std::collections::{HashMap, HashSet};
use std::fmt;

const MIN_MATCH_PLAYERS: usize = 5;
const MAX_REPAIR_ITERATIONS: usize = MIN_MATCH_PLAYERS;
const REQUIRED_ROLES: [LolRole; MIN_MATCH_PLAYERS] = [
    LolRole::Top,
    LolRole::Jungle,
    LolRole::Mid,
    LolRole::Adc,
    LolRole::Support,
];
const POLICY_EXCEPTION_TRANSFER_WINDOW_CLOSED: &str = "transfer_window_closed";
const EMERGENCY_PLAYER_BIRTH_DATE: &str = "2001-01-01";
const EMERGENCY_PLAYER_NATIONALITY: &str = "Generated";
const EMERGENCY_PLAYER_ATTRIBUTE_BASELINE: u8 = 55;
const EMERGENCY_PLAYER_WAGE: u32 = 50_000;
const EMERGENCY_PLAYER_MARKET_VALUE: u64 = 250_000;
const RENEWED_CONTRACT_END_MONTH_DAY: &str = "11-30";
const MAX_GENERATED_PLAYER_ID_COLLISIONS: usize = 16;

const GENERATED_FIRST_NAMES: &[&str] = &[
    "Alex", "Sam", "Noah", "Leo", "Max", "Ethan", "Lucas", "Mason", "Logan", "Ryan", "Dylan",
    "Tyler", "Jordan", "Casey", "Riley", "Quinn", "Avery", "Skyler", "Parker", "Cameron",
];
const GENERATED_LAST_NAMES: &[&str] = &[
    "Kerr", "Voss", "Pike", "Vance", "Sloan", "Reed", "Flynn", "Nash", "Hayes", "Banks", "Cole",
    "Dunn", "Grant", "Hale", "Meyer", "Page", "Stark", "Wells", "Blake", "Hunter",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RosterStabilityReason {
    ContractExpired,
    TransferOut,
    Release,
    SeasonTransition,
    PreMatch,
    BackgroundSimulation,
    LoadMigration,
    Emergency,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RepairAction {
    RenewedContract {
        player_id: String,
        role: LolRole,
    },
    AssignedFreeAgent {
        player_id: String,
        role: LolRole,
    },
    GeneratedReplacement {
        player_id: String,
        role: LolRole,
    },
    ReconciledLineup {
        removed_ids: Vec<String>,
        lineup_ids: Vec<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RosterEvaluation {
    pub team_id: String,
    pub match_eligible: bool,
    pub schedulable: bool,
    pub eligible_player_count: usize,
    pub missing_roles: Vec<LolRole>,
    pub stale_lineup_ids: Vec<String>,
    pub expired_player_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RosterStabilityReport {
    pub team_id: String,
    pub reason: RosterStabilityReason,
    pub actions: Vec<RepairAction>,
    pub policy_exceptions: Vec<String>,
    pub before: RosterEvaluation,
    pub after: RosterEvaluation,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RosterStabilityError {
    pub team_id: String,
    pub reason: RosterStabilityReason,
    pub missing_count: usize,
    pub missing_roles: Vec<LolRole>,
    pub expired_player_ids: Vec<String>,
    pub stale_lineup_ids: Vec<String>,
}

impl fmt::Display for RosterStabilityError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "team {} is not match eligible: missing_count={}, missing_roles={:?}, expired_players={:?}, stale_lineup_ids={:?}",
            self.team_id,
            self.missing_count,
            self.missing_roles,
            self.expired_player_ids,
            self.stale_lineup_ids
        )
    }
}

impl std::error::Error for RosterStabilityError {}

pub fn evaluate_team(
    game: &Game,
    team_id: &str,
    reason: RosterStabilityReason,
) -> Result<RosterEvaluation, RosterStabilityError> {
    let team = game
        .teams
        .iter()
        .find(|team| team.id == team_id)
        .ok_or_else(|| RosterStabilityError {
            team_id: team_id.to_string(),
            reason,
            missing_count: MIN_MATCH_PLAYERS,
            missing_roles: REQUIRED_ROLES.to_vec(),
            expired_player_ids: Vec::new(),
            stale_lineup_ids: Vec::new(),
        })?;

    let current_date = current_date(game);
    let eligible_players = eligible_team_players(game, team_id, current_date);
    let eligible_ids = eligible_players
        .iter()
        .map(|player| player.id.as_str())
        .collect::<HashSet<_>>();
    let eligible_roles_by_id = eligible_players
        .iter()
        .map(|player| (player.id.as_str(), player.natural_position))
        .collect::<HashMap<_, _>>();
    let stale_lineup_ids = lineup_issues(&team.active_lineup_ids, &eligible_ids);
    let lineup_is_valid = active_lineup_is_valid(&team.active_lineup_ids, &eligible_roles_by_id);
    let missing_roles = missing_roles(&eligible_players);
    let expired_player_ids = game
        .players
        .iter()
        .filter(|player| player.team_id.as_deref() == Some(team_id))
        .filter(|player| !has_current_contract(player, current_date))
        .map(|player| player.id.clone())
        .collect::<Vec<_>>();
    let match_eligible =
        eligible_players.len() >= MIN_MATCH_PLAYERS && missing_roles.is_empty() && lineup_is_valid;

    Ok(RosterEvaluation {
        team_id: team_id.to_string(),
        match_eligible,
        schedulable: is_schedulable_ai_main_team(game, team_id),
        eligible_player_count: eligible_players.len(),
        missing_roles,
        stale_lineup_ids,
        expired_player_ids,
    })
}

/// Ensure a team has a match-eligible roster by repairing any gaps.
///
/// Agent sits ABOVE this — `roster_stability` is the safety net for edge cases
/// the agent misses (mass departures, initial setup, corrupted saves, etc.).
/// The AI agent system (`ai_team_agent`, `ai_player_agent`) should prevent most
/// roster issues; this function catches whatever slips through.
pub fn repair_team(
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
    reconcile_lineup(&mut repaired_game, team_id, &mut actions);

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

/// Ensure ALL AI teams are match-eligible by repairing roster gaps across the league.
///
/// Agent sits ABOVE this — `roster_stability` is the safety net for edge cases
/// the agent misses. Called before background league simulation to guarantee
/// every AI team has a valid lineup.
pub fn repair_league(
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
        reports.push(repair_team(&mut repaired_game, &team_id, reason)?);
    }

    *game = repaired_game;
    Ok(reports)
}

/// One roster slot filled by [`fill_new_game_rosters`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewGameRosterFill {
    pub team_id: String,
    pub player_id: String,
    pub role: LolRole,
    /// `true` when no eligible free agent existed and a player was generated.
    pub generated: bool,
}

/// Give every Main team (AI and user-managed) a player for each required role
/// at the start of a new game.
///
/// Missing roles are filled from the free-agent pool by level and budget: the
/// best-rated free agent (natural overall, then lowest id) that the existing
/// AI signing policy accepts for the club's wage budget; when nobody is
/// affordable, the cheapest eligible free agent; a player is generated only
/// when the pool has nobody eligible. Unlike [`repair_team`] this is a setup
/// step: it records no transfers, news or finances, consumes no signing caps,
/// leaves the player's wage untouched and gives filled players the default
/// initial contract end.
///
/// Teams are processed by descending reputation (then id), so the clubs that
/// would realistically attract the best free agents choose first and a shared
/// pool is split reproducibly. Each signing counts toward the club's wage bill
/// before its next role is chosen.
pub fn fill_new_game_rosters(game: &mut Game) -> Vec<NewGameRosterFill> {
    let mut team_order = game
        .teams
        .iter()
        .filter(|team| team.team_kind == TeamKind::Main)
        .map(|team| (team.reputation, team.id.clone()))
        .collect::<Vec<_>>();
    team_order.sort_by(|(left_rep, left_id), (right_rep, right_id)| {
        right_rep.cmp(left_rep).then_with(|| left_id.cmp(right_id))
    });

    let current_date = current_date(game);
    let mut fills = Vec::new();
    for (_, team_id) in team_order {
        let missing = missing_roles(&eligible_team_players(game, &team_id, current_date));
        for role in missing {
            let free_agent = best_free_agent_for_new_game(game, &team_id, role, current_date);
            if let Some(index) = free_agent {
                let player_id = game.players[index].id.clone();
                let player = &mut game.players[index];
                player.team_id = Some(team_id.clone());
                player.contract_end = None;
                crate::game_setup::apply_default_initial_contract_end(std::slice::from_mut(player));
                fills.push(NewGameRosterFill {
                    team_id: team_id.clone(),
                    player_id,
                    role,
                    generated: false,
                });
            } else if let Some(player_id) = available_generated_player_id(
                game,
                &team_id,
                RosterStabilityReason::Emergency,
                role,
            ) {
                let player = generated_player(&player_id, &team_id, role, game);
                game.players.push(player);
                fills.push(NewGameRosterFill {
                    team_id: team_id.clone(),
                    player_id,
                    role,
                    generated: true,
                });
            }
        }
    }
    fills
}

/// Index of the free agent a new-game roster should take for `role`.
///
/// Best natural overall among players the signing policy accepts (emergency
/// intent, so only the wage budget gates, not club prestige); otherwise the
/// cheapest by expected wage, higher overall first. Ties break by id.
fn best_free_agent_for_new_game(
    game: &Game,
    team_id: &str,
    role: LolRole,
    current_date: NaiveDate,
) -> Option<usize> {
    let team = game.teams.iter().find(|team| team.id == team_id)?;
    let scored = free_agent_candidates(game, role, current_date)
        .into_iter()
        .map(|(id, index)| {
            let player = &game.players[index];
            let decision = ai_signing_policy(game, team, player, SigningIntent::Emergency);
            (id, index, natural_ovr(player), decision)
        })
        .collect::<Vec<_>>();

    let best_affordable = scored
        .iter()
        .filter(|(_, _, _, decision)| decision.accepted)
        .min_by(|(left_id, _, left_ovr, _), (right_id, _, right_ovr, _)| {
            right_ovr
                .total_cmp(left_ovr)
                .then_with(|| left_id.cmp(right_id))
        });
    if let Some((_, index, _, _)) = best_affordable {
        return Some(*index);
    }

    scored
        .iter()
        .min_by(
            |(left_id, _, left_ovr, left), (right_id, _, right_ovr, right)| {
                left.annual_wage
                    .cmp(&right.annual_wage)
                    .then_with(|| right_ovr.total_cmp(left_ovr))
                    .then_with(|| left_id.cmp(right_id))
            },
        )
        .map(|(_, index, _, _)| *index)
}

fn renew_needed_current_players(game: &mut Game, team_id: &str, actions: &mut Vec<RepairAction>) {
    let current_date = current_date(game);
    let mut missing = missing_roles(&eligible_team_players(game, team_id, current_date));
    let contract_end = renewed_contract_end(game);
    let mut candidate_ids = game
        .players
        .iter()
        .filter(|player| player.team_id.as_deref() == Some(team_id))
        .filter(|player| !has_current_contract(player, current_date))
        .map(|player| player.id.clone())
        .collect::<Vec<_>>();
    candidate_ids.sort();

    for player_id in candidate_ids {
        let Some(player_role) = game
            .players
            .iter()
            .find(|player| player.id == player_id)
            .map(|player| player.natural_position)
        else {
            continue;
        };
        if missing.contains(&player_role) {
            if let Some(player) = game
                .players
                .iter_mut()
                .find(|player| player.id == player_id)
            {
                player.contract_end = Some(contract_end.clone());
            }
            actions.push(RepairAction::RenewedContract {
                player_id,
                role: player_role,
            });
            missing = missing_roles(&eligible_team_players(game, team_id, current_date));
        }
    }
}

/// Fill each missing role using the tightest realistic repair route available.
///
/// Repair priority per role:
/// 1. Renew an existing team player whose contract expired (handled before this loop).
/// 2. Sign an eligible free agent who matches the role and passes the AI signing policy.
/// 3. Acquire from another club. **This step is intentionally not implemented.**
///    The codebase does have a direct AI club-to-club path elsewhere
///    (`simulate_ai_club_to_club_transfers -> execute_transfer`), but emergency roster
///    repair deliberately does not invoke it inline. Club-to-club transfers are a
///    separate strategic flow with market, window, budget, and seller-impact semantics;
///    running them here would blur that flow with this narrow invariant safety seam.
///    Therefore, when the free-agent pool is exhausted, the deterministic fallback in
///    step 4 remains the final safety net.
/// 4. Generate a deterministic last-resort fallback player. Internal emergency IDs and
///    audit actions are preserved; display names are plausible rather than "Emergency ...".
fn fill_missing_roles(
    game: &mut Game,
    team_id: &str,
    reason: RosterStabilityReason,
    actions: &mut Vec<RepairAction>,
) -> Result<(), RosterStabilityError> {
    for _ in 0..MAX_REPAIR_ITERATIONS {
        let evaluation = evaluate_team(game, team_id, reason).expect("team already evaluated");
        if evaluation.eligible_player_count >= MIN_MATCH_PLAYERS
            && evaluation.missing_roles.is_empty()
        {
            return Ok(());
        }

        let role = evaluation
            .missing_roles
            .first()
            .copied()
            .unwrap_or_else(|| first_uncovered_extra_role(game, team_id));

        if let Some(player_id) = assign_free_agent(game, team_id, role, reason) {
            actions.push(RepairAction::AssignedFreeAgent { player_id, role });
        } else {
            let player_id = available_generated_player_id(game, team_id, reason, role)
                .ok_or_else(|| error_from_evaluation(reason, &evaluation))?;
            game.players
                .push(generated_player(&player_id, team_id, role, game));
            actions.push(RepairAction::GeneratedReplacement { player_id, role });
        }
    }
    Ok(())
}

fn assign_free_agent(
    game: &mut Game,
    team_id: &str,
    role: LolRole,
    reason: RosterStabilityReason,
) -> Option<String> {
    let current_date = current_date(game);
    let team = game
        .teams
        .iter()
        .find(|team| team.id == team_id)
        .expect("repair team must exist")
        .clone();

    let signing_intent = repair_signing_intent(reason);
    let cap_kind = if is_emergency_repair(reason) {
        AiTransferKind::Emergency
    } else {
        AiTransferKind::Strategic
    };

    // Cap consumption and transfer recording only happen for the selected candidate.
    let candidates = free_agent_candidates(game, role, current_date);

    for (_, index) in candidates {
        let decision = {
            let player = &game.players[index];
            ai_signing_policy(game, &team, player, signing_intent)
        };
        if !decision.accepted {
            continue;
        }
        if !ai_transfer_cap_try_consume(game, team_id, cap_kind) {
            continue;
        }

        let contract_end = contract_end_for_years(game, decision.contract_years);
        let player_id = game.players[index].id.clone();
        let player = &mut game.players[index];
        player.team_id = Some(team_id.to_string());
        player.contract_end = Some(contract_end);
        player.wage = decision.annual_wage;

        let transfer_intent = if is_emergency_repair(reason) {
            Some("emergency")
        } else {
            None
        };
        record_transfer(
            game,
            &player_id,
            "",
            team_id,
            0,
            decision.annual_wage,
            decision.contract_years,
            false,
            false,
            false,
            None,
            0,
            &[],
            transfer_intent,
        );

        return Some(player_id);
    }

    None
}

/// Free agents that can fill `role`, as `(player_id, index)` sorted by id so
/// selection is deterministic.
fn free_agent_candidates(
    game: &Game,
    role: LolRole,
    current_date: NaiveDate,
) -> Vec<(String, usize)> {
    let mut candidates: Vec<(String, usize)> = game
        .players
        .iter()
        .enumerate()
        .filter(|(_, player)| player.team_id.is_none())
        .filter(|(_, player)| player.natural_position == role)
        .filter(|(_, player)| !player.was_released)
        .filter(|(_, player)| {
            player.contract_end.is_none() || has_current_contract(player, current_date)
        })
        .map(|(index, player)| (player.id.clone(), index))
        .collect();
    candidates.sort();
    candidates
}

fn is_emergency_repair(reason: RosterStabilityReason) -> bool {
    matches!(
        reason,
        RosterStabilityReason::Emergency
            | RosterStabilityReason::ContractExpired
            | RosterStabilityReason::TransferOut
    )
}

fn repair_signing_intent(reason: RosterStabilityReason) -> SigningIntent {
    if is_emergency_repair(reason) {
        SigningIntent::Emergency
    } else {
        SigningIntent::Strategic
    }
}

fn actions_require_transfer_window_exception(actions: &[RepairAction]) -> bool {
    actions.iter().any(|action| {
        matches!(
            action,
            RepairAction::RenewedContract { .. }
                | RepairAction::AssignedFreeAgent { .. }
                | RepairAction::GeneratedReplacement { .. }
        )
    })
}

fn reconcile_lineup(game: &mut Game, team_id: &str, actions: &mut Vec<RepairAction>) {
    let current_date = current_date(game);
    let previous = game
        .teams
        .iter()
        .find(|team| team.id == team_id)
        .map(|team| team.active_lineup_ids.clone())
        .unwrap_or_default();
    let lineup = select_lineup(game, team_id, current_date);
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

fn select_lineup(game: &Game, team_id: &str, current_date: NaiveDate) -> Vec<String> {
    let eligible = eligible_team_players(game, team_id, current_date);
    REQUIRED_ROLES
        .iter()
        .filter_map(|role| {
            eligible
                .iter()
                .filter(|player| player.natural_position == *role)
                .min_by(|left, right| left.id.cmp(&right.id))
                .map(|player| player.id.clone())
        })
        .collect()
}

fn first_uncovered_extra_role(game: &Game, team_id: &str) -> LolRole {
    let current_date = current_date(game);
    let covered = eligible_team_players(game, team_id, current_date)
        .iter()
        .map(|player| player.natural_position)
        .collect::<HashSet<_>>();
    REQUIRED_ROLES
        .iter()
        .copied()
        .find(|role| !covered.contains(role))
        .unwrap_or(LolRole::Support)
}

fn missing_roles(players: &[&Player]) -> Vec<LolRole> {
    let covered = players
        .iter()
        .map(|player| player.natural_position)
        .collect::<HashSet<_>>();
    REQUIRED_ROLES
        .iter()
        .copied()
        .filter(|role| !covered.contains(role))
        .collect()
}

fn active_lineup_is_valid(
    active_lineup_ids: &[String],
    eligible_roles_by_id: &HashMap<&str, LolRole>,
) -> bool {
    if active_lineup_ids.len() != MIN_MATCH_PLAYERS {
        return false;
    }

    let mut unique_lineup_ids = HashSet::new();
    let mut covered_roles = HashSet::new();
    for player_id in active_lineup_ids {
        if !unique_lineup_ids.insert(player_id.as_str()) {
            return false;
        }
        let Some(role) = eligible_roles_by_id.get(player_id.as_str()) else {
            return false;
        };
        covered_roles.insert(*role);
    }

    REQUIRED_ROLES
        .iter()
        .all(|role| covered_roles.contains(role))
}

fn lineup_issues(active_lineup_ids: &[String], eligible_ids: &HashSet<&str>) -> Vec<String> {
    let mut seen = HashSet::new();
    active_lineup_ids
        .iter()
        .filter(|id| !eligible_ids.contains(id.as_str()) || !seen.insert(id.as_str()))
        .cloned()
        .collect()
}

fn eligible_team_players<'a>(
    game: &'a Game,
    team_id: &str,
    current_date: NaiveDate,
) -> Vec<&'a Player> {
    game.players
        .iter()
        .filter(|player| player.team_id.as_deref() == Some(team_id))
        .filter(|player| has_current_contract(player, current_date))
        .collect()
}

fn has_current_contract(player: &Player, current_date: NaiveDate) -> bool {
    let Some(contract_end) = player.contract_end.as_deref() else {
        return false;
    };
    NaiveDate::parse_from_str(contract_end, "%Y-%m-%d")
        .map(|contract_end| contract_end >= current_date)
        .unwrap_or(false)
}

fn is_schedulable_ai_main_team(game: &Game, team_id: &str) -> bool {
    let Some(team) = game.teams.iter().find(|team| team.id == team_id) else {
        return false;
    };
    if team.team_kind != TeamKind::Main || team.manager_id.is_some() {
        return false;
    }

    game.leagues.iter().any(|league| {
        league.league_kind == crate::domain::league::LeagueKind::Main
            && (league
                .standings
                .iter()
                .any(|entry| entry.team_id == team_id)
                || league.fixtures.iter().any(|fixture| {
                    fixture.status == crate::domain::league::FixtureStatus::Scheduled
                        && (fixture.home_team_id == team_id || fixture.away_team_id == team_id)
                }))
    })
}

/// Deterministic, plausible display name for a generated roster-repair fallback.
///
/// Keeps the internal emergency IDs and audit actions intact while avoiding the
/// ugly "Emergency TOP/MID/..." placeholders that surface in the UI.
fn generated_player_name(player_id: &str) -> (String, String) {
    let hash = player_id.bytes().fold(0u32, |acc, byte| {
        acc.wrapping_mul(31).wrapping_add(u32::from(byte))
    });
    let first = GENERATED_FIRST_NAMES[(hash as usize) % GENERATED_FIRST_NAMES.len()];
    let last = GENERATED_LAST_NAMES[((hash >> 8) as usize) % GENERATED_LAST_NAMES.len()];
    let full_name = format!("{first} {last}");
    (full_name.clone(), full_name)
}

fn generated_player(player_id: &str, team_id: &str, role: LolRole, game: &Game) -> Player {
    let (match_name, full_name) = generated_player_name(player_id);
    let mut player = Player::new(
        player_id.to_string(),
        match_name,
        full_name,
        EMERGENCY_PLAYER_BIRTH_DATE.to_string(),
        EMERGENCY_PLAYER_NATIONALITY.to_string(),
        role,
        PlayerAttributes {
            mental_resilience: EMERGENCY_PLAYER_ATTRIBUTE_BASELINE,
            champion_pool: EMERGENCY_PLAYER_ATTRIBUTE_BASELINE,
            laning: EMERGENCY_PLAYER_ATTRIBUTE_BASELINE,
            mechanics: EMERGENCY_PLAYER_ATTRIBUTE_BASELINE,
            macro_play: EMERGENCY_PLAYER_ATTRIBUTE_BASELINE,
            consistency: EMERGENCY_PLAYER_ATTRIBUTE_BASELINE,
            discipline: EMERGENCY_PLAYER_ATTRIBUTE_BASELINE,
            teamfighting: EMERGENCY_PLAYER_ATTRIBUTE_BASELINE,
            shotcalling: EMERGENCY_PLAYER_ATTRIBUTE_BASELINE,
        },
    );
    player.team_id = Some(team_id.to_string());
    player.contract_end = Some(renewed_contract_end(game));
    player.wage = EMERGENCY_PLAYER_WAGE;
    player.market_value = EMERGENCY_PLAYER_MARKET_VALUE;
    player.lol_ovr = crate::potential::calculate_lol_ovr(&player);
    player
}

fn available_generated_player_id(
    game: &Game,
    team_id: &str,
    reason: RosterStabilityReason,
    role: LolRole,
) -> Option<String> {
    let base_id = generated_player_id(team_id, reason, role);
    if !player_id_exists(game, &base_id) {
        return Some(base_id);
    }

    for collision_index in 2..=(MAX_GENERATED_PLAYER_ID_COLLISIONS + 1) {
        let candidate_id = format!("{base_id}-{collision_index}");
        if !player_id_exists(game, &candidate_id) {
            return Some(candidate_id);
        }
    }
    None
}

fn error_from_evaluation(
    reason: RosterStabilityReason,
    evaluation: &RosterEvaluation,
) -> RosterStabilityError {
    RosterStabilityError {
        team_id: evaluation.team_id.clone(),
        reason,
        missing_count: MIN_MATCH_PLAYERS.saturating_sub(evaluation.eligible_player_count),
        missing_roles: evaluation.missing_roles.clone(),
        expired_player_ids: evaluation.expired_player_ids.clone(),
        stale_lineup_ids: evaluation.stale_lineup_ids.clone(),
    }
}

fn player_id_exists(game: &Game, player_id: &str) -> bool {
    game.players.iter().any(|player| player.id == player_id)
}

fn generated_player_id(team_id: &str, reason: RosterStabilityReason, role: LolRole) -> String {
    format!(
        "emergency-{}-{}-{}",
        slug(team_id),
        reason_slug(reason),
        role_slug(role)
    )
}

fn renewed_contract_end(game: &Game) -> String {
    let current = current_date(game);
    format!("{}-{}", current.year() + 1, RENEWED_CONTRACT_END_MONTH_DAY)
}

fn contract_end_for_years(game: &Game, contract_years: u8) -> String {
    let current = current_date(game);
    format!(
        "{}-{}",
        current.year() + i32::from(contract_years.max(1)),
        RENEWED_CONTRACT_END_MONTH_DAY
    )
}

fn current_date(game: &Game) -> NaiveDate {
    game.clock.get_date().date_naive()
}

fn slug(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect()
}

fn reason_slug(reason: RosterStabilityReason) -> &'static str {
    match reason {
        RosterStabilityReason::ContractExpired => "contract-expired",
        RosterStabilityReason::TransferOut => "transfer-out",
        RosterStabilityReason::Release => "release",
        RosterStabilityReason::SeasonTransition => "season-transition",
        RosterStabilityReason::PreMatch => "prematch",
        RosterStabilityReason::BackgroundSimulation => "background-simulation",
        RosterStabilityReason::LoadMigration => "load-migration",
        RosterStabilityReason::Emergency => "emergency",
    }
}

fn role_slug(role: LolRole) -> &'static str {
    match role {
        LolRole::Top => "top",
        LolRole::Jungle => "jungle",
        LolRole::Mid => "mid",
        LolRole::Adc => "adc",
        LolRole::Support => "support",
        LolRole::Unknown => "unknown",
    }
}
