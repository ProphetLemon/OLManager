use crate::competition_overrides::{self, CompetitionOverrides};
use crate::domain::player::Player;
use crate::domain::staff::Staff;
use crate::domain::team::Team;
use crate::game::Game;
use crate::team_overrides;
use log::{info, warn};
use std::collections::HashMap;
use std::path::Path;

use crate::generator::definitions::{
    CompetitionManifest, CompetitionSummary, LeagueSelectionData, PlayerDataFile, StaffDataFile,
    TeamDataFile, TeamSummary,
};

// ---------------------------------------------------------------------------
// Manifest loading
// ---------------------------------------------------------------------------

/// Scan a `competitions/` directory and return all manifests with the bundled
/// main-repo override layer applied.
pub fn scan_competitions(competitions_base: &Path) -> Vec<CompetitionManifest> {
    scan_competitions_with(competitions_base, competition_overrides::bundled())
}

/// Like [`scan_competitions`] but with an explicit override layer.
pub fn scan_competitions_with(
    competitions_base: &Path,
    overrides: &CompetitionOverrides,
) -> Vec<CompetitionManifest> {
    let mut manifests = scan_raw_competitions(competitions_base);
    overrides.apply_all(&mut manifests);
    manifests
}

/// Scan a `competitions/` directory without applying any override layer.
pub fn scan_raw_competitions(competitions_base: &Path) -> Vec<CompetitionManifest> {
    let entries = match std::fs::read_dir(competitions_base) {
        Ok(e) => e,
        Err(err) => {
            info!("[competitions] failed to read competitions dir: {}", err);
            return vec![];
        }
    };

    let mut manifests = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let manifest_path = path.join("manifest.json");
        if !manifest_path.exists() {
            continue;
        }
        match std::fs::read_to_string(&manifest_path) {
            Ok(json) => match serde_json::from_str::<CompetitionManifest>(&json) {
                Ok(manifest) => {
                    info!(
                        "[competitions] loaded manifest: {} ({})",
                        manifest.id, manifest.name
                    );
                    manifests.push(manifest);
                }
                Err(err) => {
                    info!(
                        "[competitions] skipped malformed manifest at {:?}: {}",
                        manifest_path, err
                    );
                }
            },
            Err(err) => {
                info!(
                    "[competitions] failed to read manifest at {:?}: {}",
                    manifest_path, err
                );
            }
        }
    }

    manifests
}

/// Load a single competition manifest by ID from a competitions directory.
pub fn load_competition_manifest(
    competitions_base: &Path,
    competition_id: &str,
) -> Result<CompetitionManifest, String> {
    load_competition_manifest_with(
        competitions_base,
        competition_id,
        competition_overrides::bundled(),
    )
}

/// Like [`load_competition_manifest`] but with an explicit override layer.
pub fn load_competition_manifest_with(
    competitions_base: &Path,
    competition_id: &str,
    overrides: &CompetitionOverrides,
) -> Result<CompetitionManifest, String> {
    let manifest_path = competitions_base.join(competition_id).join("manifest.json");
    let json = std::fs::read_to_string(&manifest_path)
        .map_err(|e| format!("Failed to read manifest for '{}': {}", competition_id, e))?;
    let mut manifest: CompetitionManifest = serde_json::from_str(&json)
        .map_err(|e| format!("Failed to parse manifest for '{}': {}", competition_id, e))?;
    overrides.apply(&mut manifest);
    Ok(manifest)
}

// ---------------------------------------------------------------------------
// Team / Player / Staff data loading
// ---------------------------------------------------------------------------

/// Load team data for a competition from its manifest's `teams_file` path.
pub fn load_teams(data_base: &Path, manifest: &CompetitionManifest) -> Result<Vec<Team>, String> {
    let teams_path = data_base.join(&manifest.teams_file);
    info!(
        "[competitions] loading teams for '{}' from {:?}",
        manifest.id, teams_path
    );
    let json = std::fs::read_to_string(&teams_path).map_err(|e| {
        format!(
            "Failed to read teams file '{}' for '{}': {}",
            manifest.teams_file, manifest.id, e
        )
    })?;
    let mut data: TeamDataFile =
        serde_json::from_str(&json).map_err(|e| format!("Failed to parse teams data: {}", e))?;

    // Inject competition_id and fix logo paths
    for team in &mut data.teams {
        team.competition_id = Some(manifest.id.clone());
        if let Some(ref mut url) = team.logo_url
            && url.starts_with("/team-logos/") {
                *url = url.replacen("/team-logos/", "/teams-icons/", 1);
            }
    }
    Ok(data.teams)
}

