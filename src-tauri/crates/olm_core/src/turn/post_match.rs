use crate::domain::league::{
    CompactMatchEvent, CompactMatchReport, CompactTeamMatchStats, FixtureStatus, MatchEndReason,
    MatchResult,
};
use crate::domain::player::{PlayerIssue, PlayerIssueCategory, PlayerPromiseKind};
use crate::domain::stats::{
    LolRole, MatchOutcome, PlayerMatchStatsRecord, StatsState, TeamMatchStatsRecord, TeamSide,
};
use crate::game::Game;
use crate::messages;
use crate::potential::{
    GAIN_TAPER_WINDOW, LOSS_TAPER_FLOOR, calculate_lol_ovr, effective_potential_cap, gain_headroom,
};
use log::debug;
use std::collections::HashMap;

fn compact_team_stats(
    stats: &crate::engine::TeamStats,
    possession_pct: u8,
) -> CompactTeamMatchStats {
    CompactTeamMatchStats {
        possession_pct,
        kills: stats.kills,
        deaths: stats.deaths,
        gold_earned: stats.gold_earned,
        damage_dealt: stats.damage_dealt,
        objectives: stats.objectives,
    }
}

fn compact_match_report(report: &crate::engine::MatchReport) -> CompactMatchReport {
    let events = report
        .events
        .iter()
        .filter(|event| {
            matches!(
                &event.event_type,
                crate::engine::EventType::Kill
                    | crate::engine::EventType::ObjectiveTaken
                    | crate::engine::EventType::TowerDestroyed
                    | crate::engine::EventType::InhibitorDestroyed
                    | crate::engine::EventType::NexusTowerDestroyed
                    | crate::engine::EventType::NexusDestroyed
            )
        })
        .map(|event| CompactMatchEvent {
            minute: event.minute,
            event_type: format!("{:?}", event.event_type),
            side: format!("{:?}", event.side),
            player_id: event.player_id.clone(),
            secondary_player_id: event.secondary_player_id.clone(),
        })
        .collect();

    // A series report keeps the last game's `total_minutes` beside the summed duration.
    let total_minutes = if report.game_duration_seconds > 0 {
        report.game_duration_seconds / 60
    } else {
        report.total_minutes.into()
    };

    CompactMatchReport {
        total_minutes,
        game_duration_seconds: report.game_duration_seconds,
        home_stats: compact_team_stats(&report.home_stats, report.home_possession.round() as u8),
        away_stats: compact_team_stats(
            &report.away_stats,
            (100.0 - report.home_possession).round().clamp(0.0, 100.0) as u8,
        ),
        events,
    }
}

fn report_end_reason(reason: crate::engine::MatchReportEndReason) -> MatchEndReason {
    match reason {
        crate::engine::MatchReportEndReason::NexusDestroyed => MatchEndReason::NexusDestroyed,
        crate::engine::MatchReportEndReason::TimeLimit => MatchEndReason::TimeLimit,
    }
}

fn team_side(team_id: &str, home_team_id: &str) -> TeamSide {
    if team_id == home_team_id {
        TeamSide::Blue
    } else {
        TeamSide::Red
    }
}

fn outcome_for_side(side: TeamSide, report: &crate::engine::MatchReport) -> MatchOutcome {
    let (team_score, opponent_score) = match side {
        TeamSide::Blue => (report.home_wins, report.away_wins),
        TeamSide::Red => (report.away_wins, report.home_wins),
    };
    MatchOutcome::from_scores(team_score, opponent_score)
}

fn domain_role(role: Option<crate::engine::sim_background::LolRole>) -> LolRole {
    match role {
        Some(crate::engine::sim_background::LolRole::Top) => LolRole::Top,
        Some(crate::engine::sim_background::LolRole::Jungle) => LolRole::Jungle,
        Some(crate::engine::sim_background::LolRole::Mid) => LolRole::Mid,
        Some(crate::engine::sim_background::LolRole::Adc) => LolRole::Adc,
        Some(crate::engine::sim_background::LolRole::Support) => LolRole::Support,
        None => LolRole::Unknown,
    }
}

/// Apply a completed match report to the game state: update fixture, standings,
/// player stats, stamina, and generate messages. Public so Tauri can call it
/// after a live match finishes.
pub fn apply_match_report(
    game: &mut Game,
    fixture_index: usize,
    home_team_id: &str,
    away_team_id: &str,
    report: &crate::engine::MatchReport,
) {
    apply_match_report_with_capture(
        game,
        fixture_index,
        home_team_id,
        away_team_id,
        report,
        &mut |_| {},
    );
}

pub fn apply_match_report_with_capture<F>(
    game: &mut Game,
    fixture_index: usize,
    home_team_id: &str,
    away_team_id: &str,
    report: &crate::engine::MatchReport,
    on_capture: &mut F,
) where
    F: FnMut(StatsState),
{
    apply_match_report_with_draft_capture(
        game,
        fixture_index,
        home_team_id,
        away_team_id,
        report,
        &[],
        &[],
        on_capture,
    );
}

#[allow(clippy::too_many_arguments)] // params struct would be an out-of-scope signature refactor
pub fn apply_match_report_with_draft_capture<F>(
    game: &mut Game,
    fixture_index: usize,
    home_team_id: &str,
    away_team_id: &str,
    report: &crate::engine::MatchReport,
    picks: &[(String, String)],
    bans: &[String],
    on_capture: &mut F,
) where
    F: FnMut(StatsState),
{
    debug!(
        "[turn] apply_match_report: fixture #{}, result {} - {}",
        fixture_index, report.home_wins, report.away_wins
    );

    let result = MatchResult {
        home_wins: report.home_wins,
        away_wins: report.away_wins,
        ended_by: report_end_reason(report.ended_by),
        game_duration_seconds: report.game_duration_seconds,
        report: Some(compact_match_report(report)),
    };
    let mut counts_for_standings = false;

    // Update fixture status, standings
    if let Some(league) = game.active_league_mut() {
        let fixture = &mut league.fixtures[fixture_index];
        fixture.status = FixtureStatus::Completed;
        counts_for_standings = fixture.counts_for_league_standings();

        if counts_for_standings {
            if let Some(entry) = league
                .standings
                .iter_mut()
                .find(|e| e.team_id == home_team_id)
            {
                entry.record_result(result.home_wins, result.away_wins);
            }
            if let Some(entry) = league
                .standings
                .iter_mut()
                .find(|e| e.team_id == away_team_id)
            {
                entry.record_result(result.away_wins, result.home_wins);
            }
        }

        fixture.result = Some(result);
    }

    on_capture(build_stats_state_capture(
        game,
        fixture_index,
        home_team_id,
        away_team_id,
        report,
        picks,
        bans,
    ));

    // Update player season stats from the engine report
    apply_player_stats(game, report, home_team_id, away_team_id);
    apply_lol_profile_progression(game, report, home_team_id, away_team_id);
    resolve_post_match_promises(game, report, home_team_id, away_team_id);

    // Deplete stamina for players who played, scaled by minutes in game
    deplete_match_stamina(game, home_team_id, report);
    deplete_match_stamina(game, away_team_id, report);

    // Update morale based on result and individual performance
    update_post_match_morale(game, report, home_team_id, away_team_id);

    // Update team form (last 5 results)
    if counts_for_standings {
        update_team_form(game, report, home_team_id, away_team_id);
    }

    // Update board satisfaction based on match result
    if counts_for_standings
        && let Some(user_team_id) = &game.manager.team_id
        && (*user_team_id == home_team_id || *user_team_id == away_team_id)
    {
        let user_wins = if *user_team_id == home_team_id {
            report.home_wins
        } else {
            report.away_wins
        };
        let opp_wins = if *user_team_id == home_team_id {
            report.away_wins
        } else {
            report.home_wins
        };
        let sat_delta: i8 = if user_wins > opp_wins { 2 } else { -3 };
        let new_sat = (game.manager.satisfaction as i16 + sat_delta as i16).clamp(0, 100) as u8;
        game.manager.satisfaction = new_sat;

        let fan_delta: i8 = if user_wins > opp_wins { 5 } else { -8 };
        let goal_diff = (user_wins as i8) - (opp_wins as i8);
        let fan_bonus: i8 = if goal_diff >= 3 {
            3
        } else if goal_diff <= -3 {
            -3
        } else {
            0
        };
        let new_fan = (game.manager.fan_approval as i16 + fan_delta as i16 + fan_bonus as i16)
            .clamp(0, 100) as u8;
        game.manager.fan_approval = new_fan;
    }

    // Generate match result message for user's team
    if counts_for_standings
        && let Some(user_team_id) = &game.manager.team_id
        && (*user_team_id == home_team_id || *user_team_id == away_team_id)
    {
        let fixture = &game.active_league().unwrap().fixtures[fixture_index];
        let res = fixture.result.as_ref().unwrap();
        let home_name = game
            .teams
            .iter()
            .find(|t| t.id == home_team_id)
            .map(|t| t.name.as_str())
            .unwrap_or("Home");
        let away_name = game
            .teams
            .iter()
            .find(|t| t.id == away_team_id)
            .map(|t| t.name.as_str())
            .unwrap_or("Away");

        let msg = messages::match_result_message(
            &fixture.id,
            home_name,
            away_name,
            res.home_wins,
            res.away_wins,
            home_team_id,
            away_team_id,
            user_team_id,
            fixture.matchday,
            &game.clock.current_date.to_rfc3339(),
        );
        game.messages.push(msg);
    }

    // Generate match report news article
    if counts_for_standings {
        super::news::generate_match_news(game, fixture_index, home_team_id, away_team_id, report);
    }
}

