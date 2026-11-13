use super::*;
use std::cmp::Ordering;

pub(super) fn team_has_vision_at(runtime: &RuntimeState, team: &str, pos: Vec2) -> bool {
    if runtime.champions.iter().any(|champion| {
        champion.alive
            && !champion_is_banished(champion)
            && normalized_team(&champion.team) == normalized_team(team)
            && dist(champion.pos, pos) <= CHAMPION_VISION_RADIUS
    }) {
        return true;
    }

    if runtime.minions.iter().any(|minion| {
        minion.alive
            && normalized_team(&minion.team) == normalized_team(team)
            && dist(minion.pos, pos) <= MINION_VISION_RADIUS
    }) {
        return true;
    }

    if runtime.structures.iter().any(|structure| {
        structure.alive
            && normalized_team(&structure.team) == normalized_team(team)
            && dist(structure.pos, pos) <= STRUCTURE_VISION_RADIUS
    }) {
        return true;
    }

    runtime.wards.iter().any(|ward| {
        normalized_team(&ward.team) == normalized_team(team)
            && ward.expires_at > runtime.time_sec
            && dist(ward.pos, pos) <= WARD_VISION_RADIUS
    })
}

fn strategic_ward_points_for_team(team: &str) -> &'static [Vec2] {
    if normalized_team(team) == "blue" {
        &[
            Vec2 { x: 0.615, y: 0.61 },  // river bot bush
            Vec2 { x: 0.565, y: 0.455 }, // river mid bot side
            Vec2 { x: 0.49, y: 0.525 },  // mid river center
            Vec2 { x: 0.412, y: 0.39 },  // river top side
            Vec2 { x: 0.675, y: 0.705 }, // dragon pit edge
            Vec2 { x: 0.328, y: 0.302 }, // baron pit edge
            Vec2 { x: 0.725, y: 0.548 }, // enemy raptor entrance
            Vec2 { x: 0.73, y: 0.37 },   // enemy blue-side entrance
        ]
    } else {
        &[
            Vec2 { x: 0.385, y: 0.39 },  // river bot bush (red perspective)
            Vec2 { x: 0.435, y: 0.545 }, // river mid bot side
            Vec2 { x: 0.51, y: 0.475 },  // mid river center
            Vec2 { x: 0.588, y: 0.61 },  // river top side
            Vec2 { x: 0.675, y: 0.705 }, // dragon pit edge
            Vec2 { x: 0.328, y: 0.302 }, // baron pit edge
            Vec2 { x: 0.272, y: 0.46 },  // enemy raptor entrance
            Vec2 { x: 0.272, y: 0.63 },  // enemy blue-side entrance
        ]
    }
}

fn pick_ward_placement_pos(
    runtime: &RuntimeState,
    champion: &ChampionRuntime,
    now: f64,
) -> Option<Vec2> {
    let points = strategic_ward_points_for_team(&champion.team);
    let max_place_dist = if champion.role == "JGL" || champion.role == "SUP" {
        0.24
    } else {
        0.18
    };

    points
        .iter()
        .copied()
        .filter(|point| dist(champion.pos, *point) <= max_place_dist)
        .filter(|point| {
            !runtime.wards.iter().any(|ward| {
                normalized_team(&ward.team) == normalized_team(&champion.team)
                    && ward.expires_at > now
                    && dist(ward.pos, *point) <= 0.095
            })
        })
        .min_by(|a, b| {
            let da = dist(champion.pos, *a);
            let db = dist(champion.pos, *b);
            da.partial_cmp(&db).unwrap_or(Ordering::Equal)
        })
}

pub(super) fn place_wards(runtime: &mut RuntimeState) {
    let now = runtime.time_sec;
    if now < WARD_UNLOCK_AT_SEC {
        return;
    }

    let mut placements: Vec<WardRuntime> = Vec::new();

    for idx in 0..runtime.champions.len() {
        let champion = runtime.champions[idx].clone();
        if !champion.alive
            || champion_is_banished(&champion)
            || champion.state == "recall"
            || now < champion.ward_cd_until
            || !champion
                .trinket_key
                .eq_ignore_ascii_case(TRINKET_WARDING_TOTEM)
        {
            continue;
        }

        let Some(place_pos) = pick_ward_placement_pos(runtime, &champion, now) else {
            continue;
        };

        runtime.champions[idx].ward_cd_until = now + WARD_COOLDOWN_SEC;
        placements.push(WardRuntime {
            id: format!("ward-{}-{:.0}", champion.id, now * 10.0),
            team: champion.team.clone(),
            owner_champion_id: champion.id.clone(),
            pos: place_pos,
            expires_at: now + WARD_DURATION_SEC,
        });
    }

    if placements.is_empty() {
        return;
    }

    for ward in placements {
        let owner_id = ward.owner_champion_id.clone();
        let mut owner_wards: Vec<usize> = runtime
            .wards
            .iter()
            .enumerate()
            .filter(|(_, w)| w.owner_champion_id == owner_id && w.expires_at > now)
            .map(|(idx, _)| idx)
            .collect();
        if owner_wards.len() >= 2 {
            owner_wards.sort_by(|a, b| {
                runtime.wards[*a]
                    .expires_at
                    .partial_cmp(&runtime.wards[*b].expires_at)
                    .unwrap_or(Ordering::Equal)
            });
            if let Some(drop_idx) = owner_wards.first().copied() {
                runtime.wards.remove(drop_idx);
            }
        }
        runtime.wards.push(ward);
    }
}

pub(super) fn process_sweepers(runtime: &mut RuntimeState) {
    let now = runtime.time_sec;
    let mut activated_by: Vec<String> = Vec::new();

    for champion in &mut runtime.champions {
        if !champion.alive || champion_is_banished(champion) {
            continue;
        }
        if champion.role != "JGL" && champion.role != "SUP" {
            continue;
        }
        if !champion
            .trinket_key
            .eq_ignore_ascii_case(TRINKET_ORACLE_LENS)
        {
            continue;
        }

        if now >= champion.sweeper_active_until
            && now >= champion.sweeper_cd_until
            && runtime.wards.iter().any(|ward| {
                normalized_team(&ward.team) != normalized_team(&champion.team)
                    && ward.expires_at > now
                    && dist(ward.pos, champion.pos) <= SWEEPER_CLEAR_RADIUS
            })
        {
            champion.sweeper_active_until = now + SWEEPER_DURATION_SEC;
            champion.sweeper_cd_until = now + SWEEPER_COOLDOWN_SEC;
            activated_by.push(champion.name.clone());
        }
    }

    for name in activated_by {
        log_coded_event(
            runtime,
            &format!("{} activated Sweeper", name),
            "info",
            EventCode::SweeperActivated,
            EventData::default().actor_name(&name),
        );
    }

    let mut should_clear = Vec::new();
    for (idx, ward) in runtime.wards.iter().enumerate() {
        let cleared = runtime.champions.iter().any(|champion| {
            champion.alive
                && !champion_is_banished(champion)
                && (champion.role == "JGL" || champion.role == "SUP")
                && champion.sweeper_active_until > now
                && normalized_team(&champion.team) != normalized_team(&ward.team)
                && dist(champion.pos, ward.pos) <= SWEEPER_CLEAR_RADIUS
        });
        if cleared {
            should_clear.push(idx);
        }
    }

    for idx in should_clear.into_iter().rev() {
        runtime.wards.remove(idx);
    }
}
