//! Every system that reads a player's age must read the same one.
//!
//! A reader agrees when it gives the same answer for a player as for a twin whose date of
//! birth is real and puts them exactly at [`player_age`]'s age on the same day. Run over
//! every player of `data/players`, this covers players with a date of birth, players
//! without one and the one outlier with a birth date in 2023.

use std::path::Path;

use chrono::{Months, NaiveDate, TimeZone, Utc};

use crate::ai_team_agent::retention_score;
use crate::clock::GameClock;
use crate::contracts::{expected_contract_years, expected_wage};
use crate::domain::manager::Manager;
use crate::domain::player::Player;
use crate::domain::team::Team;
use crate::game::Game;
use crate::player_age::player_age;
use crate::training::condition_recovery;
use crate::transfers::{calculate_player_offer_value, calculate_wage_acceptance_score};

const MARKET_VALUE: u64 = 1_000_000;

fn date(year: i32, month: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(year, month, day).unwrap()
}

/// Days spread over three seasons, so a player crosses birthdays and age bands.
fn sample_dates() -> [NaiveDate; 4] {
    [
        date(2027, 1, 1),
        date(2027, 8, 15),
        date(2028, 3, 10),
        date(2030, 11, 30),
    ]
}

fn team(id: &str) -> Team {
    Team::new(
        id.to_string(),
        id.to_string(),
        id.to_string(),
        "England".to_string(),
        "London".to_string(),
        "Ground".to_string(),
        10_000,
    )
}

/// Every player of `data/players` once per id, with the fields the readers price
/// filled in, so a different age band changes their answer.
fn shipped_players() -> Vec<Player> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../data/players");
    let mut files: Vec<_> = std::fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
        .collect();
    files.sort();

    let mut seen = std::collections::BTreeSet::new();
    let mut players = Vec::new();
    for file in files {
        let parsed: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(file).unwrap()).unwrap();
        let records: Vec<Player> = serde_json::from_value(parsed["players"].clone()).unwrap();
        for mut player in records {
            if !seen.insert(player.id.clone()) {
                continue;
            }
            player.market_value = MARKET_VALUE;
            player.potential_base = 0;
            player.wage = 100_000;
            player.contract_end = Some("2031-06-30".to_string());
            players.push(player);
        }
    }
    players
}

fn twin(player: &Player, on: NaiveDate) -> Player {
    let years = player_age(player, on).years;
    let date_of_birth = on.checked_sub_months(Months::new(years * 12)).unwrap();
    let mut twin = player.clone();
    twin.date_of_birth = date_of_birth.format("%Y-%m-%d").to_string();
    twin
}

/// Counts the players (over every sample date) the reader answers differently for than
/// for their twin.
fn disagreements<T: PartialEq>(reader: impl Fn(&Player, NaiveDate) -> T) -> usize {
    let mut count = 0;
    for player in shipped_players() {
        for on in sample_dates() {
            if reader(&player, on) != reader(&twin(&player, on), on) {
                count += 1;
            }
        }
    }
    count
}

#[test]
fn the_sample_has_players_with_and_without_a_date_of_birth() {
    let on = date(2027, 1, 1);
    let players = shipped_players();
    let unknown = players.iter().filter(|p| !player_age(p, on).known).count();
    assert!(unknown >= 500, "{unknown} unknown of {}", players.len());
    assert!(players.len() - unknown >= 1000);
}

#[test]
fn contract_wage_reads_the_shared_age() {
    let club = team("club");
    assert_eq!(disagreements(|p, on| expected_wage(p, &club, on)), 0);
}

#[test]
fn contract_length_reads_the_shared_age() {
    assert_eq!(disagreements(expected_contract_years), 0);
}

#[test]
fn ai_retention_reads_the_shared_age() {
    let club = team("club");
    assert_eq!(
        disagreements(|p, on| retention_score(p, &club, on).to_bits()),
        0
    );
}

#[test]
fn transfer_offer_value_reads_the_shared_age() {
    assert_eq!(
        disagreements(|p, on| calculate_player_offer_value(on, p)),
        0
    );
}

#[test]
fn wage_acceptance_reads_the_shared_age() {
    let game = Game::new(
        GameClock::new(Utc.with_ymd_and_hms(2027, 1, 1, 12, 0, 0).unwrap()),
        Manager::new(
            "manager".to_string(),
            "Alex".to_string(),
            "Manager".to_string(),
            "1980-01-01".to_string(),
            "England".to_string(),
        ),
        vec![],
        vec![],
        vec![],
        vec![],
    );
    assert_eq!(
        disagreements(|p, on| calculate_wage_acceptance_score(on, p, 120_000, 100_000, 3, &game)),
        0
    );
}

#[test]
fn training_recovery_reads_the_shared_age() {
    assert_eq!(disagreements(|p, on| condition_recovery(p, 9.0, on)), 0);
}

#[test]
fn a_player_without_a_date_of_birth_is_not_offered_for_as_a_teenager() {
    let on = date(2027, 1, 1);
    let teenage_offer = (MARKET_VALUE as f64 * 1.30).round() as u64;
    for player in shipped_players() {
        let age = player_age(&player, on);
        if age.known || age.years <= 20 {
            continue;
        }
        let offer = calculate_player_offer_value(on, &player);
        assert!(
            offer < teenage_offer,
            "{} is {} and costs {offer}",
            player.id,
            age.years
        );
    }
}
