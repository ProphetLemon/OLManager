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

/// Median of `values` (lower middle for an even count); 0 when empty.
fn median(values: &mut [i64]) -> i64 {
    values.sort_unstable();
    values
        .get(values.len().saturating_sub(1) / 2)
        .copied()
        .unwrap_or(0)
}

/// Sizing of the tier sponsors (ignored): the median annual player plus staff wage
/// bill of the scheduled main clubs of tier 1 and of tier 2 in the world a new game
/// builds. The constants in `olm_core::tier_sponsorship` come from these figures,
/// rounded up to the nearest 50,000.
#[test]
#[ignore = "measurement: prints the wage-bill medians that size the tier sponsors"]
fn world_sponsor_sizing_measure() {
    let world = build_start_world();
    let tiers = olm_core::tier_sponsorship::scheduled_main_club_tiers(&world);
    let wage_bill = |team_id: &str| -> i64 {
        let players: i64 = world
            .players
            .iter()
            .filter(|p| p.team_id.as_deref() == Some(team_id))
            .map(|p| i64::from(p.wage))
            .sum();
        let staff: i64 = world
            .staff
            .iter()
            .filter(|s| s.team_id.as_deref() == Some(team_id))
            .map(|s| i64::from(s.wage))
            .sum();
        players + staff
    };
    for (label, wanted) in [("tier 1", 1u8), ("tier 2", 2u8)] {
        let mut bills: Vec<i64> = tiers
            .iter()
            .filter(|(_, tier)| **tier == wanted)
            .map(|(team_id, _)| wage_bill(team_id))
            .collect();
        let clubs = bills.len();
        let min = bills.iter().copied().min().unwrap_or(0);
        let max = bills.iter().copied().max().unwrap_or(0);
        let med = median(&mut bills);
        let rounded = (med + 49_999) / 50_000 * 50_000;
        println!("{label}: {clubs} clubs, wage bill min {min} median {med} max {max}, rounded up to 50k: {rounded}");
    }
    let mut others: Vec<(String, u8)> = tiers
        .iter()
        .filter(|(_, tier)| !matches!(**tier, 1 | 2))
        .map(|(id, tier)| (id.clone(), *tier))
        .collect();
    others.sort();
    println!(
        "scheduled clubs with another tier: {} {:?}",
        others.len(),
        others.first()
    );
    println!("scheduled main clubs total: {}", tiers.len());
}

// ---------------------------------------------------------------------------
// Wage drift attribution (ignored measurement, no game behaviour is touched).
// ---------------------------------------------------------------------------

/// What the drift measurement keeps of a player between two days.
#[derive(Clone)]
struct PlayerSnap {
    team: Option<String>,
    wage: u32,
    contract_end: Option<String>,
    position: olm_core::domain::stats::LolRole,
}

fn snapshot_players(game: &Game) -> std::collections::HashMap<String, PlayerSnap> {
    game.players
        .iter()
        .map(|player| {
            (
                player.id.clone(),
                PlayerSnap {
                    team: player.team_id.clone(),
                    wage: player.wage,
                    contract_end: player.contract_end.clone(),
                    position: player.position,
                },
            )
        })
        .collect()
}

/// One change to a club's annual player wage bill between two snapshots.
struct WageEvent {
    club: String,
    path: String,
    old_wage: u32,
    new_wage: u32,
    position: olm_core::domain::stats::LolRole,
    /// A free agent signing: the wage the player held while unattached.
    free_agent_join: bool,
    expiry_leave: bool,
}

#[derive(Clone, Default)]
struct PathStat {
    count: u64,
    /// Change of the club's wage bill: new minus old (a leave counts `-old`, a join `+new`).
    delta: i64,
    old_sum: i64,
    new_sum: i64,
}

impl PathStat {
    fn add(&mut self, old: i64, new: i64, delta: i64) {
        self.count += 1;
        self.delta += delta;
        self.old_sum += old;
        self.new_sum += new;
    }
}

