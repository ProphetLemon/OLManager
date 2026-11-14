//! Counters for the roster repair that follows a contract expiry (ignored measurement, used
//! by `ai_renewals_measure`).
//!
//! On a day that releases players the harness runs the expiry step itself, in the order
//! `turn::process_day` uses (cap reset, AI renewals, release, repair per club), so each
//! repair report can be read. The only difference from the app is that this step runs
//! before that day's training or match instead of after it.
//!
//! For every role slot the repair filled it records the route (renewed, a free agent,
//! a generated player). For every generated slot it then asks, against the state the repair
//! left, why no real free agent of the role was signed.

use std::collections::{BTreeMap, HashMap};

use olm_core::ai_renewals::conclude_ai_renewals;
use olm_core::contract_wage_policy::{
    ai_signing_policy, ai_transfer_cap_reset_if_new_day, annual_team_wage_bill, SigningIntent,
};
use olm_core::contracts::release_expired_contracts;
use olm_core::domain::player::Player;
use olm_core::domain::stats::LolRole;
use olm_core::game::Game;
use olm_core::player_rating::natural_ovr;
use olm_core::roster_stability::{repair_team, RepairAction, RosterStabilityReason};

#[derive(Debug, Default)]
pub(super) struct RepairCounters {
    /// Days on which at least one contract expired.
    pub(super) expiry_days: u32,
    /// Players released by an expiry, on clubs the repair looks after / skips.
    released_on_repaired_clubs: u32,
    released_on_skipped_clubs: u32,
    /// Club-days by how many players the club lost that day.
    lost_per_club_day: BTreeMap<usize, u32>,
    /// Club-days by how many role slots the repair had to fill.
    slots_per_club_day: BTreeMap<usize, u32>,
    renewed: u32,
    assigned: u32,
    generated: u32,
    /// Why a generated slot did not get a real free agent.
    refusals: BTreeMap<String, u32>,
    /// Real free agents of the slot's role on the day of each generated slot.
    free_agents_at_generated: Vec<usize>,
    /// Best natural overall among them, per generated slot that had any.
    best_free_agent_ovr: Vec<f64>,
    /// Overall of each free agent the repair signed and the best one it could have signed.
    assigned_quality: Vec<(f64, f64)>,
    /// Wage a cheapest candidate would have pushed the bill to, over the soft cap (1.0 = at it).
    wage_pressure: Vec<f64>,
    /// Generated slots per day of the year, to see whether they bunch up.
    generated_by_day: BTreeMap<String, u32>,
}

/// Free agents that could fill `role`, as the repair sees them, and how many more it skips
/// because they were released by a club or the user.
fn free_agents(game: &Game, role: LolRole) -> (Vec<&Player>, usize) {
    let today = game.clock.current_date.format("%Y-%m-%d").to_string();
    let mut usable = Vec::new();
    let mut skipped = 0;
    for player in game
        .players
        .iter()
        .filter(|p| p.team_id.is_none() && p.natural_position == role)
    {
        let contract_ok = player
            .contract_end
            .as_deref()
            .is_none_or(|end| end > today.as_str());
        if !contract_ok {
            continue;
        }
        if player.was_released {
            skipped += 1;
        } else {
            usable.push(player);
        }
    }
    (usable, skipped)
}

