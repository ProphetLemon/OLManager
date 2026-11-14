use crate::contract_wage_policy::{
    AiTransferKind, SigningIntent, ai_signing_policy, ai_team_tier, ai_transfer_cap_try_consume,
};
use crate::domain::player::{Player, PlayerTrait};
use crate::domain::season::TransferWindowStatus;
use crate::domain::team::Team;
use crate::game::Game;
use chrono::{Datelike, NaiveDate};
use std::collections::{HashMap, HashSet};

// ---------------------------------------------------------------------------
// Retention scoring weights (design: retention = Σ(weight × factor))
// ---------------------------------------------------------------------------
const W_LOL_OVR: f64 = 0.35;
const W_AVG_RATING: f64 = 0.20;
const W_AGE: f64 = 0.15;
const W_CONTRACT_SECURITY: f64 = 0.10;
const W_WAGE_VALUE: f64 = 0.10;
const W_TRAIT_BONUS: f64 = 0.10;

/// Soft cap multiplier on wage_budget: we will not exceed 110 % of budget.
const WAGE_SOFT_CAP_MULTIPLIER: f64 = 1.10;

/// Max teams processed per day in staggered mode.
const TEAMS_PER_DAY: usize = 3;

// ---------------------------------------------------------------------------
// Threshold constants (spec-driven, single source of truth for tuning)
// ---------------------------------------------------------------------------

/// Retention score threshold: players at or above this get a renewal offer.
const RENEWAL_THRESHOLD: f64 = 0.70;

/// Underperformer detection: players below these thresholds are skipped for renewal.
const UNDERPERFORMER_RATING: f32 = 6.0;
const UNDERPERFORMER_OVR: u8 = 65;

/// High-performer bypass: players above these thresholds get a renewal offer
/// regardless of retention score, provided their contract is short (< 18 months).
const HIGH_PERFORMER_RATING: f32 = 7.5;
const HIGH_PERFORMER_OVR: u8 = 80;

// Deadweight score weights
const DW_OVR_WEIGHT: f64 = 0.40;
const DW_WAGE_WEIGHT: f64 = 0.35;
const DW_CONTRACT_WEIGHT: f64 = 0.25;

/// Sale thresholds: players meeting these criteria are transfer-listed.
const SALE_AGE_THRESHOLD: u8 = 28;
const SALE_RATING_THRESHOLD: f32 = 6.5;

/// Fraction of top wages used for sale eligibility (top 25 %).
const TOP_WAGE_QUARTILE: f64 = 0.25;

/// Deadweight score threshold: players scoring at or above this are transfer-listed.
const DEADWEIGHT_THRESHOLD: f64 = 0.60;

// ---------------------------------------------------------------------------
// Helpers (extracted for REFACTOR)
// ---------------------------------------------------------------------------

/// Age factor: younger → higher score.
/// Returns 1.0 for age ≤ 20, linear decrease to 0.0 at age ≥ 35.
pub fn age_factor(age: u8) -> f64 {
    if age <= 20 {
        1.0
    } else if age >= 35 {
        0.0
    } else {
        1.0 - (age as f64 - 20.0) / 15.0
    }
}

/// Contract security: more remaining years → higher score.
/// Returns 1.0 for ≥ 3 years, linear to 0.0 for 0 years.
pub fn contract_security(contract_end: Option<&str>, today: NaiveDate) -> f64 {
    let end = match contract_end.and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()) {
        Some(d) => d,
        None => return 0.0, // no contract = no security
    };
    let years_remaining: f64 =
        (end.signed_duration_since(today).num_days() as f64 / 365.25).clamp(0.0, f64::MAX);
    (years_remaining / 3.0).clamp(0.0, 1.0)
}

/// Wage-value ratio: wage ≤ expected → good (≥ 1.0).
/// Returns 1.0 if wage ≤ expected_wage, down to 0.3 at extreme overpay.
pub fn wage_value_ratio(wage: u32, expected_wage: u32) -> f64 {
    if expected_wage == 0 {
        return 0.5; // unknown baseline
    }
    let ratio = wage as f64 / expected_wage as f64;
    if ratio <= 1.0 {
        1.0
    } else {
        (1.0 - (ratio - 1.0) * 0.5).clamp(0.3, 1.0)
    }
}

/// Trait bonus: key traits increase retention score.
/// HyperCarry, ShotCaller, IceCold, Visionary → +0.2 each.
/// TeamPlayer, Sentinel, Workhorse → +0.1 each.
pub fn trait_bonus(traits: &[PlayerTrait]) -> f64 {
    let mut bonus: f64 = 0.0;
    for t in traits {
        match t {
            PlayerTrait::HyperCarry
            | PlayerTrait::ShotCaller
            | PlayerTrait::IceCold
            | PlayerTrait::Visionary => bonus += 0.2,
            PlayerTrait::TeamPlayer | PlayerTrait::Sentinel | PlayerTrait::Workhorse => {
                bonus += 0.1
            }
            _ => {}
        }
    }
    bonus.clamp(0.0, 1.0)
}

/// Compute player age from date_of_birth string.
pub fn player_age(date_of_birth: &str, today: NaiveDate) -> u8 {
    let birth = match NaiveDate::parse_from_str(date_of_birth, "%Y-%m-%d") {
        Ok(d) => d,
        Err(_) => return 25, // fallback
    };
    let mut age = today.year() - birth.year();
    // Birthday check: use month*100+day to avoid leap-year ordinal skew
    if today.format("%m%d").to_string() < birth.format("%m%d").to_string() {
        age -= 1;
    }
    age.max(0) as u8
}

// ---------------------------------------------------------------------------
// Composite retention score
// ---------------------------------------------------------------------------

/// The season rating of a player, or `None` when no match ever recorded one.
///
/// Matches outside the user's league do not write player stats, so those players sit at
/// rating 0 with no appearances. That is missing data, not bad form.
fn known_rating(player: &Player) -> Option<f32> {
    (player.stats.appearances > 0 || player.stats.avg_rating > 0.0)
        .then_some(player.stats.avg_rating)
}

/// The player's overall rating for renewal decisions. The stored `lol_ovr` is 0 until
/// something computes it (a new game never does for most players), which is not a rating.
fn current_ovr(player: &Player) -> u8 {
    if player.lol_ovr == 0 {
        crate::potential::calculate_lol_ovr(player)
    } else {
        player.lol_ovr
    }
}

/// Compute a 0..1 retention score for a player relative to their team.
/// Uses EXISTING player/team fields only — no schema changes.
///
/// Without rating data the rating term is left out and the other terms are rescaled to
/// the full range, so the player is neither rewarded nor punished for it.
pub fn retention_score(player: &Player, team: &Team, today: NaiveDate) -> f64 {
    let lol_ovr = f64::from(current_ovr(player)) / 99.0; // normalise 0..1

    let age = player_age(&player.date_of_birth, today);
    let age_f = age_factor(age);

    let cs = contract_security(player.contract_end.as_deref(), today);

    // Expected wage from contracts module
    let expected = crate::contracts::expected_wage(player, team, today);
    let wvr = wage_value_ratio(player.wage, expected);

    let tb = trait_bonus(&player.traits);

    let without_rating = lol_ovr * W_LOL_OVR
        + age_f * W_AGE
        + cs * W_CONTRACT_SECURITY
        + wvr * W_WAGE_VALUE
        + tb * W_TRAIT_BONUS;

    match known_rating(player) {
        // avg_rating is 0..10, normalise
        Some(rating) => without_rating + f64::from(rating) / 10.0 * W_AVG_RATING,
        None => without_rating / (1.0 - W_AVG_RATING),
    }
}

// ---------------------------------------------------------------------------
// Roster report
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct RosterReport {
    /// Number of players per LolRole
    pub role_depth: HashMap<crate::domain::stats::LolRole, u32>,
    /// Average OVR per role
    pub avg_ovr_by_role: HashMap<crate::domain::stats::LolRole, f64>,
    /// Player IDs sorted by retention score (descending)
    pub retention_scores: Vec<(String, f64)>,
    /// Player IDs whose score suggests renewal
    pub renewal_candidates: Vec<String>,
    /// Roles with 0 players
    pub role_gaps: Vec<crate::domain::stats::LolRole>,
}

/// Assess a team's roster and produce a RosterReport.
pub fn assess_roster(team: &Team, players: &[Player], today: NaiveDate) -> RosterReport {
    use crate::domain::stats::LolRole;

    let mut role_depth: HashMap<LolRole, u32> = HashMap::new();
    let mut ovr_sum: HashMap<LolRole, u64> = HashMap::new();
    let mut ovr_count: HashMap<LolRole, u32> = HashMap::new();

    // Initialise all roles
    for role in &[
        LolRole::Top,
        LolRole::Jungle,
        LolRole::Mid,
        LolRole::Adc,
        LolRole::Support,
    ] {
        role_depth.insert(*role, 0);
        ovr_sum.insert(*role, 0);
        ovr_count.insert(*role, 0);
    }

    let team_players: Vec<&Player> = players
        .iter()
        .filter(|p| p.team_id.as_deref() == Some(&team.id))
        .collect();

    for p in &team_players {
        let role = p.natural_position;
        *role_depth.entry(role).or_insert(0) += 1;
        *ovr_sum.entry(role).or_insert(0) += u64::from(p.lol_ovr);
        *ovr_count.entry(role).or_insert(0) += 1;
    }

    let avg_ovr_by_role: HashMap<LolRole, f64> = ovr_sum
        .into_iter()
        .map(|(role, sum)| {
            let count = *ovr_count.get(&role).unwrap_or(&1);
            (role, sum as f64 / count.max(1) as f64)
        })
        .collect();

    let mut retention_scores: Vec<(String, f64)> = team_players
        .iter()
        .map(|p| {
            let score = retention_score(p, team, today);
            (p.id.clone(), score)
        })
        .collect();
    retention_scores.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    let renewal_candidates: Vec<String> = retention_scores
        .iter()
        .filter(|(_, score)| *score >= RENEWAL_THRESHOLD)
        .map(|(id, _)| id.clone())
        .collect();

    let role_gaps: Vec<LolRole> = role_depth
        .iter()
        .filter(|&(_, &count)| count == 0)
        .map(|(role, _)| *role)
        .collect();

    RosterReport {
        role_depth,
        avg_ovr_by_role,
        retention_scores,
        renewal_candidates,
        role_gaps,
    }
}

// ---------------------------------------------------------------------------
// Renewal decisions
// ---------------------------------------------------------------------------

