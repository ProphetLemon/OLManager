//! Reports promotion and relegation to the player.
//!
//! Reads the movements recorded in [`crate::ladder::LadderState`] and turns them into
//! the end-of-season summary fields, an inbox message for the user's club or league,
//! and one news item per applied movement. It never changes league membership.
//!
//! Announcing is idempotent: each movement is keyed by its link and season and noted in
//! `LadderState::announced`, so running it from both the daily turn and the season
//! rollover creates every message and article exactly once.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::domain::message::{InboxMessage, MessageCategory, MessagePriority};
use crate::domain::news::{NewsArticle, NewsCategory};
use crate::game::Game;
use crate::ladder::{LadderMovement, LadderMovementStatus};

/// Announced-movement keys kept; older ones are dropped first.
const MAX_ANNOUNCED: usize = 24;

/// A team named in a movement, with its display name.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct LadderTeamRef {
    pub id: String,
    pub name: String,
}

/// One promotion and relegation decision with display names resolved.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct LadderMovementReport {
    pub lower_competition_id: String,
    pub lower_competition_name: String,
    pub upper_competition_id: String,
    pub upper_competition_name: String,
    /// Season that finished and produced the movement.
    pub season: u32,
    pub status: LadderMovementStatus,
    pub promoted: Vec<LadderTeamRef>,
    pub relegated: Vec<LadderTeamRef>,
}

/// What happened to the user's club.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum UserLadderResult {
    Promoted,
    Relegated,
    /// The club kept its place in a league that took part in a swap.
    #[default]
    Stayed,
}

/// The user's club in a season's ladder movement.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct UserLadder {
    pub result: UserLadderResult,
    pub from_competition_id: String,
    pub to_competition_id: String,
}

fn movement_key(movement: &LadderMovement) -> String {
    format!(
        "{}>{}:{}",
        movement.link_lower, movement.link_upper, movement.season
    )
}

fn competition_name(game: &Game, competition_id: &str) -> String {
    game.competition_configs
        .get(competition_id)
        .map(|manifest| manifest.name.clone())
        .or_else(|| {
            game.leagues
                .iter()
                .find(|league| league.competition_id.as_deref() == Some(competition_id))
                .map(|league| league.name.clone())
        })
        .unwrap_or_else(|| competition_id.to_string())
}

fn team_refs(game: &Game, ids: &[String]) -> Vec<LadderTeamRef> {
    ids.iter()
        .map(|id| LadderTeamRef {
            id: id.clone(),
            name: game
                .teams
                .iter()
                .find(|team| &team.id == id)
                .map(|team| team.name.clone())
                .unwrap_or_else(|| id.clone()),
        })
        .collect()
}

fn report_for(game: &Game, movement: &LadderMovement) -> LadderMovementReport {
    LadderMovementReport {
        lower_competition_id: movement.link_lower.clone(),
        lower_competition_name: competition_name(game, &movement.link_lower),
        upper_competition_id: movement.link_upper.clone(),
        upper_competition_name: competition_name(game, &movement.link_upper),
        season: movement.season,
        status: movement.status,
        promoted: team_refs(game, &movement.promoted),
        relegated: team_refs(game, &movement.relegated),
    }
}

/// Every movement recorded for the finished `season`, whatever its status.
pub fn movements_for_season(game: &Game, season: u32) -> Vec<LadderMovementReport> {
    game.ladder
        .movements
        .iter()
        .filter(|movement| movement.season == season)
        .map(|movement| report_for(game, movement))
        .collect()
}

