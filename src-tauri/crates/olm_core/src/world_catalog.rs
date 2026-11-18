//! Deterministic repairs applied to the bundled catalog when a world is assembled.
//!
//! The `data/` repository is pinned and shared, so known defects are corrected here, in
//! the main repo: stale duplicate competitions are dropped in favour of their canonical
//! copy, players on teams that do not exist become free agents, and a reviewed
//! corrections file (`assets/world/catalog-corrections.json`) fixes individual fields.
//! Everything is pure and never fails: bad input is skipped and reported.

use crate::domain::player::{Player, TransferOfferStatus};
use crate::domain::stats::LolRole;
use crate::domain::team::{Team, TeamKind};
use crate::game::Game;
use crate::generator::definitions::CompetitionManifest;
use crate::person_identity::{
    could_be_same_person, folded_names, has_all_attributes_zero, real_birth_date,
};
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

/// A record a dropped player may be the same person as. A lower `rank` is the better home
/// for the survivor: 0 is the paired stale club, 1 a surviving academy.
struct Candidate<'a> {
    player: &'a Player,
    rank: u8,
}

/// The record of `pool` that `player` is the same person as, if there is exactly one such
/// person. Two records are one person when [`could_be_same_person`] says so: a shared folded
/// name (match or full, either way round), birth dates at most 62 days apart or missing, and
/// no contradicting nationality. When two fitting candidates are different people the answer
/// is `None`: the record stays released rather than being merged into the wrong namesake.
/// When the fitting candidates are one person, the best-ranked record is the survivor.
fn same_person_survivor<'a>(player: &Player, pool: &[Candidate<'a>]) -> Option<&'a str> {
    let fits: Vec<&Candidate<'a>> = pool
        .iter()
        .filter(|candidate| could_be_same_person(player, candidate.player))
        .collect();
    let ambiguous = fits.iter().enumerate().any(|(i, one)| {
        fits[i + 1..]
            .iter()
            .any(|other| !could_be_same_person(one.player, other.player))
    });
    if ambiguous {
        return None;
    }
    fits.into_iter()
        .min_by_key(|candidate| candidate.rank)
        .map(|candidate| candidate.player.id.as_str())
}

/// An id-safe slug of a team name, as the catalog writes it into `academy-{family}-{slug}`.
fn slug(name: &str) -> String {
    name.to_lowercase()
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

/// The stale club an orphan canonical club is paired with: the team of the stale
/// competition with the same id after the competition prefix (`prm-team-x` and
/// `prime_league-team-x`) or, failing that, the same name.
fn paired_stale_club<'a>(orphan: &Team, teams: &'a [Team]) -> Option<&'a Team> {
    let canonical = orphan.competition_id.as_deref()?;
    let (stale, _) = STALE_DUPLICATE_COMPETITIONS
        .iter()
        .find(|(_, candidate)| *candidate == canonical)?;
    let same_id = orphan
        .id
        .strip_prefix(&format!("{canonical}-"))
        .map(|rest| format!("{stale}-{rest}"));
    let name = person_key(&orphan.name);
    teams.iter().find(|team| {
        team.competition_id.as_deref() == Some(*stale)
            && (same_id.as_deref() == Some(team.id.as_str()) || person_key(&team.name) == name)
    })
}

