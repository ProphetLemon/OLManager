//! SoloQ inactivity decay: a player who stops grinding loses LP, and a few days of
//! play bring it back.
//!
//! The LP formula in the parent module stays a pure function of the day. Decay is a
//! per-player offset subtracted from it after the clamp: a grace bank absorbs the first
//! idle days, then each idle day adds to the offset, and each played day removes some.
//! With the mode `Off` the offset is never read, so every LP value is the one the formula
//! alone gives.

use super::*;

/// How strongly inactivity costs LP. Chosen per save; new games start on `Real` and saves
/// from before the setting load as `Off`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS))]
#[cfg_attr(feature = "typescript", ts(export))]
pub enum SoloQDecayMode {
    #[default]
    Off,
    Soft,
    Real,
    Harsh,
}

/// The three numbers a decay mode stands for. All are zero for `Off`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS))]
#[cfg_attr(feature = "typescript", ts(export))]
pub struct SoloQDecayPreset {
    pub mode: SoloQDecayMode,
    /// LP added to the offset on each idle day once the bank is empty.
    pub decay_per_idle_day: u32,
    /// Idle days the grace bank absorbs before decay starts (and its full size).
    pub bank_days: u32,
    /// LP removed from the offset on each played day.
    pub recovery_per_played_day: u32,
}

impl SoloQDecayMode {
    /// Every mode, in the order the settings screen lists them.
    pub const ALL: [SoloQDecayMode; 4] = [Self::Off, Self::Soft, Self::Real, Self::Harsh];

    pub fn preset(self) -> SoloQDecayPreset {
        let (decay_per_idle_day, bank_days, recovery_per_played_day) = match self {
            Self::Off => (0, 0, 0),
            Self::Soft => (25, 21, 50),
            Self::Real => (50, 14, 100),
            Self::Harsh => (75, 7, 150),
        };
        SoloQDecayPreset {
            mode: self,
            decay_per_idle_day,
            bank_days,
            recovery_per_played_day,
        }
    }

    /// The preset, or `None` while decay is off.
    fn active(self) -> Option<SoloQDecayPreset> {
        (self != Self::Off).then(|| self.preset())
    }
}

/// How a day counted for one player's decay.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS))]
#[cfg_attr(feature = "typescript", ts(export))]
pub enum SoloQDayKind {
    /// A training day on a non-recovery plan: bank +1, offset down.
    Played,
    /// Off the ladder with a bank day left to spend.
    Idle,
    /// Off the ladder with the bank empty: the offset grew.
    Decay,
    /// A match day: neutral.
    Match,
    /// An ordinary rest day of a player on a team: neutral.
    Rest,
}

/// Per-day state the training pass hands to the daily SoloQ step. Never saved: it lives
/// from the training pass to the step of the same day.
#[derive(Debug, Clone, Default)]
pub struct SoloQDayMarks {
    training_ran: bool,
    match_day: bool,
    /// Players on a team plan and what the plan made of their day (`Played`, `Idle`, `Rest`).
    players: HashMap<String, SoloQDayKind>,
}

impl SoloQDayMarks {
    /// The training pass of the day starts.
    pub fn begin_training(&mut self) {
        self.players.clear();
        self.training_ran = true;
        self.match_day = false;
    }

    /// The training pass settled this player's day.
    pub fn mark_training(&mut self, player_id: &str, kind: SoloQDayKind) {
        self.players.insert(player_id.to_string(), kind);
    }

    /// The day is a match day for the user's league: no training pass runs.
    pub fn begin_match_day(&mut self) {
        self.players.clear();
        self.training_ran = false;
        self.match_day = true;
    }

    fn reset(&mut self) {
        self.players.clear();
        self.training_ran = false;
        self.match_day = false;
    }

    /// What the day was for this player before the bank is looked at.
    fn kind_for(&self, player_id: &str) -> SoloQDayKind {
        if self.match_day {
            SoloQDayKind::Match
        } else if self.training_ran {
            // Not on any team plan (a free agent): off the ladder.
            match self.players.get(player_id) {
                Some(SoloQDayKind::Played) => SoloQDayKind::Played,
                Some(SoloQDayKind::Rest) => SoloQDayKind::Rest,
                _ => SoloQDayKind::Idle,
            }
        } else {
            // No training pass and no match day was reported: change nothing.
            SoloQDayKind::Rest
        }
    }
}

