use log::info;
use tauri::State;

use olm_core::game::Game;
use olm_core::state::StateManager;

#[tauri::command]
pub fn upgrade_main_facility_module(
    state: State<'_, StateManager>,
    module: String,
) -> Result<Game, String> {
    upgrade_main_facility_module_internal(&state, &module)
}

#[tauri::command]
pub fn expand_main_facility_hub(state: State<'_, StateManager>) -> Result<Game, String> {
    expand_main_facility_hub_internal(&state)
}

fn upgrade_main_facility_module_internal(
    state: &StateManager,
    module: &str,
) -> Result<Game, String> {
    info!("[cmd] upgrade_main_facility_module: {}", module);
    let mut game = state
        .get_game(|g| g.clone())
        .ok_or("No active game session".to_string())?;

    let team_id = game
        .manager
        .team_id
        .clone()
        .ok_or("No team assigned".to_string())?;

    let module_kind = match module {
        "ScrimsRoom" => olm_core::domain::team::MainFacilityModuleKind::ScrimsRoom,
        "AnalysisRoom" => olm_core::domain::team::MainFacilityModuleKind::AnalysisRoom,
        "BootcampArea" => olm_core::domain::team::MainFacilityModuleKind::BootcampArea,
        "RecoverySuite" => olm_core::domain::team::MainFacilityModuleKind::RecoverySuite,
        "ContentStudio" => olm_core::domain::team::MainFacilityModuleKind::ContentStudio,
        "ScoutingLab" => olm_core::domain::team::MainFacilityModuleKind::ScoutingLab,
        _ => return Err(format!("Unknown facility module: {}", module)),
    };

    let today = game.clock.current_date.format("%Y-%m-%d").to_string();
    let team = game
        .teams
        .iter_mut()
        .find(|team| team.id == team_id)
        .ok_or("Managed team not found".to_string())?;

    olm_core::club::upgrade_main_facility_module(team, module_kind, &today)?;

    state.set_game(game.clone());
    Ok(crate::client_game::game_for_client(&game))
}

fn expand_main_facility_hub_internal(state: &StateManager) -> Result<Game, String> {
    info!("[cmd] expand_main_facility_hub");
    let mut game = state
        .get_game(|g| g.clone())
        .ok_or("No active game session".to_string())?;

    let team_id = game
        .manager
        .team_id
        .clone()
        .ok_or("No team assigned".to_string())?;

    let today = game.clock.current_date.format("%Y-%m-%d").to_string();
    let team = game
        .teams
        .iter_mut()
        .find(|team| team.id == team_id)
        .ok_or("Managed team not found".to_string())?;

    olm_core::club::expand_main_facility_hub(team, &today)?;

    state.set_game(game.clone());
    Ok(crate::client_game::game_for_client(&game))
}
