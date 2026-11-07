//! Roster overlay: a small, reviewed patch applied on top of the bundled world
//! when a new game starts (player moves, retirements, additions and staff
//! changes). The wire format is contract v1 of `assets/world/roster-overlay.json`,
//! produced by `scripts/world/refresh.mjs`.
//!
//! [`apply_world_overlay`] is pure: it mutates the passed vectors and never does
//! I/O. Ops that reference unknown ids or teams are skipped and reported, never
//! turned into a failure, so a stale overlay cannot block a new game.

use std::collections::HashSet;
use std::fmt;

use chrono::NaiveDate;
use serde::{Deserialize, Deserializer, Serialize};

use crate::domain::player::{LolRole, Player};
use crate::domain::staff::{Staff, StaffRole};
use crate::domain::team::Team;

/// The only overlay `schemaVersion` this build understands.
pub const SUPPORTED_SCHEMA_VERSION: u64 = 1;

const BUNDLED_OVERLAY_JSON: &str = include_str!("../../../../assets/world/roster-overlay.json");

#[derive(Debug)]
pub enum OverlayError {
    /// The document is not valid JSON or does not match the contract shape.
    Json(serde_json::Error),
    /// `schemaVersion` is missing or not [`SUPPORTED_SCHEMA_VERSION`].
    UnsupportedSchemaVersion(Option<u64>),
    /// A date field is not a real `YYYY-MM-DD` date.
    InvalidDate { field: String, value: String },
    /// A field violates the contract (empty id, unknown position, ...).
    InvalidField { field: String, reason: &'static str },
}

impl fmt::Display for OverlayError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Json(err) => write!(f, "invalid roster overlay JSON: {err}"),
            Self::UnsupportedSchemaVersion(Some(found)) => write!(
                f,
                "unsupported roster overlay schemaVersion {found} (expected {SUPPORTED_SCHEMA_VERSION})"
            ),
            Self::UnsupportedSchemaVersion(None) => {
                write!(f, "roster overlay has no numeric schemaVersion")
            }
            Self::InvalidDate { field, value } => {
                write!(
                    f,
                    "roster overlay field `{field}` is not a YYYY-MM-DD date: {value:?}"
                )
            }
            Self::InvalidField { field, reason } => {
                write!(f, "roster overlay field `{field}` is invalid: {reason}")
            }
        }
    }
}

impl std::error::Error for OverlayError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Json(err) => Some(err),
            _ => None,
        }
    }
}

impl From<serde_json::Error> for OverlayError {
    fn from(err: serde_json::Error) -> Self {
        Self::Json(err)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverlaySource {
    pub name: String,
    #[serde(default)]
    pub url: String,
    pub license: String,
    #[serde(default)]
    pub license_url: String,
    #[serde(default)]
    pub attribution: String,
}

/// A `team_id` that must be present in the JSON but may be `null` (free agency).
/// A plain `Option` would silently turn a missing key into a release.
fn required_nullable<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    Option::<String>::deserialize(deserializer)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "lowercase")]
pub enum PlayerOp {
    Move {
        id: String,
        #[serde(deserialize_with = "required_nullable")]
        team_id: Option<String>,
        #[serde(default)]
        position: Option<LolRole>,
        #[serde(default)]
        contract_end: Option<String>,
        #[serde(default)]
        evidence: String,
    },
    Retire {
        id: String,
        #[serde(default)]
        evidence: String,
    },
    Add {
        player: Box<Player>,
        #[serde(default)]
        evidence: String,
        #[serde(default)]
        dob_approx: bool,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "lowercase")]