/// Displayed LP: the formula LP minus the offset, never below Master 0 LP.
fn apply_offset(formula_lp: f64, offset: f64) -> f64 {
    if offset > 0.0 {
        (formula_lp - offset).max(0.0)
    } else {
        formula_lp
    }
}

/// The offset in force for a player under `mode`.
pub(super) fn offset_for(mode: SoloQDecayMode, player: &crate::domain::player::Player) -> f64 {
    if mode == SoloQDecayMode::Off {
        0.0
    } else {
        player.soloq_decay_offset
    }
}

pub(super) fn displayed_lp(
    mode: SoloQDecayMode,
    player: &crate::domain::player::Player,
    formula_lp: f64,
) -> f64 {
    apply_offset(formula_lp, offset_for(mode, player))
}

/// Settles one player's day against the bank and offset, and says how it counted.
pub(super) fn settle_day(
    player: &mut crate::domain::player::Player,
    raw: SoloQDayKind,
    formula_lp: f64,
    preset: &SoloQDecayPreset,
) -> SoloQDayKind {
    let bank_max = u8::try_from(preset.bank_days).unwrap_or(u8::MAX);
    player.soloq_bank_spent = player.soloq_bank_spent.min(bank_max);
    match raw {
        SoloQDayKind::Played => {
            player.soloq_bank_spent = player.soloq_bank_spent.saturating_sub(1);
            player.soloq_decay_offset =
                (player.soloq_decay_offset - f64::from(preset.recovery_per_played_day)).max(0.0);
            SoloQDayKind::Played
        }
        SoloQDayKind::Idle if player.soloq_bank_spent < bank_max => {
            player.soloq_bank_spent += 1;
            SoloQDayKind::Idle
        }
        SoloQDayKind::Idle => {
            let offset = player.soloq_decay_offset;
            // The offset never exceeds the LP above the floor, and a decay day never
            // lowers it.
            player.soloq_decay_offset = (offset + f64::from(preset.decay_per_idle_day))
                .min(formula_lp)
                .max(offset);
            SoloQDayKind::Decay
        }
        neutral => neutral,
    }
}

/// The daily SoloQ step: settles every player's day against the bank and offset and
/// refreshes the `soloq_lp` cache. One pass over the players.
pub(super) fn advance_soloq_day(game: &mut Game) {
    let formula_lps = formula_lps(game);
    let mode = game.soloq_decay_mode;
    let preset = mode.active();

    let Game {
        players,
        soloq_day_marks,
        ..
    } = game;
    for (player, formula_lp) in players.iter_mut().zip(formula_lps) {
        if let Some(preset) = &preset {
            let raw = soloq_day_marks.kind_for(&player.id);
            settle_day(player, raw, formula_lp, preset);
        }
        player.soloq_lp = displayed_lp(mode, player, formula_lp);
    }
    soloq_day_marks.reset();
}

// ---------------------------------------------------------------------------
// The setting
// ---------------------------------------------------------------------------

/// The decay setting and the numbers of every mode.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS))]
#[cfg_attr(feature = "typescript", ts(export))]
pub struct SoloQDecaySettings {
    pub mode: SoloQDecayMode,
    pub presets: Vec<SoloQDecayPreset>,
}

pub fn soloq_decay_settings(game: &Game) -> SoloQDecaySettings {
    SoloQDecaySettings {
        mode: game.soloq_decay_mode,
        presets: SoloQDecayMode::ALL
            .iter()
            .map(|mode| mode.preset())
            .collect(),
    }
}

/// Sets the save's decay mode. Turning decay on or off starts everyone with a full bank
/// and no offset, so nothing drops the same day; moving between the active modes keeps
/// each player's state.
pub fn set_soloq_decay_mode(game: &mut Game, mode: SoloQDecayMode) -> SoloQDecaySettings {
    let previous = game.soloq_decay_mode;
    game.soloq_decay_mode = mode;
    if (previous == SoloQDecayMode::Off) != (mode == SoloQDecayMode::Off) {
        for player in &mut game.players {
            player.soloq_bank_spent = 0;
            player.soloq_decay_offset = 0.0;
        }
        refresh_soloq_lp(game);
    }
    soloq_decay_settings(game)
}
