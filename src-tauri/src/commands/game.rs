use chrono::{Datelike, TimeZone};
use log::{info, warn};
use olm_core::domain::player::Player;
use olm_core::domain::staff::Staff;
use olm_core::domain::stats::LolRole;
use olm_core::domain::team::{Team, TeamKind};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::State;

use olm_core::clock::GameClock;
use olm_core::db::save_index::SaveEntry;
use olm_core::domain::manager::Manager;
use olm_core::domain::stats::StatsState;
use olm_core::game::Game;
use olm_core::game_setup;
use olm_core::wage_scale;
use olm_core::generator::definitions::CompetitionManifest;
use olm_core::roster_stability;
use olm_core::world_catalog;
use olm_core::state::StateManager;
use olm_core::world_overlay::{OverlayApplyReport, WorldOverlay, apply_world_overlay};

use crate::SaveManagerState;

#[derive(Debug, Clone, Serialize)]
pub struct TeamSelectionData {
    pub manager: Manager,
    pub teams: Vec<olm_core::domain::team::Team>,
    pub players: Vec<olm_core::domain::player::Player>,
}

// ---------------------------------------------------------------------------
// Local helpers that stay in the Tauri layer
// ---------------------------------------------------------------------------

use olm_core::competitions::{competition_id_from_team_id_known, sanitize_competition_references};
use olm_core::custom_team::{self, CustomTeamSpec};

/// Plain inputs for [`build_new_game_world`]: everything the Flow C world
/// assembly needs, with no Tauri handle involved.
pub(crate) struct NewGameWorldInputs<'a> {
    /// Resolved base `data/` directory holding the competition files.
    pub data_dir: &'a Path,
    /// Every scanned competition manifest (legacy ones are skipped).
    pub manifests: &'a [CompetitionManifest],
    /// Competition of the chosen team (only used for logging).
    pub competition_id: &'a str,
    /// Team the manager picks; its lineup is auto-filled.
    pub team_id: &'a str,
    /// Roster overlay to bring the bundled snapshot up to date, if any.
    pub overlay: Option<&'a WorldOverlay>,
    /// A club the manager created. When set, `team_id` is the slot it replaces.
    pub custom_team: Option<&'a CustomTeamSpec>,
}

/// Day a new game starts: the season after the roster snapshot in use (the
/// overlay, or the bundled one when none was resolved). Keeps the legacy start
/// only when no snapshot date can be read at all.
pub(crate) fn new_game_start_for(overlay: Option<&WorldOverlay>) -> chrono::DateTime<chrono::Utc> {
    let as_of = match overlay {
        Some(overlay) => Some(overlay.as_of.clone()),
        None => olm_core::world_overlay::bundled_world_overlay()
            .ok()
            .map(|bundled| bundled.as_of),
    };
    game_setup::new_game_start_date(as_of.as_deref())
}

/// Flow C world setup, free of Tauri I/O: assemble teams, players and staff
/// from the modular data, apply the roster overlay, make every Main team
/// playable and auto-fill the user team's lineup. Returns the id of the user's
/// team: `team_id`, or the id of the custom club that replaced it.
pub(crate) fn build_new_game_world(
    game: &mut Game,
    inputs: &NewGameWorldInputs<'_>,
) -> Result<String, String> {
    // The new game starts in the season after the roster snapshot, so ages,
    // contracts and the schedule all line up with that year.
    game.clock = GameClock::new(new_game_start_for(inputs.overlay));

    // Assemble teams, players, staff from modular data
    let (assembled_teams, assembled_players, assembled_staff) = assemble_world_from_modular_data(
        inputs.data_dir,
        inputs.manifests,
        inputs.competition_id,
        inputs.team_id,
        game.clock.current_date.date_naive(),
    )?;

    game.teams = assembled_teams;
    game.players = assembled_players;
    game.staff = assembled_staff;

    // Bring the bundled snapshot up to date before lineups are built from it.
    if let Some(overlay) = inputs.overlay {
        apply_roster_overlay(game, overlay);
    }

    // The custom club takes its slot after the overlay (so roster moves into the
    // replaced club are released with the rest) and before the fill (so it is
    // filled from the released players and the free-agent pool like any club).
    let user_team_id = match inputs.custom_team {
        Some(spec) => install_custom_club(game, inputs, spec)?,
        None => inputs.team_id.to_string(),
    };

    // The overlay can leave a team short; make every Main team playable.
    fill_short_rosters(game);
    if inputs.custom_team.is_some() {
        ensure_custom_club_roster(game, &user_team_id)?;
    }

    // Whoever is still without a team (including players detached as orphans) starts
    // contract-free with no stale seed wage; their ask comes from the wage scale.
    let cleared = game_setup::clear_free_agent_contracts(&mut game.players);
    info!("[game] {} free agents start without a contract or wage", cleared);

    // Rostered players the data ships without a wage get one from the LEC wage scale.
    seed_missing_wages(game);

    // Everyone on a team now is a resident of that team's league region; only
    // later signings can be imports.
    let grandfathered = olm_core::residency::grandfather_rostered_players(game);
    olm_core::residency::refresh_import_flags(game);
    info!("[game] grandfathered residency for {} rostered players", grandfathered);

    auto_fill_user_lineup(game, &user_team_id);
    eprintln!(
        "[select_team] AFTER assembly: staff.len={}",
        game.staff.len()
    );
    Ok(user_team_id)
}

/// Replace `inputs.team_id` with the custom club and return the new club's id.
///
/// The backend is the authority on eligibility: the target competition's merged
/// manifest must allow custom clubs, whatever the UI offered.
fn install_custom_club(
    game: &mut Game,
    inputs: &NewGameWorldInputs<'_>,
    spec: &CustomTeamSpec,
) -> Result<String, String> {
    let allowed = inputs
        .manifests
        .iter()
        .find(|manifest| manifest.id == inputs.competition_id)
        .is_some_and(custom_team::custom_team_allowed);
    if !allowed {
        return Err(format!(
            "Competition '{}' does not accept custom clubs",
            inputs.competition_id
        ));
    }
    let outcome = custom_team::replace_team_with_custom(
        game,
        inputs.competition_id,
        inputs.team_id,
        spec,
    )?;
    info!(
        "[game] custom club {} replaces {}: {} players and {} staff released",
        outcome.team_id,
        inputs.team_id,
        outcome.released_player_ids.len(),
        outcome.released_staff_ids.len()
    );
    Ok(outcome.team_id)
}

/// Fail unless the custom club covers the five roles with players under
/// contract on the game's current date; the roster fill should guarantee it.
fn ensure_custom_club_roster(game: &Game, team_id: &str) -> Result<(), String> {
    let today = game.clock.current_date.date_naive();
    let covered = |role: LolRole| {
        game.players.iter().any(|player| {
            player.team_id.as_deref() == Some(team_id)
                && player.natural_position == role
                && player
                    .contract_end
                    .as_deref()
                    .and_then(|end| chrono::NaiveDate::parse_from_str(end, "%Y-%m-%d").ok())
                    .is_some_and(|end| end >= today)
        })
    };
    if ROLES.iter().all(|role| covered(*role)) {
        Ok(())
    } else {
        Err("The custom club could not be given a full roster".to_string())
    }
}

/// A custom club can only be created while the world is still empty; once teams
/// exist the pick is a plain team selection.
fn reject_custom_team_on_built_world(
    game: &Game,
    custom_team: Option<&CustomTeamSpec>,
) -> Result<(), String> {
    if custom_team.is_some() && !game.teams.is_empty() {
        return Err("A custom club can only be created for a new career".to_string());
    }
    Ok(())
}

/// Seed the wage of every rostered wage-0 player and log how many budgeted teams
/// needed their seeded wages scaled down to fit.
fn seed_missing_wages(game: &mut Game) -> Vec<wage_scale::TeamWageSeed> {
    let reports = wage_scale::seed_missing_wages(&mut game.players, &game.teams, &game.staff);
    let seeded: usize = reports.iter().map(|report| report.seeded_players).sum();
    let over_budget = reports.iter().filter(|r| r.over_budget_before()).count();
    let scaled = reports.iter().filter(|r| r.scale_factor.is_some()).count();
    info!(
        "[game] seeded {} missing wages across {} teams ({} over budget before scaling, {} scaled down)",
        seeded,
        reports.len(),
        over_budget,
        scaled
    );
    reports
}

/// The five roles a playable lineup covers.
const ROLES: [LolRole; 5] = [
    LolRole::Top,
    LolRole::Jungle,
    LolRole::Mid,
    LolRole::Adc,
    LolRole::Support,
];

/// Auto-populate the active lineup for the user's team, one player per role.
fn auto_fill_user_lineup(game: &mut Game, team_id: &str) {
    let roles = ROLES;
    if let Some(user_team) = game.teams.iter_mut().find(|t| t.id == team_id) {
        let mut used = std::collections::HashSet::new();
        let mut missing_roles = Vec::new();
        let lineup: Vec<String> = roles
            .iter()
            .map(|role| {
                let candidates: Vec<&str> = game
                    .players
                    .iter()
                    .filter(|p| {
                        p.team_id.as_deref() == Some(team_id)
                            && !used.contains(&p.id)
                            && (p.position == *role || p.natural_position == *role)
                    })
                    .map(|p| p.id.as_str())
                    .collect();
                candidates
                    .first()
                    .map(|id| {
                        used.insert(id.to_string());
                        id.to_string()
                    })
                    .unwrap_or_else(|| {
                        missing_roles.push(format!("{:?}", role));
                        String::new()
                    })
            })
            .collect();
        if !missing_roles.is_empty() {
            warn!(
                "[select_team] auto_lineup: missing players for roles: {:?}",
                missing_roles
            );
        }
        if lineup.iter().all(|id| !id.is_empty()) {
            // Best valid five: never more than the allowed imports.
            user_team.active_lineup_ids = olm_core::residency::limit_lineup_ids_for(
                olm_core::residency::team_region(user_team),
                &game.players,
                team_id,
                lineup,
            );
            info!(
                "[select_team] active_lineup_ids set to {:?}",
                user_team.active_lineup_ids
            );
        } else {
            warn!(
                "[select_team] auto_lineup incomplete ({}/5 roles filled), setting empty lineup — user must configure manually",
                roles.len() - missing_roles.len()
            );
            user_team.active_lineup_ids = vec![];
        }
    }
}

type AssembledWorld = (Vec<Team>, Vec<Player>, Vec<Staff>);

/// Assemble teams, players, and staff from modular competition data files.
/// Used by Flow C: the game was created lightweight (empty teams/players),
/// and now we need to load the selected competition's data.
pub(crate) fn assemble_world_from_modular_data(
    data_dir: &Path,
    manifests: &[CompetitionManifest],
    competition_id: &str,
    team_id: &str,
    start_date: chrono::NaiveDate,
) -> Result<AssembledWorld, String> {
    info!(
        "[game] assemble_world_from_modular_data: competition={}, team_id={}",
        competition_id, team_id
    );

    // Initialize shared resource directory for static functions.
    olm_core::state::RESOURCE_DATA_DIR.get_or_init(|| data_dir.to_path_buf());

    // 1. Load every non-legacy competition's team + player + staff
    let mut all_teams: Vec<Team> = Vec::new();
    // Players tagged with the competition they came from, so stale duplicates can lose.
    let mut tagged_players: Vec<(String, Player)> = Vec::new();
    let mut staff = olm_core::competitions::load_staff_free_agents(data_dir)?;

    for manifest in manifests.iter().filter(|m| !m.legacy) {
        let cid = &manifest.id;
        let prefix = format!("{}-", cid);

        match olm_core::competitions::load_teams(data_dir, manifest) {
            Ok(mut comp_teams) => {
                for team in &mut comp_teams {
                    if !team.id.starts_with(&prefix) {
                        team.id = format!("{}{}", prefix, team.id);
                    }
                    team.competition_id = Some(cid.to_string());
                }
                all_teams.extend(comp_teams);
            }
            Err(err) => {
                eprintln!("[game] FAILED to load teams for '{}': {}", cid, err);
                info!("[game] FAILED to load teams for '{}': {}", cid, err);
            }
        }
        let player_count_before = tagged_players.len();
        match olm_core::competitions::load_players(data_dir, manifest) {
            Ok(comp_players) => {
                for mut player in comp_players {
                    if let Some(ref tid) = player.team_id.clone() {
                        if tid != "fa" && tid != "freeagent" && !tid.starts_with(&prefix) {
                            player.team_id = Some(format!("{}-{}", cid, tid));
                        }
                    }
                    if player.morale == 0 {
                        player.morale = 68;
                    }
                    if player.condition == 0 {
                        player.condition = 100;
                    }
                    tagged_players.push((cid.to_string(), player));
                }
            }
            Err(err) => {
                info!("[game] FAILED to load players for '{}': {}", cid, err);
            }
        }
        let loaded = tagged_players.len() - player_count_before;
        info!("[game] loaded {} players for '{}'", loaded, cid);

        // Load competition staff
        let staff_count_before = staff.len();
        eprintln!(
            "[game] loading staff for '{}': staff_file={:?}",
            cid, manifest.staff_file
        );
        match olm_core::competitions::load_staff(data_dir, manifest) {
            Ok(comp_staff) => {
                eprintln!("[game] loaded {} staff for '{}'", comp_staff.len(), cid);
                for mut s in comp_staff {
                    if let Some(ref tid) = s.team_id.clone() {
                        if !tid.starts_with(&prefix) {
                            s.team_id = Some(format!("{}-{}", cid, tid));
                        }
                    }
                    staff.push(s);
                }
            }
            Err(err) => {
                eprintln!("[game] FAILED to load staff for '{}': {}", cid, err);
                info!("[game] FAILED to load staff for '{}': {}", cid, err);
            }
        }
        let loaded_staff = staff.len() - staff_count_before;
        eprintln!("[game] total staff count after '{}': {}", cid, staff.len());
        info!("[game] loaded {} staff for '{}'", loaded_staff, cid);
    }

    // Fill the metadata gaps the read-only data ships with (country, finances, budgets)
    // before rosters and wages are seeded, so the budgets are visible to both.
    let filled = olm_core::team_overrides::bundled().apply_all(&mut all_teams);
    info!("[game] team overrides filled {} teams", filled);

    // Resolve ids shipped twice (stale duplicate competitions), then fix known field errors.
    let (mut all_players, dropped_duplicates) = world_catalog::dedupe_players(tagged_players);
    for dup in &dropped_duplicates {
        info!(
            "[game] duplicate player {}: dropped the '{}' record, kept '{}'",
            dup.player_id, dup.dropped_from, dup.kept_from
        );
    }
    let correction_report = world_catalog::apply_catalog_corrections(
        &mut all_players,
        &world_catalog::bundled_catalog_corrections(),
    );
    info!(
        "[game] catalog corrections applied: {} ({} skipped)",
        correction_report.applied,
        correction_report.skipped.len()
    );

    // 2. Bootstrap academy seeds from ERL catalog (JSON or legacy .txt fallback)
    let academy_bootstrap_date = start_date.format("%Y-%m-%d").to_string();
    let pre_count = all_teams.len();
    game_setup::bootstrap_example_academy_pool_from_example(
        &mut all_teams,
        &mut all_players,
        &academy_bootstrap_date,
    );
    let academy_count = all_teams.len() - pre_count;
    if academy_count > 0 {
        info!(
            "[game] bootstrapped {} academy teams from ERL catalog",
            academy_count
        );
    }
    game_setup::remove_free_agents_shadowed_by_academy(&mut all_players, &all_teams);

    // 4. Inject free agent players from JSON
    game_setup::inject_json_free_agents(&mut all_players);

    // 5. Apply default contract ends (and keep contracts over by the start date alive)
    let contracts = game_setup::apply_default_initial_contract_end(&mut all_players, start_date);
    info!(
        "[game] contract ends: {} filled, {} extended to the end of the {} season",
        contracts.filled,
        contracts.extended,
        start_date.year()
    );

    // 6. Players shipped with every attribute at exactly 50 have no rating data: estimate
    // them from their league and role (free agents at an amateur level). This must run
    // before market values and wages are seeded so both follow the estimated OVR.
    let estimated =
        olm_core::placeholder_ratings::estimate_placeholder_ratings(&mut all_players, &all_teams);
    info!(
        "[game] estimated ratings for {} rostered and {} free-agent placeholder players",
        estimated.rostered, estimated.free_agents
    );

    // 7. Recalculate market_value for players who have 0 (data issue in regional leagues)
    game_setup::apply_default_market_values(&mut all_players);

    // Players on teams that do not exist (stale copies) become free agents.
    let detached = world_catalog::detach_orphaned_players(&mut all_players, &all_teams);
    if !detached.is_empty() {
        info!(
            "[game] {} players referenced unknown teams and became free agents",
            detached.len()
        );
    }

    // DEBUG: count staff by team_id
    {
        use std::collections::HashMap;
        let mut by_team: HashMap<&str, usize> = HashMap::new();
        for s in &staff {
            match s.team_id.as_deref() {
                None => {
                    *by_team.entry("(free agent)").or_insert(0) += 1;
                }
                Some(tid) => {
                    *by_team.entry(tid).or_insert(0) += 1;
                }
            }
        }
        info!("[game] STAFF BREAKDOWN:");
        for (tid, count) in &by_team {
            info!("[game]   {}: {}", tid, count);
        }
    }

    info!(
        "[game] assemble_world_from_modular_data: {} teams, {} players, {} staff",
        all_teams.len(),
        all_players.len(),
        staff.len()
    );

    Ok((all_teams, all_players, staff))
}

