//! Potentials for players the data ships without one.
//!
//! A record in `data/players` with `potential_base == 0` shipped without a potential:
//! the smallest real value in the data is 50, and no other producer in the game
//! writes 0. Left as is, such a player has no headroom under
//! [`effective_potential_cap`](crate::potential::effective_potential_cap), so he can
//! never gain, and the potential report reads 0 to 3.
//!
//! [`fill_missing_potentials`] gives each of them a potential of `OVR + gap`. The gap
//! is drawn from the players of the same world or save who do have a potential, in
//! the same age band:
//!
//! 1. The reference players are those with `potential_base > 0` whose attributes are
//!    not all equal (the flat rows of [`is_placeholder_rating`] carry no rating data,
//!    and the same goes for any other flat row). Their gap is
//!    `potential_base - OVR`, floored at 0.
//! 2. Age bands are the training bands (`<= 21`, `22-25`, `26-29`, `30-33`, `34+`)
//!    plus `unknown` for a player without a usable date of birth. The game has three
//!    different fallback ages for that case; none of them is used here.
//! 3. A band with fewer than [`MIN_REFERENCE_PLAYERS_PER_BAND`] reference players uses
//!    the gaps of every age instead.
//! 4. The draw is `stable_hash(player.id, "potential")` over the sorted gaps, so no
//!    RNG state is consumed. The gap is capped at the 75th percentile of the pool the
//!    draw came from, which trims the long tail of the shipped data.
//! 5. The result is `(OVR + gap).clamp(OVR, 99)`.
//!
//! The pass is idempotent: it only touches `potential_base == 0` and never writes 0.

use chrono::NaiveDate;

use crate::domain::player::Player;
use crate::placeholder_ratings::is_placeholder_rating;
use crate::potential::calculate_lol_ovr;
use crate::squad_generator::full_years_between;
use crate::stable_hash::stable_hash;

/// An age band needs at least this many reference players before its own gaps are
/// used; below it the gaps of every age apply. Same size as
/// `placeholder_ratings::MIN_REAL_PLAYERS_PER_ROLE`.
pub const MIN_REFERENCE_PLAYERS_PER_BAND: usize = 5;

/// Most points of earned research bonus a revealed estimate keeps when it is re-based.
const MAX_REVEAL_BONUS: u8 = 3;

const MAX_POTENTIAL: u8 = 99;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AgeBand {
    Unknown,
    UpTo21,
    From22To25,
    From26To29,
    From30To33,
    From34,
}

impl AgeBand {
    const COUNT: usize = 6;

    fn of(player: &Player, today: NaiveDate) -> Self {
        let Ok(born) = NaiveDate::parse_from_str(&player.date_of_birth, "%Y-%m-%d") else {
            return Self::Unknown;
        };
        match full_years_between(today, born) {
            ..=21 => Self::UpTo21,
            22..=25 => Self::From22To25,
            26..=29 => Self::From26To29,
            30..=33 => Self::From30To33,
            _ => Self::From34,
        }
    }

    fn index(self) -> usize {
        self as usize
    }
}

/// Sorted potential-over-OVR gaps of the reference players, per age band and overall.
struct GapPools {
    by_band: [Vec<u8>; AgeBand::COUNT],
    all: Vec<u8>,
}

impl GapPools {
    fn collect(players: &[Player], today: NaiveDate) -> Self {
        let mut pools = Self {
            by_band: Default::default(),
            all: Vec::new(),
        };
        for player in players.iter().filter(|p| is_reference(p)) {
            let gap = player
                .potential_base
                .saturating_sub(calculate_lol_ovr(player));
            pools.by_band[AgeBand::of(player, today).index()].push(gap);
            pools.all.push(gap);
        }
        pools.all.sort_unstable();
        pools
            .by_band
            .iter_mut()
            .for_each(|gaps| gaps.sort_unstable());
        pools
    }

