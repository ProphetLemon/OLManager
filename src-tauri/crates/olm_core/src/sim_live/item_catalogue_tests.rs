//! The items a champion can buy in the live simulator: the class tables, the
//! shop they come from and the professional builds.

use std::collections::HashSet;

use super::champion_fit::role_code;
use super::item_catalogue::{catalogue, is_boots, item, parse, pro_plan};
use super::economy_tests::ROLES;
use super::test_helpers::{empty_neutral, test_champion, test_runtime};
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

fn builds_file() -> serde_json::Value {
    serde_json::from_str(include_str!(
        "../../../../../assets/simulation/champion-builds.v1.json"
    ))
    .expect("builds file")
}

/// Pairs with a professional build in the file, as `(champion, role code,
/// boots, items)`.
fn file_builds() -> Vec<(String, &'static str, Option<String>, Vec<String>)> {
    let file = builds_file();
    let mut builds = Vec::new();
    for (champion, roles) in file["champions"].as_object().expect("champions") {
        for (role, pair) in roles.as_object().expect("roles") {
            let build = &pair["build"];
            if build.is_null() {
                continue;
            }
            builds.push((
                champion.clone(),
                role_code(role).expect("role"),
                build["boots"].as_str().map(str::to_string),
                build["items"]
                    .as_array()
                    .expect("items")
                    .iter()
                    .map(|key| key.as_str().expect("key").to_string())
                    .collect(),
            ));
        }
    }
    builds
}

/// Attack damage, health and gold of the six items each champion and role
/// bought before the plans read the shop (`item_budgets_before.csv`, written
/// by the engine at the commit that preceded this change).
fn budgets_before() -> Vec<(String, String, f64, f64, i64)> {
    include_str!("item_budgets_before.csv")
        .lines()
        .skip(1)
        .map(|line| {
            let f: Vec<&str> = line.split(',').collect();
            (
                f[0].to_string(),
                f[1].to_string(),
                f[2].parse().expect("attack damage"),
                f[3].parse().expect("health"),
                f[4].parse().expect("cost"),
            )
        })
        .collect()
}

fn totals(plan: &[ItemTemplate; 6]) -> (f64, f64, i64) {
    (
        plan.iter().map(|t| t.attack_damage).sum(),
        plan.iter().map(|t| t.max_hp).sum(),
        plan.iter().map(|t| t.cost).sum(),
    )
}

fn keys(plan: &[ItemTemplate; 6]) -> Vec<&'static str> {
    plan.iter().map(|template| template.key).collect()
}

#[test]
fn catalogue_loads_every_item_of_the_shop_file() {
    let in_file = shop_keys();
    assert_eq!(in_file.len(), 211);
    for key in &in_file {
        assert!(item(key).is_some(), "{key} was not loaded");
    }
    catalogue();
}

#[test]
fn catalogue_rejects_a_build_that_names_an_item_the_shop_lacks() {
    let builds = r#"{"champions":{"Ahri":{"Mid":{"build":{"boots":"boots",
        "items":["not_an_item","rabadons_deathcap","zhonyas_hourglass","void_staff","shadowflame"]}}}}}"#;
    let error = parse(include_str!("../../../../../assets/simulation/items.v1.json"), builds)
        .err()
        .expect("a build with an unknown item must be refused");
    assert!(error.contains("not_an_item"), "{error}");
}

#[test]
fn catalogue_rejects_boots_that_are_not_boots_and_repeated_items() {
    let items = include_str!("../../../../../assets/simulation/items.v1.json");
    let not_boots = r#"{"champions":{"Ahri":{"Mid":{"build":{"boots":"void_staff",
        "items":["rabadons_deathcap","zhonyas_hourglass","shadowflame","lich_bane","malignance"]}}}}}"#;
    assert!(parse(items, not_boots).err().expect("refused").contains("not boots"));
    let repeated = r#"{"champions":{"Ahri":{"Mid":{"build":{"boots":"boots",
        "items":["rabadons_deathcap","rabadons_deathcap","shadowflame","lich_bane","malignance"]}}}}}"#;
    assert!(parse(items, repeated).err().expect("refused").contains("repeated"));
}

#[test]
fn every_professional_build_is_a_plan_of_six_distinct_shop_items() {
    let builds = file_builds();
    assert_eq!(builds.len(), 232);
    for (champion, role, _, _) in &builds {
        let plan = pro_plan(role, champion).unwrap_or_else(|| panic!("{champion} {role} has no plan"));
        let plan_keys = keys(plan);
        let distinct: HashSet<&str> = plan_keys.iter().copied().collect();
        assert_eq!(distinct.len(), 6, "{champion} {role}: {plan_keys:?}");
        assert!(
            plan_keys.iter().all(|key| item(key).is_some()),
            "{champion} {role}: {plan_keys:?}"
        );
        let boots = plan_keys.iter().filter(|key| is_boots(key)).count();
        assert!(boots == 1 && is_boots(plan_keys[0]), "{champion} {role}: {plan_keys:?}");
    }
}

