//! Multi-week simulation: rival (AI) teams must not drain to near-zero
//! condition and must keep valid lineups while a congested schedule runs.
//!
//! The schedule mirrors the LEC superweeks (three matchdays on consecutive
//! days, then four days off), 28 matchdays over ten weeks, eight teams with a
//! five-player roster plus two same-role substitutes (a Top and a Mid).

use chrono::{Duration, TimeZone, Utc};
use olm_core::ai_rotation::REST_BELOW;
use olm_core::clock::GameClock;
use olm_core::domain::league::{Fixture, FixtureStatus, League};
use olm_core::domain::manager::Manager;
use olm_core::domain::player::{Player, PlayerAttributes};
use olm_core::domain::stats::LolRole;
use olm_core::domain::team::Team;
use olm_core::game::Game;
use olm_core::schedule::generate_league;
use olm_core::turn;
use std::collections::HashSet;

const TEAM_COUNT: usize = 8;
const ROLES: [LolRole; 5] = [
    LolRole::Top,
    LolRole::Jungle,
    LolRole::Mid,
    LolRole::Adc,
    LolRole::Support,
];

fn attrs(level: u8) -> PlayerAttributes {
    PlayerAttributes {
        mental_resilience: 60,
        champion_pool: level,
        laning: level,
        mechanics: level,
        macro_play: level,
        consistency: level,
        discipline: level,
        teamfighting: level,
        shotcalling: level,
    }
}

fn player(team_id: &str, tag: &str, role: LolRole, level: u8) -> Player {
    let id = format!("{team_id}-{tag}");
    let mut p = Player::new(
        id.clone(),
        id.clone(),
        id,
        "2000-01-01".to_string(),
        "England".to_string(),
        role,
        attrs(level),
    );
    p.team_id = Some(team_id.to_string());
    p.morale = 70;
    p.condition = 100;
    p.contract_end = Some("2031-06-30".to_string());
    p
}

/// `substitutes` is how many of the Top and Mid substitutes each team keeps.
fn build_game(substitutes: usize) -> Game {
    let start = Utc.with_ymd_and_hms(2026, 3, 7, 12, 0, 0).unwrap();
    let team_ids: Vec<String> = (0..TEAM_COUNT).map(|i| format!("t{i}")).collect();
    let mut teams = Vec::new();
    let mut players = Vec::new();
    for team_id in &team_ids {
        let mut team = Team::new(
            team_id.clone(),
            format!("{team_id} Esports"),
            team_id.to_uppercase(),
            "England".to_string(),
            "London".to_string(),
            "Arena".to_string(),
            40_000,
        );
        for (i, role) in ROLES.iter().enumerate() {
            let p = player(team_id, &format!("s{i}"), *role, 62);
            team.active_lineup_ids.push(p.id.clone());
            players.push(p);
        }
        for (tag, role) in [("sub-top", LolRole::Top), ("sub-mid", LolRole::Mid)]
            .into_iter()
            .take(substitutes)
        {
            players.push(player(team_id, tag, role, 58));
        }
        teams.push(team);
    }

    let mut manager = Manager::new(
        "mgr".to_string(),
        "Test".to_string(),
        "Manager".to_string(),
        "1980-01-01".to_string(),
        "England".to_string(),
    );
    manager.hire("t0".to_string());

    // One double round robin, re-dated into superweeks, played twice.
    let base = generate_league("Sim League", 2026, &team_ids, start);
    let mut fixtures: Vec<Fixture> = Vec::new();
    for lap in 0..2u32 {
        for fixture in &base.fixtures {
            let matchday = fixture.matchday - 1 + lap * 14;
            let day = i64::from(matchday / 3) * 7 + i64::from(matchday % 3);
            let mut copy = fixture.clone();
            copy.id = format!("{}-{lap}", fixture.id);
            copy.matchday = matchday + 1;
            copy.date = (start + Duration::days(day)).format("%Y-%m-%d").to_string();
            copy.status = FixtureStatus::Scheduled;
            fixtures.push(copy);
        }
    }
    let league = League {
        fixtures,
        active: true,
        ..base
    };

    let clock = GameClock::new(start);
    let mut game = Game::new(clock, manager, teams, players, vec![], vec![]);
    game.leagues = vec![league];
    game
}

