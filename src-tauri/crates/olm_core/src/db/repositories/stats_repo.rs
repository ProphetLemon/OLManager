use crate::domain::league::MatchType;
use crate::domain::stats::{
    LolRole, MatchOutcome, PlayerMatchStatsRecord, StatsState, TeamMatchStatsRecord, TeamSide,
};
use rusqlite::{Connection, OptionalExtension, params};

const LOL_PLAYER_TABLE: &str = "lol_player_match_stats";
const LOL_TEAM_TABLE: &str = "lol_team_match_stats";

fn match_type_to_string(match_type: &MatchType) -> String {
    match match_type {
        MatchType::League => "League".to_string(),
        MatchType::Friendly => "Friendly".to_string(),
        MatchType::PreseasonTournament => "PreseasonTournament".to_string(),
        MatchType::Playoffs => "Playoffs".to_string(),
    }
}

fn parse_match_type(value: &str) -> MatchType {
    match value {
        "Friendly" => MatchType::Friendly,
        "PreseasonTournament" => MatchType::PreseasonTournament,
        "Playoffs" => MatchType::Playoffs,
        _ => MatchType::League,
    }
}

fn team_side_to_string(side: TeamSide) -> &'static str {
    match side {
        TeamSide::Blue => "Blue",
        TeamSide::Red => "Red",
    }
}

fn parse_team_side(value: &str) -> TeamSide {
    match value {
        "Red" | "Away" => TeamSide::Red,
        _ => TeamSide::Blue,
    }
}

fn match_outcome_to_string(result: MatchOutcome) -> &'static str {
    match result {
        MatchOutcome::Win => "Win",
        MatchOutcome::Loss => "Loss",
    }
}

fn parse_match_outcome(value: &str) -> MatchOutcome {
    match value {
        "Win" => MatchOutcome::Win,
        // Compatibilidad legacy: Draw deja de ser válido y se degrada a Loss.
        "Loss" | "Draw" => MatchOutcome::Loss,
        _ => MatchOutcome::Loss,
    }
}

fn lol_role_to_string(role: LolRole) -> &'static str {
    match role {
        LolRole::Top => "Top",
        LolRole::Jungle => "Jungle",
        LolRole::Mid => "Mid",
        LolRole::Adc => "Adc",
        LolRole::Support => "Support",
        LolRole::Unknown => "Unknown",
    }
}

fn parse_lol_role(value: &str) -> LolRole {
    match value {
        "Top" => LolRole::Top,
        "Jungle" => LolRole::Jungle,
        "Mid" => LolRole::Mid,
        "Adc" | "ADC" => LolRole::Adc,
        "Support" => LolRole::Support,
        _ => LolRole::Unknown,
    }
}

struct LegacyScoreProjection {
    home_team_id: String,
    away_team_id: String,
    home_wins: u8,
    away_wins: u8,
}

/// Legacy compatibility bridge for football-first columns.
/// Used only for explicit import/fallback, not as primary path.
fn project_legacy_scoreline(
    team_id: &str,
    opponent_team_id: &str,
    side: TeamSide,
    result: MatchOutcome,
) -> LegacyScoreProjection {
    match (side, result) {
        (TeamSide::Blue, MatchOutcome::Win) => LegacyScoreProjection {
            home_team_id: team_id.to_string(),
            away_team_id: opponent_team_id.to_string(),
            home_wins: 1,
            away_wins: 0,
        },
        (TeamSide::Blue, MatchOutcome::Loss) => LegacyScoreProjection {
            home_team_id: team_id.to_string(),
            away_team_id: opponent_team_id.to_string(),
            home_wins: 0,
            away_wins: 1,
        },
        (TeamSide::Red, MatchOutcome::Win) => LegacyScoreProjection {
            home_team_id: opponent_team_id.to_string(),
            away_team_id: team_id.to_string(),
            home_wins: 0,
            away_wins: 1,
        },
        (TeamSide::Red, MatchOutcome::Loss) => LegacyScoreProjection {
            home_team_id: opponent_team_id.to_string(),
            away_team_id: team_id.to_string(),
            home_wins: 1,
            away_wins: 0,
        },
    }
}

