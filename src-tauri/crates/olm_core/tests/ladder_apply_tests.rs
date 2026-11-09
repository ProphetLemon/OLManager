//! Promotion and relegation between linked leagues, driven through the real rollover:
//! `reg` (tier 2, four clubs) feeds `lec` (tier 1, four clubs) with one slot.

use chrono::{TimeZone, Utc};
use olm_core::clock::GameClock;
use olm_core::contract_wage_policy::ai_team_tier;
use olm_core::domain::league::{
    Fixture, FixtureStatus, League, LeagueKind, MatchResult, MatchType, StandingEntry,
};
use olm_core::domain::manager::Manager;
use olm_core::domain::player::{Player, PlayerAttributes};
use olm_core::domain::stats::LolRole;
use olm_core::domain::team::{Team, TeamKind};
use olm_core::end_of_season::roll_completed_background_leagues;
use olm_core::game::Game;
use olm_core::generator::definitions::{
    CompetitionManifest, FeederLink, PromotionLink, ScheduleConfig, SeasonStart, SplitConfig,
};
use olm_core::ladder::{LadderMovement, LadderMovementStatus};
use olm_core::ladder_apply::apply_ladders;
use olm_core::season_rollover::advance_season;
use std::collections::HashMap;

const LEC: [&str; 4] = ["lec1", "lec2", "lec3", "lec4"];
const REG: [&str; 4] = ["reg1", "reg2", "reg3", "reg4"];

fn squad(team_id: &str) -> Vec<Player> {
    [
        ("top", LolRole::Top),
        ("jungle", LolRole::Jungle),
        ("mid", LolRole::Mid),
        ("adc", LolRole::Adc),
        ("sup", LolRole::Support),
    ]
    .into_iter()
    .map(|(tag, role)| {
        let id = format!("{team_id}_{tag}");
        let attrs = PlayerAttributes {
            mental_resilience: 60,
            champion_pool: 60,
            laning: 60,
            mechanics: 60,
            macro_play: 60,
            consistency: 60,
            discipline: 60,
            teamfighting: 60,
            shotcalling: 60,
        };
        let mut p = Player::new(
            id.clone(),
            id.clone(),
            id,
            "1995-01-01".to_string(),
            "England".to_string(),
            role,
            attrs,
        );
        p.team_id = Some(team_id.to_string());
        p
    })
    .collect()
}

fn team(id: &str, competition: &str) -> Team {
    let mut team = Team::new(
        id.to_string(),
        id.to_string(),
        id[..3].to_string(),
        "England".to_string(),
        "London".to_string(),
        "Stadium".to_string(),
        40_000,
    );
    team.competition_id = Some(competition.to_string());
    team
}

fn fixture(id: &str, home: &str, away: &str, status: FixtureStatus) -> Fixture {
    let completed = status == FixtureStatus::Completed;
    Fixture {
        id: id.to_string(),
        matchday: 1,
        date: "2025-06-01".to_string(),
        home_team_id: home.to_string(),
        away_team_id: away.to_string(),
        match_type: MatchType::League,
        best_of: 1,
        status,
        result: completed.then(|| MatchResult {
            home_wins: 1,
            away_wins: 0,
            ..MatchResult::default()
        }),
    }
}

/// Fully played single round robin; the earlier team in `team_ids` always wins, so the
/// table order equals the order given.
fn finished_league(id: &str, tier: u8, team_ids: &[&str]) -> League {
    let mut fixtures = Vec::new();
    let mut standings: Vec<StandingEntry> = team_ids
        .iter()
        .map(|t| StandingEntry::new((*t).to_string()))
        .collect();
    for (i, home) in team_ids.iter().enumerate() {
        for away in &team_ids[i + 1..] {
            fixtures.push(fixture(
                &format!("{id}-{home}-{away}"),
                home,
                away,
                FixtureStatus::Completed,
            ));
            for s in &mut standings {
                if s.team_id == *home {
                    s.record_result(1, 0);
                } else if s.team_id == *away {
                    s.record_result(0, 1);
                }
            }
        }
    }
    League {
        id: id.to_string(),
        name: id.to_uppercase(),
        season: 2025,
        split_index: 1,
        fixtures,
        standings,
        competition_id: Some(id.to_string()),
        league_kind: LeagueKind::Main,
        tier,
        active: true,
        ..Default::default()
    }
}

