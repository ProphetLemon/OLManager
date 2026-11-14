//! Defaults for teams the data ships without reputation or money.
//!
//! 168 of the 200 second-tier teams carry no reputation, finance, wage budget or
//! transfer budget (the `data` submodule is read-only, and `team-overrides.json`
//! holds hand-written entries for two clubs). A team with a zero wage budget is
//! skipped by `wage_scale::seed_missing_wages`, so its players would keep wage 0,
//! and the AI cannot sign anyone with a zero transfer budget.
//!
//! [`derive_missing_team_metadata`] fills those gaps in code, at world build,
//! **only where the value is missing or zero**. Reviewed values (the data's own, or
//! a `team-overrides.json` entry applied before this pass) are never touched and
//! are the only source of the defaults: a team gets a value taken from the teams of
//! its own tier that have a reviewed one. The function returns a report of every
//! team and field it derived, so derived values stay distinguishable from reviewed
//! ones.
//!
//! A reviewed budget that contradicts the team's own files does not count as
//! reviewed: when the wage budget is below the club's committed annual wage bill
//! (player and staff wages, with the wage scale's minimum for players who have none yet), or its finance cannot pay one season of that bill, the
//! finance, wage budget and transfer budget are treated as missing and derived like
//! any other gap (the reputation is kept). Such clubs are left out of the reference
//! the defaults come from, and the report says why each was derived.
//!
//! Each team picks one point of the reviewed range, derived from its id, between the
//! 25th and the 75th percentile, and takes that point of every field. Teams of one
//! tier therefore differ from each other, a bigger reputation comes with more money,
//! and the result is stable across runs.

use std::collections::HashMap;

use crate::domain::player::Player;
use crate::domain::staff::Staff;
use crate::domain::team::Team;
use crate::stable_hash::stable_hash;
use crate::wage_scale::WAGE_SCALE_BASE;

/// Why a team's money was derived.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DerivationReason {
    /// The value was missing or zero in the data.
    Missing,
    /// A reviewed wage budget below the club's committed annual wage bill.
    WageBudgetBelowWageBill,
    /// A reviewed finance that cannot pay one season of the committed wage bill.
    FinanceBelowWageBill,
}

/// What was derived for one team.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DerivedTeamMetadata {
    pub team_id: String,
    /// Names of the fields that got a derived value.
    pub fields: Vec<&'static str>,
    pub reason: DerivationReason,
}

/// Yearly wage bill per team id that the club is committed to: the wages its
/// players and staff already carry (the data's own, plus the staff wages completed at
/// world build) and, for each rostered player without a wage, the wage scale's
/// minimum (`wage_scale::WAGE_SCALE_BASE`). The wage seeding scales the real wages of
/// those players down to the budget, so the minimum is the least a club of that
/// roster ends up paying once an emergency signing ignores the budget. Free agents
/// and unknown teams add nothing.
pub fn committed_wage_bills(players: &[Player], staff: &[Staff]) -> HashMap<String, i64> {
    let mut bills: HashMap<String, i64> = HashMap::new();
    let player_wages = players.iter().map(|p| {
        let wage = if p.wage > 0 {
            u64::from(p.wage)
        } else {
            WAGE_SCALE_BASE
        };
        (p.team_id.as_deref(), wage)
    });
    let staff_wages = staff
        .iter()
        .map(|s| (s.team_id.as_deref(), u64::from(s.wage)));
    for (team_id, wage) in player_wages.chain(staff_wages) {
        if let Some(team_id) = team_id {
            *bills.entry(team_id.to_string()).or_default() += wage as i64;
        }
    }
    bills
}

/// The reason a team's reviewed money contradicts its own wage bill, if it does.
fn budget_contradiction(team: &Team, bill: i64) -> Option<DerivationReason> {
    if team.wage_budget > 0 && team.wage_budget < bill {
        Some(DerivationReason::WageBudgetBelowWageBill)
    } else if team.finance > 0 && team.finance < bill {
        Some(DerivationReason::FinanceBelowWageBill)
    } else {
        None
    }
}