impl RepairCounters {
    /// Runs the expiry step of `turn::process_day` when a contract ends today.
    /// Returns whether it did, so the caller knows the day's expiries are already handled.
    pub(super) fn run_expiry_step(&mut self, game: &mut Game) -> bool {
        let today = game.clock.current_date.format("%Y-%m-%d").to_string();
        let any_expiring = game.players.iter().any(|player| {
            player.team_id.is_some()
                && player
                    .contract_end
                    .as_deref()
                    .is_some_and(|end| end <= today.as_str())
        });
        if !any_expiring {
            return false;
        }
        self.expiry_days += 1;

        ai_transfer_cap_reset_if_new_day(game);
        conclude_ai_renewals(game);
        let mut lost: HashMap<String, usize> = HashMap::new();
        let before_release: HashMap<String, Option<String>> = game
            .players
            .iter()
            .map(|p| (p.id.clone(), p.team_id.clone()))
            .collect();
        let affected = release_expired_contracts(game);
        for player in &game.players {
            if player.team_id.is_some() {
                continue;
            }
            if let Some(Some(team)) = before_release.get(&player.id) {
                *lost.entry(team.clone()).or_default() += 1;
            }
        }

        for team_id in affected {
            let count = lost.get(&team_id).copied().unwrap_or(0);
            *self.lost_per_club_day.entry(count).or_default() += 1;
            let Ok(report) = repair_team(game, &team_id, RosterStabilityReason::ContractExpired)
            else {
                self.released_on_skipped_clubs += count as u32;
                continue;
            };
            if !report.before.schedulable {
                self.released_on_skipped_clubs += count as u32;
                continue;
            }
            self.released_on_repaired_clubs += count as u32;
            *self
                .slots_per_club_day
                .entry(report.before.missing_roles.len())
                .or_default() += 1;
            for action in &report.actions {
                match action {
                    RepairAction::RenewedContract { .. } => self.renewed += 1,
                    RepairAction::AssignedFreeAgent { player_id, role } => {
                        self.assigned += 1;
                        self.record_assigned(game, player_id, *role);
                    }
                    RepairAction::GeneratedReplacement { role, .. } => {
                        self.generated += 1;
                        *self.generated_by_day.entry(today.clone()).or_default() += 1;
                        self.diagnose_generated(game, &team_id, *role);
                    }
                    RepairAction::ReconciledLineup { .. } => {}
                }
            }
        }
        true
    }

    fn record_assigned(&mut self, game: &Game, player_id: &str, role: LolRole) {
        let Some(signed) = game.players.iter().find(|p| p.id == player_id) else {
            return;
        };
        let signed_ovr = natural_ovr(signed);
        let (rest, _) = free_agents(game, role);
        let best = rest
            .iter()
            .map(|p| natural_ovr(p))
            .fold(signed_ovr, f64::max);
        self.assigned_quality.push((signed_ovr, best));
    }

    /// Why was no real free agent of `role` signed for `team_id`? Judged against the state
    /// the repair left (the signings it made are in the wage bill and the cap count).
    fn diagnose_generated(&mut self, game: &Game, team_id: &str, role: LolRole) {
        let (candidates, skipped) = free_agents(game, role);
        self.free_agents_at_generated.push(candidates.len());
        if let Some(best) = candidates.iter().map(|p| natural_ovr(p)).reduce(f64::max) {
            self.best_free_agent_ovr.push(best);
        }
        let reason = if candidates.is_empty() {
            if skipped > 0 {
                format!("no usable free agent of the role ({skipped} were_released skipped)")
            } else {
                "no free agent of the role".to_string()
            }
        } else {
            let team = game
                .teams
                .iter()
                .find(|t| t.id == team_id)
                .expect("repaired team exists");
            let decisions: Vec<_> = candidates
                .iter()
                .map(|p| {
                    (
                        *p,
                        ai_signing_policy(game, team, p, SigningIntent::Emergency),
                    )
                })
                .collect();
            if decisions.iter().any(|(_, d)| d.accepted) {
                let used = game
                    .ai_transfer_cap_counts
                    .get(team_id)
                    .map_or(0, |state| state.emergency_count);
                if used >= 1 {
                    "daily emergency cap (a policy-accepted free agent existed)".to_string()
                } else {
                    "other: policy accepted and the cap was free".to_string()
                }
            } else {
                let mut reasons: BTreeMap<String, u32> = BTreeMap::new();
                for (_, decision) in &decisions {
                    *reasons.entry(format!("{:?}", decision.reason)).or_default() += 1;
                }
                if let Some(cheapest) = decisions.iter().map(|(_, d)| d.annual_wage).min() {
                    let soft_cap = team.wage_budget as f64 * 1.10;
                    let bill = annual_team_wage_bill(game, team_id) as f64;
                    if soft_cap > 0.0 {
                        self.wage_pressure
                            .push((bill + f64::from(cheapest)) / soft_cap);
                    }
                }
                format!("signing policy refused all: {reasons:?}")
            }
        };
        *self.refusals.entry(reason).or_default() += 1;
    }