/// Load player data for a competition from its manifest's `players_file` path.
pub fn load_players(
    data_base: &Path,
    manifest: &CompetitionManifest,
) -> Result<Vec<Player>, String> {
    let players_path = data_base.join(&manifest.players_file);
    info!(
        "[competitions] loading players for '{}' from {:?}",
        manifest.id, players_path
    );
    let json = std::fs::read_to_string(&players_path).map_err(|e| {
        format!(
            "Failed to read players file '{}' for '{}': {}",
            manifest.players_file, manifest.id, e
        )
    })?;
    let mut data: PlayerDataFile =
        serde_json::from_str(&json).map_err(|e| format!("Failed to parse players data: {}", e))?;

    // Normalize: if natural_position is unknown, fall back to position
    for player in &mut data.players {
        if player.natural_position == crate::domain::stats::LolRole::Unknown {
            player.natural_position = player.position;
        }
    }

    Ok(data.players)
}

/// Load staff data for a competition from its manifest's `staff_file` path.
/// Returns an empty vec if no staff_file is configured and no conventional
/// `staffs/<competition>_staffs.json` shard exists.
pub fn load_staff(data_base: &Path, manifest: &CompetitionManifest) -> Result<Vec<Staff>, String> {
    let staff_path = match resolve_staff_file(data_base, manifest) {
        Some(path) => path,
        None => return Ok(Vec::new()),
    };
    eprintln!(
        "[competitions] loading staff for '{}' from {:?}",
        manifest.id, staff_path
    );
    info!(
        "[competitions] loading staff for '{}' from {:?}",
        manifest.id, staff_path
    );
    let json = std::fs::read_to_string(&staff_path).map_err(|e| {
        eprintln!(
            "[competitions] FAILED to read staff file {:?}: {}",
            staff_path, e
        );
        format!(
            "Failed to read staff file '{}' for '{}': {}",
            staff_path.display(),
            manifest.id,
            e
        )
    })?;
    let data: StaffDataFile =
        serde_json::from_str(&json).map_err(|e| format!("Failed to parse staff data: {}", e))?;
    Ok(data.staff)
}

fn resolve_staff_file(
    data_base: &Path,
    manifest: &CompetitionManifest,
) -> Option<std::path::PathBuf> {
    if let Some(path) = manifest
        .staff_file
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        return Some(data_base.join(path));
    }

    let conventional = data_base
        .join("staffs")
        .join(format!("{}_staffs.json", manifest.id));
    conventional.is_file().then_some(conventional)
}

/// Load free agent staff from `data/staffs/free_agents.json`.
pub fn load_staff_free_agents(data_base: &Path) -> Result<Vec<Staff>, String> {
    let staff_path = data_base.join("staffs").join("free_agents.json");
    let json = std::fs::read_to_string(&staff_path)
        .map_err(|e| format!("Failed to read staff file: {}", e))?;
    let data: StaffDataFile =
        serde_json::from_str(&json).map_err(|e| format!("Failed to parse staff data: {}", e))?;
    Ok(data.staff)
}

/// Count players per team from the manifest's players_file.
fn load_player_count_by_team(
    data_base: &Path,
    manifest: &CompetitionManifest,
) -> Result<HashMap<String, usize>, String> {
    let players = load_players(data_base, manifest)?;
    let mut counts = HashMap::new();
    for player in &players {
        if let Some(ref tid) = player.team_id {
            *counts.entry(tid.clone()).or_default() += 1;
        }
    }
    Ok(counts)
}

// ---------------------------------------------------------------------------
// League selection data
// ---------------------------------------------------------------------------

