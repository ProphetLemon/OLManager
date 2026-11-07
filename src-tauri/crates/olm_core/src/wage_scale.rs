//! The wage scale the whole game shares, fitted to the authored LEC wages.
//!
//! Fit: ordinary least squares over the 40 authored non-zero wages of rostered
//! LEC players (market value 70k-240k, wage 60k-356k) gives
//! `wage = 24_922 + 1.193 * market_value` (R^2 0.35; the same data against OVR
//! gives R^2 0.45, but market value tracks OVR at R^2 0.83 and is the input
//! every other economy rule already uses). The intercept is rounded to the
//! 25k minimum wage, the slope to 1.19. A 370k star lands at about 465k, a
//! 1.26x ratio; a 100k player at about 144k, in line with the authored 115k-146k.
//!
//! Non-LEC leagues ship either no wage (1577 of 3235 rostered players) or a
//! machine-derived 7% of market value, so only the LEC rows are authoritative.

use crate::domain::player::Player;
use crate::domain::staff::Staff;
use crate::domain::team::Team;
use std::collections::HashMap;

/// Minimum yearly wage of the scale (the intercept of the fit).
pub const WAGE_SCALE_BASE: u64 = 25_000;
/// Slope of the fit, in percent of market value.
pub const WAGE_SCALE_MARKET_VALUE_PERCENT: u64 = 119;
/// Lowest wage a seeded player keeps when his club budget forces a scale-down.
pub const MIN_SEEDED_WAGE: u32 = 1_000;

/// Yearly wage the LEC scale gives a player of `market_value`, rounded up to 1k.
pub fn scale_wage_for_market_value(market_value: u64) -> u32 {
    let raw = WAGE_SCALE_BASE
        .saturating_add(market_value.saturating_mul(WAGE_SCALE_MARKET_VALUE_PERCENT) / 100);
    let rounded = raw.div_ceil(1_000).saturating_mul(1_000);
    rounded.min(u64::from(u32::MAX)) as u32
}

/// What seeding did to one team.
#[derive(Debug, Clone, PartialEq)]
pub struct TeamWageSeed {
    pub team_id: String,
    pub seeded_players: usize,
    /// Yearly bill of staff plus authored (non-seeded) player wages.
    pub authored_bill: i64,
    /// Sum of the seeded wages on the scale, before any scale-down.
    pub seeded_unscaled: i64,
    pub wage_budget: i64,
    /// Proportional factor applied to the seeded wages, when the team did not fit.
    pub scale_factor: Option<f64>,
}

impl TeamWageSeed {
    /// Bill that the scale alone would have produced.
    pub fn bill_before_scaling(&self) -> i64 {
        self.authored_bill + self.seeded_unscaled
    }

    /// True when a budgeted team exceeds its budget before scaling.
    pub fn over_budget_before(&self) -> bool {
        self.wage_budget > 0 && self.bill_before_scaling() > self.wage_budget
    }
}