/// Evaluate which players on a team should get renewal offers.
/// Sets `player.morale_core.renewal_state` for eligible players.
pub fn evaluate_renewals(
    team: &Team,
    players: &mut [Player],
    report: &RosterReport,
    today: NaiveDate,
) {
    use crate::domain::player::{ContractRenewalState, RenewalSessionStatus};

    let soft_cap_wage = (team.wage_budget as f64 * WAGE_SOFT_CAP_MULTIPLIER) as i64;
    let current_wage_bill: i64 = players
        .iter()
        .filter(|p| p.team_id.as_deref() == Some(&team.id))
        .map(|p| i64::from(p.wage))
        .sum();

    let mut processed: std::collections::HashSet<String> = std::collections::HashSet::new();

    for player in players.iter_mut() {
        if player.team_id.as_deref() != Some(&team.id) {
            continue;
        }

        // No-deadlock guard: skip already processed
        if !processed.insert(player.id.clone()) {
            continue;
        }

        // Find their retention score from the report
        let score = report
            .retention_scores
            .iter()
            .find(|(id, _)| id == &player.id)
            .map(|(_, s)| *s)
            .unwrap_or(0.5);

        // Spec TA-02: Skip underperformer
        let is_underperformer = known_rating(player)
            .is_some_and(|rating| rating < UNDERPERFORMER_RATING)
            || current_ovr(player) < UNDERPERFORMER_OVR;
        if is_underperformer {
            continue;
        }

        // Skip players with zero wage (data anomaly / free agent edge case)
        if player.wage == 0 {
            continue;
        }

        // Check budget headroom
        let projected_wage = if player.wage > 0 {
            // Offer slight increase
            (player.wage as f64 * 1.10) as i64
        } else {
            player.wage as i64
        };

        let projected_bill = current_wage_bill - i64::from(player.wage) + projected_wage;
        if projected_bill > soft_cap_wage {
            continue; // budget exhausted
        }

        // Spec TA-02: Renew high performer
        let is_high_performer = player.stats.avg_rating > HIGH_PERFORMER_RATING
            && current_ovr(player) > HIGH_PERFORMER_OVR
            && contract_security(player.contract_end.as_deref(), today) < 0.5; // < ~18 months

        if score >= RENEWAL_THRESHOLD || is_high_performer {
            if player.morale_core.renewal_state.is_none() {
                player.morale_core.renewal_state = Some(ContractRenewalState {
                    status: RenewalSessionStatus::Open,
                    ..ContractRenewalState::default()
                });
            } else if let Some(ref mut state) = player.morale_core.renewal_state
                && state.status == RenewalSessionStatus::Idle {
                    state.status = RenewalSessionStatus::Open;
                }
        }
    }
}

// ---------------------------------------------------------------------------
// Deadweight score computation
// ---------------------------------------------------------------------------

/// Compute a deadweight score (0..1) indicating how much of a burden
/// this player is on the team's finances relative to their contribution.
/// High score = candidate for sale.
/// Factors: low lol_ovr, high wage, short contract.
fn compute_deadweight_score(player: &Player, today: NaiveDate) -> f64 {
    // Normalise lol_ovr: lower = more deadweight (invert)
    let ovr_factor = 1.0 - (f64::from(player.lol_ovr) / 99.0);

    // Wage factor: higher wage relative to reasonable baseline = more deadweight
    let wage_factor = (f64::from(player.wage) / 100_000.0).min(1.0);

    // Contract factor: shorter remaining = more deadweight
    let contract_factor = match player.contract_end.as_deref() {
        Some(end_str) => {
            if let Ok(end) = NaiveDate::parse_from_str(end_str, "%Y-%m-%d") {
                let months_remaining =
                    (end.signed_duration_since(today).num_days() as f64 / 30.44).max(0.0);
                // 0 months → 1.0 (deadweight), 24+ months → 0.0
                1.0 - (months_remaining / 24.0).clamp(0.0, 1.0)
            } else {
                1.0
            }
        }
        None => 1.0,
    };

    ovr_factor * DW_OVR_WEIGHT + wage_factor * DW_WAGE_WEIGHT + contract_factor * DW_CONTRACT_WEIGHT
}

// ---------------------------------------------------------------------------
// Selling decisions
// ---------------------------------------------------------------------------

/// Evaluate which players on a team should be put on the transfer list.
/// Sets `player.transfer_listed = true` for eligible players.
///
/// Spec TA-03: age > 28 + top-25% wage + avg_rating < 6.5 + contract_end > 12 months.
/// Also marks players with high deadweight score.
/// Edge cases: new signings protected, injured/out-of-form players protected.
pub fn evaluate_sales(team: &Team, players: &mut [Player], today: NaiveDate) {
    // Compute top-25% wage threshold for this team
    let mut wages: Vec<u32> = players
        .iter()
        .filter(|p| p.team_id.as_deref() == Some(&team.id))
        .map(|p| p.wage)
        .collect();
    wages.sort_unstable_by(|a, b| b.cmp(a));
    let top_25_threshold = if wages.is_empty() {
        u32::MAX
    } else {
        let idx = ((wages.len().saturating_sub(1)) as f64 * TOP_WAGE_QUARTILE) as usize;
        wages[idx]
    };

    let mut processed: std::collections::HashSet<String> = std::collections::HashSet::new();

    for player in players.iter_mut() {
        if player.team_id.as_deref() != Some(&team.id) {
            continue;
        }

        // No-deadlock guard
        if !processed.insert(player.id.clone()) {
            continue;
        }

        // Edge case: new signing (protected from immediate sale)
        if let Some(ref date_str) = player.can_be_transferred_until
            && let Ok(date) = NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
                && date > today {
                    continue;
                }

        // Edge case: injured / out of form (condition < 40)
        if player.condition < 40 {
            continue;
        }

        // Spec TA-03 explicit criteria
        let age = player_age(&player.date_of_birth, today);
        let contract_months_remaining = match player.contract_end.as_deref() {
            Some(end_str) => {
                if let Ok(end) = NaiveDate::parse_from_str(end_str, "%Y-%m-%d") {
                    (end.signed_duration_since(today).num_days() as f64 / 30.44).max(0.0)
                } else {
                    0.0
                }
            }
            None => 0.0,
        };

        let meets_sale_criteria = age > SALE_AGE_THRESHOLD
            && player.wage >= top_25_threshold
            && player.stats.avg_rating < SALE_RATING_THRESHOLD
            && contract_months_remaining > 12.0;

        // Deadweight score (design: low lol_ovr + high wage + short contract)
        let deadweight = compute_deadweight_score(player, today);
        let is_deadweight = deadweight > DEADWEIGHT_THRESHOLD;

        if meets_sale_criteria || is_deadweight {
            player.transfer_listed = true;
        }
    }
}

// ---------------------------------------------------------------------------
// Buying decisions
// ---------------------------------------------------------------------------

/// Evaluate whether a team should purchase players to fill roster gaps.
/// Checks transfer budget, role gaps from the report, and wage budget headroom.
/// Takes `team_id` to avoid borrow conflicts with `&mut Game`.
pub fn evaluate_purchases(team_id: &str, game: &mut Game, report: &RosterReport) {
    use crate::domain::season::TransferWindowStatus;

    // Look up team
    let (transfer_budget, wage_budget) = match game.teams.iter().find(|t| t.id == team_id) {
        Some(t) => (t.transfer_budget, t.wage_budget),
        None => return,
    };

    // Zero budget check — TA-05 budget respect
    if transfer_budget == 0 {
        return;
    }

    // Respect league transfer windows
    let transfer_open = matches!(
        game.season_context.transfer_window.status,
        TransferWindowStatus::Open | TransferWindowStatus::DeadlineDay
    );
    if !transfer_open {
        return;
    }

    // No role gaps — nothing to buy
    if report.role_gaps.is_empty() {
        return;
    }

    // Check wage budget headroom
    let soft_cap_wage = (wage_budget as f64 * WAGE_SOFT_CAP_MULTIPLIER) as i64;
    let current_wage_bill: i64 = game
        .players
        .iter()
        .filter(|p| p.team_id.as_deref() == Some(team_id))
        .map(|p| i64::from(p.wage))
        .sum();

    // Compute cheapest available free agent wage + estimate for headroom
    let cheapest_fa_wage = game
        .players
        .iter()
        .filter(|p| p.team_id.is_none())
        .map(|p| p.wage)
        .min()
        .unwrap_or(0);

    let projected_bill = current_wage_bill + i64::from(cheapest_fa_wage);
    if projected_bill > soft_cap_wage {
        return; // no wage budget headroom
    }

    // For each role gap, try to purchase an affordable free agent
    for role in &report.role_gaps {
        if *role == crate::domain::stats::LolRole::Unknown {
            continue;
        }
        let role_str = crate::transfers::lol_role_to_string(role);
        crate::transfers::ai_agent_purchase(game, team_id, role_str);
    }
}

// ---------------------------------------------------------------------------
// Staggered processing
// ---------------------------------------------------------------------------

/// Select non-player, non-academy teams for processing today using round-robin.
fn select_ai_teams_for_today(game: &Game) -> Vec<String> {
    let ai_teams: Vec<&Team> = game
        .teams
        .iter()
        .filter(|t| t.team_kind == crate::domain::team::TeamKind::Main && t.manager_id.is_none())
        .collect();

    if ai_teams.is_empty() {
        return Vec::new();
    }

    // Use day-of-year as round-robin offset
    let day_of_year = game
        .clock
        .current_date
        .format("%j")
        .to_string()
        .parse::<usize>()
        .unwrap_or(0);
    let count = TEAMS_PER_DAY.min(ai_teams.len());
    let start = day_of_year % ai_teams.len();

    (0..count)
        .map(|i| {
            let idx = (start + i) % ai_teams.len();
            ai_teams[idx].id.clone()
        })
        .collect()
}

/// Public entry point called from turn/mod.rs.
/// Processes up to 3 AI teams per day: assess roster, renewals, sales, purchases.
pub fn process_ai_team_agents(game: &mut Game) {
    let today = game.clock.current_date.date_naive();

    let team_ids = select_ai_teams_for_today(game);

    // --- Phase 1: Renewals + Sales (borrow team + players mutably) ---
    for team_id in &team_ids {
        let team = match game.teams.iter().find(|t| t.id == *team_id) {
            Some(t) => t,
            None => continue,
        };

        let report = assess_roster(team, &game.players, today);

        // Apply renewal decisions (mutable borrow of game.players)
        evaluate_renewals(team, &mut game.players, &report, today);

        // Apply sale decisions (mutable borrow of game.players)
        evaluate_sales(team, &mut game.players, today);
    }

    // --- Phase 2: Purchases (need &mut Game for transfers module) ---
    // Separate loop so the &Team borrow from game.teams ends before &mut Game.
    for team_id in &team_ids {
        let report = {
            let team = match game.teams.iter().find(|t| t.id == *team_id) {
                Some(t) => t,
                None => continue,
            };
            assess_roster(team, &game.players, today)
        }; // team borrow ends here

        evaluate_purchases(team_id, &mut *game, &report);
    }
}

