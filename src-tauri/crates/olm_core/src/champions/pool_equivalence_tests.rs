//! The indexed mastery seed, the batched training-target pick and the batched mastery
//! training ticks must give exactly what the per-entry and per-player code gave.
//!
//! The `legacy_*` functions are the previous implementation (copied, only renamed): one
//! scan of the mastery table per upsert, one scan of the player and mastery tables per
//! rostered player, and several table scans per training attempt.

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

fn legacy_ensure_training_targets_from_mastery(game: &mut Game, player_id: &str) {
    let has_existing_targets = game
        .players
        .iter()
        .find(|candidate| candidate.id == player_id)
        .is_some_and(|player| !training_targets_for_player(player).is_empty());
    if has_existing_targets {
        return;
    }

    let role = game
        .players
        .iter()
        .find(|candidate| candidate.id == player_id)
        .map(|player| match player.natural_position {
            crate::domain::player::LolRole::Top => "Top",
            crate::domain::player::LolRole::Jungle => "Jungle",
            crate::domain::player::LolRole::Mid => "Mid",
            crate::domain::player::LolRole::Adc => "ADC",
            crate::domain::player::LolRole::Support => "Support",
            crate::domain::player::LolRole::Unknown => "Unknown",
        })
        .unwrap_or("Unknown");

    let discovered: HashSet<String> = game
        .champion_patch
        .discovered_champion_ids
        .iter()
        .map(|id| normalize_key(id))
        .collect();

    let tier_score = |tier: &str| -> i32 {
        match tier.to_uppercase().as_str() {
            "S" => 100,
            "A" => 85,
            "B" => 70,
            "C" => 55,
            "D" => 40,
            _ => 60,
        }
    };

    let mastery_map: HashMap<String, u8> = game
        .champion_masteries
        .iter()
        .filter(|entry| entry.player_id == player_id)
        .map(|entry| (normalize_key(&entry.champion_id), entry.mastery))
        .collect();

    let mut by_meta: Vec<(String, i32)> = game
        .champion_patch
        .hidden_meta
        .iter()
        .filter(|meta| normalize_key(&meta.role) == normalize_key(role))
        .filter(|meta| {
            let key = normalize_key(&meta.champion_id);
            discovered.is_empty() || discovered.contains(&key)
        })
        .map(|meta| {
            let key = normalize_key(&meta.champion_id);
            let mastery = i32::from(*mastery_map.get(&key).unwrap_or(&MIN_MASTERY));
            let mastery_gap = i32::from(MASTERY_CAP) - mastery;
            let role_fit = if normalize_key(&meta.role) == normalize_key(role) {
                10
            } else {
                0
            };
            let score = tier_score(&meta.tier) * 2 + role_fit + mastery_gap;
            (meta.champion_id.clone(), score)
        })
        .collect();
    by_meta.sort_by_key(|entry| std::cmp::Reverse(entry.1));

    let mut selected: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for (champion_id, _) in by_meta {
        let key = normalize_key(&champion_id);
        if seen.contains(&key) {
            continue;
        }
        seen.insert(key);
        selected.push(champion_id);
        if selected.len() >= 3 {
            break;
        }
    }

    if selected.len() < 3 {
        let mut ranked_masteries: Vec<(String, u8)> = game
            .champion_masteries
            .iter()
            .filter(|entry| entry.player_id == player_id)
            .map(|entry| (entry.champion_id.clone(), entry.mastery))
            .collect();
        ranked_masteries.sort_by_key(|entry| std::cmp::Reverse(entry.1));
        for (champion_id, _) in ranked_masteries {
            let key = normalize_key(&champion_id);
            if seen.contains(&key) {
                continue;
            }
            seen.insert(key);
            selected.push(champion_id);
            if selected.len() >= 3 {
                break;
            }
        }
    }

    if selected.is_empty() {
        return;
    }

    if let Some(player) = game
        .players
        .iter_mut()
        .find(|candidate| candidate.id == player_id)
    {
        player.champion_training_targets.clear();
        player.champion_training_targets.extend(selected);
        player.champion_training_targets.truncate(3);
        player.champion_training_targets.resize(3, String::new());
    }
}