/// Give every rostered player with wage 0 a wage from the scale. Authored wages
/// are untouched. A team with a wage budget whose bill would exceed it has only
/// its seeded wages scaled down proportionally (never below `MIN_SEEDED_WAGE`).
/// Teams without a budget (0) have no constraint to honour and keep the scale.
pub fn seed_missing_wages(
    players: &mut [Player],
    teams: &[Team],
    staff: &[Staff],
) -> Vec<TeamWageSeed> {
    let mut authored: HashMap<String, i64> = HashMap::new();
    for member in staff {
        if let Some(team_id) = member.team_id.as_deref() {
            *authored.entry(team_id.to_string()).or_default() += i64::from(member.wage);
        }
    }
    for player in players.iter().filter(|p| p.wage > 0) {
        if let Some(team_id) = player.team_id.as_deref() {
            *authored.entry(team_id.to_string()).or_default() += i64::from(player.wage);
        }
    }

    let mut seeded: HashMap<String, Vec<(usize, u32)>> = HashMap::new();
    for (index, player) in players.iter().enumerate() {
        if player.wage == 0
            && let Some(team_id) = player.team_id.as_deref()
        {
            seeded
                .entry(team_id.to_string())
                .or_default()
                .push((index, scale_wage_for_market_value(player.market_value)));
        }
    }

    let mut reports = Vec::new();
    for team in teams {
        let Some(entries) = seeded.get(team.id.as_str()) else {
            continue;
        };
        let authored_bill = authored.get(team.id.as_str()).copied().unwrap_or(0);
        let seeded_unscaled: i64 = entries.iter().map(|(_, wage)| i64::from(*wage)).sum();
        let available = team.wage_budget - authored_bill;
        let scale_factor = (team.wage_budget > 0 && seeded_unscaled > available)
            .then(|| available.max(0) as f64 / seeded_unscaled as f64);

        for (index, wage) in entries {
            players[*index].wage = match scale_factor {
                Some(factor) => {
                    let scaled = (f64::from(*wage) * factor / 100.0).floor() as u32 * 100;
                    scaled.max(MIN_SEEDED_WAGE)
                }
                None => *wage,
            };
        }
        reports.push(TeamWageSeed {
            team_id: team.id.clone(),
            seeded_players: entries.len(),
            authored_bill,
            seeded_unscaled,
            wage_budget: team.wage_budget,
            scale_factor,
        });
    }
    reports
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scale_gives_a_star_about_one_and_a_quarter_times_market_value() {
        assert_eq!(scale_wage_for_market_value(370_000), 466_000);
    }

    #[test]
    fn scale_keeps_the_minimum_for_zero_value() {
        assert_eq!(scale_wage_for_market_value(0), 25_000);
    }

    fn rostered(id: &str, team_id: &str, wage: u32, market_value: u64) -> Player {
        let mut player = Player::new(
            id.to_string(),
            id.to_string(),
            id.to_string(),
            "2000-01-01".to_string(),
            "KR".to_string(),
            crate::domain::stats::LolRole::Mid,
            crate::domain::player::PlayerAttributes {
                mechanics: 60,
                laning: 60,
                teamfighting: 60,
                macro_play: 60,
                consistency: 60,
                shotcalling: 60,
                champion_pool: 60,
                discipline: 60,
                mental_resilience: 60,
            },
        );
        player.team_id = Some(team_id.to_string());
        player.wage = wage;
        player.market_value = market_value;
        player
    }

    fn club(wage_budget: i64) -> Team {
        let mut team = Team::new(
            "club".to_string(),
            "Club".to_string(),
            "CLB".to_string(),
            "KR".to_string(),
            "Seoul".to_string(),
            "Arena".to_string(),
            10_000,
        );
        team.wage_budget = wage_budget;
        team
    }

    #[test]
    fn seeding_leaves_authored_wages_alone() {
        let mut players = vec![rostered("authored", "club", 60_000, 400_000)];

        seed_missing_wages(&mut players, &[club(100_000)], &[]);

        assert_eq!(players[0].wage, 60_000);
    }

    #[test]
    fn seeding_uses_the_scale_when_the_team_fits() {
        let mut players = vec![rostered("star", "club", 0, 370_000)];

        seed_missing_wages(&mut players, &[club(1_000_000)], &[]);

        assert_eq!(players[0].wage, 466_000);
    }

    #[test]
    fn seeding_scales_only_seeded_wages_down_to_the_budget() {
        let mut players = vec![
            rostered("authored", "club", 100_000, 400_000),
            rostered("a", "club", 0, 370_000),
            rostered("b", "club", 0, 370_000),
        ];

        let reports = seed_missing_wages(&mut players, &[club(500_000)], &[]);

        let bill: u32 = players.iter().map(|p| p.wage).sum();
        assert_eq!(players[0].wage, 100_000);
        assert!(bill <= 500_000, "bill {bill}");
        assert!(reports[0].scale_factor.is_some());
    }

    #[test]
    fn seeding_ignores_the_budget_of_a_team_without_one() {
        let mut players = vec![rostered("star", "club", 0, 370_000)];

        let reports = seed_missing_wages(&mut players, &[club(0)], &[]);

        assert_eq!(players[0].wage, 466_000);
        assert_eq!(reports[0].scale_factor, None);
    }
}