/// Classifies every wage-bill change between two daily snapshots, `today` being the date
/// the day was processed on (a contract ending that day expires in it).
fn wage_events(
    before: &std::collections::HashMap<String, PlayerSnap>,
    after: &std::collections::HashMap<String, PlayerSnap>,
    today: &str,
    prefix: &str,
) -> (Vec<WageEvent>, Vec<(String, i64)>) {
    let mut events: Vec<WageEvent> = Vec::new();
    // Free agents whose wage the expiry release reset: (path, new - old).
    let mut resets: Vec<(String, i64)> = Vec::new();
    let mut push = |club: &str,
                    path: &str,
                    old_wage: u32,
                    new_wage: u32,
                    position: &olm_core::domain::stats::LolRole,
                    free_agent_join: bool,
                    expiry_leave: bool| {
        events.push(WageEvent {
            club: club.to_string(),
            path: format!("{prefix}{path}"),
            old_wage,
            new_wage,
            position: *position,
            free_agent_join,
            expiry_leave,
        });
    };

    for (id, a) in after {
        match before.get(id) {
            None => {
                if let Some(club) = &a.team {
                    push(
                        club,
                        "joins: generated player",
                        0,
                        a.wage,
                        &a.position,
                        false,
                        false,
                    );
                }
            }
            Some(b) => match (&b.team, &a.team) {
                (Some(x), Some(y)) if x == y => {
                    if b.contract_end != a.contract_end {
                        push(
                            x,
                            "renewal (new contract, same club)",
                            b.wage,
                            a.wage,
                            &a.position,
                            false,
                            false,
                        );
                    } else if b.wage != a.wage {
                        push(
                            x,
                            "wage change inside a running contract",
                            b.wage,
                            a.wage,
                            &a.position,
                            false,
                            false,
                        );
                    }
                }
                (Some(x), Some(y)) => {
                    push(
                        x,
                        "leaves: moved to another club",
                        b.wage,
                        0,
                        &b.position,
                        false,
                        false,
                    );
                    push(
                        y,
                        "joins: from another club",
                        0,
                        a.wage,
                        &a.position,
                        false,
                        false,
                    );
                }
                (Some(x), None) => {
                    let expired = b.contract_end.as_deref().is_some_and(|end| end <= today);
                    let path = if expired {
                        "leaves: contract expired"
                    } else {
                        "leaves: released or sold out of the game"
                    };
                    push(x, path, b.wage, 0, &b.position, false, expired);
                    if expired {
                        resets.push((
                            format!(
                                "{prefix}expired player's free-agent wage vs his last contract"
                            ),
                            i64::from(a.wage) - i64::from(b.wage),
                        ));
                    }
                }
                (None, Some(y)) => {
                    // Wage the player asks as a free agent is `b.wage`; the club pays `a.wage`.
                    push(
                        y,
                        "joins: free agent",
                        b.wage,
                        a.wage,
                        &a.position,
                        true,
                        false,
                    );
                }
                (None, None) => {}
            },
        }
    }
    for (id, b) in before {
        if after.contains_key(id) {
            continue;
        }
        if let Some(club) = &b.team {
            push(
                club,
                "leaves: removed from the game",
                b.wage,
                0,
                &b.position,
                false,
                false,
            );
        }
    }

    // A free agent signed by a club that lost someone to an expiry the same day is the
    // roster repair of that expiry.
    let expiry_clubs: HashSet<String> = events
        .iter()
        .filter(|e| e.expiry_leave)
        .map(|e| e.club.clone())
        .collect();
    for event in events.iter_mut() {
        if event.free_agent_join && expiry_clubs.contains(&event.club) {
            event.path =
                format!("{prefix}joins: free agent, same day an expiry hit the club (repair)");
        }
    }
    (events, resets)
}

