//! Deterministic repairs applied to the bundled catalog when a world is assembled.
//!
//! The `data/` repository is pinned and shared, so known defects are corrected here, in
//! the main repo: stale duplicate competitions are dropped in favour of their canonical
//! copy, players on teams that do not exist become free agents, and a reviewed
//! corrections file (`assets/world/catalog-corrections.json`) fixes individual fields.
//! Everything is pure and never fails: bad input is skipped and reported.

use crate::domain::player::Player;
use crate::domain::team::{Team, TeamKind};
use crate::game::Game;
use crate::generator::definitions::CompetitionManifest;
use crate::player_age::parse_date_of_birth;
use chrono::NaiveDate;
use log::{info, warn};
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

/// Whether no league ever schedules this competition: it is not legacy, not active and its
/// manifest has no schedule splits. The bundled catalog ships twelve of these (the
/// historical "-l" rosters); their clubs never play, so a new game builds none of them.
pub fn is_never_scheduled_competition(manifest: &CompetitionManifest) -> bool {
    !manifest.legacy && !manifest.active && manifest.schedule.splits.is_empty()
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

/// A name compared case-insensitively with surrounding and repeated spaces ignored.
fn person_key(name: &str) -> String {
    name.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// The stale-competition player `player` is the same person as, if any: the same full
/// name and birth date, or the same match name and birth date (the stale records write the
/// nickname as the full name and the date as "July 6, 2002"). A date that is missing or
/// unreadable never matches, and neither does an empty name.
fn same_person_survivor<'a>(
    player: &Player,
    stale_by_name: &'a HashMap<(String, NaiveDate), String>,
    stale_by_match_name: &'a HashMap<(String, NaiveDate), String>,
) -> Option<&'a str> {
    let born = parse_date_of_birth(&player.date_of_birth)?;
    let full_name = person_key(&player.full_name);
    let match_name = person_key(&player.match_name);
    let by_name = (!full_name.is_empty())
        .then(|| stale_by_name.get(&(full_name, born)))
        .flatten();
    let by_match_name = (!match_name.is_empty())
        .then(|| stale_by_match_name.get(&(match_name, born)))
        .flatten();
    by_name.or(by_match_name).map(String::as_str)
}

/// Player ids whose team was changed in play, so catalog rehydration keeps them where the
/// game put them: ids in `moved_player_ids`, players with a transfer record, and players
/// swapped in as part of a transfer.
pub fn transfer_protected_player_ids(game: &Game) -> HashSet<String> {
    let mut ids = game.moved_player_ids.clone();
    for entry in &game.transfer_history.entries {
        ids.insert(entry.player_id.clone());
        for included in &entry.included_players {
            ids.insert(included.player_id.clone());
        }
    }
    ids
}

/// Rewrite dropped ids in a list, keeping the first occurrence of each id.
fn remap_ids(ids: &mut Vec<String>, survivors: &HashMap<String, String>) {
    let mut seen: HashSet<String> = HashSet::new();
    let remapped: Vec<String> = ids
        .iter()
        .map(|id| survivors.get(id).unwrap_or(id).clone())
        .filter(|id| seen.insert(id.clone()))
        .collect();
    *ids = remapped;
}

/// Point every id-keyed reference to a dropped player at the stale record that survives.
/// `survivors` maps a dropped id to the surviving id. Mastery rows of a dropped player move
/// to the survivor only for champions the survivor has no row for; the rest are deleted.
fn remap_dropped_players(game: &mut Game, survivors: &HashMap<String, String>) {
    let remap = |id: &mut String| {
        if let Some(survivor) = survivors.get(id.as_str()) {
            id.clone_from(survivor);
        }
    };
    for assignment in &mut game.scouting_assignments {
        remap(&mut assignment.player_id);
    }
    for message in &mut game.messages {
        if let Some(id) = message.context.player_id.as_mut() {
            remap(id);
        }
        if let Some(report) = message.context.scout_report.as_mut() {
            remap(&mut report.player_id);
        }
        if let Some(report) = message.context.delegated_renewal_report.as_mut() {
            for case in &mut report.cases {
                remap(&mut case.player_id);
            }
        }
    }
    for article in &mut game.news {
        remap_ids(&mut article.player_ids, survivors);
    }
    for post in &mut game.social_posts {
        remap_ids(&mut post.player_ids, survivors);
    }
    for player in &mut game.players {
        for offer in &mut player.transfer_offers {
            for item in &mut offer.players_included {
                remap(&mut item.player_id);
            }
        }
    }

    let held: HashSet<(String, String)> = game
        .champion_masteries
        .iter()
        .filter(|row| !survivors.contains_key(&row.player_id))
        .map(|row| (row.player_id.clone(), row.champion_id.clone()))
        .collect();
    let mut moved: HashSet<(String, String)> = HashSet::new();
    game.champion_masteries.retain_mut(|row| {
        let Some(survivor) = survivors.get(&row.player_id) else {
            return true;
        };
        let key = (survivor.clone(), row.champion_id.clone());
        if held.contains(&key) || !moved.insert(key) {
            return false;
        }
        row.player_id.clone_from(survivor);
        true
    });

    for (dropped, survivor) in survivors {
        if let Some(date) = game.soloq_history.scouted.remove(dropped) {
            game.soloq_history
                .scouted
                .entry(survivor.clone())
                .or_insert(date);
        }
        if let Some(history) = game.soloq_history.players.remove(dropped) {
            game.soloq_history
                .players
                .entry(survivor.clone())
                .or_insert(history);
        }
    }
}

