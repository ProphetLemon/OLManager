//! Shared fixtures for the `lol_map` test modules: uniform-rating teams built
//! the way the shipped callers build them (`MatchConfig::default()` plus the
//! draft modifier clamp), and a minute-by-minute stepper.

use super::*;
use crate::engine::types::{DraftStrategy, MatchConfig, PlayerData};
use rand::SeedableRng;
use rand::rngs::StdRng;

pub(super) const ROLES: [LolRole; 5] = [
    LolRole::Top,
    LolRole::Jungle,
    LolRole::Mid,
    LolRole::Adc,
    LolRole::Support,
];

pub(super) fn player(team: &str, role: LolRole, rating: u8) -> PlayerData {
    PlayerData {
        id: format!("{team}-{role:?}"),
        name: format!("{team}-{role:?}"),
        profile_image_url: None,
        role,
        condition: 100,
        fitness: 75,
        mechanics: rating,
        laning: rating,
        teamfighting: rating,
        macro_play: rating,
        consistency: rating,
        shotcalling: rating,
        champion_pool: rating,
        discipline: rating,
        mental_resilience: rating,
        is_import: false,
        traits: Vec::new(),
    }
}

pub(super) fn team(id: &str, rating: u8) -> TeamData {
    TeamData {
        id: id.to_string(),
        name: id.to_string(),
        draft_strategy: DraftStrategy::default(),
        players: ROLES.iter().map(|role| player(id, *role, rating)).collect(),
    }
}

pub(super) fn new_match(home_rating: u8, away_rating: u8) -> LiveMatchState {
    LiveMatchState::new(
        team("home", home_rating),
        team("away", away_rating),
        MatchConfig::default(),
        Vec::new(),
        Vec::new(),
        false,
    )
}

pub(super) fn seeded_rng(seed: u64) -> StdRng {
    StdRng::seed_from_u64(0xD4_0002 + seed)
}

pub(super) fn unit(state: &LiveMatchState, side: Side, role: LolRole) -> &LolUnitState {
    state
        .lol_map
        .units
        .iter()
        .find(|u| u.side == side && u.role == role)
        .expect("unit exists")
}
