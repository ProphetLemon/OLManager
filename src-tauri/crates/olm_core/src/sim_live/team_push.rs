//! The plan of a team that is ahead in numbers: take structures while the advantage lasts.
//!
//! A team with at least two more champions alive than its opponent (or against an enemy with
//! nobody alive) plays one plan, and goes on with it while it is not behind in numbers: every champion who is not about to die walks to one enemy
//! structure chosen for the team and hits it. The farming, recall for items, jungle and base
//! defence routines do not pull them away while the plan holds, except when an enemy champion
//! is hitting a structure of their base. A team that holds the Baron or Elder buff and is not
//! outnumbered plays the same plan with its wave: it does not dive a tower without minions.
//!
//! The plan is a different decision, not a bonus: nothing here changes damage, health or gold.

use serde::{Deserialize, Serialize};

use super::{
    ChampionRuntime, MinionRuntime, RuntimeState, StructureRuntime, Vec2, base_position_for,
    champion_structure_focus_multiplier, clamp, dist, is_structure_targetable, normalize,
    normalized_team, team_buffs_for_runtime,
};

/// Champions that must be able to push for the ending to be the plan.
const ENDING_MIN_CHAMPIONS: usize = 3;
/// How many champions fewer than the enemy the team may have and still go for the open nexus:
/// 0 left matches 2.6 to 2.9 minutes between the last tower and the nexus, 1 gives 1.3.
const ENDING_OUTNUMBERED_BY: usize = 1;
/// Champions that gather before the ending goes in (or all that can push, if fewer).
const ENDING_GROUP: usize = 4;
/// Distance from the enemy nexus of the rally point.
const ENDING_RALLY_DISTANCE: f64 = 0.30;
/// Seconds of the pushers' damage on an open nexus under which they finish it whatever the
/// numbers: a nexus a few hits from falling is not left alone because the team is short or the
/// group is not together. [PLACEHOLDER] The replay found matches lost with an enemy nexus at
/// 388 and 565 health for a minute and a half while the defenders were away.
const FINISH_WITHIN_SEC: f64 = 20.0;
/// Radius around the rally point that counts as gathered.
const ENDING_RALLY_RADIUS: f64 = 0.12;
/// A champion this near the nexus is already in; he counts as gathered.
const ENDING_ENGAGED_RADIUS: f64 = 0.22;
/// Seconds the team waits for the fourth champion before it goes in with three.
const ENDING_GATHER_SEC: f64 = 40.0;
/// Champions alive that a team needs over its opponent to start the plan.
pub(super) const PUSH_MIN_EDGE: usize = 2;
/// Champions alive that a team needs over its opponent to go on with a plan it started: it
/// plays on while it is not behind. A 5 against 3 lasts 20 to 40 seconds, less than the walk to
/// a tower and its fall, and ending the plan at the first respawn took half a structure per run;
/// with 1 the stronger team at 80 vs 60 wins 74.0% (68.7% with 2), with 0 it wins 75.0%.
pub(super) const PUSH_KEEP_EDGE: usize = 0;
/// Health share under which a champion leaves the plan: he is about to die or recall.
/// Measured: at 0.55 the scorecard row of deaths to towers falls from 23% to 16% (at most 15%
/// is the target) and the stronger team at 95 vs 40 wins 95.0% instead of 95.7%, but the team
/// gold baseline of `economy_tests` then needs an ADC income weight of 1.28, which breaks the
/// role-share and extreme-gap guards; a later pass can take 0.55 together with a new baseline.
pub(super) const PUSH_MIN_HP_RATIO: f64 = 0.40;
/// A champion within this distance of a structure of his base, with an enemy champion hitting
/// it, answers the call and leaves the plan.
const BASE_HIT_RADIUS: f64 = 0.09;
/// Seconds a target counts as nearer when an allied wave stands at it (it takes the tower's shots).
const WAVE_AT_TARGET_BONUS_SEC: f64 = 8.0;
/// Radius around a structure inside which an allied minion counts as its wave.
const WAVE_AT_TARGET_RADIUS: f64 = 0.10;
/// Seconds the standing target counts as nearer, so the team does not switch for a small gain.
const STICKY_TARGET_BONUS_SEC: f64 = 6.0;
/// How far from the structure the team stands to hit it, short of any attack range.
const STAND_OFF: f64 = 0.03;
/// Time a champion needs per attack on a structure.
const STRUCTURE_ATTACK_CADENCE_SEC: f64 = 0.9;

