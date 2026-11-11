//! Rules for neutral objectives and the jungler: team requirement and return
//! damage for Baron and Elder, a jungler that always has something to do, and
//! targets that cannot be reached.

use std::collections::HashMap;

use super::combat::pick_combat_target;
use super::test_helpers::{test_champion, test_neutral_timer, test_runtime};
use super::*;

const BARON_POS: Vec2 = Vec2 {
    x: 0.327_473_958_333_333_3,
    y: 0.298_177_083_333_333_3,
};
const DRAGON_POS: Vec2 = Vec2 {
    x: 0.673_828_125,
    y: 0.703_125,
};
const FAR_AWAY: Vec2 = Vec2 { x: 0.12, y: 0.9 };

/// A champion with the attack damage and health a typical one has at the
/// first Baron (measured with the detector, see the PR notes).
fn fighter(id: &str, team: &str, role: &str, pos: Vec2) -> ChampionRuntime {
    let mut champion = test_champion(id, team, role, "mid", pos);
    champion.attack_damage = TYPICAL_ATTACK_DAMAGE;
    champion.max_hp = TYPICAL_MAX_HP;
    champion.hp = TYPICAL_MAX_HP;
    champion.level = 11;
    champion
}

const TYPICAL_ATTACK_DAMAGE: f64 = 125.0;
const TYPICAL_MAX_HP: f64 = 1_600.0;

fn timers(entries: &[(&str, Vec2, f64)]) -> NeutralTimersRuntime {
    let entities = entries
        .iter()
        .map(|(key, pos, hp)| {
            let mut timer = test_neutral_timer(key, *pos, true);
            timer.hp = *hp;
            timer.max_hp = *hp;
            (key.to_string(), timer)
        })
        .collect();
    NeutralTimersRuntime {
        dragon_soul_unlocked: false,
        elder_unlocked: false,
        entities,
        extra: HashMap::new(),
    }
}

fn baron() -> NeutralTimersRuntime {
    timers(&[("baron", BARON_POS, 9_000.0)])
}

/// Blue team of `blue_at_pit` champions standing at Baron, the rest of the
/// five at base, against a full red team at its base.
fn baron_runtime(blue_at_pit: usize) -> RuntimeState {
    let roles = ["JGL", "TOP", "MID", "ADC", "SUP"];
    let mut champions = Vec::new();
    for (i, role) in roles.iter().enumerate() {
        let pos = if i < blue_at_pit { BARON_POS } else { FAR_AWAY };
        champions.push(fighter(&format!("blue-{role}"), "blue", role, pos));
    }
    for role in roles {
        champions.push(fighter(&format!("red-{role}"), "red", role, FAR_AWAY));
    }
    let mut runtime = test_runtime(champions, vec![], vec![], baron());
    runtime.time_sec = 21.0 * 60.0;
    runtime
}

/// Every attacker hits once per 0.78 s until Baron is dead or `max_rounds`
/// passed; returns the rounds it took.
fn hit_baron_until_dead(
    runtime: &mut RuntimeState,
    neutral: &mut NeutralTimersRuntime,
    attackers: &[usize],
    max_rounds: usize,
) -> Option<usize> {
    for round in 1..=max_rounds {
        runtime.time_sec += 0.78;
        for &idx in attackers {
            if runtime.champions[idx].alive {
                attack_neutral_if_in_range(runtime, neutral, idx, "baron");
            }
        }
        if !neutral.entities["baron"].alive {
            return Some(round);
        }
    }
    None
}

#[test]
fn jungler_alone_at_baron_does_not_hit_it() {
    let mut runtime = baron_runtime(1);
    let mut neutral = baron();

    let hit = attack_neutral_if_in_range(&mut runtime, &mut neutral, 0, "baron");

    assert!(!hit, "a lone jungler must not start Baron");
    assert_eq!(neutral.entities["baron"].hp, 9_000.0);
    assert_eq!(runtime.champions[0].hp, TYPICAL_MAX_HP);
}

#[test]
fn two_champions_do_not_start_baron_against_a_full_team() {
    let mut runtime = baron_runtime(2);
    let mut neutral = baron();

    assert!(!attack_neutral_if_in_range(&mut runtime, &mut neutral, 0, "baron"));
}

