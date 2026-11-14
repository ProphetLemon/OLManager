use serde::{Deserialize, Serialize};

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

/// Champion page payload. The keys are the page's `Stats` interface in
/// `src/ui-v2/pages/ChampionPageV2.tsx`, so they stay snake_case.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChampionStatsDto {
    pub champion_key: String,
    pub champion_name: String,
    pub total_games: u32,
    pub total_wins: u32,
    pub win_rate: f64,
    pub pick_rate: f64,
    pub ban_rate: f64,
    pub avg_kills: f64,
    pub avg_deaths: f64,
    pub avg_assists: f64,
    pub avg_kda: f64,
    pub avg_gold: f64,
    pub avg_damage: f64,
    pub avg_cs: f64,
    pub avg_vision: f64,
    pub avg_duration: f64,
    pub role_distribution: Vec<ChampionRoleShareDto>,
    pub best_against: Vec<ChampionMatchupDto>,
    pub worst_against: Vec<ChampionMatchupDto>,
    pub top_players: Vec<ChampionTopPlayerDto>,
    pub weekly_history: Vec<ChampionWeekDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChampionRoleShareDto {
    pub role: String,
    pub games: u32,
    pub percentage: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChampionMatchupDto {
    pub vs_champion_key: String,
    pub vs_champion_name: String,
    pub games: u32,
    pub wins: u32,
    pub win_rate: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChampionTopPlayerDto {
    pub player_id: String,
    pub player_name: String,
    pub team_name: String,
    pub games: u32,
    pub win_rate: f64,
    pub avg_kda: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChampionWeekDto {
    pub week_label: String,
    pub games: u32,
    pub win_rate: f64,
    pub avg_kda: f64,
}
