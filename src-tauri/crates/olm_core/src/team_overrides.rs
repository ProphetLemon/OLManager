//! Main-repo override layer for team metadata.
//!
//! The `data/` submodule is read-only from this repository, yet a few teams
//! (for example GiantX Itero and UB Alma Mater in the LES) ship without
//! country, reputation or finances. A team with a zero `wage_budget` is skipped
//! by `wage_scale::seed_missing_wages`, so its players would keep wage 0. The
//! bundled `assets/world/team-overrides.json` fills those gaps.
//!
//! Wire format (version 1), keyed by the FINAL team id (the competition prefix
//! is already applied, for example `les-team-854f6893`):
//!
//! ```json
//! { "version": 1, "teams": { "<team id>": { "country": "ES", "city": "Madrid",
//!   "reputation": 315, "finance": 1960000, "wage_budget": 980000,
//!   "transfer_budget": 392000 } } }
//! ```
//!
//! The layer only FILLS: a field is written when the team's value is empty or
//! zero (for `team_kind`, when it is still the default `Main`). Data that is
//! already present is never overwritten. At runtime invalid entries and unknown
//! ids are logged and skipped; a test validates the bundled file against the
//! real data.

use crate::domain::team::{Team, TeamKind};
use log::warn;
use serde::Deserialize;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::OnceLock;

/// Overrides file version this build understands.
pub const SUPPORTED_VERSION: u64 = 1;

const BUNDLED_OVERRIDES_JSON: &str = include_str!("../../../../assets/world/team-overrides.json");

/// Metadata a main-repo entry may fill. Absent fields are left alone.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TeamOverride {
    /// Country code, filled when the team's is empty.
    #[serde(default)]
    pub country: Option<String>,
    /// City, filled when the team's is empty.
    #[serde(default)]
    pub city: Option<String>,
    /// Reputation, filled when the team's is 0.
    #[serde(default)]
    pub reputation: Option<u32>,
    /// Cash on hand, filled when the team's is 0.
    #[serde(default)]
    pub finance: Option<i64>,
    /// Annual wage budget, filled when the team's is 0.
    #[serde(default)]
    pub wage_budget: Option<i64>,
    /// Transfer budget, filled when the team's is 0.
    #[serde(default)]
    pub transfer_budget: Option<i64>,
    /// Club kind, filled when the team is still the default `Main`.
    #[serde(default)]
    pub team_kind: Option<TeamKind>,
}

impl TeamOverride {
    /// Reasons this entry cannot be applied; empty when it is valid.
    fn problems(&self) -> Vec<&'static str> {
        let mut out = Vec::new();
        let blank = |s: &Option<String>| s.as_deref().is_some_and(|v| v.trim().is_empty());
        if blank(&self.country) || blank(&self.city) {
            out.push("country and city must not be blank");
        }
        if [self.finance, self.wage_budget, self.transfer_budget]
            .iter()
            .flatten()
            .any(|v| *v < 0)
        {
            out.push("finance and budgets must not be negative");
        }
        if *self == TeamOverride::default() {
            out.push("entry sets no field");
        }
        out
    }

    /// Fill the empty or zero fields of `team`; returns true when anything changed.
    fn fill(&self, team: &mut Team) -> bool {
        let mut changed = false;
        if let Some(country) = &self.country
            && team.country.is_empty()
        {
            team.country.clone_from(country);
            changed = true;
        }
        if let Some(city) = &self.city
            && team.city.is_empty()
        {
            team.city.clone_from(city);
            changed = true;
        }
        if let Some(reputation) = self.reputation
            && team.reputation == 0
            && reputation != 0
        {
            team.reputation = reputation;
            changed = true;
        }
        for (value, slot) in [
            (self.finance, &mut team.finance),
            (self.wage_budget, &mut team.wage_budget),
            (self.transfer_budget, &mut team.transfer_budget),
        ] {
            if let Some(value) = value
                && *slot == 0
                && value != 0
            {
                *slot = value;
                changed = true;
            }
        }
        if let Some(kind) = &self.team_kind
            && team.team_kind == TeamKind::Main
            && *kind != TeamKind::Main
        {
            team.team_kind = kind.clone();
            changed = true;
        }
        changed
    }
}

