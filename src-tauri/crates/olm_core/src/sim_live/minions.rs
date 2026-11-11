use super::*;

fn minion_has_lane_combat_target(
    minion: &MinionRuntime,
    minions: &[MinionRuntime],
    champions: &[ChampionRuntime],
    structures: &[StructureRuntime],
) -> bool {
    let structure_range = minion.attack_range.max(MINION_STRUCTURE_AGGRO_RANGE);
    if nearest_enemy_structure_index(
        structures,
        &minion.team,
        &minion.lane,
        minion.pos,
        structure_range,
    )
    .is_some()
    {
        return true;
    }

    let minion_range = minion.attack_range.max(0.05);
    let nearby_enemy_minion = minions.iter().any(|enemy| {
        enemy.alive
            && enemy.id != minion.id
            && normalized_team(&enemy.team) != normalized_team(&minion.team)
            && normalized_lane(&enemy.lane) == normalized_lane(&minion.lane)
            && dist(enemy.pos, minion.pos) <= minion_range
    });
    if nearby_enemy_minion {
        return true;
    }

    let champion_range = minion.attack_range.max(MINION_CHAMPION_AGGRO_MIN_RANGE);
    nearest_enemy_champion_for_minion(
        champions,
        &minion.team,
        &minion.lane,
        &minion.kind,
        minion.pos,
        champion_range,
    )
    .is_some()
}

pub(super) fn move_minions(runtime: &mut RuntimeState, dt: f64) {
    for i in 0..runtime.minions.len() {
        if !runtime.minions[i].alive {
            continue;
        }

        if runtime.minions[i].kind == "summon" {
            if runtime.minions[i].summon_expires_at > 0.0
                && runtime.time_sec >= runtime.minions[i].summon_expires_at
            {
                runtime.minions[i].alive = false;
                continue;
            }
            let lane_push_summon = runtime.minions[i].summon_kind.as_deref() == Some("herald");
            if lane_push_summon {
                // Herald acts as a lane pusher summon, not an owner-orbit pet.
            } else {
                let owner_id = runtime.minions[i].owner_champion_id.clone();
                let owner = owner_id.as_ref().and_then(|id| {
                    runtime
                        .champions
                        .iter()
                        .find(|champion| champion.id == *id && champion.alive)
                });
                if let Some(owner) = owner {
                    let seed = runtime.minions[i]
                        .id
                        .bytes()
                        .fold(0u64, |acc, b| acc.wrapping_mul(131).wrapping_add(b as u64));
                    let phase = (seed % 628) as f64 / 100.0;
                    let angle = runtime.time_sec * 1.9 + phase;
                    let orbit = 0.018 + ((seed % 7) as f64) * 0.001;
                    let follow_target = Vec2 {
                        x: clamp(owner.pos.x + angle.cos() * orbit, 0.01, 0.99),
                        y: clamp(owner.pos.y + angle.sin() * orbit, 0.01, 0.99),
                    };
                    let speed = runtime.minions[i].move_speed.max(owner.move_speed * 0.85);
                    move_entity(&mut runtime.minions[i].pos, follow_target, speed, dt);
                } else {
                    runtime.minions[i].alive = false;
                    continue;
                }
                runtime.minions[i].pos.x = clamp(runtime.minions[i].pos.x, 0.01, 0.99);
                runtime.minions[i].pos.y = clamp(runtime.minions[i].pos.y, 0.01, 0.99);
                continue;
            }
        }

        let snapshot = runtime.minions[i].clone();
        if minion_has_lane_combat_target(
            &snapshot,
            &runtime.minions,
            &runtime.champions,
            &runtime.structures,
        ) {
            continue;
        }

        if let Some(structure_idx) = nearest_enemy_structure_blocker_index(
            &runtime.structures,
            &runtime.minions[i].team,
            runtime.minions[i].pos,
            MINION_STRUCTURE_BLOCKER_APPROACH_RANGE,
        ) {
            let target = runtime.structures[structure_idx].pos;
            let attack_range = runtime.minions[i]
                .attack_range
                .max(MINION_STRUCTURE_BLOCKER_ATTACK_RANGE);
            if dist(runtime.minions[i].pos, target) > attack_range {
                let speed = minion_move_speed(runtime, &runtime.minions[i]);
                move_entity(&mut runtime.minions[i].pos, target, speed, dt);
                runtime.minions[i].pos.x = clamp(runtime.minions[i].pos.x, 0.01, 0.99);
                runtime.minions[i].pos.y = clamp(runtime.minions[i].pos.y, 0.01, 0.99);
                continue;
            }
        }

        let minion = &mut runtime.minions[i];

        if minion.path_index >= minion.path.len() {
            minion.path_index = minion.path.len().saturating_sub(1);
        }

        if let Some(target) = minion.path.get(minion.path_index).copied() {
            move_entity(&mut minion.pos, target, minion.move_speed, dt);
            if dist(minion.pos, target) < 0.01
                && minion.path_index < minion.path.len().saturating_sub(1)
            {
                minion.path_index += 1;
            }
        }

        minion.pos.x = clamp(minion.pos.x, 0.01, 0.99);
        minion.pos.y = clamp(minion.pos.y, 0.01, 0.99);
    }
}

