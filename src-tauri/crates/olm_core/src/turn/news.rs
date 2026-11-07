use crate::domain::league::{Fixture, FixtureStatus, League, StandingEntry};
use crate::game::Game;
use crate::messages;
use crate::news;
use chrono::Datelike;
use std::collections::HashMap;

fn completed_fixtures_for_day<'a>(league: &'a League, today: &str) -> Vec<&'a Fixture> {
    league
        .fixtures
        .iter()
        .filter(|fixture| {
            fixture.date == today
                && fixture.status == FixtureStatus::Completed
                && fixture.counts_for_league_standings()
        })
        .collect()
}

fn team_name_or(game: &Game, team_id: &str, fallback: &str) -> String {
    game.teams
        .iter()
        .find(|team| team.id == team_id)
        .map(|team| team.name.clone())
        .unwrap_or_else(|| fallback.to_string())
}

fn team_name(game: &Game, team_id: &str) -> String {
    team_name_or(game, team_id, "")
}

fn player_match_name_or_id(game: &Game, player_id: &str) -> String {
    game.players
        .iter()
        .find(|player| player.id == player_id)
        .map(|player| player.match_name.clone())
        .unwrap_or_else(|| player_id.to_string())
}

fn scorers_for_side(
    game: &Game,
    report: &crate::engine::MatchReport,
    side: crate::engine::Side,
) -> Vec<(String, u32)> {
    report
        .kill_feed
        .iter()
        .filter(|kill| kill.side == side)
        .map(|kill| {
            (
                player_match_name_or_id(game, &kill.killer_id),
                kill.minute as u32,
            )
        })
        .collect()
}

fn matchday_results(game: &Game, fixtures: &[&Fixture]) -> Vec<(String, u8, String, u8)> {
    fixtures
        .iter()
        .map(|fixture| {
            let (home_goals, away_goals) = fixture
                .result
                .as_ref()
                .map(|result| (result.home_wins, result.away_wins))
                .unwrap_or((0, 0));
            (
                team_name(game, &fixture.home_team_id),
                home_goals,
                team_name(game, &fixture.away_team_id),
                away_goals,
            )
        })
        .collect()
}

fn standings_rows(game: &Game, league: &League) -> Vec<(String, u32, i16)> {
    let mut standings: Vec<(String, u32, i16)> = league
        .standings
        .iter()
        .map(|entry| {
            (
                team_name(game, &entry.team_id),
                entry.points,
                entry.kill_difference() as i16,
            )
        })
        .collect();
    standings.sort_by(|a, b| b.1.cmp(&a.1).then(b.2.cmp(&a.2)));
    standings
}

fn pre_match_target_date(today: &str) -> Option<String> {
    let today_date = chrono::NaiveDate::parse_from_str(today, "%Y-%m-%d").ok()?;
    Some(
        (today_date + chrono::Duration::days(3))
            .format("%Y-%m-%d")
            .to_string(),
    )
}

fn scheduled_user_fixtures_for_date<'a>(
    league: &'a League,
    user_team_id: &str,
    target_date: &str,
) -> Vec<&'a Fixture> {
    league
        .fixtures
        .iter()
        .filter(|fixture| {
            fixture.date == target_date
                && fixture.status == FixtureStatus::Scheduled
                && fixture.counts_for_league_standings()
                && (fixture.home_team_id == user_team_id || fixture.away_team_id == user_team_id)
        })
        .collect()
}

fn opponent_for_fixture<'a>(fixture: &'a Fixture, user_team_id: &str) -> (&'a str, bool) {
    if fixture.home_team_id == user_team_id {
        (&fixture.away_team_id, true)
    } else {
        (&fixture.home_team_id, false)
    }
}

fn weekly_digest_suffix(game: &Game) -> String {
    let iso_week = game.clock.current_date.iso_week();
    format!("{}_w{:02}", iso_week.year(), iso_week.week())
}

fn season_has_started(league: &League) -> bool {
    crate::end_of_season::season_has_started(league)
}

fn title_race_is_newsworthy(leader: &StandingEntry, challenger: &StandingEntry) -> bool {
    leader.played >= 5
        && challenger.played >= 5
        && leader.points > 0
        && leader.points.saturating_sub(challenger.points) <= 3
}

fn has_equivalent_storyline(game: &Game, candidate: &crate::domain::news::NewsArticle) -> bool {
    game.news.iter().any(|article| {
        article.category == candidate.category
            && article.headline_key == candidate.headline_key
            && article.body_key == candidate.body_key
            && article.source_key == candidate.source_key
            && article.team_ids == candidate.team_ids
            && article.player_ids == candidate.player_ids
            && article.i18n_params == candidate.i18n_params
    })
}

fn unbeaten_run_length(form: &[String]) -> u32 {
    let mut streak = 0;

    for result in form.iter().rev() {
        if result == "L" {
            break;
        }

        if result == "W" || result == "D" {
            streak += 1;
        }
    }

    streak
}

