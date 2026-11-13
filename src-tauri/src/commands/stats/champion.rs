//! Champion page stats, computed from the in-memory `StatsState`.
//!
//! This is a port of the SQL in `olm_core::db::repositories::champion_stats_repo`, which the
//! single-file save system left without a database to run on. A "game" is one
//! `PlayerMatchStatsRecord`: one player in one fixture, so a best-of series counts once, with the
//! series' summed stats. Pick and ban rates divide by every player record, as the SQL did.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use chrono::{Duration, NaiveDate};
use olm_core::domain::stats::{MatchOutcome, PlayerMatchStatsRecord, StatsState};
use olm_core::game::Game;
use olm_core::meta_relationships::canonical_champion_id;
use olm_core::state::StateManager;

use super::dto::{
    ChampionMatchupDto, ChampionRoleShareDto, ChampionStatsDto, ChampionTopPlayerDto,
    ChampionWeekDto,
};

/// Matchups and top players need at least this many games, as in the SQL (`HAVING games >= 3`).
const MIN_GAMES: u32 = 3;
const TOP_PLAYERS: usize = 5;
const HISTORY_WEEKS: i64 = 10;

pub(super) fn get_champion_stats_internal(
    state: &StateManager,
    champion_key: &str,
) -> Result<ChampionStatsDto, String> {
    let (today, directory) = state
        .get_game(|game| {
            (
                game.clock.current_date.date_naive(),
                PlayerDirectory::of(game),
            )
        })
        .ok_or("No active game session".to_string())?;
    state
        .get_stats_state(|stats| build_champion_stats(stats, champion_key, &directory, today))
        .ok_or("No active game session".to_string())
}

/// Player and team names the page shows next to the numbers.
#[derive(Default)]
pub(super) struct PlayerDirectory {
    players: HashMap<String, (String, String)>,
}

impl PlayerDirectory {
    pub(super) fn of(game: &Game) -> Self {
        let team_names: HashMap<&str, &str> = game
            .teams
            .iter()
            .map(|team| (team.id.as_str(), team.name.as_str()))
            .collect();
        let players = game
            .players
            .iter()
            .map(|player| {
                let team_name = player
                    .team_id
                    .as_deref()
                    .and_then(|id| team_names.get(id))
                    .map_or_else(String::new, |name| (*name).to_string());
                (player.id.clone(), (player.match_name.clone(), team_name))
            })
            .collect();
        Self { players }
    }

    fn describe(&self, player_id: &str) -> (String, String) {
        self.players
            .get(player_id)
            .cloned()
            .unwrap_or_else(|| (player_id.to_string(), String::new()))
    }
}

/// Zero when the value is NaN or infinite: serde writes those as `null`, which the page cannot read.
fn finite(value: f64) -> f64 {
    if value.is_finite() { value } else { 0.0 }
}

fn round_to(value: f64, digits: i32) -> f64 {
    let factor = 10_f64.powi(digits);
    finite((value * factor).round() / factor)
}

fn percent(part: u32, whole: u32) -> f64 {
    if whole == 0 {
        return 0.0;
    }
    round_to(f64::from(part) / f64::from(whole) * 100.0, 1)
}

fn mean(total: u64, count: u32) -> f64 {
    if count == 0 {
        0.0
    } else {
        total as f64 / f64::from(count)
    }
}

fn kda(kills_plus_assists: f64, deaths: f64) -> f64 {
    if deaths > 0.0 {
        kills_plus_assists / deaths
    } else {
        kills_plus_assists
    }
}

fn picked(record: &PlayerMatchStatsRecord, key: &str) -> bool {
    record
        .champion
        .as_deref()
        .is_some_and(|champion| canonical_champion_id(champion) == key)
}

fn is_win(record: &PlayerMatchStatsRecord) -> bool {
    record.result == MatchOutcome::Win
}

fn parse_date(value: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(value.get(..10)?, "%Y-%m-%d").ok()
}