pub enum StaffOp {
    Move {
        id: String,
        #[serde(deserialize_with = "required_nullable")]
        team_id: Option<String>,
        #[serde(default)]
        role: Option<StaffRole>,
        #[serde(default)]
        evidence: String,
    },
    Add {
        staff: Box<Staff>,
        #[serde(default)]
        evidence: String,
        #[serde(default)]
        dob_approx: bool,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldOverlay {
    #[serde(rename = "schemaVersion")]
    pub schema_version: u64,
    /// Date the rosters are accurate for (`YYYY-MM-DD`).
    pub as_of: String,
    pub source: OverlaySource,
    #[serde(default)]
    pub coverage: Vec<String>,
    #[serde(default)]
    pub players: Vec<PlayerOp>,
    #[serde(default)]
    pub staff: Vec<StaffOp>,
}

fn check_date(field: &str, value: &str) -> Result<(), OverlayError> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map(|_| ())
        .map_err(|_| OverlayError::InvalidDate {
            field: field.to_string(),
            value: value.to_string(),
        })
}

fn check_id(field: String, id: &str) -> Result<(), OverlayError> {
    if id.trim().is_empty() {
        return Err(OverlayError::InvalidField {
            field,
            reason: "id must not be empty",
        });
    }
    Ok(())
}

impl WorldOverlay {
    /// Parse and validate an overlay document. The schema version is checked
    /// before the rest of the shape so a future version reports as
    /// [`OverlayError::UnsupportedSchemaVersion`] rather than a decoding error.
    pub fn parse(json: &str) -> Result<Self, OverlayError> {
        let raw: serde_json::Value = serde_json::from_str(json)?;
        let version = raw.get("schemaVersion").and_then(serde_json::Value::as_u64);
        if version != Some(SUPPORTED_SCHEMA_VERSION) {
            return Err(OverlayError::UnsupportedSchemaVersion(version));
        }
        let overlay: Self = serde_json::from_value(raw)?;
        overlay.validate()?;
        Ok(overlay)
    }

    /// Check the invariants serde cannot express: real dates, usable ids and
    /// roles, and a named source.
    pub fn validate(&self) -> Result<(), OverlayError> {
        if self.schema_version != SUPPORTED_SCHEMA_VERSION {
            return Err(OverlayError::UnsupportedSchemaVersion(Some(
                self.schema_version,
            )));
        }
        check_date("as_of", &self.as_of)?;
        if self.source.name.trim().is_empty() || self.source.license.trim().is_empty() {
            return Err(OverlayError::InvalidField {
                field: "source".to_string(),
                reason: "name and license are required",
            });
        }
        for (index, op) in self.players.iter().enumerate() {
            let at = |part: &str| format!("players[{index}].{part}");
            match op {
                PlayerOp::Move {
                    id,
                    position,
                    contract_end,
                    ..
                } => {
                    check_id(at("id"), id)?;
                    if *position == Some(LolRole::Unknown) {
                        return Err(OverlayError::InvalidField {
                            field: at("position"),
                            reason: "unknown position",
                        });
                    }
                    if let Some(date) = contract_end {
                        check_date(&at("contract_end"), date)?;
                    }
                }
                PlayerOp::Retire { id, .. } => check_id(at("id"), id)?,
                PlayerOp::Add { player, .. } => check_id(at("player.id"), &player.id)?,
            }
        }
        for (index, op) in self.staff.iter().enumerate() {
            let at = |part: &str| format!("staff[{index}].{part}");
            match op {
                StaffOp::Move { id, .. } => check_id(at("id"), id)?,
                StaffOp::Add { staff, .. } => check_id(at("staff.id"), &staff.id)?,
            }
        }
        Ok(())
    }
}

/// The overlay shipped inside the app. Newer overlays (see R3's downloaded cache)
/// are chosen by comparing `as_of` against this one.
pub fn bundled_world_overlay() -> Result<WorldOverlay, OverlayError> {
    WorldOverlay::parse(BUNDLED_OVERLAY_JSON)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SkipReason {
    UnknownPlayer,
    UnknownStaff,
    UnknownTeam(String),
    DuplicateId,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkippedOp {
    pub id: String,
    pub reason: SkipReason,
}

/// What [`apply_world_overlay`] did. Ids are unique per list.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct OverlayApplyReport {
    pub moved_player_ids: Vec<String>,
    /// Player records touched by moves; larger than `moved_player_ids` when an
    /// id exists in more than one shard.
    pub moved_player_records: usize,
    pub retired_player_ids: Vec<String>,
    pub retired_player_records: usize,
    pub added_player_ids: Vec<String>,
    pub moved_staff_ids: Vec<String>,
    pub added_staff_ids: Vec<String>,
    pub skipped: Vec<SkippedOp>,
}

impl OverlayApplyReport {
    /// Ids whose team assignment the overlay set; the game must protect these
    /// from catalog rehydration (`Game::moved_player_ids`).
    pub fn protected_player_ids(&self) -> impl Iterator<Item = &String> {
        self.moved_player_ids.iter().chain(&self.added_player_ids)
    }
}

impl fmt::Display for OverlayApplyReport {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "players: {} moved ({} records), {} retired ({} records), {} added; staff: {} moved, {} added; {} ops skipped",
            self.moved_player_ids.len(),
            self.moved_player_records,
            self.retired_player_ids.len(),
            self.retired_player_records,
            self.added_player_ids.len(),
            self.moved_staff_ids.len(),
            self.added_staff_ids.len(),
            self.skipped.len(),
        )
    }
}

