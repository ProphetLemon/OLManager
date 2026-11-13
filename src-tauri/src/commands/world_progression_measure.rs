//! Headless world measurement (ignored): plays a stretch of a real new game day by day
//! through `turn::process_day` (every fixture, the user's included, runs in the
//! background engine) and prints how the world moved.
//!
//! Run it in release, once per engine revision, and compare the printed tables:
//!
//! ```text
//! OLM_MEASURE_DAYS=140 OLM_MEASURE_REPS=6 \
//!   cargo test --release -p openleaguemanager --lib -- --ignored \
//!   world_progression_measure --nocapture
//! ```
//!
//! The starting world is built once and cloned for every replicate, so all replicates
//! of all revisions start from the same state. The match engine and several world
//! systems draw from the thread RNG, which cannot be seeded from a test, so replicates
//! differ by that noise; compare means with the spread across replicates.

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Instant;

use olm_core::ai_rotation::REST_BELOW;
use olm_core::competitions::competition_id_from_team_id_known;
use olm_core::domain::league::{FixtureStatus, MatchType};
use olm_core::domain::player::Player;
use olm_core::domain::stats::LolRole;
use olm_core::domain::team::TeamKind;
use olm_core::game::Game;
use olm_core::season_awards::compute_season_awards;
use olm_core::turn;

use super::game::{NewGameWorldInputs, build_new_game_world, prepare_new_game_season};

const USER_SLOT: &str = "lec-movistar-koi";
const ROLE_NAMES: [&str; 5] = ["Top", "Jungle", "Mid", "ADC", "Support"];
const ATTR_NAMES: [&str; 9] = [
    "mechanics",
    "laning",
    "teamfighting",
    "mental_resilience",
    "champion_pool",
    "macro_play",
    "consistency",
    "discipline",
    "shotcalling",
];
/// Attributes `apply_lol_profile_progression` moves, in `ATTR_NAMES` order.
const TOUCHED: [usize; 6] = [1, 2, 3, 5, 7, 8];
/// Matches a player needs in the stretch to enter the attribute and rating tables.
const MIN_GAMES: u32 = 3;

fn role_index(role: LolRole) -> Option<usize> {
    match role {
        LolRole::Top => Some(0),
        LolRole::Jungle => Some(1),
        LolRole::Mid => Some(2),
        LolRole::Adc => Some(3),
        LolRole::Support => Some(4),
        LolRole::Unknown => None,
    }
}

fn attrs_of(player: &Player) -> [u8; 9] {
    let a = &player.attributes;
    [
        a.mechanics,
        a.laning,
        a.teamfighting,
        a.mental_resilience,
        a.champion_pool,
        a.macro_play,
        a.consistency,
        a.discipline,
        a.shotcalling,
    ]
}

fn env_number(name: &str, default: u32) -> u32 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

fn mean(values: &[f64]) -> f64 {
    if values.is_empty() {
        0.0
    } else {
        values.iter().sum::<f64>() / values.len() as f64
    }
}

fn sd(values: &[f64]) -> f64 {
    if values.len() < 2 {
        return 0.0;
    }
    let m = mean(values);
    (values.iter().map(|v| (v - m).powi(2)).sum::<f64>() / (values.len() - 1) as f64).sqrt()
}

#[derive(Clone)]
struct Snap {
    team: Option<String>,
    role: Option<usize>,
    attrs: [u8; 9],
    morale: u8,
    condition: u8,
    appearances: u32,
    listed: bool,
    renewal_open: bool,
    contract_end: Option<String>,
}

fn snapshot(game: &Game) -> HashMap<String, Snap> {
    game.players
        .iter()
        .map(|p| {
            (
                p.id.clone(),
                Snap {
                    team: p.team_id.clone(),
                    role: role_index(p.natural_position),
                    attrs: attrs_of(p),
                    morale: p.morale,
                    condition: p.condition,
                    appearances: p.stats.appearances,
                    listed: p.transfer_listed,
                    renewal_open: p.morale_core.renewal_state.as_ref().is_some_and(|s| {
                        s.status == olm_core::domain::player::RenewalSessionStatus::Open
                    }),
                    contract_end: p.contract_end.clone(),
                },
            )
        })
        .collect()
}