/// Fill the zero reputation, finance, wage budget and transfer budget of `teams`
/// from the reviewed values of the teams of the same tier. `tiers` maps a
/// competition id to its tier and `wage_bills` (see [`committed_wage_bills`]) a team
/// id to its committed annual wage bill; a team whose competition has no tier, or
/// whose tier has no reviewed value for a field, keeps that field as it is.
pub fn derive_missing_team_metadata(
    teams: &mut [Team],
    tiers: &HashMap<String, u8>,
    wage_bills: &HashMap<String, i64>,
) -> Vec<DerivedTeamMetadata> {
    let contradiction =
        |team: &Team| budget_contradiction(team, wage_bills.get(&team.id).copied().unwrap_or(0));
    let tier_of = |team: &Team| {
        team.competition_id
            .as_deref()
            .and_then(|competition| tiers.get(competition).copied())
    };

    // The reference is read before anything is written, so a derived value never
    // feeds another team's default, and clubs whose money is treated as missing
    // never feed it either.
    let mut references: HashMap<u8, Reference> = HashMap::new();
    for team in teams.iter() {
        if let Some(tier) = tier_of(team)
            && contradiction(team).is_none()
        {
            references.entry(tier).or_default().add(team);
        }
    }
    for reference in references.values_mut() {
        reference.sort();
    }

    let mut report = Vec::new();
    for team in teams.iter_mut() {
        let Some(reference) = tier_of(team).and_then(|tier| references.get(&tier)) else {
            continue;
        };
        let rejected = contradiction(team);
        let point = reference_point(&team.id);
        let mut fields = Vec::new();
        if team.reputation == 0
            && let Some(value) = pick(&reference.reputation, point)
        {
            team.reputation = value;
            fields.push("reputation");
        }
        for (name, slot, values) in [
            ("finance", &mut team.finance, &reference.finance),
            ("wage_budget", &mut team.wage_budget, &reference.wage_budget),
            (
                "transfer_budget",
                &mut team.transfer_budget,
                &reference.transfer_budget,
            ),
        ] {
            if (*slot == 0 || rejected.is_some())
                && let Some(value) = pick(values, point)
            {
                *slot = value;
                fields.push(name);
            }
        }
        if !fields.is_empty() {
            report.push(DerivedTeamMetadata {
                team_id: team.id.clone(),
                fields,
                reason: rejected.unwrap_or(DerivationReason::Missing),
            });
        }
    }
    report
}

/// Reviewed (non-zero) values of one tier, one sorted list per field.
#[derive(Default)]
struct Reference {
    reputation: Vec<u32>,
    finance: Vec<i64>,
    wage_budget: Vec<i64>,
    transfer_budget: Vec<i64>,
}

impl Reference {
    fn add(&mut self, team: &Team) {
        if team.reputation > 0 {
            self.reputation.push(team.reputation);
        }
        for (value, values) in [
            (team.finance, &mut self.finance),
            (team.wage_budget, &mut self.wage_budget),
            (team.transfer_budget, &mut self.transfer_budget),
        ] {
            if value > 0 {
                values.push(value);
            }
        }
    }

    fn sort(&mut self) {
        self.reputation.sort_unstable();
        self.finance.sort_unstable();
        self.wage_budget.sort_unstable();
        self.transfer_budget.sort_unstable();
    }
}

/// Where in the reviewed range a team sits, as a share between 25% and 75%.
fn reference_point(team_id: &str) -> f64 {
    let steps = stable_hash(team_id, "team-metadata") % (POINT_STEPS + 1);
    LOWEST_POINT + (HIGHEST_POINT - LOWEST_POINT) * steps as f64 / POINT_STEPS as f64
}

