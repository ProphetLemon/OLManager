//! Custom club creation: a user-defined club that takes the place of an
//! existing regional team when a new game is built.
//!
//! Everything here is pure and works on an already assembled [`Game`]; callers
//! decide where in the world build it runs and whether the target competition
//! may host a custom club (see [`custom_team_allowed`]).

use std::fmt;

use chrono::Datelike;
use serde::{Deserialize, Serialize};
#[cfg(feature = "typescript")]
use ts_rs::TS;

use crate::competitions::is_selectable_competition;
use crate::domain::team::{Facilities, Team, TeamColors, TeamKind};
use crate::game::Game;
use crate::generator::definitions::CompetitionManifest;

/// Lowest tier (inclusive) whose competitions may host a custom club.
const MIN_CUSTOM_TEAM_TIER: u8 = 2;
/// Club name length bounds, in characters, after trimming.
const NAME_LEN: std::ops::RangeInclusive<usize> = 3..=30;
/// Short name length bounds, in characters.
const SHORT_NAME_LEN: std::ops::RangeInclusive<usize> = 3..=4;
/// Stadium capacity used when no peer reports one.
const FALLBACK_STADIUM_CAPACITY: u32 = 1_000;
/// Scrim reputation used when no peer reports one (the `Team` serde default).
const FALLBACK_SCRIM_REPUTATION: u8 = 50;

/// User input describing the custom club.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS))]
#[cfg_attr(feature = "typescript", ts(export))]
pub struct CustomTeamSpec {
    /// Full club name (3-30 characters).
    pub name: String,
    /// Short name (3-4 ASCII letters or digits, stored uppercase).
    pub short_name: String,
    /// Primary badge color as `#RRGGBB`.
    pub primary_color: String,
    /// Secondary badge color as `#RRGGBB`.
    pub secondary_color: String,
    /// Country code or name; must not be empty.
    pub country: String,
}

/// Why a custom club could not be created.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CustomTeamError {
    /// The name is not 3-30 characters after trimming.
    InvalidName,
    /// The short name is not 3-4 ASCII letters or digits.
    InvalidShortName,
    /// The given color is not `#RRGGBB`.
    InvalidColor(String),
    /// The country is empty.
    MissingCountry,
    /// Another team already uses this name (case-insensitive).
    DuplicateName,
    /// Another team already uses this short name (case-insensitive).
    DuplicateShortName,
    /// No team has the given id.
    ReplacedTeamNotFound(String),
    /// The replaced team does not belong to the requested competition.
    ReplacedTeamNotInCompetition,
    /// Only main clubs can be replaced, never academies.
    NotCustomizableTeamKind,
}

impl fmt::Display for CustomTeamError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidName => write!(f, "Club name must be 3 to 30 characters"),
            Self::InvalidShortName => {
                write!(f, "Short name must be 3 or 4 letters or digits")
            }
            Self::InvalidColor(color) => write!(f, "Invalid color '{color}', expected #RRGGBB"),
            Self::MissingCountry => write!(f, "Country is required"),
            Self::DuplicateName => write!(f, "Another team already uses this name"),
            Self::DuplicateShortName => write!(f, "Another team already uses this short name"),
            Self::ReplacedTeamNotFound(id) => write!(f, "Team '{id}' was not found"),
            Self::ReplacedTeamNotInCompetition => {
                write!(f, "The replaced team is not in this competition")
            }
            Self::NotCustomizableTeamKind => write!(f, "Only main clubs can be replaced"),
        }
    }
}

impl std::error::Error for CustomTeamError {}

impl From<CustomTeamError> for String {
    fn from(error: CustomTeamError) -> Self {
        error.to_string()
    }
}

/// Whether `manifest` may host a custom club: tier 2 or lower in the pyramid
/// and playable (active, not legacy, with a schedule). Keeps real top-tier
/// clubs out of reach.
pub fn custom_team_allowed(manifest: &CompetitionManifest) -> bool {
    manifest
        .tier
        .is_some_and(|tier| tier >= MIN_CUSTOM_TEAM_TIER)
        && is_selectable_competition(manifest)
}

/// Id of a custom club: `{competition_id}-custom-{slug}`, where the slug is the
/// lowercase ASCII alphanumerics of the short name. The competition prefix
/// keeps the id resolvable by `competition_id_from_team_id_known`.
pub fn custom_team_id(competition_id: &str, short_name: &str) -> String {
    let slug: String = short_name
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .map(|c| c.to_ascii_lowercase())
        .collect();
    format!("{competition_id}-custom-{slug}")
}

fn normalize_color(color: &str) -> Result<String, CustomTeamError> {
    let trimmed = color.trim();
    let digits = trimmed.strip_prefix('#').unwrap_or("");
    if digits.len() == 6 && digits.chars().all(|c| c.is_ascii_hexdigit()) {
        Ok(trimmed.to_ascii_lowercase())
    } else {
        Err(CustomTeamError::InvalidColor(color.to_string()))
    }
}

