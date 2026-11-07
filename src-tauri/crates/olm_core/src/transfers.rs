use crate::contract_wage_policy::{
    AiTransferKind, SigningIntent, ai_signing_policy, ai_transfer_cap_try_consume,
};
use crate::contracts::{expected_contract_years, expected_wage};
use crate::domain::negotiation::{NegotiationFeedback, NegotiationMood};
use crate::domain::player::{PlayerOfferItem, TransferOfferStatus, WageNegotiationStatus};
use crate::domain::season::TransferWindowStatus;
use crate::domain::stats::LolRole;
use crate::domain::team::{FinancialTransactionKind, TeamKind};
use crate::domain::transfer_history::{IncludedPlayerEntry, TransferHistoryEntry};
use crate::finances::{
    BudgetImpact, FinanceTransactionInput, calc_annual_wages, record_transaction,
};
use crate::game::Game;
use crate::roster_stability::{RosterStabilityReason, repair_team};
use chrono::{Datelike, NaiveDate};
use rand_08::Rng;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use uuid::Uuid;

fn ai_random_contract_years() -> u8 {
    let mut rng: rand_08::rngs::StdRng = rand_08::SeedableRng::seed_from_u64(42);
    rng.gen_range(1..=3)
}

fn next_split_end_date(game: &Game) -> String {
    let current_date = game.clock.current_date.date_naive();
    let league_name = game
        .leagues
        .first()
        .map(|l| {
            if l.name.contains("Winter") {
                "Winter"
            } else if l.name.contains("Spring") {
                "Spring"
            } else {
                "Summer"
            }
        })
        .unwrap_or("Winter");

    let next_split = match league_name {
        "Winter" => (current_date.year(), 3, 28),
        "Spring" => (current_date.year(), 8, 1),
        _ => (current_date.year() + 1, 1, 17),
    };
    format!("{}-{:02}-{:02}", next_split.0, next_split.1, next_split.2)
}

