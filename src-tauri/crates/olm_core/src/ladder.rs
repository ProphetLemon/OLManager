//! Persisted ladder ledger.
//!
//! Promotion and relegation between linked leagues need to know how a whole season
//! went, not just the final split: a relegation ranking must use the summed
//! regular-season records of every split. The ledger keeps a running tally per
//! competition, closes it into a [`SeasonOutcome`] when the season ends, and keeps a
//! short history of the outcomes and of the movements applied from them.
//!
//! This module only records. Applying a promotion or relegation is a separate step
//! that reads the ledger.
//!
//! Recording is idempotent: a split (or season) that was already recorded is ignored,
//! so a retried rollover cannot double count.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
#[cfg(feature = "typescript")]
use ts_rs::TS;

use crate::domain::league::{League, StandingEntry};
use crate::end_of_season::{effective_final_position, playoff_champion_id};
use crate::game::Game;

/// Outcomes kept per competition; older ones are dropped first.
pub const MAX_OUTCOMES_PER_COMPETITION: usize = 4;
/// Movements kept in total; older ones are dropped first.
pub const MAX_MOVEMENTS: usize = 12;

/// Running totals of one competition's regular-season records for the season in
/// progress.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS))]
#[cfg_attr(feature = "typescript", ts(export))]
#[serde(default)]
pub struct SeasonTally {
    /// Season the totals belong to. A tally from an older season is discarded.
    pub season: u32,
    /// Number of splits already added.
    pub splits: u8,
    /// Index of the last split added; guards against recording a split twice.
    pub last_split: Option<usize>,
    /// Summed standings rows by team id.
    pub rows: BTreeMap<String, StandingEntry>,
}

/// How a finished season ended for one competition.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS))]
#[cfg_attr(feature = "typescript", ts(export))]
#[serde(default)]
pub struct SeasonOutcome {
    pub competition_id: String,
    pub season: u32,
    /// Playoff winner of the final split, or the regular-season leader when the
    /// split had no decided playoff final.
    pub champion_id: Option<String>,
    /// Team ids from first to last: champion, finalist, then the rest by their
    /// final-split rank.
    pub final_order: Vec<String>,
    /// Season-long regular-season table (every split summed), best first.
    pub season_table: Vec<StandingEntry>,
}

/// Result of trying to apply a ladder link for one season.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS))]
#[cfg_attr(feature = "typescript", ts(export))]
pub enum LadderMovementStatus {
    /// The swap was carried out.
    #[default]
    Applied,
    /// The next season had already started, so nothing moved.
    SkippedLate,
    /// The lower league had no team eligible to go up.
    NoEligible,
}

/// A promotion and relegation decision between two linked leagues.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS))]
#[cfg_attr(feature = "typescript", ts(export))]
#[serde(default)]
pub struct LadderMovement {
    pub link_lower: String,
    pub link_upper: String,
    pub season: u32,
    pub promoted: Vec<String>,
    pub relegated: Vec<String>,
    pub status: LadderMovementStatus,
}

/// The ledger stored on the game.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS))]
#[cfg_attr(feature = "typescript", ts(export))]
#[serde(default)]
pub struct LadderState {
    /// Season in progress, by competition id.
    pub tallies: BTreeMap<String, SeasonTally>,
    /// Closed seasons, oldest first.
    pub outcomes: Vec<SeasonOutcome>,
    /// Decisions taken between linked leagues, oldest first.
    pub movements: Vec<LadderMovement>,
}

impl LadderState {
    /// The recorded outcome of `competition_id` for `season`, if the season closed.
    pub fn outcome(&self, competition_id: &str, season: u32) -> Option<&SeasonOutcome> {
        self.outcomes
            .iter()
            .find(|o| o.competition_id == competition_id && o.season == season)
    }

    /// Append a movement and drop the oldest ones beyond [`MAX_MOVEMENTS`].
    pub fn record_movement(&mut self, movement: LadderMovement) {
        self.movements.push(movement);
        let excess = self.movements.len().saturating_sub(MAX_MOVEMENTS);
        self.movements.drain(..excess);
    }

    fn push_outcome(&mut self, outcome: SeasonOutcome) {
        let competition_id = outcome.competition_id.clone();
        self.outcomes.push(outcome);
        let mut to_drop = self
            .outcomes
            .iter()
            .filter(|o| o.competition_id == competition_id)
            .count()
            .saturating_sub(MAX_OUTCOMES_PER_COMPETITION);
        self.outcomes.retain(|o| {
            if to_drop > 0 && o.competition_id == competition_id {
                to_drop -= 1;
                false
            } else {
                true
            }
        });
    }
}