/// Pick the roster overlay a new game starts from: the newest `as_of` of the
/// bundled overlay and the one downloaded into the app data dir (see
/// `commands::world_overlay`). A malformed overlay must never block a new game,
/// so errors are logged and the game starts from the bundled data alone.
fn resolve_world_overlay(app_handle: &tauri::AppHandle) -> Option<WorldOverlay> {
    super::world_overlay::resolve_overlay_for_new_game(app_handle)
}

/// Apply `overlay` to a freshly assembled world and record it on the game:
/// changed ids are protected from catalog rehydration, retired ids are
/// tombstoned and the overlay date is kept for display.
fn apply_roster_overlay(game: &mut Game, overlay: &WorldOverlay) -> OverlayApplyReport {
    let report = apply_world_overlay(&mut game.teams, &mut game.players, &mut game.staff, overlay);
    // Added players arrive without a contract end or market value.
    game_setup::apply_default_initial_contract_end(
        &mut game.players,
        game.clock.current_date.date_naive(),
    );
    game_setup::apply_default_market_values(&mut game.players);

    game.moved_player_ids
        .extend(report.protected_player_ids().cloned());
    for id in &report.retired_player_ids {
        if !game.retired_player_ids.contains(id) {
            game.retired_player_ids.push(id.clone());
        }
    }
    game.world_overlay_as_of = Some(overlay.as_of.clone());
    info!(
        "[game] roster overlay as of {}: {} ({} skipped)",
        overlay.as_of,
        report,
        report.skipped.len()
    );
    report
}

/// Fill roles the assembled world left empty on every Main team and protect the
/// filled players from catalog rehydration reverting them.
fn fill_short_rosters(game: &mut Game) -> Vec<roster_stability::NewGameRosterFill> {
    let fills = roster_stability::fill_new_game_rosters(game);
    game.moved_player_ids
        .extend(fills.iter().map(|fill| fill.player_id.clone()));
    if !fills.is_empty() {
        let generated = fills.iter().filter(|fill| fill.generated).count();
        let teams = fills
            .iter()
            .map(|fill| fill.team_id.as_str())
            .collect::<std::collections::BTreeSet<_>>()
            .len();
        info!(
            "[game] filled {} short roster slot(s) across {} team(s) ({} generated)",
            fills.len(),
            teams,
            generated
        );
    }
    fills
}

/// What the season setup resolved for the follow-up welcome messages.
pub(crate) struct NewGameSeason {
    pub team_name: String,
    pub user_competition_id: Option<String>,
    pub season_year: i32,
}

/// Ids of the non-legacy competitions; a new game cannot start without any.
fn known_competition_ids(manifests: &[CompetitionManifest]) -> Result<Vec<String>, String> {
    let ids: Vec<String> = manifests
        .iter()
        .filter(|m| !m.legacy)
        .map(|m| m.id.clone())
        .collect();
    if ids.is_empty() {
        return Err(
            "No active competition manifests available; cannot select a team safely".to_string(),
        );
    }
    Ok(ids)
}

