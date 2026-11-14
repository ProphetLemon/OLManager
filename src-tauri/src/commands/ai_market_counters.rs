//! Counters for the AI free-agency market (ignored measurement, used by
//! `ai_renewals_measure`).
//!
//! Two things are read without touching the game code:
//!
//! * every market signing (a free agent a club signs during `turn::process_day`) is split by
//!   whether the buying club held a generated starter in that player's role the morning of
//!   the signing ("replaced a generated starter") or not ("other");
//! * the signing policy the market applies is sampled on a few days: for every AI main-league
//!   club and role with free agents, what `ai_signing_policy` answers for the best free agent
//!   of the role and whether it accepts any of them. The market's own refusals happen inside
//!   the game code and cannot be read from outside, so this is a probe of the same gate, not
//!   a count of the refusals themselves.

use std::collections::{BTreeMap, HashSet};

use olm_core::contract_wage_policy::{
    ai_signing_policy_for_bill, annual_team_wage_bill, SigningIntent,
};
use olm_core::domain::player::Player;
use olm_core::domain::stats::LolRole;
use olm_core::domain::team::TeamKind;
use olm_core::game::Game;
use olm_core::player_rating::natural_ovr;

const ROLES: [LolRole; 5] = [
    LolRole::Top,
    LolRole::Jungle,
    LolRole::Mid,
    LolRole::Adc,
    LolRole::Support,
];

/// Days between two samples of the policy gate.
const SAMPLE_EVERY_DAYS: u32 = 14;

/// (club, role) pairs whose best player of the role, by `natural_ovr`, is a generated one.
pub(super) fn generated_starter_slots(game: &Game) -> HashSet<(String, LolRole)> {
    let mut best: std::collections::HashMap<(&str, LolRole), &Player> = Default::default();
    for player in game.players.iter().filter(|p| p.team_id.is_some()) {
        let key = (
            player.team_id.as_deref().unwrap_or_default(),
            player.natural_position,
        );
        let entry = best.entry(key).or_insert(player);
        if natural_ovr(player) > natural_ovr(entry) {
            *entry = player;
        }
    }
    best.into_iter()
        .filter(|(_, player)| player.id.starts_with("emergency-"))
        .map(|((team, role), _)| (team.to_string(), role))
        .collect()
}

#[derive(Debug, Default)]
pub(super) struct MarketCounters {
    pub(super) signed_replaced_generated: u32,
    pub(super) signed_other: u32,
    days_seen: u32,
    sampled_days: u32,
    /// (club, role) pairs with free agents of the role, on sampled days.
    pairs: u32,
    /// Pairs where the policy accepts at least one of them.
    pairs_any_accepted: u32,
    /// The policy's answer for the best free agent of the role, per pair.
    best_free_agent: BTreeMap<String, u32>,
}

impl MarketCounters {
    /// Classifies one market signing of `player` by the club that bought him.
    pub(super) fn record_signing(
        &mut self,
        generated_slots: &HashSet<(String, LolRole)>,
        team_id: &str,
        player: Option<&Player>,
    ) {
        let replaced = player
            .is_some_and(|p| generated_slots.contains(&(team_id.to_string(), p.natural_position)));
        if replaced {
            self.signed_replaced_generated += 1;
        } else {
            self.signed_other += 1;
        }
    }

    /// Called once per simulated day, before `process_day`.
    pub(super) fn maybe_sample(&mut self, game: &Game) {
        self.days_seen += 1;
        if !(self.days_seen - 1).is_multiple_of(SAMPLE_EVERY_DAYS) {
            return;
        }
        self.sampled_days += 1;
        let user = game.manager.team_id.as_deref();
        let in_main_league: HashSet<&str> = game
            .leagues
            .iter()
            .filter(|l| l.league_kind == olm_core::domain::league::LeagueKind::Main)
            .flat_map(|l| l.standings.iter().map(|e| e.team_id.as_str()))
            .collect();
        let mut free_by_role: Vec<Vec<&Player>> = Vec::new();
        for role in ROLES {
            let mut agents: Vec<&Player> = game
                .players
                .iter()
                .filter(|p| p.team_id.is_none() && !p.was_released && p.natural_position == role)
                .collect();
            agents.sort_by(|a, b| {
                natural_ovr(b)
                    .total_cmp(&natural_ovr(a))
                    .then(a.id.cmp(&b.id))
            });
            free_by_role.push(agents);
        }
        for team in game.teams.iter().filter(|t| {
            t.team_kind == TeamKind::Main
                && t.manager_id.is_none()
                && user != Some(t.id.as_str())
                && in_main_league.contains(t.id.as_str())
        }) {
            let bill = annual_team_wage_bill(game, &team.id);
            for agents in free_by_role.iter().filter(|agents| !agents.is_empty()) {
                self.pairs += 1;
                let decide = |p: &Player| {
                    ai_signing_policy_for_bill(game, team, p, SigningIntent::Strategic, bill)
                };
                let best = decide(agents[0]);
                let label = if best.accepted {
                    "accepted".to_string()
                } else {
                    format!("{:?}", best.reason)
                };
                *self.best_free_agent.entry(label).or_default() += 1;
                if best.accepted || agents.iter().skip(1).any(|p| decide(p).accepted) {
                    self.pairs_any_accepted += 1;
                }
            }
        }
    }

    pub(super) fn print(&self) {
        println!(
            "market free-agency signings: replaced a generated starter {} | other {}",
            self.signed_replaced_generated, self.signed_other
        );
        println!(
            "policy gate probe (Strategic intent, every {SAMPLE_EVERY_DAYS} days, {} sampled days): club-role pairs with free agents {} | policy accepts at least one {} | answer for the best free agent of the role {:?}",
            self.sampled_days, self.pairs, self.pairs_any_accepted, self.best_free_agent
        );
    }
}