/// Build a `CompetitionSummary` for a single manifest.
fn competition_summary(
    data_base: &Path,
    manifest: CompetitionManifest,
) -> Option<CompetitionSummary> {
    let teams = match load_teams(data_base, &manifest) {
        Ok(t) => t,
        Err(err) => {
            info!(
                "[competitions] competition_summary: failed to load teams for '{}': {}",
                manifest.id, err
            );
            return None;
        }
    };
    let player_count_by_team = match load_player_count_by_team(data_base, &manifest) {
        Ok(counts) => counts,
        Err(err) => {
            info!(
                "[competitions] competition_summary: failed to load player counts for '{}': {}",
                manifest.id, err
            );
            HashMap::new()
        }
    };
    let prefix = format!("{}-", manifest.id);

    // Rosters key their players by the raw team id; the preview uses the prefixed one.
    let player_counts: Vec<Option<usize>> = teams
        .iter()
        .map(|team| player_count_by_team.get(&team.id).copied())
        .collect();
    let mut teams = teams;
    for team in &mut teams {
        if !team.id.starts_with(&prefix) {
            team.id = format!("{prefix}{}", team.id);
        }
    }
    // The metadata layer a new game applies, so the preview shows the reputation,
    // finances, country and city the game will use.
    team_overrides::bundled().apply_known(&mut teams);

    let team_summaries: Vec<TeamSummary> = teams
        .into_iter()
        .zip(player_counts)
        .map(|(team, player_count)| {
            TeamSummary {
                id: team.id,
                name: team.name,
                short_name: team.short_name,
                logo_url: team.logo_url,
                country: team.country,
                city: Some(team.city),
                finance: Some(team.finance),
                reputation: Some(team.reputation),
                colors: Some(team.colors),
                ovr: None,
                player_count,
            }
        })
        .collect();

    let custom_team_allowed = crate::custom_team::custom_team_allowed(&manifest);
    Some(CompetitionSummary {
        id: manifest.id,
        name: manifest.name,
        region: manifest.region,
        logo: manifest.logo,
        tier: manifest.tier.unwrap_or(0),
        legacy: manifest.legacy,
        active: manifest.active,
        // The roster is the truth: the manifest value drifts from the teams file.
        team_count: team_summaries.len() as u32,
        custom_team_allowed,
        teams: team_summaries,
    })
}

/// A competition is offered at team selection when it is active, not legacy,
/// and has at least one split to play (so regional leagues without a schedule stay hidden).
pub(crate) fn is_selectable_competition(manifest: &CompetitionManifest) -> bool {
    manifest.active && !manifest.legacy && !manifest.schedule.splits.is_empty()
}

/// Build lightweight league selection metadata from all competition manifests.
/// Keeps every selectable competition whatever its tier; the tier is exposed in the payload.
/// This is read-only and does not require game state.
pub fn build_league_selection(data_base: &Path) -> LeagueSelectionData {
    let competitions_base = data_base.join("competitions");
    info!(
        "[LeagueDebug] data_base={:?}, competitions_base={:?}",
        data_base, competitions_base
    );
    let manifests = scan_competitions(&competitions_base);

    for m in &manifests {
        info!(
            "[LeagueDebug] manifest: id={}, name={}, legacy={}, tier={:?}",
            m.id, m.name, m.legacy, m.tier
        );
    }

    let filtered_manifests: Vec<_> = manifests
        .into_iter()
        .filter(is_selectable_competition)
        .collect();

    for m in &filtered_manifests {
        info!("[LeagueDebug] PASSED filter: id={}, name={}", m.id, m.name);
    }

    let competitions: Vec<CompetitionSummary> = filtered_manifests
        .into_iter()
        .filter_map(|manifest| competition_summary(data_base, manifest))
        .collect();

    LeagueSelectionData { competitions }
}

