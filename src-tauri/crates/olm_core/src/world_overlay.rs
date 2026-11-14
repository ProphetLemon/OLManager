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

use chrono::{Duration, NaiveDate, Utc};
use serde::{Deserialize, Deserializer, Serialize};

use crate::domain::player::{LolRole, Player};
use crate::domain::staff::{Staff, StaffRole};
use crate::domain::team::Team;

/// The only overlay `schemaVersion` this build understands.
pub const SUPPORTED_SCHEMA_VERSION: u64 = 1;

/// An overlay may be dated slightly ahead of the local clock (time zones).
const MAX_FUTURE_DAYS: i64 = 2;
const MAX_OPS: usize = 5000;
const MAX_ID_CHARS: usize = 200;
const MAX_NAME_CHARS: usize = 200;
const MAX_EVIDENCE_CHARS: usize = 500;
const MAX_SOURCE_CHARS: usize = 1000;
const MAX_ATTRIBUTE: u8 = 100;

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

/// `as_of` is compared as a string elsewhere, so only the canonical zero-padded
/// form is accepted. Returns the parsed date for the future-date check.
fn check_canonical_date(field: &str, value: &str) -> Result<NaiveDate, OverlayError> {
    let invalid = || OverlayError::InvalidDate {
        field: field.to_string(),
        value: value.to_string(),
    };
    let date = NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| invalid())?;
    if value.len() != 10 || date.format("%Y-%m-%d").to_string() != value {
        return Err(invalid());
    }
    Ok(date)
}

fn check_id(field: String, id: &str) -> Result<(), OverlayError> {
    if id.trim().is_empty() {
        return Err(OverlayError::InvalidField {
            field,
            reason: "id must not be empty",
        });
    }
    check_len(field, id, MAX_ID_CHARS)
}

fn check_len(field: String, value: &str, max: usize) -> Result<(), OverlayError> {
    if value.chars().count() > max {
        return Err(OverlayError::InvalidField {
            field,
            reason: "text is too long",
        });
    }
    Ok(())
}

fn check_attribute(field: String, value: u8) -> Result<(), OverlayError> {
    if value > MAX_ATTRIBUTE {
        return Err(OverlayError::InvalidField {
            field,
            reason: "attribute must be between 0 and 100",
        });
    }
    Ok(())
}

/// Profile images ship inside the app, so an overlay may only point at a
/// root-relative asset path, never at a URL (including protocol-relative `//`).
fn check_image_path(field: String, path: Option<&str>) -> Result<(), OverlayError> {
    let Some(path) = path.filter(|p| !p.is_empty()) else {
        return Ok(());
    };
    let allowed_chars = path
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '_' | '.' | '-'));
    let allowed_ext = [".webp", ".png", ".jpg", ".jpeg"]
        .iter()
        .any(|ext| path.ends_with(ext));
    if !path.starts_with('/')
        || path.contains("..")
        || path.contains("//")
        || !allowed_chars
        || !allowed_ext
    {
        return Err(OverlayError::InvalidField {
            field,
            reason: "image must be a root-relative asset path",
        });
    }
    Ok(())
}

fn check_license_url(url: &str) -> Result<(), OverlayError> {
    let host = url
        .strip_prefix("https://")
        .and_then(|rest| rest.split(['/', '?', '#']).next());
    if matches!(host, Some("www.fandom.com" | "creativecommons.org")) {
        return Ok(());
    }
    Err(OverlayError::InvalidField {
        field: "source.license_url".to_string(),
        reason: "must be an https URL on www.fandom.com or creativecommons.org",
    })
}

