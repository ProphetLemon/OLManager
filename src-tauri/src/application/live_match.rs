use log::info;
use std::collections::HashMap;

use crate::commands::round_summary::{build_round_summary_dto, RoundSummaryDto};
use olm_core::engine::event::{EventType, MatchEvent};
use olm_core::engine::report::{MatchReport, MatchReportEndReason, PlayerMatchStats, TeamStats};
use olm_core::engine::types::{Side, Zone};
use olm_core::game::Game;
use olm_core::live_match_manager::{self, MatchMode};
use olm_core::roster_stability;
use olm_core::state::StateManager;
use olm_core::turn::merge_series_reports;
use serde::{Deserialize, Serialize};

fn role_to_string(role: &olm_core::domain::stats::LolRole) -> &'static str {
    use olm_core::domain::stats::LolRole;
    match role {
        LolRole::Top => "TOP",
        LolRole::Jungle => "JUNGLE",
        LolRole::Mid => "MID",
        LolRole::Adc => "ADC",
        LolRole::Support => "SUPPORT",
        LolRole::Unknown => "UNKNOWN",
    }
}

fn validate_user_team_role_coverage(game: &Game) -> Result<(), String> {
    let Some(user_team_id) = game.manager.team_id.as_deref() else {
        return Ok(());
    };

    let role_set: std::collections::HashSet<&'static str> = game
        .players
        .iter()
        .filter(|player| player.team_id.as_deref() == Some(user_team_id))
        .map(|player| role_to_string(&player.natural_position))
        .collect();
    let required_roles = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"];
    let missing_roles: Vec<&str> = required_roles
        .iter()
        .copied()
        .filter(|role| !role_set.contains(role))
        .collect();

    if missing_roles.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Main roster role coverage incomplete: missing {}. You need at least one TOP, JUNGLE, MID, ADC, and SUPPORT before starting a match.",
            missing_roles.join(", ")
        ))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FinishLiveMatchResponse {
    pub game: Game,
    pub round_summary: Option<RoundSummaryDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LolSimMatchReportInput {
    pub winner: Option<String>,
    pub time_sec: f64,
    pub events: Vec<LolSimMatchReportEventInput>,
    pub stats: LolSimMatchReportStatsInput,
    pub champions: Vec<LolSimMatchReportChampionInput>,
    /// The fixture team that plays blue in this game. Reports built without champions (a
    /// skipped or delegated game) cannot be read from player ids, so the frontend names it.
    #[serde(default)]
    pub blue_team_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LolSimMatchReportEventInput {
    pub t: f64,
    pub text: String,
    #[serde(rename = "type")]
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LolSimMatchReportStatsInput {
    pub blue: LolSimMatchReportTeamStatsInput,
    pub red: LolSimMatchReportTeamStatsInput,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LolSimMatchReportTeamStatsInput {
    pub kills: u16,
    pub deaths: u16,
    pub gold: u32,
    pub towers: u16,
    pub dragons: u16,
    pub barons: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LolSimMatchReportChampionInput {
    pub id: String,
    pub name: String,
    pub team: String,
    pub role: String,
    pub kills: u16,
    pub deaths: u16,
    pub assists: u16,
    pub cs: u16,
    pub gold: u32,
    pub spent_gold: u32,
    /// Damage dealt to enemy champions. Reports from older frontends omit it and read as 0.
    #[serde(default)]
    pub damage_dealt: f64,
}

fn map_sim_team_to_side(team: &str) -> Side {
    if team.eq_ignore_ascii_case("red") {
        Side::Away
    } else {
        Side::Home
    }
}

fn map_sim_role_to_engine(role: &str) -> Option<olm_core::engine::sim_background::LolRole> {
    match role {
        "TOP" => Some(olm_core::engine::sim_background::LolRole::Top),
        "JGL" => Some(olm_core::engine::sim_background::LolRole::Jungle),
        "MID" => Some(olm_core::engine::sim_background::LolRole::Mid),
        "ADC" => Some(olm_core::engine::sim_background::LolRole::Adc),
        "SUP" => Some(olm_core::engine::sim_background::LolRole::Support),
        _ => None,
    }
}

fn map_sim_event_kind_to_engine(kind: &str) -> Option<EventType> {
    match kind {
        "kill" => Some(EventType::Kill),
        "tower" => Some(EventType::TowerDestroyed),
        "dragon" | "baron" => Some(EventType::ObjectiveTaken),
        "nexus" => Some(EventType::NexusDestroyed),
        "spawn" => Some(EventType::ObjectiveSpawned),
        _ => None,
    }
}

fn parse_kill_text(text: &str) -> Option<(String, String)> {
    let (killer, victim) = text.split_once(" killed ")?;
    let killer = killer.trim();
    let victim = victim.trim();
    if killer.is_empty() || victim.is_empty() {
        return None;
    }
    Some((killer.to_string(), victim.to_string()))
}

fn infer_event_side(
    text: &str,
    killer_name: Option<&str>,
    champion_name_to_side: &HashMap<String, Side>,
) -> Side {
    let lower_text = text.to_lowercase();
    if lower_text.contains("blue") {
        return Side::Home;
    }
    if lower_text.contains("red") {
        return Side::Away;
    }
    if let Some(killer) = killer_name {
        let key = killer.to_lowercase();
        if let Some(side) = champion_name_to_side.get(&key) {
            return *side;
        }
    }
    Side::Home
}

fn damage_to_u32(damage: f64) -> u32 {
    if damage.is_finite() {
        damage.round().clamp(0.0, f64::from(u32::MAX)) as u32
    } else {
        0
    }
}

fn build_match_report_from_lol_sim(input: LolSimMatchReportInput) -> MatchReport {
    let mut team_damage = [0_u32; 2];
    for champion in &input.champions {
        let slot = match map_sim_team_to_side(&champion.team) {
            Side::Home => 0,
            Side::Away => 1,
        };
        team_damage[slot] = team_damage[slot].saturating_add(damage_to_u32(champion.damage_dealt));
    }
    let mut champion_name_to_side: HashMap<String, Side> = HashMap::new();
    let mut champion_name_to_id: HashMap<String, String> = HashMap::new();
    for champion in &input.champions {
        let key = champion.name.to_lowercase();
        champion_name_to_side.insert(key.clone(), map_sim_team_to_side(&champion.team));
        champion_name_to_id.insert(key, champion.id.clone());
    }

    let events = input
        .events
        .into_iter()
        .filter_map(|event| {
            let mut event_type = map_sim_event_kind_to_engine(&event.kind)?;
            if matches!(event_type, EventType::TowerDestroyed)
                && event.text.to_lowercase().contains("inhib")
            {
                event_type = EventType::InhibitorDestroyed;
            }

            let kill_data = if matches!(event_type, EventType::Kill) {
                parse_kill_text(&event.text)
            } else {
                None
            };

            let side = infer_event_side(
                &event.text,
                kill_data.as_ref().map(|(killer, _)| killer.as_str()),
                &champion_name_to_side,
            );

            let player_id = kill_data
                .as_ref()
                .and_then(|(killer, _)| champion_name_to_id.get(&killer.to_lowercase()).cloned());
            let secondary_player_id = kill_data
                .as_ref()
                .and_then(|(_, victim)| champion_name_to_id.get(&victim.to_lowercase()).cloned());

            Some(MatchEvent {
                minute: (event.t / 60.0).round().clamp(0.0, 255.0) as u8,
                event_type,
                side,
                zone: Zone::Midfield,
                player_id,
                secondary_player_id,
            })
        })
        .collect::<Vec<_>>();

    let mut player_stats: HashMap<String, PlayerMatchStats> = HashMap::new();
    for champion in input.champions {
        player_stats.insert(
            champion.id,
            PlayerMatchStats {
                role: map_sim_role_to_engine(&champion.role),
                duration_seconds: input.time_sec.round().max(0.0) as u32,
                kills: champion.kills,
                deaths: champion.deaths,
                assists: champion.assists,
                creep_score: champion.cs,
                gold_earned: champion.gold.saturating_add(champion.spent_gold),
                damage_dealt: damage_to_u32(champion.damage_dealt),
                vision_score: 0,
                wards_placed: 0,
                ..Default::default()
            },
        );
    }

    let winner_side = input
        .winner
        .as_deref()
        .map(map_sim_team_to_side)
        .unwrap_or_else(|| {
            if input.stats.blue.kills >= input.stats.red.kills {
                Side::Home
            } else {
                Side::Away
            }
        });

    let (home_wins, away_wins) = match winner_side {
        Side::Home => (1, 0),
        Side::Away => (0, 1),
    };

    MatchReport {
        home_wins,
        away_wins,
        home_stats: TeamStats {
            kills: input.stats.blue.kills,
            deaths: input.stats.blue.deaths,
            gold_earned: input.stats.blue.gold,
            damage_dealt: team_damage[0],
            objectives: input
                .stats
                .blue
                .towers
                .saturating_add(input.stats.blue.dragons)
                .saturating_add(input.stats.blue.barons),
            possession_ticks: 0,
            ..Default::default()
        },
        away_stats: TeamStats {
            kills: input.stats.red.kills,
            deaths: input.stats.red.deaths,
            gold_earned: input.stats.red.gold,
            damage_dealt: team_damage[1],
            objectives: input
                .stats
                .red
                .towers
                .saturating_add(input.stats.red.dragons)
                .saturating_add(input.stats.red.barons),
            possession_ticks: 0,
            ..Default::default()
        },
        events,
        kill_feed: vec![],
        player_stats,
        home_possession: 50.0,
        total_minutes: (input.time_sec / 60.0).round().clamp(0.0, 255.0) as u8,
        game_duration_seconds: input.time_sec.round().max(0.0) as u32,
        ended_by: if input.winner.is_some() {
            MatchReportEndReason::NexusDestroyed
        } else {
            MatchReportEndReason::TimeLimit
        },
    }
}

/// Whether the blue side of a reported game is the fixture's home team.
///
/// The frontend seats the user on the blue side they pick, so the user's club can be the
/// fixture's away team on blue (or its home team on red). The report only says "blue" and
/// "red", so unless it names the blue team the side is read from who the blue champions
/// are: their ids are player ids, and each player belongs to one of the fixture's two
/// teams. Ids that resolve to neither team (or to both equally) keep the original reading,
/// blue as home.
fn blue_side_is_home(
    game: &Game,
    home_team_id: &str,
    away_team_id: &str,
    champions: &[LolSimMatchReportChampionInput],
    blue_team_id: Option<&str>,
) -> bool {
    // The frontend names the blue team when it knows it; that settles it for a fixture team.
    match blue_team_id {
        Some(id) if id == home_team_id => return true,
        Some(id) if id == away_team_id => return false,
        _ => {}
    }
    let (mut home_votes, mut away_votes) = (0_usize, 0_usize);
    for champion in champions
        .iter()
        .filter(|champion| map_sim_team_to_side(&champion.team) == Side::Home)
    {
        let team_id = game
            .players
            .iter()
            .find(|player| player.id == champion.id)
            .and_then(|player| player.team_id.as_deref());
        if team_id == Some(home_team_id) {
            home_votes += 1;
        } else if team_id == Some(away_team_id) {
            away_votes += 1;
        }
    }
    away_votes <= home_votes
}

/// Turns a report built as blue = home into the one for a fixture where blue is away.
fn swap_report_sides(report: &mut MatchReport) {
    std::mem::swap(&mut report.home_wins, &mut report.away_wins);
    std::mem::swap(&mut report.home_stats, &mut report.away_stats);
    report.home_possession = 100.0 - report.home_possession;
    for event in &mut report.events {
        event.side = event.side.opposite();
    }
    for kill in &mut report.kill_feed {
        kill.side = kill.side.opposite();
    }
}

/// One game's report from the frontend, credited to the fixture's home and away teams.
fn fixture_report_from_lol_sim(
    game: &Game,
    home_team_id: &str,
    away_team_id: &str,
    input: LolSimMatchReportInput,
) -> MatchReport {
    let blue_is_home = blue_side_is_home(
        game,
        home_team_id,
        away_team_id,
        &input.champions,
        input.blue_team_id.as_deref(),
    );
    let mut report = build_match_report_from_lol_sim(input);
    if !blue_is_home {
        swap_report_sides(&mut report);
    }
    report
}

/// Games a side must win to take a best-of-`best_of` series.
fn series_target_wins(best_of: u8) -> u8 {
    best_of / 2 + 1
}

/// Games each side has won in the given per-game reports.
fn series_wins<'a>(reports: impl IntoIterator<Item = &'a MatchReport>) -> (u8, u8) {
    reports.into_iter().fold((0, 0), |(home, away), report| {
        (
            home.saturating_add(report.home_wins),
            away.saturating_add(report.away_wins),
        )
    })
}

/// Keeps `report` as game `game_number` of the series, replacing that game and any after it.
///
/// A series is recorded in order, so a retry or a series restarted from game 1 overwrites
/// what an earlier attempt left. Only games that leave the series undecided are kept: the
/// deciding game goes through `finish_live_match`, so a Bo1, a game past the series' length
/// and a game after the decision are all refused.
fn keep_series_game(
    buffer: &mut Vec<MatchReport>,
    game_number: u8,
    best_of: u8,
    report: MatchReport,
) -> Result<(), String> {
    let index = usize::from(game_number)
        .checked_sub(1)
        .ok_or("Series games are numbered from 1")?;
    if game_number > best_of {
        return Err(format!(
            "Game {game_number} is past the {best_of} games of the series"
        ));
    }
    if index > buffer.len() {
        return Err(format!(
            "Game {game_number} was recorded before game {}",
            buffer.len() + 1
        ));
    }

    let (home_wins, away_wins) = series_wins(buffer[..index].iter().chain([&report]));
    let target = series_target_wins(best_of);
    if home_wins >= target || away_wins >= target {
        return Err(format!(
            "Game {game_number} decides the best-of-{best_of} series: finish the match instead"
        ));
    }

    buffer.truncate(index);
    buffer.push(report);
    Ok(())
}

/// The report `apply_match_report` gets for a finished match.
///
/// A series the user played game by game merges the recorded games with the deciding one,
/// exactly as an AI series is merged. No recorded games means a single game. Recorded games
/// that do not add up to a series won by the deciding game's winner (a game that failed to
/// record, say) are not trusted: the deciding game then stands alone, as it always did.
fn series_report(buffered: Vec<MatchReport>, deciding: MatchReport, best_of: u8) -> MatchReport {
    if buffered.is_empty() {
        return deciding;
    }
    let (home_wins, away_wins) = series_wins(buffered.iter().chain([&deciding]));
    let target = series_target_wins(best_of);
    let home_takes_series = home_wins >= target && away_wins < target;
    let away_takes_series = away_wins >= target && home_wins < target;
    let deciding_home_won = deciding.home_wins > deciding.away_wins;
    let consistent =
        (home_takes_series && deciding_home_won) || (away_takes_series && !deciding_home_won);
    if !consistent {
        log::warn!(
            "[cmd] finish_live_match: recorded games {}-{} do not make a best-of-{} series won by the last game; using the last game alone",
            home_wins,
            away_wins,
            best_of
        );
        return deciding;
    }

    let mut games = buffered;
    games.push(deciding.clone());
    merge_series_reports(games).unwrap_or(deciding)
}

pub fn finish_live_match(
    state: &StateManager,
    lol_report: Option<LolSimMatchReportInput>,
    locale: Option<&str>,
    data_base: Option<&std::path::Path>,
) -> Result<FinishLiveMatchResponse, String> {
    info!("[cmd] finish_live_match");
    let mut session = state.take_live_match().ok_or("No active live match")?;
    let buffered_games = std::mem::take(&mut session.series_reports);

    let fixture_index = session.fixture_index;
    let round_matchday = session.round_matchday;
    let round_previous_standings = session.round_previous_standings.clone();
    let home_team_id = session.home_team_id.clone();
    let away_team_id = session.away_team_id.clone();

    let report = if let Some(input) = lol_report {
        state
            .get_game(|game| {
                let deciding =
                    fixture_report_from_lol_sim(game, &home_team_id, &away_team_id, input);
                let best_of = game
                    .active_league()
                    .and_then(|league| league.fixtures.get(fixture_index))
                    .map_or(1, |fixture| fixture.best_of);
                series_report(buffered_games, deciding, best_of)
            })
            .ok_or("No active game session")?
    } else {
        // A report-less finish is the backend's own game, not a series the user played.
        session.match_state.into_report()
    };
    info!(
        "[cmd] finish_live_match: fixture_index={}, home_team_id={}, away_team_id={}, events= {}",
        fixture_index,
        home_team_id,
        away_team_id,
        report.events.len()
    );

    let mut game = state
        .get_game(|g| g.clone())
        .ok_or("No active game session")?;

    let mut captures = Vec::new();
    olm_core::turn::apply_match_report_with_capture(
        &mut game,
        fixture_index,
        &home_team_id,
        &away_team_id,
        &report,
        &mut |capture| captures.push(capture),
    );
    for capture in captures {
        state.append_stats_state(capture);
    }

    olm_core::social::generate_match_social_posts(
        &mut game,
        fixture_index,
        &report,
        locale,
        data_base,
    );

    let round_summary = build_round_summary_dto(&game, round_matchday, &round_previous_standings);

    olm_core::turn::finish_live_match_day(&mut game);

    state.set_game(game.clone());
    Ok(FinishLiveMatchResponse {
        game: crate::client_game::game_for_client(&game),
        round_summary,
    })
}

/// Keeps one non-deciding game of the user's series for `finish_live_match` to merge.
///
/// `game_number` counts from 1. The report is credited to the fixture's home and away teams
/// now, because the user can swap colours from one game to the next.
pub fn record_series_game(
    state: &StateManager,
    game_number: u8,
    lol_report: LolSimMatchReportInput,
) -> Result<(), String> {
    info!("[cmd] record_series_game: game={}", game_number);
    state.with_session_mut(|session| {
        let live = session.live_match.as_mut().ok_or("No active live match")?;
        let game = session.game.as_ref().ok_or("No active game session")?;
        let best_of = game
            .active_league()
            .and_then(|league| league.fixtures.get(live.fixture_index))
            .map(|fixture| fixture.best_of)
            .ok_or("Fixture not found")?;
        let report =
            fixture_report_from_lol_sim(game, &live.home_team_id, &live.away_team_id, lol_report);
        keep_series_game(&mut live.series_reports, game_number, best_of, report)
    })
}

pub fn start_live_match(
    state: &StateManager,
    fixture_index: usize,
    mode: &str,
    allows_extra_time: bool,
) -> Result<olm_core::engine::MatchSnapshot, String> {
    info!(
        "[cmd] start_live_match: fixture={}, mode={}, extra_time={}",
        fixture_index, mode, allows_extra_time
    );
    let mut game = state
        .get_game(|g| g.clone())
        .ok_or("No active game session")?;

    validate_user_team_role_coverage(&game)?;

    // Pre-match: ensure both teams are match eligible before building engine teams.
    // For the user team, repair_team is a no-op (skips non-schedulable teams).
    // For the AI opponent, repair fills missing roles, reconciles lineups, etc.
    let match_team_ids: Vec<String> = {
        let league = game
            .active_league()
            .ok_or("No active league for start_live_match")?;
        let fixture = league
            .fixtures
            .get(fixture_index)
            .ok_or_else(|| format!("Fixture index {fixture_index} out of range"))?;
        vec![fixture.home_team_id.clone(), fixture.away_team_id.clone()]
    };
    for team_id in &match_team_ids {
        if !team_id.is_empty() {
            roster_stability::repair_team(
                &mut game,
                team_id,
                roster_stability::RosterStabilityReason::PreMatch,
            )
            .map_err(|e| {
                format!("Team {team_id} roster is invalid and could not be repaired: {e}")
            })?;
        }
    }
    // Sync repaired game back to state so live_match_manager uses current data
    state.set_game(game.clone());

    let match_mode = match mode {
        "spectator" => MatchMode::Spectator,
        _ => MatchMode::Live,
    };

    let session =
        live_match_manager::create_live_match(&game, fixture_index, match_mode, allows_extra_time)?;
    let snapshot = session.snapshot();
    info!(
        "[cmd] start_live_match: created fixture={}, phase={:?}, home_team={}, away_team={}, home_players={}, away_players={}",
        fixture_index,
        snapshot.phase,
        snapshot.home_team.name,
        snapshot.away_team.name,
        snapshot.home_team.players.len(),
        snapshot.away_team.players.len()
    );
    state.set_live_match(session);
    Ok(snapshot)
}

pub fn apply_match_command(
    state: &StateManager,
    command: olm_core::engine::MatchCommand,
) -> Result<olm_core::engine::MatchSnapshot, String> {
    info!("[cmd] apply_match_command: {:?}", command);
    let snapshot = state
        .with_live_match(|session| {
            session.apply_command(command)?;
            Ok::<olm_core::engine::MatchSnapshot, String>(session.snapshot())
        })
        .ok_or_else(|| "No active live match".to_string())??;

    info!(
        "[cmd] apply_match_command: snapshot phase={:?}, minute={}, home_players={}, away_players={}",
        snapshot.phase,
        snapshot.current_minute,
        snapshot.home_team.players.len(),
        snapshot.away_team.players.len()
    );

    Ok(snapshot)
}

pub fn get_match_snapshot(state: &StateManager) -> Result<olm_core::engine::MatchSnapshot, String> {
    log::debug!("[cmd] get_match_snapshot");
    let snapshot = state
        .with_live_match(|session| session.snapshot())
        .ok_or_else(|| "No active live match".to_string())?;

    info!(
        "[cmd] get_match_snapshot: phase={:?}, minute={}, home_team={}, away_team={}, home_roles={:?}, away_roles={:?}, events={}",
        snapshot.phase, snapshot.current_minute, snapshot.home_team.name, snapshot.away_team.name,
        snapshot.home_roles, snapshot.away_roles, snapshot.events.len()
    );

    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn champion(id: &str, team: &str, damage_dealt: f64) -> LolSimMatchReportChampionInput {
        LolSimMatchReportChampionInput {
            id: id.to_string(),
            name: id.to_uppercase(),
            team: team.to_string(),
            role: "MID".to_string(),
            kills: 0,
            deaths: 0,
            assists: 0,
            cs: 0,
            gold: 0,
            spent_gold: 0,
            damage_dealt,
        }
    }

    fn team_stats() -> LolSimMatchReportTeamStatsInput {
        LolSimMatchReportTeamStatsInput {
            kills: 0,
            deaths: 0,
            gold: 0,
            towers: 0,
            dragons: 0,
            barons: 0,
        }
    }

    fn input(champions: Vec<LolSimMatchReportChampionInput>) -> LolSimMatchReportInput {
        LolSimMatchReportInput {
            winner: Some("blue".to_string()),
            time_sec: 1800.0,
            events: Vec::new(),
            stats: LolSimMatchReportStatsInput {
                blue: team_stats(),
                red: team_stats(),
            },
            champions,
            blue_team_id: None,
        }
    }

    #[test]
    fn report_carries_each_champions_damage_instead_of_zero() {
        let report = build_match_report_from_lol_sim(input(vec![
            champion("b1", "blue", 12_345.4),
            champion("r1", "red", 9_000.6),
        ]));
        assert_eq!(report.player_stats["b1"].damage_dealt, 12_345);
        assert_eq!(report.player_stats["r1"].damage_dealt, 9_001);
    }

    #[test]
    fn report_sums_damage_per_team() {
        let report = build_match_report_from_lol_sim(input(vec![
            champion("b1", "blue", 1_000.0),
            champion("b2", "blue", 2_500.0),
            champion("r1", "red", 4_000.0),
        ]));
        assert_eq!(report.home_stats.damage_dealt, 3_500);
        assert_eq!(report.away_stats.damage_dealt, 4_000);
    }

    #[test]
    fn report_reads_missing_or_invalid_damage_as_zero() {
        let json = r#"{"id":"b1","name":"B1","team":"blue","role":"MID","kills":0,"deaths":0,
            "assists":0,"cs":0,"gold":0,"spentGold":0}"#;
        let old: LolSimMatchReportChampionInput = serde_json::from_str(json).expect("old shape");
        assert_eq!(old.damage_dealt, 0.0);
        let report = build_match_report_from_lol_sim(input(vec![
            champion("b1", "blue", f64::NAN),
            champion("b2", "blue", -50.0),
        ]));
        assert_eq!(report.player_stats["b1"].damage_dealt, 0);
        assert_eq!(report.player_stats["b2"].damage_dealt, 0);
        assert_eq!(report.home_stats.damage_dealt, 0);
    }

    #[test]
    fn swapping_report_sides_moves_score_stats_and_events_to_the_other_team() {
        let mut input = input(vec![
            champion("b1", "blue", 1_000.0),
            champion("r1", "red", 500.0),
        ]);
        input.winner = Some("blue".to_string());
        input.events = vec![LolSimMatchReportEventInput {
            t: 600.0,
            text: "blue destroyed a tower".to_string(),
            kind: "tower".to_string(),
        }];
        let mut report = build_match_report_from_lol_sim(input);

        swap_report_sides(&mut report);

        assert_eq!((report.home_wins, report.away_wins), (0, 1));
        assert_eq!(report.away_stats.damage_dealt, 1_000);
        assert_eq!(report.home_stats.damage_dealt, 500);
        assert_eq!(report.events[0].side, Side::Away);
    }
}
