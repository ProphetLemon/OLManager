//! Completes the staff the source data ships with only a name and a role.
//!
//! About half of `data/staffs` carries no attributes and no wage, so those members
//! load with every attribute at 0 and would drag their club's staff effects below
//! the floor of an empty staff. [`complete_missing_staff`] gives them attributes
//! drawn from the staff of the same role at the same league that does have data,
//! and a wage from the same peers. The draw is derived only from the member's id,
//! so the same world always gets the same values.
//!
//! Members that already carry attributes or a wage are never touched.

use std::collections::HashMap;

use crate::custom_team::quantile;
use crate::domain::staff::{Staff, StaffAttributes, StaffRole};
use crate::domain::team::Team;

/// Fewest rated peers of one role at one league for the league's own
/// distribution to be used; below this the role's distribution over every league is.
const MIN_LEAGUE_PEERS: usize = 5;
/// Quantiles of the peer distribution a club's member is drawn from: the middle half.
const CLUB_BAND: (f64, f64) = (0.25, 0.75);
/// Quantiles a member without a club is drawn from: the lower-middle of the market.
const FREE_AGENT_BAND: (f64, f64) = (0.10, 0.40);
/// Attribute window when no member of the role has data at all.
const FALLBACK_WINDOW: (u8, u8) = (50, 70);
/// Yearly wage when no rated peer of the role carries one. The complete data
/// ships one wage only, 30000, and it does not vary with the attributes.
pub const DEFAULT_STAFF_WAGE: u32 = 30_000;

/// What [`complete_missing_staff`] filled in.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct StaffCompletion {
    pub attributes: usize,
    pub wages: usize,
}

/// Attribute values of the rated staff of one role: one sorted list per attribute
/// and the wages above zero.
#[derive(Default)]
struct PeerPool {
    attributes: [Vec<u8>; 4],
    wages: Vec<u32>,
}

impl PeerPool {
    fn add(&mut self, member: &Staff) {
        for (list, value) in self.attributes.iter_mut().zip(attribute_array(member)) {
            list.push(value);
        }
        if member.wage > 0 {
            self.wages.push(member.wage);
        }
    }

    fn sort(&mut self) {
        self.attributes.iter_mut().for_each(|list| list.sort_unstable());
        self.wages.sort_unstable();
    }

    fn len(&self) -> usize {
        self.attributes[0].len()
    }
}

fn attribute_array(member: &Staff) -> [u8; 4] {
    let a = &member.attributes;
    [a.coaching, a.judging_ability, a.judging_potential, a.physiotherapy]
}

const ATTRIBUTE_KEYS: [&str; 4] = ["coaching", "judging_ability", "judging_potential", "physiotherapy"];

/// Stable value in `0.0..1.0` derived only from the seed and key: FNV-1a with a
/// splitmix64 finalizer, so there is no RNG state to carry.
fn unit_interval(seed: &str, key: &str) -> f64 {
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
    (hash >> 11) as f64 / (1u64 << 53) as f64
}

/// League (competition id) of the club a member works for, when known.
fn league_of<'a>(member: &Staff, club_league: &HashMap<&'a str, &'a str>) -> Option<&'a str> {
    member
        .team_id
        .as_deref()
        .and_then(|team_id| club_league.get(team_id).copied())
}

