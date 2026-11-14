//! The schedules the override layer gives the 22 second-tier leagues that ship
//! without one (`assets/world/competition-overrides.json`), checked against the
//! real data: each league is built from its real team count, plays a full single
//! round robin, and every split (playoffs included) ends before the next starts.

use chrono::{Datelike, Duration, NaiveDate};
use olm_core::competitions::{build_league_selection, load_teams, scan_competitions};
use olm_core::generator::definitions::CompetitionManifest;
use olm_core::schedule::generate_schedule_from_config;
use std::collections::HashSet;
use std::path::PathBuf;

/// Second-tier leagues scheduled by the override layer. LES has its own block,
/// with a promotion link to the LEC, and is covered by `four_team_playoff_tests`.
const REGIONAL_LEAGUES: [&str; 22] = [
    "al", "cd", "ebl", "eec", "hll", "hm", "lckcl", "ldl", "lfl", "lit", "ljl", "lplol", "lrn",
    "lrs", "nacl", "nlc", "pcs", "prm", "rl", "rol", "tcl", "vcs",
];

/// From the day the last regular round is played, the four-team playoffs take
/// the next day for the semifinals and, once they are played, one more week for
/// the final (`schedule_playoffs_for`). Two weeks leave a margin of five days.
const PLAYOFF_SPAN_DAYS: i64 = 14;

/// Latest end of the Winter and Spring splits that `transfers::next_split_end_date`
/// hardcodes for contract ends (28 March and 1 August).
const HARDCODED_WINTER_END: (u32, u32) = (3, 28);
const HARDCODED_SPRING_END: (u32, u32) = (8, 1);

const YEAR: u32 = 2027;

fn data_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../data")
}

fn manifests() -> Vec<CompetitionManifest> {
    let manifests = scan_competitions(&data_dir().join("competitions"));
    assert!(!manifests.is_empty(), "data/competitions must be present");
    manifests
}

fn manifest_of<'a>(manifests: &'a [CompetitionManifest], id: &str) -> &'a CompetitionManifest {
    manifests
        .iter()
        .find(|m| m.id == id)
        .unwrap_or_else(|| panic!("competition {id} is not in the data"))
}

/// Ids of the league's teams as the game builds them (competition prefix applied).
fn team_ids(manifest: &CompetitionManifest) -> Vec<String> {
    let prefix = format!("{}-", manifest.id);
    load_teams(&data_dir(), manifest)
        .unwrap_or_else(|e| panic!("{}: {e}", manifest.id))
        .into_iter()
        .map(|t| {
            if t.id.starts_with(&prefix) {
                t.id
            } else {
                format!("{prefix}{}", t.id)
            }
        })
        .collect()
}

fn date(value: &str) -> NaiveDate {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").expect("fixture date")
}

fn start_of(split: &olm_core::generator::definitions::SplitConfig) -> NaiveDate {
    NaiveDate::from_ymd_opt(
        YEAR as i32,
        split.season_start.month,
        split.season_start.day,
    )
    .expect("valid split start")
}

#[test]
fn team_selection_offers_every_second_tier_league_but_the_stale_ones() {
    let selection = build_league_selection(&data_dir());
    let offered: HashSet<&str> = selection
        .competitions
        .iter()
        .map(|c| c.id.as_str())
        .collect();
    for id in REGIONAL_LEAGUES.iter().chain(&["les"]) {
        assert!(
            offered.contains(id),
            "{id} is not offered at team selection"
        );
    }
    for id in ["lck-cl", "prime_league"] {
        assert!(
            !offered.contains(id),
            "stale duplicate {id} must stay hidden"
        );
    }
    for competition in &selection.competitions {
        let real = selection
            .competitions
            .iter()
            .find(|c| c.id == competition.id)
            .map(|c| c.teams.len());
        assert_eq!(
            Some(competition.team_count as usize),
            real,
            "{} team_count",
            competition.id
        );
    }
}

#[test]
fn the_override_team_count_is_the_real_team_count() {
    let manifests = manifests();
    for id in REGIONAL_LEAGUES {
        let manifest = manifest_of(&manifests, id);
        let real = team_ids(manifest).len();
        assert!((6..=10).contains(&real), "{id} has {real} teams");
        assert_eq!(
            manifest.schedule.team_count as usize, real,
            "{id} team_count"
        );
    }
}