/// The academies of an orphan canonical club that are in the game: `academy-{family}-{slug}`
/// for either copy of the family (the pass that removes the stale copies runs first).
fn academies_of_club<'a>(orphan: &Team, teams: &'a [Team]) -> Vec<&'a Team> {
    let Some(canonical) = orphan.competition_id.as_deref() else {
        return Vec::new();
    };
    let Some((stale, _)) = STALE_DUPLICATE_COMPETITIONS
        .iter()
        .find(|(_, candidate)| *candidate == canonical)
    else {
        return Vec::new();
    };
    let slug = slug(&orphan.name);
    ACADEMY_FAMILIES
        .iter()
        .filter(|(competition, _, _)| competition == stale)
        .flat_map(|(_, stale_prefix, canonical_prefix)| [stale_prefix, canonical_prefix])
        .filter_map(|prefix| {
            let id = format!("{prefix}{slug}");
            teams
                .iter()
                .find(|team| team.team_kind == TeamKind::Academy && team.id == id)
        })
        .collect()
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
/// who is the same person as a player of its paired stale club or of its academies (see
/// `same_person_survivor`) is dropped and tombstoned in `retired_player_ids`, so the catalog
/// does not re-add it, and every id-keyed reference to it is pointed at the surviving
/// record. A player that moved, has a transfer record or was swapped into a transfer is released instead, never dropped.
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

    let mut roster: HashMap<&str, Vec<&Player>> = HashMap::new();
    for player in &game.players {
        if let Some(team) = player.team_id.as_deref() {
            roster.entry(team).or_default().push(player);
        }
    }
    let protected = transfer_protected_player_ids(game);
    let mut survivors: HashMap<String, String> = HashMap::new();
    for orphan in game.teams.iter().filter(|team| orphans.contains(&team.id)) {
        // Each orphan looks for its twins on its own paired stale club and its own
        // academies, never on the rest of the stale competition.
        let mut pool: Vec<Candidate> = Vec::new();
        let paired = paired_stale_club(orphan, &game.teams);
        let academies = academies_of_club(orphan, &game.teams);
        let homes = paired
            .into_iter()
            .map(|team| (team, 0))
            .chain(academies.into_iter().map(|team| (team, 1)));
        for (team, rank) in homes {
            for player in roster.get(team.id.as_str()).into_iter().flatten() {
                pool.push(Candidate { player, rank });
            }
        }
        if pool.is_empty() {
            continue;
        }
        for player in roster.get(orphan.id.as_str()).into_iter().flatten() {
            if protected.contains(&player.id) {
                continue;
            }
            if let Some(survivor) = same_person_survivor(player, &pool) {
                survivors.insert(player.id.clone(), survivor.to_string());
            }
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
        let pool: Vec<Candidate> = roster
            .get(surviving.as_str())
            .into_iter()
            .flatten()
            .map(|&player| Candidate { player, rank: 0 })
            .collect();
        for player in roster.get(removed).into_iter().flatten() {
            if protected.contains(&player.id) {
                continue;
            }
            if let Some(survivor) = same_person_survivor(player, &pool) {
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

/// A stale-competition player left out of a new world.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DroppedStaleTwin {
    pub player_id: String,
    pub dropped_from: String,
    /// The live record of the same person, or empty when the record went for having no
    /// rating data at all (every attribute at 0).
    pub live_twin_id: String,
}

/// Stale-competition ids that are a different person from the live record sharing their
/// name. The name rule never drops them. Reviewed one by one.
const REVIEWED_STALE_NAMESAKES: [&str; 1] = [
    // Winner: the stale lck-cl record is a real second player named Winner.
    "player-c46f4677",
];

/// The live competition that replaces a stale duplicate one.
fn successor_competition(stale: &str) -> Option<&'static str> {
    STALE_DUPLICATE_COMPETITIONS
        .iter()
        .find(|(candidate, _)| *candidate == stale)
        .map(|(_, canonical)| *canonical)
}

/// Drop the records of a stale duplicate competition for people a live competition also
/// holds. A new world keeps no team of a stale competition, so its players would become free
/// agents next to the live record of the same person, and the AI market could sign both.
///
/// A stale record goes when any of these holds:
/// - **its successor league holds the name**: any folded name of the record (match or full
///   name, parenthesis and accents ignored, either way round) equals a folded name of a record
///   of the live league that replaces its file (`lck-cl` by `lckcl`, `prime_league` by `prm`).
///   The stale files ship the same people with birth dates a month off, a year-digit typo or
///   none, so the date is not part of the key;
/// - **it matches a live record by name and birth date** anywhere in the catalog (the
///   original rule, kept because a stale record can also duplicate a player of another league);
/// - **it carries no rating data**: all nine attributes are 0, a placeholder with nothing to
///   play.
///
/// Only a stale record that is a free agent or sits on a team of its own competition goes; a
/// record sharing its id with a live one is left to [`dedupe_players`]; a live record is never
/// dropped; reviewed namesakes ([`REVIEWED_STALE_NAMESAKES`]) never go by name. The function
/// only filters what a world is built from: it never touches a save, and on a rehydrate it
/// only decides which catalog records may be appended. `entries` pairs each player with the
/// competition it was loaded from; survivors keep their order.
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
    // Folded name -> id, per live competition that replaces a stale one.
    let mut successor_names: HashMap<(&str, String), &str> = HashMap::new();
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
        if STALE_DUPLICATE_COMPETITIONS
            .iter()
            .any(|(_, canonical)| canonical == competition)
        {
            for name in folded_names(player) {
                successor_names
                    .entry((competition.as_str(), name))
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
        let by_name = || {
            let successor = successor_competition(competition)?;
            if REVIEWED_STALE_NAMESAKES.contains(&player.id.as_str()) {
                return None;
            }
            folded_names(player).into_iter().find_map(|name| {
                successor_names
                    .get(&(successor, name))
                    .map(|id| id.to_string())
            })
        };
        let by_birth_date = || {
            let born = parse_date_of_birth(&player.date_of_birth)?;
            names(player)
                .into_iter()
                .find_map(|name| live_by_identity.get(&(name, born)).map(|id| id.to_string()))
        };
        let twin = removable
            .then(|| {
                by_name().or_else(by_birth_date).or_else(|| {
                    has_all_attributes_zero(player).then(String::new)
                })
            })
            .flatten();
        if let Some(live_twin_id) = &twin {
            dropped.push(DroppedStaleTwin {
                player_id: player.id.clone(),
                dropped_from: competition.clone(),
                live_twin_id: live_twin_id.clone(),
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

/// A record removed because another record of the same person survives.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CollapsedDuplicate {
    pub kept_id: String,
    pub dropped_id: String,
}

/// What a collapse knows about the records it chooses between.
pub struct CollapseEvidence<'a> {
    /// Whether a stat-derived rating override names this id: the override lands only there.
    pub has_rating_override: &'a dyn Fn(&str) -> bool,
    /// Ids a roster overlay op (move or add) names.
    pub overlay_op_ids: &'a HashSet<String>,
    /// Ids the overlay added without a team (the active-pros pool).
    pub pool_add_ids: &'a HashSet<String>,
}

/// Minimal union-find over record indexes.
fn find(parent: &mut [usize], mut i: usize) -> usize {
    while parent[i] != i {
        parent[i] = parent[parent[i]];
        i = parent[i];
    }
    i
}

/// Collapse the records of one person that a new world holds twice. It runs after the roster
/// overlay and before the roster fill, and removes the losers from `players` (the caller
/// tombstones them so a catalog rehydration does not bring them back).
///
/// Two records are one person when:
/// - they sit on the same club and share a folded name (match or full name, parenthesis and
///   accents ignored, either way round). Nationality and birth date are not tested: a stub
///   carries a guessed nationality and no date, and the nick and the real name swap places;
/// - or one is a pool add (a teamless overlay add) and the other is on a club, and they share
///   two folded names, for example the nick and a real name of two or more words;
/// - or a free agent and a contracted record share any folded name and the same birth date,
///   which must be readable and not the 2002-01-01 placeholder. A free agent that fits
///   records on two clubs is left alone, as are two clubs and two free agents: those need a
///   survivor chosen from the source.
///
/// The survivor of a group is the record, in this order of priority: that is on a club,
/// that is not a pool add,
/// that a stat-derived rating override names (the override lands only there), that an overlay
/// op names, that has a readable birth date and a real full name, that has a readable birth
/// date, that has a real full name, and finally the first in the list.
pub fn collapse_same_person_records(
    players: &mut Vec<Player>,
    evidence: &CollapseEvidence<'_>,
) -> Vec<CollapsedDuplicate> {
    let names: Vec<Vec<String>> = players.iter().map(folded_names).collect();
    let mut parent: Vec<usize> = (0..players.len()).collect();

    // Same club and a shared name.
    let mut by_club_name: HashMap<(&str, &str), usize> = HashMap::new();
    for (index, player) in players.iter().enumerate() {
        let Some(team) = player.team_id.as_deref() else {
            continue;
        };
        for name in &names[index] {
            match by_club_name.get(&(team, name.as_str())) {
                Some(&first) => {
                    let (a, b) = (find(&mut parent, first), find(&mut parent, index));
                    parent[b] = a;
                }
                None => {
                    by_club_name.insert((team, name.as_str()), index);
                }
            }
        }
    }

    // A pool add and a club record that share two names.
    let mut rostered_by_name: HashMap<&str, Vec<usize>> = HashMap::new();
    for (index, player) in players.iter().enumerate() {
        if player.team_id.is_some() {
            for name in &names[index] {
                rostered_by_name.entry(name.as_str()).or_default().push(index);
            }
        }
    }
    for (index, player) in players.iter().enumerate() {
        if player.team_id.is_some() || !evidence.pool_add_ids.contains(&player.id) {
            continue;
        }
        let mut shared: HashMap<usize, usize> = HashMap::new();
        for name in &names[index] {
            for &other in rostered_by_name.get(name.as_str()).into_iter().flatten() {
                *shared.entry(other).or_default() += 1;
            }
        }
        for (other, count) in shared {
            if count >= 2 {
                let (a, b) = (find(&mut parent, other), find(&mut parent, index));
                parent[b] = a;
            }
        }
    }

    // A free agent and a contracted record that share a name and a real birth date.
    let real_birth_date = |player: &Player| real_birth_date(&player.date_of_birth);
    for (index, player) in players.iter().enumerate() {
        if player.team_id.is_some() {
            continue;
        }
        let Some(born) = real_birth_date(player) else {
            continue;
        };
        let mut roots: Vec<usize> = Vec::new();
        for name in &names[index] {
            for &other in rostered_by_name.get(name.as_str()).into_iter().flatten() {
                if real_birth_date(&players[other]) == Some(born) {
                    let root = find(&mut parent, other);
                    if !roots.contains(&root) {
                        roots.push(root);
                    }
                }
            }
        }
        if let [root] = roots[..] {
            let own = find(&mut parent, index);
            parent[own] = root;
        }
    }

    let mut groups: HashMap<usize, Vec<usize>> = HashMap::new();
    for index in 0..players.len() {
        let root = find(&mut parent, index);
        groups.entry(root).or_default().push(index);
    }

    let priority = |index: usize| {
        let player = &players[index];
        let dated = parse_date_of_birth(&player.date_of_birth).is_some();
        let real_name = crate::person_identity::name_words(&player.full_name) >= 2
            && crate::person_identity::fold_name(&player.full_name)
                != crate::person_identity::fold_name(&player.match_name);
        (
            player.team_id.is_some(),
            !evidence.pool_add_ids.contains(&player.id),
            (evidence.has_rating_override)(&player.id),
            evidence.overlay_op_ids.contains(&player.id),
            dated && real_name,
            dated,
            real_name,
        )
    };

    let mut collapsed = Vec::new();
    let mut dropped_indexes = HashSet::new();
    let mut ordered: Vec<Vec<usize>> = groups.into_values().filter(|g| g.len() > 1).collect();
    ordered.sort_by_key(|group| group[0]);
    for group in ordered {
        // `max_by_key` keeps the last of equal keys; reverse so the first record wins a tie.
        let Some(&kept) = group.iter().rev().max_by_key(|&&index| priority(index)) else {
            continue;
        };
        for &index in group.iter().filter(|&&index| index != kept) {
            dropped_indexes.insert(index);
            collapsed.push(CollapsedDuplicate {
                kept_id: players[kept].id.clone(),
                dropped_id: players[index].id.clone(),
            });
        }
    }
    let mut index = 0;
    players.retain(|_| {
        let keep = !dropped_indexes.contains(&index);
        index += 1;
        keep
    });
    collapsed
}

/// Make the natural role of every player the lane he plays, for a new world. The catalog
/// ships a few dozen rows whose `natural_position` contradicts `position` (a jungler marked
/// Mid); the second record of the same person and the stats games say `position` is right,
/// and the club page already shows it. The roster fill and the repair read
/// `natural_position`, so with the bad field they signed a jungler into a Mid gap and counted
/// the gap closed. A position that is not a lane changes nothing. Returns how many records
/// changed. Never run on a save: a user edit of a natural role is his own.
pub fn align_natural_positions(players: &mut [Player]) -> usize {
    let mut changed = 0;
    for player in players {
        if player.position != LolRole::Unknown && player.natural_position != player.position {
            player.natural_position = player.position;
            changed += 1;
        }
    }
    changed
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
            rated(),
        );
        p.team_id = team.map(str::to_string);
        p
    }

    /// Attributes at 50: a rated record (the default is all zeros, a placeholder shell).
    fn rated() -> PlayerAttributes {
        PlayerAttributes {
            mechanics: 50,
            laning: 50,
            teamfighting: 50,
            macro_play: 50,
            consistency: 50,
            shotcalling: 50,
            champion_pool: 50,
            discipline: 50,
            mental_resilience: 50,
        }
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
    fn a_stale_player_with_another_name_or_no_twin_stays() {
        let live = born(
            player("live", "Densi", Some("prm-t1")),
            "Denis Real",
            "2003-06-03",
        );
        let other_name = born(player("other", "Kaiser", None), "Kaiser", "June 3, 2003");
        let no_date = born(player("no-date", "Pasu", None), "Pasu", "");
        let (kept, dropped) = drop_stale_twins_of_live_players(vec![
            ("prm".into(), live),
            ("prime_league".into(), other_name),
            ("prime_league".into(), no_date),
        ]);
        assert_eq!(ids(&kept), vec!["live", "other", "no-date"]);
        assert!(dropped.is_empty());
    }

    /// The stale file and its successor league disagree on the birth date (a month, a
    /// day-swap, a year digit, or a missing one): the name alone is the key.
    #[test]
    fn a_stale_twin_is_dropped_whatever_its_birth_date_says() {
        let cases = [
            ("kangin", "Kangin", "2003-01-14", "2003-03-14"),
            ("zephyr", "Zephyr", "2007-01-08", "2007-12-08"),
            ("ddoiv", "DDoiV", "2003-10-21", "2023-10-21"),
            ("seaz", "Seaz", "December 17, 2000", "2000-11-17"),
            ("cracker", "Cracker", "2008-01-20", ""),
            ("pasu", "Pasu", "", ""),
        ];
        for (id, nick, stale_dob, live_dob) in cases {
            let live = born(
                player(&format!("live-{id}"), nick, Some("lckcl-t1")),
                &format!("{nick} Real"),
                live_dob,
            );
            let stale = born(player(id, nick, None), nick, stale_dob);
            let (kept, dropped) = drop_stale_twins_of_live_players(vec![
                ("lckcl".into(), live),
                ("lck-cl".into(), stale),
            ]);
            assert_eq!(ids(&kept), vec![format!("live-{id}").as_str()], "{nick}");
            assert_eq!(dropped.len(), 1, "{nick}");
        }
    }

    #[test]
    fn a_stale_twin_with_its_nick_and_full_name_swapped_is_dropped() {
        let live = born(
            player("live", "Dinai", Some("lckcl-t1")),
            "Hwang Chi-hyeon",
            "2004-02-02",
        );
        let mut stale = born(player("stale", "Hwang Chi-hyeon", None), "Dinai", "");
        stale.date_of_birth = "2001-05-05".into();
        let (kept, _) = drop_stale_twins_of_live_players(vec![
            ("lckcl".into(), live),
            ("lck-cl".into(), stale),
        ]);
        assert_eq!(ids(&kept), vec!["live"]);
    }

    #[test]
    fn names_fold_accents_case_parentheses_and_html_entities() {
        let live = born(
            player("live", "Papiteero&nbsp;", Some("prm-t1")),
            "Pápiteero (Real)",
            "",
        );
        let stale = born(player("stale", "papiteero", None), "papiteero", "");
        let (kept, _) = drop_stale_twins_of_live_players(vec![
            ("prm".into(), live),
            ("prime_league".into(), stale),
        ]);
        assert_eq!(ids(&kept), vec!["live"]);
    }

    #[test]
    fn a_stale_record_is_only_matched_against_its_own_successor_league() {
        // A prime_league record whose name appears in lckcl, not in prm, stays.
        let live = born(player("live", "Seaz", Some("lckcl-t1")), "Seaz Real", "2000-01-01");
        let stale = born(player("stale", "Seaz", None), "Seaz", "1999-05-05");
        let (kept, _) = drop_stale_twins_of_live_players(vec![
            ("lckcl".into(), live),
            ("prime_league".into(), stale),
        ]);
        assert_eq!(ids(&kept), vec!["live", "stale"]);
    }

    #[test]
    fn a_stale_shell_with_every_attribute_at_zero_is_dropped_without_a_twin() {
        let mut shell = born(player("shell", "Dome", None), "Dome", "2001-01-01");
        shell.attributes = PlayerAttributes::default();
        let rated = born(player("rated", "Rin", None), "Rin", "2001-01-01");
        let (kept, dropped) = drop_stale_twins_of_live_players(vec![
            ("prime_league".into(), shell),
            ("prime_league".into(), rated),
        ]);
        assert_eq!(ids(&kept), vec!["rated"]);
        assert_eq!(dropped[0].player_id, "shell");
    }

    #[test]
    fn a_live_zero_attribute_record_is_never_dropped() {
        let mut shell = born(player("live-shell", "Dome", Some("prm-t1")), "Dome", "");
        shell.attributes = PlayerAttributes::default();
        let (kept, _) = drop_stale_twins_of_live_players(vec![("prm".into(), shell)]);
        assert_eq!(ids(&kept), vec!["live-shell"]);
    }

    #[test]
    fn a_reviewed_namesake_survives_the_name_rule() {
        let live = born(
            player("player-eddde7b7", "Winner", Some("lckcl-t1")),
            "Winner Real",
            "2000-01-01",
        );
        let stale = born(player("player-c46f4677", "Winner", None), "Winner", "1999-09-09");
        let (kept, _) = drop_stale_twins_of_live_players(vec![
            ("lckcl".into(), live),
            ("lck-cl".into(), stale),
        ]);
        assert_eq!(ids(&kept), vec!["player-eddde7b7", "player-c46f4677"]);
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

    fn on_team(mut p: Player, team: &str) -> Player {
        p.team_id = Some(team.to_string());
        p
    }

    fn collapse(
        players: &mut Vec<Player>,
        overrides: &[&str],
        ops: &[&str],
        pool: &[&str],
    ) -> Vec<CollapsedDuplicate> {
        let overrides: HashSet<String> = overrides.iter().map(|id| id.to_string()).collect();
        let has_override = |id: &str| overrides.contains(id);
        let overlay_op_ids: HashSet<String> = ops.iter().map(|id| id.to_string()).collect();
        let pool_add_ids: HashSet<String> = pool.iter().map(|id| id.to_string()).collect();
        collapse_same_person_records(
            players,
            &CollapseEvidence {
                has_rating_override: &has_override,
                overlay_op_ids: &overlay_op_ids,
                pool_add_ids: &pool_add_ids,
            },
        )
    }

    fn player_ids(players: &[Player]) -> Vec<&str> {
        players.iter().map(|p| p.id.as_str()).collect()
    }

    /// Ace of Senshi eSports. The overlay of 2026-11-14 (b084a971) added him from his Leaguepedia page as the
    /// teamless pool add `5236c06a`; the hll catalog already holds the merged record `cea7803b` ("Ace (Ignacio
    /// David Piaggio)", UY, ADC) and the nick-only stub `2ba313af`, both on Senshi. Leaguepedia reads Ignacio David
    /// Piaggio, Uruguay, Bot, Senshi eSports (cache world-2026-11-16, page "Ace (Ignacio David Piaggio)"). A world
    /// that still holds the three records ends with exactly one Ace, the catalog record, and both losers are
    /// reported so the caller tombstones them in `retired_player_ids`.
    #[test]
    fn a_world_holding_the_old_pool_add_of_ace_keeps_only_the_catalog_record() {
        let merged = born(
            on_team(player("player-cea7803b", "Ace (Ignacio David Piaggio)", None), "hll-team-ca24ae43"),
            "Ignacio David Piaggio",
            "",
        );
        let stub = born(on_team(player("player-2ba313af", "Ace", None), "hll-team-ca24ae43"), "Ace", "");
        let pool_add = born(player("player-5236c06a", "Ace", None), "Ignacio David Piaggio", "");
        let mut players = vec![stub, pool_add, merged];
        let collapsed = collapse(&mut players, &[], &[], &["player-5236c06a"]);
        assert_eq!(player_ids(&players), vec!["player-cea7803b"]);
        let mut dropped: Vec<&str> = collapsed.iter().map(|c| c.dropped_id.as_str()).collect();
        dropped.sort_unstable();
        assert_eq!(dropped, vec!["player-2ba313af", "player-5236c06a"]);
        assert!(collapsed.iter().all(|c| c.kept_id == "player-cea7803b"));
    }

    #[test]
    fn a_nick_only_stub_collapses_into_the_real_record_on_the_same_club() {
        let stub = born(on_team(player("stub", "Samkz", None), "cd-t1"), "Samkz", "");
        let real = born(
            on_team(player("real", "Samkz", None), "cd-t1"),
            "Samuel Pereira Rosa",
            "2003-03-04",
        );
        let mut players = vec![stub, real];
        let collapsed = collapse(&mut players, &[], &[], &[]);
        assert_eq!(player_ids(&players), vec!["real"]);
        assert_eq!(
            collapsed,
            vec![CollapsedDuplicate {
                kept_id: "real".into(),
                dropped_id: "stub".into()
            }]
        );
    }

    #[test]
    fn the_record_with_a_rating_override_survives_over_one_with_a_date_of_birth() {
        let dated = born(
            on_team(player("dated", "Sankaizer", None), "lplol-t1"),
            "Sankaizer Real",
            "2003-05-07",
        );
        let overridden = born(on_team(player("overridden", "Sankaizer", None), "lplol-t1"), "Sankaizer", "");
        let mut players = vec![dated, overridden];
        collapse(&mut players, &["overridden"], &["dated"], &[]);
        assert_eq!(player_ids(&players), vec!["overridden"]);
    }

    #[test]
    fn the_record_an_overlay_op_names_survives_over_one_with_a_date_of_birth() {
        let dated = born(
            on_team(player("dated", "Kaii", None), "les-t1"),
            "Jorge Saiz Hoyos",
            "2005-01-01",
        );
        let named = born(on_team(player("named", "Kaii", None), "les-t1"), "Jorge Saiz Hoyos", "");
        let mut players = vec![dated, named];
        collapse(&mut players, &[], &["named"], &[]);
        assert_eq!(player_ids(&players), vec!["named"]);
    }

    #[test]
    fn swapped_match_and_full_names_are_one_person_on_a_club() {
        let a = born(on_team(player("a", "Jorge Saiz Hoyos", None), "les-t1"), "Kaii", "2005-01-01");
        let b = born(on_team(player("b", "Kaii", None), "les-t1"), "Jorge Saiz Hoyos", "2004-07-08");
        let mut players = vec![a, b];
        assert_eq!(collapse(&mut players, &[], &[], &[]).len(), 1);
        assert_eq!(players.len(), 1);
    }

    #[test]
    fn the_nationality_of_a_stub_does_not_keep_it_apart() {
        let mut stub = born(on_team(player("stub", "Ace", None), "hll-t1"), "Ace", "");
        stub.nationality = "ES".into();
        let mut real = born(
            on_team(player("real", "Ace (Ignacio David Piaggio)", None), "hll-t1"),
            "Ignacio David Piaggio",
            "2007-04-18",
        );
        real.nationality = "CU".into();
        let mut players = vec![stub, real];
        collapse(&mut players, &[], &[], &[]);
        assert_eq!(player_ids(&players), vec!["real"]);
    }

    #[test]
    fn the_same_name_on_two_clubs_or_in_the_market_is_left_alone() {
        let a = born(on_team(player("a", "Daglas", None), "lec-t1"), "Kacper Dagiel", "2005-10-23");
        let b = born(on_team(player("b", "Daglas", None), "les-t1"), "Kacper Dagiel", "2005-10-23");
        let c = born(player("c", "Daglas", None), "Daglas", "");
        let d = born(player("d", "Daglas", None), "Daglas", "");
        let mut players = vec![a, b, c, d];
        assert!(collapse(&mut players, &[], &[], &[]).is_empty());
        assert_eq!(players.len(), 4);
    }

    #[test]
    fn three_records_on_a_club_leave_one() {
        let a = born(on_team(player("a", "Cracker", None), "t1"), "Cracker", "");
        let b = born(on_team(player("b", "Cracker", None), "t1"), "Lee Jeong-wook", "2008-01-20");
        let c = born(on_team(player("c", "Lee Jeong-wook", None), "t1"), "Cracker", "");
        let mut players = vec![a, b, c];
        let collapsed = collapse(&mut players, &[], &[], &[]);
        assert_eq!(player_ids(&players), vec!["b"]);
        assert_eq!(collapsed.len(), 2);
    }

    #[test]
    fn equal_evidence_keeps_the_first_record() {
        let a = born(on_team(player("a", "Pasu", None), "t1"), "Pasu", "");
        let b = born(on_team(player("b", "Pasu", None), "t1"), "Pasu", "");
        let mut players = vec![a, b];
        collapse(&mut players, &[], &[], &[]);
        assert_eq!(player_ids(&players), vec!["a"]);
    }

    #[test]
    fn a_pool_add_collapses_into_the_rostered_record_it_shares_two_names_with() {
        let rostered = born(
            on_team(player("rostered", "Ace (Ignacio David Piaggio)", None), "hll-t1"),
            "Ignacio David Piaggio",
            "2007-04-18",
        );
        let mut pool = born(player("pool", "Ace", None), "Ignacio David Piaggio", "2002-06-16");
        pool.nationality = "UY".into();
        let mut players = vec![pool, rostered];
        let collapsed = collapse(&mut players, &[], &["pool"], &["pool"]);
        assert_eq!(player_ids(&players), vec!["rostered"]);
        assert_eq!(collapsed[0].dropped_id, "pool");
    }

    #[test]
    fn a_pool_add_sharing_only_a_common_name_stays_a_free_agent() {
        let rostered = born(on_team(player("rostered", "Vin", None), "vcs-t1"), "Tran Hoai Vinh", "2003-03-21");
        let pool = born(player("pool", "Vin", None), "Elvin Berisha", "2003-02-06");
        let mut players = vec![pool, rostered];
        assert!(collapse(&mut players, &[], &["pool"], &["pool"]).is_empty());
        assert_eq!(players.len(), 2);
    }

    #[test]
    fn a_free_agent_that_is_not_a_pool_add_is_not_collapsed_into_a_club_record() {
        let rostered = born(
            on_team(player("rostered", "Lehends", None), "lck-t1"),
            "Son Si-woo",
            "1998-12-24",
        );
        let ghost = born(player("ghost", "Lehends", None), "Son Si-woo", "");
        let mut players = vec![ghost, rostered];
        assert!(collapse(&mut players, &[], &[], &[]).is_empty());
    }

    #[test]
    fn a_free_agent_with_a_swapped_name_and_the_same_birth_date_collapses_into_the_contracted_record()
     {
        let contracted = born(
            on_team(player("club", "Koldo", None), "es-t1"),
            "Luis Perez Garcia",
            "2000-11-07",
        );
        let free_agent = born(
            player("fa", "Luis Perez Garcia", None),
            "Koldo",
            "2000-11-07",
        );
        let mut players = vec![free_agent, contracted];
        let collapsed = collapse(&mut players, &[], &[], &[]);
        assert_eq!(player_ids(&players), vec!["club"]);
        assert_eq!(
            collapsed,
            vec![CollapsedDuplicate {
                kept_id: "club".into(),
                dropped_id: "fa".into()
            }]
        );
    }

    #[test]
    fn the_contracted_record_survives_even_when_the_free_agent_has_the_rating_override() {
        let contracted = born(
            on_team(player("club", "Deadly", None), "t1"),
            "Deadly",
            "2006-08-19",
        );
        let free_agent = born(player("fa", "DeadlyMark", None), "Deadly", "2006-08-19");
        let mut players = vec![free_agent, contracted];
        collapse(&mut players, &["fa"], &[], &[]);
        assert_eq!(player_ids(&players), vec!["club"]);
    }

    #[test]
    fn a_free_agent_sharing_a_name_with_another_birth_date_stays() {
        let contracted = born(
            on_team(player("club", "Castle", None), "t1"),
            "Cho Hyeon-seong",
            "2002-10-08",
        );
        let free_agent = born(player("fa", "Castle", None), "Matthew Castle", "2002-08-20");
        let mut players = vec![free_agent, contracted];
        assert!(collapse(&mut players, &[], &[], &[]).is_empty());
    }

    #[test]
    fn the_placeholder_birth_date_never_collapses_a_free_agent() {
        let contracted = born(
            on_team(player("club", "Nick", None), "t1"),
            "Real One",
            "2002-01-01",
        );
        let free_agent = born(player("fa", "Nick", None), "Other Real", "2002-01-01");
        let mut players = vec![free_agent, contracted];
        assert!(collapse(&mut players, &[], &[], &[]).is_empty());
    }

    #[test]
    fn two_free_agents_with_one_birth_date_are_left_to_review() {
        let a = born(
            player("a", "Chapters", None),
            "Leandro Paiano",
            "2005-01-17",
        );
        let b = born(player("b", "KUMEW", None), "Leandro Paiano", "2005-01-17");
        let mut players = vec![a, b];
        assert!(collapse(&mut players, &[], &[], &[]).is_empty());
    }

    #[test]
    fn a_free_agent_that_fits_two_clubs_is_left_alone() {
        let one = born(
            on_team(player("one", "Legolas", None), "t1"),
            "Sergio Vicente",
            "2000-12-20",
        );
        let two = born(
            on_team(player("two", "Legolas", None), "t2"),
            "Sergio Vicente",
            "2000-12-20",
        );
        let free_agent = born(
            player("fa", "Legolas", None),
            "Sergio Vicente",
            "2000-12-20",
        );
        let mut players = vec![free_agent, one, two];
        assert!(collapse(&mut players, &[], &[], &[]).is_empty());
        assert_eq!(players.len(), 3);
    }

    #[test]
    fn a_lane_position_becomes_the_natural_position() {
        let mut jungler = player("jungler", "Cariok", None);
        jungler.position = LolRole::Jungle;
        jungler.natural_position = LolRole::Mid;
        let mut agreeing = player("agreeing", "Faker", None);
        agreeing.position = LolRole::Mid;
        agreeing.natural_position = LolRole::Mid;
        let mut players = vec![jungler, agreeing];
        assert_eq!(align_natural_positions(&mut players), 1);
        assert_eq!(players[0].natural_position, LolRole::Jungle);
        assert_eq!(players[0].position, LolRole::Jungle);
        assert_eq!(players[1].natural_position, LolRole::Mid);
    }

    #[test]
    fn a_position_that_is_not_a_lane_leaves_the_natural_position_alone() {
        let mut unknown = player("unknown", "Nobody", None);
        unknown.position = LolRole::Unknown;
        unknown.natural_position = LolRole::Support;
        let mut players = vec![unknown];
        assert_eq!(align_natural_positions(&mut players), 0);
        assert_eq!(players[0].natural_position, LolRole::Support);
    }
}