/// Best-first ordering of summed rows, using the same rules as a league table.
fn rank_rows(rows: Vec<StandingEntry>) -> Vec<StandingEntry> {
    League {
        standings: rows,
        ..League::default()
    }
    .sorted_standings()
}

/// Add the league's current standings to its competition's tally. Returns `false`
/// without changing anything when this split was already added.
fn add_split(ladder: &mut LadderState, league: &League, competition_id: &str) -> bool {
    let tally = ladder
        .tallies
        .entry(competition_id.to_string())
        .or_default();
    if tally.season != league.season {
        *tally = SeasonTally {
            season: league.season,
            ..SeasonTally::default()
        };
    }
    if tally
        .last_split
        .is_some_and(|last| last >= league.split_index)
    {
        return false;
    }
    for standing in &league.standings {
        let row = tally
            .rows
            .entry(standing.team_id.clone())
            .or_insert_with(|| StandingEntry::new(standing.team_id.clone()));
        row.played += standing.played;
        row.won += standing.won;
        row.lost += standing.lost;
        row.maps_won += standing.maps_won;
        row.maps_lost += standing.maps_lost;
        row.points += standing.points;
    }
    tally.splits = tally.splits.saturating_add(1);
    tally.last_split = Some(league.split_index);
    true
}

/// Team ids from first to last once playoffs are taken into account.
///
/// Orders by [`effective_final_position`] (champion, finalist, semifinal losers)
/// and breaks ties by the regular-season rank, so the order is deterministic.
pub fn effective_final_order(league: &League) -> Vec<String> {
    let mut keyed: Vec<(u32, usize, String)> = league
        .sorted_standings()
        .into_iter()
        .enumerate()
        .map(|(rank, s)| {
            (
                effective_final_position(league, &s.team_id),
                rank,
                s.team_id,
            )
        })
        .collect();
    keyed.sort_by_key(|(position, rank, _)| (*position, *rank));
    keyed.into_iter().map(|(_, _, team_id)| team_id).collect()
}

/// The `n` worst teams of a season, worst first, ranked on the season-long table
/// rather than on the final split alone. Ties keep a stable order.
pub fn worst_teams(outcome: &SeasonOutcome, n: usize) -> Vec<String> {
    rank_rows(outcome.season_table.clone())
        .into_iter()
        .rev()
        .take(n)
        .map(|s| s.team_id)
        .collect()
}

/// Add the standings of the split that just finished in `game.leagues[league_index]`
/// to the season tally. Call it at a split end that does not close the season.
/// Does nothing for an unknown index, a league without a competition id, or a split
/// that was already recorded.
pub fn record_split_end(game: &mut Game, league_index: usize) {
    let Some(league) = game.leagues.get(league_index) else {
        return;
    };
    let Some(competition_id) = league.competition_id.as_deref() else {
        return;
    };
    add_split(&mut game.ladder, league, competition_id);
}