pub(super) fn build_champion_stats(
    stats: &StatsState,
    champion_key: &str,
    directory: &PlayerDirectory,
    today: NaiveDate,
) -> ChampionStatsDto {
    // Both sides go through one canonical form, so "MonkeyKing", "Wukong" and "monkeyking" agree.
    let key = canonical_champion_id(champion_key);
    let records: Vec<&PlayerMatchStatsRecord> = stats
        .player_matches
        .iter()
        .filter(|record| picked(record, &key))
        .collect();

    let total_games = records.len() as u32;
    let total_wins = records.iter().filter(|record| is_win(record)).count() as u32;
    let sum = |value: fn(&PlayerMatchStatsRecord) -> u64| -> u64 {
        records.iter().map(|record| value(record)).sum()
    };
    let avg_kills = round_to(mean(sum(|r| u64::from(r.kills)), total_games), 1);
    let avg_deaths = round_to(mean(sum(|r| u64::from(r.deaths)), total_games), 1);
    let avg_assists = round_to(mean(sum(|r| u64::from(r.assists)), total_games), 1);
    let total_records = stats.player_matches.len() as u32;
    let (best_against, worst_against) = matchups(stats, &key, &records);

    ChampionStatsDto {
        champion_key: champion_key.to_string(),
        champion_name: champion_key.to_string(),
        total_games,
        total_wins,
        win_rate: percent(total_wins, total_games),
        pick_rate: percent(total_games, total_records),
        ban_rate: percent(ban_count(stats, &key), total_records),
        avg_kills,
        avg_deaths,
        avg_assists,
        avg_kda: round_to(kda(avg_kills + avg_assists, avg_deaths), 2),
        avg_gold: round_to(mean(sum(|r| u64::from(r.gold_earned)), total_games), 0),
        avg_damage: round_to(mean(sum(|r| u64::from(r.damage_dealt)), total_games), 0),
        avg_cs: round_to(mean(sum(|r| u64::from(r.creep_score)), total_games), 0),
        avg_vision: round_to(mean(sum(|r| u64::from(r.vision_score)), total_games), 1),
        avg_duration: round_to(mean(sum(|r| u64::from(r.duration_seconds)), total_games), 0),
        role_distribution: role_distribution(&records),
        best_against,
        worst_against,
        top_players: top_players(&records, directory),
        weekly_history: weekly_history(&records, today),
    }
}

/// Fixtures where the champion was banned. The SQL counted distinct fixtures with a matching
/// `bans_json`; every player record of a fixture carries the same list.
fn ban_count(stats: &StatsState, key: &str) -> u32 {
    let banned: BTreeSet<&str> = stats
        .player_matches
        .iter()
        .filter(|record| {
            serde_json::from_str::<Vec<String>>(&record.bans_json)
                .is_ok_and(|bans| bans.iter().any(|ban| canonical_champion_id(ban) == key))
        })
        .map(|record| record.fixture_id.as_str())
        .collect();
    banned.len() as u32
}

fn role_distribution(records: &[&PlayerMatchStatsRecord]) -> Vec<ChampionRoleShareDto> {
    let mut by_role: BTreeMap<String, u32> = BTreeMap::new();
    for record in records {
        let role = serde_json::to_value(record.role)
            .ok()
            .and_then(|value| value.as_str().map(str::to_string))
            .unwrap_or_default();
        *by_role.entry(role).or_default() += 1;
    }
    let total = records.len() as u32;
    let mut shares: Vec<ChampionRoleShareDto> = by_role
        .into_iter()
        .map(|(role, games)| ChampionRoleShareDto {
            role,
            games,
            percentage: percent(games, total),
        })
        .collect();
    shares.sort_by_key(|share| std::cmp::Reverse(share.games));
    shares
}

