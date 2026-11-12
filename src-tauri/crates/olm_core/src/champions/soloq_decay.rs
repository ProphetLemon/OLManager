//! SoloQ inactivity decay: a player who stops grinding loses LP, and a few days of
//! play bring it back.
//!
//! The LP formula in the parent module stays a pure function of the day. Decay is a
//! per-player offset subtracted from it after the clamp: a grace bank absorbs the first
//! idle days, then each idle day adds to the offset, and each played day removes some.
//! With the mode `Off` the offset is never read, so every LP value is the one the formula
//! alone gives.

use super::*;
use std::collections::{BTreeMap, VecDeque};

/// Days of per-day history kept for each followed player.
pub const SOLOQ_HISTORY_DAYS: usize = 90;

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

/// One day of a followed player's SoloQ story.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SoloQDayRecord {
    /// Displayed LP.
    pub lp: u16,
    /// LP before decay.
    pub formula_lp: u16,
    /// The training focus in force, `None` for a player without a team.
    pub focus: Option<crate::domain::team::TrainingFocus>,
    pub kind: SoloQDayKind,
    /// Grace-bank days left after the day.
    pub bank: u8,
}

/// The last [`SOLOQ_HISTORY_DAYS`] days of one player, oldest first and contiguous: the
/// last record is `last_date`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct PlayerSoloQHistory {
    pub last_date: String,
    pub days: VecDeque<SoloQDayRecord>,
}

impl PlayerSoloQHistory {
    fn push(&mut self, date: NaiveDate, record: SoloQDayRecord) {
        let last = NaiveDate::parse_from_str(&self.last_date, "%Y-%m-%d").ok();
        match last {
            Some(last) if date == last && !self.days.is_empty() => {
                if let Some(back) = self.days.back_mut() {
                    *back = record;
                }
            }
            Some(last) if date == last + chrono::Duration::days(1) => self.days.push_back(record),
            // A gap (or an unreadable date): the missing days are not invented.
            _ => {
                self.days.clear();
                self.days.push_back(record);
            }
        }
        self.last_date = date.format("%Y-%m-%d").to_string();
        while self.days.len() > SOLOQ_HISTORY_DAYS {
            self.days.pop_front();
        }
    }

    /// The calendar date of the record at `index`.
    fn date_at(&self, index: usize) -> Option<NaiveDate> {
        let last = NaiveDate::parse_from_str(&self.last_date, "%Y-%m-%d").ok()?;
        let back = i64::try_from(self.days.len().checked_sub(index + 1)?).ok()?;
        Some(last - chrono::Duration::days(back))
    }
}

/// Everything the save keeps for the SoloQ story. Ordered maps keep saves reproducible.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SoloQHistory {
    /// Players the user's scouts have reported on, with the date of the last report.
    #[serde(default)]
    pub scouted: BTreeMap<String, String>,
    #[serde(default)]
    pub players: BTreeMap<String, PlayerSoloQHistory>,
}

impl SoloQHistory {
    /// A scouting report was delivered: the player is followed for the next
    /// [`SOLOQ_HISTORY_DAYS`] days.
    pub fn note_scouted(&mut self, player_id: &str, date: &str) {
        self.scouted.insert(player_id.to_string(), date.to_string());
    }
}

fn parse_date(value: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()
}

