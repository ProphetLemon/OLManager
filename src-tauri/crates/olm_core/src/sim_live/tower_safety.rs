//! Keeping a champion out of the reach of an enemy tower that has nobody else to shoot.
//!
//! A tower shoots the minions of the other team first and a champion only when
//! none of them is in its reach, or when the champion drew its aggro by hitting
//! one of its defenders. A champion standing in reach with no minion of his own
//! team there is therefore the tower's target, and with the tower's damage that
//! is a death within a few shots. This module is the decision a player would
//! take: step back out of the reach, unless the team is pushing the tower
//! together or the kill under it is about to be won.

use super::{
    ChampionRuntime, MinionRuntime, StructureRuntime, TOWER_ATTACK_RANGE, Vec2, base_position_for,
    clamp, dist, normalize, normalized_team, symmetric_structure_pos,
};

/// How far beyond the tower's reach a retreating champion stops, so the next step
/// does not put him back inside.
const TOWER_SAFE_MARGIN: f64 = 0.02;
/// Allied champions near the tower that make standing under it a group push.
const TOWER_GROUP_MIN_CHAMPIONS: usize = 3;
/// Radius around the tower inside which an allied champion counts for the group.
const TOWER_GROUP_RADIUS: f64 = TOWER_ATTACK_RANGE + 0.06;
/// Health share of an enemy champion at or under which killing him under a tower is worth the shots.
const SECURE_KILL_ENEMY_HP_RATIO: f64 = 0.20;
/// Health share the champion needs to risk the shots for that kill.
const SECURE_KILL_SELF_HP_RATIO: f64 = 0.50;
/// Distance at which the champion can finish the enemy he dives for.
const SECURE_KILL_REACH: f64 = 0.06;
/// How far around the tower, in radians, a detour step turns.
const DETOUR_TURN_RAD: f64 = 0.6;

/// What the champion can see around him when he decides.
pub(super) struct Surroundings<'a> {
    pub(super) now: f64,
    /// Game seconds the champion is about to walk for; `0.0` to look at his spot only.
    pub(super) step_sec: f64,
    pub(super) champions: &'a [ChampionRuntime],
    pub(super) minions: &'a [MinionRuntime],
    pub(super) structures: &'a [StructureRuntime],
}

fn hp_ratio(champion: &ChampionRuntime) -> f64 {
    if champion.max_hp <= 0.0 {
        1.0
    } else {
        champion.hp / champion.max_hp
    }
}

/// Where a tower's reach is measured from (the same spot on both sides of the map).
fn reach_origin(tower: &StructureRuntime) -> Vec2 {
    symmetric_structure_pos(tower)
}

/// Whether `tower` is locked on `champion` by a recent trade under it.
fn tower_is_locked_on(tower: &StructureRuntime, champion: &ChampionRuntime, now: f64) -> bool {
    tower.forced_target_champion_id.as_deref() == Some(champion.id.as_str())
        && now <= tower.forced_target_until
}

/// The reach origin of the enemy tower that would shoot `champion` if he stood at `pos`:
/// no minion of his team is in its reach to take the shots, or it is locked on him.
fn exposing_tower(champion: &ChampionRuntime, pos: Vec2, around: &Surroundings) -> Option<Vec2> {
    around
        .structures
        .iter()
        .filter(|tower| {
            tower.alive
                && tower.kind == "tower"
                && normalized_team(&tower.team) != normalized_team(&champion.team)
        })
        .find_map(|tower| {
            let origin = reach_origin(tower);
            if dist(origin, pos) > TOWER_ATTACK_RANGE {
                return None;
            }
            let shielded = around.minions.iter().any(|minion| {
                minion.alive
                    && normalized_team(&minion.team) == normalized_team(&champion.team)
                    && dist(minion.pos, origin) <= TOWER_ATTACK_RANGE
            });
            let locked = tower_is_locked_on(tower, champion, around.now);
            (!shielded || locked).then_some(origin)
        })
}

/// Whether being under the tower at `origin` is worth it: the team pushes it together,
/// or an enemy champion in reach is about to die.
fn dive_is_worth_it(champion: &ChampionRuntime, origin: Vec2, around: &Surroundings) -> bool {
    let allies_near = around
        .champions
        .iter()
        .filter(|ally| {
            ally.alive
                && normalized_team(&ally.team) == normalized_team(&champion.team)
                && dist(ally.pos, origin) <= TOWER_GROUP_RADIUS
        })
        .count();
    if allies_near >= TOWER_GROUP_MIN_CHAMPIONS {
        return true;
    }
    hp_ratio(champion) >= SECURE_KILL_SELF_HP_RATIO
        && around.champions.iter().any(|enemy| {
            enemy.alive
                && normalized_team(&enemy.team) != normalized_team(&champion.team)
                && hp_ratio(enemy) <= SECURE_KILL_ENEMY_HP_RATIO
                && dist(enemy.pos, champion.pos) <= SECURE_KILL_REACH
        })
}

