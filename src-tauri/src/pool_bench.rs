//! Capacity harness for the active-pros pool: how much a pool of teamless free agents adds to
//! new-game time and to the save. Every test here is `#[ignore]`d, so a plain `cargo test` never
//! runs it.
//!
//! It builds a new game the way `select_team` does (`build_new_game_world`, then
//! `prepare_new_game_season`), with `N` synthetic teamless player adds and `N / 10` teamless staff
//! adds appended to the bundled overlay, so they travel the real overlay apply path. Then it writes
//! one `.olsave` and prints the timings and the size.
//!
//! Run it in release mode, from `src-tauri`, on a quiet machine:
//!
//! ```text
//! OLM_POOL_EXTRA=5000 OLM_POOL_REPS=3 cargo test --release --lib pool_new_game_capacity -- --ignored --nocapture
//! ```
//!
//! Environment:
//! - `OLM_POOL_EXTRA` number of extra players, with a tenth of that many staff (default 0)
//! - `OLM_POOL_REPS`  repetitions, the median is reported (default 1)
//! - `OLM_POOL_TEAM`  scoped id of the user's team (default `lec-g2-esports`)

use std::path::PathBuf;
use std::sync::Once;
use std::time::Instant;

use chrono::TimeZone;
use olm_core::clock::GameClock;
use olm_core::competitions::{competition_id_from_team_id_known, scan_competitions};
use olm_core::db::save_manager::SaveManager;
use olm_core::domain::manager::Manager;
use olm_core::domain::player::{Player, PlayerAttributes};
use olm_core::domain::staff::{Staff, StaffAttributes, StaffRole};
use olm_core::domain::stats::LolRole;
use olm_core::game::Game;
use olm_core::world_overlay::{PlayerOp, StaffOp, WorldOverlay, bundled_world_overlay};

use crate::commands::game::{NewGameWorldInputs, build_new_game_world, prepare_new_game_season};

const ROLES: [LolRole; 5] = [
    LolRole::Top,
    LolRole::Jungle,
    LolRole::Mid,
    LolRole::Adc,
    LolRole::Support,
];
const STAFF_ROLES: [StaffRole; 4] = [
    StaffRole::Coach,
    StaffRole::AssistantManager,
    StaffRole::Scout,
    StaffRole::Physio,
];

fn data_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("data")
}

fn env_usize(key: &str, default: usize) -> usize {
    std::env::var(key)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

fn median(values: &mut [f64]) -> f64 {
    values.sort_by(f64::total_cmp);
    let mid = values.len() / 2;
    if values.len() % 2 == 1 {
        values[mid]
    } else {
        (values[mid - 1] + values[mid]) / 2.0
    }
}

/// The message and sender stores `select_team` initialises before the first day.
fn init_message_stores() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let messages = data_dir().join("messages");
        let _ = olm_core::messages::template_store::init_template_store(&messages.join("triggers"));
        olm_core::messages::template_store::init_senders_store(&messages.join("senders"));
    });
}

/// A rating in 35..=70 that differs by person and by attribute, without a random source.
fn rating(i: usize, salt: usize) -> u8 {
    35 + ((i * 31 + salt * 17) % 36) as u8
}

/// `extra` teamless player adds and `extra / 10` teamless staff adds, as the pool emits them:
/// no team, no wage, no market value and no contract.
fn pool_ops(extra: usize) -> (Vec<PlayerOp>, Vec<StaffOp>) {
    let players = (0..extra)
        .map(|i| {
            let attributes = PlayerAttributes {
                mental_resilience: rating(i, 0),
                champion_pool: rating(i, 1),
                laning: rating(i, 2),
                mechanics: rating(i, 3),
                macro_play: rating(i, 4),
                consistency: rating(i, 5),
                discipline: rating(i, 6),
                teamfighting: rating(i, 7),
                shotcalling: rating(i, 8),
            };
            let birth = format!("{}-{:02}-{:02}", 1995 + i % 14, 1 + i % 12, 1 + i % 28);
            let mut player = Player::new(
                format!("player-pool{i:06}"),
                format!("Pool{i}"),
                format!("Pool Player {i}"),
                birth,
                "ES".to_string(),
                ROLES[i % ROLES.len()],
                attributes,
            );
            player.team_id = None;
            player.wage = 0;
            player.market_value = 0;
            player.contract_end = None;
            PlayerOp::Add {
                player: Box::new(player),
                evidence: String::new(),
                dob_approx: false,
            }
        })
        .collect();
    let staff = (0..extra / 10)
        .map(|i| {
            let attr = |salt: usize| 40 + ((i * 29 + salt * 13) % 46) as u8;
            let mut member = Staff::new(
                format!("staff-pool{i:06}"),
                format!("Pool{i}"),
                "Staff".to_string(),
                format!("{}-{:02}-{:02}", 1970 + i % 30, 1 + i % 12, 1 + i % 28),
                STAFF_ROLES[i % STAFF_ROLES.len()].clone(),
                StaffAttributes {
                    coaching: attr(0),
                    judging_ability: attr(1),
                    judging_potential: attr(2),
                    physiotherapy: attr(3),
                },
            );
            member.nationality = "ES".to_string();
            member.team_id = None;
            member.wage = 0;
            member.contract_end = None;
            StaffOp::Add {
                staff: Box::new(member),
                evidence: String::new(),
                dob_approx: false,
            }
        })
        .collect();
    (players, staff)
}

