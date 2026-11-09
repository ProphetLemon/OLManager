//! Calibration harness for the founding squad generator.
//!
//! Loads the real LES and LEC data read-only, measures the peer OVR
//! percentiles and the league-median wage budget, generates 1,000 seeded squads
//! per league and writes a Markdown report with the observed distributions and
//! the day-1 star-signing check.
//!
//! Run it with:
//! `cargo test -p olm_core calibrate_founding_squads -- --ignored --nocapture`
//!
//! The report lands in `<repo>/src-tauri/target/olm-scratch/custom-club/calibration.md`,
//! or at `OLM_CALIBRATION_REPORT` when set.
//! Without the data directory the test prints a notice and passes.

use std::collections::HashSet;
use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::time::Instant;

use chrono::{Datelike, NaiveDate};
use olm_core::contract_wage_policy::wage_policy_room_for_new_signing;
use olm_core::contracts::expected_signing_wage;
use olm_core::custom_team::{OvrPercentiles, league_median_profile, peer_ovr_percentiles};
use olm_core::domain::player::Player;
use olm_core::domain::team::{Team, TeamKind};
use olm_core::game_setup::{
    apply_default_market_values, clear_free_agent_contracts, new_game_start_date,
};
use olm_core::player_rating::natural_ovr;
use olm_core::squad_generator::{
    BILL_WINDOW_PCT, DERIVED_BUDGET_BILL_PCT, SQUAD_ROLES, SquadSpec, founding_wage_budget,
    generate_founding_squad,
};
use olm_core::team_overrides;
use serde::Deserialize;

const SQUADS_PER_LEAGUE: u64 = 1_000;
/// Free agents at or above this OVR count as stars in the headroom check.
const STAR_OVR: u8 = 80;
/// Free agents at or above this OVR must NOT be signable on day 1.
const SUPERSTAR_OVR: u8 = 85;
/// Share of the expected wage a player still negotiates down to (`transfers::wage_floor`).
const NEGOTIATION_FLOOR_PCT: u64 = 85;
/// Day-1 bill, as a share of the wage budget, the feature doc targeted.
const DOC_BILL_TARGET_PCT: (f64, f64) = (75.0, 85.0);
/// Yearly wage of one typical staff hire (upper end seen in the LES staff data).
const STAFF_HIRE_WAGE: i64 = 30_000;
/// Staff hires counted in the "bill with staff" line.
const STAFF_HIRES: i64 = 3;
/// Year-2 renewals start at the current wage plus this many percent (`expected_wage`, age <= 27).
const RENEWAL_RAISE_PCT: i64 = 105;
/// Share of the remaining contract salary a release costs (`transfers::CONTRACT_RELEASE_PENALTY_PCT`).
const RELEASE_PENALTY_PCT: i64 = 40;
/// Tiers of the "can sign an OVR >= N free agent" summary.
const OVR_TIERS: [u8; 4] = [80, 82, 84, 85];

/// How the founding squad is priced against the club's wage budget.
#[derive(Clone, Copy, PartialEq, Eq)]
enum WageMode {
    /// Wages at the wage floor, league-median budget (no scaling).
    Floor,
    /// Wages scaled up into `BILL_WINDOW_PCT` of the league-median budget (interim).
    Window,
    /// Wages at the floor, budget derived from the bill with `founding_wage_budget`.
    Derived,
}

#[derive(Deserialize)]
struct PlayersFile {
    players: Vec<Player>,
}

#[derive(Deserialize)]
struct TeamsFile {
    teams: Vec<Team>,
}

struct League {
    id: &'static str,
    label: &'static str,
    nationalities: &'static [&'static str],
}

const LEAGUES: [League; 2] = [
    League {
        id: "les",
        label: "LES",
        nationalities: &["ES"],
    },
    League {
        id: "lec",
        label: "LEC",
        nationalities: &["FR", "DE", "DK", "SE", "PL", "GB", "ES", "IT"],
    },
];

fn repo_data_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../data")
}

/// `OLM_CALIBRATION_REPORT` overrides the default report location.
fn scratch_report_path() -> PathBuf {
    if let Some(custom) = std::env::var_os("OLM_CALIBRATION_REPORT") {
        return PathBuf::from(custom);
    }
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/olm-scratch/custom-club/calibration.md")
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))
}

struct LeagueWorld {
    teams: Vec<Team>,
    players: Vec<Player>,
}

fn load_league(data: &Path, id: &str) -> Result<LeagueWorld, String> {
    let mut teams =
        read_json::<TeamsFile>(&data.join("teams").join(format!("{id}_teams.json")))?.teams;
    for team in &mut teams {
        team.competition_id = Some(id.to_string());
    }
    // Same overrides the real world build applies on top of the shipped teams.
    team_overrides::bundled().apply_known(&mut teams);
    let players =
        read_json::<PlayersFile>(&data.join("players").join(format!("{id}_players.json")))?.players;
    Ok(LeagueWorld { teams, players })
}

