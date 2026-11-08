//! AI roster rotation: rival teams rest heavily fatigued starters when a
//! substitute for the same role is available, and bring them back once they
//! recovered.
//!
//! Thresholds (all `[PLACEHOLDER]` until playtested, condition is 0-100):
//!
//! * A starter below [`REST_BELOW`] sits out when a same-role substitute has at
//!   least [`SUBSTITUTE_MIN_CONDITION`] and is fresher.
//! * A better player who was rested comes back once they reach [`RETURN_AT`].
//!   The gap between the two thresholds stops a pair from swapping every day.
//! * A swap never leaves the starting five with more than
//!   [`crate::residency::MAX_IMPORTS_IN_STARTING_FIVE`] imports.
//! * Teams without a substitute for a role keep their starter; they instead skip
//!   training below [`TRAINING_REST_BELOW`] (see `training::process_training`).
//!
//! Only AI teams are rotated; the user's lineup is always theirs to set.

use crate::domain::player::Player;
use crate::domain::team::TeamKind;
use crate::game::Game;
use crate::potential::calculate_lol_ovr;
use crate::residency::{self, Region};

/// A starter under this condition is rested when a substitute is available.
pub const REST_BELOW: u8 = 40;
/// A substitute must have at least this condition to replace a tired starter.
pub const SUBSTITUTE_MIN_CONDITION: u8 = 55;
/// A rested player returns to the lineup at this condition.
pub const RETURN_AT: u8 = 70;
/// AI players under this condition skip training and rest instead.
pub const TRAINING_REST_BELOW: u8 = 45;

/// Picks the starting five for the next match from `lineup` (slot order kept)
/// and the team's `roster`.
///
/// Each slot is decided on its own and only swaps with a player of the same
/// natural role, so lane order never changes. Ids that match nobody on the
/// roster are left untouched.
pub fn rotate_lineup(lineup: &[String], roster: &[&Player], region: Option<Region>) -> Vec<String> {
    let mut result = lineup.to_vec();
    for slot in 0..result.len() {
        let Some(starter) = roster.iter().find(|player| player.id == result[slot]) else {
            continue;
        };
        if let Some(replacement) = replacement_for(starter, slot, &result, roster, region) {
            result[slot] = replacement.id.clone();
        }
    }
    result
}

/// The player who should take `starter`'s slot, if anyone should.
fn replacement_for<'a>(
    starter: &Player,
    slot: usize,
    lineup: &[String],
    roster: &[&'a Player],
    region: Option<Region>,
) -> Option<&'a Player> {
    let tired = starter.condition < REST_BELOW;
    let starter_ovr = calculate_lol_ovr(starter);
    roster
        .iter()
        .copied()
        .filter(|candidate| {
            candidate.natural_position == starter.natural_position
                && !lineup.contains(&candidate.id)
        })
        .filter(|candidate| {
            if tired {
                candidate.condition >= SUBSTITUTE_MIN_CONDITION
                    && candidate.condition > starter.condition
            } else {
                candidate.condition >= RETURN_AT && calculate_lol_ovr(candidate) > starter_ovr
            }
        })
        .filter(|candidate| keeps_import_limit(candidate, slot, lineup, roster, region))
        .max_by_key(|candidate| (calculate_lol_ovr(candidate), candidate.condition))
}

/// Whether putting `candidate` in `slot` leaves the starting five no further
/// over the import limit than it already was.
fn keeps_import_limit(
    candidate: &Player,
    slot: usize,
    lineup: &[String],
    roster: &[&Player],
    region: Option<Region>,
) -> bool {
    let starters = |swap: Option<&Player>| -> usize {
        lineup
            .iter()
            .enumerate()
            .filter_map(|(index, id)| match (index == slot, swap) {
                (true, Some(player)) => Some(player),
                _ => roster.iter().copied().find(|player| &player.id == id),
            })
            .filter(|player| residency::is_import(player, region))
            .count()
    };
    let after = starters(Some(candidate));
    after <= residency::MAX_IMPORTS_IN_STARTING_FIVE || after <= starters(None)
}

