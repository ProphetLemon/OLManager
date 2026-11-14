//! Outcome fingerprint of the background engine, the path every unwatched match
//! takes (`simulate_lol`, which `turn` calls for AI fixtures and delegated
//! fixtures, directly or through `simulate_series`).
//!
//! Each seeded match is reduced to a canonical string of outcome fields only: who
//! won, how long it lasted, the team totals, and per player the kills, deaths,
//! gold and damage. Assists and creep score are left out on purpose: they are
//! meant to change when the engine starts recording them, while nothing above may
//! move. A change that is invisible to the simulation keeps every digest below;
//! one that touches fights, gold, damage or the RNG breaks them.
//!
//! To regenerate the tables after an intended outcome change:
//! `cargo test -p olm_core --lib sim_background::outcome_fingerprint_tests::print_ -- --ignored --nocapture`

use rand::SeedableRng;
use rand::rngs::StdRng;

use super::*;

const ROLES: [LolRole; 5] = [
    LolRole::Top,
    LolRole::Jungle,
    LolRole::Mid,
    LolRole::Adc,
    LolRole::Support,
];

/// Matches in the always-on batch, and in the ignored large one.
const BATCH: u64 = 48;
const LARGE_BATCH: u64 = 1_200;

/// A rating moved by `delta`, kept inside the 0-100 attribute range.
fn shifted(rating: u8, delta: i16) -> u8 {
    (i16::from(rating) + delta).clamp(1, 100) as u8
}

fn player(team: &str, role: LolRole, rating: u8, tilt: i16) -> PlayerData {
    PlayerData {
        id: format!("{team}-{role:?}"),
        name: format!("{team}-{role:?}"),
        profile_image_url: None,
        role,
        condition: 100,
        fitness: 75,
        mechanics: shifted(rating, tilt),
        laning: shifted(rating, -tilt),
        teamfighting: shifted(rating, tilt / 2),
        macro_play: rating,
        consistency: shifted(rating, -tilt / 2),
        shotcalling: rating,
        champion_pool: rating,
        discipline: rating,
        mental_resilience: rating,
        is_import: false,
        traits: Vec::new(),
    }
}

/// A team whose five ratings differ by role, derived only from `base` and `salt`.
fn team(id: &str, base: u8, salt: u64) -> TeamData {
    TeamData {
        id: id.to_string(),
        name: id.to_string(),
        draft_strategy: DraftStrategy::default(),
        players: ROLES
            .iter()
            .enumerate()
            .map(|(slot, role)| {
                let spread = ((salt * 13 + slot as u64 * 7) % 15) as i16 - 7;
                let tilt = ((salt + slot as u64 * 5) % 9) as i16 - 4;
                player(id, *role, shifted(base, spread), tilt)
            })
            .collect(),
    }
}

/// Even and lopsided pairings, role spreads and draft edges, all from the match index.
fn matchup(n: u64) -> (TeamData, TeamData, MatchConfig) {
    let home = team("home", (50 + (n * 7) % 36) as u8, n);
    let away = team("away", (50 + (n * 11 + 5) % 36) as u8, n + 3);
    let config = MatchConfig {
        home_draft_modifier: [0.0, 2.0, 0.0, -2.0][(n % 4) as usize],
        away_draft_modifier: [0.0, 0.0, 1.5, 0.0][(n % 4) as usize],
        ..MatchConfig::default()
    };
    (home, away, config)
}

/// The outcome of match `n`, one canonical line. Players are sorted by id so the
/// map order does not matter, and assists and creep score are not read.
fn canonical_outcome(n: u64) -> String {
    let (home, away, config) = matchup(n);
    let mut rng = StdRng::seed_from_u64(0x5EED_0000 + n);
    let report = crate::engine::simulate_lol(&home, &away, &config, &mut rng);
    let mut players: Vec<_> = report.player_stats.iter().collect();
    players.sort_by(|a, b| a.0.cmp(b.0));
    let players: Vec<String> = players
        .into_iter()
        .map(|(id, p)| {
            format!(
                "{id}:{}/{}/{}/{}",
                p.kills, p.deaths, p.gold_earned, p.damage_dealt
            )
        })
        .collect();
    format!(
        "w={}-{} secs={} min={} end={:?} home={}/{}/{}/{} away={}/{}/{}/{} {}",
        report.home_wins,
        report.away_wins,
        report.game_duration_seconds,
        report.total_minutes,
        report.ended_by,
        report.home_stats.kills,
        report.home_stats.deaths,
        report.home_stats.gold_earned,
        report.home_stats.damage_dealt,
        report.away_stats.kills,
        report.away_stats.deaths,
        report.away_stats.gold_earned,
        report.away_stats.damage_dealt,
        players.join(" ")
    )
}

