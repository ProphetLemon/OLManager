//! What the shipped champion catalogue says about a champion: the roles it can
//! play and its class tags. The live simulator uses it to tell when a champion
//! plays a role it does not have, and to pick an item build from the champion's
//! own class instead of from the lane it stands in.

use serde::Deserialize;
use std::collections::HashMap;
use std::sync::OnceLock;

use super::normalize_champion_key;

/// A champion that plays a role it does not have loses this much role edge
/// (the same input as the tactics role impact, which the engine clamps to +-4
/// where it is read, so 4 is the largest penalty the input can carry). In a
/// duel against an even champion it deals about 12% less and takes about 13%
/// more damage (`off_role_duel_*` tests). Over 320 seeded matches one such
/// champion in a team of five did not move the win rate outside the noise (see
/// `off_role_penalty_sweep`), so the value is the full range of the input.
pub(super) const OFF_ROLE_EDGE_PENALTY: f64 = 4.0;

#[derive(Deserialize)]
struct RolesFile {
    data: RolesData,
}

#[derive(Deserialize)]
struct RolesData {
    roles: HashMap<String, Vec<String>>,
}

#[derive(Deserialize)]
struct ListFile {
    champions: Vec<ListEntry>,
}

#[derive(Deserialize)]
struct ListEntry {
    id: String,
    tags: Vec<String>,
}

pub(super) struct ChampionInfo {
    /// Role codes of the simulator (`TOP`, `JGL`, `MID`, `ADC`, `SUP`).
    roles: Vec<&'static str>,
    /// Class tags in catalogue order; the first one is the primary class.
    pub(super) tags: Vec<String>,
}

fn role_code(catalogue_role: &str) -> Option<&'static str> {
    match catalogue_role {
        "Top" => Some("TOP"),
        "Jungle" => Some("JGL"),
        "Mid" => Some("MID"),
        "Bot" | "ADC" => Some("ADC"),
        "Support" => Some("SUP"),
        _ => None,
    }
}

fn catalogue() -> &'static HashMap<String, ChampionInfo> {
    static CATALOGUE: OnceLock<HashMap<String, ChampionInfo>> = OnceLock::new();
    CATALOGUE.get_or_init(|| {
        let roles: RolesFile = serde_json::from_str(include_str!(
            "../../../../../assets/simulation/champions.json"
        ))
        .expect("assets/simulation/champions.json is valid");
        let list: ListFile = serde_json::from_str(include_str!(
            "../../../../../assets/simulation/champion-list.json"
        ))
        .expect("assets/simulation/champion-list.json is valid");

        let mut by_key: HashMap<String, ChampionInfo> = list
            .champions
            .into_iter()
            .map(|entry| {
                (
                    normalize_champion_key(&entry.id),
                    ChampionInfo {
                        roles: Vec::new(),
                        tags: entry.tags,
                    },
                )
            })
            .collect();
        for (id, catalogue_roles) in roles.data.roles {
            let info = by_key
                .entry(normalize_champion_key(&id))
                .or_insert_with(|| ChampionInfo {
                    roles: Vec::new(),
                    tags: Vec::new(),
                });
            info.roles = catalogue_roles.iter().filter_map(|r| role_code(r)).collect();
        }
        by_key
    })
}

pub(super) fn champion_info(champion_id: &str) -> Option<&'static ChampionInfo> {
    catalogue().get(&normalize_champion_key(champion_id))
}

/// Whether the champion has `role` among its roles. `None` when the champion
/// is not in the catalogue or has no role data, so nothing is assumed.
pub(super) fn champion_plays_role(champion_id: &str, role: &str) -> Option<bool> {
    let info = champion_info(champion_id)?;
    if info.roles.is_empty() {
        return None;
    }
    Some(info.roles.contains(&role))
}

/// Role edge a champion loses for playing `role`; zero when it fits or is unknown.
pub(super) fn off_role_edge_penalty(champion_id: &str, role: &str) -> f64 {
    match champion_plays_role(champion_id, role) {
        Some(false) => OFF_ROLE_EDGE_PENALTY,
        _ => 0.0,
    }
}
