//! Team picker values that match the career: money, reputation and roster size as the
//! game starts each club, not as the raw team files list them.

use std::path::Path;

use log::warn;
use olm_core::clock::GameClock;
use olm_core::competitions::{apply_start_values, build_league_selection, scan_competitions};
use olm_core::domain::manager::Manager;
use olm_core::game::Game;
use olm_core::generator::definitions::LeagueSelectionData;
use olm_core::world_overlay::WorldOverlay;

use crate::commands::game::{
    build_world_naming_replaced_club, new_game_start_for, NewGameWorldInputs,
};

/// The league selection with every club's money, reputation and player count read from
/// the world a new game assembles (same overlay, rating overrides and roster fill as
/// `select_team`). Falls back to the raw values when that world cannot be built.
pub(crate) fn build_start_league_selection(
    data_dir: &Path,
    overlay: Option<&WorldOverlay>,
) -> LeagueSelectionData {
    let mut data = build_league_selection(data_dir);
    match assemble_preview_world(data_dir, overlay, &data) {
        Ok(world) => apply_start_values(&mut data, &world.teams, &world.players),
        Err(err) => warn!("[league_preview] showing raw team values: {err}"),
    }
    data
}

/// The world `select_team` builds, around the first club on offer. The picked club only
/// matters for its own lineup, which the picker does not show; every Main club gets the
/// same overlay and roster fill whoever is picked.
fn assemble_preview_world(
    data_dir: &Path,
    overlay: Option<&WorldOverlay>,
    selection: &LeagueSelectionData,
) -> Result<Game, String> {
    let (competition, team) = selection
        .competitions
        .iter()
        .find_map(|competition| competition.teams.first().map(|team| (competition, team)))
        .ok_or("no club to build the preview world around")?;
    let manifests = scan_competitions(&data_dir.join("competitions"));
    let manager = Manager::new(
        "mgr_preview".to_string(),
        "Preview".to_string(),
        "Manager".to_string(),
        "1990-01-01".to_string(),
        "KR".to_string(),
    );
    let mut game = Game::new(
        GameClock::new(new_game_start_for(overlay)),
        manager,
        vec![],
        vec![],
        vec![],
        vec![],
    );
    build_world_naming_replaced_club(
        &mut game,
        &NewGameWorldInputs {
            data_dir,
            manifests: &manifests,
            competition_id: &competition.id,
            team_id: &team.id,
            overlay,
            custom_team: None,
            joins_league: false,
        },
        olm_core::player_rating_overrides::bundled(),
    )?;
    Ok(game)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use olm_core::clock::GameClock;
    use olm_core::competitions::competition_id_from_team_id_known;
    use olm_core::domain::manager::Manager;
    use olm_core::game::Game;
    use olm_core::generator::definitions::TeamSummary;
    use std::path::PathBuf;
    use std::time::Instant;

    use crate::commands::game::{build_world_naming_replaced_club, NewGameWorldInputs};

    fn data_base() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("data")
    }

    fn empty_session() -> Game {
        let clock = GameClock::new(chrono::Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap());
        let manager = Manager::new(
            "mgr_user".to_string(),
            "Test".to_string(),
            "Manager".to_string(),
            "1990-01-01".to_string(),
            "KR".to_string(),
        );
        Game::new(clock, manager, vec![], vec![], vec![], vec![])
    }

    /// The world `select_team` builds when the manager picks `team_id`, minus the Tauri handle.
    fn new_game_for(team_id: &str, overlay: &WorldOverlay) -> Game {
        let data = data_base();
        let manifests = scan_competitions(&data.join("competitions"));
        let known: Vec<String> = manifests
            .iter()
            .filter(|m| !m.legacy)
            .map(|m| m.id.clone())
            .collect();
        let competition_id =
            competition_id_from_team_id_known(team_id, &known).expect("competition prefix");
        let mut game = empty_session();
        build_world_naming_replaced_club(
            &mut game,
            &NewGameWorldInputs {
                data_dir: &data,
                manifests: &manifests,
                competition_id,
                team_id,
                overlay: Some(overlay),
                custom_team: None,
                joins_league: false,
            },
            olm_core::player_rating_overrides::bundled(),
        )
        .expect("world");
        game
    }

    fn raw_teams() -> Vec<(u8, TeamSummary)> {
        build_league_selection(&data_base())
            .competitions
            .into_iter()
            .flat_map(|c| c.teams.into_iter().map(move |t| (c.tier, t)))
            .collect()
    }

    fn picker_team(data: &LeagueSelectionData, team_id: &str) -> TeamSummary {
        data.competitions
            .iter()
            .flat_map(|c| c.teams.iter())
            .find(|t| t.id == team_id)
            .cloned()
            .expect("team in picker")
    }

    #[test]
    fn a_second_tier_club_without_money_or_reputation_shows_what_a_new_game_gives_it() {
        let overlay = olm_core::world_overlay::bundled_world_overlay().expect("overlay");
        let (_, raw) = raw_teams()
            .into_iter()
            .find(|(tier, t)| *tier == 2 && (t.finance == Some(0) || t.reputation == Some(0)))
            .expect("a second-tier team without money or reputation in the raw files");

        let picker = picker_team(
            &build_start_league_selection(&data_base(), Some(&overlay)),
            &raw.id,
        );
        let game = new_game_for(&raw.id, &overlay);
        let team = game
            .teams
            .iter()
            .find(|t| t.id == raw.id)
            .expect("team in game");

        assert!(
            team.finance > 0 && team.reputation > 0,
            "the game derives both"
        );
        assert_eq!(picker.finance, Some(team.finance));
        assert_eq!(picker.reputation, Some(team.reputation));
    }

    #[test]
    fn the_picker_player_count_is_the_roster_a_new_game_starts_with() {
        let overlay = olm_core::world_overlay::bundled_world_overlay().expect("overlay");
        let teams = raw_teams();
        let any_slot = teams[0].1.id.clone();
        let probe = new_game_for(&any_slot, &overlay);
        let roster = |game: &Game, id: &str| {
            game.players
                .iter()
                .filter(|p| p.team_id.as_deref() == Some(id))
                .count()
        };
        let (_, changed) = teams
            .into_iter()
            .find(|(_, t)| t.player_count.is_some_and(|n| n != roster(&probe, &t.id)))
            .expect("a team whose roster the world build changes");
        let game = new_game_for(&changed.id, &overlay);

        let picker = picker_team(
            &build_start_league_selection(&data_base(), Some(&overlay)),
            &changed.id,
        );

        assert_eq!(picker.player_count, Some(roster(&game, &changed.id)));
    }

    /// Release timing of the world assembly the picker reuses:
    /// `cargo test --release -p openleaguemanager picker_world_cost -- --ignored --nocapture`
    #[test]
    #[ignore = "timing probe, run in release"]
    fn picker_world_cost() {
        let overlay = olm_core::world_overlay::bundled_world_overlay().expect("overlay");
        let slot = raw_teams().remove(0).1.id;
        for run in 0..5 {
            let start = Instant::now();
            let data = build_start_league_selection(&data_base(), Some(&overlay));
            println!(
                "run {run}: {:.1} ms ({} leagues, slot {slot})",
                start.elapsed().as_secs_f64() * 1000.0,
                data.competitions.len()
            );
        }
    }
}