fn build_stats_state_capture(
    game: &Game,
    fixture_index: usize,
    home_team_id: &str,
    away_team_id: &str,
    report: &crate::engine::MatchReport,
    picks: &[(String, String)],
    bans: &[String],
) -> StatsState {
    let Some(league) = game.active_league() else {
        return StatsState::default();
    };
    let Some(fixture) = league.fixtures.get(fixture_index) else {
        return StatsState::default();
    };

    let team_by_player_id: std::collections::HashMap<&str, &str> = game
        .players
        .iter()
        .filter_map(|player| {
            player
                .team_id
                .as_deref()
                .map(|team_id| (player.id.as_str(), team_id))
        })
        .collect();
    let champion_by_player_id: std::collections::HashMap<&str, &str> = picks
        .iter()
        .map(|(player_id, champion_id)| (player_id.as_str(), champion_id.as_str()))
        .collect();
    let bans_json = serde_json::to_string(bans).unwrap_or_default();
    let games = games_in_report(report);

    let player_matches = report
        .player_stats
        .iter()
        .filter_map(|(player_id, stats)| {
            let team_id = *team_by_player_id.get(player_id.as_str())?;
            if team_id != home_team_id && team_id != away_team_id {
                return None;
            }

            let opponent_team_id = if team_id == home_team_id {
                away_team_id
            } else {
                home_team_id
            };
            let side = team_side(team_id, home_team_id);

            Some(PlayerMatchStatsRecord {
                fixture_id: fixture.id.clone(),
                season: league.season,
                matchday: fixture.matchday,
                date: fixture.date.clone(),
                match_type: fixture.match_type.clone(),
                player_id: player_id.clone(),
                team_id: team_id.to_string(),
                opponent_team_id: opponent_team_id.to_string(),
                side,
                result: outcome_for_side(side, report),
                role: domain_role(stats.role),
                champion: champion_by_player_id
                    .get(player_id.as_str())
                    .map(|champion_id| (*champion_id).to_string()),
                duration_seconds: stats.duration_seconds,
                kills: stats.kills,
                deaths: stats.deaths,
                assists: stats.assists,
                creep_score: stats.creep_score,
                gold_earned: stats.gold_earned,
                damage_dealt: stats.damage_dealt,
                vision_score: stats.vision_score,
                wards_placed: stats.wards_placed,
                bans_json: bans_json.clone(),
                games,
            })
        })
        .collect();

    let team_matches = vec![
        TeamMatchStatsRecord {
            fixture_id: fixture.id.clone(),
            season: league.season,
            matchday: fixture.matchday,
            date: fixture.date.clone(),
            match_type: fixture.match_type.clone(),
            team_id: home_team_id.to_string(),
            opponent_team_id: away_team_id.to_string(),
            side: TeamSide::Blue,
            result: outcome_for_side(TeamSide::Blue, report),
            duration_seconds: report.game_duration_seconds,
            kills: report.home_stats.kills,
            deaths: report.home_stats.deaths,
            gold_earned: report.home_stats.gold_earned,
            damage_dealt: report.home_stats.damage_dealt,
            objectives: report.home_stats.objectives,
            games,
        },
        TeamMatchStatsRecord {
            fixture_id: fixture.id.clone(),
            season: league.season,
            matchday: fixture.matchday,
            date: fixture.date.clone(),
            match_type: fixture.match_type.clone(),
            team_id: away_team_id.to_string(),
            opponent_team_id: home_team_id.to_string(),
            side: TeamSide::Red,
            result: outcome_for_side(TeamSide::Red, report),
            duration_seconds: report.game_duration_seconds,
            kills: report.away_stats.kills,
            deaths: report.away_stats.deaths,
            gold_earned: report.away_stats.gold_earned,
            damage_dealt: report.away_stats.damage_dealt,
            objectives: report.away_stats.objectives,
            games,
        },
    ];

    StatsState {
        player_matches,
        team_matches,
    }
}

// ---------------------------------------------------------------------------
// Post-match: feed engine report stats back into domain Player models
// ---------------------------------------------------------------------------

fn apply_player_stats(
    game: &mut Game,
    report: &crate::engine::MatchReport,
    home_team_id: &str,
    _away_team_id: &str,
) {
    for player in game.players.iter_mut() {
        if let Some(ps) = report.player_stats.get(&player.id) {
            let team_damage = if player.team_id.as_deref() == Some(home_team_id) {
                report.home_stats.damage_dealt
            } else {
                report.away_stats.damage_dealt
            };
            let minutes_played = if ps.duration_seconds > 0 {
                ps.duration_seconds / 60
            } else {
                u32::from(ps.minutes_played)
            };
            let kills = if ps.kills > 0 {
                ps.kills
            } else {
                report
                    .kill_feed
                    .iter()
                    .filter(|kill| kill.killer_id == player.id)
                    .count() as u16
            };
            player.stats.appearances += 1;
            player.stats.kills += kills as u32;
            player.stats.assists += ps.assists as u32;
            player.stats.minutes_played += minutes_played;
            player.stats.shots += ps.shots as u32;
            player.stats.shots_on_target += ps.shots_on_target as u32;
            player.stats.passes_completed += ps.passes_completed as u32;
            player.stats.passes_attempted += ps.passes_attempted as u32;
            player.stats.tackles_won += ps.tackles_won as u32;
            player.stats.interceptions += ps.interceptions as u32;

            let match_rating = if ps.rating > 0.0 {
                ps.rating
            } else {
                // Damage counts by share of the team's damage, centred on the role's par so
                // the rating keeps the scale it had when damage added nothing: par adds 0,
                // 1.5x par adds +0.5, half of par takes 0.5 off. Unmeasured adds 0.
                let damage_bonus = damage_vs_par(ps.damage_dealt, team_damage, ps.role)
                    .map_or(0.0, |ratio| (ratio - 1.0).clamp(-0.5, 0.5) as f32);
                // A series report sums every game's line, but the weights are per game: rate
                // the average game, as one appearance counts the whole series.
                let games = f32::from(games_in_report(report));
                6.0 + ((kills + ps.assists) as f32 / games * 0.35)
                    - (ps.deaths as f32 / games * 0.25)
                    + damage_bonus
            };
            if player.stats.appearances == 1 {
                player.stats.avg_rating = match_rating.clamp(0.0, 10.0);
            } else {
                let n = player.stats.appearances as f32;
                player.stats.avg_rating =
                    (player.stats.avg_rating * (n - 1.0) + match_rating.clamp(0.0, 10.0)) / n;
            }

            // clean_sheets removed — LoL has no keeper clean sheet stat (legacy).
        }
    }
}

/// Share of its team's damage a player of `role` is expected to deal.
///
/// Both match engines report damage on an abstract HP scale, so progression compares
/// shares, never absolute damage. Real pro shares (about Top 23%, Jungle 15%, Mid 27%,
/// ADC 28%, Support 7%) do not fit what the engines produce, so those would always or
/// never fire. These are the mean of the two engines' measured shares, equal weight:
///
/// | role    | background engine | live engine | expected |
/// |---------|-------------------|-------------|----------|
/// | Top     | 0.17              | 0.30        | 0.23     |
/// | Jungle  | 0.21              | 0.12        | 0.16     |
/// | Mid     | 0.23              | 0.26        | 0.24     |
/// | ADC     | 0.24              | 0.22        | 0.23     |
/// | Support | 0.16              | 0.12        | 0.14     |
///
/// Unknown role: an even fifth. Revisit when the engines' damage models settle.
fn expected_damage_share(role: Option<crate::engine::sim_background::LolRole>) -> f64 {
    match role {
        Some(crate::engine::sim_background::LolRole::Top) => 0.23,
        Some(crate::engine::sim_background::LolRole::Jungle) => 0.16,
        Some(crate::engine::sim_background::LolRole::Mid) => 0.24,
        Some(crate::engine::sim_background::LolRole::Adc) => 0.23,
        Some(crate::engine::sim_background::LolRole::Support) => 0.14,
        None => 0.20,
    }
}

/// The player's damage share relative to the role's expected share (1.0 = par), or
/// `None` when the team dealt no damage, which means damage was not measured.
fn damage_vs_par(
    damage: u32,
    team_damage: u32,
    role: Option<crate::engine::sim_background::LolRole>,
) -> Option<f64> {
    if team_damage == 0 {
        return None;
    }
    Some(f64::from(damage) / f64::from(team_damage) / expected_damage_share(role))
}

fn clamp_attr_range(value: i16) -> u8 {
    value.clamp(1, 99) as u8
}

fn scale_delta(delta: i16, num: i16, den: i16) -> i16 {
    (delta * num) / den.max(1)
}

/// Scales a positive delta by the attribute's headroom to `ceiling`, so growth fades
/// out inside the last `GAIN_TAPER_WINDOW` points and stops at the ceiling. Negative
/// deltas pass through; `tapered_loss` handles them.
///
/// Deltas are whole points, so the scaled value is rounded with `phase` (any per-match
/// counter) as a deterministic dither: over `GAIN_TAPER_WINDOW` consecutive phases the
/// gains add up to exactly `delta * headroom`, with no RNG.
fn tapered_gain(delta: i16, current: u8, ceiling: u8, phase: u32) -> i16 {
    if delta <= 0 {
        return delta;
    }
    let headroom = gain_headroom(current, ceiling);
    if headroom <= 0 {
        return 0;
    }
    if headroom >= GAIN_TAPER_WINDOW {
        return delta;
    }
    let dither = (phase % u32::from(GAIN_TAPER_WINDOW.unsigned_abs())) as i16;
    (delta * headroom + dither) / GAIN_TAPER_WINDOW
}

/// Scales a negative delta while the attribute is 1 to 9 points under `ceiling`, so a
/// player who keeps par near the cap does not slide away from it. The share is
/// `max(headroom, LOSS_TAPER_FLOOR) / GAIN_TAPER_WINDOW`, rounded with the same `phase`
/// dither as `tapered_gain`: over `GAIN_TAPER_WINDOW` consecutive phases the losses add
/// up to exactly `delta * share`, with no RNG. At or above the ceiling (a weak match at
/// the cap costs the full point) and 10 or more points under it, a loss is full.
/// Positive deltas pass through.
fn tapered_loss(delta: i16, current: u8, ceiling: u8, phase: u32) -> i16 {
    if delta >= 0 {
        return delta;
    }
    let headroom = i16::from(ceiling) - i16::from(current);
    if headroom <= 0 || headroom >= GAIN_TAPER_WINDOW {
        return delta;
    }
    let share = headroom.max(LOSS_TAPER_FLOOR);
    let dither = (phase % u32::from(GAIN_TAPER_WINDOW.unsigned_abs())) as i16;
    -((-delta * share + dither) / GAIN_TAPER_WINDOW)
}

/// Creep-score ratio at which a laner counts as clearly ahead of the lane opponent, per
/// role: the 80th percentile of r = (CS + 1) / (CS_opponent + 1) over every paired
/// player-game of the 2026 pro games in the SR0 reference data (`players_2026.jsonl.gz`:
/// 2,602 games, 2026-01-14 to 2026-11-14, 13,010 role pairings, 2,602 per role, both sides
/// counted). That file includes 222 qualifier and promotion games that SR0's own summaries
/// drop; on SR0's 2,380 games every cut moves by at most 0.004 (Support 1.2896, Top 1.1197,
/// Jungle 1.1712, Mid 1.1098, ADC 1.1049). Real farm at or above the cut
/// is 20% of player-games and at or below its inverse is 20%, so laning +1 and -1 fire
/// equally often. The rule compares two players of one game, so it holds on any engine's
/// CS scale. Script: OLManager-notes/research/laning-cs-relative-scripts/cut_points.py.
/// Support carries the loosest cut because its farm is near 1 CS a minute and noisy.
fn laning_cs_cut(role: crate::engine::sim_background::LolRole) -> f64 {
    use crate::engine::sim_background::LolRole;
    match role {
        LolRole::Top => 1.1214,
        LolRole::Jungle => 1.1733,
        LolRole::Mid => 1.1119,
        LolRole::Adc => 1.1061,
        LolRole::Support => 1.2857,
    }
}

/// The player's creep score against the same-role opponent's, as (CS + 1) / (CS_opp + 1).
/// The +1 keeps a zero-CS line finite. `None` when the role is unknown or the other side
/// has no same-role line in the report, which means laning is not measured.
fn lane_cs_ratio(
    creep_score: u16,
    role: Option<crate::engine::sim_background::LolRole>,
    opponents: &HashMap<crate::engine::sim_background::LolRole, LaneLine>,
) -> Option<f64> {
    let opponent = opponents.get(&role?)?.creep_score;
    Some((f64::from(creep_score) + 1.0) / (f64::from(opponent) + 1.0))
}

/// What one side's player of a role puts against the lane opponent, as the report counts it
/// (series totals on a series report; both sides of a ratio always share that unit).
#[derive(Clone, Copy)]
struct LaneLine {
    creep_score: u16,
    assists: u16,
}

