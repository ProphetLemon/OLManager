//! Headless measurement (ignored): what happens to the AI players whose contract ends
//! while a real new game is played on.
//!
//! The world is played day by day through `turn::process_day`, and the production season
//! rollover (`advance_season`) runs whenever the user's league completes, exactly as the
//! app does after the user's confirmation. Every AI main-team starter whose contract ends
//! inside the stretch is followed to the end of it and classified as renewed (same club,
//! later end), released (no club) or re-signed elsewhere.
//!
//! ```text
//! OLM_MEASURE_UNTIL=2028-12-20 \
//!   cargo test --release -p openleaguemanager --lib -- --ignored \
//!   ai_renewals_measure --nocapture
//! ```

use std::collections::HashMap;

use chrono::NaiveDate;
use olm_core::ai_team_agent::{renewal_score, retention_score};
use olm_core::contract_wage_policy::renewal_wage_policy_allows;
use olm_core::contracts::{contract_warning_stage, expected_wage, ContractWarningStage};
use olm_core::domain::league::{FixtureStatus, LeagueKind};
use olm_core::domain::player::{Player, RenewalSessionStatus};
use olm_core::domain::team::{Team, TeamKind};
use olm_core::game::Game;
use olm_core::{end_of_season, season_rollover, turn};

use super::ai_market_counters::{generated_starter_slots, MarketCounters};
use super::ai_repair_counters::{generated_by_reason, RepairCounters};
use super::world_progression_measure::build_start_world;

/// Where an AI starter with an ending contract stands at the end of the stretch.
#[derive(Debug, Default, PartialEq, Eq)]
pub(super) struct RenewalOutcomes {
    pub(super) total: u32,
    pub(super) renewed: u32,
    pub(super) released: u32,
    pub(super) resigned_elsewhere: u32,
}

struct Tracked {
    team_id: String,
    contract_end: String,
    starter: bool,
    /// His club plays in a main league, so the roster repair refills it.
    repaired_club: bool,
    /// What the player looked like on the first day his contract was in its final weeks.
    final_weeks: Option<FinalWeeks>,
}

/// Snapshot of a tracked player when his contract enters its final weeks.
struct FinalWeeks {
    user_league: bool,
    starter: bool,
    avg_rating: f32,
    appearances: u32,
    lol_ovr: u8,
    /// The score `evaluate_renewals` decides on (no contract-security term).
    score: f64,
    /// The retention score with the contract-security term, for comparison.
    retention: f64,
    /// For an open session: what the club's answer is going to be.
    conclusion: Option<&'static str>,
    /// Why `evaluate_renewals` would not open a session for him (or the session he has).
    reason: String,
}

// Mirrors of the private thresholds in `ai_team_agent::evaluate_renewals`.
const UNDERPERFORMER_RATING: f32 = 6.0;
const UNDERPERFORMER_OVR: u8 = 65;
const WAGE_SOFT_CAP_MULTIPLIER: f64 = 1.10;
const RENEWAL_THRESHOLD: f64 = 0.70;
const HIGH_PERFORMER_RATING: f32 = 7.5;
const HIGH_PERFORMER_OVR: u8 = 80;

/// The stored `lol_ovr` is 0 until something computes it; `evaluate_renewals` derives it then.
fn effective_ovr(player: &Player) -> u8 {
    match player.lol_ovr {
        0 => olm_core::potential::calculate_lol_ovr(player),
        stored => stored,
    }
}

/// The first check of `evaluate_renewals`, in its own order, that rejects `player`.
fn skip_reason(game: &Game, team: &Team, player: &Player) -> String {
    if let Some(state) = player.morale_core.renewal_state.as_ref() {
        return format!("session already {:?}", state.status);
    }
    // Players no match ever rated have no rating data: it is not held against them.
    let rated = player.stats.appearances > 0 || player.stats.avg_rating > 0.0;
    if rated && player.stats.avg_rating < UNDERPERFORMER_RATING {
        return "avg_rating below 6.0".to_string();
    }
    if effective_ovr(player) < UNDERPERFORMER_OVR {
        return "lol_ovr below 65".to_string();
    }
    if player.wage == 0 {
        return "wage 0".to_string();
    }
    let today = game.clock.current_date.date_naive();
    let soft_cap = (team.wage_budget as f64 * WAGE_SOFT_CAP_MULTIPLIER) as i64;
    let bill: i64 = game
        .players
        .iter()
        .filter(|p| p.team_id.as_deref() == Some(team.id.as_str()))
        .map(|p| i64::from(p.wage))
        .sum();
    let projected = (f64::from(player.wage) * 1.10) as i64;
    if bill - i64::from(player.wage) + projected > soft_cap {
        return "soft cap".to_string();
    }
    let high_performer = player.stats.avg_rating > HIGH_PERFORMER_RATING
        && effective_ovr(player) > HIGH_PERFORMER_OVR;
    if renewal_score(player, team, today) < RENEWAL_THRESHOLD && !high_performer {
        return "score below 0.70".to_string();
    }
    "would be offered".to_string()
}

