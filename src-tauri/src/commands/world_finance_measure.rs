//! Season finance measurement (ignored): plays one real season of a fresh world day by
//! day through `turn::process_day`, rolls the league at the end-of-season settlement
//! (`season_rollover::advance_season`, where prize money is paid) and prints, per
//! league tier, how club money moved.
//!
//! ```text
//! OLM_MEASURE_REPS=1 \
//!   cargo test --release -p openleaguemanager --lib -- --ignored \
//!   world_finance_measure --nocapture
//! ```
//!
//! The run stops the moment the settlement has run, so the figures cover exactly the
//! days before it plus the settlement itself. Replicates differ by thread-RNG noise and
//! are pooled club by club.

use std::collections::{BTreeMap, HashSet};
use std::time::Instant;

use olm_core::domain::league::League;
use olm_core::domain::team::{FinancialTransaction, Team, TeamKind};
use olm_core::game::Game;
use olm_core::{end_of_season, season_rollover, turn};

use super::world_progression_measure::build_start_world;

/// Safety bound on the day loop; a season is far shorter than this.
const MAX_DAYS: u32 = 800;

/// Report order of the club groups.
const GROUPS: [&str; 5] = [
    "main tier 1",
    "main tier 2",
    "main tier 3+",
    "main no league",
    "academy",
];

fn env_number(name: &str, default: u32) -> u32 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

/// Group of a club: its kind, then the tier of the league its `competition_id` names.
fn group_of(team: &Team, leagues: &[League]) -> &'static str {
    if team.team_kind == TeamKind::Academy {
        return "academy";
    }
    let tier = team.competition_id.as_deref().and_then(|competition_id| {
        leagues
            .iter()
            .find(|league| league.competition_id.as_deref() == Some(competition_id))
            .map(|league| league.tier)
    });
    match tier {
        Some(1) => "main tier 1",
        Some(2) => "main tier 2",
        Some(_) => "main tier 3+",
        None => "main no league",
    }
}

/// Team totals at one moment of the run.
#[derive(Clone, Copy, Default)]
struct Mark {
    finance: i64,
    ledger_len: usize,
    season_income: i64,
    season_expenses: i64,
}

fn mark_of(team: &Team) -> Mark {
    Mark {
        finance: team.finance,
        ledger_len: team.financial_ledger.len(),
        season_income: team.season_income,
        season_expenses: team.season_expenses,
    }
}

struct ClubRow {
    group: &'static str,
    user: bool,
    start: Mark,
    before_settlement: Mark,
    end: Mark,
    min_balance: i64,
    /// Income and expenses by ledger kind over the run, split by the sign of the amount.
    income: BTreeMap<String, i64>,
    expenses: BTreeMap<String, i64>,
    /// Ledger sums over the same windows, to compare with `season_income`.
    ledger_income_before_settlement: i64,
    ledger_income_total: i64,
    ledger_expenses_before_settlement: i64,
    ledger_expenses_total: i64,
    ledger_net: i64,
}

struct SponsorOffer {
    date: String,
    subject: String,
}

struct Run {
    first_fixture: String,
    world_start: String,
    settlement_day: String,
    stop_day: String,
    days: u32,
    settled: bool,
    seconds: f64,
    clubs: Vec<ClubRow>,
    offers: Vec<SponsorOffer>,
}

fn ledger_sums(entries: &[FinancialTransaction]) -> (i64, i64) {
    entries.iter().fold((0, 0), |(income, expenses), entry| {
        if entry.amount > 0 {
            (income + entry.amount, expenses)
        } else {
            (income, expenses + entry.amount.abs())
        }
    })
}