// ---------------------------------------------------------------------------
// Strategic recruitment — high-reputation tier-1 clubs pursue upgrades
// ---------------------------------------------------------------------------

const STRATEGIC_REPUTATION_THRESHOLD: u32 = 1_100;

/// Evaluate contracted players from other clubs as upgrades for elite teams.
/// Falls back to high-impact free agents if no club-to-club target is found.
/// Respects the shared signing policy and the daily AI transfer cap.
pub fn ai_strategic_recruitment(game: &mut Game, team_id: &str) {
    let transfer_open = matches!(
        game.season_context.transfer_window.status,
        TransferWindowStatus::Open | TransferWindowStatus::DeadlineDay
    );
    if !transfer_open {
        return;
    }

    let Some(team) = game.teams.iter().find(|t| t.id == team_id).cloned() else {
        return;
    };
    if team.team_kind != crate::domain::team::TeamKind::Main || team.manager_id.is_some() {
        return;
    }
    if team.reputation < STRATEGIC_REPUTATION_THRESHOLD {
        return;
    }
    if ai_team_tier(&team, game) != 1 {
        return;
    }
    if team.transfer_budget <= 0 || team.finance <= 0 {
        return;
    }

    let current_date = game.clock.current_date.date_naive();
    let budget_cap = team.transfer_budget.min(team.finance);
    let preferred_role = crate::transfers::ai_team_priority_role(game, team_id);
    let user_team_id = game.manager.team_id.as_deref();

    // Club-to-club upgrade path: target the team's weakest role on another club.
    let club_candidate = {
        let candidates: Vec<(String, String, u64)> = game
            .players
            .iter()
            .filter_map(|player| {
                let seller_id = player.team_id.as_deref()?;
                if seller_id == team_id {
                    return None;
                }
                // Do not poach the user-managed team without a negotiated offer.
                if user_team_id == Some(seller_id) {
                    return None;
                }
                let seller_team = game.teams.iter().find(|t| t.id == seller_id)?;
                if seller_team.team_kind != crate::domain::team::TeamKind::Main {
                    return None;
                }
                if crate::transfers::lol_role_to_string(&player.natural_position) != preferred_role
                {
                    return None;
                }
                if let Some(date_str) = &player.can_be_transferred_until
                    && let Ok(date) = NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
                        && date >= current_date {
                            return None;
                        }
                let fee =
                    crate::transfers::suggested_incoming_fee(current_date, player, &team, team_id);
                if fee == 0 || (fee as i64) > budget_cap {
                    return None;
                }
                let decision = ai_signing_policy(game, &team, player, SigningIntent::Strategic);
                if !decision.accepted {
                    return None;
                }
                Some((player.id.clone(), seller_id.to_string(), fee))
            })
            .collect();

        candidates
            .into_iter()
            .map(|(player_id, seller_id, fee)| {
                let market_value = game
                    .players
                    .iter()
                    .find(|p| p.id == player_id)
                    .map(|p| p.market_value)
                    .unwrap_or(0);
                (player_id, seller_id, fee, market_value)
            })
            .max_by_key(|(_, _, _, market_value)| *market_value)
    };

    if let Some((player_id, seller_id, fee, _)) = club_candidate {
        if ai_transfer_cap_try_consume(game, team_id, AiTransferKind::ClubToClub) {
            let _ = crate::transfers::execute_transfer(
                game, &player_id, team_id, &seller_id, fee, true,
            );
        }
        return;
    }

    // Free-agent fallback: sign a high-impact free agent for the weak role.
    let mut fa_candidate: Option<(String, u64, u64)> = None;
    let mut rejected_candidate: Option<(String, u64)> = None;
    for p in game
        .players
        .iter()
        .filter(|p| p.team_id.is_none())
        .filter(|p| crate::transfers::lol_role_to_string(&p.natural_position) == preferred_role)
    {
        let fee = (p.market_value as i64).max(25_000) / 5;
        if fee <= 0 || fee > budget_cap {
            continue;
        }
        let decision = ai_signing_policy(game, &team, p, SigningIntent::Strategic);
        if decision.accepted {
            let current_best = fa_candidate.as_ref().map(|(_, _, mv)| *mv).unwrap_or(0);
            if p.market_value > current_best {
                fa_candidate = Some((p.id.clone(), fee as u64, p.market_value));
            }
        } else if matches!(
            decision.reason,
            crate::contract_wage_policy::SigningRejectionReason::ReputationMismatch
        ) {
            let current_best = rejected_candidate.as_ref().map(|(_, mv)| *mv).unwrap_or(0);
            if p.market_value > current_best {
                rejected_candidate = Some((p.id.clone(), p.market_value));
            }
        }
    }

    if let Some((player_id, fee, _)) = fa_candidate {
        if ai_transfer_cap_try_consume(game, team_id, AiTransferKind::Strategic) {
            let _ = crate::transfers::execute_free_agent_signing(game, &player_id, team_id, fee);
        }
        return;
    }

    // Tag a strategic rejection in news if no high-impact fallback was found.
    if let Some((player_id, _)) = rejected_candidate {
        crate::turn::news::generate_strategic_rejection_news(game, team_id, &player_id);
    }
}

// ---------------------------------------------------------------------------
// Conflict resolution — Team Agent overrides Player Agent
// ---------------------------------------------------------------------------