fn load_free_agents(data: &Path) -> Result<Vec<Player>, String> {
    let mut players =
        read_json::<PlayersFile>(&data.join("players").join("free_agents.json"))?.players;
    for player in &mut players {
        player.team_id = None;
    }
    // Same passes the real new-game build runs: seed market values, then free contracts.
    apply_default_market_values(&mut players);
    clear_free_agent_contracts(&mut players);
    Ok(players)
}

fn sorted(mut values: Vec<f64>) -> Vec<f64> {
    values.sort_by(|a, b| a.total_cmp(b));
    values
}

/// Linear-interpolated quantile of an ascending slice; `0.0` when empty.
fn quantile(sorted: &[f64], q: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let position = q.clamp(0.0, 1.0) * (sorted.len() - 1) as f64;
    let lower = position.floor() as usize;
    let upper = position.ceil() as usize;
    sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower as f64)
}

fn mean(values: &[f64]) -> f64 {
    if values.is_empty() {
        0.0
    } else {
        values.iter().sum::<f64>() / values.len() as f64
    }
}

fn wage_floor(price: u32) -> u32 {
    (u64::from(price) * NEGOTIATION_FLOOR_PCT).div_ceil(100) as u32
}

struct Star {
    name: String,
    role: String,
    ovr: u8,
    market_value: u64,
    price: u32,
    floor_price: u32,
}

struct SquadStats {
    ovrs: Vec<[u8; 5]>,
    bill_pct: Vec<f64>,
    above_median: usize,
    raw_nick_clashes: usize,
    /// Per star: squads that can sign it at the full price / at the 85% floor.
    star_affordable_full: Vec<usize>,
    star_affordable_floor: Vec<usize>,
    /// Per squad: count of stars (any / superstar) signable at the 85% floor.
    stars_signable: Vec<usize>,
    superstars_signable: Vec<usize>,
    room_pct: Vec<f64>,
    /// Per squad: highest OVR among the free agents signable at the 85% floor (0 = none).
    max_signable_ovr: Vec<u8>,
    /// Per squad: superstars signable after releasing the most expensive founding player.
    superstars_after_release: Vec<usize>,
    /// Per squad: players plus three staff hires, as % of the effective budget.
    staff_bill_pct: Vec<f64>,
    /// Per squad: year-2 renewal bill (current wage + 5%), as % of the effective budget.
    renewal_bill_pct: Vec<f64>,
    /// Per squad: release penalty of the most expensive player (40% of two years).
    release_penalty: Vec<i64>,
    /// Per squad: the wage budget the squad is measured against.
    effective_budget: Vec<i64>,
    failures: Vec<String>,
    taken_clashes: usize,
}

