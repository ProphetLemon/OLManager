//! The indexed mastery seed must give exactly what the per-entry scan gave.
//!
//! `legacy_bootstrap_seed_masteries` is the previous implementation (copied, only
//! renamed): one scan of the whole mastery table per upsert.

use super::*;
use crate::clock::GameClock;
use crate::domain::manager::Manager;
use crate::domain::player::{LolRole, Player, PlayerAttributes};
use chrono::{TimeZone, Utc};

// ---------------------------------------------------------------------------
// Legacy reference
// ---------------------------------------------------------------------------

fn legacy_bootstrap_seed_masteries(game: &mut Game) {
    // Preserve existing masteries from saves (Flow C).
    if !game.champion_masteries.is_empty() {
        return;
    }

    let catalog = champion_catalog();

    // Group champion IDs by role from the static catalog.
    // The catalog returns (champion_id, role) pairs, one per role per champ.
    let mut by_role: HashMap<&str, Vec<&str>> = HashMap::new();
    for (champion_id, role) in catalog.iter() {
        by_role
            .entry(role.as_str())
            .or_default()
            .push(champion_id.as_str());
    }

    // Collect (player_id, role_str) upfront to avoid borrowing conflicts.
    let player_roles: Vec<(String, String)> = game
        .players
        .iter()
        .filter_map(|p| {
            let role = match p.natural_position {
                crate::domain::player::LolRole::Top => "Top",
                crate::domain::player::LolRole::Jungle => "Jungle",
                crate::domain::player::LolRole::Mid => "Mid",
                crate::domain::player::LolRole::Adc => "ADC",
                crate::domain::player::LolRole::Support => "Support",
                crate::domain::player::LolRole::Unknown => return None,
            };
            Some((p.id.clone(), role.to_string()))
        })
        .collect();

    for (player_id, role_str) in &player_roles {
        let Some(champions) = by_role.get(role_str.as_str()) else {
            continue;
        };
        if champions.is_empty() {
            continue;
        }

        // Deterministic count: 4-6 champions per player.
        let count_seed = format!("{}_{}", player_id, "seed_count");
        let count =
            4 + (hash_text(&count_seed) as usize % 3.min(champions.len().saturating_sub(4)));
        let count = count.min(champions.len());

        // Sort champions deterministically using a hash seeded by player_id.
        let mut sorted: Vec<&&str> = champions.iter().collect();
        sorted.sort_by(|a, b| {
            let ha = hash_text(&format!("{}_{}", player_id, a));
            let hb = hash_text(&format!("{}_{}", player_id, b));
            ha.cmp(&hb)
        });

        for champion_id in sorted.iter().take(count) {
            let mastery_seed = format!("{}_{}_mastery", player_id, champion_id);
            let mastery = 40 + (hash_text(&mastery_seed) as u8 % 41); // 40..80
            upsert_mastery(game, player_id, champion_id, mastery);
        }
    }
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const PLAYERS: usize = 240;

fn player(index: usize) -> Player {
    let role = match index % 6 {
        0 => LolRole::Top,
        1 => LolRole::Jungle,
        2 => LolRole::Mid,
        3 => LolRole::Adc,
        4 => LolRole::Support,
        _ => LolRole::Unknown,
    };
    let mut player = Player::new(
        format!("p{index:03}"),
        format!("p{index:03}"),
        format!("Player {index}"),
        "2000-01-01".to_string(),
        "Spain".to_string(),
        role,
        PlayerAttributes {
            mental_resilience: 60,
            champion_pool: 60,
            laning: 60,
            mechanics: 60,
            macro_play: 60,
            consistency: 60,
            discipline: 60,
            teamfighting: 60,
            shotcalling: 60,
        },
    );
    // Rostered players come first, the rest are free agents.
    player.team_id = (index % 3 != 0).then(|| "t1".to_string());
    player
}

/// A game with `PLAYERS` players of every role, no masteries yet, and the champion patch
/// seeded from a fixed seed.
fn fixture() -> Game {
    let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 8, 1, 12, 0, 0).unwrap());
    let manager = Manager::new(
        "manager-1".to_string(),
        "Jane".to_string(),
        "Doe".to_string(),
        "1980-01-01".to_string(),
        "Spain".to_string(),
    );
    let players = (0..PLAYERS).map(player).collect();
    let mut game = Game::new(clock, manager, vec![], players, vec![], vec![]);
    game.champion_patch.rng_seed = 7;
    ensure_initial_patch_state(&mut game);
    seed_initial_discovery(&mut game);
    game
}

