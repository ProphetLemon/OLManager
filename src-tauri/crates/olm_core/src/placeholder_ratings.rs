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

use std::collections::HashMap;

use crate::domain::player::{Player, PlayerAttributes};
use crate::domain::stats::LolRole;
use crate::domain::team::Team;
use crate::potential::calculate_lol_ovr;

/// A competition needs at least this many rostered players with real ratings before
/// its own medians are trusted. The smallest data-rich leagues in the bundle (PCS,
/// VCS) have 29 real players, while the almost-all-placeholder ones have 0 to 3, so
/// 10 (about two per role) cleanly separates them.
const MIN_REAL_PLAYERS_PER_COMPETITION: usize = 10;

/// Within a competition, a role uses its own medians from this many real players;
/// otherwise the competition-wide median is used. Matches `MIN_GROUP` in
/// `scripts/world/lib/generate.mjs`.
const MIN_REAL_PLAYERS_PER_ROLE: usize = 5;

/// Explicit league levels for competitions that are almost entirely placeholders and
/// so have no data of their own to take a median from.
///
/// - `ldl` (73): the LPL development league. Its 3 real players are too few to
///   measure. LDL stands to LPL (median 85) as LCK CL (median 73, measured) stands to
///   LCK (median 85.5): one development step, about 12 OVR below the parent league.
/// - `eec` (60): a small cup with no real data; it is placed at the weakest
///   measured professional band (HM, NLC, RL, ROL and LPLOL all sit at 60 to 61).
const LEAGUE_TIER_LEVELS: &[(&str, u8)] = &[("ldl", 73), ("eec", 60)];

/// Level for a rostered placeholder whose competition has neither enough real
/// players nor a [`LEAGUE_TIER_LEVELS`] entry (or whose team has no competition):
/// the weakest measured professional band.
const UNLISTED_LEAGUE_LEVEL: u8 = 60;

/// Level for free agents. The data has no activity information (career and stats are
/// empty), so every flat-50 free agent is treated as inactive or amateur: below the
/// weakest professional league (60). With the +-[`JITTER`] spread the OVR lands in
/// 40 to 45.
const AMATEUR_LEVEL: u8 = 43;

/// Maximum per-attribute deviation, in either direction, from the base level.
/// Same value as `JITTER` in `scripts/world/lib/generate.mjs`.
const JITTER: i16 = 4;

/// Valid attribute range for an estimate (OVR itself clamps to 1..=99).
const MIN_ATTRIBUTE: i16 = 1;
const MAX_ATTRIBUTE: i16 = 99;

/// The nine attribute names, in the order [`attribute_array`] returns them. Also the
/// jitter keys, so each attribute of a player gets an independent offset.
const ATTRIBUTE_KEYS: [&str; 9] = [
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
    attribute_array(&player.attributes) == [50; 9]
}

/// Replaces the flat-50 ratings of placeholder players with estimates (see the module
/// docs). `teams` maps a rostered player to its competition; a player whose team is
/// not in `teams` is treated as a free agent, as `detach_orphaned_players` will make
/// them one.
pub fn estimate_placeholder_ratings(
    players: &mut [Player],
    teams: &[Team],
) -> PlaceholderRatingReport {
    let competition_by_team: HashMap<&str, Option<&str>> = teams
        .iter()
        .map(|team| (team.id.as_str(), team.competition_id.as_deref()))
        .collect();

    // Medians come from the world as it is before any estimate is written, so one
    // estimated player never feeds another.
    let pools = RealRatingPools::collect(players, &competition_by_team);

    let mut report = PlaceholderRatingReport::default();
    for player in players.iter_mut().filter(|p| is_placeholder_rating(p)) {
        let team_competition = player
            .team_id
            .as_deref()
            .and_then(|team_id| competition_by_team.get(team_id).copied());
        let base = match team_competition {
            Some(competition) => {
                report.rostered += 1;
                pools.base_for(competition, player.position)
            }
            None => {
                report.free_agents += 1;
                [AMATEUR_LEVEL; 9]
            }
        };
        apply_estimate(player, base);
    }
    report
}

