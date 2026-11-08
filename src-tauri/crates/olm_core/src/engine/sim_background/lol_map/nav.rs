//! Navigation for the minute-level engine: lane geometry and wall-aware
//! movement.
//!
//! Units used to steer in a straight line and slide along walls with five
//! fixed headings, so any wall between a unit and its waypoint froze it for the
//! rest of the match. Movement now follows a flow field (a distance map over a
//! coarse grid of the walkable map, one per target) and falls back to a plain
//! straight step only when nothing is in the way.

use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap};
use std::sync::{Arc, Mutex, OnceLock};

use super::{LaneKey, distance, point_in_active_wall, segment_blocked};

/// Cells per map side. A cell is about 1.6% of the map, narrower than the thinnest
/// corridor between active walls. [PLACEHOLDER]
const GRID: usize = 64;
const CELL: f64 = 1.0 / GRID as f64;
/// Distance at which a unit counts as having reached its target.
pub(super) const ARRIVE_DISTANCE: f64 = 0.025;

const NEIGHBOURS: [(i32, i32); 8] = [
    (-1, -1),
    (0, -1),
    (1, -1),
    (-1, 0),
    (1, 0),
    (-1, 1),
    (0, 1),
    (1, 1),
];

/// Blue (Home) side to red (Away) side centre line of each lane. The set is
/// mirror-symmetric across the `y = x` diagonal (`(x, y)` <-> `(y, x)`, with the
/// point order reversed), which is the map symmetry that swaps the two bases:
/// each lane maps onto itself, so both teams walk equal distances.
const TOP_LANE: [(f64, f64); 6] = [
    (0.12, 0.72),
    (0.10, 0.45),
    (0.12, 0.20),
    (0.20, 0.12),
    (0.45, 0.10),
    (0.72, 0.12),
];
const MID_LANE: [(f64, f64); 5] = [
    (0.22, 0.78),
    (0.36, 0.64),
    (0.50, 0.50),
    (0.64, 0.36),
    (0.78, 0.22),
];
const BOT_LANE: [(f64, f64); 6] = [
    (0.28, 0.88),
    (0.55, 0.90),
    (0.80, 0.88),
    (0.88, 0.80),
    (0.90, 0.55),
    (0.88, 0.28),
];

/// Reflection across the `y = x` diagonal: the Home-to-Away side swap.
pub(super) fn mirror(point: (f64, f64)) -> (f64, f64) {
    (point.1, point.0)
}

pub(super) fn lane_polyline(lane: LaneKey) -> &'static [(f64, f64)] {
    match lane {
        LaneKey::Top => &TOP_LANE,
        LaneKey::Mid => &MID_LANE,
        LaneKey::Bot => &BOT_LANE,
    }
}

/// Point of `lane` at arc-length fraction `t` (0 = blue base end, 1 = red base end).
pub(super) fn lane_point(lane: LaneKey, t: f64) -> (f64, f64) {
    let line = lane_polyline(lane);
    let total: f64 = line.windows(2).map(|w| distance(w[0], w[1])).sum();
    let mut remaining = t.clamp(0.0, 1.0) * total;
    for w in line.windows(2) {
        let len = distance(w[0], w[1]);
        if remaining <= len || len <= f64::EPSILON {
            let f = if len <= f64::EPSILON {
                0.0
            } else {
                remaining / len
            };
            return (
                w[0].0 + (w[1].0 - w[0].0) * f,
                w[0].1 + (w[1].1 - w[0].1) * f,
            );
        }
        remaining -= len;
    }
    line[line.len() - 1]
}

struct NavGrid {
    open: Vec<bool>,
    /// Bit `k` set when the move to `NEIGHBOURS[k]` crosses no wall.
    links: Vec<u8>,
}

fn cell_index(cx: usize, cy: usize) -> usize {
    cy * GRID + cx
}

fn cell_of(p: (f64, f64)) -> (usize, usize) {
    let c = |v: f64| ((v.clamp(0.0, 0.999_999) / CELL) as usize).min(GRID - 1);
    (c(p.0), c(p.1))
}

fn cell_center(cx: usize, cy: usize) -> (f64, f64) {
    ((cx as f64 + 0.5) * CELL, (cy as f64 + 0.5) * CELL)
}

fn neighbour(cx: usize, cy: usize, k: usize) -> Option<(usize, usize)> {
    let nx = cx as i32 + NEIGHBOURS[k].0;
    let ny = cy as i32 + NEIGHBOURS[k].1;
    ((0..GRID as i32).contains(&nx) && (0..GRID as i32).contains(&ny))
        .then_some((nx as usize, ny as usize))
}

fn nav_grid() -> &'static NavGrid {
    static GRID_DATA: OnceLock<NavGrid> = OnceLock::new();
    GRID_DATA.get_or_init(|| {
        let mut open = vec![false; GRID * GRID];
        for cy in 0..GRID {
            for cx in 0..GRID {
                open[cell_index(cx, cy)] = !point_in_active_wall(cell_center(cx, cy));
            }
        }
        let mut links = vec![0u8; GRID * GRID];
        for cy in 0..GRID {
            for cx in 0..GRID {
                if !open[cell_index(cx, cy)] {
                    continue;
                }
                for k in 0..NEIGHBOURS.len() {
                    let Some((nx, ny)) = neighbour(cx, cy, k) else {
                        continue;
                    };
                    if open[cell_index(nx, ny)]
                        && !segment_blocked(cell_center(cx, cy), cell_center(nx, ny))
                    {
                        links[cell_index(cx, cy)] |= 1 << k;
                    }
                }
            }
        }
        NavGrid { open, links }
    })
}