/// Extract competition ID from a scoped team ID like `"lec-g2"` → `"lec"`.
///
/// Team IDs in OLManager are scoped as `{competition_id}-{team_local_id}`.
/// Because competition IDs may themselves contain `-` (e.g. `"emea-masters"`),
/// this helper returns the longest known competition prefix. The returned
/// prefix is guaranteed to be a known id.
///
/// Returns `None` when `team_id` has no dash, the prefix is empty, or no known
/// id matches.
pub fn competition_id_from_team_id_known<'a>(
    team_id: &'a str,
    known_competition_ids: &'a [String],
) -> Option<&'a str> {
    if team_id.is_empty() || known_competition_ids.is_empty() {
        return None;
    }
    // Longest-prefix match so competition ids that contain dashes
    // (e.g. "emea-masters") are handled correctly.
    let mut best: Option<&str> = None;
    for cid in known_competition_ids {
        let prefix = format!("{}-", cid);
        if team_id.starts_with(&prefix)
            && best.is_none_or(|b| cid.len() > b.len()) {
                best = Some(cid.as_str());
            }
    }
    best
}

/// Extract competition ID from a scoped team ID without validating it against
/// a known-id list. Returns the substring before the first dash.
///
/// Returns `None` when `team_id` has no dash or the prefix is empty.
pub fn competition_id_from_team_id_unchecked(team_id: &str) -> Option<&str> {
    if team_id.is_empty() {
        return None;
    }
    let dash_pos = team_id.find('-')?;
    let prefix = &team_id[..dash_pos];
    if prefix.is_empty() {
        None
    } else {
        Some(prefix)
    }
}

/// Backwards-compatible dispatcher. Prefer `competition_id_from_team_id_known`
/// or `competition_id_from_team_id_unchecked` for new code.
pub fn competition_id_from_team_id<'a>(
    team_id: &'a str,
    known_competition_ids: Option<&'a [String]>,
) -> Option<&'a str> {
    match known_competition_ids {
        Some(known) => competition_id_from_team_id_known(team_id, known),
        None => competition_id_from_team_id_unchecked(team_id),
    }
}

