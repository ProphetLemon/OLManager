//! League-count timing harness: how much a new game, a day, a week and a whole season cost, and
//! how big the save is, for the leagues the build schedules. Run it on a build with 7 playable
//! leagues and on one with 29 and compare the two tables. Every test here is `#[ignore]`d, so a
//! plain `cargo test` never runs it.
//!
//! A game is built the way `select_team` does (see `pool_bench::new_game`) with the user on one
//! club. Segments, all through the production turn loop (`turn::process_day`, and
//! `season_rollover::advance_season` whenever the user's league completes a split or the season):
//! - `build`:  new-game world build and season setup, plus the size of the first save
//! - `quiet`:  one day on which no league plays (days before it are advanced untimed)
//! - `match`:  one day on which the user's own club plays a best-of-3 or longer, with how many leagues played that day
//! - `week`:   the 7 days that follow
//! - `season`: a fresh game played day by day until the user's season ends and rolls over, with
//!   the per-day cost, the rollover cost and the save size afterwards
//!
//! ```text
//! OLM_L3_REPS=3 OLM_L3_SEGMENTS=build,quiet,match,week,season \
//!   cargo test --release --lib l3_league_count_timing -- --ignored --nocapture
//! ```
//!
//! Environment:
//! - `OLM_L3_REPS`     repetitions, the median is reported (default 1)
//! - `OLM_L3_SEGMENTS` comma list of the segments above (default all)
//! - `OLM_L3_TEAM`     scoped id of the user's team (default `lec-g2-esports`)
//! - `OLM_L3_MATCH_MIN`  fewest leagues that must play on the timed match day (default 1)
//! - `OLM_L3_MATCH_BEST_OF` shortest series the user's club must play on the match day (default 3)
//! - `OLM_L3_STEPS`      1 to also time the public pieces of a day on the slow days (profiling)
//! - `OLM_L3_SLOW_MS`    what counts as a slow day for `OLM_L3_STEPS` (default 400)
//! - `OLM_L3_MAX_DAYS` safety cap on the days of the season segment (default 800)

use std::collections::BTreeMap;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::time::Instant;

use olm_core::domain::league::FixtureStatus;
use olm_core::game::Game;
use olm_core::world_overlay::bundled_world_overlay;
use olm_core::{end_of_season, season_rollover, turn};

use crate::pool_bench::{env_usize, init_message_stores, median, new_game, save_bytes};

const WEEK_DAYS: usize = 7;
/// Days played before the day segments, so a one-off first-day cost is not read as a normal day.
const WARMUP_DAYS: usize = 3;

fn elapsed_ms(start: Instant) -> f64 {
    start.elapsed().as_secs_f64() * 1000.0
}

fn load_average() -> String {
    std::fs::read_to_string("/proc/loadavg")
        .map(|text| {
            text.split_whitespace()
                .take(3)
                .collect::<Vec<_>>()
                .join(" ")
        })
        .unwrap_or_else(|_| "n/a".to_string())
}

fn today(game: &Game) -> String {
    game.clock.current_date.format("%Y-%m-%d").to_string()
}

/// What is scheduled today.
struct Playing {
    /// How many leagues have a scheduled fixture.
    leagues: usize,
    /// The user's own league is one of them.
    user_league: bool,
    /// The user's club has a match: the one day type that runs the full match engine for a team
    /// the player manages.
    user_club: bool,
    /// The longest series the user's club plays today (0 when it does not play).
    club_best_of: u8,
}

fn leagues_playing(game: &Game) -> Playing {
    let day = today(game);
    let active = game.active_league_index();
    let club = game.manager.team_id.as_deref();
    let mut playing = Playing {
        leagues: 0,
        user_league: false,
        user_club: false,
        club_best_of: 0,
    };
    for (index, league) in game.leagues.iter().enumerate() {
        let mut plays = false;
        for fixture in &league.fixtures {
            if fixture.date != day || fixture.status != FixtureStatus::Scheduled {
                continue;
            }
            plays = true;
            if index == active
                && club.is_some_and(|c| fixture.home_team_id == c || fixture.away_team_id == c)
            {
                playing.user_club = true;
                playing.club_best_of = playing.club_best_of.max(fixture.best_of);
            }
        }
        if plays {
            playing.leagues += 1;
            playing.user_league |= index == active;
        }
    }
    playing
}

