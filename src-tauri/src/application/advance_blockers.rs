//! Single source of truth for what stops `advance_time_with_mode`.
//!
//! The advance command and the `check_blocking_actions` pre-check both call
//! [`advance_block`], so the UI can never show a scrim blocker the command
//! would not raise (or miss one it would).

use chrono::Datelike;
use olm_core::domain::league::FixtureStatus;
use olm_core::domain::team::{Team, TrainingSchedule};
use olm_core::game::{DayPhase, Game};

/// Mode the frontend Continue button uses when the player has not picked one.
pub const DEFAULT_ADVANCE_MODE: &str = "live";

/// A hard stop raised by the advance command before the day moves on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdvanceBlock {
    /// The weekly scrim setup (objective or rivals) is not defined yet.
    ScrimSetup,
    /// A post-scrim review from today still needs a decision.
    ScrimDecision,
}

impl AdvanceBlock {
    /// The `action` string `advance_time_with_mode` answers with.
    pub fn action(self) -> &'static str {
        match self {
            Self::ScrimSetup => "blocked_scrim_setup",
            Self::ScrimDecision => "blocked_scrim_decision",
        }
    }

    /// The blocker as `check_blocking_actions` reports it.
    pub fn to_blocker(self) -> serde_json::Value {
        let (id, text) = match self {
            Self::ScrimSetup => (
                "scrim_setup_required",
                "Define the weekly scrim setup (objective and rivals) or delegate the advance to continue.",
            ),
            Self::ScrimDecision => (
                "scrim_decision_required",
                "Make a scrim decision before continuing.",
            ),
        };
        serde_json::json!({
            "id": id,
            "severity": "warn",
            "text": text,
            "tab": "Scrims",
        })
    }
}

/// Index of the user's scheduled fixture on `today` (`%Y-%m-%d`), if any.
pub(crate) fn scheduled_user_fixture_index(game: &Game, today: &str) -> Option<usize> {
    let user_team_id = game.manager.team_id.as_ref()?;
    let league = game.active_league()?;

    league
        .fixtures
        .iter()
        .enumerate()
        .find_map(|(index, fixture)| {
            if fixture.date == today
                && fixture.status == FixtureStatus::Scheduled
                && (fixture.home_team_id == *user_team_id || fixture.away_team_id == *user_team_id)
            {
                Some(index)
            } else {
                None
            }
        })
}

fn user_team(game: &Game) -> Option<&Team> {
    let team_id = game.manager.team_id.as_ref()?;
    game.teams.iter().find(|team| &team.id == team_id)
}

fn has_unresolved_scrim_review_today(game: &Game) -> bool {
    let today = game.clock.current_date.format("%Y-%m-%d").to_string();
    user_team(game).is_some_and(|team| {
        team.scrim_reports
            .iter()
            .any(|report| report.date == today && report.post_decision.is_none())
    })
}

fn first_scrim_weekday_for_team(team: &Team) -> u8 {
    let raw_slots = if team.scrim_weekly_slots > 0 {
        team.scrim_weekly_slots
    } else {
        match team.training_schedule {
            TrainingSchedule::Intense => 6,
            TrainingSchedule::Balanced => 4,
            TrainingSchedule::Light => 2,
        }
    };
    let slots = if raw_slots <= 2 {
        2
    } else if raw_slots <= 4 {
        4
    } else {
        6
    };
    let all = match slots {
        0..=2 => vec![2_u8, 2_u8],
        3..=4 => vec![2_u8, 2_u8, 3_u8, 3_u8],
        _ => vec![2_u8, 2_u8, 3_u8, 3_u8, 4_u8, 4_u8],
    };
    all.into_iter().min().unwrap_or(2)
}

/// Whether the user's club still has a match (league, playoff or friendly)
/// scheduled from today to the end of the current ISO week (Sunday).
///
/// The weekly scrim setup prepares for that week's match; a week in which the
/// club rests (a bye in an odd-sized league) or is out of the playoffs has
/// nothing to prepare for.
fn user_has_match_left_this_week(game: &Game) -> bool {
    let (Some(user_team_id), Some(league)) = (game.manager.team_id.as_ref(), game.active_league())
    else {
        return false;
    };
    let today = game.clock.current_date.date_naive();
    let days_to_sunday = 6 - i64::from(today.weekday().num_days_from_monday());
    let week_end = today + chrono::Duration::days(days_to_sunday);

    league.fixtures.iter().any(|fixture| {
        fixture.status == FixtureStatus::Scheduled
            && (fixture.home_team_id == *user_team_id || fixture.away_team_id == *user_team_id)
            && chrono::NaiveDate::parse_from_str(&fixture.date, "%Y-%m-%d")
                .is_ok_and(|date| date >= today && date <= week_end)
    })
}

fn has_no_weekly_scrim_setup(game: &Game) -> bool {
    let week_key = format!(
        "{}-W{}",
        game.clock.current_date.iso_week().year(),
        game.clock.current_date.iso_week().week()
    );
    let current_weekday = game.clock.current_date.weekday().num_days_from_monday() as u8;
    user_team(game).is_some_and(|team| {
        let in_scrim_start_window = current_weekday == first_scrim_weekday_for_team(team)
            && game.day_phase == DayPhase::Morning;
        if !in_scrim_start_window || !user_has_match_left_this_week(game) {
            return false;
        }
        if team.scrim_setup_locked_week_key.as_deref() == Some(week_key.as_str()) {
            return false;
        }
        let has_objective = team.scrim_weekly_objective.is_some();
        let has_plans = team
            .weekly_scrim_plan_team_ids
            .iter()
            .any(|plan| plan.iter().any(|entry| !entry.is_empty()));
        !(has_objective || has_plans)
    })
}

/// What would stop `advance_time_with_mode(mode)` on this game, without
/// mutating it.
///
/// Only the normal-advance branch can block: a user match today routes to the
/// live, spectator or delegate branches, and an evening advance always plays
/// the day. The weekly setup is required only in a week in which the club
/// still has a match (see [`user_has_match_left_this_week`]). The scrim decision is checked in `ScrimBlock` only: resolving the
/// scrims in `Morning` does not change the phase, so the decision it creates
/// is raised by the following advance.
pub fn advance_block(game: &Game, mode: &str) -> Option<AdvanceBlock> {
    let today = game.clock.current_date.format("%Y-%m-%d").to_string();
    if scheduled_user_fixture_index(game, &today).is_some() || game.day_phase == DayPhase::Evening {
        return None;
    }
    if mode != "delegate" && has_no_weekly_scrim_setup(game) {
        return Some(AdvanceBlock::ScrimSetup);
    }
    if game.day_phase == DayPhase::ScrimBlock && has_unresolved_scrim_review_today(game) {
        return Some(AdvanceBlock::ScrimDecision);
    }
    None
}
