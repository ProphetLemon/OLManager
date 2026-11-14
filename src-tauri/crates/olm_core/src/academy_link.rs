//! Real-club academies: funding an academy links a real tier-2 `Main` club of the
//! parent's region to the user's club instead of generating a copy of it.
//!
//! The linked club stays a `Main` club in its own league with its own money, tier
//! sponsor and wages; the link is two ids (`parent.academy_team_id` and
//! `club.parent_team_id`). The user moves players between the two clubs.
//!
//! Legacy gate: a world that already holds any `TeamKind::Academy` team keeps the
//! copy pool, the parallel academy league and everything else as it was
//! ([`world_has_academy_copies`]). The functions here serve only worlds without copies.

use std::collections::HashMap;

use crate::academy::{
    AcademyAcquisitionOption, AcademyAcquisitionReport, BLOCKED_NOT_TOP_LEAGUE,
    BLOCKED_NO_REGION_CANDIDATES, ErlAcademyCandidate, acquisition_cost_for_candidate,
    country_matches, push_academy_acquired_message, top_league_region,
};
use crate::custom_team::is_custom_team_id;
use crate::domain::league::{League, LeagueKind};
use crate::domain::message::{InboxMessage, MessageCategory, MessageContext, MessagePriority};
use crate::domain::team::{ErlAssignmentRule, FinancialTransactionKind, Team, TeamKind};
use crate::finances::{
    BudgetImpact, FinanceTransactionInput, LedgerText, record_transaction_with_text,
};
use crate::game::Game;

/// Tier a club must play in to be offered as an academy.
const LINKABLE_TIER: u8 = 2;
/// League reputation assumed when a manifest does not declare one.
const DEFAULT_LEAGUE_REPUTATION: u8 = 3;

/// True when the world holds any academy copy; it then stays on the legacy path.
pub fn world_has_academy_copies(game: &Game) -> bool {
    game.teams.iter().any(Team::is_academy)
}

/// Id of the real club linked to `parent_team_id`, if any.
pub fn linked_club_id(game: &Game, parent_team_id: &str) -> Option<String> {
    let parent = game.teams.iter().find(|team| team.id == parent_team_id)?;
    let club_id = parent.academy_team_id.as_deref()?;
    game.teams
        .iter()
        .find(|team| {
            team.id == club_id
                && team.team_kind == TeamKind::Main
                && team.parent_team_id.as_deref() == Some(parent_team_id)
        })
        .map(|team| team.id.clone())
}

/// Id of the real club linked to the user's club. The AI market treats it and its
/// players as the user's side: it never buys, sells or recruits for it, nor from it.
pub fn user_linked_club_id(game: &Game) -> Option<String> {
    linked_club_id(game, game.manager.team_id.as_deref()?)
}

/// Sum of the market values of the players rostered at `team_id`.
fn squad_market_value(game: &Game, team_id: &str) -> u64 {
    game.players
        .iter()
        .filter(|player| player.team_id.as_deref() == Some(team_id))
        .fold(0_u64, |total, player| total.saturating_add(player.market_value))
}

/// League reputation from the manifest and the development level derived from it,
/// the same pair the copy catalog derives for a seed.
fn league_ratings(game: &Game, competition_id: &str) -> (u8, u8) {
    let reputation = game
        .competition_configs
        .get(competition_id)
        .and_then(|manifest| manifest.reputation)
        .unwrap_or(DEFAULT_LEAGUE_REPUTATION);
    let development_level = match reputation {
        5 => 4,
        4 => 3,
        3 => 2,
        _ => 1,
    };
    (reputation, development_level)
}

/// Fee for linking `club`: the league formula, or the squad's full market value when
/// that is higher. A link gives call-up rights to the whole squad, so it never costs
/// less than buying it.
fn link_fee(game: &Game, club: &Team, formula: i64) -> i64 {
    let squad_value = squad_market_value(game, &club.id);
    formula.max(i64::try_from(squad_value).unwrap_or(i64::MAX))
}

/// Tier-2 league of the parent's region that `club` is a member of.
fn linkable_league<'a>(game: &'a Game, club: &Team, region_code: &str) -> Option<&'a League> {
    game.leagues.iter().find(|league| {
        league.league_kind == LeagueKind::Main
            && league.tier == LINKABLE_TIER
            && league
                .competition_id
                .as_deref()
                .and_then(crate::residency::region_for_competition)
                .is_some_and(|region| region.code() == region_code)
            && league.standings.iter().any(|entry| entry.team_id == club.id)
    })
}