/// The state of the plan of one team.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TeamPush {
    #[serde(default)]
    pub(super) active: bool,
    /// Whether the plan may go under a tower with no allied minion in it (the enemy has the
    /// fewer champions); a team that plays it for its buff keeps its wave as a shield.
    #[serde(default)]
    pub(super) dive: bool,
    #[serde(default)]
    pub(super) since: f64,
    /// Whether the plan is the ending: the enemy nexus can be attacked and taking it is the plan.
    #[serde(default)]
    pub(super) ending: bool,
    /// Whether the team has gathered at the rally point and goes for the nexus.
    #[serde(default)]
    pub(super) assembled: bool,
    /// When the team began to gather for the ending.
    #[serde(default)]
    pub(super) rally_since: f64,
    /// When the numbers advantage ends because enemy champions come back, or the buff runs out.
    #[serde(default)]
    pub(super) window_ends_at: f64,
    #[serde(default)]
    pub(super) target_id: Option<String>,
    /// Seconds the plan has been played in the match, for the measurements.
    #[serde(default)]
    pub(super) active_sec: f64,
    /// Times the plan was entered in the match, for the measurements.
    #[serde(default)]
    pub(super) entered: u32,
}

/// What one champion is told to do while his team plays the plan.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PushOrder {
    pub(super) structure_id: String,
    pub(super) structure_pos: Vec2,
    pub(super) dive: bool,
    /// Where to gather before the ending goes in; `None` once the team is together.
    #[serde(default)]
    pub(super) rally: Option<Vec2>,
}

fn health_ratio(champion: &ChampionRuntime) -> f64 {
    if champion.max_hp <= 0.0 {
        1.0
    } else {
        champion.hp / champion.max_hp
    }
}

fn enemy_of(team: &str) -> &'static str {
    if normalized_team(team) == "blue" { "red" } else { "blue" }
}

fn team_index(team: &str) -> usize {
    usize::from(normalized_team(team) != "blue")
}

/// Time at which `team` stops being ahead because dead enemy champions respawn; a minute from
/// now when the dead enemies alone cannot end it.
fn advantage_ends_at(runtime: &RuntimeState, team: &str, ours: usize, theirs: usize) -> f64 {
    let mut returns: Vec<f64> = runtime
        .champions
        .iter()
        .filter(|champion| normalized_team(&champion.team) != normalized_team(team) && !champion.alive)
        .map(|champion| champion.respawn_at)
        .collect();
    returns.sort_by(|a, b| a.total_cmp(b));
    // The edge falls under the minimum when this many of them are back.
    let needed = (ours + 1).saturating_sub(theirs + PUSH_KEEP_EDGE).max(1);
    returns
        .get(needed - 1)
        .copied()
        .unwrap_or(runtime.time_sec + 60.0)
}

