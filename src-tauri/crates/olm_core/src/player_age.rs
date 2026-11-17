//! One age for every player, whether or not the data ships a date of birth.

use chrono::{Days, Months, NaiveDate};

use crate::domain::player::Player;
use crate::stable_hash::stable_hash;

/// The day a new game starts for the shipped roster snapshot (see
/// `game_setup::new_game_start_date`). The age table below is measured on this date.
const ANCHOR: NaiveDate = match NaiveDate::from_ymd_opt(2027, 1, 1) {
    Some(date) => date,
    None => panic!("the anchor is a valid date"),
};

/// `(age on ANCHOR, players)` for every player of `data/players` with a readable date of
/// birth, counted once per id (first file in name order wins). Unknown birth dates are
/// drawn from it. Only ages 15 to 40 count: one record ships a birth date in 2023, a data
/// error, and nobody else is under 17 or over 35.
const AGE_COUNTS: [(u32, u32); 19] = [
    (17, 3),
    (18, 17),
    (19, 48),
    (20, 72),
    (21, 115),
    (22, 143),
    (23, 163),
    (24, 154),
    (25, 122),
    (26, 128),
    (27, 76),
    (28, 59),
    (29, 25),
    (30, 11),
    (31, 9),
    (32, 4),
    (33, 4),
    (34, 1),
    (35, 1),
];

/// A player's age on a date, and whether it comes from a real date of birth.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PlayerAge {
    pub years: u32,
    pub known: bool,
}

/// Date formats the data ships: ISO, and the "Month D, YYYY" form of some imported
/// records. The frontend parser (`calcAge`) accepts exactly the same two.
const DATE_OF_BIRTH_FORMATS: [&str; 2] = ["%Y-%m-%d", "%B %d, %Y"];

/// The date of birth a record carries, or `None` when it is empty or in neither format.
pub fn parse_date_of_birth(raw: &str) -> Option<NaiveDate> {
    let raw = raw.trim();
    DATE_OF_BIRTH_FORMATS
        .iter()
        .find_map(|format| NaiveDate::parse_from_str(raw, format).ok())
}

/// The age of `player` on `on`.
///
/// A readable date of birth gives the exact age, counting the birthday. Without one the
/// age is drawn from the shipped players' age distribution on [`ANCHOR`], keyed on the
/// player id, and grows with `on` like a real age. The draw is a hash, not an RNG, so
/// every system that asks gets the same answer for the same player and date.
pub fn player_age(player: &Player, on: NaiveDate) -> PlayerAge {
    match parse_date_of_birth(&player.date_of_birth) {
        Some(date_of_birth) => PlayerAge {
            years: whole_years(date_of_birth, on),
            known: true,
        },
        None => PlayerAge {
            years: whole_years(assumed_date_of_birth(&player.id), on),
            known: false,
        },
    }
}

fn whole_years(date_of_birth: NaiveDate, on: NaiveDate) -> u32 {
    on.years_since(date_of_birth).unwrap_or(0)
}