#[test]
fn professional_builds_keep_their_items_in_the_order_of_the_file() {
    for (champion, role, boots, items) in file_builds() {
        let Some(boots) = boots else { continue };
        let plan_keys = keys(pro_plan(role, &champion).expect("plan"));
        let own: Vec<&str> = std::iter::once(&boots).chain(items.iter()).map(String::as_str).collect();
        assert_eq!(plan_keys, own, "{champion} {role}");
    }
}

#[test]
fn ahri_yuumi_jinx_and_zed_buy_their_professional_builds() {
    let expected: [(&str, &str, [&str; 6]); 4] = [
        (
            "Ahri",
            "MID",
            ["crimson_lucidity", "malignance", "hextech_rocketbelt", "rabadons_deathcap", "blackfire_torch", "shadowflame"],
        ),
        (
            "Yuumi",
            "SUP",
            ["boots", "mikaels_blessing", "ardent_censer", "moonstone_renewer", "echoes_of_helia", "knights_vow"],
        ),
        (
            "Jinx",
            "ADC",
            ["berserkers_greaves", "infinity_edge", "hexoptics_c44", "lord_dominiks_regards", "runaans_hurricane", "phantom_dancer"],
        ),
        (
            "Zed",
            "MID",
            ["crimson_lucidity", "voltaic_cyclosword", "edge_of_night", "seryldas_grudge", "axiom_arc", "serpents_fang"],
        ),
    ];
    for (champion, role, build) in expected {
        let plan = pro_plan(role, champion).unwrap_or_else(|| panic!("{champion} {role} has no plan"));
        assert_eq!(keys(plan), build, "{champion} {role}");
    }
}

#[test]
fn a_pair_without_professional_games_has_no_plan_of_its_own() {
    // Yuumi was played once on top and once on bot: below the minimum sample.
    assert!(pro_plan("TOP", "Yuumi").is_none());
    assert!(pro_plan("ADC", "Yuumi").is_none());
    assert!(pro_plan("MID", "NotAChampion").is_none());
}

#[test]
fn a_build_without_boots_gets_the_boots_of_its_class_table() {
    let without_boots: Vec<_> = file_builds()
        .into_iter()
        .filter(|(_, _, boots, _)| boots.is_none())
        .collect();
    assert!(!without_boots.is_empty());
    for (champion, role, _, items) in without_boots {
        let plan_keys = keys(pro_plan(role, &champion).expect("plan"));
        assert!(is_boots(plan_keys[0]), "{champion} {role}: {plan_keys:?}");
        assert_eq!(plan_keys[1..], items[..], "{champion} {role}");
    }
}

#[test]
fn professional_plans_name_no_retired_item() {
    let retired = retired_keys();
    for (champion, role, _, _) in file_builds() {
        for key in keys(pro_plan(role, &champion).expect("plan")) {
            assert!(!retired.iter().any(|r| r == key), "{champion} {role} buys {key}");
        }
    }
}

/// Cost, attack damage and health of a plan in the order it is bought: boots
/// first, then the rest in table order.
fn purchase_slots(plan: &[ItemTemplate; 6]) -> Vec<(i64, f64, f64)> {
    let (boots, rest): (Vec<&ItemTemplate>, Vec<&ItemTemplate>) =
        plan.iter().partition(|t| is_boots_item_key(t.key));
    boots
        .into_iter()
        .chain(rest)
        .map(|t| (t.cost, t.attack_damage, t.max_hp))
        .collect()
}

#[test]
fn a_professional_plan_keeps_the_cost_and_stats_of_its_class_table_slot_by_slot() {
    for (champion, role, _, _) in file_builds() {
        let class_table = category_plan(classify_item_build(role, &champion));
        assert_eq!(
            purchase_slots(pro_plan(role, &champion).expect("plan")),
            purchase_slots(class_table),
            "{champion} {role}"
        );
    }
}

#[test]
fn a_professional_build_costs_attack_damage_and_health_as_before() {
    let before = budgets_before();
    let mut checked = 0;
    for (champion, role, _, _) in file_builds() {
        let (_, _, attack_damage, max_hp, cost) = before
            .iter()
            .find(|(id, r, ..)| id.eq_ignore_ascii_case(&champion) && *r == role)
            .unwrap_or_else(|| panic!("{champion} {role} is not in the fixture"));
        let now = totals(pro_plan(role, &champion).expect("plan"));
        assert_eq!(
            now,
            (*attack_damage, *max_hp, *cost),
            "{champion} {role}: attack damage, health, gold"
        );
        checked += 1;
    }
    assert_eq!(checked, 232);
}

fn catalogue_ids() -> Vec<String> {
    let list: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../../assets/simulation/champion-list.json"
    ))
    .expect("champion list");
    list["champions"]
        .as_array()
        .expect("champions")
        .iter()
        .map(|entry| entry["id"].as_str().expect("id").to_string())
        .collect()
}

