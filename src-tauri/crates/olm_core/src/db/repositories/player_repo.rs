use crate::domain::player::{Player, PlayerAttributes};
use crate::domain::team::TrainingFocus;
use rusqlite::{Connection, params};

/// Insert or replace a player row.
pub fn upsert_player(conn: &Connection, p: &Player) -> Result<(), String> {
    let attrs_json =
        serde_json::to_string(&p.attributes).map_err(|e| format!("JSON error: {}", e))?;
    let traits_json = serde_json::to_string(&p.traits).map_err(|e| format!("JSON error: {}", e))?;
    let stats_json = serde_json::to_string(&p.stats).map_err(|e| format!("JSON error: {}", e))?;
    let career_json = serde_json::to_string(&p.career).map_err(|e| format!("JSON error: {}", e))?;
    let offers_json =
        serde_json::to_string(&p.transfer_offers).map_err(|e| format!("JSON error: {}", e))?;
    let morale_core_json =
        serde_json::to_string(&p.morale_core).map_err(|e| format!("JSON error: {}", e))?;
    // Use UPPERCASE for DB storage (matches serde(rename_all = "UPPERCASE") on LolRole)
    // parse_role handles both UPPERCASE and PascalCase for backward compat.
    let position_str = format!("{:?}", p.position).to_uppercase();
    let natural_position_str = format!("{:?}", p.natural_position).to_uppercase();
    let alt_positions_json =
        serde_json::to_string(&p.alternate_positions).map_err(|e| format!("JSON error: {}", e))?;
    let training_focus_str: Option<String> =
        p.training_focus.as_ref().map(|f| f.as_id().to_string());

    conn.execute(
        "INSERT OR REPLACE INTO players
         (id, match_name, full_name, date_of_birth, nationality, birth_country, position,
           attributes, condition, morale, team_id, traits,
           contract_end, wage, market_value, stats, career,
           transfer_listed, loan_listed, transfer_offers, alternate_positions,
           natural_position, training_focus, morale_core, footedness, fitness,
            potential_base, potential_revealed, potential_research_started_on, potential_research_eta_days, profile_image_url,
            was_released)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30, ?31, ?32)",
        params![
            p.id,
            p.match_name,
            p.full_name,
            p.date_of_birth,
            p.nationality,
            p.birth_country,
            position_str,
            attrs_json,
            p.condition,
            p.morale,
            p.team_id,
            traits_json,
            p.contract_end,
            p.wage,
            p.market_value as i64,
            stats_json,
            career_json,
            p.transfer_listed as i32,
            p.loan_listed as i32,
            offers_json,
            alt_positions_json,
            natural_position_str,
            training_focus_str,
            morale_core_json,
            "Right",
            p.fitness,
            p.potential_base,
            p.potential_revealed,
            p.potential_research_started_on,
            p.potential_research_eta_days,
            p.profile_image_url,
            p.was_released as i32,
        ],
    )
    .map_err(|e| format!("Failed to upsert player: {}", e))?;
    Ok(())
}

/// Insert or replace multiple players.
pub fn upsert_players(conn: &Connection, players: &[Player]) -> Result<(), String> {
    for p in players {
        upsert_player(conn, p)?;
    }
    Ok(())
}

fn parse_role(s: &str) -> crate::domain::stats::LolRole {
    // Handles UPPERCASE (new serde), PascalCase (Debug, legacy write), AND legacy
    // position strings for full backward compatibility with existing database data.
    match s {
        // === New LolRole UPPERCASE (after serde(rename_all = "UPPERCASE")) ===
        "TOP" => crate::domain::stats::LolRole::Top,
        "JUNGLE" => crate::domain::stats::LolRole::Jungle,
        "MID" => crate::domain::stats::LolRole::Mid,
        "ADC" => crate::domain::stats::LolRole::Adc,
        "SUPPORT" => crate::domain::stats::LolRole::Support,
        "" | "UNKNOWN" => crate::domain::stats::LolRole::Unknown,

        // === LolRole PascalCase (Debug format — current write path) ===
        "Top" => crate::domain::stats::LolRole::Top,
        "Jungle" => crate::domain::stats::LolRole::Jungle,
        "Mid" => crate::domain::stats::LolRole::Mid,
        "Adc" => crate::domain::stats::LolRole::Adc,
        "Support" => crate::domain::stats::LolRole::Support,
        "Unknown" => crate::domain::stats::LolRole::Unknown,

        // === Legacy position strings (for backward compatibility) ===
        // Goalkeeper/DefensiveMidfielder → Support
        "Goalkeeper" | "DefensiveMidfielder" => crate::domain::stats::LolRole::Support,
        // Defender variants → Top
        "Defender" | "RightBack" | "CenterBack" | "LeftBack" | "RightWingBack" | "LeftWingBack" => {
            crate::domain::stats::LolRole::Top
        }
        // Midfielder variants → Jungle
        "Midfielder" | "CentralMidfielder" => crate::domain::stats::LolRole::Jungle,
        // Attacking midfielder variants → Mid
        "AttackingMidfielder" | "RightMidfielder" | "LeftMidfielder" => crate::domain::stats::LolRole::Mid,
        // Forward variants → ADC
        "Forward" | "RightWinger" | "LeftWinger" | "Striker" => crate::domain::stats::LolRole::Adc,

        // Default fallback
        _ => crate::domain::stats::LolRole::Unknown,
    }
}