const TRANSFER_NEGOTIATION_STALE_DAYS: i64 = 14;
const PLAYER_INCOMING_OFFER_COOLDOWN_DAYS: i64 = 7;
const MANAGED_SQUAD_INCOMING_OFFER_COOLDOWN_DAYS: i64 = 14;
const TRANSFER_BUDGET_SELLING_REALLOCATION_PCT: i64 = 60;
const CONTRACT_RELEASE_PENALTY_PCT: i64 = 40;
const MAX_INCOMING_OFFERS_PER_DAY: usize = 2;
const MAX_OFFERS_PER_TEAM_PER_WEEK: usize = 2;
const MAX_AI_FREE_AGENT_SIGNINGS_PER_DAY: usize = 2;
const MAX_AI_INTERCLUB_TRANSFERS_PER_DAY: usize = 1;
const LOL_CORE_ROLES: [&str; 5] = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TransferNegotiationDecision {
    Accepted,
    Rejected,
    CounterOffer,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TransferNegotiationOutcome {
    pub decision: TransferNegotiationDecision,
    pub suggested_fee: Option<u64>,
    pub is_terminal: bool,
    pub feedback: NegotiationFeedback,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TransferBidFinancialProjection {
    pub transfer_budget_before: i64,
    pub transfer_budget_after: i64,
    pub finance_before: i64,
    pub finance_after: i64,
    pub annual_wage_bill_before: i64,
    pub annual_wage_bill_after: i64,
    pub annual_wage_budget: i64,
    pub projected_wage_budget_usage_pct: i64,
    pub exceeds_transfer_budget: bool,
    pub exceeds_finance: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum TransferDestination {
    #[default]
    Main,
    Academy,
}

enum PlayerImportance {
    Key,
    Regular,
    Fringe,
}

fn contract_days_remaining(current_date: NaiveDate, contract_end: Option<&str>) -> Option<i64> {
    let contract_end = contract_end?;
    let contract_end_date = NaiveDate::parse_from_str(contract_end, "%Y-%m-%d").ok()?;
    Some((contract_end_date - current_date).num_days())
}

fn infer_player_importance(
    player: &crate::domain::player::Player,
    owner_team: &crate::domain::team::Team,
) -> PlayerImportance {
    if owner_team
        .active_lineup_ids
        .iter()
        .any(|id| id == &player.id)
    {
        return PlayerImportance::Key;
    }

    if player.market_value >= 1_500_000 {
        return PlayerImportance::Regular;
    }

    PlayerImportance::Fringe
}

fn minimum_acceptable_fee(
    current_date: NaiveDate,
    player: &crate::domain::player::Player,
    owner_team: &crate::domain::team::Team,
    buyer_team: &crate::domain::team::Team,
) -> u64 {
    let mut multiplier: f64 = if player.transfer_listed { 0.8 } else { 1.2 };

    if let Some(days_remaining) =
        contract_days_remaining(current_date, player.contract_end.as_deref())
    {
        if days_remaining <= 60 {
            multiplier -= 0.25;
        } else if days_remaining <= 180 {
            multiplier -= 0.15;
        } else if days_remaining <= 365 {
            multiplier -= 0.05;
        }
    }

    match infer_player_importance(player, owner_team) {
        PlayerImportance::Key => multiplier += 0.2,
        PlayerImportance::Regular => multiplier += 0.1,
        PlayerImportance::Fringe => {}
    }

    if player.morale <= 40 {
        multiplier -= 0.05;
    }

    let openness_score = player_move_openness_score(current_date, player, owner_team, buyer_team);
    if openness_score >= 60 {
        multiplier -= 0.20;
    } else if openness_score >= 40 {
        multiplier -= 0.10;
    }

    let multiplier = multiplier.clamp(0.55, 1.6);
    ((player.market_value as f64) * multiplier).round() as u64
}

fn calculate_player_offer_value(
    current_date: NaiveDate,
    player: &crate::domain::player::Player,
) -> u64 {
    let age = calc_player_age(current_date, &player.date_of_birth);

    let age_multiplier: f64 = if age <= 20 {
        1.30
    } else if age <= 23 {
        1.20
    } else if age <= 26 {
        1.00
    } else if age <= 29 {
        0.90
    } else if age <= 32 {
        0.75
    } else {
        0.60
    };

    let potential_gap = player
        .potential_base
        .saturating_sub(player.attributes.overall());
    let potential_multiplier: f64 = if potential_gap >= 15 {
        1.20
    } else if potential_gap >= 10 {
        1.10
    } else if potential_gap >= 5 {
        1.05
    } else {
        1.00
    };

    ((player.market_value as f64) * age_multiplier * potential_multiplier).round() as u64
}

fn calc_player_age(current_date: NaiveDate, date_of_birth: &str) -> u32 {
    let dob = NaiveDate::parse_from_str(date_of_birth, "%Y-%m-%d").unwrap_or(current_date);
    let mut age = (current_date.year() - dob.year()) as u32;
    if current_date < dob.with_year(current_date.year()).unwrap_or(dob) {
        age = age.saturating_sub(1);
    }
    age
}

fn player_move_openness_score(
    current_date: NaiveDate,
    player: &crate::domain::player::Player,
    owner_team: &crate::domain::team::Team,
    buyer_team: &crate::domain::team::Team,
) -> i32 {
    let mut score = 0;

    if player.morale <= 45 {
        score += 20;
    } else if player.morale <= 60 {
        score += 10;
    }

    if player.stats.appearances <= 2 {
        score += 15;
    } else if player.stats.appearances <= 5 {
        score += 8;
    }

    if let Some(days_remaining) =
        contract_days_remaining(current_date, player.contract_end.as_deref())
    {
        if days_remaining <= 180 {
            score += 20;
        } else if days_remaining <= 365 {
            score += 10;
        }
    }

    let reputation_gap = buyer_team.reputation as i32 - owner_team.reputation as i32;
    if reputation_gap >= 200 {
        score += 25;
    } else if reputation_gap >= 75 {
        score += 15;
    }

    if player.transfer_listed {
        score += 10;
    }

    score
}

fn apply_blocked_move_consequences(
    player: &mut crate::domain::player::Player,
    openness_score: i32,
) {
    if openness_score < 40 {
        return;
    }

    let morale_drop = if openness_score >= 60 { 10 } else { 6 };
    player.morale = (i16::from(player.morale) - morale_drop).clamp(0, 100) as u8;
    player.morale_core.manager_trust =
        (i16::from(player.morale_core.manager_trust) - 5).clamp(0, 100) as u8;
    player.morale_core.unresolved_issue = Some(crate::domain::player::PlayerIssue {
        category: crate::domain::player::PlayerIssueCategory::Contract,
        severity: if openness_score >= 60 { 75 } else { 60 },
    });
}

fn incoming_interest_score(current_date: NaiveDate, player: &crate::domain::player::Player) -> i32 {
    let mut score = 8;

    if player.transfer_listed {
        score += 30;
    }

    if let Some(days_remaining) =
        contract_days_remaining(current_date, player.contract_end.as_deref())
    {
        if days_remaining <= 60 {
            score += 40;
        } else if days_remaining <= 180 {
            score += 25;
        } else if days_remaining <= 365 {
            score += 10;
        }
    }

    if player.market_value >= 1_000_000 {
        score += 20;
    } else if player.market_value >= 500_000 {
        score += 10;
    }

    if player.morale <= 45 {
        score += 10;
    }

    score
}

pub(crate) fn suggested_incoming_fee(
    current_date: NaiveDate,
    player: &crate::domain::player::Player,
    buyer_team: &crate::domain::team::Team,
    buyer_id: &str,
) -> u64 {
    let mut multiplier: f64 = if player.transfer_listed { 0.85 } else { 0.82 };

    if let Some(days_remaining) =
        contract_days_remaining(current_date, player.contract_end.as_deref())
    {
        if days_remaining <= 60 {
            multiplier -= 0.05;
        } else if days_remaining <= 180 {
            multiplier -= 0.03;
        }
    }

    if player.morale <= 45 {
        multiplier -= 0.05;
    }

    // Stronger clubs and richer clubs tend to bid more aggressively.
    if buyer_team.reputation >= 1300 {
        multiplier += 0.06;
    } else if buyer_team.reputation >= 1100 {
        multiplier += 0.03;
    }

    if buyer_team.transfer_budget >= 4_000_000 {
        multiplier += 0.04;
    } else if buyer_team.transfer_budget >= 2_000_000 {
        multiplier += 0.02;
    }

    // Deterministic per club+player+day jitter so offers are not all identical.
    let mut hasher = DefaultHasher::new();
    player.id.hash(&mut hasher);
    buyer_id.hash(&mut hasher);
    current_date.num_days_from_ce().hash(&mut hasher);
    let bucket = (hasher.finish() % 17) as i32; // 0..16
    let jitter = (bucket - 8) as f64 * 0.01; // -8% .. +8%
    multiplier += jitter;

    let multiplier = multiplier.clamp(0.42, 1.0);
    ((player.market_value as f64) * multiplier).round() as u64
}

fn has_open_incoming_offer_from_club(
    player: &crate::domain::player::Player,
    club_id: &str,
) -> bool {
    player
        .transfer_offers
        .iter()
        .any(|offer| offer.from_team_id == club_id && offer.status == TransferOfferStatus::Pending)
}

fn offer_is_stale(current_date: NaiveDate, offer: &crate::domain::player::TransferOffer) -> bool {
    if offer.status != TransferOfferStatus::Pending {
        return false;
    }

    let Ok(offer_date) = NaiveDate::parse_from_str(&offer.date, "%Y-%m-%d") else {
        return false;
    };

    (current_date - offer_date).num_days() >= TRANSFER_NEGOTIATION_STALE_DAYS
}

fn has_recent_incoming_offer(
    current_date: NaiveDate,
    player: &crate::domain::player::Player,
    cooldown_days: i64,
) -> bool {
    player.transfer_offers.iter().any(|offer| {
        let Ok(offer_date) = NaiveDate::parse_from_str(&offer.date, "%Y-%m-%d") else {
            return false;
        };
        let age_days = (current_date - offer_date).num_days();
        age_days > 0 && age_days < cooldown_days
    })
}

fn managed_squad_has_recent_incoming_offer(
    game: &Game,
    managed_team_ids: &std::collections::HashSet<String>,
    current_date: NaiveDate,
    cooldown_days: i64,
) -> bool {
    game.players
        .iter()
        .filter(|player| {
            player
                .team_id
                .as_deref()
                .map(|team_id| managed_team_ids.contains(team_id))
                .unwrap_or(false)
        })
        .flat_map(|player| player.transfer_offers.iter())
        .any(|offer| {
            let Ok(offer_date) = NaiveDate::parse_from_str(&offer.date, "%Y-%m-%d") else {
                return false;
            };
            let age_days = (current_date - offer_date).num_days();
            age_days >= 0 && age_days < cooldown_days
        })
}

fn allow_unsolicited_offer_for_player(
    current_date: NaiveDate,
    player: &crate::domain::player::Player,
    owner_team: Option<&crate::domain::team::Team>,
) -> bool {
    if player.transfer_listed {
        return true;
    }

    if has_recent_incoming_offer(current_date, player, PLAYER_INCOMING_OFFER_COOLDOWN_DAYS) {
        return false;
    }

    if let Some(team) = owner_team {
        let is_key_player = team.active_lineup_ids.iter().any(|id| id == &player.id);
        if is_key_player {
            return false;
        }
    }

    let low_morale = player.morale <= 45;
    let low_minutes = player.stats.minutes_played <= 180;
    let contract_short = contract_days_remaining(current_date, player.contract_end.as_deref())
        .map(|days| days <= 365)
        .unwrap_or(false);

    low_morale || low_minutes || contract_short
}

fn expire_stale_transfer_offers(game: &mut Game) {
    let current_date = game.clock.current_date.date_naive();

    for player in &mut game.players {
        for offer in &mut player.transfer_offers {
            if offer_is_stale(current_date, offer) {
                offer.status = TransferOfferStatus::Withdrawn;
                offer.suggested_counter_fee = None;
            }
        }
    }
}

fn find_open_offer_from_club<'a>(
    player: &'a crate::domain::player::Player,
    club_id: &str,
) -> Option<&'a crate::domain::player::TransferOffer> {
    player
        .transfer_offers
        .iter()
        .find(|offer| offer.from_team_id == club_id && offer.status == TransferOfferStatus::Pending)
}

fn negotiation_round_from_offer(offer: Option<&crate::domain::player::TransferOffer>) -> u8 {
    offer
        .map(|offer| offer.negotiation_round.max(1).saturating_add(1))
        .unwrap_or(1)
}

fn transfer_negotiation_metrics(round: u8, stalled: bool, respected_signal: bool) -> (u8, u8) {
    let mut tension = 34_i16 + (i16::from(round.saturating_sub(1)) * 16);
    let mut patience = 82_i16 - (i16::from(round.saturating_sub(1)) * 18);

    if stalled {
        tension += 12;
        patience -= 12;
    }

    if respected_signal {
        tension -= 8;
        patience += 8;
    }

    (tension.clamp(20, 90) as u8, patience.clamp(18, 86) as u8)
}

#[allow(clippy::too_many_arguments)] // params struct would be an out-of-scope signature refactor
fn upsert_transfer_offer(
    player: &mut crate::domain::player::Player,
    from_team_id: &str,
    destination_team_id: Option<&str>,
    fee: u64,
    status: TransferOfferStatus,
    date: &str,
    last_manager_fee: Option<u64>,
    negotiation_round: u8,
    suggested_counter_fee: Option<u64>,
) -> String {
    if let Some(offer) = player.transfer_offers.iter_mut().find(|offer| {
        offer.from_team_id == from_team_id && offer.status == TransferOfferStatus::Pending
    }) {
        offer.fee = fee;
        offer.destination_team_id = destination_team_id.map(str::to_string);
        offer.status = status;
        offer.date = date.to_string();
        offer.last_manager_fee = last_manager_fee;
        offer.negotiation_round = negotiation_round;
        offer.suggested_counter_fee = suggested_counter_fee;
        return offer.id.clone();
    }

    let offer_id = Uuid::new_v4().to_string();
    player
        .transfer_offers
        .push(crate::domain::player::TransferOffer {
            id: offer_id.clone(),
            from_team_id: from_team_id.to_string(),
            destination_team_id: destination_team_id.map(str::to_string),
            fee,
            wage_offered: 0,
            last_manager_fee,
            negotiation_round,
            suggested_counter_fee,
            players_included: vec![],
            status,
            date: date.to_string(),
            wage_negotiation_status: crate::domain::player::WageNegotiationStatus::NotStarted,
            contract_years_offered: 0,
            suggested_counter_wage: None,
            suggested_counter_years: None,
            wage_negotiation_round: 0,
        });
    offer_id
}

pub(crate) fn transfer_window_is_open(game: &Game) -> bool {
    matches!(
        game.season_context.transfer_window.status,
        TransferWindowStatus::Open | TransferWindowStatus::DeadlineDay
    )
}

fn user_academy_team_id(game: &Game, user_team_id: &str) -> Option<String> {
    game.teams
        .iter()
        .find(|team| team.id == user_team_id)
        .and_then(|team| team.academy_team_id.clone())
        .or_else(|| {
            game.teams
                .iter()
                .find(|team| {
                    team.team_kind == TeamKind::Academy
                        && team.parent_team_id.as_deref() == Some(user_team_id)
                })
                .map(|team| team.id.clone())
        })
}

fn resolve_user_transfer_destination(
    game: &Game,
    user_team_id: &str,
    destination: TransferDestination,
) -> Result<String, String> {
    match destination {
        TransferDestination::Main => Ok(user_team_id.to_string()),
        TransferDestination::Academy => user_academy_team_id(game, user_team_id)
            .ok_or_else(|| "Academy team not found".to_string()),
    }
}

fn is_managed_team_id(game: &Game, user_team_id: &str, team_id: &str) -> bool {
    team_id == user_team_id || user_academy_team_id(game, user_team_id).as_deref() == Some(team_id)
}

pub fn generate_incoming_transfer_offers(game: &mut Game) {
    expire_stale_transfer_offers(game);

    if !transfer_window_is_open(game) {
        return;
    }

    let Some(user_team_id) = game.manager.team_id.clone() else {
        return;
    };

    let current_date = game.clock.current_date.date_naive();
    let today = game.clock.current_date.format("%Y-%m-%d").to_string();
    let academy_offer_window_open = matches!(
        current_date.weekday(),
        chrono::Weekday::Mon | chrono::Weekday::Wed | chrono::Weekday::Fri
    );

    let mut managed_team_ids = std::collections::HashSet::new();
    managed_team_ids.insert(user_team_id.clone());
    for team in &game.teams {
        if team.team_kind == TeamKind::Academy
            && team.parent_team_id.as_deref() == Some(&user_team_id)
        {
            managed_team_ids.insert(team.id.clone());
        }
    }

    if managed_squad_has_recent_incoming_offer(
        game,
        &managed_team_ids,
        current_date,
        MANAGED_SQUAD_INCOMING_OFFER_COOLDOWN_DAYS,
    ) {
        simulate_ai_free_agent_signings(game, &user_team_id);
        simulate_ai_club_to_club_transfers(game, &user_team_id);
        return;
    }

    let buyer_ids: Vec<String> = game
        .teams
        .iter()
        .filter(|team| team.id != user_team_id && team.team_kind == TeamKind::Main)
        .map(|team| team.id.clone())
        .collect();

    let existing_offers_today = game
        .players
        .iter()
        .filter(|player| {
            player
                .team_id
                .as_deref()
                .map(|team_id| managed_team_ids.contains(team_id))
                .unwrap_or(false)
        })
        .flat_map(|player| player.transfer_offers.iter())
        .filter(|offer| offer.status == TransferOfferStatus::Pending && offer.date == today)
        .count();

    if existing_offers_today >= MAX_INCOMING_OFFERS_PER_DAY {
        simulate_ai_free_agent_signings(game, &user_team_id);
        simulate_ai_club_to_club_transfers(game, &user_team_id);
        return;
    }

    let mut created_offers = existing_offers_today;
    let mut academy_offer_created_today = false;
    for buyer_id in buyer_ids {
        if created_offers >= MAX_INCOMING_OFFERS_PER_DAY {
            break;
        }

        let Some(buyer_team) = game.teams.iter().find(|team| team.id == buyer_id) else {
            continue;
        };

        // Limit offers per buyer team per week
        let week_ago = current_date - chrono::Duration::days(7);
        let offers_from_buyer_last_week: usize = game
            .players
            .iter()
            .flat_map(|p| p.transfer_offers.iter())
            .filter(|offer| {
                offer.from_team_id == buyer_id
                    && parse_offer_date(&offer.date)
                        .map(|d| d >= week_ago)
                        .unwrap_or(false)
            })
            .count();
        if offers_from_buyer_last_week >= MAX_OFFERS_PER_TEAM_PER_WEEK {
            continue;
        }

        let mut chosen_player_id: Option<String> = None;
        let mut chosen_score = i32::MIN;
        let mut chosen_fee = 0_u64;
        let mut chosen_is_academy = false;

        let mut academy_player_id: Option<String> = None;
        let mut academy_score = i32::MIN;
        let mut academy_fee = 0_u64;

        for player in &game.players {
            let Some(player_team_id) = player.team_id.as_deref() else {
                continue;
            };

            if !managed_team_ids.contains(player_team_id) {
                continue;
            }

            let player_team = game.teams.iter().find(|team| team.id == player_team_id);
            let is_academy_player = player_team
                .map(|team| team.team_kind == TeamKind::Academy)
                .unwrap_or(false);

            if !allow_unsolicited_offer_for_player(current_date, player, player_team) {
                continue;
            }

            if is_academy_player {
                if !academy_offer_window_open {
                    continue;
                }

                if player_team.and_then(|team| team.parent_team_id.as_deref())
                    == Some(buyer_id.as_str())
                {
                    continue;
                }
            }

            if has_open_incoming_offer_from_club(player, &buyer_id) {
                continue;
            }

            let score = incoming_interest_score(current_date, player);
            let minimum_score = if is_academy_player { 12 } else { 8 };
            if score < minimum_score {
                continue;
            }

            let fee = suggested_incoming_fee(current_date, player, buyer_team, &buyer_id);
            if buyer_team.transfer_budget < fee as i64 || buyer_team.finance < fee as i64 {
                continue;
            }

            if score > chosen_score {
                chosen_player_id = Some(player.id.clone());
                chosen_score = score;
                chosen_fee = fee;
                chosen_is_academy = is_academy_player;
            }

            if is_academy_player && score > academy_score {
                academy_player_id = Some(player.id.clone());
                academy_score = score;
                academy_fee = fee;
            }
        }

        if academy_offer_window_open && !academy_offer_created_today
            && let Some(academy_id) = academy_player_id
                && !chosen_is_academy {
                    chosen_player_id = Some(academy_id);
                    chosen_fee = academy_fee;
                    chosen_is_academy = true;
                }

        let Some(player_id) = chosen_player_id else {
            continue;
        };

        let Some(player) = game
            .players
            .iter_mut()
            .find(|player| player.id == player_id)
        else {
            continue;
        };

        let offer_id = Uuid::new_v4().to_string();

        player
            .transfer_offers
            .push(crate::domain::player::TransferOffer {
                id: offer_id.clone(),
                from_team_id: buyer_id.clone(),
                destination_team_id: None,
                fee: chosen_fee,
                wage_offered: 0,
                last_manager_fee: None,
                negotiation_round: 1,
                suggested_counter_fee: None,
                players_included: vec![],
                status: TransferOfferStatus::Pending,
                date: today.clone(),
                wage_negotiation_status: crate::domain::player::WageNegotiationStatus::NotStarted,
                contract_years_offered: 0,
                suggested_counter_wage: None,
                suggested_counter_years: None,
                wage_negotiation_round: 0,
            });

        let player_name = player.match_name.clone();
        let buyer_name = buyer_team.name.clone();
        let message = crate::messages::incoming_transfer_offer_message(
            &offer_id,
            &player_id,
            &player_name,
            &buyer_name,
            chosen_fee,
            &today,
        );
        game.messages.push(message);
        created_offers = created_offers.saturating_add(1);
        if chosen_is_academy {
            academy_offer_created_today = true;
        }
    }

    simulate_ai_free_agent_signings(game, &user_team_id);
    simulate_ai_club_to_club_transfers(game, &user_team_id);
}

/// Parse a "YYYY-MM-DD" offer date string into NaiveDate, defaulting to epoch.
fn parse_offer_date(date: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()
}

fn simulate_ai_free_agent_signings(game: &mut Game, user_team_id: &str) {
    let mut candidate_team_ids: Vec<String> = game
        .teams
        .iter()
        .filter(|team| team.id != user_team_id && team.team_kind == TeamKind::Main)
        .filter(|team| team.transfer_budget > 0 && team.finance > 0)
        .map(|team| team.id.clone())
        .collect();

    candidate_team_ids.sort_by(|left, right| {
        let left_budget = game
            .teams
            .iter()
            .find(|team| team.id == *left)
            .map(|team| team.transfer_budget)
            .unwrap_or(0);
        let right_budget = game
            .teams
            .iter()
            .find(|team| team.id == *right)
            .map(|team| team.transfer_budget)
            .unwrap_or(0);
        right_budget.cmp(&left_budget)
    });

    let mut completed = 0_usize;

    for team_id in candidate_team_ids {
        if completed >= MAX_AI_FREE_AGENT_SIGNINGS_PER_DAY {
            break;
        }

        let roster_size = game
            .players
            .iter()
            .filter(|player| player.team_id.as_deref() == Some(team_id.as_str()))
            .count();
        if roster_size >= 7 {
            continue;
        }

        let Some(team) = game.teams.iter().find(|team| team.id == team_id) else {
            continue;
        };
        let budget_cap = team.transfer_budget.min(team.finance);
        if budget_cap <= 25_000 {
            continue;
        }

        let preferred_role = ai_team_priority_role(game, &team_id);

        let role_candidate = game
            .players
            .iter()
            .filter(|player| player.team_id.is_none())
            .filter(|player| lol_role_to_string(&player.natural_position) == preferred_role)
            .filter_map(|player| {
                let asking_price = (player.market_value as i64).max(25_000) / 5;
                (asking_price > 0 && asking_price <= budget_cap).then_some((
                    player.id.clone(),
                    asking_price as u64,
                    player.market_value,
                ))
            })
            .max_by_key(|(_, _, market_value)| *market_value);

        let candidate = game
            .players
            .iter()
            .filter(|player| player.team_id.is_none())
            .filter_map(|player| {
                let asking_price = (player.market_value as i64).max(25_000) / 5;
                (asking_price > 0 && asking_price <= budget_cap).then_some((
                    player.id.clone(),
                    asking_price as u64,
                    player.market_value,
                ))
            })
            .max_by_key(|(_, _, market_value)| *market_value);

        let Some((player_id, fee, _)) = role_candidate.or(candidate) else {
            continue;
        };

        let Some(player) = game.players.iter().find(|p| p.id == player_id) else {
            continue;
        };
        let Some(team) = game.teams.iter().find(|t| t.id == team_id) else {
            continue;
        };
        let decision = ai_signing_policy(game, team, player, SigningIntent::Strategic);
        if !decision.accepted {
            continue;
        }

        if !ai_transfer_cap_try_consume(game, &team_id, AiTransferKind::FreeAgent) {
            continue;
        }

        if execute_free_agent_signing(game, &player_id, &team_id, fee).is_ok() {
            completed = completed.saturating_add(1);
        }
    }
}

/// Public wrapper for the Team Agent to purchase a free agent for a specific
/// role. Returns `true` if a signing was executed.
pub fn ai_agent_purchase(game: &mut Game, team_id: &str, role: &str) -> bool {
    let Some(team) = game.teams.iter().find(|t| t.id == team_id).cloned() else {
        return false;
    };
    let budget_cap = team.transfer_budget.min(team.finance);
    if budget_cap <= 25_000 {
        return false;
    }

    let candidate = game
        .players
        .iter()
        .filter(|player| player.team_id.is_none())
        .filter(|player| lol_role_to_string(&player.natural_position) == role)
        .filter_map(|player| {
            let asking_price = (player.market_value as i64).max(25_000) / 5;
            (asking_price > 0 && asking_price <= budget_cap).then_some((
                player.id.clone(),
                asking_price as u64,
                player.market_value,
            ))
        })
        .max_by_key(|(_, fee, _)| *fee);

    if let Some((player_id, fee, _market_value)) = candidate {
        let Some(player) = game.players.iter().find(|p| p.id == player_id) else {
            return false;
        };
        let decision = ai_signing_policy(game, &team, player, SigningIntent::Casual);
        if !decision.accepted {
            return false;
        }

        if !ai_transfer_cap_try_consume(game, team_id, AiTransferKind::FreeAgent) {
            return false;
        }

        execute_free_agent_signing(game, &player_id, team_id, fee).is_ok()
    } else {
        false
    }
}

fn simulate_ai_club_to_club_transfers(game: &mut Game, user_team_id: &str) {
    let current_date = game.clock.current_date.date_naive();

    let mut completed = 0_usize;
    let buyer_ids: Vec<String> = game
        .teams
        .iter()
        .filter(|team| team.id != user_team_id && team.team_kind == TeamKind::Main)
        .filter(|team| team.transfer_budget > 0 && team.finance > 0)
        .map(|team| team.id.clone())
        .collect();

    for buyer_id in buyer_ids {
        if completed >= MAX_AI_INTERCLUB_TRANSFERS_PER_DAY {
            break;
        }

        let Some(buyer_team) = game.teams.iter().find(|team| team.id == buyer_id).cloned() else {
            continue;
        };
        let budget_cap = buyer_team.transfer_budget.min(buyer_team.finance);
        if budget_cap <= 200_000 {
            continue;
        }

        let preferred_role = ai_team_priority_role(game, &buyer_id);

        let role_candidate = game
            .players
            .iter()
            .filter_map(|player| {
                if lol_role_to_string(&player.natural_position) != preferred_role {
                    return None;
                }

                if let Some(date_str) = &player.can_be_transferred_until
                    && let Ok(date) = NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
                        && date >= current_date {
                            return None;
                        }

                let seller_id = player.team_id.as_deref()?;
                if seller_id == user_team_id || seller_id == buyer_id {
                    return None;
                }

                let seller_team = game.teams.iter().find(|team| team.id == seller_id)?;
                if seller_team.team_kind != TeamKind::Main {
                    return None;
                }

                let fee = suggested_incoming_fee(current_date, player, &buyer_team, &buyer_id);
                if fee == 0 || (fee as i64) > budget_cap {
                    return None;
                }

                let attractiveness = incoming_interest_score(current_date, player)
                    + if player.transfer_listed { 20 } else { 0 }
                    + if player.market_value >= 1_000_000 {
                        10
                    } else {
                        0
                    };

                (attractiveness >= 35).then_some((
                    player.id.clone(),
                    seller_id.to_string(),
                    fee,
                    attractiveness,
                ))
            })
            .max_by_key(|(_, _, _, attractiveness)| *attractiveness);

        let candidate = game
            .players
            .iter()
            .filter_map(|player| {
                if let Some(date_str) = &player.can_be_transferred_until
                    && let Ok(date) = NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
                        && date >= current_date {
                            return None;
                        }

                let seller_id = player.team_id.as_deref()?;
                if seller_id == user_team_id || seller_id == buyer_id {
                    return None;
                }

                let seller_team = game.teams.iter().find(|team| team.id == seller_id)?;
                if seller_team.team_kind != TeamKind::Main {
                    return None;
                }

                let fee = suggested_incoming_fee(current_date, player, &buyer_team, &buyer_id);
                if fee == 0 || (fee as i64) > budget_cap {
                    return None;
                }

                let attractiveness = incoming_interest_score(current_date, player)
                    + if player.transfer_listed { 20 } else { 0 }
                    + if player.market_value >= 1_000_000 {
                        10
                    } else {
                        0
                    };

                (attractiveness >= 35).then_some((
                    player.id.clone(),
                    seller_id.to_string(),
                    fee,
                    attractiveness,
                ))
            })
            .max_by_key(|(_, _, _, attractiveness)| *attractiveness);

        let Some((player_id, seller_id, fee, _)) = role_candidate.or(candidate) else {
            continue;
        };

        let Some(player) = game.players.iter().find(|p| p.id == player_id) else {
            continue;
        };
        let decision = ai_signing_policy(game, &buyer_team, player, SigningIntent::Strategic);
        if !decision.accepted {
            continue;
        }

        if !ai_transfer_cap_try_consume(game, &buyer_id, AiTransferKind::ClubToClub) {
            continue;
        }

        if execute_transfer(game, &player_id, &buyer_id, &seller_id, fee, true).is_ok() {
            completed = completed.saturating_add(1);
        }
    }
}

pub(crate) fn ai_team_priority_role(game: &Game, team_id: &str) -> &'static str {
    let mut role_counts = [0_usize; 5];

    for player in &game.players {
        if player.team_id.as_deref() != Some(team_id) {
            continue;
        }

        let role = lol_role_to_string(&player.natural_position);
        if let Some(index) = LOL_CORE_ROLES
            .iter()
            .position(|candidate| *candidate == role)
        {
            role_counts[index] = role_counts[index].saturating_add(1);
        }
    }

    let mut best_index = 0_usize;
    let mut best_count = role_counts[0];

    for (index, count) in role_counts.iter().enumerate().skip(1) {
        if *count < best_count {
            best_count = *count;
            best_index = index;
        }
    }

    LOL_CORE_ROLES[best_index]
}