/// The birth date that makes the player exactly their drawn age on [`ANCHOR`], with a
/// birthday that falls anywhere in the following year.
fn assumed_date_of_birth(player_id: &str) -> NaiveDate {
    let total: u64 = AGE_COUNTS.iter().map(|&(_, count)| u64::from(count)).sum();
    let pick = stable_hash(player_id, "age-on-anchor") % total;
    let mut cumulative = 0_u64;
    let age = AGE_COUNTS
        .iter()
        .find(|&&(_, count)| {
            cumulative += u64::from(count);
            pick < cumulative
        })
        .map_or(AGE_COUNTS[AGE_COUNTS.len() - 1].0, |&(age, _)| age);
    let days_past_birthday = stable_hash(player_id, "days-past-birthday") % 365;

    ANCHOR
        .checked_sub_months(Months::new(age * 12))
        .and_then(|date| date.checked_sub_days(Days::new(days_past_birthday)))
        .unwrap_or(ANCHOR)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::path::Path;

    use chrono::NaiveDate;

    use super::{PlayerAge, parse_date_of_birth, player_age};

    /// The ages `AGE_COUNTS` takes in.
    const PLAUSIBLE_AGES: std::ops::RangeInclusive<u32> = 15..=40;
    use crate::domain::player::{Player, PlayerAttributes};
    use crate::domain::stats::LolRole;

    fn date(year: i32, month: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(year, month, day).unwrap()
    }

    fn player(id: &str, date_of_birth: &str) -> Player {
        Player::new(
            id.to_string(),
            id.to_string(),
            id.to_string(),
            date_of_birth.to_string(),
            "England".to_string(),
            LolRole::Mid,
            PlayerAttributes::default(),
        )
    }

    fn unknown_players(count: usize) -> Vec<Player> {
        (0..count)
            .map(|index| player(&format!("player-{index:04}"), ""))
            .collect()
    }

    #[test]
    fn iso_date_parses() {
        assert_eq!(parse_date_of_birth("2006-01-19"), Some(date(2006, 1, 19)));
    }

    #[test]
    fn month_name_date_parses() {
        assert_eq!(
            parse_date_of_birth("January 19, 2006"),
            Some(date(2006, 1, 19))
        );
    }

    #[test]
    fn month_name_date_without_zero_padding_parses() {
        assert_eq!(
            parse_date_of_birth("November 5, 2002"),
            Some(date(2002, 11, 5))
        );
    }

    #[test]
    fn surrounding_whitespace_is_ignored() {
        assert_eq!(parse_date_of_birth(" 2006-01-19 "), Some(date(2006, 1, 19)));
    }

    #[test]
    fn empty_and_malformed_dates_do_not_parse() {
        for raw in ["", "   ", "unknown", "2006-13-40", "19/01/2006", "2006"] {
            assert_eq!(parse_date_of_birth(raw), None, "{raw:?}");
        }
    }

    #[test]
    fn known_date_of_birth_counts_the_birthday() {
        let p = player("p1", "2000-05-05");
        assert_eq!(
            player_age(&p, date(2026, 5, 4)),
            PlayerAge {
                years: 25,
                known: true
            }
        );
        assert_eq!(
            player_age(&p, date(2026, 5, 5)),
            PlayerAge {
                years: 26,
                known: true
            }
        );
    }

    #[test]
    fn month_name_date_of_birth_is_known() {
        let p = player("p1", "January 19, 2006");
        assert_eq!(
            player_age(&p, date(2027, 1, 1)),
            PlayerAge {
                years: 20,
                known: true
            }
        );
    }

    #[test]
    fn date_of_birth_after_the_date_gives_age_zero() {
        let p = player("p1", "2030-01-01");
        assert_eq!(player_age(&p, date(2027, 1, 1)).years, 0);
    }

    #[test]
    fn unknown_date_of_birth_is_flagged_unknown() {
        let p = player("p1", "");
        assert!(!player_age(&p, date(2027, 1, 1)).known);
    }

    #[test]
    fn unknown_age_is_the_same_on_every_call() {
        let p = player("player-0001", "");
        let on = date(2028, 3, 9);
        assert_eq!(player_age(&p, on), player_age(&p, on));
    }

    #[test]
    fn unknown_age_rises_by_one_a_year_later() {
        for p in unknown_players(200) {
            let now = player_age(&p, date(2027, 1, 1)).years;
            assert_eq!(player_age(&p, date(2028, 1, 1)).years, now + 1, "{}", p.id);
            assert_eq!(player_age(&p, date(2030, 1, 1)).years, now + 3, "{}", p.id);
        }
    }

    #[test]
    fn different_unknown_players_get_different_ages() {
        let on = date(2027, 1, 1);
        let ages: std::collections::BTreeSet<u32> = unknown_players(100)
            .iter()
            .map(|p| player_age(p, on).years)
            .collect();
        assert!(ages.len() > 5, "only {} distinct ages", ages.len());
    }

    #[test]
    fn unknown_ages_follow_the_real_distribution() {
        let on = date(2027, 1, 1);
        let mut ages: Vec<u32> = unknown_players(2000)
            .iter()
            .map(|p| player_age(p, on).years)
            .collect();
        ages.sort_unstable();
        assert_eq!(ages[ages.len() / 2], 24, "median");
        assert_eq!(ages[ages.len() / 4], 22, "p25");
        assert_eq!(ages[ages.len() * 3 / 4], 26, "p75");
    }

    #[test]
    fn age_table_matches_the_shipped_players() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../data/players");
        let mut files: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
            .collect();
        files.sort();

        let mut seen = std::collections::BTreeSet::new();
        let mut counts: BTreeMap<u32, u32> = BTreeMap::new();
        for file in files {
            let raw = std::fs::read_to_string(&file).unwrap();
            let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
            for record in parsed["players"].as_array().unwrap() {
                let id = record["id"].as_str().unwrap().to_string();
                if !seen.insert(id) {
                    continue;
                }
                let Some(dob) = record["date_of_birth"]
                    .as_str()
                    .and_then(parse_date_of_birth)
                else {
                    continue;
                };
                let age = super::ANCHOR.years_since(dob).unwrap_or(0);
                if PLAUSIBLE_AGES.contains(&age) {
                    *counts.entry(age).or_default() += 1;
                }
            }
        }
        let recomputed: Vec<(u32, u32)> = counts.into_iter().collect();
        assert_eq!(
            recomputed,
            super::AGE_COUNTS.to_vec(),
            "data/players changed: update AGE_COUNTS"
        );
    }
}