/// The plan of `team` this step, from the one it had.
fn evaluate(runtime: &RuntimeState, team: &str, previous: &TeamPush) -> TeamPush {
    let now = runtime.time_sec;
    let ours = runtime
        .champions
        .iter()
        .filter(|c| c.alive && normalized_team(&c.team) == normalized_team(team))
        .count();
    let theirs = runtime
        .champions
        .iter()
        .filter(|c| c.alive && normalized_team(&c.team) != normalized_team(team))
        .count();

    let buffs = team_buffs_for_runtime(runtime.extra.get("teamBuffs"), team);
    let buff_ends_at = buffs.baron_until.max(buffs.elder_until);
    let numbers_edge = ours >= theirs + PUSH_MIN_EDGE
        || (theirs == 0 && ours >= 1)
        || (previous.active && previous.dive && ours >= theirs + PUSH_KEEP_EDGE);
    let holds_buff = buff_ends_at > now && ours >= 3 && ours >= theirs;
    // The enemy nexus can be attacked and the team is not outnumbered: taking it is the plan.
    let open_nexus = runtime.structures.iter().find(|s| {
        s.kind == "nexus"
            && normalized_team(&s.team) == enemy_of(team)
            && is_structure_targetable(&runtime.structures, team, s)
    });
    let ending = open_nexus.is_some()
        && ours >= ENDING_MIN_CHAMPIONS
        && ours + ENDING_OUTNUMBERED_BY >= theirs;
    let pushers: Vec<&ChampionRuntime> = runtime
        .champions
        .iter()
        .filter(|c| {
            c.alive
                && normalized_team(&c.team) == normalized_team(team)
                && c.state != "recall"
                && health_ratio(c) >= PUSH_MIN_HP_RATIO
        })
        .collect();
    let finishing = open_nexus.is_some_and(|nexus| can_finish_nexus(runtime, nexus, &pushers));
    if !numbers_edge && !holds_buff && !ending && !finishing {
        return keep_totals(previous);
    }
    if pushers.is_empty() {
        return keep_totals(previous);
    }

    if let Some(nexus) =
        open_nexus.filter(|_| finishing || (ending && pushers.len() >= ENDING_MIN_CHAMPIONS))
    {
        return ending_plan(runtime, team, &pushers, previous, nexus, numbers_edge, finishing);
    }

    let window_ends_at = if numbers_edge {
        advantage_ends_at(runtime, team, ours, theirs)
    } else {
        buff_ends_at
    };
    let target_id = pick_target(runtime, team, &pushers, previous, window_ends_at - now);
    let Some(target_id) = target_id else {
        return keep_totals(previous);
    };

    TeamPush {
        active: true,
        dive: numbers_edge,
        since: if previous.active { previous.since } else { now },
        window_ends_at,
        target_id: Some(target_id),
        active_sec: previous.active_sec,
        entered: previous.entered + u32::from(!previous.active),
        ..TeamPush::default()
    }
}

/// Structure damage per second of `pushers`, at least 1 so that a division by it is safe.
fn structure_damage_per_sec(pushers: &[&ChampionRuntime]) -> f64 {
    pushers
        .iter()
        .map(|c| c.attack_damage * champion_structure_focus_multiplier(c) / STRUCTURE_ATTACK_CADENCE_SEC)
        .sum::<f64>()
        .max(1.0)
}

/// Whether `pushers` can bring the open `nexus` down within `FINISH_WITHIN_SEC` and no enemy
/// champion stands at it to stop them.
fn can_finish_nexus(runtime: &RuntimeState, nexus: &StructureRuntime, pushers: &[&ChampionRuntime]) -> bool {
    if pushers.is_empty() {
        return false;
    }
    let guarded = runtime.champions.iter().any(|enemy| {
        enemy.alive
            && normalized_team(&enemy.team) == normalized_team(&nexus.team)
            && dist(enemy.pos, nexus.pos) <= ENDING_ENGAGED_RADIUS
    });
    !guarded && nexus.hp.max(0.0) / structure_damage_per_sec(pushers) <= FINISH_WITHIN_SEC
}

/// Where the team gathers before it goes in: on the line to its own base, out of reach of
/// whoever defends the enemy fountain.
fn rally_point(nexus: &StructureRuntime, team: &str) -> Vec2 {
    let base = base_position_for(team);
    let toward_base = normalize(Vec2 { x: base.x - nexus.pos.x, y: base.y - nexus.pos.y });
    Vec2 {
        x: clamp(nexus.pos.x + toward_base.x * ENDING_RALLY_DISTANCE, 0.01, 0.99),
        y: clamp(nexus.pos.y + toward_base.y * ENDING_RALLY_DISTANCE, 0.01, 0.99),
    }
}