/// Rotates the starters of every AI main team. Run once a day, after
/// recovery, so the next match (including the user's rival) sees the result.
pub fn rotate_ai_lineups(game: &mut Game) {
    let user_team_id = game.manager.team_id.clone();
    let updates: Vec<(usize, Vec<String>)> = game
        .teams
        .iter()
        .enumerate()
        .filter(|(_, team)| {
            team.team_kind == TeamKind::Main
                && team.manager_id.is_none()
                && user_team_id.as_deref() != Some(team.id.as_str())
                && team.active_lineup_ids.len() == 5
        })
        .filter_map(|(index, team)| {
            let roster: Vec<&Player> = game
                .players
                .iter()
                .filter(|player| player.team_id.as_deref() == Some(team.id.as_str()))
                .collect();
            let rotated = rotate_lineup(
                &team.active_lineup_ids,
                &roster,
                residency::team_region(team),
            );
            (rotated != team.active_lineup_ids).then_some((index, rotated))
        })
        .collect();
    for (index, lineup) in updates {
        game.teams[index].active_lineup_ids = lineup;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::player::{LolRole, PlayerAttributes};

    fn attrs(value: u8) -> PlayerAttributes {
        PlayerAttributes {
            laning: value,
            mechanics: value,
            macro_play: value,
            consistency: value,
            discipline: value,
            teamfighting: value,
            shotcalling: value,
            champion_pool: value,
            mental_resilience: value,
        }
    }

    fn player(id: &str, role: LolRole, rating: u8, condition: u8, nationality: &str) -> Player {
        let mut player = Player::new(
            id.to_string(),
            id.to_string(),
            format!("{id} Test"),
            "2000-01-01".to_string(),
            nationality.to_string(),
            role,
            attrs(rating),
        );
        player.team_id = Some("t".to_string());
        player.condition = condition;
        player
    }

    fn lineup(ids: &[&str]) -> Vec<String> {
        ids.iter().map(|id| id.to_string()).collect()
    }

    /// Five starters (rating 70) and a Top substitute (rating 60).
    fn roster(top_condition: u8, sub_condition: u8) -> Vec<Player> {
        vec![
            player("top", LolRole::Top, 70, top_condition, "ES"),
            player("jg", LolRole::Jungle, 70, 100, "ES"),
            player("mid", LolRole::Mid, 70, 100, "ES"),
            player("adc", LolRole::Adc, 70, 100, "ES"),
            player("sup", LolRole::Support, 70, 100, "ES"),
            player("sub-top", LolRole::Top, 60, sub_condition, "ES"),
        ]
    }

    fn rotate(roster: &[Player], current: &[&str]) -> Vec<String> {
        let refs: Vec<&Player> = roster.iter().collect();
        rotate_lineup(&lineup(current), &refs, None)
    }

    const FIVE: [&str; 5] = ["top", "jg", "mid", "adc", "sup"];

    #[test]
    fn a_heavily_fatigued_starter_rests_for_a_fresh_substitute() {
        let players = roster(25, 90);
        assert_eq!(
            rotate(&players, &FIVE),
            lineup(&["sub-top", "jg", "mid", "adc", "sup"])
        );
    }

    #[test]
    fn a_tired_starter_without_a_substitute_keeps_playing() {
        let mut players = roster(25, 90);
        players.pop();
        assert_eq!(rotate(&players, &FIVE), lineup(&FIVE));
    }

    #[test]
    fn a_substitute_who_is_also_tired_does_not_replace_the_starter() {
        let players = roster(30, 50);
        assert_eq!(rotate(&players, &FIVE), lineup(&FIVE));
    }

    #[test]
    fn a_starter_above_the_rest_threshold_keeps_the_slot() {
        let players = roster(REST_BELOW, 100);
        assert_eq!(rotate(&players, &FIVE), lineup(&FIVE));
    }

    #[test]
    fn a_rested_player_returns_once_recovered() {
        let players = roster(RETURN_AT, 60);
        assert_eq!(
            rotate(&players, &["sub-top", "jg", "mid", "adc", "sup"]),
            lineup(&FIVE)
        );
    }

    #[test]
    fn a_rested_player_stays_out_until_recovered() {
        let players = roster(RETURN_AT - 1, 60);
        let current = ["sub-top", "jg", "mid", "adc", "sup"];
        assert_eq!(rotate(&players, &current), lineup(&current));
    }

    #[test]
    fn a_tired_substitute_hands_the_slot_back_to_the_recovered_starter() {
        let players = roster(55, 20);
        let current = ["sub-top", "jg", "mid", "adc", "sup"];
        assert_eq!(rotate(&players, &current), lineup(&FIVE));
    }

    #[test]
    fn a_swap_that_would_start_a_third_import_is_refused() {
        // Region EMEA: two Korean starters already count as imports, so the
        // Korean substitute cannot take the third import slot.
        let mut players = roster(25, 90);
        players[1].nationality = "KR".to_string();
        players[2].nationality = "KR".to_string();
        players[5].nationality = "KR".to_string();
        let refs: Vec<&Player> = players.iter().collect();
        let region = Some(Region::Emea);
        let result = rotate_lineup(&lineup(&FIVE), &refs, region);
        assert_eq!(result, lineup(&FIVE));
    }

    #[test]
    fn a_swap_that_replaces_an_import_is_allowed() {
        let mut players = roster(25, 90);
        players[0].nationality = "KR".to_string();
        players[1].nationality = "KR".to_string();
        players[5].nationality = "KR".to_string();
        let refs: Vec<&Player> = players.iter().collect();
        let result = rotate_lineup(&lineup(&FIVE), &refs, Some(Region::Emea));
        assert_eq!(result, lineup(&["sub-top", "jg", "mid", "adc", "sup"]));
    }

    #[test]
    fn the_best_available_substitute_is_chosen() {
        let mut players = roster(20, 70);
        players.push(player("sub-top-2", LolRole::Top, 62, 95, "ES"));
        assert_eq!(
            rotate(&players, &FIVE),
            lineup(&["sub-top-2", "jg", "mid", "adc", "sup"])
        );
    }

    #[test]
    fn ids_missing_from_the_roster_are_left_alone() {
        let players = roster(25, 90);
        let current = ["ghost", "jg", "mid", "adc", "sup"];
        assert_eq!(rotate(&players, &current), lineup(&current));
    }

    fn game_with_two_teams() -> Game {
        use crate::clock::GameClock;
        use crate::domain::manager::Manager;
        use crate::domain::team::Team;
        use chrono::{TimeZone, Utc};

        let team = |id: &str| {
            let mut team = Team::new(
                id.to_string(),
                id.to_string(),
                id.to_uppercase(),
                "Spain".to_string(),
                "Madrid".to_string(),
                "Arena".to_string(),
                10_000,
            );
            team.active_lineup_ids = FIVE.iter().map(|id| id.to_string()).collect();
            team
        };
        let mut players = Vec::new();
        for team_id in ["user", "rival"] {
            for mut p in roster(25, 90) {
                p.id = format!("{team_id}-{}", p.id);
                p.team_id = Some(team_id.to_string());
                players.push(p);
            }
        }
        let mut teams = vec![team("user"), team("rival")];
        for t in &mut teams {
            let prefix = t.id.clone();
            t.active_lineup_ids = FIVE.iter().map(|id| format!("{prefix}-{id}")).collect();
        }
        let mut manager = Manager::new(
            "m".to_string(),
            "A".to_string(),
            "B".to_string(),
            "1980-01-01".to_string(),
            "Spain".to_string(),
        );
        manager.hire("user".to_string());
        let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 3, 1, 12, 0, 0).unwrap());
        Game::new(clock, manager, teams, players, vec![], vec![])
    }

    #[test]
    fn only_ai_teams_are_rotated() {
        let mut game = game_with_two_teams();
        let user_before = game.teams[0].active_lineup_ids.clone();

        rotate_ai_lineups(&mut game);

        assert_eq!(game.teams[0].active_lineup_ids, user_before);
        assert_eq!(game.teams[1].active_lineup_ids[0], "rival-sub-top");
        assert_eq!(game.teams[1].active_lineup_ids.len(), 5);
    }
}