/// Resolve conflicts between Player Agent and Team Agent decisions.
///
/// For each player newly transfer-listed by Player Agent who is under contract:
/// - If retention_score >= RENEWAL_THRESHOLD → cancel the transfer listing
/// - If the player is the ONLY player at their role on the team AND
///   contract extends > 12 months from today → cancel the transfer listing
///
/// Spec OR-03: Under-contract → Team Agent overrides Player Agent.
/// Spec OR-04: Free agents (no contract / expired) → Player Agent decision is final;
///             this function skips them implicitly.
pub fn resolve_conflicts(game: &mut Game, previously_transfer_listed: &HashSet<String>) {
    use crate::domain::stats::LolRole;
    use std::collections::HashMap;

    let today = game.clock.current_date.date_naive();

    // Phase 1: Collect info needed to decide overrides.
    // Use separate references to avoid borrow conflicts.
    let teams = &game.teams;
    let players = &game.players;

    // Pre-compute role depth per team
    let mut role_depth: HashMap<(String, LolRole), u32> = HashMap::new();
    for p in players {
        if let Some(ref tid) = p.team_id {
            *role_depth
                .entry((tid.clone(), p.natural_position))
                .or_insert(0) += 1;
        }
    }

    let mut override_ids: Vec<String> = Vec::new();

    for player in players
        .iter()
        .filter(|p| p.transfer_listed && !previously_transfer_listed.contains(&p.id))
    {
        // Only under-contract players (OR-03)
        let contract_end = match player.contract_end.as_deref() {
            Some(s) => match NaiveDate::parse_from_str(s, "%Y-%m-%d").ok() {
                Some(d) => d,
                None => continue,
            },
            None => continue, // free agent → Player Agent decision is final (OR-04)
        };
        if contract_end <= today {
            continue; // expired contract → free agent
        }

        let team = match teams
            .iter()
            .find(|t| player.team_id.as_deref() == Some(&t.id))
        {
            Some(t) => t,
            None => continue,
        };
        if team.team_kind != crate::domain::team::TeamKind::Main || team.manager_id.is_some() {
            continue;
        }

        let r_score = retention_score(player, team, today);

        // Check if critical depth (only player at role)
        let team_id = match player.team_id.as_deref() {
            Some(id) => id,
            None => continue,
        };
        let role = player.natural_position;
        let count_at_role = *role_depth.get(&(team_id.to_string(), role)).unwrap_or(&0);
        let is_only = count_at_role <= 1;

        // Under-contract rule (1.3): contract > 12 months + critical depth
        let months_remaining =
            (contract_end.signed_duration_since(today).num_days() as f64 / 30.44).max(0.0);
        let long_contract_critical = months_remaining > 12.0 && is_only;

        if r_score >= RENEWAL_THRESHOLD || long_contract_critical {
            override_ids.push(player.id.clone());
        }
    }

    // Phase 2: Reset transfer_listed for overridden players
    for player in &mut game.players {
        if override_ids.iter().any(|id| id == &player.id) {
            player.transfer_listed = false;
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::GameClock;
    use crate::domain::manager::Manager;
    use crate::domain::player::RenewalSessionStatus;
    use crate::domain::player::{LolRole, Player, PlayerAttributes, PlayerSeasonStats};
    use crate::domain::team::Team;
    use chrono::{TimeZone, Utc};

    fn default_attrs() -> PlayerAttributes {
        PlayerAttributes {
            mechanics: 70,
            laning: 70,
            teamfighting: 70,
            macro_play: 70,
            consistency: 70,
            shotcalling: 70,
            champion_pool: 70,
            discipline: 70,
            mental_resilience: 70,
        }
    }

    #[allow(clippy::too_many_arguments)] // params struct would be an out-of-scope signature refactor
    fn make_player(
        id: &str,
        name: &str,
        team_id: &str,
        role: LolRole,
        lol_ovr: u8,
        avg_rating: f32,
        wage: u32,
        contract_end: Option<&str>,
        age: &str,
        traits: Vec<PlayerTrait>,
    ) -> Player {
        let mut player = Player::new(
            id.to_string(),
            name.to_string(),
            format!("Full {}", name),
            age.to_string(),
            "GB".to_string(),
            role,
            default_attrs(),
        );
        player.team_id = Some(team_id.to_string());
        player.lol_ovr = lol_ovr;
        player.stats = PlayerSeasonStats {
            avg_rating,
            ..PlayerSeasonStats::default()
        };
        player.wage = wage;
        player.contract_end = contract_end.map(|s| s.to_string());
        player.traits = traits;
        player
    }

    fn make_team(id: &str, name: &str) -> Team {
        let mut team = Team::new(
            id.to_string(),
            name.to_string(),
            name[..3].to_string(),
            "DE".to_string(),
            "Berlin".to_string(),
            "Arena".to_string(),
            10_000,
        );
        team.wage_budget = 500_000;
        team.transfer_budget = 200_000;
        team
    }

    fn test_date() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 6, 15).unwrap()
    }

    // Phase 1 — Scoring core

    #[test]
    fn test_age_factor_young() {
        assert!((age_factor(20) - 1.0).abs() < 0.001);
        assert!((age_factor(18) - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_age_factor_old() {
        assert!((age_factor(35) - 0.0).abs() < 0.001);
        assert!((age_factor(40) - 0.0).abs() < 0.001);
    }

    #[test]
    fn test_age_factor_mid() {
        let f = age_factor(27);
        assert!(f > 0.0 && f < 1.0);
        assert!((f - (1.0 - 7.0 / 15.0)).abs() < 0.001);
    }

    #[test]
    fn test_contract_security_no_contract() {
        assert!((contract_security(None, test_date()) - 0.0).abs() < 0.001);
    }

    #[test]
    fn test_contract_security_long() {
        let end = "2029-06-15";
        let sec = contract_security(Some(end), test_date());
        assert!(sec > 0.9);
    }

    #[test]
    fn test_contract_security_short() {
        let end = "2026-09-15";
        let sec = contract_security(Some(end), test_date());
        assert!(sec > 0.0 && sec < 0.3);
    }

    #[test]
    fn test_wage_value_ratio_good_value() {
        assert!((wage_value_ratio(50_000, 60_000) - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_wage_value_ratio_overpaid() {
        let r = wage_value_ratio(100_000, 50_000);
        assert!((0.3..1.0).contains(&r));
    }

    #[test]
    fn test_trait_bonus_key_traits() {
        let traits = vec![PlayerTrait::HyperCarry, PlayerTrait::ShotCaller];
        let bonus = trait_bonus(&traits);
        assert!((bonus - 0.4).abs() < 0.001);
    }

    #[test]
    fn test_trait_bonus_no_traits() {
        let bonus = trait_bonus(&[]);
        assert!((bonus - 0.0).abs() < 0.001);
    }

    #[test]
    fn test_retention_score_high_performer() {
        let team = make_team("t1", "Test Team");
        let player = make_player(
            "p1",
            "Star",
            "t1",
            LolRole::Mid,
            95,                 // lol_ovr
            8.5,                // avg_rating
            60_000,             // wage
            Some("2027-06-15"), // contract_end
            "2002-01-01",       // age ~24
            vec![PlayerTrait::HyperCarry],
        );
        let score = retention_score(&player, &team, test_date());
        assert!(
            score > 0.7,
            "retention_score should be high for star, got {score}"
        );
    }

    #[test]
    fn test_retention_score_low_performer() {
        let team = make_team("t1", "Test Team");
        let player = make_player(
            "p2",
            "Bust",
            "t1",
            LolRole::Top,
            55,                 // low lol_ovr
            5.0,                // low avg_rating
            80_000,             // overpaid
            Some("2026-09-15"), // contract ending soon
            "1995-01-01",       // age ~31
            vec![],
        );
        let score = retention_score(&player, &team, test_date());
        assert!(
            score < 0.5,
            "retention_score should be low for bust, got {score}"
        );
    }

    // Phase 1 — assess_roster

    #[test]
    fn test_assess_roster_basic() {
        let team = make_team("t1", "Test Team");
        let player = make_player(
            "p1",
            "Star",
            "t1",
            LolRole::Mid,
            90,
            8.0,
            60_000,
            Some("2027-06-15"),
            "2002-01-01",
            vec![],
        );
        let report = assess_roster(&team, &[player], test_date());
        assert_eq!(*report.role_depth.get(&LolRole::Mid).unwrap(), 1);
        assert!(*report.role_depth.get(&LolRole::Top).unwrap() == 0);
        assert!(report.role_gaps.contains(&LolRole::Top));
        assert!(!report.retention_scores.is_empty());
    }

    #[test]
    fn test_assess_roster_empty() {
        let team = make_team("t1", "Test Team");
        let report = assess_roster(&team, &[], test_date());
        assert_eq!(report.role_gaps.len(), 5); // all roles are gaps
    }

    #[test]
    fn test_assess_roster_role_gaps_identified() {
        let team = make_team("t1", "Test Team");
        let players = vec![
            make_player(
                "p1",
                "Top",
                "t1",
                LolRole::Top,
                80,
                7.0,
                50_000,
                Some("2027-06-15"),
                "2002-01-01",
                vec![],
            ),
            make_player(
                "p2",
                "Mid",
                "t1",
                LolRole::Mid,
                85,
                7.5,
                55_000,
                Some("2027-06-15"),
                "2002-01-01",
                vec![],
            ),
        ];
        let report = assess_roster(&team, &players, test_date());
        assert!(report.role_gaps.contains(&LolRole::Jungle));
        assert!(report.role_gaps.contains(&LolRole::Adc));
        assert!(report.role_gaps.contains(&LolRole::Support));
        assert!(!report.role_gaps.contains(&LolRole::Top));
        assert!(!report.role_gaps.contains(&LolRole::Mid));
    }

    // Phase 2 — Renewal decisions

    #[test]
    fn test_evaluate_renewals_high_performer_gets_offer() {
        let team = make_team("t1", "Test Team");
        let today = test_date();
        let mut players = vec![make_player(
            "p1",
            "Star",
            "t1",
            LolRole::Mid,
            85,
            8.0,
            50_000,
            Some("2026-09-15"), // < 6 months
            "2002-01-01",
            vec![],
        )];
        let report = assess_roster(&team, &players, today);
        evaluate_renewals(&team, &mut players, &report, today);

        let state = players[0].morale_core.renewal_state.as_ref();
        assert!(state.is_some(), "high performer should get renewal state");
        if let Some(s) = state {
            assert_eq!(s.status, RenewalSessionStatus::Open);
        }
    }

    #[test]
    fn test_evaluate_renewals_skip_underperformer() {
        let team = make_team("t1", "Test Team");
        let today = test_date();
        let mut players = vec![make_player(
            "p2",
            "Bust",
            "t1",
            LolRole::Top,
            55,
            5.0,
            50_000,
            Some("2026-09-15"),
            "1995-01-01",
            vec![],
        )];
        let report = assess_roster(&team, &players, today);
        evaluate_renewals(&team, &mut players, &report, today);

        assert!(
            players[0].morale_core.renewal_state.is_none(),
            "underperformer should NOT get renewal state"
        );
    }

    /// Matches of clubs outside the user's league never write player stats, so their
    /// players sit at rating 0 with no appearances: that is missing data, not bad form.
    #[test]
    fn evaluate_renewals_opens_session_for_player_without_rating_data() {
        let team = make_team("t1", "Test Team");
        let today = test_date();
        let mut players = vec![make_player(
            "p1",
            "Unrated Star",
            "t1",
            LolRole::Mid,
            85,
            0.0, // no matches recorded
            50_000,
            Some("2029-06-15"),
            "2002-01-01",
            vec![],
        )];
        let report = assess_roster(&team, &players, today);
        evaluate_renewals(&team, &mut players, &report, today);

        assert!(
            matches!(
                &players[0].morale_core.renewal_state,
                Some(s) if s.status == RenewalSessionStatus::Open
            ),
            "a good player with no rating data should get a renewal session"
        );
    }

    /// `lol_ovr` is stored, not derived, and a new game never fills it in for most of the
    /// world (saves refresh it on load). A stored 0 is "not computed", not a 0-rated player.
    #[test]
    fn evaluate_renewals_derives_ovr_when_the_stored_one_was_never_computed() {
        let team = make_team("t1", "Test Team");
        let today = test_date();
        let mut player = make_player(
            "p1",
            "Fresh Star",
            "t1",
            LolRole::Mid,
            0, // never computed
            8.0,
            50_000,
            Some("2029-06-15"),
            "2002-01-01",
            vec![],
        );
        player.stats.appearances = 20;
        player.attributes = PlayerAttributes {
            mechanics: 85,
            laning: 85,
            teamfighting: 85,
            macro_play: 85,
            consistency: 85,
            shotcalling: 85,
            champion_pool: 85,
            discipline: 85,
            mental_resilience: 85,
        };
        let mut players = vec![player];
        let report = assess_roster(&team, &players, today);
        evaluate_renewals(&team, &mut players, &report, today);

        assert!(
            matches!(
                &players[0].morale_core.renewal_state,
                Some(s) if s.status == RenewalSessionStatus::Open
            ),
            "an 85-attribute player must not be skipped as a 0-ovr underperformer"
        );
    }

    #[test]
    fn evaluate_renewals_skips_low_ovr_player_without_rating_data() {
        let team = make_team("t1", "Test Team");
        let today = test_date();
        let mut players = vec![make_player(
            "p1",
            "Unrated Bust",
            "t1",
            LolRole::Top,
            55,
            0.0,
            50_000,
            Some("2029-06-15"),
            "2002-01-01",
            vec![],
        )];
        let report = assess_roster(&team, &players, today);
        evaluate_renewals(&team, &mut players, &report, today);

        assert!(
            players[0].morale_core.renewal_state.is_none(),
            "no rating data must still be judged on lol_ovr"
        );
    }

    #[test]
    fn evaluate_renewals_skips_player_with_a_recorded_bad_rating() {
        let team = make_team("t1", "Test Team");
        let today = test_date();
        let mut player = make_player(
            "p1",
            "Slumping Star",
            "t1",
            LolRole::Mid,
            85,
            5.0,
            50_000,
            Some("2029-06-15"),
            "2002-01-01",
            vec![],
        );
        player.stats.appearances = 20;
        let mut players = vec![player];
        let report = assess_roster(&team, &players, today);
        evaluate_renewals(&team, &mut players, &report, today);

        assert!(
            players[0].morale_core.renewal_state.is_none(),
            "a rating recorded over real matches still counts as underperforming"
        );
    }

    #[test]
    fn retention_score_does_not_punish_missing_rating_data() {
        let team = make_team("t1", "Test Team");
        let unrated = make_player(
            "p1",
            "Unrated",
            "t1",
            LolRole::Mid,
            85,
            0.0,
            50_000,
            Some("2029-06-15"),
            "2002-01-01",
            vec![],
        );
        let mut slumping = unrated.clone();
        slumping.stats.avg_rating = 5.0;
        slumping.stats.appearances = 20;

        assert!(
            retention_score(&unrated, &team, test_date())
                > retention_score(&slumping, &team, test_date()),
            "a player nobody has rated must not score below one with a poor rating"
        );
    }

    #[test]
    fn test_evaluate_renewals_budget_exhausted() {
        let mut team = make_team("t1", "Poor Team");
        team.wage_budget = 50_000; // tight budget
        let today = test_date();
        let mut players = vec![make_player(
            "p1",
            "Star",
            "t1",
            LolRole::Mid,
            85,
            8.0,
            90_000, // already expensive
            Some("2026-09-15"),
            "2002-01-01",
            vec![PlayerTrait::HyperCarry],
        )];
        // Override lol_ovr since assess_roster reads it directly (no Game::new refresh here)
        players[0].lol_ovr = 85;

        let report = assess_roster(&team, &players, today);
        evaluate_renewals(&team, &mut players, &report, today);

        // Soft cap = 50_000 * 1.10 = 55_000, projected = 90_000 * 1.10 = 99_000 > 55_000
        let state = &players[0].morale_core.renewal_state;
        let is_open = matches!(state, Some(s) if s.status == RenewalSessionStatus::Open);
        assert!(
            !is_open,
            "renewal should be skipped when budget is exhausted"
        );
    }

    #[test]
    fn test_no_deadlock_same_player_not_processed_twice() {
        let team = make_team("t1", "Test Team");
        let today = test_date();
        let mut players = vec![
            make_player(
                "p1",
                "Star",
                "t1",
                LolRole::Mid,
                85,
                8.0,
                50_000,
                Some("2026-09-15"),
                "2002-01-01",
                vec![],
            ),
            // Duplicate same player ID to test deadlock guard
            make_player(
                "p1",
                "Star Clone",
                "t1",
                LolRole::Mid,
                85,
                8.0,
                50_000,
                Some("2026-09-15"),
                "2002-01-01",
                vec![],
            ),
        ];
        // Override lol_ovr since assess_roster reads it directly (no Game::new refresh here)
        players[0].lol_ovr = 85;
        players[1].lol_ovr = 85;

        let report = assess_roster(&team, &players, today);
        evaluate_renewals(&team, &mut players, &report, today);

        // Both have same ID, but the no-deadlock guard ensures
        // only one is processed (players[0]). The second is skipped,
        // so it retains its default state (None) — spec I-04.
        // Verify no panic, and first entry gets processed.
        assert!(
            players[0].morale_core.renewal_state.is_some(),
            "first occurrence should get renewal state"
        );
        assert!(
            players[1].morale_core.renewal_state.is_none(),
            "duplicate should be skipped by deadlock guard"
        );
    }

    #[test]
    fn test_process_ai_team_agents_no_panic() {
        use crate::domain::team::TeamKind;

        let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 6, 15, 12, 0, 0).unwrap());
        let manager = Manager::new(
            "mgr1".to_string(),
            "Test".to_string(),
            "Manager".to_string(),
            "1980-01-01".to_string(),
            "GB".to_string(),
        );
        let mut team = make_team("ai_team", "AI Team");
        team.team_kind = TeamKind::Main;
        team.manager_id = None; // AI team

        let player = make_player(
            "p1",
            "Star",
            "ai_team",
            LolRole::Mid,
            85,
            8.0,
            50_000,
            Some("2026-09-15"),
            "2002-01-01",
            vec![],
        );
        let mut game = Game::new(clock, manager, vec![team], vec![player], vec![], vec![]);
        // Game::new refreshes lol_ovr from attributes — override to test high performer logic
        game.players[0].lol_ovr = 85;
        process_ai_team_agents(&mut game);

        // Verify no panic, renewal states set
        let star = game.players.iter().find(|p| p.id == "p1").unwrap();
        assert!(
            star.morale_core.renewal_state.is_some(),
            "star player should have renewal state set"
        );
    }

    #[test]
    fn test_process_ai_team_agents_empty_roster() {
        use crate::domain::team::TeamKind;

        let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 6, 15, 12, 0, 0).unwrap());
        let manager = Manager::new(
            "mgr1".to_string(),
            "Test".to_string(),
            "Manager".to_string(),
            "1980-01-01".to_string(),
            "GB".to_string(),
        );
        let mut team = make_team("ai_team", "AI Team");
        team.team_kind = TeamKind::Main;
        team.manager_id = None;

        let mut game = Game::new(clock, manager, vec![team], vec![], vec![], vec![]);
        process_ai_team_agents(&mut game);
        // Should not panic with 0 eligible players
    }

    #[test]
    fn test_process_ai_team_agents_full_integration() {
        use crate::clock::GameClock;
        use crate::domain::manager::Manager;
        use crate::domain::player::LolRole;
        use crate::domain::season::TransferWindowStatus;
        use crate::domain::team::TeamKind;
        use chrono::{TimeZone, Utc};

        let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 6, 15, 12, 0, 0).unwrap());
        let manager = Manager::new(
            "mgr1".to_string(),
            "Test".to_string(),
            "Manager".to_string(),
            "1980-01-01".to_string(),
            "GB".to_string(),
        );

        // AI team with budget + a role gap (no Support)
        let mut team = make_team("ai_team", "AI Team");
        team.team_kind = TeamKind::Main;
        team.manager_id = None;
        team.transfer_budget = 500_000;
        team.wage_budget = 500_000;

        let base_players = vec![
            make_player(
                "p1",
                "Top",
                "ai_team",
                LolRole::Top,
                80,
                7.0,
                40_000,
                Some("2027-06-15"),
                "2000-01-01",
                vec![],
            ),
            make_player(
                "p2",
                "Jg",
                "ai_team",
                LolRole::Jungle,
                75,
                6.8,
                45_000,
                Some("2027-06-15"),
                "2000-01-01",
                vec![],
            ),
            make_player(
                "p3",
                "Mid",
                "ai_team",
                LolRole::Mid,
                85,
                8.5,
                50_000,
                Some("2026-09-15"),
                "2002-01-01",
                vec![],
            ), // high performer, short contract
            make_player(
                "p4",
                "Adc",
                "ai_team",
                LolRole::Adc,
                78,
                7.2,
                45_000,
                Some("2027-06-15"),
                "2000-01-01",
                vec![],
            ),
            // Expendable veteran on high wage who should get transfer_listed
            make_player(
                "p5",
                "Vet",
                "ai_team",
                LolRole::Top,
                60,
                5.5,
                120_000,
                Some("2028-06-15"),
                "1995-01-01",
                vec![],
            ),
        ];

        let mut game = Game::new(clock, manager, vec![team], base_players, vec![], vec![]);
        game.season_context.transfer_window.status = TransferWindowStatus::Open;

        // Add a free agent Support
        let mut fa = make_player(
            "fa1",
            "FreeSupp",
            "none",
            LolRole::Support,
            70,
            6.5,
            30_000,
            None,
            "2001-01-01",
            vec![],
        );
        fa.market_value = 100_000;
        fa.team_id = None;
        game.players.push(fa);

        // Override lol_ovr values that Game::new resets
        game.players[0].lol_ovr = 80;
        game.players[1].lol_ovr = 75;
        game.players[2].lol_ovr = 85;
        game.players[3].lol_ovr = 78;
        game.players[4].lol_ovr = 60;

        process_ai_team_agents(&mut game);

        // 1. High performer (p3) should get renewal state
        let p3 = game.players.iter().find(|p| p.id == "p3").unwrap();
        assert!(
            p3.morale_core.renewal_state.is_some(),
            "high performer should get renewal offer"
        );

        // 2. Expendable veteran (p5) should be transfer_listed
        let p5 = game.players.iter().find(|p| p.id == "p5").unwrap();
        assert!(
            p5.transfer_listed,
            "expendable veteran should be transfer listed"
        );

        // 3. The team should not crash — full integration runs without panics
        //    and game state is internally consistent
        if let Some(team) = game.teams.iter().find(|t| t.id == "ai_team") {
            assert!(team.transfer_budget >= 0, "budget should not go negative");
        }
    }

    #[test]
    fn test_player_age_computation() {
        let today = NaiveDate::from_ymd_opt(2026, 6, 15).unwrap();
        assert_eq!(player_age("2000-01-01", today), 26);
        assert_eq!(player_age("1995-06-15", today), 31);
        assert_eq!(player_age("2020-06-15", today), 6);
    }

    #[test]
    fn test_compute_deadweight_score_high_ovr_low_wage() {
        let today = NaiveDate::from_ymd_opt(2026, 6, 15).unwrap();
        let player = make_player(
            "p1",
            "Star",
            "t1",
            LolRole::Mid,
            99,
            8.0,
            50_000,
            Some("2028-06-15"),
            "2000-01-01",
            vec![],
        );
        let score = compute_deadweight_score(&player, today);
        assert!(
            score < 0.3,
            "star player with long contract should have low deadweight score, got {score}"
        );
    }

    #[test]
    fn test_compute_deadweight_score_low_ovr_high_wage() {
        let today = NaiveDate::from_ymd_opt(2026, 6, 15).unwrap();
        let player = make_player(
            "p2",
            "Bust",
            "t1",
            LolRole::Top,
            40,
            5.0,
            200_000,
            Some("2026-09-15"),
            "1995-01-01",
            vec![],
        );
        let score = compute_deadweight_score(&player, today);
        assert!(
            score > 0.6,
            "bust player with high wage should have high deadweight score, got {score}"
        );
    }

    #[test]
    fn test_compute_deadweight_score_no_contract() {
        let today = NaiveDate::from_ymd_opt(2026, 6, 15).unwrap();
        let player = make_player(
            "p3",
            "Expiring",
            "t1",
            LolRole::Support,
            60,
            6.0,
            80_000,
            None,
            "1998-01-01",
            vec![],
        );
        let score = compute_deadweight_score(&player, today);
        assert!(
            score > 0.4,
            "player with no contract should have moderate deadweight score, got {score}"
        );
    }

    // -----------------------------------------------------------------------
    // Phase 2 — Sell decisions
    // -----------------------------------------------------------------------

    #[test]
    fn test_evaluate_sales_transfer_list_expendable_veteran() {
        let team = make_team("t1", "Test Team");
        let today = test_date();

        // Player: age 30 (>28), avg_rating 5.5 (<6.5), contract until 2028 (>12 months)
        let mut players = vec![
            make_player(
                "p1",
                "Veteran",
                "t1",
                LolRole::Top,
                65,
                5.5,
                120_000,            // top wage
                Some("2028-06-15"), // >12 months
                "1996-01-01",       // age 30
                vec![],
            ),
            // Second player, lower wage, so p1 is top 25%
            make_player(
                "p2",
                "Youngster",
                "t1",
                LolRole::Mid,
                80,
                7.5,
                30_000,
                Some("2027-06-15"),
                "2002-01-01",
                vec![],
            ),
        ];
        // Override lol_ovr
        players[0].lol_ovr = 65;
        players[1].lol_ovr = 80;

        evaluate_sales(&team, &mut players, today);

        // p1 meets TA-03 criteria → should be transfer_listed
        assert!(
            players[0].transfer_listed,
            "expendable veteran should be transfer_listed"
        );
        // p2 is young, performing, low wage → should NOT be transfer_listed
        assert!(
            !players[1].transfer_listed,
            "young performer should NOT be transfer_listed"
        );
    }

    #[test]
    fn test_evaluate_sales_new_signing_not_sold() {
        let team = make_team("t1", "Test Team");
        let today = test_date();

        let mut players = vec![make_player(
            "p1",
            "RecentSigning",
            "t1",
            LolRole::Jungle,
            70,
            6.0,
            100_000,
            Some("2028-06-15"),
            "1995-01-01", // age 31
            vec![],
        )];
        players[0].lol_ovr = 70;
        // Protected from transfer until future date
        players[0].can_be_transferred_until = Some("2026-12-01".to_string());

        evaluate_sales(&team, &mut players, today);

        assert!(
            !players[0].transfer_listed,
            "new signing should NOT be sold even if they meet sale criteria"
        );
    }

    // -----------------------------------------------------------------------
    // Phase 2 — Buy decisions
    // -----------------------------------------------------------------------

    #[test]
    fn test_evaluate_purchases_initiates_when_budget_and_gap_exist() {
        // Integration-level: set up a team with budget + role gap + free agent
        // and verify a purchase happens through the transfers module.
        use crate::clock::GameClock;
        use crate::domain::manager::Manager;
        use crate::domain::player::LolRole;
        use crate::domain::season::TransferWindowStatus;
        use crate::domain::team::TeamKind;
        use chrono::{TimeZone, Utc};

        let today = test_date();
        let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 6, 15, 12, 0, 0).unwrap());
        let manager = Manager::new(
            "mgr1".to_string(),
            "Test".to_string(),
            "Manager".to_string(),
            "1980-01-01".to_string(),
            "GB".to_string(),
        );

        let mut team = make_team("t1", "Test Team");
        team.team_kind = TeamKind::Main;
        team.transfer_budget = 500_000;
        team.wage_budget = 500_000;
        team.finance = 500_000;

        // Team has 4 roles — no Support → gap
        let base_players = vec![
            make_player(
                "p1",
                "Top",
                "t1",
                LolRole::Top,
                80,
                7.0,
                40_000,
                Some("2027-06-15"),
                "2000-01-01",
                vec![],
            ),
            make_player(
                "p2",
                "Jg",
                "t1",
                LolRole::Jungle,
                75,
                6.8,
                45_000,
                Some("2027-06-15"),
                "2000-01-01",
                vec![],
            ),
            make_player(
                "p3",
                "Mid",
                "t1",
                LolRole::Mid,
                85,
                7.5,
                50_000,
                Some("2027-06-15"),
                "2000-01-01",
                vec![],
            ),
            make_player(
                "p4",
                "Adc",
                "t1",
                LolRole::Adc,
                78,
                7.2,
                45_000,
                Some("2027-06-15"),
                "2000-01-01",
                vec![],
            ),
        ];

        let mut game = Game::new(clock, manager, vec![team], base_players, vec![], vec![]);
        game.season_context.transfer_window.status = TransferWindowStatus::Open;

        // Add a free agent Support with low market_value to guarantee purchase
        let mut fa = make_player(
            "fa1",
            "FreeSupp",
            "none",
            LolRole::Support,
            70,
            6.5,
            30_000,
            None,
            "2001-01-01",
            vec![],
        );
        fa.market_value = 100_000;
        fa.team_id = None;
        game.players.push(fa);

        // Build report & execute purchase
        let report = assess_roster(
            game.teams.iter().find(|t| t.id == "t1").unwrap(),
            &game.players,
            today,
        );

        assert!(
            report.role_gaps.contains(&LolRole::Support),
            "precondition: Support should be a gap"
        );

        evaluate_purchases("t1", &mut game, &report);

        // After purchase, team should have exactly one Support player
        let support_count = game
            .players
            .iter()
            .filter(|p| {
                p.team_id.as_deref() == Some("t1") && p.natural_position == LolRole::Support
            })
            .count();
        assert_eq!(
            support_count, 1,
            "team should have acquired a Support free agent, got {support_count}"
        );
    }

    #[test]
    fn test_evaluate_purchases_no_budget_no_purchase_attempts() {
        use crate::clock::GameClock;
        use crate::domain::manager::Manager;
        use crate::domain::season::TransferWindowStatus;
        use crate::domain::team::TeamKind;
        use chrono::{TimeZone, Utc};

        let today = test_date();
        let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 6, 15, 12, 0, 0).unwrap());
        let manager = Manager::new(
            "mgr1".to_string(),
            "Test".to_string(),
            "Manager".to_string(),
            "1980-01-01".to_string(),
            "GB".to_string(),
        );

        let mut team = make_team("t1", "Broke Team");
        team.team_kind = TeamKind::Main;
        team.transfer_budget = 0; // zero budget

        let players = vec![make_player(
            "p1",
            "OnlyPlayer",
            "t1",
            LolRole::Top,
            70,
            6.5,
            30_000,
            Some("2027-06-15"),
            "2000-01-01",
            vec![],
        )];

        let mut game = Game::new(clock, manager, vec![team], players, vec![], vec![]);
        game.season_context.transfer_window.status = TransferWindowStatus::Open;

        let report = assess_roster(
            game.teams.iter().find(|t| t.id == "t1").unwrap(),
            &game.players,
            today,
        );

        // Even with gaps, zero budget must prevent purchases (TA-05)
        evaluate_purchases("t1", &mut game, &report);
        // No panic = function handled zero budget gracefully
        // The game state should be unchanged
        assert_eq!(
            game.players
                .iter()
                .filter(|p| p.team_id.as_deref() == Some("t1"))
                .count(),
            1,
            "no new players should be added with zero budget"
        );
    }

    #[test]
    fn test_evaluate_sales_no_deadlock_duplicate_player_skipped() {
        let team = make_team("t1", "Test Team");
        let today = test_date();

        // Two players with same ID but different wage — only the first
        // should be processed; the duplicate should be skipped.
        let mut players = vec![
            make_player(
                "p1",
                "Star",
                "t1",
                LolRole::Top,
                60,
                6.0,
                120_000,
                Some("2028-06-15"),
                "1995-01-01", // age 31, >28
                vec![],
            ),
            make_player(
                "p1",
                "Clone",
                "t1",
                LolRole::Top,
                60,
                6.0,
                120_000,
                Some("2028-06-15"),
                "1995-01-01",
                vec![],
            ),
        ];
        players[0].lol_ovr = 60;
        players[1].lol_ovr = 60;

        evaluate_sales(&team, &mut players, today);

        // First occurrence should be processed
        assert!(
            players[0].transfer_listed,
            "first occurrence should be evaluated"
        );
        // Duplicate should be skipped (deadlock guard)
        assert!(!players[1].transfer_listed, "duplicate should be skipped");
    }

    #[test]
    fn test_evaluate_sales_injured_player_not_sold() {
        let team = make_team("t1", "Test Team");
        let today = test_date();

        let mut players = vec![make_player(
            "p1",
            "InjuredStar",
            "t1",
            LolRole::Adc,
            75,
            6.0,
            100_000,
            Some("2028-06-15"),
            "1995-01-01", // age 31
            vec![],
        )];
        players[0].lol_ovr = 75;
        players[0].condition = 30; // injured/poor form

        evaluate_sales(&team, &mut players, today);

        assert!(
            !players[0].transfer_listed,
            "injured player should NOT be sold"
        );
    }

    // -----------------------------------------------------------------------
    // Phase 4: Conflict resolution (PR4)
    // -----------------------------------------------------------------------

    fn make_full_game_for_conflict(players: Vec<Player>, ai_team_ids: Vec<&str>) -> Game {
        use crate::clock::GameClock;
        use crate::domain::manager::Manager;
        use crate::domain::team::TeamKind;
        use chrono::{TimeZone, Utc};

        let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 6, 15, 12, 0, 0).unwrap());
        let manager = Manager::new(
            "mgr1".to_string(),
            "Test".to_string(),
            "Manager".to_string(),
            "1980-01-01".to_string(),
            "GB".to_string(),
        );

        let mut teams: Vec<Team> = ai_team_ids
            .iter()
            .map(|id| {
                let mut t = make_team(id, &format!("Team {id}"));
                t.team_kind = TeamKind::Main;
                t.manager_id = None;
                t
            })
            .collect();
        // Ensure at least one team exists
        if teams.is_empty() {
            let mut t = make_team("ai_default", "Default AI");
            t.team_kind = TeamKind::Main;
            t.manager_id = None;
            teams.push(t);
        }

        let mut game = Game::new(clock, manager, teams, players, vec![], vec![]);
        // Game::new refreshes lol_ovr — set it back for test assertions
        for p in &mut game.players {
            if p.lol_ovr == 0 {
                p.lol_ovr = 70;
            }
        }
        game
    }

    #[test]
    fn test_resolve_conflicts_high_retention_resets_transfer_listed() {
        // Scenario: player under contract, transfer_listed, high retention score
        // Team Agent should override → reset transfer_listed
        let mut game = make_full_game_for_conflict(
            vec![make_player(
                "p1",
                "Star",
                "ai_default",
                LolRole::Mid,
                95,
                8.5,
                60_000,             // high ovr, high rating
                Some("2028-06-15"), // long contract
                "2002-01-01",
                vec![PlayerTrait::HyperCarry],
            )],
            vec!["ai_default"],
        );

        // Mark as transfer_listed (Player Agent decision)
        game.players[0].transfer_listed = true;

        // Set lol_ovr after Game::new refresh
        game.players[0].lol_ovr = 95;

        let previously_transfer_listed = std::collections::HashSet::new();
        resolve_conflicts(&mut game, &previously_transfer_listed);

        let p = game.players.iter().find(|p| p.id == "p1").unwrap();
        assert!(
            !p.transfer_listed,
            "high retention player should have transfer_listed reset by Team Agent"
        );
    }

    #[test]
    fn test_resolve_conflicts_does_not_clear_human_managed_team_listing() {
        let mut game = make_full_game_for_conflict(
            vec![make_player(
                "p_human",
                "HumanStar",
                "human_team",
                LolRole::Mid,
                95,
                8.5,
                60_000,
                Some("2028-06-15"),
                "2002-01-01",
                vec![PlayerTrait::HyperCarry],
            )],
            vec!["human_team"],
        );
        game.teams[0].manager_id = Some("human_manager".to_string());
        game.players[0].transfer_listed = true;
        game.players[0].lol_ovr = 95;

        let previously_transfer_listed = std::collections::HashSet::new();
        resolve_conflicts(&mut game, &previously_transfer_listed);

        let player = game.players.iter().find(|p| p.id == "p_human").unwrap();
        assert!(
            player.transfer_listed,
            "human-managed team listings must not be cleared by AI conflict resolution"
        );
    }

    #[test]
    fn test_resolve_conflicts_does_not_clear_preexisting_transfer_listing() {
        let mut game = make_full_game_for_conflict(
            vec![make_player(
                "p_preexisting",
                "PreListedStar",
                "ai_default",
                LolRole::Mid,
                95,
                8.5,
                60_000,
                Some("2028-06-15"),
                "2002-01-01",
                vec![PlayerTrait::HyperCarry],
            )],
            vec!["ai_default"],
        );
        game.players[0].transfer_listed = true;
        game.players[0].lol_ovr = 95;

        let previously_transfer_listed =
            std::collections::HashSet::from(["p_preexisting".to_string()]);
        resolve_conflicts(&mut game, &previously_transfer_listed);

        let player = game
            .players
            .iter()
            .find(|p| p.id == "p_preexisting")
            .unwrap();
        assert!(
            player.transfer_listed,
            "pre-existing or Team-Agent-created listings must remain listed"
        );
    }

    #[test]
    fn test_resolve_conflicts_low_retention_keeps_transfer_listed() {
        // Scenario: player under contract, transfer_listed, LOW retention score
        // Team Agent should NOT override → transfer_listed stays true
        let mut game = make_full_game_for_conflict(
            vec![make_player(
                "p2",
                "Bust",
                "ai_default",
                LolRole::Top,
                45,
                4.0,
                100_000,            // low ovr, low rating, overpaid
                Some("2026-09-15"), // short contract
                "1995-01-01",
                vec![], // old, no traits
            )],
            vec!["ai_default"],
        );

        game.players[0].transfer_listed = true;
        game.players[0].lol_ovr = 45;

        let previously_transfer_listed = std::collections::HashSet::new();
        resolve_conflicts(&mut game, &previously_transfer_listed);

        let p = game.players.iter().find(|p| p.id == "p2").unwrap();
        assert!(
            p.transfer_listed,
            "low retention player should remain transfer_listed"
        );
    }

    #[test]
    fn test_resolve_conflicts_free_agent_not_overridden() {
        // Spec OR-04: Free agent → Player Agent decision is final
        // Player with no contract_end should NOT have transfer_listed reset
        let mut game = make_full_game_for_conflict(
            vec![{
                let mut p = make_player(
                    "p3",
                    "FreeAgent",
                    "ai_default",
                    LolRole::Jungle,
                    80,
                    7.0,
                    50_000,
                    None, // no contract
                    "2000-01-01",
                    vec![],
                );
                p.team_id = Some("ai_default".to_string());
                p
            }],
            vec!["ai_default"],
        );

        game.players[0].transfer_listed = true;
        game.players[0].lol_ovr = 80;

        let previously_transfer_listed = std::collections::HashSet::new();
        resolve_conflicts(&mut game, &previously_transfer_listed);

        let p = game.players.iter().find(|p| p.id == "p3").unwrap();
        assert!(
            p.transfer_listed,
            "free agent's transfer_listed must NOT be overridden (OR-04)"
        );
    }

    #[test]
    fn test_resolve_conflicts_expired_contract_not_overridden() {
        // Player with expired contract (end <= today) → free agent, not overridden
        let mut game = make_full_game_for_conflict(
            vec![make_player(
                "p4",
                "Expired",
                "ai_default",
                LolRole::Support,
                80,
                7.0,
                50_000,
                Some("2025-06-15"), // expired before test date
                "2000-01-01",
                vec![],
            )],
            vec!["ai_default"],
        );

        game.players[0].transfer_listed = true;
        game.players[0].lol_ovr = 80;

        let previously_transfer_listed = std::collections::HashSet::new();
        resolve_conflicts(&mut game, &previously_transfer_listed);

        let p = game.players.iter().find(|p| p.id == "p4").unwrap();
        assert!(
            p.transfer_listed,
            "expired contract player's transfer_listed must NOT be overridden"
        );
    }

    #[test]
    fn test_resolve_conflicts_only_player_at_role_critical_depth() {
        // Player is the ONLY player at their role on the team + contract > 12 months
        // → Team Agent overrides transfer_listed
        let mut game = make_full_game_for_conflict(
            vec![
                make_player(
                    "p5",
                    "OnlySupport",
                    "ai_default",
                    LolRole::Support,
                    70,
                    6.5,
                    40_000,
                    Some("2028-06-15"), // long contract > 12 months
                    "2000-01-01",
                    vec![],
                ),
                // Other roles
                make_player(
                    "p6",
                    "Top",
                    "ai_default",
                    LolRole::Top,
                    75,
                    7.0,
                    45_000,
                    Some("2028-06-15"),
                    "2000-01-01",
                    vec![],
                ),
                make_player(
                    "p7",
                    "Jungle",
                    "ai_default",
                    LolRole::Jungle,
                    75,
                    7.0,
                    45_000,
                    Some("2028-06-15"),
                    "2000-01-01",
                    vec![],
                ),
            ],
            vec!["ai_default"],
        );

        // Mark only Support player as transfer_listed
        for p in &mut game.players {
            if p.id == "p5" {
                p.transfer_listed = true;
            }
        }
        // Set lol_ovr values
        for p in &mut game.players {
            if p.lol_ovr == 0 {
                p.lol_ovr = if p.id == "p5" { 70 } else { 75 };
            }
        }

        let previously_transfer_listed = std::collections::HashSet::new();
        resolve_conflicts(&mut game, &previously_transfer_listed);

        let p5 = game.players.iter().find(|p| p.id == "p5").unwrap();
        assert!(
            !p5.transfer_listed,
            "only Support player should have transfer_listed reset (critical depth)"
        );
    }

    #[test]
    fn test_resolve_conflicts_short_contract_not_critical_depth() {
        // Player is only at role but contract is SHORT (< 12 months)
        // → Not critical depth, transfer_listed stays
        let mut game = make_full_game_for_conflict(
            vec![
                make_player(
                    "p8",
                    "TempOnlySupport",
                    "ai_default",
                    LolRole::Support,
                    70,
                    6.5,
                    40_000,
                    Some("2026-12-01"), // only ~5 months from test date
                    "2000-01-01",
                    vec![],
                ),
                make_player(
                    "p9",
                    "Top",
                    "ai_default",
                    LolRole::Top,
                    75,
                    7.0,
                    45_000,
                    Some("2028-06-15"),
                    "2000-01-01",
                    vec![],
                ),
            ],
            vec!["ai_default"],
        );

        for p in &mut game.players {
            if p.id == "p8" {
                p.transfer_listed = true;
            }
        }
        for p in &mut game.players {
            if p.lol_ovr == 0 {
                p.lol_ovr = if p.id == "p8" { 70 } else { 75 };
            }
        }

        let previously_transfer_listed = std::collections::HashSet::new();
        resolve_conflicts(&mut game, &previously_transfer_listed);

        let p8 = game.players.iter().find(|p| p.id == "p8").unwrap();
        assert!(
            p8.transfer_listed,
            "short-contract only-at-role player should stay transfer_listed"
        );
    }

    // -----------------------------------------------------------------------
    // Phase 2: Integration tests (PR4)
    // -----------------------------------------------------------------------

    /// Build a Game with `num_teams` AI teams, each with `players_per_team` players
    /// covering all 5 roles. Returns a fully initialised Game ready for process_day.
    fn build_integration_game(num_teams: usize, players_per_team: usize) -> Game {
        use crate::clock::GameClock;
        use crate::domain::manager::Manager;
        use crate::domain::team::TeamKind;
        use chrono::{TimeZone, Utc};

        let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 6, 15, 12, 0, 0).unwrap());
        let manager = Manager::new(
            "mgr1".to_string(),
            "Test".to_string(),
            "Manager".to_string(),
            "1980-01-01".to_string(),
            "GB".to_string(),
        );

        let roles = [
            LolRole::Top,
            LolRole::Jungle,
            LolRole::Mid,
            LolRole::Adc,
            LolRole::Support,
        ];
        let mut teams = Vec::with_capacity(num_teams);
        let mut players = Vec::with_capacity(num_teams * players_per_team);

        for ti in 0..num_teams {
            let tid = format!("ai_team_{ti}");
            let mut team = Team::new(
                tid.clone(),
                format!("AI Team {ti}"),
                format!("AT{ti}"),
                "DE".to_string(),
                "Berlin".to_string(),
                "Arena".to_string(),
                10_000,
            );
            team.team_kind = TeamKind::Main;
            team.manager_id = None;
            team.wage_budget = 500_000;
            team.transfer_budget = 200_000;
            teams.push(team);

            for pi in 0..players_per_team {
                let role = roles[pi % 5];
                let pid = format!("p_{tid}_{pi}");
                let mut p = make_player(
                    &pid,
                    &format!("Player {tid} {pi}"),
                    &tid,
                    role,
                    70 + (pi as u8 * 3) % 25,       // varied OVR 70-92
                    6.5 + (pi as f32 * 0.3).min(2.5), // varied rating 6.5-8.5
                    40_000 + (pi as u32 * 10_000),    // varied wage
                    Some("2028-06-15"),               // standard 2-year contract
                    "2000-01-01",
                    if pi == 0 {
                        vec![PlayerTrait::HyperCarry]
                    } else {
                        vec![]
                    },
                );
                p.condition = 80; // healthy
                p.market_value = 100_000 + (pi as u64 * 50_000);
                players.push(p);
            }
        }

        let mut game = Game::new(clock, manager, teams, players, vec![], vec![]);
        // Override lol_ovr since Game::new refreshes it from attrs
        for p in &mut game.players {
            if p.lol_ovr == 0 || p.lol_ovr < 30 {
                p.lol_ovr = 70 + (p.id.len() as u8 % 25);
            }
        }
        game
    }

    #[test]
    fn test_full_lifecycle_30_days_no_crash() {
        // Spec 2.1: Create Game with 10+ teams, run 30 process_day calls
        // Assert no crashes, budget compliance, roster_stability fires
        let mut game = build_integration_game(10, 7); // 10 teams, 7 players each = 70 players

        for day in 0..30 {
            crate::turn::process_day(&mut game);

            // Assert no crash — we're still running at day {day}
            // Budget compliance: no negative budgets
            for team in &game.teams {
                assert!(
                    team.wage_budget >= 0,
                    "Team {} wage_budget went negative on day {}",
                    team.name,
                    day
                );
                assert!(
                    team.transfer_budget >= 0,
                    "Team {} transfer_budget went negative on day {}",
                    team.name,
                    day
                );
            }

            // Invariant I-01: minimum 5 players per team (roster_stability safety net)
            for team in &game.teams {
                let count = game
                    .players
                    .iter()
                    .filter(|p| p.team_id.as_deref() == Some(&team.id))
                    .count();
                assert!(
                    count >= 5,
                    "Team {} has only {count} players on day {} (below minimum)",
                    team.name,
                    day
                );
            }
        }

        // Verify at least 25 days elapsed (should be 30 + initial offset)
        let day_of_year = game
            .clock
            .current_date
            .format("%j")
            .to_string()
            .parse::<u32>()
            .unwrap_or(0);
        // Started June 15 (day 166), after 30 days = day ~196
        assert!(
            day_of_year >= 190,
            "Expected day_of_year >= 190 after 30 days, got {day_of_year}"
        );
    }

    #[test]
    fn test_conflict_resolution_scenario_player_stays() {
        // Spec 2.2: Player requests transfer (low satisfaction),
        // Team Agent rejects due to no depth (only player at role), player stays
        // Use a single AI team with 4 players — one Support only
        use crate::clock::GameClock;
        use crate::domain::manager::Manager;
        use crate::domain::player::LolRole;
        use crate::domain::team::TeamKind;
        use chrono::{TimeZone, Utc};

        let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 6, 15, 12, 0, 0).unwrap());
        let manager = Manager::new(
            "mgr1".to_string(),
            "Test".to_string(),
            "Manager".to_string(),
            "1980-01-01".to_string(),
            "GB".to_string(),
        );

        let mut team = make_team("reject_team", "Reject Team");
        team.team_kind = TeamKind::Main;
        team.manager_id = None;
        team.wage_budget = 500_000;
        team.transfer_budget = 200_000;

        // 4 players: Top, Jungle, Mid, Support (only Support — critical depth)
        let roles = [
            LolRole::Top,
            LolRole::Jungle,
            LolRole::Mid,
            LolRole::Support,
        ];
        let mut base_players: Vec<Player> = roles
            .iter()
            .enumerate()
            .map(|(i, &role)| {
                let pid = format!("p_role_{i}");
                let mut p = make_player(
                    &pid,
                    &format!("RolePlayer{i}"),
                    "reject_team",
                    role,
                    75,
                    7.0,
                    40_000,
                    Some("2028-06-15"), // long contract
                    "2000-01-01",
                    vec![],
                );
                p.morale = 60;
                p.morale_core.manager_trust = 55;
                p.market_value = 200_000;
                p
            })
            .collect();

        // Add a 5th player at Top (so only Support has depth 1)
        let mut extra_top = make_player(
            "p_extra_top",
            "ExtraTop",
            "reject_team",
            LolRole::Top,
            70,
            6.5,
            35_000,
            Some("2028-06-15"),
            "2000-01-01",
            vec![],
        );
        extra_top.market_value = 150_000;
        base_players.push(extra_top);

        let mut game = Game::new(clock, manager, vec![team], base_players, vec![], vec![]);
        // Fix lol_ovr
        for p in &mut game.players {
            if p.lol_ovr == 0 || p.lol_ovr < 30 {
                p.lol_ovr = 75;
            }
        }

        // Run the full agent pipeline (Team Agent → Player Agent → resolve_conflicts)
        // The Support player (only one at role) might be unhappy due to setup.
        // We manually ensure the Support player has low morale to trigger Player Agent transfer request.
        let support = game
            .players
            .iter_mut()
            .find(|p| p.natural_position == LolRole::Support)
            .unwrap();
        support.morale = 20;
        support.morale_core.manager_trust = 15;
        support.wage = 20_000; // underpaid → triggers transfer request

        // Now run agents. Snapshot after Team Agent so conflict resolution only
        // clears transfer requests that Player Agent created in this cycle.
        crate::ai_team_agent::process_ai_team_agents(&mut game);
        let previously_transfer_listed: std::collections::HashSet<String> = game
            .players
            .iter()
            .filter(|p| p.transfer_listed)
            .map(|p| p.id.clone())
            .collect();
        crate::ai_player_agent::process_ai_player_agents(&mut game);

        let support_after_player_agent = game
            .players
            .iter()
            .find(|p| p.natural_position == LolRole::Support)
            .unwrap();
        assert!(
            support_after_player_agent.transfer_listed,
            "precondition: Player Agent should request a transfer before conflict resolution"
        );

        crate::ai_team_agent::resolve_conflicts(&mut game, &previously_transfer_listed);

        // Support player should NOT be transfer_listed (critical depth overrides)
        let support_after = game
            .players
            .iter()
            .find(|p| p.natural_position == LolRole::Support)
            .unwrap();
        assert!(
            !support_after.transfer_listed,
            "Support player must stay (critical depth — Team Agent overrides transfer request)"
        );
    }

    #[test]
    fn test_invariants_across_random_rosters() {
        // Spec 2.3: Property invariants across varied rosters
        // Create several different game configurations and verify invariants
        for roster_size in [5, 6, 7, 8] {
            let mut game = build_integration_game(6, roster_size);

            // Run a few days
            for _ in 0..5 {
                crate::turn::process_day(&mut game);
            }

            // I-01: Never below 5 players per team
            for team in &game.teams {
                let count = game
                    .players
                    .iter()
                    .filter(|p| p.team_id.as_deref() == Some(&team.id))
                    .count();
                assert!(
                    count >= 5,
                    "I-01 violated: Team {} has {count} players (roster_size={roster_size})",
                    team.name,
                );
            }

            // I-02: Budget never negative
            for team in &game.teams {
                assert!(
                    team.wage_budget >= 0,
                    "I-02 violated: Team {} wage_budget is {}",
                    team.name,
                    team.wage_budget
                );
                assert!(
                    team.transfer_budget >= 0,
                    "I-02 violated: Team {} transfer_budget is {}",
                    team.name,
                    team.transfer_budget
                );
            }

            // I-03/04: No deadlock loops — if we reached here without panic, it passed
            // (process_day doesn't infinite-loop)
        }
    }

    #[test]
    fn test_determinism_identical_state_identical_decisions() {
        use crate::clock::GameClock;
        use crate::domain::manager::Manager;
        use crate::domain::season::TransferWindowStatus;
        use crate::domain::team::TeamKind;
        use chrono::{TimeZone, Utc};

        // Spec 2.4/OR-06: Identical game state produces identical decisions
        // Build game manually for precise control
        let _clock = GameClock::new(Utc.with_ymd_and_hms(2026, 6, 15, 12, 0, 0).unwrap());
        let _manager = Manager::new(
            "mgr1".to_string(),
            "Test".to_string(),
            "Manager".to_string(),
            "1980-01-01".to_string(),
            "GB".to_string(),
        );

        let mut team = make_team("det_team", "Determinism Team");
        team.team_kind = TeamKind::Main;
        team.manager_id = None;
        team.wage_budget = 500_000;
        team.transfer_budget = 200_000;

        let players = vec![
            make_player(
                "p1",
                "Star",
                "det_team",
                LolRole::Mid,
                90,
                8.5,
                60_000,
                Some("2027-06-15"),
                "2002-01-01",
                vec![PlayerTrait::HyperCarry],
            ),
            make_player(
                "p2",
                "Mediocre",
                "det_team",
                LolRole::Top,
                70,
                6.5,
                40_000,
                Some("2027-06-15"),
                "2000-01-01",
                vec![],
            ),
            make_player(
                "p3",
                "Vet",
                "det_team",
                LolRole::Jungle,
                60,
                5.5,
                120_000,
                Some("2028-06-15"),
                "1995-01-01",
                vec![],
            ),
            make_player(
                "p4",
                "Young",
                "det_team",
                LolRole::Adc,
                80,
                7.5,
                30_000,
                Some("2028-06-15"),
                "2003-01-01",
                vec![],
            ),
            make_player(
                "p5",
                "Supp",
                "det_team",
                LolRole::Support,
                75,
                7.0,
                45_000,
                Some("2027-06-15"),
                "2001-01-01",
                vec![],
            ),
        ];

        // Build game state once, then snapshot
        fn build_det_game(team: Team, players: Vec<Player>) -> Game {
            let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 6, 15, 12, 0, 0).unwrap());
            let manager = Manager::new(
                "mgr1".to_string(),
                "Test".to_string(),
                "Manager".to_string(),
                "1980-01-01".to_string(),
                "GB".to_string(),
            );
            let mut g = Game::new(clock, manager, vec![team], players, vec![], vec![]);
            g.season_context.transfer_window.status = TransferWindowStatus::Open;
            for p in &mut g.players {
                if p.lol_ovr == 0 || p.lol_ovr < 30 {
                    p.lol_ovr = 70;
                }
            }
            g
        }

        // Run 1
        let mut game1 = build_det_game(team.clone(), players.clone());
        // Fix lol_ovr for game1
        game1.players[0].lol_ovr = 90;
        game1.players[1].lol_ovr = 70;
        game1.players[2].lol_ovr = 60;
        game1.players[3].lol_ovr = 80;
        game1.players[4].lol_ovr = 75;

        // Snapshot player state
        let _snapshot1: Vec<(String, bool, Option<String>)> = game1
            .players
            .iter()
            .map(|p| {
                (
                    p.id.clone(),
                    p.transfer_listed,
                    p.morale_core
                        .renewal_state
                        .as_ref()
                        .map(|s| format!("{:?}", s.status)),
                )
            })
            .collect();

        // ... run agents
        crate::ai_team_agent::process_ai_team_agents(&mut game1);
        let previously_transfer_listed1: std::collections::HashSet<String> = game1
            .players
            .iter()
            .filter(|p| p.transfer_listed)
            .map(|p| p.id.clone())
            .collect();
        crate::ai_player_agent::process_ai_player_agents(&mut game1);
        crate::ai_team_agent::resolve_conflicts(&mut game1, &previously_transfer_listed1);

        let result1: Vec<(String, bool, Option<String>)> = game1
            .players
            .iter()
            .map(|p| {
                (
                    p.id.clone(),
                    p.transfer_listed,
                    p.morale_core
                        .renewal_state
                        .as_ref()
                        .map(|s| format!("{:?}", s.status)),
                )
            })
            .collect();

        // Run 2 — identical setup
        let mut game2 = build_det_game(team.clone(), players.clone());
        game2.players[0].lol_ovr = 90;
        game2.players[1].lol_ovr = 70;
        game2.players[2].lol_ovr = 60;
        game2.players[3].lol_ovr = 80;
        game2.players[4].lol_ovr = 75;

        crate::ai_team_agent::process_ai_team_agents(&mut game2);
        let previously_transfer_listed2: std::collections::HashSet<String> = game2
            .players
            .iter()
            .filter(|p| p.transfer_listed)
            .map(|p| p.id.clone())
            .collect();
        crate::ai_player_agent::process_ai_player_agents(&mut game2);
        crate::ai_team_agent::resolve_conflicts(&mut game2, &previously_transfer_listed2);

        let result2: Vec<(String, bool, Option<String>)> = game2
            .players
            .iter()
            .map(|p| {
                (
                    p.id.clone(),
                    p.transfer_listed,
                    p.morale_core
                        .renewal_state
                        .as_ref()
                        .map(|s| format!("{:?}", s.status)),
                )
            })
            .collect();

        // Compare — must be identical
        assert_eq!(
            result1, result2,
            "OR-06 violated: identical game state produced different decisions"
        );
    }
}