fn buyer_counter_offer_ceiling(
    current_date: NaiveDate,
    player: &crate::domain::player::Player,
    current_offer_fee: u64,
    buyer_team: &crate::domain::team::Team,
) -> u64 {
    let baseline_fee = suggested_incoming_fee(current_date, player, buyer_team, &buyer_team.id)
        .max(current_offer_fee);
    let ceiling = ((baseline_fee as f64) * 1.2).round() as u64;
    ceiling
        .min(buyer_team.transfer_budget.max(0) as u64)
        .min(buyer_team.finance.max(0) as u64)
}

fn should_generate_major_transfer_news(player: &crate::domain::player::Player, fee: u64) -> bool {
    fee >= 1_000_000 || player.market_value >= 1_000_000
}

fn transfer_outcome(
    decision: TransferNegotiationDecision,
    suggested_fee: Option<u64>,
    is_terminal: bool,
    feedback: NegotiationFeedback,
) -> TransferNegotiationOutcome {
    TransferNegotiationOutcome {
        decision,
        suggested_fee,
        is_terminal,
        feedback,
    }
}

pub fn project_transfer_bid_financial_impact(
    game: &Game,
    player_id: &str,
    fee: u64,
    destination: TransferDestination,
) -> Result<TransferBidFinancialProjection, String> {
    let user_team_id = game
        .manager
        .team_id
        .clone()
        .ok_or_else(|| "No user team".to_string())?;

    let destination_team_id = resolve_user_transfer_destination(game, &user_team_id, destination)?;

    let player = game
        .players
        .iter()
        .find(|player| player.id == player_id)
        .ok_or_else(|| "Player not found".to_string())?;

    if player
        .team_id
        .as_deref()
        .is_some_and(|team_id| is_managed_team_id(game, &user_team_id, team_id))
    {
        return Err("Cannot bid on your own player".to_string());
    }

    let paying_team = game
        .teams
        .iter()
        .find(|team| team.id == user_team_id)
        .ok_or_else(|| "User team not found".to_string())?;
    let destination_team = game
        .teams
        .iter()
        .find(|team| team.id == destination_team_id)
        .ok_or_else(|| "Destination team not found".to_string())?;

    let annual_wage_bill_before = calc_annual_wages(game, &destination_team.id);
    let annual_wage_bill_after = annual_wage_bill_before + player.wage as i64;
    let projected_wage_budget_usage_pct = if destination_team.wage_budget > 0 {
        ((annual_wage_bill_after as f64 / destination_team.wage_budget as f64) * 100.0).round()
            as i64
    } else {
        0
    };

    let effective_fee = if player.team_id.is_none() { 0 } else { fee };
    let transfer_budget_after = paying_team.transfer_budget - effective_fee as i64;
    let finance_after = paying_team.finance - effective_fee as i64;

    Ok(TransferBidFinancialProjection {
        transfer_budget_before: paying_team.transfer_budget,
        transfer_budget_after,
        finance_before: paying_team.finance,
        finance_after,
        annual_wage_bill_before,
        annual_wage_bill_after,
        annual_wage_budget: destination_team.wage_budget,
        projected_wage_budget_usage_pct,
        exceeds_transfer_budget: transfer_budget_after < 0,
        exceeds_finance: finance_after < 0,
    })
}