/// One production day, in ms.
fn timed_day(game: &mut Game) -> f64 {
    let start = Instant::now();
    turn::process_day(game);
    elapsed_ms(start)
}

/// Advances untimed until `stop` holds for the day about to be played; false past `limit` days.
fn advance_until(game: &mut Game, limit: usize, stop: impl Fn(&Game) -> bool) -> bool {
    for _ in 0..limit {
        if stop(game) {
            return true;
        }
        turn::process_day(game);
    }
    stop(game)
}

#[derive(Default)]
struct DayRep {
    warmup_ms: Vec<f64>,
    quiet_ms: Option<f64>,
    match_ms: Option<f64>,
    match_day_leagues: usize,
    week_ms: Option<f64>,
    week_match_days: usize,
}

fn day_segments(
    game: &mut Game,
    wanted: &Segments,
    match_min_leagues: usize,
    match_min_best_of: u8,
) -> DayRep {
    let mut rep = DayRep {
        warmup_ms: (0..WARMUP_DAYS).map(|_| timed_day(game)).collect(),
        ..DayRep::default()
    };
    if wanted.quiet {
        if advance_until(game, 400, |g| leagues_playing(g).leagues == 0) {
            rep.quiet_ms = Some(timed_day(game));
        } else {
            println!("L3 no quiet day found in 400 days");
        }
    }
    if wanted.match_day {
        if advance_until(game, 400, |g| {
            let playing = leagues_playing(g);
            playing.club_best_of >= match_min_best_of && playing.leagues >= match_min_leagues
        }) {
            rep.match_day_leagues = leagues_playing(game).leagues;
            rep.match_ms = Some(timed_day(game));
        } else {
            println!(
                "L3 no day in 400 with the user's club and {match_min_leagues} leagues playing"
            );
        }
    }
    if wanted.week {
        let mut total = 0.0;
        for _ in 0..WEEK_DAYS {
            rep.week_match_days += usize::from(leagues_playing(game).leagues > 0);
            total += timed_day(game);
        }
        rep.week_ms = Some(total);
    }
    rep
}

type Step = (&'static str, fn(&mut Game));

/// The public pieces of `turn::process_day`, each runnable alone on a game. The day's matches and
/// the background-league simulation are private to `olm_core`, so they show up as the remainder
/// between these and the whole day.
const STEPS: &[Step] = &[
    ("repair_league", |g| {
        let _ = olm_core::roster_stability::repair_league(
            g,
            olm_core::roster_stability::RosterStabilityReason::BackgroundSimulation,
        );
    }),
    ("process_training (weekday of the day)", |g| {
        let weekday = chrono::Datelike::weekday(&g.clock.current_date).num_days_from_monday();
        olm_core::training::process_training(g, weekday);
    }),
    (
        "conclude_ai_renewals",
        olm_core::ai_renewals::conclude_ai_renewals,
    ),
    (
        "process_contract_expiries",
        olm_core::contracts::process_contract_expiries,
    ),
    (
        "process_monthly_finances",
        olm_core::finances::process_monthly_finances,
    ),
    ("board objectives", |g| {
        olm_core::board_objectives::generate_objectives(g);
        olm_core::board_objectives::update_objective_progress(g);
    }),
    (
        "check_player_events",
        olm_core::player_events::check_player_events,
    ),
    (
        "check_random_events",
        olm_core::random_events::check_random_events,
    ),
    ("process_scouting", olm_core::scouting::process_scouting),
    (
        "generate_incoming_transfer_offers",
        olm_core::transfers::generate_incoming_transfer_offers,
    ),
    (
        "process_ai_team_agents",
        olm_core::ai_team_agent::process_ai_team_agents,
    ),
    ("ai_strategic_recruitment", |g| {
        let ids: Vec<String> = g
            .teams
            .iter()
            .filter(|t| {
                t.team_kind == olm_core::domain::team::TeamKind::Main && t.manager_id.is_none()
            })
            .map(|t| t.id.clone())
            .collect();
        for id in ids {
            olm_core::ai_team_agent::ai_strategic_recruitment(g, &id);
        }
    }),
    (
        "process_ai_player_agents",
        olm_core::ai_player_agent::process_ai_player_agents,
    ),
    (
        "process_potential_research",
        olm_core::potential::process_potential_research,
    ),
    (
        "process_daily_champion_system",
        olm_core::champions::process_daily_champion_system,
    ),
    (
        "rotate_ai_lineups",
        olm_core::ai_rotation::rotate_ai_lineups,
    ),
    (
        "refresh_game_context",
        olm_core::season_context::refresh_game_context,
    ),
    (
        "refresh_import_flags",
        olm_core::residency::refresh_import_flags,
    ),
];

/// Per-step cost on slow days against ordinary days, from clones of the game taken the day before.
#[derive(Default)]
struct StepProfile {
    slow: BTreeMap<&'static str, Vec<f64>>,
    ordinary: BTreeMap<&'static str, Vec<f64>>,
    slow_days: Vec<(String, usize, f64)>,
}

impl StepProfile {
    fn sample(&mut self, before: &Game, slow: bool) {
        let bucket = if slow {
            &mut self.slow
        } else {
            &mut self.ordinary
        };
        for (name, step) in STEPS {
            let mut clone = before.clone();
            let start = Instant::now();
            step(&mut clone);
            bucket.entry(name).or_default().push(elapsed_ms(start));
        }
    }

    fn print(&mut self) {
        println!("L3 steps: slow days {:?}", self.slow_days);
        for (name, _) in STEPS {
            let mean = |map: &BTreeMap<&'static str, Vec<f64>>| {
                map.get(name)
                    .filter(|v| !v.is_empty())
                    .map(|v| v.iter().sum::<f64>() / v.len() as f64)
                    .unwrap_or(0.0)
            };
            println!(
                "L3 step {name:<34} slow-day mean {:>8.1} ms  ordinary-day mean {:>8.1} ms",
                mean(&self.slow),
                mean(&self.ordinary)
            );
        }
    }
}

