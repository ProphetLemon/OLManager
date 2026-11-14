use chrono::{Datelike, TimeZone};
use log::{info, warn};
use olm_core::domain::player::Player;
use olm_core::domain::staff::Staff;
use olm_core::domain::stats::LolRole;
use olm_core::domain::team::{Team, TeamKind};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tauri::State;

use olm_core::clock::GameClock;
use olm_core::db::save_index::SaveEntry;
use olm_core::domain::manager::Manager;
use olm_core::domain::stats::StatsState;
use olm_core::game::Game;
use olm_core::game_setup;
use olm_core::messages::FoundingMode;
use olm_core::player_rating_overrides::{ApplyReport, PlayerRatingOverrides, apply_player_rating_overrides};
use olm_core::wage_scale;
use olm_core::generator::definitions::CompetitionManifest;
use olm_core::roster_stability;
use olm_core::world_catalog;
use olm_core::state::StateManager;
use olm_core::world_overlay::{OverlayApplyReport, WorldOverlay, apply_world_overlay};

use crate::SaveManagerState;

// ---------------------------------------------------------------------------
// Local helpers that stay in the Tauri layer
// ---------------------------------------------------------------------------

use olm_core::competitions::{competition_id_from_team_id_known, sanitize_competition_references};
use olm_core::custom_team::{self, CustomTeamSpec};
use olm_core::founder_identity::{FounderError, FounderOverrides, apply_founder_photos};
use olm_core::founding_squad::{
    FoundingSquadError, FoundingSquadOutcome, FoundingSquadSummary, install_founding_squad_with,
    plan_founding_squad,
};

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
    /// A club the manager created. When set, `team_id` is the slot it replaces,
    /// unless `joins_league` is set.
    pub custom_team: Option<&'a CustomTeamSpec>,
    /// The custom club joins `competition_id` as an extra club and replaces
    /// nobody; `team_id` is unused (pass an empty string). Needs `custom_team`.
    pub joins_league: bool,
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
#[cfg(test)]
pub(crate) fn build_new_game_world(
    game: &mut Game,
    inputs: &NewGameWorldInputs<'_>,
) -> Result<String, String> {
    build_new_game_world_with_rating_overrides(
        game,
        inputs,
        olm_core::player_rating_overrides::bundled(),
    )
}

/// [`build_new_game_world`] with an explicit stat-derived rating overrides
/// document instead of the bundled one, so tests can inject a fixture.
#[cfg(test)]
pub(crate) fn build_new_game_world_with_rating_overrides(
    game: &mut Game,
    inputs: &NewGameWorldInputs<'_>,
    rating_overrides: &PlayerRatingOverrides,
) -> Result<String, String> {
    build_world_naming_replaced_club(game, inputs, rating_overrides).map(|(team_id, _)| team_id)
}

/// [`build_new_game_world_with_rating_overrides`] that also returns the name of the
/// club a custom club replaced, which the world no longer holds once it is built.
pub(crate) fn build_world_naming_replaced_club(
    game: &mut Game,
    inputs: &NewGameWorldInputs<'_>,
    rating_overrides: &PlayerRatingOverrides,
) -> Result<(String, Option<String>), String> {
    assemble_base_world(game, inputs, rating_overrides)?;

    // The custom club takes its slot after the overlay (so roster moves into the
    // replaced club are released with the rest) and before the fill. Its founding
    // squad is generated right away, so the fill finds all five roles covered; if
    // the generator fails, the fill signs free agents like it does for any club.
    let mut replaced_team_name = None;
    let user_team_id = match inputs.custom_team {
        Some(spec) => {
            if !inputs.joins_league {
                replaced_team_name = game
                    .teams
                    .iter()
                    .find(|team| team.id == inputs.team_id)
                    .map(|team| team.name.clone());
            }
            let team_id = install_custom_club(game, inputs, spec)?;
            install_generated_squad(game, inputs, spec, &team_id)
                .map_err(|error| error.to_wire())?;
            team_id
        }
        None if inputs.joins_league => {
            return Err("Joining a league needs a custom club".to_string());
        }
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
    Ok((user_team_id, replaced_team_name))
}

/// The part of the world build the founding squad depends on, shared by
/// [`build_new_game_world`] and the squad preview so both see the same world: the
/// game clock, the modular data and the roster overlay.
fn assemble_base_world(
    game: &mut Game,
    inputs: &NewGameWorldInputs<'_>,
    rating_overrides: &PlayerRatingOverrides,
) -> Result<(), String> {
    // The new game starts in the season after the roster snapshot, so ages,
    // contracts and the schedule all line up with that year.
    game.clock = GameClock::new(new_game_start_for(inputs.overlay));

    // Assemble teams, players, staff from modular data
    let (assembled_teams, assembled_players, assembled_staff) =
        assemble_world_with_rating_overrides(
            inputs.data_dir,
            inputs.manifests,
            inputs.competition_id,
            inputs.team_id,
            game.clock.current_date.date_naive(),
            rating_overrides,
        )?;

    game.teams = assembled_teams;
    game.players = assembled_players;
    game.staff = assembled_staff;

    // Bring the bundled snapshot up to date before lineups are built from it.
    if let Some(overlay) = inputs.overlay {
        let report = apply_roster_overlay(game, overlay);
        // Players the overlay added never went through the assembly pass; give them
        // the same stat-derived ratings, then re-run the market values the pass cleared.
        if !report.added_player_ids.is_empty() {
            let added: HashSet<String> = report.added_player_ids.iter().cloned().collect();
            let applied = apply_player_rating_overrides(
                &mut game.players,
                rating_overrides,
                Some(&added),
            );
            info!(
                "[game] rating overrides for overlay-added players: {} applied, {} stale",
                applied.applied, applied.skipped_stale
            );
            game_setup::apply_default_market_values(&mut game.players);
        }
    }
    Ok(())
}

/// Install the custom club and return the new club's id: it replaces
/// `inputs.team_id`, or joins `inputs.competition_id` as an extra club when
/// `inputs.joins_league` is set.
///
/// The backend is the authority on eligibility: the target competition's merged
/// manifest must allow custom clubs, whatever the UI offered.
fn install_custom_club(
    game: &mut Game,
    inputs: &NewGameWorldInputs<'_>,
    spec: &CustomTeamSpec,
) -> Result<String, String> {
    let manifest = inputs
        .manifests
        .iter()
        .find(|manifest| manifest.id == inputs.competition_id);
    let allowed = manifest.is_some_and(custom_team::custom_team_allowed);
    if !allowed {
        return Err(format!(
            "Competition '{}' does not accept custom clubs",
            inputs.competition_id
        ));
    }
    if inputs.joins_league {
        let outcome = custom_team::join_team_with_custom(game, inputs.competition_id, spec)?;
        info!(
            "[game] custom club {} joins {} as an extra club",
            outcome.team_id, inputs.competition_id
        );
        return Ok(outcome.team_id);
    }
    let outcome = custom_team::replace_team_with_custom(
        game,
        inputs.competition_id,
        manifest.and_then(|manifest| manifest.tier),
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

/// Fresh seed for a founding squad the request did not seed. The app crate owns
/// this non-determinism; `olm_core` only ever sees the resulting number.
fn random_founding_seed() -> u32 {
    use rand::RngExt;
    rand::rng().random::<u32>()
}

/// Everything the founding squad is generated from besides the world: the seed
/// (random when the spec has none), the competition's home country and the
/// identity edits. The preview and the install both read it from here.
struct FoundingArgs<'a> {
    seed: u32,
    home_country: Option<&'a str>,
    overrides: FounderOverrides,
}

fn founding_args<'a>(inputs: &NewGameWorldInputs<'a>, spec: &CustomTeamSpec) -> FoundingArgs<'a> {
    FoundingArgs {
        seed: spec.founding_seed.unwrap_or_else(random_founding_seed),
        home_country: inputs
            .manifests
            .iter()
            .find(|manifest| manifest.id == inputs.competition_id)
            .and_then(|manifest| manifest.country.as_deref()),
        overrides: spec.founder_overrides.clone().unwrap_or_default(),
    }
}

/// Gives the new custom club its generated founding squad and the wage budget
/// derived from it.
///
/// A generator error never fails club creation: it logs a warning and returns
/// `Ok(None)`, leaving the club to the free-agent roster fill. A broken identity
/// override is the user's input, so it returns `Err` and the creation is rejected
/// instead of falling back.
fn install_generated_squad(
    game: &mut Game,
    inputs: &NewGameWorldInputs<'_>,
    spec: &CustomTeamSpec,
    team_id: &str,
) -> Result<Option<FoundingSquadOutcome>, FounderError> {
    let args = founding_args(inputs, spec);
    match install_founding_squad_with(
        game,
        inputs.competition_id,
        team_id,
        args.home_country,
        u64::from(args.seed),
        &args.overrides,
    ) {
        Ok(outcome) => {
            if let Some(photos) = spec.founder_photos.as_ref().filter(|p| !p.is_empty()) {
                apply_founder_photos(game, &outcome.player_ids, photos)
                    .map_err(FounderError::InvalidPhoto)?;
            }
            info!(
                "[game] founding squad for {} (seed {}): {} players, wage budget {} (peer median {}, {} peers{})",
                team_id,
                args.seed,
                outcome.player_ids.len(),
                outcome.wage_budget,
                outcome.peer_median_wage_budget,
                outcome.peer_count,
                if outcome.percentiles_from_peers {
                    ""
                } else {
                    ", default OVR window"
                }
            );
            Ok(Some(outcome))
        }
        Err(FoundingSquadError::Edit(error)) => Err(FounderError::InvalidField(error)),
        Err(error) => {
            warn!(
                "[game] founding squad for {} failed ({}); falling back to the free-agent fill",
                team_id, error
            );
            Ok(None)
        }
    }
}

/// Name of the stand-in club a squad preview builds around; it never reaches a game.
const PREVIEW_CLUB_NAME: &str = "Founding Preview";

/// The founding squad `build_new_game_world` would install for the same inputs,
/// built on a scratch game and returned as the wizard's summary.
///
/// It runs the real world build up to the squad: the same clock, data, roster
/// overlay and custom-club replacement, so the peers and the taken names (the
/// replaced club's released players included) are exactly the install's. Then it
/// calls the same [`plan_founding_squad`] the install does. `inputs.custom_team`
/// must be set. Nothing is created, saved or put in the session.
pub(crate) fn preview_founding_squad_world(
    inputs: &NewGameWorldInputs<'_>,
) -> Result<FoundingSquadSummary, String> {
    let spec = inputs
        .custom_team
        .ok_or_else(|| "A squad preview needs a custom club".to_string())?;
    let manager = Manager::new(
        "preview".to_string(),
        String::new(),
        String::new(),
        "1990-01-01".to_string(),
        "ES".to_string(),
    );
    let mut game = Game::new(
        GameClock::new(chrono::Utc::now()),
        manager,
        vec![],
        vec![],
        vec![],
        vec![],
    );
    // The same bundled ratings the install uses, so the preview equals the install.
    assemble_base_world(
        &mut game,
        inputs,
        olm_core::player_rating_overrides::bundled(),
    )?;
    let team_id = install_custom_club(&mut game, inputs, spec)?;
    let args = founding_args(inputs, spec);
    plan_founding_squad(
        &game,
        inputs.competition_id,
        &team_id,
        args.home_country,
        u64::from(args.seed),
        &args.overrides,
    )
    .map(|plan| plan.summary())
    .map_err(|error| match error {
        FoundingSquadError::Edit(edit) => FounderError::InvalidField(edit).to_wire(),
        other => other.to_string(),
    })
}