/// Lineups of the AI main teams the rotation applies to.
fn rotated_lineups(game: &Game) -> HashMap<String, Vec<String>> {
    let user = game.manager.team_id.as_deref();
    game.teams
        .iter()
        .filter(|t| {
            t.team_kind == TeamKind::Main
                && t.manager_id.is_none()
                && user != Some(t.id.as_str())
                && t.active_lineup_ids.len() == 5
        })
        .map(|t| (t.id.clone(), t.active_lineup_ids.clone()))
        .collect()
}

#[derive(Default)]
struct Counts {
    club_to_club: u32,
    released_or_expired: u32,
    signed_from_free: u32,
    newly_listed_ai: u32,
    renewal_offers_ai: u32,
    contract_extensions_ai: u32,
    user_team_moves: u32,
}

#[derive(Default)]
struct Rotation {
    swaps: u32,
    swaps_out_tired: u32,
    swaps_back: u32,
    ai_team_days: u32,
    team_days_off_baseline: u32,
    starter_days: u32,
    starter_days_below_rest: u32,
    condition_sum: f64,
    lowest: u8,
}

struct Row {
    user: bool,
    role: usize,
    delta: [i16; 9],
    morale_start: u8,
    morale_end: u8,
    rating: f32,
    games: u32,
}

struct AwardRow {
    category: &'static str,
    role: Option<usize>,
    value: f64,
    rank: usize,
}

struct Rep {
    rows: Vec<Row>,
    counts: Counts,
    rotation: Rotation,
    awards: Vec<AwardRow>,
    seconds: f64,
    end_date: String,
    league_done: usize,
    league_total: usize,
    /// Completed fixtures of the user's league by type, with the last played date.
    league_note: String,
}

