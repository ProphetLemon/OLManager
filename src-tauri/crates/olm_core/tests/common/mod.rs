//! Fixtures shared by the ladder integration tests: two linked leagues, `reg` (tier 2)
//! feeding `lec` (tier 1), both with four clubs.

use chrono::{TimeZone, Utc};
use olm_core::clock::GameClock;
use olm_core::domain::league::{
    Fixture, FixtureStatus, League, LeagueKind, MatchResult, MatchType, StandingEntry,
};
use olm_core::domain::manager::Manager;
use olm_core::domain::player::{Player, PlayerAttributes};
use olm_core::domain::stats::LolRole;
use olm_core::domain::team::Team;
use olm_core::game::Game;
use olm_core::generator::definitions::{
    CompetitionManifest, FeederLink, PromotionLink, ScheduleConfig, SeasonStart, SplitConfig,
};
use std::collections::HashMap;

pub const LEC: [&str; 4] = ["lec1", "lec2", "lec3", "lec4"];
pub const REG: [&str; 4] = ["reg1", "reg2", "reg3", "reg4"];

pub fn squad(team_id: &str) -> Vec<Player> {
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

pub fn team(id: &str, competition: &str) -> Team {
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

pub fn fixture(id: &str, home: &str, away: &str, status: FixtureStatus) -> Fixture {
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
pub fn finished_league(id: &str, tier: u8, team_ids: &[&str]) -> League {
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

pub fn manifest(id: &str, tier: u8, promotion: Option<PromotionLink>) -> CompetitionManifest {
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

pub fn link(feeders: &[(&str, &str)]) -> PromotionLink {
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
pub fn finished_game(user: &str, lower: [&str; 4], promotion: PromotionLink) -> Game {
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

/// A finished two-league game with no feeders; the user manages `user`.
pub fn plain_game(user: &str) -> Game {
    finished_game(user, REG, link(&[]))
}
