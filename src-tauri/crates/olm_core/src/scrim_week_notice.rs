//! The Monday message that tells the manager the week's scrims can be planned.
//!
//! The planning window reopens every Monday, but the hard `scrim_setup_required`
//! stop only fires on the first scrim day. This message covers the days between,
//! with the same emptiness test as that stop and the same rest-week rule.

use std::collections::HashMap;

use chrono::Datelike;

use crate::domain::league::{Fixture, MatchType};
use crate::domain::message::{
    ActionType, InboxMessage, MessageAction, MessageCategory, MessageContext, MessagePriority,
};
use crate::game::Game;

/// Whether the user's club rests this week: the league plays a regular-season
/// matchday this week that the club does not play at all, and the club has no
/// fixture of its own dated this week (Monday to Sunday, any type or status).
///
/// An odd-sized league gives each club one bye per split. In that week the
/// rest of the league plays and the club has no match to prepare, so the
/// setup stop is skipped. Pre-season, the gaps between splits and a playoff
/// exit are not byes: the stop still applies there, as it did before
/// odd-sized leagues existed, because scrims also drive training gains.
pub fn user_club_rests_this_week(game: &Game) -> bool {
    let (Some(user_team_id), Some(league)) = (game.manager.team_id.as_ref(), game.active_league())
    else {
        return false;
    };
    let today = game.clock.current_date.date_naive();
    let week_start =
        today - chrono::Duration::days(i64::from(today.weekday().num_days_from_monday()));
    let week_end = week_start + chrono::Duration::days(6);
    let in_this_week = |fixture: &Fixture| {
        chrono::NaiveDate::parse_from_str(&fixture.date, "%Y-%m-%d")
            .is_ok_and(|date| date >= week_start && date <= week_end)
    };
    let involves_user = |fixture: &Fixture| {
        fixture.home_team_id == *user_team_id || fixture.away_team_id == *user_team_id
    };

    if league
        .fixtures
        .iter()
        .any(|fixture| in_this_week(fixture) && involves_user(fixture))
    {
        return false;
    }
    league.fixtures.iter().any(|fixture| {
        fixture.match_type == MatchType::League
            && in_this_week(fixture)
            && !league.fixtures.iter().any(|other| {
                other.match_type == MatchType::League
                    && other.matchday == fixture.matchday
                    && involves_user(other)
            })
    })
}