/// The ids of the players whose history is kept today: the user's roster (academy
/// included), players with a scouting assignment under way, and players a scouting
/// report covered in the last [`SOLOQ_HISTORY_DAYS`] days. The game has no shortlist.
pub fn followed_player_ids(game: &Game, today: NaiveDate) -> HashSet<String> {
    let mut ids: HashSet<String> = HashSet::new();
    if let Some(user_team) = game.manager.team_id.as_deref() {
        let mut team_ids: HashSet<&str> = HashSet::from([user_team]);
        for team in &game.teams {
            if team.team_kind == crate::domain::team::TeamKind::Academy
                && team.parent_team_id.as_deref() == Some(user_team)
            {
                team_ids.insert(team.id.as_str());
            }
        }
        ids.extend(
            game.players
                .iter()
                .filter(|player| {
                    player
                        .team_id
                        .as_deref()
                        .is_some_and(|team_id| team_ids.contains(team_id))
                })
                .map(|player| player.id.clone()),
        );
    }
    ids.extend(
        game.scouting_assignments
            .iter()
            .map(|assignment| assignment.player_id.clone()),
    );
    for (player_id, reported_on) in &game.soloq_history.scouted {
        let recent = parse_date(reported_on)
            .is_some_and(|date| (today - date).num_days() < SOLOQ_HISTORY_DAYS as i64);
        if recent {
            ids.insert(player_id.clone());
        }
    }
    ids
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

/// The daily SoloQ step: settles every player's day, refreshes the `soloq_lp` cache and
/// appends the day to the followed players' history. One pass over the players, with
/// the lookups it needs built once.
pub(super) fn advance_soloq_day(game: &mut Game) {
    let formula_lps = formula_lps(game);
    let today = game.clock.current_date.date_naive();
    let followed = followed_player_ids(game, today);
    let mode = game.soloq_decay_mode;
    let preset = mode.active();

    let Game {
        players,
        teams,
        soloq_history,
        soloq_day_marks,
        ..
    } = game;
    let mut teams_by_id: HashMap<&str, &crate::domain::team::Team> =
        HashMap::with_capacity(teams.len());
    for team in teams.iter() {
        // `find` semantics: the first team with an id wins.
        teams_by_id.entry(team.id.as_str()).or_insert(team);
    }

    for (player, formula_lp) in players.iter_mut().zip(formula_lps) {
        let raw = soloq_day_marks.kind_for(&player.id);
        let (kind, bank) = match &preset {
            Some(preset) => {
                let kind = settle_day(player, raw, formula_lp, preset);
                let bank_max = u8::try_from(preset.bank_days).unwrap_or(u8::MAX);
                (kind, bank_max.saturating_sub(player.soloq_bank_spent))
            }
            None => (raw, 0),
        };
        let shown = displayed_lp(mode, player, formula_lp);
        player.soloq_lp = shown;

        if followed.contains(player.id.as_str()) {
            let focus =
                player
                    .team_id
                    .as_deref()
                    .and_then(|team_id| match teams_by_id.get(team_id) {
                        Some(team) => Some(
                            team.effective_training_focus(
                                &player.id,
                                player.training_focus.as_ref(),
                            )
                            .clone(),
                        ),
                        None => player.training_focus.clone(),
                    });
            soloq_history
                .players
                .entry(player.id.clone())
                .or_default()
                .push(
                    today,
                    SoloQDayRecord {
                        lp: lp_to_u16(shown),
                        formula_lp: lp_to_u16(formula_lp),
                        focus,
                        kind,
                        bank,
                    },
                );
        }
    }

    soloq_day_marks.reset();
    soloq_history
        .players
        .retain(|player_id, _| followed.contains(player_id));
    soloq_history.scouted.retain(|_, reported_on| {
        parse_date(reported_on)
            .is_some_and(|date| (today - date).num_days() < SOLOQ_HISTORY_DAYS as i64)
    });
}

fn lp_to_u16(lp: f64) -> u16 {
    lp.round().clamp(0.0, f64::from(u16::MAX)) as u16
}

// ---------------------------------------------------------------------------
// Commands' view of the state
// ---------------------------------------------------------------------------

/// One day of the history, as the profile page reads it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS))]
#[cfg_attr(feature = "typescript", ts(export))]
pub struct SoloQHistoryDay {
    /// `YYYY-MM-DD`.
    pub date: String,
    /// Displayed LP.
    pub lp: u32,
    /// LP before decay.
    pub formula_lp: u32,
    pub focus: Option<crate::domain::team::TrainingFocus>,
    pub kind: SoloQDayKind,
    pub bank: u32,
}

/// One player's SoloQ story plus the decay state behind it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS))]
#[cfg_attr(feature = "typescript", ts(export))]
pub struct SoloQHistoryView {
    pub player_id: String,
    /// Whether history is kept for this player.
    pub followed: bool,
    pub decay_mode: SoloQDecayMode,
    /// Grace-bank days left; 0 while decay is off.
    pub bank_days: u32,
    /// Full size of the grace bank; 0 while decay is off.
    pub bank_max: u32,
    /// The LP decay currently takes off the formula LP.
    pub offset_lp: u32,
    /// Oldest first, at most [`SOLOQ_HISTORY_DAYS`].
    pub days: Vec<SoloQHistoryDay>,
}

/// The decay setting and the numbers of every mode.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS))]
#[cfg_attr(feature = "typescript", ts(export))]
pub struct SoloQDecaySettings {
    pub mode: SoloQDecayMode,
    pub presets: Vec<SoloQDecayPreset>,
}

pub fn soloq_history_for_player(game: &Game, player_id: &str) -> Result<SoloQHistoryView, String> {
    let player = game
        .players
        .iter()
        .find(|player| player.id == player_id)
        .ok_or_else(|| "Player not found".to_string())?;
    let mode = game.soloq_decay_mode;
    let bank_max = mode.preset().bank_days;
    let bank_days = if mode == SoloQDecayMode::Off {
        0
    } else {
        bank_max.saturating_sub(u32::from(player.soloq_bank_spent))
    };
    let followed =
        followed_player_ids(game, game.clock.current_date.date_naive()).contains(player_id);
    let days = game
        .soloq_history
        .players
        .get(player_id)
        .filter(|_| followed)
        .map(|history| {
            history
                .days
                .iter()
                .enumerate()
                .filter_map(|(index, record)| {
                    Some(SoloQHistoryDay {
                        date: history.date_at(index)?.format("%Y-%m-%d").to_string(),
                        lp: u32::from(record.lp),
                        formula_lp: u32::from(record.formula_lp),
                        focus: record.focus.clone(),
                        kind: record.kind,
                        bank: u32::from(record.bank),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(SoloQHistoryView {
        player_id: player_id.to_string(),
        followed,
        decay_mode: mode,
        bank_days,
        bank_max,
        offset_lp: offset_for(mode, player).round() as u32,
        days,
    })
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
