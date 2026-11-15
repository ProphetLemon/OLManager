//! The AI market treats the user's linked academy club and its players as the user's
//! side (ACADEMY-COPIES). Each test runs the same world twice: with the club linked
//! (the AI must stay away) and unlinked (the control: the AI does act).

use chrono::{TimeZone, Utc};
use olm_core::academy_link::acquire_linked_club;
use olm_core::ai_player_agent::process_ai_player_agents;
use olm_core::ai_team_agent::{ai_strategic_recruitment, process_ai_team_agents};
use olm_core::clock::GameClock;
use olm_core::domain::league::League;
use olm_core::domain::manager::Manager;
use olm_core::domain::player::{LolRole, Player, PlayerAttributes};
use olm_core::domain::season::TransferWindowStatus;
use olm_core::domain::team::Team;
use olm_core::game::Game;
use olm_core::roster_stability::{RosterStabilityReason, repair_league};
use olm_core::transfers::generate_incoming_transfer_offers;

fn team(id: &str, competition: &str, rep: u32) -> Team {
    let mut team = Team::new(
        id.to_string(),
        format!("{id} Esports"),
        id.to_uppercase(),
        "ES".to_string(),
        "City".to_string(),
        "Arena".to_string(),
        10_000,
    );
    team.finance = 10_000_000;
    team.transfer_budget = 5_000_000;
    team.wage_budget = 5_000_000;
    team.reputation = rep;
    team.competition_id = Some(competition.to_string());
    team
}

fn player(id: &str, team_id: Option<&str>, role: LolRole, ovr: u8, value: u64) -> Player {
    let a = PlayerAttributes {
        mechanics: ovr,
        laning: ovr,
        teamfighting: ovr,
        macro_play: ovr,
        consistency: ovr,
        shotcalling: ovr,
        champion_pool: ovr,
        discipline: ovr,
        mental_resilience: ovr,
    };
    let mut player = Player::new(
        id.to_string(),
        id.to_string(),
        id.to_string(),
        "2000-01-01".to_string(),
        "ES".to_string(),
        role,
        a,
    );
    player.team_id = team_id.map(str::to_string);
    player.contract_end = team_id.map(|_| "2028-11-30".to_string());
    player.wage = 20_000;
    player.market_value = value;
    player.condition = 100;
    player.lol_ovr = ovr;
    player
}

const ROLES: [LolRole; 5] = [
    LolRole::Top,
    LolRole::Jungle,
    LolRole::Mid,
    LolRole::Adc,
    LolRole::Support,
];

fn league(competition: &str, tier: u8, members: &[&str]) -> League {
    let ids: Vec<String> = members.iter().map(|id| id.to_string()).collect();
    let mut league = League::new(
        format!("league-{competition}"),
        competition.to_uppercase(),
        2026,
        &ids,
        Some(competition.to_string()),
    );
    league.tier = tier;
    league
}

/// `koi` (user, tier 1), `alpha` (tier 2, linked to koi when `linked`) and `other`
/// (tier 2 AI club). `alpha` fields four roles (no Support), `other` all five.
fn world(linked: bool) -> Game {
    let mut manager = Manager::new(
        "m".to_string(),
        "T".to_string(),
        "M".to_string(),
        "1985-01-01".to_string(),
        "ES".to_string(),
    );
    manager.hire("koi".to_string());
    let mut koi = team("koi", "lec", 1_500);
    koi.manager_id = Some("m".to_string());
    let alpha = team("alpha", "les", 1_200);
    let mut other = team("other", "les", 1_200);
    other.transfer_budget = 0;
    let mut players = Vec::new();
    for (i, role) in ROLES.iter().enumerate() {
        players.push(player(&format!("koi{i}"), Some("koi"), *role, 70, 400_000));
        players.push(player(&format!("other{i}"), Some("other"), *role, 70, 400_000));
        if i < 4 {
            players.push(player(&format!("alpha{i}"), Some("alpha"), *role, 80, 900_000));
        }
    }
    let mut game = Game::new(
        GameClock::new(Utc.with_ymd_and_hms(2026, 3, 16, 12, 0, 0).unwrap()),
        manager,
        vec![koi, alpha, other],
        players,
        vec![],
        vec![],
    );
    game.leagues = vec![league("lec", 1, &["koi"]), league("les", 2, &["alpha", "other"])];
    game.season_context.transfer_window.status = TransferWindowStatus::Open;
    if linked {
        acquire_linked_club(&mut game, "koi", "alpha").expect("link");
    }
    game
}

fn roster(game: &Game, team_id: &str) -> usize {
    game.players
        .iter()
        .filter(|p| p.team_id.as_deref() == Some(team_id))
        .count()
}

fn add_free_agents(game: &mut Game) {
    for (i, role) in ROLES.iter().enumerate() {
        game.players
            .push(player(&format!("fa{i}"), None, *role, 75, 600_000));
    }
}

