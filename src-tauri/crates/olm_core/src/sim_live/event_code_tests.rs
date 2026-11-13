//! Events carry a stable code and data next to the English line, so the screens can compose
//! the sentence in the player's language.

use std::collections::HashMap;

use serde_json::json;

use super::economy_tests::{snapshot_with, Side, FULL_MATCH_TICKS};
use super::test_helpers::{empty_neutral, test_champion, test_runtime};
use super::*;

fn event_json(event: &RuntimeEvent) -> serde_json::Value {
    serde_json::to_value(event).expect("serialize")
}

#[test]
fn a_champion_kill_carries_who_killed_whom() {
    let mut attacker = test_champion("att", "blue", "MID", "mid", Vec2 { x: 0.50, y: 0.50 });
    attacker.name = "Attacker".to_string();
    attacker.attack_damage = 500.0;
    let mut defender = test_champion("def", "red", "MID", "mid", Vec2 { x: 0.51, y: 0.50 });
    defender.name = "Defender".to_string();
    defender.hp = 1.0;
    let mut runtime = test_runtime(vec![attacker, defender], vec![], vec![], empty_neutral());
    attack_enemy_champion(&mut runtime, 0, 1);
    let kill = runtime
        .events
        .iter()
        .find(|event| event.code == Some(EventCode::ChampionKilled))
        .expect("a kill event");
    assert_eq!(kill.kind, "kill");
    assert_eq!(kill.text, "Attacker killed Defender");
    assert_eq!(
        event_json(kill)["data"],
        json!({ "actor": "Attacker", "actorId": "att", "target": "Defender", "targetId": "def" })
    );
}

#[test]
fn an_event_without_a_code_serializes_as_before() {
    let event = RuntimeEvent {
        t: 12.0,
        text: "[ai-hybrid] debug".to_string(),
        kind: "info".to_string(),
        code: None,
        data: EventData::default(),
    };
    assert_eq!(
        event_json(&event),
        json!({ "t": 12.0, "text": "[ai-hybrid] debug", "type": "info" })
    );
}

#[test]
fn an_event_saved_before_codes_existed_loads_without_one() {
    let old = json!({ "t": 5.0, "text": "BLUE secured baron", "type": "baron" });
    let event: RuntimeEvent = serde_json::from_value(old).expect("old event loads");
    assert_eq!(event.code, None);
    assert!(event.data.is_empty());
}

#[test]
fn a_code_from_a_newer_build_loads_as_unknown() {
    let newer = json!({ "t": 5.0, "text": "x", "type": "info", "code": "something_new" });
    let event: RuntimeEvent = serde_json::from_value(newer).expect("unknown code loads");
    assert_eq!(event.code, Some(EventCode::Unknown));
}

fn play(seed: &str) -> RuntimeState {
    let store = SimLiveStoreState::default();
    let session_id = format!("events-{seed}");
    init(
        &store,
        SimLiveInitRequest {
            session_id: session_id.clone(),
            seed: seed.to_string(),
            snapshot: snapshot_with(Side::EVEN, Side::EVEN),
            champion_by_player_id: HashMap::new(),
            champion_profiles_by_id: HashMap::new(),
            champion_ultimates_by_id: HashMap::new(),
            initial_state: None,
            ai_mode: SimulatorAiMode::default(),
            policy: SimulatorPolicyConfig::default(),
        },
    )
    .expect("init");
    skip_to_end(
        &store,
        SimLiveSkipToEndRequest {
            session_id: session_id.clone(),
            dt_sec: 0.2,
            speed: 12.0,
            max_ticks: FULL_MATCH_TICKS,
        },
    )
    .expect("skip");
    let sessions = store.sessions.lock().expect("lock");
    sessions[&session_id].state.clone()
}

/// Every line the engine writes has a code, so a sentence can be composed for all of them.
#[test]
fn every_event_of_a_full_match_has_a_code() {
    let state = play("event-codes-full-match");
    assert!(!state.events.is_empty());
    for event in &state.events {
        assert!(event.code.is_some(), "no code on {:?} line {:?}", event.kind, event.text);
    }
}

#[test]
fn kills_and_structures_of_a_full_match_carry_their_data() {
    let state = play("event-codes-full-match");
    let kills: Vec<_> = state
        .events
        .iter()
        .filter(|event| matches!(event.code, Some(EventCode::ChampionKilled | EventCode::IgniteKill)))
        .collect();
    assert!(!kills.is_empty(), "no kill in a whole match");
    for kill in kills {
        assert!(kill.data.actor.is_some() && kill.data.target.is_some(), "{:?}", kill.text);
        assert!(kill.data.actor_id.is_some() && kill.data.target_id.is_some(), "{:?}", kill.text);
    }
    let structures: Vec<_> = state
        .events
        .iter()
        .filter(|event| event.code == Some(EventCode::StructureDestroyed))
        .collect();
    assert!(!structures.is_empty(), "no structure fell in a whole match");
    for structure in structures {
        assert!(structure.data.team.is_some() && structure.data.structure.is_some());
    }
    let last = state.events.last().expect("events");
    assert_eq!(last.kind, "nexus");
    assert!(last.data.structure.as_deref().is_some_and(|id| id.ends_with("nexus")));
}
