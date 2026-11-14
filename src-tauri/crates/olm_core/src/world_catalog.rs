//! Deterministic repairs applied to the bundled catalog when a world is assembled.
//!
//! The `data/` repository is pinned and shared, so known defects are corrected here, in
//! the main repo: stale duplicate competitions are dropped in favour of their canonical
//! copy, players on teams that do not exist become free agents, and a reviewed
//! corrections file (`assets/world/catalog-corrections.json`) fixes individual fields.
//! Everything is pure and never fails: bad input is skipped and reported.

use crate::domain::player::Player;
use crate::domain::team::Team;
use crate::game::Game;
use log::warn;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};

/// Stale copies of a live competition that the catalog still ships: `(stale, canonical)`.
/// Mirrors `STALE_DUPLICATE_COMPETITIONS` in `scripts/world/lib/world.mjs`.
pub const STALE_DUPLICATE_COMPETITIONS: [(&str, &str); 2] =
    [("lck-cl", "lckcl"), ("prime_league", "prm")];

/// Whether `competition_id` is a stale duplicate of another competition.
pub fn is_stale_duplicate_competition(competition_id: &str) -> bool {
    STALE_DUPLICATE_COMPETITIONS
        .iter()
        .any(|(stale, _)| *stale == competition_id)
}

/// Remove the teams of stale duplicate competitions that no league plays, from a game that
/// already holds them (saves rehydrated before the catalog stopped re-adding them).
/// Their players and staff become free agents and their ids are recorded in
/// `removed_team_ids`, so a catalog rehydration never brings them back. A stale team a
/// league still schedules (a save made before new games stopped building those leagues)
/// and the manager's own team stay. Returns the removed team ids.
pub fn remove_orphan_stale_teams(game: &mut Game) -> Vec<String> {
    let scheduled: HashSet<&str> = game
        .leagues
        .iter()
        .flat_map(|league| league.standings.iter().map(|entry| entry.team_id.as_str()))
        .collect();
    let manager_team = game.manager.team_id.as_deref();
    let orphans: HashSet<String> = game
        .teams
        .iter()
        .filter(|team| {
            team.competition_id
                .as_deref()
                .is_some_and(is_stale_duplicate_competition)
                && !scheduled.contains(team.id.as_str())
                && manager_team != Some(team.id.as_str())
        })
        .map(|team| team.id.clone())
        .collect();
    if orphans.is_empty() {
        return Vec::new();
    }

    game.teams.retain(|team| !orphans.contains(&team.id));
    for player in &mut game.players {
        if player
            .team_id
            .as_ref()
            .is_some_and(|id| orphans.contains(id))
        {
            player.team_id = None;
        }
    }
    for member in &mut game.staff {
        if member
            .team_id
            .as_ref()
            .is_some_and(|id| orphans.contains(id))
        {
            member.team_id = None;
        }
    }
    let mut removed: Vec<String> = orphans.into_iter().collect();
    removed.sort_unstable();
    for id in &removed {
        if !game.removed_team_ids.contains(id) {
            game.removed_team_ids.push(id.clone());
        }
    }
    removed
}

/// A player record that lost a duplicate-id resolution.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DroppedDuplicate {
    pub player_id: String,
    pub dropped_from: String,
    pub kept_from: String,
}

/// Keep one record per player id. `entries` pairs each player with the competition it was
/// loaded from. A record from a live competition beats one from a stale duplicate;
/// otherwise the first record wins. Survivors keep their original order.
pub fn dedupe_players(entries: Vec<(String, Player)>) -> (Vec<Player>, Vec<DroppedDuplicate>) {
    // Winner per id: first record, unless a later one comes from a live competition
    // while the current winner comes from a stale duplicate.
    let mut winner: HashMap<&str, usize> = HashMap::with_capacity(entries.len());
    for (index, (competition, player)) in entries.iter().enumerate() {
        match winner.get(player.id.as_str()) {
            None => {
                winner.insert(player.id.as_str(), index);
            }
            Some(&current) => {
                let current_is_stale = is_stale_duplicate_competition(&entries[current].0);
                if current_is_stale && !is_stale_duplicate_competition(competition) {
                    winner.insert(player.id.as_str(), index);
                }
            }
        }
    }

    let mut dropped = Vec::new();
    let mut kept = Vec::with_capacity(winner.len());
    for (index, (competition, player)) in entries.iter().enumerate() {
        let winning = winner[player.id.as_str()];
        if winning != index {
            dropped.push(DroppedDuplicate {
                player_id: player.id.clone(),
                dropped_from: competition.clone(),
                kept_from: entries[winning].0.clone(),
            });
        }
    }
    let winners: HashSet<usize> = winner.values().copied().collect();
    for (index, (_, player)) in entries.into_iter().enumerate() {
        if winners.contains(&index) {
            kept.push(player);
        }
    }
    (kept, dropped)
}

