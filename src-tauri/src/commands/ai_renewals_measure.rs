//! Headless measurement (ignored): what happens to the AI players whose contract ends
//! while a real new game is played on.
//!
//! The world is played day by day through `turn::process_day`, and the production season
//! rollover (`advance_season`) runs whenever the user's league completes, exactly as the
//! app does after the user's confirmation. Every AI main-team starter whose contract ends
//! inside the stretch is followed to the end of it and classified as renewed (same club,
//! later end), released (no club) or re-signed elsewhere.
//!
//! ```text
//! OLM_MEASURE_UNTIL=2028-12-20 \
//!   cargo test --release -p openleaguemanager --lib -- --ignored \
//!   ai_renewals_measure --nocapture
//! ```

use std::collections::HashMap;

use chrono::NaiveDate;
use olm_core::domain::player::RenewalSessionStatus;
use olm_core::domain::team::TeamKind;
use olm_core::game::Game;
use olm_core::{end_of_season, season_rollover, turn};

use super::world_progression_measure::build_start_world;

/// Where an AI starter with an ending contract stands at the end of the stretch.
#[derive(Debug, Default, PartialEq, Eq)]
pub(super) struct RenewalOutcomes {
    pub(super) total: u32,
    pub(super) renewed: u32,
    pub(super) released: u32,
    pub(super) resigned_elsewhere: u32,
}

struct Tracked {
    team_id: String,
    contract_end: String,
    starter: bool,
}

/// AI main-team players whose contract ends on or before `horizon`, keyed by player id.
/// A starter is the best player of his role in his club: lineups of AI clubs are only
/// filled by the rotation once the season runs, so the roster stands in for them.
fn expiring_ai_players(game: &Game, horizon: NaiveDate) -> HashMap<String, Tracked> {
    let user = game.manager.team_id.as_deref();
    let mut tracked = HashMap::new();
    for team in game.teams.iter().filter(|t| {
        t.team_kind == TeamKind::Main && t.manager_id.is_none() && user != Some(t.id.as_str())
    }) {
        let mut best: HashMap<_, (&str, u8)> = HashMap::new();
        let squad: Vec<_> = game
            .players
            .iter()
            .filter(|p| p.team_id.as_deref() == Some(team.id.as_str()))
            .collect();
        for player in &squad {
            let entry = best
                .entry(player.natural_position)
                .or_insert((player.id.as_str(), player.lol_ovr));
            if player.lol_ovr > entry.1 {
                *entry = (player.id.as_str(), player.lol_ovr);
            }
        }
        for player in squad {
            let Some(end) = player.contract_end.as_deref() else {
                continue;
            };
            let Ok(end_date) = NaiveDate::parse_from_str(end, "%Y-%m-%d") else {
                continue;
            };
            if end_date <= horizon {
                tracked.insert(
                    player.id.clone(),
                    Tracked {
                        team_id: team.id.clone(),
                        contract_end: end.to_string(),
                        starter: best
                            .get(&player.natural_position)
                            .is_some_and(|(id, _)| *id == player.id),
                    },
                );
            }
        }
    }
    tracked
}

fn classify(
    game: &Game,
    tracked: &HashMap<String, Tracked>,
    starters_only: bool,
) -> RenewalOutcomes {
    let mut outcomes = RenewalOutcomes::default();
    for (id, before) in tracked.iter().filter(|(_, t)| t.starter || !starters_only) {
        let Some(player) = game.players.iter().find(|p| &p.id == id) else {
            continue;
        };
        outcomes.total += 1;
        match player.team_id.as_deref() {
            None => outcomes.released += 1,
            Some(team) if team == before.team_id => {
                if player.contract_end.as_deref() > Some(before.contract_end.as_str()) {
                    outcomes.renewed += 1;
                } else {
                    outcomes.released += 1;
                }
            }
            Some(_) => outcomes.resigned_elsewhere += 1,
        }
    }
    outcomes
}