/// A league that has not finished: one scheduled fixture, nobody has played.
fn unfinished_league(id: &str, tier: u8, team_ids: &[&str]) -> League {
    let mut league = finished_league(id, tier, team_ids);
    league.standings = team_ids
        .iter()
        .map(|t| StandingEntry::new((*t).to_string()))
        .collect();
    league.fixtures = vec![fixture(
        &format!("{id}-open"),
        team_ids[0],
        team_ids[1],
        FixtureStatus::Scheduled,
    )];
    league
}

fn manifest(id: &str, tier: u8, promotion: Option<PromotionLink>) -> CompetitionManifest {
    CompetitionManifest {
        id: id.to_string(),
        name: id.to_uppercase(),
        full_name: None,
        region: "EU".to_string(),
        country: None,
        tier: Some(tier),
        logo: None,
        schedule: ScheduleConfig {
            format: "single_round_robin".to_string(),
            team_count: 0,
            splits: ["Spring", "Summer"]
                .into_iter()
                .map(|name| SplitConfig {
                    name: name.to_string(),
                    season_start: SeasonStart { month: 8, day: 1 },
                    superweek_offsets: vec![],
                    best_of: 1,
                    playoffs: None,
                })
                .collect(),
            preseason_friendlies: 2,
        },
        teams_file: "teams.json".to_string(),
        players_file: "players.json".to_string(),
        staff_file: None,
        championships_file: None,
        erls: vec![],
        reputation: None,
        nearby_country_codes: vec![],
        promotion,
        legacy: false,
        active: true,
    }
}

fn link(feeders: &[(&str, &str)]) -> PromotionLink {
    PromotionLink {
        to: "lec".to_string(),
        slots: 1,
        feeders: feeders
            .iter()
            .map(|(team, parent)| FeederLink {
                team: (*team).to_string(),
                parent: (*parent).to_string(),
            })
            .collect(),
    }
}

/// Both leagues finished season 2025 on their last split. `lower` lists the `reg`
/// teams best first. The user manages `user`, in whichever league holds it.
fn finished_game(user: &str, lower: [&str; 4], promotion: PromotionLink) -> Game {
    let mut manager = Manager::new(
        "mgr1".to_string(),
        "Test".to_string(),
        "Manager".to_string(),
        "1980-01-01".to_string(),
        "England".to_string(),
    );
    manager.hire(user.to_string());
    let mut teams: Vec<Team> = LEC.iter().map(|id| team(id, "lec")).collect();
    teams.extend(lower.iter().map(|id| team(id, "reg")));
    let players = LEC
        .iter()
        .chain(lower.iter())
        .flat_map(|id| squad(id))
        .collect();
    let mut game = Game::new(
        GameClock::new(Utc.with_ymd_and_hms(2025, 6, 15, 12, 0, 0).unwrap()),
        manager,
        teams,
        players,
        vec![],
        vec![],
    );
    game.leagues = vec![
        finished_league("lec", 1, &LEC),
        finished_league("reg", 2, &lower),
    ];
    game.user_competition_id = Some(if LEC.contains(&user) { "lec" } else { "reg" }.to_string());
    game.competition_configs = HashMap::from([
        ("lec".to_string(), manifest("lec", 1, None)),
        ("reg".to_string(), manifest("reg", 2, Some(promotion))),
    ]);
    game
}

fn plain_game(user: &str) -> Game {
    finished_game(user, REG, link(&[]))
}

fn members(game: &Game, competition: &str) -> Vec<String> {
    let mut ids: Vec<String> = game
        .leagues
        .iter()
        .find(|l| l.competition_id.as_deref() == Some(competition))
        .map(|l| l.standings.iter().map(|s| s.team_id.clone()).collect())
        .unwrap_or_default();
    ids.sort();
    ids
}

fn strings(ids: &[&str]) -> Vec<String> {
    ids.iter().map(|id| (*id).to_string()).collect()
}

fn league_of<'a>(game: &'a Game, competition: &str) -> &'a League {
    game.leagues
        .iter()
        .find(|l| l.competition_id.as_deref() == Some(competition))
        .expect("league")
}