/// The value at `point` (0 to 1) of an ascending list; `None` for an empty list.
fn pick<T: Copy>(sorted: &[T], point: f64) -> Option<T> {
    let last = sorted.len().checked_sub(1)?;
    sorted.get((point * last as f64).round() as usize).copied()
}

const LOWEST_POINT: f64 = 0.25;
const HIGHEST_POINT: f64 = 0.75;
const POINT_STEPS: u64 = 10_000;

#[cfg(test)]
mod tests {
    use super::*;

    fn team(id: &str, competition: &str, reputation: u32, finance: i64) -> Team {
        let mut t = Team::new(
            id.to_string(),
            id.to_string(),
            id.to_string(),
            "ES".to_string(),
            "Madrid".to_string(),
            "Arena".to_string(),
            0,
        );
        t.competition_id = Some(competition.to_string());
        t.reputation = reputation;
        t.finance = finance;
        t.wage_budget = finance / 2;
        t.transfer_budget = finance / 5;
        t
    }

    fn tiers() -> HashMap<String, u8> {
        HashMap::from([("top".to_string(), 1), ("second".to_string(), 2)])
    }

    /// Ten reviewed second-tier teams (reputation 300..=390, finance 1M..=1.9M)
    /// and ten reviewed top-flight teams that are much richer.
    fn world() -> Vec<Team> {
        let mut teams = Vec::new();
        for i in 0..10u32 {
            teams.push(team(
                &format!("second-ok-{i}"),
                "second",
                300 + i * 10,
                1_000_000 + i64::from(i) * 100_000,
            ));
            teams.push(team(
                &format!("top-ok-{i}"),
                "top",
                600 + i * 10,
                5_000_000 + i64::from(i) * 100_000,
            ));
        }
        teams
    }

    #[test]
    fn missing_values_are_derived_from_teams_of_the_same_tier() {
        let mut teams = world();
        teams.push(team("second-gap", "second", 0, 0));
        let report = derive_missing_team_metadata(&mut teams, &tiers(), &HashMap::new());
        let gap = teams.last().unwrap();
        assert!(
            (300..=390).contains(&gap.reputation),
            "reputation {}",
            gap.reputation
        );
        assert!(
            (1_000_000..=1_900_000).contains(&gap.finance),
            "finance {}",
            gap.finance
        );
        assert!(gap.wage_budget > 0 && gap.transfer_budget > 0);
        assert_eq!(report.len(), 1);
        assert_eq!(report[0].team_id, "second-gap");
    }

    #[test]
    fn a_top_tier_gap_is_not_filled_from_the_second_tier() {
        let mut teams = world();
        teams.push(team("top-gap", "top", 0, 0));
        derive_missing_team_metadata(&mut teams, &tiers(), &HashMap::new());
        let gap = teams.last().unwrap();
        assert!(gap.reputation >= 600, "reputation {}", gap.reputation);
        assert!(gap.finance >= 5_000_000, "finance {}", gap.finance);
    }

    #[test]
    fn reviewed_values_are_never_touched() {
        let mut teams = world();
        let snapshot = |teams: &[Team]| -> Vec<_> {
            teams
                .iter()
                .map(|t| (t.reputation, t.finance, t.wage_budget, t.transfer_budget))
                .collect()
        };
        let before = snapshot(&teams);
        let report = derive_missing_team_metadata(&mut teams, &tiers(), &HashMap::new());
        assert_eq!(snapshot(&teams), before);
        assert!(report.is_empty());
    }

    #[test]
    fn only_the_zero_field_of_a_partly_reviewed_team_is_derived() {
        let mut teams = world();
        let mut partial = team("second-partial", "second", 345, 0);
        partial.wage_budget = 777_000;
        teams.push(partial);
        let report = derive_missing_team_metadata(&mut teams, &tiers(), &HashMap::new());
        let partial = teams.last().unwrap();
        assert_eq!(partial.reputation, 345);
        assert_eq!(partial.wage_budget, 777_000);
        assert!(partial.finance > 0 && partial.transfer_budget > 0);
        assert_eq!(report[0].fields, vec!["finance", "transfer_budget"]);
    }