fn run_stretch(mut game: Game, days: u32) -> Rep {
    let started = Instant::now();
    let start = snapshot(&game);
    let baseline = rotated_lineups(&game);
    let user_team = game.manager.team_id.clone();
    let main_teams: HashMap<String, bool> = game
        .teams
        .iter()
        .map(|t| (t.id.clone(), t.team_kind == TeamKind::Main))
        .collect();
    let mut prev = start.clone();
    let mut prev_lineups = baseline.clone();
    let mut counts = Counts::default();
    let mut rotation = Rotation {
        lowest: 100,
        ..Rotation::default()
    };

    for _ in 0..days {
        turn::process_day(&mut game);
        let cur = snapshot(&game);

        for (id, now) in &cur {
            let Some(before) = prev.get(id) else { continue };
            let involves_user =
                user_team.is_some() && (before.team == user_team || now.team == user_team);
            match (&before.team, &now.team) {
                (Some(a), Some(b)) if a != b => {
                    counts.club_to_club += 1;
                    counts.user_team_moves += u32::from(involves_user);
                }
                (Some(_), None) => {
                    counts.released_or_expired += 1;
                    counts.user_team_moves += u32::from(involves_user);
                }
                (None, Some(_)) => {
                    counts.signed_from_free += 1;
                    counts.user_team_moves += u32::from(involves_user);
                }
                _ => {}
            }
            let ai_player = now.team.is_some()
                && now.team != user_team
                && now
                    .team
                    .as_ref()
                    .is_some_and(|t| main_teams.get(t).copied().unwrap_or(false));
            if ai_player {
                counts.newly_listed_ai += u32::from(!before.listed && now.listed);
                counts.renewal_offers_ai += u32::from(!before.renewal_open && now.renewal_open);
                if before.team == now.team && before.contract_end != now.contract_end {
                    counts.contract_extensions_ai += 1;
                }
            }
        }

        let lineups = rotated_lineups(&game);
        for (team_id, lineup) in &lineups {
            rotation.ai_team_days += 1;
            if baseline.get(team_id).is_some_and(|b| {
                let mut a = b.clone();
                let mut c = lineup.clone();
                a.sort();
                c.sort();
                a != c
            }) {
                rotation.team_days_off_baseline += 1;
            }
            for id in lineup {
                if let Some(p) = cur.get(id) {
                    rotation.starter_days += 1;
                    rotation.condition_sum += f64::from(p.condition);
                    rotation.lowest = rotation.lowest.min(p.condition);
                    rotation.starter_days_below_rest += u32::from(p.condition < REST_BELOW);
                }
            }
            let Some(before) = prev_lineups.get(team_id) else {
                continue;
            };
            for (slot, id) in lineup.iter().enumerate() {
                // A member who only changed slots is a reorder, not a rotation.
                if before.contains(id) {
                    continue;
                }
                let (Some(old), Some(new)) = (cur.get(&before[slot]), cur.get(id)) else {
                    continue;
                };
                if old.team.as_ref() == Some(team_id) && new.team.as_ref() == Some(team_id) {
                    rotation.swaps += 1;
                    if old.condition < REST_BELOW {
                        rotation.swaps_out_tired += 1;
                    } else {
                        rotation.swaps_back += 1;
                    }
                }
            }
        }
        prev_lineups = lineups;
        prev = cur;
    }

    let rows = game
        .players
        .iter()
        .filter_map(|p| {
            let before = start.get(&p.id)?;
            let team = before.team.as_ref()?;
            if !main_teams.get(team).copied().unwrap_or(false) {
                return None;
            }
            let games = p.stats.appearances.saturating_sub(before.appearances);
            if games < MIN_GAMES {
                return None;
            }
            let now = attrs_of(p);
            let mut delta = [0i16; 9];
            for (slot, d) in delta.iter_mut().enumerate() {
                *d = i16::from(now[slot]) - i16::from(before.attrs[slot]);
            }
            Some(Row {
                user: user_team.as_ref() == Some(team),
                role: before.role?,
                delta,
                morale_start: before.morale,
                morale_end: p.morale,
                rating: p.stats.avg_rating,
                games,
            })
        })
        .collect();

    let role_of: HashMap<&str, Option<usize>> = game
        .players
        .iter()
        .map(|p| (p.id.as_str(), role_index(p.natural_position)))
        .collect();
    let awards = compute_season_awards(&game);
    let mut award_rows = Vec::new();
    for (category, entries) in [
        ("golden_boot", &awards.golden_boot),
        ("assist_king", &awards.assist_king),
        ("player_of_year", &awards.player_of_year),
        ("most_appearances", &awards.most_appearances),
        ("young_player", &awards.young_player),
    ] {
        for (rank, entry) in entries.iter().enumerate() {
            award_rows.push(AwardRow {
                category,
                role: role_of.get(entry.player_id.as_str()).copied().flatten(),
                value: entry.value,
                rank,
            });
        }
    }

    let (league_done, league_total) = game.active_league().map_or((0, 0), |l| {
        (
            l.fixtures
                .iter()
                .filter(|f| f.status == FixtureStatus::Completed)
                .count(),
            l.fixtures.len(),
        )
    });

    let league_note = game.active_league().map_or_else(String::new, |l| {
        let completed = |kind: MatchType| {
            l.fixtures
                .iter()
                .filter(|f| f.status == FixtureStatus::Completed && f.match_type == kind)
                .count()
        };
        let last = l
            .fixtures
            .iter()
            .filter(|f| f.status == FixtureStatus::Completed)
            .map(|f| f.date.as_str())
            .max()
            .unwrap_or("-");
        format!(
            "league {} / playoffs {} / friendlies {} / preseason {} completed, last played {last}",
            completed(MatchType::League),
            completed(MatchType::Playoffs),
            completed(MatchType::Friendly),
            completed(MatchType::PreseasonTournament)
        )
    });

    Rep {
        rows,
        counts,
        rotation,
        awards: award_rows,
        seconds: started.elapsed().as_secs_f64(),
        end_date: game.clock.current_date.format("%Y-%m-%d").to_string(),
        league_done,
        league_total,
        league_note,
    }
}

fn data_base() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("data")
}