/// Parsed overrides plus the entries that could not be parsed.
#[derive(Debug, Clone, Default)]
pub struct TeamOverrides {
    entries: BTreeMap<String, TeamOverride>,
    parse_errors: Vec<String>,
}

#[derive(Deserialize)]
struct RawFile {
    version: Option<u64>,
    #[serde(default)]
    teams: BTreeMap<String, serde_json::Value>,
}

impl TeamOverrides {
    /// Parse an overrides document. A wrong version or malformed top level
    /// rejects the whole file; a malformed entry is recorded in `parse_errors`.
    pub fn parse(json: &str) -> Result<Self, String> {
        let raw: RawFile =
            serde_json::from_str(json).map_err(|e| format!("invalid team overrides JSON: {e}"))?;
        if raw.version != Some(SUPPORTED_VERSION) {
            return Err(format!(
                "unsupported team overrides version {:?} (expected {SUPPORTED_VERSION})",
                raw.version
            ));
        }
        let mut out = Self::default();
        for (id, value) in raw.teams {
            match serde_json::from_value::<TeamOverride>(value) {
                Ok(entry) => {
                    out.entries.insert(id, entry);
                }
                Err(e) => out.parse_errors.push(format!("team '{id}': {e}")),
            }
        }
        Ok(out)
    }

    /// Problems with the document against the known team ids: unparseable
    /// entries, invalid entries and ids that match no team.
    pub fn validate<'a>(&self, team_ids: impl IntoIterator<Item = &'a str>) -> Vec<String> {
        let known: BTreeSet<&str> = team_ids.into_iter().collect();
        let mut problems = self.parse_errors.clone();
        for (id, entry) in &self.entries {
            if !known.contains(id.as_str()) {
                problems.push(format!("team '{id}': unknown team id"));
            }
            problems.extend(
                entry
                    .problems()
                    .into_iter()
                    .map(|p| format!("team '{id}': {p}")),
            );
        }
        problems
    }

    /// Fill `teams` from the valid entries. Invalid entries and unknown ids are
    /// logged and skipped. Returns how many teams changed.
    pub fn apply_all(&self, teams: &mut [Team]) -> usize {
        for error in &self.parse_errors {
            warn!("[team-overrides] skipping unparseable entry: {error}");
        }
        let mut changed = 0;
        for (id, entry) in &self.entries {
            let problems = entry.problems();
            if !problems.is_empty() {
                warn!("[team-overrides] skipping '{id}': {}", problems.join("; "));
                continue;
            }
            let Some(team) = teams.iter_mut().find(|t| &t.id == id) else {
                warn!("[team-overrides] skipping '{id}': unknown team id");
                continue;
            };
            if entry.fill(team) {
                changed += 1;
            }
        }
        changed
    }
}

