//! Estimated ratings for players the data ships without rating data.
//!
//! Some records in `data/players` carry all nine attributes at exactly 50: that is
//! the "no data" default, not a scouting result (199 records at the time of writing:
//! 19 free agents and 180 rostered players, most of them in minor leagues). Left as
//! is, a bottom-league rookie rates the same as a mid-table pro and the market value
//! and wage seeded from OVR are meaningless.
//!
//! [`estimate_placeholder_ratings`] replaces those ratings at world build, in code,
//! because the `data` submodule is read-only. **Every rating written here is an
//! estimate for a player without rating data**, not an assessment of the person.
//! The pass must run before market values and wages are seeded so both follow the
//! new OVR. It is idempotent: an estimated player is no longer flat 50.
//!
//! Levels, in OVR points, measured on the bundled data (median OVR of rostered
//! players with real ratings):
//!
//! | Band                                         | Median OVR |
//! |----------------------------------------------|------------|
//! | Major leagues (LCK, LPL, LEC, LCS)           | 80 to 86   |
//! | Strong ERLs (LCK CL, PRM, LFL, NACL, PCS)    | 71 to 73   |
//! | Weakest pro leagues (HM, NLC, RL, ROL, LPLOL)| 60 to 61   |
//! | Free agents with no activity record          | 40 to 45   |
//!
//! # Policy
//!
//! One policy, shared with the pool ratings of `scripts/world/lib/pool-rating.mjs`
//! (A4): measured data first, then the game's median per position shifted by the
//! tier of the competition.
//!
//! 1. A competition with enough real players (see
//!    [`MIN_REAL_PLAYERS_PER_COMPETITION`]) uses its own medians.
//! 2. Any other competition takes the median of every rostered player with a real
//!    rating, per role, shifted by its tier: [`TIER_OFFSETS`] (tier 1 by 0, tier 2 by
//!    -6, any other or unknown tier by -12).
//! 3. With no real rating anywhere, [`NO_REAL_DATA_LEVEL`] applies.
//!
//! Free agents keep the amateur level: a flat-50 free agent has no activity record.

use std::collections::{HashMap, HashSet};

use crate::domain::player::{Player, PlayerAttributes};
use crate::domain::stats::LolRole;
use crate::domain::team::Team;
use crate::potential::calculate_lol_ovr;
use crate::stable_hash::stable_hash;

/// A competition needs at least this many rostered players with real ratings before
/// its own medians are trusted. The smallest data-rich leagues in the bundle (PCS,
/// VCS) have 29 real players, while the almost-all-placeholder ones have 0 to 3, so
/// 10 (about two per role) cleanly separates them.
const MIN_REAL_PLAYERS_PER_COMPETITION: usize = 10;

/// Within a competition, a role uses its own medians from this many real players;
/// otherwise the competition-wide median is used. Matches `MIN_GROUP` in
/// `scripts/world/lib/generate.mjs`.
const MIN_REAL_PLAYERS_PER_ROLE: usize = 5;

/// Shift, in OVR points, of the game-wide median for a competition without enough
/// real players, by the competition's tier (see the module docs). Same table as
/// `TIER_OFFSETS` in `scripts/world/lib/pool-rating.mjs`.
const TIER_OFFSETS: [(u8, i16); 2] = [(1, 0), (2, -6)];

/// Shift for every tier not in [`TIER_OFFSETS`] and for a competition with no known
/// tier: the lowest one.
const LOWEST_TIER_OFFSET: i16 = -12;

/// Level for a rostered placeholder when the world holds no real rating to take a
/// median from: the weakest measured professional band.
const NO_REAL_DATA_LEVEL: u8 = 60;

/// Level for free agents. The data has no activity information (career and stats are
/// empty), so every flat-50 free agent is treated as inactive or amateur: below the
/// weakest professional league (60). With the +-[`JITTER`] spread the OVR lands in
/// 40 to 45.
const AMATEUR_LEVEL: u8 = 43;