/// Attribute rows of rostered players with real ratings, grouped for median lookup.
struct RealRatingPools<'a> {
    by_competition: HashMap<&'a str, Vec<[u8; 9]>>,
    by_competition_role: HashMap<(&'a str, LolRole), Vec<[u8; 9]>>,
}

impl<'a> RealRatingPools<'a> {
    fn collect(
        players: &[Player],
        competition_by_team: &HashMap<&'a str, Option<&'a str>>,
    ) -> Self {
        let mut by_competition: HashMap<&str, Vec<[u8; 9]>> = HashMap::new();
        let mut by_competition_role: HashMap<(&str, LolRole), Vec<[u8; 9]>> = HashMap::new();
        for player in players {
            let row = attribute_array(&player.attributes);
            // Flat 50 is a placeholder and all-zero is an unrated row: neither says
            // anything about the league's level.
            if row == [50; 9] || row == [0; 9] {
                continue;
            }
            let Some(competition) = player
                .team_id
                .as_deref()
                .and_then(|team_id| competition_by_team.get(team_id).copied().flatten())
            else {
                continue;
            };
            by_competition.entry(competition).or_default().push(row);
            by_competition_role
                .entry((competition, player.position))
                .or_default()
                .push(row);
        }
        Self {
            by_competition,
            by_competition_role,
        }
    }

    /// Base attribute levels for a rostered placeholder: the competition's real
    /// medians when it has enough real players, else the explicit tier table.
    fn base_for(&self, competition: Option<&str>, role: LolRole) -> [u8; 9] {
        let Some(competition) = competition else {
            return [UNLISTED_LEAGUE_LEVEL; 9];
        };
        if let Some(rows) = self.by_competition.get(competition)
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
        let level = LEAGUE_TIER_LEVELS
            .iter()
            .find(|(id, _)| *id == competition)
            .map_or(UNLISTED_LEAGUE_LEVEL, |(_, level)| *level);
        [level; 9]
    }
}

/// Per-attribute median; an even count averages the two middle values and rounds,
/// like `median` in `scripts/world/lib/generate.mjs`.
fn attribute_medians(rows: &[[u8; 9]]) -> [u8; 9] {
    let mut medians = [0u8; 9];
    for (index, slot) in medians.iter_mut().enumerate() {
        let mut column: Vec<u16> = rows.iter().map(|row| u16::from(row[index])).collect();
        column.sort_unstable();
        let mid = column.len() / 2;
        *slot = if column.len() % 2 == 1 {
            column[mid]
        } else {
            (column[mid - 1] + column[mid]).div_ceil(2)
        } as u8;
    }
    medians
}

/// Writes `base` plus the id-seeded jitter into the player's attributes and keeps the
/// cached `lol_ovr` in step. `potential_base` is left as shipped.
fn apply_estimate(player: &mut Player, base: [u8; 9]) {
    let mut estimated = [0u8; 9];
    for (index, slot) in estimated.iter_mut().enumerate() {
        let jitter = seeded_jitter(&player.id, ATTRIBUTE_KEYS[index]);
        *slot = (i16::from(base[index]) + jitter).clamp(MIN_ATTRIBUTE, MAX_ATTRIBUTE) as u8;
    }
    let attrs = &mut player.attributes;
    attrs.mechanics = estimated[0];
    attrs.laning = estimated[1];
    attrs.teamfighting = estimated[2];
    attrs.macro_play = estimated[3];
    attrs.consistency = estimated[4];
    attrs.shotcalling = estimated[5];
    attrs.champion_pool = estimated[6];
    attrs.discipline = estimated[7];
    attrs.mental_resilience = estimated[8];
    player.lol_ovr = calculate_lol_ovr(player);
}

/// Integer in `-JITTER..=JITTER` derived only from the seed and key: a stable
/// FNV-1a hash with a splitmix64 finalizer, so there is no RNG state and the same
/// input always gives the same output.
fn seeded_jitter(seed: &str, key: &str) -> i16 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in seed.bytes().chain(std::iter::once(b':')).chain(key.bytes()) {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash ^= hash >> 30;
    hash = hash.wrapping_mul(0xbf58_476d_1ce4_e5b9);
    hash ^= hash >> 27;
    hash = hash.wrapping_mul(0x94d0_49bb_1331_11eb);
    hash ^= hash >> 31;
    (hash % (2 * JITTER as u64 + 1)) as i16 - JITTER
}

