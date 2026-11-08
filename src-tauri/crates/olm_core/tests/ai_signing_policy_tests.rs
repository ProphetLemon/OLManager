use chrono::{TimeZone, Utc};
use olm_core::clock::GameClock;
use olm_core::contract_wage_policy::{
    AiTransferKind, SigningIntent, SigningRejectionReason, ai_signing_policy, ai_team_tier,
    ai_transfer_cap_reset_if_new_day, ai_transfer_cap_try_consume, reputation_fit_ok,
};
use olm_core::domain::league::{
    Fixture, FixtureStatus, League, LeagueKind, MatchType, StandingEntry,
};
use olm_core::domain::manager::Manager;
use olm_core::domain::player::{Player, PlayerAttributes};
use olm_core::domain::stats::LolRole;
use olm_core::domain::team::Team;
use olm_core::game::Game;

fn attrs() -> PlayerAttributes {
    PlayerAttributes {
        mental_resilience: 60,
        champion_pool: 60,
        laning: 60,
        mechanics: 60,
        macro_play: 60,
        consistency: 60,
        discipline: 60,
        teamfighting: 60,
        shotcalling: 60,
    }
}

fn player(
    id: &str,
    team_id: Option<&str>,
    role: LolRole,
    lol_ovr: u8,
    market_value: u64,
) -> Player {
    let mut player = Player::new(
        id.to_string(),
        id.to_string(),
        format!("{id} Test"),
        "2000-01-01".to_string(),
        "Spain".to_string(),
        role,
        attrs(),
    );
    player.team_id = team_id.map(str::to_string);
    player.wage = 50_000;
    player.lol_ovr = lol_ovr;
    player.market_value = market_value;
    player
}

fn team(id: &str, reputation: u32) -> Team {
    let mut team = Team::new(
        id.to_string(),
        format!("{id} Esports"),
        id.chars().take(3).collect::<String>().to_uppercase(),
        "Spain".to_string(),
        "Madrid".to_string(),
        "Arena".to_string(),
        10_000,
    );
    team.reputation = reputation;
    team.wage_budget = 500_000;
    team.transfer_budget = 500_000;
    team.finance = 500_000;
    team
}

fn league_with_team(team_id: &str, tier: u8, competition_id: &str) -> League {
    League {
        id: "league-1".to_string(),
        name: "League One".to_string(),
        season: 2026,
        fixtures: vec![Fixture {
            id: "fixture-1".to_string(),
            matchday: 1,
            date: "2026-08-02".to_string(),
            home_team_id: team_id.to_string(),
            away_team_id: "other-ai".to_string(),
            match_type: MatchType::League,
            best_of: 1,
            status: FixtureStatus::Scheduled,
            result: None,
        }],
        standings: vec![StandingEntry::new(team_id.to_string())],
        competition_id: Some(competition_id.to_string()),
        logo: None,
        league_kind: LeagueKind::Main,
        split_index: 0,
        tier,
        active: true,
    }
}

fn game_with_team_and_player(team_reputation: u32, player: Player, league_tier: u8) -> Game {
    let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 8, 1, 12, 0, 0).unwrap());
    let mut manager = Manager::new(
        "manager-1".to_string(),
        "Jane".to_string(),
        "Doe".to_string(),
        "1980-01-01".to_string(),
        "Spain".to_string(),
    );
    manager.hire("user-team".to_string());

    let mut home_team = team("ai-team", team_reputation);
    home_team.competition_id = Some("competition-1".to_string());

    let player_id = player.id.clone();
    let player_ovr = player.lol_ovr;
    let mut game = Game::new(
        clock,
        manager,
        vec![home_team, team("other-ai", 500)],
        vec![player],
        vec![],
        vec![],
    );
    game.leagues = vec![league_with_team("ai-team", league_tier, "competition-1")];
    game.user_competition_id = Some("competition-1".to_string());
    if let Some(p) = game.players.iter_mut().find(|p| p.id == player_id) {
        p.lol_ovr = player_ovr;
    }
    game
}