#[derive(Default)]
struct ClubWage {
    group: &'static str,
    user: bool,
    start_bill: i64,
    end_bill: i64,
    bill_day_sum: i64,
    days: i64,
    start_staff: i64,
    end_staff: i64,
    wage_budget: i64,
    start_players: usize,
    end_players: usize,
    paths: BTreeMap<String, PathStat>,
}

struct DriftRun {
    clubs: std::collections::HashMap<String, ClubWage>,
    resets: BTreeMap<String, PathStat>,
    /// Repair signings paired with the player of the same role the club lost the same day:
    /// (replaced wage, new wage).
    pairs: Vec<(&'static str, i64, i64)>,
    /// Free-agent signings by (club group, calendar month).
    join_months: BTreeMap<(&'static str, u32), u64>,
    days: u32,
}

fn bills_by_club(game: &Game) -> std::collections::HashMap<String, i64> {
    let mut bills = std::collections::HashMap::new();
    for player in &game.players {
        if let Some(club) = &player.team_id {
            *bills.entry(club.clone()).or_insert(0) += i64::from(player.wage);
        }
    }
    bills
}

fn head_count_by_club(game: &Game) -> std::collections::HashMap<String, usize> {
    let mut counts = std::collections::HashMap::new();
    for player in &game.players {
        if let Some(club) = &player.team_id {
            *counts.entry(club.clone()).or_insert(0) += 1;
        }
    }
    counts
}

fn staff_bills_by_club(game: &Game) -> std::collections::HashMap<String, i64> {
    let mut bills = std::collections::HashMap::new();
    for staff in &game.staff {
        if let Some(club) = &staff.team_id {
            *bills.entry(club.clone()).or_insert(0) += i64::from(staff.wage);
        }
    }
    bills
}

fn run_wage_drift(mut game: Game) -> DriftRun {
    let user_team = game.manager.team_id.clone();
    let mut clubs: std::collections::HashMap<String, ClubWage> = std::collections::HashMap::new();
    let start_bills = bills_by_club(&game);
    let start_staff = staff_bills_by_club(&game);
    let start_counts = head_count_by_club(&game);
    for team in &game.teams {
        clubs.insert(
            team.id.clone(),
            ClubWage {
                group: group_of(team, &game.leagues),
                user: user_team.as_deref() == Some(team.id.as_str()),
                start_bill: start_bills.get(&team.id).copied().unwrap_or(0),
                start_staff: start_staff.get(&team.id).copied().unwrap_or(0),
                wage_budget: team.wage_budget,
                start_players: start_counts.get(&team.id).copied().unwrap_or(0),
                ..ClubWage::default()
            },
        );
    }
    let mut resets: BTreeMap<String, PathStat> = BTreeMap::new();
    let mut pairs: Vec<(&'static str, i64, i64)> = Vec::new();
    let mut join_months: BTreeMap<(&'static str, u32), u64> = BTreeMap::new();
    let mut previous = snapshot_players(&game);
    let mut days = 0;

    let mut record = |game: &Game,
                      clubs: &mut std::collections::HashMap<String, ClubWage>,
                      previous: &mut std::collections::HashMap<String, PlayerSnap>,
                      today: &str,
                      prefix: &str,
                      count_day: bool| {
        let current = snapshot_players(game);
        let (events, day_resets) = wage_events(previous, &current, today, prefix);
        // Pair repair signings with the expiry leaves of the same club and role.
        let mut leaves: Vec<(&str, &olm_core::domain::stats::LolRole, u32, bool)> = events
            .iter()
            .filter(|e| e.expiry_leave)
            .map(|e| (e.club.as_str(), &e.position, e.old_wage, false))
            .collect();
        for event in events.iter().filter(|e| e.path.ends_with("(repair)")) {
            if let Some(slot) = leaves.iter_mut().find(|(club, position, _, used)| {
                !*used && *club == event.club && **position == event.position
            }) {
                slot.3 = true;
                let counted = clubs.get(&event.club).filter(|club| {
                    !club.user && matches!(club.group, "main tier 1" | "main tier 2")
                });
                if let Some(club) = counted {
                    pairs.push((club.group, i64::from(slot.2), i64::from(event.new_wage)));
                }
            }
        }
        let month: u32 = today.get(5..7).and_then(|m| m.parse().ok()).unwrap_or(0);
        for event in &events {
            if !event.free_agent_join {
                continue;
            }
            if let Some(club) = clubs.get(&event.club) {
                *join_months.entry((club.group, month)).or_default() += 1;
            }
        }
        for event in &events {
            if let Some(club) = clubs.get_mut(&event.club) {
                let delta = i64::from(event.new_wage) - i64::from(event.old_wage);
                club.paths.entry(event.path.clone()).or_default().add(
                    i64::from(event.old_wage),
                    i64::from(event.new_wage),
                    delta,
                );
            }
        }
        for (path, change) in day_resets {
            resets.entry(path).or_default().add(0, 0, change);
        }
        if count_day {
            let bills = bills_by_club(game);
            for (id, club) in clubs.iter_mut() {
                club.bill_day_sum += bills.get(id).copied().unwrap_or(0);
                club.days += 1;
            }
        }
        *previous = current;
    };

    for _ in 0..MAX_DAYS {
        let today = game.clock.current_date.format("%Y-%m-%d").to_string();
        if end_of_season::is_season_complete(&game) {
            let advance = season_rollover::advance_season(&mut game);
            record(
                &game,
                &mut clubs,
                &mut previous,
                &today,
                "rollover: ",
                false,
            );
            if advance.was_season_end {
                break;
            }
        }
        turn::process_day(&mut game);
        days += 1;
        record(&game, &mut clubs, &mut previous, &today, "", true);
    }

    let end_bills = bills_by_club(&game);
    let end_staff = staff_bills_by_club(&game);
    let end_counts = head_count_by_club(&game);
    for (id, club) in clubs.iter_mut() {
        club.end_players = end_counts.get(id).copied().unwrap_or(0);
        club.end_bill = end_bills.get(id).copied().unwrap_or(0);
        club.end_staff = end_staff.get(id).copied().unwrap_or(0);
    }
    DriftRun {
        clubs,
        resets,
        pairs,
        join_months,
        days,
    }
}

fn k(value: i64) -> String {
    format!("{:>7.0}k", value as f64 / 1_000.0)
}

fn print_drift_report(runs: &[DriftRun]) {
    println!(
        "=== WAGE DRIFT: {} replicate(s), AI clubs only (the user's club is left out) ===",
        runs.len()
    );
    for (i, run) in runs.iter().enumerate() {
        println!("rep {i}: {} days played", run.days);
    }
    for group in ["main tier 1", "main tier 2"] {
        let rows: Vec<&ClubWage> = runs
            .iter()
            .flat_map(|run| run.clubs.values())
            .filter(|club| club.group == group && !club.user)
            .collect();
        let n = rows.len() as i64;
        if n == 0 {
            continue;
        }
        let pick = |f: fn(&ClubWage) -> i64| -> Vec<i64> { rows.iter().map(|c| f(c)).collect() };
        let avg_bill = |c: &ClubWage| {
            if c.days > 0 {
                c.bill_day_sum / c.days
            } else {
                0
            }
        };
        let avg_bills: Vec<i64> = rows.iter().map(|c| avg_bill(c)).collect();
        let mut starts = pick(|c| c.start_bill);
        let mut ends = pick(|c| c.end_bill);
        let mut avgs = avg_bills.clone();
        let mut growth = pick(|c| c.end_bill - c.start_bill);
        let mut avg_growth: Vec<i64> = rows.iter().map(|c| avg_bill(c) - c.start_bill).collect();
        let mut staff_growth = pick(|c| c.end_staff - c.start_staff);
        println!("\n--- {group}: {n} club rows (clubs x replicates) ---");
        println!(
            "  player wage bill  start median {} | season average median {} | end median {}",
            k(median(&mut starts)),
            k(median(&mut avgs)),
            k(median(&mut ends))
        );
        println!(
            "  change            end - start median {} (total {}) | average - start median {} (total {}) | staff bill change median {}",
            k(median(&mut growth)),
            k(growth.iter().sum::<i64>() / runs.len() as i64),
            k(median(&mut avg_growth)),
            k(avg_growth.iter().sum::<i64>() / runs.len() as i64),
            k(median(&mut staff_growth)),
        );
        println!(
            "  clubs whose end bill is above start: {}/{}",
            rows.iter().filter(|c| c.end_bill > c.start_bill).count(),
            n
        );
        let mut budgets = pick(|c| c.wage_budget);
        let mut budget_use_start: Vec<i64> = rows
            .iter()
            .map(|c| c.start_bill * 100 / c.wage_budget.max(1))
            .collect();
        let mut budget_use_end: Vec<i64> = rows
            .iter()
            .map(|c| c.end_bill * 100 / c.wage_budget.max(1))
            .collect();
        println!(
            "  wage budget median {} | bill as % of budget: start median {}% , end median {}% (the board allows signings up to 110%)",
            k(median(&mut budgets)),
            median(&mut budget_use_start),
            median(&mut budget_use_end)
        );
        let mut head_start: Vec<i64> = rows.iter().map(|c| c.start_players as i64).collect();
        let mut head_end: Vec<i64> = rows.iter().map(|c| c.end_players as i64).collect();
        println!(
            "  players on the roster: start median {} | end median {}, end p90 {} max {} (start max {})",
            median(&mut head_start),
            median(&mut head_end),
            percentile(&head_end, 90.0),
            head_end.iter().copied().max().unwrap_or(0),
            head_start.iter().copied().max().unwrap_or(0),
        );
        let mut use_sorted = budget_use_end.clone();
        use_sorted.sort_unstable();
        println!(
            "  end bill as % of budget: p10 {}% p90 {}% max {}%; clubs over the 110% soft cap at the end: {}",
            percentile(&use_sorted, 10.0),
            percentile(&use_sorted, 90.0),
            use_sorted.last().copied().unwrap_or(0),
            use_sorted.iter().filter(|u| **u > 110).count()
        );
        let fa_per_club: Vec<i64> = rows
            .iter()
            .map(|c| {
                c.paths
                    .iter()
                    .filter(|(path, _)| path.starts_with("joins: free agent"))
                    .map(|(_, stat)| stat.count as i64)
                    .sum()
            })
            .collect();
        println!(
            "  free-agent signings per club over the season: 0: {} 1: {} 2: {} 3+: {} (max {})",
            fa_per_club.iter().filter(|c| **c == 0).count(),
            fa_per_club.iter().filter(|c| **c == 1).count(),
            fa_per_club.iter().filter(|c| **c == 2).count(),
            fa_per_club.iter().filter(|c| **c >= 3).count(),
            fa_per_club.iter().copied().max().unwrap_or(0),
        );
        let months: Vec<String> = (1..=12u32)
            .map(|m| {
                let total: u64 = runs
                    .iter()
                    .map(|r| r.join_months.get(&(group, m)).copied().unwrap_or(0))
                    .sum();
                format!("{m}:{}", total / runs.len() as u64)
            })
            .collect();
        println!(
            "  free-agent signings by month (per replicate): {}",
            months.join(" ")
        );
        let paths: std::collections::BTreeSet<&String> =
            rows.iter().flat_map(|c| c.paths.keys()).collect();
        println!(
            "  {:<66} {:>8} {:>10} {:>10} {:>9} {:>9}",
            "path (totals are per replicate average)",
            "contracts",
            "total",
            "per club",
            "mean",
            "new/old"
        );
        let mut reconciled = 0usize;
        for club in &rows {
            let sum: i64 = club.paths.values().map(|p| p.delta).sum();
            if sum == club.end_bill - club.start_bill {
                reconciled += 1;
            }
        }
        for path in paths {
            let stats: Vec<PathStat> = rows
                .iter()
                .map(|c| c.paths.get(path).cloned().unwrap_or_default())
                .collect();
            let count: u64 = stats.iter().map(|s| s.count).sum();
            let delta: i64 = stats.iter().map(|s| s.delta).sum();
            let old: i64 = stats.iter().map(|s| s.old_sum).sum();
            let new: i64 = stats.iter().map(|s| s.new_sum).sum();
            let mut per_club: Vec<i64> = stats.iter().map(|s| s.delta).collect();
            let ratio = if old > 0 && new > 0 {
                format!("{:.2}", new as f64 / old as f64)
            } else {
                "-".to_string()
            };
            println!(
                "  {:<66} {:>8} {} {} {} {:>9}",
                path,
                count / runs.len() as u64,
                k(delta / runs.len() as i64),
                k(median(&mut per_club)),
                k(if count > 0 { delta / count as i64 } else { 0 }),
                ratio
            );
        }
        println!("  path deltas add up to the bill change for {reconciled}/{n} club rows");
        let pairs: Vec<&(&str, i64, i64)> = runs
            .iter()
            .flat_map(|r| r.pairs.iter())
            .filter(|p| p.0 == group)
            .collect();
        if !pairs.is_empty() {
            let old: i64 = pairs.iter().map(|p| p.1).sum();
            let new: i64 = pairs.iter().map(|p| p.2).sum();
            let mut diffs: Vec<i64> = pairs.iter().map(|p| p.2 - p.1).collect();
            println!(
                "  repair signing vs the expired player of the same club and role (same day): {} pairs, replaced wage mean {}, new wage mean {}, mean raise {} (median {}), new/old {:.2}",
                pairs.len() / runs.len(),
                k(old / pairs.len() as i64),
                k(new / pairs.len() as i64),
                k((new - old) / pairs.len() as i64),
                k(median(&mut diffs)),
                new as f64 / old.max(1) as f64
            );
        }
    }
    println!("\n--- free-agent wage reset at expiry (no club bill effect) ---");
    let mut merged: BTreeMap<&String, PathStat> = BTreeMap::new();
    for run in runs {
        for (path, stat) in &run.resets {
            let slot = merged.entry(path).or_default();
            slot.count += stat.count;
            slot.delta += stat.delta;
        }
    }
    for (path, stat) in merged {
        println!(
            "  {path}: {} players per replicate, mean change {}",
            stat.count / runs.len() as u64,
            k(stat.delta / stat.count.max(1) as i64)
        );
    }
}

/// Wage drift attribution (ignored): plays one season like [`world_finance_measure`] and
/// attributes the change of every AI club's player wage bill to the path that moved it.
///
/// ```text
/// OLM_MEASURE_REPS=1 \
///   cargo test --release -p openleaguemanager --lib -- --ignored \
///   world_wage_drift_measure --nocapture
/// ```
#[test]
#[ignore = "measurement: prints the wage-bill change per path, run it explicitly in release"]
fn world_wage_drift_measure() {
    let reps = env_number("OLM_MEASURE_REPS", 1) as usize;
    let world = build_start_world();
    let started = Instant::now();
    let runs: Vec<DriftRun> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..reps)
            .map(|_| {
                let copy = world.clone();
                scope.spawn(move || run_wage_drift(copy))
            })
            .collect();
        handles
            .into_iter()
            .map(|h| h.join().expect("replicate thread"))
            .collect()
    });
    print_drift_report(&runs);
    println!("\ntotal wall time {:.1}s", started.elapsed().as_secs_f64());
}