/// On the Monday the clock has just reached, tell the manager the week's scrims
/// can be planned, once per week. Quiet when the week is already set up (an
/// objective, any plan, or a confirmed setup) and in a week the club rests.
///
/// Call it right after the clock moves to a new day.
pub fn push_scrim_week_open_message(game: &mut Game) {
    if game.clock.current_date.weekday().num_days_from_monday() != 0 {
        return;
    }
    let Some(team_id) = game.manager.team_id.clone() else {
        return;
    };
    let week_key = format!(
        "{}-W{}",
        game.clock.current_date.iso_week().year(),
        game.clock.current_date.iso_week().week()
    );
    let Some(team) = game.teams.iter().find(|team| team.id == team_id) else {
        return;
    };
    let has_plans = team
        .weekly_scrim_plan_team_ids
        .iter()
        .any(|plan| plan.iter().any(|entry| !entry.is_empty()));
    if team.scrim_setup_locked_week_key.as_deref() == Some(week_key.as_str())
        || team.scrim_weekly_objective.is_some()
        || has_plans
        || user_club_rests_this_week(game)
    {
        return;
    }

    let message_id = format!("scrim-week-open-{team_id}-{week_key}");
    if game.messages.iter().any(|message| message.id == message_id) {
        return;
    }

    let message = InboxMessage::new(
        message_id,
        "Scrims can be planned this week".to_string(),
        "Planning for this week's scrims is open. Pick the objective and the opponents before the first scrim day.".to_string(),
        "Coaching Staff".to_string(),
        game.clock.current_date.to_rfc3339(),
    )
    .with_category(MessageCategory::Training)
    .with_priority(MessagePriority::Normal)
    .with_sender_role("Coaching Staff")
    .with_action(MessageAction {
        id: "plan_scrims".to_string(),
        label: "Plan scrims".to_string(),
        action_type: ActionType::NavigateTo {
            route: "/dashboard?tab=Scrims".to_string(),
        },
        resolved: false,
        label_key: Some("be.msg.scrimWeekOpen.action".to_string()),
    })
    .with_context(MessageContext {
        team_id: Some(team_id),
        ..Default::default()
    })
    .with_i18n(
        "be.msg.scrimWeekOpen.subject",
        "be.msg.scrimWeekOpen.body",
        HashMap::new(),
    )
    .with_sender_i18n("be.sender.coachingStaff", "be.role.coachingStaff");
    game.messages.push(message);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::GameClock;
    use crate::domain::league::{FixtureStatus, League, LeagueKind};
    use crate::domain::manager::Manager;
    use crate::domain::team::{ScrimFocus, Team};
    use crate::turn::process_day;
    use chrono::{TimeZone, Utc};

    fn team(id: &str) -> Team {
        Team::new(
            id.to_string(),
            id.to_string(),
            id.to_string(),
            "England".to_string(),
            "City".to_string(),
            "Ground".to_string(),
            20_000,
        )
    }

    fn fixture(id: &str, date: &str, home: &str, away: &str) -> Fixture {
        Fixture {
            id: id.to_string(),
            matchday: 1,
            date: date.to_string(),
            home_team_id: home.to_string(),
            away_team_id: away.to_string(),
            match_type: MatchType::League,
            best_of: 1,
            status: FixtureStatus::Scheduled,
            result: None,
        }
    }

    /// Sunday 2026-01-04, so the clock reaches Monday 2026-01-05 on the next day.
    /// The club plays on Sunday 2026-01-11.
    fn game_on_sunday_before_monday() -> Game {
        let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 1, 4, 12, 0, 0).unwrap());
        let mut manager = Manager::new(
            "mgr1".to_string(),
            "Alex".to_string(),
            "Manager".to_string(),
            "1980-01-01".to_string(),
            "England".to_string(),
        );
        manager.hire("team1".to_string());
        let mut game = Game::new(
            clock,
            manager,
            vec![team("team1"), team("team2"), team("team3")],
            vec![],
            vec![],
            vec![],
        );
        game.leagues = vec![League {
            id: "league1".to_string(),
            name: "League".to_string(),
            season: 1,
            competition_id: None,
            logo: None,
            league_kind: LeagueKind::Main,
            split_index: 0,
            tier: 0,
            active: false,
            fixtures: vec![fixture("fx", "2026-01-11", "team1", "team2")],
            standings: Vec::new(),
        }];
        game
    }

    fn week_open_messages(game: &Game) -> usize {
        game.messages
            .iter()
            .filter(|message| message.id.starts_with("scrim-week-open-"))
            .count()
    }

    #[test]
    fn the_day_before_a_reopening_monday_leaves_one_message_with_a_scrims_action() {
        let mut game = game_on_sunday_before_monday();
        process_day(&mut game);
        assert_eq!(game.clock.current_date.weekday().num_days_from_monday(), 0);
        assert_eq!(week_open_messages(&game), 1);
        let message = game
            .messages
            .iter()
            .find(|message| message.id.starts_with("scrim-week-open-"))
            .expect("message");
        let action = message.actions.first().expect("action");
        assert!(matches!(
            &action.action_type,
            ActionType::NavigateTo { route } if route == "/dashboard?tab=Scrims"
        ));
        assert_eq!(
            message.subject_key.as_deref(),
            Some("be.msg.scrimWeekOpen.subject")
        );
    }

    #[test]
    fn it_is_sent_once_per_week() {
        let mut game = game_on_sunday_before_monday();
        process_day(&mut game);
        push_scrim_week_open_message(&mut game);
        assert_eq!(week_open_messages(&game), 1);
    }

    #[test]
    fn it_is_not_sent_on_other_weekdays() {
        let mut game = game_on_sunday_before_monday();
        game.clock = GameClock::new(Utc.with_ymd_and_hms(2026, 1, 6, 12, 0, 0).unwrap());
        push_scrim_week_open_message(&mut game);
        assert_eq!(week_open_messages(&game), 0);
    }

    #[test]
    fn it_is_not_sent_when_the_week_is_already_planned() {
        let mut game = game_on_sunday_before_monday();
        game.teams[0].weekly_scrim_plan_team_ids = vec![vec!["team2".to_string()]];
        process_day(&mut game);
        assert_eq!(week_open_messages(&game), 0);

        let mut game = game_on_sunday_before_monday();
        game.teams[0].scrim_weekly_objective = Some(ScrimFocus::Macro);
        process_day(&mut game);
        assert_eq!(week_open_messages(&game), 0);
    }

    #[test]
    fn it_is_not_sent_in_a_week_the_club_rests() {
        let mut game = game_on_sunday_before_monday();
        game.leagues[0].fixtures = vec![fixture("fx", "2026-01-11", "team2", "team3")];
        process_day(&mut game);
        assert_eq!(week_open_messages(&game), 0);
    }
}
