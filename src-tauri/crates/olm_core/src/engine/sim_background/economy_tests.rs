//! Economy validation for the minute-level engine used by background and
//! instant matches: many seeded full matches, gold shares by role, pacing and
//! the stronger-team check.

use std::collections::HashMap;

use rand::SeedableRng;
use rand::rngs::StdRng;

use super::*;

/// Inclusive `(min, max)` share of a team's total gold per role (approximate
/// pro-play averages, general knowledge).
const ROLE_SHARE_RANGE: [(LolRole, f64, f64); 5] = [
    (LolRole::Top, 0.20, 0.23),
    (LolRole::Jungle, 0.17, 0.20),
    (LolRole::Mid, 0.21, 0.24),
    (LolRole::Adc, 0.23, 0.27),
    (LolRole::Support, 0.10, 0.14),
];

const ROLES: [LolRole; 5] = [
    LolRole::Top,
    LolRole::Jungle,
    LolRole::Mid,
    LolRole::Adc,
    LolRole::Support,
];

fn player(team: &str, role: LolRole, rating: u8) -> PlayerData {
    PlayerData {
        id: format!("{team}-{role:?}"),
        name: format!("{team}-{role:?}"),
        profile_image_url: None,
        role,
        condition: 100,
        fitness: 75,
        mechanics: rating,
        laning: rating,
        teamfighting: rating,
        macro_play: rating,
        consistency: rating,
        shotcalling: rating,
        champion_pool: rating,
        discipline: rating,
        mental_resilience: rating,
        is_import: false,
        traits: Vec::new(),
    }
}

fn team(id: &str, rating: u8) -> TeamData {
    TeamData {
        id: id.to_string(),
        name: id.to_string(),
        draft_strategy: DraftStrategy::default(),
        players: ROLES.iter().map(|role| player(id, *role, rating)).collect(),
    }
}

struct Batch {
    home_wins: usize,
    matches: usize,
    minutes: f64,
    kills: f64,
    /// Share of own-team gold per role, averaged over both teams and all matches.
    role_share: HashMap<LolRole, f64>,
    gold_earned_per_team: f64,
}

fn run_batch(matches: u64, home_rating: u8, away_rating: u8) -> Batch {
    let mut batch = Batch {
        home_wins: 0,
        matches: matches as usize,
        minutes: 0.0,
        kills: 0.0,
        role_share: HashMap::new(),
        gold_earned_per_team: 0.0,
    };
    for seed in 0..matches {
        let mut rng = StdRng::seed_from_u64(0x0EC0 + seed);
        let state = LiveMatchState::new(
            team("home", home_rating),
            team("away", away_rating),
            MatchConfig::default(),
            Vec::new(),
            Vec::new(),
            false,
        );
        let report = state.run_to_completion(&mut rng);
        if report.home_wins > report.away_wins {
            batch.home_wins += 1;
        }
        batch.minutes += report.total_minutes as f64;
        batch.kills += (report.home_stats.kills + report.away_stats.kills) as f64;
        batch.gold_earned_per_team +=
            (report.home_stats.gold_earned + report.away_stats.gold_earned) as f64 / 2.0;
        for (prefix, total) in [
            ("home", report.home_stats.gold_earned),
            ("away", report.away_stats.gold_earned),
        ] {
            for role in ROLES {
                let stats = &report.player_stats[&format!("{prefix}-{role:?}")];
                *batch.role_share.entry(role).or_default() +=
                    stats.gold_earned as f64 / total.max(1) as f64 / (2.0 * matches as f64);
            }
        }
    }
    batch.minutes /= matches as f64;
    batch.kills /= matches as f64;
    batch.gold_earned_per_team /= matches as f64;
    batch
}

#[test]
fn role_gold_shares_match_pro_averages() {
    let batch = run_batch(100, 70, 70);
    for (role, min, max) in ROLE_SHARE_RANGE {
        let share = batch.role_share[&role];
        assert!(
            (min..=max).contains(&share),
            "{role:?} earns {:.1}% of team gold, expected {:.0}%-{:.0}%",
            share * 100.0,
            min * 100.0,
            max * 100.0
        );
    }
    // Pacing guard: the rework must not stretch matches past the engine's
    // 60 minute limit or make the economy explode.
    assert!(
        batch.minutes <= 61.0,
        "average length {:.1} min",
        batch.minutes
    );
    assert!(
        (8_000.0..=40_000.0).contains(&batch.gold_earned_per_team),
        "gold per team {:.0}",
        batch.gold_earned_per_team
    );
}

#[test]
#[ignore = "measurement report; run with --ignored --nocapture"]
fn print_engine_economy_report() {
    let even = run_batch(400, 70, 70);
    for role in ROLES {
        println!("share {role:?}: {:.1}%", even.role_share[&role] * 100.0);
    }
    println!(
        "even: {:.1} min, {:.1} kills, {:.0} gold per team, home wins {}/{}",
        even.minutes, even.kills, even.gold_earned_per_team, even.home_wins, even.matches
    );
    let strong_home = run_batch(400, 80, 60);
    let strong_away = run_batch(400, 60, 80);
    println!(
        "stronger team wins {} of {}",
        strong_home.home_wins + (strong_away.matches - strong_away.home_wins),
        strong_home.matches + strong_away.matches
    );
}