fn push_unique(list: &mut Vec<String>, id: &str) {
    if !list.iter().any(|existing| existing == id) {
        list.push(id.to_string());
    }
}

/// Apply `overlay` to a freshly assembled world.
///
/// An op keyed by id applies to every record with that id (some ids exist in two
/// shards). Retired players are removed from `players`. Players that left a team
/// are dropped from that team's lineup, roles and training groups.
pub fn apply_world_overlay(
    teams: &mut [Team],
    players: &mut Vec<Player>,
    staff: &mut Vec<Staff>,
    overlay: &WorldOverlay,
) -> OverlayApplyReport {
    let mut report = OverlayApplyReport::default();
    let team_ids: HashSet<String> = teams.iter().map(|team| team.id.clone()).collect();
    let mut touched_players: HashSet<String> = HashSet::new();

    for op in &overlay.players {
        match op {
            PlayerOp::Move {
                id,
                team_id,
                position,
                contract_end,
                ..
            } => {
                if let Some(unknown) = team_id.as_ref().filter(|t| !team_ids.contains(*t)) {
                    report.skipped.push(SkippedOp {
                        id: id.clone(),
                        reason: SkipReason::UnknownTeam(unknown.clone()),
                    });
                    continue;
                }
                let mut records = 0;
                for player in players.iter_mut().filter(|p| &p.id == id) {
                    player.team_id.clone_from(team_id);
                    if let Some(role) = position {
                        player.position = *role;
                        player.natural_position = *role;
                    }
                    if let Some(date) = contract_end {
                        player.contract_end = Some(date.clone());
                    }
                    records += 1;
                }
                if records == 0 {
                    report.skipped.push(SkippedOp {
                        id: id.clone(),
                        reason: SkipReason::UnknownPlayer,
                    });
                    continue;
                }
                report.moved_player_records += records;
                push_unique(&mut report.moved_player_ids, id);
                touched_players.insert(id.clone());
            }
            PlayerOp::Retire { id, .. } => {
                let before = players.len();
                players.retain(|player| &player.id != id);
                let removed = before - players.len();
                if removed == 0 {
                    report.skipped.push(SkippedOp {
                        id: id.clone(),
                        reason: SkipReason::UnknownPlayer,
                    });
                    continue;
                }
                report.retired_player_records += removed;
                push_unique(&mut report.retired_player_ids, id);
                touched_players.insert(id.clone());
            }
            PlayerOp::Add { player, .. } => {
                if players.iter().any(|existing| existing.id == player.id) {
                    report.skipped.push(SkippedOp {
                        id: player.id.clone(),
                        reason: SkipReason::DuplicateId,
                    });
                    continue;
                }
                if let Some(unknown) = player.team_id.as_ref().filter(|t| !team_ids.contains(*t)) {
                    report.skipped.push(SkippedOp {
                        id: player.id.clone(),
                        reason: SkipReason::UnknownTeam(unknown.clone()),
                    });
                    continue;
                }
                let mut record = player.as_ref().clone();
                if record.natural_position == LolRole::Unknown {
                    record.natural_position = record.position;
                }
                // The generator leaves contract_end empty; the new-game defaults
                // only fill a missing value, not an empty string.
                if record
                    .contract_end
                    .as_deref()
                    .is_some_and(|s| s.trim().is_empty())
                {
                    record.contract_end = None;
                }
                push_unique(&mut report.added_player_ids, &record.id);
                players.push(record);
            }
        }
    }

    for op in &overlay.staff {
        match op {
            StaffOp::Move {
                id, team_id, role, ..
            } => {
                if let Some(unknown) = team_id.as_ref().filter(|t| !team_ids.contains(*t)) {
                    report.skipped.push(SkippedOp {
                        id: id.clone(),
                        reason: SkipReason::UnknownTeam(unknown.clone()),
                    });
                    continue;
                }
                let mut records = 0;
                for member in staff.iter_mut().filter(|s| &s.id == id) {
                    member.team_id.clone_from(team_id);
                    if let Some(role) = role {
                        member.role = role.clone();
                    }
                    records += 1;
                }
                if records == 0 {
                    report.skipped.push(SkippedOp {
                        id: id.clone(),
                        reason: SkipReason::UnknownStaff,
                    });
                } else {
                    push_unique(&mut report.moved_staff_ids, id);
                }
            }
            StaffOp::Add { staff: member, .. } => {
                if staff.iter().any(|existing| existing.id == member.id) {
                    report.skipped.push(SkippedOp {
                        id: member.id.clone(),
                        reason: SkipReason::DuplicateId,
                    });
                    continue;
                }
                if let Some(unknown) = member.team_id.as_ref().filter(|t| !team_ids.contains(*t)) {
                    report.skipped.push(SkippedOp {
                        id: member.id.clone(),
                        reason: SkipReason::UnknownTeam(unknown.clone()),
                    });
                    continue;
                }
                push_unique(&mut report.added_staff_ids, &member.id);
                staff.push(member.as_ref().clone());
            }
        }
    }

    scrub_departed_players(teams, players, &touched_players);
    report
}