#[test]
fn two_champions_may_start_baron_when_the_enemy_has_two_alive() {
    let mut runtime = baron_runtime(2);
    for enemy in runtime.champions.iter_mut().filter(|c| c.team == "red").skip(2) {
        enemy.alive = false;
    }
    let mut neutral = baron();

    assert!(attack_neutral_if_in_range(&mut runtime, &mut neutral, 0, "baron"));
}

#[test]
fn group_of_three_takes_baron_without_losing_health() {
    let mut runtime = baron_runtime(3);
    let mut neutral = baron();

    let rounds = hit_baron_until_dead(&mut runtime, &mut neutral, &[0, 1, 2], 400);

    assert!(rounds.is_some(), "the group never finished Baron");
    for champion in &runtime.champions[..3] {
        assert!(champion.alive, "{} died", champion.id);
        assert_eq!(champion.hp, champion.max_hp, "Baron must not hit back");
    }
}

#[test]
fn two_champions_take_baron_when_the_enemy_has_two_alive_and_survive() {
    let mut runtime = baron_runtime(2);
    for enemy in runtime.champions.iter_mut().filter(|c| c.team == "red").skip(2) {
        enemy.alive = false;
    }
    let mut neutral = baron();

    let rounds = hit_baron_until_dead(&mut runtime, &mut neutral, &[0, 1], 400);

    assert!(rounds.is_some());
    assert!(runtime.champions[0].alive && runtime.champions[1].alive);
}

#[test]
fn survivors_leave_baron_when_the_group_falls_under_the_requirement() {
    let mut runtime = baron_runtime(3);
    let mut neutral = baron();
    assert!(attack_neutral_if_in_range(&mut runtime, &mut neutral, 0, "baron"));
    let hp_after_first_hit = neutral.entities["baron"].hp;

    runtime.champions[1].alive = false;
    let hit = attack_neutral_if_in_range(&mut runtime, &mut neutral, 0, "baron");

    assert!(!hit);
    assert_eq!(neutral.entities["baron"].hp, hp_after_first_hit);
    assert!(macro_ai::champion_avoids(
        &runtime.champions[0],
        BARON_POS,
        runtime.time_sec
    ));
}

#[test]
fn elder_needs_a_group_too() {
    let mut runtime = baron_runtime(0);
    runtime.champions[0].pos = DRAGON_POS;
    let mut neutral = timers(&[("elder", DRAGON_POS, 7_200.0)]);

    assert!(!attack_neutral_if_in_range(&mut runtime, &mut neutral, 0, "elder"));
}

#[test]
fn abandoned_baron_attempt_heals_back_to_full() {
    let mut neutral = baron();
    let timer = neutral.entities.get_mut("baron").unwrap();
    timer.hp = 4_000.0;
    timer.last_hit_at = Some(100.0);

    objectives::tick_neutral_entity_timer(&mut neutral, "baron", 100.0 + 10.0);
    assert_eq!(neutral.entities["baron"].hp, 4_000.0, "healed too early");

    objectives::tick_neutral_entity_timer(&mut neutral, "baron", 100.0 + 21.0);
    assert_eq!(neutral.entities["baron"].hp, 9_000.0);
}

#[test]
fn damage_to_a_dragon_is_not_healed() {
    let mut neutral = timers(&[("dragon", DRAGON_POS, 5_000.0)]);
    let timer = neutral.entities.get_mut("dragon").unwrap();
    timer.hp = 2_000.0;
    timer.last_hit_at = Some(100.0);

    objectives::tick_neutral_entity_timer(&mut neutral, "dragon", 400.0);

    assert_eq!(neutral.entities["dragon"].hp, 2_000.0);
}

/// Runs one decision of champion `idx` and returns where it now walks to.
fn decide(
    champions: &mut [ChampionRuntime],
    idx: usize,
    now: f64,
    neutral: &NeutralTimersRuntime,
) -> Option<Vec2> {
    let snapshot = champions.to_vec();
    let mut champion = champions[idx].clone();
    macro_ai::decide_champion_state(
        &mut champion,
        now,
        &[],
        &[],
        &snapshot,
        Some(neutral),
        &RuntimeTeamTactics::default(),
        &RuntimeTeamBuffState::default(),
    );
    let target = champion.target_path.last().copied();
    champions[idx] = champion;
    target
}

fn near(a: Option<Vec2>, b: Vec2) -> bool {
    a.is_some_and(|a| dist(a, b) <= 0.03)
}

