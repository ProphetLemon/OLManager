//! Stat-derived rating overrides for the players of a new world.
//!
//! The authored attributes in `data/players` have no documented criterion, so a
//! few players sit far below their league. The offline pipeline in
//! `scripts/stats` blends the authored values with an estimate built from real
//! Leaguepedia per-game stats (CC BY-SA 3.0) and writes the result to the bundled
//! `assets/world/player-rating-overrides.json`. League levels stay as authored:
//! stats only place a player inside his league.
//!
//! Wire format (version 1, `deny_unknown_fields` everywhere):
//!
//! ```json
//! { "version": 1, "method": "stat-blend-v1", "source": "...",
//!   "window": { "since": "2025-01-01", "until": "2026-11-01" },
//!   "league_levels": { "<competition id>": { "median": 80.0, "sd": 3.5 } },
//!   "entries": [ { "id": "<player id>", "authored_ovr": 71, "games": 60,
//!     "confidence": 0.8, "attributes": { "mechanics": 70, "laning": 70,
//!     "teamfighting": 70, "macro_play": 70, "consistency": 70, "shotcalling": 70,
//!     "champion_pool": 70, "discipline": 70, "mental_resilience": 70 },
//!     "potential_floor": 72 } ] }
//! ```
//!
//! Each entry carries `authored_ovr` as a guard: it is applied only while the
//! player's current OVR still equals it, so an entry generated against older data
//! is skipped (and reported) instead of overwriting a newer rating. Invalid
//! entries are logged and skipped; they never fail the world build. Wages are
//! never touched. Existing saves are not affected: the pass only runs when a new
//! world is assembled.

use crate::domain::player::{Player, PlayerAttributes};
use crate::game_setup::{has_placeholder_market_value, suggested_seed_market_value};
use crate::potential::calculate_lol_ovr;
use log::warn;
use serde::Deserialize;
use std::collections::{BTreeMap, HashSet};
use std::sync::OnceLock;

/// Overrides file version this build understands.
pub const SUPPORTED_VERSION: u64 = 1;

/// Entries backed by fewer raw games than this are reported as low confidence.
pub const LOW_CONFIDENCE_GAMES: u32 = 25;

const BUNDLED_OVERRIDES_JSON: &str =
    include_str!("../../../../assets/world/player-rating-overrides.json");

/// Why an overrides document was rejected as a whole.
#[derive(Debug, thiserror::Error)]
pub enum PlayerRatingOverridesError {
    /// The document is not valid JSON or has an unknown or missing top-level field.
    #[error("invalid player rating overrides JSON: {0}")]
    Json(#[from] serde_json::Error),
    /// The document declares a version this build does not understand.
    #[error("unsupported player rating overrides version {found} (expected {SUPPORTED_VERSION})")]
    UnsupportedVersion {
        /// Version found in the document.
        found: u64,
    },
}

/// Date window of the stats an asset was built from.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StatsWindow {
    /// First day of the window, `YYYY-MM-DD`.
    pub since: String,
    /// Last day of the window, `YYYY-MM-DD`.
    pub until: String,
}

/// Authored level of a league the stat blend was anchored to.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LeagueLevel {
    /// Median OVR of the league.
    pub median: f64,
    /// Standard deviation of OVR inside the league.
    pub sd: f64,
}

/// The nine rating attributes an entry sets.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OverrideAttributes {
    /// Mechanical skill.
    pub mechanics: u8,
    /// Lane phase skill.
    pub laning: u8,
    /// Teamfight performance.
    pub teamfighting: u8,
    /// Macro and map awareness.
    pub macro_play: u8,
    /// Consistency.
    pub consistency: u8,
    /// Shotcalling.
    pub shotcalling: u8,
    /// Champion pool.
    pub champion_pool: u8,
    /// Discipline.
    pub discipline: u8,
    /// Mental resilience.
    pub mental_resilience: u8,
}

impl OverrideAttributes {
    fn to_array(&self) -> [u8; 9] {
        [
            self.mechanics,
            self.laning,
            self.teamfighting,
            self.macro_play,
            self.consistency,
            self.shotcalling,
            self.champion_pool,
            self.discipline,
            self.mental_resilience,
        ]
    }
}

/// One player's stat-derived rating.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlayerRatingOverride {
    /// Game player id.
    pub id: String,
    /// OVR of the authored attributes; the staleness guard.
    pub authored_ovr: u8,
    /// Raw games behind the estimate.
    pub games: u32,
    /// Blend weight of the stat estimate, in `[0, 1]`.
    pub confidence: f64,
    /// Attributes to write.
    pub attributes: OverrideAttributes,
    /// Lowest `potential_base` the player keeps.
    pub potential_floor: u8,
}