fn parse_training_focus(s: &str) -> Option<TrainingFocus> {
    TrainingFocus::from_id(s)
}

/// Load all players.
pub fn load_all_players(conn: &Connection) -> Result<Vec<Player>, String> {
    log::info!("[player_repo] load_all_players: preparing query...");
    let mut stmt = conn
        .prepare(
            "SELECT id, match_name, full_name, date_of_birth, nationality, birth_country, position,
                    attributes, condition, morale, team_id, traits,
                    contract_end, wage, market_value, stats, career,
                    transfer_listed, loan_listed, transfer_offers, alternate_positions,
                    natural_position, training_focus, morale_core, footedness, weak_foot, fitness,
                    potential_base, potential_revealed, potential_research_started_on, potential_research_eta_days, profile_image_url,
                    was_released
             FROM players",
        )
        .map_err(|e| {
            log::error!("[player_repo] load_all_players: failed to prepare: {}", e);
            format!("Failed to prepare players query: {}", e)
        })?;
    log::info!("[player_repo] load_all_players: query prepared, executing...");

    let rows = stmt.query_map([], row_to_player).map_err(|e| {
        log::error!("[player_repo] load_all_players: failed to query: {}", e);
        format!("Failed to query players: {}", e)
    })?;

    log::info!("[player_repo] load_all_players: iterating rows...");
    let mut players = Vec::new();
    for (idx, row) in rows.enumerate() {
        match row {
            Ok(player) => {
                if idx % 50 == 0 {
                    log::info!("[player_repo] load_all_players: loaded {} players", idx + 1);
                }
                players.push(player);
            }
            Err(e) => {
                log::error!(
                    "[player_repo] load_all_players: failed to read player row {}: {}",
                    idx,
                    e
                );
                return Err(format!("Failed to read player row {}: {}", idx, e));
            }
        }
    }
    log::info!(
        "[player_repo] load_all_players: done, {} players loaded",
        players.len()
    );
    Ok(players)
}

/// Load players by team id.
pub fn load_players_by_team(conn: &Connection, team_id: &str) -> Result<Vec<Player>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, match_name, full_name, date_of_birth, nationality, birth_country, position,
                    attributes, condition, morale, team_id, traits,
                    contract_end, wage, market_value, stats, career,
                    transfer_listed, loan_listed, transfer_offers, alternate_positions,
                    natural_position, training_focus, morale_core, footedness, weak_foot, fitness,
                    potential_base, potential_revealed, potential_research_started_on, potential_research_eta_days, profile_image_url,
                    was_released
             FROM players WHERE team_id = ?1",
        )
        .map_err(|e| format!("Failed to prepare players query: {}", e))?;

    let rows = stmt
        .query_map(params![team_id], row_to_player)
        .map_err(|e| format!("Failed to query players: {}", e))?;

    let mut players = Vec::new();
    for row in rows {
        players.push(row.map_err(|e| format!("Failed to read player row: {}", e))?);
    }
    Ok(players)
}

