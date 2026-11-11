//! Promotion and relegation between linked leagues.
//!
//! [`apply_ladders`] reads the [`ladder`](crate::ladder) ledger and swaps club
//! membership between a lower league and the league above it (a
//! [`PromotionLink`] declared on the lower league). It runs at the tail of every
//! rollover, so it works whichever league finishes last and whether the user sits
//! in the upper league, the lower league or a third one.
//!
//! What a swap changes: `Team::competition_id` of the moved clubs, the standings and
//! next-season calendar of both leagues, and `Game::user_competition_id` when the
//! user's club moves. Team ids never change, so players, staff, history and saves stay
//! valid. The moved clubs are then repriced by [`crate::ladder_reprice`].
//!
//! Rules:
//! - Promotion order is the lower league's final order (champion, finalist, then the
//!   rest). Relegation takes the worst teams of the upper league's summed
//!   regular-season table. Both come from the ledger, never from
//!   `TeamSeasonRecord::league_position`.
//! - A lower-league club is ineligible while its parent organisation is in the upper
//!   league (declared feeders, `parent_team_id`, academy kind). Custom clubs are
//!   always eligible. The next eligible club goes up instead. Eligibility is judged
//!   against the upper league before the swap, so a feeder is still blocked when its
//!   parent is relegated in the same swap.
//! - The swap waits until both leagues have an outcome for the finished season and
//!   both already rolled into the next one. It is idempotent per (link, season).
//! - If the next season of either league has started, or its calendar would begin on
//!   or before the clock date, nothing moves and [`LadderMovementStatus::SkippedLate`]
//!   is recorded.
//!
//! # Tier assumptions audit
//!
//! Places that assume a club stays in one league, checked against a club that moves.
//!
//! | Site | Assumption | Result |
//! | --- | --- | --- |
//! | `ai_team_agent` (strategic recruitment) and `contract_wage_policy::ai_team_tier` | Tier comes from the league of `Team::competition_id` | Holds: the swap rewrites `competition_id` and the rebuilt league keeps its tier. A relegated club stops strategic recruitment, a promoted one starts (tested) |
//! | `academy` catalog (tier <= 1 skipped) | Reads manifests from disk at world build | Unaffected: static, never re-run after a swap |
//! | `roster_stability::is_schedulable_ai_main_team` | Membership comes from league standings | Holds: standings are rebuilt, and `repair_league` runs after a swap |
//! | `board_objectives::active_league_teams` | Follows `Game::active_league` | Holds once `user_competition_id` moves; objectives are cleared when the user moves so they are regenerated for the new league |
//! | `squad` market views (`commands/squad.rs`) | Peers share the user team's `competition_id` | Holds: a moved user club sees its new league's clubs |
//! | `commands/game.rs` new-game setup | Derives the competition from the team id prefix | Unaffected: new games only. A loaded save keeps `user_competition_id`, and sanitising only re-derives it from the prefix when it is missing (tested through the load path) |
//! | `job_offers::check_job_offers` | Reputation-based, no tier | Unaffected |
//! | `job_offers::hire_manager` | Sets `user_competition_id` from the hired team's `competition_id` | Holds: the field is current after a swap |

use std::collections::{HashMap, HashSet};

use log::{info, warn};

use crate::domain::league::League;
use crate::domain::league::StandingEntry;
use crate::domain::team::{Team, TeamKind};
use crate::end_of_season::{build_split_league, season_has_started};
use crate::game::Game;
use crate::generator::definitions::{CompetitionManifest, PromotionLink};
use crate::ladder::{LadderMovement, LadderMovementStatus, worst_teams};
use crate::roster_stability::{RosterStabilityReason, repair_league};

/// Marker inside the id of a user-created club (`{competition}-custom-{slug}`).
const CUSTOM_CLUB_ID_MARKER: &str = "-custom-";

/// Apply every ladder link whose two leagues both closed the same season.
///
/// Links come from the manifests (a lower league carrying `promotion`), handled by
/// upper tier then id. Returns the movements recorded by this call; a link that is
/// not ready, or already handled, contributes nothing.
pub fn apply_ladders(
    game: &mut Game,
    manifests: &HashMap<String, CompetitionManifest>,
) -> Vec<LadderMovement> {
    let mut links: Vec<(&str, &PromotionLink)> = manifests
        .iter()
        .filter_map(|(id, manifest)| Some((id.as_str(), manifest.promotion.as_ref()?)))
        .collect();
    links.sort_by_key(|(lower_id, link)| {
        let upper_tier = manifests
            .get(&link.to)
            .and_then(|manifest| manifest.tier)
            .unwrap_or(0);
        (upper_tier, link.to.clone(), (*lower_id).to_string())
    });

    links
        .into_iter()
        .filter_map(|(lower_id, link)| apply_link(game, manifests, lower_id, link))
        .collect()
}

