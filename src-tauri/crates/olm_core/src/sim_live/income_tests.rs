//! What a match pays: passive income, the farm weights, kills and assists.

use super::economy::{
    champion_kill_rewards, passive_payment, passive_payments_due, role_adjusted_income,
    role_income_weight, PASSIVE_GOLD_PER_PAYMENT, PASSIVE_GOLD_START_SEC,
};
use super::test_helpers::{empty_neutral, test_champion, test_runtime};
use super::*;

fn five_roles() -> RuntimeState {
    let champions = ["TOP", "JGL", "MID", "ADC", "SUP"]
        .iter()
        .map(|role| test_champion(role, "blue", role, "mid", Vec2 { x: 0.5, y: 0.5 }))
        .collect();
    test_runtime(champions, vec![], vec![], empty_neutral())
}

#[test]
fn passive_gold_starts_at_110_seconds_and_comes_every_ten() {
    assert_eq!(passive_payments_due(PASSIVE_GOLD_START_SEC - 0.1), 0);
    assert_eq!(passive_payments_due(PASSIVE_GOLD_START_SEC), 1);
    assert_eq!(passive_payments_due(PASSIVE_GOLD_START_SEC + 9.9), 1);
    assert_eq!(passive_payments_due(PASSIVE_GOLD_START_SEC + 10.0), 2);
}

#[test]
fn every_role_gets_the_same_passive_gold_and_the_support_his_item_on_top() {
    for role in ["TOP", "JGL", "MID", "ADC"] {
        assert_eq!(passive_payment(role), PASSIVE_GOLD_PER_PAYMENT, "{role}");
    }
    assert!(passive_payment("SUP") > PASSIVE_GOLD_PER_PAYMENT);
}

#[test]
fn passive_gold_is_paid_to_the_living_and_the_dead_once() {
    let mut runtime = five_roles();
    runtime.champions[2].alive = false;
    runtime.time_sec = PASSIVE_GOLD_START_SEC + 25.0;

    pay_passive_gold(&mut runtime);
    pay_passive_gold(&mut runtime);

    let paid = |role: &str| runtime.champions.iter().find(|c| c.role == role).map(|c| c.gold);
    assert_eq!(paid("TOP"), Some(3 * PASSIVE_GOLD_PER_PAYMENT), "three payments, once each");
    assert_eq!(paid("MID"), paid("TOP"), "the dead champion was not paid");
    assert_eq!(paid("SUP"), Some(3 * passive_payment("SUP")));
}

#[test]
fn passive_gold_is_in_the_ledger_and_the_team_total() {
    let mut runtime = five_roles();
    runtime.time_sec = PASSIVE_GOLD_START_SEC;

    pay_passive_gold(&mut runtime);

    let from_ledger = runtime.gold_ledger.tally("TOP").gold[GoldSource::Passive.index()];
    assert_eq!(from_ledger, PASSIVE_GOLD_PER_PAYMENT);
    let team_total: i64 = ["TOP", "JGL", "MID", "ADC", "SUP"].iter().map(|r| passive_payment(r)).sum();
    assert_eq!(runtime.stats.blue.gold, team_total);
}

#[test]
fn a_kill_pays_the_same_to_every_role() {
    let victim = test_champion("v", "red", "MID", "mid", Vec2 { x: 0.5, y: 0.5 });
    let reward = |role: &str| {
        let killer = test_champion("k", "blue", role, "mid", Vec2 { x: 0.5, y: 0.5 });
        champion_kill_rewards(&killer, &victim)
    };
    for role in ["TOP", "JGL", "ADC", "SUP"] {
        assert_eq!(reward(role), reward("MID"), "{role}");
    }
}

#[test]
fn the_farm_weight_does_not_touch_a_kill_an_assist_or_an_objective() {
    for source in [GoldSource::Kill, GoldSource::Assist, GoldSource::Dragon, GoldSource::Baron] {
        let mut runtime = five_roles();
        add_gold_xp_to_champion(&mut runtime, "ADC", 100, 0, source);
        assert_eq!(runtime.champions[3].gold, 100, "a weight was applied to a {source:?}");
    }
}

#[test]
fn the_farm_weight_applies_to_jungle_camps() {
    let mut runtime = five_roles();
    add_gold_xp_to_champion(&mut runtime, "ADC", 100, 0, GoldSource::JungleCamp);
    assert_eq!(runtime.champions[3].gold, role_adjusted_income("ADC", 100));
}

#[test]
fn no_role_weight_is_above_two() {
    for role in ["TOP", "JGL", "MID", "ADC", "SUP"] {
        assert!(role_income_weight(role) <= 2.0, "{role}: {}", role_income_weight(role));
    }
}