#[allow(clippy::too_many_arguments)]
fn run_league(
    league: &League,
    percentiles: OvrPercentiles,
    budget_team: &Team,
    taken: &HashSet<String>,
    stars: &[Star],
    today: NaiveDate,
    mode: WageMode,
) -> SquadStats {
    let budget = budget_team.wage_budget.max(1);
    let empty = HashSet::new();
    let mut stats = SquadStats {
        ovrs: Vec::new(),
        bill_pct: Vec::new(),
        above_median: 0,
        raw_nick_clashes: 0,
        star_affordable_full: vec![0; stars.len()],
        star_affordable_floor: vec![0; stars.len()],
        stars_signable: Vec::new(),
        superstars_signable: Vec::new(),
        room_pct: Vec::new(),
        max_signable_ovr: Vec::new(),
        superstars_after_release: Vec::new(),
        staff_bill_pct: Vec::new(),
        renewal_bill_pct: Vec::new(),
        release_penalty: Vec::new(),
        effective_budget: Vec::new(),
        failures: Vec::new(),
        taken_clashes: 0,
    };
    for seed in 0..SQUADS_PER_LEAGUE {
        let raw_spec = SquadSpec {
            club_slug: "calibration",
            percentiles,
            nationalities: league.nationalities,
            today,
            taken_match_names: &empty,
            taken_full_names: &empty,
            serial: 1,
            wage_budget: (mode == WageMode::Window).then_some(budget),
        };
        if let Ok(raw) = generate_founding_squad(&raw_spec, seed) {
            stats.raw_nick_clashes += raw
                .iter()
                .filter(|p| taken.contains(&p.match_name.to_lowercase()))
                .count();
        }
        let spec = SquadSpec {
            taken_match_names: taken,
            taken_full_names: &empty,
            ..raw_spec
        };
        let squad = match generate_founding_squad(&spec, seed) {
            Ok(squad) => squad,
            Err(error) => {
                stats.failures.push(format!("seed {seed}: {error}"));
                continue;
            }
        };
        stats.taken_clashes += squad
            .iter()
            .filter(|p| taken.contains(&p.match_name.to_lowercase()))
            .count();

        let mut ovrs = [0u8; 5];
        for (slot, player) in squad.iter().enumerate() {
            ovrs[slot] = player.lol_ovr;
        }
        if ovrs.iter().any(|ovr| *ovr > percentiles.p50) {
            stats.above_median += 1;
        }
        stats.ovrs.push(ovrs);

        let bill: i64 = squad.iter().map(|p| i64::from(p.wage)).sum();
        let (effective, team) = if mode == WageMode::Derived {
            let mut team = budget_team.clone();
            team.wage_budget = founding_wage_budget(&squad);
            (team.wage_budget.max(1), team)
        } else {
            (budget, budget_team.clone())
        };
        stats.effective_budget.push(effective);
        stats.bill_pct.push(bill as f64 * 100.0 / effective as f64);
        let room = wage_policy_room_for_new_signing(&team, bill);
        stats.room_pct.push(room as f64 * 100.0 / effective as f64);
        stats
            .staff_bill_pct
            .push((bill + STAFF_HIRES * STAFF_HIRE_WAGE) as f64 * 100.0 / effective as f64);
        let renewal: i64 = squad
            .iter()
            .map(|p| i64::from(p.wage) * RENEWAL_RAISE_PCT / 100)
            .sum();
        stats
            .renewal_bill_pct
            .push(renewal as f64 * 100.0 / effective as f64);
        let top_wage = squad.iter().map(|p| i64::from(p.wage)).max().unwrap_or(0);
        stats.release_penalty.push(
            top_wage * i64::from(olm_core::squad_generator::CONTRACT_YEARS) * RELEASE_PENALTY_PCT
                / 100,
        );
        let room_after_release = wage_policy_room_for_new_signing(&team, bill - top_wage);

        let (mut signable, mut superstars, mut after_release) = (0, 0, 0);
        let mut best_ovr = 0u8;
        for (index, star) in stars.iter().enumerate() {
            if i64::from(star.price) <= room {
                stats.star_affordable_full[index] += 1;
            }
            if i64::from(star.floor_price) <= room {
                stats.star_affordable_floor[index] += 1;
                signable += 1;
                best_ovr = best_ovr.max(star.ovr);
                if star.ovr >= SUPERSTAR_OVR {
                    superstars += 1;
                }
            }
            if star.ovr >= SUPERSTAR_OVR && i64::from(star.floor_price) <= room_after_release {
                after_release += 1;
            }
        }
        stats.stars_signable.push(signable);
        stats.superstars_signable.push(superstars);
        stats.max_signable_ovr.push(best_ovr);
        stats.superstars_after_release.push(after_release);
    }
    stats
}

fn distribution_row(label: &str, values: &[f64], unit: &str) -> String {
    let s = sorted(values.to_vec());
    format!(
        "| {label} | {:.1}{unit} | {:.1}{unit} | {:.1}{unit} | {:.1}{unit} | {:.1}{unit} | {:.1}{unit} |\n",
        s.first().copied().unwrap_or(0.0),
        quantile(&s, 0.10),
        quantile(&s, 0.50),
        mean(&s),
        quantile(&s, 0.90),
        s.last().copied().unwrap_or(0.0),
    )
}

/// A baseline run summary (`label, bill p50, room p50, superstar share`) and its blocking bill.
type BaselineRow = ((String, f64, f64, f64), Option<f64>);

struct LeagueReport {
    markdown: String,
    /// `(label, bill p50 %, room p50 %, superstar-signable share %)`.
    summary: (String, f64, f64, f64),
    /// Share of squads (%) that can sign a free agent of at least each [`OVR_TIERS`] OVR.
    tier_shares: Vec<(u8, f64)>,
    /// Share of squads (%) that can sign an OVR >= 85 free agent after releasing the top earner.
    after_release_share: f64,
    /// Median year-2 renewal bill and bill with staff, as % of the effective budget.
    renewal_p50: f64,
    staff_p50: f64,
    /// Median wage budget the squads were measured against.
    budget_p50: f64,
    /// Smallest day-1 bill, as % of budget, that keeps every superstar out of reach
    /// at the 85% negotiation floor (the soft cap leaves `110% - bill`).
    block_bill_pct: Option<f64>,
}