/// The nearest spot just outside the reach of the tower at `origin`, on the line from the
/// tower through `from` (toward the champion's own base when he stands on the tower).
fn spot_outside_reach(origin: Vec2, from: Vec2, team: &str) -> Vec2 {
    let mut away = normalize(Vec2 {
        x: from.x - origin.x,
        y: from.y - origin.y,
    });
    if away.x == 0.0 && away.y == 0.0 {
        let base = base_position_for(team);
        away = normalize(Vec2 {
            x: base.x - origin.x,
            y: base.y - origin.y,
        });
    }
    let radius = TOWER_ATTACK_RANGE + TOWER_SAFE_MARGIN;
    Vec2 {
        x: clamp(origin.x + away.x * radius, 0.01, 0.99),
        y: clamp(origin.y + away.y * radius, 0.01, 0.99),
    }
}

/// The reach origin of the tower the champion should keep away from at `pos`: it would
/// shoot him there and standing there is not worth it.
fn avoided_tower(champion: &ChampionRuntime, pos: Vec2, around: &Surroundings) -> Option<Vec2> {
    exposing_tower(champion, pos, around)
        .filter(|origin| !dive_is_worth_it(champion, *origin, around))
}

/// `pos`, or the spot just outside the reach of the tower that would shoot `champion` there.
pub(super) fn outside_bare_tower_reach(
    champion: &ChampionRuntime,
    pos: Vec2,
    around: &Surroundings,
) -> Vec2 {
    avoided_tower(champion, pos, around)
        .map_or(pos, |origin| spot_outside_reach(origin, pos, &champion.team))
}

/// A spot on the edge of the tower's reach, a few steps around it from `from`, on the side
/// that is nearer to `to`: the walk goes around the tower instead of through its reach.
fn spot_around_reach(origin: Vec2, from: Vec2, to: Vec2) -> Vec2 {
    let radius = TOWER_ATTACK_RANGE + TOWER_SAFE_MARGIN;
    let angle = (from.y - origin.y).atan2(from.x - origin.x);
    let on_circle = |turn: f64| Vec2 {
        x: clamp(origin.x + (angle + turn).cos() * radius, 0.01, 0.99),
        y: clamp(origin.y + (angle + turn).sin() * radius, 0.01, 0.99),
    };
    let (left, right) = (on_circle(DETOUR_TURN_RAD), on_circle(-DETOUR_TURN_RAD));
    if dist(left, to) <= dist(right, to) {
        left
    } else {
        right
    }
}

/// Walks the champion on a one-spot path, bypassing the repath hysteresis of
/// `set_champion_direct_path`: the spot is often within it of the path he is on.
fn walk_to(champion: &mut ChampionRuntime, spot: Vec2) {
    champion.target_path = vec![spot];
    champion.target_path_index = 0;
    champion.path_stuck_for_sec = 0.0;
}

/// Where the champion would stand after walking one step toward his next waypoint.
fn position_after_step(champion: &ChampionRuntime, step_sec: f64) -> Vec2 {
    let Some(waypoint) = champion.target_path.get(champion.target_path_index).copied() else {
        return champion.pos;
    };
    let reach = champion.move_speed * step_sec;
    let gap = dist(champion.pos, waypoint);
    if gap <= reach || gap <= 1e-9 {
        return waypoint;
    }
    Vec2 {
        x: champion.pos.x + (waypoint.x - champion.pos.x) * reach / gap,
        y: champion.pos.y + (waypoint.y - champion.pos.y) * reach / gap,
    }
}

/// Sends the champion out of the reach of a tower with nobody else to shoot, stops him
/// walking into it, and walks him around it when his next step would cross it. Returns
/// whether the path was changed.
pub(super) fn keep_out_of_bare_tower_reach(
    champion: &mut ChampionRuntime,
    around: &Surroundings,
) -> bool {
    if !champion.alive || champion.recall_channel_until > around.now {
        return false;
    }
    let here = outside_bare_tower_reach(champion, champion.pos, around);
    if dist(here, champion.pos) > 1e-9 {
        walk_to(champion, here);
        return true;
    }
    let mut changed = false;
    if let Some(destination) = champion.target_path.last().copied() {
        let safe = outside_bare_tower_reach(champion, destination, around);
        if dist(safe, destination) > 1e-9 {
            walk_to(champion, safe);
            changed = true;
        }
    }
    if around.step_sec > 0.0 {
        let next = position_after_step(champion, around.step_sec);
        if let Some(origin) = avoided_tower(champion, next, around) {
            let goal = champion.target_path.last().copied().unwrap_or(next);
            let detour = spot_around_reach(origin, champion.pos, goal);
            champion.target_path = vec![detour, goal];
            champion.target_path_index = 0;
            champion.path_stuck_for_sec = 0.0;
            changed = true;
        }
    }
    changed
}