fn mastery_rows(game: &Game) -> Vec<(String, String, u8, String)> {
    game.champion_masteries
        .iter()
        .map(|entry| {
            (
                entry.player_id.clone(),
                entry.champion_id.clone(),
                entry.mastery,
                entry.last_active_on.clone(),
            )
        })
        .collect()
}

/// Seeds with the current code, then makes the table awkward: ties in mastery and a
/// champion written in another spelling.
fn seeded_fixture() -> Game {
    let mut game = fixture();
    bootstrap_seed_masteries(&mut game);
    for entry in game.champion_masteries.iter_mut().step_by(4) {
        entry.mastery = 55;
    }
    let first = game.champion_masteries[0].clone();
    game.champion_masteries.push(ChampionMasteryEntry {
        champion_id: first.champion_id.to_uppercase(),
        mastery: 90,
        ..first
    });
    game
}

// ---------------------------------------------------------------------------
// Season seed
// ---------------------------------------------------------------------------

#[test]
fn fixture_should_seed_masteries_for_most_players() {
    let mut game = fixture();

    bootstrap_seed_masteries(&mut game);

    assert!(game.champion_masteries.len() > PLAYERS * 3);
}

#[test]
fn indexed_seed_should_match_the_scanning_seed_row_for_row() {
    let mut indexed = fixture();
    let mut scanning = fixture();

    bootstrap_seed_masteries(&mut indexed);
    legacy_bootstrap_seed_masteries(&mut scanning);

    assert_eq!(mastery_rows(&indexed), mastery_rows(&scanning));
}

#[test]
fn indexed_seed_should_leave_an_existing_table_alone() {
    let mut indexed = seeded_fixture();
    let mut scanning = seeded_fixture();

    bootstrap_seed_masteries(&mut indexed);
    legacy_bootstrap_seed_masteries(&mut scanning);

    assert_eq!(mastery_rows(&indexed), mastery_rows(&scanning));
}

#[test]
fn mastery_index_should_upsert_like_the_scanning_upsert() {
    let mut indexed = seeded_fixture();
    let mut scanning = seeded_fixture();
    indexed.clock.current_date += chrono::Duration::days(3);
    scanning.clock.current_date += chrono::Duration::days(3);
    // Hits (also through another spelling, and a duplicated key: the first entry wins),
    // misses, a repeat of a miss, and values past both bounds.
    let first = indexed.champion_masteries[0].clone();
    let calls = [
        (
            first.player_id.as_str(),
            first.champion_id.to_uppercase(),
            71,
        ),
        ("p001", "Brand-New".to_string(), 12),
        ("p001", "brandnew".to_string(), 99),
        ("p002", "Ahri".to_string(), 0),
        ("p002", "Ahri".to_string(), 255),
        ("nobody", "Ahri".to_string(), 50),
        ("p003", "Kai'Sa".to_string(), 64),
        ("p003", "KAISA".to_string(), 66),
    ];

    let mut index = MasteryIndex::new(&indexed);
    for (player_id, champion_id, value) in &calls {
        index.upsert(&mut indexed, player_id, champion_id, *value);
        upsert_mastery(&mut scanning, player_id, champion_id, *value);
    }

    assert_eq!(mastery_rows(&indexed), mastery_rows(&scanning));
}
