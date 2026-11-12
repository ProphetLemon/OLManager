use super::{StructureSeed, Vec2};

pub(super) const BASE_POSITION_BLUE: Vec2 = Vec2 { x: 0.115, y: 0.882 };
pub(super) const BASE_POSITION_RED: Vec2 = Vec2 { x: 0.891, y: 0.117 };

pub(super) const ROLE_SEEDS: [RoleSeed; 5] = [
    RoleSeed {
        role: "TOP",
        lane: "top",
        offset: Vec2 {
            x: -0.014,
            y: -0.012,
        },
    },
    RoleSeed {
        role: "JGL",
        lane: "bot",
        offset: Vec2 { x: 0.014, y: -0.01 },
    },
    RoleSeed {
        role: "MID",
        lane: "mid",
        offset: Vec2 { x: 0.011, y: 0.011 },
    },
    RoleSeed {
        role: "ADC",
        lane: "bot",
        offset: Vec2 {
            x: -0.012,
            y: 0.018,
        },
    },
    RoleSeed {
        role: "SUP",
        lane: "bot",
        offset: Vec2 { x: 0.004, y: 0.021 },
    },
];

#[derive(Debug, Clone, Copy)]
pub(super) struct RoleSeed {
    pub role: &'static str,
    pub lane: &'static str,
    pub offset: Vec2,
}

pub(super) const STRUCTURE_LAYOUT: [StructureSeed; 30] = [
    StructureSeed {
        id: "blue-top-outer",
        team: "blue",
        lane: "top",
        kind: "tower",
        pos: Vec2 {
            x: 0.072265625,
            y: 0.2838541666666667,
        },
    },
    StructureSeed {
        id: "blue-top-inner",
        team: "blue",
        lane: "top",
        kind: "tower",
        pos: Vec2 {
            x: 0.099609375,
            y: 0.5533854166666666,
        },
    },
    StructureSeed {
        id: "blue-top-inhib-tower",
        team: "blue",
        lane: "top",
        kind: "tower",
        pos: Vec2 {
            x: 0.09049479166666667,
            y: 0.69921875,
        },
    },
    StructureSeed {
        id: "blue-mid-outer",
        team: "blue",
        lane: "mid",
        kind: "tower",
        pos: Vec2 {
            x: 0.4016927083333333,
            y: 0.5755208333333334,
        },
    },
    StructureSeed {
        id: "blue-mid-inner",
        team: "blue",
        lane: "mid",
        kind: "tower",
        pos: Vec2 {
            x: 0.3470052083333333,
            y: 0.6705729166666666,
        },
    },
    StructureSeed {
        id: "blue-mid-inhib-tower",
        team: "blue",
        lane: "mid",
        kind: "tower",
        pos: Vec2 {
            x: 0.2623697916666667,
            y: 0.7408854166666666,
        },
    },
    StructureSeed {
        id: "blue-bot-inner",
        team: "blue",
        lane: "bot",
        kind: "tower",
        pos: Vec2 {
            x: 0.4720052083333333,
            y: 0.8958333333333334,
        },
    },
    StructureSeed {
        id: "blue-bot-outer",
        team: "blue",
        lane: "bot",
        kind: "tower",
        pos: Vec2 {
            x: 0.720703125,
            y: 0.9231770833333334,
        },
    },
    StructureSeed {
        id: "blue-bot-inhib-tower",
        team: "blue",
        lane: "bot",
        kind: "tower",
        pos: Vec2 {
            x: 0.298828125,
            y: 0.9127604166666666,
        },
    },
    StructureSeed {
        id: "blue-inhib-top",
        team: "blue",
        lane: "base",
        kind: "inhib",
        pos: Vec2 {
            x: 0.08658854166666667,
            y: 0.7591145833333334,
        },
    },
    StructureSeed {
        id: "blue-inhib-mid",
        team: "blue",
        lane: "base",
        kind: "inhib",
        pos: Vec2 {
            x: 0.224609375,
            y: 0.7864583333333334,
        },
    },
    StructureSeed {
        id: "blue-inhib-bot",
        team: "blue",
        lane: "base",
        kind: "inhib",
        pos: Vec2 {
            x: 0.24544270833333334,
            y: 0.9114583333333334,
        },
    },
    StructureSeed {
        id: "blue-nexus-top-tower",
        team: "blue",
        lane: "base",
        kind: "tower",
        pos: Vec2 {
            x: 0.126953125,
            y: 0.8372395833333334,
        },
    },
    StructureSeed {
        id: "blue-nexus-bot-tower",
        team: "blue",
        lane: "base",
        kind: "tower",
        pos: Vec2 {
            x: 0.15950520833333334,
            y: 0.875,
        },
    },
    StructureSeed {
        id: "blue-nexus",
        team: "blue",
        lane: "base",
        kind: "nexus",
        pos: Vec2 {
            x: 0.115234375,
            y: 0.8815104166666666,
        },
    },
    StructureSeed {
        id: "red-top-outer",
        team: "red",
        lane: "top",
        kind: "tower",
        pos: Vec2 {
            x: 0.275390625,
            y: 0.07161458333333333,
        },
    },
    StructureSeed {
        id: "red-top-inner",
        team: "red",
        lane: "top",
        kind: "tower",
        pos: Vec2 {
            x: 0.533203125,
            y: 0.08203125,
        },
    },
    StructureSeed {
        id: "red-top-inhib-tower",
        team: "red",
        lane: "top",
        kind: "tower",
        pos: Vec2 {
            x: 0.7024739583333334,
            y: 0.09375,
        },
    },
    StructureSeed {
        id: "red-mid-outer",
        team: "red",
        lane: "mid",
        kind: "tower",
        pos: Vec2 {
            x: 0.595703125,
            y: 0.44140625,
        },
    },
    StructureSeed {
        id: "red-mid-inner",
        team: "red",
        lane: "mid",
        kind: "tower",
        pos: Vec2 {
            x: 0.6569010416666666,
            y: 0.33203125,
        },
    },
    StructureSeed {
        id: "red-mid-inhib-tower",
        team: "red",
        lane: "mid",
        kind: "tower",
        pos: Vec2 {
            x: 0.740234375,
            y: 0.26171875,
        },
    },
    StructureSeed {
        id: "red-bot-inner",
        team: "red",
        lane: "bot",
        kind: "tower",
        pos: Vec2 {
            x: 0.9016927083333334,
            y: 0.44921875,
        },
    },
    StructureSeed {
        id: "red-bot-outer",
        team: "red",
        lane: "bot",
        kind: "tower",
        pos: Vec2 {
            x: 0.9303385416666666,
            y: 0.7057291666666666,
        },
    },
    StructureSeed {
        id: "red-bot-inhib-tower",
        team: "red",
        lane: "bot",
        kind: "tower",
        pos: Vec2 {
            x: 0.912109375,
            y: 0.3125,
        },
    },
    StructureSeed {
        id: "red-inhib-top",
        team: "red",
        lane: "base",
        kind: "inhib",
        pos: Vec2 {
            x: 0.7545572916666666,
            y: 0.09114583333333333,
        },
    },
    StructureSeed {
        id: "red-inhib-mid",
        team: "red",
        lane: "base",
        kind: "inhib",
        pos: Vec2 {
            x: 0.783203125,
            y: 0.22395833333333334,
        },
    },
    StructureSeed {
        id: "red-inhib-bot",
        team: "red",
        lane: "base",
        kind: "inhib",
        pos: Vec2 {
            x: 0.9108072916666666,
            y: 0.24869791666666666,
        },
    },
    StructureSeed {
        id: "red-nexus-top-tower",
        team: "red",
        lane: "base",
        kind: "tower",
        pos: Vec2 {
            x: 0.845703125,
            y: 0.1328125,
        },
    },
    StructureSeed {
        id: "red-nexus-bot-tower",
        team: "red",
        lane: "base",
        kind: "tower",
        pos: Vec2 {
            x: 0.8717447916666666,
            y: 0.1640625,
        },
    },
    StructureSeed {
        id: "red-nexus",
        team: "red",
        lane: "base",
        kind: "nexus",
        pos: Vec2 {
            x: 0.8912760416666666,
            y: 0.1171875,
        },
    },
];

