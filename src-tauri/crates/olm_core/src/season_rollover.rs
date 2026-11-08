//! Season and split rollover for the user's league and every background league.
//!
//! The Tauri `advance_to_next_season` command is a thin wrapper around
//! [`advance_season`], so the whole rollover can be exercised without a UI shell.

use log::info;

use crate::end_of_season::{
    EndOfSeasonSummary, process_background_seasons, process_end_of_season,
    process_end_of_season_with_config, process_end_of_split,
};
use crate::game::Game;
use crate::generator::definitions::CompetitionManifest;

/// Result of [`advance_season`].
#[derive(Debug, Clone)]
pub struct AdvanceOutcome {
    /// Summary of the split or season that just finished, for the end-of-season screen.
    pub summary: EndOfSeasonSummary,
    /// True when the finished split also closed the season, so season-end side effects
    /// such as the manager firing check apply.
    pub was_season_end: bool,
}

/// Resolve the user's competition manifest. The game's merged configs come first so
/// the override layer applies; the data directory is only a fallback for older games.
fn resolve_user_manifest(game: &Game) -> Option<CompetitionManifest> {
    let competition_id = game.user_competition_id.as_deref()?;
    if let Some(manifest) = game.competition_configs.get(competition_id) {
        return Some(manifest.clone());
    }
    let data_dir = crate::state::RESOURCE_DATA_DIR.get()?;
    crate::competitions::load_competition_manifest(&data_dir.join("competitions"), competition_id)
        .ok()
}

/// Summary of the user's league standings taken before a mid-season split advance.
fn split_summary(game: &Game) -> EndOfSeasonSummary {
    let league = game.active_league();
    let standings = league.map(|l| l.sorted_standings()).unwrap_or_default();
    let user_position = game
        .manager
        .team_id
        .as_deref()
        .and_then(|tid| standings.iter().position(|s| s.team_id == tid))
        .map(|i| i + 1)
        .unwrap_or(0);
    let user_standing = user_position.checked_sub(1).and_then(|i| standings.get(i));
    let champion = standings.first();
    let champion_name = champion
        .and_then(|c| game.teams.iter().find(|t| t.id == c.team_id))
        .map(|t| t.name.clone())
        .unwrap_or_default();

    EndOfSeasonSummary {
        season: league.map(|l| l.season).unwrap_or(0),
        league_name: league.map(|l| l.name.clone()).unwrap_or_default(),
        champion_id: champion.map(|c| c.team_id.clone()).unwrap_or_default(),
        champion_name,
        user_position: user_position as u32,
        user_points: user_standing.map(|s| s.points).unwrap_or(0),
        user_won: user_standing.map(|s| s.won).unwrap_or(0),
        user_lost: user_standing.map(|s| s.lost).unwrap_or(0),
        user_maps_won: user_standing.map(|s| s.maps_won).unwrap_or(0),
        user_maps_lost: user_standing.map(|s| s.maps_lost).unwrap_or(0),
        total_teams: standings.len() as u32,
        ..Default::default()
    }
}

/// Advance the game past a completed split or season.
///
/// The user's league either moves to its next split or, when the finished split was the
/// last one of the manifest, runs the full end-of-season and starts split 0 of the next
/// season. Without a resolvable manifest the legacy single-schedule rollover runs.
/// Completed background leagues are rolled afterwards in every case.
///
/// The caller is responsible for checking `is_season_complete` first and for the
/// manager firing check when [`AdvanceOutcome::was_season_end`] is set.
pub fn advance_season(game: &mut Game) -> AdvanceOutcome {
    let manifest = resolve_user_manifest(game);

    let (summary, was_season_end) = match manifest {
        Some(manifest) => {
            let is_wrapping = game
                .active_league()
                .is_some_and(|league| league.split_index + 1 >= manifest.schedule.splits.len());
            if is_wrapping {
                info!("[season] season complete, running full end-of-season");
                let summary = process_end_of_season_with_config(game, Some(&manifest));
                // After season-end processing, generate split 0 of the new season
                process_end_of_split(game, &manifest);
                (summary, true)
            } else {
                info!("[season] split complete, advancing to next split");
                let summary = split_summary(game);
                if let Some(league) = game.active_league_mut() {
                    league.split_index += 1;
                }
                process_end_of_split(game, &manifest);
                (summary, false)
            }
        }
        None => {
            info!("[season] using legacy schedule");
            (process_end_of_season(game), true)
        }
    };

    let manifests = game.competition_configs.clone();
    process_background_seasons(game, &manifests);

    AdvanceOutcome {
        summary,
        was_season_end,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::GameClock;
    use crate::domain::manager::Manager;
    use chrono::{TimeZone, Utc};

    #[test]
    fn resolve_user_manifest_uses_the_games_merged_config() {
        let manifest: CompetitionManifest = serde_json::from_str(
            r#"{"id":"les","name":"LES","region":"EU","teams_file":"t.json","players_file":"p.json",
                "schedule":{"format":"double_round_robin","team_count":8,
                "splits":[{"name":"Spring","best_of":1,"season_start":{"month":3,"day":1}}]}}"#,
        )
        .expect("manifest should parse");
        let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 8, 20, 12, 0, 0).unwrap());
        let manager = Manager::new(
            "manager-1".to_string(),
            "Test".to_string(),
            "Manager".to_string(),
            "1980-01-01".to_string(),
            "England".to_string(),
        );
        let mut game = Game::new(clock, manager, vec![], vec![], vec![], vec![]);
        game.user_competition_id = Some("les".to_string());
        game.competition_configs.insert("les".to_string(), manifest);

        let resolved = resolve_user_manifest(&game).expect("manifest from configs");

        assert_eq!(resolved.schedule.splits.len(), 1);
    }
}