fn build_start_world() -> Game {
    let data = data_base();
    let manifests = olm_core::competitions::scan_competitions(&data.join("competitions"));
    let known: Vec<String> = manifests
        .iter()
        .filter(|m| !m.legacy)
        .map(|m| m.id.clone())
        .collect();
    let clock = olm_core::clock::GameClock::new(
        chrono::TimeZone::with_ymd_and_hms(&chrono::Utc, 2026, 1, 1, 0, 0, 0)
            .single()
            .expect("valid start"),
    );
    let manager = olm_core::domain::manager::Manager::new(
        "mgr_user".to_string(),
        "Test".to_string(),
        "Manager".to_string(),
        "1990-01-01".to_string(),
        "KR".to_string(),
    );
    let mut game = Game::new(clock, manager, vec![], vec![], vec![], vec![]);
    let overlay = olm_core::world_overlay::bundled_world_overlay().expect("bundled overlay");
    let competition_id =
        competition_id_from_team_id_known(USER_SLOT, &known).expect("competition prefix");
    let team_id = build_new_game_world(
        &mut game,
        &NewGameWorldInputs {
            data_dir: &data,
            manifests: &manifests,
            competition_id,
            team_id: USER_SLOT,
            overlay: Some(&overlay),
            custom_team: None,
            joins_league: false,
        },
    )
    .expect("world");
    prepare_new_game_season(&mut game, &manifests, &known, &team_id).expect("season");
    game
}

