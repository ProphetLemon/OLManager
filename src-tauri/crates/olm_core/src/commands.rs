use crate::domain::stats::LolRole;
use crate::domain::team::{
    DraftStrategy, ScrimFocus, TrainingFocus, TrainingIntensity, TrainingSchedule,
};
use crate::domain::transfer_history::TransferHistoryEntry;
use crate::game::Game;

// ── Training ────────────────────────────────────────────────

pub fn set_training(game: &mut Game, team_id: &str, focus: &str, intensity: &str) {
    if let Some(team) = game.teams.iter_mut().find(|t| t.id == team_id) {
        team.training_focus = TrainingFocus::from_id(focus).unwrap_or_default();
        team.training_intensity = match intensity {
            "Low" => TrainingIntensity::Low,
            "High" => TrainingIntensity::High,
            _ => TrainingIntensity::Medium,
        };
    }
}

pub fn set_training_schedule(game: &mut Game, team_id: &str, schedule: &str) {
    if let Some(team) = game.teams.iter_mut().find(|t| t.id == team_id) {
        team.training_schedule = match schedule {
            "Intense" => TrainingSchedule::Intense,
            "Light" => TrainingSchedule::Light,
            _ => TrainingSchedule::Balanced,
        };
    }
}

pub fn set_training_groups(game: &mut Game, team_id: &str, groups: &[serde_json::Value]) {
    use crate::domain::team::TrainingGroup;
    let parsed: Vec<TrainingGroup> = groups
        .iter()
        .filter_map(|g| serde_json::from_value(g.clone()).ok())
        .collect();
    if let Some(team) = game.teams.iter_mut().find(|t| t.id == team_id) {
        team.training_groups = parsed;
    }
}

pub fn set_player_training_focus(game: &mut Game, player_id: &str, _focus: Option<&str>) {
    if let Some(_player) = game.players.iter_mut().find(|p| p.id == player_id) {
        // player.training_focus would be set here
    }
}

// ── Draft Strategy ───────────────────────────────────────────

pub fn set_draft_strategy(game: &mut Game, team_id: &str, value: &str) {
    if let Some(team) = game.teams.iter_mut().find(|t| t.id == team_id) {
        team.draft_strategy = match value {
            "Attacking" | "HighPress" => DraftStrategy::Aggressive,
            "Defensive" => DraftStrategy::Passive,
            "Possession" => DraftStrategy::Scaling,
            "Counter" => DraftStrategy::CounterPick,
            "PriorityBans" => DraftStrategy::PriorityBans,
            _ => DraftStrategy::Balanced,
        };
    }
}

// ── Lineup ───────────────────────────────────────────────────

/// Set the team's active lineup. Refuses a lineup with more imports than the
/// residency rule allows (`LINEUP_TOO_MANY_IMPORTS:<count>:<max>`).
pub fn set_active_lineup(
    game: &mut Game,
    team_id: &str,
    player_ids: Vec<String>,
) -> Result<(), String> {
    crate::residency::validate_lineup_imports(game, team_id, &player_ids)
        .map_err(|err| err.to_string())?;
    if let Some(team) = game.teams.iter_mut().find(|t| t.id == team_id) {
        team.active_lineup_ids = player_ids;
    }
    Ok(())
}

// ── Tactics ──────────────────────────────────────────────────

pub fn set_lol_tactics(game: &mut Game, team_id: &str, tactics: crate::domain::team::LolTactics) {
    if let Some(team) = game.teams.iter_mut().find(|t| t.id == team_id) {
        team.lol_tactics = tactics;
    }
}

// ── Team Roles ───────────────────────────────────────────────

pub fn set_team_roles(game: &mut Game, team_id: &str, roles: crate::domain::team::TeamRoles) {
    if let Some(team) = game.teams.iter_mut().find(|t| t.id == team_id) {
        team.team_roles = roles;
    }
}

// ── Scrims ───────────────────────────────────────────────────

pub fn set_weekly_scrims(game: &mut Game, team_id: &str, opponent_ids: Vec<String>) {
    if let Some(team) = game.teams.iter_mut().find(|t| t.id == team_id) {
        team.weekly_scrim_opponent_ids = opponent_ids;
    }
}

pub fn set_weekly_scrim_plans(game: &mut Game, team_id: &str, plans: Vec<Vec<String>>) {
    if let Some(team) = game.teams.iter_mut().find(|t| t.id == team_id) {
        team.weekly_scrim_plan_team_ids = plans;
    }
}