fn run_season(mut game: Game) -> Run {
    let started = Instant::now();
    let world_start = game.clock.current_date.format("%Y-%m-%d").to_string();
    let first_fixture = game
        .active_league()
        .and_then(|l| l.fixtures.iter().map(|f| f.date.as_str()).min())
        .unwrap_or("-")
        .to_string();
    let user_team = game.manager.team_id.clone();
    let groups: Vec<&'static str> = game
        .teams
        .iter()
        .map(|t| group_of(t, &game.leagues))
        .collect();
    let start: Vec<Mark> = game.teams.iter().map(mark_of).collect();
    let mut min_balance: Vec<i64> = start.iter().map(|m| m.finance).collect();
    let mut before_settlement: Vec<Mark> = start.clone();
    let mut seen_offers: HashSet<String> = HashSet::new();
    let mut offers: Vec<SponsorOffer> = Vec::new();
    let mut settlement_day = String::from("-");
    let mut settled = false;
    let mut days = 0;

    for _ in 0..MAX_DAYS {
        if end_of_season::is_season_complete(&game) {
            let pre: Vec<Mark> = game.teams.iter().map(mark_of).collect();
            let advance = season_rollover::advance_season(&mut game);
            for (low, team) in min_balance.iter_mut().zip(&game.teams) {
                *low = (*low).min(team.finance);
            }
            if advance.was_season_end {
                before_settlement = pre;
                settlement_day = game.clock.current_date.format("%Y-%m-%d").to_string();
                settled = true;
                break;
            }
        }
        turn::process_day(&mut game);
        days += 1;
        for (low, team) in min_balance.iter_mut().zip(&game.teams) {
            *low = (*low).min(team.finance);
        }
        for message in &game.messages {
            if message.id.starts_with("sponsor_") && seen_offers.insert(message.id.clone()) {
                offers.push(SponsorOffer {
                    date: message.date.clone(),
                    subject: message.subject.clone(),
                });
            }
        }
    }

    let clubs = game
        .teams
        .iter()
        .enumerate()
        .map(|(i, team)| {
            let window =
                &team.financial_ledger[start[i].ledger_len.min(team.financial_ledger.len())..];
            let mut income: BTreeMap<String, i64> = BTreeMap::new();
            let mut expenses: BTreeMap<String, i64> = BTreeMap::new();
            for entry in window {
                let key = format!("{:?}", entry.kind);
                if entry.amount > 0 {
                    *income.entry(key).or_default() += entry.amount;
                } else {
                    *expenses.entry(key).or_default() += entry.amount.abs();
                }
            }
            let pre_len = before_settlement[i].ledger_len.max(start[i].ledger_len);
            let pre_window = &team.financial_ledger
                [start[i].ledger_len..pre_len.min(team.financial_ledger.len())];
            let (pre_income, pre_expenses) = ledger_sums(pre_window);
            let (total_income, total_expenses) = ledger_sums(window);
            ClubRow {
                group: groups[i],
                user: user_team.as_deref() == Some(team.id.as_str()),
                start: start[i],
                before_settlement: before_settlement[i],
                end: mark_of(team),
                min_balance: min_balance[i],
                income,
                expenses,
                ledger_income_before_settlement: pre_income,
                ledger_income_total: total_income,
                ledger_expenses_before_settlement: pre_expenses,
                ledger_expenses_total: total_expenses,
                ledger_net: window.iter().map(|e| e.amount).sum(),
            }
        })
        .collect();

    Run {
        first_fixture,
        world_start,
        settlement_day,
        stop_day: game.clock.current_date.format("%Y-%m-%d").to_string(),
        days,
        settled,
        seconds: started.elapsed().as_secs_f64(),
        clubs,
        offers,
    }
}

/// Nearest-rank percentile of a sorted slice.
fn percentile(sorted: &[i64], pct: f64) -> i64 {
    if sorted.is_empty() {
        return 0;
    }
    let index = ((pct / 100.0) * (sorted.len() - 1) as f64).round() as usize;
    sorted[index.min(sorted.len() - 1)]
}

fn thousands(value: i64) -> String {
    format!("{:>8.0}k", value as f64 / 1_000.0)
}

/// `median / p10 / p90 / min` of a sample, in thousands of euros.
fn dist(values: &[i64]) -> String {
    let mut sorted = values.to_vec();
    sorted.sort_unstable();
    format!(
        "med {} p10 {} p90 {} min {}",
        thousands(percentile(&sorted, 50.0)),
        thousands(percentile(&sorted, 10.0)),
        thousands(percentile(&sorted, 90.0)),
        thousands(sorted.first().copied().unwrap_or(0)),
    )
}

fn print_kind_table(title: &str, rows: &[&ClubRow], pick: fn(&ClubRow) -> &BTreeMap<String, i64>) {
    let kinds: std::collections::BTreeSet<&String> =
        rows.iter().flat_map(|r| pick(r).keys()).collect();
    println!(
        "  {title} by ledger kind (clubs with any / distribution over all clubs of the group):"
    );
    if kinds.is_empty() {
        println!("    (none)");
    }
    for kind in kinds {
        let values: Vec<i64> = rows
            .iter()
            .map(|r| pick(r).get(kind).copied().unwrap_or(0))
            .collect();
        let any = values.iter().filter(|v| **v != 0).count();
        println!(
            "    {kind:<18} {any:>4}/{:<4} {}",
            values.len(),
            dist(&values)
        );
    }
}

