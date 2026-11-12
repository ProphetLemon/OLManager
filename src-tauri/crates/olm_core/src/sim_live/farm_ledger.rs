//! How each lane minion died and who had hit it last.
//!
//! Like the gold ledger, it is written where minions die and never read by
//! the simulation: no random draw, no branch, not serialized. It exists so the
//! farming measurements can tell a champion last hit from a kill by an allied
//! minion or by a tower (see `farm_harness_tests.rs`).

use std::collections::HashMap;

use super::{dist, lane_path_blue, Vec2};

/// What dealt the damage that killed a lane minion.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(super) enum MinionKiller {
    /// A champion's attack; the minion pays gold and creep score to that champion.
    Champion,
    /// A turret shot; the minion pays gold to whoever hit it last, if anyone.
    Tower,
    /// Another minion; nobody is paid.
    Minion,
}

/// What took health from a champion.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(super) enum DamageSource {
    Champion,
    Minion,
    Tower,
    /// Summoner spells and anything else.
    Other,
}

/// One kind of minion death: whose minion, in which lane, killed by what, and
/// which champion had hit it last (the champion who is paid, for a champion kill).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(super) struct DeathKey {
    pub(super) minion_is_blue: bool,
    pub(super) lane: &'static str,
    pub(super) killer: MinionKiller,
    pub(super) last_hit_by: Option<String>,
}

/// Arc fraction of `pos` along `path` (projection on the nearest segment).
pub(super) fn arc_fraction(pos: Vec2, path: &[Vec2]) -> f64 {
    let lengths: Vec<f64> = path.windows(2).map(|w| dist(w[0], w[1])).collect();
    let total: f64 = lengths.iter().sum();
    let mut walked = 0.0;
    let mut best = (f64::MAX, 0.0);
    for (w, len) in path.windows(2).zip(&lengths) {
        let (dx, dy) = (w[1].x - w[0].x, w[1].y - w[0].y);
        let t = (((pos.x - w[0].x) * dx + (pos.y - w[0].y) * dy) / (dx * dx + dy * dy)).clamp(0.0, 1.0);
        let proj = Vec2 { x: w[0].x + t * dx, y: w[0].y + t * dy };
        let d = dist(pos, proj);
        if d < best.0 {
            best = (d, (walked + t * len) / total);
        }
        walked += len;
    }
    best.1
}

/// Deaths of one kind and the sum of where they happened (arc fraction along
/// the blue lane path, 0 at the blue base and 1 at the red base).
#[derive(Debug, Clone, Copy, Default)]
pub(super) struct DeathTally {
    pub(super) count: u32,
    pub(super) arc_sum: f64,
}

#[derive(Debug, Clone, Default)]
pub(super) struct FarmLedger {
    deaths: HashMap<DeathKey, DeathTally>,
    /// Health taken from each champion, by what dealt it (nominal damage, not
    /// clipped to the health left).
    damage: HashMap<(String, DamageSource), f64>,
    /// Health taken from each champion by another champion, by the attacker's role.
    damage_by_attacker_role: HashMap<(String, String), f64>,
}

impl FarmLedger {
    pub(super) fn record_death(
        &mut self,
        minion_is_blue: bool,
        lane: &'static str,
        killer: MinionKiller,
        last_hit_by: Option<&String>,
        pos: Vec2,
    ) {
        let key = DeathKey {
            minion_is_blue,
            lane,
            killer,
            last_hit_by: last_hit_by.cloned(),
        };
        let tally = self.deaths.entry(key).or_default();
        tally.count += 1;
        tally.arc_sum += arc_fraction(pos, lane_path_blue(lane));
    }

    pub(super) fn record_damage(&mut self, champion_id: &str, source: DamageSource, amount: f64) {
        *self
            .damage
            .entry((champion_id.to_string(), source))
            .or_default() += amount;
    }

    pub(super) fn record_champion_hit(&mut self, defender_id: &str, attacker_role: &str, amount: f64) {
        *self
            .damage_by_attacker_role
            .entry((defender_id.to_string(), attacker_role.to_string()))
            .or_default() += amount;
    }

    #[cfg(test)]
    pub(super) fn damage_by_attacker_role(&self) -> &HashMap<(String, String), f64> {
        &self.damage_by_attacker_role
    }

    #[cfg(test)]
    pub(super) fn damage(&self) -> &HashMap<(String, DamageSource), f64> {
        &self.damage
    }

    #[cfg(test)]
    pub(super) fn deaths(&self) -> &HashMap<DeathKey, DeathTally> {
        &self.deaths
    }
}
