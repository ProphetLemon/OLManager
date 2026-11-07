use crate::contracts::{RenewalFinancialProjection, expected_contract_years, expected_wage};
use crate::domain::league::League;
use crate::domain::player::Player;
use crate::domain::team::Team;
use crate::finances::calc_cash_runway_weeks;
use crate::game::Game;
use serde::{Deserialize, Serialize};

const WAGE_SOFT_CAP_PCT: i64 = 110;
const LEGACY_OVER_BUDGET_GRACE_PCT: i64 = 3;
const LEGACY_OVER_BUDGET_GRACE_MIN: i64 = 25_000;

const MAX_AI_TRANSFERS_PER_DAY: u8 = 2;
const MAX_AI_EMERGENCY_TRANSFERS_PER_DAY: u8 = 1;

const HIGH_REPUTATION_THRESHOLD: u32 = 1_100;
const MIN_STRATEGIC_ATTRACTIVENESS: i32 = 35;

pub fn annual_team_wage_bill(game: &Game, team_id: &str) -> i64 {
    let player_wages: i64 = game
        .players
        .iter()
        .filter(|player| player.team_id.as_deref() == Some(team_id))
        .map(|player| player.wage as i64)
        .sum();

    let staff_wages: i64 = game
        .staff
        .iter()
        .filter(|staff_member| staff_member.team_id.as_deref() == Some(team_id))
        .map(|staff_member| staff_member.wage as i64)
        .sum();

    player_wages + staff_wages
}

fn projected_annual_wage_bill(
    game: &Game,
    team_id: &str,
    current_player_wage: u32,
    offered_wage: u32,
) -> i64 {
    annual_team_wage_bill(game, team_id) - current_player_wage as i64 + offered_wage as i64
}

pub fn renewal_wage_policy_allows(
    game: &Game,
    team: &Team,
    current_player_wage: u32,
    offered_wage: u32,
) -> bool {
    let current_bill = annual_team_wage_bill(game, &team.id);
    wage_policy_allows_for_bill(team, current_bill, current_player_wage, offered_wage)
}

/// [`renewal_wage_policy_allows`] against an explicit `current_bill` instead of
/// the bill computed from the game's players and staff.
fn wage_policy_allows_for_bill(
    team: &Team,
    current_bill: i64,
    current_player_wage: u32,
    offered_wage: u32,
) -> bool {
    let projected_bill = current_bill - current_player_wage as i64 + offered_wage as i64;
    let soft_cap = (team.wage_budget * WAGE_SOFT_CAP_PCT) / 100;

    if current_bill <= team.wage_budget {
        return projected_bill <= soft_cap;
    }

    if projected_bill <= current_bill {
        return true;
    }

    let legacy_grace = std::cmp::max(
        (team.wage_budget * LEGACY_OVER_BUDGET_GRACE_PCT) / 100,
        LEGACY_OVER_BUDGET_GRACE_MIN,
    );

    projected_bill <= current_bill + legacy_grace
}

pub fn renewal_wage_policy_error_message(team: &Team) -> String {
    format!(
        "Renewal blocked by board wage policy. Keep annual wages near €{} to recover.",
        team.wage_budget
    )
}