fn print_report(runs: &[Run]) {
    println!("=== SEASON FINANCE: {} replicate(s) ===", runs.len());
    for (i, run) in runs.iter().enumerate() {
        println!(
            "rep {i}: world starts {}, first user-league fixture {}, {} days played, settlement ran on {} (settled: {}), run stops {}, {:.1}s",
            run.world_start,
            run.first_fixture,
            run.days,
            run.settlement_day,
            run.settled,
            run.stop_day,
            run.seconds
        );
    }
    let all: Vec<&ClubRow> = runs.iter().flat_map(|r| r.clubs.iter()).collect();
    for group in GROUPS {
        let rows: Vec<&ClubRow> = all.iter().copied().filter(|r| r.group == group).collect();
        if rows.is_empty() {
            continue;
        }
        println!("\n--- {group}: {} club rows ---", rows.len());
        let pick = |f: fn(&ClubRow) -> i64| -> Vec<i64> { rows.iter().map(|r| f(r)).collect() };
        println!("  start balance   {}", dist(&pick(|r| r.start.finance)));
        println!("  end balance     {}", dist(&pick(|r| r.end.finance)));
        println!("  min balance     {}", dist(&pick(|r| r.min_balance)));
        println!(
            "  net change      {}",
            dist(&pick(|r| r.end.finance - r.start.finance))
        );
        println!(
            "  clubs: start negative {}, end negative {}, negative at any point {}, end below start {}",
            rows.iter().filter(|r| r.start.finance < 0).count(),
            rows.iter().filter(|r| r.end.finance < 0).count(),
            rows.iter().filter(|r| r.min_balance < 0).count(),
            rows.iter().filter(|r| r.end.finance < r.start.finance).count(),
        );
        println!(
            "  ledger net equals balance change for {}/{} clubs",
            rows.iter()
                .filter(|r| r.ledger_net == r.end.finance - r.start.finance)
                .count(),
            rows.len()
        );
        print_kind_table("income", &rows, |r| &r.income);
        print_kind_table("expenses", &rows, |r| &r.expenses);
        println!("  season_income / season_expenses reset check:");
        println!(
            "    season_income  start {} | just before settlement {} | after settlement {}",
            dist(&pick(|r| r.start.season_income)),
            dist(&pick(|r| r.before_settlement.season_income)),
            dist(&pick(|r| r.end.season_income)),
        );
        println!(
            "    ledger income  before settlement {} | whole run {}",
            dist(&pick(|r| r.ledger_income_before_settlement)),
            dist(&pick(|r| r.ledger_income_total)),
        );
        println!(
            "    season_expenses start {} | just before settlement {} | after settlement {}",
            dist(&pick(|r| r.start.season_expenses)),
            dist(&pick(|r| r.before_settlement.season_expenses)),
            dist(&pick(|r| r.end.season_expenses)),
        );
        println!(
            "    ledger expenses before settlement {} | whole run {}",
            dist(&pick(|r| r.ledger_expenses_before_settlement)),
            dist(&pick(|r| r.ledger_expenses_total)),
        );
        println!(
            "    clubs where season_income after settlement == start + ledger income: {}/{}; set to 0 by the settlement: {}; lower after than before: {}",
            rows.iter()
                .filter(|r| r.end.season_income == r.start.season_income + r.ledger_income_total)
                .count(),
            rows.len(),
            rows.iter()
                .filter(|r| r.before_settlement.season_income != 0 && r.end.season_income == 0)
                .count(),
            rows.iter()
                .filter(|r| r.end.season_income < r.before_settlement.season_income)
                .count(),
        );
    }

    println!("\n--- the user's club in the harness ---");
    for (i, run) in runs.iter().enumerate() {
        let Some(user) = run.clubs.iter().find(|r| r.user) else {
            println!("rep {i}: no user club row");
            continue;
        };
        println!(
            "rep {i}: group {}, start {}, end {}, min {}, income {:?}, expenses {:?}",
            user.group,
            thousands(user.start.finance),
            thousands(user.end.finance),
            thousands(user.min_balance),
            user.income,
            user.expenses
        );
        println!(
            "  random-event sponsor offers received (never accepted by the harness): {}",
            run.offers.len()
        );
        for offer in &run.offers {
            println!("    {} {}", offer.date, offer.subject);
        }
    }
}

#[test]
#[ignore = "measurement: prints per-tier season finances, run it explicitly in release"]
fn world_finance_measure() {
    let reps = env_number("OLM_MEASURE_REPS", 1) as usize;
    let build_started = Instant::now();
    let world = build_start_world();
    println!(
        "world built in {:.1}s: {} teams ({} leagues), user team {:?}",
        build_started.elapsed().as_secs_f64(),
        world.teams.len(),
        world.leagues.len(),
        world.manager.team_id
    );
    let tiers: Vec<String> = world
        .leagues
        .iter()
        .map(|l| {
            format!(
                "{}=T{}",
                l.competition_id.as_deref().unwrap_or(&l.id),
                l.tier
            )
        })
        .collect();
    println!("league tiers: {}", tiers.join(", "));
    let started = Instant::now();
    let runs: Vec<Run> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..reps)
            .map(|_| {
                let copy = world.clone();
                scope.spawn(move || run_season(copy))
            })
            .collect();
        handles
            .into_iter()
            .map(|h| h.join().expect("replicate thread"))
            .collect()
    });
    print_report(&runs);
    println!("\ntotal wall time {:.1}s", started.elapsed().as_secs_f64());
}
