//! Main-repo override layer for competition manifests.
//!
//! The `data/` submodule is read-only from this repository, yet some tier-2
//! manifests (for example LES) ship with a placeholder schedule. The bundled
//! `assets/world/competition-overrides.json` lets this repository patch a
//! manifest's `tier`, `active`, `legacy` and `schedule` after it is parsed.
//!
//! Wire format (version 1):
//!
//! ```json
//! { "version": 1, "competitions": { "<id>": { "tier": 2, "active": true,
//!   "legacy": false, "schedule": { ... } } } }
//! ```
//!
//! A present `schedule` replaces the manifest schedule wholesale. The file is
//! embedded with `include_str!` (like the roster overlay), so it needs no
//! resource plumbing and no signature. At runtime invalid entries are logged
//! and skipped; a test validates the bundled file against the scanned data.

use crate::generator::definitions::{CompetitionManifest, ScheduleConfig};
use log::warn;
use serde::Deserialize;
use std::collections::BTreeMap;
use std::sync::OnceLock;

pub const SUPPORTED_VERSION: u64 = 1;

const BUNDLED_OVERRIDES_JSON: &str =
    include_str!("../../../../assets/world/competition-overrides.json");

/// Fields a main-repo entry may override. Absent fields keep the manifest value.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CompetitionOverride {
    #[serde(default)]
    pub tier: Option<u8>,
    #[serde(default)]
    pub active: Option<bool>,
    #[serde(default)]
    pub legacy: Option<bool>,
    #[serde(default)]
    pub schedule: Option<ScheduleConfig>,
}

/// Parsed overrides plus the entries that could not be parsed.
#[derive(Debug, Clone, Default)]
pub struct CompetitionOverrides {
    entries: BTreeMap<String, CompetitionOverride>,
    parse_errors: Vec<String>,
}

#[derive(Deserialize)]
struct RawFile {
    version: Option<u64>,
    #[serde(default)]
    competitions: BTreeMap<String, serde_json::Value>,
}

impl CompetitionOverrides {
    /// Parse an overrides document. A wrong version or malformed top level
    /// rejects the whole file; a malformed entry is recorded in `parse_errors`.
    pub fn parse(json: &str) -> Result<Self, String> {
        let raw: RawFile =
            serde_json::from_str(json).map_err(|e| format!("invalid overrides JSON: {e}"))?;
        if raw.version != Some(SUPPORTED_VERSION) {
            return Err(format!(
                "unsupported overrides version {:?} (expected {SUPPORTED_VERSION})",
                raw.version
            ));
        }
        let mut out = Self::default();
        for (id, value) in raw.competitions {
            match serde_json::from_value::<CompetitionOverride>(value) {
                Ok(entry) => {
                    out.entries.insert(id, entry);
                }
                Err(e) => out.parse_errors.push(format!("override '{id}': {e}")),
            }
        }
        Ok(out)
    }

    /// Every problem found against the scanned manifests: parse errors,
    /// unknown ids and invalid entries. Empty means the file is sound.
    pub fn validate(&self, manifests: &[CompetitionManifest]) -> Vec<String> {
        let mut problems = self.parse_errors.clone();
        for (id, entry) in &self.entries {
            if !manifests.iter().any(|m| &m.id == id) {
                problems.push(format!("override '{id}': unknown competition id"));
            } else if let Err(e) = validate_entry(entry) {
                problems.push(format!("override '{id}': {e}"));
            }
        }
        problems
    }

    /// Apply the matching entry to one manifest. An invalid entry is logged and
    /// leaves the manifest untouched. Returns whether anything was applied.
    pub fn apply(&self, manifest: &mut CompetitionManifest) -> bool {
        let Some(entry) = self.entries.get(&manifest.id) else {
            return false;
        };
        if let Err(e) = validate_entry(entry) {
            warn!(
                "[competition-overrides] ignoring override '{}': {e}",
                manifest.id
            );
            return false;
        }
        if let Some(tier) = entry.tier {
            manifest.tier = Some(tier);
        }
        if let Some(active) = entry.active {
            manifest.active = active;
        }
        if let Some(legacy) = entry.legacy {
            manifest.legacy = legacy;
        }
        if let Some(schedule) = &entry.schedule {
            manifest.schedule = schedule.clone();
        }
        true
    }

    /// Apply overrides to a scanned set, warning about unknown ids and bad entries.
    pub fn apply_all(&self, manifests: &mut [CompetitionManifest]) {
        for message in &self.parse_errors {
            warn!("[competition-overrides] ignoring {message}");
        }
        for id in self.entries.keys() {
            if !manifests.iter().any(|m| &m.id == id) {
                warn!("[competition-overrides] ignoring override for unknown competition '{id}'");
            }
        }
        for manifest in manifests.iter_mut() {
            self.apply(manifest);
        }
    }
}

fn validate_entry(entry: &CompetitionOverride) -> Result<(), String> {
    if entry.tier.is_none()
        && entry.active.is_none()
        && entry.legacy.is_none()
        && entry.schedule.is_none()
    {
        return Err("entry overrides nothing".to_string());
    }
    if entry.tier == Some(0) {
        return Err("tier must be at least 1".to_string());
    }
    match &entry.schedule {
        Some(schedule) => validate_schedule(schedule),
        None => Ok(()),
    }
}

