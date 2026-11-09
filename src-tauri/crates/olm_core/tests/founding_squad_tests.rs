use chrono::TimeZone;
use olm_core::clock::GameClock;
use olm_core::custom_team::{CustomTeamSpec, replace_team_with_custom};
use olm_core::domain::manager::Manager;
use olm_core::domain::player::{LolRole, Player, PlayerAttributes};
use olm_core::domain::team::Team;
use olm_core::founding_squad::{
    FoundingSquadError, founding_nationalities, install_founding_squad,
};
use olm_core::game::Game;
use olm_core::residency::{self, Region};
use olm_core::squad_generator::{SQUAD_ROLES, SquadError, founding_wage_budget};
use olm_core::wage_scale::scale_wage_for_market_value;

const SLOT: &str = "les-t0";
const CUSTOM: &str = "les-custom-ray";

fn spec(seed: Option<u32>) -> CustomTeamSpec {
    CustomTeamSpec {
        name: "Rayo Esports".to_string(),
        short_name: "RAY".to_string(),
        primary_color: "#112233".to_string(),
        secondary_color: "#ffffff".to_string(),
        country: "ES".to_string(),
        founding_seed: seed,
        founder_overrides: None,
    }
}

fn team(id: &str, competition: &str) -> Team {
    let mut team = Team::new(
        id.to_string(),
        format!("Club {id}"),
        id.chars().rev().take(3).collect(),
        "ES".to_string(),
        String::new(),
        "Arena".to_string(),
        1_000,
    );
    team.competition_id = Some(competition.to_string());
    team.wage_budget = 1_300_000;
    team
}

fn player(id: &str, team_id: Option<&str>, role: LolRole, level: u8) -> Player {
    let mut player = Player::new(
        id.to_string(),
        format!("nick-{id}"),
        format!("Full {id}"),
        "2000-01-01".to_string(),
        "ES".to_string(),
        role,
        PlayerAttributes::from_array([level; 9]),
    );
    player.team_id = team_id.map(str::to_string);
    player.contract_end = Some("2028-06-30".to_string());
    player.wage = 100_000;
    player
}

/// Eight LES clubs with five level-`level` players each, plus `extra` free agents.
fn world(competition: &str, level: u8) -> Game {
    let clock = GameClock::new(chrono::Utc.with_ymd_and_hms(2026, 8, 1, 12, 0, 0).unwrap());
    let manager = Manager::new(
        "manager-1".to_string(),
        "Test".to_string(),
        "Manager".to_string(),
        "1980-01-01".to_string(),
        "ES".to_string(),
    );
    let mut teams = Vec::new();
    let mut players = Vec::new();
    for t in 0..8 {
        let id = format!("{competition}-t{t}");
        teams.push(team(&id, competition));
        for (r, role) in SQUAD_ROLES.iter().enumerate() {
            players.push(player(&format!("{id}-p{r}"), Some(&id), *role, level));
        }
    }
    Game::new(clock, manager, teams, players, vec![], vec![])
}

fn with_custom_club(competition: &str, level: u8) -> Game {
    let mut game = world(competition, level);
    let slot = format!("{competition}-t0");
    replace_team_with_custom(&mut game, competition, &slot, &spec(None)).expect("custom club");
    game
}

fn founders(game: &Game) -> Vec<&Player> {
    game.players
        .iter()
        .filter(|p| p.team_id.as_deref() == Some(CUSTOM))
        .collect()
}

#[test]
fn installs_five_generated_players_one_per_role() {
    let mut game = with_custom_club("les", 70);
    let outcome = install_founding_squad(&mut game, "les", CUSTOM, Some("ES"), 7).expect("squad");

    let squad = founders(&game);
    assert_eq!(squad.len(), 5);
    assert_eq!(outcome.player_ids.len(), 5);
    assert!(squad.iter().all(|p| p.id.starts_with("gen-ray-")));
    for role in SQUAD_ROLES {
        assert_eq!(
            squad.iter().filter(|p| p.natural_position == role).count(),
            1
        );
    }
    assert!(
        !game
            .players
            .iter()
            .any(|p| p.id.starts_with(SLOT) && p.team_id.is_some())
    );
}

