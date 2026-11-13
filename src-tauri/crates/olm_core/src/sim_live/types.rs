use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub(super) struct Vec2 {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RuntimeStats {
    pub blue: RuntimeTeamStats,
    pub red: RuntimeTeamStats,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RuntimeTeamStats {
    pub kills: i64,
    pub towers: i64,
    pub dragons: i64,
    pub barons: i64,
    pub gold: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RuntimeEvent {
    pub t: f64,
    /// English line for logs and for states saved before events carried a code. The screens
    /// compose their own sentence from `code` and `data` and fall back to this text only when
    /// there is no code (or a code they do not know).
    pub text: String,
    #[serde(rename = "type")]
    pub kind: String,
    /// What happened, as a stable identifier. Absent on debug lines and on old states.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<EventCode>,
    /// The facts a sentence needs: who, to whom, which structure or objective.
    #[serde(default, skip_serializing_if = "EventData::is_empty")]
    pub data: EventData,
}

/// Stable identifier of a live-match event. The names are part of the contract with the
/// frontend (`src/lib/match/live/eventSentence.ts`): add variants, never rename one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum EventCode {
    WaveSpawned,
    SweeperActivated,
    NeutralSpawned,
    NeutralDespawned,
    RecallStarted,
    RecallInterrupted,
    RecallCompleted,
    HeraldDeployed,
    UnitSummoned,
    SpellCast,
    IgniteCast,
    CampCleared,
    CampSkipped,
    DragonSecured,
    BaronSecured,
    ElderSecured,
    HeraldSecured,
    VoidgrubSecured,
    VoidgrubCampCleared,
    ObjectiveSecured,
    ChampionKilled,
    IgniteKill,
    StructureDestroyed,
    ItemBought,
    /// A code written by a newer build.
    #[serde(other)]
    Unknown,
}

/// The facts of one event. Every field is optional; an event fills only the ones it has.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct EventData {
    /// Champion that acted (display name and id).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actor_id: Option<String>,
    /// Champion acted upon.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_id: Option<String>,
    /// `blue` or `red`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub team: Option<String>,
    /// What killed a champion when it was not another champion: `tower`, `minion`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cause: Option<String>,
    /// Structure id, such as `blue-top-outer`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structure: Option<String>,
    /// Neutral timer key, such as `baron` or `wolves-red`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub objective: Option<String>,
    /// `infernal`, `ocean`, `mountain`, `cloud`, `hextech` or `chemtech`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dragon_kind: Option<String>,
    /// Item key, such as `black_cleaver`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub item: Option<String>,
    /// `ultimate`, `heal`, `flash`, `smite` or `teleport`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spell: Option<String>,
}

impl EventData {
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }

    pub fn actor(mut self, name: &str, id: &str) -> Self {
        self.actor = Some(name.to_string());
        self.actor_id = Some(id.to_string());
        self
    }

    pub fn actor_name(mut self, name: &str) -> Self {
        self.actor = Some(name.to_string());
        self
    }

    pub fn target(mut self, name: &str, id: &str) -> Self {
        self.target = Some(name.to_string());
        self.target_id = Some(id.to_string());
        self
    }

    pub fn team(mut self, team: &str) -> Self {
        self.team = Some(team.to_string());
        self
    }

    pub fn cause(mut self, cause: &str) -> Self {
        self.cause = Some(cause.to_string());
        self
    }

    pub fn structure(mut self, id: &str) -> Self {
        self.structure = Some(id.to_string());
        self
    }

    pub fn objective(mut self, key: &str) -> Self {
        self.objective = Some(key.to_string());
        self
    }

    pub fn dragon_kind(mut self, kind: &str) -> Self {
        self.dragon_kind = Some(kind.to_string());
        self
    }

    pub fn item(mut self, key: &str) -> Self {
        self.item = Some(key.to_string());
        self
    }

    pub fn spell(mut self, spell: &str) -> Self {
        self.spell = Some(spell.to_string());
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WardRuntime {
    pub id: String,
    pub team: String,
    pub owner_champion_id: String,
    pub pos: Vec2,
    pub expires_at: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RuntimeSummonerSpellSlot {
    pub key: String,
    pub cd_until: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RuntimeUltimateSlot {
    pub archetype: String,
    #[serde(default)]
    pub icon: String,
    pub cd_until: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanerCombatStateRuntime {
    pub last_disengage_at: f64,
    pub reengage_at: f64,
    pub recent_trade_until: f64,
    pub last_ai_debug_at: f64,
}

impl Default for LanerCombatStateRuntime {
    fn default() -> Self {
        Self {
            last_disengage_at: -999.0,
            reengage_at: -999.0,
            recent_trade_until: -999.0,
            last_ai_debug_at: -999.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LolChampionCombatProfileInput {
    pub base_hp: f64,
    pub attack_type: String,
    pub attack_range: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LolChampionUltimateInput {
    pub archetype: String,
    #[serde(default)]
    pub icon: String,
}
