use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlayerAdvancedMetricDto {
    pub total: u32,
    pub per_match: Option<f32>,
    pub percentile: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlayerStatsOverviewMetricsDto {
    pub kills: PlayerAdvancedMetricDto,
    pub deaths: PlayerAdvancedMetricDto,
    pub assists: PlayerAdvancedMetricDto,
    pub creep_score: PlayerAdvancedMetricDto,
    pub vision_score: PlayerAdvancedMetricDto,
    pub wards_placed: PlayerAdvancedMetricDto,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlayerStatsOverviewDto {
    pub percentile_eligible: bool,
    pub matches_played: u32,
    pub metrics: PlayerStatsOverviewMetricsDto,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlayerMatchHistoryEntryDto {
    pub fixture_id: String,
    pub season: u32,
    pub date: String,
    pub competition: String,
    pub matchday: u32,
    pub opponent_team_id: String,
    pub opponent_name: String,
    pub side: String,
    pub result: String,
    pub role: String,
    pub champion_id: Option<String>,
    pub champion_win: Option<bool>,
    pub game_duration_seconds: u32,
    pub kills: u16,
    pub deaths: u16,
    pub assists: u16,
    pub cs: u16,
    pub gold_earned: u32,
    pub damage_to_champions: u32,
    pub vision_score: u16,
    pub wards_placed: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TeamMatchHistoryEntryDto {
    pub fixture_id: String,
    pub date: String,
    pub competition: String,
    pub matchday: u32,
    pub opponent_team_id: String,
    pub opponent_name: String,
    pub side: String,
    pub result: String,
    pub game_duration_seconds: u32,
    pub kills: u16,
    pub deaths: u16,
    pub gold_earned: u32,
    pub damage_to_champions: u32,
    pub objectives: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TeamAdvancedMetricDto {
    pub total: u32,
    pub per_match: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TeamStatsOverviewMetricsDto {
    pub kills: TeamAdvancedMetricDto,
    pub deaths: TeamAdvancedMetricDto,
    pub gold_earned: TeamAdvancedMetricDto,
    pub damage_to_champions: TeamAdvancedMetricDto,
    pub objectives: TeamAdvancedMetricDto,
    pub average_game_duration_seconds: TeamAdvancedMetricDto,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TeamStatsOverviewDto {
    pub matches_played: u32,
    pub wins: u32,
    pub losses: u32,
    pub metrics: TeamStatsOverviewMetricsDto,
}