struct SeasonRep {
    days: u32,
    splits_rolled: u32,
    total_ms: f64,
    rollover_ms: f64,
    day_ms: Vec<f64>,
    /// For each timed day, how many leagues had a fixture and whether the user's club played.
    day_playing: Vec<(usize, bool)>,
    save_bytes: u64,
    finished: bool,
    panic: Option<String>,
    /// (league id, tier, split or season changes observed): a league with 0 never finished one.
    league_rolls: Vec<(String, u8, u32)>,
}

/// Season and split of every league, by position: league ids are not unique (an academy league
/// can share the id of its parent competition).
fn league_marks(game: &Game) -> Vec<(u32, usize)> {
    game.leagues
        .iter()
        .map(|l| (l.season, l.split_index))
        .collect()
}

/// Counts the leagues whose season or split changed. A league created mid-run (an academy league
/// appears at a rollover) has no earlier mark and counts as not rolled.
fn count_rolls(rolls: &mut Vec<u32>, before: &[(u32, usize)], after: &[(u32, usize)]) {
    rolls.resize(rolls.len().max(after.len()), 0);
    for (index, (old, new)) in before.iter().zip(after).enumerate() {
        if old != new {
            rolls[index] += 1;
        }
    }
}

fn season_segment(
    game: &mut Game,
    max_days: usize,
    print_leagues: bool,
    mut profile: Option<&mut StepProfile>,
    slow_ms: f64,
) -> SeasonRep {
    let mut marks = league_marks(game);
    let start_fixtures: Vec<usize> = game.leagues.iter().map(|l| l.fixtures.len()).collect();
    let mut rolls = vec![0u32; marks.len()];
    let mut rep = SeasonRep {
        days: 0,
        splits_rolled: 0,
        total_ms: 0.0,
        rollover_ms: 0.0,
        day_ms: Vec::new(),
        day_playing: Vec::new(),
        save_bytes: 0,
        finished: false,
        panic: None,
        league_rolls: Vec::new(),
    };
    let wall = Instant::now();
    // A panic inside the engine is a result of the run, not a reason to lose the numbers so far.
    let outcome = catch_unwind(AssertUnwindSafe(|| {
        for _ in 0..max_days {
            if end_of_season::is_season_complete(game) {
                let start = Instant::now();
                let advance = season_rollover::advance_season(game);
                rep.rollover_ms += elapsed_ms(start);
                rep.splits_rolled += 1;
                let now = league_marks(game);
                count_rolls(&mut rolls, &marks, &now);
                marks = now;
                if advance.was_season_end {
                    rep.finished = true;
                    break;
                }
            }
            let today_plays = leagues_playing(game);
            let playing = today_plays.leagues;
            rep.day_playing.push((playing, today_plays.user_club));
            let before = profile.as_ref().map(|_| game.clone());
            let date = today(game);
            let ms = timed_day(game);
            rep.day_ms.push(ms);
            if let (Some(profile), Some(before)) = (profile.as_deref_mut(), before) {
                let slow = ms >= slow_ms;
                if slow {
                    profile.slow_days.push((date, playing, ms.round()));
                }
                // Every slow day, one ordinary day in ten: cloning the game 17 times is costly.
                if slow || rep.days.is_multiple_of(10) {
                    profile.sample(&before, slow);
                }
            }
            rep.days += 1;
            let now = league_marks(game);
            count_rolls(&mut rolls, &marks, &now);
            marks = now;
        }
    }));
    if let Err(payload) = outcome {
        rep.panic = Some(
            payload
                .downcast_ref::<&str>()
                .map(|s| (*s).to_string())
                .or_else(|| payload.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "non-string panic payload".to_string()),
        );
    }
    rep.total_ms = elapsed_ms(wall);
    rep.save_bytes = save_bytes(game);
    if print_leagues {
        for (index, l) in game.leagues.iter().enumerate() {
            println!(
                "L3 league {:<22} competition {:<12} tier {} kind {:?} fixtures at start {:>4} rolls {:>2} season {} split {}",
                l.id,
                l.competition_id.as_deref().unwrap_or("-"),
                l.tier,
                l.league_kind,
                start_fixtures.get(index).copied().unwrap_or(0),
                rolls.get(index).copied().unwrap_or(0),
                l.season,
                l.split_index,
            );
        }
    }
    rep.league_rolls = game
        .leagues
        .iter()
        .enumerate()
        .map(|(index, l)| (l.id.clone(), l.tier, rolls.get(index).copied().unwrap_or(0)))
        .collect();
    rep
}