fn saturating_u8(value: u16) -> u8 {
    value.min(u16::from(u8::MAX)) as u8
}

fn has_table(conn: &Connection, table_name: &str) -> Result<bool, String> {
    let exists = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1 LIMIT 1",
            [table_name],
            |row| row.get::<_, i32>(0),
        )
        .optional()
        .map_err(|e| format!("Failed to inspect sqlite schema for {}: {}", table_name, e))?
        .is_some();
    Ok(exists)
}

fn load_stats_state_from_lol_tables(conn: &Connection) -> Result<StatsState, String> {
    let mut player_stmt = conn
        .prepare(
            "SELECT fixture_id, season, matchday, date, competition, player_id, team_id,
                    opponent_team_id, side, result, role, champion_id, duration_seconds,
                    kills, deaths, assists, creep_score, gold_earned, damage_dealt,
                    vision_score, wards_placed, bans_json
               FROM lol_player_match_stats
               ORDER BY date, matchday, fixture_id, player_id",
        )
        .map_err(|e| format!("Failed to prepare lol_player_match_stats query: {}", e))?;

    let player_rows = player_stmt
        .query_map([], |row| {
            Ok(PlayerMatchStatsRecord {
                fixture_id: row.get(0)?,
                season: row.get(1)?,
                matchday: row.get(2)?,
                date: row.get(3)?,
                match_type: parse_match_type(&row.get::<_, String>(4)?),
                player_id: row.get(5)?,
                team_id: row.get(6)?,
                opponent_team_id: row.get(7)?,
                side: parse_team_side(&row.get::<_, String>(8)?),
                result: parse_match_outcome(&row.get::<_, String>(9)?),
                role: parse_lol_role(&row.get::<_, String>(10)?),
                champion: row.get(11)?,
                duration_seconds: row.get(12)?,
                kills: row.get(13)?,
                deaths: row.get(14)?,
                assists: row.get(15)?,
                creep_score: row.get(16)?,
                gold_earned: row.get(17)?,
                damage_dealt: row.get(18)?,
                vision_score: row.get(19)?,
                wards_placed: row.get(20)?,
                bans_json: row.get(21).unwrap_or_default(),
                games: 1,
            })
        })
        .map_err(|e| format!("Failed to query lol_player_match_stats: {}", e))?;

    let mut player_matches = Vec::new();
    for row in player_rows {
        player_matches
            .push(row.map_err(|e| format!("Failed to read lol_player_match_stats row: {}", e))?);
    }

    let mut team_stmt = conn
        .prepare(
            "SELECT fixture_id, season, matchday, date, competition, team_id, opponent_team_id,
                    side, result, duration_seconds, kills, deaths, gold_earned,
                    damage_dealt, objectives
               FROM lol_team_match_stats
               ORDER BY date, matchday, fixture_id, team_id",
        )
        .map_err(|e| format!("Failed to prepare lol_team_match_stats query: {}", e))?;

    let team_rows = team_stmt
        .query_map([], |row| {
            Ok(TeamMatchStatsRecord {
                fixture_id: row.get(0)?,
                season: row.get(1)?,
                matchday: row.get(2)?,
                date: row.get(3)?,
                match_type: parse_match_type(&row.get::<_, String>(4)?),
                team_id: row.get(5)?,
                opponent_team_id: row.get(6)?,
                side: parse_team_side(&row.get::<_, String>(7)?),
                result: parse_match_outcome(&row.get::<_, String>(8)?),
                duration_seconds: row.get(9)?,
                kills: row.get(10)?,
                deaths: row.get(11)?,
                gold_earned: row.get(12)?,
                damage_dealt: row.get(13)?,
                objectives: row.get(14)?,
                games: 1,
            })
        })
        .map_err(|e| format!("Failed to query lol_team_match_stats: {}", e))?;

    let mut team_matches = Vec::new();
    for row in team_rows {
        team_matches
            .push(row.map_err(|e| format!("Failed to read lol_team_match_stats row: {}", e))?);
    }

    Ok(StatsState {
        player_matches,
        team_matches,
    })
}

