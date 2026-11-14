//! AI clubs conclude the renewal sessions they open.
//!
//! [`crate::ai_team_agent::evaluate_renewals`] and the player agent only set a session to
//! `Open`; nothing on the AI side ever answered it, so every expiring contract ended in
//! `process_contract_expiries` and the player walked. Once an open session reaches the
//! final weeks of its contract the club now answers it with the same rules the user-side
//! renewal uses: the player's expected wage and contract length, under the board wage
//! policy. A renewal the club cannot afford, or for a player it has put up for sale, is
//! marked `Stalled` and the contract runs out as before. A concluded renewal leaves no
//! session behind, so the next contract can open its own.
//!
//! Runs every day from the turn loop, before contract expiries.

use chrono::Months;

use crate::contract_wage_policy::renewal_wage_policy_allows;
use crate::contracts::{
    ContractWarningStage, contract_warning_stage, expected_contract_years, expected_wage,
};
use crate::domain::player::{RenewalSessionOutcome, RenewalSessionStatus};
use crate::domain::team::{Team, TeamKind};
use crate::game::Game;

/// Answer every open renewal session of an AI main team whose contract is in its final weeks.
pub fn conclude_ai_renewals(game: &mut Game) {
    let today = game.clock.current_date.date_naive();
    let today_text = today.format("%Y-%m-%d").to_string();

    let due: Vec<usize> = game
        .players
        .iter()
        .enumerate()
        .filter(|(_, player)| {
            player
                .morale_core
                .renewal_state
                .as_ref()
                .is_some_and(|state| state.status == RenewalSessionStatus::Open)
                && contract_warning_stage(player.contract_end.as_deref(), today)
                    == Some(ContractWarningStage::FinalWeeks)
        })
        .map(|(index, _)| index)
        .collect();

    for index in due {
        let Some(team) = ai_main_team_of(game, index) else {
            continue;
        };
        let player = &game.players[index];
        let wage = expected_wage(player, &team, today);
        let years = expected_contract_years(player, today);
        let new_end = today.checked_add_months(Months::new(years * 12));

        let affordable =
            !player.transfer_listed && renewal_wage_policy_allows(game, &team, player.wage, wage);
        let player = &mut game.players[index];
        let Some(state) = player.morale_core.renewal_state.as_mut() else {
            continue;
        };
        state.last_attempt_date = Some(today_text.clone());
        match new_end {
            Some(end) if affordable => {
                player.wage = wage;
                player.contract_end = Some(end.format("%Y-%m-%d").to_string());
                // The talks are over with the new contract: leaving them `Agreed` would
                // keep the club from ever opening a session for the next one.
                player.clear_renewal_session();
            }
            _ => {
                state.status = RenewalSessionStatus::Stalled;
                state.last_outcome = Some(RenewalSessionOutcome::Stalled);
            }
        }
    }
}