pub fn project_renewal_financial_impact(
    game: &Game,
    player_id: &str,
    offered_wage: u32,
) -> Result<RenewalFinancialProjection, String> {
    let player = game
        .players
        .iter()
        .find(|player| player.id == player_id)
        .ok_or_else(|| "Player not found".to_string())?;
    let team_id = player
        .team_id
        .as_deref()
        .ok_or_else(|| "Player has no team".to_string())?;
    let team = game
        .teams
        .iter()
        .find(|team| team.id == team_id)
        .ok_or_else(|| "Team not found".to_string())?;

    let current_bill = annual_team_wage_bill(game, team_id);
    let projected_bill = projected_annual_wage_bill(game, team_id, player.wage, offered_wage);
    let annual_wage_budget = team.wage_budget;
    let annual_soft_cap = (annual_wage_budget * WAGE_SOFT_CAP_PCT) / 100;

    let current_cash_runway_weeks = {
        let weekly_net = -(current_bill / 52);
        calc_cash_runway_weeks(team.finance, weekly_net)
    };
    let projected_cash_runway_weeks = {
        let weekly_net = -(projected_bill / 52);
        calc_cash_runway_weeks(team.finance, weekly_net)
    };

    Ok(RenewalFinancialProjection {
        current_annual_wage_bill: current_bill,
        projected_annual_wage_bill: projected_bill,
        annual_wage_budget,
        annual_soft_cap,
        current_cash_runway_weeks,
        projected_cash_runway_weeks,
        currently_over_budget: current_bill > annual_wage_budget,
        policy_allows: renewal_wage_policy_allows(game, team, player.wage, offered_wage),
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SigningIntent {
    Emergency,
    Strategic,
    Casual,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SigningRejectionReason {
    None,
    WageBudgetExceeded,
    ReputationMismatch,
    DailyCapReached,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SigningDecision {
    pub accepted: bool,
    pub annual_wage: u32,
    pub contract_years: u8,
    pub reason: SigningRejectionReason,
}

impl SigningDecision {
    fn accepted(annual_wage: u32, contract_years: u8) -> Self {
        Self {
            accepted: true,
            annual_wage,
            contract_years,
            reason: SigningRejectionReason::None,
        }
    }

    fn rejected(reason: SigningRejectionReason, annual_wage: u32, contract_years: u8) -> Self {
        Self {
            accepted: false,
            annual_wage,
            contract_years,
            reason,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiTransferKind {
    Strategic,
    FreeAgent,
    ClubToClub,
    Emergency,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AiTransferCapState {
    pub strategic_count: u8,
    pub emergency_count: u8,
}

/// Resolve a team's competition tier (1..=3).
/// Prefers `team.competition_id -> game.leagues[].tier`, falling back to
/// reputation bands when no matching league exists.
pub fn ai_team_tier(team: &Team, game: &Game) -> u8 {
    tier_from_competition_id(team, &game.leagues)
        .unwrap_or_else(|| tier_from_reputation(team.reputation))
}

fn tier_from_competition_id(team: &Team, leagues: &[League]) -> Option<u8> {
    let competition_id = team.competition_id.as_deref()?;
    leagues
        .iter()
        .find(|league| league.competition_id.as_deref() == Some(competition_id))
        .map(|league| league.tier.clamp(1, 3))
}

fn tier_from_reputation(reputation: u32) -> u8 {
    if reputation >= 1_100 {
        1
    } else if reputation >= 800 {
        2
    } else {
        3
    }
}

/// Compute a free-agent attractiveness score used by the strategic gating
/// path. Mirrors the spirit of `transfers::incoming_interest_score` but uses
/// stable player attributes so the result is deterministic per player.
pub fn player_attractiveness_score(player: &Player) -> i32 {
    let mut score = 8;

    if player.market_value >= 1_000_000 {
        score += 20;
    } else if player.market_value >= 500_000 {
        score += 10;
    }

    if player.lol_ovr >= 80 {
        score += 15;
    } else if player.lol_ovr >= 70 {
        score += 8;
    }

    score
}

/// Reputation/tier fit gate for AI signings.
/// Emergency intent always passes. Strategic intent at high-reputation tier-1
/// clubs rejects low-impact free agents unless roster validity is at stake.
pub fn reputation_fit_ok(team: &Team, player: &Player, intent: SigningIntent, game: &Game) -> bool {
    if matches!(intent, SigningIntent::Emergency | SigningIntent::Casual) {
        return true;
    }

    let is_elite_context =
        team.reputation >= HIGH_REPUTATION_THRESHOLD && ai_team_tier(team, game) == 1;
    if !is_elite_context {
        return true;
    }

    player_attractiveness_score(player) >= MIN_STRATEGIC_ATTRACTIVENESS
}

/// Shared AI signing policy: computes wage/term and enforces budget + fit gates.
pub fn ai_signing_policy(
    game: &Game,
    team: &Team,
    player: &Player,
    intent: SigningIntent,
) -> SigningDecision {
    let current_bill = annual_team_wage_bill(game, &team.id);
    ai_signing_policy_for_bill(game, team, player, intent, current_bill)
}

/// [`ai_signing_policy`] judging the wage budget against `current_bill`, for
/// callers that track commitments the players' stored wages do not show yet
/// (see `fill_new_game_rosters`).
pub fn ai_signing_policy_for_bill(
    game: &Game,
    team: &Team,
    player: &Player,
    intent: SigningIntent,
    current_bill: i64,
) -> SigningDecision {
    let current_date = game.clock.current_date.date_naive();
    let annual_wage = expected_wage(player, team, current_date);
    let contract_years = expected_contract_years(player, current_date) as u8;

    if !reputation_fit_ok(team, player, intent, game) {
        return SigningDecision::rejected(
            SigningRejectionReason::ReputationMismatch,
            annual_wage,
            contract_years,
        );
    }

    if !wage_policy_allows_for_bill(team, current_bill, 0, annual_wage) {
        return SigningDecision::rejected(
            SigningRejectionReason::WageBudgetExceeded,
            annual_wage,
            contract_years,
        );
    }

    SigningDecision::accepted(annual_wage, contract_years)
}

/// Attempt to consume one slot from the per-team daily transfer cap.
/// Returns `true` if the slot was available.
pub fn ai_transfer_cap_try_consume(game: &mut Game, team_id: &str, kind: AiTransferKind) -> bool {
    let state = game
        .ai_transfer_cap_counts
        .entry(team_id.to_string())
        .or_default();

    let allowed = match kind {
        AiTransferKind::Emergency => state.emergency_count < MAX_AI_EMERGENCY_TRANSFERS_PER_DAY,
        _ => state.strategic_count < MAX_AI_TRANSFERS_PER_DAY,
    };

    if !allowed {
        return false;
    }

    match kind {
        AiTransferKind::Emergency => state.emergency_count += 1,
        _ => state.strategic_count += 1,
    }

    true
}

/// Reset per-team transfer counters when the in-game date advances.
pub fn ai_transfer_cap_reset_if_new_day(game: &mut Game) {
    let current_date = game.clock.current_date.format("%Y-%m-%d").to_string();
    if game.ai_transfer_cap_last_reset_date.as_deref() == Some(&current_date) {
        return;
    }
    game.ai_transfer_cap_counts.clear();
    game.ai_transfer_cap_last_reset_date = Some(current_date);
}