/// Turn players whose team does not exist into free agents. Returns their ids.
pub fn detach_orphaned_players(players: &mut [Player], teams: &[Team]) -> Vec<String> {
    let team_ids: HashSet<&str> = teams.iter().map(|t| t.id.as_str()).collect();
    let mut detached = Vec::new();
    for player in players.iter_mut() {
        if player
            .team_id
            .as_deref()
            .is_some_and(|team| !team_ids.contains(team))
        {
            player.team_id = None;
            detached.push(player.id.clone());
        }
    }
    detached
}

/// One reviewed field fix: `field` of player `id` goes from `from` to `to`.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct CatalogCorrection {
    pub id: String,
    pub field: String,
    pub from: String,
    pub to: String,
    pub evidence: String,
}

/// Contract of `assets/world/catalog-corrections.json`.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct CatalogCorrections {
    #[serde(default)]
    pub corrections: Vec<CatalogCorrection>,
}

/// What [`apply_catalog_corrections`] did.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CorrectionReport {
    pub applied: usize,
    pub skipped: Vec<String>,
}

/// Apply reviewed corrections. An unknown id, field, or a `from` that no longer matches
/// is skipped and reported, never an error.
pub fn apply_catalog_corrections(
    players: &mut [Player],
    corrections: &[CatalogCorrection],
) -> CorrectionReport {
    let mut report = CorrectionReport::default();
    for correction in corrections {
        let Some(player) = players.iter_mut().find(|p| p.id == correction.id) else {
            report
                .skipped
                .push(format!("{}: unknown player id", correction.id));
            continue;
        };
        let slot = match correction.field.as_str() {
            "full_name" => &mut player.full_name,
            "match_name" => &mut player.match_name,
            "nationality" => &mut player.nationality,
            other => {
                report
                    .skipped
                    .push(format!("{}: unsupported field '{other}'", correction.id));
                continue;
            }
        };
        if *slot != correction.from {
            report.skipped.push(format!(
                "{}.{}: expected '{}' but found '{}'",
                correction.id, correction.field, correction.from, slot
            ));
            continue;
        }
        slot.clone_from(&correction.to);
        report.applied += 1;
    }
    for note in &report.skipped {
        warn!("[world_catalog] correction skipped: {note}");
    }
    report
}

const BUNDLED_CORRECTIONS_JSON: &str =
    include_str!("../../../../assets/world/catalog-corrections.json");

/// Parse a corrections document; malformed input yields no corrections.
pub fn parse_catalog_corrections(json: &str) -> Vec<CatalogCorrection> {
    match serde_json::from_str::<CatalogCorrections>(json) {
        Ok(doc) => doc.corrections,
        Err(err) => {
            warn!("[world_catalog] ignoring malformed corrections file: {err}");
            Vec::new()
        }
    }
}