fn top_scorer_summary(game: &Game) -> Option<(String, u32)> {
    game.players
        .iter()
        .filter(|player| player.stats.kills > 0)
        .max_by(|a, b| {
            a.stats
                .kills
                .cmp(&b.stats.kills)
                .then_with(|| a.match_name.cmp(&b.match_name))
        })
        .map(|player| (player.match_name.clone(), player.stats.kills))
}

fn weekly_storyline_articles(
    game: &Game,
    suffix: &str,
    date: &str,
) -> Vec<crate::domain::news::NewsArticle> {
    let mut articles = Vec::new();
    let league = match game.active_league() {
        Some(league) => league,
        None => return articles,
    };

    let sorted_standings = league.sorted_standings();
    if sorted_standings.len() >= 2 {
        let leader = &sorted_standings[0];
        let challenger = &sorted_standings[1];

        if title_race_is_newsworthy(leader, challenger) {
            let leader_name = team_name(game, &leader.team_id);
            let challenger_name = team_name(game, &challenger.team_id);
            let gap = leader.points.saturating_sub(challenger.points);
            let article = news::title_race_storyline_article(
                &format!("storyline_title_race_{}", suffix),
                &leader.team_id,
                &leader_name,
                &challenger.team_id,
                &challenger_name,
                gap,
                date,
            );

            if !has_equivalent_storyline(game, &article) {
                articles.push(article);
            }
        }
    }

    if let Some(team) = game
        .teams
        .iter()
        .map(|team| (team, unbeaten_run_length(&team.form)))
        .filter(|(_, streak)| *streak >= 5)
        .max_by_key(|(_, streak)| *streak)
        .map(|(team, streak)| (team.id.clone(), team.name.clone(), streak))
    {
        let article = news::unbeaten_streak_storyline_article(
            &format!("storyline_unbeaten_streak_{}", suffix),
            &team.0,
            &team.1,
            team.2,
            date,
        );

        if !has_equivalent_storyline(game, &article) {
            articles.push(article);
        }
    }

    articles
}

pub(super) fn generate_weekly_digest_news(game: &mut Game, today: &str) {
    if game.clock.current_date.weekday().num_days_from_monday() != 0 {
        return;
    }

    let league = match game.active_league() {
        Some(league) => league,
        None => return,
    };

    if !season_has_started(league) {
        return;
    }

    let suffix = weekly_digest_suffix(game);
    let digest_id = format!("weekly_digest_{}", suffix);
    if game.news.iter().any(|article| article.id == digest_id) {
        return;
    }

    let date = game.clock.current_date.to_rfc3339();
    let sorted_standings = league.sorted_standings();
    let leader = sorted_standings
        .first()
        .map(|entry| team_name(game, &entry.team_id))
        .unwrap_or_else(|| "Unknown".to_string());
    let storylines = weekly_storyline_articles(game, &suffix, &date);
    let (top_scorer, top_scorer_goals) =
        top_scorer_summary(game).unwrap_or_else(|| (String::new(), 0));

    game.news.push(news::weekly_digest_article(
        &digest_id,
        today,
        &leader,
        &top_scorer,
        top_scorer_goals,
        storylines.len(),
        &date,
    ));
    game.news.extend(storylines);
}

/// Generate a match report news article for the completed fixture.
pub(super) fn generate_match_news(
    game: &mut Game,
    fixture_index: usize,
    home_team_id: &str,
    away_team_id: &str,
    report: &crate::engine::MatchReport,
) {
    let fixture = &game.active_league().unwrap().fixtures[fixture_index];
    let article_id = format!("report_{}", fixture.id);
    if game.news.iter().any(|n| n.id == article_id) {
        return;
    }

    let home_name = team_name_or(game, home_team_id, "Home");
    let away_name = team_name_or(game, away_team_id, "Away");
    let home_scorers = scorers_for_side(game, report, crate::engine::Side::Home);
    let away_scorers = scorers_for_side(game, report, crate::engine::Side::Away);

    let article = news::match_report_article(
        &fixture.id,
        &home_name,
        &away_name,
        report.home_wins,
        report.away_wins,
        home_team_id,
        away_team_id,
        fixture.matchday,
        &home_scorers,
        &away_scorers,
        &game.clock.current_date.to_rfc3339(),
    );
    game.news.push(article);
}

