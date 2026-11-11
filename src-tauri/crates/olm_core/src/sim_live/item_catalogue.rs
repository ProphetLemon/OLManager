//! The real item shop and the builds professionals use, for the live simulator.
//!
//! Two committed files feed it: `assets/simulation/items.v1.json` (the shop of
//! one patch, with the real stats and costs) and
//! `assets/simulation/champion-builds.v1.json` (for each champion and role, the
//! boots and five items it ends a professional game with, or a marker that it
//! has too few games and falls back on its class).
//!
//! The engine knows only two effects of an item, attack damage and health, and
//! the balance of the whole engine rests on how much of both a full build gives
//! and what it costs. So a professional build keeps the budget of the class
//! table the champion buys today: the six items together give exactly the same
//! attack damage and health and cost exactly the same gold. What the real
//! catalogue decides is which items they are, in which order they are bought,
//! and how that budget is split among them ([`budget_weights`]).

use serde::Deserialize;
use std::collections::HashMap;
use std::sync::OnceLock;

use super::champion_fit::role_code;
use super::{
    category_plan, classify_item_build, normalize_champion_key, ItemTemplate, ITEM_COST_MIN,
};

const ITEMS_JSON: &str = include_str!("../../../../../assets/simulation/items.v1.json");
const BUILDS_JSON: &str = include_str!("../../../../../assets/simulation/champion-builds.v1.json");

/// Statistic that counts as one point of a stat score: a typical full item
/// carries about one point of its main stat. Offence, defence and utility
/// scores are sums of `value / UNIT` over the stats of an item.
const ATTACK_DAMAGE_UNIT: f64 = 60.0;
const ABILITY_POWER_UNIT: f64 = 100.0;
const ATTACK_SPEED_UNIT: f64 = 0.35;
const CRIT_CHANCE_UNIT: f64 = 0.25;
const LETHALITY_UNIT: f64 = 18.0;
const ARMOR_PENETRATION_UNIT: f64 = 30.0;
const MAGIC_PENETRATION_UNIT: f64 = 15.0;
/// Points an on-hit item earns for its effect, which has no number of its own.
const ON_HIT_POINTS: f64 = 0.5;
const HEALTH_UNIT: f64 = 400.0;
const ARMOR_UNIT: f64 = 50.0;
const MAGIC_RESIST_UNIT: f64 = 50.0;
const ABILITY_HASTE_UNIT: f64 = 20.0;
const MANA_UNIT: f64 = 600.0;
const MOVE_SPEED_UNIT: f64 = 0.08;
const HEAL_SHIELD_UNIT: f64 = 15.0;
const SUSTAIN_UNIT: f64 = 0.10;

/// How much of its utility score an item adds to both budgets: utility items
/// (haste, mana, movement, heal and shield power, sustain) take a small share
/// of the damage and of the health.
const UTILITY_WEIGHT: f64 = 0.25;
/// Every item that is not boots keeps a sliver of both budgets, so an item
/// without a stat of one kind still gets a whole-number share, and a budget is
/// never left with no item able to carry it.
const BUDGET_FLOOR: f64 = 0.05;

#[derive(Deserialize)]
struct ItemsFile {
    items: Vec<ItemEntry>,
}

#[derive(Deserialize)]
struct ItemEntry {
    key: String,
    cost: i64,
    #[serde(default)]
    stats: HashMap<String, f64>,
    #[serde(rename = "statLines", default)]
    stat_lines: Vec<StatLine>,
    #[serde(default)]
    tags: Vec<String>,
    boots: bool,
}