/// Clear `user_competition_id` and any team `competition_id` that do not
/// correspond to a known, non-legacy competition. After clearing, attempt to
/// re-derive `user_competition_id` from the manager team's id so the active
/// league resolution does not silently fall back to an unrelated league.
///
/// This is the minimum safe compatibility behavior for saves created when
/// legacy competition ids were still valid: invalid references are dropped
/// rather than left pointing at missing data.
pub fn sanitize_competition_references(game: &mut Game, known_competition_ids: &[String]) -> bool {
    // An empty known-id set means the competitions directory could not be
    // scanned or no manifests are present. Treat that as "cannot validate"
    // rather than "everything invalid" to avoid destructively clearing refs.
    if known_competition_ids.is_empty() {
        info!("[competitions] sanitize skipped: no known competition ids available");
        return false;
    }

    let mut changed = false;

    if let Some(ref cid) = game.user_competition_id
        && !known_competition_ids.contains(cid) {
            warn!(
                "[competitions] clearing invalid user_competition_id '{}'",
                cid
            );
            game.user_competition_id = None;
            changed = true;
        }

    for team in game.teams.iter_mut() {
        if let Some(ref cid) = team.competition_id
            && !known_competition_ids.contains(cid) {
                warn!(
                    "[competitions] clearing invalid competition_id '{}' for team '{}'",
                    cid, team.id
                );
                team.competition_id = None;
                changed = true;
            }
    }

    // Try to restore user_competition_id from the manager team id, which is
    // scoped as `{competition_id}-{team_local_id}` and is stable even when the
    // team's persisted competition_id was invalid.
    if game.user_competition_id.is_none()
        && let Some(manager_team) = game
            .teams
            .iter()
            .find(|t| t.manager_id.as_deref() == Some(&game.manager.id))
            && let Some(cid) =
                competition_id_from_team_id_known(&manager_team.id, known_competition_ids)
            {
                info!(
                    "[competitions] derived user_competition_id '{}' from manager team '{}'",
                    cid, manager_team.id
                );
                game.user_competition_id = Some(cid.to_string());
                changed = true;
            }

    changed
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest_with_staff_file(staff_file: Option<&str>) -> CompetitionManifest {
        let staff_file_json = match staff_file {
            Some(path) => format!(r#""{path}""#),
            None => "null".to_string(),
        };
        serde_json::from_str(&format!(
            r#"{{
                "id": "lec",
                "name": "LEC",
                "region": "EU",
                "tier": 1,
                "teams_file": "teams/lec_teams.json",
                "players_file": "players/lec_players.json",
                "staff_file": {staff_file_json},
                "schedule": {{
                    "format": "single_round_robin",
                    "team_count": 10,
                    "splits": []
                }}
            }}"#
        ))
        .expect("manifest should parse")
    }

    const OVERRIDES_JSON: &str = r#"{"version":1,"competitions":{"lec":{"tier":1,
        "schedule":{"format":"double_round_robin","team_count":6,
        "splits":[{"name":"Spring","best_of":1,"season_start":{"month":3,"day":1}}]}}}}"#;

    fn write_manifest_dir(base: &std::path::Path) {
        let dir = base.join("lec");
        std::fs::create_dir_all(&dir).expect("competition dir");
        std::fs::write(
            dir.join("manifest.json"),
            r#"{"id":"lec","name":"LEC","region":"EU","tier":2,
                "schedule":{"format":"unknown","team_count":0,"splits":[]}}"#,
        )
        .expect("manifest write");
    }

    #[test]
    fn scan_with_overrides_patches_every_scanned_manifest() {
        let dir = tempfile::tempdir().expect("tempdir");
        write_manifest_dir(dir.path());
        let overrides = CompetitionOverrides::parse(OVERRIDES_JSON).expect("overrides");

        let manifests = scan_competitions_with(dir.path(), &overrides);

        assert_eq!(manifests[0].tier, Some(1));
        assert_eq!(manifests[0].schedule.team_count, 6);
    }

    #[test]
    fn load_with_overrides_patches_a_single_manifest() {
        let dir = tempfile::tempdir().expect("tempdir");
        write_manifest_dir(dir.path());
        let overrides = CompetitionOverrides::parse(OVERRIDES_JSON).expect("overrides");

        let manifest = load_competition_manifest_with(dir.path(), "lec", &overrides).expect("load");

        assert_eq!(manifest.schedule.format, "double_round_robin");
    }

    fn write_competition(base: &std::path::Path, id: &str, tier: u8, legacy: bool, with_split: bool) {
        let dir = base.join("competitions").join(id);
        std::fs::create_dir_all(&dir).expect("competition dir");
        let splits = if with_split {
            r#"[{"name": "Winter", "season_start": {"day": 18, "month": 1}}]"#
        } else {
            "[]"
        };
        std::fs::write(
            dir.join("manifest.json"),
            format!(
                r#"{{
                    "id": "{id}", "name": "{id}", "region": "EU", "tier": {tier},
                    "active": true, "legacy": {legacy},
                    "teams_file": "teams/{id}.json",
                    "schedule": {{"format": "single_round_robin", "team_count": 0, "splits": {splits}}}
                }}"#
            ),
        )
        .expect("manifest");
        std::fs::create_dir_all(base.join("teams")).expect("teams dir");
        std::fs::write(base.join("teams").join(format!("{id}.json")), r#"{"teams": []}"#)
            .expect("teams file");
    }

    #[test]
    fn league_selection_offers_playable_leagues_of_every_tier() {
        let dir = tempfile::tempdir().expect("tempdir");
        write_competition(dir.path(), "lec", 1, false, true);
        write_competition(dir.path(), "les", 2, false, true);
        write_competition(dir.path(), "lfl", 2, false, false);
        write_competition(dir.path(), "old", 1, true, true);

        let data = build_league_selection(dir.path());
        let mut ids: Vec<_> = data.competitions.iter().map(|c| (c.id.as_str(), c.tier)).collect();
        ids.sort();

        // tier-2 with splits kept, tier-2 without splits and legacy dropped
        assert_eq!(ids, vec![("lec", 1), ("les", 2)]);
    }

    #[test]
    fn league_selection_flags_only_tier_two_playable_leagues_as_custom_team_hosts() {
        let dir = tempfile::tempdir().expect("tempdir");
        write_competition(dir.path(), "lec", 1, false, true);
        write_competition(dir.path(), "les", 2, false, true);

        let data = build_league_selection(dir.path());
        let flag = |id: &str| {
            data.competitions
                .iter()
                .find(|c| c.id == id)
                .map(|c| c.custom_team_allowed)
        };

        assert_eq!(flag("lec"), Some(false));
        assert_eq!(flag("les"), Some(true));
    }

    #[test]
    fn league_selection_hides_stale_competitions_without_a_teams_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        write_competition(dir.path(), "lec", 1, false, true);
        write_competition(dir.path(), "stale", 2, false, true);
        std::fs::remove_file(dir.path().join("teams").join("stale.json")).expect("remove teams");

        let data = build_league_selection(dir.path());
        let ids: Vec<_> = data.competitions.iter().map(|c| c.id.as_str()).collect();

        assert_eq!(ids, vec!["lec"]);
    }

    #[test]
    fn league_selection_counts_teams_from_the_roster_not_the_manifest() {
        let dir = tempfile::tempdir().expect("tempdir");
        write_competition(dir.path(), "les", 2, false, true);
        // The manifest claims 10 teams (`write_competition` writes 0 and the shipped
        // manifests drift the same way); the teams file holds three.
        let manifest_path = dir.path().join("competitions").join("les").join("manifest.json");
        let manifest = std::fs::read_to_string(&manifest_path).expect("manifest");
        std::fs::write(&manifest_path, manifest.replace(r#""team_count": 0"#, r#""team_count": 10"#))
            .expect("manifest");
        let team = |n: u8| {
            format!(
                r#"{{"id": "t{n}", "name": "T{n}", "short_name": "T{n}", "country": "ES", "city": "Madrid", "manager_id": null}}"#
            )
        };
        std::fs::write(
            dir.path().join("teams").join("les.json"),
            format!(r#"{{"teams": [{}, {}, {}]}}"#, team(1), team(2), team(3)),
        )
        .expect("teams file");

        let data = build_league_selection(dir.path());
        let les = data.competitions.iter().find(|c| c.id == "les").expect("les offered");

        assert_eq!(les.team_count, 3);
    }

    fn write_staff_file(path: &std::path::Path) {
        std::fs::write(
            path,
            r#"{
                "staff": [
                    {
                        "id": "staff-1",
                        "first_name": "Ada",
                        "last_name": "Analyst",
                        "date_of_birth": "1990-01-01",
                        "nationality": "Spain",
                        "role": "Assistant",
                        "attributes": {
                            "coaching": 70,
                            "judging_ability": 71,
                            "judging_potential": 72,
                            "physiotherapy": 73
                        },
                        "team_id": "lec-g2-esports"
                    }
                ]
            }"#,
        )
        .expect("staff file should write");
    }

    #[test]
    fn load_staff_falls_back_to_conventional_shard_when_manifest_omits_staff_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let staffs = dir.path().join("staffs");
        std::fs::create_dir_all(&staffs).expect("staffs dir");
        write_staff_file(&staffs.join("lec_staffs.json"));

        let loaded = load_staff(dir.path(), &manifest_with_staff_file(None)).expect("staff load");

        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "staff-1");
        assert_eq!(loaded[0].team_id.as_deref(), Some("lec-g2-esports"));
    }

    #[test]
    fn load_staff_still_respects_explicit_manifest_staff_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let custom = dir.path().join("custom_staff.json");
        write_staff_file(&custom);

        let loaded = load_staff(
            dir.path(),
            &manifest_with_staff_file(Some("custom_staff.json")),
        )
        .expect("staff load");

        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].first_name, "Ada");
    }

    #[test]
    fn competition_id_from_team_id_extracts_prefix() {
        assert_eq!(competition_id_from_team_id("lec-g2", None), Some("lec"));
        assert_eq!(
            competition_id_from_team_id("lec-team-name", None),
            Some("lec")
        );
        assert_eq!(competition_id_from_team_id("g2", None), None);
        assert_eq!(competition_id_from_team_id("-g2", None), None);
        assert_eq!(competition_id_from_team_id("", None), None);
    }

    #[test]
    fn competition_id_from_team_id_prefers_longest_known_prefix() {
        let known = vec!["lec".to_string(), "emea-masters".to_string()];
        assert_eq!(
            competition_id_from_team_id("lec-g2", Some(&known)),
            Some("lec")
        );
        assert_eq!(
            competition_id_from_team_id("emea-masters-g2", Some(&known)),
            Some("emea-masters")
        );
        // Unknown prefix returns None when known ids are supplied.
        assert_eq!(competition_id_from_team_id("lcs-g2", Some(&known)), None);
    }

    #[test]
    fn sanitize_competition_references_clears_invalid_ids_and_derives_from_team_id() {
        let mut game = Game::new(
            crate::clock::GameClock::new(chrono::Utc::now()),
            crate::domain::manager::Manager::new(
                "mgr-1".to_string(),
                "John".to_string(),
                "Smith".to_string(),
                "1990-01-01".to_string(),
                "GB".to_string(),
            ),
            vec![
                {
                    let mut t = Team::new(
                        "lec-g2".to_string(),
                        "G2".to_string(),
                        "G2".to_string(),
                        "DE".to_string(),
                        "Berlin".to_string(),
                        "Arena".to_string(),
                        1000,
                    );
                    t.manager_id = Some("mgr-1".to_string());
                    t.competition_id = Some("legacy-league".to_string());
                    t
                },
                Team::new(
                    "lec-fnc".to_string(),
                    "Fnatic".to_string(),
                    "FNC".to_string(),
                    "GB".to_string(),
                    "London".to_string(),
                    "Arena".to_string(),
                    1000,
                ),
            ],
            vec![],
            vec![],
            vec![],
        );
        game.user_competition_id = Some("legacy-league".to_string());

        let known = vec!["lec".to_string()];
        let changed = sanitize_competition_references(&mut game, &known);

        assert!(changed);
        assert_eq!(game.user_competition_id, Some("lec".to_string()));
        let g2 = game.teams.iter().find(|t| t.id == "lec-g2").unwrap();
        assert_eq!(g2.competition_id, None);
        let fnc = game.teams.iter().find(|t| t.id == "lec-fnc").unwrap();
        assert_eq!(fnc.competition_id, None);
    }

    #[test]
    fn sanitize_competition_references_preserves_valid_references() {
        let mut game = Game::new(
            crate::clock::GameClock::new(chrono::Utc::now()),
            crate::domain::manager::Manager::new(
                "mgr-1".to_string(),
                "John".to_string(),
                "Smith".to_string(),
                "1990-01-01".to_string(),
                "GB".to_string(),
            ),
            vec![
                {
                    let mut t = Team::new(
                        "lec-g2".to_string(),
                        "G2".to_string(),
                        "G2".to_string(),
                        "DE".to_string(),
                        "Berlin".to_string(),
                        "Arena".to_string(),
                        1000,
                    );
                    t.manager_id = Some("mgr-1".to_string());
                    t.competition_id = Some("lec".to_string());
                    t
                },
                {
                    let mut t = Team::new(
                        "emea-masters-g2".to_string(),
                        "G2".to_string(),
                        "G2".to_string(),
                        "DE".to_string(),
                        "Berlin".to_string(),
                        "Arena".to_string(),
                        1000,
                    );
                    t.competition_id = Some("emea-masters".to_string());
                    t
                },
            ],
            vec![],
            vec![],
            vec![],
        );
        game.user_competition_id = Some("lec".to_string());

        let known = vec!["lec".to_string(), "emea-masters".to_string()];
        let changed = sanitize_competition_references(&mut game, &known);

        assert!(!changed);
        assert_eq!(game.user_competition_id, Some("lec".to_string()));
        let g2 = game.teams.iter().find(|t| t.id == "lec-g2").unwrap();
        assert_eq!(g2.competition_id, Some("lec".to_string()));
        let emea_g2 = game
            .teams
            .iter()
            .find(|t| t.id == "emea-masters-g2")
            .unwrap();
        assert_eq!(emea_g2.competition_id, Some("emea-masters".to_string()));
    }

    #[test]
    fn sanitize_competition_references_handles_stale_and_legacy_refs() {
        let mut game = Game::new(
            crate::clock::GameClock::new(chrono::Utc::now()),
            crate::domain::manager::Manager::new(
                "mgr-1".to_string(),
                "John".to_string(),
                "Smith".to_string(),
                "1990-01-01".to_string(),
                "GB".to_string(),
            ),
            vec![
                {
                    let mut t = Team::new(
                        "lec-g2".to_string(),
                        "G2".to_string(),
                        "G2".to_string(),
                        "DE".to_string(),
                        "Berlin".to_string(),
                        "Arena".to_string(),
                        1000,
                    );
                    t.manager_id = Some("mgr-1".to_string());
                    t.competition_id = Some("old-worlds".to_string());
                    t
                },
                {
                    let mut t = Team::new(
                        "legacy-g2".to_string(),
                        "G2".to_string(),
                        "G2".to_string(),
                        "DE".to_string(),
                        "Berlin".to_string(),
                        "Arena".to_string(),
                        1000,
                    );
                    t.competition_id = Some("legacy".to_string());
                    t
                },
            ],
            vec![],
            vec![],
            vec![],
        );
        game.user_competition_id = Some("legacy-league".to_string());

        let known = vec!["lec".to_string()];
        let changed = sanitize_competition_references(&mut game, &known);

        assert!(changed);
        // Restored from the manager team id.
        assert_eq!(game.user_competition_id, Some("lec".to_string()));
        let lec_g2 = game.teams.iter().find(|t| t.id == "lec-g2").unwrap();
        assert_eq!(lec_g2.competition_id, None);
        let legacy_g2 = game.teams.iter().find(|t| t.id == "legacy-g2").unwrap();
        assert_eq!(legacy_g2.competition_id, None);
    }

    #[test]
    fn sanitize_competition_references_no_ops_when_known_ids_empty() {
        let mut game = Game::new(
            crate::clock::GameClock::new(chrono::Utc::now()),
            crate::domain::manager::Manager::new(
                "mgr-1".to_string(),
                "John".to_string(),
                "Smith".to_string(),
                "1990-01-01".to_string(),
                "GB".to_string(),
            ),
            vec![{
                let mut t = Team::new(
                    "lec-g2".to_string(),
                    "G2".to_string(),
                    "G2".to_string(),
                    "DE".to_string(),
                    "Berlin".to_string(),
                    "Arena".to_string(),
                    1000,
                );
                t.competition_id = Some("lec".to_string());
                t
            }],
            vec![],
            vec![],
            vec![],
        );
        game.user_competition_id = Some("lec".to_string());

        let known: Vec<String> = vec![];
        let changed = sanitize_competition_references(&mut game, &known);

        assert!(!changed);
        assert_eq!(game.user_competition_id, Some("lec".to_string()));
        assert_eq!(game.teams[0].competition_id, Some("lec".to_string()));
    }

    #[test]
    fn competition_id_from_team_id_known_returns_none_for_empty_known_list() {
        assert_eq!(competition_id_from_team_id_known("lec-g2", &[]), None);
    }

    #[test]
    fn league_selection_preview_applies_team_overrides_like_a_new_game() {
        let data_base = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../data");
        let selection = build_league_selection(&data_base);
        let les = selection
            .competitions
            .iter()
            .find(|c| c.id == "les")
            .expect("les is selectable");

        for (id, country, city, reputation, finance) in [
            ("les-team-854f6893", "ES", "Madrid", 315, 1_960_000),
            ("les-team-ac846213", "ES", "Barcelona", 300, 2_600_000),
        ] {
            let team = les.teams.iter().find(|t| t.id == id).expect("team listed");
            assert_eq!(team.country, country, "{id} country");
            assert_eq!(team.city.as_deref(), Some(city), "{id} city");
            assert_eq!(team.reputation, Some(reputation), "{id} reputation");
            assert_eq!(team.finance, Some(finance), "{id} finance");
        }
    }
}
