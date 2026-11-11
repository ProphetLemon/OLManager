use chrono::Datelike;
use log::{info, warn};
use tauri::State;

use olm_core::domain::team::FinancialTransactionKind;
use olm_core::finances::{
    record_transaction_with_text, BudgetImpact, FinanceTransactionInput, LedgerText,
};
use olm_core::game::Game;
use olm_core::state::StateManager;

fn is_normal_staff_hiring_window_open(game: &Game) -> bool {
    let context = &game.season_context;
    if context.season_start.is_some() {
        return context.phase != olm_core::domain::season::SeasonPhase::InSeason;
    }

    let month = game.clock.current_date.month();
    // Fallback when season context is missing: offseason/winter->spring window.
    month <= 5 || month == 12
}

/// Why a hire or a release was refused. The reason is a stable code the UI
/// translates (`staff.errors.<reason>`); the player never reads the English here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum StaffError {
    NoGame,
    NoTeam,
    HiringLocked,
    NotFound,
    AlreadyEmployed,
    InsufficientFunds,
    OwnerNotHireable,
    OwnerNotFireable,
    NotYourTeam,
    TransactionFailed,
}

impl StaffError {
    fn reason(self) -> &'static str {
        match self {
            Self::NoGame => "no_game",
            Self::NoTeam => "no_team",
            Self::HiringLocked => "hiring_locked",
            Self::NotFound => "not_found",
            Self::AlreadyEmployed => "already_employed",
            Self::InsufficientFunds => "insufficient_funds",
            Self::OwnerNotHireable => "owner_not_hireable",
            Self::OwnerNotFireable => "owner_not_fireable",
            Self::NotYourTeam => "not_your_team",
            Self::TransactionFailed => "transaction_failed",
        }
    }

    /// JSON wire form `{"kind":"staff","reason":"..."}`.
    fn to_wire(self) -> String {
        format!(r#"{{"kind":"staff","reason":"{}"}}"#, self.reason())
    }
}

#[tauri::command]
pub fn hire_staff(state: State<'_, StateManager>, staff_id: String) -> Result<Game, String> {
    hire_staff_internal(&state, &staff_id).map_err(StaffError::to_wire)
}

pub(crate) fn hire_staff_internal(state: &StateManager, staff_id: &str) -> Result<Game, StaffError> {
    info!("[cmd] hire_staff: staff_id={}", staff_id);
    let mut game = state
        .get_game(|g| g.clone())
        .ok_or(StaffError::NoGame)?;

    let team_id = game.manager.team_id.clone().ok_or(StaffError::NoTeam)?;

    if !is_normal_staff_hiring_window_open(&game) {
        return Err(StaffError::HiringLocked);
    }

    let staff = game
        .staff
        .iter_mut()
        .find(|s| s.id == staff_id)
        .ok_or(StaffError::NotFound)?;

    // A club owner belongs to the club, not to the staff market.
    if staff.is_owner() {
        return Err(StaffError::OwnerNotHireable);
    }

    if staff.team_id.is_some() {
        return Err(StaffError::AlreadyEmployed);
    }

    staff.team_id = Some(team_id.clone());

    // Immediate hiring impact: reserve budget from real cash pool now.
    if let Some(team) = game.teams.iter_mut().find(|t| t.id == team_id) {
        if team.finance < staff.wage as i64 {
            return Err(StaffError::InsufficientFunds);
        }
        // A signing that costs nothing has nothing to record: the ledger refuses
        // zero-amount transactions.
        if staff.wage > 0 {
            record_transaction_with_text(
                team,
                FinanceTransactionInput {
                    date: game.clock.current_date.format("%Y-%m-%d").to_string(),
                    description: format!(
                        "Staff hiring cost: {} {}",
                        staff.first_name, staff.last_name
                    ),
                    amount: -(staff.wage as i64),
                    kind: FinancialTransactionKind::StaffWage,
                    budget_impact: BudgetImpact::None,
                    affects_season_totals: true,
                    source: "staff".to_string(),
                    source_id: Some(staff.id.clone()),
                    correlation_id: Some(format!("staff-hire:{}:{}", team_id, staff.id)),
                },
                LedgerText::new(
                    "be.ledger.staffHiring",
                    &[("name", &format!("{} {}", staff.first_name, staff.last_name))],
                ),
            )
            .map_err(|err| {
                warn!("[cmd] hire_staff: could not record the hiring transaction: {err:?}");
                StaffError::TransactionFailed
            })?;
        }
    }

    state.set_game(game.clone());
    Ok(crate::client_game::game_for_client(&game))
}