fn print_report(reps: &[Rep], days: u32) {
    println!("=== STRETCH: {days} days, {} replicates ===", reps.len());
    for (i, rep) in reps.iter().enumerate() {
        println!(
            "rep {i}: ends {}, user league fixtures completed {}/{} ({}), {:.1}s, {} measured players",
            rep.end_date,
            rep.league_done,
            rep.league_total,
            rep.league_note,
            rep.seconds,
            rep.rows.len()
        );
    }

    for (label, user) in [("AI Main-team players", false), ("USER team players", true)] {
        println!("\n--- 1. attribute deltas, {label} (played >= {MIN_GAMES} matches) ---");
        println!(
            "{:<8} {:>5} {:>6} | {}",
            "role",
            "n",
            "games",
            TOUCHED
                .iter()
                .map(|a| format!("{:>22}", ATTR_NAMES[*a]))
                .collect::<Vec<_>>()
                .join(" ")
        );
        println!("(cells: mean / pooled sd / sd of replicate means)");
        for role in 0..5 {
            let per_rep: Vec<Vec<&Row>> = reps
                .iter()
                .map(|r| {
                    r.rows
                        .iter()
                        .filter(|x| x.user == user && x.role == role)
                        .collect()
                })
                .collect();
            let all: Vec<&Row> = per_rep.iter().flatten().copied().collect();
            let games = mean(&all.iter().map(|r| f64::from(r.games)).collect::<Vec<_>>());
            let cells = TOUCHED
                .iter()
                .map(|a| {
                    let pooled: Vec<f64> = all.iter().map(|r| f64::from(r.delta[*a])).collect();
                    let rep_means: Vec<f64> = per_rep
                        .iter()
                        .filter(|rows| !rows.is_empty())
                        .map(|rows| {
                            mean(
                                &rows
                                    .iter()
                                    .map(|r| f64::from(r.delta[*a]))
                                    .collect::<Vec<_>>(),
                            )
                        })
                        .collect();
                    format!(
                        "{:>+7.2}/{:>5.2}/{:>5.2}   ",
                        mean(&pooled),
                        sd(&pooled),
                        sd(&rep_means)
                    )
                })
                .collect::<Vec<_>>()
                .join(" ");
            println!(
                "{:<8} {:>5} {:>6.1} | {cells}",
                ROLE_NAMES[role],
                all.len(),
                games
            );
        }
        let untouched = [0usize, 4, 6];
        let line = untouched
            .iter()
            .map(|a| {
                let pooled: Vec<f64> = reps
                    .iter()
                    .flat_map(|r| r.rows.iter().filter(|x| x.user == user))
                    .map(|r| f64::from(r.delta[*a]))
                    .collect();
                format!("{} {:+.2}", ATTR_NAMES[*a], mean(&pooled))
            })
            .collect::<Vec<_>>()
            .join(", ");
        println!("untouched attributes, all roles, mean delta: {line}");
    }

    println!("\n--- 2. morale at the end (cap 100; players who played >= {MIN_GAMES}) ---");
    for (label, user) in [("AI", false), ("USER", true)] {
        let rows: Vec<&Row> = reps
            .iter()
            .flat_map(|r| r.rows.iter().filter(|x| x.user == user))
            .collect();
        if rows.is_empty() {
            continue;
        }
        let end: Vec<f64> = rows.iter().map(|r| f64::from(r.morale_end)).collect();
        let start: Vec<f64> = rows.iter().map(|r| f64::from(r.morale_start)).collect();
        let at_cap = rows.iter().filter(|r| r.morale_end >= 100).count();
        let buckets = [
            (0u8, 29u8),
            (30, 49),
            (50, 69),
            (70, 89),
            (90, 99),
            (100, 100),
        ];
        let hist = buckets
            .iter()
            .map(|(lo, hi)| {
                let n = rows
                    .iter()
                    .filter(|r| r.morale_end >= *lo && r.morale_end <= *hi)
                    .count();
                format!("{lo}-{hi}: {:.1}%", 100.0 * n as f64 / rows.len() as f64)
            })
            .collect::<Vec<_>>()
            .join("  ");
        println!(
            "{label:<5} n={:<5} start mean {:.1}, end mean {:.1} sd {:.1}, at cap {} ({:.1}%) | {hist}",
            rows.len(),
            mean(&start),
            mean(&end),
            sd(&end),
            at_cap,
            100.0 * at_cap as f64 / rows.len() as f64
        );
    }

    println!("\n--- 3. avg_rating per role (players with >= {MIN_GAMES} matches) ---");
    for (label, user) in [("AI", false), ("USER", true)] {
        let cells = (0..5)
            .map(|role| {
                let vals: Vec<f64> = reps
                    .iter()
                    .flat_map(|r| r.rows.iter().filter(|x| x.user == user && x.role == role))
                    .map(|r| f64::from(r.rating))
                    .collect();
                format!(
                    "{} {:.2} (sd {:.2}, n {})",
                    ROLE_NAMES[role],
                    mean(&vals),
                    sd(&vals),
                    vals.len()
                )
            })
            .collect::<Vec<_>>()
            .join(" | ");
        println!("{label:<5} {cells}");
    }

    println!(
        "\n--- 4. AI transfer and retention decisions (summed over the stretch, per replicate mean) ---"
    );
    let per = |f: fn(&Counts) -> u32| {
        let v: Vec<f64> = reps.iter().map(|r| f64::from(f(&r.counts))).collect();
        format!("{:.1} (sd {:.1})", mean(&v), sd(&v))
    };
    println!(
        "newly transfer-listed AI players (sales): {}",
        per(|c| c.newly_listed_ai)
    );
    println!(
        "renewal sessions opened by AI clubs (retentions): {}",
        per(|c| c.renewal_offers_ai)
    );
    println!(
        "AI contract extensions (same club, new end date): {}",
        per(|c| c.contract_extensions_ai)
    );
    println!("club-to-club moves: {}", per(|c| c.club_to_club));
    println!(
        "released or expired to free agency: {}",
        per(|c| c.released_or_expired)
    );
    println!("signed from free agency: {}", per(|c| c.signed_from_free));
    println!(
        "moves involving the user team: {}",
        per(|c| c.user_team_moves)
    );

    println!(
        "\n--- 5. awards at the end of the stretch (top 5 per category, pooled over replicates) ---"
    );
    for category in [
        "golden_boot",
        "assist_king",
        "player_of_year",
        "most_appearances",
        "young_player",
    ] {
        let rows: Vec<&AwardRow> = reps
            .iter()
            .flat_map(|r| r.awards.iter().filter(|a| a.category == category))
            .collect();
        let winners: Vec<&&AwardRow> = rows.iter().filter(|a| a.rank == 0).collect();
        let winner_roles = (0..5)
            .map(|role| {
                let n = winners.iter().filter(|a| a.role == Some(role)).count();
                format!("{} {n}", ROLE_NAMES[role])
            })
            .collect::<Vec<_>>()
            .join(", ");
        let top5_roles = (0..5)
            .map(|role| {
                let n = rows.iter().filter(|a| a.role == Some(role)).count();
                format!("{} {n}", ROLE_NAMES[role])
            })
            .collect::<Vec<_>>()
            .join(", ");
        let winner_values: Vec<f64> = winners.iter().map(|a| a.value).collect();
        let entries = rows.len() as f64 / reps.len() as f64;
        println!(
            "{category:<17} entries/rep {entries:.1}, winner value mean {:.2} | winners by role: {winner_roles} | top-5 by role: {top5_roles}",
            mean(&winner_values)
        );
    }

    println!("\n--- 6. AI rotation (AI main teams, daily, after rotation) ---");
    let rot = |f: fn(&Rotation) -> f64| {
        let v: Vec<f64> = reps.iter().map(|r| f(&r.rotation)).collect();
        format!("{:.2} (sd {:.2})", mean(&v), sd(&v))
    };
    println!(
        "lineup substitutions per replicate (a new player in the starting five): {}",
        rot(|r| f64::from(r.swaps))
    );
    println!(
        "  of which resting a starter below {REST_BELOW}: {}",
        rot(|r| f64::from(r.swaps_out_tired))
    );
    println!(
        "  of which a rested player returning: {}",
        rot(|r| f64::from(r.swaps_back))
    );
    println!("AI team-days: {}", rot(|r| f64::from(r.ai_team_days)));
    println!(
        "team-days with a lineup that differs from day 0: {}",
        rot(|r| f64::from(r.team_days_off_baseline))
    );
    println!(
        "starter mean condition: {}",
        rot(|r| if r.starter_days == 0 {
            0.0
        } else {
            r.condition_sum / f64::from(r.starter_days)
        })
    );
    println!(
        "starter-days below {REST_BELOW} after rotation (tired, not rested): {} of {}",
        rot(|r| f64::from(r.starter_days_below_rest)),
        rot(|r| f64::from(r.starter_days))
    );
    println!(
        "lowest starter condition seen: min {} over replicates",
        reps.iter().map(|r| r.rotation.lowest).min().unwrap_or(0)
    );
}

