//! The jungler recalls only where nobody can stop the channel: 59% of his deaths in the replay
//! happened around a recall, because the channel started whenever no enemy stood within 0.085
//! although an enemy reaches and hits a recaller from the engagement radius (0.16).

use super::macro_ai::should_recall_in_place;
use super::test_helpers::{test_champion, test_structure};
use super::*;

const NOW: f64 = LANE_COMBAT_UNLOCK_AT + 900.0;
const HOME: Vec2 = Vec2 { x: 0.50, y: 0.50 };

fn jungler() -> ChampionRuntime {
    test_champion("blue-JGL", "blue", "JGL", "jungle", HOME)
}

fn enemy_at(distance: f64) -> ChampionRuntime {
    test_champion(
        "red-MID",
        "red",
        "MID",
        "mid",
        Vec2 { x: HOME.x + distance, y: HOME.y },
    )
}

#[test]
fn a_jungler_does_not_channel_with_an_enemy_who_can_arrive_before_the_end() {
    let jungler = jungler();
    let enemy = enemy_at(0.14);

    assert!(!should_recall_in_place(&jungler, &[jungler.clone(), enemy]));
}

#[test]
fn a_jungler_channels_where_no_enemy_reaches_the_engagement_radius() {
    let jungler = jungler();
    let enemy = enemy_at(0.30);

    assert!(should_recall_in_place(&jungler, &[jungler.clone(), enemy]));
}

#[test]
fn a_jungler_ignores_an_enemy_who_is_recalling_or_has_little_health() {
    let jungler = jungler();
    let mut recalling = enemy_at(0.12);
    recalling.state = "recall".to_string();
    let mut hurt = enemy_at(0.12);
    hurt.id = "red-TOP".to_string();
    hurt.hp = 10.0;

    assert!(should_recall_in_place(&jungler, &[jungler.clone(), recalling, hurt]));
}

#[test]
fn a_laner_keeps_the_old_rule_and_channels_with_an_enemy_beyond_the_cancel_radius() {
    let laner = test_champion("blue-MID", "blue", "MID", "mid", HOME);
    let enemy = enemy_at(0.14);

    assert!(should_recall_in_place(&laner, &[laner.clone(), enemy]));
}

#[test]
fn a_jungler_with_a_reachable_enemy_walks_away_before_the_channel() {
    let mut jungler = jungler();
    let enemy = enemy_at(0.14);
    let team = [jungler.clone(), enemy];

    start_recall(&mut jungler, NOW, &team, &[], &[]);

    let anchor = jungler.recall_anchor.expect("the recall has no anchor");
    assert!(
        anchor.x < HOME.x - 0.02,
        "the anchor {anchor:?} is not away from the enemy to the east"
    );
}

#[test]
fn a_jungler_with_nobody_near_recalls_in_place() {
    let mut jungler = jungler();
    let team = [jungler.clone()];

    start_recall(&mut jungler, NOW, &team, &[], &[]);

    let anchor = jungler.recall_anchor.expect("the recall has no anchor");
    assert!(dist(anchor, HOME) < 1e-9, "the anchor {anchor:?} moved");
}

#[test]
fn the_jungler_recall_anchor_stays_out_of_an_enemy_tower() {
    let jungler = jungler();
    let tower = test_structure("red-mid-outer", "red", "mid", Vec2 { x: 0.52, y: 0.50 });

    let anchor = safe_recall_anchor(&jungler, HOME, std::slice::from_ref(&tower));

    assert!(
        dist(anchor, tower.pos) > TOWER_ATTACK_RANGE,
        "the anchor {anchor:?} is inside the enemy tower's reach"
    );
}

#[test]
fn a_jungler_guarded_by_his_group_channels_in_place_like_the_interrupter_expects() {
    // The champion who stops a recall does not walk into a group: the recaller's side near him
    // must not outnumber his own. Two allies beside the jungler against one enemy do that.
    let jungler = jungler();
    let enemy = enemy_at(0.14);
    let mut top = test_champion("blue-TOP", "blue", "TOP", "top", Vec2 { x: HOME.x + 0.02, y: HOME.y });
    top.hp = 100.0;
    let mut adc = test_champion("blue-ADC", "blue", "ADC", "bot", Vec2 { x: HOME.x - 0.02, y: HOME.y });
    adc.hp = 100.0;

    assert!(should_recall_in_place(&jungler, &[jungler.clone(), top, adc, enemy]));
}