    #[test]
    fn teams_of_one_tier_get_different_values() {
        let mut teams = world();
        for i in 0..8 {
            teams.push(team(&format!("second-gap-{i}"), "second", 0, 0));
        }
        derive_missing_team_metadata(&mut teams, &tiers(), &HashMap::new());
        let mut reputations: Vec<u32> = teams[20..].iter().map(|t| t.reputation).collect();
        reputations.sort_unstable();
        reputations.dedup();
        assert!(reputations.len() > 1, "all gaps got the same reputation");
    }

    #[test]
    fn derived_values_are_stable_across_runs_and_team_order() {
        let build = |reverse: bool| {
            let mut teams = world();
            teams.push(team("second-gap-a", "second", 0, 0));
            teams.push(team("second-gap-b", "second", 0, 0));
            if reverse {
                teams.reverse();
            }
            derive_missing_team_metadata(&mut teams, &tiers(), &HashMap::new());
            let mut out: Vec<_> = teams
                .into_iter()
                .filter(|t| t.id.contains("gap"))
                .map(|t| {
                    (
                        t.id,
                        t.reputation,
                        t.finance,
                        t.wage_budget,
                        t.transfer_budget,
                    )
                })
                .collect();
            out.sort();
            out
        };
        assert_eq!(build(false), build(true));
    }

    #[test]
    fn a_richer_team_gets_more_reputation_and_more_money() {
        let mut teams = world();
        for i in 0..30 {
            teams.push(team(&format!("second-gap-{i}"), "second", 0, 0));
        }
        derive_missing_team_metadata(&mut teams, &tiers(), &HashMap::new());
        let mut pairs: Vec<(u32, i64)> = teams[20..]
            .iter()
            .map(|t| (t.reputation, t.finance))
            .collect();
        pairs.sort_unstable();
        assert!(
            pairs[0].0 > 0 && pairs[0].1 > 0,
            "gaps were not filled: {pairs:?}"
        );
        assert!(pairs.windows(2).all(|w| w[0].1 <= w[1].1), "{pairs:?}");
    }

    #[test]
    fn a_team_without_a_known_tier_or_reference_is_left_alone() {
        let mut teams = world();
        teams.push(team("lost", "unknown", 0, 0));
        let mut no_competition = team("none", "second", 0, 0);
        no_competition.competition_id = None;
        teams.push(no_competition);
        let report = derive_missing_team_metadata(&mut teams, &tiers(), &HashMap::new());
        assert!(report.is_empty());
        assert_eq!(teams[teams.len() - 1].finance, 0);
        assert_eq!(teams[teams.len() - 2].finance, 0);
    }

    fn bills(entries: &[(&str, i64)]) -> HashMap<String, i64> {
        entries
            .iter()
            .map(|(id, bill)| (id.to_string(), *bill))
            .collect()
    }

    fn money(t: &Team) -> (u32, i64, i64, i64) {
        (t.reputation, t.finance, t.wage_budget, t.transfer_budget)
    }

    #[test]
    fn a_wage_budget_below_the_committed_bill_counts_as_missing() {
        let mut teams = world();
        let mut tcl = team("second-tcl", "second", 300, 2_000_000);
        tcl.wage_budget = 20_000;
        teams.push(tcl);
        let report =
            derive_missing_team_metadata(&mut teams, &tiers(), &bills(&[("second-tcl", 90_000)]));
        let tcl = teams.last().unwrap();
        assert_eq!(tcl.reputation, 300, "the reputation stays reviewed");
        assert!(
            tcl.wage_budget >= 400_000,
            "wage budget {}",
            tcl.wage_budget
        );
        assert!(
            (1_000_000..=1_900_000).contains(&tcl.finance),
            "finance {}",
            tcl.finance
        );
        assert!(tcl.transfer_budget > 0);
        assert_eq!(report.len(), 1);
        assert_eq!(report[0].reason, DerivationReason::WageBudgetBelowWageBill);
        assert_eq!(
            report[0].fields,
            vec!["finance", "wage_budget", "transfer_budget"]
        );
    }