#[test]
fn the_wage_budget_is_derived_from_the_squad_at_the_wage_floor() {
    let mut game = with_custom_club("les", 70);
    let outcome = install_founding_squad(&mut game, "les", CUSTOM, Some("ES"), 7).expect("squad");

    let squad: Vec<Player> = founders(&game).into_iter().cloned().collect();
    let club = game.teams.iter().find(|t| t.id == CUSTOM).expect("club");
    assert_eq!(club.wage_budget, founding_wage_budget(&squad));
    assert_eq!(outcome.wage_budget, club.wage_budget);
    assert!(
        squad
            .iter()
            .all(|p| p.wage >= scale_wage_for_market_value(p.market_value))
    );
}

#[test]
fn the_squad_is_marked_as_moved_and_under_a_two_year_contract() {
    let mut game = with_custom_club("les", 70);
    let outcome = install_founding_squad(&mut game, "les", CUSTOM, Some("ES"), 7).expect("squad");

    for id in &outcome.player_ids {
        assert!(game.moved_player_ids.contains(id), "{id}");
    }
    assert!(
        founders(&game)
            .iter()
            .all(|p| p.contract_end.as_deref() == Some("2028-11-30"))
    );
}

#[test]
fn the_same_seed_gives_the_same_squad_and_another_seed_a_different_one() {
    let key = |game: &Game| {
        founders(game)
            .iter()
            .map(|p| {
                (
                    p.id.clone(),
                    p.full_name.clone(),
                    p.match_name.clone(),
                    p.wage,
                )
            })
            .collect::<Vec<_>>()
    };
    let mut a = with_custom_club("les", 70);
    let mut b = with_custom_club("les", 70);
    let mut c = with_custom_club("les", 70);
    install_founding_squad(&mut a, "les", CUSTOM, Some("ES"), 11).expect("a");
    install_founding_squad(&mut b, "les", CUSTOM, Some("ES"), 11).expect("b");
    install_founding_squad(&mut c, "les", CUSTOM, Some("ES"), 12).expect("c");

    assert_eq!(key(&a), key(&b));
    assert_ne!(key(&a), key(&c));
}

#[test]
fn no_nick_or_full_name_repeats_one_already_in_the_world() {
    let mut reference = with_custom_club("les", 70);
    install_founding_squad(&mut reference, "les", CUSTOM, Some("ES"), 5).expect("reference");
    let wanted: Vec<(String, String)> = founders(&reference)
        .iter()
        .map(|p| (p.match_name.clone(), p.full_name.clone()))
        .collect();

    // A released player already owns each name the seed would produce.
    let mut game = with_custom_club("les", 70);
    for (index, (nick, full)) in wanted.iter().enumerate() {
        let mut released = player(&format!("released-{index}"), None, LolRole::Mid, 70);
        released.match_name = nick.to_uppercase();
        released.full_name = full.to_uppercase();
        game.players.push(released);
    }
    install_founding_squad(&mut game, "les", CUSTOM, Some("ES"), 5).expect("squad");

    let squad = founders(&game);
    let others: Vec<&Player> = game
        .players
        .iter()
        .filter(|p| !p.id.starts_with("gen-"))
        .collect();
    for new in &squad {
        assert!(
            !others
                .iter()
                .any(|p| p.match_name.eq_ignore_ascii_case(&new.match_name))
        );
        assert!(
            !others
                .iter()
                .any(|p| p.full_name.eq_ignore_ascii_case(&new.full_name))
        );
    }
}