/// Close the season of `game.leagues[league_index]`: add its final split, write the
/// [`SeasonOutcome`] and clear the tally. Call it before the league's standings are
/// consumed by the end-of-season. Does nothing when the outcome for that season
/// exists already.
///
/// A game saved before the ledger existed has no tally, so its first outcome ranks
/// the final split alone (the partial season).
pub fn record_season_end(game: &mut Game, league_index: usize) {
    let Some(league) = game.leagues.get(league_index) else {
        return;
    };
    let Some(competition_id) = league.competition_id.clone() else {
        return;
    };
    if game
        .ladder
        .outcome(&competition_id, league.season)
        .is_some()
    {
        return;
    }
    add_split(&mut game.ladder, league, &competition_id);
    let tally = game
        .ladder
        .tallies
        .remove(&competition_id)
        .unwrap_or_default();
    let champion_id = playoff_champion_id(league).or_else(|| {
        league
            .sorted_standings()
            .first()
            .map(|standing| standing.team_id.clone())
    });
    game.ladder.push_outcome(SeasonOutcome {
        competition_id,
        season: league.season,
        champion_id,
        final_order: effective_final_order(league),
        season_table: rank_rows(tally.rows.into_values().collect()),
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::GameClock;
    use crate::domain::league::{Fixture, FixtureStatus, MatchResult, MatchType};
    use crate::domain::manager::Manager;
    use chrono::{TimeZone, Utc};

    fn game() -> Game {
        let manager = Manager::new(
            "mgr".to_string(),
            "Test".to_string(),
            "Manager".to_string(),
            "1980-01-01".to_string(),
            "England".to_string(),
        );
        Game::new(
            GameClock::new(Utc.with_ymd_and_hms(2025, 6, 15, 12, 0, 0).unwrap()),
            manager,
            vec![],
            vec![],
            vec![],
            vec![],
        )
    }

    /// A split league whose teams hold the given points (three games each).
    fn split(
        competition_id: &str,
        season: u32,
        split_index: usize,
        rows: &[(&str, u32)],
    ) -> League {
        League {
            id: competition_id.to_string(),
            season,
            split_index,
            competition_id: Some(competition_id.to_string()),
            standings: rows
                .iter()
                .map(|(team_id, points)| {
                    let won = points / 3;
                    StandingEntry {
                        team_id: (*team_id).to_string(),
                        played: 3,
                        won,
                        lost: 3 - won,
                        maps_won: won,
                        maps_lost: 3 - won,
                        points: *points,
                    }
                })
                .collect(),
            ..League::default()
        }
    }

    fn series(id: &str, matchday: u32, home: &str, away: &str, home_won: bool) -> Fixture {
        let (home_wins, away_wins) = if home_won { (3, 1) } else { (1, 3) };
        Fixture {
            id: id.to_string(),
            matchday,
            home_team_id: home.to_string(),
            away_team_id: away.to_string(),
            match_type: MatchType::Playoffs,
            status: FixtureStatus::Completed,
            result: Some(MatchResult {
                home_wins,
                away_wins,
                ..MatchResult::default()
            }),
            ..Fixture::default()
        }
    }

    fn row<'a>(tally: &'a SeasonTally, team_id: &str) -> &'a StandingEntry {
        &tally.rows[team_id]
    }

    /// Three splits where the final split's last place (A) is not the worst overall (D).
    fn three_split_game() -> Game {
        let mut game = game();
        let splits = [
            [("A", 9), ("B", 6), ("C", 3), ("D", 0)],
            [("A", 9), ("B", 6), ("C", 3), ("D", 0)],
            [("A", 0), ("B", 9), ("C", 6), ("D", 3)],
        ];
        for (index, rows) in splits.iter().enumerate() {
            game.leagues = vec![split("les", 2026, index, rows)];
            if index < 2 {
                record_split_end(&mut game, 0);
            } else {
                record_season_end(&mut game, 0);
            }
        }
        game
    }

    #[test]
    fn tally_sums_three_splits() {
        let mut game = game();
        for (index, points) in [9, 6, 3].into_iter().enumerate() {
            game.leagues = vec![split("les", 2026, index, &[("A", points)])];
            record_split_end(&mut game, 0);
        }
        let tally = &game.ladder.tallies["les"];
        assert_eq!(
            (tally.splits, row(tally, "A").points, row(tally, "A").played),
            (3, 18, 9)
        );
    }

    #[test]
    fn worst_teams_uses_summed_records_not_the_final_split() {
        let game = three_split_game();
        let outcome = game.ladder.outcome("les", 2026).unwrap();
        assert_eq!(worst_teams(outcome, 1), vec!["D".to_string()]);
    }

    #[test]
    fn worst_teams_lists_the_worst_first() {
        let game = three_split_game();
        let outcome = game.ladder.outcome("les", 2026).unwrap();
        assert_eq!(
            worst_teams(outcome, 2),
            vec!["D".to_string(), "C".to_string()]
        );
    }

    #[test]
    fn worst_teams_breaks_ties_in_a_stable_order() {
        let mut game = game();
        game.leagues = vec![split("les", 2026, 0, &[("A", 3), ("B", 3), ("C", 3)])];
        record_season_end(&mut game, 0);
        let outcome = game.ladder.outcome("les", 2026).unwrap();
        assert_eq!(
            worst_teams(outcome, 3),
            vec!["C".to_string(), "B".to_string(), "A".to_string()]
        );
    }

    #[test]
    fn season_end_clears_the_tally() {
        let game = three_split_game();
        assert!(game.ladder.tallies.is_empty());
    }

    #[test]
    fn champion_comes_from_the_playoff_final() {
        let mut game = game();
        let mut league = split("les", 2026, 0, &[("A", 9), ("B", 6), ("C", 3)]);
        league.fixtures = vec![series("f", 3, "C", "A", true)];
        game.leagues = vec![league];
        record_season_end(&mut game, 0);
        assert_eq!(
            game.ladder
                .outcome("les", 2026)
                .unwrap()
                .champion_id
                .as_deref(),
            Some("C")
        );
    }

    #[test]
    fn champion_falls_back_to_the_table_leader_without_a_final() {
        let mut game = game();
        game.leagues = vec![split("les", 2026, 0, &[("A", 3), ("B", 9), ("C", 6)])];
        record_season_end(&mut game, 0);
        assert_eq!(
            game.ladder
                .outcome("les", 2026)
                .unwrap()
                .champion_id
                .as_deref(),
            Some("B")
        );
    }

    #[test]
    fn final_order_is_champion_finalist_then_regular_order() {
        let mut league = split("les", 2026, 0, &[("A", 9), ("B", 6), ("C", 3), ("D", 0)]);
        league.fixtures = vec![
            series("s1", 1, "A", "D", false),
            series("s2", 2, "B", "C", false),
            series("f", 3, "D", "C", true),
        ];
        assert_eq!(effective_final_order(&league), vec!["D", "C", "A", "B"]);
    }

    #[test]
    fn recording_the_same_split_twice_does_not_double_count() {
        let mut game = game();
        game.leagues = vec![split("les", 2026, 0, &[("A", 9)])];
        record_split_end(&mut game, 0);
        record_split_end(&mut game, 0);
        let tally = &game.ladder.tallies["les"];
        assert_eq!((tally.splits, row(tally, "A").points), (1, 9));
    }

    #[test]
    fn recording_the_same_season_twice_writes_one_outcome() {
        let mut game = game();
        game.leagues = vec![split("les", 2026, 0, &[("A", 9), ("B", 3)])];
        record_season_end(&mut game, 0);
        record_season_end(&mut game, 0);
        assert_eq!(game.ladder.outcomes.len(), 1);
    }

    #[test]
    fn a_tally_from_an_older_season_is_discarded() {
        let mut game = game();
        game.leagues = vec![split("les", 2025, 0, &[("A", 9)])];
        record_split_end(&mut game, 0);
        game.leagues = vec![split("les", 2026, 0, &[("A", 3)])];
        record_split_end(&mut game, 0);
        let tally = &game.ladder.tallies["les"];
        assert_eq!((tally.season, row(tally, "A").points), (2026, 3));
    }

    #[test]
    fn a_save_without_a_tally_ranks_the_final_split_alone() {
        let mut game = game();
        game.leagues = vec![split("les", 2026, 2, &[("A", 0), ("B", 9)])];
        record_season_end(&mut game, 0);
        let outcome = game.ladder.outcome("les", 2026).unwrap();
        assert_eq!(worst_teams(outcome, 1), vec!["A".to_string()]);
    }

    #[test]
    fn a_league_without_a_competition_id_is_not_recorded() {
        let mut game = game();
        let mut league = split("les", 2026, 0, &[("A", 9)]);
        league.competition_id = None;
        game.leagues = vec![league];
        record_split_end(&mut game, 0);
        record_season_end(&mut game, 0);
        assert!(game.ladder.tallies.is_empty() && game.ladder.outcomes.is_empty());
    }

    #[test]
    fn outcomes_are_pruned_per_competition() {
        let mut game = game();
        for season in 2020..2026 {
            game.leagues = vec![split("les", season, 0, &[("A", 9)])];
            record_season_end(&mut game, 0);
        }
        game.leagues = vec![split("lec", 2020, 0, &[("A", 9)])];
        record_season_end(&mut game, 0);
        let les: Vec<u32> = game
            .ladder
            .outcomes
            .iter()
            .filter(|o| o.competition_id == "les")
            .map(|o| o.season)
            .collect();
        assert_eq!(les, vec![2022, 2023, 2024, 2025]);
        assert_eq!(game.ladder.outcomes.len(), MAX_OUTCOMES_PER_COMPETITION + 1);
    }

    #[test]
    fn movements_are_pruned_to_the_most_recent() {
        let mut ladder = LadderState::default();
        for season in 0..20 {
            ladder.record_movement(LadderMovement {
                season,
                ..LadderMovement::default()
            });
        }
        let seasons: Vec<u32> = ladder.movements.iter().map(|m| m.season).collect();
        assert_eq!(seasons, (8..20).collect::<Vec<u32>>());
    }

    #[test]
    fn ladder_state_round_trips_through_json() {
        let mut game = three_split_game();
        game.leagues = vec![split("les", 2027, 0, &[("A", 9)])];
        record_split_end(&mut game, 0);
        game.ladder.record_movement(LadderMovement {
            link_lower: "les".to_string(),
            link_upper: "lec".to_string(),
            season: 2026,
            promoted: vec!["A".to_string()],
            relegated: vec!["B".to_string()],
            status: LadderMovementStatus::SkippedLate,
        });
        let json = serde_json::to_string(&game.ladder).unwrap();
        let loaded: LadderState = serde_json::from_str(&json).unwrap();
        assert_eq!(serde_json::to_string(&loaded).unwrap(), json);
        assert_eq!(
            loaded.movements[0].status,
            LadderMovementStatus::SkippedLate
        );
    }

    #[test]
    fn a_tally_without_optional_fields_deserializes() {
        let loaded: SeasonTally = serde_json::from_str(r#"{"season": 2026}"#).unwrap();
        assert_eq!((loaded.splits, loaded.last_split), (0, None));
    }
}