#[allow(clippy::too_many_arguments)]
fn render_league(
    heading: &str,
    mode: WageMode,
    show_header: bool,
    window: (f64, f64),
    league: &League,
    percentiles: OvrPercentiles,
    budget_team: &Team,
    peer_count: usize,
    peer_players: usize,
    stars: &[Star],
    stats: &SquadStats,
    elapsed_ms: u128,
) -> LeagueReport {
    let budget = budget_team.wage_budget;
    let mut md = String::new();
    let _ = writeln!(md, "{heading}\n");
    if show_header {
        let _ = writeln!(
            md,
            "Peers: {peer_count} Main teams, {peer_players} rostered players. Median wage budget: {budget} (soft cap 110% = {}). Median reputation used for wage pricing: {}.\n",
            budget * 110 / 100,
            budget_team.reputation
        );
        let _ = writeln!(
            md,
            "### Peer OVR percentiles\n\n| p10 | p25 | p50 | p75 | p90 | source |\n|---|---|---|---|---|---|\n| {} | {} | {} | {} | {} | {} |\n",
            percentiles.p10,
            percentiles.p25,
            percentiles.p50,
            percentiles.p75,
            percentiles.p90,
            if percentiles.from_peers {
                "peers"
            } else {
                "FALLBACK"
            }
        );
    }

    let n = stats.ovrs.len();
    let _ = writeln!(
        md,
        "### Generated OVR ({n} squads, {} failures)\n\n| slot | min | mean | max |\n|---|---|---|---|",
        stats.failures.len()
    );
    for (slot, role) in SQUAD_ROLES.iter().enumerate() {
        let column: Vec<f64> = stats.ovrs.iter().map(|o| f64::from(o[slot])).collect();
        let _ = writeln!(
            md,
            "| {role:?} | {:.0} | {:.2} | {:.0} |",
            column.iter().copied().fold(f64::MAX, f64::min),
            mean(&column),
            column.iter().copied().fold(f64::MIN, f64::max),
        );
    }
    let squad_means: Vec<f64> = stats
        .ovrs
        .iter()
        .map(|o| o.iter().map(|v| f64::from(*v)).sum::<f64>() / 5.0)
        .collect();
    let _ = writeln!(
        md,
        "\nSquad mean OVR: min {:.1} / mean {:.2} / max {:.1} (median {}, target about median-1.5 = {:.1}).\nSquads with a starter above the median: {} of {n} ({:.1}%).\n",
        squad_means.iter().copied().fold(f64::MAX, f64::min),
        mean(&squad_means),
        squad_means.iter().copied().fold(f64::MIN, f64::max),
        percentiles.p50,
        f64::from(percentiles.p50) - 1.5,
        stats.above_median,
        stats.above_median as f64 * 100.0 / n.max(1) as f64,
    );

    let _ = writeln!(
        md,
        "### Day-1 wage bill vs wage budget\n\n| metric | min | p10 | p50 | mean | p90 | max |\n|---|---|---|---|---|---|---|"
    );
    md.push_str(&distribution_row("bill % of budget", &stats.bill_pct, "%"));
    md.push_str(&distribution_row(
        "room to soft cap % of budget",
        &stats.room_pct,
        "%",
    ));
    md.push_str(&distribution_row(
        "bill + 3 staff hires % of budget",
        &stats.staff_bill_pct,
        "%",
    ));
    md.push_str(&distribution_row(
        "year-2 renewal bill (+5%) % of budget",
        &stats.renewal_bill_pct,
        "%",
    ));
    let budgets: Vec<f64> = stats.effective_budget.iter().map(|b| *b as f64).collect();
    md.push_str(&distribution_row("wage budget", &budgets, ""));
    let penalties: Vec<f64> = stats.release_penalty.iter().map(|b| *b as f64).collect();
    md.push_str(&distribution_row(
        "release penalty of the top earner (40% of 2 years)",
        &penalties,
        "",
    ));
    let in_doc_window = stats
        .bill_pct
        .iter()
        .filter(|pct| (window.0..=window.1 + 0.1).contains(pct))
        .count();
    let _ = writeln!(
        md,
        "\nSquads inside the {}-{}% window: {} of {n} ({:.1}%).\n",
        window.0,
        window.1,
        in_doc_window,
        in_doc_window as f64 * 100.0 / n.max(1) as f64,
    );

    let _ = writeln!(
        md,
        "### Star-headroom check (free agents with OVR >= {STAR_OVR}, day 1)\n\nUser rule: `negotiate_player_wage` accepts a wage between 85% of `expected_signing_wage` and `wage_policy_room_for_new_signing` (110% soft cap minus the bill). A star is signable when the room covers its price (full) or its 85% floor (best case).\n"
    );
    let _ = writeln!(
        md,
        "| player | role | OVR | market value | expected signing wage | 85% floor | squads that afford full price | squads that afford the 85% floor |\n|---|---|---|---|---|---|---|---|"
    );
    for (index, star) in stars.iter().enumerate() {
        let _ = writeln!(
            md,
            "| {} | {} | {} | {} | {} | {} | {:.1}% | {:.1}% |",
            star.name,
            star.role,
            star.ovr,
            star.market_value,
            star.price,
            star.floor_price,
            stats.star_affordable_full[index] as f64 * 100.0 / n.max(1) as f64,
            stats.star_affordable_floor[index] as f64 * 100.0 / n.max(1) as f64,
        );
    }
    let any_star = stats.stars_signable.iter().filter(|c| **c > 0).count();
    let any_superstar = stats.superstars_signable.iter().filter(|c| **c > 0).count();
    let star_counts: Vec<f64> = stats.stars_signable.iter().map(|c| *c as f64).collect();
    let _ = writeln!(
        md,
        "\nStars signable at the 85% floor per squad: mean {:.2}, max {:.0}. Squads that can sign at least one star: {any_star} of {n} ({:.1}%). Squads that can sign at least one OVR >= {SUPERSTAR_OVR} free agent: {any_superstar} of {n} ({:.1}%).\n",
        mean(&star_counts),
        star_counts.iter().copied().fold(0.0, f64::max),
        any_star as f64 * 100.0 / n.max(1) as f64,
        any_superstar as f64 * 100.0 / n.max(1) as f64,
    );

    let cheapest_superstar_floor = stars
        .iter()
        .filter(|s| s.ovr >= SUPERSTAR_OVR)
        .map(|s| s.floor_price)
        .min();
    let block_bill_pct = cheapest_superstar_floor
        .filter(|_| mode != WageMode::Derived)
        .map(|floor| {
            // Room < floor  <=>  1.10 * budget - bill < floor.
            (budget as f64 * 1.10 - f64::from(floor) + 1.0) * 100.0 / budget as f64
        });
    if let (Some(floor), Some(pct)) = (cheapest_superstar_floor, block_bill_pct) {
        let _ = writeln!(
            md,
            "Cheapest OVR >= {SUPERSTAR_OVR} free agent at the 85% floor: {floor}. To keep every such player out of reach the day-1 bill must exceed {pct:.1}% of the median wage budget (the soft cap leaves 110% minus the bill).\n"
        );
    }

    let tier_shares: Vec<(u8, f64)> = OVR_TIERS
        .iter()
        .map(|tier| {
            let count = stats
                .max_signable_ovr
                .iter()
                .filter(|ovr| **ovr >= *tier)
                .count();
            (*tier, count as f64 * 100.0 / n.max(1) as f64)
        })
        .collect();
    let _ = writeln!(
        md,
        "Squads that can sign at least one free agent of OVR >= N at the 85% floor:\n"
    );
    for (tier, share) in &tier_shares {
        let _ = writeln!(md, "- OVR >= {tier}: {share:.1}%");
    }
    let after_release = stats
        .superstars_after_release
        .iter()
        .filter(|c| **c > 0)
        .count();
    let after_release_share = after_release as f64 * 100.0 / n.max(1) as f64;
    let _ = writeln!(
        md,
        "\nAfter releasing the top earner (one-off penalty above), {after_release} of {n} squads ({after_release_share:.1}%) could sign an OVR >= {SUPERSTAR_OVR} free agent. The block is 'not without moving a starter', not absolute.\n"
    );

    let _ = writeln!(
        md,
        "### Nick clashes\n\nGenerated nicks equal to a real LES/LEC/free-agent `match_name` when the generator is NOT told about them: {} of {} generated players ({:.3}%). With the taken-names set supplied: {} clashes.\n",
        stats.raw_nick_clashes,
        n * 5,
        stats.raw_nick_clashes as f64 * 100.0 / (n * 5).max(1) as f64,
        stats.taken_clashes
    );
    let _ = writeln!(
        md,
        "### Runtime\n\n{n} squads (x2 passes) generated in {elapsed_ms} ms.\n"
    );
    if !stats.failures.is_empty() {
        let _ = writeln!(md, "### Failures\n");
        for failure in stats.failures.iter().take(10) {
            let _ = writeln!(md, "- {failure}");
        }
        md.push('\n');
    }

    let superstar_share = any_superstar as f64 * 100.0 / n.max(1) as f64;
    LeagueReport {
        markdown: md,
        summary: (
            league.label.to_string(),
            quantile(&sorted(stats.bill_pct.clone()), 0.5),
            quantile(&sorted(stats.room_pct.clone()), 0.5),
            superstar_share,
        ),
        tier_shares,
        after_release_share,
        renewal_p50: quantile(&sorted(stats.renewal_bill_pct.clone()), 0.5),
        staff_p50: quantile(&sorted(stats.staff_bill_pct.clone()), 0.5),
        budget_p50: quantile(
            &sorted(stats.effective_budget.iter().map(|b| *b as f64).collect()),
            0.5,
        ),
        block_bill_pct,
    }
}