/// Gives every member in `staff` that has no attribute data deterministic
/// attributes and, when `fill_wages` is set, a wage. Owners get attributes (so no
/// card shows a 0 rating) but never a wage: an owner is not on the payroll.
///
/// A save's existing members pass `fill_wages = false`: their finances already
/// ran without a wage, and changing it mid-game would change the books.
pub fn complete_missing_staff(
    staff: &mut [Staff],
    teams: &[Team],
    fill_wages: bool,
) -> StaffCompletion {
    let club_league: HashMap<&str, &str> = teams
        .iter()
        .filter_map(|team| Some((team.id.as_str(), team.competition_id.as_deref()?)))
        .collect();

    let mut by_league: HashMap<(StaffRole, &str), PeerPool> = HashMap::new();
    let mut by_role: HashMap<StaffRole, PeerPool> = HashMap::new();
    for member in staff.iter().filter(|member| member.has_attribute_data()) {
        by_role.entry(member.role.clone()).or_default().add(member);
        if let Some(league) = league_of(member, &club_league) {
            by_league
                .entry((member.role.clone(), league))
                .or_default()
                .add(member);
        }
    }
    by_league.values_mut().for_each(PeerPool::sort);
    by_role.values_mut().for_each(PeerPool::sort);

    let mut report = StaffCompletion::default();
    for member in staff.iter_mut().filter(|member| !member.has_attribute_data()) {
        let league_pool = league_of(member, &club_league)
            .and_then(|league| by_league.get(&(member.role.clone(), league)))
            .filter(|pool| pool.len() >= MIN_LEAGUE_PEERS);
        let role_pool = by_role.get(&member.role);
        let pool = league_pool.or(role_pool);

        let (low, high) = if member.team_id.is_none() { FREE_AGENT_BAND } else { CLUB_BAND };
        let mut drawn = [0u8; 4];
        for (index, key) in ATTRIBUTE_KEYS.iter().enumerate() {
            let u = unit_interval(&member.id, key);
            drawn[index] = match pool {
                Some(pool) => quantile(&pool.attributes[index], low + u * (high - low)),
                None => {
                    let (min, max) = FALLBACK_WINDOW;
                    (f64::from(min) + u * f64::from(max - min)).round() as u8
                }
            };
        }
        member.attributes = StaffAttributes {
            coaching: drawn[0],
            judging_ability: drawn[1],
            judging_potential: drawn[2],
            physiotherapy: drawn[3],
        };
        report.attributes += 1;

        if fill_wages && member.wage == 0 && !member.is_owner() {
            member.wage = role_pool
                .and_then(|pool| pool.wages.get(pool.wages.len() / 2).copied())
                .unwrap_or(DEFAULT_STAFF_WAGE);
            report.wages += 1;
        }
    }
    report
}

#[cfg(test)]
mod tests {
    use super::*;

    fn member(id: &str, role: StaffRole, team_id: Option<&str>, attrs: [u8; 4], wage: u32) -> Staff {
        let mut staff = Staff::new(
            id.to_string(),
            "Test".to_string(),
            id.to_string(),
            String::new(),
            role,
            StaffAttributes {
                coaching: attrs[0],
                judging_ability: attrs[1],
                judging_potential: attrs[2],
                physiotherapy: attrs[3],
            },
        );
        staff.team_id = team_id.map(str::to_string);
        staff.wage = wage;
        staff
    }

    fn team(id: &str, league: &str) -> Team {
        let mut team = Team::new(
            id.to_string(),
            id.to_string(),
            id.to_string(),
            "Spain".to_string(),
            "Madrid".to_string(),
            "Ground".to_string(),
            1_000,
        );
        team.competition_id = Some(league.to_string());
        team
    }

    /// Six rated assistants at league `hi` (80..=90) and six at league `lo` (50..=60).
    fn world() -> (Vec<Staff>, Vec<Team>) {
        let mut staff = Vec::new();
        for i in 0..6u8 {
            staff.push(member(&format!("hi-{i}"), StaffRole::AssistantManager, Some("hi-club"), [80 + i * 2; 4], 30_000));
            staff.push(member(&format!("lo-{i}"), StaffRole::AssistantManager, Some("lo-club"), [50 + i * 2; 4], 30_000));
        }
        (staff, vec![team("hi-club", "hi"), team("lo-club", "lo")])
    }

    #[test]
    fn missing_attributes_are_drawn_from_the_same_league_peers() {
        let (mut staff, teams) = world();
        staff.push(member("gap-hi", StaffRole::AssistantManager, Some("hi-club"), [0; 4], 0));
        staff.push(member("gap-lo", StaffRole::AssistantManager, Some("lo-club"), [0; 4], 0));

        let report = complete_missing_staff(&mut staff, &teams, true);

        assert_eq!(report.attributes, 2);
        let hi = staff.iter().find(|m| m.id == "gap-hi").unwrap().attributes.coaching;
        let lo = staff.iter().find(|m| m.id == "gap-lo").unwrap().attributes.coaching;
        assert!((80..=90).contains(&hi), "league hi peers are 80..=90, got {hi}");
        assert!((50..=60).contains(&lo), "league lo peers are 50..=60, got {lo}");
    }