/// After all matches in a matchday are simulated, generate roundup + standings news.
pub fn generate_matchday_news(game: &mut Game, today: &str) {
    // Use leagues.first() directly for borrow checker compatibility
    let league = match game.leagues.first() {
        Some(l) => l,
        None => return,
    };

    let todays_fixtures = completed_fixtures_for_day(league, today);

    if todays_fixtures.is_empty() {
        return;
    }

    let matchday = todays_fixtures[0].matchday;
    let date_str = game.clock.current_date.to_rfc3339();

    // Don't duplicate
    let roundup_id = format!("roundup_md{}", matchday);
    if game.news.iter().any(|n| n.id == roundup_id) {
        return;
    }

    let results = matchday_results(game, &todays_fixtures);

    let roundup = news::league_roundup_article(matchday, &results, &date_str);
    game.news.push(roundup);

    let standings = standings_rows(game, league);

    let standings_article = news::standings_update_article(matchday, &standings, &date_str);
    game.news.push(standings_article);
}

pub(super) fn generate_pre_match_messages(game: &mut Game, today: &str) {
    let user_team_id = match &game.manager.team_id {
        Some(id) => id.clone(),
        None => return,
    };

    let target_str = match pre_match_target_date(today) {
        Some(date) => date,
        None => return,
    };

    if let Some(league) = game.leagues.first() {
        let upcoming = scheduled_user_fixtures_for_date(league, &user_team_id, &target_str);

        for fixture in upcoming {
            let (opponent_id, is_home) = opponent_for_fixture(fixture, &user_team_id);
            let opponent_name = team_name_or(game, opponent_id, "Unknown");

            // Check if we already sent this message
            let msg_id = format!("prematch_{}", fixture.id);
            let already_sent = game.messages.iter().any(|m| m.id == msg_id);
            if already_sent {
                continue;
            }

            let msg = messages::pre_match_message(
                &fixture.id,
                &opponent_name,
                opponent_id,
                is_home,
                fixture.matchday,
                &target_str,
                &game.clock.current_date.to_rfc3339(),
            );
            game.messages.push(msg);
        }
    }
}

/// Generate news articles for AI team free agent signings.
/// Must be called AFTER `process_ai_team_agents()` in the turn pipeline.
pub(super) fn generate_ai_transfer_news(game: &mut Game) {
    for entry in &game.transfer_history.entries {
        // Skip if the user's team is involved (user's own transfers
        // already have dedicated inbox messages)
        if entry.is_user_involved {
            continue;
        }

        // Skip club-to-club transfers — free agents only
        // (free agent signings have empty from_team_id)
        if !entry.from_team_id.is_empty() {
            continue;
        }

        let article_id = format!("ai_fa_signed_{}_{}", entry.player_id, entry.date);

        // Deduplicate: skip if article already exists
        if game.news.iter().any(|n| n.id == article_id) {
            continue;
        }

        let player_name = player_match_name_or_id(game, &entry.player_id);
        let team_name = team_name(game, &entry.to_team_id);

        let date = game.clock.current_date.to_rfc3339();
        let mut params = HashMap::new();
        params.insert("player".to_string(), player_name);
        params.insert("team".to_string(), team_name);
        params.insert("years".to_string(), entry.contract_years.to_string());
        params.insert("wage".to_string(), entry.annual_wage.to_string());
        if let Some(ref intent) = entry.intent {
            params.insert("intent".to_string(), intent.clone());
        }

        let article = crate::domain::news::NewsArticle::new(
            article_id,
            String::new(),
            String::new(),
            String::new(),
            date,
            crate::domain::news::NewsCategory::TransferRumour,
        )
        .with_i18n(
            "be.news.freeAgentSigned.headline",
            "be.news.freeAgentSigned.body",
            "be.source.leagueChronicle",
            params,
        )
        .with_teams(vec![entry.to_team_id.clone()])
        .with_players(vec![entry.player_id.clone()]);

        game.news.push(article);
    }
}

/// Generate a news article when an elite team strategically passes on a free agent
/// because their impact does not meet the club's recruitment threshold.
pub(crate) fn generate_strategic_rejection_news(game: &mut Game, team_id: &str, player_id: &str) {
    let article_id = format!(
        "ai_strategic_rejected_{}_{}",
        team_id,
        game.clock.current_date.format("%Y-%m-%d")
    );
    if game.news.iter().any(|n| n.id == article_id) {
        return;
    }

    let player_name = player_match_name_or_id(game, player_id);
    let team_name = team_name(game, team_id);
    let date = game.clock.current_date.to_rfc3339();

    let mut params = HashMap::new();
    params.insert("player".to_string(), player_name.clone());
    params.insert("team".to_string(), team_name.clone());
    params.insert("intent".to_string(), "strategic".to_string());
    params.insert("outcome".to_string(), "rejected".to_string());

    let article = crate::domain::news::NewsArticle::new(
        article_id,
        format!("{team_name} pass on {player_name}"),
        format!(
            "{team_name} ended their strategic review of {player_name} without making an offer."
        ),
        "League Chronicle".to_string(),
        date,
        crate::domain::news::NewsCategory::TransferRumour,
    )
    .with_i18n(
        "be.news.strategicRejection.headline",
        "be.news.strategicRejection.body",
        "be.source.leagueChronicle",
        params,
    )
    .with_teams(vec![team_id.to_string()])
    .with_players(vec![player_id.to_string()]);

    game.news.push(article);
}