/// What `conclude_ai_renewals` will do with the open session of `player` today.
fn conclusion_preview(game: &Game, team: &Team, player: &Player) -> &'static str {
    if player.transfer_listed {
        return "transfer-listed";
    }
    let today = game.clock.current_date.date_naive();
    let wage = expected_wage(player, team, today);
    if renewal_wage_policy_allows(game, team, player.wage, wage) {
        "renewable"
    } else {
        "wage policy refuses"
    }
}

/// Records the final-weeks snapshot of every tracked player who just entered that stage.
fn snapshot_final_weeks(game: &Game, tracked: &mut HashMap<String, Tracked>) {
    let today = game.clock.current_date.date_naive();
    let user_competition = game
        .manager
        .team_id
        .as_deref()
        .and_then(|id| game.teams.iter().find(|t| t.id == id))
        .and_then(|t| t.competition_id.as_deref());
    for player in &game.players {
        let Some(entry) = tracked.get_mut(&player.id) else {
            continue;
        };
        if entry.final_weeks.is_some()
            || player.team_id.as_deref() != Some(entry.team_id.as_str())
            || player.contract_end.as_deref() != Some(entry.contract_end.as_str())
            || contract_warning_stage(player.contract_end.as_deref(), today)
                != Some(ContractWarningStage::FinalWeeks)
        {
            continue;
        }
        let Some(team) = game.teams.iter().find(|t| t.id == entry.team_id) else {
            continue;
        };
        entry.final_weeks = Some(FinalWeeks {
            starter: entry.starter,
            user_league: user_competition.is_some()
                && team.competition_id.as_deref() == user_competition,
            avg_rating: player.stats.avg_rating,
            appearances: player.stats.appearances,
            lol_ovr: effective_ovr(player),
            score: renewal_score(player, team, today),
            retention: retention_score(player, team, today),
            conclusion: player
                .morale_core
                .renewal_state
                .as_ref()
                .filter(|state| state.status == RenewalSessionStatus::Open)
                .map(|_| conclusion_preview(game, team, player)),
            reason: skip_reason(game, team, player),
        });
    }
}

/// Same test as the roster repair uses to decide whether it looks after a club.
fn in_main_league(game: &Game, team_id: &str) -> bool {
    game.leagues.iter().any(|league| {
        league.league_kind == LeagueKind::Main
            && league
                .standings
                .iter()
                .any(|entry| entry.team_id == team_id)
    })
}

/// AI main-team players whose contract ends on or before `horizon`, keyed by player id.
/// A starter is the best player of his role in his club: lineups of AI clubs are only
/// filled by the rotation once the season runs, so the roster stands in for them.
fn expiring_ai_players(game: &Game, horizon: NaiveDate) -> HashMap<String, Tracked> {
    let user = game.manager.team_id.as_deref();
    let mut tracked = HashMap::new();
    for team in game.teams.iter().filter(|t| {
        t.team_kind == TeamKind::Main && t.manager_id.is_none() && user != Some(t.id.as_str())
    }) {
        let mut best: HashMap<_, (&str, u8)> = HashMap::new();
        let squad: Vec<_> = game
            .players
            .iter()
            .filter(|p| p.team_id.as_deref() == Some(team.id.as_str()))
            .collect();
        for player in &squad {
            let entry = best
                .entry(player.natural_position)
                .or_insert((player.id.as_str(), effective_ovr(player)));
            if effective_ovr(player) > entry.1 {
                *entry = (player.id.as_str(), effective_ovr(player));
            }
        }
        for player in squad {
            let Some(end) = player.contract_end.as_deref() else {
                continue;
            };
            let Ok(end_date) = NaiveDate::parse_from_str(end, "%Y-%m-%d") else {
                continue;
            };
            if end_date <= horizon {
                tracked.insert(
                    player.id.clone(),
                    Tracked {
                        team_id: team.id.clone(),
                        contract_end: end.to_string(),
                        starter: best
                            .get(&player.natural_position)
                            .is_some_and(|(id, _)| *id == player.id),
                        repaired_club: in_main_league(game, &team.id),
                        final_weeks: None,
                    },
                );
            }
        }
    }
    tracked
}