/// Assist ratio at which a player counts as clearly out-shotcalling the lane opponent, per
/// role, as the exact fraction `(numerator, denominator)`: the 80th percentile of
/// r = (A + 1) / (A_opponent + 1) over every paired player-game of the 2026 pro games in
/// the SR0 reference data (`players_2026.jsonl.gz`, the same 2,602 games as
/// `laning_cs_cut`, 5,204 pairings per role with both sides counted). Top 8/3 (2.667),
/// Jungle, Mid and ADC 5/2, Support 13/5 (2.6). Real assists at or above the cut are
/// 20.1-21.5% of player-games and at or below its inverse the same share, so +1 and -1 fire
/// equally often. Assist counts are small integers, so the cut sits on exact ties: it is
/// kept as a fraction and compared by cross-multiplication. Like laning, the rule compares
/// two players of one game, so it holds on any engine's assist scale. Script:
/// OLManager-notes/research/par-asymmetry-scripts/real_cuts.py (PA1, 2026-11-16).
fn shotcalling_assist_cut(role: crate::engine::sim_background::LolRole) -> (u32, u32) {
    use crate::engine::sim_background::LolRole;
    match role {
        LolRole::Top => (8, 3),
        LolRole::Jungle | LolRole::Mid | LolRole::Adc => (5, 2),
        LolRole::Support => (13, 5),
    }
}

/// Shotcalling delta from the assists against the same-role opponent's: +1 when
/// (A + 1) / (A_opp + 1) is at or above the role's cut, -1 at or below its inverse, 0 in
/// between and when the lane is unmeasured. The +1 keeps a zero-assist line finite.
fn shotcalling_delta_vs_lane(
    assists: u16,
    role: Option<crate::engine::sim_background::LolRole>,
    opponents: &HashMap<crate::engine::sim_background::LolRole, LaneLine>,
) -> i16 {
    let Some(role) = role else {
        return 0;
    };
    let Some(opponent) = opponents.get(&role) else {
        return 0;
    };
    let (cut_num, cut_den) = shotcalling_assist_cut(role);
    let own = u32::from(assists) + 1;
    let other = u32::from(opponent.assists) + 1;
    if own * cut_den >= cut_num * other {
        1
    } else if own * cut_num <= cut_den * other {
        -1
    } else {
        0
    }
}

/// Laning delta from the lane CS ratio: +1 at or above the role's cut, -1 at or below its
/// inverse, 0 in between and when laning is unmeasured.
fn laning_delta_from_ratio(
    ratio: Option<f64>,
    role: Option<crate::engine::sim_background::LolRole>,
) -> i16 {
    let (Some(ratio), Some(role)) = (ratio, role) else {
        return 0;
    };
    let cut = laning_cs_cut(role);
    if ratio >= cut {
        1
    } else if ratio <= 1.0 / cut {
        -1
    } else {
        0
    }
}

/// Number of games a report covers: the series score, or one for a single game. Series
/// reports sum every game's line (`simulate_series`), so their counts are series totals.
fn games_in_report(report: &crate::engine::MatchReport) -> u8 {
    report.home_wins.saturating_add(report.away_wins).max(1)
}

/// A player's kills, deaths and assists in an average game of the report. The post-match
/// thresholds (`deaths_bad`, a kda of 2) are per game, so they only read this
/// view and never the raw series totals. For a single game it equals the report's counts.
#[derive(Clone, Copy)]
struct PerGame {
    kills: f64,
    deaths: f64,
    assists: f64,
}

impl PerGame {
    fn of(stats: &crate::engine::PlayerMatchStats, games: u8) -> Self {
        let games = f64::from(games);
        Self {
            kills: f64::from(stats.kills) / games,
            deaths: f64::from(stats.deaths) / games,
            assists: f64::from(stats.assists) / games,
        }
    }

    fn kda(self) -> f64 {
        (self.kills + self.assists) / self.deaths.max(1.0)
    }
}

fn apply_lol_profile_progression(
    game: &mut Game,
    report: &crate::engine::MatchReport,
    home_team_id: &str,
    away_team_id: &str,
) {
    // Creep score and assists of each side's player per role, so every player finds their
    // lane opponent in the other side's map. A side with two players of one role keeps the last.
    let mut home_lane: HashMap<crate::engine::sim_background::LolRole, LaneLine> = HashMap::new();
    let mut away_lane: HashMap<crate::engine::sim_background::LolRole, LaneLine> = HashMap::new();
    for player in &game.players {
        let side = match player.team_id.as_deref() {
            Some(team_id) if team_id == home_team_id => &mut home_lane,
            Some(team_id) if team_id == away_team_id => &mut away_lane,
            _ => continue,
        };
        if let Some(ps) = report.player_stats.get(&player.id)
            && let Some(role) = ps.role
        {
            side.insert(
                role,
                LaneLine {
                    creep_score: ps.creep_score,
                    assists: ps.assists,
                },
            );
        }
    }

    for player in game.players.iter_mut() {
        let tid = match player.team_id.as_deref() {
            Some(team_id) if team_id == home_team_id || team_id == away_team_id => team_id,
            _ => continue,
        };

        let Some(ps) = report.player_stats.get(&player.id) else {
            continue;
        };

        let minutes = (ps.duration_seconds as f64 / 60.0).max(1.0);
        let team_kills = if tid == home_team_id {
            report.home_stats.kills.max(1) as f64
        } else {
            report.away_stats.kills.max(1) as f64
        };

        let role = ps.role;
        let per_game = PerGame::of(ps, games_in_report(report));
        let kda = per_game.kda();
        let opponents = if tid == home_team_id {
            &away_lane
        } else {
            &home_lane
        };
        let lane_ratio = lane_cs_ratio(ps.creep_score, role, opponents);
        let team_damage = if tid == home_team_id {
            report.home_stats.damage_dealt
        } else {
            report.away_stats.damage_dealt
        };
        let vision_per_min = ps.vision_score as f64 / minutes;
        let kp = (ps.kills + ps.assists) as f64 / team_kills;

        let (exp_dmg, exp_vision, exp_kp, deaths_bad) = match role {
            Some(crate::engine::sim_background::LolRole::Top) => (560.0, 0.45, 0.42, 7_u16),
            Some(crate::engine::sim_background::LolRole::Jungle) => (520.0, 0.65, 0.52, 8_u16),
            Some(crate::engine::sim_background::LolRole::Mid) => (660.0, 0.55, 0.50, 7_u16),
            Some(crate::engine::sim_background::LolRole::Adc) => (740.0, 0.45, 0.50, 7_u16),
            Some(crate::engine::sim_background::LolRole::Support) => (340.0, 1.20, 0.56, 9_u16),
            None => (560.0, 0.55, 0.48, 8_u16),
        };

        // The thresholds below keep their old per-minute margins around `exp_dmg`; the
        // player's damage is its share of the team's against the role's par, rescaled onto
        // that axis. A report with no team damage is unmeasured and reads as par.
        let dmg_per_min =
            damage_vs_par(ps.damage_dealt, team_damage, role).unwrap_or(1.0) * exp_dmg;
        let bad = f64::from(deaths_bad);
        let bad_minus_1 = f64::from(deaths_bad.saturating_sub(1));
        let bad_plus_1 = f64::from(deaths_bad.saturating_add(1));
        let bad_plus_2 = f64::from(deaths_bad.saturating_add(2));
        let mechanics_delta: i16 = if dmg_per_min >= exp_dmg + 120.0 {
            1
        } else if dmg_per_min < exp_dmg - 150.0 && per_game.deaths >= bad {
            -1
        } else {
            0
        };
        let laning_delta = laning_delta_from_ratio(lane_ratio, role);
        let teamfighting_delta: i16 = if kp >= exp_kp + 0.08 && kda >= 2.0 {
            1
        } else if kp < exp_kp - 0.2 && per_game.deaths >= bad_minus_1 {
            -1
        } else {
            0
        };
        // Neither match engine models vision yet, so a line with no vision score
        // and no wards carries no information: it must not read as "bad vision".
        let vision_measured = ps.vision_score > 0 || ps.wards_placed > 0;
        let macro_delta: i16 = if !vision_measured {
            0
        } else if vision_per_min >= exp_vision + 0.25 {
            1
        } else if vision_per_min < exp_vision - 0.30 {
            -1
        } else {
            0
        };
        let consistency_delta: i16 = if per_game.deaths <= 2.0 && kda >= 2.0 {
            1
        } else if per_game.deaths >= bad {
            -1
        } else {
            0
        };
        let shotcalling_delta = shotcalling_delta_vs_lane(ps.assists, role, opponents);
        let champion_pool_delta: i16 = if kda >= 3.0 && lane_ratio.is_some_and(|ratio| ratio >= 1.0)
        {
            1
        } else if kda < 1.0 && per_game.deaths >= bad_minus_1 {
            -1
        } else {
            0
        };
        let discipline_delta: i16 =
            if per_game.deaths <= 2.0 && per_game.kills + per_game.assists >= 4.0 {
                1
            } else if per_game.deaths >= bad_plus_1 {
                -1
            } else {
                0
            };
        let mental_resilience_delta: i16 =
            if per_game.deaths >= 4.0 && per_game.kills + per_game.assists >= 8.0 {
                1
            } else if per_game.deaths >= bad_plus_2 {
                -1
            } else {
                0
            };

        let (mech_num, lane_num, macro_num, shot_num) = match role {
            Some(crate::engine::sim_background::LolRole::Support) => (1_i16, 0_i16, 2_i16, 2_i16),
            Some(crate::engine::sim_background::LolRole::Adc) => (2_i16, 2_i16, 1_i16, 1_i16),
            Some(crate::engine::sim_background::LolRole::Mid) => (2_i16, 2_i16, 1_i16, 1_i16),
            Some(crate::engine::sim_background::LolRole::Jungle) => (1_i16, 1_i16, 2_i16, 2_i16),
            Some(crate::engine::sim_background::LolRole::Top) => (1_i16, 1_i16, 1_i16, 1_i16),
            None => (1_i16, 1_i16, 1_i16, 1_i16),
        };

        let mut d_dribbling = scale_delta(mechanics_delta, mech_num, 2) + champion_pool_delta;
        let mut d_agility = scale_delta(mechanics_delta, mech_num, 2) + champion_pool_delta;
        let mut d_shooting = scale_delta(laning_delta, lane_num, 2);
        let mut d_positioning =
            scale_delta(laning_delta, lane_num, 2) + scale_delta(macro_delta, macro_num, 2);
        let mut d_teamwork = teamfighting_delta + mental_resilience_delta;
        let mut d_stamina = teamfighting_delta;
        let mut d_vision =
            scale_delta(macro_delta, macro_num, 2) + scale_delta(shotcalling_delta, shot_num, 2);
        let mut d_decisions =
            scale_delta(macro_delta, macro_num, 2) + consistency_delta + discipline_delta;
        let mut d_composure = consistency_delta + discipline_delta + mental_resilience_delta;
        let mut d_leadership = scale_delta(shotcalling_delta, shot_num, 2) + discipline_delta;
        let mut d_passing = champion_pool_delta + scale_delta(macro_delta, macro_num, 3);

        for delta in [
            &mut d_dribbling,
            &mut d_agility,
            &mut d_shooting,
            &mut d_positioning,
            &mut d_teamwork,
            &mut d_stamina,
            &mut d_vision,
            &mut d_decisions,
            &mut d_composure,
            &mut d_leadership,
            &mut d_passing,
        ] {
            *delta = (*delta).clamp(-2, 2);
        }

        // Attributes stop growing at the potential cap, like training does at OVR level.
        let ceiling = effective_potential_cap(player);
        let phase = player.stats.appearances;
        // A gain also waits while the rounded OVR sits at the cap, the same test as
        // `is_lol_training_capped`, re-read after every gain so a match cannot carry OVR
        // past it. Losses taper near the cap instead (`tapered_loss`).
        let grow = |player: &mut crate::domain::player::Player,
                    attribute: fn(&mut crate::domain::player::PlayerAttributes) -> &mut u8,
                    delta: i16,
                    slot: u32| {
            let phase = phase.wrapping_add(slot);
            let current = *attribute(&mut player.attributes);
            let change = if delta > 0 {
                if calculate_lol_ovr(player) >= ceiling {
                    0
                } else {
                    tapered_gain(delta, current, ceiling, phase)
                }
            } else {
                tapered_loss(delta, current, ceiling, phase)
            };
            let value = attribute(&mut player.attributes);
            *value = clamp_attr_range(i16::from(*value) + change);
        };

        grow(player, |a| &mut a.mechanics, d_dribbling, 0);
        grow(player, |a| &mut a.champion_pool, d_agility, 1);
        grow(player, |a| &mut a.laning, d_shooting, 2);
        grow(player, |a| &mut a.consistency, d_positioning, 3);
        grow(player, |a| &mut a.teamfighting, d_teamwork, 4);
        grow(player, |a| &mut a.mental_resilience, d_stamina, 5);
        grow(player, |a| &mut a.macro_play, d_vision, 6);
        grow(player, |a| &mut a.consistency, d_decisions, 7);
        grow(player, |a| &mut a.discipline, d_composure, 8);
        grow(player, |a| &mut a.shotcalling, d_leadership, 9);
        grow(player, |a| &mut a.teamfighting, d_passing, 10);
    }
}

