//! The jungle of the red side is the mirror image of the blue side's.

use super::*;

fn camp_pos(key: &str) -> Vec2 {
    neutral_timer_templates()
        .into_iter()
        .find(|template| template.key == key)
        .unwrap_or_else(|| panic!("no camp {key}"))
        .pos
}

const CAMPS: [&str; 6] = ["blue-buff", "red-buff", "wolves", "raptors", "gromp", "krugs"];

/// The wolves and the raptors of the two sides stood about 0.1 from each other's mirror image, so the two junglers reached the lanes at different times and the top and
/// bot lanes leaned to opposite sides.
#[test]
fn every_red_camp_is_the_mirror_image_of_its_blue_camp() {
    for camp in CAMPS {
        let blue = camp_pos(&format!("{camp}-blue"));
        let red = camp_pos(&format!("{camp}-red"));
        let mirrored = Vec2 { x: red.y, y: red.x };
        assert!(
            dist(blue, mirrored) < 0.03,
            "{camp}: the red camp is {:.3} from the mirror image of the blue one",
            dist(blue, mirrored)
        );
    }
}

#[test]
fn no_camp_stands_inside_a_wall() {
    let grid = nav_grid();
    for camp in CAMPS {
        for side in ["blue", "red"] {
            let pos = camp_pos(&format!("{camp}-{side}"));
            assert!(
                !grid.is_blocked_cell(grid.to_cell(pos.x), grid.to_cell(pos.y)),
                "{camp}-{side} at ({:.3}, {:.3}) is inside a wall",
                pos.x,
                pos.y
            );
        }
    }
}