/// Validates `spec` and returns it normalized: trimmed name, uppercase short
/// name, lowercase `#rrggbb` colors, trimmed country.
///
/// `others` are the teams the club must be unique against (names compare
/// case-insensitively); academies are ignored. Callers leave the replaced club
/// out of `others`, so the new club may reuse its name.
pub fn validate_spec(
    spec: &CustomTeamSpec,
    others: &[&Team],
) -> Result<CustomTeamSpec, CustomTeamError> {
    let name = spec.name.trim();
    if !NAME_LEN.contains(&name.chars().count()) {
        return Err(CustomTeamError::InvalidName);
    }
    let short_name = spec.short_name.trim().to_ascii_uppercase();
    if !SHORT_NAME_LEN.contains(&short_name.chars().count())
        || !short_name.chars().all(|c| c.is_ascii_alphanumeric())
    {
        return Err(CustomTeamError::InvalidShortName);
    }
    let primary_color = normalize_color(&spec.primary_color)?;
    let secondary_color = normalize_color(&spec.secondary_color)?;
    let country = spec.country.trim();
    if country.is_empty() {
        return Err(CustomTeamError::MissingCountry);
    }

    let lowered_name = name.to_lowercase();
    let lowered_short = short_name.to_lowercase();
    let mut real_others = others
        .iter()
        .filter(|team| team.team_kind != TeamKind::Academy);
    if real_others
        .clone()
        .any(|team| team.name.trim().to_lowercase() == lowered_name)
    {
        return Err(CustomTeamError::DuplicateName);
    }
    if real_others.any(|team| team.short_name.trim().to_lowercase() == lowered_short) {
        return Err(CustomTeamError::DuplicateShortName);
    }

    Ok(CustomTeamSpec {
        name: name.to_string(),
        short_name,
        primary_color,
        secondary_color,
        country: country.to_string(),
    })
}

/// Percent-encodes like JavaScript's `encodeURIComponent`.
fn encode_uri_component(input: &str) -> String {
    let mut out = String::with_capacity(input.len() * 2);
    for byte in input.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            out.push(char::from(byte));
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

fn escape_xml(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Builds the club badge as a self-contained `data:image/svg+xml` URI.
///
/// The output must stay byte-identical to the TypeScript `buildBadgeDataUri`:
/// both are pinned by the same golden strings. Inputs are expected to be
/// validated (see [`validate_spec`]); XML escaping is a no-op for them.
pub fn badge_data_uri(short_name: &str, primary: &str, secondary: &str) -> String {
    let font_size = if short_name.chars().count() <= 3 {
        44
    } else {
        36
    };
    let primary = escape_xml(primary);
    let secondary = escape_xml(secondary);
    let text = escape_xml(short_name);
    let svg = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 128 128\">\
         <path d=\"M64 6L116 22V62C116 92 94 114 64 124C34 114 12 92 12 62V22Z\" \
         fill=\"{primary}\" stroke=\"{secondary}\" stroke-width=\"6\"/>\
         <text x=\"64\" y=\"78\" text-anchor=\"middle\" font-family=\"sans-serif\" \
         font-weight=\"800\" font-size=\"{font_size}\" fill=\"{secondary}\">{text}</text></svg>"
    );
    format!("data:image/svg+xml;utf8,{}", encode_uri_component(&svg))
}

/// Economy of a typical club in a league: the starting point for a club that
/// has no history of its own. Shared by custom clubs and promoted clubs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClubProfile {
    /// Cash on hand.
    pub finance: i64,
    /// Wage budget.
    pub wage_budget: i64,
    /// Transfer budget.
    pub transfer_budget: i64,
    /// Club reputation.
    pub reputation: u32,
    /// Stadium capacity.
    pub stadium_capacity: u32,
}

/// Median of the non-zero values, or `None` when there are none. An even count
/// yields the integer mean of the two middle values.
fn median_non_zero(values: impl Iterator<Item = i64>) -> Option<i64> {
    let mut sorted: Vec<i64> = values.filter(|value| *value != 0).collect();
    sorted.sort_unstable();
    let mid = sorted.len() / 2;
    match sorted.len() {
        0 => None,
        n if n % 2 == 1 => Some(sorted[mid]),
        _ => {
            let sum = i128::from(sorted[mid - 1]) + i128::from(sorted[mid]);
            i64::try_from(sum / 2).ok()
        }
    }
}

/// The league-median club economy, THE shared helper for "average club" starts.
///
/// Each field is the median of the peers' non-zero values (clubs that ship
/// without finance or reputation data must not drag the median to zero). An
/// even number of values yields the integer mean of the two middle ones. A
/// field with no non-zero value falls back to the `Team::new` default.
pub fn league_median_profile(peers: &[&Team]) -> ClubProfile {
    let defaults = Team::new(
        String::new(),
        String::new(),
        String::new(),
        String::new(),
        String::new(),
        String::new(),
        FALLBACK_STADIUM_CAPACITY,
    );
    let pick = |extract: fn(&Team) -> i64, fallback: i64| {
        median_non_zero(peers.iter().map(|team| extract(team))).unwrap_or(fallback)
    };
    ClubProfile {
        finance: pick(|t| t.finance, defaults.finance),
        wage_budget: pick(|t| t.wage_budget, defaults.wage_budget),
        transfer_budget: pick(|t| t.transfer_budget, defaults.transfer_budget),
        reputation: u32::try_from(pick(
            |t| i64::from(t.reputation),
            i64::from(defaults.reputation),
        ))
        .unwrap_or(defaults.reputation),
        stadium_capacity: u32::try_from(pick(
            |t| i64::from(t.stadium_capacity),
            i64::from(defaults.stadium_capacity),
        ))
        .unwrap_or(defaults.stadium_capacity),
    }
}