#[test]
fn the_ai_does_not_sign_free_agents_into_a_linked_club() {
    let mut linked = world(true);
    let mut control = world(false);
    for game in [&mut linked, &mut control] {
        add_free_agents(game);
        generate_incoming_transfer_offers(game);
    }

    assert!(roster(&control, "alpha") > 4, "control: the AI signs a free agent");
    assert_eq!(roster(&linked, "alpha"), 4);
}

#[test]
fn the_team_agent_neither_buys_nor_sells_for_a_linked_club() {
    let mut linked = world(true);
    let mut control = world(false);
    for game in [&mut linked, &mut control] {
        add_free_agents(game);
        for p in game.players.iter_mut().filter(|p| p.id == "alpha0") {
            p.condition = 100;
            p.wage = 400_000;
            p.stats.avg_rating = 1.0;
        }
        process_ai_team_agents(game);
    }

    assert!(roster(&control, "alpha") > 4, "control: the agent buys the missing role");
    assert_eq!(roster(&linked, "alpha"), 4);
}

#[test]
fn strategic_recruitment_does_not_take_a_linked_clubs_players() {
    let mut linked = world(true);
    let mut control = world(false);
    for game in [&mut linked, &mut control] {
        // `other` is an elite tier-1 club whose roster is all Top, and alpha's
        // players (every role) are the only upgrade on the market.
        for role in ROLES {
            let id = format!("alpha-x-{role:?}");
            game.players.push(player(&id, Some("alpha"), role, 85, 1_200_000));
        }
        let other = game.teams.iter_mut().find(|t| t.id == "other").unwrap();
        other.transfer_budget = 5_000_000;
        other.reputation = 1_100;
        other.competition_id = Some("lec".to_string());
        game.leagues[0].standings.push(olm_core::domain::league::StandingEntry::new("other".to_string()));
        for p in game.players.iter_mut().filter(|p| p.team_id.as_deref() == Some("other")) {
            p.natural_position = LolRole::Top;
            p.position = LolRole::Top;
            p.market_value = 100_000;
        }
        ai_strategic_recruitment(game, "other");
    }

    let taken = |game: &Game| {
        game.players
            .iter()
            .filter(|p| p.id.starts_with("alpha") && p.team_id.as_deref() == Some("other"))
            .count()
    };
    assert!(taken(&control) > 0, "control: the elite club recruits from alpha");
    assert_eq!(taken(&linked), 0);
}

#[test]
fn a_linked_clubs_players_get_user_side_offers_and_the_club_is_never_a_buyer() {
    let mut linked = world(true);
    for game in [&mut linked] {
        for p in game.players.iter_mut().filter(|p| p.team_id.as_deref() == Some("alpha")) {
            p.transfer_listed = true;
        }
        add_free_agents(game);
        for _ in 0..5 {
            generate_incoming_transfer_offers(game);
        }
    }

    assert!(!linked
        .players
        .iter()
        .flat_map(|p| p.transfer_offers.iter())
        .any(|offer| offer.from_team_id == "alpha"));
    assert_eq!(roster(&linked, "alpha"), 4, "the AI never moves a player on its own");
}

#[test]
fn the_expiry_repair_still_refills_a_linked_clubs_empty_role_from_free_agents() {
    let mut game = world(true);
    add_free_agents(&mut game);

    repair_league(&mut game, RosterStabilityReason::SeasonTransition).expect("repair");

    assert!(
        game.players
            .iter()
            .any(|p| p.team_id.as_deref() == Some("alpha") && p.natural_position == LolRole::Support),
        "alpha has a Support again"
    );
}

#[test]
fn player_agents_still_reach_a_linked_club_for_renewals() {
    // Kept as a smoke check: the agent pass runs over a world with a linked club.
    let mut game = world(true);
    process_ai_player_agents(&mut game);
    assert_eq!(roster(&game, "alpha"), 4);
}


#[test]
fn ai_clubs_do_not_buy_players_out_of_a_linked_club() {
    let mut linked = world(true);
    let mut control = world(false);
    for game in [&mut linked, &mut control] {
        game.teams.iter_mut().find(|t| t.id == "other").unwrap().transfer_budget = 5_000_000;
        for p in game.players.iter_mut().filter(|p| p.team_id.as_deref() == Some("alpha")) {
            p.transfer_listed = true;
            p.market_value = 1_200_000;
        }
        generate_incoming_transfer_offers(game);
    }

    let bought = |game: &Game| {
        game.players
            .iter()
            .filter(|p| p.id.starts_with("alpha") && p.team_id.as_deref() == Some("other"))
            .count()
    };
    assert!(bought(&control) > 0, "control: the AI buys a listed player");
    assert_eq!(bought(&linked), 0);
}