/// The ending: the enemy nexus is the target. The champions gather at the rally point first,
/// so that the defenders of the fountain meet the team and not one champion at a time. A team
/// that is `finishing` a nexus nobody guards does not gather: it goes straight to it.
fn ending_plan(
    runtime: &RuntimeState,
    team: &str,
    pushers: &[&ChampionRuntime],
    previous: &TeamPush,
    nexus: &StructureRuntime,
    numbers_edge: bool,
    finishing: bool,
) -> TeamPush {
    let now = runtime.time_sec;
    let rally = rally_point(nexus, team);
    let near = pushers
        .iter()
        .filter(|c| dist(c.pos, rally) <= ENDING_RALLY_RADIUS || dist(c.pos, nexus.pos) <= ENDING_ENGAGED_RADIUS)
        .count();
    // Teammates who are alive but recalling or hurt are on their way back: the group waits for
    // them (up to `ENDING_GATHER_SEC`) instead of going in with the healthy ones alone.
    let alive = runtime
        .champions
        .iter()
        .filter(|c| c.alive && normalized_team(&c.team) == normalized_team(team))
        .count();
    let need = ENDING_GROUP.min(alive);
    let rally_since = if previous.ending { previous.rally_since } else { now };
    let assembled = finishing
        || (previous.ending && previous.assembled)
        || near >= need
        || (near >= ENDING_MIN_CHAMPIONS && now - rally_since > ENDING_GATHER_SEC);
    TeamPush {
        active: true,
        dive: numbers_edge,
        ending: true,
        assembled,
        rally_since,
        since: if previous.active { previous.since } else { now },
        window_ends_at: now + 60.0,
        target_id: Some(nexus.id.clone()),
        active_sec: previous.active_sec,
        entered: previous.entered + u32::from(!previous.active),
    }
}

fn keep_totals(previous: &TeamPush) -> TeamPush {
    TeamPush {
        active_sec: previous.active_sec,
        entered: previous.entered,
        ..TeamPush::default()
    }
}

/// The enemy structure the team can bring down soonest: the walk of its champions to it plus
/// the time they need to destroy it, nearer when an allied wave is there.
fn pick_target(
    runtime: &RuntimeState,
    team: &str,
    pushers: &[&ChampionRuntime],
    previous: &TeamPush,
    window_sec: f64,
) -> Option<String> {
    let count = pushers.len() as f64;
    let centre = Vec2 {
        x: pushers.iter().map(|c| c.pos.x).sum::<f64>() / count,
        y: pushers.iter().map(|c| c.pos.y).sum::<f64>() / count,
    };
    let speed = (pushers.iter().map(|c| c.move_speed).sum::<f64>() / count).max(0.01);
    let damage_per_sec = structure_damage_per_sec(pushers);

    runtime
        .structures
        .iter()
        .filter(|s| {
            normalized_team(&s.team) == enemy_of(team)
                && is_structure_targetable(&runtime.structures, team, s)
        })
        .map(|s| {
            let mut seconds = dist(centre, s.pos) / speed + s.hp.max(0.0) / damage_per_sec;
            if wave_at(&runtime.minions, team, s) {
                seconds -= WAVE_AT_TARGET_BONUS_SEC;
            }
            if previous.target_id.as_deref() == Some(s.id.as_str()) {
                seconds -= STICKY_TARGET_BONUS_SEC;
            }
            (seconds > window_sec, seconds, s.id.as_str())
        })
        // A structure that can fall inside the window comes first; the rest by time.
        .min_by(|a, b| a.0.cmp(&b.0).then(a.1.total_cmp(&b.1)).then(a.2.cmp(b.2)))
        .map(|(_, _, id)| id.to_string())
}

fn wave_at(minions: &[MinionRuntime], team: &str, structure: &StructureRuntime) -> bool {
    minions.iter().any(|m| {
        m.alive
            && normalized_team(&m.team) == normalized_team(team)
            && dist(m.pos, structure.pos) <= WAVE_AT_TARGET_RADIUS
    })
}

/// Evaluates the plan of both teams for this step.
pub(super) fn update_team_pushes(runtime: &mut RuntimeState) {
    let step = super::runtime::FIXED_STEP_SEC;
    for team in ["blue", "red"] {
        let index = team_index(team);
        let mut next = evaluate(runtime, team, &runtime.team_push[index]);
        if next.active {
            next.active_sec += step;
        }
        runtime.team_push[index] = next;
    }
}