fn resolve_post_match_promises(
    game: &mut Game,
    report: &crate::engine::MatchReport,
    home_team_id: &str,
    away_team_id: &str,
) {
    for player in game.players.iter_mut() {
        let Some(team_id) = player.team_id.as_deref() else {
            continue;
        };
        if team_id != home_team_id && team_id != away_team_id {
            continue;
        }

        let Some(promise) = player.morale_core.pending_promise.clone() else {
            continue;
        };

        let played = report.player_stats.contains_key(&player.id);

        match promise.kind {
            PlayerPromiseKind::PlayingTime => {
                if played {
                    player.morale_core.pending_promise = None;
                    player.morale_core.manager_trust =
                        (i16::from(player.morale_core.manager_trust) + 3).clamp(0, 100) as u8;

                    if player
                        .morale_core
                        .unresolved_issue
                        .as_ref()
                        .is_some_and(|issue| issue.category == PlayerIssueCategory::PlayingTime)
                    {
                        player.morale_core.unresolved_issue = None;
                    }
                } else if promise.matches_remaining <= 1 {
                    player.morale_core.pending_promise = None;
                    player.morale_core.manager_trust =
                        (i16::from(player.morale_core.manager_trust) - 12).clamp(0, 100) as u8;
                    player.morale_core.unresolved_issue = Some(PlayerIssue {
                        category: PlayerIssueCategory::PlayingTime,
                        severity: 75,
                    });
                } else {
                    player.morale_core.pending_promise =
                        Some(crate::domain::player::PlayerPromise {
                            kind: PlayerPromiseKind::PlayingTime,
                            matches_remaining: promise.matches_remaining - 1,
                        });
                }
            }
        }
    }
}

fn capped_positive_recovery(delta: i16, player: &crate::domain::player::Player) -> i16 {
    let Some(issue) = player.morale_core.unresolved_issue.as_ref() else {
        return delta;
    };

    if delta <= 0 {
        return delta;
    }

    if issue.severity >= 75 {
        return 0;
    }

    if issue.severity >= 50 {
        return ((delta + 1) / 2).max(1);
    }

    delta
}

/// Kills credited to `player_id` in the report's kill feed; the fallback for engines that
/// leave `PlayerMatchStats::kills` at zero.
fn kill_feed_kills(report: &crate::engine::MatchReport, player_id: &str) -> u16 {
    report
        .kill_feed
        .iter()
        .filter(|kill| kill.killer_id == player_id)
        .count() as u16
}

/// The individual part of a player's post-match morale change. The report carries series
/// sums, so it reads the player's average game (`feed_kills` stands in for the kills when
/// the stats row has none): a line that is worth the same in one game is worth the same in
/// a best-of-five, instead of growing with the number of games.
fn individual_morale_delta(
    stats: &crate::engine::PlayerMatchStats,
    feed_kills: u16,
    games: u8,
) -> i16 {
    let mut per_game = PerGame::of(stats, games);
    if stats.kills == 0 {
        per_game.kills = f64::from(feed_kills) / f64::from(games);
    }
    let mut delta = per_game.kills * 3.0 + per_game.assists * 2.0;
    if per_game.deaths >= 5.0 {
        delta -= 3.0;
    } else if per_game.kills + per_game.assists >= 6.0 {
        delta += 2.0;
    }
    delta.round() as i16
}

/// Update player morale based on match result and individual performance.
fn update_post_match_morale(
    game: &mut Game,
    report: &crate::engine::MatchReport,
    home_team_id: &str,
    away_team_id: &str,
) {
    use rand::RngExt;
    let mut rng = rand::rng();

    let home_won = report.home_wins > report.away_wins;
    let away_won = report.away_wins > report.home_wins;
    let games = games_in_report(report);

    for player in game.players.iter_mut() {
        let tid = match player.team_id.as_deref() {
            Some(t) if t == home_team_id || t == away_team_id => t.to_string(),
            _ => continue,
        };

        let is_home = tid == home_team_id;
        let base_morale = player.morale as i16;

        let goal_diff = (report.home_wins as i16 - report.away_wins as i16).abs();
        let result_delta: i16 = if (is_home && home_won) || (!is_home && away_won) {
            rng.random_range(3..=8)
        } else {
            let base_loss = rng.random_range(-5..=-2);
            let margin_penalty = (goal_diff - 1).max(0) * -3;
            base_loss + margin_penalty
        };

        let individual_delta = report.player_stats.get(&player.id).map_or(0, |ps| {
            individual_morale_delta(ps, kill_feed_kills(report, &player.id), games)
        });

        let total_delta = capped_positive_recovery(result_delta + individual_delta, player);
        let new_morale = (base_morale + total_delta).clamp(10, 100) as u8;
        player.morale = new_morale;
    }
}

/// Update team form vectors after a match result. Keeps last 5 results.
/// Also applies streak-based morale bonus/penalty to all players on teams with streaks.
fn update_team_form(
    game: &mut Game,
    report: &crate::engine::MatchReport,
    home_team_id: &str,
    away_team_id: &str,
) {
    use rand::RngExt;
    let mut rng = rand::rng();

    let home_result = if report.home_wins > report.away_wins {
        "W"
    } else if report.home_wins == report.away_wins {
        "D"
    } else {
        "L"
    };
    let away_result = if report.away_wins > report.home_wins {
        "W"
    } else if report.away_wins == report.home_wins {
        "D"
    } else {
        "L"
    };

    // Update form for both teams
    for (team_id_str, result) in [(home_team_id, home_result), (away_team_id, away_result)] {
        if let Some(team) = game.teams.iter_mut().find(|t| t.id == team_id_str) {
            team.form.push(result.to_string());
            if team.form.len() > 5 {
                team.form.remove(0);
            }
        }
    }

    // Apply streak-based morale bonus/penalty
    for team_id_str in [home_team_id, away_team_id] {
        let form = game
            .teams
            .iter()
            .find(|t| t.id == team_id_str)
            .map(|t| t.form.clone())
            .unwrap_or_default();

        if form.len() >= 3 {
            let last3: Vec<&str> = form.iter().rev().take(3).map(|s| s.as_str()).collect();
            let streak_delta: i16 = if last3.iter().all(|r| *r == "W") {
                rng.random_range(2..=5) // 3+ win streak: small global morale boost
            } else if last3.iter().all(|r| *r == "L") {
                rng.random_range(-10..=-5) // 3+ loss streak: significant morale drop
            } else {
                0
            };

            if streak_delta != 0 {
                for player in game.players.iter_mut() {
                    if player.team_id.as_deref() == Some(team_id_str) {
                        let base = player.morale as i16;
                        let adjusted_delta = capped_positive_recovery(streak_delta, player);
                        player.morale = (base + adjusted_delta).clamp(10, 100) as u8;
                    }
                }
            }
        }
    }
}

/// Minutes a player was on the map in the report. A series sums every game, so this is the
/// series total; it stays wide so a long best-of-five never wraps.
fn minutes_on_map(stats: &crate::engine::PlayerMatchStats) -> u32 {
    if stats.duration_seconds > 0 {
        stats.duration_seconds / 60
    } else {
        u32::from(stats.minutes_played)
    }
}

/// Condition points lost for `minutes` on the map. Round up so even a short stint costs at
/// least one point.
fn stamina_depletion(minutes: u32, mental_resilience: u8) -> u8 {
    let minutes_factor = f64::from(minutes) / 90.0;
    let stamina_factor = f64::from(mental_resilience) / 100.0;
    let base_depletion = 15.0 * (1.0 - stamina_factor * 0.25);
    (base_depletion * minutes_factor).ceil() as u8
}

fn deplete_match_stamina(game: &mut Game, team_id: &str, report: &crate::engine::MatchReport) {
    for player in game.players.iter_mut() {
        if player.team_id.as_deref() == Some(team_id) {
            let minutes = report
                .player_stats
                .get(&player.id)
                .map(minutes_on_map)
                .unwrap_or(0);
            if minutes == 0 {
                continue;
            }
            let depletion = stamina_depletion(minutes, player.attributes.mental_resilience);
            player.condition = player.condition.saturating_sub(depletion);

            if minutes >= 60 {
                use rand::RngExt;
                let mut rng = rand::rng();
                if rng.random_bool(0.5) && player.fitness < 100 {
                    player.fitness = player.fitness.saturating_add(1);
                }
            }
        }
    }
}

#[cfg(test)]
mod stamina_minutes_tests {
    use super::{minutes_on_map, stamina_depletion};
    use crate::engine::PlayerMatchStats;

    fn series_minutes(minutes: u32) -> u32 {
        minutes_on_map(&PlayerMatchStats {
            duration_seconds: minutes * 60,
            ..Default::default()
        })
    }

    #[test]
    fn a_series_of_two_hundred_and_sixty_minutes_should_not_wrap() {
        assert_eq!(series_minutes(260), 260);
    }

    #[test]
    fn a_longer_series_should_deplete_more_condition() {
        let depletion = |minutes| stamina_depletion(series_minutes(minutes), 50);
        assert!(depletion(260) > depletion(200));
    }

    #[test]
    fn a_single_game_should_keep_its_minutes() {
        assert_eq!(series_minutes(32), 32);
    }