fn check_player_record(at: &dyn Fn(&str) -> String, player: &Player) -> Result<(), OverlayError> {
    check_id(at("player.id"), &player.id)?;
    check_len(at("player.match_name"), &player.match_name, MAX_NAME_CHARS)?;
    check_len(at("player.full_name"), &player.full_name, MAX_NAME_CHARS)?;
    if let Some(team) = &player.team_id {
        check_len(at("player.team_id"), team, MAX_ID_CHARS)?;
    }
    if player.position == LolRole::Unknown {
        return Err(OverlayError::InvalidField {
            field: at("player.position"),
            reason: "unknown position",
        });
    }
    check_date(&at("player.date_of_birth"), &player.date_of_birth)?;
    let a = &player.attributes;
    for (name, value) in [
        ("mechanics", a.mechanics),
        ("laning", a.laning),
        ("teamfighting", a.teamfighting),
        ("macro_play", a.macro_play),
        ("consistency", a.consistency),
        ("shotcalling", a.shotcalling),
        ("champion_pool", a.champion_pool),
        ("discipline", a.discipline),
        ("mental_resilience", a.mental_resilience),
        ("potential_base", player.potential_base),
    ] {
        check_attribute(at(&format!("player.{name}")), value)?;
    }
    check_image_path(
        at("player.profile_image_url"),
        player.profile_image_url.as_deref(),
    )
}

