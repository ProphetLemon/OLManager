use serde::{Deserialize, Serialize};
#[cfg(feature = "typescript")]
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "typescript", derive(TS))]
#[cfg_attr(feature = "typescript", ts(export))]
pub enum SocialAuthorType {
    Team,
    Player,
    Fan,
    Analyst,
    Journalist,
    MemeAccount,
    Manager,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "typescript", derive(TS))]
#[cfg_attr(feature = "typescript", ts(export))]
pub enum SocialSentiment {
    Hype,
    Calm,
    Worried,
    Angry,
    Meltdown,
    Copium,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "typescript", derive(TS))]
#[cfg_attr(feature = "typescript", ts(export))]
pub enum SocialPostCategory {
    MatchResult,
    Banter,
    PlayerReaction,
    FanOpinion,
    MediaTake,
    Meme,
    ManagerPost,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "typescript", derive(TS))]
#[cfg_attr(feature = "typescript", ts(export))]
pub struct SocialAccount {
    pub id: String,
    pub language: String,
    pub display_name: String,
    pub handle: String,
    pub author_type: SocialAuthorType,
    pub profile_image_url: Option<String>,
    pub favorite_team_ids: Vec<String>,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "typescript", derive(TS))]
#[cfg_attr(feature = "typescript", ts(export))]
pub struct SocialTemplate {
    pub id: String,
    pub language: String,
    pub slot: String,
    pub author_id: Option<String>,
    pub conditions_json: String,
    pub variants: Vec<String>,
    pub tags: Vec<String>,
    pub weight: u32,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "typescript", derive(TS))]
#[cfg_attr(feature = "typescript", ts(export))]
pub struct SocialPost {
    pub id: String,
    pub date: String,
    pub author_name: String,
    pub author_handle: String,
    pub author_type: SocialAuthorType,
    pub body: String,
    pub likes: u32,
    pub reposts: u32,
    pub replies: u32,
    pub sentiment: SocialSentiment,
    pub category: SocialPostCategory,
    pub tags: Vec<String>,
    pub team_ids: Vec<String>,
    pub player_ids: Vec<String>,
    pub fixture_id: Option<String>,
    pub media_url: Option<String>,
    pub read: bool,
}

impl SocialPost {
    #[allow(clippy::too_many_arguments)] // params struct would be an out-of-scope signature refactor
    pub fn new(
        id: String,
        date: String,
        author_name: String,
        author_handle: String,
        author_type: SocialAuthorType,
        body: String,
        category: SocialPostCategory,
        sentiment: SocialSentiment,
    ) -> Self {
        Self {
            id,
            date,
            author_name,
            author_handle,
            author_type,
            body,
            likes: 0,
            reposts: 0,
            replies: 0,
            sentiment,
            category,
            tags: vec![],
            team_ids: vec![],
            player_ids: vec![],
            fixture_id: None,
            media_url: None,
            read: false,
        }
    }

    pub fn with_engagement(mut self, likes: u32, reposts: u32, replies: u32) -> Self {
        self.likes = likes;
        self.reposts = reposts;
        self.replies = replies;
        self
    }

    pub fn with_tags(mut self, tags: Vec<String>) -> Self {
        self.tags = tags;
        self
    }

    pub fn with_teams(mut self, team_ids: Vec<String>) -> Self {
        self.team_ids = team_ids;
        self
    }

    pub fn with_players(mut self, player_ids: Vec<String>) -> Self {
        self.player_ids = player_ids;
        self
    }

    pub fn with_fixture(mut self, fixture_id: String) -> Self {
        self.fixture_id = Some(fixture_id);
        self
    }

    pub fn with_media_url(mut self, media_url: Option<String>) -> Self {
        self.media_url = media_url;
        self
    }
}