    #[test]
    fn the_same_id_always_gets_the_same_attributes() {
        let (mut first, teams) = world();
        let (mut second, _) = world();
        first.push(member("gap", StaffRole::AssistantManager, Some("hi-club"), [0; 4], 0));
        second.push(member("gap", StaffRole::AssistantManager, Some("hi-club"), [0; 4], 0));
        second.reverse();

        complete_missing_staff(&mut first, &teams, true);
        complete_missing_staff(&mut second, &teams, true);

        let pick = |staff: &[Staff]| staff.iter().find(|m| m.id == "gap").unwrap().attributes.clone();
        assert_eq!(pick(&first), pick(&second));
    }

    #[test]
    fn a_free_agent_is_drawn_below_the_club_band() {
        let (mut staff, teams) = world();
        for i in 0..20 {
            staff.push(member(&format!("fa-{i}"), StaffRole::AssistantManager, None, [0; 4], 0));
        }

        complete_missing_staff(&mut staff, &teams, true);

        // The role's rated values run 50..=90; the free-agent band stops at the 40th percentile.
        let ceiling = {
            let mut all: Vec<u8> = (0..6).flat_map(|i| [80 + i * 2, 50 + i * 2]).collect();
            all.sort_unstable();
            quantile(&all, FREE_AGENT_BAND.1)
        };
        for m in staff.iter().filter(|m| m.id.starts_with("fa-")) {
            assert!(m.attributes.coaching <= ceiling, "{} drew {} above {ceiling}", m.id, m.attributes.coaching);
        }
    }

    #[test]
    fn a_league_with_too_few_peers_uses_the_role_over_every_league() {
        let (mut staff, mut teams) = world();
        teams.push(team("tiny-club", "tiny"));
        staff.push(member("tiny-rated", StaffRole::AssistantManager, Some("tiny-club"), [70; 4], 30_000));
        staff.push(member("gap", StaffRole::AssistantManager, Some("tiny-club"), [0; 4], 0));

        complete_missing_staff(&mut staff, &teams, true);

        let drawn = staff.iter().find(|m| m.id == "gap").unwrap().attributes.coaching;
        assert!((50..=90).contains(&drawn), "role-wide peers are 50..=90, got {drawn}");
    }

    #[test]
    fn a_role_without_rated_peers_uses_the_fallback_window() {
        let mut staff = vec![member("gap", StaffRole::Physio, None, [0; 4], 0)];

        complete_missing_staff(&mut staff, &[], true);

        let a = &staff[0].attributes;
        for value in [a.coaching, a.judging_ability, a.judging_potential, a.physiotherapy] {
            assert!((FALLBACK_WINDOW.0..=FALLBACK_WINDOW.1).contains(&value));
        }
        assert_eq!(staff[0].wage, DEFAULT_STAFF_WAGE);
    }

    #[test]
    fn wage_follows_the_rated_peers_of_the_role() {
        let (mut staff, teams) = world();
        for m in staff.iter_mut() {
            m.wage = 45_000;
        }
        staff.push(member("gap", StaffRole::AssistantManager, Some("hi-club"), [0; 4], 0));

        let report = complete_missing_staff(&mut staff, &teams, true);

        assert_eq!(report.wages, 1);
        assert_eq!(staff.iter().find(|m| m.id == "gap").unwrap().wage, 45_000);
    }

    #[test]
    fn existing_saves_keep_their_wage() {
        let (mut staff, teams) = world();
        staff.push(member("gap", StaffRole::AssistantManager, Some("hi-club"), [0; 4], 0));

        let report = complete_missing_staff(&mut staff, &teams, false);

        assert_eq!((report.attributes, report.wages), (1, 0));
        assert_eq!(staff.iter().find(|m| m.id == "gap").unwrap().wage, 0);
    }

    #[test]
    fn an_owner_gets_attributes_but_no_wage() {
        let mut staff = vec![member("boss", StaffRole::Owner, Some("club"), [0; 4], 0)];

        complete_missing_staff(&mut staff, &[], true);

        assert!(staff[0].has_attribute_data());
        assert_eq!(staff[0].wage, 0);
    }

    #[test]
    fn rated_members_are_never_touched() {
        let (mut staff, teams) = world();
        let before = staff.clone();

        let report = complete_missing_staff(&mut staff, &teams, true);

        assert_eq!(report, StaffCompletion::default());
        for (after, before) in staff.iter().zip(&before) {
            assert_eq!((after.attributes.clone(), after.wage), (before.attributes.clone(), before.wage));
        }
    }
}