fn classify(
    game: &Game,
    tracked: &HashMap<String, Tracked>,
    keep: impl Fn(&Tracked) -> bool,
) -> RenewalOutcomes {
    let mut outcomes = RenewalOutcomes::default();
    for (id, before) in tracked.iter().filter(|(_, t)| keep(t)) {
        let Some(player) = game.players.iter().find(|p| &p.id == id) else {
            continue;
        };
        outcomes.total += 1;
        match player.team_id.as_deref() {
            None => outcomes.released += 1,
            Some(team) if team == before.team_id => {
                if player.contract_end.as_deref() > Some(before.contract_end.as_str()) {
                    outcomes.renewed += 1;
                } else {
                    outcomes.released += 1;
                }
            }
            Some(_) => outcomes.resigned_elsewhere += 1,
        }
    }
    outcomes
}

/// Renewal-session status of every tracked player who is still on his old club or gone,
/// as `status=count` pairs.
fn session_states(game: &Game, tracked: &HashMap<String, Tracked>) -> String {
    let mut counts: HashMap<String, u32> = HashMap::new();
    for id in tracked.keys() {
        if let Some(player) = game.players.iter().find(|p| &p.id == id) {
            let label = player
                .morale_core
                .renewal_state
                .as_ref()
                .map_or("none".to_string(), |s| format!("{:?}", s.status));
            *counts.entry(label).or_default() += 1;
        }
    }
    let mut pairs: Vec<_> = counts.into_iter().collect();
    pairs.sort();
    format!("{pairs:?}")
}

fn open_ai_sessions(game: &Game) -> usize {
    let user = game.manager.team_id.as_deref();
    game.players
        .iter()
        .filter(|p| p.team_id.is_some() && p.team_id.as_deref() != user)
        .filter(|p| {
            p.morale_core
                .renewal_state
                .as_ref()
                .is_some_and(|s| s.status == RenewalSessionStatus::Open)
        })
        .count()
}

/// Club changes seen day by day over the whole stretch.
#[derive(Debug, Default)]
pub(super) struct Movement {
    pub(super) club_to_club: u32,
    pub(super) released: u32,
    pub(super) signed_from_free: u32,
}

/// Adds the club changes between two daily snapshots to `movement`.
fn count_moves(
    before: &HashMap<String, Option<String>>,
    after: &HashMap<String, Option<String>>,
    movement: &mut Movement,
) {
    for (id, team) in after {
        match (before.get(id), team) {
            (Some(Some(a)), Some(b)) if a != b => movement.club_to_club += 1,
            (Some(Some(_)), None) => movement.released += 1,
            (Some(None), Some(_)) => movement.signed_from_free += 1,
            _ => {}
        }
    }
}

fn team_of_each_player(game: &Game) -> HashMap<String, Option<String>> {
    game.players
        .iter()
        .map(|p| (p.id.clone(), p.team_id.clone()))
        .collect()
}

/// AI main-team starting slots (best `lol_ovr` per role per club) held by generated
/// emergency players, out of all AI slots.
fn generated_starters(game: &Game) -> (u32, u32) {
    let user = game.manager.team_id.as_deref();
    let (mut generated, mut slots) = (0, 0);
    for team in game.teams.iter().filter(|t| {
        t.team_kind == TeamKind::Main && t.manager_id.is_none() && user != Some(t.id.as_str())
    }) {
        let mut best: HashMap<_, &Player> = HashMap::new();
        for player in game
            .players
            .iter()
            .filter(|p| p.team_id.as_deref() == Some(team.id.as_str()))
        {
            let entry = best.entry(player.natural_position).or_insert(player);
            if effective_ovr(player) > effective_ovr(entry) {
                *entry = player;
            }
        }
        slots += best.len() as u32;
        generated += best
            .values()
            .filter(|p| p.id.starts_with("emergency-"))
            .count() as u32;
    }
    (generated, slots)
}