    pub(super) fn print(&self) {
        let quantiles = |values: &mut Vec<f64>| {
            values.sort_by(f64::total_cmp);
            let at = |p: usize| {
                values
                    .get(values.len().saturating_sub(1) * p / 100)
                    .copied()
            };
            (at(0), at(50), at(100))
        };
        println!("repair at contract expiry (harness runs the expiry step, see module docs):");
        println!(
            "  days with expiries {} | players released on clubs the repair looks after {} | on clubs it skips (outside a main league, or a user club) {}",
            self.expiry_days, self.released_on_repaired_clubs, self.released_on_skipped_clubs
        );
        println!(
            "  club-days by players lost (count: club-days) {:?}",
            self.lost_per_club_day
        );
        println!(
            "  repaired club-days by role slots to fill {:?}",
            self.slots_per_club_day
        );
        println!(
            "  routes per role slot: RenewedContract {} | AssignedFreeAgent {} | GeneratedReplacement {}",
            self.renewed, self.assigned, self.generated
        );
        println!("  generated slots, what refused a real free agent:");
        for (reason, count) in &self.refusals {
            println!("    {count:5}  {reason}");
        }
        let mut counts: Vec<f64> = self
            .free_agents_at_generated
            .iter()
            .map(|n| *n as f64)
            .collect();
        let (lo, mid, hi) = quantiles(&mut counts);
        println!(
            "  real free agents of the role at a generated slot: min {lo:?} | median {mid:?} | max {hi:?}"
        );
        let mut best = self.best_free_agent_ovr.clone();
        let (lo, mid, hi) = quantiles(&mut best);
        println!(
            "  best natural ovr among them (slots that had any): min {lo:?} | median {mid:?} | max {hi:?}"
        );
        let mut pressure = self.wage_pressure.clone();
        let (lo, mid, hi) = quantiles(&mut pressure);
        println!(
            "  wage refusals: (bill + cheapest candidate) / soft cap: min {lo:?} | median {mid:?} | max {hi:?} ({} slots)",
            pressure.len()
        );
        let mean = |f: fn(&(f64, f64)) -> f64| {
            self.assigned_quality.iter().map(f).sum::<f64>()
                / self.assigned_quality.len().max(1) as f64
        };
        println!(
            "  signed free agents: mean ovr {:.1} vs best available {:.1} ({} signings)",
            mean(|q| q.0),
            mean(|q| q.1),
            self.assigned_quality.len()
        );
        let mut busiest: Vec<_> = self.generated_by_day.iter().collect();
        busiest.sort_by(|a, b| b.1.cmp(a.1).then(a.0.cmp(b.0)));
        println!(
            "  generated slots by day, busiest five {:?}",
            &busiest[..busiest.len().min(5)]
        );
    }
}

/// Generated players by the repair reason their id carries, over the whole world: every
/// path that fills an AI starting role (expiry, transfer out, season transition, the
/// daily background repair, new-game fill).
pub(super) fn generated_by_reason(game: &Game) -> BTreeMap<String, u32> {
    const REASONS: [&str; 8] = [
        "contract-expired",
        "transfer-out",
        "release",
        "season-transition",
        "prematch",
        "background-simulation",
        "load-migration",
        "emergency",
    ];
    let mut by_reason = BTreeMap::new();
    for player in game
        .players
        .iter()
        .filter(|p| p.id.starts_with("emergency-"))
    {
        let reason = REASONS
            .iter()
            .find(|reason| player.id.contains(&format!("-{reason}-")))
            .copied()
            .unwrap_or("unknown");
        *by_reason.entry(reason.to_string()).or_default() += 1;
    }
    by_reason
}