fn gromp_blue() -> (&'static str, Vec2, f64) {
    ("gromp-blue", Vec2 { x: 0.16, y: 0.43 }, 470.0)
}

#[test]
fn jungler_does_not_go_for_baron_without_a_group_that_can_form() {
    let mut runtime = baron_runtime(0);
    runtime.champions[0].pos = Vec2 { x: 0.3, y: 0.45 };
    for ally in runtime.champions.iter_mut().filter(|c| c.team == "blue").skip(1) {
        ally.pos = FAR_AWAY;
    }
    let neutral = timers(&[("baron", BARON_POS, 9_000.0), gromp_blue()]);

    let target = decide(&mut runtime.champions, 0, runtime.time_sec, &neutral);

    assert!(!near(target, BARON_POS), "walked to Baron alone: {target:?}");
    assert!(near(target, gromp_blue().1), "no camp target: {target:?}");
}

#[test]
fn jungler_goes_to_baron_when_a_group_can_form() {
    let mut runtime = baron_runtime(0);
    runtime.champions[0].pos = Vec2 { x: 0.3, y: 0.45 };
    runtime.champions[1].pos = Vec2 { x: 0.3, y: 0.35 };
    runtime.champions[2].pos = Vec2 { x: 0.4, y: 0.4 };
    let neutral = timers(&[("baron", BARON_POS, 9_000.0), gromp_blue()]);

    let target = decide(&mut runtime.champions, 0, runtime.time_sec, &neutral);

    assert!(near(target, BARON_POS), "did not stage at Baron: {target:?}");
}

#[test]
fn waiting_jungler_rallies_the_laners_to_baron() {
    let mut runtime = baron_runtime(1);
    runtime.champions[1].pos = Vec2 { x: 0.3, y: 0.5 };
    let neutral = baron();

    let rotating = macro_ai::should_assist_objective_attempt(
        &runtime.champions[1],
        &runtime.champions,
        &neutral,
    );

    assert!(rotating, "the top laner did not rotate to the staged jungler");
}

#[test]
fn jungler_gives_up_waiting_for_a_group_and_leaves_baron_alone() {
    let mut runtime = baron_runtime(1);
    // Close enough to rotate (0.52) but not at the pit yet (0.36).
    runtime.champions[1].pos = Vec2 { x: 0.3, y: 0.72 };
    runtime.champions[2].pos = Vec2 { x: 0.55, y: 0.62 };
    let neutral = timers(&[("baron", BARON_POS, 9_000.0), gromp_blue()]);
    let start = runtime.time_sec;

    let staged = decide(&mut runtime.champions, 0, start, &neutral);
    assert!(near(staged, BARON_POS), "did not wait at the pit: {staged:?}");
    let still_waiting = decide(&mut runtime.champions, 0, start + 30.0, &neutral);
    assert!(near(still_waiting, BARON_POS));

    let _ = decide(&mut runtime.champions, 0, start + 45.0, &neutral);
    let later = decide(&mut runtime.champions, 0, start + 46.0, &neutral);
    assert!(near(later, gromp_blue().1), "kept waiting: {later:?}");
}

#[test]
fn commit_check_gates_a_dragon() {
    let mut champions = vec![
        fighter("blue-JGL", "blue", "JGL", Vec2 { x: 0.6, y: 0.62 }),
        fighter("red-TOP", "red", "TOP", DRAGON_POS),
        fighter("red-MID", "red", "MID", DRAGON_POS),
        fighter("red-ADC", "red", "ADC", DRAGON_POS),
    ];
    let neutral = timers(&[("dragon", DRAGON_POS, 5_000.0), gromp_blue()]);

    let target = decide(&mut champions, 0, 900.0, &neutral);

    assert!(!near(target, DRAGON_POS), "one jungler walked into three: {target:?}");
}

#[test]
fn jungler_takes_a_dragon_when_the_check_passes() {
    let mut champions = vec![fighter("blue-JGL", "blue", "JGL", Vec2 { x: 0.6, y: 0.62 })];
    let neutral = timers(&[("dragon", DRAGON_POS, 5_000.0), gromp_blue()]);

    let target = decide(&mut champions, 0, 900.0, &neutral);

    assert!(near(target, DRAGON_POS), "{target:?}");
}