/// Preview of the generated founding squad for the creation wizard.
///
/// Returns the five founders (visible data only, never the hidden potential), the
/// derived `wage_budget` and the yearly `bill`. It is read-only: it builds a
/// scratch world, so it does not create, mutate or save a game and never touches
/// the session. With the same `seed`, `short_name` and `founder_overrides`, the
/// players `select_team` installs for the same custom club are exactly these.
///
/// `founder_overrides` are validated like the install's; a broken one is an `Err`
/// holding the JSON of a [`FounderError`] (see `olm_core::founder_identity`).
///
/// With `replaced_team_id` the club replaces that team; without it (omitted or
/// null) the club joins `competition_id` as an extra club.
#[tauri::command]
pub async fn preview_founding_squad(
    app_handle: tauri::AppHandle,
    competition_id: String,
    replaced_team_id: Option<String>,
    short_name: String,
    seed: u32,
    founder_overrides: Option<FounderOverrides>,
) -> Result<FoundingSquadSummary, String> {
    info!(
        "[cmd] preview_founding_squad: competition={}, replaces={:?}, short_name={}, seed={}",
        competition_id, replaced_team_id, short_name, seed
    );
    let manifests = crate::commands::competitions::scan_competitions(&app_handle);
    let data_dir = crate::commands::competitions::require_data_base(&app_handle)?;
    let overlay = resolve_world_overlay(&app_handle);
    tauri::async_runtime::spawn_blocking(move || {
        let spec = CustomTeamSpec {
            name: PREVIEW_CLUB_NAME.to_string(),
            short_name,
            primary_color: "#000000".to_string(),
            secondary_color: "#ffffff".to_string(),
            country: "ES".to_string(),
            logo_data_uri: None,
            founding_seed: Some(seed),
            founder_overrides,
            // The preview never carries photos: they do not change a single stat.
            founder_photos: None,
        };
        preview_founding_squad_world(&NewGameWorldInputs {
            data_dir: &data_dir,
            manifests: &manifests,
            competition_id: &competition_id,
            team_id: replaced_team_id.as_deref().unwrap_or_default(),
            overlay: overlay.as_ref(),
            custom_team: Some(&spec),
            joins_league: replaced_team_id.is_none(),
        })
    })
    .await
    .map_err(|error| format!("Squad preview failed: {error}"))?
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

/// What the player picked in the team-selection step.
#[derive(Debug, PartialEq, Eq)]
enum TeamPick {
    /// An existing team (or, with a custom club, the slot it replaces).
    Existing(String),
    /// A custom club that joins this competition as an extra club.
    JoinLeague(String),
}

/// Reads `select_team`'s arguments: a team id (existing team, or the slot a
/// custom club replaces) or, to join a league, a competition id with a custom
/// club and no team id. Anything ambiguous is rejected.
fn resolve_team_pick(
    team_id: Option<String>,
    joins_competition_id: Option<String>,
    custom_team: Option<&CustomTeamSpec>,
) -> Result<TeamPick, String> {
    match (team_id, joins_competition_id) {
        (Some(team_id), None) => Ok(TeamPick::Existing(team_id)),
        (None, Some(competition_id)) if custom_team.is_some() => {
            Ok(TeamPick::JoinLeague(competition_id))
        }
        (None, Some(_)) => Err("Joining a league needs a custom club".to_string()),
        (Some(_), Some(_)) => {
            Err("Pick either a team to replace or a league to join, not both".to_string())
        }
        (None, None) => Err("No team was picked".to_string()),
    }
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
/// and now we need to load the selected competition's data. Production goes through
/// [`build_new_game_world`]; this wrapper (bundled rating overrides) serves the tests
/// that assemble the catalog directly.
#[cfg(test)]
pub(crate) fn assemble_world_from_modular_data(
    data_dir: &Path,
    manifests: &[CompetitionManifest],
    competition_id: &str,
    team_id: &str,
    start_date: chrono::NaiveDate,
) -> Result<AssembledWorld, String> {
    assemble_world_with_rating_overrides(
        data_dir,
        manifests,
        competition_id,
        team_id,
        start_date,
        olm_core::player_rating_overrides::bundled(),
    )
}

/// [`assemble_world_from_modular_data`] with an explicit stat-derived rating
/// overrides document instead of the bundled one.
pub(crate) fn assemble_world_with_rating_overrides(
    data_dir: &Path,
    manifests: &[CompetitionManifest],
    competition_id: &str,
    team_id: &str,
    start_date: chrono::NaiveDate,
    rating_overrides: &PlayerRatingOverrides,
) -> Result<AssembledWorld, String> {
    assemble_world_reporting_rating_overrides(
        data_dir,
        manifests,
        competition_id,
        team_id,
        start_date,
        rating_overrides,
    )
    .map(|(world, _)| world)
}

/// [`assemble_world_with_rating_overrides`] that also returns what the
/// stat-derived rating pass did, so tests can check how the overrides landed.
pub(crate) fn assemble_world_reporting_rating_overrides(
    data_dir: &Path,
    manifests: &[CompetitionManifest],
    competition_id: &str,
    team_id: &str,
    start_date: chrono::NaiveDate,
    rating_overrides: &PlayerRatingOverrides,
) -> Result<(AssembledWorld, ApplyReport), String> {
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
                // Stale copies of a live competition keep no teams: they get no league,
                // so nothing would repair or simulate them. Their players follow the
                // duplicate and orphan rules below.
                if world_catalog::is_stale_duplicate_competition(cid) {
                    info!(
                        "[game] dropped {} teams of stale competition '{}'",
                        comp_teams.len(),
                        cid
                    );
                } else {
                    all_teams.extend(comp_teams);
                }
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
    //
    // 5b. Stat-derived ratings go first: they replace authored ratings with estimates
    // built from real stats, and the low-confidence ones must not set the league
    // medians a placeholder is estimated from. Wages stay authored; a cleared market
    // value is recomputed by step 7.
    let rated = apply_player_rating_overrides(&mut all_players, rating_overrides, None);
    info!(
        "[game] rating overrides: {} applied, {} stale, {} missing, {} low confidence",
        rated.applied,
        rated.skipped_stale,
        rated.skipped_missing,
        rated.low_confidence_ids.len()
    );
    let estimated = olm_core::placeholder_ratings::estimate_placeholder_ratings_excluding(
        &mut all_players,
        &all_teams,
        &rated.low_confidence_ids,
    );
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

    // Staff shipped with only a name and a role get attributes and a wage from their
    // league's rated staff, so none enters the game rated 0.
    let completed = olm_core::staff_completion::complete_missing_staff(&mut staff, &all_teams, true);
    info!(
        "[game] completed {} staff without data ({} wages)",
        completed.attributes, completed.wages
    );

    info!(
        "[game] assemble_world_from_modular_data: {} teams, {} players, {} staff",
        all_teams.len(),
        all_players.len(),
        staff.len()
    );

    Ok(((all_teams, all_players, staff), rated))
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
        // Stale copies of a live competition get no league in a new game: they would
        // be repaired and simulated every day for nothing. Saves keep their own set.
        if olm_core::world_catalog::is_stale_duplicate_competition(cid) {
            continue;
        }
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

/// Day-one welcome and, for a club the player created, the league news that
/// announces it. A career with an existing club gets the generic welcome and no
/// article; a custom club gets the founding welcome for its mode.
fn push_welcome_and_founding_news(
    game: &mut Game,
    team_id: &str,
    team_name: &str,
    founding: Option<FoundingMode<'_>>,
    league_name: &str,
    date: &str,
    lang: &str,
) {
    let days_to_start = game_setup::days_until_first_league_fixture(game);
    let Some(mode) = founding else {
        game.messages.push(olm_core::messages::welcome_message(
            team_name,
            team_id,
            date,
            lang,
            days_to_start,
        ));
        return;
    };
    game.messages.push(olm_core::messages::founding_welcome_message(
        team_name,
        team_id,
        mode,
        days_to_start,
        date,
    ));
    // A custom club has no city, only the country it was created in.
    let origin = game
        .teams
        .iter()
        .find(|team| team.id == team_id)
        .map(|team| if team.city.is_empty() { team.country.clone() } else { team.city.clone() })
        .unwrap_or_default();
    game.news.push(olm_core::news::new_club_article(
        team_id,
        team_name,
        &origin,
        league_name,
        mode,
        date,
    ));
}

/// Step 2: User picks a team. Assigns manager, generates welcome message, saves to DB.
/// Supports both Flow A (world pre-loaded) and Flow C (modular assembly).
#[tauri::command]
pub async fn select_team(
    state: State<'_, StateManager>,
    sm_state: State<'_, SaveManagerState>,
    app_handle: tauri::AppHandle,
    team_id: Option<String>,
    lang: Option<String>,
    custom_team: Option<CustomTeamSpec>,
    joins_competition_id: Option<String>,
) -> Result<Game, String> {
    let lang = lang.unwrap_or_else(|| "en".to_string());
    info!(
        "[cmd] select_team: team_id={:?}, joins={:?}, lang={}",
        team_id, joins_competition_id, lang
    );
    let pick = resolve_team_pick(
        team_id,
        joins_competition_id,
        custom_team.as_ref(),
    )?;
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

    // With a custom club, `team_id` named the slot it replaces (or nothing, when it
    // joins a league); from here on it is the user's actual team.
    let (team_id, replaced_team_name) = if game.teams.is_empty() {
        info!("[cmd] select_team: empty game state — assembling from modular data");

        let (competition_id, slot_team_id, joins_league) = match &pick {
            // Extract competition ID from team ID (e.g. "lec-g2" → "lec")
            TeamPick::Existing(team_id) => (
                competition_id_from_team_id_known(team_id, &known_competition_ids).ok_or_else(
                    || {
                        format!(
                            "Invalid team ID format '{}': missing competition prefix",
                            team_id
                        )
                    },
                )?,
                team_id.as_str(),
                false,
            ),
            TeamPick::JoinLeague(competition_id) => (
                known_competition_ids
                    .iter()
                    .find(|known| *known == competition_id)
                    .map(String::as_str)
                    .ok_or_else(|| format!("Unknown competition '{competition_id}'"))?,
                "",
                true,
            ),
        };

        // Use the same multi-tier resolution as the rest of the data layer so the
        // Tauri `_up_/data` install layout is handled correctly.
        olm_core::state::RESOURCE_DATA_DIR.get_or_init(|| {
            crate::commands::competitions::resolve_data_base(&app_handle)
                .unwrap_or_else(|| PathBuf::from("data"))
        });
        let data_dir = crate::commands::competitions::require_data_base(&app_handle)?;
        let overlay = resolve_world_overlay(&app_handle);

        build_world_naming_replaced_club(
            &mut game,
            &NewGameWorldInputs {
                data_dir: &data_dir,
                manifests: &all_manifests,
                competition_id,
                team_id: slot_team_id,
                overlay: overlay.as_ref(),
                custom_team: custom_team.as_ref(),
                joins_league,
            },
            olm_core::player_rating_overrides::bundled(),
        )?
    } else {
        match pick {
            TeamPick::Existing(team_id) => (team_id, None),
            TeamPick::JoinLeague(_) => {
                return Err("A custom club can only be created for a new career".to_string());
            }
        }
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
        // Same data-base candidates as teams and players, so a packaged or
        // Android build finds the bundled templates too.
        let messages_root = crate::commands::competitions::resolve_messages_root(&app_handle);

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

    let founding = custom_team.as_ref().map(|_| match replaced_team_name.as_deref() {
        Some(replaced_team_name) => FoundingMode::Replace { replaced_team_name },
        None => FoundingMode::Join,
    });
    push_welcome_and_founding_news(
        &mut game,
        &team_id,
        &team_name,
        founding,
        &league_display_name,
        &date_str,
        &lang,
    );

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

    let league_teams: Vec<&Team> = game
        .teams
        .iter()
        .filter(|team| {
            team.team_kind != TeamKind::Academy && team.competition_id.as_deref() == user_cid
        })
        .collect();
    let team_names =
        olm_core::board_objectives::team_names_by_strength(&league_teams, &game.players);
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
    state.install_loaded_game(save_id, game);
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
pub async fn save_game(
    state: State<'_, StateManager>,
    sm_state: State<'_, SaveManagerState>,
) -> Result<(), String> {
    info!("[cmd] save_game");
    let mut sm = sm_state
        .0
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    state.save_active_game(&mut sm)
}

/// Save the current game and clear the active session so the player returns to the main menu.
#[tauri::command]
pub async fn exit_to_menu(
    state: State<'_, StateManager>,
    sm_state: State<'_, SaveManagerState>,
) -> Result<(), String> {
    info!("[cmd] exit_to_menu");
    if state.get_game(|_| ()).is_none() {
        return Err("No active game session".to_string());
    }

    // Auto-save
    if state.get_save_id().is_some() {
        let mut sm = sm_state
            .0
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        state.save_active_game(&mut sm)?;
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

    fn any_spec() -> CustomTeamSpec {
        CustomTeamSpec {
            name: "Rayo Esports".to_string(),
            short_name: "RAY".to_string(),
            primary_color: "#f97316".to_string(),
            secondary_color: "#111111".to_string(),
            country: "ES".to_string(),
            logo_data_uri: None,
            founding_seed: None,
            founder_overrides: None,
            founder_photos: None,
        }
    }

    #[test]
    fn an_old_pick_with_only_a_team_id_still_resolves() {
        let spec = any_spec();

        assert_eq!(
            resolve_team_pick(Some("lec-g2".to_string()), None, None),
            Ok(TeamPick::Existing("lec-g2".to_string()))
        );
        assert_eq!(
            resolve_team_pick(Some("les-team-1".to_string()), None, Some(&spec)),
            Ok(TeamPick::Existing("les-team-1".to_string()))
        );
    }

    #[test]
    fn a_join_pick_names_a_competition_and_needs_a_custom_club() {
        let spec = any_spec();

        assert_eq!(
            resolve_team_pick(None, Some("les".to_string()), Some(&spec)),
            Ok(TeamPick::JoinLeague("les".to_string()))
        );
        assert!(resolve_team_pick(None, Some("les".to_string()), None).is_err());
    }

    #[test]
    fn an_ambiguous_or_empty_pick_is_rejected() {
        let spec = any_spec();

        assert!(
            resolve_team_pick(
                Some("les-team-1".to_string()),
                Some("les".to_string()),
                Some(&spec)
            )
            .is_err()
        );
        assert!(resolve_team_pick(None, None, Some(&spec)).is_err());
    }

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
        use olm_core::founder_identity::FounderIdentityOverride;
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

        /// [`new_game`] with the bundled rating overrides switched off: the authored
        /// ratings that rating, wage-formula and override tests compare against.
        fn new_game_without_overrides() -> (Game, Vec<Player>, WorldOverlay, String) {
            let (_, _, overlay, user_team) = new_game();
            let (manifests, _) = known_ids_and_manifests();
            let ((_, catalog, _), _) = assemble_world_reporting_rating_overrides(
                &data_base(),
                &manifests,
                "",
                "",
                chrono::NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
                &PlayerRatingOverrides::default(),
            )
            .expect("catalog without overrides");
            let game = world_with_rating_overrides(
                &PlayerRatingOverrides::default(),
                &overlay,
                &user_team,
            );
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
                    joins_league: false,
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

        /// A new game schedules no league for the stale duplicates the catalog still
        /// ships (`lck-cl`, `prime_league`): they have no teams and would only be repaired
        /// and simulated every day for nothing.
        #[test]
        fn a_new_game_builds_no_league_for_stale_duplicate_competitions() {
            let (mut game, _catalog_players, _overlay, user_team) = new_game();
            let (manifests, known) = known_ids_and_manifests();
            prepare_new_game_season(&mut game, &manifests, &known, &user_team).expect("season setup");

            let ids: Vec<&str> = game
                .leagues
                .iter()
                .filter_map(|l| l.competition_id.as_deref())
                .collect();
            let stale: Vec<&&str> = ids
                .iter()
                .filter(|id| olm_core::world_catalog::is_stale_duplicate_competition(id))
                .collect();
            assert!(stale.is_empty(), "stale leagues built: {stale:?}");
        }

        /// The stale duplicates' teams are not part of a new game either: without a league
        /// they would never be repaired or simulated, and still show up in the market, in
        /// search and in the tier lookup. Their players become free agents.
        #[test]
        fn a_new_game_has_no_teams_or_rostered_players_for_stale_duplicate_competitions() {
            let (game, _catalog_players, _overlay, _user_team) = new_game();

            let stale_teams: Vec<&str> = game
                .teams
                .iter()
                .filter(|t| {
                    t.competition_id
                        .as_deref()
                        .is_some_and(olm_core::world_catalog::is_stale_duplicate_competition)
                })
                .map(|t| t.id.as_str())
                .collect();
            assert!(stale_teams.is_empty(), "stale teams kept: {stale_teams:?}");

            let team_ids: HashSet<&str> = game.teams.iter().map(|t| t.id.as_str()).collect();
            let dangling = game
                .players
                .iter()
                .filter(|p| p.team_id.as_deref().is_some_and(|id| !team_ids.contains(id)))
                .count();
            assert_eq!(dangling, 0, "players left on a team that does not exist");
            assert!(
                game.teams.iter().any(|t| t.competition_id.as_deref() == Some("lckcl")),
                "the live LCK CL keeps its teams"
            );
        }

        /// The academy catalogs read the manifests from disk; they must skip the stale
        /// duplicates too, or the academy offers teams the game no longer carries.
        #[test]
        fn the_academy_catalogs_skip_stale_duplicate_competitions() {
            let _ = new_game();
            let erl = olm_core::academy::academy_erl_catalog();
            assert!(erl.iter().any(|l| l.id == "lckcl"), "live leagues stay");
            let stale_leagues: Vec<&str> = erl
                .iter()
                .filter(|l| matches!(l.id.as_str(), "lck_cl" | "lck-cl" | "prime_league"))
                .map(|l| l.id.as_str())
                .collect();
            assert!(stale_leagues.is_empty(), "stale ERL leagues: {stale_leagues:?}");
            let stale_candidates = olm_core::academy::academy_candidate_catalog()
                .iter()
                .filter(|c| matches!(c.erl_league_id.as_str(), "lck_cl" | "lck-cl" | "prime_league"))
                .count();
            assert_eq!(stale_candidates, 0);
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

        /// A saved new game keeps its league set and its teams through the load path: the
        /// catalog rehydration and the rebuilt competition configs (which still list the stale
        /// duplicate manifests) add neither a league nor a team of a stale competition.
        #[test]
        fn loading_a_new_game_save_brings_back_no_stale_league_or_team() {
            let (mut game, catalog_players, _overlay, user_team) = new_game();
            let (manifests, known) = known_ids_and_manifests();
            prepare_new_game_season(&mut game, &manifests, &known, &user_team).expect("season setup");
            let league_ids = |game: &Game| -> Vec<Option<String>> {
                game.leagues.iter().map(|l| l.competition_id.clone()).collect()
            };
            let (leagues_before, teams_before) = (league_ids(&game), game.teams.len());

            let dir = tempfile::tempdir().expect("tempdir");
            let mut manager = SaveManager::init(dir.path()).expect("save manager");
            let save_id = manager.create_save(&game, "stale").expect("create save");
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

            assert_eq!(league_ids(&loaded), leagues_before, "the league set is the saved one");
            assert_eq!(loaded.teams.len(), teams_before, "no team is added by the load");
            assert!(
                loaded
                    .teams
                    .iter()
                    .all(|t| !t.competition_id.as_deref().is_some_and(olm_core::world_catalog::is_stale_duplicate_competition)),
                "a stale competition's team came back"
            );
        }

        /// A new world built the way `select_team` does, but with the given rating
        /// overrides instead of the bundled ones.
        fn world_with_rating_overrides(
            overrides: &PlayerRatingOverrides,
            overlay: &WorldOverlay,
            slot_id: &str,
        ) -> Game {
            let mut game = empty_session();
            let data = data_base();
            let (manifests, known_ids) = known_ids_and_manifests();
            let competition_id = competition_id_from_team_id_known(slot_id, &known_ids)
                .expect("competition prefix");
            build_new_game_world_with_rating_overrides(
                &mut game,
                &NewGameWorldInputs {
                    data_dir: &data,
                    manifests: &manifests,
                    competition_id,
                    team_id: slot_id,
                    overlay: Some(overlay),
                    custom_team: None,
                    joins_league: false,
                },
                overrides,
            )
            .expect("build new game world");
            game
        }

        /// One-entry overrides document that sets every attribute of `id` to `value`.
        fn single_override(id: &str, authored_ovr: u8, value: u8) -> PlayerRatingOverrides {
            PlayerRatingOverrides::parse(&format!(
                r#"{{"version":1,"method":"stat-blend-v1","source":"test",
                "window":{{"since":"2025-01-01","until":"2026-01-01"}},"league_levels":{{}},
                "entries":[{{"id":"{id}","authored_ovr":{authored_ovr},"games":60,
                "confidence":0.8,"attributes":{{"mechanics":{value},"laning":{value},
                "teamfighting":{value},"macro_play":{value},"consistency":{value},
                "shotcalling":{value},"champion_pool":{value},"discipline":{value},
                "mental_resilience":{value}}},"potential_floor":{value}}}]}}"#
            ))
            .expect("fixture overrides parse")
        }

        /// The fields a rating override may touch, plus the wage it must not.
        fn rating_snapshot(game: &Game) -> HashMap<String, ([u8; 9], u8, u8, u64, u32)> {
            game.players
                .iter()
                .map(|p| {
                    (
                        p.id.clone(),
                        (p.attributes.as_array(), p.lol_ovr, p.potential_base, p.market_value, p.wage),
                    )
                })
                .collect()
        }

        /// A rostered player with an authored wage and an OVR of at most 90, from the
        /// assembled catalog: the state the override guard compares against. An authored
        /// wage keeps the downstream wage seeding out of the comparison.
        fn rated_catalog_player(catalog: &[Player]) -> (String, u8) {
            let p = catalog
                .iter()
                .find(|p| {
                    p.team_id.is_some()
                        && p.wage > 0
                        && olm_core::potential::calculate_lol_ovr(p) <= 90
                })
                .expect("a rostered player with an authored wage");
            (p.id.clone(), olm_core::potential::calculate_lol_ovr(p))
        }

        /// A new world built from the bundled data with the bundled overrides, plus
        /// the report of the assembly pass that applied them.
        fn bundled_world_and_report() -> (Game, ApplyReport) {
            let (manifests, _) = known_ids_and_manifests();
            let (_, report) = assemble_world_reporting_rating_overrides(
                &data_base(),
                &manifests,
                "",
                "",
                chrono::NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
                olm_core::player_rating_overrides::bundled(),
            )
            .expect("assemble with the bundled overrides");
            let (game, ..) = new_game();
            (game, report)
        }

        /// True when the player carries exactly the attributes of its override entry.
        fn carries_entry_attributes(
            p: &Player,
            entry: &olm_core::player_rating_overrides::PlayerRatingOverride,
        ) -> bool {
            let a = &entry.attributes;
            p.attributes.as_array()
                == [
                    a.mechanics,
                    a.laning,
                    a.teamfighting,
                    a.macro_play,
                    a.consistency,
                    a.shotcalling,
                    a.champion_pool,
                    a.discipline,
                    a.mental_resilience,
                ]
        }

        #[test]
        fn the_bundled_rating_overrides_land_on_a_real_new_world() {
            let bundled = olm_core::player_rating_overrides::bundled();
            let entries = bundled.len();
            let (world, report) = bundled_world_and_report();
            let in_world = world.players.iter().filter(|p| bundled.entry(&p.id).is_some()).count();
            let landed = world
                .players
                .iter()
                .filter(|p| bundled.entry(&p.id).is_some_and(|e| carries_entry_attributes(p, e)))
                .count();
            println!(
                "bundled overrides: {entries} entries; assembly pass {} applied, {} stale, {} missing; \
                 final world holds {in_world} listed players, {landed} carry their entry",
                report.applied, report.skipped_stale, report.skipped_missing
            );
            assert!(report.skipped_stale * 20 <= entries, "stale: {}", report.skipped_stale);
            // Entries the assembly pass could not find belong to players the roster
            // overlay adds; the second pass applies those.
            assert_eq!(in_world, entries, "every entry has a player in the new world");
            assert!(landed * 10 >= entries * 9, "{landed} of {entries} entries landed");
        }

        #[test]
        fn a_bundled_entry_sets_the_ratings_of_its_player_in_a_new_world() {
            let bundled = olm_core::player_rating_overrides::bundled();
            let (world, _) = bundled_world_and_report();
            let boal = player_named(&world, "Boal")
                .into_iter()
                .find(|p| bundled.entry(&p.id).is_some())
                .expect("Boal has a bundled entry");
            let entry = bundled.entry(&boal.id).expect("entry");
            let a = &entry.attributes;
            let array = [
                a.mechanics,
                a.laning,
                a.teamfighting,
                a.macro_play,
                a.consistency,
                a.shotcalling,
                a.champion_pool,
                a.discipline,
                a.mental_resilience,
            ];
            let mut expected = boal.clone();
            expected.attributes = PlayerAttributes::from_array(array);
            let expected_ovr = olm_core::potential::calculate_lol_ovr(&expected);
            assert_eq!(boal.lol_ovr, expected_ovr);
            assert_eq!(boal.attributes.as_array(), array);
        }

        #[test]
        fn unlisted_players_keep_their_ratings_and_every_wage_stays_in_a_new_world() {
            let bundled = olm_core::player_rating_overrides::bundled();
            let (with_game, _) = bundled_world_and_report();
            let (_, _, overlay, user_team) = new_game();
            let without_game = world_with_rating_overrides(
                &PlayerRatingOverrides::default(),
                &overlay,
                &user_team,
            );
            let with = rating_snapshot(&with_game);
            let without = rating_snapshot(&without_game);
            let free_agents: HashSet<&str> = without_game
                .players
                .iter()
                .filter(|p| p.team_id.is_none())
                .map(|p| p.id.as_str())
                .collect();

            // Placeholder estimates take their league medians from the rated players
            // around them, so an unlisted rostered placeholder may drift a little when
            // its league's ratings move. Nothing else about an unlisted player may change.
            let mut drifted = 0;
            let mut max_drift = 0u8;
            for (id, row) in without.iter().filter(|(id, _)| bundled.entry(id).is_none()) {
                let after = &with[id];
                if after != row {
                    drifted += 1;
                    max_drift = max_drift.max(after.1.abs_diff(row.1));
                    assert!(!free_agents.contains(id.as_str()), "{id}: free agents never drift");
                }
            }
            println!("unlisted players that drifted: {drifted}, max OVR drift {max_drift}");
            assert!(max_drift <= 3, "unlisted OVR drift {max_drift}");

            // Wages that are not authored (0) are seeded per club from its players'
            // ratings and may move; authored ones never do.
            let (_, catalog, ..) = new_game_without_overrides();
            let wage_changes: Vec<_> = catalog
                .iter()
                .filter(|p| p.wage > 0)
                .filter(|p| match (with.get(&p.id), without.get(&p.id)) {
                    (Some(w), Some(wo)) => w.4 != wo.4,
                    _ => false,
                })
                .map(|p| p.id.clone())
                .collect();
            assert_eq!(wage_changes, Vec::<String>::new());
            assert!(catalog.iter().any(|p| p.wage > 0), "the check needs authored wages");
        }

        #[test]
        fn potential_covers_the_rating_of_every_player_the_bundled_overrides_rated() {
            let bundled = olm_core::player_rating_overrides::bundled();
            let (world, _) = bundled_world_and_report();
            let (_, _, overlay, user_team) = new_game();
            let without = world_with_rating_overrides(
                &PlayerRatingOverrides::default(),
                &overlay,
                &user_team,
            );
            let below = |p: &&Player| p.potential_base < p.lol_ovr;
            let rated_below: Vec<_> = world
                .players
                .iter()
                .filter(|p| bundled.entry(&p.id).is_some())
                .filter(below)
                .map(|p| p.id.clone())
                .collect();
            assert_eq!(rated_below, Vec::<String>::new());
            // Data players shipped without a potential (0) sit below their rating with or
            // without overrides; overrides must not add to them.
            let already_below: HashSet<_> =
                without.players.iter().filter(below).map(|p| p.id.as_str()).collect();
            let new_below: Vec<_> = world
                .players
                .iter()
                .filter(below)
                .filter(|p| !already_below.contains(p.id.as_str()))
                .map(|p| p.id.clone())
                .collect();
            assert_eq!(new_below, Vec::<String>::new());
        }

        #[test]
        fn a_listed_player_gets_the_override_and_an_unlisted_one_does_not_change() {
            let (baseline, catalog, overlay, user_team) = new_game_without_overrides();
            let (id, ovr) = rated_catalog_player(&catalog);
            let new_ovr = ovr.saturating_add(6).min(99);

            let world = world_with_rating_overrides(
                &single_override(&id, ovr, new_ovr),
                &overlay,
                &user_team,
            );

            let (before, after) = (rating_snapshot(&baseline), rating_snapshot(&world));
            let (old, new) = (&before[&id], &after[&id]);
            assert_eq!(new.0, [new_ovr; 9]);
            assert_eq!(new.1, new_ovr);
            assert!(new.2 >= new_ovr, "potential is floored at the new OVR");
            assert_eq!(new.4, old.4, "wages are never changed");
            let was_derived = old.3 == 0
                || (old.4 > 0 && old.3 == 15 * u64::from(old.4))
                || old.3 == game_setup::suggested_seed_market_value(ovr, old.2.max(ovr), false)
                || old.3 == game_setup::suggested_seed_market_value(ovr, old.2.max(ovr), true);
            let expected_value = if was_derived {
                game_setup::suggested_seed_market_value(new_ovr, new.2.max(new_ovr), false)
            } else {
                old.3
            };
            assert_eq!(new.3, expected_value);
            for (other, row) in &before {
                if *other != id {
                    assert_eq!(Some(row), after.get(other), "{other} must not change");
                }
            }
        }

        #[test]
        fn a_stale_override_is_skipped() {
            let (baseline, catalog, overlay, user_team) = new_game_without_overrides();
            let (id, ovr) = rated_catalog_player(&catalog);
            let stale_ovr = if ovr > 50 { ovr - 1 } else { ovr + 1 };

            let world = world_with_rating_overrides(
                &single_override(&id, stale_ovr, 99),
                &overlay,
                &user_team,
            );

            assert_eq!(rating_snapshot(&baseline), rating_snapshot(&world));
        }

        #[test]
        fn a_player_added_by_the_overlay_gets_the_override_too() {
            let (baseline, _, bundled_overlay, user_team) = new_game_without_overrides();
            let overlay = WorldOverlay::parse(&format!(
                r#"{{"schemaVersion":1,"as_of":"{}",
                "source":{{"name":"Leaguepedia","license":"CC BY-SA 3.0","license_url":"https://www.fandom.com/licensing"}},
                "players":[{{"op":"add","player":{{"id":"overlay-rookie","match_name":"Rookie",
                "full_name":"Rookie","position":"Top","team_id":"{user_team}","contract_end":"",
                "date_of_birth":"2005-01-01"}}}}]}}"#,
                bundled_overlay.as_of
            ))
            .expect("overlay");
            let plain = world_with_rating_overrides(
                &PlayerRatingOverrides::default(),
                &overlay,
                &user_team,
            );
            let rookie = plain.players.iter().find(|p| p.id == "overlay-rookie").expect("rookie");
            let ovr = olm_core::potential::calculate_lol_ovr(rookie);
            let new_ovr = if ovr < 90 { ovr + 7 } else { ovr - 7 };
            assert!(baseline.players.iter().all(|p| p.id != "overlay-rookie"));

            let world = world_with_rating_overrides(
                &single_override("overlay-rookie", ovr, new_ovr),
                &overlay,
                &user_team,
            );

            let rookie = world.players.iter().find(|p| p.id == "overlay-rookie").expect("rookie");
            assert_eq!(rookie.attributes.as_array(), [new_ovr; 9]);
            assert_eq!(rookie.lol_ovr, new_ovr);
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
            // The wage formula is checked on his authored rating; the shipped overrides
            // lower it, which moves the wage on purpose.
            let (game, _catalog, _overlay, _user) = new_game_without_overrides();
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
                logo_data_uri: None,
                founding_seed: None,
                founder_overrides: None,
                founder_photos: None,
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
            // The wage budget is the exception: it is derived from the founding squad's bill.
            let squad: Vec<Player> = founders(&game, &id).into_iter().cloned().collect();
            assert_eq!(club.wage_budget, olm_core::squad_generator::founding_wage_budget(&squad));
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
                joins_league: false,
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

        fn seeded_rayo(seed: u32) -> CustomTeamSpec {
            CustomTeamSpec {
                logo_data_uri: None,
                founding_seed: Some(seed),
                founder_overrides: None,
                ..rayo()
            }
        }

        fn founders<'a>(game: &'a Game, id: &str) -> Vec<&'a Player> {
            game.players
                .iter()
                .filter(|p| p.team_id.as_deref() == Some(id))
                .collect()
        }

        /// Everything a seed decides about a squad, in role order.
        fn squad_fingerprint(game: &Game, id: &str) -> Vec<(String, String, String, String, u32, u8)> {
            let mut squad: Vec<_> = founders(game, id)
                .into_iter()
                .map(|p| {
                    (
                        p.id.clone(),
                        p.match_name.clone(),
                        p.full_name.clone(),
                        p.date_of_birth.clone(),
                        p.wage,
                        p.lol_ovr,
                    )
                })
                .collect();
            squad.sort();
            squad
        }

        /// A new custom club starts with five generated players: one per role at the wage
        /// floor, a wage budget derived from their bill, names that exist nowhere else in the
        /// world, a legal and valid lineup, and the replaced club's real players left on the
        /// market instead of being signed by the custom club.
        #[test]
        fn a_new_custom_club_gets_the_generated_founding_squad() {
            let (plain, _overlay, _) = try_build_world(LES_SLOT, None).expect("plain world");
            let replaced_players = roster_ids(&plain, LES_SLOT);
            assert!(!replaced_players.is_empty());

            let (game, _overlay, id) =
                try_build_world(LES_SLOT, Some(&seeded_rayo(7))).expect("custom club world");

            let squad = founders(&game, &id);
            assert_eq!(squad.len(), 5);
            assert!(squad.iter().all(|p| p.id.starts_with("gen-ray-")), "only generated players");
            for role in ROLES {
                assert_eq!(squad.iter().filter(|p| p.natural_position == role).count(), 1);
            }
            assert!(squad.iter().all(|p| p.wage >= olm_core::wage_scale::scale_wage_for_market_value(p.market_value)));
            let owned: Vec<Player> = squad.iter().map(|p| (*p).clone()).collect();
            let club = game.teams.iter().find(|t| t.id == id).expect("club");
            assert_eq!(club.wage_budget, olm_core::squad_generator::founding_wage_budget(&owned));
            assert!(annual_bill(&game, &id) <= club.wage_budget);

            // The replaced club's players go back to the market: the custom club never signs
            // them (other clubs' short rosters may, exactly as before this feature).
            let released: Vec<&Player> = game
                .players
                .iter()
                .filter(|p| replaced_players.contains(&p.id))
                .collect();
            assert_eq!(released.len(), replaced_players.len(), "released players are kept");
            assert!(released.iter().all(|p| p.team_id.as_deref() != Some(id.as_str())));
            assert!(released.iter().filter(|p| p.team_id.is_none()).all(|p| p.contract_end.is_none()));

            let generated_ids: HashSet<&str> = squad.iter().map(|p| p.id.as_str()).collect();
            let others: Vec<&Player> = game
                .players
                .iter()
                .filter(|p| !generated_ids.contains(p.id.as_str()))
                .collect();
            for new in &squad {
                assert!(!others.iter().any(|p| p.match_name.eq_ignore_ascii_case(&new.match_name)), "{}", new.match_name);
                assert!(!others.iter().any(|p| p.full_name.eq_ignore_ascii_case(&new.full_name)), "{}", new.full_name);
            }

            assert_eq!(club.active_lineup_ids.len(), 5);
            let lineup: HashSet<&str> = club.active_lineup_ids.iter().map(String::as_str).collect();
            assert_eq!(lineup, generated_ids);
            assert!(olm_core::residency::validate_lineup_imports(&game, &id, &club.active_lineup_ids).is_ok());
            assert!(squad.iter().all(|p| !p.is_import));
            assert!(duplicate_player_ids(&game.players).is_empty());
            ensure_custom_club_roster(&game, &id).expect("full roster");

            // The season setup that follows must leave the squad and its budget alone.
            let budget = club.wage_budget;
            let before = squad_fingerprint(&game, &id);
            let mut game = game;
            let (manifests, known) = known_ids_and_manifests();
            prepare_new_game_season(&mut game, &manifests, &known, &id).expect("season setup");
            assert_eq!(squad_fingerprint(&game, &id), before);
            assert_eq!(game.teams.iter().find(|t| t.id == id).map(|t| t.wage_budget), Some(budget));
        }

        #[test]
        fn the_same_founding_seed_builds_the_same_squad() {
            let (a, _, id_a) = try_build_world(LES_SLOT, Some(&seeded_rayo(21))).expect("a");
            let (b, _, id_b) = try_build_world(LES_SLOT, Some(&seeded_rayo(21))).expect("b");
            let (c, _, id_c) = try_build_world(LES_SLOT, Some(&seeded_rayo(22))).expect("c");

            assert_eq!(squad_fingerprint(&a, &id_a), squad_fingerprint(&b, &id_b));
            assert_ne!(squad_fingerprint(&a, &id_a), squad_fingerprint(&c, &id_c));
        }

        // -- Custom club joining a league (join mode) ---------------------------------

        /// What `select_team` does up to the day-one welcome, minus the Tauri handle: build
        /// the world (a custom club replaces `slot_id`, or joins the LES when `joins`), set
        /// the season up and push the welcome and, for a custom club, the news article.
        fn day_one_game(slot_id: &str, custom: Option<&CustomTeamSpec>, joins: bool) -> Game {
            let mut game = empty_session();
            let overlay = olm_core::world_overlay::bundled_world_overlay().expect("bundled overlay");
            let data = data_base();
            let (manifests, known) = known_ids_and_manifests();
            let competition_id = if joins {
                "les"
            } else {
                competition_id_from_team_id_known(slot_id, &known).expect("competition prefix")
            };
            let (team_id, replaced_team_name) = build_world_naming_replaced_club(
                &mut game,
                &NewGameWorldInputs {
                    data_dir: &data,
                    manifests: &manifests,
                    competition_id,
                    team_id: if joins { "" } else { slot_id },
                    overlay: Some(&overlay),
                    custom_team: custom,
                    joins_league: joins,
                },
                olm_core::player_rating_overrides::bundled(),
            )
            .expect("world");
            let season = prepare_new_game_season(&mut game, &manifests, &known, &team_id)
                .expect("season");
            let founding = custom.map(|_| match replaced_team_name.as_deref() {
                Some(replaced_team_name) => FoundingMode::Replace { replaced_team_name },
                None => FoundingMode::Join,
            });
            let date = game.clock.current_date.to_rfc3339();
            push_welcome_and_founding_news(
                &mut game,
                &team_id,
                &season.team_name,
                founding,
                "LES Winter",
                &date,
                "en",
            );
            game
        }

        fn welcomes(game: &Game) -> Vec<&olm_core::domain::message::InboxMessage> {
            game.messages
                .iter()
                .filter(|message| message.id.starts_with("welcome_"))
                .collect()
        }

        fn new_club_articles(game: &Game) -> Vec<&olm_core::domain::news::NewsArticle> {
            game.news
                .iter()
                .filter(|article| article.id.starts_with("new_club_"))
                .collect()
        }

        /// Days from the game clock to the first LES league fixture, read from the calendar.
        fn days_to_first_les_fixture(game: &Game) -> String {
            let first = league_dates(les_league(game)).remove(0);
            let first = chrono::NaiveDate::parse_from_str(&first, "%Y-%m-%d").unwrap();
            (first - game.clock.current_date.date_naive()).num_days().to_string()
        }

        #[test]
        fn a_replace_career_gets_the_founding_welcome_and_the_new_club_article() {
            let (plain, _overlay, _) = try_build_world(LES_SLOT, None).expect("plain world");
            let replaced = plain.teams.iter().find(|t| t.id == LES_SLOT).unwrap().name.clone();

            let game = day_one_game(LES_SLOT, Some(&rayo()), false);

            let welcomes = welcomes(&game);
            assert_eq!(welcomes.len(), 1, "exactly one welcome");
            assert_eq!(welcomes[0].id, "welcome_les-custom-ray");
            assert_eq!(
                welcomes[0].body_key.as_deref(),
                Some("be.msg.foundingWelcome.replace.body")
            );
            assert_eq!(welcomes[0].i18n_params.get("replaced"), Some(&replaced));
            assert_eq!(welcomes[0].i18n_params.get("team").map(String::as_str), Some("Rayo Esports"));
            assert_eq!(
                welcomes[0].i18n_params.get("days"),
                Some(&days_to_first_les_fixture(&game))
            );
            let articles = new_club_articles(&game);
            assert_eq!(articles.len(), 1, "exactly one new-club article");
            assert_eq!(
                articles[0].headline_key.as_deref(),
                Some("be.news.newClub.replace.headline")
            );
            assert_eq!(articles[0].i18n_params.get("replaced"), Some(&replaced));
            assert_eq!(articles[0].i18n_params.get("origin").map(String::as_str), Some("ES"));
            assert_eq!(articles[0].i18n_params.get("league").map(String::as_str), Some("LES Winter"));
        }

        #[test]
        fn a_join_career_gets_the_founding_welcome_and_the_new_club_article() {
            let game = day_one_game("", Some(&rayo()), true);

            let welcomes = welcomes(&game);
            assert_eq!(welcomes.len(), 1, "exactly one welcome");
            assert_eq!(
                welcomes[0].body_key.as_deref(),
                Some("be.msg.foundingWelcome.join.body")
            );
            assert!(!welcomes[0].i18n_params.contains_key("replaced"));
            assert_eq!(
                welcomes[0].i18n_params.get("days"),
                Some(&days_to_first_les_fixture(&game))
            );
            let articles = new_club_articles(&game);
            assert_eq!(articles.len(), 1, "exactly one new-club article");
            assert_eq!(
                articles[0].headline_key.as_deref(),
                Some("be.news.newClub.join.headline")
            );
            assert!(!articles[0].i18n_params.contains_key("replaced"));
        }

        #[test]
        fn a_career_with_an_existing_club_gets_the_generic_welcome_and_no_new_club_article() {
            let game = day_one_game(LES_SLOT, None, false);

            let welcomes = welcomes(&game);
            assert_eq!(welcomes.len(), 1, "exactly one welcome");
            assert!(
                !welcomes[0].body_key.as_deref().unwrap_or_default().contains("foundingWelcome"),
                "generic welcome expected: {:?}",
                welcomes[0].body_key
            );
            assert!(new_club_articles(&game).is_empty());
        }

        /// What `select_team` does for a join pick, minus the Tauri handle.
        fn try_build_join_world(
            competition_id: &str,
            custom: &CustomTeamSpec,
        ) -> Result<(Game, String), String> {
            let mut game = empty_session();
            let overlay = olm_core::world_overlay::bundled_world_overlay().expect("bundled overlay");
            let data = data_base();
            let (manifests, _known) = known_ids_and_manifests();
            let id = build_new_game_world(
                &mut game,
                &NewGameWorldInputs {
                    data_dir: &data,
                    manifests: &manifests,
                    competition_id,
                    team_id: "",
                    overlay: Some(&overlay),
                    custom_team: Some(custom),
                    joins_league: true,
                },
            )?;
            Ok((game, id))
        }

        fn les_main_ids(game: &Game) -> HashSet<String> {
            game.teams
                .iter()
                .filter(|t| {
                    t.competition_id.as_deref() == Some("les") && t.team_kind == TeamKind::Main
                })
                .map(|t| t.id.clone())
                .collect()
        }

        /// Distinct dates of the league fixtures, in order.
        fn league_dates(league: &olm_core::domain::league::League) -> Vec<String> {
            let mut dates: Vec<String> = league
                .fixtures
                .iter()
                .filter(|f| f.counts_for_league_standings())
                .map(|f| f.date.clone())
                .collect();
            dates.dedup();
            dates
        }

        /// An 8-club LES keeps its 28 fixtures on 7 weekly dates (pin of today's behaviour,
        /// on real data, for a plain career and for replace mode).
        #[test]
        fn the_eight_club_les_calendar_is_unchanged_in_plain_and_replace_mode() {
            let (manifests, known) = known_ids_and_manifests();
            let (mut plain, _overlay, plain_id) = try_build_world(LES_SLOT, None).expect("plain");
            prepare_new_game_season(&mut plain, &manifests, &known, &plain_id).expect("season");
            let (mut replaced, id) = custom_game();
            prepare_new_game_season(&mut replaced, &manifests, &known, &id).expect("season");

            for game in [&plain, &replaced] {
                let les = les_league(game);
                assert_eq!(les.standings.len(), 8);
                assert_eq!(les.fixtures.len(), 28);
                let dates = league_dates(les);
                assert_eq!(dates.len(), 7);
                assert!(dates.windows(2).all(|pair| {
                    let day = |d: &str| chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").unwrap();
                    (day(&pair[1]) - day(&pair[0])).num_days() == 7
                }));
                assert!(dates[0].ends_with("-01-17"), "Winter starts Jan 17: {}", dates[0]);
            }
        }

        #[test]
        fn a_joined_club_makes_a_nine_club_les_and_replaces_nobody() {
            let (plain, _overlay, _) = try_build_world(LES_SLOT, None).expect("plain world");
            let plain_les = les_main_ids(&plain);
            assert_eq!(plain_les.len(), 8);

            let (mut game, id) = try_build_join_world("les", &seeded_rayo(7)).expect("join world");

            assert_eq!(id, "les-custom-ray");
            let joined_les = les_main_ids(&game);
            assert_eq!(joined_les.len(), 9);
            assert!(plain_les.is_subset(&joined_les), "every original club stays");
            assert!(game.removed_team_ids.is_empty());
            let club = game.teams.iter().find(|t| t.id == id).expect("custom club");
            assert_eq!(club.competition_id.as_deref(), Some("les"));
            assert_eq!(club.academy_team_id, None);
            assert!(!game.teams.iter().any(|t| t.parent_team_id.as_deref() == Some(id.as_str())));

            // Nobody was released: every player of an LES club in the plain world is
            // still there (the club picks no one else's players).
            for player in plain.players.iter().filter(|p| {
                p.team_id.as_deref().is_some_and(|t| plain_les.contains(t))
            }) {
                let joined = game.players.iter().find(|p| p.id == player.id).expect("player kept");
                assert_eq!(joined.team_id, player.team_id, "{} moved", player.id);
            }

            // Founders, lineup and roster, exactly like a replacing club.
            let squad = founders(&game, &id);
            assert_eq!(squad.len(), 5);
            assert!(squad.iter().all(|p| p.id.starts_with("gen-ray-")));
            assert_eq!(club.active_lineup_ids.len(), 5);
            assert!(olm_core::residency::validate_lineup_imports(&game, &id, &club.active_lineup_ids).is_ok());
            ensure_custom_club_roster(&game, &id).expect("full roster");
            assert!(duplicate_player_ids(&game.players).is_empty());

            // Median of ALL the LES clubs, the founders' bill as wage budget.
            let peers = les_peers(&game, &id);
            assert_eq!(peers.len(), 8);
            assert_eq!(club.finance, median(peers.iter().map(|t| t.finance).collect()));
            let owned: Vec<Player> = squad.iter().map(|p| (*p).clone()).collect();
            assert_eq!(club.wage_budget, olm_core::squad_generator::founding_wage_budget(&owned));

            // The season: nine clubs, nine weekly matchdays, a bye each, the club included.
            let (manifests, known) = known_ids_and_manifests();
            let season = prepare_new_game_season(&mut game, &manifests, &known, &id).expect("season");
            assert_eq!(season.user_competition_id.as_deref(), Some("les"));
            assert_eq!(game.manager.team_id.as_deref(), Some(id.as_str()));
            let les = les_league(&game);
            assert_eq!(les.standings.len(), 9);
            assert_eq!(les.fixtures.len(), 36);
            assert_eq!(league_dates(les).len(), 9);
            let own: Vec<_> = les
                .fixtures
                .iter()
                .filter(|f| f.home_team_id == id || f.away_team_id == id)
                .collect();
            assert_eq!(own.len(), 8, "eight matches and one bye");
            let own_dates: HashSet<&str> = own.iter().map(|f| f.date.as_str()).collect();
            assert_eq!(own_dates.len(), 8, "never twice on a day");
        }

        /// Plays the first LES split of a nine-club league on its match days: the club
        /// with a bye never plays on its rest day, the regular season completes, the
        /// playoffs are scheduled and played, the league reports complete, and all of it
        /// ends before the next split starts. Only match days are simulated (the empty
        /// days in between add nothing to this proof); the full season is task J3's.
        #[test]
        fn a_nine_club_les_split_plays_through_the_playoffs() {
            use olm_core::domain::league::{FixtureStatus, MatchType};

            let (mut game, id) = try_build_join_world("les", &seeded_rayo(7)).expect("join world");
            let (manifests, known) = known_ids_and_manifests();
            prepare_new_game_season(&mut game, &manifests, &known, &id).expect("season");
            let next_split_start = {
                let spring = manifests
                    .iter()
                    .find(|m| m.id == "les")
                    .and_then(|m| m.schedule.splits.get(1))
                    .expect("Spring split");
                format!(
                    "{:04}-{:02}-{:02}",
                    game.clock.current_date.year(),
                    spring.season_start.month,
                    spring.season_start.day
                )
            };

            let mut bye_days = 0;
            let mut last_day = String::new();
            for _ in 0..30 {
                let Some(next) = les_league(&game)
                    .fixtures
                    .iter()
                    .filter(|f| f.status == FixtureStatus::Scheduled)
                    .map(|f| f.date.clone())
                    .min()
                else {
                    break;
                };
                let target = chrono::NaiveDate::parse_from_str(&next, "%Y-%m-%d").unwrap();
                let gap = (target - game.clock.current_date.date_naive()).num_days();
                assert!(gap >= 0, "the clock passed a scheduled fixture on {next}");
                game.clock.advance_days(gap);

                let played_before = les_league(&game)
                    .standings
                    .iter()
                    .find(|s| s.team_id == id)
                    .map_or(0, |s| s.played);
                let regular_day = les_league(&game)
                    .fixtures
                    .iter()
                    .any(|f| f.date == next && f.match_type == MatchType::League);
                let rested = regular_day
                    && !les_league(&game)
                        .fixtures
                        .iter()
                        .any(|f| f.date == next && (f.home_team_id == id || f.away_team_id == id));
                olm_core::turn::process_day_with_capture(&mut game, &mut |_| {});
                let les = les_league(&game);
                assert!(
                    les.fixtures
                        .iter()
                        .filter(|f| f.date == next)
                        .all(|f| f.status == FixtureStatus::Completed),
                    "the matches of {next} were not all played"
                );
                if rested {
                    bye_days += 1;
                    let played_after = les
                        .standings
                        .iter()
                        .find(|s| s.team_id == id)
                        .map_or(0, |s| s.played);
                    assert_eq!(played_after, played_before, "the club with a bye played on {next}");
                }
                last_day = next;
            }

            let les = les_league(&game);
            assert_eq!(bye_days, 1, "one bye in the nine-matchday regular season");
            assert_eq!(
                les.fixtures
                    .iter()
                    .filter(|f| f.match_type == MatchType::Playoffs)
                    .count(),
                3,
                "two semifinals and a final"
            );
            assert!(olm_core::end_of_season::is_league_complete(les), "the split should be complete");
            assert!(les.standings.iter().all(|s| s.played >= 8));
            assert!(last_day < next_split_start, "{last_day} must precede {next_split_start}");
            eprintln!("[nine-club split] regular season ends and playoffs finish on {last_day}; Spring starts {next_split_start}");
        }

        /// A save with a joined club survives a reload and the catalog rehydration:
        /// the extra club is kept, no catalog club is dropped or duplicated.
        #[test]
        fn a_joined_club_survives_save_round_trip_and_catalog_rehydration() {
            let (game, id) = try_build_join_world("les", &seeded_rayo(7)).expect("join world");
            let roster = roster_ids(&game, &id);
            let les_before = les_main_ids(&game);
            assert_eq!(les_before.len(), 9);

            let dir = tempfile::tempdir().expect("tempdir");
            let mut manager = SaveManager::init(dir.path()).expect("save manager");
            let save_id = manager.create_save(&game, "joined club").expect("create save");
            let mut loaded = manager.load_game(&save_id).expect("load save");

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
            crate::commands::import::apply_catalog_to_game(
                &mut loaded,
                catalog_teams,
                catalog_players,
                catalog_staff,
            );

            assert_eq!(les_main_ids(&loaded), les_before);
            assert_eq!(loaded.teams.iter().filter(|t| t.id == id).count(), 1);
            assert_eq!(roster_ids(&loaded, &id), roster, "rehydration changed the roster");
            assert!(loaded.removed_team_ids.is_empty());
        }

        /// Every split of a nine-club LES ends, playoffs included, before the next one
        /// starts, and the eight-club calendar keeps its slack. The playoffs open the day
        /// after the last regular match and the final is a week later (`schedule_playoffs_for`).
        #[test]
        fn nine_club_les_splits_close_before_the_next_one_starts() {
            let (manifests, _known) = known_ids_and_manifests();
            let les = manifests.iter().find(|m| m.id == "les").expect("LES manifest");
            let day = |text: &str| chrono::NaiveDate::parse_from_str(text, "%Y-%m-%d").unwrap();

            for clubs in [8usize, 9] {
                let ids: Vec<String> = (0..clubs).map(|i| format!("c{i}")).collect();
                let splits = les.schedule.splits.len();
                let leagues: Vec<_> = (0..splits)
                    .map(|split| olm_core::schedule::generate_schedule_from_config(les, 2027, &ids, split))
                    .collect();
                for (split, league) in leagues.iter().enumerate() {
                    let dates = league_dates(league);
                    assert_eq!(dates.len(), if clubs == 9 { 9 } else { 7 }, "{clubs} clubs, split {split}");
                    let final_day = day(dates.last().unwrap()) + chrono::Duration::days(1 + 7);
                    if let Some(next) = leagues.get(split + 1) {
                        let next_start = day(&league_dates(next)[0]);
                        assert!(final_day < next_start, "{clubs} clubs: split {split} ends {final_day}, next starts {next_start}");
                    } else {
                        let next_winter = day(&league_dates(&leagues[0])[0]) + chrono::Duration::days(365);
                        assert!(final_day < next_winter, "{clubs} clubs: the season runs into the next Winter");
                    }
                    eprintln!("[calendar] {clubs} clubs split {split}: regular season {} to {}, final about {final_day}", dates[0], dates.last().unwrap());
                }
            }
        }

        /// The custom club that joined the LES wins it and goes up: the LEC keeps ten
        /// clubs, the LES keeps nine (the relegated LEC club takes the custom club's
        /// place), and both rebuilt calendars have the right size.
        #[test]
        fn a_joined_club_promoted_to_the_lec_keeps_the_les_at_nine() {
            use olm_core::domain::league::StandingEntry;
            use olm_core::ladder::SeasonOutcome;

            let (mut game, id) = try_build_join_world("les", &seeded_rayo(7)).expect("join world");
            let (manifests, known) = known_ids_and_manifests();
            prepare_new_game_season(&mut game, &manifests, &known, &id).expect("season");
            // Early enough that both rebuilt calendars start after the clock.
            game.clock = GameClock::new(chrono::Utc.with_ymd_and_hms(2025, 12, 1, 0, 0, 0).unwrap());

            let season = les_league(&game).season;
            let lec_ids: Vec<String> = game
                .leagues
                .iter()
                .find(|l| l.competition_id.as_deref() == Some("lec"))
                .map(|l| l.standings.iter().map(|s| s.team_id.clone()).collect())
                .expect("the LEC has a league");
            let mut les_order = vec![id.clone()];
            les_order.extend(les_league(&game).standings.iter().map(|s| s.team_id.clone()).filter(|t| *t != id));
            assert_eq!(les_order.len(), 9);
            let relegated = lec_ids[0].clone();
            let mut table: Vec<StandingEntry> = lec_ids
                .iter()
                .enumerate()
                .map(|(rank, club)| {
                    let mut row = StandingEntry::new(club.clone());
                    row.points = 3 * (rank as u32 + 1);
                    row
                })
                .collect();
            table.reverse();
            game.ladder.outcomes = vec![
                SeasonOutcome {
                    competition_id: "les".to_string(),
                    season: season - 1,
                    champion_id: Some(id.clone()),
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
            assert_eq!(applied[0].promoted, vec![id.clone()]);
            assert_eq!(applied[0].relegated, vec![relegated.clone()]);
            assert_eq!(game.user_competition_id.as_deref(), Some("lec"));
            let main_clubs = |competition: &str| -> HashSet<String> {
                game.teams
                    .iter()
                    .filter(|t| t.competition_id.as_deref() == Some(competition) && t.team_kind == TeamKind::Main)
                    .map(|t| t.id.clone())
                    .collect()
            };
            let (les_clubs, lec_clubs) = (main_clubs("les"), main_clubs("lec"));
            assert_eq!(les_clubs.len(), 9);
            assert!(les_clubs.contains(&relegated) && !les_clubs.contains(&id));
            assert_eq!(lec_clubs.len(), 10);
            assert!(lec_clubs.contains(&id) && !lec_clubs.contains(&relegated));

            let les = les_league(&game);
            assert_eq!(les.standings.len(), 9);
            assert_eq!(les.fixtures.iter().filter(|f| f.counts_for_league_standings()).count(), 36);
            assert_eq!(league_dates(les).len(), 9);
            let lec = game.active_league().expect("active league");
            assert_eq!(lec.competition_id.as_deref(), Some("lec"));
            assert_eq!(lec.standings.len(), 10);
            assert!(lec.standings.iter().any(|s| s.team_id == id));
            let club = game.teams.iter().find(|t| t.id == id).expect("the custom club survives");
            assert_eq!(club.active_lineup_ids.len(), 5);
        }

        // -- Staff integrity -------------------------------------------------------------

        /// Ids of the staff the data ships with only a name and a role.
        fn raw_staff_without_data() -> HashSet<String> {
            let data = data_base();
            let (manifests, _) = known_ids_and_manifests();
            let mut raw = olm_core::competitions::load_staff_free_agents(&data).expect("free agents");
            for manifest in manifests.iter().filter(|m| !m.legacy) {
                raw.extend(olm_core::competitions::load_staff(&data, manifest).unwrap_or_default());
            }
            raw.into_iter()
                .filter(|member| !member.has_attribute_data())
                .map(|member| member.id)
                .collect()
        }

        #[test]
        fn new_world_staff_without_data_get_attributes_and_no_staff_rates_zero() {
            let (game, _catalog, _overlay, _user_team) = new_game();
            let without_data = raw_staff_without_data();

            assert!(without_data.len() > 100, "the data should still ship staff without data");
            let unrated: Vec<&str> = game
                .staff
                .iter()
                .filter(|member| !member.has_attribute_data())
                .map(|member| member.id.as_str())
                .collect();
            assert!(unrated.is_empty(), "staff still rated 0: {unrated:?}");
        }

        #[test]
        fn completed_staff_stay_inside_the_range_of_the_rated_staff() {
            let (game, _catalog, _overlay, _user_team) = new_game();
            let without_data = raw_staff_without_data();
            let rated: Vec<[u8; 4]> = game
                .staff
                .iter()
                .filter(|member| !without_data.contains(&member.id))
                .map(|member| {
                    let a = &member.attributes;
                    [a.coaching, a.judging_ability, a.judging_potential, a.physiotherapy]
                })
                .collect();

            for member in game.staff.iter().filter(|member| without_data.contains(&member.id)) {
                let a = &member.attributes;
                for (index, value) in [a.coaching, a.judging_ability, a.judging_potential, a.physiotherapy]
                    .into_iter()
                    .enumerate()
                {
                    let min = rated.iter().map(|row| row[index]).min().unwrap();
                    let max = rated.iter().map(|row| row[index]).max().unwrap();
                    assert!(
                        (min..=max).contains(&value),
                        "{} attribute {index} = {value} is outside the rated {min}..={max}",
                        member.id
                    );
                }
            }
        }

        #[test]
        fn completed_staff_wages_follow_the_data_and_owners_stay_unpaid() {
            let (game, _catalog, _overlay, _user_team) = new_game();
            let without_data = raw_staff_without_data();

            for member in game.staff.iter().filter(|member| without_data.contains(&member.id)) {
                let expected = if member.is_owner() {
                    0
                } else {
                    olm_core::staff_completion::DEFAULT_STAFF_WAGE
                };
                assert_eq!(member.wage, expected, "{} ({:?})", member.id, member.role);
            }
        }

        #[test]
        fn clubs_with_completed_staff_get_effects_inside_the_range_of_clubs_with_rated_staff() {
            use olm_core::staff_effects::LolStaffEffects;

            let (game, _catalog, _overlay, _user_team) = new_game();
            let without_data = raw_staff_without_data();
            let coaching_staff = |team_id: &str| -> Vec<&Staff> {
                game.staff
                    .iter()
                    .filter(|member| member.team_id.as_deref() == Some(team_id) && !member.is_owner())
                    .collect()
            };
            let fields = |e: LolStaffEffects| [e.coaching, e.development, e.tactics, e.analysis, e.recovery, e.morale];

            let mut rated_clubs = Vec::new();
            let mut completed_clubs = Vec::new();
            for team in game.teams.iter().filter(|t| t.team_kind == TeamKind::Main) {
                let staff = coaching_staff(&team.id);
                if staff.is_empty() {
                    continue;
                }
                let effects = fields(LolStaffEffects::for_team(&game.staff, &team.id));
                if staff.iter().any(|member| without_data.contains(&member.id)) {
                    completed_clubs.push((team.id.clone(), effects));
                } else {
                    rated_clubs.push(effects);
                }
            }
            assert!(rated_clubs.len() > 10 && completed_clubs.len() > 10);

            for (club, effects) in &completed_clubs {
                for (index, value) in effects.iter().enumerate() {
                    let min = rated_clubs.iter().map(|row| row[index]).fold(f64::MAX, f64::min);
                    let max = rated_clubs.iter().map(|row| row[index]).fold(f64::MIN, f64::max);
                    assert!(
                        *value >= min - 1e-9 && *value <= max + 1e-9,
                        "{club} effect {index} = {value} is outside the rated clubs' {min}..={max}"
                    );
                }
            }
        }

        #[test]
        fn in_a_real_world_no_owner_is_hireable_and_the_koi_owner_cannot_be_fired() {
            use crate::commands::staff::{hire_staff_internal, release_staff_internal, StaffError};

            const KOI: &str = "lec-movistar-koi";
            let (mut game, _catalog, _overlay, user_team) = new_game_as("Movistar KOI", Some(KOI));
            assert_eq!(user_team, KOI);
            game.manager.hire(KOI.to_string());
            // The market is open in the offseason.
            game.season_context.season_start = None;
            game.clock = GameClock::new(chrono::Utc.with_ymd_and_hms(2026, 3, 1, 12, 0, 0).unwrap());
            let koi_owner = game
                .staff
                .iter()
                .find(|member| member.is_owner() && member.team_id.as_deref() == Some(KOI))
                .map(|member| member.id.clone())
                .expect("KOI has its owner");
            let free_owners: Vec<String> = game
                .staff
                .iter()
                .filter(|member| member.is_owner() && member.team_id.is_none())
                .map(|member| member.id.clone())
                .collect();
            assert!(!free_owners.is_empty(), "the data ships an unattached owner");
            let state = StateManager::new();
            state.set_game(game);

            assert_eq!(
                release_staff_internal(&state, &koi_owner).expect_err("the owner stays"),
                StaffError::OwnerNotFireable
            );
            for id in &free_owners {
                assert_eq!(
                    hire_staff_internal(&state, id).expect_err("owners are not for hire"),
                    StaffError::OwnerNotHireable,
                    "{id}"
                );
            }
        }

        // -- Whole LES seasons (J3) ----------------------------------------------------

        /// Plays whole LES seasons day by day through the app's own entry points
        /// (`process_day_with_capture`, `advance_season`, a save and load in between)
        /// and records what actually happened.
        mod full_season {
            use super::*;
            use olm_core::domain::league::{FixtureStatus, League, MatchType};
            use olm_core::ladder::LadderMovementStatus;

            /// The user's league the day a split closed, and what the rollover did next.
            #[derive(Debug)]
            struct ClosedSplit {
                season: u32,
                split: usize,
                clubs: usize,
                last_regular_day: String,
                last_playoff_day: String,
                /// Clock date when the league first counted as complete.
                closed_on: String,
                champion: String,
                was_season_end: bool,
                /// Earliest league fixture of the split the rollover generated.
                next_first_day: String,
            }

            /// When the run saves the game and loads it back.
            #[derive(Debug, Clone, Copy, PartialEq)]
            enum ReloadWhen {
                /// Three regular-season matchdays into the split.
                MidSplit,
                /// Playoffs scheduled and not all played.
                InPlayoffs,
            }

            #[derive(Debug, Clone, Copy)]
            struct Reload {
                split: usize,
                when: ReloadWhen,
            }

            /// Everything a loaded game must give back unchanged.
            #[derive(Debug, PartialEq)]
            struct Snapshot {
                date: String,
                season: u32,
                split: usize,
                les_clubs: Vec<String>,
                standings: Vec<(String, u32, u32)>,
                fixtures: Vec<(String, String, bool)>,
                lineup: Vec<String>,
            }

            fn snapshot(game: &Game, user_id: &str) -> Snapshot {
                let les = les_league(game);
                let mut les_clubs: Vec<String> = les_main_ids(game).into_iter().collect();
                les_clubs.sort();
                Snapshot {
                    date: game.clock.current_date.format("%Y-%m-%d").to_string(),
                    season: les.season,
                    split: les.split_index,
                    les_clubs,
                    standings: les
                        .standings
                        .iter()
                        .map(|s| (s.team_id.clone(), s.played, s.points))
                        .collect(),
                    fixtures: les
                        .fixtures
                        .iter()
                        .map(|f| (f.id.clone(), f.date.clone(), f.status == FixtureStatus::Completed))
                        .collect(),
                    lineup: game
                        .teams
                        .iter()
                        .find(|t| t.id == user_id)
                        .map(|t| t.active_lineup_ids.clone())
                        .unwrap_or_default(),
                }
            }

            fn regular_fixtures(league: &League) -> Vec<&olm_core::domain::league::Fixture> {
                league.fixtures.iter().filter(|f| f.counts_for_league_standings()).collect()
            }

            fn last_day(league: &League, playoffs: bool) -> String {
                league
                    .fixtures
                    .iter()
                    .filter(|f| {
                        if playoffs {
                            f.match_type == MatchType::Playoffs
                        } else {
                            f.counts_for_league_standings()
                        }
                    })
                    .map(|f| f.date.clone())
                    .max()
                    .unwrap_or_default()
            }

            fn first_regular_day(league: &League) -> String {
                regular_fixtures(league).iter().map(|f| f.date.clone()).min().unwrap_or_default()
            }

            fn today(game: &Game) -> String {
                game.clock.current_date.format("%Y-%m-%d").to_string()
            }

            fn reload_like_load_game(game: &Game) -> Game {
                let dir = tempfile::tempdir().expect("tempdir");
                let mut manager = SaveManager::init(dir.path()).expect("save manager");
                let save_id = manager.create_save(game, "season run").expect("create save");
                let mut loaded = manager.load_game(&save_id).expect("load save");

                let data = data_base();
                let scanned = olm_core::competitions::scan_competitions(&data.join("competitions"));
                let (teams, players, staff) = assemble_world_from_modular_data(
                    &data,
                    &scanned,
                    "",
                    "",
                    chrono::NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
                )
                .expect("catalog");
                crate::commands::import::apply_catalog_to_game(&mut loaded, teams, players, staff);
                let current: Vec<_> = scanned.into_iter().filter(|m| !m.legacy).collect();
                let known: Vec<String> = current.iter().map(|m| m.id.clone()).collect();
                loaded.competition_configs.clear();
                for manifest in &current {
                    loaded.competition_configs.insert(manifest.id.clone(), manifest.clone());
                }
                sanitize_competition_references(&mut loaded, &known);
                olm_core::champions::bootstrap_champion_state(&mut loaded);
                for player in &mut loaded.players {
                    player.lol_ovr = olm_core::potential::calculate_lol_ovr(player);
                }
                roster_stability::repair_league(
                    &mut loaded,
                    roster_stability::RosterStabilityReason::LoadMigration,
                )
                .expect("load migration repair");
                loaded
            }

            fn reload_is_due(game: &Game, reload: Reload) -> bool {
                let les = les_league(game);
                if les.split_index != reload.split {
                    return false;
                }
                let playoffs = les.fixtures.iter().any(|f| f.match_type == MatchType::Playoffs);
                match reload.when {
                    ReloadWhen::MidSplit => {
                        let played = regular_fixtures(les)
                            .iter()
                            .filter(|f| f.status == FixtureStatus::Completed)
                            .count();
                        played >= 12 && !playoffs
                    }
                    ReloadWhen::InPlayoffs => {
                        playoffs
                            && les
                                .fixtures
                                .iter()
                                .any(|f| f.match_type == MatchType::Playoffs && f.status != FixtureStatus::Completed)
                    }
                }
            }

            /// Every pair met exactly once, everybody played `clubs - 1` matches on distinct
            /// days, and the table agrees.
            fn assert_every_pair_met(league: &League, clubs: usize) {
                let regular = regular_fixtures(league);
                assert_eq!(league.standings.len(), clubs);
                assert_eq!(regular.len(), clubs * (clubs - 1) / 2);
                assert!(regular.iter().all(|f| f.status == FixtureStatus::Completed));
                let pairs: HashSet<(String, String)> = regular
                    .iter()
                    .map(|f| {
                        let mut pair = [f.home_team_id.clone(), f.away_team_id.clone()];
                        pair.sort();
                        let [a, b] = pair;
                        (a, b)
                    })
                    .collect();
                assert_eq!(pairs.len(), regular.len(), "a pair met twice");
                for entry in &league.standings {
                    assert_eq!(entry.played as usize, clubs - 1, "{} played {}", entry.team_id, entry.played);
                    let days: HashSet<&str> = regular
                        .iter()
                        .filter(|f| f.home_team_id == entry.team_id || f.away_team_id == entry.team_id)
                        .map(|f| f.date.as_str())
                        .collect();
                    assert_eq!(days.len(), clubs - 1, "{} played twice on a day", entry.team_id);
                }
            }

            /// The day-by-day sanity checks over every league of the world.
            fn assert_no_league_is_stuck(game: &Game, complete_days: &mut HashMap<String, u32>) {
                let now = game.clock.current_date.date_naive();
                let active = game.active_league_index();
                for (index, league) in game.leagues.iter().enumerate() {
                    let name = league.competition_id.clone().unwrap_or_else(|| league.id.clone());
                    for fixture in &league.fixtures {
                        if !matches!(fixture.match_type, MatchType::League | MatchType::Playoffs)
                            || fixture.status != FixtureStatus::Scheduled
                        {
                            continue;
                        }
                        let day = chrono::NaiveDate::parse_from_str(&fixture.date, "%Y-%m-%d").unwrap();
                        assert!(day >= now, "{name}: fixture {} of {} was never played (today {now})", fixture.id, fixture.date);
                    }
                    if index != active && game.competition_configs.contains_key(&name) {
                        let days = complete_days.entry(name.clone()).or_default();
                        if olm_core::end_of_season::is_league_complete(league) {
                            *days += 1;
                            assert!(*days <= 2, "{name} stayed complete without rolling");
                        } else {
                            *days = 0;
                        }
                    }
                }
            }

            struct SeasonRun {
                game: Game,
                splits: Vec<ClosedSplit>,
                reloads: usize,
                fired: bool,
            }

            /// Plays the user's LES career from the start of `game` until the first season has
            /// closed, the LES-LEC ladder has been applied and the next season's first split
            /// has played `extra_matchdays` matchdays.
            fn play_season(
                mut game: Game,
                user_id: &str,
                clubs: usize,
                mut reloads: Vec<Reload>,
                extra_matchdays: usize,
            ) -> SeasonRun {
                let year = les_league(&game).season;
                let splits_per_season = game.competition_configs["les"].schedule.splits.len();
                let mut closed = Vec::new();
                let mut complete_days = HashMap::new();
                let mut reload_count = 0;
                let mut fired = false;
                let mut season_closed = false;
                let started = std::time::Instant::now();

                for _ in 0..800 {
                    olm_core::turn::process_day_with_capture(&mut game, &mut |_| {});
                    assert_no_league_is_stuck(&game, &mut complete_days);

                    if let Some(position) = reloads.iter().position(|r| reload_is_due(&game, *r)) {
                        let reload = reloads.remove(position);
                        let before = snapshot(&game, user_id);
                        game = reload_like_load_game(&game);
                        assert_eq!(snapshot(&game, user_id), before, "{reload:?}: the loaded game differs");
                        reload_count += 1;
                        eprintln!("[season run] {} saved and loaded at {reload:?}", today(&game));
                    }

                    if olm_core::end_of_season::is_season_complete(&game) {
                        let les = les_league(&game);
                        assert_every_pair_met(les, clubs);
                        let playoffs: Vec<_> =
                            les.fixtures.iter().filter(|f| f.match_type == MatchType::Playoffs).collect();
                        assert_eq!(playoffs.len(), 3, "two semifinals and a final");
                        assert!(playoffs.iter().all(|f| f.status == FixtureStatus::Completed));
                        let champion = olm_core::end_of_season::playoff_champion_id(les)
                            .expect("a decided final has a champion");
                        let field: HashSet<&str> = playoffs
                            .iter()
                            .flat_map(|f| [f.home_team_id.as_str(), f.away_team_id.as_str()])
                            .collect();
                        let ranked = les.sorted_standings();
                        let top_four: HashSet<&str> = ranked.iter().take(4).map(|s| s.team_id.as_str()).collect();
                        assert_eq!(field, top_four, "the playoffs take the four best clubs");
                        assert!(field.contains(champion.as_str()));
                        if let Some(previous) = closed.last() {
                            let previous: &ClosedSplit = previous;
                            assert!(
                                first_regular_day(les) > previous.closed_on,
                                "split {} started before split {} had closed",
                                les.split_index, previous.split
                            );
                        }
                        let (season, split) = (les.season, les.split_index);
                        let last_regular_day = last_day(les, false);
                        let last_playoff_day = last_day(les, true);
                        let closed_on = today(&game);

                        let outcome = olm_core::season_rollover::advance_season(&mut game);
                        if outcome.was_season_end && olm_core::firing::check_manager_firing(&mut game) {
                            // Board satisfaction is random here and unrelated to the league size.
                            fired = true;
                            game.manager.hire(user_id.to_string());
                        }
                        let after = les_league(&game);
                        closed.push(ClosedSplit {
                            season,
                            split,
                            clubs,
                            last_regular_day,
                            last_playoff_day,
                            closed_on,
                            champion,
                            was_season_end: outcome.was_season_end,
                            next_first_day: first_regular_day(after),
                        });
                        season_closed |= outcome.was_season_end;
                        let last = closed.last().unwrap();
                        eprintln!(
                            "[season run] {} S{} split {}: regular season ended {}, playoffs ended {}, closed {}, champion {}, next split starts {}",
                            clubs, last.season, last.split, last.last_regular_day, last.last_playoff_day,
                            last.closed_on, last.champion, last.next_first_day
                        );
                    }

                    if season_closed && closed.len() >= splits_per_season {
                        let les = les_league(&game);
                        let ladder_done = game.ladder.movements.iter().any(|m| {
                            m.link_lower == "les" && m.link_upper == "lec" && m.season == year
                        });
                        let played = les
                            .fixtures
                            .iter()
                            .filter(|f| f.counts_for_league_standings() && f.status == FixtureStatus::Completed)
                            .map(|f| f.date.clone())
                            .collect::<HashSet<_>>()
                            .len();
                        if les.season == year + 1 && ladder_done && played >= extra_matchdays {
                            break;
                        }
                    }
                }
                eprintln!("[season run] {clubs}-club run took {:?}, ended {}", started.elapsed(), today(&game));
                SeasonRun { game, splits: closed, reloads: reload_count, fired }
            }

            /// What a finished run must show, for `clubs` LES clubs (9 with a joined club,
            /// 8 for the control): the exact calendar of every split, a champion each, the
            /// ladder swap, the league sizes after it and a playable next season.
            fn assert_season_run(run: SeasonRun, year: u32, user_id: &str, clubs: usize, expected_reloads: usize) {
                use chrono::{Duration, NaiveDate};
                let SeasonRun { game, splits, reloads, fired } = run;
                assert_eq!(reloads, expected_reloads);
                assert_eq!(splits.len(), 3, "Winter, Spring and Summer");
                let rounds = if clubs % 2 == 1 { clubs } else { clubs - 1 };
                let manifest = &game.competition_configs["les"];
                let start_of = |split: usize, season: u32| {
                    let start = &manifest.schedule.splits[split].season_start;
                    NaiveDate::from_ymd_opt(season as i32, start.month, start.day).unwrap()
                };
                let text = |day: NaiveDate| day.format("%Y-%m-%d").to_string();
                for (index, split) in splits.iter().enumerate() {
                    assert_eq!((split.season, split.split, split.clubs), (year, index, clubs));
                    assert_eq!(split.was_season_end, index == 2);
                    let last_regular = start_of(index, year) + Duration::days(7 * (rounds as i64 - 1));
                    let final_day = last_regular + Duration::days(8);
                    assert_eq!(split.last_regular_day, text(last_regular), "split {index} regular season");
                    assert_eq!(split.last_playoff_day, text(final_day), "split {index} playoffs");
                    assert_eq!(split.closed_on, text(final_day + Duration::days(1)), "split {index} close");
                    let next = if index < 2 { start_of(index + 1, year) } else { start_of(0, year + 1) };
                    assert_eq!(split.next_first_day, text(next), "split {index} successor");
                    assert!(split.closed_on < split.next_first_day);
                    assert!(!split.champion.is_empty());
                }

                // The ladder: one club up, one down, the sizes unchanged.
                let movement = game
                    .ladder
                    .movements
                    .iter()
                    .find(|m| m.link_lower == "les" && m.link_upper == "lec" && m.season == year)
                    .expect("the LES-LEC ladder ran");
                assert_eq!(movement.status, LadderMovementStatus::Applied);
                assert_eq!((movement.promoted.len(), movement.relegated.len()), (1, 1));
                let main_clubs = |competition: &str| {
                    game.teams
                        .iter()
                        .filter(|t| t.competition_id.as_deref() == Some(competition) && t.team_kind == TeamKind::Main)
                        .count()
                };
                assert_eq!(main_clubs("les"), clubs);
                assert_eq!(main_clubs("lec"), 10);
                assert_eq!(
                    game.teams.iter().find(|t| t.id == movement.promoted[0]).and_then(|t| t.competition_id.as_deref()),
                    Some("lec")
                );
                assert_eq!(
                    game.teams.iter().find(|t| t.id == movement.relegated[0]).and_then(|t| t.competition_id.as_deref()),
                    Some("les")
                );

                // The next season's first split is a full calendar for these clubs.
                let les = les_league(&game);
                assert_eq!((les.season, les.split_index, les.standings.len()), (year + 1, 0, clubs));
                let regular = regular_fixtures(les);
                assert_eq!(regular.len(), clubs * (clubs - 1) / 2);
                assert_eq!(league_dates(les).len(), rounds);
                for entry in &les.standings {
                    let own = regular
                        .iter()
                        .filter(|f| f.home_team_id == entry.team_id || f.away_team_id == entry.team_id)
                        .count();
                    assert_eq!(own, clubs - 1, "{} plays everybody once", entry.team_id);
                }
                // Matchdays already played: the clubs resting on them have one match fewer.
                let played_days = regular
                    .iter()
                    .filter(|f| f.status == FixtureStatus::Completed)
                    .map(|f| f.date.as_str())
                    .collect::<HashSet<_>>()
                    .len();
                assert!(played_days >= 2, "the new season played {played_days} matchdays");
                let rested = les.standings.iter().filter(|s| s.played as usize == played_days - 1).count();
                let full = les.standings.iter().filter(|s| s.played as usize == played_days).count();
                let byes_so_far = if clubs % 2 == 1 { played_days } else { 0 };
                assert_eq!(rested, byes_so_far, "one club rests on each matchday, never the same twice");
                assert_eq!(rested + full, clubs);

                // The other leagues closed their season too.
                for league in &game.leagues {
                    let name = league.competition_id.clone().unwrap_or_default();
                    assert_eq!(league.season, year + 1, "{name} did not roll into the next season");
                    if game.competition_configs.contains_key(&name) {
                        assert!(game.ladder.outcome(&name, year).is_some(), "{name} never closed season {year}");
                    }
                }

                // The user's club is still there and can still field a team.
                let club = game.teams.iter().find(|t| t.id == user_id).expect("the user's club exists");
                if olm_core::custom_team::is_custom_team_id(user_id) {
                    // A created club carries an explicit lineup; a catalog club's stays empty.
                    assert_eq!(club.active_lineup_ids.len(), 5);
                    assert!(olm_core::residency::validate_lineup_imports(&game, user_id, &club.active_lineup_ids).is_ok());
                    assert!(club
                        .active_lineup_ids
                        .iter()
                        .all(|p| game.players.iter().any(|q| &q.id == p && q.team_id.as_deref() == Some(user_id))));
                } else {
                    // No human renews contracts in this run, so a catalog club's roster thins
                    // out over a season; the real Continue stops on those contracts. Only
                    // report the size here.
                    let roster = game.players.iter().filter(|p| p.team_id.as_deref() == Some(user_id)).count();
                    eprintln!("[season run] {clubs} clubs: the user's catalog club ends with {roster} players");
                }
                assert_eq!(game.manager.team_id.as_deref(), Some(user_id));
                eprintln!("[season run] {clubs} clubs: manager fired and re-hired at the season end: {fired}");
            }

            #[test]
            #[ignore = "plays a whole nine-club LES season and the start of the next in a debug build (about 14 minutes); cd src-tauri && cargo test -p openleaguemanager --lib nine_club_les_career -- --ignored --nocapture"]
            fn nine_club_les_career_plays_a_full_season_and_starts_the_next() {
                let (mut game, id) = try_build_join_world("les", &seeded_rayo(7)).expect("join world");
                let (manifests, known) = known_ids_and_manifests();
                prepare_new_game_season(&mut game, &manifests, &known, &id).expect("season");
                let year = les_league(&game).season;

                let reloads = vec![
                    Reload { split: 0, when: ReloadWhen::MidSplit },
                    Reload { split: 1, when: ReloadWhen::InPlayoffs },
                ];
                let run = play_season(game, &id, 9, reloads, 2);
                assert_season_run(run, year, &id, 9, 2);
            }

            /// The same run for the plain eight-club LES: a failure of the nine-club run
            /// that also fails here is not about the size.
            #[test]
            #[ignore = "control: plays a whole eight-club LES season in a debug build (about 14 minutes); cd src-tauri && cargo test -p openleaguemanager --lib eight_club_les_career -- --ignored --nocapture"]
            fn eight_club_les_career_plays_the_same_season_as_a_control() {
                let (mut game, _catalog, _overlay, id) =
                    new_game_as("Barcelona Esports", Some("les-team-06974122"));
                let (manifests, known) = known_ids_and_manifests();
                prepare_new_game_season(&mut game, &manifests, &known, &id).expect("season");
                let year = les_league(&game).season;

                let run = play_season(game, &id, 8, Vec::new(), 2);
                assert_season_run(run, year, &id, 8, 0);
            }
        }

        // -- The season a custom LES club wins promotion to the LEC (J13) --------------

        /// Drives the real season-end rollover of a real world to the point where the
        /// custom LES club holds the promotion slot, then checks both leagues.
        ///
        /// Setup (the cheapest honest one): the final split of the LES and of the LEC is
        /// replaced by the schedule the engine itself builds for it (`build_split_league`),
        /// every regular match is marked played with the better-ranked club winning, and the
        /// LES playoffs get the same three fixtures the engine schedules (two semifinals and
        /// a final), the top seed winning. Standings come from `StandingEntry::record_result`,
        /// the structure the engine fills. The rollover is then the production code:
        /// `advance_season` for the user's league, `process_background_seasons` for the LEC
        /// (what the daily turn calls once the LEC has finished), and the ladder runs inside
        /// them. Nothing is simulated, so a case takes seconds instead of a quarter of an hour;
        /// the matches themselves cannot change what the rollover does with the results.
        mod lec_promotion {
            use super::*;
            use chrono::{Duration, NaiveDate};
            use olm_core::domain::league::{Fixture, FixtureStatus, League, MatchResult, MatchType, StandingEntry};
            use olm_core::domain::season::{SeasonPhase, TransferWindowStatus};
            use olm_core::ladder::LadderMovementStatus;

            /// LES clubs whose parent club plays in the LEC (`competition-overrides.json`).
            const FEEDERS: [&str; 3] = ["les-team-8baee3fd", "les-team-f10b156f", "les-team-854f6893"];

            fn day(text: &str) -> NaiveDate {
                NaiveDate::parse_from_str(text, "%Y-%m-%d").expect("a fixture date")
            }

            fn index_of(game: &Game, competition: &str) -> usize {
                game.leagues
                    .iter()
                    .position(|l| l.competition_id.as_deref() == Some(competition))
                    .unwrap_or_else(|| panic!("no league for {competition}"))
            }

            fn league_of<'a>(game: &'a Game, competition: &str) -> &'a League {
                &game.leagues[index_of(game, competition)]
            }

            fn table_ids(game: &Game, competition: &str) -> Vec<String> {
                league_of(game, competition).standings.iter().map(|s| s.team_id.clone()).collect()
            }

            fn main_clubs(game: &Game, competition: &str) -> HashSet<String> {
                game.teams
                    .iter()
                    .filter(|t| t.competition_id.as_deref() == Some(competition) && t.team_kind == TeamKind::Main)
                    .map(|t| t.id.clone())
                    .collect()
            }

            /// `first` in the given order, then the other clubs of the league in table order.
            fn order_with(game: &Game, competition: &str, first: &[&str]) -> Vec<String> {
                let mut order: Vec<String> = first.iter().map(|id| (*id).to_string()).collect();
                order.extend(table_ids(game, competition).into_iter().filter(|id| !first.contains(&id.as_str())));
                order
            }

            /// The final split of `competition` as the engine builds it, every regular match
            /// played (the better-ranked club of `order` wins) and, with `playoffs`, the
            /// four-team bracket played (top seed wins). Moves the clock to the day after the
            /// last match, as the user's Continue would reach it.
            fn play_out_final_split(game: &mut Game, competition: &str, order: &[String], playoffs: bool) {
                let last_split = game.competition_configs[competition].schedule.splits.len() - 1;
                play_out_split(game, competition, last_split, order, playoffs.then_some(8));
            }

            /// Like [`play_out_final_split`] for any split. `final_after` is the number of days
            /// between the last regular match and the playoff final, `None` for no playoffs.
            fn play_out_split(game: &mut Game, competition: &str, split: usize, order: &[String], final_after: Option<i64>) {
                let index = index_of(game, competition);
                let manifest = game.competition_configs[competition].clone();
                let last_split = split;
                let previous = &game.leagues[index];
                let mut members = table_ids(game, competition);
                let mut ranked = order.to_vec();
                members.sort();
                ranked.sort();
                assert_eq!(members, ranked, "{competition}: the order must name every club once");

                let mut league =
                    olm_core::end_of_season::build_split_league(previous, &manifest, previous.season, last_split, None);
                league.split_index = last_split;
                let rank = |id: &str| order.iter().position(|o| o == id).expect("ranked club");
                let mut standings: Vec<StandingEntry> = order.iter().cloned().map(StandingEntry::new).collect();
                for fixture in league.fixtures.iter_mut().filter(|f| f.counts_for_league_standings()) {
                    let home_won = rank(&fixture.home_team_id) < rank(&fixture.away_team_id);
                    let (home, away) = if home_won { (2u8, 0u8) } else { (0, 2) };
                    fixture.status = FixtureStatus::Completed;
                    fixture.result = Some(MatchResult { home_wins: home, away_wins: away, ..Default::default() });
                    for entry in &mut standings {
                        if entry.team_id == fixture.home_team_id {
                            entry.record_result(home, away);
                        } else if entry.team_id == fixture.away_team_id {
                            entry.record_result(away, home);
                        }
                    }
                }
                league.standings = standings;

                let last_regular = league
                    .fixtures
                    .iter()
                    .filter(|f| f.counts_for_league_standings())
                    .map(|f| day(&f.date))
                    .max()
                    .expect("a regular season");
                let mut last_day = last_regular;
                if let Some(final_after) = final_after {
                    let matchday = league.fixtures.iter().map(|f| f.matchday).max().unwrap_or(0);
                    let semis = last_regular + Duration::days(1);
                    let final_day = last_regular + Duration::days(final_after);
                    let series = |id: &str, matchday: u32, date: NaiveDate, home: &str, away: &str, score: (u8, u8)| Fixture {
                        id: id.to_string(),
                        matchday,
                        date: date.format("%Y-%m-%d").to_string(),
                        home_team_id: home.to_string(),
                        away_team_id: away.to_string(),
                        match_type: MatchType::Playoffs,
                        best_of: 5,
                        status: FixtureStatus::Completed,
                        result: Some(MatchResult { home_wins: score.0, away_wins: score.1, ..Default::default() }),
                    };
                    league.fixtures.push(series("po-semi-1", matchday + 1, semis, &order[0], &order[3], (3, 0)));
                    league.fixtures.push(series("po-semi-2", matchday + 1, semis, &order[1], &order[2], (3, 1)));
                    league.fixtures.push(series("po-final", matchday + 2, final_day, &order[0], &order[1], (3, 2)));
                    last_day = final_day;
                }
                assert!(olm_core::end_of_season::is_league_complete(&league), "{competition} must count as complete");
                game.leagues[index] = league;

                let gap = (last_day + Duration::days(1) - game.clock.current_date.date_naive()).num_days();
                assert!(gap > 0, "the clock is already past the end of {competition}");
                game.clock.advance_days(gap);
            }

            /// The production rollover of a season in which the LES and the LEC both finish:
            /// the user's LES first, the LEC later (the order of the real calendar).
            fn roll_over(game: &mut Game, les_order: &[String], lec_order: &[String]) {
                play_out_final_split(game, "les", les_order, true);
                let outcome = olm_core::season_rollover::advance_season(game);
                assert!(outcome.was_season_end);
                play_out_final_split(game, "lec", lec_order, false);
                let configs = game.competition_configs.clone();
                olm_core::end_of_season::process_background_seasons(game, &configs);
            }

            /// A prepared career for `mode`: a custom club that joined the LES (9 clubs) or one
            /// that replaced an LES club (8 clubs).
            fn career(joins: bool) -> (Game, String) {
                let (mut game, id) = if joins {
                    try_build_join_world("les", &seeded_rayo(7)).expect("join world")
                } else {
                    let (game, _overlay, id) =
                        try_build_world(LES_SLOT, Some(&seeded_rayo(7))).expect("replace world");
                    (game, id)
                };
                let (manifests, known) = known_ids_and_manifests();
                prepare_new_game_season(&mut game, &manifests, &known, &id).expect("season");
                (game, id)
            }

            struct Rolled {
                game: Game,
                id: String,
                season: u32,
                les_order: Vec<String>,
            }

            /// `career(joins)` rolled over with `first` leading the LES order. The LEC order is
            /// its table order, so its last club is the one the ladder relegates.
            fn rolled(joins: bool, first: impl Fn(&str) -> Vec<String>) -> Rolled {
                let (mut game, id) = career(joins);
                let season = league_of(&game, "les").season;
                let les_first = first(&id);
                let les_order = order_with(
                    &game,
                    "les",
                    &les_first.iter().map(String::as_str).collect::<Vec<_>>(),
                );
                let lec_order = table_ids(&game, "lec");
                roll_over(&mut game, &les_order, &lec_order);
                Rolled { game, id, season, les_order }
            }

            fn champion_is_the_custom_club(id: &str) -> Vec<String> {
                vec![id.to_string()]
            }

            /// Every pair met once, nobody twice on a day, the right number of dates for the
            /// size, and (for a fresh season) every match still ahead of the clock.
            fn assert_round_robin(game: &Game, competition: &str, clubs: usize, fresh: bool) {
                let league = league_of(game, competition);
                let today = game.clock.current_date.date_naive();
                assert_eq!(league.standings.len(), clubs, "{competition} size");
                let regular: Vec<&Fixture> = league.fixtures.iter().filter(|f| f.counts_for_league_standings()).collect();
                assert_eq!(regular.len(), clubs * (clubs - 1) / 2, "{competition} fixture count");
                let pairs: HashSet<(String, String)> = regular
                    .iter()
                    .map(|f| {
                        let mut pair = [f.home_team_id.clone(), f.away_team_id.clone()];
                        pair.sort();
                        let [a, b] = pair;
                        (a, b)
                    })
                    .collect();
                assert_eq!(pairs.len(), regular.len(), "{competition}: a pair meets twice");
                let members: HashSet<&str> = league.standings.iter().map(|s| s.team_id.as_str()).collect();
                for fixture in &regular {
                    assert!(members.contains(fixture.home_team_id.as_str()) && members.contains(fixture.away_team_id.as_str()));
                }
                for entry in &league.standings {
                    let days: Vec<&str> = regular
                        .iter()
                        .filter(|f| f.home_team_id == entry.team_id || f.away_team_id == entry.team_id)
                        .map(|f| f.date.as_str())
                        .collect();
                    assert_eq!(days.len(), clubs - 1, "{competition}: {} plays everybody once", entry.team_id);
                    assert_eq!(days.iter().collect::<HashSet<_>>().len(), days.len(), "{competition}: {} twice on a day", entry.team_id);
                }
                let rounds: HashSet<&str> = regular.iter().map(|f| f.date.as_str()).collect();
                assert_eq!(rounds.len(), if clubs % 2 == 1 { clubs } else { clubs - 1 }, "{competition}: matchdays");
                for date in &rounds {
                    let playing = regular.iter().filter(|f| f.date == *date).count();
                    assert_eq!(playing, clubs / 2, "{competition} on {date}: {} clubs rest", clubs - 2 * playing);
                }
                if fresh {
                    for fixture in &league.fixtures {
                        assert!(day(&fixture.date) > today, "{competition}: {} is dated {} (today {today})", fixture.id, fixture.date);
                        assert_eq!(fixture.status, FixtureStatus::Scheduled, "{competition}: {}", fixture.id);
                    }
                    assert!(league.standings.iter().all(|s| s.played == 0));
                }
            }

            /// No club in two leagues, none missing, and the table of every league equals its
            /// member list.
            fn assert_world_is_consistent(game: &Game) {
                let mut seen: HashMap<&str, &str> = HashMap::new();
                for league in &game.leagues {
                    let name = league.competition_id.as_deref().unwrap_or(league.id.as_str());
                    let ids: HashSet<&str> = league.standings.iter().map(|s| s.team_id.as_str()).collect();
                    assert_eq!(ids.len(), league.standings.len(), "{name}: a club is listed twice");
                    for id in ids {
                        if let Some(other) = seen.insert(id, name) {
                            panic!("{id} is in the tables of {other} and {name}");
                        }
                    }
                }
                for competition in ["les", "lec"] {
                    let table: HashSet<String> = table_ids(game, competition).into_iter().collect();
                    assert_eq!(table, main_clubs(game, competition), "{competition}: table and member list differ");
                    let league = league_of(game, competition);
                    for fixture in &league.fixtures {
                        assert!(table.contains(&fixture.home_team_id) && table.contains(&fixture.away_team_id), "{competition}: {} names an outsider", fixture.id);
                    }
                }
            }

            /// A season wrap rebuilds the leagues the game already holds; it never adds one,
            /// and in particular never brings back a stale duplicate competition.
            #[test]
            fn a_season_wrap_keeps_the_league_set() {
                let (mut game, id) = career(true);
                let ids = |game: &Game| -> Vec<Option<String>> {
                    let mut ids: Vec<_> = game.leagues.iter().map(|l| l.competition_id.clone()).collect();
                    ids.sort();
                    ids
                };
                let before = ids(&game);
                assert!(
                    before.iter().flatten().all(|id| !olm_core::world_catalog::is_stale_duplicate_competition(id)),
                    "a new game starts without stale leagues"
                );
                let les_order = order_with(&game, "les", &[id.as_str()]);
                let lec_order = table_ids(&game, "lec");

                roll_over(&mut game, &les_order, &lec_order);

                assert_eq!(ids(&game), before);
            }

            /// Q1: the club, the user's league and the clubs that move.
            #[test]
            fn the_promoted_custom_club_moves_to_the_lec_and_the_last_lec_club_comes_down() {
                let (mut game, id) = career(true);
                let season = league_of(&game, "les").season;
                let (les_before, lec_before) = (main_clubs(&game, "les"), main_clubs(&game, "lec"));
                assert_eq!((les_before.len(), lec_before.len()), (9, 10));
                let les_order = order_with(&game, "les", &[id.as_str()]);
                let lec_order = table_ids(&game, "lec");

                // The LES rolls first: the ladder has to wait for the LEC.
                play_out_final_split(&mut game, "les", &les_order, true);
                olm_core::season_rollover::advance_season(&mut game);
                assert!(game.ladder.movements.is_empty(), "the swap needs the LEC to close first");
                assert_eq!(game.user_competition_id.as_deref(), Some("les"));
                assert_eq!(main_clubs(&game, "les").len(), 9);

                play_out_final_split(&mut game, "lec", &lec_order, false);
                let configs = game.competition_configs.clone();
                olm_core::end_of_season::process_background_seasons(&mut game, &configs);

                let movement = game.ladder.movements.last().expect("a movement");
                assert_eq!((movement.link_lower.as_str(), movement.link_upper.as_str(), movement.season), ("les", "lec", season));
                assert_eq!(movement.status, LadderMovementStatus::Applied);
                assert_eq!(movement.promoted, vec![id.clone()]);
                assert_eq!(movement.relegated, vec![lec_order.last().unwrap().clone()]);
                let team = |team_id: &str| game.teams.iter().find(|t| t.id == team_id).expect("team");
                assert_eq!(team(&id).competition_id.as_deref(), Some("lec"));
                assert_eq!(team(&movement.relegated[0]).competition_id.as_deref(), Some("les"));
                assert_eq!(game.user_competition_id.as_deref(), Some("lec"));
                let active = game.active_league().expect("active league");
                assert_eq!(active.competition_id.as_deref(), Some("lec"));
                assert_eq!(active.tier, 1);
                assert_eq!(league_of(&game, "les").tier, 2);
                let (les_after, lec_after) = (main_clubs(&game, "les"), main_clubs(&game, "lec"));
                assert_eq!((les_after.len(), lec_after.len()), (9, 10));
                let mut all_before: Vec<_> = les_before.union(&lec_before).cloned().collect();
                let mut all_after: Vec<_> = les_after.union(&lec_after).cloned().collect();
                all_before.sort();
                all_after.sort();
                assert_eq!(all_before, all_after, "nobody is lost or invented");
                assert!(les_after.contains(&movement.relegated[0]) && !les_after.contains(&id));
                eprintln!(
                    "[lec promotion] LES {} -> {}, LEC {} -> {}; {} up, {} down; user league now {:?}",
                    les_before.len(), les_after.len(), lec_before.len(), lec_after.len(),
                    id, movement.relegated[0], game.user_competition_id
                );
            }

            /// Q2 and Q6: both leagues are whole and playable, with the calendar of their size.
            #[test]
            fn both_leagues_are_consistent_and_scheduled_for_their_size_after_the_rollover() {
                let Rolled { game, id, season, .. } = rolled(true, champion_is_the_custom_club);

                assert_world_is_consistent(&game);
                assert_round_robin(&game, "les", 9, true);
                assert_round_robin(&game, "lec", 10, true);
                for competition in ["les", "lec"] {
                    let league = league_of(&game, competition);
                    assert_eq!((league.season, league.split_index), (season + 1, 0), "{competition}");
                    let first = league.fixtures.iter().map(|f| f.date.as_str()).min().unwrap();
                    eprintln!("[lec promotion] {competition} {} clubs, {} fixtures, first on {first}, clock {}",
                        league.standings.len(), league.fixtures.len(), game.clock.current_date.date_naive());
                }
                // The relegated club is back in the LES and plays its calendar like the rest.
                let relegated = game.ladder.movements.last().unwrap().relegated[0].clone();
                let les = league_of(&game, "les");
                let own = les.fixtures.iter().filter(|f| f.counts_for_league_standings() && (f.home_team_id == relegated || f.away_team_id == relegated)).count();
                assert_eq!(own, 8);

                // The user's context follows the LEC: pre-season with the window open.
                assert_eq!(game.season_context.phase, SeasonPhase::Preseason);
                assert_eq!(game.season_context.transfer_window.status, TransferWindowStatus::Open);
                let lec_start = league_of(&game, "lec")
                    .fixtures
                    .iter()
                    .filter(|f| f.counts_for_league_standings())
                    .map(|f| f.date.clone())
                    .min()
                    .unwrap();
                assert_eq!(game.season_context.season_start.as_deref(), Some(lec_start.as_str()));
                assert!(game.clock.current_date.date_naive() < day(&lec_start));
                assert!(game.teams.iter().any(|t| t.id == id));
            }

            /// Q3: what the promoted club carries into the LEC. The numbers are printed for
            /// the report; the asserts are the documented rules (no rebalance beyond one step
            /// toward the median, objectives regenerated, squad and lineup intact).
            #[test]
            fn the_promoted_club_keeps_its_squad_and_gets_lec_finances_objectives_and_rules() {
                let (mut game, id) = career(true);
                let before = game.teams.iter().find(|t| t.id == id).cloned().expect("club");
                let roster_before = roster_ids(&game, &id);
                let les_order = order_with(&game, "les", &[id.as_str()]);
                let lec_order = table_ids(&game, "lec");
                game.board_objectives = vec![olm_core::game::BoardObjective {
                    id: "obj_position".to_string(),
                    description: "boardObjectives.objective.LeaguePosition".to_string(),
                    target: 4,
                    objective_type: olm_core::game::ObjectiveType::LeaguePosition,
                    met: false,
                }];
                roll_over(&mut game, &les_order, &lec_order);

                let club = game.teams.iter().find(|t| t.id == id).expect("club");
                assert_eq!(club.competition_id.as_deref(), Some("lec"));
                let lec_peers: Vec<&Team> = game
                    .teams
                    .iter()
                    .filter(|t| t.competition_id.as_deref() == Some("lec") && t.team_kind == TeamKind::Main && t.id != id)
                    .collect();
                assert_eq!(lec_peers.len(), 9);
                eprintln!(
                    "[lec promotion] club finance {} -> {}, wage budget {} -> {}, transfer budget {} -> {}, reputation {} -> {}; LEC median wage budget {}, median finance {}",
                    before.finance, club.finance, before.wage_budget, club.wage_budget,
                    before.transfer_budget, club.transfer_budget, before.reputation, club.reputation,
                    median(lec_peers.iter().map(|t| t.wage_budget).collect()),
                    median(lec_peers.iter().map(|t| t.finance).collect())
                );
                assert!(club.wage_budget >= before.wage_budget, "a promotion never lowers the wage budget");
                assert!(club.reputation >= before.reputation);
                assert!(club.transfer_budget >= before.transfer_budget);

                // The squad is the same five founders, the lineup still legal under the LEC rule.
                assert_eq!(roster_ids(&game, &id), roster_before);
                assert_eq!(club.active_lineup_ids, before.active_lineup_ids);
                assert!(olm_core::residency::validate_lineup_imports(&game, &id, &club.active_lineup_ids).is_ok());
                ensure_custom_club_roster(&game, &id).expect("full roster");
                let imports = game.players.iter().filter(|p| p.team_id.as_deref() == Some(id.as_str()) && p.is_import).count();
                eprintln!("[lec promotion] founders flagged as imports in the LEC: {imports} of {}", roster_before.len());

                // Objectives written for the LES are dropped by the move and regenerated for
                // the LEC on the next day.
                assert!(game.board_objectives.is_empty(), "stale LES objectives survived the promotion");
                olm_core::board_objectives::generate_objectives(&mut game);
                let position = game.board_objectives.iter().find(|o| o.id == "obj_position").expect("a position objective");
                assert!((1..=10).contains(&position.target), "target {} for a 10-club league", position.target);
                eprintln!("[lec promotion] regenerated objectives: {:?}", game.board_objectives.iter().map(|o| (o.id.as_str(), o.target)).collect::<Vec<_>>());
            }

            /// Q5: the custom club finishes below the champion, so it stays in a nine-club LES.
            #[test]
            fn a_join_club_that_does_not_win_stays_in_a_nine_club_les() {
                let Rolled { game, id, les_order, .. } = rolled(true, |_| Vec::new());
                let champion = les_order.iter().find(|c| !FEEDERS.contains(&c.as_str())).expect("eligible champion").clone();

                assert_ne!(champion, id);
                let movement = game.ladder.movements.last().expect("a movement");
                assert_eq!(movement.promoted, vec![champion.clone()]);
                assert_eq!(game.user_competition_id.as_deref(), Some("les"));
                assert_eq!(main_clubs(&game, "les").len(), 9);
                assert!(main_clubs(&game, "les").contains(&id));
                assert_eq!(main_clubs(&game, "lec").len(), 10);
                assert_world_is_consistent(&game);
                assert_round_robin(&game, "les", 9, true);
                assert_round_robin(&game, "lec", 10, true);
            }

            /// Q5: a feeder club in first place is skipped; the next eligible club goes up.
            #[test]
            fn a_feeder_champion_is_skipped_for_the_custom_club_in_second_place() {
                let Rolled { game, id, .. } = rolled(true, |id| vec![FEEDERS[0].to_string(), id.to_string()]);

                let movement = game.ladder.movements.last().expect("a movement");
                assert_eq!(movement.status, LadderMovementStatus::Applied);
                assert_eq!(movement.promoted, vec![id.clone()], "the feeder is skipped, the runner-up goes up");
                assert_eq!(game.teams.iter().find(|t| t.id == FEEDERS[0]).and_then(|t| t.competition_id.as_deref()), Some("les"));
                assert_eq!(game.user_competition_id.as_deref(), Some("lec"));
                assert_eq!(main_clubs(&game, "les").len(), 9);
                assert_world_is_consistent(&game);
            }

            /// Q5: three feeders on top are all skipped; the slot goes to the next eligible
            /// club, never stays empty while one exists.
            #[test]
            fn three_feeders_on_top_are_skipped_and_the_first_eligible_club_goes_up() {
                let Rolled { game, les_order, .. } = rolled(true, |_| FEEDERS.iter().map(|f| (*f).to_string()).collect());
                let movement = game.ladder.movements.last().expect("a movement");
                assert_eq!(movement.status, LadderMovementStatus::Applied);
                assert_eq!(&les_order[..3], &FEEDERS.map(String::from)[..]);
                assert_eq!(movement.promoted, vec![les_order[3].clone()], "the fourth club is the first eligible one");
                assert_eq!(main_clubs(&game, "les").len(), 9);
                assert_world_is_consistent(&game);
            }

            /// Q5: the same promotion in replace mode (8 clubs). The LES and its calendar
            /// stay at eight.
            #[test]
            fn a_replace_mode_club_promoted_keeps_the_les_at_eight() {
                let Rolled { game, id, season, .. } = rolled(false, champion_is_the_custom_club);

                assert!(id.contains("-custom-"));
                let movement = game.ladder.movements.last().expect("a movement");
                assert_eq!((movement.season, movement.status), (season, LadderMovementStatus::Applied));
                assert_eq!(movement.promoted, vec![id.clone()]);
                assert_eq!(game.user_competition_id.as_deref(), Some("lec"));
                assert_eq!((main_clubs(&game, "les").len(), main_clubs(&game, "lec").len()), (8, 10));
                assert_world_is_consistent(&game);
                assert_round_robin(&game, "les", 8, true);
                assert_round_robin(&game, "lec", 10, true);
            }

            /// A user in the LEC: Winter's playoffs end on May 4 (the day the season run
            /// closed it), five weeks after Spring is due to start (Mar 29). The next split
            /// must still be playable: no match dated on or before the clock.
            #[test]
            fn a_lec_split_that_ends_after_the_next_one_starts_gets_a_playable_calendar() {
                let (mut game, _catalog, _overlay, id) = new_game_as("Movistar KOI", Some(LEC_SLOT));
                let (manifests, known) = known_ids_and_manifests();
                prepare_new_game_season(&mut game, &manifests, &known, &id).expect("season");
                assert_eq!(game.user_competition_id.as_deref(), Some("lec"));
                let order = table_ids(&game, "lec");
                play_out_split(&mut game, "lec", 0, &order, Some(50));
                let today = game.clock.current_date.date_naive();
                let spring = &game.competition_configs["lec"].schedule.splits[1].season_start;
                assert!(today > NaiveDate::from_ymd_opt(today.year(), spring.month, spring.day).unwrap(), "setup: Spring is already due on {today}");

                let outcome = olm_core::season_rollover::advance_season(&mut game);

                assert!(!outcome.was_season_end);
                let lec = league_of(&game, "lec");
                assert_eq!(lec.split_index, 1);
                for fixture in lec.fixtures.iter().filter(|f| f.status == FixtureStatus::Scheduled) {
                    assert!(day(&fixture.date) > today, "{} is dated {} but the clock is {today}", fixture.id, fixture.date);
                }
            }

            /// Q4: the season after the promotion. The custom club plays in the LEC, the LES
            /// (nine clubs again) runs in the background, and both leagues play every split
            /// and playoff day by day until the next rollover has swapped a club again.
            #[test]
            #[ignore = "plays a whole season of the LEC and the LES after a promotion in a debug build (about 15 minutes); cd src-tauri && cargo test -p openleaguemanager --lib the_season_after_a_promotion -- --ignored --nocapture"]
            fn the_season_after_a_promotion_plays_in_both_leagues_and_rolls_again() {
                use std::collections::BTreeMap;

                let Rolled { mut game, id, season, .. } = rolled(true, champion_is_the_custom_club);
                let next = season + 1;
                let clubs_before: HashSet<String> =
                    main_clubs(&game, "les").union(&main_clubs(&game, "lec")).cloned().collect();
                assert_eq!(clubs_before.len(), 19);
                let started = std::time::Instant::now();

                let position = |game: &Game| -> BTreeMap<String, (u32, usize)> {
                    ["les", "lec"]
                        .iter()
                        .map(|c| ((*c).to_string(), (league_of(game, c).season, league_of(game, c).split_index)))
                        .collect()
                };
                // (competition, season, split) of every split that closed, and the playoff
                // fixtures the split ever had.
                let mut closed: BTreeMap<(String, u32, usize), usize> = BTreeMap::new();
                let mut playoffs: BTreeMap<(String, u32, usize), usize> = BTreeMap::new();
                let mut fired = false;
                let mut finished = false;
                let mut last = position(&game);

                for _ in 0..700 {
                    for competition in ["les", "lec"] {
                        let league = league_of(&game, competition);
                        let count = league.fixtures.iter().filter(|f| f.match_type == MatchType::Playoffs).count();
                        let entry = playoffs.entry((competition.to_string(), league.season, league.split_index)).or_default();
                        *entry = (*entry).max(count);
                    }
                    olm_core::turn::process_day_with_capture(&mut game, &mut |_| {});
                    let today = game.clock.current_date.date_naive();
                    for competition in ["les", "lec"] {
                        for fixture in &league_of(&game, competition).fixtures {
                            if matches!(fixture.match_type, MatchType::League | MatchType::Playoffs)
                                && fixture.status == FixtureStatus::Scheduled
                            {
                                assert!(day(&fixture.date) >= today, "{competition}: {} of {} was never played (today {today})", fixture.id, fixture.date);
                            }
                        }
                    }
                    if olm_core::end_of_season::is_season_complete(&game) {
                        let outcome = olm_core::season_rollover::advance_season(&mut game);
                        if outcome.was_season_end && olm_core::firing::check_manager_firing(&mut game) {
                            // Board satisfaction is random here and unrelated to the promotion.
                            fired = true;
                            game.manager.hire(id.clone());
                        }
                    }
                    let now = position(&game);
                    for (competition, was) in &last {
                        if now[competition] != *was {
                            let count = playoffs.get(&(competition.clone(), was.0, was.1)).copied().unwrap_or(0);
                            closed.insert((competition.clone(), was.0, was.1), count);
                            eprintln!("[lec promotion] {} closed {competition} S{} split {} ({count} playoff fixtures)", today, was.0, was.1);
                        }
                    }
                    last = now;
                    let swapped = game
                        .ladder
                        .movements
                        .iter()
                        .any(|m| m.link_lower == "les" && m.link_upper == "lec" && m.season == next);
                    if swapped && last.values().all(|(s, _)| *s == next + 1) {
                        finished = true;
                        break;
                    }
                }
                eprintln!("[lec promotion] second season took {:?}, ended {}, manager fired and re-hired: {fired}", started.elapsed(), game.clock.current_date.date_naive());
                assert!(finished, "the second rollover never happened by {}", game.clock.current_date.date_naive());

                for competition in ["les", "lec"] {
                    for split in 0..3 {
                        let key = (competition.to_string(), next, split);
                        let count = closed.get(&key).unwrap_or_else(|| panic!("{competition} split {split} never closed"));
                        if competition == "les" {
                            assert_eq!(*count, 3, "les split {split}: two semifinals and a final");
                        } else {
                            // The LEC manifest declares no playoffs; the engine schedules its own
                            // double-elimination bracket from the split name.
                            assert!(*count > 0, "lec split {split} played no playoffs");
                        }
                    }
                }
                let movement = game
                    .ladder
                    .movements
                    .iter()
                    .find(|m| m.link_lower == "les" && m.link_upper == "lec" && m.season == next)
                    .expect("the second ladder movement");
                eprintln!("[lec promotion] second ladder: {:?} up {:?}, down {:?}", movement.status, movement.promoted, movement.relegated);
                assert_eq!(movement.status, LadderMovementStatus::Applied);
                assert_eq!((movement.promoted.len(), movement.relegated.len()), (1, 1));
                let (les, lec) = (main_clubs(&game, "les"), main_clubs(&game, "lec"));
                assert_eq!((les.len(), lec.len()), (9, 10));
                let clubs_after: HashSet<String> = les.union(&lec).cloned().collect();
                assert_eq!(clubs_after, clubs_before, "nobody is lost");
                assert!(lec.contains(&movement.promoted[0]) && les.contains(&movement.relegated[0]));
                let club_league = game.teams.iter().find(|t| t.id == id).and_then(|t| t.competition_id.clone());
                eprintln!("[lec promotion] the custom club ends the second season in {club_league:?}");
                assert_eq!(game.user_competition_id, club_league, "the user's league follows the club");
                assert_eq!(game.manager.team_id.as_deref(), Some(id.as_str()));
                assert_world_is_consistent(&game);
                assert_round_robin(&game, "les", 9, false);
                assert_round_robin(&game, "lec", 10, false);
                let club = game.teams.iter().find(|t| t.id == id).expect("club");
                assert_eq!(club.active_lineup_ids.len(), 5);
                assert!(olm_core::residency::validate_lineup_imports(&game, &id, &club.active_lineup_ids).is_ok());
            }
        }

        #[test]
        fn joining_a_top_tier_league_is_rejected_by_the_backend() {
            let error = try_build_join_world("lec", &rayo()).expect_err("LEC is tier 1");

            assert!(error.contains("does not accept custom clubs"), "{error}");
        }

        #[test]
        fn joining_an_unknown_competition_is_rejected() {
            let error = try_build_join_world("nowhere", &rayo()).expect_err("unknown competition");

            assert!(error.contains("does not accept custom clubs"), "{error}");
        }

        /// Join mode keeps every club, so the name of an LES club stays taken even
        /// though replace mode would free it.
        #[test]
        fn joining_cannot_reuse_the_name_of_a_league_club() {
            let (plain, _overlay, _) = try_build_world(LES_SLOT, None).expect("plain world");
            let slot_name = plain
                .teams
                .iter()
                .find(|t| t.id == LES_SLOT)
                .expect("slot")
                .name
                .clone();
            let mut spec = rayo();
            spec.name = slot_name;

            assert!(try_build_world(LES_SLOT, Some(&spec)).is_ok(), "replace frees the name");
            let error = try_build_join_world("les", &spec).expect_err("the name is taken");
            assert_eq!(error, "Another team already uses this name");
        }

        /// The preview in join mode runs the join install, so it shows the real squad.
        #[test]
        fn the_preview_equals_the_installed_squad_in_join_mode() {
            let data = data_base();
            let (manifests, _known) = known_ids_and_manifests();
            let overlay = olm_core::world_overlay::bundled_world_overlay().expect("bundled overlay");
            for seed in [7_u32, 1_234] {
                let preview_spec = CustomTeamSpec {
                    name: PREVIEW_CLUB_NAME.to_string(),
                    primary_color: "#000000".to_string(),
                    secondary_color: "#ffffff".to_string(),
                    ..install_spec("RAY", seed, None)
                };
                let summary = preview_founding_squad_world(&NewGameWorldInputs {
                    data_dir: &data,
                    manifests: &manifests,
                    competition_id: "les",
                    team_id: "",
                    overlay: Some(&overlay),
                    custom_team: Some(&preview_spec),
                    joins_league: true,
                })
                .expect("join preview");

                let (game, id) =
                    try_build_join_world("les", &install_spec("RAY", seed, None)).expect("join world");
                assert_preview_matches_install(&summary, &game, &id);
            }
        }

        #[test]
        fn a_join_without_a_custom_club_is_refused() {
            let mut game = empty_session();
            let overlay = olm_core::world_overlay::bundled_world_overlay().expect("bundled overlay");
            let (manifests, _known) = known_ids_and_manifests();
            let error = build_new_game_world(
                &mut game,
                &NewGameWorldInputs {
                    data_dir: &data_base(),
                    manifests: &manifests,
                    competition_id: "les",
                    team_id: "",
                    overlay: Some(&overlay),
                    custom_team: None,
                    joins_league: true,
                },
            )
            .expect_err("nothing to join with");

            assert_eq!(error, "Joining a league needs a custom club");
        }

        /// The wizard's preview for `slot`, built the way the `preview_founding_squad`
        /// command does it, with a spec that differs from the real one in everything
        /// the squad does not depend on.
        fn preview_for(
            slot: &str,
            short_name: &str,
            seed: u32,
            overrides: Option<FounderOverrides>,
        ) -> Result<FoundingSquadSummary, String> {
            let data = data_base();
            let (manifests, known) = known_ids_and_manifests();
            let overlay = olm_core::world_overlay::bundled_world_overlay().expect("bundled overlay");
            let spec = CustomTeamSpec {
                name: PREVIEW_CLUB_NAME.to_string(),
                short_name: short_name.to_string(),
                primary_color: "#000000".to_string(),
                secondary_color: "#ffffff".to_string(),
                country: "ES".to_string(),
                logo_data_uri: None,
                founding_seed: Some(seed),
                founder_overrides: overrides,
                founder_photos: None,
            };
            preview_founding_squad_world(&NewGameWorldInputs {
                data_dir: &data,
                manifests: &manifests,
                competition_id: competition_id_from_team_id_known(slot, &known).expect("competition"),
                team_id: slot,
                overlay: Some(&overlay),
                custom_team: Some(&spec),
                joins_league: false,
            })
        }

        fn install_spec(
            short_name: &str,
            seed: u32,
            overrides: Option<FounderOverrides>,
        ) -> CustomTeamSpec {
            CustomTeamSpec {
                short_name: short_name.to_string(),
                logo_data_uri: None,
                founding_seed: Some(seed),
                founder_overrides: overrides,
                ..rayo()
            }
        }

        /// What a preview shows must be what the install creates, field by field.
        fn assert_preview_matches_install(summary: &FoundingSquadSummary, game: &Game, id: &str) {
            let club = game.teams.iter().find(|t| t.id == id).expect("club");
            let mut installed = founders(game, id);
            installed.sort_by_key(|p| ROLES.iter().position(|r| *r == p.natural_position));
            assert_eq!(summary.players.len(), installed.len());
            for (shown, real) in summary.players.iter().zip(installed) {
                assert_eq!(shown.id, real.id);
                assert_eq!(shown.role, real.natural_position);
                assert_eq!(shown.nick, real.match_name);
                assert_eq!(shown.full_name, real.full_name);
                assert_eq!(shown.nationality, real.nationality);
                assert_eq!(shown.date_of_birth, real.date_of_birth);
                assert_eq!(shown.ovr, real.lol_ovr);
                assert_eq!(shown.attributes.as_array(), real.attributes.as_array());
                assert_eq!(shown.wage, real.wage);
                assert_eq!(Some(shown.contract_end.as_str()), real.contract_end.as_deref());
                assert_eq!(shown.market_value, real.market_value);
            }
            assert_eq!(summary.wage_budget, club.wage_budget);
            assert_eq!(summary.bill, annual_bill(game, id));
        }

        /// PREVIEW MUST EQUAL INSTALL: same seed and inputs, same players, on two replaced
        /// slots (the second one is a different club with different released players).
        #[test]
        fn the_preview_equals_the_installed_squad_for_several_seeds() {
            for slot in [LES_SLOT, "les-team-8baee3fd"] {
                for seed in [7_u32, 21, 1_234, 987_654] {
                    let started = std::time::Instant::now();
                    let summary = preview_for(slot, "RAY", seed, None).expect("preview");
                    eprintln!("[preview] {slot} seed {seed}: {:?}", started.elapsed());
                    let (game, _overlay, id) =
                        try_build_world(slot, Some(&install_spec("RAY", seed, None))).expect("install");
                    assert_preview_matches_install(&summary, &game, &id);
                }
            }
        }

        /// The preview reproduces the install's identity edits and the budget derived after them.
        #[test]
        fn the_preview_equals_the_installed_squad_with_identity_edits() {
            let region = olm_core::residency::region_for_competition("les").expect("region");
            let nationality = olm_core::residency::region_nationality_codes(region)
                .pop()
                .expect("a region code");
            let overrides = FounderOverrides {
                top: Some(FounderIdentityOverride {
                    nick: Some("  Zed_77 ".to_string()),
                    full_name: Some("Ana   Núñez-Ruiz".to_string()),
                    nationality: Some(nationality.to_lowercase()),
                    birth_date: None,
                }),
                support: Some(FounderIdentityOverride {
                    birth_date: None,
                    ..FounderIdentityOverride::default()
                }),
                ..FounderOverrides::default()
            };
            for seed in [3_u32, 55] {
                // Birth dates are locked to the generated age: take the ends of each range.
                let plain = preview_for(LES_SLOT, "RAY", seed, None).expect("plain preview");
                let bounds = |role| {
                    let founder = plain.players.iter().find(|p| p.role == role).expect("founder");
                    (founder.birth_date_min.clone(), founder.birth_date_max.clone())
                };
                let mut overrides = overrides.clone();
                if let Some(top) = overrides.top.as_mut() {
                    top.birth_date = Some(bounds(LolRole::Top).0);
                }
                if let Some(support) = overrides.support.as_mut() {
                    support.birth_date = Some(bounds(LolRole::Support).1);
                }
                let summary =
                    preview_for(LES_SLOT, "RAY", seed, Some(overrides.clone())).expect("preview");
                let (game, _overlay, id) = try_build_world(
                    LES_SLOT,
                    Some(&install_spec("RAY", seed, Some(overrides.clone()))),
                )
                .expect("install");
                assert_preview_matches_install(&summary, &game, &id);
                let top = summary.players.iter().find(|p| p.role == LolRole::Top).expect("top");
                assert_eq!((top.nick.as_str(), top.full_name.as_str()), ("Zed_77", "Ana Núñez-Ruiz"));
                assert_eq!(top.nationality, nationality);
                let plain_top = plain.players.iter().find(|p| p.role == LolRole::Top).expect("top");
                assert_eq!(top.age, plain_top.age);
                assert_eq!(top.wage, plain_top.wage);
                assert_eq!(top.market_value, plain_top.market_value);
                assert_eq!(summary.wage_budget, plain.wage_budget);
                for shown in &summary.players {
                    let real = game.players.iter().find(|p| p.id == shown.id).expect("player");
                    assert!(
                        real.wage >= olm_core::wage_scale::scale_wage_for_market_value(real.market_value),
                        "{} is paid under the wage floor",
                        real.id
                    );
                }
            }
        }

        /// Wire errors are JSON: `{"kind":"invalid_field","role":..,"field":..,"reason":..}`.
        fn wire_error(error: &str) -> serde_json::Value {
            serde_json::from_str(error).unwrap_or_else(|_| panic!("not a wire error: {error}"))
        }

        fn nick_override(nick: &str) -> Option<FounderOverrides> {
            Some(FounderOverrides {
                top: Some(FounderIdentityOverride {
                    nick: Some(nick.to_string()),
                    ..FounderIdentityOverride::default()
                }),
                ..FounderOverrides::default()
            })
        }

        /// The names of the replaced club's released players are taken in the preview and in
        /// the install alike, so an edit to one of them is rejected on both sides.
        #[test]
        fn an_edit_to_a_released_players_nick_is_rejected_by_preview_and_install() {
            let (plain, _overlay, _) = try_build_world(LES_SLOT, None).expect("plain world");
            let released = plain
                .players
                .iter()
                .find(|p| p.team_id.as_deref() == Some(LES_SLOT))
                .expect("a player of the replaced club");
            let typed = released.match_name.to_uppercase();

            let preview = preview_for(LES_SLOT, "RAY", 5, nick_override(&typed)).expect_err("preview");
            let install = try_build_world(LES_SLOT, Some(&install_spec("RAY", 5, nick_override(&typed))))
                .map(|(_, _, id)| id)
                .expect_err("install");
            for error in [preview, install] {
                let wire = wire_error(&error);
                assert_eq!(wire["kind"], "invalid_field");
                assert_eq!(wire["role"], "TOP");
                assert_eq!(wire["field"], "nick");
                assert_eq!(wire["reason"], "taken");
            }
        }

        /// An invalid edit rejects the creation: no silent fallback to the generated name.
        #[test]
        fn an_invalid_edit_rejects_the_creation_with_a_field_level_error() {
            let error = try_build_world(LES_SLOT, Some(&install_spec("RAY", 5, nick_override("x"))))
                .map(|(_, _, id)| id)
                .expect_err("creation must be rejected");
            let wire = wire_error(&error);
            assert_eq!((wire["field"].as_str(), wire["reason"].as_str()), (Some("nick"), Some("too_short")));
        }

        /// A preview is a scratch build: it leaves a live session alone and only reads the world.
        #[test]
        fn a_preview_leaves_the_live_session_alone() {
            let state = StateManager::new();
            state.set_game(empty_session());
            let before = state.get_game(|g| serde_json::to_value(g).expect("json")).expect("game");
            preview_for(LES_SLOT, "RAY", 9, None).expect("preview");
            let after = state.get_game(|g| serde_json::to_value(g).expect("json")).expect("game");
            assert_eq!(before, after);
            assert!(state.get_game(|g| g.teams.is_empty()).expect("game"));
        }

        /// A preview for a club the world cannot host is a plain error, not a wire error.
        #[test]
        fn a_preview_for_a_slot_outside_the_competition_fails() {
            let error = preview_for(LEC_SLOT, "RAY", 9, None).expect_err("LEC takes no custom club");
            assert!(serde_json::from_str::<serde_json::Value>(&error).is_err(), "{error}");
        }

        fn session_with_custom_club(seed: u32) -> (StateManager, String) {
            let (mut game, _overlay, id) =
                try_build_world(LES_SLOT, Some(&install_spec("RAY", seed, None))).expect("world");
            game.manager.team_id = Some(id.clone());
            let state = StateManager::new();
            state.set_game(game);
            (state, id)
        }

        fn state_player(state: &StateManager, player_id: &str) -> Player {
            state
                .get_game(|g| g.players.iter().find(|p| p.id == player_id).cloned())
                .flatten()
                .expect("player")
        }

        /// A valid rename updates the session and, once the game is saved, the save.
        #[test]
        fn renaming_a_founder_updates_the_session_and_the_save() {
            let (state, id) = session_with_custom_club(11);
            let founder = state
                .get_game(|g| founders(g, &id).first().map(|p| p.id.clone()))
                .flatten()
                .expect("founder");
            let returned = crate::commands::squad::rename_player_in_session(
                &state,
                &founder,
                Some(" Zed_9 "),
                Some("Ana  Ruiz"),
            )
            .expect("rename");
            assert_eq!(returned.players.iter().find(|p| p.id == founder).map(|p| p.match_name.as_str()), Some("Zed_9"));
            let live = state_player(&state, &founder);
            assert_eq!((live.match_name.as_str(), live.full_name.as_str()), ("Zed_9", "Ana Ruiz"));

            let dir = tempfile::tempdir().expect("temp dir");
            let mut saves = olm_core::db::save_manager::SaveManager::init(dir.path()).expect("saves");
            let game = state.get_game(|g| g.clone()).expect("game");
            let save_id = saves.create_save(&game, "Rename").expect("create save");
            let loaded = saves.load_game(&save_id).expect("load");
            let saved = loaded.players.iter().find(|p| p.id == founder).expect("saved founder");
            assert_eq!((saved.match_name.as_str(), saved.full_name.as_str()), ("Zed_9", "Ana Ruiz"));
        }

        #[test]
        fn renaming_a_player_who_is_not_a_founder_is_rejected_and_changes_nothing() {
            let (state, id) = session_with_custom_club(11);
            let other = state
                .get_game(|g| {
                    g.players
                        .iter()
                        .find(|p| {
                            p.team_id.as_deref().is_some_and(|team| team != id && team.starts_with("les-"))
                        })
                        .map(|p| p.id.clone())
                })
                .flatten()
                .expect("another club's player");
            let before = state_player(&state, &other);
            let error = crate::commands::squad::rename_player_in_session(&state, &other, Some("Zed"), None)
                .expect_err("rejected");
            assert_eq!(wire_error(&error)["kind"], "not_a_founder");
            assert_eq!(state_player(&state, &other).match_name, before.match_name);
        }

        #[test]
        fn renaming_a_founder_to_a_taken_nick_is_rejected() {
            let (state, id) = session_with_custom_club(11);
            let (founder, taken) = state
                .get_game(|g| {
                    let founder = founders(g, &id).first().map(|p| p.id.clone());
                    let taken = g
                        .players
                        .iter()
                        .filter(|p| p.team_id.as_deref() != Some(id.as_str()))
                        .find(|p| olm_core::founder_identity::normalize_nick(&p.match_name).is_ok())
                        .map(|p| p.match_name.to_uppercase());
                    (founder, taken)
                })
                .expect("game");
            let error = crate::commands::squad::rename_player_in_session(
                &state,
                &founder.expect("founder"),
                Some(&taken.expect("a nick")),
                None,
            )
            .expect_err("duplicate");
            let wire = wire_error(&error);
            assert_eq!((wire["kind"].as_str(), wire["reason"].as_str()), (Some("invalid_field"), Some("taken")));
        }

        /// A photo set in a running game reaches the session, the projection the UI receives
        /// and, once the game is saved, the save; removing it clears all three.
        #[test]
        fn a_founder_photo_changed_in_game_survives_a_save_round_trip_and_can_be_removed() {
            let (state, id) = session_with_custom_club(11);
            let founder = state
                .get_game(|g| founders(g, &id).first().map(|p| p.id.clone()))
                .flatten()
                .expect("founder");
            let expected = olm_core::custom_logo::normalize_portrait(RED_STRIP_PNG).expect("photo");

            let returned =
                crate::commands::squad::set_player_photo_in_session(&state, &founder, Some(RED_STRIP_PNG))
                    .expect("set photo");
            let projected = returned.players.iter().find(|p| p.id == founder).expect("founder");
            assert_eq!(projected.profile_image_url.as_deref(), Some(expected.as_str()));
            assert_eq!(state_player(&state, &founder).profile_image_url, Some(expected.clone()));

            let dir = tempfile::tempdir().expect("temp dir");
            let mut saves = olm_core::db::save_manager::SaveManager::init(dir.path()).expect("saves");
            let game = state.get_game(|g| g.clone()).expect("game");
            let save_id = saves.create_save(&game, "Photo").expect("create save");
            let loaded = saves.load_game(&save_id).expect("load");
            let saved = loaded.players.iter().find(|p| p.id == founder).expect("saved founder");
            assert_eq!(saved.profile_image_url, Some(expected));

            crate::commands::squad::set_player_photo_in_session(&state, &founder, None).expect("remove");
            assert_eq!(state_player(&state, &founder).profile_image_url, None);
        }

        #[test]
        fn a_photo_for_a_player_who_is_not_a_founder_is_rejected_and_changes_nothing() {
            let (state, id) = session_with_custom_club(11);
            let other = state
                .get_game(|g| {
                    g.players
                        .iter()
                        .find(|p| {
                            p.team_id.as_deref().is_some_and(|team| team != id && team.starts_with("les-"))
                        })
                        .map(|p| p.id.clone())
                })
                .flatten()
                .expect("another club's player");
            let before = state_player(&state, &other).profile_image_url;
            let error = crate::commands::squad::set_player_photo_in_session(&state, &other, Some(RED_STRIP_PNG))
                .expect_err("rejected");
            assert_eq!(wire_error(&error)["kind"], "not_a_founder");
            assert_eq!(state_player(&state, &other).profile_image_url, before);
        }

        #[test]
        fn a_photo_that_is_not_an_image_is_rejected_in_game_and_the_session_keeps_the_old_one() {
            let (state, id) = session_with_custom_club(11);
            let founder = state
                .get_game(|g| founders(g, &id).first().map(|p| p.id.clone()))
                .flatten()
                .expect("founder");
            crate::commands::squad::set_player_photo_in_session(&state, &founder, Some(RED_STRIP_PNG))
                .expect("set photo");
            let before = state_player(&state, &founder).profile_image_url;

            let error = crate::commands::squad::set_player_photo_in_session(
                &state,
                &founder,
                Some("data:image/svg+xml;base64,PHN2Zy8+"),
            )
            .expect_err("rejected");

            let wire = wire_error(&error);
            assert_eq!((wire["kind"].as_str(), wire["reason"].as_str()), (Some("invalid_photo"), Some("not_png")));
            assert_eq!(state_player(&state, &founder).profile_image_url, before);
        }

        /// Without a seed the app picks one, and the squad is still generated.
        #[test]
        fn an_unseeded_custom_club_still_gets_a_generated_squad() {
            let (game, id) = custom_game();
            assert_eq!(founders(&game, &id).len(), 5);
            assert!(founders(&game, &id).iter().all(|p| p.id.starts_with("gen-ray-")));
        }

        /// The founding squad is stored in the game: a save round trip does not need the seed.
        #[test]
        fn the_founding_squad_survives_a_serde_round_trip_without_the_seed() {
            let (game, id) = custom_game();
            let json = serde_json::to_string(&game).expect("serialize");
            let loaded: Game = serde_json::from_str(&json).expect("deserialize");
            assert_eq!(squad_fingerprint(&game, &id), squad_fingerprint(&loaded, &id));
        }

        /// A 6x2 red PNG: wider than tall, so the portrait process must crop it square.
        const RED_STRIP_PNG: &str = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAYAAAACCAYAAAB7Xa1eAAAAEklEQVR4nGM4ISf3HxtmwCUBAFf2GCVZSxv0AAAAAElFTkSuQmCC";

        fn game_with_photos(
            photos: olm_core::founder_identity::FounderPhotos,
        ) -> Result<(Game, String), String> {
            let spec = CustomTeamSpec {
                founder_photos: Some(photos),
                ..install_spec("RAY", 7, None)
            };
            try_build_world(LES_SLOT, Some(&spec)).map(|(game, _overlay, id)| (game, id))
        }

        /// A founder photo chosen in the wizard is stored, square and re-encoded, in the player of
        /// that role, and a save round trip keeps it without any file on disk.
        #[test]
        fn a_founder_photo_is_stored_in_the_player_and_survives_a_save_round_trip() {
            let (game, id) = game_with_photos(olm_core::founder_identity::FounderPhotos {
                mid: Some(RED_STRIP_PNG.to_string()),
                ..Default::default()
            })
            .expect("world");

            let stored = |game: &Game, role| {
                founders(game, &id)
                    .into_iter()
                    .find(|p| p.natural_position == role)
                    .and_then(|p| p.profile_image_url.clone())
            };
            let photo = stored(&game, LolRole::Mid).expect("mid photo");
            assert_eq!(
                Some(photo.clone()),
                olm_core::custom_logo::normalize_portrait(RED_STRIP_PNG).ok()
            );
            assert!(photo.starts_with("data:image/png;base64,"));
            for role in [LolRole::Top, LolRole::Jungle, LolRole::Adc, LolRole::Support] {
                assert_eq!(stored(&game, role), None, "{role:?}");
            }
            let json = serde_json::to_string(&game).expect("serialize");
            let loaded: Game = serde_json::from_str(&json).expect("deserialize");
            assert_eq!(stored(&loaded, LolRole::Mid), Some(photo));
        }

        /// A photo the image process refuses rejects the creation with a wire error that names
        /// the founder's role and the reason.
        #[test]
        fn a_founder_photo_that_is_not_an_image_rejects_the_creation() {
            let error = game_with_photos(olm_core::founder_identity::FounderPhotos {
                support: Some("data:image/svg+xml;base64,PHN2Zy8+".to_string()),
                ..Default::default()
            })
            .expect_err("rejected");

            let wire: serde_json::Value =
                serde_json::from_str(&error).unwrap_or_else(|_| panic!("not a wire error: {error}"));
            assert_eq!(wire["kind"], "invalid_photo");
            assert_eq!(wire["role"], "SUPPORT");
            assert_eq!(wire["reason"], "not_png");
        }

        /// A club created without photos keeps every founder on the default avatar.
        #[test]
        fn a_club_without_photos_keeps_the_default_avatars() {
            let (game, id) = custom_game();
            assert!(founders(&game, &id).iter().all(|p| p.profile_image_url.is_none()));
        }

        /// When the generator refuses (a league median above what it supports), club
        /// creation goes on with today's free-agent fill and the league-median budget.
        #[test]
        fn a_failed_generation_falls_back_to_the_free_agent_fill() {
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
                joins_league: false,
            };
            let id = install_custom_club(&mut game, &inputs, &spec).expect("install");
            for player in game.players.iter_mut().filter(|p| {
                p.team_id
                    .as_deref()
                    .is_some_and(|team| team != id && team.starts_with("les-"))
            }) {
                player.attributes = PlayerAttributes::from_array([95; 9]);
            }
            let players_before = game.players.len();
            let budget_before = game.teams.iter().find(|t| t.id == id).map(|t| t.wage_budget);

            assert!(install_generated_squad(&mut game, &inputs, &spec, &id).expect("no edit error").is_none());

            assert_eq!(game.players.len(), players_before);
            assert_eq!(game.teams.iter().find(|t| t.id == id).map(|t| t.wage_budget), budget_before);
            fill_short_rosters(&mut game);
            ensure_custom_club_roster(&game, &id).expect("the free-agent fill still staffs the club");
        }

        /// Every competition that accepts a custom club generates a founding squad from the
        /// real data. Skipped when `data/` is missing.
        #[test]
        fn every_custom_club_competition_generates_a_founding_squad() {
            let data = data_base();
            if !data.join("competitions").is_dir() {
                eprintln!("data directory not found at {}; skipping", data.display());
                return;
            }
            let (manifests, _known) = known_ids_and_manifests();
            let overlay = olm_core::world_overlay::bundled_world_overlay().expect("bundled overlay");
            let mut base = empty_session();
            base.clock = GameClock::new(new_game_start_for(Some(&overlay)));
            let (teams, players, staff) = assemble_world_from_modular_data(
                &data,
                &manifests,
                "",
                "",
                base.clock.current_date.date_naive(),
            )
            .expect("catalog");
            base.teams = teams;
            base.players = players;
            base.staff = staff;
            apply_roster_overlay(&mut base, &overlay);

            // Today only the competitions with a configured schedule accept custom clubs. The
            // squad is also checked for every other active tier 2+ league, so enabling more of them
            // later cannot hit an unsupported region or an empty peer set unnoticed.
            let allowed: Vec<&CompetitionManifest> = manifests
                .iter()
                .filter(|m| {
                    !m.legacy
                        && (custom_team::custom_team_allowed(m)
                            || (m.active && m.tier.is_some_and(|tier| tier >= 2)))
                })
                .collect();
            assert!(
                allowed.iter().any(|m| m.id == "les"),
                "the LES must accept custom clubs, got {:?}",
                allowed.iter().map(|m| m.id.as_str()).collect::<Vec<_>>()
            );

            let mut failures = Vec::new();
            for manifest in allowed {
                let Some(slot) = base
                    .teams
                    .iter()
                    .find(|t| t.team_kind == TeamKind::Main && t.competition_id.as_deref() == Some(manifest.id.as_str()))
                    .map(|t| t.id.clone())
                else {
                    failures.push(format!("{}: no Main team to replace", manifest.id));
                    continue;
                };
                let mut game = base.clone();
                let outcome = custom_team::replace_team_with_custom(&mut game, &manifest.id, manifest.tier, &slot, &seeded_rayo(1))
                    .expect("custom club");
                match olm_core::founding_squad::install_founding_squad(
                    &mut game,
                    &manifest.id,
                    &outcome.team_id,
                    manifest.country.as_deref(),
                    1,
                ) {
                    Ok(installed) => {
                        let club = game.teams.iter().find(|t| t.id == outcome.team_id).expect("club");
                        let region = olm_core::residency::team_region(club);
                        let imports = founders(&game, &outcome.team_id)
                            .iter()
                            .filter(|p| olm_core::residency::is_import(p, region))
                            .count();
                        if installed.player_ids.len() != 5 || imports != 0 {
                            failures.push(format!("{}: {} players, {imports} imports", manifest.id, installed.player_ids.len()));
                        }
                    }
                    Err(error) => failures.push(format!("{}: {error}", manifest.id)),
                }
            }
            assert!(failures.is_empty(), "founding squad failures: {failures:#?}");
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
            // A tier-2 club funds no academy: the custom club inherits none and the
            // replaced club's seed copy is dissolved, not left orphaned.
            let owns_academy = game
                .teams
                .iter()
                .find(|t| t.id == id)
                .is_some_and(|club| club.academy_team_id.is_some())
                || game
                    .teams
                    .iter()
                    .any(|t| t.parent_team_id.as_deref() == Some(id));
            if owns_academy {
                problems.push("the custom club inherited an academy from a tier-2 club".to_string());
            }
            if game
                .teams
                .iter()
                .any(|t| t.team_kind == TeamKind::Academy && t.name == REPLACED_NAME)
            {
                problems.push("the replaced club's academy copy was left behind".to_string());
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