fn competition_of(game: &Game, team_id: &str) -> Option<String> {
    game.teams
        .iter()
        .find(|t| t.id == team_id)
        .and_then(|t| t.competition_id.clone())
}

fn only_movement(game: &Game) -> &LadderMovement {
    assert_eq!(
        game.ladder.movements.len(),
        1,
        "{:?}",
        game.ladder.movements
    );
    &game.ladder.movements[0]
}

#[test]
fn the_champion_goes_up_and_the_worst_team_goes_down() {
    let mut game = plain_game("lec1");
    advance_season(&mut game);

    let movement = only_movement(&game);
    assert_eq!(
        (
            movement.status,
            movement.promoted.clone(),
            movement.relegated.clone(),
            movement.season
        ),
        (
            LadderMovementStatus::Applied,
            vec!["reg1".to_string()],
            vec!["lec4".to_string()],
            2025
        )
    );
}

#[test]
fn moved_clubs_change_competition_and_the_rest_stay() {
    let mut game = plain_game("lec1");
    advance_season(&mut game);

    let competitions: Vec<_> = ["reg1", "reg2", "lec1", "lec4"]
        .iter()
        .map(|id| competition_of(&game, id))
        .collect();
    assert_eq!(
        competitions,
        vec![
            Some("lec".to_string()),
            Some("reg".to_string()),
            Some("lec".to_string()),
            Some("reg".to_string())
        ]
    );
}

#[test]
fn both_leagues_get_a_next_season_calendar_for_their_new_members() {
    let mut game = plain_game("lec1");
    advance_season(&mut game);

    assert_eq!(
        (members(&game, "lec"), members(&game, "reg")),
        (
            strings(&["lec1", "lec2", "lec3", "reg1"]),
            strings(&["lec4", "reg2", "reg3", "reg4"])
        )
    );
}

#[test]
fn rebuilt_calendars_keep_their_size_season_and_identity() {
    let mut game = plain_game("lec1");
    advance_season(&mut game);

    let lec = league_of(&game, "lec");
    let reg = league_of(&game, "reg");
    let competitive = |league: &League| {
        league
            .fixtures
            .iter()
            .filter(|f| f.counts_for_league_standings())
            .count()
    };
    assert_eq!(
        (
            competitive(lec),
            competitive(reg),
            lec.season,
            reg.season,
            lec.tier,
            reg.tier
        ),
        (6, 6, 2026, 2026, 1, 2)
    );
}

#[test]
fn rebuilt_fixtures_only_involve_the_new_members() {
    let mut game = plain_game("lec1");
    advance_season(&mut game);

    let in_lec: Vec<&str> = league_of(&game, "lec")
        .fixtures
        .iter()
        .flat_map(|f| [f.home_team_id.as_str(), f.away_team_id.as_str()])
        .collect();
    assert!(in_lec.contains(&"reg1") && !in_lec.contains(&"lec4"));
}

#[test]
fn ids_players_and_rosters_are_untouched_by_a_swap() {
    let mut game = plain_game("lec1");
    let before: Vec<_> = game
        .players
        .iter()
        .map(|p| (p.id.clone(), p.team_id.clone()))
        .collect();
    advance_season(&mut game);

    let after: Vec<_> = game
        .players
        .iter()
        .map(|p| (p.id.clone(), p.team_id.clone()))
        .collect();
    assert_eq!(before, after);
}

#[test]
fn a_feeder_champion_is_skipped_for_the_next_eligible_team() {
    let mut game = finished_game("lec1", REG, link(&[("reg1", "lec2")]));
    advance_season(&mut game);

    assert_eq!(only_movement(&game).promoted, vec!["reg2".to_string()]);
}

#[test]
fn a_feeder_is_still_blocked_when_its_parent_is_relegated_in_the_same_swap() {
    // lec4 finishes last and goes down, but eligibility is judged before the swap.
    let mut game = finished_game("lec1", REG, link(&[("reg1", "lec4")]));
    advance_season(&mut game);

    let movement = only_movement(&game);
    assert_eq!(
        (movement.promoted.clone(), movement.relegated.clone()),
        (vec!["reg2".to_string()], vec!["lec4".to_string()])
    );
}