#[test]
fn every_champion_and_role_buys_the_budget_it_bought_before() {
    let before = budgets_before();
    assert_eq!(before.len(), 173 * 5);
    for (champion, role, attack_damage, max_hp, cost) in before {
        let now = totals(champion_item_plan(&role, &champion));
        assert_eq!(now, (attack_damage, max_hp, cost), "{champion} {role}: attack damage, health, gold");
    }
}

#[test]
fn a_champion_without_a_professional_build_in_a_role_buys_its_class_table() {
    for (champion, role) in [("Yuumi", "TOP"), ("Ahri", "JGL"), ("Jinx", "TOP"), ("NotAChampion", "MID")] {
        assert!(
            std::ptr::eq(
                champion_item_plan(role, champion),
                category_plan(classify_item_build(role, champion))
            ),
            "{champion} {role} does not buy its class table"
        );
    }
}

#[test]
fn a_champion_with_a_professional_build_does_not_buy_its_class_table() {
    let plan = champion_item_plan("MID", "Ahri");
    assert!(!std::ptr::eq(plan, category_plan(classify_item_build("MID", "Ahri"))));
    assert_eq!(plan[1].key, "malignance");
}

#[test]
fn no_champion_and_role_buys_a_retired_item() {
    let retired = retired_keys();
    for champion in catalogue_ids() {
        for role in ROLES {
            for key in keys(champion_item_plan(role, &champion)) {
                assert!(!retired.iter().any(|r| r == key), "{champion} {role} buys {key}");
            }
        }
    }
}

#[test]
fn every_item_a_champion_can_buy_has_an_icon() {
    let icons = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../public/lol-item-icons");
    let mut buyable: HashSet<&str> = HashSet::new();
    for category in CATEGORIES {
        buyable.extend(keys(category_plan(category)));
    }
    for champion in catalogue_ids() {
        for role in ROLES {
            buyable.extend(keys(champion_item_plan(role, &champion)));
        }
    }
    let missing: Vec<&&str> = buyable.iter().filter(|key| !icons.join(format!("{key}.png")).is_file()).collect();
    assert!(missing.is_empty(), "no icon for {missing:?}");
}

#[test]
fn boots_are_recognised_from_the_shop_not_from_a_list() {
    assert!(is_boots_item_key("crimson_lucidity"));
    assert!(is_boots_item_key("boots"));
    assert!(is_boots_item_key("plated_steelcaps"));
    assert!(!is_boots_item_key("rabadons_deathcap"));
    assert!(!is_boots_item_key("mobility_boots"));
}

/// A champion standing in its base with plenty of gold, as after a recall.
fn shopper(champion_id: &str, role: &str, gold: i64) -> ChampionRuntime {
    let mut champion = test_champion("c", "blue", role, "mid", base_position_for("blue"));
    champion.champion_id = champion_id.to_string();
    champion.has_left_base_once = true;
    champion.gold = gold;
    champion
}

#[test]
fn a_champion_buys_its_professional_build_one_item_per_visit_boots_first() {
    let mut runtime = test_runtime(vec![shopper("Ahri", "MID", 100_000)], vec![], vec![], empty_neutral());
    let before = (runtime.champions[0].attack_damage, runtime.champions[0].max_hp);
    for _ in 0..8 {
        try_auto_buy_items(&mut runtime);
    }
    let bought: Vec<&str> = runtime.champions[0].items.iter().map(String::as_str).collect();
    assert_eq!(
        bought,
        ["crimson_lucidity", "malignance", "hextech_rocketbelt", "rabadons_deathcap", "blackfire_torch", "shadowflame"]
    );
    let (attack_damage, max_hp, cost) = budgets_before()
        .into_iter()
        .find(|(id, role, ..)| id == "Ahri" && role == "MID")
        .map(|(_, _, ad, hp, cost)| (ad, hp, cost))
        .expect("fixture");
    let champion = &runtime.champions[0];
    assert_eq!(champion.attack_damage - before.0, attack_damage);
    assert_eq!(champion.max_hp - before.1, max_hp);
    assert_eq!(champion.spent_gold, cost);
    assert_eq!(champion.gold, 100_000 - cost);
}

#[test]
fn a_champion_without_a_build_in_its_role_buys_its_class_table_in_table_order() {
    let mut runtime = test_runtime(vec![shopper("Yuumi", "TOP", 100_000)], vec![], vec![], empty_neutral());
    for _ in 0..8 {
        try_auto_buy_items(&mut runtime);
    }
    let table = category_plan(classify_item_build("TOP", "Yuumi"));
    let mut expected: Vec<&str> = table.iter().filter(|t| is_boots_item_key(t.key)).map(|t| t.key).collect();
    expected.extend(table.iter().filter(|t| !is_boots_item_key(t.key)).map(|t| t.key));
    assert_eq!(runtime.champions[0].items, expected);
}

#[test]
fn the_recall_check_waits_for_the_price_of_the_first_boots_of_the_build() {
    let price = effective_item_cost(champion_item_plan("MID", "Ahri")[0].cost);
    assert!(!champion_can_afford_next_item(&shopper("Ahri", "MID", price - 1)));
    assert!(champion_can_afford_next_item(&shopper("Ahri", "MID", price)));
}