/// Open cell closest to `p` (the cell itself when it is open).
fn nearest_open_cell(p: (f64, f64)) -> (usize, usize) {
    let grid = nav_grid();
    let (cx, cy) = cell_of(p);
    for radius in 0..GRID as i32 {
        let mut best: Option<((usize, usize), f64)> = None;
        for dy in -radius..=radius {
            for dx in -radius..=radius {
                if dx.abs().max(dy.abs()) != radius {
                    continue;
                }
                let (nx, ny) = (cx as i32 + dx, cy as i32 + dy);
                if !(0..GRID as i32).contains(&nx) || !(0..GRID as i32).contains(&ny) {
                    continue;
                }
                let (nx, ny) = (nx as usize, ny as usize);
                if !grid.open[cell_index(nx, ny)] {
                    continue;
                }
                let d = distance(cell_center(nx, ny), p);
                if best.is_none_or(|(_, bd)| d < bd) {
                    best = Some(((nx, ny), d));
                }
            }
        }
        if let Some((cell, _)) = best {
            return cell;
        }
    }
    (cx, cy)
}

/// Walking distance (in map units) from every cell to `target`; unreachable
/// cells hold `f32::INFINITY`.
fn flow_field(target: (f64, f64)) -> Arc<Vec<f32>> {
    static CACHE: OnceLock<Mutex<HashMap<usize, Arc<Vec<f32>>>>> = OnceLock::new();
    let goal = nearest_open_cell(target);
    let key = cell_index(goal.0, goal.1);
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(field) = cache.lock().ok().and_then(|guard| guard.get(&key).cloned()) {
        return field;
    }

    let grid = nav_grid();
    let mut dist = vec![f32::INFINITY; GRID * GRID];
    let mut heap = BinaryHeap::new();
    dist[key] = 0.0;
    heap.push(Reverse((0u32, key)));
    while let Some(Reverse((bits, idx))) = heap.pop() {
        let d = f32::from_bits(bits);
        if d > dist[idx] {
            continue;
        }
        let (cx, cy) = (idx % GRID, idx / GRID);
        for (k, offset) in NEIGHBOURS.iter().enumerate() {
            let Some((nx, ny)) = neighbour(cx, cy, k) else {
                continue;
            };
            let nidx = cell_index(nx, ny);
            // Links are symmetric: a step is allowed from `n` iff it is from here.
            if grid.links[nidx] & (1 << (7 - k)) == 0 {
                continue;
            }
            let step = if offset.0 != 0 && offset.1 != 0 {
                CELL * std::f64::consts::SQRT_2
            } else {
                CELL
            } as f32;
            if d + step < dist[nidx] {
                dist[nidx] = d + step;
                heap.push(Reverse(((d + step).to_bits(), nidx)));
            }
        }
    }

    let field = Arc::new(dist);
    if let Ok(mut guard) = cache.lock() {
        guard.insert(key, Arc::clone(&field));
    }
    field
}

/// Moves a unit at `from` up to `speed` map units toward `target` around walls.
/// Returns the new position and whether the unit has reached the target (or the
/// closest walkable point to it when the target itself lies inside a wall).
pub(super) fn step_toward(from: (f64, f64), target: (f64, f64), speed: f64) -> ((f64, f64), bool) {
    let d = distance(from, target);
    if d < ARRIVE_DISTANCE {
        return (from, true);
    }
    if !segment_blocked(from, target) {
        let f = (speed / d).min(1.0);
        let next = (
            from.0 + (target.0 - from.0) * f,
            from.1 + (target.1 - from.1) * f,
        );
        return (next, f >= 1.0);
    }

    let grid = nav_grid();
    let field = flow_field(target);
    let mut pos = from;
    let mut remaining = speed;
    for _ in 0..16 {
        let (cx, cy) = cell_of(pos);
        let here = field[cell_index(cx, cy)];
        let mut best: Option<((usize, usize), f32)> = None;
        for k in 0..NEIGHBOURS.len() {
            let Some((nx, ny)) = neighbour(cx, cy, k) else {
                continue;
            };
            let nidx = cell_index(nx, ny);
            let reachable = if grid.open[cell_index(cx, cy)] {
                grid.links[cell_index(cx, cy)] & (1 << k) != 0
            } else {
                grid.open[nidx]
            };
            if reachable && field[nidx] < best.map_or(here, |(_, v)| v) {
                best = Some(((nx, ny), field[nidx]));
            }
        }
        let Some(((nx, ny), _)) = best else {
            // Local minimum of the field: this is the closest reachable cell.
            return (pos, true);
        };
        let center = cell_center(nx, ny);
        let hop = distance(pos, center);
        if hop > remaining {
            let f = remaining / hop;
            let next = (
                pos.0 + (center.0 - pos.0) * f,
                pos.1 + (center.1 - pos.1) * f,
            );
            if !segment_blocked(pos, next) {
                pos = next;
            }
            return (pos, false);
        }
        if segment_blocked(pos, center) {
            return (pos, false);
        }
        pos = center;
        remaining -= hop;
        if remaining <= 1e-9 {
            break;
        }
    }
    (pos, false)
}
