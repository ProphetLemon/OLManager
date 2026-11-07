//! End-to-end check of the roster overlay on recorded LCK/LEC data: the spike
//! case (Aiming to Kiwoom DRX, Ice retired, Pad hired by Vitality).

use olm_core::domain::player::Player;
use olm_core::domain::staff::{Staff, StaffRole};
use olm_core::domain::team::Team;
use olm_core::world_overlay::{WorldOverlay, apply_world_overlay};
use serde::Deserialize;

const OVERLAY: &str = include_str!("fixtures/world_overlay/overlay.json");
const WORLD: &str = include_str!("fixtures/world_overlay/world.json");

const KT: &str = "lck-team-932ee946";
const KIWOOM_DRX: &str = "lck-team-bc4c40ec";
const HERETICS: &str = "lec-team-heretics-lec";
const VITALITY: &str = "lec-team-vitality";
const AIMING: &str = "player-c5877188";
const ICE: &str = "lec-player-105501834624360050";

#[derive(Deserialize)]
struct WorldFixture {
    players: Vec<Player>,
    staff: Vec<Staff>,
}

fn team(id: &str) -> Team {
    Team::new(
        id.to_string(),
        id.to_string(),
        id.to_string(),
        "KR".to_string(),
        "Seoul".to_string(),
        "Arena".to_string(),
        1000,
    )
}

#[test]
fn spike_case_is_applied_to_recorded_data() {
    let fixture: WorldFixture = serde_json::from_str(WORLD).expect("world fixture");
    let (mut players, mut staff) = (fixture.players, fixture.staff);
    let mut teams: Vec<Team> = [KT, KIWOOM_DRX, HERETICS, VITALITY].map(team).into();
    teams[2].active_lineup_ids = vec![ICE.to_string()];
    let overlay = WorldOverlay::parse(OVERLAY).expect("overlay fixture");

    let report = apply_world_overlay(&mut teams, &mut players, &mut staff, &overlay);

    let aiming = players
        .iter()
        .find(|p| p.id == AIMING)
        .expect("Aiming stays in the game");
    assert_eq!(aiming.team_id.as_deref(), Some(KIWOOM_DRX));
    assert!(players.iter().all(|p| p.id != ICE), "Ice is retired");
    assert!(
        teams[2].active_lineup_ids.is_empty(),
        "retired player leaves the lineup"
    );
    let pad = staff
        .iter()
        .find(|s| s.nickname == "Pad")
        .expect("Pad is hired");
    assert_eq!(
        (pad.team_id.as_deref(), &pad.role),
        (Some(VITALITY), &StaffRole::Coach)
    );
    assert_eq!(report.moved_player_ids, vec![AIMING.to_string()]);
    assert_eq!(report.retired_player_ids, vec![ICE.to_string()]);
    assert_eq!(report.added_staff_ids.len(), 1);
    assert!(report.skipped.is_empty(), "{:?}", report.skipped);
}