/// FNV-1a, 64 bit: stable across platforms and releases, unlike `DefaultHasher`.
fn digest(text: &str) -> u64 {
    text.bytes().fold(0xcbf2_9ce4_8422_2325_u64, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x0000_0100_0000_01b3)
    })
}

/// Digest of match `n`, then of every line in order for the large batch.
fn match_digest(n: u64) -> u64 {
    digest(&canonical_outcome(n))
}

fn large_batch_digest() -> u64 {
    let joined: Vec<String> = (0..LARGE_BATCH).map(canonical_outcome).collect();
    digest(&joined.join("\n"))
}

/// One digest per match of the always-on batch (`BATCH` entries).
const EXPECTED: [u64; BATCH as usize] = [
    0x26d7cf672d338fee,
    0xfa29d522053e5841,
    0xd785fd929bbedec2,
    0x1b986f7c0acbf7b9,
    0x96605e7d71be1d2c,
    0xe06408ebcfd6639e,
    0x354393165e299d8f,
    0xf79e48f86ac2312a,
    0xb9e933827ef38519,
    0x8fb887db6600fbe0,
    0x13eeb2b374cc3b10,
    0x29486df8c875cb64,
    0xae39d5ab44e6bcb2,
    0x7bde82ebeeffd805,
    0xd6d1d9d9405d1000,
    0x70a3f7a24709effb,
    0xbc27980df1ed0863,
    0xdf83776a1bb843a9,
    0xb6e0f4a57d93d56c,
    0x3dfbfde47fedbe5b,
    0x9c44fd18e6d06940,
    0x23921660ff23d395,
    0x8282eba0bf585a91,
    0xc2c7980b1c3c695b,
    0xb0a3fabf69d3fff3,
    0xc8a183bd80f43258,
    0x6c0b63c537fd3101,
    0x3eeac397b2298cb5,
    0xa83430c953642d5b,
    0x7d121b7a5f94155f,
    0x60b2c5ba2edf5354,
    0xbea6f9bda1135f3f,
    0x8fb2bfcf809616ab,
    0x0b968248eb41736d,
    0xe82736eac7e69fa5,
    0xca2c111f22e2eae1,
    0x9637cefeb6815280,
    0xed45c2ce140410b4,
    0xc5a8538d7adf735a,
    0x6f6abb21ea1507d6,
    0xb0b29b61394660c5,
    0x0632495bc44db2c7,
    0xdd534e33a2bba9d5,
    0xa68143c37cfc3a95,
    0x88b93a6604827b89,
    0x073a0aeac1f7dab2,
    0x618ef92457299dd7,
    0xbb22ad9235528428,
];

/// Digest of all `LARGE_BATCH` matches joined with newlines.
const EXPECTED_LARGE: u64 = 0x9723c92a1f0a7d00;

#[test]
fn background_outcomes_match_the_pinned_fingerprint() {
    for (n, expected) in EXPECTED.iter().enumerate() {
        let line = canonical_outcome(n as u64);
        assert_eq!(
            digest(&line),
            *expected,
            "match {n} outcome changed; canonical line: {line}"
        );
    }
}

#[test]
fn background_outcomes_repeat_for_the_same_seed() {
    assert_eq!(canonical_outcome(7), canonical_outcome(7));
}

#[test]
fn background_batch_covers_both_winners() {
    let home_wins = (0..BATCH)
        .filter(|n| canonical_outcome(*n).starts_with("w=1-0"))
        .count();
    assert!(
        (1..BATCH as usize).contains(&home_wins),
        "the batch must contain home and away winners, home won {home_wins}"
    );
}

#[test]
#[ignore = "pins a 1200-match batch; slow in debug, run with --release --ignored"]
fn background_outcomes_of_a_large_batch_match_the_pinned_fingerprint() {
    assert_eq!(large_batch_digest(), EXPECTED_LARGE);
}

#[test]
#[ignore = "prints the tables to paste into EXPECTED and EXPECTED_LARGE; run with --nocapture"]
fn print_outcome_fingerprints() {
    println!("EXPECTED:");
    for n in 0..BATCH {
        println!("    {:#018x},", match_digest(n));
    }
    println!("EXPECTED_LARGE: {:#018x}", large_batch_digest());
}