/// Players on a club whose stored `lol_ovr` is 0, i.e. never computed or never refreshed.
fn clubbed_players_without_ovr(game: &Game) -> (usize, usize) {
    let clubbed: Vec<_> = game
        .players
        .iter()
        .filter(|p| p.team_id.is_some())
        .collect();
    (
        clubbed.iter().filter(|p| p.lol_ovr == 0).count(),
        clubbed.len(),
    )
}

/// Players on a club whose stored `lol_ovr` no longer matches their attributes: nothing
/// refreshes the field during a session, only a load does.
fn clubbed_players_with_stale_ovr(game: &Game) -> (usize, usize) {
    let clubbed: Vec<_> = game
        .players
        .iter()
        .filter(|p| p.team_id.is_some())
        .collect();
    (
        clubbed
            .iter()
            .filter(|p| p.lol_ovr != olm_core::potential::calculate_lol_ovr(p))
            .count(),
        clubbed.len(),
    )
}

/// AI main teams with at least five players, and all AI main teams.
fn staffed_ai_teams(game: &Game) -> (usize, usize) {
    let user = game.manager.team_id.as_deref();
    let teams: Vec<_> = game
        .teams
        .iter()
        .filter(|t| {
            t.team_kind == TeamKind::Main && t.manager_id.is_none() && user != Some(t.id.as_str())
        })
        .collect();
    let staffed = teams
        .iter()
        .filter(|t| {
            game.players
                .iter()
                .filter(|p| p.team_id.as_deref() == Some(t.id.as_str()))
                .count()
                >= 5
        })
        .count();
    (staffed, teams.len())
}

/// AI main teams with fewer than five players at the end, by the competitions they appear in.
#[derive(Debug, Default)]
struct Understaffed {
    total: u32,
    in_main_league_standings: u32,
    in_main_league_fixtures: u32,
    in_any_league: u32,
    /// Appears in a league that has a fixture scheduled after the window end.
    fixtures_after_window: u32,
    kinds: Vec<(String, u32)>,
}

fn understaffed_with_fixtures(game: &Game, until: NaiveDate) -> Understaffed {
    let user = game.manager.team_id.as_deref();
    let until = until.format("%Y-%m-%d").to_string();
    let mut out = Understaffed::default();
    let mut kinds: HashMap<String, u32> = HashMap::new();
    for team in game.teams.iter().filter(|t| {
        t.team_kind == TeamKind::Main && t.manager_id.is_none() && user != Some(t.id.as_str())
    }) {
        let players = game
            .players
            .iter()
            .filter(|p| p.team_id.as_deref() == Some(team.id.as_str()))
            .count();
        if players >= 5 {
            continue;
        }
        out.total += 1;
        let in_standings =
            |l: &olm_core::domain::league::League| l.standings.iter().any(|e| e.team_id == team.id);
        let in_fixtures = |l: &olm_core::domain::league::League| {
            l.fixtures
                .iter()
                .any(|f| f.home_team_id == team.id || f.away_team_id == team.id)
        };
        let main_standings = game
            .leagues
            .iter()
            .any(|l| l.league_kind == LeagueKind::Main && in_standings(l));
        let main_fixtures = game
            .leagues
            .iter()
            .any(|l| l.league_kind == LeagueKind::Main && in_fixtures(l));
        let any = game
            .leagues
            .iter()
            .any(|l| in_standings(l) || in_fixtures(l));
        let after = game.leagues.iter().any(|l| {
            (in_standings(l) || in_fixtures(l))
                && l.fixtures.iter().any(|f| {
                    f.status == FixtureStatus::Scheduled && f.date.as_str() > until.as_str()
                })
        });
        out.in_main_league_standings += u32::from(main_standings);
        out.in_main_league_fixtures += u32::from(main_fixtures);
        out.in_any_league += u32::from(any);
        out.fixtures_after_window += u32::from(after);
        let kind = game
            .leagues
            .iter()
            .find(|l| in_standings(l) || in_fixtures(l))
            .map_or("no league".to_string(), |l| format!("{:?}", l.league_kind));
        *kinds.entry(kind).or_default() += 1;
    }
    out.kinds = kinds.into_iter().collect();
    out.kinds.sort();
    out
}