#[derive(Deserialize)]
struct StatLine {
    stat: String,
    value: String,
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

/// The real stats of an item that the budget split reads. Percentages are
/// fractions except penetration and heal and shield power, which keep the
/// number the shop prints (`35%` is `35.0`).
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub(super) struct ItemStats {
    pub(super) attack_damage: f64,
    pub(super) ability_power: f64,
    pub(super) attack_speed: f64,
    pub(super) crit_chance: f64,
    pub(super) lethality: f64,
    pub(super) armor_penetration: f64,
    pub(super) magic_penetration: f64,
    pub(super) on_hit: bool,
    pub(super) health: f64,
    pub(super) armor: f64,
    pub(super) magic_resist: f64,
    pub(super) ability_haste: f64,
    pub(super) mana: f64,
    pub(super) move_speed: f64,
    pub(super) heal_shield_power: f64,
    /// Life steal plus omnivamp.
    pub(super) sustain: f64,
}

pub(super) struct CatalogueItem {
    pub(super) key: &'static str,
    pub(super) cost: i64,
    pub(super) boots: bool,
    pub(super) stats: ItemStats,
}

pub(super) struct ItemCatalogue {
    items: HashMap<&'static str, CatalogueItem>,
    /// The plan of each professional build by normalised champion key and role
    /// code: its six items in purchase order, boots first, with the budget of
    /// the champion's class table split among them.
    plans: HashMap<String, Vec<(&'static str, [ItemTemplate; 6])>>,
}

fn item_stats(entry: &ItemEntry) -> ItemStats {
    let flat = |name: &str| entry.stats.get(name).copied().unwrap_or(0.0);
    let line = |name: &str| {
        entry
            .stat_lines
            .iter()
            .find(|line| line.stat == name)
            .and_then(|line| line.value.trim_end_matches('%').parse::<f64>().ok())
            .unwrap_or(0.0)
    };
    ItemStats {
        attack_damage: flat("FlatPhysicalDamageMod"),
        ability_power: flat("FlatMagicDamageMod"),
        attack_speed: flat("PercentAttackSpeedMod"),
        crit_chance: flat("FlatCritChanceMod"),
        lethality: line("Lethality"),
        armor_penetration: line("Armor Penetration"),
        magic_penetration: line("Magic Penetration"),
        on_hit: entry.tags.iter().any(|tag| tag == "OnHit"),
        health: flat("FlatHPPoolMod"),
        armor: flat("FlatArmorMod"),
        magic_resist: flat("FlatSpellBlockMod"),
        ability_haste: line("Ability Haste"),
        mana: flat("FlatMPPoolMod"),
        move_speed: flat("PercentMovementSpeedMod"),
        heal_shield_power: line("Heal and Shield Power"),
        sustain: flat("PercentLifeStealMod") + line("Omnivamp") / 100.0,
    }
}

/// Points of offence: attack damage, ability power, attack speed, crit,
/// lethality, penetration and on-hit effects.
pub(super) fn offence_points(stats: &ItemStats) -> f64 {
    stats.attack_damage / ATTACK_DAMAGE_UNIT
        + stats.ability_power / ABILITY_POWER_UNIT
        + stats.attack_speed / ATTACK_SPEED_UNIT
        + stats.crit_chance / CRIT_CHANCE_UNIT
        + stats.lethality / LETHALITY_UNIT
        + stats.armor_penetration / ARMOR_PENETRATION_UNIT
        + stats.magic_penetration / MAGIC_PENETRATION_UNIT
        + if stats.on_hit { ON_HIT_POINTS } else { 0.0 }
}

/// Points of defence: health, armor and magic resist.
pub(super) fn defence_points(stats: &ItemStats) -> f64 {
    stats.health / HEALTH_UNIT + stats.armor / ARMOR_UNIT + stats.magic_resist / MAGIC_RESIST_UNIT
}

/// Points of utility: ability haste, mana, movement, heal and shield power
/// and sustain.
pub(super) fn utility_points(stats: &ItemStats) -> f64 {
    stats.ability_haste / ABILITY_HASTE_UNIT
        + stats.mana / MANA_UNIT
        + stats.move_speed / MOVE_SPEED_UNIT
        + stats.heal_shield_power / HEAL_SHIELD_UNIT
        + stats.sustain / SUSTAIN_UNIT
}

/// Weights with which an item takes part in the build's attack damage budget
/// and in its health budget, as `(damage, health)`. An offensive item weighs
/// more in the damage budget, a defensive one in the health budget, a utility
/// item adds a quarter of its utility points to both, and boots weigh nothing
/// in either: they stay cheap and weak as in the class tables.
pub(super) fn budget_weights(stats: &ItemStats, boots: bool) -> (f64, f64) {
    if boots {
        return (0.0, 0.0);
    }
    let utility = UTILITY_WEIGHT * utility_points(stats);
    (
        BUDGET_FLOOR + offence_points(stats) + utility,
        BUDGET_FLOOR + defence_points(stats) + utility,
    )
}

/// Splits `total` into whole numbers proportional to `weights` that add up to
/// exactly `total` (largest remainder; ties go to the earlier item). `None`
/// when there is something to split and no weight to split it by.
pub(super) fn apportion(total: i64, weights: &[f64]) -> Option<Vec<i64>> {
    if total == 0 {
        return Some(vec![0; weights.len()]);
    }
    let sum: f64 = weights.iter().sum();
    if sum <= 0.0 {
        return None;
    }
    let exact: Vec<f64> = weights.iter().map(|w| total as f64 * w / sum).collect();
    let mut shares: Vec<i64> = exact.iter().map(|x| x.floor() as i64).collect();
    let left = (total - shares.iter().sum::<i64>()).max(0) as usize;
    let mut by_remainder: Vec<usize> = (0..weights.len()).collect();
    by_remainder.sort_by(|&a, &b| {
        (exact[b] - shares[b] as f64).total_cmp(&(exact[a] - shares[a] as f64))
    });
    for &i in by_remainder.iter().take(left) {
        shares[i] += 1;
    }
    Some(shares)
}

/// [`apportion`] with no share below `floor`: an item whose proportional share
/// falls under it is held at `floor` and the rest is split among the others.
/// The engine never charges less than its minimum item price, so a smaller
/// share would change the cost of the build.
pub(super) fn apportion_with_floor(total: i64, weights: &[f64], floor: i64) -> Option<Vec<i64>> {
    let mut held = vec![false; weights.len()];
    loop {
        let rest = total - held.iter().filter(|&&h| h).count() as i64 * floor;
        let active: Vec<usize> = (0..weights.len()).filter(|&i| !held[i]).collect();
        let sum: f64 = active.iter().map(|&i| weights[i]).sum();
        let below: Vec<usize> = active
            .iter()
            .copied()
            .filter(|&i| (rest as f64 * weights[i] / sum) < floor as f64)
            .collect();
        if below.is_empty() {
            let active_weights: Vec<f64> = active.iter().map(|&i| weights[i]).collect();
            let split = apportion(rest, &active_weights)?;
            let mut shares = vec![floor; weights.len()];
            for (&i, share) in active.iter().zip(split) {
                shares[i] = share;
            }
            return Some(shares);
        }
        for i in below {
            held[i] = true;
        }
    }
}

impl ItemCatalogue {
    fn item(&self, key: &str) -> Result<&CatalogueItem, String> {
        self.items
            .get(key)
            .ok_or_else(|| format!("item `{key}` is not in the item catalogue"))
    }