/// Explicit legacy compatibility: read from football-first tables when
/// the database does not have the pure LoL schema (old DBs without v021).
fn load_stats_state_from_legacy_tables(conn: &Connection) -> Result<StatsState, String> {
    let mut player_stmt = conn
        .prepare(
            "SELECT fixture_id, season, matchday, date, competition, player_id, team_id,
                    opponent_team_id, side, result, role, champion_id,
                    minutes_played, goals, assists, shots, shots_on_target, passes_completed,
                    passes_attempted, duration_seconds, kills, deaths, creep_score, gold_earned,
                    damage_dealt, vision_score, wards_placed
               FROM player_match_stats
               ORDER BY date, matchday, fixture_id, player_id",
        )
        .map_err(|e| format!("Failed to prepare legacy player_match_stats query: {}", e))?;

    let player_rows = player_stmt
        .query_map([], |row| {
            let duration_seconds: u32 = row.get(19)?;
            let minutes_played: u32 = row.get(12)?;
            let kills: u16 = row.get(20)?;
            let deaths: u16 = row.get(21)?;
            let assists: u16 = row.get(14)?;
            let creep_score: u16 = row.get(22)?;
            let gold_earned: u32 = row.get(23)?;
            let damage_dealt: u32 = row.get(24)?;
            let vision_score: u16 = row.get(25)?;
            let wards_placed: u16 = row.get(26)?;

            Ok(PlayerMatchStatsRecord {
                fixture_id: row.get(0)?,
                season: row.get(1)?,
                matchday: row.get(2)?,
                date: row.get(3)?,
                match_type: parse_match_type(&row.get::<_, String>(4)?),
                player_id: row.get(5)?,
                team_id: row.get(6)?,
                opponent_team_id: row.get(7)?,
                side: parse_team_side(&row.get::<_, String>(8)?),
                result: parse_match_outcome(&row.get::<_, String>(9)?),
                role: parse_lol_role(&row.get::<_, String>(10)?),
                champion: row.get(11)?,
                duration_seconds: if duration_seconds > 0 {
                    duration_seconds
                } else {
                    minutes_played.saturating_mul(60)
                },
                kills,
                deaths,
                assists,
                creep_score,
                gold_earned,
                damage_dealt,
                vision_score,
                wards_placed,
                bans_json: String::new(),
                games: 1,
            })
        })
        .map_err(|e| format!("Failed to query legacy player_match_stats: {}", e))?;

    let mut player_matches = Vec::new();
    for row in player_rows {
        player_matches
            .push(row.map_err(|e| format!("Failed to read legacy player_match_stats row: {}", e))?);
    }

    let mut team_stmt = conn
        .prepare(
            "SELECT fixture_id, season, matchday, date, competition, team_id, opponent_team_id,
                    side, result, duration_seconds, kills, deaths, gold_earned,
                    damage_dealt, objectives, shots, shots_on_target, passes_attempted,
                    passes_completed, tackles_won
               FROM team_match_stats
               ORDER BY date, matchday, fixture_id, team_id",
        )
        .map_err(|e| format!("Failed to prepare legacy team_match_stats query: {}", e))?;

    let team_rows = team_stmt
        .query_map([], |row| {
            let duration_seconds: u32 = row.get(9)?;
            let kills: u16 = row.get(10)?;
            let deaths: u16 = row.get(11)?;
            let gold_earned: u32 = row.get(12)?;
            let damage_dealt: u32 = row.get(13)?;
            let objectives: u16 = row.get(14)?;

            Ok(TeamMatchStatsRecord {
                fixture_id: row.get(0)?,
                season: row.get(1)?,
                matchday: row.get(2)?,
                date: row.get(3)?,
                match_type: parse_match_type(&row.get::<_, String>(4)?),
                team_id: row.get(5)?,
                opponent_team_id: row.get(6)?,
                side: parse_team_side(&row.get::<_, String>(7)?),
                result: parse_match_outcome(&row.get::<_, String>(8)?),
                duration_seconds,
                kills: if kills > 0 { kills } else { row.get(15)? },
                deaths: if deaths > 0 { deaths } else { row.get(16)? },
                gold_earned: if gold_earned > 0 {
                    gold_earned
                } else {
                    row.get(17)?
                },
                damage_dealt: if damage_dealt > 0 {
                    damage_dealt
                } else {
                    row.get(18)?
                },
                objectives: if objectives > 0 {
                    objectives
                } else {
                    row.get(19)?
                },
                games: 1,
            })
        })
        .map_err(|e| format!("Failed to query legacy team_match_stats: {}", e))?;

    let mut team_matches = Vec::new();
    for row in team_rows {
        team_matches
            .push(row.map_err(|e| format!("Failed to read legacy team_match_stats row: {}", e))?);
    }

    Ok(StatsState {
        player_matches,
        team_matches,
    })
}