/// The order of each team's champions this step: blue first, red second.
pub(super) fn orders(runtime: &RuntimeState) -> [Option<PushOrder>; 2] {
    ["blue", "red"].map(|team| {
        let push = &runtime.team_push[team_index(team)];
        if !push.active {
            return None;
        }
        let id = push.target_id.as_deref()?;
        let structure = runtime.structures.iter().find(|s| s.alive && s.id == id)?;
        Some(PushOrder {
            structure_id: structure.id.clone(),
            structure_pos: structure.pos,
            dive: push.dive,
            rally: (push.ending && !push.assembled).then(|| rally_point(structure, team)),
        })
    })
}

pub(super) fn order_slot(team: &str) -> usize {
    team_index(team)
}

/// Where a champion of `team` stands to hit the structure of `order`: short of it, on the side
/// of his own base.
pub(super) fn stand_position(order: &PushOrder, team: &str) -> Vec2 {
    if let Some(rally) = order.rally {
        return rally;
    }
    let base = base_position_for(team);
    let toward_base = normalize(Vec2 {
        x: base.x - order.structure_pos.x,
        y: base.y - order.structure_pos.y,
    });
    Vec2 {
        x: clamp(order.structure_pos.x + toward_base.x * STAND_OFF, 0.01, 0.99),
        y: clamp(order.structure_pos.y + toward_base.y * STAND_OFF, 0.01, 0.99),
    }
}

/// Whether the champion plays the plan this step: he has an order and is not about to die.
pub(super) fn plays_plan(champion: &ChampionRuntime) -> bool {
    champion.push.is_some() && health_ratio(champion) >= PUSH_MIN_HP_RATIO
}

/// Whether an enemy champion is hitting a structure of the base of `champion`: the call that
/// takes him out of the plan.
pub(super) fn base_is_hit(
    champion: &ChampionRuntime,
    champions: &[ChampionRuntime],
    structures: &[StructureRuntime],
) -> bool {
    structures.iter().any(|s| {
        s.alive
            && normalized_team(&s.team) == normalized_team(&champion.team)
            && (s.kind == "nexus" || s.kind == "inhib" || s.id.contains("nexus"))
            && s.hp < s.max_hp
            && champions.iter().any(|enemy| {
                enemy.alive
                    && normalized_team(&enemy.team) != normalized_team(&champion.team)
                    && dist(enemy.pos, s.pos) <= BASE_HIT_RADIUS
            })
    })
}

/// The structure of the order, when the champion is in reach of it and it can be hit.
pub(super) fn structure_in_reach(runtime: &RuntimeState, champion_idx: usize) -> Option<usize> {
    let champion = &runtime.champions[champion_idx];
    if !plays_plan(champion) {
        return None;
    }
    let order = champion.push.as_ref()?;
    let reach = champion.attack_range.max(0.04);
    runtime.structures.iter().position(|s| {
        s.id == order.structure_id
            && s.alive
            && dist(champion.pos, s.pos) <= reach
            && is_structure_targetable(&runtime.structures, &champion.team, s)
    })
}

/// Whether `champion`, who plays the plan with permission to dive, may stand in the reach of
/// the tower at `origin`: no enemy champion is near it and the group is together.
pub(super) fn may_dive(
    champion: &ChampionRuntime,
    origin: Vec2,
    champions: &[ChampionRuntime],
    reach: f64,
) -> bool {
    let Some(order) = champion.push.as_ref() else {
        return false;
    };
    if !order.dive || !plays_plan(champion) {
        return false;
    }
    let enemy_near = champions.iter().any(|enemy| {
        enemy.alive
            && normalized_team(&enemy.team) != normalized_team(&champion.team)
            && dist(enemy.pos, origin) <= reach
    });
    let allies_near = champions
        .iter()
        .filter(|ally| {
            ally.alive
                && normalized_team(&ally.team) == normalized_team(&champion.team)
                && dist(ally.pos, origin) <= reach
        })
        .count();
    !enemy_near && allies_near >= PUSH_MIN_EDGE
}