fn validate_schedule(schedule: &ScheduleConfig) -> Result<(), String> {
    if schedule.format.trim().is_empty() || schedule.format == "unknown" {
        return Err("schedule.format must be a known format".to_string());
    }
    if schedule.team_count < 2 {
        return Err("schedule.team_count must be at least 2".to_string());
    }
    if schedule.splits.is_empty() {
        return Err("schedule.splits must not be empty".to_string());
    }
    for split in &schedule.splits {
        if split.name.trim().is_empty() {
            return Err("split name must not be empty".to_string());
        }
        if split.best_of == 0 {
            return Err(format!("split '{}' best_of must be at least 1", split.name));
        }
        let start = &split.season_start;
        if !(1..=12).contains(&start.month) || !(1..=31).contains(&start.day) {
            return Err(format!(
                "split '{}' has an invalid season_start",
                split.name
            ));
        }
        if let Some(playoffs) = &split.playoffs {
            if playoffs.teams < 2 || playoffs.teams > schedule.team_count {
                return Err(format!(
                    "split '{}' has an invalid playoffs.teams",
                    split.name
                ));
            }
        }
    }
    Ok(())
}

/// The overrides bundled in the binary. A broken bundle logs once and yields no overrides.
pub fn bundled() -> &'static CompetitionOverrides {
    static BUNDLED: OnceLock<CompetitionOverrides> = OnceLock::new();
    BUNDLED.get_or_init(|| {
        CompetitionOverrides::parse(BUNDLED_OVERRIDES_JSON).unwrap_or_else(|e| {
            warn!("[competition-overrides] ignoring bundled overrides: {e}");
            CompetitionOverrides::default()
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(id: &str) -> CompetitionManifest {
        serde_json::from_str(&format!(
            r#"{{"id":"{id}","name":"X","region":"R","tier":2,"active":false,
                "schedule":{{"format":"unknown","team_count":0,"splits":[]}}}}"#
        ))
        .expect("manifest parses")
    }

    const SCHEDULE: &str = r#""schedule":{"format":"double_round_robin","team_count":8,
        "splits":[{"name":"Spring","best_of":3,"season_start":{"month":2,"day":1}}]}"#;

    fn overrides(entry: &str) -> CompetitionOverrides {
        CompetitionOverrides::parse(&format!(
            r#"{{"version":1,"competitions":{{"les":{{{entry}}}}}}}"#
        ))
        .expect("overrides parse")
    }

    #[test]
    fn override_replaces_schedule_wholesale() {
        let mut m = manifest("les");
        assert!(overrides(SCHEDULE).apply(&mut m));
        assert_eq!(m.schedule.format, "double_round_robin");
        assert_eq!(m.schedule.team_count, 8);
        assert_eq!(m.schedule.splits.len(), 1);
    }

    #[test]
    fn override_changes_tier_active_and_legacy_only() {
        let mut m = manifest("les");
        assert!(overrides(r#""tier":1,"active":true,"legacy":true"#).apply(&mut m));
        assert_eq!(m.tier, Some(1));
        assert!(m.active && m.legacy);
        assert_eq!(m.schedule.format, "unknown");
    }

    #[test]
    fn validation_rejects_unknown_competition_id() {
        let o = CompetitionOverrides::parse(r#"{"version":1,"competitions":{"nope":{"tier":1}}}"#)
            .unwrap();
        let problems = o.validate(&[manifest("les")]);
        assert_eq!(problems.len(), 1);
        assert!(problems[0].contains("unknown competition id"));
    }

    #[test]
    fn validation_rejects_invalid_schedule_and_apply_ignores_it() {
        let o =
            overrides(r#""schedule":{"format":"double_round_robin","team_count":8,"splits":[]}"#);
        let mut m = manifest("les");
        assert_eq!(o.validate(&[m.clone()]).len(), 1);
        assert!(!o.apply(&mut m));
        assert_eq!(m.schedule.format, "unknown");
    }

    #[test]
    fn validation_reports_unparseable_entries() {
        let o = CompetitionOverrides::parse(r#"{"version":1,"competitions":{"les":{"bogus":1}}}"#)
            .unwrap();
        assert_eq!(o.validate(&[manifest("les")]).len(), 1);
    }

    #[test]
    fn wrong_version_is_rejected() {
        assert!(CompetitionOverrides::parse(r#"{"version":2,"competitions":{}}"#).is_err());
        assert!(CompetitionOverrides::parse(r#"{"competitions":{}}"#).is_err());
    }

    #[test]
    fn empty_overrides_leave_manifests_byte_identical() {
        let o = CompetitionOverrides::parse(r#"{"version":1,"competitions":{}}"#).unwrap();
        let original = manifest("les");
        let mut patched = vec![original.clone()];
        o.apply_all(&mut patched);
        assert_eq!(
            serde_json::to_string(&original).unwrap(),
            serde_json::to_string(&patched[0]).unwrap()
        );
    }

    #[test]
    fn bundled_overrides_are_valid_against_scanned_competitions() {
        let base =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../data/competitions");
        let manifests = crate::competitions::scan_raw_competitions(&base);
        assert!(!manifests.is_empty(), "data/competitions must be present");
        let parsed = CompetitionOverrides::parse(BUNDLED_OVERRIDES_JSON).expect("bundled parses");
        assert_eq!(parsed.validate(&manifests), Vec::<String>::new());
    }
}