#[test]
fn team_tier_uses_competition_id_when_available() {
    let player = player("fa1", None, LolRole::Mid, 80, 1_000_000);
    let game = game_with_team_and_player(1_200, player, 1);
    let team = game.teams.iter().find(|t| t.id == "ai-team").unwrap();
    assert_eq!(ai_team_tier(team, &game), 1);
}

#[test]
fn team_tier_falls_back_to_reputation_bands() {
    let player = player("fa1", None, LolRole::Mid, 80, 1_000_000);
    let mut game = game_with_team_and_player(1_200, player, 1);
    game.leagues.clear();
    let team = game.teams.iter().find(|t| t.id == "ai-team").unwrap();
    assert_eq!(ai_team_tier(team, &game), 1);
}

#[test]
fn team_tier_reputation_fallback_maps_low_reputation_to_tier_three() {
    let player = player("fa1", None, LolRole::Mid, 80, 1_000_000);
    let mut game = game_with_team_and_player(500, player, 1);
    game.leagues.clear();
    let team = game.teams.iter().find(|t| t.id == "ai-team").unwrap();
    assert_eq!(ai_team_tier(team, &game), 3);
}

#[test]
fn emergency_intent_ignores_reputation_fit() {
    let low_impact = player("fa1", None, LolRole::Support, 60, 100_000);
    let game = game_with_team_and_player(1_200, low_impact, 1);
    let team = game.teams.iter().find(|t| t.id == "ai-team").unwrap();
    let player_ref = game.players.iter().find(|p| p.id == "fa1").unwrap();
    assert!(reputation_fit_ok(
        team,
        player_ref,
        SigningIntent::Emergency,
        &game
    ));
}

#[test]
fn strategic_intent_blocks_low_impact_at_tier_one_high_reputation() {
    let low_impact = player("fa1", None, LolRole::Support, 60, 100_000);
    let game = game_with_team_and_player(1_200, low_impact, 1);
    let team = game.teams.iter().find(|t| t.id == "ai-team").unwrap();
    let player_ref = game.players.iter().find(|p| p.id == "fa1").unwrap();
    assert!(!reputation_fit_ok(
        team,
        player_ref,
        SigningIntent::Strategic,
        &game
    ));
}

#[test]
fn strategic_intent_allows_high_impact_at_tier_one_high_reputation() {
    let high_impact = player("fa1", None, LolRole::Mid, 85, 2_000_000);
    let game = game_with_team_and_player(1_200, high_impact, 1);
    let team = game.teams.iter().find(|t| t.id == "ai-team").unwrap();
    let player_ref = game.players.iter().find(|p| p.id == "fa1").unwrap();
    assert!(reputation_fit_ok(
        team,
        player_ref,
        SigningIntent::Strategic,
        &game
    ));
}

#[test]
fn casual_intent_allows_low_impact_at_tier_one() {
    let low_impact = player("fa1", None, LolRole::Support, 60, 100_000);
    let game = game_with_team_and_player(1_200, low_impact, 1);
    let team = game.teams.iter().find(|t| t.id == "ai-team").unwrap();
    let player_ref = game.players.iter().find(|p| p.id == "fa1").unwrap();
    assert!(reputation_fit_ok(
        team,
        player_ref,
        SigningIntent::Casual,
        &game
    ));
}

#[test]
fn signing_policy_accepts_when_budget_and_fit_ok() {
    let fa = player("fa1", None, LolRole::Mid, 80, 1_000_000);
    let mut game = game_with_team_and_player(1_100, fa, 1);
    // On the LEC wage scale a 1M player asks about 1.2M a year, so the club needs room for it.
    game.teams.iter_mut().find(|t| t.id == "ai-team").unwrap().wage_budget = 2_000_000;
    let team = game.teams.iter().find(|t| t.id == "ai-team").unwrap();
    let player_ref = game.players.iter().find(|p| p.id == "fa1").unwrap();
    let decision = ai_signing_policy(&game, team, player_ref, SigningIntent::Casual);
    assert!(decision.accepted);
    assert!(decision.annual_wage > 0);
    assert!(decision.contract_years >= 1 && decision.contract_years <= 5);
}

