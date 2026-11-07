use chrono::{TimeZone, Utc};
use olm_core::ai_team_agent::ai_strategic_recruitment;
use olm_core::clock::GameClock;
use olm_core::domain::league::{
    Fixture, FixtureStatus, League, LeagueKind, MatchType, StandingEntry,
};
use olm_core::domain::manager::Manager;
use olm_core::domain::player::{Player, PlayerAttributes};
use olm_core::domain::season::TransferWindowStatus;
use olm_core::domain::stats::LolRole;
use olm_core::domain::team::Team;
use olm_core::game::Game;
use olm_core::turn;
use std::collections::HashMap;

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
    player.contract_end = Some("2028-06-30".to_string());
    player
}

fn free_agent(id: &str, role: LolRole, lol_ovr: u8, market_value: u64) -> Player {
    player(id, None, role, lol_ovr, market_value)
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
    team.wage_budget = 2_000_000;
    team.transfer_budget = 2_000_000;
    team.finance = 5_000_000;
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

fn make_strategic_game(
    buyer_reputation: u32,
    league_tier: u8,
    seller_players: Vec<Player>,
    free_agents: Vec<Player>,
) -> Game {
    let date = Utc.with_ymd_and_hms(2026, 8, 1, 12, 0, 0).unwrap();
    let clock = GameClock::new(date);
    let mut manager = Manager::new(
        "manager-1".to_string(),
        "Jane".to_string(),
        "Doe".to_string(),
        "1980-01-01".to_string(),
        "Spain".to_string(),
    );
    manager.hire("user-team".to_string());

    let mut buyer = team("buyer", buyer_reputation);
    buyer.competition_id = Some("competition-1".to_string());

    let seller = team("seller", 800);
    let other = team("other-ai", 500);

    // Capture custom values before Game::new refreshes them.
    let snapshot: Vec<(String, u8, u64)> = seller_players
        .iter()
        .chain(free_agents.iter())
        .map(|p| (p.id.clone(), p.lol_ovr, p.market_value))
        .collect();

    let mut players = vec![];
    players.extend(seller_players);
    players.extend(free_agents);
    // Give buyer a minimal roster so it has a preferred role
    players.push(player(
        "buyer-top",
        Some("buyer"),
        LolRole::Top,
        75,
        300_000,
    ));
    players.push(player(
        "buyer-jungle",
        Some("buyer"),
        LolRole::Jungle,
        75,
        300_000,
    ));
    players.push(player(
        "buyer-mid",
        Some("buyer"),
        LolRole::Mid,
        75,
        300_000,
    ));
    players.push(player(
        "buyer-adc",
        Some("buyer"),
        LolRole::Adc,
        75,
        300_000,
    ));
    // Support gap intentionally left so preferred role becomes SUPPORT

    let mut game = Game::new(
        clock,
        manager,
        vec![buyer, seller, other],
        players,
        vec![],
        vec![],
    );
    game.leagues = vec![league_with_team("buyer", league_tier, "competition-1")];
    game.user_competition_id = Some("competition-1".to_string());
    game.season_context.transfer_window.status = TransferWindowStatus::Open;

    // Restore custom lol_ovr/market_value after Game::new refresh.
    for (id, ovr, mv) in snapshot {
        if let Some(p) = game.players.iter_mut().find(|p| p.id == id) {
            p.lol_ovr = ovr;
            p.market_value = mv;
        }
    }
    game
}

#[test]
fn strategic_recruitment_rejects_low_impact_free_agent_at_tier_one() {
    let free_agents = vec![free_agent("fa-low", LolRole::Support, 60, 100_000)];
    let mut game = make_strategic_game(1_200, 1, vec![], free_agents);

    ai_strategic_recruitment(&mut game, "buyer");

    let fa = game.players.iter().find(|p| p.id == "fa-low").unwrap();
    assert_eq!(
        fa.team_id, None,
        "low-impact FA should be rejected by strategic recruitment"
    );
    assert!(
        game.transfer_history.entries.is_empty(),
        "no history should be recorded for rejected signing"
    );
}

#[test]
fn strategic_recruitment_completes_club_to_club_upgrade_with_non_zero_terms() {
    // Seller has a high-impact Support player (matches buyer's preferred role gap)
    let seller_players = vec![player(
        "star-support",
        Some("seller"),
        LolRole::Support,
        85,
        2_000_000,
    )];
    let mut game = make_strategic_game(1_200, 1, seller_players, vec![]);

    ai_strategic_recruitment(&mut game, "buyer");

    let star = game
        .players
        .iter()
        .find(|p| p.id == "star-support")
        .unwrap();
    assert_eq!(
        star.team_id.as_deref(),
        Some("buyer"),
        "high-impact upgrade should move to buyer"
    );
    assert!(star.wage > 0, "player wage must be non-zero after transfer");

    let entry = game
        .transfer_history
        .entries
        .iter()
        .find(|e| e.player_id == "star-support")
        .expect("history entry should exist");
    assert!(
        entry.annual_wage > 0,
        "history annual_wage must be non-zero"
    );
    assert!(
        entry.contract_years >= 1 && entry.contract_years <= 5,
        "history contract_years must be realistic"
    );
    assert_eq!(
        entry.annual_wage, star.wage,
        "history wage must match player wage"
    );
}

#[test]
fn strategic_recruitment_respects_daily_cap() {
    let seller_players = vec![
        player(
            "star-support",
            Some("seller"),
            LolRole::Support,
            85,
            2_000_000,
        ),
        player("star-top", Some("seller"), LolRole::Top, 85, 1_900_000),
        player(
            "star-jungle",
            Some("seller"),
            LolRole::Jungle,
            85,
            1_800_000,
        ),
    ];
    let mut game = make_strategic_game(1_200, 1, seller_players, vec![]);
    game.teams
        .iter_mut()
        .find(|team| team.id == "buyer")
        .expect("buyer should exist")
        .transfer_budget = 10_000_000;
    game.teams
        .iter_mut()
        .find(|team| team.id == "buyer")
        .expect("buyer should exist")
        .finance = 10_000_000;

    // First and second calls consume the daily strategic transfer cap.
    ai_strategic_recruitment(&mut game, "buyer");
    assert_eq!(
        game.players
            .iter()
            .find(|p| p.id == "star-support")
            .unwrap()
            .team_id
            .as_deref(),
        Some("buyer")
    );

    ai_strategic_recruitment(&mut game, "buyer");
    assert_eq!(
        game.players
            .iter()
            .find(|p| p.id == "star-top")
            .unwrap()
            .team_id
            .as_deref(),
        Some("buyer")
    );

    // Third call on the same day still has an eligible candidate, so only the
    // daily cap can block the signing.
    ai_strategic_recruitment(&mut game, "buyer");
    assert_eq!(
        game.players
            .iter()
            .find(|p| p.id == "star-jungle")
            .unwrap()
            .team_id
            .as_deref(),
        Some("seller")
    );
    let entries_for_buyer = game
        .transfer_history
        .entries
        .iter()
        .filter(|e| e.to_team_id == "buyer")
        .count();
    assert_eq!(
        entries_for_buyer, 2,
        "third strategic signing should be capped"
    );
}

#[test]
fn process_day_runs_strategic_recruitment_for_eligible_team() {
    let seller_players = vec![player(
        "star-support",
        Some("seller"),
        LolRole::Support,
        85,
        2_000_000,
    )];
    let mut game = make_strategic_game(1_200, 1, seller_players, vec![]);

    // Advance one day to trigger turn pipeline
    turn::process_day(&mut game);

    let star = game
        .players
        .iter()
        .find(|p| p.id == "star-support")
        .unwrap();
    assert_eq!(
        star.team_id.as_deref(),
        Some("buyer"),
        "turn wiring should run strategic recruitment and complete upgrade"
    );
}

#[test]
fn strategic_recruitment_fa_fallback_signs_high_impact_free_agent() {
    let free_agents = vec![free_agent("fa-star", LolRole::Support, 85, 2_000_000)];
    let mut game = make_strategic_game(1_200, 1, vec![], free_agents);
    // On the LEC wage scale a 2M free agent asks about 2.4M a year, above the default 2M budget.
    game.teams.iter_mut().find(|t| t.id == "buyer").unwrap().wage_budget = 4_000_000;

    ai_strategic_recruitment(&mut game, "buyer");

    let fa = game.players.iter().find(|p| p.id == "fa-star").unwrap();
    assert_eq!(
        fa.team_id.as_deref(),
        Some("buyer"),
        "high-impact FA fallback should sign"
    );
    assert!(fa.wage > 0);

    let entry = game
        .transfer_history
        .entries
        .iter()
        .find(|e| e.player_id == "fa-star")
        .expect("history entry should exist");
    assert!(entry.annual_wage > 0);
}

#[test]
fn strategic_recruitment_generates_rejection_news_with_intent_metadata() {
    let free_agents = vec![free_agent("fa-low", LolRole::Support, 60, 100_000)];
    let mut game = make_strategic_game(1_200, 1, vec![], free_agents);

    ai_strategic_recruitment(&mut game, "buyer");

    let article = game
        .news
        .iter()
        .find(|n| n.id.starts_with("ai_strategic_rejected_buyer_"))
        .expect("strategic rejection news should be generated");
    assert_eq!(
        article.i18n_params.get("intent"),
        Some(&"strategic".to_string())
    );
    assert_eq!(
        article.i18n_params.get("outcome"),
        Some(&"rejected".to_string())
    );
    assert!(
        !article.headline.is_empty(),
        "raw headline fallback should be non-empty"
    );
    assert!(
        !article.body.is_empty(),
        "raw body fallback should be non-empty"
    );
    assert!(
        !article.source.is_empty(),
        "raw source fallback should be non-empty"
    );
    assert!(article.player_ids.contains(&"fa-low".to_string()));
}

#[test]
fn process_day_fourteen_days_respects_cap_and_no_zero_wage_entries() {
    // Provide a pool of high-impact Support players on the seller so strategic
    // recruitment has club-to-club upgrade opportunities across multiple days.
    let seller_players: Vec<Player> = (0..5)
        .map(|i| {
            player(
                &format!("star-support-{i}"),
                Some("seller"),
                LolRole::Support,
                85,
                2_000_000,
            )
        })
        .collect();
    let mut game = make_strategic_game(1_200, 1, seller_players, vec![]);

    // Push the only fixture far into the future so no matchday simulation runs
    // during the 14-day window (keeps the test focused on transfer behaviour).
    if let Some(league) = game.leagues.first_mut() {
        for fixture in &mut league.fixtures {
            fixture.date = "2026-09-01".to_string();
        }
    }

    for _ in 0..14 {
        turn::process_day(&mut game);
    }

    // No transfer history entry may contain a zero wage or zero contract term.
    for entry in &game.transfer_history.entries {
        assert!(
            entry.annual_wage > 0,
            "entry {} for player {} has zero annual_wage",
            entry.id,
            entry.player_id
        );
        assert!(
            entry.contract_years > 0 && entry.contract_years <= 5,
            "entry {} for player {} has unrealistic contract_years: {}",
            entry.id,
            entry.player_id,
            entry.contract_years
        );
    }

    // Per-team daily cap audit: AI-initiated transfers are limited to
    // MAX_AI_TRANSFERS_PER_DAY (2) + MAX_AI_EMERGENCY_TRANSFERS_PER_DAY (1).
    let mut daily_counts: HashMap<(String, String), usize> = HashMap::new();
    let mut emergency_counts: HashMap<(String, String), usize> = HashMap::new();
    for entry in &game.transfer_history.entries {
        if entry.is_user_involved {
            continue;
        }
        let key = (entry.date.clone(), entry.to_team_id.clone());
        *daily_counts.entry(key.clone()).or_insert(0) += 1;
        if entry.intent.as_deref() == Some("emergency") {
            *emergency_counts.entry(key).or_insert(0) += 1;
        }
    }

    for ((date, team_id), count) in &daily_counts {
        assert!(
            *count <= 3,
            "team {} on {} has {} AI-initiated transfers (exceeds 2 strategic/FA/club-to-club + 1 emergency)",
            team_id,
            date,
            count
        );
    }

    for ((date, team_id), count) in &emergency_counts {
        assert!(
            *count <= 1,
            "team {} on {} has {} emergency transfers (exceeds 1 per day)",
            team_id,
            date,
            count
        );
    }
}