fn replace_lol_stats_state(conn: &Connection, stats: &StatsState) -> Result<(), String> {
    conn.execute("DELETE FROM lol_player_match_stats", [])
        .map_err(|e| format!("Failed to clear lol_player_match_stats: {}", e))?;
    conn.execute("DELETE FROM lol_team_match_stats", [])
        .map_err(|e| format!("Failed to clear lol_team_match_stats: {}", e))?;

    for record in &stats.player_matches {
        conn.execute(
            "INSERT INTO lol_player_match_stats (
                fixture_id, season, matchday, date, competition, player_id, team_id,
                opponent_team_id, side, result, role, champion_id, duration_seconds,
                kills, deaths, assists, creep_score, gold_earned, damage_dealt,
                vision_score, wards_placed, bans_json
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)",
            params![
                record.fixture_id,
                record.season,
                record.matchday,
                record.date,
                match_type_to_string(&record.match_type),
                record.player_id,
                record.team_id,
                record.opponent_team_id,
                team_side_to_string(record.side),
                match_outcome_to_string(record.result),
                lol_role_to_string(record.role),
                record.champion,
                record.duration_seconds,
                record.kills,
                record.deaths,
                record.assists,
                record.creep_score,
                record.gold_earned,
                record.damage_dealt,
                record.vision_score,
                record.wards_placed,
                record.bans_json,
            ],
        )
        .map_err(|e| format!("Failed to insert lol_player_match_stats row: {}", e))?;
    }

    for record in &stats.team_matches {
        conn.execute(
            "INSERT INTO lol_team_match_stats (
                fixture_id, season, matchday, date, competition, team_id, opponent_team_id,
                side, result, duration_seconds, kills, deaths, gold_earned, damage_dealt,
                objectives
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![
                record.fixture_id,
                record.season,
                record.matchday,
                record.date,
                match_type_to_string(&record.match_type),
                record.team_id,
                record.opponent_team_id,
                team_side_to_string(record.side),
                match_outcome_to_string(record.result),
                record.duration_seconds,
                record.kills,
                record.deaths,
                record.gold_earned,
                record.damage_dealt,
                record.objectives,
            ],
        )
        .map_err(|e| format!("Failed to insert lol_team_match_stats row: {}", e))?;
    }

    Ok(())
}

