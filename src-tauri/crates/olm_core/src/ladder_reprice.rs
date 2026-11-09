//! Economy and mood of clubs that changed league.
//!
//! After [`apply_ladders`](crate::ladder_apply::apply_ladders) swaps clubs between
//! two leagues, each moved club is repriced toward the median club of its new league
//! (see [`league_median_profile`]). A club keeps its identity and its history; its
//! numbers take one step of [`STEP_DIVISOR`] of the gap, so the move is felt without
//! teleporting a regional club to a giant's budget or zeroing a fallen giant.
//!
//! - Promoted clubs: reputation, wage budget, transfer budget and treasury move up
//!   toward the destination median. Anything already above the median stays. The
//!   treasury top-up is a ledger transaction (source `ladder`) that is not counted in
//!   the season income.
//! - Relegated clubs: reputation, wage budget and transfer budget move down toward the
//!   destination median; anything already below it stays. The treasury is untouched
//!   because wages are contracted, and the sponsorship is scaled down.
//! - The user's board is happier after a promotion and unhappier after a relegation.
//!
//! Peers are the destination league's other main clubs, so a league that has no peer
//! left leaves the moved clubs unchanged.

use crate::custom_team::league_median_profile;
use crate::domain::team::{FinancialTransactionKind, Team, TeamKind};
use crate::finances::{BudgetImpact, FinanceTransactionInput, record_transaction};
use crate::game::Game;

/// A moved club covers one over this many of the gap to the destination median.
pub const STEP_DIVISOR: i64 = 2;
/// Percent of the sponsorship value a relegated club keeps.
pub const RELEGATED_SPONSORSHIP_PERCENT: i64 = 80;
/// Board satisfaction gained by a user whose club is promoted.
pub const PROMOTION_SATISFACTION_BONUS: u8 = 10;
/// Board satisfaction lost by a user whose club is relegated.
pub const RELEGATION_SATISFACTION_PENALTY: u8 = 15;

/// `current` moved one step of the way to `target`.
fn step_toward(current: i64, target: i64) -> i64 {
    current + (target - current) / STEP_DIVISOR
}

/// Median club of `league_id`, leaving out the clubs that just moved. `None` when no
/// peer is left.
fn destination_profile(
    game: &Game,
    league_id: &str,
    moved: &[&String],
) -> Option<crate::custom_team::ClubProfile> {
    let peers: Vec<&Team> = game
        .teams
        .iter()
        .filter(|team| team.competition_id.as_deref() == Some(league_id))
        .filter(|team| team.team_kind == TeamKind::Main)
        .filter(|team| !moved.contains(&&team.id))
        .collect();
    if peers.is_empty() {
        None
    } else {
        Some(league_median_profile(&peers))
    }
}

/// Reprice the clubs a swap just moved: `promoted` entered `upper_id` and `relegated`
/// entered `lower_id`. Also adjusts the user's board satisfaction when the user's club
/// is one of them.
pub fn reprice_moved_clubs(
    game: &mut Game,
    promoted: &[String],
    relegated: &[String],
    lower_id: &str,
    upper_id: &str,
) {
    let moved: Vec<&String> = promoted.iter().chain(relegated.iter()).collect();
    let upper = destination_profile(game, upper_id, &moved);
    let lower = destination_profile(game, lower_id, &moved);
    let date = game.clock.current_date.format("%Y-%m-%d").to_string();

    if let Some(profile) = &upper {
        for team in game.teams.iter_mut().filter(|t| promoted.contains(&t.id)) {
            promote_economy(team, profile, &date);
        }
    }
    if let Some(profile) = &lower {
        for team in game.teams.iter_mut().filter(|t| relegated.contains(&t.id)) {
            relegate_economy(team, profile);
        }
    }

    if let Some(user_team_id) = game.manager.team_id.as_deref() {
        let satisfaction = game.manager.satisfaction;
        if promoted.iter().any(|id| id == user_team_id) {
            game.manager.satisfaction = satisfaction
                .saturating_add(PROMOTION_SATISFACTION_BONUS)
                .min(100);
        } else if relegated.iter().any(|id| id == user_team_id) {
            game.manager.satisfaction =
                satisfaction.saturating_sub(RELEGATION_SATISFACTION_PENALTY);
        }
    }
}

fn promote_economy(team: &mut Team, target: &crate::custom_team::ClubProfile, date: &str) {
    let reputation = i64::from(team.reputation);
    let goal = i64::from(target.reputation);
    if goal > reputation {
        team.reputation = u32::try_from(step_toward(reputation, goal)).unwrap_or(team.reputation);
    }
    if target.wage_budget > team.wage_budget {
        team.wage_budget = step_toward(team.wage_budget, target.wage_budget);
    }
    if target.transfer_budget > team.transfer_budget {
        team.transfer_budget = step_toward(team.transfer_budget, target.transfer_budget);
    }
    if target.finance > team.finance {
        let top_up = step_toward(team.finance, target.finance) - team.finance;
        if top_up > 0 {
            let input = FinanceTransactionInput {
                date: date.to_string(),
                description: "Promotion funding".to_string(),
                amount: top_up,
                kind: FinancialTransactionKind::Other,
                budget_impact: BudgetImpact::None,
                affects_season_totals: false,
                source: "ladder".to_string(),
                source_id: Some("promotion".to_string()),
                correlation_id: None,
            };
            if let Err(error) = record_transaction(team, input) {
                log::warn!(
                    "[ladder] promotion funding for {} failed: {error:?}",
                    team.id
                );
            }
        }
    }
}

fn relegate_economy(team: &mut Team, target: &crate::custom_team::ClubProfile) {
    let reputation = i64::from(team.reputation);
    let goal = i64::from(target.reputation);
    if goal < reputation {
        team.reputation = u32::try_from(step_toward(reputation, goal)).unwrap_or(team.reputation);
    }
    if target.wage_budget < team.wage_budget {
        team.wage_budget = step_toward(team.wage_budget, target.wage_budget);
    }
    if target.transfer_budget < team.transfer_budget {
        team.transfer_budget = step_toward(team.transfer_budget, target.transfer_budget);
    }
    if let Some(sponsorship) = team.sponsorship.as_mut() {
        sponsorship.base_value = sponsorship.base_value * RELEGATED_SPONSORSHIP_PERCENT / 100;
    }
}