#[test]
fn a_feeder_whose_parent_is_not_in_the_upper_league_can_go_up() {
    let mut game = finished_game("lec1", REG, link(&[("reg1", "elsewhere")]));
    advance_season(&mut game);

    assert_eq!(only_movement(&game).promoted, vec!["reg1".to_string()]);
}

#[test]
fn an_academy_team_is_never_promoted() {
    let mut game = plain_game("lec1");
    for team in &mut game.teams {
        if team.id == "reg1" {
            team.team_kind = TeamKind::Academy;
        }
    }
    advance_season(&mut game);

    assert_eq!(only_movement(&game).promoted, vec!["reg2".to_string()]);
}

#[test]
fn a_team_with_a_parent_in_the_upper_league_is_not_promoted() {
    let mut game = plain_game("lec1");
    for team in &mut game.teams {
        if team.id == "reg1" {
            team.parent_team_id = Some("lec3".to_string());
        }
    }
    advance_season(&mut game);

    assert_eq!(only_movement(&game).promoted, vec!["reg2".to_string()]);
}

#[test]
fn a_custom_club_is_eligible_even_if_listed_as_a_feeder() {
    let lower = ["reg-custom-ray", "reg2", "reg3", "reg4"];
    let mut game = finished_game("lec1", lower, link(&[("reg-custom-ray", "lec2")]));
    advance_season(&mut game);

    assert_eq!(
        only_movement(&game).promoted,
        vec!["reg-custom-ray".to_string()]
    );
}

#[test]
fn nobody_moves_when_no_lower_team_is_eligible() {
    let feeders: Vec<(&str, &str)> = REG.iter().map(|id| (*id, "lec2")).collect();
    let mut game = finished_game("lec1", REG, link(&feeders));
    advance_season(&mut game);

    let movement = only_movement(&game);
    assert_eq!(
        (
            movement.status,
            movement.promoted.len(),
            members(&game, "lec")
        ),
        (
            LadderMovementStatus::NoEligible,
            0,
            strings(&["lec1", "lec2", "lec3", "lec4"])
        )
    );
}

#[test]
fn applying_again_changes_nothing() {
    let mut game = plain_game("lec1");
    advance_season(&mut game);
    let manifests = game.competition_configs.clone();

    let again = apply_ladders(&mut game, &manifests);

    assert_eq!((again.len(), game.ladder.movements.len()), (0, 1));
}

#[test]
fn the_swap_waits_until_both_leagues_closed_the_season() {
    let mut game = plain_game("lec1");
    game.leagues[1] = unfinished_league("reg", 2, &REG);
    advance_season(&mut game);

    assert!(game.ladder.movements.is_empty());
}

#[test]
fn the_swap_happens_when_the_lower_league_finishes_last() {
    let mut game = plain_game("lec1");
    game.leagues[1] = unfinished_league("reg", 2, &REG);
    advance_season(&mut game);
    game.leagues[1] = finished_league("reg", 2, &REG);
    let manifests = game.competition_configs.clone();
    roll_completed_background_leagues(&mut game, &manifests, &[1]);

    assert_eq!(only_movement(&game).promoted, vec!["reg1".to_string()]);
}

#[test]
fn a_late_swap_is_recorded_as_skipped_and_moves_nobody() {
    let mut game = plain_game("lec1");
    // The new calendars start on Aug 1, 2026; the clock is already past that.
    game.clock = GameClock::new(Utc.with_ymd_and_hms(2026, 9, 1, 12, 0, 0).unwrap());
    advance_season(&mut game);

    let movement = only_movement(&game);
    assert_eq!(
        (
            movement.status,
            movement.promoted.len(),
            competition_of(&game, "reg1")
        ),
        (
            LadderMovementStatus::SkippedLate,
            0,
            Some("reg".to_string())
        )
    );
}

#[test]
fn a_started_next_season_blocks_the_swap() {
    let mut game = plain_game("lec1");
    advance_season(&mut game);
    // Rewind the ledger to the state before the swap, with a match already played.
    game.ladder.movements.clear();
    game.leagues[0].standings[0].played = 1;
    let manifests = game.competition_configs.clone();

    let applied = apply_ladders(&mut game, &manifests);

    assert_eq!(
        applied.first().map(|m| m.status),
        Some(LadderMovementStatus::SkippedLate)
    );
}