/// Legacy write-path explícito para import/migración. NO usar como ruta principal.
fn mirror_lol_stats_into_legacy_tables(
    conn: &Connection,
    stats: &StatsState,
) -> Result<(), String> {
    conn.execute("DELETE FROM player_match_stats", [])
        .map_err(|e| format!("Failed to clear player_match_stats: {}", e))?;
    conn.execute("DELETE FROM team_match_stats", [])
        .map_err(|e| format!("Failed to clear team_match_stats: {}", e))?;

    for record in &stats.player_matches {
        let legacy_projection = project_legacy_scoreline(
            &record.team_id,
            &record.opponent_team_id,
            record.side,
            record.result,
        );

        conn.execute(
            "INSERT INTO player_match_stats (
                fixture_id, season, matchday, date, competition, player_id, team_id,
                opponent_team_id, home_team_id, away_team_id, home_goals, away_goals,
                side, result, role, champion_id, champion_win,
                minutes_played, goals, assists, shots, shots_on_target, passes_completed,
                passes_attempted, tackles_won, interceptions, fouls_committed, duration_seconds,
                kills, deaths, creep_score, gold_earned, damage_dealt, vision_score,
                wards_placed,
                yellow_cards, red_cards, rating
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30, ?31, ?32, ?33, ?34, ?35, ?36, ?37, ?38)",
            params![
                record.fixture_id,
                record.season,
                record.matchday,
                record.date,
                match_type_to_string(&record.match_type),
                record.player_id,
                record.team_id,
                record.opponent_team_id,
                legacy_projection.home_team_id,
                legacy_projection.away_team_id,
                legacy_projection.home_wins,
                legacy_projection.away_wins,
                team_side_to_string(record.side),
                match_outcome_to_string(record.result),
                lol_role_to_string(record.role),
                record.champion,
                None::<i64>,
                (record.duration_seconds / 60).min(u32::from(u8::MAX)) as u8,
                saturating_u8(record.kills),
                saturating_u8(record.assists),
                saturating_u8(record.creep_score),
                saturating_u8(record.deaths),
                saturating_u8(record.vision_score),
                saturating_u8(record.wards_placed),
                0_u8,
                0_u8,
                0_u8,
                record.duration_seconds,
                record.kills,
                record.deaths,
                record.creep_score,
                record.gold_earned,
                record.damage_dealt,
                record.vision_score,
                record.wards_placed,
                0_u8,
                0_u8,
                0.0_f32,
            ],
        )
        .map_err(|e| format!("Failed to insert player_match_stats row: {}", e))?;
    }

    for record in &stats.team_matches {
        let legacy_projection = project_legacy_scoreline(
            &record.team_id,
            &record.opponent_team_id,
            record.side,
            record.result,
        );

        conn.execute(
            "INSERT INTO team_match_stats (
                fixture_id, season, matchday, date, competition, team_id, opponent_team_id,
                home_team_id, away_team_id, goals_for, goals_against, side, result, possession_pct,
                shots, shots_on_target, passes_completed, passes_attempted, tackles_won,
                interceptions, fouls_committed, duration_seconds, kills, deaths, gold_earned,
                damage_dealt, objectives, yellow_cards, red_cards
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29)",
            params![
                record.fixture_id,
                record.season,
                record.matchday,
                record.date,
                match_type_to_string(&record.match_type),
                record.team_id,
                record.opponent_team_id,
                legacy_projection.home_team_id,
                legacy_projection.away_team_id,
                legacy_projection.home_wins,
                legacy_projection.away_wins,
                team_side_to_string(record.side),
                match_outcome_to_string(record.result),
                0_u8,
                record.kills,
                record.deaths,
                record.damage_dealt.min(u32::from(u16::MAX)) as u16,
                record.gold_earned.min(u32::from(u16::MAX)) as u16,
                record.objectives,
                0_u16,
                0_u16,
                record.duration_seconds,
                record.kills,
                record.deaths,
                record.gold_earned,
                record.damage_dealt,
                record.objectives,
                0_u8,
                0_u8,
            ],
        )
        .map_err(|e| format!("Failed to insert team_match_stats row: {}", e))?;
    }

    Ok(())
}

pub fn replace_stats_state(conn: &Connection, stats: &StatsState) -> Result<(), String> {
    if has_table(conn, LOL_PLAYER_TABLE)? && has_table(conn, LOL_TEAM_TABLE)? {
        replace_lol_stats_state(conn, stats)?;
    } else {
        // Fallback explícito: DB legacy sin tablas LoL puras.
        mirror_lol_stats_into_legacy_tables(conn, stats)?;
    }

    Ok(())
}

pub fn load_stats_state(conn: &Connection) -> Result<StatsState, String> {
    if has_table(conn, LOL_PLAYER_TABLE)? && has_table(conn, LOL_TEAM_TABLE)? {
        return load_stats_state_from_lol_tables(conn);
    }

    // Fallback explícito para DB legacy sin tablas LoL puras.
    load_stats_state_from_legacy_tables(conn)
}

