//! What each tower shot hit during the current tick, and how many aggro locks
//! it received.
//!
//! Like the gold and farm ledgers it is written where the tower acts and never
//! read by the simulation: no random draw, no branch, not serialized. The shot
//! list holds one tick only (`begin_tick` clears it), so it stays small in a
//! live match that never drains it; the tower measurements in
//! `tower_harness_tests.rs` read it after every tick.

/// What a tower shot hit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum TowerVictim {
    /// Index of the champion in `RuntimeState::champions`.
    Champion(usize),
    Minion,
}

/// One tower shot.
// The fields are read by the measurement harness, which only exists in test builds.
#[cfg_attr(not(test), allow(dead_code))]
#[derive(Debug, Clone, Copy)]
pub(super) struct TowerShot {
    /// Index of the tower in `RuntimeState::structures`.
    pub(super) structure_idx: usize,
    pub(super) victim: TowerVictim,
    pub(super) damage: f64,
    /// The victim's health before the shot.
    pub(super) hp_before: f64,
    pub(super) killed: bool,
}

#[derive(Debug, Clone, Default)]
pub(super) struct TowerLedger {
    shots: Vec<TowerShot>,
    locks: u32,
    unusable_locks: u32,
}

impl TowerLedger {
    /// Forgets the shots of the previous tick.
    pub(super) fn begin_tick(&mut self) {
        self.shots.clear();
    }

    pub(super) fn record_shot(&mut self, shot: TowerShot) {
        self.shots.push(shot);
    }

    /// Records a tower lock on a champion; `usable` is whether the champion
    /// stood inside the tower's attack range when the lock was set.
    pub(super) fn record_lock(&mut self, usable: bool) {
        self.locks += 1;
        if !usable {
            self.unusable_locks += 1;
        }
    }

    #[cfg(test)]
    pub(super) fn shots(&self) -> &[TowerShot] {
        &self.shots
    }

    /// Locks set so far and how many of them the tower could not use.
    #[cfg(test)]
    pub(super) fn lock_counts(&self) -> (u32, u32) {
        (self.locks, self.unusable_locks)
    }
}