fn user_outcome(game: &Game, movement: &LadderMovement) -> Option<UserLadder> {
    if movement.status != LadderMovementStatus::Applied {
        return None;
    }
    let team_id = game.manager.team_id.as_deref()?;
    let outcome = |result, from: &str, to: &str| UserLadder {
        result,
        from_competition_id: from.to_string(),
        to_competition_id: to.to_string(),
    };
    if movement.promoted.iter().any(|id| id == team_id) {
        return Some(outcome(
            UserLadderResult::Promoted,
            &movement.link_lower,
            &movement.link_upper,
        ));
    }
    if movement.relegated.iter().any(|id| id == team_id) {
        return Some(outcome(
            UserLadderResult::Relegated,
            &movement.link_upper,
            &movement.link_lower,
        ));
    }
    let current = game.user_competition_id.as_deref()?;
    (current == movement.link_lower || current == movement.link_upper)
        .then(|| outcome(UserLadderResult::Stayed, current, current))
}

/// What the finished `season` meant for the user's club, if a swap touched it.
/// A move outranks a stay when several links apply.
pub fn user_ladder_for_season(game: &Game, season: u32) -> Option<UserLadder> {
    let mut found: Option<UserLadder> = None;
    for movement in game.ladder.movements.iter().filter(|m| m.season == season) {
        match user_outcome(game, movement) {
            Some(outcome) if outcome.result != UserLadderResult::Stayed => return Some(outcome),
            Some(outcome) => found = found.or(Some(outcome)),
            None => {}
        }
    }
    found
}

fn join_names(teams: &[LadderTeamRef]) -> String {
    teams
        .iter()
        .map(|team| team.name.as_str())
        .collect::<Vec<_>>()
        .join(", ")
}

fn params(pairs: &[(&str, String)]) -> HashMap<String, String> {
    pairs
        .iter()
        .map(|(key, value)| ((*key).to_string(), value.clone()))
        .collect()
}

fn news_for(report: &LadderMovementReport, date: &str) -> NewsArticle {
    let promoted = join_names(&report.promoted);
    let relegated = join_names(&report.relegated);
    let team_ids = report
        .promoted
        .iter()
        .chain(&report.relegated)
        .map(|team| team.id.clone())
        .collect();
    NewsArticle::new(
        format!(
            "ladder_news_{}_{}_{}",
            report.lower_competition_id, report.upper_competition_id, report.season
        ),
        format!(
            "{} promoted to {}, {} relegated",
            promoted, report.upper_competition_name, relegated
        ),
        format!(
            "{} go up from {} to {} and {} drop down after season {}.",
            promoted,
            report.lower_competition_name,
            report.upper_competition_name,
            relegated,
            report.season
        ),
        "League Chronicle".to_string(),
        date.to_string(),
        NewsCategory::LeagueRoundup,
    )
    .with_teams(team_ids)
    .with_i18n(
        "be.news.ladder.headline",
        "be.news.ladder.body",
        "be.source.leagueChronicle",
        params(&[
            ("promoted", promoted),
            ("relegated", relegated),
            ("lower", report.lower_competition_name.clone()),
            ("upper", report.upper_competition_name.clone()),
            ("season", report.season.to_string()),
        ]),
    )
}

fn user_message_for(
    report: &LadderMovementReport,
    result: UserLadderResult,
    team_name: &str,
    date: &str,
) -> InboxMessage {
    let promoted = result == UserLadderResult::Promoted;
    let (kind, subject_key, body_key, from, to) = if promoted {
        (
            "promoted",
            "be.msg.ladder.promoted.subject",
            "be.msg.ladder.promoted.body",
            &report.lower_competition_name,
            &report.upper_competition_name,
        )
    } else {
        (
            "relegated",
            "be.msg.ladder.relegated.subject",
            "be.msg.ladder.relegated.body",
            &report.upper_competition_name,
            &report.lower_competition_name,
        )
    };
    let (subject, body) = if promoted {
        (
            format!("{team_name} promoted to {to}"),
            format!(
                "{team_name} have earned promotion from {from} to {to}. The board expects a strong first season among the elite."
            ),
        )
    } else {
        (
            format!("{team_name} relegated to {to}"),
            format!(
                "{team_name} have been relegated from {from} to {to}. The board wants an immediate return."
            ),
        )
    };
    InboxMessage::new(
        format!(
            "ladder_user_{kind}_{}_{}_{}",
            report.lower_competition_id, report.upper_competition_id, report.season
        ),
        subject,
        body,
        "Board of Directors".to_string(),
        date.to_string(),
    )
    .with_category(MessageCategory::BoardDirective)
    .with_priority(MessagePriority::High)
    .with_sender_role("Chairman")
    .with_i18n(
        subject_key,
        body_key,
        params(&[
            ("team", team_name.to_string()),
            ("from", from.clone()),
            ("to", to.clone()),
            ("season", report.season.to_string()),
        ]),
    )
    .with_sender_i18n("be.sender.boardOfDirectors", "be.role.chairman")
}