fn empty_session() -> Game {
    let clock = GameClock::new(chrono::Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap());
    let manager = Manager::new(
        "mgr_user".to_string(),
        "Test".to_string(),
        "Manager".to_string(),
        "1990-01-01".to_string(),
        "KR".to_string(),
    );
    Game::new(clock, manager, vec![], vec![], vec![], vec![])
}

/// One new game with `overlay`; returns it with the world-build and season-setup times in ms.
fn new_game(overlay: &WorldOverlay, team_id: &str) -> (Game, f64, f64) {
    let manifests = scan_competitions(&data_dir().join("competitions"));
    let known: Vec<String> = manifests
        .iter()
        .filter(|m| !m.legacy)
        .map(|m| m.id.clone())
        .collect();
    let competition_id = competition_id_from_team_id_known(team_id, &known)
        .unwrap_or_else(|| panic!("no competition prefix in {team_id}"));
    let data = data_dir();
    let mut game = empty_session();

    let start = Instant::now();
    build_new_game_world(
        &mut game,
        &NewGameWorldInputs {
            data_dir: &data,
            manifests: &manifests,
            competition_id,
            team_id,
            overlay: Some(overlay),
            custom_team: None,
            joins_league: false,
        },
    )
    .expect("world");
    let world_ms = start.elapsed().as_secs_f64() * 1000.0;

    let start = Instant::now();
    prepare_new_game_season(&mut game, &manifests, &known, team_id).expect("season");
    let season_ms = start.elapsed().as_secs_f64() * 1000.0;
    (game, world_ms, season_ms)
}

/// Size of the `.olsave` the game writes.
fn save_bytes(game: &Game) -> u64 {
    let dir = tempfile::tempdir().expect("save dir");
    let mut manager = SaveManager::init(dir.path()).expect("save manager");
    let save_id = manager
        .create_save(game, "pool-bench")
        .expect("create save");
    std::fs::metadata(dir.path().join(format!("{save_id}.olsave")))
        .expect("save file")
        .len()
}

#[test]
#[ignore = "capacity harness; run by hand, see the module docs"]
fn pool_new_game_capacity() {
    init_message_stores();
    let extra = env_usize("OLM_POOL_EXTRA", 0);
    let reps = env_usize("OLM_POOL_REPS", 1).max(1);
    let team_id = std::env::var("OLM_POOL_TEAM").unwrap_or_else(|_| "lec-g2-esports".to_string());

    let mut overlay = bundled_world_overlay().expect("bundled overlay");
    let (players, staff) = pool_ops(extra);
    overlay.players.extend(players);
    overlay.staff.extend(staff);

    let (mut world, mut season, mut save) = (Vec::new(), Vec::new(), 0);
    let (mut counts, mut signed_by_fill) = ((0, 0), 0);
    for _ in 0..reps {
        let (game, world_ms, season_ms) = new_game(&overlay, &team_id);
        world.push(world_ms);
        season.push(season_ms);
        // The adds went through the overlay apply: every one is in the game, and the ones the
        // short-roster fill did not sign are free agents with a market value and no contract.
        let pool: Vec<&Player> = game
            .players
            .iter()
            .filter(|p| p.id.starts_with("player-pool"))
            .collect();
        assert_eq!(pool.len(), extra, "pool players kept");
        let free = pool
            .iter()
            .filter(|p| p.team_id.is_none())
            .collect::<Vec<_>>();
        assert!(
            free.iter()
                .all(|p| p.market_value > 0 && p.contract_end.is_none())
        );
        signed_by_fill = pool.len() - free.len();
        save = save_bytes(&game);
        counts = (game.players.len(), game.staff.len());
    }
    println!(
        "POOL extra={extra} (+{} staff) reps={reps} players={} staff={} world_ms={:.0} new_game_season_ms={:.0} signed_by_roster_fill={signed_by_fill} save_bytes={save}",
        extra / 10,
        counts.0,
        counts.1,
        median(&mut world),
        median(&mut season),
    );
}