/// Best and worst matchups: the other team's champions in the same fixtures, kept when met at least
/// `MIN_GAMES` times. As in the SQL, the top half by win rate is "best" and the bottom half
/// "worst", so fewer than two qualifying opponents leave both empty.
fn matchups(
    stats: &StatsState,
    key: &str,
    mine: &[&PlayerMatchStatsRecord],
) -> (Vec<ChampionMatchupDto>, Vec<ChampionMatchupDto>) {
    let mut by_fixture: HashMap<&str, Vec<&PlayerMatchStatsRecord>> = HashMap::new();
    for record in &stats.player_matches {
        by_fixture
            .entry(record.fixture_id.as_str())
            .or_default()
            .push(record);
    }

    // canonical opponent key -> (key as recorded, games, wins)
    let mut tally: BTreeMap<String, (String, u32, u32)> = BTreeMap::new();
    for record in mine {
        let Some(fixture) = by_fixture.get(record.fixture_id.as_str()) else {
            continue;
        };
        for opponent in fixture {
            let Some(champion) = opponent.champion.as_deref().filter(|c| !c.is_empty()) else {
                continue;
            };
            if opponent.team_id == record.team_id || canonical_champion_id(champion) == key {
                continue;
            }
            let entry = tally
                .entry(canonical_champion_id(champion))
                .or_insert_with(|| (champion.to_string(), 0, 0));
            entry.1 += 1;
            if is_win(record) {
                entry.2 += 1;
            }
        }
    }

    let mut all: Vec<ChampionMatchupDto> = tally
        .into_values()
        .filter(|(_, games, _)| *games >= MIN_GAMES)
        .map(|(champion, games, wins)| ChampionMatchupDto {
            vs_champion_name: champion.clone(),
            vs_champion_key: champion,
            games,
            wins,
            win_rate: percent(wins, games),
        })
        .collect();
    all.sort_by(|a, b| {
        b.win_rate
            .total_cmp(&a.win_rate)
            .then_with(|| b.games.cmp(&a.games))
            .then_with(|| a.vs_champion_key.cmp(&b.vs_champion_key))
    });
    let half = all.len() / 2;
    let best = all.iter().take(half).cloned().collect();
    let worst = all.iter().rev().take(half).cloned().collect();
    (best, worst)
}

fn top_players(
    records: &[&PlayerMatchStatsRecord],
    directory: &PlayerDirectory,
) -> Vec<ChampionTopPlayerDto> {
    // player id -> (games, wins, kills + assists, deaths)
    let mut by_player: BTreeMap<&str, (u32, u32, u64, u64)> = BTreeMap::new();
    for record in records {
        let entry = by_player.entry(record.player_id.as_str()).or_default();
        entry.0 += 1;
        entry.1 += u32::from(is_win(record));
        entry.2 += u64::from(record.kills) + u64::from(record.assists);
        entry.3 += u64::from(record.deaths);
    }
    let mut players: Vec<ChampionTopPlayerDto> = by_player
        .into_iter()
        .filter(|(_, (games, ..))| *games >= MIN_GAMES)
        .map(|(player_id, (games, wins, kills_plus_assists, deaths))| {
            let (player_name, team_name) = directory.describe(player_id);
            ChampionTopPlayerDto {
                player_id: player_id.to_string(),
                player_name,
                team_name,
                games,
                win_rate: percent(wins, games),
                avg_kda: round_to(kda(kills_plus_assists as f64, deaths as f64), 1),
            }
        })
        .collect();
    players.sort_by(|a, b| {
        b.win_rate
            .total_cmp(&a.win_rate)
            .then_with(|| b.games.cmp(&a.games))
            .then_with(|| a.player_id.cmp(&b.player_id))
    });
    players.truncate(TOP_PLAYERS);
    players
}

/// Weekly lines for the last `HISTORY_WEEKS` weeks of the game clock, oldest first. The SQL used the
/// wall clock; the game clock keeps this deterministic and in step with the save.
fn weekly_history(records: &[&PlayerMatchStatsRecord], today: NaiveDate) -> Vec<ChampionWeekDto> {
    let since = today - Duration::weeks(HISTORY_WEEKS);
    // week label -> (games, wins, kills + assists, deaths)
    let mut by_week: BTreeMap<String, (u32, u32, u64, u64)> = BTreeMap::new();
    for record in records {
        let Some(date) = parse_date(&record.date).filter(|date| *date >= since) else {
            continue;
        };
        let week = date.format("%Y-W%W").to_string();
        let entry = by_week.entry(week).or_default();
        entry.0 += 1;
        entry.1 += u32::from(is_win(record));
        entry.2 += u64::from(record.kills) + u64::from(record.assists);
        entry.3 += u64::from(record.deaths);
    }
    by_week
        .into_iter()
        .map(
            |(week_label, (games, wins, kills_plus_assists, deaths))| ChampionWeekDto {
                week_label,
                games,
                win_rate: percent(wins, games),
                avg_kda: round_to(kda(kills_plus_assists as f64, deaths as f64), 1),
            },
        )
        .collect()
}