/// Submit a transfer bid from user's team for a player.
/// The AI evaluates the bid and can accept, reject, or counter based on club context.
pub fn make_transfer_bid(
    game: &mut Game,
    player_id: &str,
    fee: u64,
    destination: TransferDestination,
    included_player_ids: &[String],
) -> Result<TransferNegotiationOutcome, String> {
    expire_stale_transfer_offers(game);

    if !transfer_window_is_open(game) {
        return Err("Transfer window is closed".into());
    }

    if included_player_ids.len() > 2 {
        return Err("Maximum 2 players can be included in a deal".into());
    }

    let user_team_id = game.manager.team_id.clone().ok_or("No user team")?;
    let destination_team_id = resolve_user_transfer_destination(game, &user_team_id, destination)?;

    let player = game
        .players
        .iter()
        .find(|p| p.id == player_id)
        .ok_or("Player not found")?;

    if player
        .team_id
        .as_deref()
        .is_some_and(|team_id| is_managed_team_id(game, &user_team_id, team_id))
    {
        return Err("Cannot bid on your own player".into());
    }

    let my_team = game
        .teams
        .iter()
        .find(|t| t.id == user_team_id)
        .ok_or("User team not found")?;

    let effective_fee = if player.team_id.is_none() { 0 } else { fee };

    if (my_team.finance as u64) < effective_fee {
        return Err("Insufficient funds".into());
    }

    if my_team.transfer_budget < effective_fee as i64 {
        return Err("Transfer budget too low".into());
    }

    let date = game.clock.current_date.format("%Y-%m-%d").to_string();
    let current_date = game.clock.current_date.date_naive();

    let included_items: Vec<PlayerOfferItem> = included_player_ids
        .iter()
        .map(|pid| {
            let p = game
                .players
                .iter()
                .find(|p| p.id == pid.as_str() && p.team_id.as_deref() == Some(&user_team_id))
                .ok_or_else(|| format!("Included player {} not found or not yours", pid))?;

            if p.transfer_offers
                .iter()
                .any(|o| o.status == TransferOfferStatus::Pending)
            {
                return Err(format!(
                    "Player {} already has a pending transfer offer",
                    pid
                ));
            }

            let days = contract_days_remaining(current_date, p.contract_end.as_deref())
                .ok_or_else(|| format!("Player {} has no active contract", pid))?;
            if days <= 0 {
                return Err(format!("Player {} has an expired contract", pid));
            }

            let valuation = calculate_player_offer_value(current_date, p);
            Ok(PlayerOfferItem {
                player_id: pid.clone(),
                player_name: p.match_name.clone(),
                valuation,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;

    let total_included_value: u64 = included_items.iter().map(|item| item.valuation).sum();

    if player.team_id.is_none() {
        let free_agent_fee = 0u64;

        if let Some(p) = game.players.iter_mut().find(|p| p.id == player_id) {
            let offer_id = upsert_transfer_offer(
                p,
                &user_team_id,
                Some(&destination_team_id),
                free_agent_fee,
                TransferOfferStatus::Accepted,
                &date,
                Some(free_agent_fee),
                1,
                None,
            );
            if let Some(o) = p.transfer_offers.iter_mut().find(|o| o.id == offer_id) {
                o.players_included = included_items.clone();
                o.wage_negotiation_status = WageNegotiationStatus::Pending;
                o.wage_negotiation_round = 1;
            }
        }

        return Ok(transfer_outcome(
            TransferNegotiationDecision::Accepted,
            None,
            false,
            build_transfer_feedback(
                "transfers.transferFeedbackAcceptedHeadline",
                "transfers.transferFeedbackWageNegotiationDetail",
                NegotiationMood::Positive,
                24,
                84,
                1,
                &[("fee", free_agent_fee.to_string())],
            ),
        ));
    }

    let owner_team_id = player.team_id.clone().ok_or("Player has no team")?;

    let owner_team = game
        .teams
        .iter()
        .find(|t| t.id == owner_team_id)
        .ok_or("Owner team not found")?;

    let buyer_team = my_team;

    let threshold = minimum_acceptable_fee(current_date, player, owner_team, buyer_team);
    let existing_offer = find_open_offer_from_club(player, &user_team_id);
    let previous_fee = existing_offer.map(|offer| offer.fee);
    let previous_counter_fee = existing_offer.and_then(|offer| offer.suggested_counter_fee);
    let round = negotiation_round_from_offer(existing_offer);
    let respected_signal = previous_counter_fee
        .map(|counter| fee >= counter.saturating_mul(95) / 100)
        .unwrap_or(false);
    let stalled = previous_fee
        .map(|previous| fee <= previous.saturating_add(50_000))
        .unwrap_or(false);
    let concession = if respected_signal {
        ((threshold as f64) * 0.04).round() as u64
    } else if round >= 3 && !stalled {
        ((threshold as f64) * 0.02).round() as u64
    } else {
        0
    };
    let effective_threshold = threshold.saturating_sub(total_included_value);
    let adjusted_threshold = effective_threshold.saturating_sub(concession);
    let counter_floor_ratio = if round >= 2 && stalled {
        0.94
    } else if round >= 3 {
        0.92
    } else {
        0.88
    };
    let counter_floor = ((adjusted_threshold as f64) * counter_floor_ratio).round() as u64;
    let openness_score = player_move_openness_score(current_date, player, owner_team, buyer_team);
    let (tension, patience) = transfer_negotiation_metrics(round, stalled, respected_signal);

    if fee >= adjusted_threshold {
        if !player_accepts_transfer(current_date, player, owner_team, buyer_team) {
            if let Some(p) = game.players.iter_mut().find(|p| p.id == player_id) {
                upsert_transfer_offer(
                    p,
                    &user_team_id,
                    Some(&destination_team_id),
                    fee,
                    TransferOfferStatus::Rejected,
                    &date,
                    Some(fee),
                    round,
                    None,
                );
            }

            return Ok(transfer_outcome(
                TransferNegotiationDecision::Rejected,
                None,
                true,
                build_transfer_feedback(
                    "transfers.transferFeedbackRejectedHeadline",
                    "transfers.transferFeedbackPlayerRejectedDetail",
                    NegotiationMood::Guarded,
                    tension.saturating_add(6).min(90),
                    patience.saturating_sub(8),
                    round,
                    &[("fee", round_transfer_fee(adjusted_threshold).to_string())],
                ),
            ));
        }

        if let Some(p) = game.players.iter_mut().find(|p| p.id == player_id) {
            let offer_id = upsert_transfer_offer(
                p,
                &user_team_id,
                Some(&destination_team_id),
                fee,
                TransferOfferStatus::Accepted,
                &date,
                Some(fee),
                round,
                None,
            );
            if let Some(o) = p.transfer_offers.iter_mut().find(|o| o.id == offer_id) {
                o.players_included = included_items.clone();
                o.wage_negotiation_status = WageNegotiationStatus::Pending;
                o.wage_negotiation_round = 1;
            }
        }

        return Ok(transfer_outcome(
            TransferNegotiationDecision::Accepted,
            None,
            false,
            build_transfer_feedback(
                "transfers.transferFeedbackAcceptedHeadline",
                "transfers.transferFeedbackWageNegotiationDetail",
                NegotiationMood::Positive,
                tension.saturating_sub(8),
                patience.saturating_add(6).min(90),
                round,
                &[("fee", fee.to_string())],
            ),
        ));
    }

    if fee >= counter_floor {
        let suggested_fee = round_transfer_fee(adjusted_threshold);
        if let Some(p) = game.players.iter_mut().find(|p| p.id == player_id) {
            upsert_transfer_offer(
                p,
                &user_team_id,
                Some(&destination_team_id),
                fee,
                TransferOfferStatus::Pending,
                &date,
                Some(fee),
                round,
                Some(suggested_fee),
            );
        }

        return Ok(transfer_outcome(
            TransferNegotiationDecision::CounterOffer,
            Some(suggested_fee),
            false,
            build_transfer_feedback(
                "transfers.transferFeedbackCounterHeadline",
                "transfers.transferFeedbackCounterDetail",
                if openness_score >= 45 {
                    NegotiationMood::Firm
                } else {
                    NegotiationMood::Tense
                },
                if openness_score >= 45 {
                    tension.saturating_sub(6)
                } else {
                    tension.saturating_add(6).min(90)
                },
                if openness_score >= 45 {
                    patience.saturating_add(4).min(90)
                } else {
                    patience.saturating_sub(4)
                },
                round,
                &[("fee", suggested_fee.to_string())],
            ),
        ));
    }

    if let Some(p) = game.players.iter_mut().find(|p| p.id == player_id) {
        upsert_transfer_offer(
            p,
            &user_team_id,
            Some(&destination_team_id),
            fee,
            TransferOfferStatus::Rejected,
            &date,
            Some(fee),
            round,
            None,
        );
    }

    Ok(transfer_outcome(
        TransferNegotiationDecision::Rejected,
        None,
        true,
        build_transfer_feedback(
            "transfers.transferFeedbackRejectedHeadline",
            "transfers.transferFeedbackRejectedDetail",
            NegotiationMood::Guarded,
            tension.saturating_add(10).min(92),
            patience.saturating_sub(14),
            round,
            &[("fee", round_transfer_fee(adjusted_threshold).to_string())],
        ),
    ))
}

pub(crate) fn execute_free_agent_signing(
    game: &mut Game,
    player_id: &str,
    to_team_id: &str,
    fee: u64,
) -> Result<(), String> {
    execute_free_agent_signing_with_payer(game, player_id, to_team_id, to_team_id, fee)
}

fn execute_free_agent_signing_with_payer(
    game: &mut Game,
    player_id: &str,
    to_team_id: &str,
    payer_team_id: &str,
    fee: u64,
) -> Result<(), String> {
    let current_date = game.clock.current_date.date_naive();
    let annual_wage;
    let contract_years;

    if let Some(player) = game
        .players
        .iter_mut()
        .find(|player| player.id == player_id)
    {
        let to_team = game
            .teams
            .iter()
            .find(|team| team.id == to_team_id)
            .ok_or("Destination team not found")?;
        annual_wage = expected_wage(player, to_team, current_date);
        contract_years = expected_contract_years(player, current_date) as u8;

        player.team_id = Some(to_team_id.to_string());
        player.transfer_listed = false;
        player.loan_listed = false;
        player
            .transfer_offers
            .retain(|offer| offer.status == TransferOfferStatus::Accepted);
        player.contract_end = Some(contract_end_for_years(current_date, contract_years));
        player.wage = annual_wage;
    } else {
        return Err("Player not found".to_string());
    }

    if let Some(team) = game.teams.iter_mut().find(|team| team.id == payer_team_id) {
        record_transaction(
            team,
            FinanceTransactionInput {
                date: game.clock.current_date.format("%Y-%m-%d").to_string(),
                description: format!("Free agent signing fee for {player_id}"),
                amount: -(fee as i64),
                kind: FinancialTransactionKind::TransferPurchase,
                budget_impact: BudgetImpact::Transfer(-(fee as i64)),
                affects_season_totals: false,
                source: "transfer".to_string(),
                source_id: Some(player_id.to_string()),
                correlation_id: Some(format!("transfer:{payer_team_id}:{player_id}:free-agent")),
            },
        )
        .ok();
    }

    let players_snapshot = game.players.clone();
    if let Some(team) = game.teams.iter_mut().find(|team| team.id == to_team_id) {
        clear_player_from_active_lineup(team, player_id);
        reconcile_lol_active_lineup(team, &players_snapshot);
    }

    let user_team_id = game.manager.team_id.clone().unwrap_or_default();
    let is_user_involved = to_team_id == user_team_id;
    let is_user_buying = is_user_involved;

    record_transfer(
        game,
        player_id,
        "",
        to_team_id,
        0,
        annual_wage,
        contract_years,
        is_user_involved,
        is_user_buying,
        false,
        None,
        0,
        &[],
        None,
    );

    Ok(())
}

/// Respond to an incoming transfer offer on one of user's players.
pub fn respond_to_offer(
    game: &mut Game,
    player_id: &str,
    offer_id: &str,
    accept: bool,
) -> Result<(), String> {
    expire_stale_transfer_offers(game);

    if accept && !transfer_window_is_open(game) {
        return Err("Transfer window is closed".into());
    }

    let user_team_id = game.manager.team_id.clone().ok_or("No user team")?;

    let player = game
        .players
        .iter()
        .find(|p| p.id == player_id && p.team_id.as_deref() == Some(&user_team_id))
        .ok_or("Player not found or not yours")?;

    let offer = player
        .transfer_offers
        .iter()
        .find(|o| o.id == offer_id && o.status == TransferOfferStatus::Pending)
        .ok_or("Offer not found or not pending")?;

    let from_team_id = offer.from_team_id.clone();
    let fee = offer.fee;
    let current_date = game.clock.current_date.date_naive();
    let openness_score = {
        let owner_team = game
            .teams
            .iter()
            .find(|team| team.id == user_team_id)
            .ok_or("User team not found")?;
        let buyer_team = game
            .teams
            .iter()
            .find(|team| team.id == from_team_id)
            .ok_or("Buying team not found")?;
        player_move_openness_score(current_date, player, owner_team, buyer_team)
    };

    // Update offer status
    if let Some(p) = game.players.iter_mut().find(|p| p.id == player_id)
        && let Some(o) = p.transfer_offers.iter_mut().find(|o| o.id == offer_id)
    {
        o.status = if accept {
            TransferOfferStatus::Accepted
        } else {
            TransferOfferStatus::Rejected
        };
    }

    if accept {
        execute_transfer(game, player_id, &from_team_id, &user_team_id, fee, true)?;
    } else if let Some(player) = game
        .players
        .iter_mut()
        .find(|player| player.id == player_id)
    {
        apply_blocked_move_consequences(player, openness_score);
    }

    Ok(())
}

pub fn counter_offer(
    game: &mut Game,
    player_id: &str,
    offer_id: &str,
    requested_fee: u64,
    included_player_ids: &[String],
) -> Result<TransferNegotiationOutcome, String> {
    expire_stale_transfer_offers(game);

    if !transfer_window_is_open(game) {
        return Err("Transfer window is closed".into());
    }

    if included_player_ids.len() > 2 {
        return Err("Maximum 2 players can be included in a deal".into());
    }

    let user_team_id = game.manager.team_id.clone().ok_or("No user team")?;

    let player = game
        .players
        .iter()
        .find(|p| p.id == player_id && p.team_id.as_deref() == Some(&user_team_id))
        .ok_or("Player not found or not yours")?;

    let offer = player
        .transfer_offers
        .iter()
        .find(|offer| offer.id == offer_id && offer.status == TransferOfferStatus::Pending)
        .ok_or("Offer not found or not pending")?;
    let player_snapshot = player.clone();

    let current_date = game.clock.current_date.date_naive();

    let included_items: Vec<PlayerOfferItem> = included_player_ids
        .iter()
        .map(|pid| {
            let p = game
                .players
                .iter()
                .find(|p| p.id == pid.as_str() && p.team_id.as_deref() == Some(&user_team_id))
                .ok_or_else(|| format!("Included player {} not found or not yours", pid))?;

            if p.transfer_offers
                .iter()
                .any(|o| o.status == TransferOfferStatus::Pending)
            {
                return Err(format!(
                    "Player {} already has a pending transfer offer",
                    pid
                ));
            }

            let days = contract_days_remaining(current_date, p.contract_end.as_deref())
                .ok_or_else(|| format!("Player {} has no active contract", pid))?;
            if days <= 0 {
                return Err(format!("Player {} has an expired contract", pid));
            }

            let valuation = calculate_player_offer_value(current_date, p);
            Ok(PlayerOfferItem {
                player_id: pid.clone(),
                player_name: p.match_name.clone(),
                valuation,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;

    let total_included_value: u64 = included_items.iter().map(|item| item.valuation).sum();

    if requested_fee <= offer.fee && included_items.is_empty() {
        return Err("Counter offer must exceed current offer".into());
    }

    let buyer_team = game
        .teams
        .iter()
        .find(|team| team.id == offer.from_team_id)
        .ok_or("Buying team not found")?;

    let _buyer_team_id = buyer_team.id.clone();
    let round = offer.negotiation_round.max(1).saturating_add(1);
    let respected_signal = offer
        .suggested_counter_fee
        .map(|suggested| requested_fee <= suggested.saturating_add(50_000))
        .unwrap_or(false);
    let stalled = requested_fee > offer.fee.saturating_add(175_000);
    let (tension, patience) = transfer_negotiation_metrics(round, stalled, respected_signal);
    let counter_ceiling =
        buyer_counter_offer_ceiling(current_date, &player_snapshot, offer.fee, buyer_team);
    let adjusted_ceiling = counter_ceiling.saturating_add(total_included_value);
    let budget_cap =
        (buyer_team.transfer_budget.max(0) as u64).min(buyer_team.finance.max(0) as u64);
    let goodwill_margin = if respected_signal { 50_000 } else { 0 };
    let accepted = requested_fee
        <= adjusted_ceiling
            .saturating_add(goodwill_margin)
            .min(budget_cap);
    let counter_window = ((adjusted_ceiling as f64)
        * if round >= 3 && stalled { 1.03 } else { 1.08 })
    .round() as u64;
    let date = game.clock.current_date.format("%Y-%m-%d").to_string();

    if let Some(p) = game.players.iter_mut().find(|p| p.id == player_id)
        && let Some(o) = p.transfer_offers.iter_mut().find(|o| o.id == offer_id)
    {
        if accepted {
            o.fee = requested_fee;
            o.status = TransferOfferStatus::Accepted;
            o.destination_team_id = Some(o.from_team_id.clone());
            o.last_manager_fee = Some(requested_fee);
            o.negotiation_round = round;
            o.suggested_counter_fee = None;
            o.players_included = included_items.clone();
        } else if requested_fee > counter_window {
            o.status = TransferOfferStatus::Rejected;
            o.last_manager_fee = Some(requested_fee);
            o.negotiation_round = round;
            o.suggested_counter_fee = None;
        }
        o.date = date.clone();
    }

    if accepted {
        if let Some(p) = game.players.iter_mut().find(|p| p.id == player_id)
            && let Some(o) = p.transfer_offers.iter_mut().find(|o| o.id == offer_id)
        {
            o.players_included = included_items.clone();
            o.wage_negotiation_status = WageNegotiationStatus::Pending;
            o.wage_negotiation_round = 1;
        }

        return Ok(transfer_outcome(
            TransferNegotiationDecision::Accepted,
            None,
            false,
            build_transfer_feedback(
                "transfers.transferFeedbackAcceptedHeadline",
                "transfers.transferFeedbackWageNegotiationDetail",
                NegotiationMood::Positive,
                tension.saturating_sub(8),
                patience.saturating_add(8).min(92),
                round,
                &[("fee", requested_fee.to_string())],
            ),
        ));
    }

    if requested_fee <= counter_window {
        let suggested_fee = round_transfer_fee(counter_ceiling);
        if let Some(p) = game.players.iter_mut().find(|p| p.id == player_id)
            && let Some(o) = p.transfer_offers.iter_mut().find(|o| o.id == offer_id)
        {
            o.fee = suggested_fee;
            o.status = TransferOfferStatus::Pending;
            o.last_manager_fee = Some(requested_fee);
            o.negotiation_round = round;
            o.suggested_counter_fee = Some(suggested_fee);
            o.date = date;
        }

        return Ok(transfer_outcome(
            TransferNegotiationDecision::CounterOffer,
            Some(suggested_fee),
            false,
            build_transfer_feedback(
                "transfers.transferFeedbackCounterHeadline",
                "transfers.transferFeedbackCounterDetail",
                NegotiationMood::Firm,
                tension,
                patience,
                round,
                &[("fee", suggested_fee.to_string())],
            ),
        ));
    }

    Ok(transfer_outcome(
        TransferNegotiationDecision::Rejected,
        None,
        true,
        build_transfer_feedback(
            "transfers.transferFeedbackRejectedHeadline",
            "transfers.transferFeedbackRejectedDetail",
            NegotiationMood::Tense,
            tension.saturating_add(10).min(92),
            patience.saturating_sub(12),
            round,
            &[("fee", round_transfer_fee(counter_ceiling).to_string())],
        ),
    ))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WageNegotiationOutcome {
    pub decision: TransferNegotiationDecision,
    pub suggested_wage: Option<u32>,
    pub suggested_years: Option<u8>,
    pub is_terminal: bool,
    pub feedback: NegotiationFeedback,
}

fn calculate_wage_acceptance_score(
    current_date: NaiveDate,
    player: &crate::domain::player::Player,
    offered_wage: u32,
    contract_years: u8,
    game: &Game,
) -> i32 {
    let current_wage = player.wage;
    let wage_diff = offered_wage as i64 - current_wage as i64;
    let wage_increase_pct = if current_wage > 0 {
        ((offered_wage as f64 / current_wage as f64) - 1.0) * 100.0
    } else {
        100.0
    };

    let mut score = 0_i32;

    // Primary scoring: percentage increase (works at any salary level)
    if wage_increase_pct >= 40.0 {
        score += 55;
    } else if wage_increase_pct >= 25.0 {
        score += 45;
    } else if wage_increase_pct >= 15.0 {
        score += 35;
    } else if wage_increase_pct >= 5.0 {
        score += 25;
    } else if wage_increase_pct >= 0.0 {
        score += 15;
    } else {
        score -= 15;
    }

    // Bonus for large absolute increases (high-salary players)
    if wage_diff >= 150_000 {
        score += 10;
    } else if wage_diff >= 75_000 {
        score += 5;
    }

    if player.team_id.is_none() {
        // Free agent: eager to find a new club
        score += 25;
    } else if let Some(team_id) = &player.team_id
        && game.teams.iter().any(|t| t.id.as_str() == team_id.as_str()) {
            let player_team = game
                .teams
                .iter()
                .find(|t| t.id.as_str() == team_id.as_str());
            let is_academy = player_team
                .map(|t| t.team_kind == TeamKind::Academy)
                .unwrap_or(false);

            if is_academy {
                // Academy player wants to step up to main squad
                score += 15;
            }

            let team_wages: Vec<u32> = game
                .players
                .iter()
                .filter(|p| p.team_id.as_deref() == Some(team_id))
                .map(|p| p.wage)
                .collect();
            if !team_wages.is_empty() {
                let max_wage = team_wages.iter().max().copied().unwrap_or(0);
                let min_wage = team_wages.iter().min().copied().unwrap_or(0);
                if player.wage >= max_wage {
                    score -= 5;
                }
                if player.wage <= min_wage && team_wages.len() > 1 {
                    score += 10;
                }
            }
        }

    if player.transfer_listed {
        // Player actively wants to leave
        score += 20;
    }

    // Contract situation: players near end of contract are more open to moves
    if let Some(contract_end) = &player.contract_end
        && let Ok(end_date) = NaiveDate::parse_from_str(contract_end, "%Y-%m-%d") {
            let days_left = (end_date - current_date).num_days();
            if days_left <= 30 {
                score += 18; // Contract almost expired
            } else if days_left <= 90 {
                score += 10; // Contract expiring this season
            } else if days_left <= 180 {
                score += 5; // One year or less remaining
            }
        }

    // Contract duration: longer commitments demand higher wages
    if contract_years == 1 {
        score += 12; // Short deal, willing to accept less
    } else if contract_years == 2 {
        score += 8; // Moderate commitment
    } else if contract_years == 3 {
        score -= 3; // Longer commitment, wants better pay
    } else if contract_years >= 4 {
        score -= 6; // Long-term lock-in, demands premium wages
    }

    if player.morale >= 80 {
        score -= 3;
    } else if player.morale <= 45 {
        score += 10;
    }

    let age = calc_player_age(current_date, &player.date_of_birth);
    if age <= 22 {
        score += 8;
    } else if age >= 32 {
        score += 3;
    }

    score
}

fn wage_negotiation_metrics(round: u8, stalled: bool, respected_signal: bool) -> (u8, u8) {
    let mut tension = 30_i16 + (i16::from(round.saturating_sub(1)) * 18);
    let mut patience = 85_i16 - (i16::from(round.saturating_sub(1)) * 20);

    if stalled {
        tension += 14;
        patience -= 14;
    }

    if respected_signal {
        tension -= 8;
        patience += 10;
    }

    (tension.clamp(20, 92) as u8, patience.clamp(15, 88) as u8)
}

fn build_wage_feedback(
    headline_key: &str,
    detail_key: &str,
    mood: NegotiationMood,
    tension: u8,
    patience: u8,
    round: u8,
    params: &[(&str, String)],
) -> NegotiationFeedback {
    NegotiationFeedback {
        mood,
        headline_key: headline_key.to_string(),
        detail_key: Some(detail_key.to_string()),
        tension,
        patience,
        round,
        params: params
            .iter()
            .map(|(key, value)| ((*key).to_string(), value.clone()))
            .collect(),
    }
}

pub fn negotiate_player_wage(
    game: &mut Game,
    player_id: &str,
    offer_id: &str,
    annual_wage: u32,
    contract_years: u8,
) -> Result<WageNegotiationOutcome, String> {
    if contract_years == 0 || contract_years > 5 {
        return Err("Contract must be between 1 and 5 years".into());
    }

    let user_team_id = game.manager.team_id.clone().ok_or("No user team")?;

    let player_team_id: Option<String> = game
        .players
        .iter()
        .find(|p| p.id == player_id)
        .map(|p| p.team_id.clone())
        .ok_or("Player not found")?;

    let player = game
        .players
        .iter()
        .find(|p| p.id == player_id)
        .ok_or("Player not found")?;

    let offer = player
        .transfer_offers
        .iter()
        .find(|o| o.id == offer_id && o.status == TransferOfferStatus::Accepted)
        .ok_or("Offer not found or not accepted by club")?;

    if offer.wage_negotiation_status != WageNegotiationStatus::Pending {
        return Err("Wage negotiation not available for this offer".into());
    }

    let destination_team_id = offer
        .destination_team_id
        .clone()
        .ok_or("No destination team")?;
    let destination_is_user_academy = game
        .teams
        .iter()
        .find(|team| team.id == destination_team_id)
        .and_then(|team| team.parent_team_id.as_deref())
        == Some(user_team_id.as_str());
    let payer_team_id = if destination_team_id == user_team_id || destination_is_user_academy {
        user_team_id.clone()
    } else {
        destination_team_id.clone()
    };

    let offer_fee = offer.fee;

    let current_date = game.clock.current_date.date_naive();
    let date = game.clock.current_date.format("%Y-%m-%d").to_string();
    // wage_negotiation_round starts at 1 for a fresh offer; don't double-increment
    let round = offer.wage_negotiation_round;

    // Accept immediately if offer matches a previous counter-offer within tolerance
    if let Some(counter_annual) = offer.suggested_counter_wage
        && annual_wage >= counter_annual.saturating_sub(5_000)
        && annual_wage <= counter_annual.saturating_add(5_000)
    {
        if let Some(p) = game.players.iter_mut().find(|p| p.id == player_id)
            && let Some(o) = p.transfer_offers.iter_mut().find(|o| o.id == offer_id)
        {
            o.wage_negotiation_status = WageNegotiationStatus::Agreed;
            o.contract_years_offered = contract_years;
            o.wage_offered = annual_wage;
            o.date = date.clone();
        }

        complete_transfer_with_wage(
            game,
            player_id,
            &destination_team_id,
            &payer_team_id,
            player_team_id.as_deref(),
            offer_fee,
            annual_wage,
            contract_years,
            &date,
        )?;

        return Ok(WageNegotiationOutcome {
            decision: TransferNegotiationDecision::Accepted,
            suggested_wage: None,
            suggested_years: None,
            is_terminal: true,
            feedback: build_wage_feedback(
                "transfers.wageFeedbackAcceptedHeadline",
                "transfers.wageFeedbackAcceptedDetail",
                NegotiationMood::Positive,
                20,
                90,
                round,
                &[("wage", annual_wage.to_string())],
            ),
        });
    }

    let score =
        calculate_wage_acceptance_score(current_date, player, annual_wage, contract_years, game);

    let previous_wage = if annual_wage > player.wage {
        Some(player.wage)
    } else {
        None
    };
    // Clear stale suggested_counter_wage from previous rounds to avoid confusion
    let previous_counter = offer.suggested_counter_wage;
    let respected_signal = previous_wage.is_some()
        && previous_counter
            .map(|suggested| annual_wage <= suggested.saturating_add(50_000))
            .unwrap_or(false);
    // Stalled: offer barely above current wage (< 5% increase)
    let stalled =
        previous_wage.is_some() && annual_wage <= (player.wage as f64 * 1.05).round() as u32;

    let (tension, patience) = wage_negotiation_metrics(round, stalled, respected_signal);

    let destination_team = game
        .teams
        .iter()
        .find(|t| t.id.as_str() == destination_team_id.as_str())
        .ok_or("Destination team not found")?;

    if score >= 50 {
        let current_annual_wage_bill = calc_annual_wages(game, &destination_team_id);
        let projected_annual_wage_bill = current_annual_wage_bill + annual_wage as i64;
        let can_afford = projected_annual_wage_bill <= destination_team.wage_budget;

        if let Some(p) = game.players.iter_mut().find(|p| p.id == player_id)
            && let Some(o) = p.transfer_offers.iter_mut().find(|o| o.id == offer_id)
        {
            o.wage_negotiation_status = WageNegotiationStatus::Agreed;
            o.contract_years_offered = contract_years;
            o.wage_offered = annual_wage;
            o.date = date.clone();
        }

        complete_transfer_with_wage(
            game,
            player_id,
            &destination_team_id,
            &payer_team_id,
            player_team_id.as_deref(),
            offer_fee,
            annual_wage,
            contract_years,
            &date,
        )?;

        let (headline, detail) = if can_afford {
            (
                "transfers.wageFeedbackAcceptedHeadline",
                "transfers.wageFeedbackAcceptedDetail",
            )
        } else {
            (
                "transfers.wageFeedbackAcceptedOverBudgetHeadline",
                "transfers.wageFeedbackAcceptedOverBudgetDetail",
            )
        };

        return Ok(WageNegotiationOutcome {
            decision: TransferNegotiationDecision::Accepted,
            suggested_wage: None,
            suggested_years: None,
            is_terminal: true,
            feedback: build_wage_feedback(
                headline,
                detail,
                NegotiationMood::Positive,
                tension.saturating_sub(10),
                patience.saturating_add(10).min(92),
                round,
                &[("wage", annual_wage.to_string())],
            ),
        });
    }

    if round >= 4 && score < 40 {
        if let Some(p) = game.players.iter_mut().find(|p| p.id == player_id)
            && let Some(o) = p.transfer_offers.iter_mut().find(|o| o.id == offer_id)
        {
            o.wage_negotiation_status = WageNegotiationStatus::Rejected;
            o.date = date;
        }

        return Ok(WageNegotiationOutcome {
            decision: TransferNegotiationDecision::Rejected,
            suggested_wage: None,
            suggested_years: None,
            is_terminal: true,
            feedback: build_wage_feedback(
                "transfers.wageFeedbackRejectedHeadline",
                "transfers.wageFeedbackRejectedDetail",
                NegotiationMood::Guarded,
                tension.saturating_add(12).min(92),
                patience.saturating_sub(16),
                round,
                &[],
            ),
        });
    }

    if score >= 25 {
        // Contract length premium: longer deals demand higher wages
        let years_premium = match contract_years {
            1 => -0.05, // Short deal: willing to take 5% less
            2 => 0.0,   // Neutral
            3 => 0.05,  // Longer: wants 5% more
            _ => 0.10,  // Long-term: wants 10% more
        };

        // Counter-offer: player wants ~10-25% more than offered, depending on score
        let wage_gap = if annual_wage > 0 {
            (50 - score) as f64 / 100.0 * 0.2 + 0.1 + years_premium
        } else {
            0.20 + years_premium
        };
        let mut suggested_wage = ((annual_wage as f64) * (1.0 + wage_gap)).round() as u32;

        // Never suggest less than what the user offered + 5%
        let min_over_offer = (annual_wage as f64 * 1.05).round() as u32;
        suggested_wage = suggested_wage.max(min_over_offer);

        // Never suggest less than player's current wage + 10%
        let min_acceptable = (player.wage as f64 * 1.1).round() as u32;
        suggested_wage = suggested_wage.max(min_acceptable);

        let suggested_years = if contract_years < 3 {
            (contract_years + 1).min(5)
        } else {
            contract_years
        };

        if let Some(p) = game.players.iter_mut().find(|p| p.id == player_id)
            && let Some(o) = p.transfer_offers.iter_mut().find(|o| o.id == offer_id)
        {
            o.suggested_counter_wage = Some(suggested_wage);
            o.suggested_counter_years = Some(suggested_years);
            o.date = date.clone();
            o.wage_negotiation_round = round;
        }

        return Ok(WageNegotiationOutcome {
            decision: TransferNegotiationDecision::CounterOffer,
            suggested_wage: Some(suggested_wage),
            suggested_years: Some(suggested_years),
            is_terminal: false,
            feedback: build_wage_feedback(
                "transfers.wageFeedbackCounterHeadline",
                "transfers.wageFeedbackCounterDetail",
                NegotiationMood::Firm,
                if score >= 35 {
                    tension.saturating_sub(6)
                } else {
                    tension.saturating_add(6).min(90)
                },
                if score >= 35 {
                    patience.saturating_add(4).min(90)
                } else {
                    patience.saturating_sub(4)
                },
                round,
                &[
                    ("wage", suggested_wage.to_string()),
                    ("years", suggested_years.to_string()),
                ],
            ),
        });
    }

    // Low score: player demands significantly more, adjusted by contract length
    let suggested_wage = {
        let years_premium = match contract_years {
            1 => 1.15, // Short deal: willing to accept 15% increase
            2 => 1.25, // Neutral: 25% increase
            3 => 1.35, // Longer: wants 35% increase
            _ => 1.45, // Long-term: wants 45% increase
        };
        let base = ((annual_wage as f64) * years_premium).round() as u32;
        let min_over_offer = (annual_wage as f64 * 1.05).round() as u32;
        let min_acceptable = (player.wage as f64 * 1.1).round() as u32;
        base.max(min_over_offer).max(min_acceptable)
    };
    if let Some(p) = game.players.iter_mut().find(|p| p.id == player_id)
        && let Some(o) = p.transfer_offers.iter_mut().find(|o| o.id == offer_id)
    {
        o.suggested_counter_wage = Some(suggested_wage);
        o.suggested_counter_years = Some(contract_years);
        o.date = date.clone();
        o.wage_negotiation_round = round;
    }

    Ok(WageNegotiationOutcome {
        decision: TransferNegotiationDecision::CounterOffer,
        suggested_wage: Some(suggested_wage),
        suggested_years: Some(contract_years),
        is_terminal: false,
        feedback: build_wage_feedback(
            "transfers.wageFeedbackLowHeadline",
            "transfers.wageFeedbackLowDetail",
            NegotiationMood::Tense,
            tension.saturating_add(10).min(92),
            patience.saturating_sub(10),
            round,
            &[("wage", suggested_wage.to_string())],
        ),
    })
}

#[allow(clippy::too_many_arguments)] // params struct would be an out-of-scope signature refactor
fn complete_transfer_with_wage(
    game: &mut Game,
    player_id: &str,
    to_team_id: &str,
    payer_team_id: &str,
    from_team_id: Option<&str>,
    fee: u64,
    annual_wage: u32,
    contract_years: u8,
    date: &str,
) -> Result<(), String> {
    let player_snapshot = game
        .players
        .iter()
        .find(|p| p.id == player_id)
        .cloned()
        .ok_or("Player not found")?;
    let from_id = from_team_id.unwrap_or("");
    let from_team_name = game
        .teams
        .iter()
        .find(|team| team.id == from_id)
        .map(|team| team.name.clone())
        .unwrap_or_else(|| from_id.to_string());
    let to_team_name = game
        .teams
        .iter()
        .find(|team| team.id == to_team_id)
        .map(|team| team.name.clone())
        .unwrap_or_else(|| to_team_id.to_string());
    let academy_owner_id = game
        .teams
        .iter()
        .find(|team| team.id == from_id && team.team_kind == TeamKind::Academy)
        .and_then(|team| team.parent_team_id.clone());
    let selling_team_is_academy = game
        .teams
        .iter()
        .find(|team| team.id == from_id)
        .map(|team| team.team_kind == TeamKind::Academy)
        .unwrap_or(false);

    let current_date = game.clock.current_date.date_naive();
    let renewal_year = current_date.year() + contract_years as i32;
    let contract_end = format!("{}-11-30", renewal_year);

    if let Some(p) = game.players.iter_mut().find(|p| p.id == player_id) {
        p.team_id = Some(to_team_id.to_string());
        p.wage = annual_wage;
        p.contract_end = Some(contract_end);
        p.transfer_listed = false;
        p.loan_listed = false;
        p.transfer_offers
            .retain(|o| o.status == TransferOfferStatus::Accepted);
    }

    if let Some(t) = game.teams.iter_mut().find(|t| t.id == payer_team_id) {
        record_transaction(
            t,
            FinanceTransactionInput {
                date: date.to_string(),
                description: format!("Transfer purchase fee for {player_id}"),
                amount: -(fee as i64),
                kind: FinancialTransactionKind::TransferPurchase,
                budget_impact: BudgetImpact::Transfer(-(fee as i64)),
                affects_season_totals: false,
                source: "transfer".to_string(),
                source_id: Some(player_id.to_string()),
                correlation_id: Some(format!(
                    "transfer:{payer_team_id}:{player_id}:{date}:purchase"
                )),
            },
        )
        .ok();
    }

    if !from_id.is_empty() {
        if let Some(t) = game.teams.iter_mut().find(|t| t.id == from_id)
            && let Some(pos) = t.active_lineup_ids.iter().position(|id| id == player_id) {
                t.active_lineup_ids.remove(pos);
            }

        let credit_target_id = academy_owner_id.as_deref().unwrap_or(from_id);
        if let Some(t) = game.teams.iter_mut().find(|t| t.id == credit_target_id) {
            record_transaction(
                t,
                FinanceTransactionInput {
                    date: date.to_string(),
                    description: format!("Transfer sale fee for {player_id}"),
                    amount: fee as i64,
                    kind: FinancialTransactionKind::TransferSale,
                    budget_impact: BudgetImpact::Transfer(
                        (fee as i64 * TRANSFER_BUDGET_SELLING_REALLOCATION_PCT) / 100,
                    ),
                    affects_season_totals: false,
                    source: "transfer".to_string(),
                    source_id: Some(player_id.to_string()),
                    correlation_id: Some(format!(
                        "transfer:{credit_target_id}:{player_id}:{date}:sale"
                    )),
                },
            )
            .ok();
        }
    }

    if selling_team_is_academy {
        ensure_academy_roster_continuity(game, from_id, &player_snapshot);
    }

    if let Some(t) = game.teams.iter_mut().find(|t| t.id == to_team_id)
        && let Some(pos) = t.active_lineup_ids.iter().position(|id| id == player_id) {
            t.active_lineup_ids.remove(pos);
        }

    let offer = player_snapshot
        .transfer_offers
        .iter()
        .find(|o| o.status == TransferOfferStatus::Accepted)
        .cloned();

    if let Some(ref offer) = offer {
        let seller_team = from_team_id.unwrap_or("");
        for item in &offer.players_included {
            execute_transfer(game, &item.player_id, seller_team, payer_team_id, 0, false)?;
        }
    }

    let player_name = player_snapshot.match_name.clone();
    let msg = crate::messages::transfer_complete_message(&player_name, fee, date);
    game.messages.push(msg);

    let user_team_id = game.manager.team_id.clone().unwrap_or_default();
    let is_user_involved = from_id == user_team_id || to_team_id == user_team_id;
    let is_user_buying = to_team_id == user_team_id;

    if should_generate_major_transfer_news(&player_snapshot, fee) {
        let article_id = format!(
            "transfer_news_{}_{}_{}_{}",
            player_id, from_id, to_team_id, date
        );
        if !game.news.iter().any(|article| article.id == article_id) {
            game.news.push(crate::news::major_transfer_article(
                &article_id,
                player_id,
                &player_snapshot.match_name,
                from_id,
                &from_team_name,
                to_team_id,
                &to_team_name,
                fee,
                date,
            ));
        }
    }
    let (initial_fee, neg_rounds, included_ids) = if let Some(ref o) = offer {
        (
            if o.fee > 0 && o.fee != fee {
                Some(o.fee)
            } else {
                None
            },
            o.negotiation_round,
            o.players_included
                .iter()
                .map(|p| p.player_id.clone())
                .collect::<Vec<_>>(),
        )
    } else {
        (None, 1, Vec::new())
    };

    record_transfer(
        game,
        player_id,
        from_id,
        to_team_id,
        fee,
        annual_wage,
        contract_years,
        is_user_involved,
        is_user_buying,
        true,
        initial_fee,
        neg_rounds,
        &included_ids,
        None,
    );

    Ok(())
}

pub fn get_transfer_history(game: &Game) -> Vec<TransferHistoryEntry> {
    game.transfer_history.entries.clone()
}

#[allow(clippy::too_many_arguments)] // params struct would be an out-of-scope signature refactor
pub fn record_transfer(
    game: &mut Game,
    player_id: &str,
    from_team_id: &str,
    to_team_id: &str,
    fee: u64,
    annual_wage: u32,
    contract_years: u8,
    is_user_involved: bool,
    is_user_buying: bool,
    was_negotiated: bool,
    initial_offer_fee: Option<u64>,
    negotiation_rounds: u8,
    included_player_ids: &[String],
    intent: Option<&str>,
) {
    let player = match game.players.iter().find(|p| p.id == player_id) {
        Some(p) => p,
        None => return,
    };
    let from_team = game
        .teams
        .iter()
        .find(|t| t.id == from_team_id)
        .map(|t| t.name.clone())
        .unwrap_or_else(|| from_team_id.to_string());
    let to_team = game
        .teams
        .iter()
        .find(|t| t.id == to_team_id)
        .map(|t| t.name.clone())
        .unwrap_or_else(|| to_team_id.to_string());
    let today = game.clock.current_date.format("%Y-%m-%d").to_string();

    let a = &player.attributes;
    let ovr = a.overall() as u32;

    let included_players: Vec<IncludedPlayerEntry> = included_player_ids
        .iter()
        .filter_map(|pid| {
            let p = game.players.iter().find(|p| p.id == pid.as_str())?;
            let a = &p.attributes;
            let ovr = a.overall() as u32;
            Some(IncludedPlayerEntry {
                player_id: p.id.clone(),
                player_name: p.match_name.clone(),
                player_ovr: ovr as u8,
                player_position: lol_role_to_string(&p.natural_position).to_string(),
                player_profile_image_url: p.profile_image_url.clone(),
                valuation: 0,
            })
        })
        .collect();

    let entry = TransferHistoryEntry {
        id: Uuid::new_v4().to_string(),
        player_id: player.id.clone(),
        player_name: player.match_name.clone(),
        player_ovr: ovr as u8,
        player_position: lol_role_to_string(&player.natural_position).to_string(),
        player_profile_image_url: player.profile_image_url.clone(),
        from_team_id: from_team_id.to_string(),
        from_team_name: from_team,
        to_team_id: to_team_id.to_string(),
        to_team_name: to_team,
        fee,
        annual_wage,
        contract_years,
        date: today,
        is_user_involved,
        is_user_buying,
        was_negotiated,
        initial_offer_fee,
        negotiation_rounds,
        included_players,
        intent: intent.map(str::to_string),
    };

    game.moved_player_ids.insert(entry.player_id.clone());
    game.moved_player_ids.extend(
        entry
            .included_players
            .iter()
            .map(|included| included.player_id.clone()),
    );
    game.transfer_history.entries.insert(0, entry);
    if game.transfer_history.entries.len() > 200 {
        game.transfer_history.entries.truncate(200);
    }
}

fn round_transfer_fee(value: u64) -> u64 {
    if value == 0 {
        return 0;
    }

    value.div_ceil(50_000) * 50_000
}

fn remove_player_from_team_references(team: &mut crate::domain::team::Team, player_id: &str) {
    clear_player_from_active_lineup(team, player_id);

    for group in &mut team.training_groups {
        group.player_ids.retain(|id| id != player_id);
    }

    if team.team_roles.captain.as_deref() == Some(player_id) {
        team.team_roles.captain = None;
    }
    if team.team_roles.shotcaller.as_deref() == Some(player_id) {
        team.team_roles.shotcaller = None;
    }
}

fn clear_player_from_active_lineup(team: &mut crate::domain::team::Team, player_id: &str) {
    for lineup_id in &mut team.active_lineup_ids {
        if lineup_id == player_id {
            lineup_id.clear();
        }
    }
}

fn reconcile_lol_active_lineup(
    team: &mut crate::domain::team::Team,
    players: &[crate::domain::player::Player],
) {
    const ROLES: [LolRole; 5] = [
        LolRole::Top,
        LolRole::Jungle,
        LolRole::Mid,
        LolRole::Adc,
        LolRole::Support,
    ];

    let saved_ids = team.active_lineup_ids.clone();
    let mut next_ids = vec![String::new(); ROLES.len()];
    let mut used: HashSet<String> = HashSet::new();

    for (index, role) in ROLES.iter().enumerate() {
        if let Some(player) = saved_ids
            .get(index)
            .and_then(|id| current_team_player_by_id(players, &team.id, id))
            .filter(|player| !used.contains(&player.id) && player.natural_position == *role)
        {
            next_ids[index] = player.id.clone();
            used.insert(player.id.clone());
            continue;
        }

        if let Some(player) = saved_ids
            .iter()
            .filter_map(|id| current_team_player_by_id(players, &team.id, id))
            .find(|player| !used.contains(&player.id) && player.natural_position == *role)
        {
            next_ids[index] = player.id.clone();
            used.insert(player.id.clone());
            continue;
        }

        if let Some(player) = players
            .iter()
            .filter(|player| player.team_id.as_deref() == Some(team.id.as_str()))
            .filter(|player| !used.contains(&player.id) && player.natural_position == *role)
            .max_by_key(|player| player.market_value)
        {
            next_ids[index] = player.id.clone();
            used.insert(player.id.clone());
        }
    }

    team.active_lineup_ids = next_ids.into_iter().filter(|id| !id.is_empty()).collect();
}

fn current_team_player_by_id<'a>(
    players: &'a [crate::domain::player::Player],
    team_id: &str,
    player_id: &str,
) -> Option<&'a crate::domain::player::Player> {
    if player_id.is_empty() {
        return None;
    }

    players
        .iter()
        .find(|player| player.id == player_id && player.team_id.as_deref() == Some(team_id))
}

fn remaining_contract_salary(
    player: &crate::domain::player::Player,
    current_date: NaiveDate,
) -> i64 {
    let days_remaining =
        contract_days_remaining(current_date, player.contract_end.as_deref()).unwrap_or(0);

    let bounded_days = days_remaining.max(0);
    if bounded_days == 0 {
        return 0;
    }

    ((i64::from(player.wage) * bounded_days) + 364) / 365
}

fn release_penalty_amount(player: &crate::domain::player::Player, current_date: NaiveDate) -> i64 {
    let remaining_salary = remaining_contract_salary(player, current_date);
    if remaining_salary <= 0 {
        return 0;
    }

    (remaining_salary * CONTRACT_RELEASE_PENALTY_PCT + 99) / 100
}

fn player_accepts_transfer(
    current_date: NaiveDate,
    player: &crate::domain::player::Player,
    owner_team: &crate::domain::team::Team,
    buyer_team: &crate::domain::team::Team,
) -> bool {
    let openness = player_move_openness_score(current_date, player, owner_team, buyer_team);
    let reputation_gap = buyer_team.reputation as i32 - owner_team.reputation as i32;
    let days_remaining =
        contract_days_remaining(current_date, player.contract_end.as_deref()).unwrap_or(365);

    let mut acceptance_score = openness;
    if reputation_gap >= 0 {
        acceptance_score += 12;
    } else if reputation_gap <= -75 {
        acceptance_score -= 18;
    }

    if days_remaining <= 180 {
        acceptance_score += 10;
    } else if days_remaining <= 365 {
        acceptance_score += 6;
    }

    if player.morale >= 80 {
        acceptance_score -= 8;
    }

    acceptance_score >= 22
}

pub fn release_player_contract(game: &mut Game, player_id: &str) -> Result<i64, String> {
    if !transfer_window_is_open(game) {
        return Err("Transfer window is closed".to_string());
    }

    let user_team_id = game
        .manager
        .team_id
        .clone()
        .ok_or_else(|| "No user team".to_string())?;

    let mut managed_team_ids = std::collections::HashSet::new();
    managed_team_ids.insert(user_team_id.clone());
    for team in &game.teams {
        if team.team_kind == TeamKind::Academy {
            managed_team_ids.insert(team.id.clone());
        }
    }

    let current_date = game.clock.current_date.date_naive();
    let today = game.clock.current_date.format("%Y-%m-%d").to_string();

    let (owning_team_id, player_name, penalty) = {
        let player = game
            .players
            .iter()
            .find(|player| player.id == player_id)
            .ok_or_else(|| "Player not found".to_string())?;

        let owning_team_id = player
            .team_id
            .clone()
            .ok_or_else(|| "Player is already a free agent".to_string())?;

        if !managed_team_ids.contains(&owning_team_id) {
            return Err("Player not found or not yours".to_string());
        }

        // Academy players (youth intake) may have no contract_end — skip guard.
        let is_academy = game
            .teams
            .iter()
            .any(|t| t.id == owning_team_id && t.team_kind == TeamKind::Academy);

        if !is_academy && player.contract_end.is_none() {
            return Err("Player has no active contract".to_string());
        }

        (
            owning_team_id,
            player.match_name.clone(),
            release_penalty_amount(player, current_date),
        )
    };

    let team = game
        .teams
        .iter_mut()
        .find(|team| team.id == owning_team_id)
        .ok_or_else(|| "Owning team not found".to_string())?;

    if penalty > 0 {
        if team.finance < penalty {
            return Err(format!(
                "Insufficient funds for contract termination: need €{}",
                penalty
            ));
        }

        record_transaction(
            team,
            FinanceTransactionInput {
                date: today.clone(),
                description: format!("Contract termination penalty for {player_name}"),
                amount: -penalty,
                kind: FinancialTransactionKind::ReleasePenalty,
                budget_impact: BudgetImpact::None,
                affects_season_totals: true,
                source: "transfer".to_string(),
                source_id: Some(player_id.to_string()),
                correlation_id: Some(format!("release:{owning_team_id}:{player_id}:{today}")),
            },
        )
        .map_err(|err| format!("Failed to record release penalty: {err:?}"))?;
    }
    remove_player_from_team_references(team, player_id);

    if let Some(player) = game
        .players
        .iter_mut()
        .find(|player| player.id == player_id)
    {
        player.team_id = None;
        player.contract_end = None;
        player.wage = 0;
        player.was_released = true;
        player.transfer_listed = false;
        player.loan_listed = false;
        game.moved_player_ids.insert(player_id.to_string());
        player.transfer_offers.clear();
    }

    let message = crate::messages::with_sender(
        crate::domain::message::InboxMessage::new(
            format!("contract_terminated_{}", player_id),
            format!("Contract terminated: {}", player_name),
            format!(
                "You terminated {}'s contract. The player is now a free agent. Termination cost: €{}.",
                player_name, penalty
            ),
            "Director of Football".to_string(),
            today,
        )
        .with_category(crate::domain::message::MessageCategory::Contract)
        .with_priority(crate::domain::message::MessagePriority::High),
        "director_of_football",
        vec![("player", &player_name)],
    );
    game.messages.push(message);

    Ok(penalty)
}

pub(crate) fn lol_role_to_string(role: &LolRole) -> &'static str {
    match role {
        LolRole::Top => "TOP",
        LolRole::Jungle => "JUNGLE",
        LolRole::Mid => "MID",
        LolRole::Adc => "ADC",
        LolRole::Support => "SUPPORT",
        LolRole::Unknown => "UNKNOWN",
    }
}

fn string_to_lol_role(role: &str) -> LolRole {
    match role {
        "TOP" => LolRole::Top,
        "JUNGLE" => LolRole::Jungle,
        "MID" => LolRole::Mid,
        "ADC" => LolRole::Adc,
        "SUPPORT" => LolRole::Support,
        _ => LolRole::Unknown,
    }
}

fn academy_role_count(game: &Game, academy_team_id: &str, role: &str) -> usize {
    game.players
        .iter()
        .filter(|player| player.team_id.as_deref() == Some(academy_team_id))
        .filter(|player| lol_role_to_string(&player.natural_position) == role)
        .count()
}

fn try_assign_free_agent_by_role(game: &mut Game, academy_team_id: &str, role: &str) -> bool {
    let candidate_id = game
        .players
        .iter()
        .filter(|player| player.team_id.is_none())
        .filter(|player| lol_role_to_string(&player.natural_position) == role)
        .max_by_key(|player| player.market_value)
        .map(|player| player.id.clone());

    let Some(candidate_id) = candidate_id else {
        return false;
    };

    if let Some(player) = game
        .players
        .iter_mut()
        .find(|player| player.id == candidate_id)
    {
        player.team_id = Some(academy_team_id.to_string());
        player.transfer_listed = false;
        player.loan_listed = false;
        if player.contract_end.is_none() {
            player.contract_end = Some(format!("{}-11-30", game.clock.current_date.year() + 2));
        }
        return true;
    }

    false
}

fn spawn_academy_replacement(
    game: &mut Game,
    academy_team_id: &str,
    template: &crate::domain::player::Player,
    role: &str,
) {
    let replacement_id = format!("academy-replacement-{}-{}", academy_team_id, Uuid::new_v4());
    let match_name = format!("{} Prospect", role);
    let mut replacement = crate::domain::player::Player::new(
        replacement_id,
        match_name.clone(),
        match_name,
        "2006-01-01".to_string(),
        template.nationality.clone(),
        string_to_lol_role(role),
        template.attributes.clone(),
    );
    replacement.team_id = Some(academy_team_id.to_string());
    replacement.contract_end = Some(format!("{}-11-30", game.clock.current_date.year() + 2));
    replacement.wage = template.wage.max(6_000) / 2;
    replacement.market_value = template.market_value.max(120_000) / 2;
    replacement.morale = 62;
    replacement.condition = 100;
    replacement.potential_base = template.potential_base;
    game.players.push(replacement);
}

fn ensure_academy_roster_continuity(
    game: &mut Game,
    academy_team_id: &str,
    template: &crate::domain::player::Player,
) {
    let required_roles = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"];

    for _ in 0..8 {
        let roster_size = game
            .players
            .iter()
            .filter(|player| player.team_id.as_deref() == Some(academy_team_id))
            .count();
        let missing_role = required_roles
            .iter()
            .copied()
            .find(|role| academy_role_count(game, academy_team_id, role) == 0);

        if roster_size >= 5 && missing_role.is_none() {
            break;
        }

        let target_role =
            missing_role.unwrap_or_else(|| lol_role_to_string(&template.natural_position));
        if !try_assign_free_agent_by_role(game, academy_team_id, target_role) {
            spawn_academy_replacement(game, academy_team_id, template, target_role);
        }
    }
}

fn build_transfer_feedback(
    headline_key: &str,
    detail_key: &str,
    mood: NegotiationMood,
    tension: u8,
    patience: u8,
    round: u8,
    params: &[(&str, String)],
) -> NegotiationFeedback {
    NegotiationFeedback {
        mood,
        headline_key: headline_key.to_string(),
        detail_key: Some(detail_key.to_string()),
        tension,
        patience,
        round,
        params: params
            .iter()
            .map(|(key, value)| ((*key).to_string(), value.clone()))
            .collect(),
    }
}

/// Transfer a player between teams, adjusting finances.
pub(crate) fn execute_transfer(
    game: &mut Game,
    player_id: &str,
    to_team_id: &str,
    from_team_id: &str,
    fee: u64,
    record_history: bool,
) -> Result<(), String> {
    let contract_years = ai_random_contract_years();
    execute_transfer_with_payer(
        game,
        player_id,
        to_team_id,
        from_team_id,
        fee,
        to_team_id,
        record_history,
        contract_years,
    )
}

#[allow(clippy::too_many_arguments)] // params struct would be an out-of-scope signature refactor
fn execute_transfer_with_payer(
    game: &mut Game,
    player_id: &str,
    to_team_id: &str,
    from_team_id: &str,
    fee: u64,
    payer_team_id: &str,
    record_history: bool,
    transfer_contract_years: u8,
) -> Result<(), String> {
    let player_snapshot = game
        .players
        .iter()
        .find(|player| player.id == player_id)
        .cloned()
        .ok_or("Player not found")?;
    let from_team_name = game
        .teams
        .iter()
        .find(|team| team.id == from_team_id)
        .map(|team| team.name.clone())
        .unwrap_or_else(|| from_team_id.to_string());
    let to_team_name = game
        .teams
        .iter()
        .find(|team| team.id == to_team_id)
        .map(|team| team.name.clone())
        .unwrap_or_else(|| to_team_id.to_string());
    let today = game.clock.current_date.format("%Y-%m-%d").to_string();
    let selling_team_is_academy = game
        .teams
        .iter()
        .find(|team| team.id == from_team_id)
        .map(|team| team.team_kind == TeamKind::Academy)
        .unwrap_or(false);
    let departing_starter_ids: Vec<String> = game
        .teams
        .iter()
        .find(|team| team.id == from_team_id)
        .filter(|team| team.active_lineup_ids.iter().any(|id| id == player_id))
        .map(|team| {
            team.active_lineup_ids
                .iter()
                .filter(|id| id.as_str() != player_id)
                .cloned()
                .collect()
        })
        .unwrap_or_default();

    let next_split_date = next_split_end_date(game);
    let current_date = game.clock.current_date.date_naive();
    let contract_years = transfer_contract_years.max(1);
    let annual_wage = game
        .teams
        .iter()
        .find(|team| team.id == to_team_id)
        .map(|to_team| expected_wage(&player_snapshot, to_team, current_date))
        .unwrap_or(player_snapshot.wage);

    // Move player
    if let Some(p) = game.players.iter_mut().find(|p| p.id == player_id) {
        p.team_id = Some(to_team_id.to_string());
        p.transfer_listed = false;
        p.loan_listed = false;
        p.can_be_transferred_until = Some(next_split_date);
        p.contract_end = Some(contract_end_for_years(current_date, contract_years));
        p.wage = annual_wage;
    }

    if !departing_starter_ids.is_empty() {
        for player in &mut game.players {
            if player.team_id.as_deref() == Some(from_team_id)
                && departing_starter_ids.iter().any(|id| id == &player.id)
            {
                player.morale = (i16::from(player.morale) - 4).clamp(0, 100) as u8;
            }
        }
    }

    // Debit the paying club; user academy signings are funded by the parent club.
    if let Some(t) = game.teams.iter_mut().find(|t| t.id == payer_team_id) {
        record_transaction(
            t,
            FinanceTransactionInput {
                date: today.clone(),
                description: format!("Transfer purchase fee for {}", player_snapshot.match_name),
                amount: -(fee as i64),
                kind: FinancialTransactionKind::TransferPurchase,
                budget_impact: BudgetImpact::Transfer(-(fee as i64)),
                affects_season_totals: false,
                source: "transfer".to_string(),
                source_id: Some(player_id.to_string()),
                correlation_id: Some(format!(
                    "transfer:{payer_team_id}:{player_id}:{today}:purchase"
                )),
            },
        )
        .ok();
    }

    let players_snapshot = game.players.clone();
    if let Some(t) = game.teams.iter_mut().find(|t| t.id == to_team_id) {
        clear_player_from_active_lineup(t, player_id);
        reconcile_lol_active_lineup(t, &players_snapshot);
    }

    let academy_owner_id = game
        .teams
        .iter()
        .find(|team| team.id == from_team_id && team.team_kind == TeamKind::Academy)
        .and_then(|team| team.parent_team_id.clone());

    // Credit selling team or academy owner
    let credit_target_id = academy_owner_id.as_deref().unwrap_or(from_team_id);
    if let Some(t) = game.teams.iter_mut().find(|t| t.id == credit_target_id) {
        record_transaction(
            t,
            FinanceTransactionInput {
                date: today.clone(),
                description: format!("Transfer sale fee for {}", player_snapshot.match_name),
                amount: fee as i64,
                kind: FinancialTransactionKind::TransferSale,
                budget_impact: BudgetImpact::Transfer(
                    (fee as i64 * TRANSFER_BUDGET_SELLING_REALLOCATION_PCT) / 100,
                ),
                affects_season_totals: false,
                source: "transfer".to_string(),
                source_id: Some(player_id.to_string()),
                correlation_id: Some(format!(
                    "transfer:{credit_target_id}:{player_id}:{today}:sale"
                )),
            },
        )
        .ok();
    }

    if selling_team_is_academy {
        ensure_academy_roster_continuity(game, from_team_id, &player_snapshot);
    }

    let players_snapshot = game.players.clone();
    if let Some(t) = game.teams.iter_mut().find(|t| t.id == from_team_id) {
        clear_player_from_active_lineup(t, player_id);
        reconcile_lol_active_lineup(t, &players_snapshot);
    }

    // After transfer-out, repair non-player AI selling teams whose roster may
    // have fallen below the match-eligibility threshold. Academy teams are
    // skipped internally by is_schedulable_ai_main_team.
    let _ = repair_team(game, from_team_id, RosterStabilityReason::TransferOut);

    if should_generate_major_transfer_news(&player_snapshot, fee) {
        let article_id = format!(
            "transfer_news_{}_{}_{}_{}",
            player_id, from_team_id, to_team_id, today
        );
        if !game.news.iter().any(|article| article.id == article_id) {
            game.news.push(crate::news::major_transfer_article(
                &article_id,
                player_id,
                &player_snapshot.match_name,
                from_team_id,
                &from_team_name,
                to_team_id,
                &to_team_name,
                fee,
                &today,
            ));
        }
    }

    let user_team_id = game.manager.team_id.clone().unwrap_or_default();
    let is_user_involved = from_team_id == user_team_id || to_team_id == user_team_id;
    let is_user_buying = to_team_id == user_team_id;

    if record_history {
        record_transfer(
            game,
            player_id,
            from_team_id,
            to_team_id,
            fee,
            annual_wage,
            contract_years,
            is_user_involved,
            is_user_buying,
            false,
            None,
            0,
            &[],
            None,
        );
    }

    Ok(())
}

fn contract_end_for_years(current_date: NaiveDate, contract_years: u8) -> String {
    if let Some(new_date) =
        current_date.checked_add_months(chrono::Months::new(contract_years.max(1) as u32 * 12))
    {
        return format!("{}-11-30", new_date.year());
    }

    format!(
        "{}-11-30",
        current_date.year() + i32::from(contract_years.max(1))
    )
}