struct Segments {
    build: bool,
    quiet: bool,
    match_day: bool,
    week: bool,
    season: bool,
}

impl Segments {
    fn from_env() -> Self {
        let raw = std::env::var("OLM_L3_SEGMENTS")
            .unwrap_or_else(|_| "build,quiet,match,week,season".to_string());
        let has = |name: &str| raw.split(',').any(|s| s.trim() == name);
        Self {
            build: has("build"),
            quiet: has("quiet"),
            match_day: has("match"),
            week: has("week"),
            season: has("season"),
        }
    }

    fn needs_day_game(&self) -> bool {
        self.quiet || self.match_day || self.week
    }
}

fn spread(label: &str, unit: &str, values: &mut [f64]) {
    if values.is_empty() {
        return;
    }
    let med = median(values);
    println!(
        "L3 {label:<22} median {med:>10.1} {unit}  min {:>10.1}  max {:>10.1}  (n={})",
        values.iter().copied().fold(f64::INFINITY, f64::min),
        values.iter().copied().fold(f64::NEG_INFINITY, f64::max),
        values.len()
    );
}

#[test]
#[ignore = "timing harness; run by hand, see the module docs"]
fn l3_league_count_timing() {
    init_message_stores();
    let reps = env_usize("OLM_L3_REPS", 1).max(1);
    let max_days = env_usize("OLM_L3_MAX_DAYS", 800);
    let match_min = env_usize("OLM_L3_MATCH_MIN", 1);
    let match_best_of = env_usize("OLM_L3_MATCH_BEST_OF", 3) as u8;
    let steps = env_usize("OLM_L3_STEPS", 0) > 0;
    let slow_ms = env_usize("OLM_L3_SLOW_MS", 400) as f64;
    let mut profile = StepProfile::default();
    let mut by_playing: BTreeMap<(bool, usize), Vec<f64>> = BTreeMap::new();
    let team_id = std::env::var("OLM_L3_TEAM").unwrap_or_else(|_| "lec-g2-esports".to_string());
    let wanted = Segments::from_env();
    let overlay = bundled_world_overlay().expect("bundled overlay");

    println!("L3 start load={}", load_average());
    let (mut world, mut setup, mut first_save) = (Vec::new(), Vec::new(), Vec::new());
    let (mut quiet, mut match_day, mut week) = (Vec::new(), Vec::new(), Vec::new());
    let (mut season_total, mut rollover, mut season_save) = (Vec::new(), Vec::new(), Vec::new());
    let (mut day_mean, mut day_p95, mut day_max) = (Vec::new(), Vec::new(), Vec::new());
    let mut notes = Vec::new();

    for rep_index in 0..reps {
        if wanted.build || wanted.needs_day_game() {
            let (mut game, world_ms, season_ms) = new_game(&overlay, &team_id);
            world.push(world_ms);
            setup.push(season_ms);
            if rep_index == 0 {
                println!(
                    "L3 world: {} leagues, {} teams, {} players, {} staff, start {}",
                    game.leagues.len(),
                    game.teams.len(),
                    game.players.len(),
                    game.staff.len(),
                    today(&game),
                );
            }
            if wanted.build {
                first_save.push(save_bytes(&game) as f64);
            }
            if wanted.needs_day_game() {
                let day = day_segments(&mut game, &wanted, match_min, match_best_of);
                quiet.extend(day.quiet_ms);
                match_day.extend(day.match_ms);
                week.extend(day.week_ms);
                notes.push(format!(
                    "rep {rep_index}: warm-up days (ms) {:?}, match day had {} leagues playing, week had {} playing days, now {}",
                    day.warmup_ms.iter().map(|v| v.round()).collect::<Vec<_>>(),
                    day.match_day_leagues,
                    day.week_match_days,
                    today(&game),
                ));
            }
        }
        if wanted.season {
            let (mut game, world_ms, season_ms) = new_game(&overlay, &team_id);
            if !wanted.build {
                world.push(world_ms);
                setup.push(season_ms);
            }
            let mut run = season_segment(
                &mut game,
                max_days,
                rep_index == 0,
                steps.then_some(&mut profile),
                slow_ms,
            );
            let finished_leagues = run.league_rolls.iter().filter(|(_, _, n)| *n > 0).count();
            let idle: Vec<String> = run
                .league_rolls
                .iter()
                .filter(|(_, _, n)| *n == 0)
                .map(|(id, tier, _)| format!("{id}(t{tier})"))
                .collect();
            let mean = run.day_ms.iter().sum::<f64>() / run.day_ms.len().max(1) as f64;
            let mut sorted = run.day_ms.clone();
            sorted.sort_by(f64::total_cmp);
            let p95 = sorted
                .get(sorted.len().saturating_sub(1) * 95 / 100)
                .copied()
                .unwrap_or(0.0);
            let max = sorted.last().copied().unwrap_or(0.0);
            notes.push(format!(
                "rep {rep_index} season: {} days, {} split rollovers, finished={}, panic={:?}, {} of {} leagues rolled a split or season, never rolled: {:?}, slowest days (ms): {:?}",
                run.days,
                run.splits_rolled,
                run.finished,
                run.panic,
                finished_leagues,
                run.league_rolls.len(),
                idle,
                sorted.iter().rev().take(5).map(|v| v.round()).collect::<Vec<_>>(),
            ));
            season_total.push(run.total_ms);
            rollover.push(run.rollover_ms);
            season_save.push(run.save_bytes as f64);
            day_mean.push(mean);
            day_p95.push(p95);
            day_max.push(max);
            for ((playing, club), ms) in run.day_playing.iter().zip(&run.day_ms) {
                // The user's club days are grouped whatever the other leagues do that day.
                let key = if *club { (true, 0) } else { (false, *playing) };
                by_playing.entry(key).or_default().push(*ms);
            }
            run.day_ms.clear();
        }
    }

    spread("new-game world build", "ms", &mut world);
    spread("new-game season setup", "ms", &mut setup);
    spread("first save", "bytes", &mut first_save);
    spread("quiet day", "ms", &mut quiet);
    spread("match day", "ms", &mut match_day);
    spread("7 days", "ms", &mut week);
    spread("season total", "ms", &mut season_total);
    spread("season rollovers", "ms", &mut rollover);
    spread("season day mean", "ms", &mut day_mean);
    spread("season day p95", "ms", &mut day_p95);
    spread("season day max", "ms", &mut day_max);
    spread("save after season", "bytes", &mut season_save);
    for ((club, playing), mut times) in by_playing {
        let days = times.len();
        let med = median(&mut times);
        let max = times.last().copied().unwrap_or(0.0);
        let label = if club {
            "the user's club plays".to_string()
        } else {
            format!("{playing:>2} leagues playing, not the user's club")
        };
        println!(
            "L3 season days where {label}: {days:>3} days, median {med:>8.1} ms, max {max:>8.1} ms"
        );
    }
    for note in notes {
        println!("L3 {note}");
    }
    if steps {
        profile.print();
    }
    println!("L3 end load={}", load_average());
}