#[test]
fn every_league_plays_a_single_round_robin_with_a_four_team_bracket_and_no_promotion() {
    let manifests = manifests();
    for id in REGIONAL_LEAGUES {
        let manifest = manifest_of(&manifests, id);
        assert_eq!(manifest.schedule.format, "single_round_robin", "{id}");
        assert!(
            manifest.promotion.is_none(),
            "{id} must not invent a promotion link"
        );
        let names: Vec<_> = manifest
            .schedule
            .splits
            .iter()
            .map(|s| s.name.as_str())
            .collect();
        assert_eq!(names, ["Winter", "Spring", "Summer"], "{id} splits");
        for split in &manifest.schedule.splits {
            let playoffs = split.playoffs.as_ref().expect("playoffs");
            assert_eq!(
                (playoffs.teams, playoffs.format.as_str()),
                (4, "single_elimination")
            );
        }
    }
}

#[test]
fn the_offsets_cover_a_full_round_robin_in_every_split() {
    let manifests = manifests();
    for id in REGIONAL_LEAGUES {
        let manifest = manifest_of(&manifests, id);
        let ids = team_ids(manifest);
        let n = ids.len();
        let rounds = if n.is_multiple_of(2) { n - 1 } else { n };
        assert_eq!(manifest.schedule.splits.len(), 3, "{id} has no schedule");
        for (index, split) in manifest.schedule.splits.iter().enumerate() {
            assert_eq!(
                split.superweek_offsets.len(),
                rounds,
                "{id} {} offsets",
                split.name
            );
            let league = generate_schedule_from_config(manifest, YEAR, &ids, index);
            assert_eq!(
                league.fixtures.len(),
                n * (n - 1) / 2,
                "{id} {} fixtures",
                split.name
            );

            let mut pairs = HashSet::new();
            for fixture in &league.fixtures {
                let pair = if fixture.home_team_id < fixture.away_team_id {
                    (&fixture.home_team_id, &fixture.away_team_id)
                } else {
                    (&fixture.away_team_id, &fixture.home_team_id)
                };
                assert!(
                    pairs.insert(pair),
                    "{id} {}: {pair:?} meet twice",
                    split.name
                );
            }

            let expected: HashSet<NaiveDate> = split
                .superweek_offsets
                .iter()
                .map(|offset| start_of(split) + Duration::days(*offset))
                .collect();
            let played: HashSet<NaiveDate> =
                league.fixtures.iter().map(|f| date(&f.date)).collect();
            assert_eq!(
                played, expected,
                "{id} {} dates follow the offsets",
                split.name
            );
        }
    }
}

/// End of a split: the last regular round plus the playoffs.
fn split_end(manifest: &CompetitionManifest, ids: &[String], index: usize) -> NaiveDate {
    let league = generate_schedule_from_config(manifest, YEAR, ids, index);
    let last = league
        .fixtures
        .iter()
        .map(|f| date(&f.date))
        .max()
        .expect("fixtures");
    last + Duration::days(PLAYOFF_SPAN_DAYS)
}

#[test]
fn every_split_ends_before_the_next_one_starts() {
    let manifests = manifests();
    for id in REGIONAL_LEAGUES {
        let manifest = manifest_of(&manifests, id);
        let ids = team_ids(manifest);
        let splits = &manifest.schedule.splits;
        assert_eq!(splits.len(), 3, "{id} has no schedule");
        for index in 0..splits.len() {
            let end = split_end(manifest, &ids, index);
            let next_start = match splits.get(index + 1) {
                Some(next) => start_of(next),
                // The next season opens with its first split.
                None => NaiveDate::from_ymd_opt(
                    YEAR as i32 + 1,
                    splits[0].season_start.month,
                    splits[0].season_start.day,
                )
                .expect("next season start"),
            };
            assert!(
                end < next_start,
                "{id}: {} ends {end}, {} starts {next_start}",
                splits[index].name,
                splits
                    .get(index + 1)
                    .map_or("next season", |s| s.name.as_str())
            );
            assert_eq!(
                end.year(),
                YEAR as i32,
                "{id}: {} spills into the next year",
                splits[index].name
            );
        }
    }
}

#[test]
fn winter_and_spring_end_before_the_dates_the_transfer_code_hardcodes() {
    let manifests = manifests();
    for id in REGIONAL_LEAGUES {
        let manifest = manifest_of(&manifests, id);
        let ids = team_ids(manifest);
        assert_eq!(manifest.schedule.splits.len(), 3, "{id} has no schedule");
        for (index, (month, day)) in [HARDCODED_WINTER_END, HARDCODED_SPRING_END]
            .into_iter()
            .enumerate()
        {
            let end = split_end(manifest, &ids, index);
            let limit = NaiveDate::from_ymd_opt(YEAR as i32, month, day).expect("limit");
            assert!(
                end <= limit,
                "{id}: {} ends {end}, after the hardcoded {limit}",
                manifest.schedule.splits[index].name
            );
        }
    }
}
