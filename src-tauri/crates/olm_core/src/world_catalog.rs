//! Deterministic repairs applied to the bundled catalog when a world is assembled.
//!
//! The `data/` repository is pinned and shared, so known defects are corrected here, in
//! the main repo: stale duplicate competitions are dropped in favour of their canonical
//! copy, players on teams that do not exist become free agents, and a reviewed
//! corrections file (`assets/world/catalog-corrections.json`) fixes individual fields.
//! Everything is pure and never fails: bad input is skipped and reported.

use crate::domain::player::{Player, TransferOfferStatus};
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
/// game put them: ids in `moved_player_ids`, players with a transfer record, players swapped
/// in as part of a transfer, and players with a pending transfer offer (it lives on the
/// player record, so dropping the record would silently cancel it).
pub fn transfer_protected_player_ids(game: &Game) -> HashSet<String> {
    let mut ids = game.moved_player_ids.clone();
    for player in &game.players {
        if player
            .transfer_offers
            .iter()
            .any(|offer| offer.status == TransferOfferStatus::Pending)
        {
            ids.insert(player.id.clone());
        }
    }
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

/// Ids of the teams some league schedules.
fn scheduled_team_ids(game: &Game) -> HashSet<&str> {
    game.leagues
        .iter()
        .flat_map(|league| league.standings.iter().map(|entry| entry.team_id.as_str()))
        .collect()
}

/// The stale competitions this save still plays: a stale league with standings, or a stale
/// club some league schedules. Empty for a new world, which gates every duplicate repair.
fn stale_era_competitions(game: &Game, scheduled: &HashSet<&str>) -> HashSet<&'static str> {
    STALE_DUPLICATE_COMPETITIONS
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
        .collect()
}

/// What `remove_teams` took out of a game.
struct TeamRemoval {
    /// Removed team ids, sorted.
    removed: Vec<String>,
    /// Ids of the dropped players, sorted.
    dropped: Vec<String>,
    /// Players of the removed teams released as free agents.
    released_players: usize,
}