/// What `remove_unscheduled_canonical_duplicates` changed.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct CanonicalDuplicateReport {
    /// Ids of the removed canonical clubs, sorted.
    pub removed_teams: Vec<String>,
    /// Ids of the players dropped as the same person as a stale-competition player, sorted.
    pub dropped_players: Vec<String>,
    /// Players of the removed clubs that were released as free agents.
    pub released_players: usize,
}

/// Remove the canonical clubs that no league plays, from a game whose leagues are still the
/// stale duplicates (releases up to 2026.1113.2 built both families in the same world and
/// scheduled only the stale one). The stale club survives: league, fixtures and standings
/// reference it. A pair is repaired only while a stale league with standings, or a
/// scheduled stale club, exists for it, so a new world is untouched. Academy clubs and the
/// manager's own club stay (the latter with a warning, said only when the pass changes
/// something).
///
/// The removed clubs' staff are freed and their players released with their wage. A player
/// who is the same person as a player of the stale competition (see `same_person_survivor`)
/// is dropped and tombstoned in `retired_player_ids`, so the catalog does not re-add it, and
/// every id-keyed reference to it is pointed at the surviving record. A player that moved,
/// has a transfer record or was swapped into a transfer is released instead, never dropped.
/// Ids are appended to `removed_team_ids` once.
pub fn remove_unscheduled_canonical_duplicates(game: &mut Game) -> CanonicalDuplicateReport {
    let scheduled: HashSet<&str> = game
        .leagues
        .iter()
        .flat_map(|league| league.standings.iter().map(|entry| entry.team_id.as_str()))
        .collect();
    let stale_competitions: HashSet<&str> = STALE_DUPLICATE_COMPETITIONS
        .iter()
        .map(|(stale, _)| *stale)
        .filter(|stale| {
            game.leagues.iter().any(|league| {
                league.competition_id.as_deref() == Some(*stale) && !league.standings.is_empty()
            }) || game.teams.iter().any(|team| {
                team.competition_id.as_deref() == Some(*stale)
                    && scheduled.contains(team.id.as_str())
            })
        })
        .collect();
    if stale_competitions.is_empty() {
        return CanonicalDuplicateReport::default();
    }
    let canonical_competitions: HashSet<&str> = STALE_DUPLICATE_COMPETITIONS
        .iter()
        .filter(|(stale, _)| stale_competitions.contains(stale))
        .map(|(_, canonical)| *canonical)
        .collect();

    let manager_team = game.manager.team_id.as_deref();
    let mut orphans: HashSet<String> = HashSet::new();
    let mut kept_manager_club: Option<&str> = None;
    for team in &game.teams {
        let is_unscheduled_canonical = team.team_kind == TeamKind::Main
            && team
                .competition_id
                .as_deref()
                .is_some_and(|competition| canonical_competitions.contains(competition))
            && !scheduled.contains(team.id.as_str());
        if !is_unscheduled_canonical {
            continue;
        }
        if manager_team == Some(team.id.as_str()) {
            kept_manager_club = Some(team.id.as_str());
            continue;
        }
        orphans.insert(team.id.clone());
    }
    if orphans.is_empty() {
        return CanonicalDuplicateReport::default();
    }
    // Said only when the pass changes something: it runs on every `get_active_game`.
    if let Some(id) = kept_manager_club {
        warn!(
            "[world_catalog] keeping the manager's club {id}: no league plays it, but it is the manager's"
        );
    }

    let stale_teams: HashSet<&str> = game
        .teams
        .iter()
        .filter(|team| {
            team.competition_id
                .as_deref()
                .is_some_and(|c| stale_competitions.contains(c))
        })
        .map(|team| team.id.as_str())
        .collect();
    let mut stale_by_name: HashMap<(String, NaiveDate), String> = HashMap::new();
    let mut stale_by_match_name: HashMap<(String, NaiveDate), String> = HashMap::new();
    for player in &game.players {
        if !player
            .team_id
            .as_deref()
            .is_some_and(|id| stale_teams.contains(id))
        {
            continue;
        }
        if let Some(born) = parse_date_of_birth(&player.date_of_birth) {
            stale_by_name
                .entry((person_key(&player.full_name), born))
                .or_insert_with(|| player.id.clone());
            stale_by_match_name
                .entry((person_key(&player.match_name), born))
                .or_insert_with(|| player.id.clone());
        }
    }
    let protected = transfer_protected_player_ids(game);
    let mut survivors: HashMap<String, String> = HashMap::new();
    for player in &game.players {
        let on_orphan = player
            .team_id
            .as_ref()
            .is_some_and(|id| orphans.contains(id));
        if !on_orphan || protected.contains(&player.id) {
            continue;
        }
        if let Some(survivor) = same_person_survivor(player, &stale_by_name, &stale_by_match_name) {
            survivors.insert(player.id.clone(), survivor.to_string());
        }
    }

    game.teams.retain(|team| !orphans.contains(&team.id));
    game.players
        .retain(|player| !survivors.contains_key(&player.id));
    remap_dropped_players(game, &survivors);
    let mut dropped: Vec<String> = survivors.into_keys().collect();
    dropped.sort_unstable();
    for id in &dropped {
        if !game.retired_player_ids.contains(id) {
            game.retired_player_ids.push(id.clone());
        }
    }
    let mut released_players = 0;
    for player in &mut game.players {
        if player
            .team_id
            .as_ref()
            .is_some_and(|id| orphans.contains(id))
        {
            player.team_id = None;
            released_players += 1;
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
    info!(
        "[world_catalog] removed {} unscheduled canonical clubs, dropped {} duplicate players {:?}, released {}",
        removed.len(),
        dropped.len(),
        dropped,
        released_players
    );
    CanonicalDuplicateReport {
        removed_teams: removed,
        dropped_players: dropped,
        released_players,
    }
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
