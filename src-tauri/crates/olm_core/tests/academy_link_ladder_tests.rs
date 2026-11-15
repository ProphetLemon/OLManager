//! A linked club that a ladder move puts in tier 1 loses its link (ACADEMY-COPIES).

use olm_core::domain::team::Team;
use olm_core::season_rollover::advance_season;

mod common;

use common::*;

#[test]
fn a_linked_club_promoted_to_tier_one_loses_the_link_and_the_user_is_told() {
    let mut game = plain_game("lec1");
    // The user's club sits outside both leagues, so nothing blocks reg1's promotion.
    let mut boss = team("boss", "elsewhere");
    boss.academy_team_id = Some("reg1".to_string());
    game.teams.push(boss);
    game.manager.hire("boss".to_string());
    for club in &mut game.teams {
        if club.id == "reg1" {
            club.parent_team_id = Some("boss".to_string());
        }
    }
    let messages_before = game.messages.len();

    advance_season(&mut game);

    let boss: &Team = game.teams.iter().find(|t| t.id == "boss").expect("boss");
    let reg1 = game.teams.iter().find(|t| t.id == "reg1").expect("reg1");
    assert_eq!(reg1.competition_id.as_deref(), Some("lec"), "reg1 went up");
    assert_eq!(boss.academy_team_id, None);
    assert_eq!(reg1.parent_team_id, None);
    assert!(
        game.messages[messages_before..]
            .iter()
            .any(|m| m.subject_key.as_deref() == Some("be.msg.academyLinkDissolved.subject"))
    );
}

#[test]
fn a_linked_club_that_stays_in_tier_two_keeps_its_link() {
    let mut game = plain_game("lec1");
    let mut boss = team("boss", "elsewhere");
    boss.academy_team_id = Some("reg4".to_string());
    game.teams.push(boss);
    game.manager.hire("boss".to_string());
    for club in &mut game.teams {
        if club.id == "reg4" {
            club.parent_team_id = Some("boss".to_string());
        }
    }

    advance_season(&mut game);

    let boss = game.teams.iter().find(|t| t.id == "boss").expect("boss");
    assert_eq!(boss.academy_team_id.as_deref(), Some("reg4"));
}