/// Everything one run prints.
struct Measurement {
    starters: RenewalOutcomes,
    everyone: RenewalOutcomes,
    repaired_starters: RenewalOutcomes,
    movement: Movement,
    /// Moves made by the contract-expiry step (release, then the repair's signings).
    repair_movement: Movement,
    market: MarketCounters,
    understaffed_with_fixtures: Understaffed,
    rollovers: u32,
    peak_open: usize,
    session_states: String,
    generated_at_start: (u32, u32),
    generated_at_end: (u32, u32),
    no_ovr_at_start: (usize, usize),
    no_ovr_at_end: (usize, usize),
    stale_ovr_at_end: (usize, usize),
    staffed_at_start: (usize, usize),
    staffed_at_end: (usize, usize),
    /// Starters that were not renewed: teamless, on another club, other.
    starter_whereabouts: [u32; 3],
    tracked: HashMap<String, Tracked>,
    repair: RepairCounters,
    generated_by_reason: std::collections::BTreeMap<String, u32>,
    generated_by_reason_at_start: std::collections::BTreeMap<String, u32>,
    players: usize,
    refresh_micros: f64,
}

/// Plays a fresh world until `until`, rolling the season whenever the league completes.
fn measure(until: NaiveDate) -> Measurement {
    let mut game = build_start_world();
    println!(
        "world starts {}",
        game.clock.current_date.format("%Y-%m-%d")
    );
    let mut tracked = expiring_ai_players(&game, until);
    let generated_at_start = generated_starters(&game);
    let no_ovr_at_start = clubbed_players_without_ovr(&game);
    let staffed_at_start = staffed_ai_teams(&game);
    let mut movement = Movement::default();
    let mut repair_movement = Movement::default();
    let mut teams = team_of_each_player(&game);
    let mut rollovers = 0;
    let mut peak_open = 0;
    let mut repair = RepairCounters::default();
    let mut market = MarketCounters::default();
    let generated_by_reason_at_start = generated_by_reason(&game);
    while game.clock.current_date.date_naive() < until {
        if end_of_season::is_season_complete(&game) {
            season_rollover::advance_season(&mut game);
            rollovers += 1;
        }
        snapshot_final_weeks(&game, &mut tracked);
        // The expiry step is the repair's own: its moves are counted apart, so the market
        // figures below are the AI transfers and free-agency signings of `process_day`.
        if repair.run_expiry_step(&mut game) {
            let now = team_of_each_player(&game);
            count_moves(&teams, &now, &mut repair_movement);
            teams = now;
        }
        // The state the market acts on: after the expiry step, before the day's AI decisions.
        let generated_slots = generated_starter_slots(&game);
        market.maybe_sample(&game);
        turn::process_day(&mut game);
        peak_open = peak_open.max(open_ai_sessions(&game));
        let now = team_of_each_player(&game);
        count_moves(&teams, &now, &mut movement);
        for (id, team) in &now {
            if let (Some(None), Some(buyer)) = (teams.get(id), team) {
                let player = game.players.iter().find(|p| &p.id == id);
                market.record_signing(&generated_slots, buyer, player);
            }
        }
        teams = now;
    }
    Measurement {
        starters: classify(&game, &tracked, |t| t.starter),
        everyone: classify(&game, &tracked, |_| true),
        repaired_starters: classify(&game, &tracked, |t| t.starter && t.repaired_club),
        movement,
        repair_movement,
        market,
        understaffed_with_fixtures: understaffed_with_fixtures(&game, until),
        rollovers,
        peak_open,
        session_states: session_states(&game, &tracked),
        generated_at_start,
        generated_at_end: generated_starters(&game),
        no_ovr_at_start,
        no_ovr_at_end: clubbed_players_without_ovr(&game),
        stale_ovr_at_end: clubbed_players_with_stale_ovr(&game),
        staffed_at_start,
        staffed_at_end: staffed_ai_teams(&game),
        starter_whereabouts: starter_whereabouts(&game, &tracked),
        tracked,
        repair,
        generated_by_reason: generated_by_reason(&game),
        generated_by_reason_at_start,
        players: game.players.len(),
        refresh_micros: refresh_cost_micros(&game),
    }
}