    #[test]
    fn the_played_minutes_should_stand_in_when_the_duration_is_missing() {
        let stats = PlayerMatchStats {
            minutes_played: 45,
            ..Default::default()
        };
        assert_eq!(minutes_on_map(&stats), 45);
    }

    #[test]
    fn a_short_stint_should_cost_at_least_one_point() {
        assert_eq!(stamina_depletion(1, 100), 1);
    }
}

#[cfg(test)]
mod vision_progression_tests {
    use super::{apply_lol_profile_progression, expected_damage_share};
    use crate::clock::GameClock;
    use crate::domain::manager::Manager;
    use crate::domain::player::{LolRole as PlayerRole, Player, PlayerAttributes};
    use crate::engine::sim_background::LolRole;
    use crate::engine::{MatchReport, MatchReportEndReason, PlayerMatchStats, TeamStats};
    use crate::game::Game;
    use chrono::{TimeZone, Utc};
    use std::collections::HashMap;

    const MINUTES: u32 = 30;
    /// A team's damage in an engine report: the engines run on an abstract HP scale,
    /// a few hundred to a few thousand a game, nowhere near real-LoL 15,000 a player.
    const TEAM_DAMAGE: u32 = 4_000;

    fn team_stats(damage_dealt: u32) -> TeamStats {
        TeamStats {
            damage_dealt,
            ..TeamStats::default()
        }
    }

    /// Damage of a player who deals exactly the role's expected share of `TEAM_DAMAGE`.
    fn par_damage(role: LolRole) -> u32 {
        (expected_damage_share(Some(role)) * f64::from(TEAM_DAMAGE)).round() as u32
    }

    /// Attributes after one match: every attribute the vision term can reach.
    type Outcome = (u8, u8, u8, u8, u8, u8, u8, u8, u8);

    fn attrs() -> PlayerAttributes {
        PlayerAttributes {
            mechanics: 50,
            laning: 50,
            teamfighting: 50,
            macro_play: 50,
            consistency: 50,
            shotcalling: 50,
            champion_pool: 50,
            discipline: 50,
            mental_resilience: 50,
        }
    }

    fn outcome(role: LolRole, vision_score: u16, wards_placed: u16) -> Outcome {
        let position = match role {
            LolRole::Top => PlayerRole::Top,
            LolRole::Jungle => PlayerRole::Jungle,
            LolRole::Mid => PlayerRole::Mid,
            LolRole::Adc => PlayerRole::Adc,
            LolRole::Support => PlayerRole::Support,
        };
        let mut player = Player::new(
            "p1".to_string(),
            "P1".to_string(),
            "Player One".to_string(),
            "1998-03-15".to_string(),
            "England".to_string(),
            position,
            attrs(),
        );
        player.team_id = Some("home".to_string());

        let mut manager = Manager::new(
            "m".to_string(),
            "A".to_string(),
            "B".to_string(),
            "1980-01-01".to_string(),
            "England".to_string(),
        );
        manager.hire("home".to_string());
        let clock = GameClock::new(Utc.with_ymd_and_hms(2025, 8, 12, 12, 0, 0).unwrap());
        let mut game = Game::new(clock, manager, vec![], vec![player], vec![], vec![]);

        let stats = PlayerMatchStats {
            role: Some(role),
            duration_seconds: MINUTES * 60,
            kills: 2,
            deaths: 3,
            assists: 4,
            creep_score: 180,
            damage_dealt: par_damage(role),
            vision_score,
            wards_placed,
            ..Default::default()
        };
        let report = MatchReport {
            home_wins: 1,
            away_wins: 0,
            home_stats: team_stats(TEAM_DAMAGE),
            away_stats: TeamStats::default(),
            events: vec![],
            kill_feed: vec![],
            player_stats: HashMap::from([("p1".to_string(), stats)]),
            home_possession: 50.0,
            total_minutes: MINUTES as u8,
            game_duration_seconds: MINUTES * 60,
            ended_by: MatchReportEndReason::TimeLimit,
        };

        apply_lol_profile_progression(&mut game, &report, "home", "away");
        let a = &game.players[0].attributes;
        (
            a.mechanics,
            a.laning,
            a.teamfighting,
            a.macro_play,
            a.consistency,
            a.shotcalling,
            a.champion_pool,
            a.discipline,
            a.mental_resilience,
        )
    }

    /// Vision per minute well inside the neutral band of the role.
    fn neutral_vision(role: LolRole) -> u16 {
        match role {
            LolRole::Support => 36,
            LolRole::Jungle => 20,
            _ => 15,
        }
    }

    const ALL_ROLES: [LolRole; 5] = [
        LolRole::Top,
        LolRole::Jungle,
        LolRole::Mid,
        LolRole::Adc,
        LolRole::Support,
    ];

    #[test]
    fn unmeasured_vision_should_not_move_progression_for_any_role() {
        for role in ALL_ROLES {
            assert_eq!(
                outcome(role, 0, 0),
                outcome(role, neutral_vision(role), 0),
                "{role:?} drifted on a line with no vision data"
            );
        }
    }

    #[test]
    fn jungle_and_support_should_lose_vision_term_when_measured_vision_is_low() {
        for role in [LolRole::Jungle, LolRole::Support] {
            let neutral = outcome(role, neutral_vision(role), 0);
            let low = outcome(role, 1, 0);
            assert_eq!(low.3, neutral.3 - 1, "{role:?} macro_play");
            assert_eq!(low.4, neutral.4 - 2, "{role:?} consistency");
        }
    }

    #[test]
    fn jungle_and_support_should_gain_vision_term_when_measured_vision_is_high() {
        for role in [LolRole::Jungle, LolRole::Support] {
            let neutral = outcome(role, neutral_vision(role), 0);
            let high = outcome(role, 90, 0);
            assert_eq!(high.3, neutral.3 + 1, "{role:?} macro_play");
            assert_eq!(high.4, neutral.4 + 2, "{role:?} consistency");
        }
    }

    #[test]
    fn wards_alone_should_count_as_measured_vision() {
        let neutral = outcome(LolRole::Support, neutral_vision(LolRole::Support), 0);
        let low = outcome(LolRole::Support, 0, 3);
        assert_eq!(low.3, neutral.3 - 1);
    }

    #[test]
    fn top_mid_adc_should_ignore_the_vision_term_whatever_the_vision() {
        for role in [LolRole::Top, LolRole::Mid, LolRole::Adc] {
            let base = outcome(role, 0, 0);
            assert_eq!(base, outcome(role, 1, 0), "{role:?} low vision");
            assert_eq!(base, outcome(role, 90, 0), "{role:?} high vision");
        }
    }
}

#[cfg(test)]
mod progression_bound_tests {
    use super::{
        GAIN_TAPER_WINDOW, apply_lol_profile_progression, apply_player_stats,
        expected_damage_share, tapered_gain, tapered_loss,
    };
    use crate::clock::GameClock;
    use crate::domain::manager::Manager;
    use crate::domain::player::{LolRole as PlayerRole, Player, PlayerAttributes};
    use crate::engine::sim_background::LolRole;
    use crate::engine::{MatchReport, MatchReportEndReason, PlayerMatchStats, TeamStats};
    use crate::game::Game;
    use crate::potential::calculate_lol_ovr;
    use chrono::{TimeZone, Utc};
    use std::collections::HashMap;

    const MINUTES: u32 = 30;
    /// A team's damage in an engine report: the engines run on an abstract HP scale,
    /// a few hundred to a few thousand a game, nowhere near real-LoL 15,000 a player.
    const TEAM_DAMAGE: u32 = 4_000;

    fn team_stats(damage_dealt: u32) -> TeamStats {
        TeamStats {
            damage_dealt,
            ..TeamStats::default()
        }
    }

    /// Damage of a player who deals exactly the role's expected share of `TEAM_DAMAGE`.
    fn par_damage(role: LolRole) -> u32 {
        (expected_damage_share(Some(role)) * f64::from(TEAM_DAMAGE)).round() as u32
    }

    fn flat_attrs(level: u8) -> PlayerAttributes {
        PlayerAttributes {
            mechanics: level,
            laning: level,
            teamfighting: level,
            macro_play: level,
            consistency: level,
            shotcalling: level,
            champion_pool: level,
            discipline: level,
            mental_resilience: level,
        }
    }

    fn game_with_player(level: u8, potential_base: u8, potential_revealed: Option<u8>) -> Game {
        let mut player = Player::new(
            "p1".to_string(),
            "P1".to_string(),
            "Player One".to_string(),
            "1998-03-15".to_string(),
            "England".to_string(),
            PlayerRole::Mid,
            flat_attrs(level),
        );
        player.team_id = Some("home".to_string());
        player.potential_base = potential_base;
        player.potential_revealed = potential_revealed;

        let mut manager = Manager::new(
            "m".to_string(),
            "A".to_string(),
            "B".to_string(),
            "1980-01-01".to_string(),
            "England".to_string(),
        );
        manager.hire("home".to_string());
        let clock = GameClock::new(Utc.with_ymd_and_hms(2025, 8, 12, 12, 0, 0).unwrap());
        Game::new(clock, manager, vec![], vec![player], vec![], vec![])
    }

    fn report_for(stats: PlayerMatchStats) -> MatchReport {
        MatchReport {
            home_wins: 1,
            away_wins: 0,
            home_stats: team_stats(TEAM_DAMAGE),
            away_stats: TeamStats::default(),
            events: vec![],
            kill_feed: vec![],
            player_stats: HashMap::from([("p1".to_string(), stats)]),
            home_possession: 50.0,
            total_minutes: MINUTES as u8,
            game_duration_seconds: MINUTES * 60,
            ended_by: MatchReportEndReason::TimeLimit,
        }
    }

    /// A dominant game: every positive threshold of every role term is met.
    fn strong_report() -> MatchReport {
        report_for(PlayerMatchStats {
            role: Some(LolRole::Mid),
            duration_seconds: MINUTES * 60,
            kills: 9,
            deaths: 0,
            assists: 12,
            creep_score: 300,
            damage_dealt: 1_800,
            vision_score: 30,
            wards_placed: 6,
            ..Default::default()
        })
    }

    /// A losing game: deaths and missing farm trip every negative threshold.
    fn weak_report() -> MatchReport {
        report_for(PlayerMatchStats {
            role: Some(LolRole::Mid),
            duration_seconds: MINUTES * 60,
            kills: 0,
            deaths: 12,
            assists: 1,
            creep_score: 90,
            damage_dealt: 200,
            vision_score: 2,
            wards_placed: 0,
            ..Default::default()
        })
    }

    fn attribute_sum(game: &Game) -> u32 {
        let a = &game.players[0].attributes;
        [
            a.mechanics,
            a.laning,
            a.teamfighting,
            a.macro_play,
            a.consistency,
            a.shotcalling,
            a.champion_pool,
            a.discipline,
            a.mental_resilience,
        ]
        .iter()
        .map(|v| u32::from(*v))
        .sum()
    }

    #[test]
    fn player_far_below_potential_should_still_gain_from_a_strong_match() {
        let mut game = game_with_player(60, 99, None);
        let before = attribute_sum(&game);
        apply_lol_profile_progression(&mut game, &strong_report(), "home", "away");
        assert!(attribute_sum(&game) > before);
    }

