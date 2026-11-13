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
    // Pacing guard: even teams must finish in pro-play time, well inside the
    // engine's 60 minute limit.
    assert!(
        (25.0..=40.0).contains(&batch.minutes),
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

/// Live engine per-role averages over 420 full watched matches (T1,
/// `sim_live::role_reference_tests`): CS per minute and assists per player, and
/// assists per team kill.
const LIVE_CS_PER_MIN: [(LolRole, f64); 5] = [
    (LolRole::Top, 5.55),
    (LolRole::Jungle, 5.55),
    (LolRole::Mid, 5.97),
    (LolRole::Adc, 4.07),
    (LolRole::Support, 0.39),
];
const LIVE_ASSISTS_PER_KILL: f64 = 1.08;

/// Same-seed batch used by the band test and the printed table: even 70 v 70.
const REFERENCE_MATCHES: u64 = 800;

struct RoleReference {
    minutes: Vec<f64>,
    kills: f64,
    /// Per role: `[cs/min, assists, kills, deaths, cs/match]`, averaged over both teams.
    per_role: HashMap<LolRole, [f64; 5]>,
    /// Assists credited per kill, over both teams.
    assists_per_kill: f64,
}

fn run_role_reference(matches: u64) -> RoleReference {
    let mut totals: HashMap<LolRole, [f64; 5]> = HashMap::new();
    let (mut minutes, mut kills, mut assists) = (Vec::new(), 0.0, 0.0);
    for seed in 0..matches {
        let mut rng = StdRng::seed_from_u64(0x0EC0 + seed);
        let state = LiveMatchState::new(
            team("home", 70),
            team("away", 70),
            MatchConfig::default(),
            Vec::new(),
            Vec::new(),
            false,
        );
        let report = state.run_to_completion(&mut rng);
        let length = f64::from(report.game_duration_seconds) / 60.0;
        minutes.push(length);
        kills += f64::from(report.home_stats.kills + report.away_stats.kills);
        for prefix in ["home", "away"] {
            for role in ROLES {
                let stats = &report.player_stats[&format!("{prefix}-{role:?}")];
                let entry = totals.entry(role).or_default();
                entry[0] += f64::from(stats.creep_score) / length.max(1.0);
                entry[1] += f64::from(stats.assists);
                entry[2] += f64::from(stats.kills);
                entry[3] += f64::from(stats.deaths);
                entry[4] += f64::from(stats.creep_score);
                assists += f64::from(stats.assists);
            }
        }
    }
    let per = 2.0 * matches as f64;
    for values in totals.values_mut() {
        values.iter_mut().for_each(|v| *v /= per);
    }
    RoleReference {
        minutes,
        kills: kills / matches as f64,
        per_role: totals,
        assists_per_kill: assists / kills.max(1.0),
    }
}

/// Per-role averages of the minute-level engine, the table to set beside the live
/// engine's (`sim_live::role_reference_tests`).
#[test]
#[ignore = "measurement report; run with --ignored --nocapture"]
fn print_background_role_reference() {
    let mut reference = run_role_reference(REFERENCE_MATCHES);
    reference.minutes.sort_by(f64::total_cmp);
    let minutes = &reference.minutes;
    println!(
        "== background engine, even 70 v 70: {REFERENCE_MATCHES} matches, duration mean {:.2} min (p10 {:.1} p50 {:.1} p90 {:.1}), kills per match {:.2}, assists per kill {:.2}",
        minutes.iter().sum::<f64>() / minutes.len() as f64,
        minutes[(minutes.len() - 1) / 10],
        minutes[(minutes.len() - 1) / 2],
        minutes[(minutes.len() - 1) * 9 / 10],
        reference.kills,
        reference.assists_per_kill
    );
    println!("role   cs/min  cs/match  assists  kills  deaths");
    for role in ROLES {
        let t = reference.per_role[&role];
        println!(
            "{:<8} {:>5.2} {:>9.1} {:>8.2} {:>6.2} {:>7.2}",
            format!("{role:?}"),
            t[0],
            t[4],
            t[1],
            t[2],
            t[3]
        );
    }
}

/// CS band (owner-delegated): each role within 10% of the live CS/min or 0.3,
/// whichever is larger; the support within 0.15. Team assists per kill between
/// 0.8 and 1.4 (live 1.08). Per-role assists are reported, not gated.
fn cs_band(role: LolRole, live: f64) -> f64 {
    if role == LolRole::Support {
        0.15
    } else {
        (live * 0.10).max(0.3)
    }
}

#[test]
fn background_cs_and_assists_stay_within_the_live_bands() {
    let reference = run_role_reference(REFERENCE_MATCHES);
    for (role, live) in LIVE_CS_PER_MIN {
        let cs = reference.per_role[&role][0];
        let band = cs_band(role, live);
        assert!(
            (cs - live).abs() <= band,
            "{role:?} CS/min {cs:.2} is outside live {live:.2} +/- {band:.2}"
        );
    }
    assert!(
        (0.8..=1.4).contains(&reference.assists_per_kill),
        "assists per kill {:.2} is outside 0.8..1.4 (live {LIVE_ASSISTS_PER_KILL})",
        reference.assists_per_kill
    );
}