    /// The six items of a plan: the professional items in purchase order, boots
    /// first, completed from the class table when the build has no boots or
    /// fewer than five items. The class table's attack damage, health and gold
    /// are the budget; the real stats and costs of the six decide each share.
    fn assemble_plan(
        &self,
        build: &[&'static str],
        class_table: &[ItemTemplate; 6],
    ) -> Result<[ItemTemplate; 6], String> {
        let mut keys: Vec<&'static str> = build.to_vec();
        if !keys.iter().any(|key| self.items[key].boots) {
            let boots = class_table
                .iter()
                .filter_map(|template| self.items.get(template.key))
                .find(|item| item.boots)
                .ok_or("a class table has no boots")?;
            keys.insert(0, boots.key);
        }
        for template in class_table {
            let item = self.item(template.key)?;
            if keys.len() < 6 && !item.boots && !keys.contains(&item.key) {
                keys.push(item.key);
            }
        }
        if keys.len() != 6 {
            return Err(format!("a plan needs six items, got {keys:?}"));
        }

        let items: Vec<&CatalogueItem> = keys.iter().map(|key| &self.items[key]).collect();
        let weights: Vec<(f64, f64)> = items
            .iter()
            .map(|item| budget_weights(&item.stats, item.boots))
            .collect();
        let costs: Vec<f64> = items.iter().map(|item| item.cost as f64).collect();
        let split = |total: f64, weights: Vec<f64>| {
            apportion(total.round() as i64, &weights).ok_or("a budget has no item to carry it")
        };
        let attack_damage = split(
            class_table.iter().map(|t| t.attack_damage).sum(),
            weights.iter().map(|w| w.0).collect(),
        )?;
        let max_hp = split(
            class_table.iter().map(|t| t.max_hp).sum(),
            weights.iter().map(|w| w.1).collect(),
        )?;
        let cost = apportion_with_floor(
            class_table.iter().map(|t| t.cost).sum(),
            &costs,
            ITEM_COST_MIN,
        )
        .ok_or("the gold budget cannot give every item the minimum price")?;

        Ok(std::array::from_fn(|i| ItemTemplate {
            key: items[i].key,
            cost: cost[i],
            attack_damage: attack_damage[i] as f64,
            max_hp: max_hp[i] as f64,
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
            cost: entry.cost,
            boots: entry.boots,
            stats: item_stats(entry),
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