/// Maximum per-attribute deviation, in either direction, from the base level.
/// Same value as `JITTER` in `scripts/world/lib/generate.mjs`.
const JITTER: i16 = 4;

/// Number of distinct jitter values, `-JITTER..=JITTER`.
const JITTER_SPAN: u64 = 2 * JITTER as u64 + 1;
const _: () = assert!(JITTER > 0);

/// Valid attribute range for an estimate (OVR itself clamps to 1..=99).
const MIN_ATTRIBUTE: i16 = 1;
const MAX_ATTRIBUTE: i16 = 99;

/// Number of rating attributes a player has.
const ATTRIBUTE_COUNT: usize = 9;

/// The "no data" value the source data uses for every attribute of a placeholder.
const PLACEHOLDER_ATTRIBUTE: u8 = 50;

/// The nine attribute names, in the order [`PlayerAttributes::as_array`] returns them.
/// Also the jitter keys, so each attribute of a player gets an independent offset.
const ATTRIBUTE_KEYS: [&str; ATTRIBUTE_COUNT] = [
    "mechanics",
    "laning",
    "teamfighting",
    "macro_play",
    "consistency",
    "shotcalling",
    "champion_pool",
    "discipline",
    "mental_resilience",
];

/// How many players [`estimate_placeholder_ratings`] replaced.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct PlaceholderRatingReport {
    /// Rostered players estimated from their league.
    pub rostered: usize,
    /// Players without a team estimated at the amateur level.
    pub free_agents: usize,
}

/// True when every attribute is exactly 50: the "no data" signature. A real player
/// with some 50s is not a placeholder.
pub fn is_placeholder_rating(player: &Player) -> bool {
    is_placeholder_row(&player.attributes.as_array())
}

fn is_placeholder_row(row: &[u8; ATTRIBUTE_COUNT]) -> bool {
    *row == [PLACEHOLDER_ATTRIBUTE; ATTRIBUTE_COUNT]
}

/// Replaces the flat-50 ratings of placeholder players with estimates (see the module
/// docs). `teams` maps a rostered player to its competition; a player whose team is
/// not in `teams` is treated as a free agent, as `detach_orphaned_players` will make
/// them one. `competition_tiers` maps a competition id to its tier.
pub fn estimate_placeholder_ratings(
    players: &mut [Player],
    teams: &[Team],
    competition_tiers: &HashMap<String, u8>,
) -> PlaceholderRatingReport {
    estimate_placeholder_ratings_excluding(players, teams, competition_tiers, &HashSet::new())
}

/// Like [`estimate_placeholder_ratings`], but players whose id is in `excluded` do
/// not feed the real-rating pools the medians come from. Used for ratings that are
/// themselves low-confidence estimates (see `player_rating_overrides`), so one
/// noisy rating cannot shift the level a placeholder is estimated at.
pub fn estimate_placeholder_ratings_excluding(
    players: &mut [Player],
    teams: &[Team],
    competition_tiers: &HashMap<String, u8>,
    excluded: &HashSet<String>,
) -> PlaceholderRatingReport {
    let competition_by_team: HashMap<&str, Option<&str>> = teams
        .iter()
        .map(|team| (team.id.as_str(), team.competition_id.as_deref()))
        .collect();

    // Medians come from the world as it is before any estimate is written, so one
    // estimated player never feeds another.
    let pools = RealRatingPools::collect(players, &competition_by_team, excluded);

    let mut report = PlaceholderRatingReport::default();
    for player in players.iter_mut().filter(|p| is_placeholder_rating(p)) {
        let team_competition = player
            .team_id
            .as_deref()
            .and_then(|team_id| competition_by_team.get(team_id).copied());
        let base = match team_competition {
            Some(competition) => {
                report.rostered += 1;
                let tier = competition.and_then(|id| competition_tiers.get(id).copied());
                pools.base_for(competition, tier, player.position)
            }
            None => {
                report.free_agents += 1;
                [AMATEUR_LEVEL; ATTRIBUTE_COUNT]
            }
        };
        apply_estimate(player, base);
    }
    report
}