impl PlayerRatingOverride {
    /// Reasons this entry cannot be applied; empty when it is valid.
    fn problems(&self) -> Vec<&'static str> {
        let mut out = Vec::new();
        if self.id.trim().is_empty() {
            out.push("id must not be blank");
        }
        if self
            .attributes
            .to_array()
            .iter()
            .any(|v| !(1..=99).contains(v))
        {
            out.push("attributes must be within 1..=99");
        }
        if !(1..=99).contains(&self.potential_floor) {
            out.push("potential_floor must be within 1..=99");
        }
        if !(1..=99).contains(&self.authored_ovr) {
            out.push("authored_ovr must be within 1..=99");
        }
        if !(0.0..=1.0).contains(&self.confidence) {
            out.push("confidence must be within 0..=1");
        }
        out
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawFile {
    version: u64,
    method: String,
    source: String,
    window: StatsWindow,
    league_levels: BTreeMap<String, LeagueLevel>,
    entries: Vec<serde_json::Value>,
}

/// A parsed overrides document: header metadata plus the valid entries by id.
#[derive(Debug, Clone, Default)]
pub struct PlayerRatingOverrides {
    method: String,
    source: String,
    window: Option<StatsWindow>,
    league_levels: BTreeMap<String, LeagueLevel>,
    entries: BTreeMap<String, PlayerRatingOverride>,
    skipped_entries: Vec<String>,
}

impl PlayerRatingOverrides {
    /// Parse an overrides document. A wrong version, an unknown field or a
    /// malformed top level rejects the whole file; a malformed, invalid or
    /// duplicate entry is logged, recorded in [`Self::skipped_entries`] and
    /// skipped.
    pub fn parse(json: &str) -> Result<Self, PlayerRatingOverridesError> {
        let raw: RawFile = serde_json::from_str(json)?;
        if raw.version != SUPPORTED_VERSION {
            return Err(PlayerRatingOverridesError::UnsupportedVersion { found: raw.version });
        }
        let mut out = Self {
            method: raw.method,
            source: raw.source,
            window: Some(raw.window),
            league_levels: raw.league_levels,
            ..Self::default()
        };
        for (index, value) in raw.entries.into_iter().enumerate() {
            let entry = match serde_json::from_value::<PlayerRatingOverride>(value) {
                Ok(entry) => entry,
                Err(e) => {
                    out.skip(format!("entry #{index}: {e}"));
                    continue;
                }
            };
            let problems = entry.problems();
            if !problems.is_empty() {
                out.skip(format!("entry '{}': {}", entry.id, problems.join("; ")));
            } else if out.entries.contains_key(&entry.id) {
                out.skip(format!("entry '{}': duplicate id", entry.id));
            } else {
                out.entries.insert(entry.id.clone(), entry);
            }
        }
        Ok(out)
    }

    fn skip(&mut self, message: String) {
        warn!("[player-rating-overrides] skipping {message}");
        self.skipped_entries.push(message);
    }

    /// Method label of the asset, for example `stat-blend-v1`.
    pub fn method(&self) -> &str {
        &self.method
    }

    /// Attribution of the data the asset was derived from.
    pub fn source(&self) -> &str {
        &self.source
    }

    /// Date window of the stats, when the document declared one.
    pub fn window(&self) -> Option<&StatsWindow> {
        self.window.as_ref()
    }

    /// Authored league levels the blend was anchored to, by competition id.
    pub fn league_levels(&self) -> &BTreeMap<String, LeagueLevel> {
        &self.league_levels
    }

    /// Number of valid entries.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// True when there are no valid entries.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// The valid entry for a player id.
    pub fn entry(&self, id: &str) -> Option<&PlayerRatingOverride> {
        self.entries.get(id)
    }

    /// Messages for every entry that was skipped while parsing.
    pub fn skipped_entries(&self) -> &[String] {
        &self.skipped_entries
    }
}

/// What [`apply_player_rating_overrides`] did.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ApplyReport {
    /// Players whose rating was replaced.
    pub applied: usize,
    /// Entries skipped because the player's OVR no longer equals `authored_ovr`.
    pub skipped_stale: usize,
    /// In-scope entries whose player is not in the world.
    pub skipped_missing: usize,
    /// Applied players backed by fewer than [`LOW_CONFIDENCE_GAMES`] games.
    pub low_confidence_ids: HashSet<String>,
}