/// The club of `game.players[index]` when it is an AI main team (no human manager).
fn ai_main_team_of(game: &Game, index: usize) -> Option<Team> {
    let team_id = game.players[index].team_id.as_deref()?;
    game.teams
        .iter()
        .find(|team| {
            team.id == team_id && team.team_kind == TeamKind::Main && team.manager_id.is_none()
        })
        .cloned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::GameClock;
    use crate::domain::manager::Manager;
    use crate::domain::player::{
        ContractRenewalState, LolRole, Player, PlayerAttributes, PlayerSeasonStats,
    };
    use chrono::{TimeZone, Utc};

    fn player(id: &str, team_id: &str, wage: u32, contract_end: &str) -> Player {
        let attrs = PlayerAttributes {
            mechanics: 70,
            laning: 70,
            teamfighting: 70,
            macro_play: 70,
            consistency: 70,
            shotcalling: 70,
            champion_pool: 70,
            discipline: 70,
            mental_resilience: 70,
        };
        let mut player = Player::new(
            id.to_string(),
            id.to_string(),
            id.to_string(),
            "2000-01-01".to_string(),
            "GB".to_string(),
            LolRole::Mid,
            attrs,
        );
        player.team_id = Some(team_id.to_string());
        player.wage = wage;
        player.contract_end = Some(contract_end.to_string());
        player.stats = PlayerSeasonStats {
            avg_rating: 7.0,
            ..PlayerSeasonStats::default()
        };
        player.morale_core.renewal_state = Some(ContractRenewalState {
            status: RenewalSessionStatus::Open,
            ..ContractRenewalState::default()
        });
        player
    }

    fn game_with(players: Vec<Player>, wage_budget: i64) -> Game {
        let mut team = Team::new(
            "ai".to_string(),
            "AI Club".to_string(),
            "AIC".to_string(),
            "DE".to_string(),
            "Berlin".to_string(),
            "Arena".to_string(),
            10_000,
        );
        team.wage_budget = wage_budget;
        let clock = GameClock::new(
            Utc.with_ymd_and_hms(2026, 11, 10, 0, 0, 0)
                .single()
                .unwrap(),
        );
        let manager = Manager::new(
            "mgr".to_string(),
            "Test".to_string(),
            "Manager".to_string(),
            "1990-01-01".to_string(),
            "GB".to_string(),
        );
        Game::new(clock, manager, vec![team], players, vec![], vec![])
    }

    fn state_of(game: &Game, id: &str) -> RenewalSessionStatus {
        game.players
            .iter()
            .find(|p| p.id == id)
            .and_then(|p| p.morale_core.renewal_state.as_ref())
            .map(|s| s.status.clone())
            .expect("renewal state")
    }

    #[test]
    fn open_session_in_final_weeks_extends_the_contract() {
        let mut game = game_with(vec![player("p1", "ai", 50_000, "2026-11-30")], 500_000);

        conclude_ai_renewals(&mut game);

        let p = &game.players[0];
        assert!(
            p.contract_end.as_deref() > Some("2027-11-10"),
            "{:?}",
            p.contract_end
        );
    }

    #[test]
    fn renewed_player_has_no_session_left_over() {
        let mut game = game_with(vec![player("p1", "ai", 50_000, "2026-11-30")], 500_000);

        conclude_ai_renewals(&mut game);

        assert!(
            game.players[0].morale_core.renewal_state.is_none(),
            "a settled session would keep the next contract from ever getting one"
        );
    }

    #[test]
    fn released_player_loses_a_stalled_session() {
        let mut game = game_with(vec![player("p1", "ai", 400_000, "2026-11-10")], 100_000);
        game.players[0]
            .morale_core
            .renewal_state
            .as_mut()
            .unwrap()
            .status = RenewalSessionStatus::Stalled;

        crate::contracts::process_contract_expiries(&mut game);

        assert!(game.players[0].team_id.is_none());
        assert!(game.players[0].morale_core.renewal_state.is_none());
    }

    #[test]
    fn open_session_far_from_expiry_stays_open() {
        let mut game = game_with(vec![player("p1", "ai", 50_000, "2027-11-30")], 500_000);

        conclude_ai_renewals(&mut game);

        assert_eq!(state_of(&game, "p1"), RenewalSessionStatus::Open);
        assert_eq!(game.players[0].contract_end.as_deref(), Some("2027-11-30"));
    }

    #[test]
    fn unaffordable_renewal_is_stalled_and_contract_unchanged() {
        let mut game = game_with(vec![player("p1", "ai", 400_000, "2026-11-30")], 100_000);

        conclude_ai_renewals(&mut game);

        assert_eq!(state_of(&game, "p1"), RenewalSessionStatus::Stalled);
        assert_eq!(game.players[0].contract_end.as_deref(), Some("2026-11-30"));
    }

    #[test]
    fn transfer_listed_player_is_not_renewed() {
        let mut listed = player("p1", "ai", 50_000, "2026-11-30");
        listed.transfer_listed = true;
        let mut game = game_with(vec![listed], 500_000);

        conclude_ai_renewals(&mut game);

        assert_eq!(state_of(&game, "p1"), RenewalSessionStatus::Stalled);
    }

    #[test]
    fn user_team_session_is_left_alone() {
        let mut game = game_with(vec![player("p1", "ai", 50_000, "2026-11-30")], 500_000);
        game.teams[0].manager_id = Some("mgr".to_string());

        conclude_ai_renewals(&mut game);

        assert_eq!(state_of(&game, "p1"), RenewalSessionStatus::Open);
    }

    #[test]
    fn concluded_contract_survives_the_expiry_pass() {
        let mut game = game_with(vec![player("p1", "ai", 50_000, "2026-11-30")], 500_000);
        game.clock = GameClock::new(
            Utc.with_ymd_and_hms(2026, 11, 29, 0, 0, 0)
                .single()
                .unwrap(),
        );

        conclude_ai_renewals(&mut game);
        game.clock.advance_days(2);
        crate::contracts::process_contract_expiries(&mut game);

        assert_eq!(game.players[0].team_id.as_deref(), Some("ai"));
    }
}