/// The overrides bundled in the binary. A broken bundle logs once and yields no overrides.
pub fn bundled() -> &'static TeamOverrides {
    static BUNDLED: OnceLock<TeamOverrides> = OnceLock::new();
    BUNDLED.get_or_init(|| {
        TeamOverrides::parse(BUNDLED_OVERRIDES_JSON).unwrap_or_else(|e| {
            warn!("[team-overrides] ignoring bundled overrides: {e}");
            TeamOverrides::default()
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A team as the data files ship the gaps: `Team::new` seeds defaults, the
    /// data deserialises missing fields to empty or zero.
    fn team(id: &str) -> Team {
        let mut team = Team::new(
            id.to_string(),
            id.to_string(),
            id.to_string(),
            String::new(),
            String::new(),
            String::new(),
            0,
        );
        team.reputation = 0;
        team.finance = 0;
        team.wage_budget = 0;
        team.transfer_budget = 0;
        team
    }

    fn overrides(entry: &str) -> TeamOverrides {
        TeamOverrides::parse(&format!(r#"{{"version":1,"teams":{{"t1":{entry}}}}}"#))
            .expect("parses")
    }

    const FULL: &str = r#"{"country":"ES","city":"Madrid","reputation":315,"finance":100,
        "wage_budget":50,"transfer_budget":20}"#;

    #[test]
    fn fills_empty_and_zero_fields() {
        let mut teams = vec![team("t1")];
        assert_eq!(overrides(FULL).apply_all(&mut teams), 1);
        let t = &teams[0];
        assert_eq!((t.country.as_str(), t.city.as_str()), ("ES", "Madrid"));
        assert_eq!(
            (t.reputation, t.finance, t.wage_budget, t.transfer_budget),
            (315, 100, 50, 20)
        );
    }

    #[test]
    fn never_overwrites_present_data() {
        let mut t = team("t1");
        t.country = "FR".into();
        t.city = "Paris".into();
        t.reputation = 200;
        t.finance = 7;
        t.wage_budget = 3;
        t.transfer_budget = 1;
        let mut teams = vec![t];
        assert_eq!(overrides(FULL).apply_all(&mut teams), 0);
        let t = &teams[0];
        assert_eq!((t.country.as_str(), t.city.as_str()), ("FR", "Paris"));
        assert_eq!(
            (t.reputation, t.finance, t.wage_budget, t.transfer_budget),
            (200, 7, 3, 1)
        );
    }

    #[test]
    fn fills_only_the_missing_field_of_a_partial_team() {
        let mut t = team("t1");
        t.country = "FR".into();
        let mut teams = vec![t];
        overrides(r#"{"country":"ES","wage_budget":50}"#).apply_all(&mut teams);
        assert_eq!(teams[0].country, "FR");
        assert_eq!(teams[0].wage_budget, 50);
    }

    #[test]
    fn team_kind_only_replaces_the_default() {
        let mut teams = vec![team("t1")];
        overrides(r#"{"team_kind":"Academy"}"#).apply_all(&mut teams);
        assert_eq!(teams[0].team_kind, TeamKind::Academy);
    }

    #[test]
    fn unknown_ids_and_invalid_entries_are_skipped_without_touching_teams() {
        let o = TeamOverrides::parse(
            r#"{"version":1,"teams":{"ghost":{"country":"ES"},
                "t1":{"finance":-5},"t2":{"bogus":1}}}"#,
        )
        .unwrap();
        let mut teams = vec![team("t1")];
        assert_eq!(o.apply_all(&mut teams), 0);
        assert_eq!(teams[0].finance, 0);
        assert_eq!(o.validate(["t1"]).len(), 3);
    }

    #[test]
    fn wrong_version_is_rejected() {
        assert!(TeamOverrides::parse(r#"{"version":2,"teams":{}}"#).is_err());
        assert!(TeamOverrides::parse(r#"{"teams":{}}"#).is_err());
    }

    #[test]
    fn bundled_overrides_reference_real_teams() {
        let data = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../data");
        let manifests = crate::competitions::scan_raw_competitions(&data.join("competitions"));
        assert!(!manifests.is_empty(), "data/competitions must be present");
        let mut ids = Vec::new();
        for manifest in manifests.iter().filter(|m| !m.legacy) {
            let Ok(teams) = crate::competitions::load_teams(&data, manifest) else {
                continue;
            };
            let prefix = format!("{}-", manifest.id);
            ids.extend(teams.into_iter().map(|t| {
                if t.id.starts_with(&prefix) {
                    t.id
                } else {
                    format!("{prefix}{}", t.id)
                }
            }));
        }
        let parsed = TeamOverrides::parse(BUNDLED_OVERRIDES_JSON).expect("bundled parses");
        assert_eq!(
            parsed.validate(ids.iter().map(String::as_str)),
            Vec::<String>::new()
        );
    }
}