/// Season setup for a world that already holds its teams and players, free of
/// Tauri I/O: validate the chosen team, hire the manager, generate every
/// competition's calendar and bootstrap champions and season context.
pub(crate) fn prepare_new_game_season(
    game: &mut Game,
    manifests: &[CompetitionManifest],
    known_competition_ids: &[String],
    team_id: &str,
) -> Result<NewGameSeason, String> {
    // Validate team exists
    let team = game
        .teams
        .iter()
        .find(|t| t.id == team_id)
        .ok_or("Team not found".to_string())?;
    if team.team_kind == TeamKind::Academy {
        return Err("Academy teams cannot be selected as manager team".to_string());
    }
    let team_name = team.name.clone();

    // Assign manager to team
    game.manager.hire(team_id.to_string());
    if let Some(t) = game.teams.iter_mut().find(|t| t.id == team_id) {
        t.manager_id = Some(game.manager.id.clone());
    }

    // Generate schedules for ALL competitions
    let season_year = game.clock.current_date.year();
    let user_cid = competition_id_from_team_id_known(team_id, known_competition_ids);
    let mut all_leagues: Vec<olm_core::domain::league::League> = Vec::new();

    for manifest in manifests.iter().filter(|m| !m.legacy) {
        let cid = &manifest.id;
        let team_ids: Vec<String> = game
            .teams
            .iter()
            .filter(|team| {
                team.team_kind != TeamKind::Academy
                    && team.competition_id.as_deref() == Some(cid.as_str())
            })
            .map(|team| team.id.clone())
            .collect();

        if team_ids.len() < 2 {
            continue;
        }

        let schedule_config = &manifest.schedule;
        // Competitions whose manifest has no schedule splits (e.g. several
        // legacy/ERL leagues) cannot generate a calendar — skip them instead
        // of indexing into an empty `splits` vec and panicking.
        if schedule_config.splits.is_empty() {
            log::warn!(
                "[game] skipping schedule for '{}' — manifest has no schedule splits",
                cid
            );
            continue;
        }
        let mut league = olm_core::schedule::generate_schedule_from_config(
            manifest,
            season_year as u32,
            &team_ids,
            0,
        );

        // Generate preseason friendlies for ALL competitions
        let today = game.clock.current_date.format("%Y-%m-%d").to_string();
        let split = &schedule_config.splits[0];
        let season_start = chrono::Utc
            .with_ymd_and_hms(
                season_year,
                split.season_start.month,
                split.season_start.day,
                0,
                0,
                0,
            )
            .single()
            .unwrap_or(
                chrono::Utc
                    .with_ymd_and_hms(season_year, 1, 18, 0, 0, 0)
                    .unwrap(),
            );
        let num_friendlies = schedule_config.preseason_friendlies as usize;
        if num_friendlies > 0 {
            if user_cid == Some(cid.as_str()) {
                // User's competition: only generate friendlies for the user's team
                let opponents: Vec<String> = team_ids
                    .iter()
                    .filter(|tid| tid.as_str() != team_id)
                    .cloned()
                    .collect();
                if !opponents.is_empty() {
                    let mut friendlies = olm_core::schedule::generate_preseason_friendlies(
                        team_id,
                        &opponents,
                        season_start,
                        num_friendlies,
                    );
                    friendlies.retain(|fixture| fixture.date >= today);
                    olm_core::schedule::append_fixtures(&mut league, friendlies);
                }
            } else {
                // Background competitions: generate friendlies for all teams
                for tid in &team_ids {
                    let opponents: Vec<String> = team_ids
                        .iter()
                        .filter(|t| t.as_str() != tid.as_str())
                        .cloned()
                        .collect();
                    if !opponents.is_empty() {
                        let mut friendlies = olm_core::schedule::generate_preseason_friendlies(
                            tid,
                            &opponents,
                            season_start,
                            num_friendlies,
                        );
                        friendlies.retain(|fixture| fixture.date >= today);
                        olm_core::schedule::append_fixtures(&mut league, friendlies);
                    }
                }
            }
        }

        league.competition_id = Some(cid.clone());
        league.logo = manifest.logo.clone();
        league.tier = manifest.tier.unwrap_or(0);
        league.active = manifest.active;
        all_leagues.push(league);
    }

    // Populate competition_configs from all manifests for bg season cycling.
    // Clear first so this set always reflects the current non-legacy manifests.
    game.competition_configs.clear();
    for manifest in manifests.iter().filter(|m| !m.legacy) {
        game.competition_configs
            .insert(manifest.id.clone(), (*manifest).clone());
    }

    game.leagues = all_leagues;
    game.user_competition_id = user_cid.map(String::from);
    olm_core::champions::bootstrap_champion_state(game);
    olm_core::season_context::refresh_game_context(game);

    Ok(NewGameSeason {
        team_name,
        user_competition_id: user_cid.map(String::from),
        season_year,
    })
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Step 1 (Flow C / lightweight): Create manager only, no world loaded.
/// Teams, players, staff are empty — they'll be assembled on select_team().
/// Used when the frontend wants to show league/team selection first.
#[tauri::command]
pub async fn start_new_game_lightweight(
    app_handle: tauri::AppHandle,
    state: State<'_, StateManager>,
    nickname: Option<String>,
    first_name: String,
    last_name: String,
    dob: String,
    nationality: String,
) -> Result<String, String> {
    info!(
        "[cmd] start_new_game_lightweight: {} {} (nickname={:?}, nationality={})",
        first_name, last_name, nickname, nationality
    );
    // Validate inputs (same as start_new_game)
    let first_name = first_name.trim().to_string();
    let last_name = last_name.trim().to_string();
    let nickname = nickname.unwrap_or_default().trim().to_string();
    if first_name.is_empty() || last_name.is_empty() {
        return Err("First name and last name are required.".to_string());
    }
    if first_name.len() > 30 || last_name.len() > 30 {
        return Err("First name and last name must not exceed 30 characters.".to_string());
    }
    if nickname.len() > 20 {
        return Err("Nickname must not exceed 20 characters.".to_string());
    }
    let nationality = nationality.trim().to_string();
    if nationality.is_empty() {
        return Err("Nationality is required.".to_string());
    }

    let start_date = new_game_start_for(resolve_world_overlay(&app_handle).as_ref());

    let birth_date = chrono::NaiveDate::parse_from_str(&dob, "%Y-%m-%d")
        .map_err(|_| "Invalid date of birth. Use YYYY-MM-DD format.".to_string())?;
    let age = game_setup::calculate_age_on_date(birth_date, start_date.date_naive());
    if age > 99 {
        return Err("Invalid date of birth.".to_string());
    }

    let mut manager = Manager::new(
        "mgr_user".to_string(),
        first_name,
        last_name,
        dob,
        nationality,
    );
    manager.nickname = nickname;

    let clock = GameClock::new(start_date);

    // Empty world — will be assembled on select_team()
    let new_game = Game::new(clock, manager, vec![], vec![], vec![], vec![]);

    info!("[cmd] start_new_game_lightweight: manager created (no world), storing game in state");
    state.set_game(new_game);
    state.set_stats_state(StatsState::default());
    info!("[cmd] start_new_game_lightweight: completed");
    Ok("ok".to_string())
}

/// Step 2: User picks a team. Assigns manager, generates welcome message, saves to DB.
/// Supports both Flow A (world pre-loaded) and Flow C (modular assembly).
#[tauri::command]
pub async fn select_team(
    state: State<'_, StateManager>,
    sm_state: State<'_, SaveManagerState>,
    app_handle: tauri::AppHandle,
    team_id: String,
    lang: Option<String>,
    custom_team: Option<CustomTeamSpec>,
) -> Result<Game, String> {
    let lang = lang.unwrap_or_else(|| "en".to_string());
    info!("[cmd] select_team: team_id={}, lang={}", team_id, lang);
    // Work on a clone: the session only changes through `set_game` at the very end, so
    // any `Err` below leaves the empty world in place and the pick can be retried.
    let mut game = state
        .get_game(|g: &Game| g.clone())
        .ok_or("No active game session".to_string())?;
    reject_custom_team_on_built_world(&game, custom_team.as_ref())?;

    // Detect flow: if game has no teams, this is Flow C (modular assembly)
    eprintln!(
        "[select_team] teams.is_empty={}, staff.len={}",
        game.teams.is_empty(),
        game.staff.len()
    );

    let all_manifests = crate::commands::competitions::scan_competitions(&app_handle);
    let known_competition_ids = known_competition_ids(&all_manifests)?;

    // With a custom club, `team_id` named the slot it replaces; from here on it is the
    // user's actual team.
    let team_id = if game.teams.is_empty() {
        info!("[cmd] select_team: empty game state — assembling from modular data");

        // Extract competition ID from team ID (e.g. "lec-g2" → "lec")
        let competition_id = competition_id_from_team_id_known(&team_id, &known_competition_ids)
            .ok_or_else(|| {
                format!(
                    "Invalid team ID format '{}': missing competition prefix",
                    team_id
                )
            })?;

        // Use the same multi-tier resolution as the rest of the data layer so the
        // Tauri `_up_/data` install layout is handled correctly.
        olm_core::state::RESOURCE_DATA_DIR.get_or_init(|| {
            crate::commands::competitions::resolve_data_base(&app_handle)
                .unwrap_or_else(|| PathBuf::from("data"))
        });
        let data_dir = crate::commands::competitions::require_data_base(&app_handle)?;
        let overlay = resolve_world_overlay(&app_handle);

        build_new_game_world(
            &mut game,
            &NewGameWorldInputs {
                data_dir: &data_dir,
                manifests: &all_manifests,
                competition_id,
                team_id: &team_id,
                overlay: overlay.as_ref(),
                custom_team: custom_team.as_ref(),
            },
        )?
    } else {
        team_id
    };

    let NewGameSeason {
        team_name,
        user_competition_id,
        season_year,
    } = prepare_new_game_season(&mut game, &all_manifests, &known_competition_ids, &team_id)?;
    let user_cid = user_competition_id.as_deref();

    // Rich templated messages
    let date_str = game.clock.current_date.to_rfc3339();

    // Get league name for messages
    let league_display_name = user_cid
        .and_then(|cid| {
            crate::commands::competitions::load_competition_manifest(&app_handle, cid).ok()
        })
        .map(|m| {
            format!(
                "{} {}",
                m.name,
                m.schedule
                    .splits
                    .first()
                    .map(|s| s.name.as_str())
                    .unwrap_or("")
            )
        })
        .unwrap_or_else(|| "Competition.error".to_string());

    // Initialize message template store
    {
        // Look for messages root directory (to find senders)
        let msg_root_candidates = [std::env::current_dir()
                .ok()
                .map(|d| d.join("data").join("messages")),
            std::env::current_dir()
                .ok()
                .map(|d| d.join("../data").join("messages")),
            std::env::current_dir()
                .ok()
                .map(|d| d.join("src-tauri/data").join("messages"))];
        let mut messages_root = None;
        for path in msg_root_candidates.iter().flatten() {
            if path.is_dir() {
                messages_root = Some(path.clone());
                break;
            }
        }

        // Look for triggers/ subdirectory inside messages root
        let triggers_candidates = [messages_root.as_ref().map(|p| p.join("triggers"))];
        for path in triggers_candidates.iter().flatten() {
            if path.is_dir() {
                let result = olm_core::messages::template_store::init_template_store(path);
                eprintln!("[template_store] init from {:?}: {:?}", path, result);
                break;
            }
        }

        // Initialize senders store under data/messages/senders/
        if let Some(msg_dir) = &messages_root {
            let senders_dir = msg_dir.join("senders");
            if senders_dir.is_dir() {
                olm_core::messages::template_store::init_senders_store(&senders_dir);
                eprintln!("[senders_store] init from {:?}", senders_dir);
            }
        }
    }

    let welcome_msg = olm_core::messages::welcome_message(&team_name, &team_id, &date_str, &lang);
    game.messages.push(welcome_msg);

    if let Some(parent_team) = game.teams.iter().find(|team| team.id == team_id) {
        if let Some(academy_team_id) = parent_team.academy_team_id.as_deref() {
            if let Some(academy_team) = game.teams.iter().find(|team| team.id == academy_team_id) {
                let academy_roster_count = game
                    .players
                    .iter()
                    .filter(|player| player.team_id.as_deref() == Some(academy_team_id))
                    .count();
                game.messages.push(game_setup::academy_overview_message(
                    parent_team,
                    academy_team,
                    academy_roster_count,
                    &date_str,
                ));
            }
        }
    }

    // For schedule message, compute the season start (ISO) from the user competition manifest or fallback
    let season_start_str = if let Some(cid) = user_cid {
        if let Ok(m) = crate::commands::competitions::load_competition_manifest(&app_handle, cid) {
            if let Some(split) = m.schedule.splits.first() {
                format!(
                    "{:04}-{:02}-{:02}",
                    season_year, split.season_start.month, split.season_start.day
                )
            } else {
                format!("{season_year:04}-01-18")
            }
        } else {
            format!("{season_year:04}-01-18")
        }
    } else {
        format!("{season_year:04}-01-18")
    };

    let season_msg = olm_core::messages::season_schedule_message(
        &league_display_name,
        &season_start_str,
        &date_str,
    );
    game.messages.push(season_msg);

    let team_names: Vec<String> = game
        .teams
        .iter()
        .filter(|team| {
            team.team_kind != TeamKind::Academy && team.competition_id.as_deref() == user_cid
        })
        .map(|team| team.name.clone())
        .collect();
    game.news.push(olm_core::news::season_preview_article(
        &team_names,
        &date_str,
    ));

    let staff_msg = olm_core::messages::staff_advice_message(&team_name, &team_id, &date_str);
    game.messages.push(staff_msg);

    olm_core::player_events::generate_contract_concern_messages(&mut game, false);

    // Save to new per-save DB
    let manager_name = game.manager.display_name();
    let save_name = format!("{}'s Career", manager_name);

    let mut sm = sm_state
        .0
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    let save_id = sm.create_save(&game, &save_name)?;
    state.set_save_id(save_id);

    eprintln!(
        "[select_team] BEFORE return: staff.len={}",
        game.staff.len()
    );
    state.set_game(game.clone());
    state.set_stats_state(StatsState::default());
    Ok(crate::client_game::game_for_client(&game))
}

#[tauri::command]
pub async fn get_saves(sm_state: State<'_, SaveManagerState>) -> Result<Vec<SaveEntry>, String> {
    log::debug!("[cmd] get_saves");
    let sm = sm_state
        .0
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    Ok(sm.list_saves().to_vec())
}

#[tauri::command]
pub async fn delete_save(
    sm_state: State<'_, SaveManagerState>,
    save_id: String,
) -> Result<bool, String> {
    info!("[cmd] delete_save: save_id={}", save_id);
    let mut sm = sm_state
        .0
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    sm.delete_save(&save_id)
}

#[tauri::command]
pub async fn load_game(
    state: State<'_, StateManager>,
    sm_state: State<'_, SaveManagerState>,
    app_handle: tauri::AppHandle,
    save_id: String,
) -> Result<String, String> {
    info!("[cmd] load_game: save_id={}", save_id);

    let mut sm = sm_state
        .0
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;

    info!("[cmd] load_game: loading game data from save");

    // Initialize shared resource directory so static catalog functions
    // (academy, game_setup) can find bundled data in production builds.
    olm_core::state::RESOURCE_DATA_DIR.get_or_init(|| {
        crate::commands::competitions::resolve_data_base(&app_handle)
            .unwrap_or_else(|| PathBuf::from("data"))
    });

    let mut game = sm.load_game(&save_id)?;
    let rehydrated = crate::commands::import::rehydrate_game_from_catalog(&app_handle, &mut game);
    if rehydrated.total() > 0 {
        info!(
            "[cmd] load_game: rehydrated {} missing teams, {} players, {} reassigned players, {} staff from catalog",
            rehydrated.teams, rehydrated.players, rehydrated.players_reassigned, rehydrated.staff
        );
    }
    info!(
        "[cmd] load_game: game loaded, players={}, teams={}, staff={}",
        game.players.len(),
        game.teams.len(),
        game.staff.len()
    );

    // Repopulate competition_configs from current manifests. Saves created
    // before the ScheduleConfig -> CompetitionManifest migration lose their
    // legacy-shaped entries during lenient deserialization; rebuilding here
    // (as new-game setup does) keeps the config set correct and complete.
    // Clear first so stale keys from older saves do not survive.
    let scanned_manifests: Vec<_> = crate::commands::competitions::scan_competitions(&app_handle)
        .into_iter()
        .filter(|manifest| !manifest.legacy)
        .collect();
    let known_competition_ids: Vec<String> = scanned_manifests
        .iter()
        .map(|manifest| manifest.id.clone())
        .collect();
    if !known_competition_ids.is_empty() {
        game.competition_configs.clear();
        for manifest in &scanned_manifests {
            game.competition_configs
                .insert(manifest.id.clone(), manifest.clone());
        }

        // Clear any legacy/unknown competition references so loading a save does
        // not silently point active-league resolution at missing data. Use the
        // freshly scanned manifests as the source of truth so stale config keys
        // from older saves cannot survive as valid references.
        sanitize_competition_references(&mut game, &known_competition_ids);
    } else {
        warn!(
            "[cmd] load_game: no current competition manifests found; preserving saved competition configs and references"
        );
    }

    // Bootstrap champion state so the Champions tab has data
    info!("[cmd] load_game: bootstrapping champion state...");
    olm_core::champions::bootstrap_champion_state(&mut game);
    // Refresh lol_ovr for all players (it's stored as 0 in the save DB)
    for player in &mut game.players {
        player.lol_ovr = olm_core::potential::calculate_lol_ovr(player);
    }
    info!(
        "[cmd] load_game: champion_patch.hidden_meta={}, champion_masteries={}",
        game.champion_patch.hidden_meta.len(),
        game.champion_masteries.len()
    );

    // Run load migration repair: ensure all AI teams are match eligible
    // after catalog rehydration and OVR refresh. Only persists when actions occur
    // to avoid unnecessary save mutations on clean loads.
    match roster_stability::repair_league(
        &mut game,
        roster_stability::RosterStabilityReason::LoadMigration,
    ) {
        Ok(reports) => {
            let total_actions: usize = reports.iter().map(|r| r.actions.len()).sum();
            if total_actions > 0 {
                info!(
                    "[cmd] load_game: load migration repaired {} team(s) with {} action(s)",
                    reports.len(),
                    total_actions
                );
            }
        }
        Err(e) => {
            warn!(
                "[cmd] load_game: load migration repair failed for team {}: {}",
                e.team_id, e
            );
        }
    }

    info!("[cmd] load_game: setting state");
    let mgr_name = game.manager.display_name();
    state.set_save_id(save_id);
    state.set_game(game);
    state.set_stats_state(StatsState::default());
    info!("[cmd] load_game: state set, returning manager name");

    Ok(mgr_name)
}

#[tauri::command]
pub async fn get_active_game(
    state: State<'_, StateManager>,
    app_handle: tauri::AppHandle,
) -> Result<Game, String> {
    log::info!("[cmd] get_active_game: start");
    let mut game = state.get_game(|g: &Game| g.clone()).ok_or_else(|| {
        log::error!("[cmd] get_active_game: no active game in state");
        "No active game session".to_string()
    })?;
    let rehydrated = crate::commands::import::rehydrate_game_from_catalog(&app_handle, &mut game);
    if rehydrated.total() > 0 {
        log::info!(
            "[cmd] get_active_game: rehydrated {} missing teams, {} players, {} reassigned players, {} staff from catalog",
            rehydrated.teams,
            rehydrated.players,
            rehydrated.players_reassigned,
            rehydrated.staff
        );
        state.set_game(game.clone());
    }
    log::info!(
        "[cmd] get_active_game: found game with {} players, {} teams, {} staff",
        game.players.len(),
        game.teams.len(),
        game.staff.len()
    );

    // Refresh can happen after manifests changed on disk; sanitize competition
    // references so the active game does not silently point at removed leagues.
    let known_competition_ids: Vec<String> =
        crate::commands::competitions::scan_competitions(&app_handle)
            .into_iter()
            .filter(|m| !m.legacy)
            .map(|m| m.id)
            .collect();
    let sanitized = sanitize_competition_references(&mut game, &known_competition_ids);
    if rehydrated.total() > 0 || sanitized {
        state.set_game(game.clone());
    }

    log::info!("[cmd] get_active_game: bootstrapping champion state...");
    olm_core::champions::bootstrap_champion_state(&mut game);
    // Refresh lol_ovr for all players (it's stored as 0 in the save DB)
    for player in &mut game.players {
        player.lol_ovr = olm_core::potential::calculate_lol_ovr(player);
    }
    log::info!(
        "[cmd] get_active_game: champion_patch.hidden_meta={}, champion_masteries={}",
        game.champion_patch.hidden_meta.len(),
        game.champion_masteries.len()
    );

    // Run load migration repair after catalog rehydration and OVR refresh.
    // Only persists to state when the report contains actual repair actions.
    match roster_stability::repair_league(
        &mut game,
        roster_stability::RosterStabilityReason::LoadMigration,
    ) {
        Ok(reports) => {
            let total_actions: usize = reports.iter().map(|r| r.actions.len()).sum();
            if total_actions > 0 {
                log::info!(
                    "[cmd] get_active_game: load migration repaired {} team(s) with {} action(s)",
                    reports.len(),
                    total_actions
                );
                state.set_game(game.clone());
            }
        }
        Err(e) => {
            log::warn!(
                "[cmd] get_active_game: load migration repair failed for team {}: {}",
                e.team_id,
                e
            );
        }
    }

    Ok(crate::client_game::game_for_client(&game))
}

#[tauri::command]
pub async fn get_champions() -> Result<Vec<olm_core::domain::champion::Champion>, String> {
    let raw = include_str!("../../../assets/draft/champion-list.json");
    let list: olm_core::champions::ChampionListFile = serde_json::from_str(raw)
        .map_err(|e| format!("Failed to parse champion-list.json: {e}"))?;
    let catalog: Vec<olm_core::domain::champion::Champion> = list
        .champions
        .into_iter()
        .enumerate()
        .map(|(i, entry)| {
            let champion_key = entry.id.clone();
            olm_core::domain::champion::Champion {
                id: (i + 1) as i64,
                name: entry.name,
                champion_key: entry.id,
                roles_json: serde_json::to_string(&entry.tags).unwrap_or_default(),
                counterpicks_json: None,
                synergies_json: None,
                image_tile_url: Some(format!("/champion-tiles/{}.webp", champion_key)),
                image_splash_url: Some(format!("/champion-splash/{}.jpg", champion_key)),
            }
        })
        .collect();
    log::info!("[cmd] get_champions: embedded {} champions", catalog.len());
    Ok(catalog)
}

#[tauri::command]
pub async fn get_team_selection_data(
    state: State<'_, StateManager>,
) -> Result<TeamSelectionData, String> {
    log::debug!("[cmd] get_team_selection_data");
    state
        .get_game(|game| TeamSelectionData {
            manager: game.manager.clone(),
            teams: game
                .teams
                .iter()
                .filter(|team| team.team_kind != TeamKind::Academy)
                .cloned()
                .collect(),
            players: game.players.clone(),
        })
        .ok_or("No active game session".to_string())
}

#[tauri::command]
pub async fn save_game(
    state: State<'_, StateManager>,
    sm_state: State<'_, SaveManagerState>,
) -> Result<(), String> {
    info!("[cmd] save_game");
    let mut game = state
        .get_game(|g: &Game| g.clone())
        .ok_or("No active game session".to_string())?;

    let save_id = state
        .get_save_id()
        .ok_or("No active save session".to_string())?;

    // Sync stats_state from session back into game before saving
    let stats_state = state
        .get_stats_state(|stats| stats.clone())
        .unwrap_or_default();
    game.stats_state = stats_state;

    let mut sm = sm_state
        .0
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    sm.save_game(&game, &save_id)
}

/// Save the current game and clear the active session so the player returns to the main menu.
#[tauri::command]
pub async fn exit_to_menu(
    state: State<'_, StateManager>,
    sm_state: State<'_, SaveManagerState>,
) -> Result<(), String> {
    info!("[cmd] exit_to_menu");
    let game = state
        .get_game(|g: &Game| g.clone())
        .ok_or("No active game session")?;

    // Auto-save
    if let Some(save_id) = state.get_save_id() {
        let mut game = game;
        let stats_state = state
            .get_stats_state(|stats| stats.clone())
            .unwrap_or_default();
        game.stats_state = stats_state;

        let mut sm = sm_state
            .0
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        sm.save_game(&game, &save_id)?;
    }

    // Clear the in-memory game state
    state.clear_game();
    state.clear_save_id();

    Ok(())
}

/// Diagnostic: verify the current set of know.enums is consistent.
#[tauri::command]
pub fn debug_serde_test() -> Result<String, String> {
    Ok("debug ok".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use olm_core::domain::player::PlayerAttributes;

    fn test_game() -> Game {
        let teams = ["t-a", "t-b"]
            .iter()
            .map(|id| {
                Team::new(
                    id.to_string(),
                    id.to_string(),
                    "TST".to_string(),
                    "KR".to_string(),
                    "Seoul".to_string(),
                    "Arena".to_string(),
                    1_000,
                )
            })
            .collect();
        let players = [("mover", "t-a"), ("retiree", "t-a")]
            .iter()
            .map(|(id, team_id)| {
                let mut player = Player::new(
                    id.to_string(),
                    id.to_string(),
                    id.to_string(),
                    "2000-01-01".to_string(),
                    "KR".to_string(),
                    LolRole::Mid,
                    PlayerAttributes::default(),
                );
                player.team_id = Some(team_id.to_string());
                player
            })
            .collect();
        let clock = GameClock::new(chrono::Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap());
        let manager = Manager::new(
            "mgr".to_string(),
            "Test".to_string(),
            "Manager".to_string(),
            "1980-01-01".to_string(),
            "KR".to_string(),
        );
        Game::new(clock, manager, teams, players, vec![], vec![])
    }

    fn overlay() -> WorldOverlay {
        WorldOverlay::parse(
            r#"{"schemaVersion":1,"as_of":"2026-11-07",
                "source":{"name":"Leaguepedia","license":"CC BY-SA 3.0","license_url":"https://www.fandom.com/licensing"},
                "players":[
                  {"op":"move","id":"mover","team_id":"t-b"},
                  {"op":"retire","id":"retiree"},
                  {"op":"add","player":{"id":"rookie","match_name":"Rookie","full_name":"Rookie",
                    "position":"Top","team_id":"t-b","contract_end":"","date_of_birth":"2005-01-01"}}
                ]}"#,
        )
        .expect("test overlay")
    }

    #[test]
    fn roster_overlay_is_recorded_on_the_game() {
        let mut game = test_game();

        apply_roster_overlay(&mut game, &overlay());

        assert_eq!(game.world_overlay_as_of.as_deref(), Some("2026-11-07"));
        assert_eq!(game.retired_player_ids, vec!["retiree".to_string()]);
        assert!(game.moved_player_ids.contains("mover"));
        assert!(game.moved_player_ids.contains("rookie"));
        assert!(!game.moved_player_ids.contains("retiree"));
    }

    #[test]
    fn short_roster_fill_tracks_filled_players_as_moved() {
        let mut game = test_game();
        let mut free_agent = Player::new(
            "fa-top".to_string(),
            "fa-top".to_string(),
            "fa-top".to_string(),
            "2000-01-01".to_string(),
            "KR".to_string(),
            LolRole::Top,
            PlayerAttributes::default(),
        );
        free_agent.team_id = None;
        game.players.push(free_agent);

        let fills = fill_short_rosters(&mut game);

        assert!(!fills.is_empty());
        for fill in &fills {
            assert!(game.moved_player_ids.contains(&fill.player_id));
        }
        assert!(fills.iter().any(|fill| fill.player_id == "fa-top"));
    }

    #[test]
    fn roster_overlay_gives_added_players_a_contract_and_market_value() {
        let mut game = test_game();

        apply_roster_overlay(&mut game, &overlay());

        let rookie = game.players.iter().find(|p| p.id == "rookie").unwrap();
        assert!(rookie.contract_end.is_some());
        assert!(rookie.market_value > 0);
    }

    /// End-to-end new game with the real `data/` catalog and the bundled overlay.
    ///
    /// `select_team` needs a Tauri `AppHandle` and `State`, so the AppHandle-free world setup
    /// lives in `build_new_game_world`, which this test calls directly: modular data assembly,
    /// roster overlay, short-roster fill and the user lineup auto-fill. It then does a real
    /// `.olsave` round trip plus the `load_game` catalog rehydration
    /// (`reassign_stale_player_teams` + `merge_missing_players`).
    mod bundled_overlay_new_game {
        use super::*;
        use olm_core::db::save_manager::SaveManager;
        use std::collections::{HashMap, HashSet};

        const ROLES: [LolRole; 5] = [
            LolRole::Top,
            LolRole::Jungle,
            LolRole::Mid,
            LolRole::Adc,
            LolRole::Support,
        ];
        const ICE_ID: &str = "lec-player-105501834624360050";

        fn data_base() -> PathBuf {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("data")
        }

        fn player_named<'a>(game: &'a Game, name: &str) -> Vec<&'a Player> {
            game.players.iter().filter(|p| p.match_name == name).collect()
        }

        fn team_id_by_name(game: &Game, name: &str) -> String {
            let found: Vec<_> = game.teams.iter().filter(|t| t.name == name).collect();
            assert_eq!(found.len(), 1, "expected exactly one team named {name}");
            found[0].id.clone()
        }

        /// A new game built by the same `build_new_game_world` that `select_team` runs,
        /// returning the pre-overlay catalog the way `load_game` assembles it.
        fn new_game() -> (Game, Vec<Player>, WorldOverlay, String) {
            new_game_as("Kiwoom DRX", None)
        }

        /// [`new_game`] with the manager taking over the catalog team called `team_name`; pass
        /// `team_id` when the name is shared by teams of several leagues.
        fn new_game_as(team_name: &str, team_id: Option<&str>) -> (Game, Vec<Player>, WorldOverlay, String) {
            let data = data_base();
            let manifests = olm_core::competitions::scan_competitions(&data.join("competitions"));
            let (catalog_teams, catalog, _staff) =
                assemble_world_from_modular_data(
                    &data,
                    &manifests,
                    "",
                    "",
                    chrono::NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
                )
                .expect("catalog");
            let user_team = {
                let found: Vec<_> = catalog_teams
                    .iter()
                    .filter(|t| t.name == team_name && team_id.is_none_or(|id| t.id == id)).collect();
                assert_eq!(found.len(), 1, "expected exactly one team named {team_name}");
                found[0].id.clone()
            };
            let (game, overlay, user_team) =
                try_build_world(&user_team, None).expect("build new game world");
            (game, catalog, overlay, user_team)
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

        /// What `select_team` does for an empty session, minus the Tauri handle: build the
        /// world around `slot_id` (replaced by `custom` when given) and return the resolved
        /// user team id.
        fn try_build_world(
            slot_id: &str,
            custom: Option<&CustomTeamSpec>,
        ) -> Result<(Game, WorldOverlay, String), String> {
            let mut game = empty_session();
            let overlay = olm_core::world_overlay::bundled_world_overlay().expect("bundled overlay");
            let team_id = build_world_into(&mut game, &overlay, slot_id, custom)?;
            Ok((game, overlay, team_id))
        }

        fn build_world_into(
            game: &mut Game,
            overlay: &WorldOverlay,
            slot_id: &str,
            custom: Option<&CustomTeamSpec>,
        ) -> Result<String, String> {
            let data = data_base();
            let (manifests, known_ids) = known_ids_and_manifests();
            let competition_id = competition_id_from_team_id_known(slot_id, &known_ids)
                .expect("competition prefix");
            build_new_game_world(
                game,
                &NewGameWorldInputs {
                    data_dir: &data,
                    manifests: &manifests,
                    competition_id,
                    team_id: slot_id,
                    overlay: Some(overlay),
                    custom_team: custom,
                },
            )
        }

        fn duplicate_player_ids(players: &[Player]) -> HashSet<String> {
            let mut counts: HashMap<&str, usize> = HashMap::new();
            for p in players {
                *counts.entry(p.id.as_str()).or_default() += 1;
            }
            counts
                .into_iter()
                .filter(|(_, n)| *n > 1)
                .map(|(id, _)| id.to_string())
                .collect()
        }

        fn annual_bill(game: &Game, team_id: &str) -> i64 {
            olm_core::contract_wage_policy::annual_team_wage_bill(game, team_id)
        }

        fn known_ids_and_manifests() -> (Vec<CompetitionManifest>, Vec<String>) {
            let manifests =
                olm_core::competitions::scan_competitions(&data_base().join("competitions"));
            let known = manifests
                .iter()
                .filter(|m| !m.legacy)
                .map(|m| m.id.clone())
                .collect();
            (manifests, known)
        }

        /// A user promoted from the LES to the LEC at a season wrap keeps the LEC after the
        /// save is written and read back through the load path: the save round trip, catalog
        /// rehydration, the rebuilt competition configs and the reference sanitising.
        #[test]
        fn a_promoted_user_stays_in_the_lec_through_save_and_load() {
            use olm_core::domain::league::StandingEntry;
            use olm_core::ladder::SeasonOutcome;

            const USER: &str = "les-team-ac846213";
            let (mut game, catalog_players, _overlay, user_team) =
                new_game_as("UB Alma Mater", Some(USER));
            let (manifests, known) = known_ids_and_manifests();
            prepare_new_game_season(&mut game, &manifests, &known, &user_team).expect("season setup");
            // Early enough that both rebuilt calendars start after the clock.
            game.clock = GameClock::new(chrono::Utc.with_ymd_and_hms(2025, 12, 1, 0, 0, 0).unwrap());

            let season = les_league(&game).season;
            let lec_ids: Vec<String> = game
                .leagues
                .iter()
                .find(|l| l.competition_id.as_deref() == Some("lec"))
                .map(|l| l.standings.iter().map(|s| s.team_id.clone()).collect())
                .expect("the LEC has a league");
            let les_ids: Vec<String> =
                les_league(&game).standings.iter().map(|s| s.team_id.clone()).collect();
            let mut les_order = vec![USER.to_string()];
            les_order.extend(les_ids.iter().filter(|id| id.as_str() != USER).cloned());
            let relegated = lec_ids[0].clone();
            let mut table: Vec<StandingEntry> = lec_ids
                .iter()
                .enumerate()
                .map(|(rank, id)| {
                    let mut row = StandingEntry::new(id.clone());
                    row.points = 3 * (rank as u32 + 1);
                    row
                })
                .collect();
            table.reverse();
            game.ladder.outcomes = vec![
                SeasonOutcome {
                    competition_id: "les".to_string(),
                    season: season - 1,
                    champion_id: Some(USER.to_string()),
                    final_order: les_order,
                    season_table: vec![],
                },
                SeasonOutcome {
                    competition_id: "lec".to_string(),
                    season: season - 1,
                    champion_id: None,
                    final_order: lec_ids.clone(),
                    season_table: table,
                },
            ];
            let configs = game.competition_configs.clone();
            let applied = olm_core::ladder_apply::apply_ladders(&mut game, &configs);
            assert_eq!(applied.len(), 1, "the swap applies");
            assert_eq!(applied[0].promoted, vec![USER.to_string()]);
            assert_eq!(applied[0].relegated, vec![relegated.clone()]);
            assert_eq!(game.user_competition_id.as_deref(), Some("lec"));

            let dir = tempfile::tempdir().expect("tempdir");
            let mut manager = SaveManager::init(dir.path()).expect("save manager");
            let save_id = manager.create_save(&game, "promoted").expect("create save");
            let mut loaded = manager.load_game(&save_id).expect("load save");

            // The same steps `load_game` runs after reading the file.
            let data = data_base();
            let scanned = olm_core::competitions::scan_competitions(&data.join("competitions"));
            let (catalog_teams, _players, catalog_staff) = assemble_world_from_modular_data(
                &data,
                &scanned,
                "",
                "",
                chrono::NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
            )
            .expect("catalog");
            crate::commands::import::apply_catalog_to_game(
                &mut loaded,
                catalog_teams,
                catalog_players,
                catalog_staff,
            );
            let current: Vec<_> = scanned.into_iter().filter(|m| !m.legacy).collect();
            let known_now: Vec<String> = current.iter().map(|m| m.id.clone()).collect();
            loaded.competition_configs.clear();
            for manifest in &current {
                loaded.competition_configs.insert(manifest.id.clone(), manifest.clone());
            }
            sanitize_competition_references(&mut loaded, &known_now);

            let team_competition = |id: &str| {
                loaded.teams.iter().find(|t| t.id == id).and_then(|t| t.competition_id.clone())
            };
            assert_eq!(loaded.user_competition_id.as_deref(), Some("lec"));
            assert_eq!(team_competition(USER).as_deref(), Some("lec"));
            assert_eq!(team_competition(&relegated).as_deref(), Some("les"));
            let active = loaded.active_league().expect("active league");
            assert_eq!(active.competition_id.as_deref(), Some("lec"));
            assert!(active.standings.iter().any(|s| s.team_id == USER));
            assert!(active.standings.iter().all(|s| s.team_id != relegated));
            assert!(
                loaded.competition_configs.get("les").is_some_and(|m| m.promotion.is_some()),
                "the ladder link is read from the current manifests"
            );
            assert_eq!(loaded.ladder.movements.len(), 1);
        }

        #[test]
        fn les_clubs_without_metadata_get_it_from_team_overrides_and_seeded_wages() {
            let (game, _, _, _) = new_game();
            let gxi = game.teams.iter().find(|t| t.id == "les-team-854f6893").expect("GiantX Itero");
            let uam = game.teams.iter().find(|t| t.id == "les-team-ac846213").expect("UB Alma Mater");
            assert_eq!((gxi.country.as_str(), gxi.city.as_str(), gxi.reputation), ("ES", "Madrid", 315));
            assert_eq!((gxi.finance, gxi.wage_budget, gxi.transfer_budget), (1_960_000, 980_000, 392_000));
            assert_eq!((uam.country.as_str(), uam.city.as_str(), uam.reputation), ("ES", "Barcelona", 300));
            assert_eq!((uam.finance, uam.wage_budget, uam.transfer_budget), (2_600_000, 1_300_000, 520_000));
            for club in [gxi, uam] {
                let roster: Vec<_> = game
                    .players
                    .iter()
                    .filter(|p| p.team_id.as_deref() == Some(club.id.as_str()))
                    .collect();
                assert!(!roster.is_empty(), "{} has a roster", club.name);
                assert!(roster.iter().all(|p| p.wage > 0), "{} players have seeded wages", club.name);
            }
        }

        #[test]
        fn every_les_season_wage_bill_fits_its_wage_budget() {
            let (game, _, _, _) = new_game();
            for team in game.teams.iter().filter(|t| t.competition_id.as_deref() == Some("les")) {
                let bill = annual_bill(&game, &team.id);
                assert!(
                    bill <= team.wage_budget,
                    "{}: bill {bill} exceeds wage budget {}",
                    team.name,
                    team.wage_budget
                );
            }
        }

        #[test]
        fn new_game_replaces_flat_fifty_ratings_and_prices_them_from_the_new_ovr() {
            let (game, _catalog, _overlay, _user) = new_game();

            let flat: Vec<_> = game
                .players
                .iter()
                .filter(|p| olm_core::placeholder_ratings::is_placeholder_rating(p))
                .map(|p| p.id.as_str())
                .collect();
            assert!(flat.is_empty(), "flat-50 placeholders survived: {flat:?}");

            for name in ["Werlyb", "Elmillor"] {
                let found = player_named(&game, name);
                assert_eq!(found.len(), 1, "expected exactly one {name}");
                let player = found[0];
                assert!(player.team_id.is_none(), "{name} is a free agent");
                let ovr = olm_core::potential::calculate_lol_ovr(player);
                assert!((40..=45).contains(&ovr), "{name} OVR {ovr}");
                assert_eq!(
                    player.market_value,
                    game_setup::suggested_seed_market_value(
                        ovr,
                        player.potential_base.max(ovr),
                        false
                    ),
                    "{name} market value must follow the estimated OVR"
                );
            }
        }

        #[test]
        fn new_game_free_agents_have_no_contract_and_no_stale_wage() {
            let (game, _catalog, _overlay, _user) = new_game();

            let free_agents: Vec<_> = game.players.iter().filter(|p| p.team_id.is_none()).collect();
            assert!(!free_agents.is_empty(), "the world ships free agents");
            for player in free_agents {
                assert_eq!(player.contract_end, None, "{} has a contract", player.id);
                assert_eq!(player.wage, 0, "{} keeps a stale wage", player.id);
            }
        }

        #[test]
        fn new_game_starts_on_january_first_of_the_season_after_the_snapshot() {
            let (game, _catalog, overlay, _user) = new_game();

            let expected = game_setup::new_game_start_date(Some(&overlay.as_of));
            assert_eq!(game.clock.current_date, expected);
            assert_eq!(game.clock.start_date, expected);
            assert_eq!(
                (game.clock.current_date.month(), game.clock.current_date.day()),
                (1, 1)
            );
            assert!(
                game.clock.current_date.year() > 2026,
                "the bundled snapshot is dated {}",
                overlay.as_of
            );
        }

        #[test]
        fn new_game_schedule_is_generated_for_the_start_year() {
            let (mut game, _catalog, _overlay, user_team) = new_game();
            let (manifests, known) = known_ids_and_manifests();
            let year = game.clock.current_date.year();

            let season = prepare_new_game_season(&mut game, &manifests, &known, &user_team)
                .expect("season setup");

            assert_eq!(season.season_year, year);
            assert!(!game.leagues.is_empty());
            let today = game.clock.current_date.format("%Y-%m-%d").to_string();
            for league in &game.leagues {
                assert_eq!(league.season as i32, year, "{} season", league.id);
                assert!(!league.fixtures.is_empty(), "{} has fixtures", league.id);
                let first = league.fixtures.iter().map(|f| f.date.as_str()).min().unwrap();
                assert!(
                    first >= today.as_str(),
                    "{} schedules {first} before the start {today}",
                    league.id
                );
                assert!(
                    first.starts_with(&year.to_string()),
                    "{} starts on {first}, not in {year}",
                    league.id
                );
            }
        }

        #[test]
        fn new_game_has_no_expired_contract_at_the_start_date() {
            let (game, _catalog, _overlay, _user) = new_game();
            let today = game.clock.current_date.date_naive();

            let expired: Vec<&str> = game
                .players
                .iter()
                .filter(|p| p.team_id.is_some())
                .filter(|p| {
                    p.contract_end
                        .as_deref()
                        .and_then(|d| chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())
                        .is_none_or(|end| end <= today)
                })
                .map(|p| p.match_name.as_str())
                .collect();

            assert!(expired.is_empty(), "{} rostered players start expired", expired.len());
        }

        #[test]
        fn new_game_leaves_no_player_of_a_budgeted_team_without_a_wage() {
            let (game, _catalog, _overlay, _user) = new_game();
            let budgeted: HashSet<&str> = game
                .teams
                .iter()
                .filter(|t| t.wage_budget > 0)
                .map(|t| t.id.as_str())
                .collect();

            let unpaid: Vec<&str> = game
                .players
                .iter()
                .filter(|p| p.wage == 0 && p.team_id.as_deref().is_some_and(|t| budgeted.contains(t)))
                .map(|p| p.match_name.as_str())
                .collect();

            assert!(unpaid.is_empty(), "{} budgeted-team players have wage 0", unpaid.len());
        }

        #[test]
        fn new_game_does_not_charge_wages_to_teams_without_a_wage_budget() {
            let (game, catalog, _overlay, _user) = new_game();
            let authored: HashMap<&str, u32> =
                catalog.iter().map(|p| (p.id.as_str(), p.wage)).collect();

            let shells: Vec<&str> = game
                .teams
                .iter()
                .filter(|t| t.wage_budget == 0 && t.finance == 0)
                .map(|t| t.id.as_str())
                .collect();
            assert!(!shells.is_empty(), "the data ships shell teams");
            let seeded: Vec<&str> = game
                .players
                .iter()
                .filter(|p| p.team_id.as_deref().is_some_and(|t| shells.contains(&t)))
                .filter(|p| authored.get(p.id.as_str()).is_some_and(|wage| *wage == 0 && p.wage > 0))
                .map(|p| p.match_name.as_str())
                .collect();

            assert!(seeded.is_empty(), "{} shell-team players were seeded", seeded.len());
        }

        #[test]
        fn new_game_keeps_authored_wages() {
            let (game, catalog, _overlay, _user) = new_game();

            let authored: HashMap<&str, u32> = catalog
                .iter()
                .filter(|p| p.wage > 0)
                .map(|p| (p.id.as_str(), p.wage))
                .collect();
            let changed = game
                .players
                .iter()
                // Free agents start at wage 0 on purpose (see clear_free_agent_contracts).
                .filter(|p| p.team_id.is_some())
                .filter(|p| authored.get(p.id.as_str()).is_some_and(|wage| *wage != p.wage))
                .count();

            assert_eq!(changed, 0, "seeding must not touch authored wages");
        }

        #[test]
        fn new_game_seeding_never_pushes_a_team_over_its_wage_budget() {
            let (game, catalog, _overlay, _user) = new_game();
            let unpaid_in_catalog: HashSet<&str> = catalog
                .iter()
                .filter(|p| p.wage == 0)
                .map(|p| p.id.as_str())
                .collect();

            // A budgeted team may still be over only when all its seeded players are already
            // at the minimum seeded wage (the budget cannot cover even that, or the authored
            // wages alone exceed it).
            let mut by_league: std::collections::BTreeMap<String, (usize, usize)> =
                std::collections::BTreeMap::new();
            let mut offenders = Vec::new();
            for team in game.teams.iter().filter(|t| t.wage_budget > 0) {
                let bill = annual_bill(&game, &team.id);
                let league = team.id.split('-').next().unwrap_or("").to_string();
                let entry = by_league.entry(league).or_default();
                entry.0 += 1;
                if bill <= team.wage_budget {
                    continue;
                }
                entry.1 += 1;
                let can_still_shrink = game.players.iter().any(|p| {
                    p.team_id.as_deref() == Some(team.id.as_str())
                        && unpaid_in_catalog.contains(p.id.as_str())
                        && p.wage > wage_scale::MIN_SEEDED_WAGE
                });
                if can_still_shrink {
                    offenders.push(format!("{} bill {bill} budget {}", team.id, team.wage_budget));
                }
            }
            eprintln!("budgeted teams / still over budget, by league: {by_league:?}");

            assert!(offenders.is_empty(), "teams over budget after seeding: {offenders:?}");
        }

        #[test]
        fn gumayusi_asks_about_half_a_million_a_year() {
            let (game, _catalog, _overlay, _user) = new_game();
            let gumayusi = player_named(&game, "Gumayusi");
            assert_eq!(gumayusi.len(), 1);
            let star = gumayusi[0];
            let team = game
                .teams
                .iter()
                .find(|t| Some(t.id.as_str()) == star.team_id.as_deref())
                .expect("Gumayusi has a team");

            let wage = olm_core::contracts::expected_wage(
                star,
                team,
                game.clock.current_date.date_naive(),
            );

            assert!((450_000..=550_000).contains(&wage), "expected wage {wage}");
        }

        #[test]
        fn koi_wage_budget_cannot_fit_five_top_ovr_stars() {
            let (game, _catalog, _overlay, _user) = new_game();
            let koi = game
                .teams
                .iter()
                .find(|t| t.id == "lec-movistar-koi")
                .expect("KOI exists");
            let mut ranked: Vec<&Player> = game.players.iter().collect();
            ranked.sort_by_key(|p| std::cmp::Reverse(olm_core::potential::calculate_lol_ovr(p)));
            let date = game.clock.current_date.date_naive();

            let five_stars: i64 = ranked
                .iter()
                .take(5)
                .map(|p| i64::from(olm_core::contracts::expected_wage(p, koi, date)))
                .sum();

            assert!(
                five_stars > koi.wage_budget,
                "five stars cost {five_stars}, KOI budget {}",
                koi.wage_budget
            );
        }

        #[test]
        fn new_game_reflects_bundled_overlay_and_every_team_is_playable() {
            let (game, catalog, overlay, user_team) = new_game();

            let drx = user_team.clone();
            let kt = team_id_by_name(&game, "KT Rolster");
            let vitality = team_id_by_name(&game, "Team Vitality");

            assert_eq!(game.world_overlay_as_of.as_deref(), Some(overlay.as_of.as_str()));

            let aiming = player_named(&game, "Aiming");
            assert_eq!(aiming.len(), 1);
            assert_eq!(aiming[0].team_id.as_deref(), Some(drx.as_str()));
            // "Jiwoo" is also the name of a Challengers player, so look for the one on KT.
            let jiwoo_on_kt = player_named(&game, "Jiwoo")
                .into_iter()
                .filter(|p| p.team_id.as_deref() == Some(kt.as_str()))
                .count();
            assert_eq!(jiwoo_on_kt, 1);

            assert!(catalog.iter().any(|p| p.id == ICE_ID), "Ice must exist in the catalog");
            assert!(game.players.iter().all(|p| p.id != ICE_ID));
            assert!(game.retired_player_ids.iter().any(|id| id == ICE_ID));

            let pad: Vec<_> = game
                .staff
                .iter()
                .filter(|s| s.nickname == "Pad" && s.team_id.as_deref() == Some(vitality.as_str()))
                .collect();
            assert_eq!(pad.len(), 1);
            assert_eq!(pad[0].role, olm_core::domain::staff::StaffRole::Coach);

            let mut by_team: HashMap<&str, Vec<&Player>> = HashMap::new();
            for p in &game.players {
                if let Some(tid) = p.team_id.as_deref() {
                    by_team.entry(tid).or_default().push(p);
                }
            }
            let mut gaps = Vec::new();
            let mut main_teams = 0;
            for team in game
                .teams
                .iter()
                .filter(|t| t.team_kind == TeamKind::Main && t.competition_id.is_some())
            {
                main_teams += 1;
                let roster = by_team.get(team.id.as_str()).cloned().unwrap_or_default();
                for role in &ROLES {
                    if !roster.iter().any(|p| p.position == *role || p.natural_position == *role) {
                        gaps.push(format!("{} lacks {:?}", team.id, role));
                    }
                }
            }
            assert!(main_teams > 100, "expected a real world, got {main_teams} main teams");
            assert!(gaps.is_empty(), "teams with missing roles: {gaps:?}");

            let team = game.teams.iter().find(|t| t.id == user_team).unwrap();
            assert_eq!(team.active_lineup_ids.len(), 5);
            let unique: HashSet<_> = team.active_lineup_ids.iter().collect();
            assert_eq!(unique.len(), 5);
            for id in &team.active_lineup_ids {
                let p = game.players.iter().find(|p| &p.id == id).unwrap();
                assert_eq!(p.team_id.as_deref(), Some(user_team.as_str()));
            }
        }

        #[test]
        fn new_game_rostered_players_are_residents_and_free_agents_are_not_marked() {
            let (game, _catalog, _overlay, user_team) = new_game();
            assert!(game.residency_initialized);
            for team in game.teams.iter().filter(|t| t.team_kind == TeamKind::Main) {
                let region = olm_core::residency::team_region(team);
                for p in game
                    .players
                    .iter()
                    .filter(|p| p.team_id.as_deref() == Some(team.id.as_str()))
                {
                    assert!(
                        !olm_core::residency::is_import(p, region),
                        "{} must be a resident of {}",
                        p.id,
                        team.id
                    );
                    assert!(!p.is_import);
                }
            }
            assert!(
                game.players
                    .iter()
                    .filter(|p| p.team_id.is_none())
                    .all(|p| p.resident_region.is_none())
            );
            let team = game.teams.iter().find(|t| t.id == user_team).unwrap();
            let lineup: Vec<String> = team.active_lineup_ids.clone();
            assert!(
                olm_core::residency::validate_lineup_imports(&game, &user_team, &lineup).is_ok()
            );
        }

        #[test]
        fn overlay_and_filled_staff_never_dangle_or_duplicate() {
            let (game, _catalog, _overlay, _user_team) = new_game();
            let team_ids: HashSet<&str> = game.teams.iter().map(|t| t.id.as_str()).collect();
            for s in &game.staff {
                if let Some(tid) = s.team_id.as_deref() {
                    assert!(team_ids.contains(tid), "staff {} -> unknown team {tid}", s.id);
                }
            }
            // Players added or moved by the overlay, and players the fill touched, must
            // sit on a real team.
            for p in game.players.iter().filter(|p| game.moved_player_ids.contains(&p.id)) {
                if let Some(tid) = p.team_id.as_deref() {
                    assert!(team_ids.contains(tid), "moved player {} -> unknown team {tid}", p.id);
                }
            }
        }

        /// The `data/` catalog ships players twice (legacy lck_cl/lckcl and prime_league/prm
        /// copies) and players whose team id matches no loaded team; assembly repairs both.
        #[test]
        fn world_has_unique_player_ids_and_no_dangling_team_references() {
            let (game, _catalog, _overlay, _user_team) = new_game();
            let duplicates = duplicate_player_ids(&game.players);
            assert!(duplicates.is_empty(), "duplicate player ids: {duplicates:?}");
            let team_ids: HashSet<&str> = game.teams.iter().map(|t| t.id.as_str()).collect();
            let dangling: Vec<_> = game
                .players
                .iter()
                .filter(|p| p.team_id.as_deref().is_some_and(|t| !team_ids.contains(t)))
                .map(|p| p.id.as_str())
                .collect();
            assert!(dangling.is_empty(), "players on unknown teams: {dangling:?}");
        }

        #[test]
        fn assembly_applies_the_reviewed_catalog_corrections() {
            let (game, catalog, _overlay, _user_team) = new_game();
            for players in [&game.players, &catalog] {
                let oner: Vec<_> = players.iter().filter(|p| p.match_name == "Oner").collect();
                assert_eq!(oner.len(), 1);
                assert_eq!(oner[0].full_name, "Mun Hyeon-jun");
            }
        }

        #[test]
        fn save_and_reload_keep_overlay_results_against_the_catalog() {
            let (game, catalog, overlay, _user_team) = new_game();
            let drx = team_id_by_name(&game, "Kiwoom DRX");
            let kt = team_id_by_name(&game, "KT Rolster");
            let dup_ids = duplicate_player_ids(&game.players);
            let protected: Vec<(String, Option<String>)> = game
                .players
                .iter()
                .filter(|p| game.moved_player_ids.contains(&p.id) && !dup_ids.contains(&p.id))
                .map(|p| (p.id.clone(), p.team_id.clone()))
                .collect();
            assert!(protected.len() > 100, "expected many moved/filled players");

            let dir = tempfile::tempdir().expect("tempdir");
            let mut manager = SaveManager::init(dir.path()).expect("save manager");
            let save_id = manager.create_save(&game, "overlay e2e").expect("create save");
            let mut loaded = manager.load_game(&save_id).expect("load save");

            assert_eq!(loaded.world_overlay_as_of.as_deref(), Some(overlay.as_of.as_str()));
            assert_eq!(loaded.retired_player_ids, game.retired_player_ids);
            assert_eq!(loaded.players.len(), game.players.len());

            // load_game: rehydrate against the pre-overlay catalog.
            let before: Vec<(String, Option<String>)> =
                loaded.players.iter().map(|p| (p.id.clone(), p.team_id.clone())).collect();
            crate::commands::import::reassign_stale_player_teams(&mut loaded, &catalog);
            let added = crate::commands::import::merge_missing_players(&mut loaded, catalog.clone());

            // reassign keeps the player order, so compare position by position.
            for ((id, team), p) in before.iter().zip(&loaded.players) {
                if !dup_ids.contains(id) {
                    assert_eq!(&p.team_id, team, "catalog rehydration moved {id}");
                }
            }
            assert_eq!(added, 0, "retired or already present players must not be backfilled");
            assert!(loaded.players.iter().all(|p| p.id != ICE_ID));
            for id in &game.retired_player_ids {
                assert!(loaded.players.iter().all(|p| &p.id != id), "retired {id} came back");
            }
            let aiming = player_named(&loaded, "Aiming");
            assert_eq!(aiming.len(), 1);
            assert_eq!(aiming[0].team_id.as_deref(), Some(drx.as_str()));
            assert!(player_named(&loaded, "Jiwoo")
                .iter()
                .any(|p| p.team_id.as_deref() == Some(kt.as_str())));
            for (id, team) in protected {
                let p = loaded.players.iter().find(|p| p.id == id).unwrap();
                assert_eq!(p.team_id, team, "moved or filled player {id} reverted");
            }
        }

        /// Plays days with the same `process_day` the app calls until the user's league
        /// is complete (regular season and playoffs), and returns the days it took.
        fn play_until_split_complete(
            game: &mut Game,
            max_days: u32,
            playoffs_played: &mut HashSet<String>,
        ) -> u32 {
            let mut days = 0;
            while !olm_core::end_of_season::is_season_complete(game) {
                assert!(days < max_days, "split not complete after {max_days} days");
                olm_core::turn::process_day(game);
                days += 1;
                note_completed_playoffs(game, playoffs_played);
            }
            days
        }

        /// Records the competitions that have a completed playoff fixture right now. A
        /// league's fixtures are replaced when it rolls, so this has to be sampled daily.
        fn note_completed_playoffs(game: &Game, playoffs_played: &mut HashSet<String>) {
            use olm_core::domain::league::{FixtureStatus, MatchType};
            for league in &game.leagues {
                let Some(competition_id) = league.competition_id.as_deref() else {
                    continue;
                };
                if league.fixtures.iter().any(|f| {
                    f.match_type == MatchType::Playoffs && f.status == FixtureStatus::Completed
                }) {
                    playoffs_played.insert(competition_id.to_string());
                }
            }
        }

        fn les_league(game: &Game) -> &olm_core::domain::league::League {
            game.leagues
                .iter()
                .find(|l| l.competition_id.as_deref() == Some("les"))
                .expect("the LES has a league")
        }

        fn assert_les_players_are_paid_or_free(game: &Game) {
            let les_clubs: HashSet<&str> = game
                .teams
                .iter()
                .filter(|t| t.competition_id.as_deref() == Some("les"))
                .map(|t| t.id.as_str())
                .collect();
            for player in &game.players {
                if player.team_id.as_deref().is_some_and(|t| les_clubs.contains(t)) {
                    assert!(player.wage > 0, "{} is on an LES roster with wage 0", player.match_name);
                }
            }
        }

        /// An LES career from the real catalog: Winter (28 matches, semis, final, a
        /// champion), then Spring, Summer and the season rollover into the next year.
        #[test]
        #[ignore = "plays three full splits of every league in a debug build (about 7 minutes); run with --ignored"]
        fn an_les_career_plays_a_full_season_from_real_data() {
            use olm_core::domain::league::{FixtureStatus, MatchType};

            let (mut game, _catalog, _overlay, user_team) = new_game_as("Barcelona Esports", Some("les-team-06974122"));
            let (manifests, known) = known_ids_and_manifests();
            let season = prepare_new_game_season(&mut game, &manifests, &known, &user_team)
                .expect("season setup");
            let year = season.season_year;
            assert_eq!(season.user_competition_id.as_deref(), Some("les"));
            assert_eq!(game.user_competition_id.as_deref(), Some("les"));

            let les = les_league(&game);
            assert_eq!(les.split_index, 0);
            assert_eq!(les.fixtures.iter().filter(|f| f.counts_for_league_standings()).count(), 28);
            assert_les_players_are_paid_or_free(&game);

            // Winter.
            let mut playoffs_played = HashSet::new();
            play_until_split_complete(&mut game, 120, &mut playoffs_played);
            let les = les_league(&game);
            let regular: Vec<_> = les.fixtures.iter().filter(|f| f.counts_for_league_standings()).collect();
            assert_eq!(regular.len(), 28);
            assert!(regular.iter().all(|f| f.status == FixtureStatus::Completed));
            let playoffs: Vec<_> = les.fixtures.iter().filter(|f| f.match_type == MatchType::Playoffs).collect();
            assert_eq!(playoffs.len(), 3, "two semifinals and a final");
            assert!(playoffs.iter().all(|f| f.id.starts_with("po4-") && f.best_of == 5));
            assert!(playoffs.iter().all(|f| f.status == FixtureStatus::Completed));
            assert!(
                olm_core::end_of_season::playoff_champion_id(les).is_some(),
                "Winter has a champion"
            );

            // Winter rolls into Spring; Spring and Summer follow, then the season rolls over.
            for expected_split in 1..3 {
                let outcome = olm_core::season_rollover::advance_season(&mut game);
                assert!(!outcome.was_season_end);
                assert_eq!(les_league(&game).split_index, expected_split);
                assert_eq!(les_league(&game).season as i32, year);
                play_until_split_complete(&mut game, 150, &mut playoffs_played);
                assert!(olm_core::end_of_season::playoff_champion_id(les_league(&game)).is_some());
            }
            let outcome = olm_core::season_rollover::advance_season(&mut game);
            assert!(outcome.was_season_end);

            // Next season: still an LES career, in the second tier.
            assert_eq!(game.user_competition_id.as_deref(), Some("les"));
            let les = les_league(&game);
            assert_eq!(les.season as i32, year + 1);
            assert_eq!(les.split_index, 0);
            assert_eq!(les.tier, 2);
            assert_eq!(les.standings.len(), 8);
            let today = game.clock.current_date.format("%Y-%m-%d").to_string();
            let first = les.fixtures.iter().map(|f| f.date.as_str()).min().expect("fixtures");
            assert!(first > today.as_str(), "Winter fixtures {first} are not after {today}");
            assert!(game.manager.team_id.is_some(), "the manager kept the job");

            for id in ["les-team-854f6893", "les-team-ac846213"] {
                let club = game.teams.iter().find(|t| t.id == id).expect("LES club");
                assert_ne!(club.finance, 0, "{} has finances", club.name);
            }
            assert_les_players_are_paid_or_free(&game);

            // Background leagues run their own playoffs and roll on their own. The LEC is
            // mid-Summer of the same season the LES just closed, so it has rolled twice.
            assert!(
                playoffs_played.contains("lec"),
                "the LEC never played playoffs in the background"
            );
            let lec = game
                .leagues
                .iter()
                .find(|l| l.competition_id.as_deref() == Some("lec"))
                .expect("the LEC has a league");
            assert_eq!(lec.season as i32, year);
            assert_eq!(lec.split_index, 2, "the LEC is in its third split");

            // The ladder ledger is ready: the LES season is closed with a champion, a full
            // final order and a summed table, and the LEC carries both closed splits.
            let outcome = game
                .ladder
                .outcome("les", year as u32)
                .expect("the LES season is in the ledger");
            assert!(outcome.champion_id.is_some());
            assert_eq!(outcome.final_order.len(), 8);
            assert_eq!(outcome.season_table.len(), 8);
            assert!(
                outcome.season_table.iter().all(|row| row.played == 3 * 7),
                "the season table sums all three splits of 7 matches per team"
            );
            let lec_tally = game
                .ladder
                .tallies
                .get("lec")
                .expect("the LEC has a running tally");
            assert_eq!(lec_tally.season as i32, year);
            assert_eq!(lec_tally.splits, 2);

            // A one-split background league closed its season through the daily roll.
            let prime = game
                .ladder
                .outcome("prime_league", year as u32)
                .expect("the Prime League season is in the ledger");
            assert!(prime.champion_id.is_some());
            assert_eq!(prime.final_order.len(), prime.season_table.len());
        }

        // -- Custom club (B3) ---------------------------------------------------------

        /// UB Alma Mater, an LES main club the tests replace.
        const LES_SLOT: &str = "les-team-ac846213";
        const LEC_SLOT: &str = "lec-movistar-koi";

        fn rayo() -> CustomTeamSpec {
            CustomTeamSpec {
                name: "Rayo Esports".to_string(),
                short_name: "RAY".to_string(),
                primary_color: "#f97316".to_string(),
                secondary_color: "#111111".to_string(),
                country: "ES".to_string(),
            }
        }

        fn custom_game() -> (Game, String) {
            let (game, _overlay, id) =
                try_build_world(LES_SLOT, Some(&rayo())).expect("custom club world");
            (game, id)
        }

        fn roster_ids(game: &Game, team_id: &str) -> HashSet<String> {
            game.players
                .iter()
                .filter(|p| p.team_id.as_deref() == Some(team_id))
                .map(|p| p.id.clone())
                .collect()
        }

        fn median(mut values: Vec<i64>) -> i64 {
            values.sort_unstable();
            let mid = values.len() / 2;
            if values.len() % 2 == 1 {
                values[mid]
            } else {
                (values[mid - 1] + values[mid]) / 2
            }
        }

        fn les_peers<'a>(game: &'a Game, custom_id: &str) -> Vec<&'a Team> {
            game.teams
                .iter()
                .filter(|t| {
                    t.competition_id.as_deref() == Some("les")
                        && t.team_kind == TeamKind::Main
                        && t.id != custom_id
                })
                .collect()
        }

        #[test]
        fn custom_club_takes_the_slot_in_the_les_with_a_full_roster() {
            let (mut game, id) = custom_game();

            assert_eq!(id, "les-custom-ray");
            assert!(game.teams.iter().all(|t| t.id != LES_SLOT), "the slot is gone");
            let club = game.teams.iter().find(|t| t.id == id).expect("custom club");
            assert_eq!(club.competition_id.as_deref(), Some("les"));
            assert!(club
                .logo_url
                .as_deref()
                .is_some_and(|logo| logo.starts_with("data:image/svg+xml")));
            assert_eq!(club.active_lineup_ids.len(), 5);
            assert!(ensure_custom_club_roster(&game, &id).is_ok());
            assert_eq!(les_peers(&game, &id).len(), 7);
            assert!(game.manager.team_id.is_none(), "hiring happens in the season setup");

            let (manifests, known) = known_ids_and_manifests();
            let season =
                prepare_new_game_season(&mut game, &manifests, &known, &id).expect("season setup");
            assert_eq!(season.user_competition_id.as_deref(), Some("les"));
            assert_eq!(game.manager.team_id.as_deref(), Some(id.as_str()));
            let les = les_league(&game);
            assert_eq!(les.standings.len(), 8);
                founding_seed: None,
            assert!(les.standings.iter().any(|s| s.team_id == id));
            assert!(les
                .fixtures
                .iter()
                .all(|f| f.home_team_id != LES_SLOT && f.away_team_id != LES_SLOT));
            assert!(les.fixtures.iter().any(|f| f.home_team_id == id || f.away_team_id == id));
        }

        #[test]
        fn custom_club_starts_with_the_median_economy_of_the_other_les_clubs() {
            let (game, id) = custom_game();
            let club = game.teams.iter().find(|t| t.id == id).expect("custom club");
            let peers = les_peers(&game, &id);
            let med = |extract: fn(&Team) -> i64| median(peers.iter().map(|t| extract(t)).collect());

            assert_eq!(club.finance, med(|t| t.finance));
            assert_eq!(club.wage_budget, med(|t| t.wage_budget));
            assert_eq!(club.transfer_budget, med(|t| t.transfer_budget));
            assert_eq!(i64::from(club.reputation), med(|t| i64::from(t.reputation)));
            assert!(club.finance > 0, "the median ignores clubs shipped without finances");
        }

        #[test]
        fn replaced_players_become_free_agents_or_are_refilled_by_a_club() {
            let (plain, _overlay, _) = try_build_world(LES_SLOT, None).expect("plain world");
            let released = roster_ids(&plain, LES_SLOT);
            assert!(!released.is_empty());

            let (game, _id) = custom_game();

            for player_id in &released {
                let player = game.players.iter().find(|p| &p.id == player_id).expect("player kept");
                assert!(game.moved_player_ids.contains(player_id), "{player_id} not protected");
                match player.team_id.as_deref() {
                    // Some club's roster fill may have signed the released player.
                    Some(_) => assert!(player.contract_end.is_some(), "{player_id} signed without a contract"),
                    None => {
                        assert_eq!(player.contract_end, None, "{player_id} keeps a contract");
                        assert_eq!(player.wage, 0, "{player_id} keeps a wage");
                    }
                }
            }
            assert!(game.players.iter().all(|p| p.team_id.as_deref() != Some(LES_SLOT)));
            assert!(game.removed_team_ids.iter().any(|t| t == LES_SLOT));
        }

        #[test]
        fn custom_club_survives_save_round_trip_and_catalog_rehydration() {
            let (game, id) = custom_game();
            let roster = roster_ids(&game, &id);
            assert!(roster.len() >= 5);

            let dir = tempfile::tempdir().expect("tempdir");
            let mut manager = SaveManager::init(dir.path()).expect("save manager");
            let save_id = manager.create_save(&game, "custom club").expect("create save");
            let mut loaded = manager.load_game(&save_id).expect("load save");
            assert!(loaded.teams.iter().any(|t| t.id == id));
            assert!(loaded.removed_team_ids.iter().any(|t| t == LES_SLOT));

            let data = data_base();
            let manifests = olm_core::competitions::scan_competitions(&data.join("competitions"));
            let (catalog_teams, catalog_players, catalog_staff) = assemble_world_from_modular_data(
                &data,
                &manifests,
                "",
                "",
                chrono::NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
            )
            .expect("catalog");
            assert!(catalog_teams.iter().any(|t| t.id == LES_SLOT), "the catalog still has the slot");
            crate::commands::import::apply_catalog_to_game(
                &mut loaded,
                catalog_teams,
                catalog_players,
                catalog_staff,
            );

            assert!(loaded.teams.iter().all(|t| t.id != LES_SLOT), "the replaced club came back");
            assert!(loaded.players.iter().all(|p| p.team_id.as_deref() != Some(LES_SLOT)));
            assert!(loaded.staff.iter().all(|s| s.team_id.as_deref() != Some(LES_SLOT)));
            assert!(loaded.teams.iter().any(|t| t.id == id));
            assert_eq!(roster_ids(&loaded, &id), roster, "rehydration changed the custom roster");
        }

        #[test]
        fn a_top_tier_slot_is_rejected_by_the_backend() {
            let error = try_build_world(LEC_SLOT, Some(&rayo())).expect_err("LEC is tier 1");

            assert!(error.contains("does not accept custom clubs"), "{error}");
        }

        #[test]
        fn duplicate_names_report_the_core_error_strings() {
            let (plain, _overlay, _) = try_build_world(LES_SLOT, None).expect("plain world");
            let lec = plain.teams.iter().find(|t| t.id == LEC_SLOT).expect("LEC club");

            let mut same_name = rayo();
            same_name.name = lec.name.to_lowercase();
            let name_error = try_build_world(LES_SLOT, Some(&same_name)).expect_err("duplicate name");
            assert_eq!(name_error, "Another team already uses this name");

            let other_short = plain
                .teams
                .iter()
                .find(|t| {
                    t.competition_id.as_deref() == Some("lec")
                        && (3..=4).contains(&t.short_name.chars().count())
                        && t.short_name.chars().all(|c| c.is_ascii_alphanumeric())
                })
                .expect("a LEC club with a valid short name");
            let mut same_short = rayo();
            same_short.short_name = other_short.short_name.to_lowercase();
            let short_error =
                try_build_world(LES_SLOT, Some(&same_short)).expect_err("duplicate short name");
            assert_eq!(short_error, "Another team already uses this short name");
        }

        #[test]
        fn a_custom_club_is_refused_once_the_world_is_built() {
            let (built, _overlay, _) = try_build_world(LES_SLOT, None).expect("plain world");
            let spec = rayo();

            assert!(reject_custom_team_on_built_world(&built, Some(&spec)).is_err());
            assert!(reject_custom_team_on_built_world(&built, None).is_ok());
            assert!(reject_custom_team_on_built_world(&empty_session(), Some(&spec)).is_ok());
        }

        /// `select_team` builds the world on a clone of the session and only stores it on
        /// success, so a rejected pick leaves the empty world for the retry.
        #[test]
        fn a_rejected_custom_club_leaves_the_empty_session_for_a_retry() {
            let session = empty_session();
            let overlay = olm_core::world_overlay::bundled_world_overlay().expect("bundled overlay");

            let mut attempt = session.clone();
            let rejected = build_world_into(&mut attempt, &overlay, LEC_SLOT, Some(&rayo()));
            assert!(rejected.is_err());
            assert!(session.teams.is_empty(), "the session must stay the empty world");

            let mut retry = session.clone();
            let id = build_world_into(&mut retry, &overlay, LES_SLOT, Some(&rayo()))
                .expect("retry on an eligible slot");
            assert_eq!(id, "les-custom-ray");
        }

        /// With no free agent left, the custom club is filled with generated players
        /// that still make a playable, affordable five.
        #[test]
        fn custom_club_gets_a_playable_generated_roster_when_the_pool_is_empty() {
            let data = data_base();
            let (manifests, known) = known_ids_and_manifests();
            let overlay = olm_core::world_overlay::bundled_world_overlay().expect("bundled overlay");
            let mut game = empty_session();
            game.clock = GameClock::new(new_game_start_for(Some(&overlay)));
            let (teams, players, staff) = assemble_world_from_modular_data(
                &data,
                &manifests,
                "les",
                LES_SLOT,
                game.clock.current_date.date_naive(),
            )
            .expect("catalog");
            game.teams = teams;
            game.players = players;
            game.staff = staff;
            apply_roster_overlay(&mut game, &overlay);
            let spec = rayo();
            let inputs = NewGameWorldInputs {
                data_dir: &data,
                manifests: &manifests,
                competition_id: competition_id_from_team_id_known(LES_SLOT, &known).expect("les"),
                team_id: LES_SLOT,
                overlay: Some(&overlay),
                custom_team: Some(&spec),
            };
            let id = install_custom_club(&mut game, &inputs, &spec).expect("install");

            game.players.retain(|p| p.team_id.is_some());
            fill_short_rosters(&mut game);

            ensure_custom_club_roster(&game, &id).expect("full roster");
            let club = game.teams.iter().find(|t| t.id == id).expect("club");
            let roster: Vec<&Player> = game
                .players
                .iter()
                .filter(|p| p.team_id.as_deref() == Some(id.as_str()))
                .collect();
            assert_eq!(roster.len(), 5);
            for player in &roster {
                let ovr = olm_core::potential::calculate_lol_ovr(player);
                assert!((30..=70).contains(&ovr), "{} has OVR {ovr}", player.id);
                assert!(player.wage > 0);
            }
            let bill: i64 = roster.iter().map(|p| i64::from(p.wage)).sum();
            assert!(bill <= club.wage_budget, "generated bill {bill} over {}", club.wage_budget);
        }

        /// The median club's reputation sits inside the range of its LES peers, so every
        /// reputation-keyed policy treats it like a regional club, and a month of the
        /// real turn loop (with its first matchdays) runs cleanly for it.
        #[test]
        fn median_reputation_custom_club_behaves_like_a_regional_club() {
            let (mut game, id) = custom_game();
            let (manifests, known) = known_ids_and_manifests();
            prepare_new_game_season(&mut game, &manifests, &known, &id).expect("season setup");

            let club = game.teams.iter().find(|t| t.id == id).expect("club");
            let peers = les_peers(&game, &id);
            let low = peers.iter().map(|t| t.reputation).min().expect("peers");
            let high = peers.iter().map(|t| t.reputation).max().expect("peers");
            assert!((low..=high).contains(&club.reputation));
            assert!(club.reputation < 1_100, "AI strategic recruitment is for tier-1 giants");

            for _ in 0..30 {
                olm_core::turn::process_day(&mut game);
            }

            assert!(ensure_custom_club_roster(&game, &id).is_ok(), "the roster stays playable");
            let club = game.teams.iter().find(|t| t.id == id).expect("club");
            assert!(club.finance > 0);
            assert_eq!(game.manager.team_id.as_deref(), Some(id.as_str()));
            assert!(!game.board_objectives.is_empty(), "the board set objectives");
            let played = les_league(&game)
                .standings
                .iter()
                .find(|s| s.team_id == id)
                .map(|s| s.played)
                .unwrap_or(0);
            assert!(played >= 1, "the custom club played a match");
        }

        // -- Promotion and relegation end to end (C8) ---------------------------------

        /// Headless promotion and relegation with the real LEC and LES: real data, real
        /// calendars, real season wrap. Results are injected instead of simulated so the
        /// checks stay fast: the regular season of each league's final split is filled with
        /// "the better-ranked team wins", and the playoff final is set by hand.
        mod ladder_e2e {
            use super::*;
            use olm_core::domain::league::{Fixture, FixtureStatus, League, MatchResult, MatchType};
            use olm_core::ladder::LadderMovementStatus;
            use olm_core::ladder_report::UserLadderResult;
            use olm_core::roster_stability::{RosterStabilityReason, evaluate_team};

            /// Wins a team needs to take a series of `best_of` maps.
            fn series_wins(best_of: u8) -> u8 {
                best_of / 2 + 1
            }

            fn team<'a>(game: &'a Game, id: &str) -> &'a Team {
                game.teams.iter().find(|t| t.id == id).expect("team")
            }

            fn les_club(game: &Game, name: &str) -> String {
                let found: Vec<_> = game
                    .teams
                    .iter()
                    .filter(|t| t.competition_id.as_deref() == Some("les") && t.name == name)
                    .collect();
                assert_eq!(found.len(), 1, "expected exactly one LES club named {name}");
                found[0].id.clone()
            }

            fn league<'a>(game: &'a Game, competition_id: &str) -> &'a League {
                game.leagues
                    .iter()
                    .find(|l| l.competition_id.as_deref() == Some(competition_id))
                    .expect("league")
            }

            fn members(game: &Game, competition_id: &str) -> Vec<String> {
                league(game, competition_id)
                    .standings
                    .iter()
                    .map(|s| s.team_id.clone())
                    .collect()
            }

            fn sorted_members(game: &Game, competition_id: &str) -> Vec<String> {
                let mut ids = members(game, competition_id);
                ids.sort();
                ids
            }

            fn new_world(slot_id: &str) -> Game {
                let (mut game, _overlay, user_team) =
                    try_build_world(slot_id, None).expect("build new game world");
                let (manifests, known) = known_ids_and_manifests();
                prepare_new_game_season(&mut game, &manifests, &known, &user_team).expect("season setup");
                game
            }

            /// Every member, best first: `first`, `second`, then the rest by id.
            fn strength_order(mut ids: Vec<String>, first: &str, second: &str) -> Vec<String> {
                ids.sort();
                ids.retain(|id| id != first && id != second);
                ids.insert(0, second.to_string());
                ids.insert(0, first.to_string());
                ids
            }

            fn playoff_fixture(
                id: &str,
                matchday: u32,
                date: chrono::NaiveDate,
                home: &str,
                away: &str,
                winner_is_home: bool,
            ) -> Fixture {
                let (home_wins, away_wins) = if winner_is_home { (3, 1) } else { (1, 3) };
                Fixture {
                    id: id.to_string(),
                    matchday,
                    date: date.format("%Y-%m-%d").to_string(),
                    home_team_id: home.to_string(),
                    away_team_id: away.to_string(),
                    match_type: MatchType::Playoffs,
                    best_of: 5,
                    status: FixtureStatus::Completed,
                    result: Some(MatchResult {
                        home_wins,
                        away_wins,
                        ..MatchResult::default()
                    }),
                }
            }

            /// Replaces the league of `competition_id` with the real calendar of its last
            /// split, plays the whole regular season so that `order` (best first) is the
            /// table, and adds a completed playoff in which the second seed beats the first
            /// in the final. The LES gets the full four-team bracket, other leagues just the
            /// final. Returns the date of the last playoff fixture.
            fn finish_final_split(
                game: &mut Game,
                competition_id: &str,
                order: &[String],
            ) -> chrono::NaiveDate {
                let manifest = game
                    .competition_configs
                    .get(competition_id)
                    .cloned()
                    .expect("manifest");
                let index = game
                    .leagues
                    .iter()
                    .position(|l| l.competition_id.as_deref() == Some(competition_id))
                    .expect("league index");
                let last_split = manifest.schedule.splits.len() - 1;
                let previous = game.leagues[index].clone();
                let mut fresh = olm_core::end_of_season::build_split_league(
                    &previous,
                    &manifest,
                    previous.season,
                    last_split,
                    None,
                );
                assert_eq!(fresh.split_index, last_split);
                assert_eq!(fresh.standings.len(), order.len());

                let rank = |id: &str| order.iter().position(|o| o == id).expect("ranked team");
                let mut last_date = chrono::NaiveDate::MIN;
                let mut last_matchday = 0;
                let mut results: Vec<(String, String, u8, u8)> = Vec::new();
                for fixture in fresh.fixtures.iter_mut() {
                    let date =
                        chrono::NaiveDate::parse_from_str(&fixture.date, "%Y-%m-%d").expect("fixture date");
                    last_date = last_date.max(date);
                    last_matchday = last_matchday.max(fixture.matchday);
                    if !fixture.counts_for_league_standings() {
                        continue;
                    }
                    let wins = series_wins(fixture.best_of);
                    let home_better = rank(&fixture.home_team_id) < rank(&fixture.away_team_id);
                    let (home_wins, away_wins) = if home_better { (wins, 0) } else { (0, wins) };
                    fixture.result = Some(MatchResult {
                        home_wins,
                        away_wins,
                        ..MatchResult::default()
                    });
                    fixture.status = FixtureStatus::Completed;
                    results.push((
                        fixture.home_team_id.clone(),
                        fixture.away_team_id.clone(),
                        home_wins,
                        away_wins,
                    ));
                }
                for (home, away, home_wins, away_wins) in results {
                    for standing in &mut fresh.standings {
                        if standing.team_id == home {
                            standing.record_result(home_wins, away_wins);
                        } else if standing.team_id == away {
                            standing.record_result(away_wins, home_wins);
                        }
                    }
                }

                let seeds: Vec<String> = fresh
                    .sorted_standings()
                    .into_iter()
                    .map(|s| s.team_id)
                    .collect();
                assert_eq!(
                    &seeds[..],
                    order,
                    "the injected results produce the intended table"
                );
                let day = |n: i64| last_date + chrono::Duration::days(n);
                let playoffs = if competition_id == "les" {
                    vec![
                        playoff_fixture(
                            "po4-e2e-sf1",
                            last_matchday + 1,
                            day(7),
                            &seeds[0],
                            &seeds[3],
                            true,
                        ),
                        playoff_fixture(
                            "po4-e2e-sf2",
                            last_matchday + 1,
                            day(7),
                            &seeds[1],
                            &seeds[2],
                            true,
                        ),
                        playoff_fixture(
                            "po4-e2e-final",
                            last_matchday + 2,
                            day(14),
                            &seeds[0],
                            &seeds[1],
                            false,
                        ),
                    ]
                } else {
                    vec![playoff_fixture(
                        "e2e-final",
                        last_matchday + 1,
                        day(7),
                        &seeds[0],
                        &seeds[1],
                        false,
                    )]
                };
                let finished = playoffs
                    .iter()
                    .map(|f| f.date.clone())
                    .max()
                    .expect("playoffs");
                fresh.fixtures.extend(playoffs);
                assert!(
                    olm_core::end_of_season::is_league_complete(&fresh),
                    "the injected {competition_id} split is complete"
                );
                game.leagues[index] = fresh;
                chrono::NaiveDate::parse_from_str(&finished, "%Y-%m-%d").expect("date")
            }

            /// Finishes the last split of both leagues with the given top two seeds and the
            /// rest by id, then puts the clock on the day after the later playoff final.
            fn finish_both_leagues(game: &mut Game, les_top: (&str, &str), lec_top: (&str, &str)) {
                let les_order = strength_order(members(game, "les"), les_top.0, les_top.1);
                let lec_order = strength_order(members(game, "lec"), lec_top.0, lec_top.1);
                let les_done = finish_final_split(game, "les", &les_order);
                let lec_done = finish_final_split(game, "lec", &lec_order);
                let day_after = les_done.max(lec_done) + chrono::Duration::days(1);
                game.clock.current_date =
                    chrono::Utc.from_utc_datetime(&day_after.and_hms_opt(0, 0, 0).expect("midnight"));
            }

            /// (news, inbox messages) whose id starts with `prefix`.
            fn count_ids(game: &Game, prefix: &str) -> (usize, usize) {
                (
                    game.news
                        .iter()
                        .filter(|n| n.id.starts_with(prefix))
                        .count(),
                    game.messages
                        .iter()
                        .filter(|m| m.id.starts_with(prefix))
                        .count(),
                )
            }

            fn round_trip(game: &Game, label: &str) -> Game {
                let dir = tempfile::tempdir().expect("tempdir");
                let mut manager = SaveManager::init(dir.path()).expect("save manager");
                let save_id = manager.create_save(game, label).expect("create save");
                manager.load_game(&save_id).expect("load save")
            }

            fn assert_playable_roster(game: &Game, team_id: &str) {
                let evaluation = evaluate_team(game, team_id, RosterStabilityReason::SeasonTransition)
                    .expect("team exists");
                assert!(
                    evaluation.match_eligible,
                    "{} is not match eligible after the swap: {evaluation:?}",
                    team(game, team_id).name
                );
                for role in ROLES {
                    assert!(
                        game.players
                            .iter()
                            .any(|p| p.team_id.as_deref() == Some(team_id) && p.natural_position == role),
                        "{} lacks a {role:?}",
                        team(game, team_id).name
                    );
                }
            }

            /// The rebuilt league starts the next season at its first split, keeps `size`
            /// members, has a complete schedule and every fixture is dated after the clock.
            fn assert_next_season_calendar(game: &Game, competition_id: &str, season: u32, size: usize) {
                let rebuilt = league(game, competition_id);
                let today = game.clock.current_date.format("%Y-%m-%d").to_string();
                assert_eq!(rebuilt.season, season + 1, "{competition_id} season");
                assert_eq!(
                    rebuilt.split_index, 0,
                    "{competition_id} starts at its first split"
                );
                assert_eq!(
                    rebuilt.standings.len(),
                    size,
                    "{competition_id} keeps its size"
                );
                assert!(
                    olm_core::end_of_season::has_full_schedule(rebuilt),
                    "{competition_id} has a complete S+1 schedule"
                );
                assert!(!rebuilt.fixtures.is_empty());
                for fixture in &rebuilt.fixtures {
                    assert!(
                        fixture.date.as_str() > today.as_str(),
                        "{competition_id} fixture {} on {} is not after {today}",
                        fixture.id,
                        fixture.date
                    );
                    assert_eq!(fixture.status, FixtureStatus::Scheduled);
                }
                for standing in &rebuilt.standings {
                    assert_eq!(standing.played, 0, "{competition_id} standings start clean");
                }
            }

            fn feeder_ids(game: &Game) -> Vec<String> {
                game.competition_configs["les"]
                    .promotion
                    .as_ref()
                    .expect("the LES declares its ladder link")
                    .feeders
                    .iter()
                    .map(|f| f.team.clone())
                    .collect()
            }

            fn economy(game: &Game, id: &str) -> String {
                let t = team(game, id);
                format!(
                    "{}: rep {} finance {} wage_budget {} transfer_budget {} wage_bill {}",
                    t.name,
                    t.reputation,
                    t.finance,
                    t.wage_budget,
                    t.transfer_budget,
                    annual_bill(game, id)
                )
            }

            fn champion(game: &Game, competition_id: &str, season: u32) -> Option<String> {
                game.ladder
                    .outcome(competition_id, season)
                    .and_then(|o| o.champion_id.clone())
            }

            /// Case A: an LEC user whose club is neither promoted nor relegated. The LES
            /// rolls first through the daily turn and waits; the user's season wrap then
            /// applies the swap. With `feeder_champion` the LES champion is a feeder of an
            /// LEC club, so the beaten finalist has to go up instead.
            fn ai_only_swap(feeder_champion: bool) {
                let mut game = new_world(LEC_SLOT);
                assert_eq!(game.user_competition_id.as_deref(), Some("lec"));
                let season = league(&game, "lec").season;
                let koi_fenix = "les-team-8baee3fd".to_string();
                let barcelona = les_club(&game, "Barcelona Esports");
                let ucam = les_club(&game, "UCAM Esports");
                // The second seed wins the final (upset), so it is the champion.
                let (les_seed_one, les_champion, expected_up) = if feeder_champion {
                    (barcelona.clone(), koi_fenix.clone(), barcelona.clone())
                } else {
                    (barcelona.clone(), ucam.clone(), ucam.clone())
                };

                let others: Vec<String> = sorted_members(&game, "lec")
                    .into_iter()
                    .filter(|id| id != LEC_SLOT)
                    .collect();
                let lec_size = others.len() + 1;
                let lec_seed_one = others[0].clone();
                let expected_down = others.last().expect("LEC teams").clone();
                let les_size = members(&game, "les").len();
                assert_eq!((lec_size, les_size), (10, 8), "sizes as authored");

                finish_both_leagues(
                    &mut game,
                    (&les_seed_one, &les_champion),
                    (&lec_seed_one, LEC_SLOT),
                );
                let feeders = feeder_ids(&game);
                let up_before = economy(&game, &expected_up);
                let down_before = economy(&game, &expected_down);

                // The LES closes first and rolls through the daily turn; the ladder waits
                // for the LEC.
                olm_core::turn::process_day(&mut game);
                assert_eq!(
                    league(&game, "les").season,
                    season + 1,
                    "the LES rolled in the background"
                );
                assert_eq!(
                    league(&game, "lec").season,
                    season,
                    "the LEC has not rolled yet"
                );
                assert!(
                    game.ladder.movements.is_empty(),
                    "nothing moves before both leagues close"
                );
                assert_eq!(count_ids(&game, "ladder_"), (0, 0));

                let outcome = olm_core::season_rollover::advance_season(&mut game);
                assert!(outcome.was_season_end);

                assert_eq!(champion(&game, "les", season), Some(les_champion.clone()));
                assert_eq!(game.ladder.movements.len(), 1);
                let movement = &game.ladder.movements[0];
                assert_eq!(
                    movement.status,
                    LadderMovementStatus::Applied,
                    "the real calendars leave room for the swap"
                );
                assert_eq!(movement.promoted, vec![expected_up.clone()]);
                assert_eq!(movement.relegated, vec![expected_down.clone()]);
                assert!(
                    movement.promoted.iter().all(|id| !feeders.contains(id)),
                    "a feeder went up"
                );
                if feeder_champion {
                    assert!(
                        feeders.contains(&les_champion),
                        "the champion is a declared feeder"
                    );
                }

                let lec_now = members(&game, "lec");
                let les_now = members(&game, "les");
                assert!(lec_now.contains(&expected_up) && !lec_now.contains(&expected_down));
                assert!(les_now.contains(&expected_down) && !les_now.contains(&expected_up));
                assert_eq!(
                    team(&game, &expected_up).competition_id.as_deref(),
                    Some("lec")
                );
                assert_eq!(
                    team(&game, &expected_down).competition_id.as_deref(),
                    Some("les")
                );
                assert_next_season_calendar(&game, "lec", season, lec_size);
                assert_next_season_calendar(&game, "les", season, les_size);
                assert_eq!(game.user_competition_id.as_deref(), Some("lec"));
                assert_eq!(game.manager.team_id.as_deref(), Some(LEC_SLOT));

                assert_playable_roster(&game, &expected_down);
                assert_playable_roster(&game, &expected_up);
                eprintln!("[c8 A feeder={feeder_champion}] promoted before:  {up_before}");
                eprintln!(
                    "[c8 A feeder={feeder_champion}] promoted after:   {}",
                    economy(&game, &expected_up)
                );
                eprintln!("[c8 A feeder={feeder_champion}] relegated before: {down_before}");
                eprintln!(
                    "[c8 A feeder={feeder_champion}] relegated after:  {}",
                    economy(&game, &expected_down)
                );

                // Communications are created once, and stay single after more reporting and
                // another day of the turn loop.
                let key = format!("les_lec_{season}");
                let news_id = format!("ladder_news_{key}");
                let swap_id = format!("ladder_swap_{key}");
                assert_eq!(count_ids(&game, &news_id), (1, 0));
                assert_eq!(
                    count_ids(&game, &swap_id),
                    (0, 1),
                    "an uninvolved user gets the league notice"
                );
                assert_eq!(count_ids(&game, "ladder_user_"), (0, 0));
                olm_core::ladder_report::announce_ladder_movements(&mut game);
                olm_core::turn::process_day(&mut game);
                assert_eq!(count_ids(&game, &news_id), (1, 0));
                assert_eq!(count_ids(&game, &swap_id), (0, 1));
                assert_eq!(game.ladder.movements.len(), 1, "the swap is not repeated");
                assert_eq!(outcome.summary.ladder_movements.len(), 1);
                assert_eq!(
                    outcome.summary.user_ladder.as_ref().map(|u| u.result),
                    Some(UserLadderResult::Stayed)
                );

                let loaded = round_trip(&game, "ladder A");
                assert_eq!(members(&loaded, "lec"), lec_now);
                assert_eq!(members(&loaded, "les"), les_now);
                assert_eq!(loaded.ladder.movements.len(), 1);
                assert_eq!(loaded.ladder.announced, game.ladder.announced);
                assert_eq!(count_ids(&loaded, &news_id), (1, 0));
                assert_eq!(count_ids(&loaded, &swap_id), (0, 1));
                assert_eq!(
                    team(&loaded, &expected_up).competition_id.as_deref(),
                    Some("lec")
                );
                assert_eq!(
                    team(&loaded, &expected_down).competition_id.as_deref(),
                    Some("les")
                );
                assert_eq!(loaded.user_competition_id.as_deref(), Some("lec"));
                assert_eq!(
                    league(&loaded, "lec").fixtures.len(),
                    league(&game, "lec").fixtures.len()
                );
            }

            #[test]
            #[ignore = "real-data end-to-end, run explicitly"]
            fn an_ai_only_swap_skips_a_feeder_champion_and_relegates_the_last_placed_lec_club() {
                ai_only_swap(true);
            }

            #[test]
            #[ignore = "real-data end-to-end, run explicitly"]
            fn an_ai_only_swap_promotes_the_real_les_champion() {
                ai_only_swap(false);
            }

            /// Case B: the user manages an LES club that wins the LES. The wrap promotes the
            /// club, moves the user to the LEC and builds the LEC calendar and objectives.
            #[test]
            #[ignore = "real-data end-to-end, run explicitly"]
            fn a_user_who_wins_the_les_is_promoted_into_the_lec() {
                const USER: &str = "les-team-06974122";
                let mut game = new_world(USER);
                assert_eq!(game.user_competition_id.as_deref(), Some("les"));
                let season = league(&game, "les").season;
                let ucam = les_club(&game, "UCAM Esports");
                let lec_sorted = sorted_members(&game, "lec");
                let lec_size = lec_sorted.len();
                let expected_down = lec_sorted.last().expect("LEC teams").clone();
                // The user wins the final as the second seed against UCAM.
                finish_both_leagues(&mut game, (&ucam, USER), (&lec_sorted[2], &lec_sorted[3]));
                let up_before = economy(&game, USER);
                let down_before = economy(&game, &expected_down);

                let outcome = olm_core::season_rollover::advance_season(&mut game);
                assert!(outcome.was_season_end);

                assert_eq!(champion(&game, "les", season), Some(USER.to_string()));
                assert_eq!(game.ladder.movements.len(), 1);
                let movement = &game.ladder.movements[0];
                assert_eq!(movement.status, LadderMovementStatus::Applied);
                assert_eq!(movement.promoted, vec![USER.to_string()]);
                assert_eq!(movement.relegated, vec![expected_down.clone()]);
                assert_eq!(game.user_competition_id.as_deref(), Some("lec"));
                assert_eq!(team(&game, USER).competition_id.as_deref(), Some("lec"));
                assert_eq!(game.manager.team_id.as_deref(), Some(USER));

                // The user's active league is the LEC with its S+1 calendar.
                let active = game.active_league().expect("active league");
                assert_eq!(active.competition_id.as_deref(), Some("lec"));
                assert!(active.standings.iter().any(|s| s.team_id == USER));
                assert!(
                    active
                        .fixtures
                        .iter()
                        .any(|f| f.home_team_id == USER || f.away_team_id == USER)
                );
                assert_next_season_calendar(&game, "lec", season, lec_size);
                assert_next_season_calendar(&game, "les", season, 8);
                assert!(!members(&game, "les").contains(&USER.to_string()));
                assert!(members(&game, "les").contains(&expected_down));

                let ladder = outcome
                    .summary
                    .user_ladder
                    .as_ref()
                    .expect("the user moved");
                assert_eq!(ladder.result, UserLadderResult::Promoted);
                assert_eq!(ladder.from_competition_id, "les");
                assert_eq!(ladder.to_competition_id, "lec");
                let key = format!("les_lec_{season}");
                let promoted_msg = format!("ladder_user_promoted_{key}");
                let news_id = format!("ladder_news_{key}");
                assert_eq!(count_ids(&game, &promoted_msg), (0, 1));
                assert_eq!(count_ids(&game, &news_id), (1, 0));
                assert_eq!(count_ids(&game, "ladder_swap_"), (0, 0));

                // Board objectives follow the LEC: the swap cleared the LES ones and the next
                // day of the turn loop writes them again for the ten-club league.
                assert!(
                    game.board_objectives.is_empty(),
                    "the swap cleared the old objectives"
                );
                olm_core::turn::process_day(&mut game);
                assert!(
                    !game.board_objectives.is_empty(),
                    "objectives were regenerated"
                );
                let position = game
                    .board_objectives
                    .iter()
                    .find(|o| o.id == "obj_position")
                    .expect("position objective");
                assert!(
                    (1..=lec_size as i64).contains(&(position.target as i64)),
                    "position target {} fits a ten-club league",
                    position.target
                );
                let active_season = game.active_league().expect("league").season;
                assert!(
                    game.messages
                        .iter()
                        .any(|m| m.id == format!("board_objectives_{active_season}")),
                    "the board wrote to the user for the new season"
                );
                assert_eq!(count_ids(&game, &promoted_msg), (0, 1));
                assert_playable_roster(&game, USER);
                assert_playable_roster(&game, &expected_down);
                eprintln!("[c8 B] promoted before:  {up_before}");
                eprintln!("[c8 B] promoted after:   {}", economy(&game, USER));
                eprintln!("[c8 B] relegated before: {down_before}");
                eprintln!(
                    "[c8 B] relegated after:  {}",
                    economy(&game, &expected_down)
                );

                // Save round trip, then the reference sanitising `load_game` runs.
                let mut loaded = round_trip(&game, "ladder B");
                let (_, known) = known_ids_and_manifests();
                sanitize_competition_references(&mut loaded, &known);
                assert_eq!(loaded.user_competition_id.as_deref(), Some("lec"));
                assert_eq!(
                    loaded
                        .active_league()
                        .and_then(|l| l.competition_id.clone())
                        .as_deref(),
                    Some("lec")
                );
                assert_eq!(team(&loaded, USER).competition_id.as_deref(), Some("lec"));
                assert_eq!(loaded.board_objectives.len(), game.board_objectives.len());
                assert_eq!(loaded.ladder.movements.len(), 1);
                assert_eq!(count_ids(&loaded, &promoted_msg), (0, 1));
                assert_eq!(count_ids(&loaded, &news_id), (1, 0));
            }
        }

        // -- Custom club career, end to end (B7) -------------------------------------

        /// Name of the club the custom one replaces, as the data ships it.
        const REPLACED_NAME: &str = "UB Alma Mater";

        /// A custom LES club after the season setup, ready for the turn loop.
        fn custom_career() -> (Game, String) {
            let (mut game, id) = custom_game();
            let (manifests, known) = known_ids_and_manifests();
            prepare_new_game_season(&mut game, &manifests, &known, &id).expect("season setup");
            (game, id)
        }

        fn mentions_replaced(text: &str) -> bool {
            text.contains(REPLACED_NAME) || text.contains(LES_SLOT)
        }

        /// Dashboard home: the manager runs the club, whose identity and next match are intact.
        /// The board sets its objectives on the first processed day, so `after_days` gates that check.
        fn dashboard_problems(game: &Game, id: &str, after_days: bool) -> Vec<String> {
            use olm_core::domain::league::FixtureStatus;
            let mut problems = Vec::new();
            if game.manager.team_id.as_deref() != Some(id) {
                problems.push(format!("manager.team_id is {:?}", game.manager.team_id));
            }
            if game.user_competition_id.as_deref() != Some("les") {
                problems.push(format!("user_competition_id is {:?}", game.user_competition_id));
            }
            let spec = rayo();
            match game.teams.iter().find(|t| t.id == id) {
                None => problems.push("the custom club is not in game.teams".to_string()),
                Some(club) => {
                    if club.name != spec.name || club.short_name != spec.short_name {
                        problems.push(format!("identity is {} / {}", club.name, club.short_name));
                    }
                    if club.colors.primary != spec.primary_color
                        || club.colors.secondary != spec.secondary_color
                    {
                        problems.push(format!("colours are {:?}", club.colors));
                    }
                    if !club.logo_url.as_deref().is_some_and(|l| l.starts_with("data:image/svg+xml")) {
                        problems.push("no generated badge in logo_url".to_string());
                    }
                    if club.country != spec.country {
                        problems.push(format!("country is {}", club.country));
                    }
                }
            }
            if game.active_league().and_then(|l| l.competition_id.as_deref()) != Some("les") {
                problems.push("the active league is not the LES".to_string());
            }
            if after_days && game.board_objectives.is_empty() {
                problems.push("the board set no objectives".to_string());
            }
            let today = game.clock.current_date.format("%Y-%m-%d").to_string();
            let next = les_league(game).fixtures.iter().find(|f| {
                (f.home_team_id == id || f.away_team_id == id)
                    && f.status == FixtureStatus::Scheduled
                    && f.date >= today
            });
            if next.is_none() {
                problems.push("no upcoming fixture for the next-match card".to_string());
            }
            problems
        }

        /// Teams tab: one active club under the new name, and nothing of the replaced one.
        fn teams_problems(game: &Game, id: &str) -> Vec<String> {
            let mut problems = Vec::new();
            let spec = rayo();
            if game.teams.iter().filter(|t| t.name == spec.name).count() != 1 {
                problems.push("the custom name is not unique".to_string());
            }
            if game.teams.iter().filter(|t| t.id == id).count() != 1 {
                problems.push("the custom id is not unique".to_string());
            }
            if !id.contains("-custom-") {
                problems.push(format!("the id {id} lacks -custom-"));
            }
            for team in &game.teams {
                if team.id == LES_SLOT || team.name == REPLACED_NAME {
                    problems.push(format!("replaced team still present: {}", team.id));
                }
                if team.parent_team_id.as_deref() == Some(LES_SLOT)
                    || team.academy_team_id.as_deref() == Some(LES_SLOT)
                {
                    problems.push(format!("{} still links to the replaced team", team.id));
                }
            }
            let academy = game
                .teams
                .iter()
                .find(|t| t.id == id)
                .and_then(|club| club.academy_team_id.as_deref())
                .and_then(|academy_id| game.teams.iter().find(|t| t.id == academy_id));
            if academy.is_none_or(|a| a.parent_team_id.as_deref() != Some(id)) {
                problems.push("the custom club does not own the inherited academy".to_string());
            }
            if game.players.iter().any(|p| p.team_id.as_deref() == Some(LES_SLOT))
                || game.staff.iter().any(|s| s.team_id.as_deref() == Some(LES_SLOT))
            {
                problems.push("people are still attached to the replaced team".to_string());
            }
            let known: HashSet<&str> = game.teams.iter().map(|t| t.id.as_str()).collect();
            for player in &game.players {
                if player.team_id.as_deref().is_some_and(|t| !known.contains(t)) {
                    problems.push(format!("{} points at a missing team", player.id));
                }
            }
            problems
        }

        /// Standings and fixtures: the club is in the table and plays; nobody plays a ghost.
        fn standings_problems(game: &Game, id: &str, min_played: u32) -> Vec<String> {
            use olm_core::domain::league::FixtureStatus;
            let mut problems = Vec::new();
            let known: HashSet<&str> = game.teams.iter().map(|t| t.id.as_str()).collect();
            let les = les_league(game);
            if les.standings.len() != 8 {
                problems.push(format!("{} standings rows", les.standings.len()));
            }
            match les.standings.iter().find(|s| s.team_id == id) {
                None => problems.push("the club has no standings row".to_string()),
                Some(row) if row.played < min_played => {
                    problems.push(format!("the club played {} < {min_played}", row.played));
                }
                Some(_) => {}
            }
            for league in &game.leagues {
                for row in &league.standings {
                    if !known.contains(row.team_id.as_str()) {
                        problems.push(format!("standings row for unknown team {}", row.team_id));
                    }
                }
                for fixture in &league.fixtures {
                    for side in [&fixture.home_team_id, &fixture.away_team_id] {
                        if side == LES_SLOT || !known.contains(side.as_str()) {
                            problems.push(format!("fixture {} names unknown team {side}", fixture.id));
                        }
                    }
                }
            }
            let played = les
                .fixtures
                .iter()
                .filter(|f| {
                    f.counts_for_league_standings()
                        && (f.home_team_id == id || f.away_team_id == id)
                        && f.status == FixtureStatus::Completed
                })
                .count() as u32;
            if played < min_played {
                problems.push(format!("only {played} completed fixtures for the club"));
            }
            if played > 0
                && !les.fixtures.iter().any(|f| {
                    (f.home_team_id == id || f.away_team_id == id)
                        && f.status == FixtureStatus::Completed
                        && f.result.is_some()
                })
            {
                problems.push("completed fixtures carry no result".to_string());
            }
            problems
        }

        /// Transfer and market history: every entry names real teams, with the current name.
        fn market_problems(game: &Game, id: &str) -> Vec<String> {
            let mut problems = Vec::new();
            let known: HashSet<&str> = game.teams.iter().map(|t| t.id.as_str()).collect();
            for entry in &game.transfer_history.entries {
                for (team_id, team_name) in [
                    (&entry.from_team_id, &entry.from_team_name),
                    (&entry.to_team_id, &entry.to_team_name),
                ] {
                    if team_id.is_empty() {
                        continue;
                    }
                    if team_id == LES_SLOT || mentions_replaced(team_name) {
                        problems.push(format!("history entry {} names the replaced team", entry.id));
                    } else if team_id == id && team_name != &rayo().name {
                        problems.push(format!("entry {} calls the club {team_name:?}", entry.id));
                    } else if !known.contains(team_id.as_str()) && team_id != "free_agent" {
                        problems.push(format!("entry {} names unknown team {team_id}", entry.id));
                    }
                }
            }
            problems
        }

        /// Social: posts and accounts reference only existing teams, never the replaced one.
        fn social_problems(game: &Game) -> Vec<String> {
            let mut problems = Vec::new();
            let known: HashSet<&str> = game.teams.iter().map(|t| t.id.as_str()).collect();
            for post in &game.social_posts {
                if post.team_ids.iter().any(|t| !known.contains(t.as_str())) {
                    problems.push(format!("post {} references an unknown team", post.id));
                }
                if mentions_replaced(&post.body) || mentions_replaced(&post.author_name) {
                    problems.push(format!("post {} names the replaced team", post.id));
                }
            }
            for account in &game.social_accounts {
                if account.favorite_team_ids.iter().any(|t| t == LES_SLOT) {
                    problems.push(format!("account {} still favours the replaced team", account.id));
                }
            }
            problems
        }

        /// News: articles reference only existing teams and never name the replaced one.
        fn news_problems(game: &Game) -> Vec<String> {
            let mut problems = Vec::new();
            let known: HashSet<&str> = game.teams.iter().map(|t| t.id.as_str()).collect();
            for article in &game.news {
                if article.team_ids.iter().any(|t| !known.contains(t.as_str())) {
                    problems.push(format!("article {} references an unknown team", article.id));
                }
                if mentions_replaced(&article.headline)
                    || mentions_replaced(&article.body)
                    || article.i18n_params.values().any(|v| mentions_replaced(v))
                {
                    problems.push(format!("article {} names the replaced team", article.id));
                }
            }
            problems
        }

        /// Inbox: messages address the new club and never the replaced one.
        fn message_problems(game: &Game, id: &str) -> Vec<String> {
            let mut problems = Vec::new();
            let known: HashSet<&str> = game.teams.iter().map(|t| t.id.as_str()).collect();
            let name = rayo().name;
            for message in &game.messages {
                if let Some(team_id) = message.context.team_id.as_deref() {
                    if !known.contains(team_id) {
                        problems.push(format!("message {} context names unknown team {team_id}", message.id));
                    }
                }
                if mentions_replaced(&message.subject)
                    || mentions_replaced(&message.body)
                    || mentions_replaced(&message.sender)
                {
                    problems.push(format!("message {} names the replaced team", message.id));
                }
            }
            let addressed = game.messages.iter().any(|m| {
                m.context.team_id.as_deref() == Some(id)
                    || m.body.contains(&name)
                    || m.subject.contains(&name)
            });
            if !addressed {
                problems.push("no message addresses the custom club".to_string());
            }
            problems
        }

        /// Residency: the club counts as an LES (EMEA) team and no LES starting five breaks the
        /// import rule.
        fn residency_problems(game: &Game, id: &str) -> Vec<String> {
            use olm_core::residency;
            let mut problems = Vec::new();
            let club = game.teams.iter().find(|t| t.id == id).expect("club");
            let les_region = residency::region_for_competition("les");
            if les_region.is_none() || residency::team_region(club) != les_region {
                problems.push(format!("team_region is {:?}, LES is {les_region:?}", residency::team_region(club)));
            }
            for team in game.teams.iter().filter(|t| t.competition_id.as_deref() == Some("les")) {
                if let Err(error) = residency::validate_lineup_imports(game, &team.id, &team.active_lineup_ids) {
                    problems.push(format!("{} starts {} imports (max {})", team.id, error.imports, error.max));
                }
            }
            problems
        }

        fn assert_surface(surface: &str, problems: Vec<String>) {
            let verdict = if problems.is_empty() { "PASS" } else { "FAIL" };
            eprintln!("[B7] {verdict} {surface}: {problems:?}");
            assert!(problems.is_empty(), "{surface}: {problems:?}");
        }

        /// A custom LES club through the first matchdays of the real turn loop: every surface
        /// the UI reads shows the new club and nothing of the one it replaced.
        #[test]
        #[ignore = "real-data end-to-end, run explicitly"]
        fn a_custom_club_shows_up_on_every_surface_through_the_first_matchdays() {
            let (mut game, id) = custom_career();
            assert_surface("dashboard (start)", dashboard_problems(&game, &id, false));
            assert_surface("teams (start)", teams_problems(&game, &id));

            // Winter opens on Jan 17 and runs one round per week: 45 days is about 4 rounds.
            for _ in 0..45 {
                olm_core::turn::process_day(&mut game);
            }

            assert_surface("dashboard", dashboard_problems(&game, &id, true));
            assert_surface("teams", teams_problems(&game, &id));
            assert_surface("standings and fixtures", standings_problems(&game, &id, 2));
            assert_surface("market and transfer history", market_problems(&game, &id));
            // The turn loop writes no social posts: they come from the live-match flow, so
            // feed that flow the club's first completed fixture.
            let fixture_index = les_league(&game)
                .fixtures
                .iter()
                .position(|f| {
                    (f.home_team_id == id || f.away_team_id == id)
                        && f.status == olm_core::domain::league::FixtureStatus::Completed
                })
                .expect("a completed fixture of the club");
            let mut report = olm_core::engine::report::MatchReport::from_events(Vec::new(), 1, 1, 0);
            report.home_wins = 2;
            report.away_wins = 0;
            olm_core::social::generate_match_social_posts(
                &mut game,
                fixture_index,
                &report,
                Some("en"),
                Some(&data_base()),
            );
            let about_club = game
                .social_posts
                .iter()
                .filter(|p| p.team_ids.iter().any(|t| t == &id))
                .count();
            assert!(about_club > 0, "no social post references the custom club");
            assert_surface("social", social_problems(&game));
            let club_news = game.news.iter().filter(|a| a.team_ids.iter().any(|t| t == &id)).count();
            eprintln!("[B7] {club_news} news articles reference the custom club");
            assert!(club_news > 0, "no news article references the custom club");
            assert_surface("news", news_problems(&game));
            assert_surface("messages", message_problems(&game, &id));
            assert_surface("residency", residency_problems(&game, &id));
            eprintln!(
                "[B7] volumes: {} news, {} social posts, {} messages, {} transfers",
                game.news.len(),
                game.social_posts.len(),
                game.messages.len(),
                game.transfer_history.entries.len()
            );
        }

        /// The custom club and its competition survive the real save and load flow in the
        /// middle of a career, and the turn loop keeps running on the loaded game.
        #[test]
        #[ignore = "real-data end-to-end, run explicitly"]
        fn a_custom_club_career_survives_save_and_load_mid_season() {
            let (mut game, id) = custom_career();
            for _ in 0..30 {
                olm_core::turn::process_day(&mut game);
            }
            let roster = roster_ids(&game, &id);
            let played_before = les_league(&game)
                .standings
                .iter()
                .find(|s| s.team_id == id)
                .map_or(0, |s| s.played);

            let dir = tempfile::tempdir().expect("tempdir");
            let mut manager = SaveManager::init(dir.path()).expect("save manager");
            let save_id = manager.create_save(&game, "custom career").expect("create save");
            let mut loaded = manager.load_game(&save_id).expect("load save");

            // The steps `load_game` runs after reading the file.
            let data = data_base();
            let scanned = olm_core::competitions::scan_competitions(&data.join("competitions"));
            let (catalog_teams, catalog_players, catalog_staff) = assemble_world_from_modular_data(
                &data,
                &scanned,
                "",
                "",
                chrono::NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
            )
            .expect("catalog");
            crate::commands::import::apply_catalog_to_game(
                &mut loaded,
                catalog_teams,
                catalog_players,
                catalog_staff,
            );
            let current: Vec<_> = scanned.into_iter().filter(|m| !m.legacy).collect();
            let known_now: Vec<String> = current.iter().map(|m| m.id.clone()).collect();
            loaded.competition_configs.clear();
            for manifest in &current {
                loaded.competition_configs.insert(manifest.id.clone(), manifest.clone());
            }
            sanitize_competition_references(&mut loaded, &known_now);

            assert_surface("load: dashboard", dashboard_problems(&loaded, &id, true));
            assert_surface("load: teams", teams_problems(&loaded, &id));
            assert_surface("load: standings", standings_problems(&loaded, &id, 1));
            assert_surface("load: news", news_problems(&loaded));
            assert_surface("load: social", social_problems(&loaded));
            assert_surface("load: messages", message_problems(&loaded, &id));
            assert_surface("load: market", market_problems(&loaded, &id));
            assert_eq!(roster_ids(&loaded, &id), roster, "the roster changed through the load");
            let club = loaded.teams.iter().find(|t| t.id == id).expect("club");
            assert_eq!(club.competition_id.as_deref(), Some("les"));
            let les = loaded.active_league().expect("active league");
            assert_eq!(les.competition_id.as_deref(), Some("les"));
            let played = les.standings.iter().find(|s| s.team_id == id).map_or(0, |s| s.played);
            assert_eq!(played, played_before, "the table changed through the load");

            for _ in 0..14 {
                olm_core::turn::process_day(&mut loaded);
            }
            assert_surface("load: standings after more days", standings_problems(&loaded, &id, 1));
            assert_surface("load: teams after more days", teams_problems(&loaded, &id));
        }

        /// One full calendar year of finance processing for the median-reputation custom club.
        ///
        /// This only checks internal consistency (signs, scale, a recorded ledger). It does
        /// not prove sustainability: bundled clubs have no sponsor, so a LES club earns far
        /// less than its wage bill and drains its treasury. That economy gap is tracked as a
        /// follow-up, not asserted away here.
        #[test]
        #[ignore = "real-data end-to-end, run explicitly"]
        fn a_custom_club_year_keeps_finances_consistent_but_does_not_prove_they_are_sustainable() {
            let (mut game, id) = custom_career();
            let start = game.teams.iter().find(|t| t.id == id).expect("club").clone();
            let peers_finance: Vec<i64> = les_peers(&game, &id).iter().map(|t| t.finance).collect();
            eprintln!(
                "[B7] finance start: treasury {} wage_budget {} transfer_budget {} rep {} sponsorship {:?}",
                start.finance,
                start.wage_budget,
                start.transfer_budget,
                start.reputation,
                start.sponsorship.as_ref().map(|s| (s.base_value, s.remaining_months))
            );
            assert!(start.wage_budget > 0 && start.finance > 0);

            let mut lowest = start.finance;
            let mut highest = start.finance;
            for day in 1..=365 {
                olm_core::turn::process_day(&mut game);
                let club = game.teams.iter().find(|t| t.id == id).expect("club");
                lowest = lowest.min(club.finance);
                highest = highest.max(club.finance);
                if day % 60 == 0 {
                    eprintln!(
                        "[B7] day {day}: treasury {} income {} expenses {} bill {}",
                        club.finance,
                        club.season_income,
                        club.season_expenses,
                        annual_bill(&game, &id)
                    );
                }
            }

            let club = game.teams.iter().find(|t| t.id == id).expect("club");
            let bill = annual_bill(&game, &id);
            eprintln!(
                "[B7] finance end: treasury {} (min {lowest}, max {highest}) wage_budget {} transfer_budget {} \
                 income {} expenses {} bill {bill} sponsorship {:?} peers' start treasuries {peers_finance:?}",
                club.finance,
                club.wage_budget,
                club.transfer_budget,
                club.season_income,
                club.season_expenses,
                club.sponsorship.as_ref().map(|s| (s.base_value, s.remaining_months)),
            );
            for peer in les_peers(&game, &id) {
                eprintln!(
                    "[B7] peer {}: treasury {} income {} expenses {} sponsorship {:?}",
                    peer.name,
                    peer.finance,
                    peer.season_income,
                    peer.season_expenses,
                    peer.sponsorship.as_ref().map(|s| s.base_value)
                );
            }
            assert!(club.wage_budget > 0, "the wage budget stayed positive");
            assert!(club.transfer_budget >= 0, "the transfer budget went negative");
            assert!(bill <= club.wage_budget, "wage bill {bill} over budget {}", club.wage_budget);
            assert!(club.season_income >= 0 && club.season_expenses >= 0, "season totals have a sign");
            assert!(
                club.season_expenses <= 3 * start.wage_budget.max(1) + start.finance,
                "expenses {} are out of scale",
                club.season_expenses
            );
            assert!(
                club.season_income <= 20 * start.finance.max(1),
                "income {} is out of scale",
                club.season_income
            );
            assert!(club.finance > -start.finance, "the treasury collapsed to {}", club.finance);
            assert_ne!(club.finance, start.finance, "the treasury never moved");
            assert!(!club.financial_ledger.is_empty(), "no transactions were recorded");
            assert!(ensure_custom_club_roster(&game, &id).is_ok());
            assert_surface("finance year: teams", teams_problems(&game, &id));
        }
    }
}