/// Top lane. The map is symmetric about the diagonal that swaps the two bases,
/// so node `n - 1 - k` is node `k` with x and y exchanged: red walks the same
/// line as blue, the other way, and node k is as far from the red base as from
/// the blue one. The corner is the one node on the diagonal.
pub(super) const LANE_PATH_TOP_BLUE: [Vec2; 11] = [
    Vec2 { x: 0.108, y: 0.88 },
    Vec2 { x: 0.096, y: 0.76 },
    Vec2 { x: 0.091, y: 0.67 },
    Vec2 { x: 0.087, y: 0.56 },
    Vec2 { x: 0.082, y: 0.31 },
    Vec2 { x: 0.14, y: 0.14 },
    Vec2 { x: 0.31, y: 0.082 },
    Vec2 { x: 0.56, y: 0.087 },
    Vec2 { x: 0.67, y: 0.091 },
    Vec2 { x: 0.76, y: 0.096 },
    Vec2 { x: 0.88, y: 0.108 },
];

pub(super) const LANE_PATH_MID_BLUE: [Vec2; 7] = [
    Vec2 { x: 0.12, y: 0.88 },
    Vec2 { x: 0.248, y: 0.7533 },
    Vec2 { x: 0.377, y: 0.6267 },
    Vec2 { x: 0.505, y: 0.5 },
    Vec2 { x: 0.633, y: 0.3733 },
    Vec2 { x: 0.762, y: 0.2467 },
    Vec2 { x: 0.89, y: 0.12 },
];

/// Bottom lane, symmetric about the same diagonal as [`LANE_PATH_TOP_BLUE`].
pub(super) const LANE_PATH_BOT_BLUE: [Vec2; 13] = [
    Vec2 { x: 0.12, y: 0.88 },
    Vec2 { x: 0.24, y: 0.89 },
    Vec2 { x: 0.36, y: 0.9 },
    Vec2 { x: 0.49, y: 0.907 },
    Vec2 { x: 0.62, y: 0.909 },
    Vec2 { x: 0.72, y: 0.912 },
    Vec2 { x: 0.86, y: 0.86 },
    Vec2 { x: 0.912, y: 0.72 },
    Vec2 { x: 0.909, y: 0.62 },
    Vec2 { x: 0.907, y: 0.49 },
    Vec2 { x: 0.9, y: 0.36 },
    Vec2 { x: 0.89, y: 0.24 },
    Vec2 { x: 0.88, y: 0.12 },
];