/// Attribute rows of rostered players with real ratings, grouped for median lookup.
struct RealRatingPools<'a> {
    all: Vec<[u8; ATTRIBUTE_COUNT]>,
    by_role: HashMap<LolRole, Vec<[u8; ATTRIBUTE_COUNT]>>,
    by_competition: HashMap<&'a str, Vec<[u8; ATTRIBUTE_COUNT]>>,
    by_competition_role: HashMap<(&'a str, LolRole), Vec<[u8; ATTRIBUTE_COUNT]>>,
}

impl<'a> RealRatingPools<'a> {
    fn collect(
        players: &[Player],
        competition_by_team: &HashMap<&'a str, Option<&'a str>>,
        excluded: &HashSet<String>,
    ) -> Self {
        let mut all = Vec::new();
        let mut by_role: HashMap<LolRole, Vec<[u8; ATTRIBUTE_COUNT]>> = HashMap::new();
        let mut by_competition: HashMap<&str, Vec<[u8; ATTRIBUTE_COUNT]>> = HashMap::new();
        let mut by_competition_role: HashMap<(&str, LolRole), Vec<[u8; ATTRIBUTE_COUNT]>> =
            HashMap::new();
        for player in players.iter().filter(|p| !excluded.contains(&p.id)) {
            let row = player.attributes.as_array();
            // Flat 50 is a placeholder and all-zero is an unrated row: neither says
            // anything about the league's level.
            if is_placeholder_row(&row) || row == [0; ATTRIBUTE_COUNT] {
                continue;
            }
            let Some(competition) = player
                .team_id
                .as_deref()
                .and_then(|team_id| competition_by_team.get(team_id).copied().flatten())
            else {
                continue;
            };
            all.push(row);
            by_role.entry(player.position).or_default().push(row);
            by_competition.entry(competition).or_default().push(row);
            by_competition_role
                .entry((competition, player.position))
                .or_default()
                .push(row);
        }
        Self {
            all,
            by_role,
            by_competition,
            by_competition_role,
        }
    }

    /// Base attribute levels for a rostered placeholder: the competition's real
    /// medians when it has enough real players, else the game-wide policy.
    fn base_for(
        &self,
        competition: Option<&str>,
        tier: Option<u8>,
        role: LolRole,
    ) -> [u8; ATTRIBUTE_COUNT] {
        if let Some(competition) = competition
            && let Some(rows) = self.by_competition.get(competition)
            && rows.len() >= MIN_REAL_PLAYERS_PER_COMPETITION
        {
            let role_rows = self.by_competition_role.get(&(competition, role));
            return match role_rows {
                Some(role_rows) if role_rows.len() >= MIN_REAL_PLAYERS_PER_ROLE => {
                    attribute_medians(role_rows)
                }
                _ => attribute_medians(rows),
            };
        }
        self.tier_default(tier, role)
    }

    /// The game-wide median of the role (of every role when the role is thin),
    /// shifted by the tier offset.
    fn tier_default(&self, tier: Option<u8>, role: LolRole) -> [u8; ATTRIBUTE_COUNT] {
        let rows = match self.by_role.get(&role) {
            Some(role_rows) if role_rows.len() >= MIN_REAL_PLAYERS_PER_ROLE => role_rows,
            _ => &self.all,
        };
        if rows.is_empty() {
            return [NO_REAL_DATA_LEVEL; ATTRIBUTE_COUNT];
        }
        let offset = tier
            .and_then(|tier| TIER_OFFSETS.iter().find(|(t, _)| *t == tier))
            .map_or(LOWEST_TIER_OFFSET, |(_, offset)| *offset);
        attribute_medians(rows)
            .map(|median| (i16::from(median) + offset).clamp(MIN_ATTRIBUTE, MAX_ATTRIBUTE) as u8)
    }
}

