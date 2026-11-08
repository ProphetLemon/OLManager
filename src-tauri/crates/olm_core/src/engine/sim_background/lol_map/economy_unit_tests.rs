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