fn option_for_club(
    game: &Game,
    parent: &Team,
    club: &Team,
    league: &League,
) -> AcademyAcquisitionOption {
    let competition_id = league.competition_id.as_deref().unwrap_or_default();
    let (reputation, development_level) = league_ratings(game, competition_id);
    let formula = acquisition_cost_for_candidate(&ErlAcademyCandidate {
        source_team_id: club.id.clone(),
        name: club.name.clone(),
        short_name: club.short_name.clone(),
        logo_url: club.logo_url.clone(),
        erl_league_id: competition_id.to_string(),
        country_code: club.country.clone(),
        reputation,
        development_level,
    });
    AcademyAcquisitionOption {
        source_team_id: club.id.clone(),
        name: club.name.clone(),
        short_name: club.short_name.clone(),
        logo_url: club.logo_url.clone(),
        erl_league_id: competition_id.to_string(),
        erl_league_name: league.name.clone(),
        country_code: club.country.clone(),
        assignment_rule: if country_matches(&club.country, &parent.country) {
            ErlAssignmentRule::Domestic
        } else {
            ErlAssignmentRule::Fallback
        },
        fallback_reason: None,
        reputation,
        development_level,
        acquisition_cost: link_fee(game, club, formula),
        real_club: true,
    }
}

/// Real tier-2 clubs `parent` may link, plus the reason it may not.
///
/// Same tier-1 parent, same region and same blocked codes as the copy catalog.
pub fn linked_club_report(game: &Game, parent_team_id: &str) -> AcademyAcquisitionReport {
    let Some(parent) = game.teams.iter().find(|team| team.id == parent_team_id) else {
        return AcademyAcquisitionReport {
            options: vec![],
            blocked_reason: Some("Team not found".to_string()),
            region: None,
        };
    };

    let parent_region = top_league_region(game, parent);
    let region_code = parent_region.map(|region| region.code().to_string());
    let user_team_id = game.manager.team_id.as_deref();

    let mut options: Vec<AcademyAcquisitionOption> = match &region_code {
        Some(code) => game
            .teams
            .iter()
            .filter(|club| {
                club.team_kind == TeamKind::Main
                    && club.id != parent.id
                    && club.parent_team_id.is_none()
                    && club.academy_team_id.is_none()
                    && Some(club.id.as_str()) != user_team_id
                    && !is_custom_team_id(&club.id)
            })
            .filter_map(|club| {
                let league = linkable_league(game, club, code)?;
                Some(option_for_club(game, parent, club, league))
            })
            .collect(),
        None => vec![],
    };
    options.sort_by(|left, right| {
        let left_domestic = left.assignment_rule == ErlAssignmentRule::Domestic;
        let right_domestic = right.assignment_rule == ErlAssignmentRule::Domestic;
        right_domestic
            .cmp(&left_domestic)
            .then_with(|| left.erl_league_id.cmp(&right.erl_league_id))
            .then_with(|| left.name.cmp(&right.name))
            .then_with(|| left.source_team_id.cmp(&right.source_team_id))
    });

    let blocked_reason = if !parent.is_main() {
        Some("Academy can only be acquired for a main team".to_string())
    } else if parent.academy_team_id.is_some() {
        Some("Parent team already has academy".to_string())
    } else if parent_region.is_none() {
        Some(BLOCKED_NOT_TOP_LEAGUE.to_string())
    } else if options.is_empty() {
        Some(BLOCKED_NO_REGION_CANDIDATES.to_string())
    } else if options
        .iter()
        .all(|option| parent.finance < option.acquisition_cost)
    {
        Some("Insufficient funds for all eligible academy acquisition options".to_string())
    } else {
        None
    };

    AcademyAcquisitionReport {
        options,
        blocked_reason,
        region: region_code,
    }
}

/// Link `club_id` to `parent_team_id`: book the fee and set both ids. The club keeps
/// its kind, name, logo, finances and competition; nothing is created or renamed.
pub fn acquire_linked_club(
    game: &mut Game,
    parent_team_id: &str,
    club_id: &str,
) -> Result<(), String> {
    let option = linked_club_report(game, parent_team_id)
        .options
        .into_iter()
        .find(|option| option.source_team_id == club_id)
        .ok_or_else(|| format!("Academy candidate '{club_id}' is not eligible for this team"))?;

    let parent_index = game
        .teams
        .iter()
        .position(|team| team.id == parent_team_id)
        .ok_or_else(|| "Parent team not found".to_string())?;
    if let Some(existing) = &game.teams[parent_index].academy_team_id {
        return Err(format!(
            "Parent team '{parent_team_id}' already has academy '{existing}'"
        ));
    }
    if game.teams[parent_index].finance < option.acquisition_cost {
        return Err(format!(
            "Insufficient funds for academy acquisition: available {}, required {}",
            game.teams[parent_index].finance, option.acquisition_cost
        ));
    }

    let date = game.clock.current_date.format("%Y-%m-%d").to_string();
    record_transaction_with_text(
        &mut game.teams[parent_index],
        FinanceTransactionInput {
            date,
            description: format!("Academy acquisition: {}", option.name),
            amount: -option.acquisition_cost,
            kind: FinancialTransactionKind::AcademyAcquisition,
            budget_impact: BudgetImpact::None,
            affects_season_totals: true,
            source: "academy".to_string(),
            source_id: Some(club_id.to_string()),
            correlation_id: Some(format!("academy-acquisition:{parent_team_id}:{club_id}")),
        },
        LedgerText::new("be.ledger.academyAcquisition", &[("name", &option.name)]),
    )
    .map_err(|err| format!("Failed to record academy acquisition: {err:?}"))?;
    game.teams[parent_index].academy_team_id = Some(club_id.to_string());

    if let Some(club) = game.teams.iter_mut().find(|team| team.id == club_id) {
        club.parent_team_id = Some(parent_team_id.to_string());
    }

    let parent_snapshot = game.teams[parent_index].clone();
    push_academy_acquired_message(game, &parent_snapshot, &option.name, option.acquisition_cost);
    Ok(())
}