#[cfg(test)]
mod tests {
    use super::{
        generate_ai_transfer_news, generate_match_news, generate_matchday_news,
        generate_pre_match_messages, generate_weekly_digest_news,
    };
    use crate::clock::GameClock;
    use crate::domain::league::{
        Fixture, FixtureStatus, League, MatchResult, MatchType, StandingEntry,
    };
    use crate::domain::manager::Manager;
    use crate::domain::message::{MessageCategory, MessagePriority};
    use crate::domain::news::NewsCategory;
    use crate::domain::player::{LolRole, Player, PlayerAttributes};
    use crate::domain::team::Team;
    use crate::domain::transfer_history::TransferHistoryEntry;
    use crate::engine::{KillDetail, MatchReport, MatchReportEndReason, Side, TeamStats};
    use crate::game::Game;
    use chrono::{TimeZone, Utc};
    use std::collections::HashMap;

    fn make_team(id: &str, name: &str) -> Team {
        Team::new(
            id.to_string(),
            name.to_string(),
            name.to_string(),
            "England".to_string(),
            "Test City".to_string(),
            format!("{} Ground", name),
            20_000,
        )
    }

    fn make_manager() -> Manager {
        let mut manager = Manager::new(
            "mgr1".to_string(),
            "Alex".to_string(),
            "Manager".to_string(),
            "1980-01-01".to_string(),
            "England".to_string(),
        );
        manager.hire("team1".to_string());
        manager
    }

    fn make_fixture(
        id: &str,
        matchday: u32,
        date: &str,
        home_team_id: &str,
        away_team_id: &str,
        status: FixtureStatus,
        result: Option<(u8, u8)>,
    ) -> Fixture {
        Fixture {
            id: id.to_string(),
            matchday,
            date: date.to_string(),
            home_team_id: home_team_id.to_string(),
            away_team_id: away_team_id.to_string(),
            match_type: MatchType::League,
            best_of: 1,
            status,
            result: result.map(|(home_goals, away_goals)| MatchResult {
                home_wins: home_goals,
                away_wins: away_goals,
                ended_by: Default::default(),
                game_duration_seconds: 90 * 60,
                report: None,
            }),
        }
    }

    fn default_attrs() -> PlayerAttributes {
        PlayerAttributes {
            mechanics: 69,
            laning: 72,
            teamfighting: 64,
            macro_play: 65,
            consistency: 67,
            shotcalling: 52,
            champion_pool: 68,
            discipline: 66,
            mental_resilience: 70,
        }
    }

    fn make_player(id: &str, name: &str, team_id: &str) -> Player {
        let mut player = Player::new(
            id.to_string(),
            name.to_string(),
            format!("Full {}", name),
            "1998-03-15".to_string(),
            "England".to_string(),
            LolRole::Mid,
            default_attrs(),
        );
        player.team_id = Some(team_id.to_string());
        player
    }

    fn make_report(kills: Vec<KillDetail>, home_wins: u8, away_wins: u8) -> MatchReport {
        MatchReport {
            home_wins,
            away_wins,
            home_stats: TeamStats::default(),
            away_stats: TeamStats::default(),
            events: vec![],
            kill_feed: kills,
            player_stats: HashMap::new(),
            home_possession: 50.0,
            total_minutes: 90,
            game_duration_seconds: 90 * 60,
            ended_by: MatchReportEndReason::TimeLimit,
        }
    }

    fn make_game(today: &str, todays_fixture_status: FixtureStatus) -> Game {
        let clock = GameClock::new(Utc.with_ymd_and_hms(2025, 8, 12, 12, 0, 0).unwrap());
        let manager = make_manager();
        let teams = vec![
            make_team("team1", "Alpha FC"),
            make_team("team2", "Beta FC"),
            make_team("team3", "Gamma FC"),
        ];

        let mut game = Game::new(clock, manager, teams, vec![], vec![], vec![]);

        let mut alpha = StandingEntry::new("team1".to_string());
        alpha.record_result(2, 1);
        let mut beta = StandingEntry::new("team2".to_string());
        beta.record_result(1, 2);
        let gamma = StandingEntry::new("team3".to_string());

        game.leagues = vec![League {
            id: "league1".to_string(),
            name: "Premier Division".to_string(),
            season: 1,
            competition_id: None,
            fixtures: vec![
                make_fixture(
                    "fx1",
                    4,
                    today,
                    "team1",
                    "team2",
                    todays_fixture_status,
                    Some((2, 1)),
                ),
                make_fixture(
                    "fx2",
                    4,
                    "2025-08-13",
                    "team3",
                    "team2",
                    FixtureStatus::Completed,
                    Some((0, 0)),
                ),
            ],
            standings: vec![alpha, beta, gamma],
            logo: None,
            league_kind: crate::domain::league::LeagueKind::Main,
            split_index: 0,
            tier: 0,
            active: false,
        }];

        game
    }