    #[test]
    fn player_at_potential_should_not_gain_from_a_strong_match() {
        let mut game = game_with_player(80, 80, None);
        let before = attribute_sum(&game);
        apply_lol_profile_progression(&mut game, &strong_report(), "home", "away");
        assert_eq!(attribute_sum(&game), before);
    }

    #[test]
    fn player_at_revealed_potential_should_not_gain_when_base_potential_is_higher() {
        let mut game = game_with_player(80, 99, Some(80));
        let before = attribute_sum(&game);
        apply_lol_profile_progression(&mut game, &strong_report(), "home", "away");
        assert_eq!(attribute_sum(&game), before);
    }

    #[test]
    fn player_at_potential_should_still_lose_from_a_weak_match() {
        let mut game = game_with_player(80, 80, None);
        let before = attribute_sum(&game);
        apply_lol_profile_progression(&mut game, &weak_report(), "home", "away");
        assert!(attribute_sum(&game) < before);
    }

    #[test]
    fn many_strong_matches_should_not_push_ovr_past_potential() {
        let mut game = game_with_player(70, 85, None);
        for appearance in 1..=400 {
            game.players[0].stats.appearances = appearance;
            apply_lol_profile_progression(&mut game, &strong_report(), "home", "away");
        }
        assert!(calculate_lol_ovr(&game.players[0]) <= 85);
    }

    #[test]
    fn gain_should_pass_through_unchanged_outside_the_taper_window() {
        for phase in 0..GAIN_TAPER_WINDOW as u32 {
            assert_eq!(tapered_gain(2, 60, 99, phase), 2);
        }
    }

    #[test]
    fn gain_should_average_to_the_headroom_share_inside_the_window() {
        let window = GAIN_TAPER_WINDOW as u32;
        let total: i16 = (0..window)
            .map(|phase| tapered_gain(1, 95, 99, phase))
            .sum();
        // Headroom 4 of a 10 window: four matches out of ten keep the +1.
        assert_eq!(total, 4);
    }

    #[test]
    fn gain_should_vanish_at_or_above_the_ceiling() {
        for phase in 0..GAIN_TAPER_WINDOW as u32 {
            assert_eq!(tapered_gain(2, 85, 85, phase), 0);
            assert_eq!(tapered_gain(2, 90, 85, phase), 0);
        }
    }

    #[test]
    fn loss_should_never_be_tapered() {
        for phase in 0..GAIN_TAPER_WINDOW as u32 {
            assert_eq!(tapered_gain(-2, 85, 85, phase), -2);
            assert_eq!(tapered_gain(-1, 40, 85, phase), -1);
        }
    }

    #[test]
    fn gain_should_never_overshoot_the_ceiling() {
        for current in 70..=85_u8 {
            for phase in 0..GAIN_TAPER_WINDOW as u32 {
                let gained = i16::from(current) + tapered_gain(2, current, 85, phase);
                assert!(gained <= 85);
            }
        }
    }

    /// Total loss of one point over `GAIN_TAPER_WINDOW` consecutive phases.
    fn loss_over_a_window(current: u8, ceiling: u8) -> i16 {
        (0..GAIN_TAPER_WINDOW as u32)
            .map(|phase| tapered_loss(-1, current, ceiling, phase))
            .sum()
    }

    #[test]
    fn weak_match_at_the_cap_should_cost_the_full_point() {
        for phase in 0..GAIN_TAPER_WINDOW as u32 {
            assert_eq!(tapered_loss(-1, 85, 85, phase), -1);
            assert_eq!(tapered_loss(-2, 85, 85, phase), -2);
            assert_eq!(tapered_loss(-1, 90, 85, phase), -1);
        }
    }

    #[test]
    fn loss_one_or_two_under_the_cap_should_land_one_match_in_five() {
        // The floor holds the share at 2 of 10 for headroom 1 and 2.
        assert_eq!(loss_over_a_window(84, 85), -2);
        assert_eq!(loss_over_a_window(83, 85), -2);
    }

    #[test]
    fn loss_five_under_the_cap_should_land_one_match_in_two() {
        assert_eq!(loss_over_a_window(80, 85), -5);
    }

    #[test]
    fn loss_should_average_to_the_scaled_share_for_a_two_point_loss() {
        let total: i16 = (0..GAIN_TAPER_WINDOW as u32)
            .map(|phase| tapered_loss(-2, 80, 85, phase))
            .sum();
        assert_eq!(total, -10);
    }

    #[test]
    fn loss_ten_or_more_under_the_cap_should_be_full() {
        for phase in 0..GAIN_TAPER_WINDOW as u32 {
            assert_eq!(tapered_loss(-1, 75, 85, phase), -1);
            assert_eq!(tapered_loss(-2, 40, 85, phase), -2);
        }
    }

    #[test]
    fn gain_ten_or_more_under_the_cap_should_stay_full() {
        for phase in 0..GAIN_TAPER_WINDOW as u32 {
            assert_eq!(tapered_gain(1, 75, 85, phase), 1);
            assert_eq!(tapered_gain(2, 40, 85, phase), 2);
        }
    }

    #[test]
    fn positive_delta_should_pass_through_the_loss_taper() {
        for phase in 0..GAIN_TAPER_WINDOW as u32 {
            assert_eq!(tapered_loss(1, 84, 85, phase), 1);
        }
    }

    #[test]
    fn no_gain_should_land_while_ovr_is_at_the_cap_even_if_the_attribute_is_under_its_cap() {
        let mut game = game_with_player(82, 80, None);
        // The other eight attributes hold OVR at 81, over the cap of 80, while mechanics
        // sits 10 under it.
        game.players[0].attributes.mechanics = 70;
        assert!(calculate_lol_ovr(&game.players[0]) >= 80);
        let before = attribute_sum(&game);
        apply_lol_profile_progression(&mut game, &strong_report(), "home", "away");
        assert_eq!(attribute_sum(&game), before);
    }

    #[test]
    fn strong_matches_should_never_end_ovr_above_the_cap_when_one_attribute_starts_above_it() {
        let mut game = game_with_player(78, 80, None);
        game.players[0].attributes.mechanics = 90;
        for appearance in 1..=400 {
            game.players[0].stats.appearances = appearance;
            apply_lol_profile_progression(&mut game, &strong_report(), "home", "away");
            assert!(calculate_lol_ovr(&game.players[0]) <= 80);
        }
    }

    #[test]
    fn par_attribute_near_the_cap_should_stay_within_three_points_of_it() {
        // Equal +1 and -1 against one attribute at its cap, whichever phase the run
        // starts on. The OVR gate is the attribute itself here: no gain at the cap.
        for first_phase in 0..GAIN_TAPER_WINDOW as u32 {
            let mut attribute = 80_u8;
            for match_number in 0..200_u32 {
                let phase = first_phase + match_number;
                let change = if match_number % 2 == 0 {
                    tapered_loss(-1, attribute, 80, phase)
                } else if attribute >= 80 {
                    0
                } else {
                    tapered_gain(1, attribute, 80, phase)
                };
                attribute = (i16::from(attribute) + change) as u8;
            }
            assert!(attribute <= 80, "{attribute} passed the cap");
            assert!(80 - attribute <= 3, "{attribute} is over 3 under the cap");
        }
    }

    /// Mechanics after one Mid game with the given damage and deaths; every other
    /// term of the line is neutral for mechanics. `team_damage` 0 means unmeasured.
    fn mechanics_after(damage: u32, team_damage: u32, deaths: u16) -> u8 {
        let mut game = game_with_player(50, 90, None);
        let mut report = report_for(PlayerMatchStats {
            role: Some(LolRole::Mid),
            duration_seconds: MINUTES * 60,
            kills: 5,
            deaths,
            assists: 4,
            creep_score: 180,
            damage_dealt: damage,
            ..Default::default()
        });
        report.home_stats = team_stats(team_damage);
        apply_lol_profile_progression(&mut game, &report, "home", "away");
        game.players[0].attributes.mechanics
    }

    #[test]
    fn above_par_damage_share_should_raise_mechanics() {
        assert_eq!(mechanics_after(1_800, TEAM_DAMAGE, 3), 51);
    }

    #[test]
    fn par_damage_share_should_not_cost_mechanics_even_with_many_deaths() {
        assert_eq!(
            mechanics_after(par_damage(LolRole::Mid), TEAM_DAMAGE, 8),
            50
        );
    }

    #[test]
    fn far_below_par_damage_share_with_many_deaths_should_cost_mechanics() {
        assert_eq!(mechanics_after(200, TEAM_DAMAGE, 8), 49);
    }

    #[test]
    fn unmeasured_team_damage_should_not_cost_mechanics() {
        assert_eq!(mechanics_after(0, 0, 8), 50);
    }

    #[test]
    fn expected_damage_shares_should_add_up_to_the_whole_team() {
        let total: f64 = [
            LolRole::Top,
            LolRole::Jungle,
            LolRole::Mid,
            LolRole::Adc,
            LolRole::Support,
        ]
        .iter()
        .map(|role| expected_damage_share(Some(*role)))
        .sum();
        assert!((total - 1.0).abs() < 1e-9, "shares add up to {total}");
    }

    /// Fallback rating (no engine rating) of a Mid with 2 kills, 4 assists, 3 deaths
    /// whose team dealt `team_damage`; the kills/assists/deaths part is 7.35.
    fn fallback_rating(damage: u32, team_damage: u32) -> f32 {
        let mut game = game_with_player(50, 90, None);
        let mut report = report_for(PlayerMatchStats {
            role: Some(LolRole::Mid),
            duration_seconds: MINUTES * 60,
            kills: 2,
            deaths: 3,
            assists: 4,
            damage_dealt: damage,
            ..Default::default()
        });
        report.home_stats = team_stats(team_damage);
        apply_player_stats(&mut game, &report, "home", "away");
        game.players[0].stats.avg_rating
    }

    #[test]
    fn fallback_rating_should_add_nothing_for_a_par_damage_share() {
        let rating = fallback_rating(par_damage(LolRole::Mid), TEAM_DAMAGE);
        assert!((rating - 7.35).abs() < 0.01, "rating {rating}");
    }

    #[test]
    fn fallback_rating_should_credit_an_above_par_damage_share() {
        let rating = fallback_rating(par_damage(LolRole::Mid) * 3 / 2, TEAM_DAMAGE);
        assert!((rating - 7.85).abs() < 0.01, "rating {rating}");
    }

    #[test]
    fn fallback_rating_should_dock_a_below_par_damage_share() {
        let rating = fallback_rating(par_damage(LolRole::Mid) / 2, TEAM_DAMAGE);
        assert!((rating - 6.85).abs() < 0.01, "rating {rating}");
    }

    #[test]
    fn fallback_rating_should_ignore_unmeasured_damage() {
        let rating = fallback_rating(0, 0);
        assert!((rating - 7.35).abs() < 0.01, "rating {rating}");
    }

    #[test]
    fn fallback_rating_should_rate_a_series_by_its_average_game() {
        let mut game = game_with_player(50, 90, None);
        // Three games of the 2 kills, 3 deaths, 4 assists line above, summed as a series.
        let mut report = report_for(PlayerMatchStats {
            role: Some(LolRole::Mid),
            duration_seconds: MINUTES * 60 * 3,
            kills: 6,
            deaths: 9,
            assists: 12,
            ..Default::default()
        });
        report.home_wins = 2;
        report.away_wins = 1;
        report.home_stats = team_stats(0);
        apply_player_stats(&mut game, &report, "home", "away");
        let rating = game.players[0].stats.avg_rating;
        assert!((rating - 7.35).abs() < 0.01, "rating {rating}");
    }
}

