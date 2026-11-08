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
/// playable and auto-fill the user team's lineup.
pub(crate) fn build_new_game_world(
    game: &mut Game,
    inputs: &NewGameWorldInputs<'_>,
) -> Result<(), String> {
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

    // The overlay can leave a team short; make every Main team playable.
    fill_short_rosters(game);

    // Rostered players the data ships without a wage get one from the LEC wage scale.
    seed_missing_wages(game);

    // Everyone on a team now is a resident of that team's league region; only
    // later signings can be imports.
    let grandfathered = olm_core::residency::grandfather_rostered_players(game);
    olm_core::residency::refresh_import_flags(game);
    info!("[game] grandfathered residency for {} rostered players", grandfathered);

    auto_fill_user_lineup(game, inputs.team_id);
    eprintln!(
        "[select_team] AFTER assembly: staff.len={}",
        game.staff.len()
    );
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

/// Auto-populate the active lineup for the user's team, one player per role.
fn auto_fill_user_lineup(game: &mut Game, team_id: &str) {
    let roles = [
        LolRole::Top,
        LolRole::Jungle,
        LolRole::Mid,
        LolRole::Adc,
        LolRole::Support,
    ];
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

    // 6. Recalculate market_value for players who have 0 (data issue in regional leagues)
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
) -> Result<Game, String> {
    let lang = lang.unwrap_or_else(|| "en".to_string());
    info!("[cmd] select_team: team_id={}, lang={}", team_id, lang);
    let mut game = state
        .get_game(|g: &Game| g.clone())
        .ok_or("No active game session".to_string())?;

    // Detect flow: if game has no teams, this is Flow C (modular assembly)
    eprintln!(
        "[select_team] teams.is_empty={}, staff.len={}",
        game.teams.is_empty(),
        game.staff.len()
    );

    let all_manifests = crate::commands::competitions::scan_competitions(&app_handle);
    let known_competition_ids = known_competition_ids(&all_manifests)?;

    if game.teams.is_empty() {
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
            },
        )?;
    }

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
            let data = data_base();
            let manifests = olm_core::competitions::scan_competitions(&data.join("competitions"));
            let known_ids: Vec<String> = manifests
                .iter()
                .filter(|m| !m.legacy)
                .map(|m| m.id.clone())
                .collect();
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
                let found: Vec<_> = catalog_teams.iter().filter(|t| t.name == "Kiwoom DRX").collect();
                assert_eq!(found.len(), 1, "expected exactly one team named Kiwoom DRX");
                found[0].id.clone()
            };
            let competition_id = competition_id_from_team_id_known(&user_team, &known_ids)
                .expect("competition prefix");

            let clock = GameClock::new(chrono::Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap());
            let manager = Manager::new(
                "mgr_user".to_string(),
                "Test".to_string(),
                "Manager".to_string(),
                "1990-01-01".to_string(),
                "KR".to_string(),
            );
            let mut game = Game::new(clock, manager, vec![], vec![], vec![], vec![]);
            let overlay = olm_core::world_overlay::bundled_world_overlay().expect("bundled overlay");
            build_new_game_world(
                &mut game,
                &NewGameWorldInputs {
                    data_dir: &data,
                    manifests: &manifests,
                    competition_id,
                    team_id: &user_team,
                    overlay: Some(&overlay),
                },
            )
            .expect("build new game world");
            (game, catalog, overlay, user_team)
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
    }
}
