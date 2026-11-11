use log::info;
use tauri::State;

use olm_core::state::StateManager;

#[tauri::command]
pub fn check_season_complete(state: State<'_, StateManager>) -> Result<bool, String> {
    log::debug!("[cmd] check_season_complete");
    let game = state
        .get_game(|g| g.clone())
        .ok_or("No active game session".to_string())?;
    Ok(olm_core::end_of_season::is_season_complete(&game))
}

#[tauri::command]
pub fn advance_to_next_season(state: State<'_, StateManager>) -> Result<serde_json::Value, String> {
    info!("[cmd] advance_to_next_season");
    let mut game = state
        .get_game(|g| g.clone())
        .ok_or("No active game session".to_string())?;

    if !olm_core::end_of_season::is_season_complete(&game) {
        return Err("Season is not yet complete".to_string());
    }

    let outcome = olm_core::season_rollover::advance_season(&mut game);

    // End-of-season objective evaluation may have dropped satisfaction — check firing
    if outcome.was_season_end {
        olm_core::firing::check_manager_firing(&mut game);
    }

    state.set_game(game.clone());

    if game.manager.team_id.is_none() {
        return Ok(serde_json::json!({
            "action": "fired",
            "game": crate::client_game::game_for_client(&game),
            "summary": outcome.summary,
        }));
    }

    Ok(serde_json::json!({
        "game": crate::client_game::game_for_client(&game),
        "summary": outcome.summary,
    }))
}

#[tauri::command]
pub fn get_season_awards(
    state: State<'_, StateManager>,
) -> Result<olm_core::season_awards::SeasonAwards, String> {
    log::debug!("[cmd] get_season_awards");
    let game = state
        .get_game(|g| g.clone())
        .ok_or("No active game session".to_string())?;
    Ok(olm_core::season_awards::compute_season_awards(&game))
}