/// The corrections bundled with the app.
pub fn bundled_catalog_corrections() -> Vec<CatalogCorrection> {
    parse_catalog_corrections(BUNDLED_CORRECTIONS_JSON)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::player::PlayerAttributes;

    fn player(id: &str, name: &str, team: Option<&str>) -> Player {
        let mut p = Player::new(
            id.to_string(),
            name.to_string(),
            format!("{name} Real"),
            "2000-01-01".to_string(),
            "KR".to_string(),
            crate::domain::stats::LolRole::Mid,
            PlayerAttributes::default(),
        );
        p.team_id = team.map(str::to_string);
        p
    }

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

    #[test]
    fn dedupe_keeps_the_canonical_record_when_the_stale_copy_comes_first() {
        let (kept, dropped) = dedupe_players(vec![
            (
                "lck-cl".into(),
                player("p1", "Stale", Some("lck-cl-team-a")),
            ),
            (
                "lckcl".into(),
                player("p1", "Canonical", Some("lckcl-team-a")),
            ),
        ]);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].match_name, "Canonical");
        assert_eq!(
            dropped,
            vec![DroppedDuplicate {
                player_id: "p1".into(),
                dropped_from: "lck-cl".into(),
                kept_from: "lckcl".into(),
            }]
        );
    }

    #[test]
    fn dedupe_keeps_the_canonical_record_when_it_comes_first() {
        let (kept, _) = dedupe_players(vec![
            ("prm".into(), player("p1", "Canonical", Some("prm-team-a"))),
            (
                "prime_league".into(),
                player("p1", "Stale", Some("prime_league-team-a")),
            ),
        ]);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].match_name, "Canonical");
    }

    #[test]
    fn dedupe_prefers_a_live_competition_over_a_stale_one_that_never_mirrored_it() {
        let (kept, _) = dedupe_players(vec![
            ("prime_league".into(), player("p1", "Stale", None)),
            ("hll".into(), player("p1", "Live", Some("hll-team-a"))),
        ]);
        assert_eq!(kept[0].match_name, "Live");
    }

    #[test]
    fn dedupe_between_two_live_competitions_keeps_the_first_record() {
        let (kept, dropped) = dedupe_players(vec![
            ("hll".into(), player("p1", "First", Some("hll-team-a"))),
            ("rl".into(), player("p1", "Second", Some("rl-team-a"))),
        ]);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].match_name, "First");
        assert_eq!(dropped[0].dropped_from, "rl");
    }

    #[test]
    fn dedupe_leaves_unique_players_in_their_original_order() {
        let (kept, dropped) = dedupe_players(vec![
            ("lck".into(), player("a", "A", None)),
            ("lck".into(), player("b", "B", None)),
            ("lec".into(), player("c", "C", None)),
        ]);
        let ids: Vec<_> = kept.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, ["a", "b", "c"]);
        assert!(dropped.is_empty());
    }

    #[test]
    fn orphaned_players_become_free_agents() {
        let mut players = vec![
            player("ok", "Ok", Some("lck-team-a")),
            player("orphan", "Orphan", Some("lck-cl-team-gone")),
            player("free", "Free", None),
            player("fa", "Marker", Some("fa")),
        ];
        let detached = detach_orphaned_players(&mut players, &[team("lck-team-a")]);
        assert_eq!(detached, vec!["orphan".to_string(), "fa".to_string()]);
        assert_eq!(players[0].team_id.as_deref(), Some("lck-team-a"));
        assert_eq!(players[1].team_id, None);
        assert_eq!(players[3].team_id, None);
    }

    fn fix(id: &str, field: &str, from: &str, to: &str) -> CatalogCorrection {
        CatalogCorrection {
            id: id.into(),
            field: field.into(),
            from: from.into(),
            to: to.into(),
            evidence: "test".into(),
        }
    }

    #[test]
    fn correction_replaces_the_field_when_from_matches() {
        let mut players = vec![player("p1", "Oner", None)];
        players[0].full_name = "Lee Sang-hyeok".into();
        let report = apply_catalog_corrections(
            &mut players,
            &[fix("p1", "full_name", "Lee Sang-hyeok", "Mun Hyeon-jun")],
        );
        assert_eq!(players[0].full_name, "Mun Hyeon-jun");
        assert_eq!(report.applied, 1);
        assert!(report.skipped.is_empty());
    }

    #[test]
    fn correction_is_skipped_when_from_no_longer_matches() {
        let mut players = vec![player("p1", "Oner", None)];
        let before = players[0].full_name.clone();
        let report =
            apply_catalog_corrections(&mut players, &[fix("p1", "full_name", "stale", "x")]);
        assert_eq!(players[0].full_name, before);
        assert_eq!(report.applied, 0);
        assert_eq!(report.skipped.len(), 1);
    }

    #[test]
    fn correction_with_unknown_id_or_field_is_skipped_without_panicking() {
        let mut players = vec![player("p1", "Oner", None)];
        let report = apply_catalog_corrections(
            &mut players,
            &[
                fix("missing", "full_name", "a", "b"),
                fix("p1", "wage", "0", "9"),
            ],
        );
        assert_eq!(report.applied, 0);
        assert_eq!(report.skipped.len(), 2);
    }

    #[test]
    fn malformed_corrections_document_yields_no_corrections() {
        assert!(parse_catalog_corrections("not json").is_empty());
    }

    #[test]
    fn bundled_corrections_are_valid_and_carry_evidence() {
        let bundled = bundled_catalog_corrections();
        assert!(!bundled.is_empty(), "bundled corrections must parse");
        assert!(bundled.iter().all(|c| !c.evidence.trim().is_empty()));
    }
}