#[cfg(test)]
mod tests {
    use super::{hire_staff_internal, release_staff_internal, StaffError};
    use chrono::{TimeZone, Utc};
    use olm_core::clock::GameClock;
    use olm_core::domain::manager::Manager;
    use olm_core::domain::staff::{Staff, StaffAttributes, StaffRole};
    use olm_core::domain::team::{FinancialTransactionKind, Team};
    use olm_core::game::Game;
    use olm_core::state::StateManager;

    fn make_team() -> Team {
        let mut team = Team::new(
            "team-1".to_string(),
            "User FC".to_string(),
            "USR".to_string(),
            "England".to_string(),
            "London".to_string(),
            "User Ground".to_string(),
            25_000,
        );
        team.manager_id = Some("manager-1".to_string());
        team.finance = 200_000;
        team
    }

    fn make_staff() -> Staff {
        let mut staff = Staff::new(
            "staff-1".to_string(),
            "Alex".to_string(),
            "Coach".to_string(),
            "1985-01-01".to_string(),
            StaffRole::Coach,
            StaffAttributes {
                coaching: 70,
                judging_ability: 50,
                judging_potential: 50,
                physiotherapy: 30,
            },
        );
        staff.wage = 12_000;
        staff
    }

    fn make_employed_staff() -> Staff {
        let mut staff = make_staff();
        staff.team_id = Some("team-1".to_string());
        staff
    }