/// What [`replace_team_with_custom`] changed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CustomTeamOutcome {
    /// Id of the new club.
    pub team_id: String,
    /// Players of the replaced club that became free agents.
    pub released_player_ids: Vec<String>,
    /// Staff of the replaced club that became free agents.
    pub released_staff_ids: Vec<String>,
}

/// Replaces `replaces_team_id` with a new club built from `spec`.
///
/// Meant for world build time, before rosters are filled. The new club joins
/// `competition_id` with the league-median economy of its peers, a generated
/// badge and no sponsorship, matching its peers. The replaced club's players
/// and staff become teamless (their contracts are cleared later by the usual
/// free-agent pass) and are recorded in `moved_player_ids`; the replaced id is
/// recorded in `removed_team_ids` so catalog rehydration never restores it.
/// Academy links to the replaced club are cut on both sides.
pub fn replace_team_with_custom(
    game: &mut Game,
    competition_id: &str,
    replaces_team_id: &str,
    spec: &CustomTeamSpec,
) -> Result<CustomTeamOutcome, CustomTeamError> {
    let replaced = game
        .teams
        .iter()
        .find(|team| team.id == replaces_team_id)
        .ok_or_else(|| CustomTeamError::ReplacedTeamNotFound(replaces_team_id.to_string()))?;
    if replaced.team_kind != TeamKind::Main {
        return Err(CustomTeamError::NotCustomizableTeamKind);
    }
    if replaced.competition_id.as_deref() != Some(competition_id) {
        return Err(CustomTeamError::ReplacedTeamNotInCompetition);
    }

    let others: Vec<&Team> = game
        .teams
        .iter()
        .filter(|team| team.id != replaces_team_id && team.team_kind != TeamKind::Academy)
        .collect();
    let spec = validate_spec(spec, &others)?;

    let peers: Vec<&Team> = others
        .iter()
        .copied()
        .filter(|team| team.competition_id.as_deref() == Some(competition_id))
        .collect();
    let profile = league_median_profile(&peers);
    let scrim_reputation = median_non_zero(peers.iter().map(|t| i64::from(t.scrim_reputation)))
        .and_then(|value| u8::try_from(value).ok())
        .unwrap_or(FALLBACK_SCRIM_REPUTATION);

    let team_id = custom_team_id(competition_id, &spec.short_name);
    let mut team = Team::new(
        team_id.clone(),
        spec.name.clone(),
        spec.short_name.clone(),
        spec.country.clone(),
        String::new(),
        format!("{} Arena", spec.short_name),
        profile.stadium_capacity,
    );
    team.finance = profile.finance;
    team.wage_budget = profile.wage_budget;
    team.transfer_budget = profile.transfer_budget;
    team.reputation = profile.reputation;
    team.competition_id = Some(competition_id.to_string());
    team.logo_url = Some(badge_data_uri(
        &spec.short_name,
        &spec.primary_color,
        &spec.secondary_color,
    ));
    team.colors = TeamColors {
        primary: spec.primary_color.clone(),
        secondary: spec.secondary_color.clone(),
    };
    team.founded_year = u32::try_from(game.clock.current_date.year()).unwrap_or(team.founded_year);
    // Peers ship without sponsorship and with entry-level facilities.
    team.sponsorship = None;
    team.facilities = Facilities::default();
    team.scrim_reputation = scrim_reputation;

    let mut released_player_ids = Vec::new();
    for player in game
        .players
        .iter_mut()
        .filter(|p| p.team_id.as_deref() == Some(replaces_team_id))
    {
        player.team_id = None;
        released_player_ids.push(player.id.clone());
    }
    game.moved_player_ids
        .extend(released_player_ids.iter().cloned());

    let mut released_staff_ids = Vec::new();
    for member in game
        .staff
        .iter_mut()
        .filter(|s| s.team_id.as_deref() == Some(replaces_team_id))
    {
        member.team_id = None;
        released_staff_ids.push(member.id.clone());
    }

    for other in game.teams.iter_mut() {
        if other.parent_team_id.as_deref() == Some(replaces_team_id) {
            other.parent_team_id = None;
        }
        if other.academy_team_id.as_deref() == Some(replaces_team_id) {
            other.academy_team_id = None;
        }
    }

    game.teams.retain(|t| t.id != replaces_team_id);
    game.teams.push(team);
    if !game
        .removed_team_ids
        .iter()
        .any(|id| id == replaces_team_id)
    {
        game.removed_team_ids.push(replaces_team_id.to_string());
    }

    Ok(CustomTeamOutcome {
        team_id,
        released_player_ids,
        released_staff_ids,
    })
}