/// Percentiles, budgets and how much of its budget a real peer spends on players.
fn render_peer_reference(
    league: &League,
    peers: &[&Team],
    players: &[Player],
    budget_team: &Team,
) -> (String, f64, f64) {
    let percentiles = peer_ovr_percentiles(peers, players);
    let mut md = format!(
        "# {} ({})\n\nPeers: {} Main teams. Median wage budget: {} (soft cap 110% = {}). Median reputation used for wage pricing: {}.\n\n| p10 | p25 | p50 | p75 | p90 | source |\n|---|---|---|---|---|---|\n| {} | {} | {} | {} | {} | {} |\n\n",
        league.label,
        league.id,
        peers.len(),
        budget_team.wage_budget,
        budget_team.wage_budget * 110 / 100,
        budget_team.reputation,
        percentiles.p10,
        percentiles.p25,
        percentiles.p50,
        percentiles.p75,
        percentiles.p90,
        if percentiles.from_peers {
            "peers"
        } else {
            "FALLBACK"
        }
    );
    let mut priced = players.to_vec();
    apply_default_market_values(&mut priced);
    let _ = writeln!(
        md,
        "Real peer reference (players only, per team with budget > 0):\n\n| team | budget | authored wages / budget | wage-scale price of the roster / budget |\n|---|---|---|---|"
    );
    let (mut authored_pcts, mut scale_pcts) = (Vec::new(), Vec::new());
    for team in peers.iter().filter(|t| t.wage_budget > 0) {
        let roster: Vec<&Player> = priced
            .iter()
            .filter(|p| p.team_id.as_deref() == Some(team.id.as_str()))
            .collect();
        let authored: i64 = roster.iter().map(|p| i64::from(p.wage)).sum();
        let scale: i64 = roster
            .iter()
            .map(|p| {
                i64::from(olm_core::wage_scale::scale_wage_for_market_value(
                    p.market_value,
                ))
            })
            .sum();
        let budget = team.wage_budget as f64;
        let _ = writeln!(
            md,
            "| {} | {} | {:.1}% | {:.1}% |",
            team.name,
            team.wage_budget,
            authored as f64 * 100.0 / budget,
            scale as f64 * 100.0 / budget
        );
        if authored > 0 {
            authored_pcts.push(authored as f64 * 100.0 / budget);
        }
        scale_pcts.push(scale as f64 * 100.0 / budget);
    }
    let authored_p50 = quantile(&sorted(authored_pcts.clone()), 0.5);
    let scale_p50 = quantile(&sorted(scale_pcts), 0.5);
    let _ = writeln!(
        md,
        "\nMedian authored bill: {authored_p50:.1}% of budget ({} teams with authored wages). Median wage-scale roster price: {scale_p50:.1}% of budget.\n",
        authored_pcts.len(),
    );
    (md, authored_p50, scale_p50)
}

