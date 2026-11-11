//! Where each champion's gold came from.
//!
//! The ledger is written at the gold grant sites and never read by the
//! simulation: it adds no random draw and no branch, so a match plays out
//! identically with or without it. It is not serialized with the runtime state
//! (it exists to measure the economy, see `economy_harness_tests.rs`).

use std::collections::HashMap;

/// What paid a grant of gold.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum GoldSource {
    LaneMinion,
    JungleCamp,
    /// Champion kills, including ignite and last-damage credit kills.
    Kill,
    Assist,
    /// Turret gold, shared by the whole team.
    Tower,
    Dragon,
    Herald,
    Voidgrub,
    Elder,
    /// Baron gold, shared by the living team.
    Baron,
    OtherObjective,
}

impl GoldSource {
    pub(super) const COUNT: usize = 11;

    #[cfg(test)]
    pub(super) const ALL: [GoldSource; GoldSource::COUNT] = [
        GoldSource::LaneMinion,
        GoldSource::JungleCamp,
        GoldSource::Kill,
        GoldSource::Assist,
        GoldSource::Tower,
        GoldSource::Dragon,
        GoldSource::Herald,
        GoldSource::Voidgrub,
        GoldSource::Elder,
        GoldSource::Baron,
        GoldSource::OtherObjective,
    ];

    pub(super) const fn index(self) -> usize {
        self as usize
    }

    #[cfg(test)]
    pub(super) const fn label(self) -> &'static str {
        match self {
            GoldSource::LaneMinion => "minion",
            GoldSource::JungleCamp => "camp",
            GoldSource::Kill => "kill",
            GoldSource::Assist => "assist",
            GoldSource::Tower => "tower",
            GoldSource::Dragon => "dragon",
            GoldSource::Herald => "herald",
            GoldSource::Voidgrub => "grubs",
            GoldSource::Elder => "elder",
            GoldSource::Baron => "baron",
            GoldSource::OtherObjective => "other",
        }
    }
}

/// Gold and number of grants per source for one champion.
#[derive(Debug, Clone, Copy, Default)]
pub(super) struct SourceTally {
    pub(super) gold: [i64; GoldSource::COUNT],
    pub(super) grants: [i64; GoldSource::COUNT],
}

impl SourceTally {
    #[cfg(test)]
    pub(super) fn total(&self) -> i64 {
        self.gold.iter().sum()
    }
}

#[derive(Debug, Clone, Default)]
pub(super) struct GoldLedger {
    by_champion: HashMap<String, SourceTally>,
}

impl GoldLedger {
    /// Records `gold` actually added to a champion's purse (after any role weight).
    pub(super) fn record(&mut self, champion_id: &str, source: GoldSource, gold: i64) {
        if gold <= 0 {
            return;
        }
        let index = source.index();
        if let Some(tally) = self.by_champion.get_mut(champion_id) {
            tally.gold[index] += gold;
            tally.grants[index] += 1;
        } else {
            let mut tally = SourceTally::default();
            tally.gold[index] = gold;
            tally.grants[index] = 1;
            self.by_champion.insert(champion_id.to_string(), tally);
        }
    }

    #[cfg(test)]
    pub(super) fn tally(&self, champion_id: &str) -> SourceTally {
        self.by_champion
            .get(champion_id)
            .copied()
            .unwrap_or_default()
    }
}