#[test]
fn jungler_who_will_not_contest_gets_another_target_and_keeps_it() {
    let mut runtime = baron_runtime(0);
    let jungler_pos = Vec2 { x: 0.6, y: 0.62 };
    runtime.champions[0].pos = jungler_pos;
    let neutral = timers(&[("dragon", DRAGON_POS, 5_000.0), gromp_blue()]);
    let mut runtime = test_runtime(runtime.champions, vec![], vec![], neutral.clone());
    runtime.time_sec = 900.0;

    // He walks to the dragon, finds the fight is not worth it and disengages.
    runtime.champions[0].pos = Vec2 { x: 0.66, y: 0.69 };
    runtime.champions[0].state = "objective".to_string();
    issue_lane_disengage(&mut runtime, 0, DRAGON_POS);

    let mut champions = runtime.champions.clone();
    for step in 1..=20 {
        let now = 900.0 + step as f64 * 0.85;
        let target = decide(&mut champions, 0, now, &neutral);
        assert!(
            !near(target, DRAGON_POS),
            "went back to the dragon after {:.1} s: {target:?}",
            now - 900.0
        );
    }
}

#[test]
fn jungler_comes_back_to_the_objective_once_the_cooldown_is_over() {
    let mut champions = vec![fighter("blue-JGL", "blue", "JGL", Vec2 { x: 0.6, y: 0.62 })];
    macro_ai::avoid_target(&mut champions[0], DRAGON_POS, 900.0, macro_ai::OBJECTIVE_AVOID_COOLDOWN_SEC);
    let neutral = timers(&[("dragon", DRAGON_POS, 5_000.0), gromp_blue()]);

    let during = decide(&mut champions, 0, 910.0, &neutral);
    let after = decide(&mut champions, 0, 900.0 + macro_ai::OBJECTIVE_AVOID_COOLDOWN_SEC + 1.0, &neutral);

    assert!(!near(during, DRAGON_POS));
    assert!(near(after, DRAGON_POS));
}

#[test]
fn jungler_with_no_target_gets_a_path_to_the_nearest_ally() {
    let mut champions = vec![
        fighter("blue-JGL", "blue", "JGL", Vec2 { x: 0.5, y: 0.5 }),
        fighter("blue-TOP", "blue", "TOP", Vec2 { x: 0.3, y: 0.25 }),
        fighter("blue-ADC", "blue", "ADC", Vec2 { x: 0.8, y: 0.8 }),
    ];
    let neutral = timers(&[]);

    let target = decide(&mut champions, 0, 900.0, &neutral);

    assert!(near(target, Vec2 { x: 0.3, y: 0.25 }), "{target:?}");
}

#[test]
fn jungler_with_no_target_and_no_living_ally_walks_to_base() {
    let mut champions = vec![fighter("blue-JGL", "blue", "JGL", Vec2 { x: 0.5, y: 0.5 })];
    let neutral = timers(&[]);

    let target = decide(&mut champions, 0, 900.0, &neutral);

    assert!(near(target, base_position_for("blue")), "{target:?}");
}

#[test]
fn unreachable_target_is_not_chosen_twice_in_a_row() {
    let camp_a = Vec2 { x: 0.16, y: 0.43 };
    let mut jungler = fighter("blue-JGL", "blue", "JGL", Vec2 { x: 0.2, y: 0.5 });
    // A champion that cannot make progress towards its target.
    jungler.move_speed = 0.0;
    jungler.target_path = vec![camp_a];
    jungler.target_path_index = 0;
    jungler.path_stuck_for_sec = 6.5;
    jungler.next_decision_at = 1e9;
    let neutral = timers(&[
        ("gromp-blue", camp_a, 470.0),
        ("krugs-blue", Vec2 { x: 0.4, y: 0.7 }, 470.0),
    ]);
    let mut runtime = test_runtime(vec![jungler], vec![], vec![], neutral.clone());
    runtime.time_sec = 900.0;

    // The stuck trigger fires and clears the path.
    move_champions(&mut runtime, 1.0);
    assert!(runtime.champions[0].target_path.is_empty());

    let target = decide(&mut runtime.champions.clone(), 0, 901.0, &neutral);
    assert!(
        !near(target, camp_a),
        "chose the unreachable camp again: {target:?}"
    );
}