/// Per-attribute median; an even count averages the two middle values and rounds,
/// like `median` in `scripts/world/lib/generate.mjs`.
///
/// `rows` must not be empty: the median of no values is undefined. Both callers only
/// pass pools that already met a minimum player count.
fn attribute_medians(rows: &[[u8; ATTRIBUTE_COUNT]]) -> [u8; ATTRIBUTE_COUNT] {
    debug_assert!(!rows.is_empty(), "median of an empty pool is undefined");
    let mut medians = [0u8; ATTRIBUTE_COUNT];
    for (index, slot) in medians.iter_mut().enumerate() {
        let mut column: Vec<u16> = rows.iter().map(|row| u16::from(row[index])).collect();
        column.sort_unstable();
        let mid = column.len() / 2;
        let median = if column.len() % 2 == 1 {
            column[mid]
        } else {
            (column[mid - 1] + column[mid]).div_ceil(2)
        };
        // Lossless: the median of `u8` values never exceeds `u8::MAX`.
        *slot = median as u8;
    }
    medians
}

/// Writes `base` plus the id-seeded jitter into the player's attributes and keeps the
/// cached `lol_ovr` in step. `potential_base` is left as shipped.
fn apply_estimate(player: &mut Player, base: [u8; ATTRIBUTE_COUNT]) {
    let mut estimated = [0u8; ATTRIBUTE_COUNT];
    for (index, slot) in estimated.iter_mut().enumerate() {
        let jitter = seeded_jitter(&player.id, ATTRIBUTE_KEYS[index]);
        *slot = (i16::from(base[index]) + jitter).clamp(MIN_ATTRIBUTE, MAX_ATTRIBUTE) as u8;
    }
    player.attributes = PlayerAttributes::from_array(estimated);
    player.lol_ovr = calculate_lol_ovr(player);
}