/// The overrides bundled in the binary. A broken bundle logs once and yields no overrides.
pub fn bundled() -> &'static PlayerRatingOverrides {
    static BUNDLED: OnceLock<PlayerRatingOverrides> = OnceLock::new();
    BUNDLED.get_or_init(|| {
        PlayerRatingOverrides::parse(BUNDLED_OVERRIDES_JSON).unwrap_or_else(|e| {
            warn!("[player-rating-overrides] ignoring bundled overrides: {e}");
            PlayerRatingOverrides::default()
        })
    })
}

/// Replace the ratings of the players `overrides` lists.
///
/// `ids` restricts the pass to a subset of entries (used for players an overlay
/// added after the first pass); `None` considers every entry. An entry is applied
/// only when the player's current OVR equals `authored_ovr`. Applying sets the
/// nine attributes and `lol_ovr`, raises `potential_base` to at least the entry's
/// floor and the new OVR, lifts a lower `potential_revealed` to the new OVR, and
/// clears `market_value` when it was 0, a placeholder or the seeded formula value
/// of the old rating, so `apply_default_market_values` recomputes it from the new
/// OVR. Authored real market values and every wage are kept.
pub fn apply_player_rating_overrides(
    players: &mut [Player],
    overrides: &PlayerRatingOverrides,
    ids: Option<&HashSet<String>>,
) -> ApplyReport {
    let mut report = ApplyReport::default();
    let mut seen: HashSet<&str> = HashSet::new();
    for player in players.iter_mut() {
        if ids.is_some_and(|ids| !ids.contains(&player.id)) {
            continue;
        }
        let Some(entry) = overrides.entry(&player.id) else {
            continue;
        };
        seen.insert(entry.id.as_str());
        if calculate_lol_ovr(player) != entry.authored_ovr {
            warn!(
                "[player-rating-overrides] stale entry '{}': OVR is {}, entry was built for {}",
                entry.id,
                calculate_lol_ovr(player),
                entry.authored_ovr
            );
            report.skipped_stale += 1;
            continue;
        }
        apply_entry(player, entry);
        report.applied += 1;
        if entry.games < LOW_CONFIDENCE_GAMES {
            report.low_confidence_ids.insert(entry.id.clone());
        }
    }
    report.skipped_missing = overrides
        .entries
        .keys()
        .filter(|id| ids.is_none_or(|ids| ids.contains(id.as_str())))
        .filter(|id| !seen.contains(id.as_str()))
        .count();
    report
}

/// True when the market value is one the seed would have computed from the old
/// rating (or a placeholder), so the default pass may recompute it.
fn market_value_is_derived(player: &Player, old_ovr: u8) -> bool {
    let old_potential = player.potential_base.max(old_ovr);
    player.market_value == 0
        || has_placeholder_market_value(player)
        || player.market_value == suggested_seed_market_value(old_ovr, old_potential, false)
        || player.market_value == suggested_seed_market_value(old_ovr, old_potential, true)
}