/// Average and minimum condition over the current starting fives of the AI teams.
fn rival_starter_condition(game: &Game) -> (f64, u8) {
    let mut total = 0u32;
    let mut count = 0u32;
    let mut min = 100u8;
    for team in game.teams.iter().filter(|t| t.id != "t0") {
        for id in &team.active_lineup_ids {
            let p = game
                .players
                .iter()
                .find(|p| &p.id == id)
                .expect("starter exists");
            total += u32::from(p.condition);
            count += 1;
            min = min.min(p.condition);
        }
    }
    (f64::from(total) / f64::from(count), min)
}

fn lineup_is_valid(game: &Game, team_id: &str) -> bool {
    let team = game.teams.iter().find(|t| t.id == team_id).unwrap();
    if team.active_lineup_ids.len() != 5 {
        return false;
    }
    let unique: HashSet<&String> = team.active_lineup_ids.iter().collect();
    if unique.len() != 5 {
        return false;
    }
    let roles: Vec<LolRole> = team
        .active_lineup_ids
        .iter()
        .map(|id| {
            let p = game.players.iter().find(|p| &p.id == id).unwrap();
            assert_eq!(
                p.team_id.as_deref(),
                Some(team_id),
                "starter {id} left the team"
            );
            p.natural_position
        })
        .collect();
    roles == ROLES
}

struct Outcome {
    overall: f64,
    final_week: f64,
    lowest: u8,
    /// Rival team-days on which a substitute started.
    substitute_starts: usize,
    game: Game,
}

fn simulate(substitutes: usize) -> Outcome {
    let mut game = build_game(substitutes);
    let mut daily_average = Vec::new();
    let mut lowest = 100u8;
    let mut substitute_starts = 0;
    for _ in 0..70 {
        turn::process_day(&mut game);
        substitute_starts += game
            .teams
            .iter()
            .filter(|t| t.id != "t0")
            .filter(|t| t.active_lineup_ids.iter().any(|id| id.contains("-sub-")))
            .count();
        let (average, min) = rival_starter_condition(&game);
        daily_average.push(average);
        lowest = lowest.min(min);
    }
    let overall = daily_average.iter().sum::<f64>() / daily_average.len() as f64;
    let final_week = daily_average[daily_average.len() - 7..].iter().sum::<f64>() / 7.0;
    println!(
        "{substitutes} substitute(s): rival starters over 10 weeks: mean daily avg {overall:.1}, final-week avg {final_week:.1}, lowest {lowest}, substitute team-days {substitute_starts}"
    );
    Outcome {
        overall,
        final_week,
        lowest,
        substitute_starts,
        game,
    }
}

fn assert_valid_lineups(game: &Game) {
    for team in game.teams.iter().filter(|t| t.id != "t0") {
        assert!(
            lineup_is_valid(game, &team.id),
            "{} lineup is invalid",
            team.id
        );
    }
}

#[test]
fn rivals_with_a_deep_bench_stay_fresh_and_keep_valid_lineups() {
    let outcome = simulate(2);
    assert!(
        outcome.lowest >= 20,
        "a rival starter fell to {} condition; the lowest tolerated is 20",
        outcome.lowest
    );
    assert!(
        outcome.overall >= 55.0 && outcome.final_week >= 50.0,
        "rival starters averaged {:.1} overall and {:.1} in the last week",
        outcome.overall,
        outcome.final_week
    );
    // Starters are only rested below `REST_BELOW`. Real assists and CS (background
    // matches record them) keep mental resilience from decaying, so starters may
    // never get that tired: require the rest only when somebody did.
    assert!(
        outcome.substitute_starts > 0 || outcome.lowest >= REST_BELOW,
        "starters fell to {} condition but no substitute was started",
        outcome.lowest
    );
    assert_valid_lineups(&outcome.game);
}

#[test]
fn rivals_with_one_substitute_stay_fresh_and_keep_valid_lineups() {
    let outcome = simulate(1);
    assert!(
        outcome.lowest >= 15,
        "a rival starter fell to {} condition; the lowest tolerated is 15",
        outcome.lowest
    );
    assert!(
        outcome.final_week >= 45.0,
        "rival starters averaged {:.1} in the last week",
        outcome.final_week
    );
    assert_valid_lineups(&outcome.game);
}

#[test]
fn rivals_without_substitutes_do_not_sink_to_zero() {
    let outcome = simulate(0);
    assert!(
        outcome.lowest >= 10,
        "a rival starter fell to {} condition; the lowest tolerated is 10",
        outcome.lowest
    );
    assert!(
        outcome.final_week >= 40.0,
        "rival starters averaged {:.1} in the last week",
        outcome.final_week
    );
    assert_valid_lineups(&outcome.game);
}