fn legacy_soloq_lp_for_player(game: &Game, player: &Player) -> f64 {
    let day_index = days_between(game.clock.start_date, game.clock.current_date);
    let formula_lp = (soloq_points_at(game, player, day_index) - SOLOQ_POINTS_BASELINE).max(0.0);
    soloq_decay::displayed_lp(game.soloq_decay_mode, player, formula_lp)
}

fn legacy_mastery_gain_multiplier_for_player(game: &Game, player_id: &str) -> f64 {
    let Some(player) = game
        .players
        .iter()
        .find(|candidate| candidate.id == player_id)
    else {
        return 1.0;
    };
    soloq_multiplier_for_tier(soloq_tier_from_lp(legacy_soloq_lp_for_player(game, player)))
}

fn legacy_apply_training_mastery_progress(
    game: &mut Game,
    player_id: &str,
    champion_id: &str,
    gain_factor: f64,
    rng: &mut impl Rng,
) {
    let current = mastery_for_player_champion(game, player_id, champion_id);
    let Some(player) = game
        .players
        .iter()
        .find(|candidate| candidate.id == player_id)
    else {
        return;
    };

    let mechanics = f64::from(player.attributes.mechanics.min(100)) / 100.0;
    let champion_pool = f64::from(player.attributes.champion_pool.min(100)) / 100.0;
    let stat_push = (mechanics * 0.6) + (champion_pool * 0.6);

    let headroom = f64::from(MASTERY_CAP.saturating_sub(current)) / 75.0;
    let chance = (0.16 + gain_factor * 0.26 + headroom * 0.2 + stat_push * 0.18).clamp(0.14, 0.88);
    let roll: f64 = rng.random_range(0.0..1.0);
    if roll > chance {
        return;
    }

    let stat_bonus = if mechanics >= 0.85 && champion_pool >= 0.85 {
        2
    } else if mechanics >= 0.72 || champion_pool >= 0.72 {
        1
    } else {
        0
    };

    let gain = if current >= 90 {
        2 + stat_bonus
    } else if current >= 75 {
        3 + stat_bonus
    } else {
        4 + stat_bonus
    };
    let next = current.saturating_add(gain).min(MASTERY_CAP);
    upsert_mastery(game, player_id, champion_id, next);
}