fn row_to_player(row: &rusqlite::Row) -> rusqlite::Result<Player> {
    let position_str: String = row.get(6)?;
    let attrs_json: String = row.get(7)?;
    let traits_json: String = row.get(11)?;
    let stats_json: String = row.get(15)?;
    let career_json: String = row.get(16)?;
    let offers_json: String = row.get(19)?;
    let alt_positions_json: String = row.get(20)?;
    let natural_position_str: String = row.get(21)?;
    let training_focus_str: Option<String> = row.get(22)?;
    let morale_core_json: String = row.get(23)?;
    let _footedness_str: String = row.get(24)?;
    let _weak_foot: u8 = row.get(25).unwrap_or(2);
    let fitness: u8 = row.get(26).unwrap_or(75);
    let potential_base: u8 = row.get(27).unwrap_or(99);
    let potential_revealed: Option<u8> = row.get(28).unwrap_or(None);
    let potential_research_started_on: Option<String> = row.get(29).unwrap_or(None);
    let potential_research_eta_days: Option<u8> = row.get(30).unwrap_or(None);
    let profile_image_url: Option<String> = row.get(31).unwrap_or(None);
    let was_released_int: i32 = row.get(32).unwrap_or(0);
    let transfer_listed_int: i32 = row.get(17)?;
    let loan_listed_int: i32 = row.get(18)?;
    let market_value_i64: i64 = row.get(14)?;

    let position = parse_role(&position_str);
    let natural_position = if natural_position_str.is_empty() {
        position
    } else {
        parse_role(&natural_position_str)
    };

    Ok(Player {
        id: row.get(0)?,
        match_name: row.get(1)?,
        full_name: row.get(2)?,
        date_of_birth: row.get(3)?,
        nationality: row.get(4)?,
        birth_country: row.get(5)?,
        profile_image_url,
        position,
        natural_position,
        alternate_positions: serde_json::from_str(&alt_positions_json).unwrap_or_default(),
        attributes: serde_json::from_str(&attrs_json).unwrap_or(PlayerAttributes {
            mechanics: 50,
            laning: 50,
            teamfighting: 50,
            macro_play: 50,
            consistency: 50,
            shotcalling: 50,
            champion_pool: 50,
            discipline: 50,
            mental_resilience: 50,
        }),
        condition: row.get(8)?,
        morale: row.get(9)?,
        fitness,
        team_id: row.get(10)?,
        contract_end: row.get(12)?,
        wage: row.get(13)?,
        market_value: market_value_i64 as u64,
        stats: serde_json::from_str(&stats_json).unwrap_or_default(),
        career: serde_json::from_str(&career_json).unwrap_or_default(),
        traits: serde_json::from_str(&traits_json).unwrap_or_default(),
        training_focus: training_focus_str.and_then(|s| parse_training_focus(&s)),
        transfer_listed: transfer_listed_int != 0,
        loan_listed: loan_listed_int != 0,
        transfer_offers: serde_json::from_str(&offers_json).unwrap_or_default(),
        morale_core: serde_json::from_str(&morale_core_json).unwrap_or_default(),
        potential_base,
        potential_revealed,
        potential_research_started_on,
        potential_research_eta_days,
        was_released: was_released_int != 0,
        champion_training_targets: Vec::new(),
        can_be_transferred_until: None,
        lol_ovr: 0,
        resident_region: None,
        is_import: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game_database::GameDatabase;
    use crate::domain::player::{PlayerIssue, PlayerIssueCategory, PlayerMoraleCore};

    fn test_db() -> GameDatabase {
        GameDatabase::open_in_memory().unwrap()
    }

    fn sample_player(id: &str, team_id: Option<&str>) -> Player {
        let mut p = Player::new(
            id.to_string(),
            "J. Smith".to_string(),
            "John Smith".to_string(),
            "2000-01-15".to_string(),
            "GB".to_string(),
            crate::domain::stats::LolRole::Mid,
            PlayerAttributes {
                mechanics: 68,
                laning: 60,
                teamfighting: 80,
                macro_play: 78,
                consistency: 70,
                shotcalling: 45,
                champion_pool: 72,
                discipline: 60,
                mental_resilience: 75,
            },
        );
        p.team_id = team_id.map(|s| s.to_string());
        p.wage = 5000;
        p.market_value = 500_000;
        p
    }

    #[test]
    fn test_upsert_and_load_player() {
        let db = test_db();
        let player = sample_player("p-001", Some("team-001"));

        upsert_player(db.conn(), &player).unwrap();
        let all = load_all_players(db.conn()).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].id, "p-001");
        assert_eq!(all[0].full_name, "John Smith");
        assert_eq!(all[0].position, crate::domain::stats::LolRole::Mid);
        assert_eq!(all[0].team_id, Some("team-001".to_string()));
        assert_eq!(all[0].wage, 5000);
        assert_eq!(all[0].market_value, 500_000);
        assert_eq!(all[0].birth_country, None);
    }

    #[test]
    fn test_player_birth_country_roundtrip() {
        let db = test_db();
        let mut player = sample_player("p-eng", Some("team-001"));
        player.nationality = "English".to_string();
        player.birth_country = Some("ENG".to_string());

        upsert_player(db.conn(), &player).unwrap();
        let loaded = load_all_players(db.conn()).unwrap();

        assert_eq!(loaded[0].birth_country, Some("ENG".to_string()));
    }

    #[test]
    fn test_upsert_players_batch() {
        let db = test_db();
        let players = vec![
            sample_player("p-001", Some("team-001")),
            sample_player("p-002", Some("team-001")),
            sample_player("p-003", Some("team-002")),
        ];

        upsert_players(db.conn(), &players).unwrap();
        let all = load_all_players(db.conn()).unwrap();
        assert_eq!(all.len(), 3);
    }

    #[test]
    fn test_load_players_by_team() {
        let db = test_db();
        let players = vec![
            sample_player("p-001", Some("team-001")),
            sample_player("p-002", Some("team-001")),
            sample_player("p-003", Some("team-002")),
        ];
        upsert_players(db.conn(), &players).unwrap();

        let team1 = load_players_by_team(db.conn(), "team-001").unwrap();
        assert_eq!(team1.len(), 2);

        let team2 = load_players_by_team(db.conn(), "team-002").unwrap();
        assert_eq!(team2.len(), 1);
    }

    #[test]
    fn test_player_alternate_positions_roundtrip() {
        let db = test_db();
        let mut player = sample_player("p-001", Some("team-001"));
        player.alternate_positions =
            vec![crate::domain::stats::LolRole::Support, crate::domain::stats::LolRole::Adc];

        upsert_player(db.conn(), &player).unwrap();
        let loaded = load_all_players(db.conn()).unwrap();

        assert_eq!(loaded[0].alternate_positions.len(), 2);
        assert_eq!(
            loaded[0].alternate_positions[0],
            crate::domain::stats::LolRole::Support
        );
        assert_eq!(
            loaded[0].alternate_positions[1],
            crate::domain::stats::LolRole::Adc
        );
    }

    #[test]
    fn test_player_empty_alternate_positions_roundtrip() {
        let db = test_db();
        let player = sample_player("p-001", None);

        upsert_player(db.conn(), &player).unwrap();
        let loaded = load_all_players(db.conn()).unwrap();

        assert!(loaded[0].alternate_positions.is_empty());
    }

    #[test]
    fn test_player_attributes_roundtrip() {
        let db = test_db();
        let player = sample_player("p-001", None);

        upsert_player(db.conn(), &player).unwrap();
        let loaded = load_all_players(db.conn()).unwrap();

        assert_eq!(loaded[0].attributes.mechanics, 68);
        assert_eq!(loaded[0].attributes.teamfighting, 80);
        assert_eq!(loaded[0].attributes.macro_play, 78);
    }

    #[test]
    fn test_player_transfer_flags_roundtrip() {
        let db = test_db();
        let mut player = sample_player("p-001", None);
        player.transfer_listed = true;
        player.loan_listed = true;

        upsert_player(db.conn(), &player).unwrap();
        let loaded = load_all_players(db.conn()).unwrap();

        assert!(loaded[0].transfer_listed);
        assert!(loaded[0].loan_listed);
    }

    #[test]
    fn test_player_stats_roundtrip() {
        let db = test_db();
        let mut player = sample_player("p-001", None);
        player.stats.appearances = 20;
        player.stats.kills = 5;
        player.stats.assists = 8;
        player.stats.shots = 42;
        player.stats.shots_on_target = 21;
        player.stats.passes_completed = 510;
        player.stats.passes_attempted = 612;
        player.stats.tackles_won = 33;
        player.stats.interceptions = 19;

        upsert_player(db.conn(), &player).unwrap();
        let loaded = load_all_players(db.conn()).unwrap();

        assert_eq!(loaded[0].stats.appearances, 20);
        assert_eq!(loaded[0].stats.kills, 5);
        assert_eq!(loaded[0].stats.assists, 8);
        assert_eq!(loaded[0].stats.shots, 42);
        assert_eq!(loaded[0].stats.shots_on_target, 21);
        assert_eq!(loaded[0].stats.passes_completed, 510);
        assert_eq!(loaded[0].stats.passes_attempted, 612);
        assert_eq!(loaded[0].stats.tackles_won, 33);
        assert_eq!(loaded[0].stats.interceptions, 19);
    }

    #[test]
    #[ignore = "legacy: PlayerSeasonStats goals->kills mapping removed in LoL migration (see #92)"]
    fn test_legacy_player_stats_defaults_new_fields() {
        let db = test_db();
        let player = sample_player("p-legacy", None);

        upsert_player(db.conn(), &player).unwrap();
        db.conn()
            .execute(
                "UPDATE players SET stats = ?1 WHERE id = ?2",
                params![
                    r#"{"appearances":12,"goals":4,"assists":6,"minutes_played":900}"#,
                    "p-legacy"
                ],
            )
            .unwrap();

        let loaded = load_all_players(db.conn()).unwrap();
        let loaded_player = loaded
            .iter()
            .find(|candidate| candidate.id == "p-legacy")
            .unwrap();

        assert_eq!(loaded_player.stats.appearances, 12);
        assert_eq!(loaded_player.stats.kills, 4);
        assert_eq!(loaded_player.stats.assists, 6);
        assert_eq!(loaded_player.stats.minutes_played, 900);
        assert_eq!(loaded_player.stats.shots, 0);
        assert_eq!(loaded_player.stats.shots_on_target, 0);
        assert_eq!(loaded_player.stats.passes_completed, 0);
        assert_eq!(loaded_player.stats.passes_attempted, 0);
        assert_eq!(loaded_player.stats.tackles_won, 0);
        assert_eq!(loaded_player.stats.interceptions, 0);
    }

    #[test]
    fn test_player_morale_core_roundtrip() {
        let db = test_db();
        let mut player = sample_player("p-001", Some("team-001"));
        player.morale_core = PlayerMoraleCore {
            manager_trust: 63,
            unresolved_issue: Some(PlayerIssue {
                category: PlayerIssueCategory::PlayingTime,
                severity: 55,
            }),
            recent_treatment: None,
            pending_promise: None,
            talk_cooldown_until: None,
            renewal_state: None,
        };

        upsert_player(db.conn(), &player).unwrap();
        let loaded = load_all_players(db.conn()).unwrap();

        assert_eq!(loaded[0].morale_core.manager_trust, 63);
        assert_eq!(
            loaded[0]
                .morale_core
                .unresolved_issue
                .as_ref()
                .map(|issue| &issue.category),
            Some(&PlayerIssueCategory::PlayingTime)
        );
    }

    #[test]
    fn test_player_granular_identity_roundtrip() {
        let db = test_db();
        let mut player = sample_player("p-identity", Some("team-001"));
        player.natural_position = crate::domain::stats::LolRole::Top;
        player.alternate_positions = vec![crate::domain::stats::LolRole::Top, crate::domain::stats::LolRole::Top];

        upsert_player(db.conn(), &player).unwrap();
        let loaded = load_all_players(db.conn()).unwrap();

        assert_eq!(loaded[0].natural_position, crate::domain::stats::LolRole::Top);
        assert_eq!(
            loaded[0].alternate_positions,
            vec![crate::domain::stats::LolRole::Top, crate::domain::stats::LolRole::Top]
        );
    }

    #[test]
    fn test_player_fitness_roundtrip() {
        let db = test_db();
        let mut player = sample_player("p-001", None);
        player.fitness = 88;

        upsert_player(db.conn(), &player).unwrap();
        let loaded = load_all_players(db.conn()).unwrap();

        assert_eq!(
            loaded[0].fitness, 88,
            "Fitness should round-trip through DB"
        );
    }

    #[test]
    fn test_player_fitness_default_on_new() {
        let db = test_db();
        let player = sample_player("p-001", None);
        assert_eq!(
            player.fitness, 75,
            "New player should start with fitness=75"
        );

        upsert_player(db.conn(), &player).unwrap();
        let loaded = load_all_players(db.conn()).unwrap();
        assert_eq!(loaded[0].fitness, 75);
    }
}