#[test]
#[ignore = "measurement: prints a before/after table, run it explicitly in release"]
fn world_progression_measure() {
    let days = env_number("OLM_MEASURE_DAYS", 140);
    let reps = env_number("OLM_MEASURE_REPS", 4) as usize;
    let threads = env_number("OLM_MEASURE_THREADS", 3) as usize;
    let build_started = Instant::now();
    let mut world = build_start_world();
    // Optional: start every player at this morale, so drift is visible below the cap.
    if let Some(start_morale) = std::env::var("OLM_MEASURE_START_MORALE")
        .ok()
        .and_then(|value| value.parse::<u8>().ok())
    {
        for player in &mut world.players {
            player.morale = start_morale;
        }
        println!("all players start at morale {start_morale}");
    }
    println!(
        "world built in {:.1}s: {} teams, {} players, starts {}, user team {:?}",
        build_started.elapsed().as_secs_f64(),
        world.teams.len(),
        world.players.len(),
        world.clock.current_date.format("%Y-%m-%d"),
        world.manager.team_id
    );
    let started = Instant::now();
    let mut results: Vec<Rep> = Vec::new();
    let mut remaining = reps;
    while remaining > 0 {
        let batch = remaining.min(threads);
        let finished: Vec<Rep> = std::thread::scope(|scope| {
            let handles: Vec<_> = (0..batch)
                .map(|_| {
                    let copy = world.clone();
                    scope.spawn(move || run_stretch(copy, days))
                })
                .collect();
            handles
                .into_iter()
                .map(|h| h.join().expect("replicate thread"))
                .collect()
        });
        results.extend(finished);
        remaining -= batch;
    }
    print_report(&results, days);
    println!("\ntotal wall time {:.1}s", started.elapsed().as_secs_f64());
}