#[test]
fn signing_policy_rejects_when_wage_budget_exceeded() {
    let mut fa = player("fa1", None, LolRole::Mid, 95, 5_000_000);
    fa.wage = 2_000_000;
    let mut game = game_with_team_and_player(1_100, fa, 1);
    game.teams
        .iter_mut()
        .find(|t| t.id == "ai-team")
        .unwrap()
        .wage_budget = 100_000;
    let team = game.teams.iter().find(|t| t.id == "ai-team").unwrap();
    let player_ref = game.players.iter().find(|p| p.id == "fa1").unwrap();
    let decision = ai_signing_policy(&game, team, player_ref, SigningIntent::Casual);
    assert!(!decision.accepted);
}

#[test]
fn signing_policy_rejects_strategic_low_impact_at_tier_one() {
    let low_impact = player("fa1", None, LolRole::Support, 60, 100_000);
    let game = game_with_team_and_player(1_200, low_impact, 1);
    let team = game.teams.iter().find(|t| t.id == "ai-team").unwrap();
    let player_ref = game.players.iter().find(|p| p.id == "fa1").unwrap();
    let decision = ai_signing_policy(&game, team, player_ref, SigningIntent::Strategic);
    assert!(!decision.accepted);
}

#[test]
fn transfer_cap_allows_up_to_two_strategic_signings_per_day() {
    let mut game =
        game_with_team_and_player(1_100, player("fa1", None, LolRole::Mid, 80, 1_000_000), 1);
    assert!(ai_transfer_cap_try_consume(
        &mut game,
        "ai-team",
        AiTransferKind::FreeAgent
    ));
    assert!(ai_transfer_cap_try_consume(
        &mut game,
        "ai-team",
        AiTransferKind::FreeAgent
    ));
    assert!(!ai_transfer_cap_try_consume(
        &mut game,
        "ai-team",
        AiTransferKind::FreeAgent
    ));
}

#[test]
fn emergency_cap_is_independent_from_strategic_cap() {
    let mut game =
        game_with_team_and_player(1_100, player("fa1", None, LolRole::Mid, 80, 1_000_000), 1);
    assert!(ai_transfer_cap_try_consume(
        &mut game,
        "ai-team",
        AiTransferKind::FreeAgent
    ));
    assert!(ai_transfer_cap_try_consume(
        &mut game,
        "ai-team",
        AiTransferKind::FreeAgent
    ));
    assert!(ai_transfer_cap_try_consume(
        &mut game,
        "ai-team",
        AiTransferKind::Emergency
    ));
    assert!(!ai_transfer_cap_try_consume(
        &mut game,
        "ai-team",
        AiTransferKind::Emergency
    ));
}

#[test]
fn transfer_cap_resets_on_new_day() {
    let mut game =
        game_with_team_and_player(1_100, player("fa1", None, LolRole::Mid, 80, 1_000_000), 1);
    assert!(ai_transfer_cap_try_consume(
        &mut game,
        "ai-team",
        AiTransferKind::FreeAgent
    ));
    assert!(ai_transfer_cap_try_consume(
        &mut game,
        "ai-team",
        AiTransferKind::FreeAgent
    ));

    game.clock.current_date = Utc.with_ymd_and_hms(2026, 8, 2, 12, 0, 0).unwrap();
    ai_transfer_cap_reset_if_new_day(&mut game);

    assert!(ai_transfer_cap_try_consume(
        &mut game,
        "ai-team",
        AiTransferKind::FreeAgent
    ));
}

