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
//! Each team picks one point of the reviewed range, derived from its id, between the
//! 25th and the 75th percentile, and takes that point of every field. Teams of one
//! tier therefore differ from each other, a bigger reputation comes with more money,
//! and the result is stable across runs.

use std::collections::HashMap;

use crate::domain::team::Team;
use crate::stable_hash::stable_hash;

/// What was derived for one team.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DerivedTeamMetadata {
    pub team_id: String,
    /// Names of the fields that were missing or zero and got a derived value.
    pub fields: Vec<&'static str>,
}

/// Fill the zero reputation, finance, wage budget and transfer budget of `teams`
/// from the reviewed values of the teams of the same tier. `tiers` maps a
/// competition id to its tier; a team whose competition has no tier, or whose tier
/// has no reviewed value for a field, keeps that field as it is.
pub fn derive_missing_team_metadata(
    teams: &mut [Team],
    tiers: &HashMap<String, u8>,
) -> Vec<DerivedTeamMetadata> {
    let tier_of = |team: &Team| {
        team.competition_id
            .as_deref()
            .and_then(|competition| tiers.get(competition).copied())
    };

    // The reference is read before anything is written, so a derived value never
    // feeds another team's default.
    let mut references: HashMap<u8, Reference> = HashMap::new();
    for team in teams.iter() {
        if let Some(tier) = tier_of(team) {
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
            if *slot == 0
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
        let report = derive_missing_team_metadata(&mut teams, &tiers());
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
        derive_missing_team_metadata(&mut teams, &tiers());
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
        let report = derive_missing_team_metadata(&mut teams, &tiers());
        assert_eq!(snapshot(&teams), before);
        assert!(report.is_empty());
    }

    #[test]
    fn only_the_zero_field_of_a_partly_reviewed_team_is_derived() {
        let mut teams = world();
        let mut partial = team("second-partial", "second", 345, 0);
        partial.wage_budget = 777_000;
        teams.push(partial);
        let report = derive_missing_team_metadata(&mut teams, &tiers());
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
        derive_missing_team_metadata(&mut teams, &tiers());
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
            derive_missing_team_metadata(&mut teams, &tiers());
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
        derive_missing_team_metadata(&mut teams, &tiers());
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
        let report = derive_missing_team_metadata(&mut teams, &tiers());
        assert!(report.is_empty());
        assert_eq!(teams[teams.len() - 1].finance, 0);
        assert_eq!(teams[teams.len() - 2].finance, 0);
    }
}