pub fn set_weekly_scrim_slots(game: &mut Game, team_id: &str, slots: u8) {
    if let Some(team) = game.teams.iter_mut().find(|t| t.id == team_id) {
        team.scrim_weekly_slots = slots;
    }
}

pub fn set_weekly_scrim_objective(game: &mut Game, team_id: &str, objective: Option<ScrimFocus>) {
    if let Some(team) = game.teams.iter_mut().find(|t| t.id == team_id) {
        team.scrim_weekly_objective = objective;
    }
}

// ── Messages / Inbox ─────────────────────────────────────────

pub fn mark_message_read(game: &mut Game, message_id: &str) {
    if let Some(m) = game.messages.iter_mut().find(|m| m.id == message_id) {
        m.read = true;
    }
}

pub fn mark_all_messages_read(game: &mut Game) {
    for m in game.messages.iter_mut() {
        m.read = true;
    }
}

pub fn delete_message(game: &mut Game, message_id: &str) {
    game.messages.retain(|m| m.id != message_id);
}

pub fn delete_messages(game: &mut Game, ids: &std::collections::HashSet<String>) {
    game.messages.retain(|m| !ids.contains(&m.id));
}

pub fn clear_old_messages(game: &mut Game) {
    game.messages.clear();
}

// ── Staff ────────────────────────────────────────────────────

pub fn hire_staff(game: &mut Game, staff_id: &str, team_id: &str) {
    if let Some(s) = game.staff.iter_mut().find(|s| s.id == staff_id) {
        s.team_id = Some(team_id.to_string());
    }
}

pub fn release_staff(game: &mut Game, staff_id: &str, team_id: &str) {
    if let Some(s) = game
        .staff
        .iter_mut()
        .find(|s| s.id == staff_id && s.team_id.as_deref() == Some(team_id))
    {
        s.team_id = Some("fa".to_string());
    }
}

// ── Scouting ─────────────────────────────────────────────────

pub fn send_scout(game: &mut Game, scout_id: &str, player_id: &str) {
    let _ = crate::scouting::send_scout(game, scout_id, player_id);
}

pub fn start_potential_research(game: &mut Game, player_id: &str) {
    if let Some(p) = game.players.iter_mut().find(|p| p.id == player_id) {
        p.potential_revealed = None;
        p.potential_research_started_on = Some(game.clock.current_date.to_rfc3339());
        p.potential_research_eta_days = Some(7);
    }
}

// ── Transfer helpers ─────────────────────────────────────────

pub fn release_player_contract(game: &mut Game, player_id: &str) {
    if let Some(p) = game.players.iter_mut().find(|p| p.id == player_id) {
        p.team_id = None;
        p.was_released = true;
        p.transfer_listed = false;
        game.moved_player_ids.insert(player_id.to_string());
    }
}

pub fn toggle_transfer_list(game: &mut Game, player_id: &str) {
    if let Some(p) = game.players.iter_mut().find(|p| p.id == player_id) {
        p.transfer_listed = !p.transfer_listed;
    }
}

pub fn toggle_loan_list(game: &mut Game, player_id: &str) {
    if let Some(p) = game.players.iter_mut().find(|p| p.id == player_id) {
        p.loan_listed = !p.loan_listed;
    }
}

pub fn get_transfer_history(game: &Game) -> Vec<TransferHistoryEntry> {
    game.transfer_history.entries.clone()
}

// ── Academies ────────────────────────────────────────────────

pub fn promote_academy_player(game: &mut Game, player_id: &str, team_id: &str) {
    if let Some(p) = game.players.iter_mut().find(|p| p.id == player_id) {
        p.team_id = Some(team_id.to_string());
    }
}

pub fn demote_academy_player(game: &mut Game, player_id: &str, academy_team_id: &str) {
    if let Some(p) = game.players.iter_mut().find(|p| p.id == player_id) {
        p.team_id = Some(academy_team_id.to_string());
    }
}

pub fn bootstrap_academy_pool(game: &mut Game) {
    let date = game.clock.current_date.format("%Y-%m-%d").to_string();
    crate::game_setup::bootstrap_example_academy_pool_from_example(
        &mut game.teams,
        &mut game.players,
        &date,
    );
    crate::game_setup::remove_free_agents_shadowed_by_academy(&mut game.players, &game.teams);
}