fn apply_entry(player: &mut Player, entry: &PlayerRatingOverride) {
    let old_ovr = calculate_lol_ovr(player);
    let reset_market_value = market_value_is_derived(player, old_ovr);

    player.attributes = PlayerAttributes::from_array(entry.attributes.to_array());
    let new_ovr = calculate_lol_ovr(player);
    player.lol_ovr = new_ovr;
    player.potential_base = player
        .potential_base
        .max(entry.potential_floor)
        .max(new_ovr);
    if let Some(revealed) = player.potential_revealed.as_mut()
        && *revealed < new_ovr
    {
        *revealed = new_ovr;
    }
    if reset_market_value {
        player.market_value = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::stats::LolRole;

    fn attrs(value: u8) -> PlayerAttributes {
        PlayerAttributes::from_array([value; 9])
    }

    fn player(id: &str, value: u8) -> Player {
        let mut p = Player::new(
            id.to_string(),
            id.to_string(),
            id.to_string(),
            "2000-01-01".to_string(),
            "BR".to_string(),
            LolRole::Top,
            attrs(value),
        );
        p.lol_ovr = calculate_lol_ovr(&p);
        p
    }

    fn entry_json(id: &str, authored_ovr: u8, games: u32, value: u8, floor: u8) -> String {
        format!(
            r#"{{"id":"{id}","authored_ovr":{authored_ovr},"games":{games},"confidence":0.8,
            "attributes":{{"mechanics":{value},"laning":{value},"teamfighting":{value},
            "macro_play":{value},"consistency":{value},"shotcalling":{value},
            "champion_pool":{value},"discipline":{value},"mental_resilience":{value}}},
            "potential_floor":{floor}}}"#
        )
    }

    fn document(entries: &[String]) -> String {
        format!(
            r#"{{"version":1,"method":"stat-blend-v1","source":"test",
            "window":{{"since":"2025-01-01","until":"2026-01-01"}},
            "league_levels":{{"cblol":{{"median":75.0,"sd":3.0}}}},
            "entries":[{}]}}"#,
            entries.join(",")
        )
    }

    fn overrides(entries: &[String]) -> PlayerRatingOverrides {
        PlayerRatingOverrides::parse(&document(entries)).expect("parses")
    }

    #[test]
    fn bundled_asset_parses_without_skipped_entries() {
        let json = BUNDLED_OVERRIDES_JSON;
        let parsed = PlayerRatingOverrides::parse(json).expect("bundled asset parses");
        assert_eq!(parsed.method(), "stat-blend-v1");
        assert!(parsed.skipped_entries().is_empty());
        assert!(parsed.window().is_some());
    }

    #[test]
    fn bundled_accessor_matches_the_asset() {
        assert!(!bundled().is_empty(), "the shipped asset lists players");
        assert_eq!(bundled().skipped_entries(), &[] as &[String]);
        assert_eq!(bundled().method(), "stat-blend-v1");
    }

    #[test]
    fn parse_rejects_unknown_top_level_field() {
        let json = document(&[]).replacen(r#""version":1"#, r#""version":1,"extra":true"#, 1);
        assert!(matches!(
            PlayerRatingOverrides::parse(&json),
            Err(PlayerRatingOverridesError::Json(_))
        ));
    }

    #[test]
    fn parse_rejects_unsupported_version() {
        let json = document(&[]).replacen(r#""version":1"#, r#""version":2"#, 1);
        assert!(matches!(
            PlayerRatingOverrides::parse(&json),
            Err(PlayerRatingOverridesError::UnsupportedVersion { found: 2 })
        ));
    }

    #[test]
    fn parse_skips_entry_with_unknown_field() {
        let bad =
            entry_json("a", 50, 40, 60, 60).replacen(r#""games":40"#, r#""games":40,"x":1"#, 1);
        let parsed = overrides(&[bad, entry_json("b", 50, 40, 60, 60)]);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed.skipped_entries().len(), 1);
    }

    #[test]
    fn parse_skips_out_of_range_and_duplicate_entries() {
        let parsed = overrides(&[
            entry_json("zero_attr", 50, 40, 0, 60),
            entry_json("big_floor", 50, 40, 60, 100),
            entry_json("ok", 50, 40, 60, 60),
            entry_json("ok", 50, 40, 61, 61),
        ]);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed.skipped_entries().len(), 3);
        assert_eq!(parsed.entry("ok").map(|e| e.attributes.mechanics), Some(60));
    }

    #[test]
    fn parse_skips_confidence_outside_unit_interval() {
        let bad = entry_json("a", 50, 40, 60, 60).replacen(
            r#""confidence":0.8"#,
            r#""confidence":1.5"#,
            1,
        );
        assert_eq!(overrides(&[bad]).len(), 0);
    }

    #[test]
    fn apply_skips_stale_entry_and_leaves_player_unchanged() {
        let mut players = vec![player("a", 55)];
        let report = apply_player_rating_overrides(
            &mut players,
            &overrides(&[entry_json("a", 50, 40, 70, 70)]),
            None,
        );
        assert_eq!((report.applied, report.skipped_stale), (0, 1));
        assert_eq!(players[0].attributes.as_array(), [55; 9]);
    }

    #[test]
    fn apply_leaves_unlisted_players_unchanged() {
        let mut players = vec![player("a", 50), player("other", 50)];
        let report = apply_player_rating_overrides(
            &mut players,
            &overrides(&[entry_json("a", 50, 40, 70, 70)]),
            None,
        );
        assert_eq!(report.applied, 1);
        assert_eq!(players[1].attributes.as_array(), [50; 9]);
        assert_eq!(players[1].lol_ovr, 50);
    }

    #[test]
    fn apply_sets_attributes_and_ovr() {
        let mut players = vec![player("a", 50)];
        apply_player_rating_overrides(
            &mut players,
            &overrides(&[entry_json("a", 50, 40, 72, 60)]),
            None,
        );
        assert_eq!(players[0].attributes.as_array(), [72; 9]);
        assert_eq!(players[0].lol_ovr, 72);
    }

    #[test]
    fn apply_raises_potential_to_floor_and_new_ovr_but_never_lowers_it() {
        let mut players = vec![player("floor", 50), player("ovr", 50), player("high", 50)];
        players[0].potential_base = 55;
        players[1].potential_base = 55;
        players[2].potential_base = 90;
        let set = overrides(&[
            entry_json("floor", 50, 40, 60, 80),
            entry_json("ovr", 50, 40, 70, 60),
            entry_json("high", 50, 40, 70, 60),
        ]);
        apply_player_rating_overrides(&mut players, &set, None);
        assert_eq!(players[0].potential_base, 80);
        assert_eq!(players[1].potential_base, 70);
        assert_eq!(players[2].potential_base, 90);
    }

    #[test]
    fn apply_raises_revealed_potential_below_the_new_ovr_only() {
        let mut players = vec![player("low", 50), player("fine", 50), player("none", 50)];
        players[0].potential_revealed = Some(60);
        players[1].potential_revealed = Some(85);
        let set = overrides(&[
            entry_json("low", 50, 40, 70, 60),
            entry_json("fine", 50, 40, 70, 60),
            entry_json("none", 50, 40, 70, 60),
        ]);
        apply_player_rating_overrides(&mut players, &set, None);
        assert_eq!(players[0].potential_revealed, Some(70));
        assert_eq!(players[1].potential_revealed, Some(85));
        assert_eq!(players[2].potential_revealed, None);
    }

    fn market_value_after(mut p: Player, value: u64, wage: u32) -> u64 {
        p.market_value = value;
        p.wage = wage;
        p.potential_base = 50;
        let mut players = vec![p];
        apply_player_rating_overrides(
            &mut players,
            &overrides(&[entry_json("a", 50, 40, 72, 60)]),
            None,
        );
        players[0].market_value
    }

    #[test]
    fn market_value_is_reset_when_zero_placeholder_or_seeded() {
        let seeded = suggested_seed_market_value(50, 50, false);
        let academy = suggested_seed_market_value(50, 50, true);
        assert_eq!(market_value_after(player("a", 50), 0, 0), 0);
        assert_eq!(market_value_after(player("a", 50), 150_000, 10_000), 0);
        assert_eq!(market_value_after(player("a", 50), seeded, 0), 0);
        assert_eq!(market_value_after(player("a", 50), academy, 0), 0);
    }

    #[test]
    fn market_value_is_kept_when_authored() {
        assert_eq!(
            market_value_after(player("a", 50), 777_000, 10_000),
            777_000
        );
    }

    #[test]
    fn wage_is_never_changed() {
        let mut p = player("a", 50);
        p.wage = 123_456;
        let mut players = vec![p];
        apply_player_rating_overrides(
            &mut players,
            &overrides(&[entry_json("a", 50, 40, 72, 60)]),
            None,
        );
        assert_eq!(players[0].wage, 123_456);
    }

    #[test]
    fn low_confidence_ids_list_applied_entries_below_the_games_threshold() {
        let mut players = vec![player("few", 50), player("many", 50), player("stale", 60)];
        let set = overrides(&[
            entry_json("few", 50, 24, 70, 60),
            entry_json("many", 50, 25, 70, 60),
            entry_json("stale", 50, 3, 70, 60),
        ]);
        let report = apply_player_rating_overrides(&mut players, &set, None);
        assert_eq!(
            report.low_confidence_ids,
            HashSet::from(["few".to_string()])
        );
    }

    #[test]
    fn missing_players_are_counted() {
        let mut players = vec![player("a", 50)];
        let set = overrides(&[
            entry_json("a", 50, 40, 70, 60),
            entry_json("gone", 50, 40, 70, 60),
        ]);
        assert_eq!(
            apply_player_rating_overrides(&mut players, &set, None).skipped_missing,
            1
        );
    }

    #[test]
    fn ids_subset_restricts_players_and_missing_count() {
        let mut players = vec![player("a", 50), player("b", 50)];
        let set = overrides(&[
            entry_json("a", 50, 40, 70, 60),
            entry_json("b", 50, 40, 70, 60),
            entry_json("gone", 50, 40, 70, 60),
        ]);
        let subset = HashSet::from(["b".to_string()]);
        let report = apply_player_rating_overrides(&mut players, &set, Some(&subset));
        assert_eq!((report.applied, report.skipped_missing), (1, 0));
        assert_eq!(players[0].attributes.as_array(), [50; 9]);
        assert_eq!(players[1].attributes.as_array(), [70; 9]);
    }
}