#[test]
fn a_taken_player_id_moves_the_squad_to_the_next_serial() {
    let mut game = with_custom_club("les", 70);
    game.players
        .push(player("gen-ray-top-1", None, LolRole::Top, 70));
    let outcome = install_founding_squad(&mut game, "les", CUSTOM, Some("ES"), 3).expect("squad");

    assert!(
        outcome.player_ids.iter().all(|id| id.ends_with("-2")),
        "{:?}",
        outcome.player_ids
    );
}

#[test]
fn every_founding_player_is_a_resident_of_the_clubs_region() {
    let mut game = with_custom_club("les", 70);
    install_founding_squad(&mut game, "les", CUSTOM, Some("ES"), 9).expect("squad");

    let club = game.teams.iter().find(|t| t.id == CUSTOM).expect("club");
    let region = residency::team_region(club);
    assert_eq!(region, Some(Region::Emea));
    for p in founders(&game) {
        assert!(
            !residency::is_import(p, region),
            "{} ({})",
            p.id,
            p.nationality
        );
    }
}

#[test]
fn nationalities_come_from_the_region_with_the_home_country_favoured() {
    let codes = founding_nationalities("les", Some("ES")).expect("codes");
    let regional = residency::region_nationality_codes(Region::Emea);

    assert!(codes.iter().all(|code| regional.contains(code)));
    let home = codes.iter().filter(|code| *code == "ES").count();
    assert!(home * 2 >= codes.len(), "{home} of {}", codes.len());
    assert!(codes.iter().any(|code| code != "ES"));
}

#[test]
fn a_competition_outside_the_tables_falls_back_to_its_country_region() {
    let codes = founding_nationalities("unlisted-league", Some("FR")).expect("codes");
    assert!(codes.iter().any(|code| code == "FR"));
    assert_eq!(
        founding_nationalities("unlisted-league", Some("Narnia")),
        Err(FoundingSquadError::UnknownRegion(
            "unlisted-league".to_string()
        ))
    );
    assert!(founding_nationalities("unlisted-league", None).is_err());
}

#[test]
fn a_league_median_above_the_supported_range_leaves_the_game_untouched() {
    let mut game = with_custom_club("les", 95);
    let before_players = game.players.len();
    let before_budget = game
        .teams
        .iter()
        .find(|t| t.id == CUSTOM)
        .map(|t| t.wage_budget);

    let error =
        install_founding_squad(&mut game, "les", CUSTOM, Some("ES"), 1).expect_err("median");

    assert!(
        matches!(
            error,
            FoundingSquadError::Squad(SquadError::UnsupportedMedian(_))
        ),
        "{error}"
    );
    assert_eq!(game.players.len(), before_players);
    assert_eq!(
        game.teams
            .iter()
            .find(|t| t.id == CUSTOM)
            .map(|t| t.wage_budget),
        before_budget
    );
}

#[test]
fn an_unknown_club_is_reported() {
    let mut game = world("les", 70);
    assert_eq!(
        install_founding_squad(&mut game, "les", "nope", Some("ES"), 1),
        Err(FoundingSquadError::TeamNotFound("nope".to_string()))
    );
}

#[test]
fn peers_leave_out_the_custom_club() {
    let mut game = with_custom_club("les", 70);
    let outcome = install_founding_squad(&mut game, "les", CUSTOM, Some("ES"), 2).expect("squad");

    // Seven original peers: the replaced slot is gone and the custom club is not its own peer.
    assert_eq!(outcome.peer_count, 7);
    assert!(outcome.percentiles_from_peers);
}

#[test]
fn a_spec_without_the_seed_field_still_parses() {
    let json = r##"{"name":"Rayo Esports","short_name":"RAY","primary_color":"#112233","secondary_color":"#ffffff","country":"ES"}"##;
    let parsed: CustomTeamSpec = serde_json::from_str(json).expect("legacy payload");
    assert_eq!(parsed.founding_seed, None);

    let seeded = json.replace("\"ES\"}", "\"ES\",\"founding_seed\":42}");
    let parsed: CustomTeamSpec = serde_json::from_str(&seeded).expect("seeded payload");
    assert_eq!(parsed.founding_seed, Some(42));
}