/// Drop players who no longer belong to a team from its lineup, captain,
/// shotcaller and training groups. Teams reference players by id only, so this
/// is the whole of the roster bookkeeping.
fn scrub_departed_players(teams: &mut [Team], players: &[Player], touched: &HashSet<String>) {
    if touched.is_empty() {
        return;
    }
    for team in teams {
        let still_here = |id: &String| {
            !touched.contains(id)
                || players
                    .iter()
                    .any(|p| &p.id == id && p.team_id.as_deref() == Some(team.id.as_str()))
        };
        team.active_lineup_ids.retain(|id| still_here(id));
        if team
            .team_roles
            .captain
            .as_ref()
            .is_some_and(|id| !still_here(id))
        {
            team.team_roles.captain = None;
        }
        if team
            .team_roles
            .shotcaller
            .as_ref()
            .is_some_and(|id| !still_here(id))
        {
            team.team_roles.shotcaller = None;
        }
        for group in &mut team.training_groups {
            group.player_ids.retain(|id| still_here(id));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::player::PlayerAttributes;
    use crate::domain::staff::StaffAttributes;

    fn team(id: &str) -> Team {
        Team::new(
            id.to_string(),
            id.to_string(),
            id.to_string(),
            "KR".to_string(),
            "Seoul".to_string(),
            "Arena".to_string(),
            1000,
        )
    }

    fn player(id: &str, team_id: Option<&str>) -> Player {
        let mut p = Player::new(
            id.to_string(),
            id.to_string(),
            id.to_string(),
            "2000-01-01".to_string(),
            "KR".to_string(),
            LolRole::Mid,
            PlayerAttributes::default(),
        );
        p.team_id = team_id.map(str::to_string);
        p
    }

    fn staff_member(id: &str, role: StaffRole, team_id: Option<&str>) -> Staff {
        let mut s = Staff::new(
            id.to_string(),
            id.to_string(),
            String::new(),
            "1990-01-01".to_string(),
            role,
            StaffAttributes::default(),
        );
        s.team_id = team_id.map(str::to_string);
        s
    }

    struct World {
        teams: Vec<Team>,
        players: Vec<Player>,
        staff: Vec<Staff>,
    }

    fn world() -> World {
        let mut a = team("t-a");
        a.active_lineup_ids = vec!["p-1".to_string(), "p-2".to_string()];
        a.team_roles.captain = Some("p-1".to_string());
        World {
            teams: vec![a, team("t-b")],
            players: vec![
                player("p-1", Some("t-a")),
                player("p-2", Some("t-a")),
                player("p-3", Some("t-b")),
            ],
            staff: vec![staff_member("s-1", StaffRole::Scout, Some("t-a"))],
        }
    }

    fn overlay(players: &str, staff: &str) -> WorldOverlay {
        WorldOverlay::parse(&format!(
            r#"{{"schemaVersion":1,"as_of":"2026-11-07",
                "source":{{"name":"Leaguepedia","license":"CC BY-SA 3.0"}},
                "coverage":[],"players":[{players}],"staff":[{staff}]}}"#
        ))
        .expect("test overlay should parse")
    }

    fn apply(world: &mut World, overlay: &WorldOverlay) -> OverlayApplyReport {
        apply_world_overlay(
            &mut world.teams,
            &mut world.players,
            &mut world.staff,
            overlay,
        )
    }

    fn team_of<'a>(world: &'a World, id: &str) -> Option<&'a str> {
        world
            .players
            .iter()
            .find(|p| p.id == id)
            .and_then(|p| p.team_id.as_deref())
    }

    const ADD_PLAYER: &str = r#"{"op":"add","player":{"id":"p-new","match_name":"New","full_name":"New Guy",
        "position":"ADC","team_id":"t-b","contract_end":"","date_of_birth":"2004-04-17"}}"#;

    #[test]
    fn move_updates_team_position_and_contract() {
        let mut w = world();
        let o = overlay(
            r#"{"op":"move","id":"p-1","team_id":"t-b","position":"Top","contract_end":"2027-11-16"}"#,
            "",
        );
        let report = apply(&mut w, &o);
        let moved = w.players.iter().find(|p| p.id == "p-1").unwrap();
        assert_eq!(moved.team_id.as_deref(), Some("t-b"));
        assert_eq!(
            (moved.position, moved.natural_position),
            (LolRole::Top, LolRole::Top)
        );
        assert_eq!(moved.contract_end.as_deref(), Some("2027-11-16"));
        assert_eq!(report.moved_player_ids, vec!["p-1".to_string()]);
    }

    #[test]
    fn move_to_null_team_releases_to_free_agency() {
        let mut w = world();
        apply(
            &mut w,
            &overlay(r#"{"op":"move","id":"p-3","team_id":null}"#, ""),
        );
        assert_eq!(team_of(&w, "p-3"), None);
    }

    #[test]
    fn moved_player_leaves_old_team_lineup_and_roles() {
        let mut w = world();
        apply(
            &mut w,
            &overlay(r#"{"op":"move","id":"p-1","team_id":"t-b"}"#, ""),
        );
        assert_eq!(w.teams[0].active_lineup_ids, vec!["p-2".to_string()]);
        assert_eq!(w.teams[0].team_roles.captain, None);
    }

    #[test]
    fn move_applies_to_every_record_with_the_id() {
        let mut w = world();
        w.players.push(player("p-1", Some("t-b")));
        let report = apply(
            &mut w,
            &overlay(r#"{"op":"move","id":"p-1","team_id":null}"#, ""),
        );
        assert_eq!(
            w.players
                .iter()
                .filter(|p| p.id == "p-1" && p.team_id.is_none())
                .count(),
            2
        );
        assert_eq!(
            (report.moved_player_ids.len(), report.moved_player_records),
            (1, 2)
        );
    }

    #[test]
    fn retire_removes_all_duplicate_records_and_reports_the_id_once() {
        let mut w = world();
        w.players.push(player("p-2", Some("t-b")));
        let report = apply(&mut w, &overlay(r#"{"op":"retire","id":"p-2"}"#, ""));
        assert!(w.players.iter().all(|p| p.id != "p-2"));
        assert_eq!(report.retired_player_ids, vec!["p-2".to_string()]);
        assert_eq!(report.retired_player_records, 2);
        assert_eq!(w.teams[0].active_lineup_ids, vec!["p-1".to_string()]);
    }

    #[test]
    fn add_player_normalises_natural_position_and_empty_contract() {
        let mut w = world();
        let report = apply(&mut w, &overlay(ADD_PLAYER, ""));
        let added = w.players.iter().find(|p| p.id == "p-new").unwrap();
        assert_eq!(added.team_id.as_deref(), Some("t-b"));
        assert_eq!(added.natural_position, LolRole::Adc);
        assert_eq!(added.contract_end, None);
        assert_eq!(report.added_player_ids, vec!["p-new".to_string()]);
    }

    #[test]
    fn add_with_existing_id_is_skipped_and_reported() {
        let mut w = world();
        let o = overlay(ADD_PLAYER, "");
        apply(&mut w, &o);
        let report = apply(&mut w, &o);
        assert_eq!(w.players.iter().filter(|p| p.id == "p-new").count(), 1);
        assert_eq!(
            report.skipped,
            vec![SkippedOp {
                id: "p-new".to_string(),
                reason: SkipReason::DuplicateId
            }]
        );
    }

    #[test]
    fn head_coach_staff_add_becomes_coach() {
        let mut w = world();
        let staff = r#"{"op":"add","staff":{"id":"s-pad","nickname":"Pad","role":"HeadCoach","team_id":"t-b","wage":null}}"#;
        let report = apply(&mut w, &overlay("", staff));
        let added = w.staff.iter().find(|s| s.id == "s-pad").unwrap();
        assert_eq!(added.role, StaffRole::Coach);
        assert_eq!(report.added_staff_ids, vec!["s-pad".to_string()]);
    }

    #[test]
    fn staff_move_changes_team_and_role() {
        let mut w = world();
        let report = apply(
            &mut w,
            &overlay(
                "",
                r#"{"op":"move","id":"s-1","team_id":"t-b","role":"Analyst"}"#,
            ),
        );
        let moved = &w.staff[0];
        assert_eq!(
            (moved.team_id.as_deref(), &moved.role),
            (Some("t-b"), &StaffRole::Coach)
        );
        assert_eq!(report.moved_staff_ids, vec!["s-1".to_string()]);
    }

    #[test]
    fn unknown_ids_and_teams_are_skipped_not_fatal() {
        let mut w = world();
        let o = overlay(
            r#"{"op":"move","id":"ghost","team_id":"t-a"},
               {"op":"move","id":"p-1","team_id":"t-zzz"},
               {"op":"retire","id":"ghost"}"#,
            r#"{"op":"move","id":"s-ghost","team_id":null},
               {"op":"move","id":"s-1","team_id":"t-zzz"}"#,
        );
        let report = apply(&mut w, &o);
        assert_eq!(team_of(&w, "p-1"), Some("t-a"));
        assert_eq!(report.skipped.len(), 5);
        assert!(report.skipped.contains(&SkippedOp {
            id: "p-1".to_string(),
            reason: SkipReason::UnknownTeam("t-zzz".to_string()),
        }));
        assert!(report.skipped.contains(&SkippedOp {
            id: "s-ghost".to_string(),
            reason: SkipReason::UnknownStaff,
        }));
        assert!(report.moved_player_ids.is_empty());
    }

    #[test]
    fn empty_overlay_changes_nothing() {
        let mut w = world();
        let report = apply(&mut w, &overlay("", ""));
        assert_eq!(report, OverlayApplyReport::default());
        assert_eq!((w.players.len(), w.staff.len()), (3, 1));
        assert_eq!(w.teams[0].active_lineup_ids.len(), 2);
    }

    #[test]
    fn protected_ids_cover_moves_and_adds_but_not_retirements() {
        let mut w = world();
        let o = overlay(
            &format!(
                r#"{{"op":"move","id":"p-1","team_id":"t-b"}},{{"op":"retire","id":"p-2"}},{ADD_PLAYER}"#
            ),
            "",
        );
        let report = apply(&mut w, &o);
        let protected: Vec<&String> = report.protected_player_ids().collect();
        assert_eq!(protected, vec!["p-1", "p-new"]);
    }

    #[test]
    fn unknown_schema_version_is_rejected() {
        let err = WorldOverlay::parse(r#"{"schemaVersion":2,"as_of":"2026-11-07"}"#).unwrap_err();
        assert!(matches!(
            err,
            OverlayError::UnsupportedSchemaVersion(Some(2))
        ));
        let err = WorldOverlay::parse(r#"{"as_of":"2026-11-07"}"#).unwrap_err();
        assert!(matches!(err, OverlayError::UnsupportedSchemaVersion(None)));
    }

    #[test]
    fn malformed_dates_are_rejected() {
        let bad_as_of =
            r#"{"schemaVersion":1,"as_of":"2026-13-40","source":{"name":"x","license":"y"}}"#;
        assert!(matches!(
            WorldOverlay::parse(bad_as_of).unwrap_err(),
            OverlayError::InvalidDate { .. }
        ));
        let bad_contract = r#"{"schemaVersion":1,"as_of":"2026-11-07","source":{"name":"x","license":"y"},
            "players":[{"op":"move","id":"p-1","team_id":null,"contract_end":"soon"}]}"#;
        assert!(matches!(
            WorldOverlay::parse(bad_contract).unwrap_err(),
            OverlayError::InvalidDate { .. }
        ));
    }

    #[test]
    fn move_without_team_id_key_is_rejected_instead_of_releasing_the_player() {
        let json = r#"{"schemaVersion":1,"as_of":"2026-11-07","source":{"name":"x","license":"y"},
            "players":[{"op":"move","id":"p-1"}]}"#;
        assert!(matches!(
            WorldOverlay::parse(json).unwrap_err(),
            OverlayError::Json(_)
        ));
    }

    #[test]
    fn bundled_overlay_parses_and_validates() {
        let bundled = bundled_world_overlay().expect("bundled overlay must be valid");
        assert_eq!(bundled.schema_version, SUPPORTED_SCHEMA_VERSION);
        assert_eq!(bundled.source.license, "CC BY-SA 3.0");
        assert!(bundled.validate().is_ok());
    }
}
