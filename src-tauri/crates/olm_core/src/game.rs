use crate::champions::{ChampionMasteryEntry, ChampionPatchState};
use crate::clock::GameClock;
use crate::contract_wage_policy::AiTransferCapState;
use crate::domain::league::League;
use crate::domain::manager::Manager;
use crate::domain::message::InboxMessage;
use crate::domain::news::NewsArticle;
use crate::domain::player::Player;
use crate::domain::season::SeasonContext;
use crate::domain::social::{SocialAccount, SocialPost, SocialTemplate};
use crate::domain::staff::Staff;
use crate::domain::stats::StatsState;
use crate::domain::team::Team;
use crate::domain::transfer_history::TransferHistory;
#[cfg(feature = "typescript")]
use ts_rs::TS;

use crate::generator::definitions::CompetitionManifest;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[cfg_attr(feature = "typescript", derive(TS))]
#[cfg_attr(feature = "typescript", ts(export))]
pub enum DayPhase {
    #[default]
    Morning,
    ScrimBlock,
    ReviewBlock,
    TrainingBlock,
    Evening,
}

impl DayPhase {
    pub fn as_id(&self) -> &'static str {
        match self {
            Self::Morning => "Morning",
            Self::ScrimBlock => "ScrimBlock",
            Self::ReviewBlock => "ReviewBlock",
            Self::TrainingBlock => "TrainingBlock",
            Self::Evening => "Evening",
        }
    }

    pub fn from_id(value: &str) -> Self {
        match value {
            "ScrimBlock" => Self::ScrimBlock,
            "ReviewBlock" => Self::ReviewBlock,
            "TrainingBlock" => Self::TrainingBlock,
            "Evening" => Self::Evening,
            _ => Self::Morning,
        }
    }

    pub fn next(&self) -> Self {
        match self {
            Self::Morning => Self::ScrimBlock,
            Self::ScrimBlock => Self::ReviewBlock,
            Self::ReviewBlock => Self::TrainingBlock,
            Self::TrainingBlock => Self::Evening,
            Self::Evening => Self::Evening,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS))]
#[cfg_attr(feature = "typescript", ts(export))]
pub enum ObjectiveType {
    LeaguePosition,
    Wins,
    GoalsScored,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS))]
#[cfg_attr(feature = "typescript", ts(export))]
pub struct BoardObjective {
    pub id: String,
    pub description: String,
    pub target: u32,
    pub objective_type: ObjectiveType,
    pub met: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS))]
#[cfg_attr(feature = "typescript", ts(export))]
pub struct ScoutingAssignment {
    pub id: String,
    pub scout_id: String,
    pub player_id: String,
    pub days_remaining: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS))]
#[cfg_attr(feature = "typescript", ts(export))]
pub struct Game {
    pub clock: GameClock,
    #[serde(default)]
    pub day_phase: DayPhase,
    pub manager: Manager,
    pub teams: Vec<Team>,
    pub players: Vec<Player>,
    pub staff: Vec<Staff>,
    pub messages: Vec<InboxMessage>,
    #[serde(default)]
    pub news: Vec<NewsArticle>,
    #[serde(default)]
    pub social_posts: Vec<SocialPost>,
    #[serde(default)]
    pub social_accounts: Vec<SocialAccount>,
    #[serde(default)]
    pub social_templates: Vec<SocialTemplate>,
    /// Multi-league storage. The first element is the player's active league.
    #[serde(default)]
    pub leagues: Vec<League>,
    /// The competition_id of the player's active league.
    #[serde(default)]
    pub user_competition_id: Option<String>,
    #[serde(default)]
    pub scouting_assignments: Vec<ScoutingAssignment>,
    #[serde(default)]
    pub board_objectives: Vec<BoardObjective>,
    #[serde(default)]
    pub season_context: SeasonContext,
    #[serde(default)]
    pub days_since_last_job_offer: Option<u32>,
    #[serde(default)]
    pub champion_masteries: Vec<ChampionMasteryEntry>,
    #[serde(default)]
    pub champion_patch: ChampionPatchState,
    #[serde(default)]
    pub stats_state: StatsState,
    #[serde(default, deserialize_with = "deserialize_competition_configs_lenient")]
    pub competition_configs: HashMap<String, CompetitionManifest>,
    #[serde(default)]
    pub transfer_history: TransferHistory,
    /// Per-team daily counters for AI-initiated transfers (strategic/FA/club-to-club
    /// share one bucket; emergency repairs have a separate bucket).
    #[serde(default)]
    pub ai_transfer_cap_counts: HashMap<String, AiTransferCapState>,
    /// Last in-game date for which `ai_transfer_cap_counts` was reset.
    #[serde(default)]
    pub ai_transfer_cap_last_reset_date: Option<String>,
    /// Ids of contract warning messages already sent, so deleting one from the
    /// inbox does not cause it to be regenerated.
    #[serde(default)]
    pub sent_contract_warning_ids: HashSet<String>,
    /// Ids of players whose team assignment changed in-save (transfers and
    /// releases). Unlike `transfer_history`, this is never truncated, so
    /// catalog rehydration can always keep these players where the game put them.
    #[serde(default)]
    pub moved_player_ids: HashSet<String>,
    /// Tombstones for players the roster overlay retired. Catalog rehydration
    /// must never re-add these (see `merge_missing_players`).
    #[serde(default)]
    pub retired_player_ids: Vec<String>,
    /// `as_of` date of the roster overlay applied when this game was created,
    /// if any. Shown to the player as "Rosters as of <date>".
    #[serde(default)]
    pub world_overlay_as_of: Option<String>,
    /// Whether `residency::grandfather_rostered_players` already ran for this
    /// game. Saves from before the import rule load as `false`, so players on a
    /// team at that moment become residents of the team's league region.
    #[serde(default)]
    pub residency_initialized: bool,
}

