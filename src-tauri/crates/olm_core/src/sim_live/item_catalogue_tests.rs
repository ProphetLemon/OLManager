//! The items a champion can buy in the live simulator: the class tables, the
//! shop they come from and the professional builds.

use std::collections::HashSet;

use super::*;

const CATEGORIES: [ItemBuildCategory; 13] = [
    ItemBuildCategory::Tank,
    ItemBuildCategory::Bruiser,
    ItemBuildCategory::Colossus,
    ItemBuildCategory::AssassinAd,
    ItemBuildCategory::AssassinAp,
    ItemBuildCategory::ControlMage,
    ItemBuildCategory::BattleMage,
    ItemBuildCategory::AdcCrit,
    ItemBuildCategory::AdcAttackSpeed,
    ItemBuildCategory::LethalityMarksman,
    ItemBuildCategory::SupportEngage,
    ItemBuildCategory::SupportEnchanter,
    ItemBuildCategory::SupportDamage,
];

fn shop_file() -> serde_json::Value {
    serde_json::from_str(include_str!(
        "../../../../../assets/simulation/items.v1.json"
    ))
    .expect("items file")
}

fn shop_keys() -> HashSet<String> {
    shop_file()["items"]
        .as_array()
        .expect("items")
        .iter()
        .map(|item| item["key"].as_str().expect("key").to_string())
        .collect()
}

fn retired_keys() -> Vec<String> {
    shop_file()["retiredKeys"]
        .as_array()
        .expect("retiredKeys")
        .iter()
        .map(|key| key.as_str().expect("key").to_string())
        .collect()
}

#[test]
fn class_tables_name_only_items_the_shop_sells() {
    let shop = shop_keys();
    let retired = retired_keys();
    let mut offenders = Vec::new();
    for (index, category) in CATEGORIES.into_iter().enumerate() {
        for template in category_plan(category) {
            if !shop.contains(template.key) || retired.iter().any(|key| key == template.key) {
                offenders.push(format!("table {index} names `{}`", template.key));
            }
        }
    }
    assert!(offenders.is_empty(), "{offenders:?}");
}

#[test]
fn class_tables_hold_six_distinct_items_with_boots_last() {
    for (index, category) in CATEGORIES.into_iter().enumerate() {
        let plan = category_plan(category);
        let distinct: HashSet<&str> = plan.iter().map(|template| template.key).collect();
        assert_eq!(distinct.len(), 6, "table {index} repeats an item");
        assert!(is_boots_item_key(plan[5].key), "table {index} has no boots last");
    }
}