/// Break the link of `club_id`, if it has one. Returns the former parent's id.
fn dissolve_link(game: &mut Game, club_id: &str) -> Option<String> {
    let club = game.teams.iter_mut().find(|team| team.id == club_id)?;
    let parent_id = club.parent_team_id.take()?;
    for team in game
        .teams
        .iter_mut()
        .filter(|team| team.academy_team_id.as_deref() == Some(club_id))
    {
        team.academy_team_id = None;
    }
    Some(parent_id)
}

/// A linked club that moved into a tier-1 league loses the link (no refund) and the
/// user is told. `moved_club_ids` are the clubs a ladder move just promoted.
pub fn dissolve_links_of_promoted_clubs(game: &mut Game, moved_club_ids: &[String]) {
    for club_id in moved_club_ids {
        let in_tier_one = game
            .teams
            .iter()
            .find(|team| &team.id == club_id)
            .filter(|team| team.team_kind == TeamKind::Main && team.parent_team_id.is_some())
            .and_then(|team| team.competition_id.as_deref())
            .is_some_and(|competition_id| {
                game.leagues.iter().any(|league| {
                    league.competition_id.as_deref() == Some(competition_id)
                        && league.league_kind == LeagueKind::Main
                        && league.tier == 1
                })
            });
        if !in_tier_one {
            continue;
        }
        let club_name = game
            .teams
            .iter()
            .find(|team| &team.id == club_id)
            .map(|team| team.name.clone())
            .unwrap_or_default();
        if let Some(parent_id) = dissolve_link(game, club_id) {
            push_link_dissolved_message(game, &parent_id, &club_name);
        }
    }
}

fn push_link_dissolved_message(game: &mut Game, parent_id: &str, club_name: &str) {
    if game.manager.team_id.as_deref() != Some(parent_id) {
        return;
    }
    let date = game.clock.current_date.format("%Y-%m-%d").to_string();
    let params = HashMap::from([("academy".to_string(), club_name.to_string())]);
    let message = InboxMessage::new(
        format!("academy-link-dissolved-{parent_id}-{date}"),
        format!("Academy link ended: {club_name}"),
        format!(
            "{club_name} was promoted to the top flight and is no longer your academy. The link ends with no refund."
        ),
        "Sporting Director".to_string(),
        date,
    )
    .with_category(MessageCategory::Finance)
    .with_priority(MessagePriority::High)
    .with_context(MessageContext {
        team_id: Some(parent_id.to_string()),
        ..Default::default()
    })
    .with_i18n(
        "be.msg.academyLinkDissolved.subject",
        "be.msg.academyLinkDissolved.body",
        params,
    )
    .with_sender_i18n("be.sender.sportingDirector", "be.role.sportingDirector");
    game.messages.push(message);
}

/// Standing rows of the real league of a linked club, best first:
/// `(team_id, name, points, map_diff, maps_won, won, lost)`.
pub fn linked_league_rows(game: &Game, club_id: &str) -> Vec<(String, String, u32, i32, u32, u32, u32)> {
    let Some(league) = game.leagues.iter().find(|league| {
        league.league_kind == LeagueKind::Main
            && league.standings.iter().any(|entry| entry.team_id == club_id)
    }) else {
        return vec![];
    };
    league
        .sorted_standings()
        .into_iter()
        .map(|entry| {
            let name = game
                .teams
                .iter()
                .find(|team| team.id == entry.team_id)
                .map(|team| team.name.clone())
                .unwrap_or_else(|| entry.team_id.clone());
            let map_diff = entry.maps_won as i32 - entry.maps_lost as i32;
            (
                entry.team_id,
                name,
                entry.points,
                map_diff,
                entry.maps_won,
                entry.won,
                entry.lost,
            )
        })
        .collect()
}