/// Tier shares as `OVR >= 80: 49.9%, ...` for one report.
fn tier_summary(report: &LeagueReport) -> String {
    report
        .tier_shares
        .iter()
        .map(|(tier, share)| format!("OVR >= {tier}: {share:.1}%"))
        .collect::<Vec<_>>()
        .join(", ")
}

fn render_recommendations(
    window: &[LeagueReport],
    baselines: &[BaselineRow],
    derived: &[LeagueReport],
    peer_refs: &[(f64, f64)],
) -> String {
    let mut md = String::from("## Recommended constants\n\n");
    let mut worst_block = 0.0f64;
    for (index, report) in window.iter().enumerate() {
        let (label, bill_p50, room_p50, _) = &report.summary;
        let ((_, base_bill, base_room, base_share), block) = &baselines[index];
        let (peer_authored, peer_scale) = peer_refs[index];
        let derived_report = &derived[index];
        let _ = writeln!(
            md,
            "- {label}: baseline (floor wages, median budget) bill p50 {base_bill:.1}% of budget, room {base_room:.1}%, {base_share:.1}% of squads can sign an OVR >= {SUPERSTAR_OVR} free agent on day 1. Real peers spend {peer_authored:.1}% (authored wages) / {peer_scale:.1}% (wage-scale price) of their budget.\n  - Interim window ({}-{}% of the median budget): bill p50 {bill_p50:.1}%, room {room_p50:.1}%; free agents signable at the 85% floor: {}; {:.1}% could sign an OVR >= {SUPERSTAR_OVR} free agent after releasing the top earner; with 3 staff hires the bill is {:.1}% (p50), a year-2 renewal round {:.1}%.\n  - Derived budget (floor wages, budget = bill / 0.{DERIVED_BUDGET_BILL_PCT}, p50 {:.0}): room {:.1}% of that budget; free agents signable at the 85% floor: {}; {:.1}% could sign an OVR >= {SUPERSTAR_OVR} free agent after releasing the top earner; 3 staff hires {:.1}%, year-2 renewals {:.1}%.",
            BILL_WINDOW_PCT.start(),
            BILL_WINDOW_PCT.end(),
            tier_summary(report),
            report.after_release_share,
            report.staff_p50,
            report.renewal_p50,
            derived_report.budget_p50,
            derived_report.summary.2,
            tier_summary(derived_report),
            derived_report.after_release_share,
            derived_report.staff_p50,
            derived_report.renewal_p50,
        );
        if let Some(pct) = block {
            worst_block = worst_block.max(*pct);
            let _ = writeln!(
                md,
                "  - Blocking every OVR >= {SUPERSTAR_OVR} free agent at the 85% negotiation floor needs a bill above {pct:.1}% of the median budget."
            );
        }
    }
    let low = *BILL_WINDOW_PCT.start() as f64;
    let _ = writeln!(
        md,
        "\n1. **OVR window**: keep median-4..median per starter, squad mean about median-1.5 (window median-2..median-1), at most one starter at median+1 (never above p75), weakest >= median-5. The observed squads match (see the OVR tables).\n2. **What is blocked**: no OVR >= 84 free agent (so no OVR >= {SUPERSTAR_OVR} star) is signable on day 1 in either league. Under the interim window the LEC still lets some squads sign an OVR-80 free agent (the LEC median; see the tier lists above); the derived budget blocks OVR >= 80 in both leagues. The guarantee is 'not without moving a starter': releasing the top earner frees enough room for some stars (see 'After releasing').\n3. **Preferred policy (slice 2)**: keep floor-priced wages and give the custom club `wage_budget = founding_wage_budget(squad)` (bill / 0.{DERIVED_BUDGET_BILL_PCT}, rounded up to 10k). Wages stay realistic and the room under the soft cap is about 16% of the bill, independent of the percentage window. Its cost: the club budget is {:.0}-{:.0} per league (see the derived sections), below some peers, so playtest LEC.\n4. **Interim policy**: `BILL_WINDOW_PCT` = {}-{}% of the league-median budget with wages scaled up at most {}x. The worst blocking threshold is {worst_block:.1}% of the median budget, so the window start leaves a margin of {:.1} points. The wages then sit above the wage scale (bill p50 {} of budget vs {:.0}-{:.0}% for real peers), which makes year-2 renewals, staff hires and sales harder.\n5. **Feature-doc bill target**: the old 75-85% target does NOT block the stars (baseline above). Restate it as: the room under the soft cap must stay below the 85% floor of the cheapest OVR >= {SUPERSTAR_OVR} free agent.",
        derived
            .iter()
            .map(|r| r.budget_p50)
            .fold(f64::MAX, f64::min),
        derived.iter().map(|r| r.budget_p50).fold(0.0, f64::max),
        BILL_WINDOW_PCT.start(),
        BILL_WINDOW_PCT.end(),
        olm_core::squad_generator::MAX_WAGE_SCALE_PCT / 100,
        low - worst_block,
        window
            .iter()
            .map(|r| format!("{:.1}%", r.summary.1))
            .collect::<Vec<_>>()
            .join(" / "),
        peer_refs
            .iter()
            .flat_map(|p| [p.0, p.1])
            .filter(|v| *v > 0.0)
            .fold(f64::MAX, f64::min),
        peer_refs.iter().map(|p| p.0.max(p.1)).fold(0.0, f64::max),
    );
    md
}