#[test]
fn unreachable_target_is_chosen_again_once_the_avoid_time_is_over() {
    let camp_a = Vec2 { x: 0.16, y: 0.43 };
    let mut champions = vec![fighter("blue-JGL", "blue", "JGL", Vec2 { x: 0.2, y: 0.5 })];
    macro_ai::avoid_target(&mut champions[0], camp_a, 900.0, macro_ai::UNREACHABLE_TARGET_AVOID_SEC);
    let neutral = timers(&[("gromp-blue", camp_a, 470.0)]);

    let later = decide(&mut champions, 0, 900.0 + macro_ai::UNREACHABLE_TARGET_AVOID_SEC + 1.0, &neutral);

    assert!(near(later, camp_a));
}

#[test]
fn jungler_farms_his_camp_while_an_objective_he_skips_is_alive() {
    let (key, camp_pos, hp) = gromp_blue();
    // A few hundredths away, as a jungler is after walking up to the camp.
    let jungler_pos = Vec2 {
        x: camp_pos.x + 0.02,
        y: camp_pos.y,
    };
    let jungler = fighter("blue-JGL", "blue", "JGL", jungler_pos);
    let neutral = timers(&[(key, camp_pos, hp), ("baron", BARON_POS, 9_000.0)]);
    let runtime = test_runtime(vec![jungler], vec![], vec![], neutral.clone());

    let target = pick_combat_target(&runtime, 0, 900.0, &neutral);

    assert!(
        matches!(&target, Some(CombatTarget::Neutral(k)) if k == key),
        "the jungler stood at his camp without hitting it"
    );
}

#[test]
fn jungler_does_not_hit_an_objective_he_left_alone() {
    let mut jungler = fighter("blue-JGL", "blue", "JGL", DRAGON_POS);
    macro_ai::avoid_target(&mut jungler, DRAGON_POS, 900.0, macro_ai::OBJECTIVE_AVOID_COOLDOWN_SEC);
    let neutral = timers(&[("dragon", DRAGON_POS, 5_000.0)]);
    let runtime = test_runtime(vec![jungler], vec![], vec![], neutral.clone());

    let target = pick_combat_target(&runtime, 0, 910.0, &neutral);

    assert!(target.is_none(), "targeted the dragon he left alone");
}

#[test]
fn jungler_too_hurt_for_elder_is_not_pulled_back_to_it_by_combat() {
    // Close to the pit with the group already there, but at 45% health the
    // decision logic will not send him in; combat must not walk him back.
    let mut jungler = fighter("blue-JGL", "blue", "JGL", Vec2 { x: 0.66, y: 0.66 });
    jungler.hp = jungler.max_hp * 0.45;
    let champions = vec![
        jungler,
        fighter("blue-MID", "blue", "MID", DRAGON_POS),
        fighter("blue-ADC", "blue", "ADC", DRAGON_POS),
    ];
    let neutral = timers(&[("elder", DRAGON_POS, 7_200.0)]);
    let runtime = test_runtime(champions, vec![], vec![], neutral.clone());

    let target = pick_combat_target(&runtime, 0, 900.0, &neutral);

    assert!(target.is_none(), "combat targeted Elder");
}

#[test]
fn neutral_positions_lie_on_free_navigation_cells() {
    let grid = nav_grid();
    let blocked: Vec<String> = neutral_timer_templates()
        .into_iter()
        .filter(|t| grid.is_blocked_cell(grid.to_cell(t.pos.x), grid.to_cell(t.pos.y)))
        .map(|t| t.key.to_string())
        .collect();
    assert!(blocked.is_empty(), "neutral positions inside a wall: {blocked:?}");
}

#[test]
fn saved_state_without_the_new_fields_still_loads() {
    let mut champion = serde_json::to_value(fighter("c", "blue", "JGL", BARON_POS)).unwrap();
    let object = champion.as_object_mut().unwrap();
    object.remove("avoidTargets");
    object.remove("objectiveWaitSince");
    let loaded: ChampionRuntime = serde_json::from_value(champion).unwrap();
    assert!(loaded.avoid_targets.is_empty());
    assert_eq!(loaded.objective_wait_since, 0.0);

    let mut timer = serde_json::to_value(test_neutral_timer("baron", BARON_POS, true)).unwrap();
    timer.as_object_mut().unwrap().remove("lastHitAt");
    let loaded: NeutralTimerRuntime = serde_json::from_value(timer).unwrap();
    assert!(loaded.last_hit_at.is_none());
}
