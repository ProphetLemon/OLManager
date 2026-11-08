//! Unit tests for the gold and item model of the minute-level engine.

use super::*;
use crate::engine::types::{DraftStrategy, PlayerData};

fn player(team: &str, role: LolRole) -> PlayerData {
    PlayerData {
        id: format!("{team}-{role:?}"),
        name: format!("{team}-{role:?}"),
        profile_image_url: None,
        role,
        condition: 100,
        fitness: 75,
        mechanics: 70,
        laning: 70,
        teamfighting: 70,
        macro_play: 70,
        consistency: 70,
        shotcalling: 70,
        champion_pool: 70,
        discipline: 70,
        mental_resilience: 70,
        is_import: false,
        traits: Vec::new(),
    }
}

fn seeded_units() -> Vec<LolUnitState> {
    let roles = [
        LolRole::Top,
        LolRole::Jungle,
        LolRole::Mid,
        LolRole::Adc,
        LolRole::Support,
    ];
    let team = |id: &str| TeamData {
        id: id.to_string(),
        name: id.to_string(),
        draft_strategy: DraftStrategy::default(),
        players: roles.iter().map(|role| player(id, *role)).collect(),
    };
    let mut state = LolMapState::new();
    state.seed_units(&team("home"), &team("away"));
    state.units
}

#[test]
fn unspent_gold_does_not_raise_item_tier() {
    let mut unit = seeded_units().remove(0);
    unit.gold = 20_000.0;

    sync_progress(&mut unit);

    assert_eq!(
        unit.item_tier, 0,
        "a raw gold lead must not count as item power until it is spent"
    );
}

#[test]
fn gold_is_converted_into_items_at_price_breakpoints() {
    let mut unit = seeded_units().remove(0);
    unit.gold = ITEM_PRICES[0] - 1.0;
    buy_items(&mut unit);
    assert_eq!(unit.item_tier, 0);

    unit.gold = ITEM_PRICES[0];
    buy_items(&mut unit);
    assert_eq!(unit.item_tier, 1);
    assert_eq!(unit.gold, 0.0);
    assert_eq!(unit.gold_spent, ITEM_PRICES[0]);

    unit.gold = ITEM_PRICES[1] + 100.0;
    buy_items(&mut unit);
    assert_eq!(unit.item_tier, 2);
    assert_eq!(unit.gold, 100.0, "change stays in the pocket");
}

#[test]
fn item_count_is_capped_and_total_earned_gold_is_preserved() {
    let mut unit = seeded_units().remove(0);
    unit.gold = 50_000.0;
    buy_items(&mut unit);

    assert_eq!(unit.item_tier as usize, ITEM_PRICES.len());
    assert!((unit.gold + unit.gold_spent - 50_000.0).abs() < 1e-9);
    assert!(unit.gold > 0.0, "gold beyond the last item stays unspent");
}

#[test]
fn team_gold_pays_only_the_chosen_side_and_skips_the_dead_when_asked() {
    let mut units = seeded_units();
    for unit in units.iter_mut() {
        unit.gold = 0.0;
    }
    units[1].alive = false; // home jungle is dead

    grant_team_gold(&mut units, Side::Home, 300.0, true);

    for unit in &units {
        let expected = if unit.side == Side::Home && unit.alive {
            300.0
        } else {
            0.0
        };
        assert_eq!(unit.gold + unit.gold_spent, expected, "{:?}", unit.role);
    }
}

#[test]
fn towers_pay_by_tier_and_inhibitors_pay_nothing() {
    assert!(tower_team_gold(StructureTarget::Outer(LaneKey::Mid)) > 0.0);
    assert!(
        tower_team_gold(StructureTarget::Inner(LaneKey::Mid))
            <= tower_team_gold(StructureTarget::Outer(LaneKey::Mid))
    );
    assert!(tower_team_gold(StructureTarget::NexusTop) > 0.0);
    assert_eq!(tower_team_gold(StructureTarget::Inhib(LaneKey::Top)), 0.0);
}

#[test]
fn role_weights_favor_the_carry_over_the_support() {
    let mut units = seeded_units();
    let (mut adc, mut support) = (units.remove(3), units.remove(3));
    adc.gold = 0.0;
    support.gold = 0.0;
    credit_gold(&mut adc, 100.0);
    credit_gold(&mut support, 100.0);
    assert!(adc.gold > support.gold);
}

/// A unit shaped like one saved before the item model: `item_tier` came from
/// `floor(total gold / 1450)`, every coin sat in `gold` and `gold_spent` did not
/// exist (it deserializes to 0).
fn legacy_unit(item_tier: u8, total_gold: f64) -> LolUnitState {
    let mut unit = seeded_units().remove(0);
    unit.item_tier = item_tier;
    unit.gold = total_gold;
    unit.gold_spent = 0.0;
    unit
}

#[test]
fn old_save_does_not_buy_several_items_on_its_first_tick() {
    // Three items under the old rule, 4600 gold earned. Without a backfill the
    // unit looked like it had 4600 unspent coins and bought items 4, 5 and 6
    // at once (a one-off +3 item power spike).
    let mut state = super::test_support::new_match(70, 70);
    state.lol_map.units[0] = legacy_unit(3, 4_600.0);
    let earned_before = 4_600.0;

    state.tick_progression(1);

    let unit = &state.lol_map.units[0];
    assert_eq!(unit.item_tier, 3, "the first tick must not add items");
    assert_eq!(
        unit.gold_spent,
        ITEM_PRICES[..3].iter().sum::<f64>(),
        "gold_spent is backfilled from the item count"
    );
    let earned_after = unit.gold + unit.gold_spent;
    assert!(
        earned_after >= earned_before && earned_after - earned_before < 200.0,
        "total earned gold is preserved apart from one tick of income, got {earned_after}"
    );
}

#[test]
fn backfill_is_idempotent_and_leaves_new_matches_alone() {
    let mut state = super::test_support::new_match(70, 70);
    state.lol_map.units[0] = legacy_unit(2, 3_000.0);

    state.tick_progression(1);
    let after_first = state.lol_map.units[0].clone();
    // A second tick only adds income; it must not backfill again.
    state.tick_progression(2);
    let after_second = &state.lol_map.units[0];
    assert_eq!(after_second.gold_spent, after_first.gold_spent);
    assert_eq!(after_second.item_tier, after_first.item_tier);

    // A fresh unit (no items, nothing spent) is untouched by the migration.
    let fresh = &state.lol_map.units[1];
    assert_eq!(fresh.gold_spent, 0.0);
    assert_eq!(fresh.item_tier, 0);
}

#[test]
fn saves_without_the_rating_fields_load_as_a_neutral_player() {
    let unit = seeded_units().remove(0);
    let mut json = serde_json::to_value(&unit).expect("unit serializes");
    let map = json.as_object_mut().expect("unit is an object");
    for key in ["fight_skill", "macro_skill", "gold_spent"] {
        map.remove(key);
    }
    let loaded: LolUnitState = serde_json::from_value(json).expect("old unit loads");
    assert_eq!(loaded.fight_skill, 0.0);
    assert_eq!(loaded.macro_skill, 0.0);
    assert_eq!(loaded.gold_spent, 0.0);

    let lane = serde_json::json!({
        "outer_alive": true, "outer_hp": 1200.0, "inner_alive": true, "inner_hp": 1400.0,
        "inhibitor_alive": true, "inhibitor_hp": 1200.0, "inhibitor_respawn_minute": null
    });
    let lane: LolLaneState = serde_json::from_value(lane).expect("old lane loads");
    assert_eq!(lane.front, 0.5, "an old lane starts from the neutral front");
}