fn collect_stars(free_agents: &[Player], budget_team: &Team, today: NaiveDate) -> Vec<Star> {
    let mut stars: Vec<Star> = free_agents
        .iter()
        .filter(|p| natural_ovr(p).round() as u8 >= STAR_OVR)
        .map(|p| {
            let price = expected_signing_wage(p, budget_team, today);
            Star {
                name: p.match_name.clone(),
                role: format!("{:?}", p.position),
                ovr: natural_ovr(p).round() as u8,
                market_value: p.market_value,
                price,
                floor_price: wage_floor(price),
            }
        })
        .collect();
    stars.sort_by(|a, b| b.ovr.cmp(&a.ovr).then(a.name.cmp(&b.name)));
    stars
}

#[test]
#[ignore = "calibration run: writes target/olm-scratch/custom-club/calibration.md"]
fn calibrate_founding_squads() {
    let data = repo_data_dir();
    if !data.join("players").join("les_players.json").exists() {
        eprintln!(
            "data directory not found at {}; skipping calibration",
            data.display()
        );
        return;
    }
    let started = Instant::now();
    let today = new_game_start_date(None).date_naive();
    let free_agents = load_free_agents(&data).expect("free agents");

    let mut taken: HashSet<String> = free_agents
        .iter()
        .map(|p| p.match_name.to_lowercase())
        .collect();

    let mut report = String::new();
    let _ = writeln!(
        report,
        "# Founding squad calibration\n\nGenerated by `calibrate_founding_squads`. Start date {today} (year {}), {SQUADS_PER_LEAGUE} seeded squads per league, real data read-only.\n",
        today.year()
    );
    let mut league_reports = Vec::new();
    let mut derived_reports = Vec::new();
    let mut baselines: Vec<BaselineRow> = Vec::new();
    let mut peer_refs: Vec<(f64, f64)> = Vec::new();
    let mut worlds = Vec::new();
    for league in &LEAGUES {
        let world = load_league(&data, league.id).expect("league data");
        taken.extend(world.players.iter().map(|p| p.match_name.to_lowercase()));
        worlds.push(world);
    }

    for (league, world) in LEAGUES.iter().zip(&worlds) {
        let peers: Vec<&Team> = world
            .teams
            .iter()
            .filter(|t| t.team_kind == TeamKind::Main)
            .collect();
        let percentiles = peer_ovr_percentiles(&peers, &world.players);
        let profile = league_median_profile(&peers);
        let mut budget_team = Team::new(
            String::new(),
            String::new(),
            String::new(),
            String::new(),
            String::new(),
            String::new(),
            profile.stadium_capacity,
        );
        budget_team.wage_budget = profile.wage_budget;
        budget_team.reputation = profile.reputation;

        let peer_ids: HashSet<&str> = peers.iter().map(|t| t.id.as_str()).collect();
        let peer_players = world
            .players
            .iter()
            .filter(|p| p.team_id.as_deref().is_some_and(|id| peer_ids.contains(id)))
            .count();
        let stars = collect_stars(&free_agents, &budget_team, today);

        let league_started = Instant::now();
        let (peer_md, peer_authored_p50, peer_scale_p50) =
            render_peer_reference(league, &peers, &world.players, &budget_team);
        report.push_str(&peer_md);
        for (mode, heading, window) in [
            (
                WageMode::Floor,
                format!(
                    "## {} baseline: wages at the wage floor, no bill scaling",
                    league.label
                ),
                DOC_BILL_TARGET_PCT,
            ),
            (
                WageMode::Window,
                format!(
                    "## {} with the bill window ({}-{}% of the median wage budget)",
                    league.label,
                    BILL_WINDOW_PCT.start(),
                    BILL_WINDOW_PCT.end()
                ),
                (
                    *BILL_WINDOW_PCT.start() as f64,
                    *BILL_WINDOW_PCT.end() as f64,
                ),
            ),
            (
                WageMode::Derived,
                format!(
                    "## {} with a derived wage budget (floor wages, budget = bill / 0.{DERIVED_BUDGET_BILL_PCT})",
                    league.label
                ),
                (
                    DERIVED_BUDGET_BILL_PCT as f64 - 1.0,
                    DERIVED_BUDGET_BILL_PCT as f64,
                ),
            ),
        ] {
            let stats = run_league(
                league,
                percentiles,
                &budget_team,
                &taken,
                &stars,
                today,
                mode,
            );
            let elapsed = league_started.elapsed().as_millis();
            assert!(
                stats.failures.is_empty(),
                "{}: generation failures: {:?}",
                league.label,
                stats.failures
            );
            let rendered = render_league(
                &heading,
                mode,
                false,
                window,
                league,
                percentiles,
                &budget_team,
                peers.len(),
                peer_players,
                &stars,
                &stats,
                elapsed,
            );
            report.push_str(&rendered.markdown);
            match mode {
                WageMode::Floor => {
                    baselines.push((rendered.summary.clone(), rendered.block_bill_pct));
                }
                WageMode::Window | WageMode::Derived => {
                    assert!(
                        stats.superstars_signable.iter().all(|count| *count == 0),
                        "{}: the bill must keep OVR >= {SUPERSTAR_OVR} free agents out of reach on day 1",
                        league.label
                    );
                    if mode == WageMode::Window {
                        league_reports.push(rendered);
                        peer_refs.push((peer_authored_p50, peer_scale_p50));
                    } else {
                        derived_reports.push(rendered);
                    }
                }
            }
        }
    }

    report.push_str(&render_recommendations(
        &league_reports,
        &baselines,
        &derived_reports,
        &peer_refs,
    ));
    let _ = writeln!(
        report,
        "\nTotal harness runtime: {} ms.",
        started.elapsed().as_millis()
    );

    let path = scratch_report_path();
    std::fs::create_dir_all(path.parent().expect("report dir")).expect("create report dir");
    std::fs::write(&path, &report).expect("write report");
    println!("{report}");
    println!("report written to {}", path.display());
}