/// True for a club created by the user: it has a fresh id and is never a feeder.
fn is_custom_club(team: &Team) -> bool {
    team.id.contains(CUSTOM_CLUB_ID_MARKER)
}

/// Whether `team` may be promoted into a league whose members are `upper_members`.
fn is_eligible(team: &Team, link: &PromotionLink, upper_members: &HashSet<&str>) -> bool {
    if is_custom_club(team) {
        return true;
    }
    if team.team_kind != TeamKind::Main {
        return false;
    }
    if team
        .parent_team_id
        .as_deref()
        .is_some_and(|parent| upper_members.contains(parent))
    {
        return false;
    }
    !link
        .feeders
        .iter()
        .any(|feeder| feeder.team == team.id && upper_members.contains(feeder.parent.as_str()))
}

fn league_index(game: &Game, competition_id: &str) -> Option<usize> {
    game.leagues
        .iter()
        .position(|league| league.competition_id.as_deref() == Some(competition_id))
}

/// Newest season for which `competition_id` closed with an outcome.
fn latest_outcome_season(game: &Game, competition_id: &str) -> Option<u32> {
    game.ladder
        .outcomes
        .iter()
        .filter(|outcome| outcome.competition_id == competition_id)
        .map(|outcome| outcome.season)
        .max()
}

/// `members` with each `leaving[k]` replaced by `arriving[k]`, keeping positions.
fn swapped_members(members: &[String], leaving: &[String], arriving: &[String]) -> Vec<String> {
    members
        .iter()
        .map(|id| match leaving.iter().position(|l| l == id) {
            Some(slot) => arriving[slot].clone(),
            None => id.clone(),
        })
        .collect()
}

/// The league as it will start next season, entered by `member_ids`.
///
/// The league keeps its identity (name, tier, logo); the user's preseason friendlies
/// are added when the user's club is a member.
fn rebuilt_league(
    game: &Game,
    previous: &League,
    manifest: &CompetitionManifest,
    member_ids: &[String],
) -> League {
    let template = League {
        fixtures: Vec::new(),
        standings: member_ids.iter().cloned().map(StandingEntry::new).collect(),
        ..previous.clone()
    };
    let user_team_id = game
        .manager
        .team_id
        .as_deref()
        .filter(|id| member_ids.iter().any(|member| member == id));
    build_split_league(&template, manifest, previous.season, 0, user_team_id)
}

/// Earliest fixture date of `league`, or `None` for an empty calendar.
fn first_fixture_date(league: &League) -> Option<chrono::NaiveDate> {
    league
        .fixtures
        .iter()
        .filter_map(|fixture| chrono::NaiveDate::parse_from_str(&fixture.date, "%Y-%m-%d").ok())
        .min()
}