fn legacy_apply_training_ticks(
    game: &mut Game,
    ticks: &[(String, String, f64, u8)],
    rng: &mut StdRng,
) {
    for (player_id, champion_id, gain, attempts) in ticks {
        let soloq_mult = legacy_mastery_gain_multiplier_for_player(game, player_id);
        let effective_gain = gain * soloq_mult;
        for _ in 0..*attempts {
            legacy_apply_training_mastery_progress(
                game,
                player_id,
                champion_id,
                effective_gain,
                rng,
            );
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
    let level = 45 + (index * 7 % 56) as u8;
    let mut player = Player::new(
        format!("p{index:03}"),
        format!("p{index:03}"),
        format!("Player {index}"),
        "2000-01-01".to_string(),
        "Spain".to_string(),
        role,
        PlayerAttributes {
            mental_resilience: level,
            champion_pool: level.saturating_add(3).min(100),
            laning: level,
            mechanics: level.saturating_add(5).min(100),
            macro_play: level,
            consistency: level,
            discipline: level,
            teamfighting: level,
            shotcalling: level,
        },
    );
    // Two players in three are rostered, the rest are free agents.
    player.team_id = (!index.is_multiple_of(3)).then(|| "t1".to_string());
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

fn targets(game: &Game) -> Vec<(String, Vec<String>)> {
    game.players
        .iter()
        .map(|player| (player.id.clone(), player.champion_training_targets.clone()))
        .collect()
}

fn all_ids(game: &Game) -> Vec<String> {
    game.players
        .iter()
        .map(|player| player.id.clone())
        .collect()
}

/// Seeds with the current code, then makes the tables awkward for the picks: a player with
/// existing targets, ties in mastery, and a champion written in another spelling.
fn seeded_fixture() -> Game {
    let mut game = fixture();
    bootstrap_seed_masteries(&mut game);
    for entry in game.champion_masteries.iter_mut().step_by(4) {
        entry.mastery = 55;
    }
    game.players[1].champion_training_targets =
        vec!["Ahri".to_string(), String::new(), String::new()];
    game.players[2].champion_training_targets = vec![String::new(); 3];
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

// ---------------------------------------------------------------------------
// Training targets
// ---------------------------------------------------------------------------

fn assert_batch_matches_sequential(mut batched: Game, mut sequential: Game) {
    let ids = all_ids(&batched);

    ensure_training_targets_for_players(&mut batched, &ids);
    for id in &ids {
        legacy_ensure_training_targets_from_mastery(&mut sequential, id);
    }

    assert_eq!(targets(&batched), targets(&sequential));
}

#[test]
fn batched_targets_should_assign_to_players_without_targets() {
    let mut game = seeded_fixture();
    let ids = all_ids(&game);

    ensure_training_targets_for_players(&mut game, &ids);

    let assigned = game
        .players
        .iter()
        .filter(|player| !training_targets_for_player(player).is_empty())
        .count();
    assert!(assigned > PLAYERS / 2, "{assigned} players got targets");
}

#[test]
fn batched_targets_should_match_the_per_player_pick() {
    assert_batch_matches_sequential(seeded_fixture(), seeded_fixture());
}

#[test]
fn batched_targets_should_match_when_the_meta_has_too_few_champions() {
    let shrink = |game: &mut Game| game.champion_patch.hidden_meta.truncate(2);
    let (mut batched, mut sequential) = (seeded_fixture(), seeded_fixture());
    shrink(&mut batched);
    shrink(&mut sequential);

    assert_batch_matches_sequential(batched, sequential);
}

#[test]
fn batched_targets_should_match_when_nothing_is_discovered_yet() {
    let clear = |game: &mut Game| game.champion_patch.discovered_champion_ids.clear();
    let (mut batched, mut sequential) = (seeded_fixture(), seeded_fixture());
    clear(&mut batched);
    clear(&mut sequential);

    assert_batch_matches_sequential(batched, sequential);
}

#[test]
fn batched_targets_should_match_when_the_meta_is_empty() {
    let clear = |game: &mut Game| game.champion_patch.hidden_meta.clear();
    let (mut batched, mut sequential) = (seeded_fixture(), seeded_fixture());
    clear(&mut batched);
    clear(&mut sequential);

    assert_batch_matches_sequential(batched, sequential);
}

#[test]
fn batched_targets_should_match_with_repeated_and_unknown_ids() {
    let (mut batched, mut sequential) = (seeded_fixture(), seeded_fixture());
    let mut ids = all_ids(&batched);
    ids.extend(["p004".to_string(), "nobody".to_string(), "p000".to_string()]);

    ensure_training_targets_for_players(&mut batched, &ids);
    for id in &ids {
        legacy_ensure_training_targets_from_mastery(&mut sequential, id);
    }

    assert_eq!(targets(&batched), targets(&sequential));
}

#[test]
fn single_player_pick_should_match_the_previous_scan() {
    let (mut single, mut scanning) = (seeded_fixture(), seeded_fixture());

    for id in all_ids(&single) {
        ensure_training_targets_from_mastery(&mut single, &id);
        legacy_ensure_training_targets_from_mastery(&mut scanning, &id);
    }

    assert_eq!(targets(&single), targets(&scanning));
}

// ---------------------------------------------------------------------------
// Training ticks
// ---------------------------------------------------------------------------

/// Ticks for every player: a champion the player has, the same one spelled differently,
/// and one the player has not played; plus an unknown player and a repeated pair.
fn ticks(game: &Game) -> Vec<(String, String, f64, u8)> {
    let mut ticks = Vec::new();
    for (index, player) in game.players.iter().enumerate() {
        let known = game
            .champion_masteries
            .iter()
            .find(|entry| entry.player_id == player.id)
            .map(|entry| entry.champion_id.clone());
        let attempts = 1 + (index % 4) as u8;
        let gain = 0.2 + (index % 7) as f64 * 0.05;
        if let Some(known) = known {
            ticks.push((player.id.clone(), known.to_lowercase(), gain, attempts));
            ticks.push((player.id.clone(), known, gain, attempts));
        }
        ticks.push((
            player.id.clone(),
            format!("Fresh{}", index % 5),
            gain,
            attempts,
        ));
        ticks.push((player.id.clone(), "Fresh0".to_string(), gain, 2));
    }
    ticks.push(("nobody".to_string(), "Ahri".to_string(), 0.3, 3));
    ticks
}

#[test]
fn fixture_should_cover_more_than_one_soloq_multiplier() {
    let game = seeded_fixture();

    let multipliers: HashSet<u64> = game
        .players
        .iter()
        .map(|player| legacy_mastery_gain_multiplier_for_player(&game, &player.id).to_bits())
        .collect();

    assert!(multipliers.len() >= 2, "{} multipliers", multipliers.len());
}

#[test]
fn soloq_lp_for_player_should_match_the_previous_chain() {
    let game = seeded_fixture();

    for player in &game.players {
        assert_eq!(
            soloq_lp_for_player(&game, player).to_bits(),
            legacy_soloq_lp_for_player(&game, player).to_bits(),
            "{}",
            player.id
        );
    }
}

#[test]
fn batched_ticks_should_match_the_per_attempt_scans() {
    let (mut batched, mut scanning) = (seeded_fixture(), seeded_fixture());
    batched.clock.current_date += chrono::Duration::days(2);
    scanning.clock.current_date += chrono::Duration::days(2);
    let ticks = ticks(&batched);
    let (mut batched_rng, mut scanning_rng) =
        (StdRng::seed_from_u64(11), StdRng::seed_from_u64(11));

    apply_training_mastery_ticks(&mut batched, &ticks, &mut batched_rng);
    legacy_apply_training_ticks(&mut scanning, &ticks, &mut scanning_rng);

    assert_eq!(mastery_rows(&batched), mastery_rows(&scanning));
    assert_eq!(
        batched_rng.random_range(0.0..1.0_f64).to_bits(),
        scanning_rng.random_range(0.0..1.0_f64).to_bits(),
        "the random stream must be left at the same point"
    );
}

#[test]
fn batched_ticks_should_change_the_table() {
    let mut game = seeded_fixture();
    let before = mastery_rows(&game);
    let ticks = ticks(&game);

    apply_training_mastery_ticks(&mut game, &ticks, &mut StdRng::seed_from_u64(11));

    assert_ne!(mastery_rows(&game), before);
}

#[test]
fn mastery_index_signal_should_follow_upserts_like_the_table_scan() {
    let mut game = seeded_fixture();
    let mut index = MasteryIndex::new(&game);
    let calls = [
        ("p001", "Fresh0", 99),
        ("p001", "Fresh1", 98),
        ("p001", "FRESH0", 97),
        ("p002", "Fresh0", 1),
        ("p004", "Ahri", 100),
        ("nobody", "Ahri", 80),
    ];

    for (player_id, champion_id, value) in calls {
        index.upsert(&mut game, player_id, champion_id, value);
        for player in &game.players {
            assert_eq!(
                index.mastery_signal(&game, &player.id).to_bits(),
                mastery_signal_for_player(&game, &player.id).to_bits(),
                "{} after {player_id}/{champion_id}",
                player.id
            );
        }
    }
}