    fn set_current_date(game: &mut Game, year: i32, month: u32, day: u32) {
        game.clock = GameClock::new(Utc.with_ymd_and_hms(year, month, day, 12, 0, 0).unwrap());
    }

    fn standing_mut<'a>(game: &'a mut Game, team_id: &str) -> &'a mut StandingEntry {
        game.active_league_mut()
            .unwrap()
            .standings
            .iter_mut()
            .find(|entry| entry.team_id == team_id)
            .unwrap()
    }

    fn team_mut<'a>(game: &'a mut Game, team_id: &str) -> &'a mut Team {
        game.teams
            .iter_mut()
            .find(|team| team.id == team_id)
            .unwrap()
    }

    fn reset_to_preseason(game: &mut Game) {
        let league = game.active_league_mut().unwrap();
        for fixture in &mut league.fixtures {
            fixture.status = FixtureStatus::Scheduled;
        }
        league.standings = vec![
            StandingEntry::new("team1".to_string()),
            StandingEntry::new("team2".to_string()),
            StandingEntry::new("team3".to_string()),
        ];
    }

    #[test]
    fn generate_matchday_news_adds_roundup_and_standings_for_completed_fixtures_today() {
        let mut game = make_game("2025-08-12", FixtureStatus::Completed);

        generate_matchday_news(&mut game, "2025-08-12");

        assert_eq!(game.news.len(), 2);

        let roundup = game
            .news
            .iter()
            .find(|article| article.id == "roundup_md4")
            .unwrap();
        assert_eq!(roundup.category, NewsCategory::LeagueRoundup);
        assert!(roundup.body.contains("Alpha FC 2 - 1 Beta FC"));
        assert!(!roundup.body.contains("Gamma FC"));

        let standings = game
            .news
            .iter()
            .find(|article| article.id == "standings_md4")
            .unwrap();
        assert_eq!(standings.category, NewsCategory::StandingsUpdate);
        assert!(standings.body.contains("Alpha FC sit at the top"));
    }

    #[test]
    fn generate_matchday_news_does_nothing_when_today_has_no_completed_fixtures() {
        let mut game = make_game("2025-08-12", FixtureStatus::Scheduled);

        generate_matchday_news(&mut game, "2025-08-12");

        assert!(game.news.is_empty());
    }

    #[test]
    fn generate_matchday_news_does_not_duplicate_articles_on_repeat_calls() {
        let mut game = make_game("2025-08-12", FixtureStatus::Completed);

        generate_matchday_news(&mut game, "2025-08-12");
        generate_matchday_news(&mut game, "2025-08-12");

        assert_eq!(game.news.len(), 2);
        assert_eq!(
            game.news
                .iter()
                .filter(|article| article.id == "roundup_md4")
                .count(),
            1
        );
        assert_eq!(
            game.news
                .iter()
                .filter(|article| article.id == "standings_md4")
                .count(),
            1
        );
    }

    #[test]
    #[ignore = "legacy: match scorer data format changed in LoL migration (see #92)"]
    fn generate_match_news_resolves_known_names_and_falls_back_to_scorer_ids() {
        let mut game = make_game("2025-08-12", FixtureStatus::Completed);
        game.players = vec![make_player("p1", "Alice", "team1")];

        let report = make_report(
            vec![
                KillDetail {
                    minute: 10,
                    killer_id: "p1".to_string(),
                    victim_id: None,
                    assist_id: None,
                    side: Side::Home,
                },
                KillDetail {
                    minute: 74,
                    killer_id: "ghost9".to_string(),
                    victim_id: None,
                    assist_id: None,
                    side: Side::Away,
                },
            ],
            1,
            1,
        );

        generate_match_news(&mut game, 0, "team1", "team2", &report);

        assert_eq!(game.news.len(), 1);

        let article = &game.news[0];
        assert_eq!(article.id, "report_fx1");
        assert_eq!(article.category, NewsCategory::MatchReport);
        assert_eq!(
            article.team_ids,
            vec!["team1".to_string(), "team2".to_string()]
        );
        assert_eq!(
            article.player_ids,
            vec!["Alice".to_string(), "ghost9".to_string()]
        );
        assert_eq!(
            article.match_score.as_ref().map(|score| (
                score.home_team_id.as_str(),
                score.away_team_id.as_str(),
                score.home_goals,
                score.away_goals,
            )),
            Some(("team1", "team2", 1, 1))
        );
        assert_eq!(
            article.i18n_params.get("scorers"),
            Some(&"Alice (10', Alpha FC), ghost9 (74', Beta FC)".to_string())
        );
    }

    #[test]
    fn generate_match_news_does_not_duplicate_existing_report_article() {
        let mut game = make_game("2025-08-12", FixtureStatus::Completed);
        let report = make_report(vec![], 0, 0);

        generate_match_news(&mut game, 0, "team1", "team2", &report);
        generate_match_news(&mut game, 0, "team1", "team2", &report);

        assert_eq!(game.news.len(), 1);
        assert_eq!(
            game.news
                .iter()
                .filter(|article| article.id == "report_fx1")
                .count(),
            1
        );
    }

    #[test]
    fn generate_pre_match_messages_adds_preview_metadata_for_user_fixture_three_days_ahead() {
        let mut game = make_game("2025-08-15", FixtureStatus::Scheduled);

        generate_pre_match_messages(&mut game, "2025-08-12");

        assert_eq!(game.messages.len(), 1);

        let message = &game.messages[0];
        assert_eq!(message.id, "prematch_fx1");
        assert_eq!(message.category, MessageCategory::MatchPreview);
        assert_eq!(message.priority, MessagePriority::Normal);
        assert!(message.subject.contains("Beta FC"));
        assert!(message.subject.contains("(H)"));
        assert_eq!(message.context.fixture_id.as_deref(), Some("fx1"));
        assert_eq!(message.context.team_id.as_deref(), Some("team2"));
        assert_eq!(message.i18n_params.get("venue"), Some(&"be.msg.preMatch.venue.home".to_string()));
        assert_eq!(
            message.i18n_params.get("opponent"),
            Some(&"Beta FC".to_string())
        );
        assert_eq!(
            message.i18n_params.get("matchDate"),
            Some(&"2025-08-15".to_string())
        );
        assert_eq!(message.i18n_params.get("matchday"), Some(&"4".to_string()));
    }

    #[test]
    fn generate_pre_match_messages_skips_fixtures_without_user_team() {
        let mut game = make_game("2025-08-15", FixtureStatus::Scheduled);
        let fixture = &mut game.active_league_mut().unwrap().fixtures[0];
        fixture.home_team_id = "team2".to_string();
        fixture.away_team_id = "team3".to_string();

        generate_pre_match_messages(&mut game, "2025-08-12");

        assert!(game.messages.is_empty());
    }

    #[test]
    fn generate_pre_match_messages_does_not_duplicate_same_fixture() {
        let mut game = make_game("2025-08-15", FixtureStatus::Scheduled);

        generate_pre_match_messages(&mut game, "2025-08-12");
        generate_pre_match_messages(&mut game, "2025-08-12");

        assert_eq!(game.messages.len(), 1);
        assert_eq!(
            game.messages
                .iter()
                .filter(|message| message.id == "prematch_fx1")
                .count(),
            1
        );
    }

    #[test]
    fn generate_weekly_digest_news_only_runs_on_monday_cadence() {
        let mut game = make_game("2025-08-12", FixtureStatus::Completed);

        generate_weekly_digest_news(&mut game, "2025-08-12");

        assert!(
            game.news
                .iter()
                .all(|article| !article.id.starts_with("weekly_digest_"))
        );

        set_current_date(&mut game, 2025, 8, 11);
        generate_weekly_digest_news(&mut game, "2025-08-11");

        assert!(
            game.news
                .iter()
                .any(|article| article.id.starts_with("weekly_digest_"))
        );
    }

    #[test]
    fn generate_weekly_digest_news_skips_preseason_even_on_monday() {
        let mut game = make_game("2025-08-11", FixtureStatus::Scheduled);
        set_current_date(&mut game, 2025, 8, 11);
        reset_to_preseason(&mut game);

        generate_weekly_digest_news(&mut game, "2025-08-11");

        assert!(
            game.news
                .iter()
                .all(|article| !article.id.starts_with("weekly_digest_"))
        );
        assert!(
            game.news
                .iter()
                .all(|article| !article.id.starts_with("storyline_"))
        );
    }

    #[test]
    fn generate_weekly_digest_news_creates_storylines_from_standings_and_form() {
        let mut game = make_game("2025-08-11", FixtureStatus::Completed);
        set_current_date(&mut game, 2025, 8, 11);

        let alpha = standing_mut(&mut game, "team1");
        alpha.played = 10;
        alpha.points = 25;
        alpha.maps_won = 18;
        alpha.maps_lost = 8;

        let beta = standing_mut(&mut game, "team2");
        beta.played = 10;
        beta.points = 24;
        beta.maps_won = 16;
        beta.maps_lost = 9;

        let gamma = standing_mut(&mut game, "team3");
        gamma.played = 10;
        gamma.points = 7;
        gamma.maps_won = 6;
        gamma.maps_lost = 15;

        team_mut(&mut game, "team1").form = vec![
            "D".to_string(),
            "W".to_string(),
            "W".to_string(),
            "W".to_string(),
            "W".to_string(),
        ];

        generate_weekly_digest_news(&mut game, "2025-08-11");

        let weekly_digest = game
            .news
            .iter()
            .find(|article| article.id.starts_with("weekly_digest_"))
            .unwrap();
        assert_eq!(weekly_digest.category, NewsCategory::Editorial);
        assert_eq!(
            weekly_digest.headline_key.as_deref(),
            Some("be.news.weeklyDigest.headline")
        );
        assert_eq!(
            weekly_digest.i18n_params.get("weekStart"),
            Some(&"2025-08-11".to_string())
        );
        assert!(!weekly_digest.i18n_params.contains_key("weekLabel"));

        let title_race = game
            .news
            .iter()
            .find(|article| article.id.starts_with("storyline_title_race_"))
            .unwrap();
        assert_eq!(title_race.category, NewsCategory::Editorial);
        assert_eq!(
            title_race.headline_key.as_deref(),
            Some("be.news.storyline.titleRace.headline")
        );
        assert_eq!(
            title_race.body_key.as_deref(),
            Some("be.news.storyline.titleRace.body")
        );
        assert_eq!(
            title_race.i18n_params.get("leader"),
            Some(&"Alpha FC".to_string())
        );
        assert_eq!(
            title_race.i18n_params.get("challenger"),
            Some(&"Beta FC".to_string())
        );
        assert_eq!(title_race.i18n_params.get("gap"), Some(&"1".to_string()));

        let unbeaten = game
            .news
            .iter()
            .find(|article| article.id.starts_with("storyline_unbeaten_streak_"))
            .unwrap();
        assert_eq!(unbeaten.category, NewsCategory::Editorial);
        assert_eq!(
            unbeaten.headline_key.as_deref(),
            Some("be.news.storyline.unbeatenStreak.headline")
        );
        assert_eq!(
            unbeaten.body_key.as_deref(),
            Some("be.news.storyline.unbeatenStreak.body")
        );
        assert_eq!(
            unbeaten.i18n_params.get("team"),
            Some(&"Alpha FC".to_string())
        );
        assert_eq!(
            unbeaten.i18n_params.get("runLength"),
            Some(&"5".to_string())
        );
    }

    #[test]
    fn generate_weekly_digest_news_does_not_duplicate_same_week() {
        let mut game = make_game("2025-08-11", FixtureStatus::Completed);
        set_current_date(&mut game, 2025, 8, 11);

        generate_weekly_digest_news(&mut game, "2025-08-11");
        generate_weekly_digest_news(&mut game, "2025-08-11");

        assert_eq!(
            game.news
                .iter()
                .filter(|article| article.id.starts_with("weekly_digest_"))
                .count(),
            1
        );
    }

    #[test]
    fn generate_weekly_digest_news_does_not_repeat_identical_storylines_in_later_weeks() {
        let mut game = make_game("2025-08-11", FixtureStatus::Completed);
        set_current_date(&mut game, 2025, 8, 11);

        let alpha = standing_mut(&mut game, "team1");
        alpha.played = 10;
        alpha.points = 25;
        alpha.maps_won = 18;
        alpha.maps_lost = 8;

        let beta = standing_mut(&mut game, "team2");
        beta.played = 10;
        beta.points = 24;
        beta.maps_won = 16;
        beta.maps_lost = 9;

        let gamma = standing_mut(&mut game, "team3");
        gamma.played = 10;
        gamma.points = 7;
        gamma.maps_won = 6;
        gamma.maps_lost = 15;

        team_mut(&mut game, "team1").form = vec![
            "D".to_string(),
            "W".to_string(),
            "W".to_string(),
            "W".to_string(),
            "W".to_string(),
        ];

        generate_weekly_digest_news(&mut game, "2025-08-11");

        set_current_date(&mut game, 2025, 8, 18);
        generate_weekly_digest_news(&mut game, "2025-08-18");

        assert_eq!(
            game.news
                .iter()
                .filter(|article| article.id.starts_with("weekly_digest_"))
                .count(),
            2
        );
        assert_eq!(
            game.news
                .iter()
                .filter(|article| article.id.starts_with("storyline_title_race_"))
                .count(),
            1
        );
        assert_eq!(
            game.news
                .iter()
                .filter(|article| article.id.starts_with("storyline_unbeaten_streak_"))
                .count(),
            1
        );
    }

    // -----------------------------------------------------------------------
    // AI Transfer News tests
    // -----------------------------------------------------------------------

    fn make_transfer_entry(
        id: &str,
        player_id: &str,
        from_team_id: &str,
        to_team_id: &str,
        is_user_involved: bool,
        intent: Option<&str>,
    ) -> TransferHistoryEntry {
        TransferHistoryEntry {
            id: id.to_string(),
            player_id: player_id.to_string(),
            player_name: String::new(),
            player_ovr: 75,
            player_position: String::new(),
            player_profile_image_url: None,
            from_team_id: from_team_id.to_string(),
            from_team_name: String::new(),
            to_team_id: to_team_id.to_string(),
            to_team_name: String::new(),
            fee: 0,
            annual_wage: 50_000,
            contract_years: 2,
            date: "2025-08-12".to_string(),
            is_user_involved,
            is_user_buying: false,
            was_negotiated: false,
            initial_offer_fee: None,
            negotiation_rounds: 0,
            included_players: vec![],
            intent: intent.map(str::to_string),
        }
    }

    #[test]
    fn generate_ai_transfer_news_creates_article_for_ai_free_agent_signing() {
        let mut game = make_game("2025-08-12", FixtureStatus::Completed);
        game.transfer_history
            .entries
            .push(make_transfer_entry("th1", "p1", "", "team2", false, None));
        // Add a player and team for name resolution
        game.players.push(make_player("p1", "Alice", "team2"));
        game.teams.push(make_team("team2", "Beta FC"));

        generate_ai_transfer_news(&mut game);

        assert_eq!(game.news.len(), 1);
        let article = &game.news[0];
        assert!(article.id.starts_with("ai_fa_signed_p1_"));
        assert_eq!(article.category, NewsCategory::TransferRumour);
        assert_eq!(
            article.headline_key.as_deref(),
            Some("be.news.freeAgentSigned.headline")
        );
        assert_eq!(
            article.body_key.as_deref(),
            Some("be.news.freeAgentSigned.body")
        );
        assert_eq!(
            article.source_key.as_deref(),
            Some("be.source.leagueChronicle")
        );
        assert_eq!(article.team_ids, vec!["team2".to_string()]);
        assert_eq!(article.player_ids, vec!["p1".to_string()]);
        assert_eq!(
            article.i18n_params.get("player"),
            Some(&"Alice".to_string())
        );
        assert_eq!(
            article.i18n_params.get("team"),
            Some(&"Beta FC".to_string())
        );
        assert_eq!(article.i18n_params.get("years"), Some(&"2".to_string()));
        assert_eq!(article.i18n_params.get("wage"), Some(&"50000".to_string()));
    }

    #[test]
    fn generate_ai_transfer_news_skips_user_team_signing() {
        let mut game = make_game("2025-08-12", FixtureStatus::Completed);
        game.transfer_history
            .entries
            .push(make_transfer_entry("th1", "p1", "", "team1", true, None));

        game.players.push(make_player("p1", "Alice", "team1"));

        generate_ai_transfer_news(&mut game);

        assert!(game.news.is_empty());
    }

    #[test]
    fn generate_ai_transfer_news_skips_club_to_club_transfer() {
        let mut game = make_game("2025-08-12", FixtureStatus::Completed);
        game.transfer_history.entries.push(make_transfer_entry(
            "th1", "p1", "team3", "team2", false, None,
        ));

        game.players.push(make_player("p1", "Alice", "team2"));

        generate_ai_transfer_news(&mut game);

        assert!(game.news.is_empty());
    }

    #[test]
    fn generate_ai_transfer_news_deduplicates_on_repeat_call() {
        let mut game = make_game("2025-08-12", FixtureStatus::Completed);
        game.transfer_history
            .entries
            .push(make_transfer_entry("th1", "p1", "", "team2", false, None));
        game.players.push(make_player("p1", "Alice", "team2"));
        game.teams.push(make_team("team2", "Beta FC"));

        generate_ai_transfer_news(&mut game);
        generate_ai_transfer_news(&mut game);

        assert_eq!(game.news.len(), 1);
    }

    #[test]
    fn generate_ai_transfer_news_handles_multiple_signings() {
        let mut game = make_game("2025-08-12", FixtureStatus::Completed);
        game.transfer_history
            .entries
            .push(make_transfer_entry("th1", "p1", "", "team2", false, None));
        game.transfer_history
            .entries
            .push(make_transfer_entry("th2", "p2", "", "team3", false, None));
        game.transfer_history
            .entries
            .push(make_transfer_entry("th3", "p3", "", "team2", false, None));
        game.players.push(make_player("p1", "Alice", "team2"));
        game.players.push(make_player("p2", "Bob", "team3"));
        game.players.push(make_player("p3", "Carol", "team2"));
        game.teams.push(make_team("team2", "Beta FC"));
        game.teams.push(make_team("team3", "Gamma FC"));

        generate_ai_transfer_news(&mut game);

        assert_eq!(game.news.len(), 3);
        let ids: Vec<&str> = game.news.iter().map(|a| a.id.as_str()).collect();
        assert!(ids.iter().any(|id| id.starts_with("ai_fa_signed_p1_")));
        assert!(ids.iter().any(|id| id.starts_with("ai_fa_signed_p2_")));
        assert!(ids.iter().any(|id| id.starts_with("ai_fa_signed_p3_")));
    }
}