#[cfg(test)]
mod series_morale_tests {
    use super::individual_morale_delta;
    use crate::engine::PlayerMatchStats;

    /// The report line of a series in which every game was `(kills, deaths, assists)`.
    fn series_line(per_game: (u16, u16, u16), games: u8) -> PlayerMatchStats {
        let games = u16::from(games);
        PlayerMatchStats {
            kills: per_game.0 * games,
            deaths: per_game.1 * games,
            assists: per_game.2 * games,
            ..Default::default()
        }
    }

    fn delta(per_game: (u16, u16, u16), games: u8) -> i16 {
        individual_morale_delta(&series_line(per_game, games), 0, games)
    }

    #[test]
    fn a_single_game_should_keep_its_individual_delta() {
        // 4 kills * 3 + 6 assists * 2 + 2 for a 10 kill-and-assist game.
        assert_eq!(delta((4, 2, 6), 1), 26);
    }

    #[test]
    fn the_same_per_game_line_should_give_the_same_delta_over_any_number_of_games() {
        let one = delta((4, 2, 6), 1);
        assert_eq!([2, 3, 5].map(|games| delta((4, 2, 6), games)), [one; 3]);
    }

    #[test]
    fn three_deaths_a_game_over_a_best_of_three_should_not_trip_the_fed_penalty() {
        // Nine summed deaths, but never more than three in a game: the +2 stays.
        assert_eq!(delta((3, 3, 4), 3), delta((3, 3, 4), 1));
    }

    #[test]
    fn five_deaths_in_every_game_should_still_trip_the_fed_penalty() {
        assert_eq!(delta((1, 5, 0), 3), 3 - 3);
    }

    #[test]
    fn the_kill_feed_should_stand_in_for_missing_kills_per_game() {
        let stats = PlayerMatchStats {
            assists: 18,
            ..Default::default()
        };
        // 12 feed kills over 3 games is 4 a game: 12 + 12 + 2.
        assert_eq!(individual_morale_delta(&stats, 12, 3), 26);
    }
}

#[cfg(test)]
mod laning_relative_tests {
    use super::apply_lol_profile_progression;
    use crate::clock::GameClock;
    use crate::domain::manager::Manager;
    use crate::domain::player::{LolRole as PlayerRole, Player, PlayerAttributes};
    use crate::engine::sim_background::LolRole;
    use crate::engine::{MatchReport, MatchReportEndReason, PlayerMatchStats, TeamStats};
    use crate::game::Game;
    use chrono::{TimeZone, Utc};
    use std::collections::HashMap;

    const MINUTES: u32 = 30;

    fn flat_attrs() -> PlayerAttributes {
        PlayerAttributes {
            mechanics: 50,
            laning: 50,
            teamfighting: 50,
            macro_play: 50,
            consistency: 50,
            shotcalling: 50,
            champion_pool: 50,
            discipline: 50,
            mental_resilience: 50,
        }
    }

    fn position(role: LolRole) -> PlayerRole {
        match role {
            LolRole::Top => PlayerRole::Top,
            LolRole::Jungle => PlayerRole::Jungle,
            LolRole::Mid => PlayerRole::Mid,
            LolRole::Adc => PlayerRole::Adc,
            LolRole::Support => PlayerRole::Support,
        }
    }

    fn player(id: &str, team: &str, role: LolRole) -> Player {
        let mut player = Player::new(
            id.to_string(),
            id.to_string(),
            format!("Player {id}"),
            "1998-03-15".to_string(),
            "England".to_string(),
            position(role),
            flat_attrs(),
        );
        player.team_id = Some(team.to_string());
        player.potential_base = 99;
        player
    }

    /// A line whose only meaningful input is creep score; kills, deaths and assists are
    /// neutral for every term except the champion pool, which the caller opts into.
    fn line(role: LolRole, creep_score: u16, deaths: u16) -> PlayerMatchStats {
        PlayerMatchStats {
            role: Some(role),
            duration_seconds: MINUTES * 60,
            kills: 5,
            deaths,
            assists: 4,
            creep_score,
            ..Default::default()
        }
    }

    /// `(laning, champion_pool)` of the home player "h" and the away player "a" after one
    /// match. `None` for the away side leaves it out of both the game and the report.
    fn play(
        home: (LolRole, PlayerMatchStats),
        away: Option<(LolRole, PlayerMatchStats)>,
    ) -> ((u8, u8), Option<(u8, u8)>) {
        let mut players = vec![player("h", "home", home.0)];
        let mut stats = HashMap::from([("h".to_string(), home.1)]);
        if let Some((role, line)) = away {
            players.push(player("a", "away", role));
            stats.insert("a".to_string(), line);
        }
        let manager = Manager::new(
            "m".to_string(),
            "A".to_string(),
            "B".to_string(),
            "1980-01-01".to_string(),
            "England".to_string(),
        );
        let clock = GameClock::new(Utc.with_ymd_and_hms(2025, 8, 12, 12, 0, 0).unwrap());
        let mut game = Game::new(clock, manager, vec![], players, vec![], vec![]);
        let report = MatchReport {
            home_wins: 1,
            away_wins: 0,
            home_stats: TeamStats::default(),
            away_stats: TeamStats::default(),
            events: vec![],
            kill_feed: vec![],
            player_stats: stats,
            home_possession: 50.0,
            total_minutes: MINUTES as u8,
            game_duration_seconds: MINUTES * 60,
            ended_by: MatchReportEndReason::TimeLimit,
        };
        apply_lol_profile_progression(&mut game, &report, "home", "away");
        let read = |p: &Player| (p.attributes.laning, p.attributes.champion_pool);
        let away_out = game.players.get(1).map(read);
        (read(&game.players[0]), away_out)
    }

    #[test]
    fn adc_at_four_cs_per_minute_against_an_equal_opponent_should_keep_laning() {
        let cs = 4 * MINUTES as u16;
        let (home, away) = play(
            (LolRole::Adc, line(LolRole::Adc, cs, 3)),
            Some((LolRole::Adc, line(LolRole::Adc, cs, 3))),
        );
        assert_eq!(home.0, 50);
        assert_eq!(away.unwrap().0, 50);
    }

    #[test]
    fn adc_at_ten_cs_per_minute_against_an_equal_opponent_should_keep_laning() {
        let cs = 10 * MINUTES as u16;
        let (home, _) = play(
            (LolRole::Adc, line(LolRole::Adc, cs, 3)),
            Some((LolRole::Adc, line(LolRole::Adc, cs, 3))),
        );
        assert_eq!(home.0, 50);
    }

    #[test]
    fn clear_cs_lead_should_raise_laning_for_the_winner_and_cost_the_opponent() {
        let (home, away) = play(
            (LolRole::Mid, line(LolRole::Mid, 300, 3)),
            Some((LolRole::Mid, line(LolRole::Mid, 200, 3))),
        );
        assert_eq!(home.0, 51);
        assert_eq!(away.unwrap().0, 49);
    }

    #[test]
    fn missing_same_role_opponent_should_keep_laning() {
        // Opposite lane is a different role, so there is no lane opponent.
        let (home, away) = play(
            (LolRole::Mid, line(LolRole::Mid, 300, 3)),
            Some((LolRole::Top, line(LolRole::Top, 100, 3))),
        );
        assert_eq!(home.0, 50);
        assert_eq!(away.unwrap().0, 50);
    }

    #[test]
    fn no_opponent_in_the_report_should_keep_laning() {
        let (home, _) = play((LolRole::Mid, line(LolRole::Mid, 300, 3)), None);
        assert_eq!(home.0, 50);
    }

    #[test]
    fn zero_cs_on_both_sides_should_keep_laning() {
        let (home, away) = play(
            (LolRole::Mid, line(LolRole::Mid, 0, 3)),
            Some((LolRole::Mid, line(LolRole::Mid, 0, 3))),
        );
        assert_eq!(home.0, 50);
        assert_eq!(away.unwrap().0, 50);
    }

    /// kills 5 + assists 4 over 2 deaths: kda 4.5, past the champion-pool bar of 3.
    #[test]
    fn good_kda_with_cs_at_least_even_should_raise_champion_pool() {
        let (home, _) = play(
            (LolRole::Adc, line(LolRole::Adc, 120, 2)),
            Some((LolRole::Adc, line(LolRole::Adc, 120, 2))),
        );
        assert_eq!(home.1, 51);
    }

    #[test]
    fn good_kda_with_cs_behind_the_opponent_should_not_raise_champion_pool() {
        let (home, _) = play(
            (LolRole::Adc, line(LolRole::Adc, 300, 2)),
            Some((LolRole::Adc, line(LolRole::Adc, 310, 2))),
        );
        assert_eq!(home.1, 50);
    }
}

#[cfg(test)]
mod series_units_tests {
    use super::apply_lol_profile_progression;
    use crate::clock::GameClock;
    use crate::domain::manager::Manager;
    use crate::domain::player::{LolRole as PlayerRole, Player, PlayerAttributes};
    use crate::engine::sim_background::LolRole;
    use crate::engine::{MatchReport, MatchReportEndReason, PlayerMatchStats, TeamStats};
    use crate::game::Game;
    use chrono::{TimeZone, Utc};
    use std::collections::HashMap;

    const ROLES: [LolRole; 5] = [
        LolRole::Top,
        LolRole::Jungle,
        LolRole::Mid,
        LolRole::Adc,
        LolRole::Support,
    ];
    /// Team kills of one game, so the kill-participation ratio is the same in every unit.
    const TEAM_KILLS_PER_GAME: u16 = 20;

    fn position(role: LolRole) -> PlayerRole {
        match role {
            LolRole::Top => PlayerRole::Top,
            LolRole::Jungle => PlayerRole::Jungle,
            LolRole::Mid => PlayerRole::Mid,
            LolRole::Adc => PlayerRole::Adc,
            LolRole::Support => PlayerRole::Support,
        }
    }

    fn flat_attrs() -> PlayerAttributes {
        PlayerAttributes {
            mechanics: 50,
            laning: 50,
            teamfighting: 50,
            macro_play: 50,
            consistency: 50,
            shotcalling: 50,
            champion_pool: 50,
            discipline: 50,
            mental_resilience: 50,
        }
    }

