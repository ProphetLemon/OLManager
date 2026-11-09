//! Pacing, kill volume, side fairness and rating sensitivity of the
//! minute-level engine, exercised through `simulate_lol` with
//! `MatchConfig::default()`: the entry point the shipped callers use for
//! AI-vs-AI league matches, user matches played in the turn and instant matches.
//!
//! Before the lane rework every league match ran to the 60 minute limit with
//! about one kill, no tower down and the home side always winning.

use super::test_support::*;
use super::*;
use crate::engine::report::MatchReportEndReason;
use crate::engine::simulate_lol;
use crate::engine::types::MatchConfig;

/// Rating spread by role, so rosters look like shipped ones (a team is not 5
/// identical players).
const ROLE_SPREAD: [i16; 5] = [3, -2, 5, 0, -6];

/// A roster around `mean`, built the way `build_engine_team_from` builds one:
/// per-player attributes, condition below 100.
pub(super) fn roster(id: &str, mean: u8) -> TeamData {
    let mut team = team(id, mean);
    for (player, spread) in team.players.iter_mut().zip(ROLE_SPREAD) {
        let shift = |v: u8| (i16::from(v) + spread).clamp(1, 99) as u8;
        player.mechanics = shift(player.mechanics);
        player.laning = shift(player.laning);
        player.teamfighting = shift(player.teamfighting);
        player.macro_play = shift(player.macro_play);
        player.consistency = shift(player.consistency);
        player.shotcalling = shift(player.shotcalling);
        player.discipline = shift(player.discipline);
        player.condition = 92;
    }
    team
}

struct Outcome {
    home_won: bool,
    minutes: f64,
    kills: f64,
    by_nexus: bool,
}

fn play(home: &TeamData, away: &TeamData, seed: u64) -> Outcome {
    let mut rng = seeded_rng(seed);
    let report = simulate_lol(home, away, &MatchConfig::default(), &mut rng);
    Outcome {
        home_won: report.home_wins > report.away_wins,
        minutes: f64::from(report.total_minutes),
        kills: f64::from(report.home_stats.kills + report.away_stats.kills),
        by_nexus: matches!(report.ended_by, MatchReportEndReason::NexusDestroyed),
    }
}

/// Share of matches won by the team rated `strong` against one rated `weak`,
/// averaged over both orientations (home and away) of `matches_per_side` seeds.
fn stronger_win_rate(strong: u8, weak: u8, matches_per_side: u64) -> f64 {
    let (a, b) = (roster("strong", strong), roster("weak", weak));
    let mut wins = 0;
    for seed in 0..matches_per_side {
        wins += usize::from(play(&a, &b, seed).home_won);
        wins += usize::from(!play(&b, &a, 10_000 + seed).home_won);
    }
    wins as f64 / (2 * matches_per_side) as f64
}

#[test]
fn even_matches_end_by_nexus_at_pro_pace() {
    // [PLACEHOLDER] targets: 25-40 minutes, 15-35 total kills, nexus decides.
    let (a, b) = (roster("home", 70), roster("away", 70));
    let n = 40;
    let games: Vec<Outcome> = (0..n).map(|seed| play(&a, &b, seed)).collect();
    let minutes = games.iter().map(|g| g.minutes).sum::<f64>() / n as f64;
    let kills = games.iter().map(|g| g.kills).sum::<f64>() / n as f64;
    let by_nexus = games.iter().filter(|g| g.by_nexus).count();
    assert!(
        (25.0..=40.0).contains(&minutes),
        "average length {minutes:.1} min, expected 25-40"
    );
    assert!(
        (15.0..=35.0).contains(&kills),
        "average kills {kills:.1}, expected 15-35"
    );
    assert!(
        by_nexus * 10 >= games.len() * 9,
        "only {by_nexus}/{n} matches ended by a destroyed nexus"
    );
}

#[test]
fn even_teams_win_about_half_each_side() {
    // [PLACEHOLDER] 45-55% for home. 1500 seeded matches: the binomial standard
    // error is 1.3 points, so the band is about 3.8 standard errors wide on
    // each side of a fair 50%. The old engine returned 100% (60% with walls
    // fixed alone), so a real bias still fails; a fair one does not flake.
    let (a, b) = (roster("home", 70), roster("away", 70));
    let n = 1500;
    let home_wins = (0..n).filter(|seed| play(&a, &b, *seed).home_won).count();
    let rate = home_wins as f64 / n as f64;
    assert!(
        (0.45..=0.55).contains(&rate),
        "home won {:.1}% of even matches, expected 45-55%",
        rate * 100.0
    );
}

#[test]
fn stronger_team_win_rate_rises_with_the_gap() {
    // [PLACEHOLDER] targets: a moderate gap gives at least 60%, 95 vs 40 at
    // least 90%, and the rate never falls as the gap widens. 300 matches per
    // orientation put the standard error of one rate near 1.7 points (about 2.4
    // for the difference of two), so a step may dip by at most 3 points of
    // sampling noise; the curve itself rises 57, 78, 92, 95 percent. The seeds
    // are fixed, so the outcome is reproducible.
    let steps = [(75, 70), (80, 60), (90, 50), (95, 40)];
    let rates: Vec<f64> = steps
        .iter()
        .map(|(strong, weak)| stronger_win_rate(*strong, *weak, 300))
        .collect();
    for pair in rates.windows(2) {
        assert!(
            pair[1] >= pair[0] - 0.03,
            "win rate fell as the gap widened: {rates:?}"
        );
    }
    assert!(
        rates[3] > rates[0] + 0.25,
        "a wide gap must win far more than a narrow one: {rates:?}"
    );
    assert!(
        rates[1] >= 0.60,
        "80 vs 60 won only {:.1}%",
        rates[1] * 100.0
    );
    assert!(
        rates[3] >= 0.90,
        "95 vs 40 won only {:.1}%",
        rates[3] * 100.0
    );
}

#[test]
#[ignore = "measurement report; run with: cargo test -p olm_core --lib print_pacing_report -- --ignored --nocapture"]
fn print_pacing_report() {
    let (a, b) = (roster("home", 70), roster("away", 70));
    let n = 2_000;
    let games: Vec<Outcome> = (0..n).map(|seed| play(&a, &b, 50_000 + seed)).collect();
    let f = n as f64;
    println!(
        "even: {:.1} min, {:.1} kills, home wins {:.1}%, nexus {:.1}%",
        games.iter().map(|g| g.minutes).sum::<f64>() / f,
        games.iter().map(|g| g.kills).sum::<f64>() / f,
        games.iter().filter(|g| g.home_won).count() as f64 / f * 100.0,
        games.iter().filter(|g| g.by_nexus).count() as f64 / f * 100.0,
    );
    for (strong, weak) in [(55, 50), (65, 60), (75, 70), (80, 60), (90, 50), (95, 40)] {
        println!(
            "{strong} vs {weak}: stronger wins {:.1}%",
            stronger_win_rate(strong, weak, 1_000) * 100.0
        );
    }
}