/// Lenient deserializer for `competition_configs`.
///
/// Saves created before the `ScheduleConfig` -> `CompetitionManifest` migration
/// stored values without the fields a manifest requires (e.g. `id`), which would
/// otherwise fail the entire save load with "missing field `id`". Parse each
/// entry independently and drop any that no longer match the manifest shape; the
/// map is repopulated from the on-disk manifests when the game is loaded.
fn deserialize_competition_configs_lenient<'de, D>(
    deserializer: D,
) -> Result<HashMap<String, CompetitionManifest>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = HashMap::<String, serde_json::Value>::deserialize(deserializer)?;
    let mut configs = HashMap::with_capacity(raw.len());
    for (key, value) in raw {
        if let Ok(manifest) = serde_json::from_value::<CompetitionManifest>(value) {
            configs.insert(key, manifest);
        }
    }
    Ok(configs)
}

impl Game {
    pub fn new(
        clock: GameClock,
        manager: Manager,
        teams: Vec<Team>,
        players: Vec<Player>,
        staff: Vec<Staff>,
        messages: Vec<InboxMessage>,
    ) -> Self {
        let mut game = Self {
            clock,
            day_phase: DayPhase::Morning,
            manager,
            teams,
            players,
            staff,
            messages,
            news: vec![],
            social_posts: vec![],
            social_accounts: vec![],
            social_templates: vec![],
            leagues: vec![],
            user_competition_id: None,
            scouting_assignments: vec![],
            board_objectives: vec![],
            season_context: SeasonContext::default(),
            days_since_last_job_offer: None,
            champion_masteries: vec![],
            champion_patch: ChampionPatchState::default(),
            stats_state: StatsState::default(),
            competition_configs: HashMap::new(),
            transfer_history: TransferHistory::default(),
            ai_transfer_cap_counts: HashMap::new(),
            ai_transfer_cap_last_reset_date: None,
            sent_contract_warning_ids: HashSet::new(),
            moved_player_ids: HashSet::new(),
            retired_player_ids: vec![],
            world_overlay_as_of: None,
            residency_initialized: false,
        };
        crate::identity_upgrade::upgrade_game_football_identities(&mut game);
        crate::season_context::refresh_game_context(&mut game);
        game.refresh_lol_ovrs();
        game
    }

    /// Returns a reference to the player's active league, identified by
    /// `user_competition_id`. Falls back to `leagues.first()` if not set.
    pub fn active_league(&self) -> Option<&League> {
        self.user_competition_id
            .as_ref()
            .and_then(|cid| {
                self.leagues
                    .iter()
                    .find(|l| l.competition_id.as_deref() == Some(cid))
            })
            .or_else(|| self.leagues.first())
    }

    /// Returns a mutable reference to the player's active league.
    pub fn active_league_mut(&mut self) -> Option<&mut League> {
        let cid = self.user_competition_id.clone();
        if let Some(ref cid) = cid
            && let Some(pos) = self
                .leagues
                .iter()
                .position(|l| l.competition_id.as_deref() == Some(cid))
            {
                return self.leagues.get_mut(pos);
            }
        self.leagues.first_mut()
    }

    /// Recompute `lol_ovr` for every player from their current attributes.
    pub fn refresh_lol_ovrs(&mut self) {
        for player in &mut self.players {
            player.lol_ovr = crate::potential::calculate_lol_ovr(player);
        }
    }

    /// Returns the index of the player's active league.
    pub fn active_league_index(&self) -> usize {
        self.user_competition_id
            .as_ref()
            .and_then(|cid| {
                self.leagues
                    .iter()
                    .position(|l| l.competition_id.as_deref() == Some(cid))
            })
            .unwrap_or(0)
    }
}