pub(super) fn resolve_minion_combat(runtime: &mut RuntimeState) {
    let now = runtime.time_sec;

    for i in 0..runtime.minions.len() {
        if !runtime.minions[i].alive || now < runtime.minions[i].attack_cd_until {
            continue;
        }

        let attacker_empowered = minion_is_baron_empowered(runtime, &runtime.minions[i]);

        let cadence = minion_stats(&runtime.minions[i].kind).3;
        let enemy_minion = nearest_enemy_minion_index(
            &runtime.minions,
            i,
            runtime.minions[i].attack_range.max(0.05),
        );

        if let Some(enemy_idx) = enemy_minion {
            let attacker_damage = runtime.minions[i].attack_damage
                * if attacker_empowered {
                    BARON_MINION_DAMAGE_MULTIPLIER
                } else {
                    1.0
                };
            let defender_empowered =
                minion_is_baron_empowered(runtime, &runtime.minions[enemy_idx]);
            let damage = attacker_damage
                * MINION_DAMAGE_TO_MINION_MULTIPLIER
                * if defender_empowered {
                    1.0 - BARON_MINION_DAMAGE_REDUCTION
                } else {
                    1.0
                };
            if i < enemy_idx {
                let (left, right) = runtime.minions.split_at_mut(enemy_idx);
                let attacker = &mut left[i];
                let defender = &mut right[0];
                defender.hp -= damage;
                attacker.attack_cd_until = now + cadence;
            } else if enemy_idx < i {
                let (left, right) = runtime.minions.split_at_mut(i);
                let defender = &mut left[enemy_idx];
                let attacker = &mut right[0];
                defender.hp -= damage;
                attacker.attack_cd_until = now + cadence;
            }

            if runtime.minions[enemy_idx].hp <= 0.0 && runtime.minions[enemy_idx].alive {
                runtime.minions[enemy_idx].alive = false;
                let dead = &runtime.minions[enemy_idx];
                if dead.kind != "summon" {
                    runtime.farm_ledger.record_death(
                        normalized_team(&dead.team) == "blue",
                        normalized_lane(&dead.lane),
                        MinionKiller::Minion,
                        dead.last_hit_by_champion_id.as_ref(),
                        dead.pos,
                    );
                }
            }
            continue;
        }

        let structure_range = runtime.minions[i]
            .attack_range
            .max(MINION_STRUCTURE_BLOCKER_ATTACK_RANGE);
        let enemy_structure = nearest_enemy_structure_blocker_index(
            &runtime.structures,
            &runtime.minions[i].team,
            runtime.minions[i].pos,
            structure_range,
        )
        .or_else(|| {
            nearest_enemy_structure_index(
                &runtime.structures,
                &runtime.minions[i].team,
                &runtime.minions[i].lane,
                runtime.minions[i].pos,
                structure_range,
            )
        });

        if let Some(structure_idx) = enemy_structure {
            if !runtime.structures[structure_idx].alive
                || !is_structure_targetable(
                    &runtime.structures,
                    &runtime.minions[i].team,
                    &runtime.structures[structure_idx],
                )
            {
                continue;
            }

            let attacker_team = runtime.minions[i].team.clone();
            let damage = runtime.minions[i].attack_damage
                * if attacker_empowered {
                    BARON_MINION_DAMAGE_MULTIPLIER
                } else {
                    1.0
                }
                * MINION_DAMAGE_TO_STRUCTURE_MULTIPLIER;
            apply_damage_to_structure(runtime, structure_idx, damage, &attacker_team);
            runtime.minions[i].attack_cd_until = now + cadence;
            continue;
        }

        let attacker_team = runtime.minions[i].team.clone();
        let attacker_lane = runtime.minions[i].lane.clone();
        let attacker_pos = runtime.minions[i].pos;
        let attacker_damage = runtime.minions[i].attack_damage
            * if attacker_empowered {
                BARON_MINION_DAMAGE_MULTIPLIER
            } else {
                1.0
            };
        let attacker_range = runtime.minions[i]
            .attack_range
            .max(MINION_CHAMPION_AGGRO_MIN_RANGE);

        let enemy_champion = nearest_enemy_champion_for_minion(
            &runtime.champions,
            &attacker_team,
            &attacker_lane,
            &runtime.minions[i].kind,
            attacker_pos,
            attacker_range,
        );

        if let Some(champion_idx) = enemy_champion {
            let defender_mult =
                team_damage_reduction_multiplier(runtime, &runtime.champions[champion_idx].team);
            let minion_damage = attacker_damage * MINION_DAMAGE_TO_CHAMPION_MULTIPLIER * defender_mult;
            runtime.champions[champion_idx].hp -= minion_damage;
            runtime.farm_ledger.record_damage(
                &runtime.champions[champion_idx].id,
                DamageSource::Minion,
                minion_damage,
            );
            runtime.champions[champion_idx].last_damaged_at = now;
            cancel_recall(
                &mut runtime.champions[champion_idx],
                now,
                &mut runtime.events,
            );
            runtime.minions[i].attack_cd_until = now + cadence;

            if runtime.champions[champion_idx].hp <= 0.0 && runtime.champions[champion_idx].alive {
                runtime.champions[champion_idx].alive = false;
                runtime.champions[champion_idx].deaths += 1;
                let respawn = champion_respawn_seconds(runtime.champions[champion_idx].level, now);
                runtime.champions[champion_idx].respawn_at = now + respawn;
                award_recent_champion_kill_credit(runtime, champion_idx, now, "minion");
            }
            continue;
        }
    }
}