/// Delete `orphans` from the game. A player in `survivors` (dropped id to surviving id) is
/// deleted, tombstoned in `retired_player_ids`, and every reference to it is pointed at the
/// survivor; every other player and every staff member of an orphan becomes a free agent.
/// The ids are appended to `removed_team_ids` once.
fn remove_teams(
    game: &mut Game,
    orphans: HashSet<String>,
    survivors: HashMap<String, String>,
) -> TeamRemoval {
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
    TeamRemoval {
        removed,
        dropped,
        released_players,
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
    let scheduled = scheduled_team_ids(game);
    let stale_competitions = stale_era_competitions(game, &scheduled);
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

    let TeamRemoval {
        removed,
        dropped,
        released_players,
    } = remove_teams(game, orphans, survivors);
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

/// Stale academy families: `(stale competition, stale academy id prefix, canonical prefix)`.
/// The two copies of an academy share the slug after the prefix (`academy-lck_cl-t1` and
/// `academy-lckcl-t1`), which is how a twin is found. Academies carry no competition id.
const ACADEMY_FAMILIES: [(&str, &str, &str); 2] = [
    ("lck-cl", "academy-lck_cl-", "academy-lckcl-"),
    ("prime_league", "academy-prime_league-", "academy-prm-"),
];

/// What `remove_stale_academy_duplicates` changed.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct AcademyDuplicateReport {
    /// Ids of the removed academies, sorted.
    pub removed_teams: Vec<String>,
    /// Ids of the players dropped as the same person as a player of the surviving twin, sorted.
    pub dropped_players: Vec<String>,
    /// Players of the removed academies that were released as free agents.
    pub released_players: usize,
}

/// Remove the duplicate copy of each academy that a save from releases up to 2026.1113.2
/// holds twice (a stale `lck_cl` or `prime_league` academy next to its canonical `lckcl` or
/// `prm` twin, paired by id), while the save still plays a stale league (the gate of
/// `remove_unscheduled_canonical_duplicates`). The copy a club links as its academy
/// survives; when neither is linked the canonical copy survives, and when both are linked
/// neither is touched. A pair is also left alone when a league schedules either copy (the
/// user's parallel academy league does). The manager's club and its academy are never
/// removed, and an academy with no twin stays.
///
/// Players and staff of a removed academy follow `remove_teams`: a player who is the same
/// person as one on the surviving twin is dropped and its references remapped, any other
/// player is released as a free agent, and a player that moved or has a transfer record is
/// always released. Transfer-history rows that name a removed academy point at its surviving
/// twin.
pub fn remove_stale_academy_duplicates(game: &mut Game) -> AcademyDuplicateReport {
    let scheduled = scheduled_team_ids(game);
    let stale_competitions = stale_era_competitions(game, &scheduled);
    if stale_competitions.is_empty() {
        return AcademyDuplicateReport::default();
    }

    let academies: HashSet<&str> = game
        .teams
        .iter()
        .filter(|team| team.team_kind == TeamKind::Academy)
        .map(|team| team.id.as_str())
        .collect();
    let mut linked: HashSet<&str> = game.manager.team_id.as_deref().into_iter().collect();
    for team in &game.teams {
        if team.parent_team_id.is_some() {
            linked.insert(team.id.as_str());
        }
        linked.extend(team.academy_team_id.as_deref());
    }

    // `(removed, surviving)` academy ids.
    let mut pairs: Vec<(&str, String)> = Vec::new();
    for (competition, stale_prefix, canonical_prefix) in ACADEMY_FAMILIES {
        if !stale_competitions.contains(competition) {
            continue;
        }
        for stale in &academies {
            let Some(slug) = stale.strip_prefix(stale_prefix) else {
                continue;
            };
            let canonical = format!("{canonical_prefix}{slug}");
            let Some(canonical) = academies.get(canonical.as_str()).copied() else {
                continue;
            };
            let pair = match (linked.contains(stale), linked.contains(canonical)) {
                (false, _) => Some((*stale, canonical.to_string())),
                (true, false) => Some((canonical, (*stale).to_string())),
                (true, true) => None,
            };
            // A league plays the academy (the user's parallel academy league holds every
            // academy of an ERL league): removing a copy would leave its standings dangling.
            if let Some((removed, surviving)) = pair
                && !scheduled.contains(removed)
                && !scheduled.contains(surviving.as_str())
            {
                pairs.push((removed, surviving));
            }
        }
    }
    if pairs.is_empty() {
        return AcademyDuplicateReport::default();
    }

    let mut roster: HashMap<&str, Vec<&Player>> = HashMap::new();
    for player in &game.players {
        if let Some(team) = player.team_id.as_deref() {
            roster.entry(team).or_default().push(player);
        }
    }
    let protected = transfer_protected_player_ids(game);
    let mut survivors: HashMap<String, String> = HashMap::new();
    for (removed, surviving) in &pairs {
        let mut by_name: HashMap<(String, NaiveDate), String> = HashMap::new();
        let mut by_match_name: HashMap<(String, NaiveDate), String> = HashMap::new();
        for player in roster.get(surviving.as_str()).into_iter().flatten() {
            if let Some(born) = parse_date_of_birth(&player.date_of_birth) {
                by_name
                    .entry((person_key(&player.full_name), born))
                    .or_insert_with(|| player.id.clone());
                by_match_name
                    .entry((person_key(&player.match_name), born))
                    .or_insert_with(|| player.id.clone());
            }
        }
        for player in roster.get(removed).into_iter().flatten() {
            if protected.contains(&player.id) {
                continue;
            }
            if let Some(survivor) = same_person_survivor(player, &by_name, &by_match_name) {
                survivors.insert(player.id.clone(), survivor.to_string());
            }
        }
    }
    let orphans: HashSet<String> = pairs
        .iter()
        .map(|(removed, _)| removed.to_string())
        .collect();
    let surviving_teams: HashMap<String, String> = pairs
        .iter()
        .map(|(removed, surviving)| (removed.to_string(), surviving.clone()))
        .collect();

    let TeamRemoval {
        removed,
        dropped,
        released_players,
    } = remove_teams(game, orphans, survivors);
    for entry in &mut game.transfer_history.entries {
        for team in [&mut entry.from_team_id, &mut entry.to_team_id] {
            if let Some(surviving) = surviving_teams.get(team.as_str()) {
                team.clone_from(surviving);
            }
        }
    }
    info!(
        "[world_catalog] removed {} stale academy duplicates, dropped {} duplicate players {:?}, released {}",
        removed.len(),
        dropped.len(),
        dropped,
        released_players
    );
    AcademyDuplicateReport {
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

/// A stale-competition player left out of a new world because a live competition holds
/// the same person.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DroppedStaleTwin {
    pub player_id: String,
    pub dropped_from: String,
    pub live_twin_id: String,
}

/// Drop the records of a stale duplicate competition for people a live competition also
/// holds. A new world keeps no team of a stale competition, so its players would become free
/// agents next to the live record of the same person, and the AI market could sign both.
///
/// The person is matched like `same_person_survivor` does (a name and a readable birth date),
/// except that either name of the stale record may equal either name of the live one: the
/// stale files sometimes write the nick as the full name and the other way round. Only a
/// stale record that is a free agent or sits on a team of its own competition goes; a record
/// sharing its id with a live one is left to [`dedupe_players`]; a live record is never
/// dropped. `entries` pairs each player with the competition it was loaded from; survivors
/// keep their order.
pub fn drop_stale_twins_of_live_players(
    entries: Vec<(String, Player)>,
) -> (Vec<(String, Player)>, Vec<DroppedStaleTwin>) {
    let names = |player: &Player| -> Vec<String> {
        [
            person_key(&player.full_name),
            person_key(&player.match_name),
        ]
        .into_iter()
        .filter(|name| !name.is_empty())
        .collect()
    };

    let mut live_ids: HashSet<&str> = HashSet::new();
    let mut live_by_identity: HashMap<(String, NaiveDate), &str> = HashMap::new();
    for (competition, player) in &entries {
        if is_stale_duplicate_competition(competition) {
            continue;
        }
        live_ids.insert(player.id.as_str());
        if let Some(born) = parse_date_of_birth(&player.date_of_birth) {
            for name in names(player) {
                live_by_identity
                    .entry((name, born))
                    .or_insert(player.id.as_str());
            }
        }
    }

    let mut dropped = Vec::new();
    let mut drop_flags = Vec::with_capacity(entries.len());
    for (competition, player) in &entries {
        let removable = is_stale_duplicate_competition(competition)
            && !live_ids.contains(player.id.as_str())
            && player.team_id.as_deref().is_none_or(|team| {
                matches!(team, "fa" | "freeagent") || team.starts_with(&format!("{competition}-"))
            });
        let twin = removable
            .then(|| parse_date_of_birth(&player.date_of_birth))
            .flatten()
            .and_then(|born| {
                names(player)
                    .into_iter()
                    .find_map(|name| live_by_identity.get(&(name, born)).copied())
            });
        if let Some(live_twin_id) = twin {
            dropped.push(DroppedStaleTwin {
                player_id: player.id.clone(),
                dropped_from: competition.clone(),
                live_twin_id: live_twin_id.to_string(),
            });
        }
        drop_flags.push(twin.is_some());
    }
    let kept = entries
        .into_iter()
        .zip(drop_flags)
        .filter_map(|(entry, dropped)| (!dropped).then_some(entry))
        .collect();
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

/// Apply one correction to the identity fields of the record it names. `Err` says why it
/// was not applied: an unsupported field, or a `from` that no longer matches.
pub fn apply_identity_correction(
    correction: &CatalogCorrection,
    match_name: &mut String,
    full_name: &mut String,
    nationality: &mut String,
) -> Result<(), String> {
    let slot = match correction.field.as_str() {
        "full_name" => full_name,
        "match_name" => match_name,
        "nationality" => nationality,
        other => return Err(format!("{}: unsupported field '{other}'", correction.id)),
    };
    if *slot != correction.from {
        return Err(format!(
            "{}.{}: expected '{}' but found '{}'",
            correction.id, correction.field, correction.from, slot
        ));
    }
    slot.clone_from(&correction.to);
    Ok(())
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
        match apply_identity_correction(
            correction,
            &mut player.match_name,
            &mut player.full_name,
            &mut player.nationality,
        ) {
            Ok(()) => report.applied += 1,
            Err(note) => report.skipped.push(note),
        }
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

    fn born(mut p: Player, full_name: &str, dob: &str) -> Player {
        p.full_name = full_name.to_string();
        p.date_of_birth = dob.to_string();
        p
    }

    fn ids(entries: &[(String, Player)]) -> Vec<&str> {
        entries.iter().map(|(_, p)| p.id.as_str()).collect()
    }

    #[test]
    fn a_stale_player_who_is_a_live_player_by_nick_and_birth_date_is_dropped() {
        let live = born(
            player("live", "Densi", Some("prm-t1")),
            "Denis Real",
            "2003-06-03",
        );
        let stale = born(player("stale", "Densi", None), "Densi", "June 3, 2003");
        let (kept, dropped) = drop_stale_twins_of_live_players(vec![
            ("prm".into(), live),
            ("prime_league".into(), stale),
        ]);
        assert_eq!(ids(&kept), vec!["live"]);
        assert_eq!(
            dropped,
            vec![DroppedStaleTwin {
                player_id: "stale".into(),
                dropped_from: "prime_league".into(),
                live_twin_id: "live".into(),
            }]
        );
    }

    #[test]
    fn a_stale_player_who_is_a_live_player_by_full_name_and_birth_date_is_dropped() {
        let live = born(
            player("live", "Rin", Some("lckcl-t1")),
            "Kim Rin",
            "2001-02-03",
        );
        let stale = born(
            player("stale", "Other Nick", None),
            "  kim  RIN ",
            "2001-02-03",
        );
        let (kept, dropped) = drop_stale_twins_of_live_players(vec![
            ("lckcl".into(), live),
            ("lck-cl".into(), stale),
        ]);
        assert_eq!(ids(&kept), vec!["live"]);
        assert_eq!(dropped.len(), 1);
    }

    #[test]
    fn a_stale_record_with_its_nick_and_full_name_swapped_is_a_twin() {
        let live = born(
            player("live", "Dinai", Some("lckcl-t1")),
            "Hwang Chi-hyeon",
            "2005-09-22",
        );
        let stale = born(
            player("stale", "Hwang Chi-hyeon", None),
            "Dinai",
            "2005-09-22",
        );
        let (kept, dropped) = drop_stale_twins_of_live_players(vec![
            ("lckcl".into(), live),
            ("lck-cl".into(), stale),
        ]);
        assert_eq!(ids(&kept), vec!["live"]);
        assert_eq!(dropped.len(), 1);
    }

    #[test]
    fn the_stale_record_is_dropped_even_when_it_is_listed_first() {
        let stale = born(player("stale", "Densi", None), "Densi", "June 3, 2003");
        let live = born(
            player("live", "Densi", Some("prm-t1")),
            "Denis Real",
            "2003-06-03",
        );
        let (kept, _) = drop_stale_twins_of_live_players(vec![
            ("prime_league".into(), stale),
            ("prm".into(), live),
        ]);
        assert_eq!(ids(&kept), vec!["live"]);
    }

    #[test]
    fn a_stale_player_with_another_birth_date_or_no_readable_one_stays() {
        let live = born(
            player("live", "Densi", Some("prm-t1")),
            "Denis Real",
            "2003-06-03",
        );
        let other_day = born(player("other-day", "Densi", None), "Densi", "June 4, 2003");
        let unreadable = born(
            player("unreadable", "Densi", None),
            "Densi",
            "sometime in 2003",
        );
        let missing = born(player("missing", "Densi", None), "Densi", "");
        let (kept, dropped) = drop_stale_twins_of_live_players(vec![
            ("prm".into(), live),
            ("prime_league".into(), other_day),
            ("prime_league".into(), unreadable),
            ("prime_league".into(), missing),
        ]);
        assert_eq!(
            ids(&kept),
            vec!["live", "other-day", "unreadable", "missing"]
        );
        assert!(dropped.is_empty());
    }

    #[test]
    fn a_live_player_is_never_dropped_even_when_two_live_players_match() {
        let a = born(
            player("a", "Densi", Some("prm-t1")),
            "Denis Real",
            "2003-06-03",
        );
        let b = born(
            player("b", "Densi", Some("al-t2")),
            "Denis Real",
            "2003-06-03",
        );
        let (kept, dropped) =
            drop_stale_twins_of_live_players(vec![("prm".into(), a), ("al".into(), b)]);
        assert_eq!(ids(&kept), vec!["a", "b"]);
        assert!(dropped.is_empty());
    }

    #[test]
    fn a_stale_player_under_contract_on_a_live_team_stays() {
        let live = born(
            player("live", "Densi", Some("prm-t1")),
            "Denis Real",
            "2003-06-03",
        );
        let signed = born(
            player("signed", "Densi", Some("prm-t9")),
            "Densi",
            "June 3, 2003",
        );
        let (kept, dropped) = drop_stale_twins_of_live_players(vec![
            ("prm".into(), live),
            ("prime_league".into(), signed),
        ]);
        assert_eq!(ids(&kept), vec!["live", "signed"]);
        assert!(dropped.is_empty());
    }

    #[test]
    fn a_stale_record_sharing_an_id_with_a_live_one_is_left_to_the_id_dedupe() {
        let live = born(
            player("same", "Densi", Some("prm-t1")),
            "Denis Real",
            "2003-06-03",
        );
        let stale = born(player("same", "Densi", None), "Densi", "June 3, 2003");
        let (kept, dropped) = drop_stale_twins_of_live_players(vec![
            ("prm".into(), live),
            ("prime_league".into(), stale),
        ]);
        assert_eq!(kept.len(), 2);
        assert!(dropped.is_empty());
        assert_eq!(dedupe_players(kept).0.len(), 1);
    }

    #[test]
    fn a_stale_player_with_only_a_stale_twin_stays() {
        let a = born(player("a", "Densi", None), "Densi", "June 3, 2003");
        let b = born(player("b", "Densi", None), "Densi", "June 3, 2003");
        let (kept, dropped) = drop_stale_twins_of_live_players(vec![
            ("prime_league".into(), a),
            ("lck-cl".into(), b),
        ]);
        assert_eq!(kept.len(), 2);
        assert!(dropped.is_empty());
    }

    #[test]
    fn bundled_corrections_are_valid_and_carry_evidence() {
        let bundled = bundled_catalog_corrections();
        assert!(!bundled.is_empty(), "bundled corrections must parse");
        assert!(bundled.iter().all(|c| !c.evidence.trim().is_empty()));
    }
}