fn check_staff_record(at: &dyn Fn(&str) -> String, staff: &Staff) -> Result<(), OverlayError> {
    check_id(at("staff.id"), &staff.id)?;
    check_len(at("staff.nickname"), &staff.nickname, MAX_NAME_CHARS)?;
    check_len(at("staff.first_name"), &staff.first_name, MAX_NAME_CHARS)?;
    check_len(at("staff.last_name"), &staff.last_name, MAX_NAME_CHARS)?;
    if let Some(team) = &staff.team_id {
        check_len(at("staff.team_id"), team, MAX_ID_CHARS)?;
    }
    let a = &staff.attributes;
    for (name, value) in [
        ("coaching", a.coaching),
        ("judging_ability", a.judging_ability),
        ("judging_potential", a.judging_potential),
        ("physiotherapy", a.physiotherapy),
    ] {
        check_attribute(at(&format!("staff.{name}")), value)?;
    }
    check_image_path(
        at("staff.profile_image_url"),
        staff.profile_image_url.as_deref(),
    )
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

    /// [`Self::validate_at`] against today's UTC date.
    pub fn validate(&self) -> Result<(), OverlayError> {
        self.validate_at(Utc::now().date_naive())
    }

    /// Check the invariants serde cannot express: canonical dates (`as_of` no
    /// later than `today` + [`MAX_FUTURE_DAYS`]), usable ids and roles, bounded
    /// sizes, sane attributes, asset-only image paths and a trusted licence.
    pub fn validate_at(&self, today: NaiveDate) -> Result<(), OverlayError> {
        if self.schema_version != SUPPORTED_SCHEMA_VERSION {
            return Err(OverlayError::UnsupportedSchemaVersion(Some(
                self.schema_version,
            )));
        }
        let as_of = check_canonical_date("as_of", &self.as_of)?;
        if as_of > today + Duration::days(MAX_FUTURE_DAYS) {
            return Err(OverlayError::InvalidDate {
                field: "as_of".to_string(),
                value: self.as_of.clone(),
            });
        }
        if self.source.name.trim().is_empty() || self.source.license.trim().is_empty() {
            return Err(OverlayError::InvalidField {
                field: "source".to_string(),
                reason: "name and license are required",
            });
        }
        let source = &self.source;
        for (name, value) in [
            ("name", &source.name),
            ("url", &source.url),
            ("license", &source.license),
            ("license_url", &source.license_url),
            ("attribution", &source.attribution),
        ] {
            check_len(format!("source.{name}"), value, MAX_SOURCE_CHARS)?;
        }
        check_license_url(&source.license_url)?;
        if self.players.len() > MAX_OPS || self.staff.len() > MAX_OPS {
            return Err(OverlayError::InvalidField {
                field: "players/staff".to_string(),
                reason: "too many ops",
            });
        }
        for (index, op) in self.players.iter().enumerate() {
            let at = |part: &str| format!("players[{index}].{part}");
            match op {
                PlayerOp::Move {
                    id,
                    team_id,
                    position,
                    contract_end,
                    evidence,
                } => {
                    check_id(at("id"), id)?;
                    if let Some(team) = team_id {
                        check_len(at("team_id"), team, MAX_ID_CHARS)?;
                    }
                    check_len(at("evidence"), evidence, MAX_EVIDENCE_CHARS)?;
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
                PlayerOp::Retire { id, evidence } => {
                    check_id(at("id"), id)?;
                    check_len(at("evidence"), evidence, MAX_EVIDENCE_CHARS)?;
                }
                PlayerOp::Add {
                    player, evidence, ..
                } => {
                    check_player_record(&at, player)?;
                    check_len(at("evidence"), evidence, MAX_EVIDENCE_CHARS)?;
                }
            }
        }
        for (index, op) in self.staff.iter().enumerate() {
            let at = |part: &str| format!("staff[{index}].{part}");
            match op {
                StaffOp::Move {
                    id,
                    team_id,
                    evidence,
                    ..
                } => {
                    check_id(at("id"), id)?;
                    if let Some(team) = team_id {
                        check_len(at("team_id"), team, MAX_ID_CHARS)?;
                    }
                    check_len(at("evidence"), evidence, MAX_EVIDENCE_CHARS)?;
                }
                StaffOp::Add {
                    staff, evidence, ..
                } => {
                    check_staff_record(&at, staff)?;
                    check_len(at("evidence"), evidence, MAX_EVIDENCE_CHARS)?;
                }
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
    /// Extra records of a moved id that were removed so the player is not on
    /// the target team twice.
    pub collapsed_duplicate_records: usize,
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
            "players: {} moved ({} records, {} duplicates collapsed), {} retired ({} records), {} added; staff: {} moved, {} added; {} ops skipped",
            self.moved_player_ids.len(),
            self.moved_player_records,
            self.collapsed_duplicate_records,
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
/// A move applies to the first record with that id and removes the other
/// records sharing it (some ids exist in two shards: stale and live), so the
/// player is never on the target team twice. A retirement removes every record.
/// Retired players are removed from `players`. Players that left a team
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
                // An id can exist in two shards (stale and live). Moving every
                // record would put the player on the target team twice, so the
                // first record moves and the others are collapsed away.
                let mut matching = players
                    .iter()
                    .enumerate()
                    .filter(|(_, p)| &p.id == id)
                    .map(|(index, _)| index);
                let Some(first) = matching.next() else {
                    report.skipped.push(SkippedOp {
                        id: id.clone(),
                        reason: SkipReason::UnknownPlayer,
                    });
                    continue;
                };
                let extra: Vec<usize> = matching.collect();
                report.collapsed_duplicate_records += extra.len();
                // Highest index first so earlier removals do not shift later ones.
                for index in extra.into_iter().rev() {
                    players.remove(index);
                }
                let player = &mut players[first];
                player.team_id.clone_from(team_id);
                if let Some(role) = position {
                    player.position = *role;
                    player.natural_position = *role;
                }
                if let Some(date) = contract_end {
                    player.contract_end = Some(date.clone());
                }
                report.moved_player_records += 1;
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
                "source":{{"name":"Leaguepedia","license":"CC BY-SA 3.0","license_url":"https://www.fandom.com/licensing"}},
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
    fn move_with_duplicate_ids_keeps_one_record_on_the_target_team() {
        let mut w = world();
        w.players.push(player("p-1", Some("t-b")));
        w.teams[1].active_lineup_ids = vec!["p-1".to_string()];
        let report = apply(
            &mut w,
            &overlay(r#"{"op":"move","id":"p-1","team_id":"t-b"}"#, ""),
        );
        let records: Vec<&Player> = w.players.iter().filter(|p| p.id == "p-1").collect();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].team_id.as_deref(), Some("t-b"));
        assert_eq!(report.collapsed_duplicate_records, 1);
        assert_eq!(
            (report.moved_player_ids.len(), report.moved_player_records),
            (1, 1)
        );
        assert_eq!(w.teams[0].active_lineup_ids, vec!["p-2".to_string()]);
        assert_eq!(w.teams[1].active_lineup_ids, vec!["p-1".to_string()]);
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

    /// A free-agent add shaped like `scripts/world/lib/pool.mjs` emits it: no team, an ISO-2
    /// nationality, the generator's empty wage, market value and contract end, and an extra
    /// `pool` object the app does not know.
    const POOL_PLAYER: &str = r#"{"op":"add","evidence":"https://lol.fandom.com/wiki/Send0o","dob_approx":true,
        "player":{"id":"player-bea33543","team_id":null,"position":"Top","nationality":"ES",
          "full_name":"Rosendo Fuentes Boveda","match_name":"Send0o","wage":0,"market_value":0,
          "contract_end":"","date_of_birth":"2002-05-01","potential_base":60},
        "pool":{"page":"Send0o","kind":"player","role":"Top","region":"EMEA","tier":2,"rating":"tier-default"}}"#;

    const POOL_STAFF: &str = r#"{"op":"add","evidence":"https://lol.fandom.com/wiki/Pad","dob_approx":true,
        "staff":{"id":"staff-1a2b3c4d","role":"Analyst","wage":null,"team_id":null,"last_name":"Suckow-Breum",
          "first_name":"Patrick Suckow-Breum","nickname":"Pad","nationality":"DK","contract_end":null,
          "birth_country":null,"date_of_birth":"1990-01-01","specialization":null,"profile_image_url":null},
        "pool":{"page":"Pad","kind":"staff","role":"Analyst","region":"EMEA","tier":2,"rating":"tier-default"}}"#;

    #[test]
    fn teamless_pool_player_add_is_kept_as_a_free_agent_with_no_contract() {
        let mut w = world();
        let report = apply(&mut w, &overlay(POOL_PLAYER, ""));
        let added = w
            .players
            .iter()
            .find(|p| p.id == "player-bea33543")
            .unwrap();
        assert_eq!(added.team_id, None);
        assert_eq!(added.nationality, "ES");
        assert_eq!((added.wage, added.contract_end.as_deref()), (0, None));
        assert_eq!(report.added_player_ids, vec!["player-bea33543".to_string()]);
        assert!(report.skipped.is_empty());
    }

    #[test]
    fn teamless_pool_staff_add_is_kept_as_a_free_agent() {
        let mut w = world();
        let report = apply(&mut w, &overlay("", POOL_STAFF));
        let added = w.staff.iter().find(|s| s.id == "staff-1a2b3c4d").unwrap();
        assert_eq!(added.team_id, None);
        assert_eq!(added.nationality, "DK");
        assert_eq!((added.wage, added.contract_end.as_deref()), (0, None));
        assert_eq!(report.added_staff_ids, vec!["staff-1a2b3c4d".to_string()]);
        assert!(report.skipped.is_empty());
    }

    #[test]
    fn a_wage_written_as_an_empty_string_makes_the_overlay_unreadable() {
        // `lenient_u32` accepts a number, a float or null, not a string: the generator writes 0 (players)
        // and null (staff), and an empty string would reject the whole overlay rather than read as 0.
        let json = format!(
            r#"{{"schemaVersion":1,"as_of":"2026-11-07","source":{{"name":"x","license":"y","license_url":"https://www.fandom.com/licensing"}},
                "players":[{}]}}"#,
            POOL_PLAYER.replace(r#""wage":0"#, r#""wage":"""#)
        );
        assert!(WorldOverlay::parse(&json).is_err());
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
        let bad_as_of = r#"{"schemaVersion":1,"as_of":"2026-13-40","source":{"name":"x","license":"y","license_url":"https://www.fandom.com/licensing"}}"#;
        assert!(matches!(
            WorldOverlay::parse(bad_as_of).unwrap_err(),
            OverlayError::InvalidDate { .. }
        ));
        let bad_contract = r#"{"schemaVersion":1,"as_of":"2026-11-07","source":{"name":"x","license":"y","license_url":"https://www.fandom.com/licensing"},
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

    const SOURCE: &str =
        r#""source":{"name":"x","license":"y","license_url":"https://www.fandom.com/licensing"}"#;

    fn doc(as_of: &str, body: &str) -> String {
        format!(r#"{{"schemaVersion":1,"as_of":"{as_of}",{SOURCE}{body}}}"#)
    }

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 11, 7).unwrap()
    }

    fn validate_doc(json: &str) -> Result<(), OverlayError> {
        let overlay: WorldOverlay = serde_json::from_str(json).expect("shape");
        overlay.validate_at(today())
    }

    fn add_player_with(patch: &str) -> String {
        let player = format!(
            r#"{{"id":"p-new","match_name":"New","full_name":"New Guy","position":"ADC","team_id":"t-b","date_of_birth":"2004-04-17"{patch}}}"#
        );
        doc(
            "2026-11-07",
            &format!(r#","players":[{{"op":"add","player":{player}}}]"#),
        )
    }

    #[test]
    fn as_of_must_be_canonical_zero_padded() {
        for bad in [
            "2026-1-5",
            "2026-11-7",
            "20261107",
            " 2026-11-07",
            "2026-11-07 ",
        ] {
            assert!(
                matches!(
                    validate_doc(&doc(bad, "")),
                    Err(OverlayError::InvalidDate { .. })
                ),
                "{bad:?} must be rejected"
            );
        }
        assert!(validate_doc(&doc("2026-11-07", "")).is_ok());
    }

    #[test]
    fn as_of_more_than_two_days_ahead_is_rejected() {
        assert!(validate_doc(&doc("2026-11-09", "")).is_ok());
        assert!(matches!(
            validate_doc(&doc("2026-11-10", "")),
            Err(OverlayError::InvalidDate { .. })
        ));
    }

    #[test]
    fn license_url_must_be_https_on_a_trusted_host() {
        for bad in [
            "http://www.fandom.com/licensing",
            "https://evil.example/licensing",
            "https://www.fandom.com.evil.example/x",
            "https://www.fandom.com@evil.example/x",
            "",
        ] {
            let json = format!(
                r#"{{"schemaVersion":1,"as_of":"2026-11-07","source":{{"name":"x","license":"y","license_url":"{bad}"}}}}"#
            );
            assert!(validate_doc(&json).is_err(), "{bad:?} must be rejected");
        }
        let cc = r#"{"schemaVersion":1,"as_of":"2026-11-07","source":{"name":"x","license":"y","license_url":"https://creativecommons.org/licenses/by-sa/3.0/"}}"#;
        assert!(validate_doc(cc).is_ok());
    }

    #[test]
    fn add_player_with_unknown_position_is_rejected() {
        let json = add_player_with("").replace("ADC", "Unknown");
        assert!(matches!(
            validate_doc(&json),
            Err(OverlayError::InvalidField {
                reason: "unknown position",
                ..
            })
        ));
    }

    #[test]
    fn add_player_with_bad_date_of_birth_is_rejected() {
        let json = add_player_with("").replace("2004-04-17", "someday");
        assert!(matches!(
            validate_doc(&json),
            Err(OverlayError::InvalidDate { .. })
        ));
    }

    #[test]
    fn add_player_attributes_and_potential_are_bounded_to_100() {
        assert!(validate_doc(&add_player_with(r#","attributes":{"mechanics":100,"laning":0,"macro_play":50,"consistency":50,"mental_resilience":50}"#)).is_ok());
        let over = add_player_with(
            r#","attributes":{"mechanics":101,"laning":0,"macro_play":50,"consistency":50,"mental_resilience":50}"#,
        );
        assert!(matches!(
            validate_doc(&over),
            Err(OverlayError::InvalidField { .. })
        ));
        let potential = add_player_with(r#","potential_base":200"#);
        assert!(matches!(
            validate_doc(&potential),
            Err(OverlayError::InvalidField { .. })
        ));
    }

    #[test]
    fn staff_attributes_are_bounded_to_100() {
        let staff = |attrs: &str| {
            doc(
                "2026-11-07",
                &format!(
                    r#","staff":[{{"op":"add","staff":{{"id":"s-new","role":"Coach","team_id":null,"attributes":{attrs}}}}}]"#
                ),
            )
        };
        assert!(validate_doc(&staff(r#"{"coaching":100}"#)).is_ok());
        assert!(validate_doc(&staff(r#"{"coaching":101}"#)).is_err());
    }

    #[test]
    fn profile_image_must_be_a_root_relative_asset_path() {
        for ok in ["", "/img/players/faker.webp", "/a/b_c-d.jpg"] {
            let json = add_player_with(&format!(r#","profile_image_url":"{ok}""#));
            assert!(validate_doc(&json).is_ok(), "{ok:?} should be accepted");
        }
        for bad in [
            "https://evil.example/x.png",
            "//evil.example/x.png",
            "/img/../secret.png",
            "img/x.png",
            "/img/x.svg",
            "/img/x.png?q=1",
            "javascript:alert(1).png",
        ] {
            let json = add_player_with(&format!(r#","profile_image_url":"{bad}""#));
            assert!(validate_doc(&json).is_err(), "{bad:?} must be rejected");
        }
        let staff = doc(
            "2026-11-07",
            r#","staff":[{"op":"add","staff":{"id":"s-new","role":"Coach","team_id":null,"profile_image_url":"https://evil.example/x.png"}}]"#,
        );
        assert!(validate_doc(&staff).is_err());
    }

    #[test]
    fn op_counts_are_bounded() {
        let ops = |n: usize| {
            let retire = r#"{"op":"retire","id":"p"}"#;
            doc(
                "2026-11-07",
                &format!(r#","players":[{}]"#, vec![retire; n].join(",")),
            )
        };
        assert!(validate_doc(&ops(5000)).is_ok());
        assert!(validate_doc(&ops(5001)).is_err());
        let staff_ops = format!(
            r#","staff":[{}]"#,
            vec![r#"{"op":"move","id":"s","team_id":null}"#; 5001].join(",")
        );
        assert!(validate_doc(&doc("2026-11-07", &staff_ops)).is_err());
    }

    #[test]
    fn long_strings_are_rejected() {
        let long = |n: usize| "a".repeat(n);
        let retire = |id: &str, evidence: &str| {
            doc(
                "2026-11-07",
                &format!(r#","players":[{{"op":"retire","id":"{id}","evidence":"{evidence}"}}]"#),
            )
        };
        assert!(validate_doc(&retire(&long(200), &long(500))).is_ok());
        assert!(validate_doc(&retire(&long(201), "")).is_err());
        assert!(validate_doc(&retire("p", &long(501))).is_err());
        let source = format!(
            r#"{{"schemaVersion":1,"as_of":"2026-11-07","source":{{"name":"{}","license":"y","license_url":"https://www.fandom.com/licensing"}}}}"#,
            long(1001)
        );
        assert!(validate_doc(&source).is_err());
        let name = add_player_with("").replace("New Guy", &long(201));
        assert!(validate_doc(&name).is_err());
    }

    #[test]
    fn bundled_overlay_parses_and_validates() {
        let bundled = bundled_world_overlay().expect("bundled overlay must be valid");
        assert_eq!(bundled.schema_version, SUPPORTED_SCHEMA_VERSION);
        assert_eq!(bundled.source.license, "CC BY-SA 3.0");
        assert!(bundled.validate().is_ok());
    }
}