/// Mean cost of one `refresh_lol_ovrs` over this world, in microseconds.
fn refresh_cost_micros(game: &Game) -> f64 {
    let mut copy = game.clone();
    let runs = 200;
    let started = std::time::Instant::now();
    for _ in 0..runs {
        copy.refresh_lol_ovrs();
        std::hint::black_box(&copy.players);
    }
    started.elapsed().as_secs_f64() * 1e6 / f64::from(runs)
}

/// Where the starters that did not get a later contract at their club stand now.
fn starter_whereabouts(game: &Game, tracked: &HashMap<String, Tracked>) -> [u32; 3] {
    let mut places = [0; 3];
    for (id, before) in tracked.iter().filter(|(_, t)| t.starter) {
        let Some(player) = game.players.iter().find(|p| &p.id == id) else {
            continue;
        };
        match player.team_id.as_deref() {
            None => places[0] += 1,
            Some(team) if team != before.team_id => places[1] += 1,
            Some(_) if player.contract_end.as_deref() <= Some(before.contract_end.as_str()) => {
                places[2] += 1
            }
            Some(_) => {}
        }
    }
    places
}

/// Prints why tracked players had no session in their final weeks and the rating spread.
fn print_final_weeks(tracked: &HashMap<String, Tracked>) {
    let seen: Vec<&FinalWeeks> = tracked
        .values()
        .filter_map(|t| t.final_weeks.as_ref())
        .collect();
    println!("tracked players seen in their final weeks: {}", seen.len());
    for (label, starters_only) in [("all", false), ("starters", true)] {
        let mut reasons: HashMap<&str, u32> = HashMap::new();
        for snapshot in seen.iter().filter(|s| s.starter || !starters_only) {
            *reasons.entry(snapshot.reason.as_str()).or_default() += 1;
        }
        let mut reasons: Vec<_> = reasons.into_iter().collect();
        reasons.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
        println!("  first check that rejected {label} (evaluate_renewals order): {reasons:?}");
    }
    let mut answers: HashMap<&str, u32> = HashMap::new();
    for snapshot in seen.iter().filter_map(|s| s.conclusion) {
        *answers.entry(snapshot).or_default() += 1;
    }
    let mut answers: Vec<_> = answers.into_iter().collect();
    answers.sort();
    println!("  open sessions in the final weeks, the club's answer: {answers:?}");
    let starters: Vec<_> = seen.iter().filter(|s| s.starter).collect();
    let mut ovrs: Vec<u8> = starters.iter().map(|s| s.lol_ovr).collect();
    ovrs.sort_unstable();
    let pct = |p: usize| ovrs.get(ovrs.len().saturating_sub(1) * p / 100).copied();
    println!(
        "  starters lol_ovr p10/p25/p50/p75/p90: {:?}/{:?}/{:?}/{:?}/{:?} | below 65: {}",
        pct(10),
        pct(25),
        pct(50),
        pct(75),
        pct(90),
        ovrs.iter().filter(|o| **o < UNDERPERFORMER_OVR).count()
    );
    for (label, score_of) in [
        (
            "renewal score",
            (|s: &FinalWeeks| s.score) as fn(&FinalWeeks) -> f64,
        ),
        (
            "retention score (with contract security)",
            |s: &FinalWeeks| s.retention,
        ),
    ] {
        let mut scores: Vec<f64> = starters
            .iter()
            .filter(|s| s.lol_ovr >= UNDERPERFORMER_OVR)
            .map(|s| score_of(s))
            .collect();
        scores.sort_by(f64::total_cmp);
        let spct = |p: usize| {
            scores
                .get(scores.len().saturating_sub(1) * p / 100)
                .copied()
        };
        println!(
            "  {label} of starters with lol_ovr >= 65 ({}): p10 {:.2} | p50 {:.2} | p90 {:.2} | max {:.2} | at least 0.70: {} | at least 0.60: {} | at least 0.55: {}",
            scores.len(),
            spct(10).unwrap_or(0.0),
            spct(50).unwrap_or(0.0),
            spct(90).unwrap_or(0.0),
            spct(100).unwrap_or(0.0),
            scores.iter().filter(|s| **s >= 0.70).count(),
            scores.iter().filter(|s| **s >= 0.60).count(),
            scores.iter().filter(|s| **s >= 0.55).count(),
        );
    }
    for (label, user_league) in [("user league", true), ("other leagues", false)] {
        let group: Vec<_> = seen
            .iter()
            .filter(|s| s.user_league == user_league)
            .collect();
        let mut buckets = [0u32; 7];
        for snapshot in &group {
            let bucket = match snapshot.avg_rating {
                r if r <= 0.0 && snapshot.appearances == 0 => 0,
                r if r <= 0.0 => 1,
                r if r < 6.0 => 2,
                r if r < 6.5 => 3,
                r if r < 7.0 => 4,
                r if r < 7.5 => 5,
                _ => 6,
            };
            buckets[bucket] += 1;
        }
        let played = group.iter().filter(|s| s.appearances > 0).count();
        let mean_games =
            group.iter().map(|s| f64::from(s.appearances)).sum::<f64>() / group.len().max(1) as f64;
        println!(
            "  {label} ({}): rating 0 no games {} | 0 with games {} | <6.0 {} | 6.0-6.5 {} | 6.5-7.0 {} | 7.0-7.5 {} | >=7.5 {} | with games {played}, mean games {mean_games:.1}",
            group.len(),
            buckets[0],
            buckets[1],
            buckets[2],
            buckets[3],
            buckets[4],
            buckets[5],
            buckets[6],
        );
    }
}