// ── Manager ──────────────────────────────────────────────────

pub fn update_manager_profile(
    game: &mut Game,
    first_name: Option<&str>,
    last_name: Option<&str>,
    nickname: Option<&str>,
    nationality: Option<&str>,
) {
    if let Some(v) = first_name {
        game.manager.first_name = v.to_string();
    }
    if let Some(v) = last_name {
        game.manager.last_name = v.to_string();
    }
    if let Some(v) = nickname {
        game.manager.nickname = v.to_string();
    }
    if let Some(v) = nationality {
        game.manager.nationality = v.to_string();
    }
}

pub fn reroll_player_role(game: &mut Game, player_id: &str) {
    if let Some(p) = game.players.iter_mut().find(|p| p.id == player_id) {
        p.position = LolRole::Unknown;
    }
}

// ── Player ───────────────────────────────────────────────────

pub fn set_player_champion_training_target(game: &mut Game, player_id: &str, champion_key: &str) {
    if let Err(e) = crate::champions::set_player_training_target(
        game,
        player_id,
        0,
        Some(champion_key.to_string()),
    ) {
        log::warn!("set_player_champion_training_target: {e}");
    }
}

pub fn delegate_champion_training(game: &mut Game) {
    if let Err(e) = crate::champions::delegate_champion_training_to_coach(game) {
        log::warn!("delegate_champion_training: {e}");
    }
}

// ── Social ───────────────────────────────────────────────────

pub fn create_social_post(_game: &mut Game, _text: &str) {
    // Placeholder - creates a social post
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::GameClock;
    use crate::domain::manager::Manager;
    use crate::domain::player::{LolRole, Player, PlayerAttributes};
    use crate::domain::team::Team;
    use chrono::{TimeZone, Utc};

    fn roster(nationalities: [&str; 5]) -> Game {
        let attrs = PlayerAttributes {
            mechanics: 60,
            laning: 60,
            teamfighting: 60,
            macro_play: 60,
            consistency: 60,
            shotcalling: 60,
            champion_pool: 60,
            discipline: 60,
            mental_resilience: 60,
        };
        let roles = [
            LolRole::Top,
            LolRole::Jungle,
            LolRole::Mid,
            LolRole::Adc,
            LolRole::Support,
        ];
        let players = roles
            .iter()
            .zip(nationalities)
            .enumerate()
            .map(|(i, (role, nationality))| {
                let mut p = Player::new(
                    format!("p{i}"),
                    format!("p{i}"),
                    format!("Player {i}"),
                    "2000-01-01".to_string(),
                    nationality.to_string(),
                    *role,
                    attrs.clone(),
                );
                p.team_id = Some("lec-a".to_string());
                p
            })
            .collect();
        let mut team = Team::new(
            "lec-a".to_string(),
            "A".to_string(),
            "A".to_string(),
            "Spain".to_string(),
            "Madrid".to_string(),
            "Arena".to_string(),
            1_000,
        );
        team.competition_id = Some("lec".to_string());
        let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 8, 1, 12, 0, 0).unwrap());
        let manager = Manager::new(
            "m".to_string(),
            "A".to_string(),
            "B".to_string(),
            "1980-01-01".to_string(),
            "Spain".to_string(),
        );
        Game::new(clock, manager, vec![team], players, vec![], vec![])
    }

    fn ids() -> Vec<String> {
        (0..5).map(|i| format!("p{i}")).collect()
    }

    #[test]
    fn set_active_lineup_refuses_three_imports_and_keeps_the_old_lineup() {
        let mut game = roster(["KR", "KR", "CN", "DE", "ES"]);
        game.teams[0].active_lineup_ids = vec!["old".to_string()];

        let err = set_active_lineup(&mut game, "lec-a", ids()).unwrap_err();

        assert_eq!(err, "LINEUP_TOO_MANY_IMPORTS:3:2");
        assert_eq!(game.teams[0].active_lineup_ids, vec!["old".to_string()]);
    }

    #[test]
    fn set_active_lineup_accepts_two_imports() {
        let mut game = roster(["KR", "KR", "FR", "DE", "ES"]);

        set_active_lineup(&mut game, "lec-a", ids()).unwrap();

        assert_eq!(game.teams[0].active_lineup_ids, ids());
    }
}