#[test]
fn transfer_cap_state_tracks_counts_per_team() {
    let mut game =
        game_with_team_and_player(1_100, player("fa1", None, LolRole::Mid, 80, 1_000_000), 1);
    ai_transfer_cap_try_consume(&mut game, "ai-team", AiTransferKind::FreeAgent);
    let state = game
        .ai_transfer_cap_counts
        .get("ai-team")
        .cloned()
        .unwrap_or_default();
    assert_eq!(state.strategic_count, 1);
    assert_eq!(state.emergency_count, 0);
}

fn lineup_with_two_imports(team_id: &str) -> Vec<Player> {
    let roles = [
        ("top", LolRole::Top, "KR"),
        ("jg", LolRole::Jungle, "KR"),
        ("mid", LolRole::Mid, "ES"),
        ("adc", LolRole::Adc, "ES"),
        ("sup", LolRole::Support, "ES"),
    ];
    roles
        .into_iter()
        .map(|(id, role, nationality)| {
            let mut p = player(id, Some(team_id), role, 70, 300_000);
            p.nationality = nationality.to_string();
            p
        })
        .collect()
}

fn game_with_full_import_slots() -> Game {
    let fa = player("fa-import", None, LolRole::Mid, 80, 1_000_000);
    let mut game = game_with_team_and_player(1_100, fa, 2);
    game.players.extend(lineup_with_two_imports("ai-team"));
    let team = game.teams.iter_mut().find(|t| t.id == "ai-team").unwrap();
    team.competition_id = Some("lec".to_string());
    team.wage_budget = 5_000_000;
    team.active_lineup_ids = ["top", "jg", "mid", "adc", "sup"]
        .iter()
        .map(|id| id.to_string())
        .collect();
    game.players
        .iter_mut()
        .find(|p| p.id == "fa-import")
        .unwrap()
        .nationality = "CN".to_string();
    game
}

#[test]
fn ai_does_not_sign_an_import_it_could_not_start() {
    let game = game_with_full_import_slots();
    let team = game.teams.iter().find(|t| t.id == "ai-team").unwrap();
    let import = game.players.iter().find(|p| p.id == "fa-import").unwrap();

    for intent in [SigningIntent::Strategic, SigningIntent::Casual] {
        let decision = ai_signing_policy(&game, team, import, intent);
        assert!(!decision.accepted, "{intent:?} must refuse the import");
        assert_eq!(decision.reason, SigningRejectionReason::ImportSlotsFull);
    }
}

#[test]
fn ai_signs_a_resident_or_an_import_that_replaces_an_import() {
    let mut game = game_with_full_import_slots();
    let team = game.teams.iter().find(|t| t.id == "ai-team").unwrap().clone();

    // A resident always fits.
    game.players
        .iter_mut()
        .find(|p| p.id == "fa-import")
        .unwrap()
        .nationality = "FR".to_string();
    let resident = game.players.iter().find(|p| p.id == "fa-import").unwrap();
    assert!(ai_signing_policy(&game, &team, resident, SigningIntent::Strategic).accepted);

    // An import at a role currently held by an import fits (still 2 imports).
    let mut replacement = player("fa-top", None, LolRole::Top, 80, 1_000_000);
    replacement.nationality = "CN".to_string();
    game.players.push(replacement);
    let replacement = game.players.iter().find(|p| p.id == "fa-top").unwrap();
    assert!(ai_signing_policy(&game, &team, replacement, SigningIntent::Strategic).accepted);
}

#[test]
fn emergency_signings_may_still_take_an_import() {
    let game = game_with_full_import_slots();
    let team = game.teams.iter().find(|t| t.id == "ai-team").unwrap();
    let import = game.players.iter().find(|p| p.id == "fa-import").unwrap();
    let decision = ai_signing_policy(&game, team, import, SigningIntent::Emergency);
    assert!(decision.accepted);
}