    fn make_game() -> Game {
        let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 3, 1, 12, 0, 0).unwrap());
        let mut manager = Manager::new(
            "manager-1".to_string(),
            "Test".to_string(),
            "Manager".to_string(),
            "1980-01-01".to_string(),
            "England".to_string(),
        );
        manager.hire("team-1".to_string());

        Game::new(
            clock,
            manager,
            vec![make_team()],
            vec![],
            vec![make_staff()],
            vec![],
        )
    }

    fn make_game_with_employed_staff() -> Game {
        let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 3, 1, 12, 0, 0).unwrap());
        let mut manager = Manager::new(
            "manager-1".to_string(),
            "Test".to_string(),
            "Manager".to_string(),
            "1980-01-01".to_string(),
            "England".to_string(),
        );
        manager.hire("team-1".to_string());

        Game::new(
            clock,
            manager,
            vec![make_team()],
            vec![],
            vec![make_employed_staff()],
            vec![],
        )
    }

    #[test]
    fn hire_staff_internal_updates_state() {
        let state = StateManager::new();
        state.set_game(make_game());

        let response = hire_staff_internal(&state, "staff-1").expect("response");
        let staff = response
            .staff
            .iter()
            .find(|staff| staff.id == "staff-1")
            .unwrap();
        let team = response
            .teams
            .iter()
            .find(|team| team.id == "team-1")
            .unwrap();

        assert_eq!(staff.team_id.as_deref(), Some("team-1"));
        assert_eq!(team.finance, 188_000);
        assert_eq!(team.season_expenses, 12_000);
        assert_eq!(team.financial_ledger.len(), 1);
        assert_eq!(
            team.financial_ledger[0].kind,
            FinancialTransactionKind::StaffWage
        );
        assert_eq!(team.financial_ledger[0].amount, -12_000);
        assert_eq!(
            team.financial_ledger[0].description_key.as_deref(),
            Some("be.ledger.staffHiring")
        );
        assert_eq!(
            team.financial_ledger[0]
                .description_params
                .get("name")
                .map(String::as_str),
            Some(format!("{} {}", staff.first_name, staff.last_name).as_str())
        );

        let stored_game = state.get_game(|game| game.clone()).expect("stored game");
        let stored_staff = stored_game
            .staff
            .iter()
            .find(|staff| staff.id == "staff-1")
            .expect("stored staff should exist");
        let stored_team = stored_game
            .teams
            .iter()
            .find(|team| team.id == "team-1")
            .expect("stored team should exist");
        assert_eq!(stored_staff.team_id.as_deref(), Some("team-1"));
        assert_eq!(stored_team.finance, 188_000);
        assert_eq!(stored_team.season_expenses, 12_000);
        assert_eq!(stored_team.financial_ledger.len(), 1);
        assert_eq!(
            stored_team.financial_ledger[0].kind,
            FinancialTransactionKind::StaffWage
        );
        assert_eq!(stored_team.financial_ledger[0].amount, -12_000);
    }

    #[test]
    fn hire_staff_is_blocked_outside_hiring_window() {
        let state = StateManager::new();
        let mut game = make_game();
        game.clock.current_date = Utc.with_ymd_and_hms(2026, 7, 1, 12, 0, 0).unwrap();
        state.set_game(game);

        let err = hire_staff_internal(&state, "staff-1").expect_err("should be blocked");
        assert_eq!(err, StaffError::HiringLocked);
    }

    #[test]
    fn hire_staff_fails_when_finance_is_too_low() {
        let state = StateManager::new();
        let mut game = make_game();
        if let Some(team) = game.teams.iter_mut().find(|team| team.id == "team-1") {
            team.finance = 8_000;
        }
        state.set_game(game);

        let err = hire_staff_internal(&state, "staff-1").expect_err("should fail");
        assert_eq!(err, StaffError::InsufficientFunds);
    }

    #[test]
    fn hiring_a_member_with_no_wage_records_no_transaction_instead_of_failing() {
        let state = StateManager::new();
        let mut game = make_game();
        game.staff[0].wage = 0;
        state.set_game(game);

        let response = hire_staff_internal(&state, "staff-1").expect("a free signing succeeds");

        let team = response.teams.iter().find(|team| team.id == "team-1").unwrap();
        assert_eq!(team.finance, 200_000);
        assert!(team.financial_ledger.is_empty());
        assert_eq!(response.staff[0].team_id.as_deref(), Some("team-1"));
    }

    #[test]
    fn an_owner_cannot_be_hired_from_the_market() {
        let state = StateManager::new();
        let mut game = make_game();
        game.staff[0].role = StaffRole::Owner;
        state.set_game(game);

        let err = hire_staff_internal(&state, "staff-1").expect_err("owners are not for hire");

        assert_eq!(err, StaffError::OwnerNotHireable);
        let stored = state.get_game(|game| game.clone()).expect("stored game");
        assert!(stored.staff[0].team_id.is_none());
        assert_eq!(stored.teams[0].finance, 200_000);
    }

    #[test]
    fn the_owner_of_the_club_cannot_be_fired() {
        let state = StateManager::new();
        let mut game = make_game_with_employed_staff();
        game.staff[0].role = StaffRole::Owner;
        state.set_game(game);

        let err = release_staff_internal(&state, "staff-1").expect_err("owners cannot be fired");

        assert_eq!(err, StaffError::OwnerNotFireable);
        let stored = state.get_game(|game| game.clone()).expect("stored game");
        assert_eq!(stored.staff[0].team_id.as_deref(), Some("team-1"));
    }

    #[test]
    fn a_refusal_reaches_the_ui_as_a_coded_reason() {
        assert_eq!(
            StaffError::OwnerNotFireable.to_wire(),
            r#"{"kind":"staff","reason":"owner_not_fireable"}"#
        );
    }

    #[test]
    fn release_staff_internal_updates_state() {
        let state = StateManager::new();
        state.set_game(make_game_with_employed_staff());

        let response = release_staff_internal(&state, "staff-1").expect("response");
        let staff = response
            .staff
            .iter()
            .find(|staff| staff.id == "staff-1")
            .unwrap();

        assert!(staff.team_id.is_none());

        let stored_game = state.get_game(|game| game.clone()).expect("stored game");
        let stored_staff = stored_game
            .staff
            .iter()
            .find(|staff| staff.id == "staff-1")
            .expect("stored staff should exist");
        assert!(stored_staff.team_id.is_none());
    }
}

#[tauri::command]
pub fn release_staff(state: State<'_, StateManager>, staff_id: String) -> Result<Game, String> {
    release_staff_internal(&state, &staff_id).map_err(StaffError::to_wire)
}

pub(crate) fn release_staff_internal(state: &StateManager, staff_id: &str) -> Result<Game, StaffError> {
    info!("[cmd] release_staff: staff_id={}", staff_id);
    let mut game = state
        .get_game(|g| g.clone())
        .ok_or(StaffError::NoGame)?;

    let team_id = game.manager.team_id.clone().ok_or(StaffError::NoTeam)?;

    let staff = game
        .staff
        .iter_mut()
        .find(|s| s.id == staff_id)
        .ok_or(StaffError::NotFound)?;

    if staff.team_id.as_deref() != Some(&team_id) {
        return Err(StaffError::NotYourTeam);
    }

    // The club owner is not hired staff and cannot be dismissed.
    if staff.is_owner() {
        return Err(StaffError::OwnerNotFireable);
    }

    staff.team_id = None;

    state.set_game(game.clone());
    Ok(crate::client_game::game_for_client(&game))
}