/// Renewal-session status of every tracked player who is still on his old club or gone,
/// as `status=count` pairs.
fn session_states(game: &Game, tracked: &HashMap<String, Tracked>) -> String {
    let mut counts: HashMap<String, u32> = HashMap::new();
    for id in tracked.keys() {
        if let Some(player) = game.players.iter().find(|p| &p.id == id) {
            let label = player
                .morale_core
                .renewal_state
                .as_ref()
                .map_or("none".to_string(), |s| format!("{:?}", s.status));
            *counts.entry(label).or_default() += 1;
        }
    }
    let mut pairs: Vec<_> = counts.into_iter().collect();
    pairs.sort();
    format!("{pairs:?}")
}

fn open_ai_sessions(game: &Game) -> usize {
    let user = game.manager.team_id.as_deref();
    game.players
        .iter()
        .filter(|p| p.team_id.is_some() && p.team_id.as_deref() != user)
        .filter(|p| {
            p.morale_core
                .renewal_state
                .as_ref()
                .is_some_and(|s| s.status == RenewalSessionStatus::Open)
        })
        .count()
}

/// Club changes seen day by day over the whole stretch.
#[derive(Debug, Default)]
pub(super) struct Movement {
    pub(super) club_to_club: u32,
    pub(super) released: u32,
    pub(super) signed_from_free: u32,
}

fn team_of_each_player(game: &Game) -> HashMap<String, Option<String>> {
    game.players
        .iter()
        .map(|p| (p.id.clone(), p.team_id.clone()))
        .collect()
}

/// Plays a fresh world until `until`, rolling the season whenever the league completes.
pub(super) fn measure(
    until: NaiveDate,
) -> (
    RenewalOutcomes,
    RenewalOutcomes,
    Movement,
    u32,
    usize,
    String,
) {
    let mut game = build_start_world();
    println!(
        "world starts {}",
        game.clock.current_date.format("%Y-%m-%d")
    );
    let tracked = expiring_ai_players(&game, until);
    let mut movement = Movement::default();
    let mut teams = team_of_each_player(&game);
    let mut rollovers = 0;
    let mut peak_open = 0;
    while game.clock.current_date.date_naive() < until {
        if end_of_season::is_season_complete(&game) {
            season_rollover::advance_season(&mut game);
            rollovers += 1;
        }
        turn::process_day(&mut game);
        peak_open = peak_open.max(open_ai_sessions(&game));
        let now = team_of_each_player(&game);
        for (id, team) in &now {
            match (teams.get(id), team) {
                (Some(Some(a)), Some(b)) if a != b => movement.club_to_club += 1,
                (Some(Some(_)), None) => movement.released += 1,
                (Some(None), Some(_)) => movement.signed_from_free += 1,
                _ => {}
            }
        }
        teams = now;
    }
    (
        classify(&game, &tracked, true),
        classify(&game, &tracked, false),
        movement,
        rollovers,
        peak_open,
        session_states(&game, &tracked),
    )
}

#[test]
#[ignore = "measurement: plays a season day by day, run it explicitly in release"]
fn ai_renewals_measure() {
    let until = std::env::var("OLM_MEASURE_UNTIL").unwrap_or_else(|_| "2028-12-20".to_string());
    let until = NaiveDate::parse_from_str(&until, "%Y-%m-%d").expect("OLM_MEASURE_UNTIL date");
    let started = std::time::Instant::now();
    let (starters, everyone, movement, rollovers, peak_open, session_states) = measure(until);
    println!(
        "until {until}: season rollovers {rollovers}, peak open AI renewal sessions {peak_open}"
    );
    for (label, outcomes) in [("starters", &starters), ("all players", &everyone)] {
        println!(
            "AI {label} with an ending contract: {} | renewed {} | released {} | re-signed elsewhere {}",
            outcomes.total, outcomes.renewed, outcomes.released, outcomes.resigned_elsewhere
        );
    }
    println!("session states at the end: {session_states}");
    println!(
        "club-to-club moves {} | released or expired {} | signed from free agency {}",
        movement.club_to_club, movement.released, movement.signed_from_free
    );
    println!("wall time {:.1}s", started.elapsed().as_secs_f64());
}