fn attribute_array(attrs: &PlayerAttributes) -> [u8; 9] {
    [
        attrs.mechanics,
        attrs.laning,
        attrs.teamfighting,
        attrs.macro_play,
        attrs.consistency,
        attrs.shotcalling,
        attrs.champion_pool,
        attrs.discipline,
        attrs.mental_resilience,
    ]
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
        let report = estimate_placeholder_ratings(&mut players, &teams);

        assert_eq!(report, PlaceholderRatingReport::default());
        assert_eq!(
            attribute_array(&players[0].attributes),
            attribute_array(&real.attributes)
        );
        assert_eq!(
            attribute_array(&players[1].attributes),
            attribute_array(&some_fifties.attributes)
        );
        assert_eq!(
            attribute_array(&players[2].attributes),
            [0; 9],
            "unrated all-zero rows are left alone"
        );
    }

    #[test]
    fn placeholder_in_an_almost_all_placeholder_league_takes_the_tier_table_level() {
        let teams = vec![team("ldl-t", Some("ldl"))];
        let mut players = vec![];
        players.push(player("ldl-real-mid", LolRole::Mid, Some("ldl-t"), 90));
        for i in 0..20 {
            players.push(player(
                &format!("ldl-ph-{i}"),
                ROLES[i % 5],
                Some("ldl-t"),
                50,
            ));
        }

        let report = estimate_placeholder_ratings(&mut players, &teams);

        assert_eq!(report.rostered, 20);
        for p in players.iter().filter(|p| p.id.starts_with("ldl-ph")) {
            assert!(
                (70..=76).contains(&ovr(p)),
                "{} OVR {} is not near the LDL level of 73",
                p.id,
                ovr(p)
            );
        }
    }

    #[test]
    fn placeholder_in_a_league_with_real_players_takes_their_median() {
        let teams = vec![team("lfl-t", Some("lfl"))];
        let mut players = real_roster("lfl-real", "lfl-t", 3, 80);
        players.push(player("lfl-ph", LolRole::Top, Some("lfl-t"), 50));

        estimate_placeholder_ratings(&mut players, &teams);

        let estimated = players.last().unwrap();
        assert!(
            (78..=82).contains(&ovr(estimated)),
            "OVR {} should follow the league median of 80",
            ovr(estimated)
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

        estimate_placeholder_ratings(&mut players, &teams);

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

        estimate_placeholder_ratings(&mut players, &teams);

        let top = players.iter().find(|p| p.id == "ph-top").unwrap();
        assert!(
            (68..=72).contains(&ovr(top)),
            "top OVR {} should be the league median",
            ovr(top)
        );
    }

    #[test]
    fn rostered_placeholder_without_data_or_table_entry_takes_the_unlisted_level() {
        let teams = vec![team("x-t", Some("zzz")), team("n-t", None)];
        let mut players = vec![
            player("ph-x", LolRole::Top, Some("x-t"), 50),
            player("ph-n", LolRole::Top, Some("n-t"), 50),
        ];

        estimate_placeholder_ratings(&mut players, &teams);

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

        let report = estimate_placeholder_ratings(&mut players, &teams);

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
        estimate_placeholder_ratings(&mut a, &teams);
        estimate_placeholder_ratings(&mut b, &teams);
        assert_eq!(
            attribute_array(&a[0].attributes),
            attribute_array(&b[0].attributes)
        );
        assert_ne!(
            attribute_array(&a[0].attributes),
            attribute_array(&a[1].attributes),
            "different ids get different jitter"
        );

        let before = attribute_array(&a[0].attributes);
        let again = estimate_placeholder_ratings(&mut a, &teams);
        assert_eq!(again, PlaceholderRatingReport::default());
        assert_eq!(attribute_array(&a[0].attributes), before);
    }

    #[test]
    fn market_value_is_computed_from_the_estimated_ovr() {
        let teams = vec![team("t", Some("ldl"))];
        let mut players = vec![player("ph", LolRole::Top, Some("t"), 50)];
        players[0].market_value = 0;

        estimate_placeholder_ratings(&mut players, &teams);
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
}