    /// The nine attributes of the lone home player after one report of `games` games in
    /// which every game had the per-game line `(kills, deaths, assists)`; the report
    /// carries the series sums, as `simulate_series` builds them.
    fn after_series(role: LolRole, per_game: (u16, u16, u16), games: u8) -> [u8; 9] {
        let mut player = Player::new(
            "h".to_string(),
            "h".to_string(),
            "Player h".to_string(),
            "1998-03-15".to_string(),
            "England".to_string(),
            position(role),
            flat_attrs(),
        );
        player.team_id = Some("home".to_string());
        player.potential_base = 99;
        let line = PlayerMatchStats {
            role: Some(role),
            duration_seconds: 30 * 60 * u32::from(games),
            kills: per_game.0 * u16::from(games),
            deaths: per_game.1 * u16::from(games),
            assists: per_game.2 * u16::from(games),
            creep_score: 200 * u16::from(games),
            ..Default::default()
        };
        let manager = Manager::new(
            "m".to_string(),
            "A".to_string(),
            "B".to_string(),
            "1980-01-01".to_string(),
            "England".to_string(),
        );
        let clock = GameClock::new(Utc.with_ymd_and_hms(2025, 8, 12, 12, 0, 0).unwrap());
        let mut game = Game::new(clock, manager, vec![], vec![player], vec![], vec![]);
        // A 2-1 or 3-0 series: the home side takes the majority of the games.
        let home_wins = games / 2 + 1;
        let report = MatchReport {
            home_wins,
            away_wins: games - home_wins,
            home_stats: TeamStats {
                kills: TEAM_KILLS_PER_GAME * u16::from(games),
                ..TeamStats::default()
            },
            away_stats: TeamStats::default(),
            events: vec![],
            kill_feed: vec![],
            player_stats: HashMap::from([("h".to_string(), line)]),
            home_possession: 50.0,
            total_minutes: 30,
            game_duration_seconds: 30 * 60 * u32::from(games),
            ended_by: MatchReportEndReason::TimeLimit,
        };
        apply_lol_profile_progression(&mut game, &report, "home", "away");
        let a = &game.players[0].attributes;
        [
            a.mechanics,
            a.laning,
            a.teamfighting,
            a.macro_play,
            a.consistency,
            a.shotcalling,
            a.champion_pool,
            a.discipline,
            a.mental_resilience,
        ]
    }

    /// Per-game lines that cross a threshold only when the series sum is read as one game.
    const LINES: [(u16, u16, u16); 6] = [
        (5, 3, 4),  // 3 deaths a game: 9 over a bo3, past every deaths_bad
        (5, 2, 4),  // 2 deaths a game: good consistency per game, 6 summed
        (1, 5, 1),  // poor line
        (8, 1, 12), // dominant line
        (3, 2, 9),
        (0, 0, 0),
    ];

    #[test]
    fn a_series_should_read_like_one_game_of_the_same_per_game_line() {
        for role in ROLES {
            for line in LINES {
                let single = after_series(role, line, 1);
                for games in [2, 3, 5] {
                    assert_eq!(
                        after_series(role, line, games),
                        single,
                        "{role:?} {line:?} over {games} games"
                    );
                }
            }
        }
    }

    #[test]
    fn three_deaths_a_game_over_a_best_of_three_should_not_cost_consistency() {
        // Mid: 9 summed deaths reach deaths_bad 7, but 3 a game never do.
        let after = after_series(LolRole::Mid, (5, 3, 4), 3);
        assert_eq!(after[4], 50);
    }

    /// Characterisation, recorded on 78fd260c before the unit change: single-game reports
    /// must give the same attributes after it. Shotcalling and macro_play are left out of
    /// the hash because the shotcalling rule changes in a later commit; no lane opponent
    /// is in the report, so laning stays unmeasured.
    #[test]
    fn single_game_reports_should_keep_their_recorded_outcome() {
        let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
        for role in ROLES {
            for kills in [0_u16, 2, 5, 9] {
                for deaths in 0..=10_u16 {
                    for assists in [0_u16, 3, 6, 9, 13] {
                        let attrs = after_series(role, (kills, deaths, assists), 1);
                        for (i, value) in attrs.into_iter().enumerate() {
                            if i == 3 || i == 5 {
                                continue;
                            }
                            hash = (hash ^ u64::from(value)).wrapping_mul(0x0100_0000_01b3);
                        }
                    }
                }
            }
        }
        assert_eq!(hash, 7_645_557_679_294_536_828);
    }
}

#[cfg(test)]
mod shotcalling_relative_tests {
    use super::{apply_lol_profile_progression, shotcalling_assist_cut};
    use crate::clock::GameClock;
    use crate::domain::manager::Manager;
    use crate::domain::player::{LolRole as PlayerRole, Player, PlayerAttributes};
    use crate::engine::sim_background::LolRole;
    use crate::engine::{MatchReport, MatchReportEndReason, PlayerMatchStats, TeamStats};
    use crate::game::Game;
    use chrono::{TimeZone, Utc};
    use std::collections::HashMap;

    fn position(role: LolRole) -> PlayerRole {
        match role {
            LolRole::Top => PlayerRole::Top,
            LolRole::Jungle => PlayerRole::Jungle,
            LolRole::Mid => PlayerRole::Mid,
            LolRole::Adc => PlayerRole::Adc,
            LolRole::Support => PlayerRole::Support,
        }
    }

    fn player(id: &str, team: &str, role: LolRole) -> Player {
        let level = 50;
        let mut player = Player::new(
            id.to_string(),
            id.to_string(),
            format!("Player {id}"),
            "1998-03-15".to_string(),
            "England".to_string(),
            position(role),
            PlayerAttributes {
                mechanics: level,
                laning: level,
                teamfighting: level,
                macro_play: level,
                consistency: level,
                shotcalling: level,
                champion_pool: level,
                discipline: level,
                mental_resilience: level,
            },
        );
        player.team_id = Some(team.to_string());
        player.potential_base = 99;
        player
    }

    /// Three deaths and a modest line keep the discipline, consistency and teamfighting
    /// terms at zero, so only the shotcalling term can move `macro_play` for a Support
    /// or Jungle (vision is unmeasured).
    fn line(role: LolRole, assists: u16) -> PlayerMatchStats {
        PlayerMatchStats {
            role: Some(role),
            duration_seconds: 30 * 60,
            kills: 1,
            deaths: 3,
            assists,
            creep_score: 200,
            ..Default::default()
        }
    }

    /// `macro_play` of the home player and, when there is one, the away player, after one
    /// game in which they have `home_assists` and `away_assists`.
    fn macro_play_after(
        role: LolRole,
        home_assists: u16,
        away: Option<(LolRole, u16)>,
    ) -> (u8, Option<u8>) {
        let mut players = vec![player("h", "home", role)];
        let mut stats = HashMap::from([("h".to_string(), line(role, home_assists))]);
        if let Some((away_role, assists)) = away {
            players.push(player("a", "away", away_role));
            stats.insert("a".to_string(), line(away_role, assists));
        }
        let manager = Manager::new(
            "m".to_string(),
            "A".to_string(),
            "B".to_string(),
            "1980-01-01".to_string(),
            "England".to_string(),
        );
        let clock = GameClock::new(Utc.with_ymd_and_hms(2025, 8, 12, 12, 0, 0).unwrap());
        let mut game = Game::new(clock, manager, vec![], players, vec![], vec![]);
        let report = MatchReport {
            home_wins: 1,
            away_wins: 0,
            home_stats: TeamStats {
                kills: 20,
                ..TeamStats::default()
            },
            away_stats: TeamStats {
                kills: 20,
                ..TeamStats::default()
            },
            events: vec![],
            kill_feed: vec![],
            player_stats: stats,
            home_possession: 50.0,
            total_minutes: 30,
            game_duration_seconds: 30 * 60,
            ended_by: MatchReportEndReason::TimeLimit,
        };
        apply_lol_profile_progression(&mut game, &report, "home", "away");
        (
            game.players[0].attributes.macro_play,
            game.players.get(1).map(|p| p.attributes.macro_play),
        )
    }

    fn support(home: u16, away: u16) -> (u8, Option<u8>) {
        macro_play_after(LolRole::Support, home, Some((LolRole::Support, away)))
    }

    #[test]
    fn support_at_par_with_the_opponent_should_keep_macro_play() {
        assert_eq!(support(6, 6), (50, Some(50)));
    }

    #[test]
    fn support_with_a_ratio_between_the_cuts_should_keep_macro_play() {
        // 12 against 9 assists: (13 / 10) is under 2.6 and over 1 / 2.6.
        assert_eq!(support(12, 9), (50, Some(50)));
        assert_eq!(support(9, 12), (50, Some(50)));
    }

    #[test]
    fn support_far_above_the_opponent_should_gain_macro_play_and_the_opponent_lose_it() {
        assert_eq!(support(20, 4), (51, Some(49)));
    }

    #[test]
    fn support_far_below_the_opponent_should_lose_macro_play() {
        assert_eq!(support(4, 20), (49, Some(51)));
    }

    #[test]
    fn support_exactly_on_the_top_cut_should_gain_macro_play() {
        // 12 against 4 assists: 13 / 5 is the Support cut, 2.6 exactly.
        assert_eq!(support(12, 4), (51, Some(49)));
    }

    #[test]
    fn support_just_under_the_top_cut_should_keep_macro_play() {
        assert_eq!(support(11, 4), (50, Some(50)));
    }

    #[test]
    fn zero_assists_against_an_opponent_with_none_should_keep_macro_play() {
        assert_eq!(support(0, 0), (50, Some(50)));
    }

    #[test]
    fn a_couple_of_assists_against_none_should_gain_macro_play() {
        // (2 + 1) / (0 + 1) = 3, past 2.6.
        assert_eq!(support(2, 0), (51, Some(49)));
    }

    #[test]
    fn jungle_far_above_the_opponent_should_gain_macro_play() {
        let (home, away) = macro_play_after(LolRole::Jungle, 20, Some((LolRole::Jungle, 4)));
        assert_eq!((home, away), (51, Some(49)));
    }

    #[test]
    fn no_same_role_opponent_should_keep_macro_play() {
        let (home, _) = macro_play_after(LolRole::Support, 20, Some((LolRole::Adc, 0)));
        assert_eq!(home, 50);
        let (alone, _) = macro_play_after(LolRole::Support, 20, None);
        assert_eq!(alone, 50);
    }

    #[test]
    fn every_cut_should_sit_above_one_and_come_from_the_recorded_table() {
        let cuts = [
            (LolRole::Top, (8, 3)),
            (LolRole::Jungle, (5, 2)),
            (LolRole::Mid, (5, 2)),
            (LolRole::Adc, (5, 2)),
            (LolRole::Support, (13, 5)),
        ];
        for (role, cut) in cuts {
            assert_eq!(shotcalling_assist_cut(role), cut);
            assert!(cut.0 > cut.1);
        }
    }
}

#[cfg(test)]
mod compact_report_tests {
    use super::compact_match_report;
    use crate::engine::{MatchReport, MatchReportEndReason};

    fn report(total_minutes: u8, game_duration_seconds: u32) -> MatchReport {
        MatchReport {
            home_wins: 2,
            away_wins: 1,
            home_stats: Default::default(),
            away_stats: Default::default(),
            events: Vec::new(),
            kill_feed: Vec::new(),
            player_stats: Default::default(),
            home_possession: 50.0,
            total_minutes,
            game_duration_seconds,
            ended_by: MatchReportEndReason::NexusDestroyed,
        }
    }

    #[test]
    fn a_series_report_should_compact_to_its_summed_minutes() {
        // The merged series keeps the last game's minutes beside the summed duration.
        let compact = compact_match_report(&report(31, 95 * 60));
        assert_eq!(compact.total_minutes, 95);
    }

    #[test]
    fn a_single_game_should_keep_its_minutes() {
        let compact = compact_match_report(&report(31, 31 * 60));
        assert_eq!(compact.total_minutes, 31);
    }

    #[test]
    fn a_report_without_a_duration_should_keep_its_minutes() {
        let compact = compact_match_report(&report(31, 0));
        assert_eq!(compact.total_minutes, 31);
    }
}