#[test]
fn a_user_in_the_lower_league_is_promoted_with_their_club() {
    let mut game = plain_game("reg1");
    advance_season(&mut game);

    let active = game.active_league().expect("active league");
    assert_eq!(
        (
            game.user_competition_id.clone(),
            active.competition_id.clone(),
            game.manager.team_id.clone(),
            active.standings.iter().any(|s| s.team_id == "reg1")
        ),
        (
            Some("lec".to_string()),
            Some("lec".to_string()),
            Some("reg1".to_string()),
            true
        )
    );
}

#[test]
fn a_promoted_user_keeps_preseason_friendlies_in_the_new_league() {
    let mut game = plain_game("reg1");
    advance_season(&mut game);

    let friendlies = league_of(&game, "lec")
        .fixtures
        .iter()
        .filter(|f| !f.counts_for_league_standings())
        .filter(|f| f.home_team_id == "reg1" || f.away_team_id == "reg1")
        .count();
    assert_eq!(friendlies, 2);
}

#[test]
fn a_promoted_user_plays_under_tier_one_rules() {
    let mut game = plain_game("reg1");
    advance_season(&mut game);

    let promoted = game.teams.iter().find(|t| t.id == "reg1").expect("team");
    assert_eq!(ai_team_tier(promoted, &game), 1);
}

#[test]
fn a_user_in_the_upper_league_is_relegated_with_their_club() {
    let mut game = plain_game("lec4");
    advance_season(&mut game);

    let active = game.active_league().expect("active league");
    assert_eq!(
        (
            game.user_competition_id.clone(),
            active.competition_id.clone(),
            active.tier,
            active.standings.iter().any(|s| s.team_id == "lec4")
        ),
        (Some("reg".to_string()), Some("reg".to_string()), 2, true)
    );
}

#[test]
fn a_relegated_club_moves_to_tier_two_rules() {
    let mut game = plain_game("lec1");
    advance_season(&mut game);

    let relegated = game.teams.iter().find(|t| t.id == "lec4").expect("team");
    assert_eq!(ai_team_tier(relegated, &game), 2);
}

#[test]
fn the_user_is_promoted_when_the_upper_league_finishes_last() {
    // The user wraps the lower league first; the upper league closes later in the
    // background roll and only then does the swap happen.
    let mut game = plain_game("reg1");
    game.leagues[0] = unfinished_league("lec", 1, &LEC);
    advance_season(&mut game);
    assert!(game.ladder.movements.is_empty());

    game.leagues[0] = finished_league("lec", 1, &LEC);
    let manifests = game.competition_configs.clone();
    roll_completed_background_leagues(&mut game, &manifests, &[0]);

    assert_eq!(game.user_competition_id.as_deref(), Some("lec"));
}

#[test]
fn a_user_in_a_third_league_sees_the_swap_without_moving() {
    let mut game = plain_game("lec1");
    game.teams.push(team("xyz1", "xyz"));
    game.teams.push(team("xyz2", "xyz"));
    game.leagues
        .push(finished_league("xyz", 1, &["xyz1", "xyz2"]));
    game.competition_configs
        .insert("xyz".to_string(), manifest("xyz", 1, None));
    game.manager.team_id = Some("xyz1".to_string());
    game.user_competition_id = Some("xyz".to_string());
    advance_season(&mut game);

    assert_eq!(
        (
            only_movement(&game).promoted.clone(),
            game.user_competition_id.clone()
        ),
        (vec!["reg1".to_string()], Some("xyz".to_string()))
    );
}

#[test]
fn a_promoted_users_league_survives_a_save_round_trip() {
    let mut game = plain_game("reg1");
    advance_season(&mut game);

    let json = serde_json::to_string(&game).expect("serialise");
    let loaded: Game = serde_json::from_str(&json).expect("load");

    assert_eq!(
        (
            loaded.user_competition_id.clone(),
            loaded
                .active_league()
                .and_then(|l| l.competition_id.clone()),
            competition_of(&loaded, "reg1"),
            loaded.ladder.movements.len()
        ),
        (
            Some("lec".to_string()),
            Some("lec".to_string()),
            Some("lec".to_string()),
            1
        )
    );
}