fn apply_link(
    game: &mut Game,
    manifests: &HashMap<String, CompetitionManifest>,
    lower_id: &str,
    link: &PromotionLink,
) -> Option<LadderMovement> {
    let upper_id = link.to.as_str();
    let season = latest_outcome_season(game, lower_id)?;
    let handled = game.ladder.movements.iter().any(|movement| {
        movement.link_lower == lower_id
            && movement.link_upper == upper_id
            && movement.season == season
    });
    if handled {
        return None;
    }
    let lower_outcome = game.ladder.outcome(lower_id, season)?;
    let upper_outcome = game.ladder.outcome(upper_id, season)?;
    let lower_order = lower_outcome.final_order.clone();
    let relegation_order = worst_teams(upper_outcome, usize::MAX);

    let lower_manifest = manifests.get(lower_id)?;
    let upper_manifest = manifests.get(upper_id)?;
    let lower_index = league_index(game, lower_id)?;
    let upper_index = league_index(game, upper_id)?;
    let next_season = season + 1;
    // Both leagues must already have rolled into the next season.
    if game.leagues[lower_index].season != next_season
        || game.leagues[upper_index].season != next_season
    {
        return None;
    }

    let lower_members: Vec<String> = game.leagues[lower_index]
        .standings
        .iter()
        .map(|entry| entry.team_id.clone())
        .collect();
    let upper_members: Vec<String> = game.leagues[upper_index]
        .standings
        .iter()
        .map(|entry| entry.team_id.clone())
        .collect();
    let upper_set: HashSet<&str> = upper_members.iter().map(String::as_str).collect();

    let slots = usize::from(link.slots);
    let promoted_candidates: Vec<String> = lower_order
        .iter()
        .filter(|id| lower_members.contains(id))
        .filter(|id| {
            game.teams
                .iter()
                .find(|team| &team.id == *id)
                .is_some_and(|team| is_eligible(team, link, &upper_set))
        })
        .take(slots)
        .cloned()
        .collect();
    let relegated_candidates: Vec<String> = relegation_order
        .into_iter()
        .filter(|id| upper_members.contains(id))
        .take(slots)
        .collect();
    let moving = promoted_candidates.len().min(relegated_candidates.len());
    let promoted = promoted_candidates[..moving].to_vec();
    let relegated = relegated_candidates[..moving].to_vec();

    let mut movement = LadderMovement {
        link_lower: lower_id.to_string(),
        link_upper: upper_id.to_string(),
        season,
        promoted: Vec::new(),
        relegated: Vec::new(),
        status: LadderMovementStatus::NoEligible,
    };
    if moving == 0 {
        game.ladder.record_movement(movement.clone());
        return Some(movement);
    }

    let new_lower = swapped_members(&lower_members, &promoted, &relegated);
    let new_upper = swapped_members(&upper_members, &relegated, &promoted);
    let lower_league = rebuilt_league(game, &game.leagues[lower_index], lower_manifest, &new_lower);
    let upper_league = rebuilt_league(game, &game.leagues[upper_index], upper_manifest, &new_upper);

    let today = game.clock.current_date.date_naive();
    let too_late = |old: &League, new: &League| {
        season_has_started(old) || first_fixture_date(new).is_some_and(|first| first <= today)
    };
    if too_late(&game.leagues[lower_index], &lower_league)
        || too_late(&game.leagues[upper_index], &upper_league)
    {
        info!("[ladder] {lower_id}->{upper_id} season {season}: next season too close, skipped");
        movement.status = LadderMovementStatus::SkippedLate;
        game.ladder.record_movement(movement.clone());
        return Some(movement);
    }

    game.leagues[lower_index] = lower_league;
    game.leagues[upper_index] = upper_league;
    for team in &mut game.teams {
        if promoted.contains(&team.id) {
            team.competition_id = Some(upper_id.to_string());
        } else if relegated.contains(&team.id) {
            team.competition_id = Some(lower_id.to_string());
        }
    }
    move_user_with_club(game, &promoted, &relegated, lower_id, upper_id);
    crate::ladder_reprice::reprice_moved_clubs(game, &promoted, &relegated, lower_id, upper_id);

    crate::residency::refresh_import_flags(game);
    crate::season_context::refresh_game_context(game);
    if let Err(error) = repair_league(game, RosterStabilityReason::SeasonTransition) {
        warn!("[ladder] {lower_id}->{upper_id} season {season}: roster repair failed: {error}");
    }

    info!("[ladder] {lower_id}->{upper_id} season {season}: {promoted:?} up, {relegated:?} down");
    movement.promoted = promoted;
    movement.relegated = relegated;
    movement.status = LadderMovementStatus::Applied;
    game.ladder.record_movement(movement.clone());
    Some(movement)
}

/// Point the user's active league at the new league of the user's club when it moved.
///
/// Board objectives were written for the old league, so they are dropped and
/// regenerated on the next day.
fn move_user_with_club(
    game: &mut Game,
    promoted: &[String],
    relegated: &[String],
    lower_id: &str,
    upper_id: &str,
) {
    let Some(user_team_id) = game.manager.team_id.as_deref() else {
        return;
    };
    let destination = if promoted.iter().any(|id| id == user_team_id) {
        upper_id
    } else if relegated.iter().any(|id| id == user_team_id) {
        lower_id
    } else {
        return;
    };
    game.user_competition_id = Some(destination.to_string());
    game.board_objectives.clear();
}