/// Integer in `-JITTER..=JITTER` derived only from the seed and key, so there is
/// no RNG state and the same input always gives the same output.
fn seeded_jitter(seed: &str, key: &str) -> i16 {
    (stable_hash(seed, key) % JITTER_SPAN) as i16 - JITTER
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game_setup::apply_default_market_values;

    fn attrs(value: u8) -> PlayerAttributes {
        PlayerAttributes {
            mechanics: value,
            laning: value,
            teamfighting: value,
            macro_play: value,
            consistency: value,
            shotcalling: value,
            champion_pool: value,
            discipline: value,
            mental_resilience: value,
        }
    }

    fn player(id: &str, role: LolRole, team: Option<&str>, value: u8) -> Player {
        let mut p = Player::new(
            id.to_string(),
            id.to_string(),
            id.to_string(),
            "2000-01-01".to_string(),
            "KR".to_string(),
            role,
            attrs(value),
        );
        p.team_id = team.map(str::to_string);
        p
    }

    fn team(id: &str, competition: Option<&str>) -> Team {
        let mut t = Team::new(
            id.to_string(),
            id.to_string(),
            "TST".to_string(),
            "KR".to_string(),
            "Seoul".to_string(),
            "Arena".to_string(),
            1_000,
        );
        t.competition_id = competition.map(str::to_string);
        t
    }

    /// Tiers of the competitions the tests use.
    fn tiers() -> HashMap<String, u8> {
        [("lck", 1), ("lfl", 2), ("ldl", 2), ("tcl", 3)]
            .into_iter()
            .map(|(id, tier)| (id.to_string(), tier))
            .collect()
    }

    fn ovr(p: &Player) -> u8 {
        calculate_lol_ovr(p)
    }

    const ROLES: [LolRole; 5] = [
        LolRole::Top,
        LolRole::Jungle,
        LolRole::Mid,
        LolRole::Adc,
        LolRole::Support,
    ];

    /// `per_role` real players of every role on `team`, all rated `value`.
    fn real_roster(prefix: &str, team_id: &str, per_role: usize, value: u8) -> Vec<Player> {
        let mut out = Vec::new();
        for (r, role) in ROLES.iter().enumerate() {
            for i in 0..per_role {
                out.push(player(
                    &format!("{prefix}-{r}-{i}"),
                    *role,
                    Some(team_id),
                    value,
                ));
            }
        }
        out
    }

    #[test]
    fn only_all_fifty_players_are_placeholders() {
        let mut real = player("real", LolRole::Mid, Some("t"), 50);
        real.attributes.mechanics = 51;
        assert!(!is_placeholder_rating(&real));
        assert!(is_placeholder_rating(&player(
            "flat",
            LolRole::Mid,
            Some("t"),
            50
        )));

        let mut some_fifties = player("mixed", LolRole::Mid, Some("t"), 70);
        some_fifties.attributes.laning = 50;
        some_fifties.attributes.discipline = 50;

        let teams = vec![team("t", Some("ldl"))];
        let mut players = vec![
            real.clone(),
            some_fifties.clone(),
            player("zero", LolRole::Top, Some("t"), 0),
        ];
        let report = estimate_placeholder_ratings(&mut players, &teams, &tiers());

        assert_eq!(report, PlaceholderRatingReport::default());
        assert_eq!(players[0].attributes.as_array(), real.attributes.as_array());
        assert_eq!(
            players[1].attributes.as_array(),
            some_fifties.attributes.as_array()
        );
        assert_eq!(
            players[2].attributes.as_array(),
            [0; 9],
            "unrated all-zero rows are left alone"
        );
    }

    /// A top-flight league with 15 real players rated 80 and, in `competition`, 20
    /// placeholders spread over the roles.
    fn world_with_placeholders(competition: &str) -> (Vec<Team>, Vec<Player>) {
        let teams = vec![team("lck-t", Some("lck")), team("ph-t", Some(competition))];
        let mut players = real_roster("lck-real", "lck-t", 3, 80);
        for i in 0..20 {
            players.push(player(&format!("ph-{i}"), ROLES[i % 5], Some("ph-t"), 50));
        }
        (teams, players)
    }

    /// Mean of the nine attributes of each placeholder: the level the policy sets,
    /// before the role weights of OVR.
    fn placeholder_levels(players: &[Player]) -> Vec<f64> {
        players
            .iter()
            .filter(|p| p.id.starts_with("ph-"))
            .map(|p| {
                p.attributes
                    .as_array()
                    .iter()
                    .map(|a| f64::from(*a))
                    .sum::<f64>()
                    / 9.0
            })
            .collect()
    }

    /// Every level stays within the jitter of `expected`, and the average of the
    /// roster is close to it.
    fn assert_levels_near(players: &[Player], expected: f64, label: &str) {
        let levels = placeholder_levels(players);
        assert!(!levels.is_empty());
        for level in &levels {
            assert!(
                (level - expected).abs() <= f64::from(JITTER),
                "{label}: level {level:.1} is not within the jitter of {expected}"
            );
        }
        let mean = levels.iter().sum::<f64>() / levels.len() as f64;
        assert!(
            (mean - expected).abs() <= 1.5,
            "{label}: average level {mean:.1} is not near {expected}"
        );
    }

    #[test]
    fn a_thin_second_tier_league_takes_the_game_median_minus_six() {
        let (teams, mut players) = world_with_placeholders("ldl");
        let report = estimate_placeholder_ratings(&mut players, &teams, &tiers());

        assert_eq!(report.rostered, 20);
        assert_levels_near(&players, 74.0, "tier 2");
    }

    #[test]
    fn a_thin_top_tier_league_takes_the_game_median() {
        let mut tiers = tiers();
        tiers.insert("ph-top".to_string(), 1);
        let (teams, mut players) = world_with_placeholders("ph-top");
        estimate_placeholder_ratings(&mut players, &teams, &tiers);

        assert_levels_near(&players, 80.0, "tier 1");
    }

    #[test]
    fn a_thin_lowest_tier_or_unknown_tier_league_takes_the_game_median_minus_twelve() {
        for competition in ["tcl", "no-tier-known"] {
            let (teams, mut players) = world_with_placeholders(competition);
            estimate_placeholder_ratings(&mut players, &teams, &tiers());

            assert_levels_near(&players, 68.0, competition);
        }
    }

    #[test]
    fn the_game_median_is_taken_per_role_when_the_role_has_enough_real_players() {
        let teams = vec![team("lck-t", Some("lck")), team("ph-t", Some("ldl"))];
        let mut players = real_roster("lck-real", "lck-t", 5, 70);
        for p in players.iter_mut().filter(|p| p.position == LolRole::Top) {
            p.attributes = attrs(90);
        }
        players.push(player("ph-top", LolRole::Top, Some("ph-t"), 50));
        players.push(player("ph-mid", LolRole::Mid, Some("ph-t"), 50));

        estimate_placeholder_ratings(&mut players, &teams, &tiers());

        let level_of = |id: &str| {
            let p = players.iter().find(|p| p.id == id).unwrap();
            p.attributes
                .as_array()
                .iter()
                .map(|a| f64::from(*a))
                .sum::<f64>()
                / 9.0
        };
        assert!(
            (level_of("ph-top") - 84.0).abs() <= 2.5,
            "top {}",
            level_of("ph-top")
        );
        assert!(
            (level_of("ph-mid") - 64.0).abs() <= 2.5,
            "mid {}",
            level_of("ph-mid")
        );
    }

    #[test]
    fn placeholders_of_one_roster_are_not_identical() {
        let (teams, mut players) = world_with_placeholders("ldl");
        estimate_placeholder_ratings(&mut players, &teams, &tiers());

        let top_rows: Vec<[u8; ATTRIBUTE_COUNT]> = players
            .iter()
            .filter(|p| p.id.starts_with("ph-") && p.position == LolRole::Top)
            .map(|p| p.attributes.as_array())
            .collect();
        assert_eq!(top_rows.len(), 4);
        let distinct: HashSet<_> = top_rows.iter().collect();
        assert_eq!(
            distinct.len(),
            top_rows.len(),
            "same-role placeholders must differ"
        );
    }

    #[test]
    fn the_policy_gives_the_same_ratings_whatever_the_player_order() {
        let (teams, mut forward) = world_with_placeholders("ldl");
        let mut reversed = forward.clone();
        reversed.reverse();
        estimate_placeholder_ratings(&mut forward, &teams, &tiers());
        estimate_placeholder_ratings(&mut reversed, &teams, &tiers());

        for p in &forward {
            let twin = reversed.iter().find(|q| q.id == p.id).unwrap();
            assert_eq!(
                p.attributes.as_array(),
                twin.attributes.as_array(),
                "{}",
                p.id
            );
        }
    }

    #[test]
    fn placeholder_in_a_league_with_real_players_takes_their_median() {
        let teams = vec![team("lfl-t", Some("lfl"))];
        let mut players = real_roster("lfl-real", "lfl-t", 3, 80);
        players.push(player("lfl-ph", LolRole::Top, Some("lfl-t"), 50));

        estimate_placeholder_ratings(&mut players, &teams, &tiers());

        let estimated = players.last().unwrap();
        assert!(
            (78..=82).contains(&ovr(estimated)),
            "OVR {} should follow the league median of 80",
            ovr(estimated)
        );
    }

    #[test]
    fn excluded_ids_do_not_feed_the_real_rating_pools() {
        let teams = vec![team("lfl-t", Some("lfl"))];
        // 10 real players is exactly the minimum for the competition's own median.
        let build = || {
            let mut players = real_roster("lfl-real", "lfl-t", 2, 80);
            players.push(player("lfl-ph", LolRole::Top, Some("lfl-t"), 50));
            players
        };

        let mut included = build();
        estimate_placeholder_ratings_excluding(&mut included, &teams, &tiers(), &HashSet::new());
        let mut excluded = build();
        let skip = HashSet::from(["lfl-real-0-0".to_string()]);
        estimate_placeholder_ratings_excluding(&mut excluded, &teams, &tiers(), &skip);

        let level = |players: &[Player]| ovr(players.last().unwrap());
        assert!(
            (78..=82).contains(&level(&included)),
            "OVR {}",
            level(&included)
        );
        assert!(
            (72..=76).contains(&level(&excluded)),
            "with 9 pool players the league falls back to the game median 80 - 6, got {}",
            level(&excluded)
        );
    }

    #[test]
    fn a_role_with_enough_real_players_uses_its_own_median() {
        let teams = vec![team("lfl-t", Some("lfl"))];
        let mut players = real_roster("lfl-real", "lfl-t", 5, 70);
        for p in players.iter_mut().filter(|p| p.position == LolRole::Top) {
            p.attributes = attrs(90);
        }
        players.push(player("ph-top", LolRole::Top, Some("lfl-t"), 50));
        players.push(player("ph-mid", LolRole::Mid, Some("lfl-t"), 50));

        estimate_placeholder_ratings(&mut players, &teams, &tiers());

        let top = players.iter().find(|p| p.id == "ph-top").unwrap();
        let mid = players.iter().find(|p| p.id == "ph-mid").unwrap();
        assert!((88..=92).contains(&ovr(top)), "top OVR {}", ovr(top));
        assert!((68..=72).contains(&ovr(mid)), "mid OVR {}", ovr(mid));
    }

    #[test]
    fn a_thin_role_falls_back_to_the_competition_wide_median() {
        let teams = vec![team("lfl-t", Some("lfl"))];
        // 3 per role (15 real): every role is below the per-role threshold of 5.
        let mut players = real_roster("lfl-real", "lfl-t", 3, 70);
        for p in players.iter_mut().filter(|p| p.position == LolRole::Top) {
            p.attributes = attrs(90);
        }
        players.push(player("ph-top", LolRole::Top, Some("lfl-t"), 50));

        estimate_placeholder_ratings(&mut players, &teams, &tiers());

        let top = players.iter().find(|p| p.id == "ph-top").unwrap();
        assert!(
            (68..=72).contains(&ovr(top)),
            "top OVR {} should be the league median",
            ovr(top)
        );
    }

    #[test]
    fn rostered_placeholder_in_a_world_without_real_ratings_takes_the_no_data_level() {
        let teams = vec![team("x-t", Some("zzz")), team("n-t", None)];
        let mut players = vec![
            player("ph-x", LolRole::Top, Some("x-t"), 50),
            player("ph-n", LolRole::Top, Some("n-t"), 50),
        ];

        estimate_placeholder_ratings(&mut players, &teams, &tiers());

        for p in &players {
            assert!((58..=62).contains(&ovr(p)), "{} OVR {}", p.id, ovr(p));
        }
    }

    #[test]
    fn free_agents_and_orphans_land_between_forty_and_forty_five() {
        let teams = vec![team("t", Some("lck"))];
        let mut players: Vec<Player> = (0..60)
            .map(|i| player(&format!("fa-{i}"), ROLES[i % 5], None, 50))
            .collect();
        players.push(player("orphan", LolRole::Mid, Some("missing-team"), 50));

        let report = estimate_placeholder_ratings(&mut players, &teams, &tiers());

        assert_eq!(report.free_agents, 61);
        assert_eq!(report.rostered, 0);
        for p in &players {
            assert!((40..=45).contains(&ovr(p)), "{} OVR {}", p.id, ovr(p));
        }
    }

    #[test]
    fn estimates_are_deterministic_by_player_id_and_idempotent() {
        let teams = vec![team("t", Some("ldl"))];
        let build = || {
            vec![
                player("same", LolRole::Top, Some("t"), 50),
                player("other", LolRole::Top, Some("t"), 50),
            ]
        };
        let (mut a, mut b) = (build(), build());
        estimate_placeholder_ratings(&mut a, &teams, &tiers());
        estimate_placeholder_ratings(&mut b, &teams, &tiers());
        assert_eq!(a[0].attributes.as_array(), b[0].attributes.as_array());
        assert_ne!(
            a[0].attributes.as_array(),
            a[1].attributes.as_array(),
            "different ids get different jitter"
        );

        let before = a[0].attributes.as_array();
        let again = estimate_placeholder_ratings(&mut a, &teams, &tiers());
        assert_eq!(again, PlaceholderRatingReport::default());
        assert_eq!(a[0].attributes.as_array(), before);
    }

    #[test]
    fn market_value_is_computed_from_the_estimated_ovr() {
        let teams = vec![team("t", Some("ldl"))];
        let mut players = vec![player("ph", LolRole::Top, Some("t"), 50)];
        players[0].market_value = 0;

        estimate_placeholder_ratings(&mut players, &teams, &tiers());
        apply_default_market_values(&mut players);

        let new_ovr = ovr(&players[0]);
        assert_ne!(new_ovr, 50);
        let expected = crate::game_setup::suggested_seed_market_value(
            new_ovr,
            players[0].potential_base.max(new_ovr),
            false,
        );
        assert_eq!(players[0].market_value, expected);
    }

    #[test]
    fn seeded_jitter_matches_pinned_golden_values() {
        let golden: [(&str, &str, i16); 9] = [
            ("p1", "mechanics", 3),
            ("p1", "laning", 0),
            ("p1", "mental_resilience", -2),
            ("player-abc", "mechanics", -4),
            ("lck-faker", "laning", -4),
            ("lck-faker", "mental_resilience", 2),
            ("x", "laning", 4),
            ("", "laning", 2),
            ("", "mechanics", 0),
        ];
        for (id, key, expected) in golden {
            assert_eq!(seeded_jitter(id, key), expected, "id {id:?} key {key}");
        }
    }

    #[test]
    fn seeded_jitter_stays_within_the_jitter_range() {
        let mut seen = [false; JITTER_SPAN as usize];
        for id in 0..2_000 {
            for key in ATTRIBUTE_KEYS {
                let jitter = seeded_jitter(&format!("player-{id}"), key);
                assert!(
                    (-JITTER..=JITTER).contains(&jitter),
                    "{jitter} out of range"
                );
                seen[(jitter + JITTER) as usize] = true;
            }
        }
        assert!(seen.iter().all(|hit| *hit), "every offset should occur");
    }

    #[test]
    fn apply_estimate_matches_pinned_golden_attributes() {
        let mut p = player("dump-1", LolRole::Mid, Some("t"), 50);
        apply_estimate(&mut p, [70, 71, 72, 73, 74, 75, 76, 77, 78]);
        assert_eq!(
            p.attributes.as_array(),
            [71, 73, 68, 71, 77, 78, 76, 79, 77]
        );
        assert_eq!(p.lol_ovr, 74);
    }

    #[test]
    fn apply_estimate_clamps_to_the_attribute_range() {
        let mut high = player("clamp-high", LolRole::Mid, Some("t"), 50);
        apply_estimate(&mut high, [99; ATTRIBUTE_COUNT]);
        let mut low = player("clamp-low", LolRole::Mid, Some("t"), 50);
        apply_estimate(&mut low, [1; ATTRIBUTE_COUNT]);
        let (min, max) = (MIN_ATTRIBUTE as u8, MAX_ATTRIBUTE as u8);
        assert!(
            high.attributes
                .as_array()
                .iter()
                .all(|v| (max - 8..=max).contains(v))
        );
        assert!(
            low.attributes
                .as_array()
                .iter()
                .all(|v| (min..=min + 8).contains(v))
        );
        assert!(
            high.attributes.as_array().contains(&max),
            "some jittered attribute should reach the upper clamp"
        );
        assert!(
            low.attributes.as_array().contains(&min),
            "some jittered attribute should reach the lower clamp"
        );
    }

    #[test]
    fn attribute_keys_follow_the_attribute_array_order() {
        let attributes = PlayerAttributes::from_array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
        let json = serde_json::to_value(&attributes).expect("attributes serialize");
        for (index, key) in ATTRIBUTE_KEYS.iter().enumerate() {
            assert_eq!(json[*key], index as u64 + 1, "key {key} at index {index}");
        }
    }
}
