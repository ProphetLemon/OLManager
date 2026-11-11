//! The real item shop and the builds professionals use, for the live simulator.
//!
//! Two committed files feed it: `assets/simulation/items.v1.json` (the shop of
//! one patch) and `assets/simulation/champion-builds.v1.json` (for each
//! champion and role, the boots and five items it ends a professional game
//! with, or a marker that it has too few games and falls back on its class).
//!
//! The engine knows only two effects of an item, attack damage and health, and
//! the balance of the whole engine rests on how much of both a champion holds
//! after each purchase and what it has spent. Real item stats do not enter the
//! engine until the owner decides they should, so a professional plan is the
//! class table the champion buys today with the keys replaced: the boots take
//! the cost, attack damage and health of the class table's boots, and the j-th
//! item that is not boots, in purchase order, takes those of the class table's
//! j-th item that is not boots. After any number of purchases a champion has
//! spent the same gold and holds the same attack damage and health as with its
//! class table; only the names and icons differ.

use serde::Deserialize;
use std::collections::HashMap;
use std::sync::OnceLock;

use super::champion_fit::role_code;
use super::{category_plan, classify_item_build, normalize_champion_key, ItemTemplate};

const ITEMS_JSON: &str = include_str!("../../../../../assets/simulation/items.v1.json");
const BUILDS_JSON: &str = include_str!("../../../../../assets/simulation/champion-builds.v1.json");

#[derive(Deserialize)]
struct ItemsFile {
    items: Vec<ItemEntry>,
}

#[derive(Deserialize)]
struct ItemEntry {
    key: String,
    boots: bool,
}

#[derive(Deserialize)]
struct BuildsFile {
    champions: HashMap<String, HashMap<String, PairEntry>>,
}

#[derive(Deserialize)]
struct PairEntry {
    build: Option<BuildEntry>,
}

#[derive(Deserialize)]
struct BuildEntry {
    boots: Option<String>,
    items: Vec<String>,
}

pub(super) struct CatalogueItem {
    pub(super) key: &'static str,
    pub(super) boots: bool,
}

pub(super) struct ItemCatalogue {
    items: HashMap<&'static str, CatalogueItem>,
    /// The plan of each professional build by normalised champion key and role
    /// code: its six items in purchase order, boots first, each in the slot of
    /// the champion's class table.
    plans: HashMap<String, Vec<(&'static str, [ItemTemplate; 6])>>,
}

impl ItemCatalogue {
    fn item(&self, key: &str) -> Result<&CatalogueItem, String> {
        self.items
            .get(key)
            .ok_or_else(|| format!("item `{key}` is not in the item catalogue"))
    }

    /// The six items of a plan: the professional items in purchase order,
    /// boots first, completed from the class table when the build has no boots
    /// or fewer than five items. Each takes the cost, attack damage and health
    /// of the class table slot in the same position of the purchase order.
    fn assemble_plan(
        &self,
        build: &[&'static str],
        class_table: &[ItemTemplate; 6],
    ) -> Result<[ItemTemplate; 6], String> {
        let mut class_boots = None;
        let mut class_rest = Vec::new();
        for template in class_table {
            if self.item(template.key)?.boots && class_boots.is_none() {
                class_boots = Some(template);
            } else {
                class_rest.push(template);
            }
        }
        let class_boots = class_boots.ok_or("a class table has no boots")?;
        if class_rest.len() != 5 {
            return Err("a class table needs exactly one pair of boots".to_string());
        }

        let mut keys: Vec<&'static str> = build.to_vec();
        if !keys.iter().any(|key| self.items[key].boots) {
            keys.insert(0, self.item(class_boots.key)?.key);
        }
        for template in &class_rest {
            let item = self.item(template.key)?;
            if keys.len() < 6 && !keys.contains(&item.key) {
                keys.push(item.key);
            }
        }
        if keys.len() != 6 || !self.items[keys[0]].boots {
            return Err(format!("a plan needs boots and five items, got {keys:?}"));
        }

        Ok(std::array::from_fn(|i| {
            let slot = if i == 0 { class_boots } else { class_rest[i - 1] };
            ItemTemplate {
                key: keys[i],
                cost: slot.cost,
                attack_damage: slot.attack_damage,
                max_hp: slot.max_hp,
            }
        }))
    }
}

/// Reads and validates both files: every item key a build names must exist, a
/// build's boots must be boots and its items distinct.
pub(super) fn parse(items_json: &str, builds_json: &str) -> Result<ItemCatalogue, String> {
    let items_file: ItemsFile =
        serde_json::from_str(items_json).map_err(|e| format!("items file: {e}"))?;
    let builds_file: BuildsFile =
        serde_json::from_str(builds_json).map_err(|e| format!("builds file: {e}"))?;

    let mut catalogue = ItemCatalogue {
        items: HashMap::new(),
        plans: HashMap::new(),
    };
    for entry in &items_file.items {
        // The keys live as long as the process: the catalogue is loaded once.
        let key: &'static str = Box::leak(entry.key.clone().into_boxed_str());
        let item = CatalogueItem {
            key,
            boots: entry.boots,
        };
        if catalogue.items.insert(key, item).is_some() {
            return Err(format!("item `{key}` appears twice"));
        }
    }

    for (champion, roles) in &builds_file.champions {
        let champion_key = normalize_champion_key(champion);
        for (role_name, pair) in roles {
            let role = role_code(role_name)
                .ok_or_else(|| format!("{champion} has an unknown role `{role_name}`"))?;
            let Some(build) = &pair.build else { continue };
            let mut keys: Vec<&'static str> = Vec::new();
            if let Some(boots) = &build.boots {
                if !catalogue.item(boots)?.boots {
                    return Err(format!("{champion} {role_name}: `{boots}` is not boots"));
                }
                keys.push(catalogue.item(boots)?.key);
            }
            for key in &build.items {
                keys.push(catalogue.item(key)?.key);
            }
            let mut distinct = keys.clone();
            distinct.sort_unstable();
            distinct.dedup();
            if distinct.len() != keys.len() {
                return Err(format!("{champion} {role_name}: repeated item in {keys:?}"));
            }
            let class_table = category_plan(classify_item_build(role, &champion_key));
            let plan = catalogue
                .assemble_plan(&keys, class_table)
                .map_err(|e| format!("{champion} {role_name}: {e}"))?;
            catalogue.plans.entry(champion_key.clone()).or_default().push((role, plan));
        }
    }
    Ok(catalogue)
}

pub(super) fn catalogue() -> &'static ItemCatalogue {
    static CATALOGUE: OnceLock<ItemCatalogue> = OnceLock::new();
    CATALOGUE.get_or_init(|| {
        parse(ITEMS_JSON, BUILDS_JSON).expect("the item and build files in assets/simulation are valid")
    })
}

pub(super) fn is_boots(key: &str) -> bool {
    catalogue().items.get(key).is_some_and(|item| item.boots)
}

#[cfg(test)]
pub(super) fn item(key: &str) -> Option<&'static CatalogueItem> {
    catalogue().items.get(key)
}

/// The professional build of a champion in a role (`TOP`, `JGL`, `MID`, `ADC`,
/// `SUP`) as a six-item plan in purchase order, boots first, with the budget of
/// the class table the champion buys today. `None` when the pair has no build
/// of its own and falls back on its class, or the champion is unknown.
pub(super) fn pro_plan(role: &str, champion_id: &str) -> Option<&'static [ItemTemplate; 6]> {
    catalogue()
        .plans
        .get(&normalize_champion_key(champion_id))?
        .iter()
        .find(|(plan_role, _)| *plan_role == role)
        .map(|(_, plan)| plan)
}