    #[test]
    fn a_finance_that_cannot_pay_one_season_of_the_bill_counts_as_missing() {
        let mut teams = world();
        let mut poor = team("second-poor", "second", 300, 100_000);
        poor.wage_budget = 500_000;
        teams.push(poor);
        let report =
            derive_missing_team_metadata(&mut teams, &tiers(), &bills(&[("second-poor", 105_000)]));
        assert!(teams.last().unwrap().finance >= 1_000_000);
        assert_eq!(report[0].reason, DerivationReason::FinanceBelowWageBill);
    }

    #[test]
    fn a_small_budget_that_covers_the_bill_stays_reviewed() {
        let mut teams = world();
        let mut small = team("second-small", "second", 300, 150_000);
        small.wage_budget = 120_000;
        teams.push(small);
        let before = money(teams.last().unwrap());
        let report =
            derive_missing_team_metadata(&mut teams, &tiers(), &bills(&[("second-small", 90_000)]));
        assert_eq!(money(teams.last().unwrap()), before);
        assert!(report.is_empty());
    }

    #[test]
    fn clubs_treated_as_missing_do_not_feed_the_reference() {
        let mut teams = world();
        // Absurdly rich on paper but contradicted by its own wage bill.
        for i in 0..30 {
            let mut rich = team(&format!("second-rich-{i}"), "second", 5_000, 90_000_000);
            rich.wage_budget = 10_000;
            teams.push(rich);
        }
        teams.push(team("second-gap", "second", 0, 0));
        let bill_entries: Vec<(String, i64)> = (0..30)
            .map(|i| (format!("second-rich-{i}"), 50_000))
            .collect();
        let wage_bills: HashMap<String, i64> = bill_entries.into_iter().collect();
        derive_missing_team_metadata(&mut teams, &tiers(), &wage_bills);
        let gap = teams.last().unwrap();
        assert!(
            (300..=390).contains(&gap.reputation),
            "reputation {}",
            gap.reputation
        );
        assert!(
            (1_000_000..=1_900_000).contains(&gap.finance),
            "finance {}",
            gap.finance
        );
    }

    #[test]
    fn the_committed_bill_counts_carried_wages_staff_and_the_scale_minimum_for_unpaid_players() {
        use crate::domain::player::{Player, PlayerAttributes};
        use crate::domain::staff::{Staff, StaffAttributes, StaffRole};
        use crate::domain::stats::LolRole;

        let player = |id: &str, team: Option<&str>, wage: u32| {
            let a = PlayerAttributes::from_array([60; 9]);
            let mut p = Player::new(
                id.to_string(),
                id.to_string(),
                id.to_string(),
                "2000-01-01".to_string(),
                "ES".to_string(),
                LolRole::Mid,
                a,
            );
            p.team_id = team.map(str::to_string);
            p.wage = wage;
            p.market_value = 0;
            p
        };
        let mut coach = Staff::new(
            "s".to_string(),
            "A".to_string(),
            "B".to_string(),
            "1980-01-01".to_string(),
            StaffRole::Coach,
            StaffAttributes {
                coaching: 60,
                judging_ability: 60,
                judging_potential: 60,
                physiotherapy: 60,
            },
        );
        coach.team_id = Some("t".to_string());
        coach.wage = 30_000;
        let players = [
            player("paid", Some("t"), 10_000),
            player("unpaid", Some("t"), 0),
            player("free-agent", None, 0),
        ];
        let bills = committed_wage_bills(&players, &[coach]);
        let floor = WAGE_SCALE_BASE as i64;
        assert_eq!(bills.get("t"), Some(&(10_000 + floor + 30_000)));
        assert_eq!(bills.len(), 1);
    }
}
