use olm_core::domain::stats::{LolRole, MatchOutcome, PlayerMatchStatsRecord, TeamSide};
use olm_core::state::StateManager;

use super::dto::PlayerMatchHistoryEntryDto;
use super::shared::{competition_label, opponent_name};

fn side_label(side: TeamSide) -> String {
    match side {
        TeamSide::Blue => "Blue".to_string(),
        TeamSide::Red => "Red".to_string(),
    }
}

fn outcome_label(outcome: MatchOutcome) -> String {
    match outcome {
        MatchOutcome::Win => "Win".to_string(),
        MatchOutcome::Loss => "Loss".to_string(),
    }
}

fn role_label(role: LolRole) -> String {
    match role {
        LolRole::Top => "Top".to_string(),
        LolRole::Jungle => "Jungle".to_string(),
        LolRole::Mid => "Mid".to_string(),
        LolRole::Adc => "ADC".to_string(),
        LolRole::Support => "Support".to_string(),
        LolRole::Unknown => "Unknown".to_string(),
    }
}

fn to_dto(state: &StateManager, record: &PlayerMatchStatsRecord) -> PlayerMatchHistoryEntryDto {
    PlayerMatchHistoryEntryDto {
        fixture_id: record.fixture_id.clone(),
        season: record.season,
        date: record.date.clone(),
        competition: competition_label(&record.match_type),
        matchday: record.matchday,
        opponent_team_id: record.opponent_team_id.clone(),
        opponent_name: opponent_name(state, &record.opponent_team_id),
        side: side_label(record.side),
        result: outcome_label(record.result),
        role: role_label(record.role),
        champion_id: record.champion.clone(),
        champion_win: Some(matches!(record.result, MatchOutcome::Win)),
        game_duration_seconds: record.duration_seconds,
        kills: record.kills,
        deaths: record.deaths,
        assists: record.assists,
        cs: record.creep_score,
        gold_earned: record.gold_earned,
        damage_to_champions: record.damage_dealt,
        vision_score: record.vision_score,
        wards_placed: record.wards_placed,
    }
}

pub(super) fn get_player_match_history_internal(
    state: &StateManager,
    player_id: &str,
    limit: Option<usize>,
) -> Result<Vec<PlayerMatchHistoryEntryDto>, String> {
    let Some(mut history) = state.get_stats_state(|stats| {
        stats
            .player_matches
            .iter()
            .filter(|record| record.player_id == player_id)
            .cloned()
            .collect::<Vec<_>>()
    }) else {
        return Ok(Vec::new());
    };

    history.sort_by(|left, right| {
        right
            .date
            .cmp(&left.date)
            .then(right.matchday.cmp(&left.matchday))
            .then(right.fixture_id.cmp(&left.fixture_id))
    });

    let limit = limit.unwrap_or(5);
    Ok(history
        .into_iter()
        .take(limit)
        .map(|record| to_dto(state, &record))
        .collect())
}
