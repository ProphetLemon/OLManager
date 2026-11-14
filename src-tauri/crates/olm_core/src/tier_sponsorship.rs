//! Starting and renewing sponsors sized by league tier.
//!
//! Every main club that a league schedules holds a 12-month deal worth one annual
//! amount per tier, so a club that plays only in a background league (no prize money,
//! no matchday income) still covers a typical wage bill. The deal is paid by the
//! ordinary monthly sponsorship step (`base_value / 12`); this module only decides who
//! holds one and for how much. Clubs a league does not schedule (the historical-roster
//! clubs) and academy sub-teams get none.

use std::collections::{HashMap, HashSet};

use crate::domain::league::LeagueKind;
use crate::domain::team::{Sponsorship, SponsorshipOrigin, Team};
use crate::game::Game;

/// Annual value of a tier-1 club's sponsor, in euros.
///
/// Measured on 2026-11-14 on the world a new game builds (`world_sponsor_sizing_measure`):
/// the median annual player plus staff wage bill of the 58 scheduled tier-1 main clubs
/// is 1,490,000, rounded up to the nearest 50,000.
pub const TIER_1_SPONSORSHIP_VALUE: i64 = 1_500_000;

/// Annual value of a tier-2 (and lower) club's sponsor, in euros.
///
/// Measured on 2026-11-14 like [`TIER_1_SPONSORSHIP_VALUE`]: the median annual wage
/// bill of the 200 scheduled tier-2 main clubs is 918,000, rounded up to the nearest
/// 50,000. Tier 3 and lower, and a league with no tier, use this value.
pub const TIER_2_SPONSORSHIP_VALUE: i64 = 950_000;

/// Length of a tier deal; a club whose deal ends gets a new one the same month.
pub const TIER_SPONSORSHIP_MONTHS: u32 = 12;

/// Brand names for tier deals. None contains a word that triggers the esports theme
/// bonus, so a deal pays exactly its tier value whichever name it carries.
const TIER_SPONSOR_NAMES: [&str; 12] = [
    "Northwind Logistics",
    "Harbor Capital",
    "Summit Foods",
    "Granite Insurance",
    "Meridian Energy",
    "Alder Telecom",
    "Lumen Airlines",
    "Cobalt Motors",
    "Juniper Bank",
    "Atlas Freight",
    "Verde Beverages",
    "Orion Property",
];

/// Annual sponsor value for a league tier.
pub fn tier_sponsorship_value(tier: u8) -> i64 {
    if tier == 1 {
        TIER_1_SPONSORSHIP_VALUE
    } else {
        TIER_2_SPONSORSHIP_VALUE
    }
}

/// FNV-1a over the team id: stable across runs and platforms, unlike `DefaultHasher`.
fn stable_hash(text: &str) -> u64 {
    text.bytes().fold(0xcbf2_9ce4_8422_2325, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3)
    })
}

/// Deterministic sponsor name of a club.
pub fn tier_sponsor_name(team_id: &str) -> &'static str {
    TIER_SPONSOR_NAMES[(stable_hash(team_id) % TIER_SPONSOR_NAMES.len() as u64) as usize]
}

/// A fresh tier deal for `team_id`: 12 months, no bonus criteria, and silent (no
/// inbox mail), see [`SponsorshipOrigin::Tier`].
pub fn tier_sponsorship(team_id: &str, tier: u8) -> Sponsorship {
    Sponsorship {
        sponsor_name: tier_sponsor_name(team_id).to_string(),
        base_value: tier_sponsorship_value(tier),
        remaining_months: TIER_SPONSORSHIP_MONTHS,
        bonus_criteria: Vec::new(),
        origin: SponsorshipOrigin::Tier,
    }
}

/// Tier of every main club some league schedules (the club is in its standings),
/// keyed by team id. A club listed in several leagues keeps the best tier; a league
/// with no tier counts as tier 0 and so sizes like tier 2. Academy sub-teams and
/// clubs in no league are absent.
pub fn scheduled_main_club_tiers(game: &Game) -> HashMap<String, u8> {
    let mut tiers: HashMap<String, u8> = HashMap::new();
    for league in game
        .leagues
        .iter()
        .filter(|league| league.league_kind == LeagueKind::Main)
    {
        for standing in &league.standings {
            tiers
                .entry(standing.team_id.clone())
                .and_modify(|tier| *tier = better_tier(*tier, league.tier))
                .or_insert(league.tier);
        }
    }
    let main_ids: HashSet<&str> = game
        .teams
        .iter()
        .filter(|team| team.is_main())
        .map(|team| team.id.as_str())
        .collect();
    tiers.retain(|team_id, _| main_ids.contains(team_id.as_str()));
    tiers
}

/// The lower number is the better tier; 0 means "no tier" and loses to any real one.
fn better_tier(current: u8, other: u8) -> u8 {
    match (current, other) {
        (0, other) => other,
        (current, 0) => current,
        (current, other) => current.min(other),
    }
}

/// Give every club of `tiers` (see [`scheduled_main_club_tiers`]) that holds no
/// sponsor a tier deal. Returns how many clubs received one.
pub fn assign_missing_tier_sponsorships_from(
    teams: &mut [Team],
    tiers: &HashMap<String, u8>,
) -> usize {
    let mut assigned = 0;
    for team in teams.iter_mut() {
        if team.sponsorship.is_none()
            && let Some(tier) = tiers.get(&team.id)
        {
            team.sponsorship = Some(tier_sponsorship(&team.id, *tier));
            assigned += 1;
        }
    }
    assigned
}

/// Give every scheduled main club that holds no sponsor a tier deal. Returns how
/// many clubs received one. Used at world build; the monthly step calls
/// [`assign_missing_tier_sponsorships_from`] with the tiers it already computed.
pub fn assign_missing_tier_sponsorships(game: &mut Game) -> usize {
    let tiers = scheduled_main_club_tiers(game);
    assign_missing_tier_sponsorships_from(&mut game.teams, &tiers)
}