fn swap_message_for(report: &LadderMovementReport, date: &str) -> InboxMessage {
    let promoted = join_names(&report.promoted);
    let relegated = join_names(&report.relegated);
    InboxMessage::new(
        format!(
            "ladder_swap_{}_{}_{}",
            report.lower_competition_id, report.upper_competition_id, report.season
        ),
        format!(
            "Promotion and relegation: {} and {}",
            report.lower_competition_name, report.upper_competition_name
        ),
        format!(
            "After season {}, {} go up to {} and {} drop down to {}.",
            report.season,
            promoted,
            report.upper_competition_name,
            relegated,
            report.lower_competition_name
        ),
        "League Office".to_string(),
        date.to_string(),
    )
    .with_category(MessageCategory::LeagueInfo)
    .with_priority(MessagePriority::Normal)
    .with_sender_role("Competition Secretary")
    .with_i18n(
        "be.msg.ladder.leagueSwap.subject",
        "be.msg.ladder.leagueSwap.body",
        params(&[
            ("promoted", promoted),
            ("relegated", relegated),
            ("lower", report.lower_competition_name.clone()),
            ("upper", report.upper_competition_name.clone()),
            ("season", report.season.to_string()),
        ]),
    )
    .with_sender_i18n("be.sender.leagueOffice", "be.role.competitionSecretary")
}

/// Create the inbox messages and news for every applied movement not yet announced.
///
/// A movement that is not `Applied` announces nothing and is not marked, so a later
/// status change is not lost. Safe to call repeatedly.
pub fn announce_ladder_movements(game: &mut Game) {
    let pending: Vec<LadderMovement> = game
        .ladder
        .movements
        .iter()
        .filter(|movement| movement.status == LadderMovementStatus::Applied)
        .filter(|movement| !game.ladder.announced.contains(&movement_key(movement)))
        .cloned()
        .collect();
    if pending.is_empty() {
        return;
    }

    let message_date = game.clock.current_date.format("%Y-%m-%d").to_string();
    let news_date = game.clock.current_date.to_rfc3339();
    let user_team_name = game
        .manager
        .team_id
        .as_deref()
        .and_then(|id| game.teams.iter().find(|team| team.id == id))
        .map(|team| team.name.clone())
        .unwrap_or_default();

    for movement in pending {
        let report = report_for(game, &movement);
        let article = news_for(&report, &news_date);
        if !game.news.iter().any(|existing| existing.id == article.id) {
            game.news.push(article);
        }

        let message =
            match user_outcome(game, &movement) {
                Some(outcome) if outcome.result != UserLadderResult::Stayed => Some(
                    user_message_for(&report, outcome.result, &user_team_name, &message_date),
                ),
                Some(_) => Some(swap_message_for(&report, &message_date)),
                None => None,
            };
        if let Some(message) = message
            && !game
                .messages
                .iter()
                .any(|existing| existing.id == message.id)
        {
            game.messages.push(message);
        }

        game.ladder.announced.push(movement_key(&movement));
    }
    let excess = game.ladder.announced.len().saturating_sub(MAX_ANNOUNCED);
    game.ladder.announced.drain(..excess);
}