    /// The gap drawn for `player_id`: from the band when it has enough reference
    /// players, otherwise from every age. 0 when the world has no reference at all.
    fn gap_for(&self, band: AgeBand, player_id: &str) -> u8 {
        let band_gaps = &self.by_band[band.index()];
        let gaps = if band_gaps.len() >= MIN_REFERENCE_PLAYERS_PER_BAND {
            band_gaps
        } else {
            &self.all
        };
        if gaps.is_empty() {
            return 0;
        }
        let drawn = gaps[(stable_hash(player_id, "potential") % gaps.len() as u64) as usize];
        drawn.min(percentile_75(gaps))
    }
}

/// A player whose shipped potential and rating both carry information.
fn is_reference(player: &Player) -> bool {
    let row = player.attributes.as_array();
    player.potential_base > 0 && !is_placeholder_rating(player) && row.iter().any(|&a| a != row[0])
}

/// Nearest-rank 75th percentile of an ascending, non-empty slice.
fn percentile_75(sorted: &[u8]) -> u8 {
    sorted[(sorted.len() * 3).div_ceil(4) - 1]
}

/// Gives every player with `potential_base == 0` a potential (see the module docs) and
/// returns how many were filled. `today` is the date ages are measured at.
///
/// A revealed estimate on a filled player is re-based: it becomes the new potential
/// plus the research bonus already earned (at most 3), capped at 99. Players with a
/// positive potential are never touched.
pub fn fill_missing_potentials(players: &mut [Player], today: NaiveDate) -> usize {
    // The pools are read before any write, so one filled player never feeds another.
    let pools = GapPools::collect(players, today);
    let mut filled = 0;
    for player in players.iter_mut().filter(|p| p.potential_base == 0) {
        let gap = pools.gap_for(AgeBand::of(player, today), &player.id);
        let ovr = calculate_lol_ovr(player);
        player.potential_base = ovr.saturating_add(gap).clamp(ovr, MAX_POTENTIAL);
        if let Some(earned) = player.potential_revealed {
            player.potential_revealed = Some(
                player
                    .potential_base
                    .saturating_add(earned.min(MAX_REVEAL_BONUS))
                    .min(MAX_POTENTIAL),
            );
        }
        filled += 1;
    }
    filled
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::player::PlayerAttributes;
    use crate::domain::stats::LolRole;

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 11, 16).unwrap()
    }

    fn attributes(value: u8) -> PlayerAttributes {
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

    fn player(id: &str, dob: &str, attributes: PlayerAttributes, potential: u8) -> Player {
        let mut p = Player::new(
            id.to_string(),
            id.to_string(),
            id.to_string(),
            dob.to_string(),
            "KR".to_string(),
            LolRole::Jungle,
            attributes,
        );
        p.potential_base = potential;
        p
    }

    /// A non-flat player whose OVR is exactly `ovr` and whose potential is `ovr + gap`.
    fn rated(id: &str, dob: &str, ovr: u8, gap: u8) -> Player {
        let mut attrs = attributes(ovr);
        attrs.mechanics = ovr + 1;
        attrs.laning = ovr - 1;
        player(id, dob, attrs, ovr + gap)
    }

    /// A player shipped without a potential, rated `ovr` (non-flat).
    fn marked(id: &str, dob: &str, ovr: u8) -> Player {
        with_potential(rated(id, dob, ovr, 0), 0)
    }

    fn with_potential(mut player: Player, potential: u8) -> Player {
        player.potential_base = potential;
        player
    }

    const AGE_28: &str = "1998-03-01";
    const AGE_31: &str = "1995-03-01";
    const AGE_23: &str = "2003-03-01";

    /// `count` reference players of one age, all with the same `gap`.
    fn reference(prefix: &str, dob: &str, count: usize, gap: u8) -> Vec<Player> {
        (0..count)
            .map(|i| rated(&format!("{prefix}-{i}"), dob, 60, gap))
            .collect()
    }

    #[test]
    fn a_flat_29_year_old_without_a_potential_gets_one_at_or_above_his_rating() {
        let mut players = reference("ref", AGE_28, 10, 5);
        let elmillor = player("fa-c45e5ff7", "1997-09-30", attributes(50), 0);
        players.push(elmillor);

        let filled = fill_missing_potentials(&mut players, today());

        let elmillor = players.last().unwrap();
        assert_eq!(filled, 1);
        assert_eq!(elmillor.potential_base, 55);
    }

    #[test]
    fn a_band_under_five_players_uses_the_gaps_of_every_age() {
        let mut players = reference("young", AGE_23, 10, 3);
        players.extend(reference("older", AGE_31, 2, 20));
        players.push(marked("target", AGE_31, 60));

        fill_missing_potentials(&mut players, today());

        let target = players.last().unwrap();
        assert_eq!(target.potential_base, 63);
    }

    #[test]
    fn a_player_without_a_date_of_birth_uses_the_unknown_band() {
        let mut players = reference("unknown", "", 5, 8);
        for band_dob in [AGE_23, AGE_28, AGE_31] {
            players.extend(reference(&format!("age-{band_dob}"), band_dob, 6, 2));
        }
        players.push(marked("target", "", 60));

        fill_missing_potentials(&mut players, today());

        let target = players.last().unwrap();
        assert_eq!(target.potential_base, 68);
    }

    #[test]
    fn an_unparseable_date_of_birth_is_unknown_too() {
        let mut players = reference("unknown", "n/a", 5, 8);
        players.extend(reference("known", AGE_28, 6, 2));
        players.push(marked("target", "not-a-date", 60));

        fill_missing_potentials(&mut players, today());

        assert_eq!(players.last().unwrap().potential_base, 68);
    }

    #[test]
    fn age_is_measured_at_the_given_date() {
        let build = || {
            let mut players = reference("a", "2005-06-01", 6, 9);
            players.extend(reference("b", AGE_23, 6, 2));
            players.push(marked("target", "2004-12-01", 60));
            players
        };

        let mut before_birthday = build();
        fill_missing_potentials(&mut before_birthday, today());
        let mut after_birthday = build();
        fill_missing_potentials(
            &mut after_birthday,
            NaiveDate::from_ymd_opt(2026, 12, 2).unwrap(),
        );

        assert_eq!(before_birthday.last().unwrap().potential_base, 69);
        assert_eq!(after_birthday.last().unwrap().potential_base, 62);
    }

    #[test]
    fn the_same_world_gives_the_same_result_in_any_order() {
        let mut gaps: Vec<Player> = (0..12)
            .map(|i| rated(&format!("ref-{i}"), AGE_28, 60, (i % 7) as u8))
            .collect();
        gaps.extend((0..20).map(|i| marked(&format!("m-{i}"), AGE_28, 55 + (i % 9) as u8)));
        let mut forward = gaps.clone();
        let mut reversed: Vec<Player> = gaps.iter().rev().cloned().collect();

        fill_missing_potentials(&mut forward, today());
        fill_missing_potentials(&mut reversed, today());

        let by_id = |players: &[Player]| {
            let mut ids: Vec<(String, u8)> = players
                .iter()
                .map(|p| (p.id.clone(), p.potential_base))
                .collect();
            ids.sort();
            ids
        };
        assert_eq!(by_id(&forward), by_id(&reversed));
    }

    #[test]
    fn players_with_a_potential_are_left_alone() {
        let mut players = reference("ref", AGE_28, 10, 5);
        players.push(with_potential(rated("below", AGE_28, 70, 0), 66));
        players.push(with_potential(rated("above", AGE_28, 70, 0), 90));
        players.push(marked("target", AGE_28, 60));
        let before: Vec<(String, u8)> = players
            .iter()
            .filter(|p| p.potential_base > 0)
            .map(|p| (p.id.clone(), p.potential_base))
            .collect();

        fill_missing_potentials(&mut players, today());

        let after: Vec<(String, u8)> = players
            .iter()
            .filter(|p| p.id != "target")
            .map(|p| (p.id.clone(), p.potential_base))
            .collect();
        assert_eq!(after, before);
    }

    #[test]
    fn a_flat_row_with_a_potential_does_not_shape_the_reference() {
        let mut players = reference("ref", AGE_28, 6, 5);
        players.extend((0..6).map(|i| player(&format!("flat-{i}"), AGE_28, attributes(50), 99)));
        players.push(marked("target", AGE_28, 60));

        fill_missing_potentials(&mut players, today());

        assert_eq!(players.last().unwrap().potential_base, 65);
    }

    #[test]
    fn the_gap_is_capped_at_the_bands_75th_percentile() {
        let mut players = reference("short", AGE_28, 7, 1);
        players.extend(reference("tall", AGE_28, 1, 40));
        players.extend((0..60).map(|i| marked(&format!("m-{i}"), AGE_28, 60)));

        fill_missing_potentials(&mut players, today());

        let most = players
            .iter()
            .filter(|p| p.id.starts_with("m-"))
            .map(|p| p.potential_base)
            .max()
            .unwrap();
        assert_eq!(most, 61);
    }

    #[test]
    fn the_potential_never_passes_99() {
        let mut players = reference("ref", AGE_28, 6, 10);
        players.push(marked("target", AGE_28, 97));

        fill_missing_potentials(&mut players, today());

        assert_eq!(players.last().unwrap().potential_base, 99);
    }

    #[test]
    fn a_world_without_reference_players_gives_the_rating() {
        let mut players = vec![marked("target", AGE_28, 60)];

        fill_missing_potentials(&mut players, today());

        assert_eq!(players[0].potential_base, 60);
    }

    #[test]
    fn a_revealed_estimate_becomes_the_new_base_plus_the_bonus_already_earned() {
        let mut players = reference("ref", AGE_28, 10, 5);
        for (id, revealed) in [("two", 2), ("seven", 7), ("none", 0)] {
            let mut p = marked(id, AGE_28, 60);
            p.potential_revealed = Some(revealed);
            players.push(p);
        }
        let mut capped = marked("capped", AGE_28, 97);
        capped.potential_revealed = Some(3);
        players.push(capped);

        fill_missing_potentials(&mut players, today());

        let revealed: Vec<(String, Option<u8>)> = players
            .iter()
            .skip(10)
            .map(|p| (p.id.clone(), p.potential_revealed))
            .collect();
        assert_eq!(
            revealed,
            vec![
                ("two".to_string(), Some(67)),
                ("seven".to_string(), Some(68)),
                ("none".to_string(), Some(65)),
                ("capped".to_string(), Some(99)),
            ]
        );
    }

    #[test]
    fn a_revealed_estimate_on_a_player_with_a_potential_is_kept() {
        let mut players = reference("ref", AGE_28, 10, 5);
        let mut set = rated("set", AGE_28, 60, 8);
        set.potential_revealed = Some(71);
        players.push(set);

        fill_missing_potentials(&mut players, today());

        assert_eq!(players.last().unwrap().potential_revealed, Some(71));
    }

    #[test]
    fn a_second_pass_changes_nothing() {
        let mut players = reference("ref", AGE_28, 10, 5);
        let mut target = marked("target", AGE_28, 60);
        target.potential_revealed = Some(2);
        players.push(target);
        fill_missing_potentials(&mut players, today());
        let once = players.clone();

        let filled = fill_missing_potentials(&mut players, today());

        assert_eq!(filled, 0);
        assert_eq!(
            players
                .iter()
                .map(|p| (p.potential_base, p.potential_revealed))
                .collect::<Vec<_>>(),
            once.iter()
                .map(|p| (p.potential_base, p.potential_revealed))
                .collect::<Vec<_>>()
        );
    }
}