#[test]
#[ignore = "measurement: plays a season day by day, run it explicitly in release"]
fn ai_renewals_measure() {
    let until = std::env::var("OLM_MEASURE_UNTIL").unwrap_or_else(|_| "2028-12-20".to_string());
    let until = NaiveDate::parse_from_str(&until, "%Y-%m-%d").expect("OLM_MEASURE_UNTIL date");
    let started = std::time::Instant::now();
    let run = measure(until);
    println!(
        "until {until}: season rollovers {}, peak open AI renewal sessions {}",
        run.rollovers, run.peak_open
    );
    for (label, outcomes) in [
        ("starters", &run.starters),
        ("starters of clubs in a main league", &run.repaired_starters),
        ("all players", &run.everyone),
    ] {
        println!(
            "AI {label} with an ending contract: {} | renewed {} | released {} | re-signed elsewhere {}",
            outcomes.total, outcomes.renewed, outcomes.released, outcomes.resigned_elsewhere
        );
    }
    let [teamless, other_club, same_club] = run.starter_whereabouts;
    println!(
        "starters not renewed now: teamless {teamless} | on another club {other_club} | same club, contract not extended {same_club}"
    );
    println!(
        "generated (emergency) players in AI starting slots: start {}/{} | end {}/{}",
        run.generated_at_start.0,
        run.generated_at_start.1,
        run.generated_at_end.0,
        run.generated_at_end.1
    );
    println!(
        "players on a club with lol_ovr 0: start {}/{} | end {}/{}",
        run.no_ovr_at_start.0, run.no_ovr_at_start.1, run.no_ovr_at_end.0, run.no_ovr_at_end.1
    );
    println!(
        "players on a club whose stored lol_ovr differs from their attributes at the end: {}/{}",
        run.stale_ovr_at_end.0, run.stale_ovr_at_end.1
    );
    println!(
        "AI main teams with 5+ players: start {}/{} | end {}/{}",
        run.staffed_at_start.0, run.staffed_at_start.1, run.staffed_at_end.0, run.staffed_at_end.1
    );
    println!(
        "refresh_lol_ovrs: {:.0} us per call over {} players",
        run.refresh_micros, run.players
    );
    println!(
        "generated players by the repair reason in their id: start {:?} | end {:?}",
        run.generated_by_reason_at_start, run.generated_by_reason
    );
    run.repair.print();
    print_final_weeks(&run.tracked);
    println!("session states at the end: {}", run.session_states);
    println!(
        "market (process_day): club-to-club moves {} | released {} | signed from free agency {}",
        run.movement.club_to_club, run.movement.released, run.movement.signed_from_free
    );
    run.market.print();
    println!(
        "AI main teams with fewer than 5 players at the end: {:?}",
        run.understaffed_with_fixtures
    );
    println!(
        "contract-expiry step: released {} | re-signed by another club the same day {} | signed from free agency {}",
        run.repair_movement.released,
        run.repair_movement.club_to_club,
        run.repair_movement.signed_from_free
    );
    println!("wall time {:.1}s", started.elapsed().as_secs_f64());
}
