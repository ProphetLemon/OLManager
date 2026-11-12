//! The balance scorecard of the live match: eleven targets, one command.
//!
//! `print_balance_scorecard` plays seeded matches the way the watched match is
//! driven (one fixed step per `tick`, macro decisions on every step; see
//! `tower_harness_tests::drive_match`) and prints one table: the target, the
//! measured value and whether it is met. It changes no rule; every number it
//! prints comes from the state of the match, the gold ledger and the tower
//! ledger.
//!
//! ```text
//! SCORECARD_PROFILE=quick SCORECARD_OUT=target/sim-balance/quick.txt \
//!   cargo test --release -p olm_core --lib \
//!   sim_live::scorecard_tests::print_balance_scorecard -- --ignored --nocapture
//! ```
//!
//! Profiles (`SCORECARD_PROFILE`): `quick` (default) plays 60 even matches and 20
//! each of 80 vs 60 and 95 vs 40, and 20 objective matches; it is what a rule
//! change is iterated with. `full` plays 300 even matches, 200 at 80 vs 60, 144 at
//! 95 vs 40, the 1,000-match side test and 100 objective matches; it closes a
//! milestone. `SCORECARD_EVEN`, `SCORECARD_MODERATE`, `SCORECARD_EXTREME`, `SCORECARD_SIDES`,
//! `SCORECARD_TANKS` and `SCORECARD_OBJECTIVES` override the counts of the profile. `SCORECARD_OUT` also writes the table to a file. The strength
//! assertions of `strength_tests::stronger_team_wins_at_least` (skip path) and
//! the default tests (T11) are separate commands.
//!
//! Teams are even (70 vs 70) unless the row says otherwise. In uneven runs team A
//! is the stronger side and plays blue in even seeds and red in odd seeds.

use std::fmt::Write as _;
use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};

use super::economy_tests::{Side, EARLY_ROLE_SHARE_RANGE, ROLES, ROLE_SHARE_RANGE};
use super::gold_ledger::GoldSource;
use super::objectives_detector_tests::objective_score;
use super::tower_harness_tests::{drive_match, run_tower_tracked, Config, TowerScore};
use super::TowerVictim;
use super::*;

const MINUTE_15_SEC: f64 = 900.0;
/// Step limit of a full match, in game seconds (6,000 steps of 0.6 s).
const STEP_LIMIT_SEC: f64 = 3600.0;
const LANERS: [&str; 3] = ["TOP", "MID", "ADC"];
/// Team gold per minute at minute 15 that item prices are tuned to.
const TEAM_GOLD_PER_MIN_15: f64 = 1060.0;
const SHOTS_NON_TANK_MAX: f64 = 8.0;
const SHOTS_TANK_MAX: f64 = 14.0;
/// Kills a team may lead by and still lose the match.
const BIG_LEAD_KILLS: i64 = 20;
/// Largest role income weight the economy may use.
const ROLE_WEIGHT_MAX: f64 = 2.0;

struct Profile {
    name: &'static str,
    even: usize,
    moderate: usize,
    extreme: usize,
    /// Separate light matches for the side test; `0` reuses the even matches.
    sides: usize,
    /// Even matches with a tank top laner and jungler, for the tank rows of T9.
    tanks: usize,
    objectives: usize,
}

fn profile_from_env() -> Profile {
    let mut profile = named_profile();
    let override_count = |name: &str, slot: &mut usize| {
        if let Some(count) = std::env::var(name).ok().and_then(|raw| raw.parse().ok()) {
            *slot = count;
        }
    };
    override_count("SCORECARD_EVEN", &mut profile.even);
    override_count("SCORECARD_MODERATE", &mut profile.moderate);
    override_count("SCORECARD_EXTREME", &mut profile.extreme);
    override_count("SCORECARD_SIDES", &mut profile.sides);
    override_count("SCORECARD_TANKS", &mut profile.tanks);
    override_count("SCORECARD_OBJECTIVES", &mut profile.objectives);
    profile
}

fn named_profile() -> Profile {
    match std::env::var("SCORECARD_PROFILE").as_deref() {
        Ok("mini") => Profile {
            name: "mini",
            even: 24,
            moderate: 8,
            extreme: 8,
            sides: 0,
            tanks: 0,
            objectives: 0,
        },
        Ok("full") => Profile {
            name: "full",
            even: 300,
            moderate: 200,
            extreme: 144,
            sides: 1000,
            tanks: 40,
            objectives: 100,
        },
        _ => Profile {
            name: "quick",
            even: 60,
            moderate: 20,
            extreme: 20,
            sides: 0,
            tanks: 10,
            objectives: 20,
        },
    }
}

/// Runs `job(0..count)` on every available core and returns the results in order.
fn par_map<T: Send>(count: usize, job: impl Fn(usize) -> T + Sync) -> Vec<T> {
    let workers = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .min(count.max(1));
    let next = AtomicUsize::new(0);
    let mut done: Vec<(usize, T)> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..workers)
            .map(|_| {
                scope.spawn(|| {
                    let mut mine = Vec::new();
                    loop {
                        let i = next.fetch_add(1, AtomicOrdering::Relaxed);
                        if i >= count {
                            break;
                        }
                        mine.push((i, job(i)));
                    }
                    mine
                })
            })
            .collect();
        handles
            .into_iter()
            .flat_map(|handle| handle.join().expect("scorecard worker"))
            .collect()
    });
    done.sort_by_key(|(i, _)| *i);
    done.into_iter().map(|(_, value)| value).collect()
}

// ------------------------------------------------------------- observation

/// Facts about every champion at minute 15, in champion order.
struct At15 {
    cs: Vec<i64>,
    earned: Vec<i64>,
    /// Gold earned since the start, starting purse excluded.
    income: Vec<i64>,
    towers_down: i64,
    max_hp: Vec<f64>,
    /// Gold earned so far by source (`GoldSource::index` order).
    gold_by_source: Vec<[i64; GoldSource::COUNT]>,
    /// Health taken so far from champions, minions, towers and anything else.
    damage: Vec<[f64; 4]>,
}

#[derive(Default)]
struct Obs {
    start_earned: Vec<i64>,
    was_recalling: Vec<bool>,
    /// Recalls begun before minute 15, per champion.
    recalls: Vec<u32>,
    /// The same recalls by cause: the next item was affordable, low health, anything else.
    recall_causes: Vec<[u32; 3]>,
    at15: Option<At15>,
}

impl Obs {
    fn observe(&mut self, rt: &RuntimeState) {
        let earned = |c: &ChampionRuntime| c.gold + c.spent_gold;
        if self.start_earned.is_empty() {
            self.start_earned = rt.champions.iter().map(earned).collect();
            self.was_recalling = vec![false; rt.champions.len()];
            self.recalls = vec![0; rt.champions.len()];
            self.recall_causes = vec![[0; 3]; rt.champions.len()];
        }
        if rt.time_sec <= MINUTE_15_SEC {
            for (i, champion) in rt.champions.iter().enumerate() {
                let recalling = champion.alive && champion.state == "recall";
                if recalling && !self.was_recalling[i] {
                    self.recalls[i] += 1;
                    let cause = if champion_can_afford_next_item(champion) {
                        0
                    } else if champion.hp / champion.max_hp.max(1.0) <= RECALL_TRIGGER_HP_RATIO {
                        1
                    } else {
                        2
                    };
                    self.recall_causes[i][cause] += 1;
                }
                self.was_recalling[i] = recalling;
            }
        }
        if self.at15.is_none() && rt.time_sec >= MINUTE_15_SEC {
            self.at15 = Some(At15 {
                cs: rt.champions.iter().map(|c| c.cs).collect(),
                earned: rt.champions.iter().map(earned).collect(),
                income: rt
                    .champions
                    .iter()
                    .zip(&self.start_earned)
                    .map(|(c, start)| earned(c) - start)
                    .collect(),
                towers_down: rt.stats.blue.towers + rt.stats.red.towers,
                max_hp: rt.champions.iter().map(|c| c.max_hp).collect(),
                gold_by_source: rt
                    .champions
                    .iter()
                    .map(|c| rt.gold_ledger.tally(&c.id).gold)
                    .collect(),
                damage: rt
                    .champions
                    .iter()
                    .map(|c| {
                        [
                            DamageSource::Champion,
                            DamageSource::Minion,
                            DamageSource::Tower,
                            DamageSource::Other,
                        ]
                        .map(|source| {
                            rt.farm_ledger
                                .damage()
                                .get(&(c.id.clone(), source))
                                .copied()
                                .unwrap_or(0.0)
                        })
                    })
                    .collect(),
            });
        }
    }
}

struct Member {
    role: String,
    blue: bool,
    earned_end: i64,
    kill_gold: i64,
    kill_grants: i64,
}

struct Played {
    seed: usize,
    /// Towers and Barons taken by blue and red.
    blue_objectives: (i64, i64),
    red_objectives: (i64, i64),
    winner_blue: Option<bool>,
    a_is_blue: bool,
    minutes: f64,
    blue_kills: i64,
    red_kills: i64,
    members: Vec<Member>,
    obs: Obs,
    tower: Option<TowerScore>,
}

impl Played {
    fn kills(&self) -> i64 {
        self.blue_kills + self.red_kills
    }

    fn team_a_won(&self) -> Option<bool> {
        self.winner_blue.map(|blue| blue == self.a_is_blue)
    }

    /// Indices of the blue and the red champion of `role`.
    fn pair(&self, role: &str) -> (usize, usize) {
        let find = |blue: bool| {
            self.members
                .iter()
                .position(|m| m.role == role && m.blue == blue)
                .expect("role on both teams")
        };
        (find(true), find(false))
    }
}

fn play(seed: usize, team_a: Side, team_b: Side, tracked: bool) -> Played {
    play_with(seed, team_a, team_b, tracked, Config::watched(STEP_LIMIT_SEC))
}

fn play_with(seed: usize, team_a: Side, team_b: Side, tracked: bool, cfg: Config) -> Played {
    let a_is_blue = seed.is_multiple_of(2);
    let (blue, red) = if a_is_blue {
        (team_a, team_b)
    } else {
        (team_b, team_a)
    };
    let name = format!("scorecard-{seed}");
    let mut obs = Obs::default();
    let (tower, state) = if tracked {
        let (score, state) = run_tower_tracked(&name, blue, red, cfg, |rt| obs.observe(rt));
        (Some(score), state)
    } else {
        (None, drive_match(&name, blue, red, cfg, |rt| obs.observe(rt)))
    };
    let members = state
        .champions
        .iter()
        .map(|c| {
            let tally = state.gold_ledger.tally(&c.id);
            Member {
                role: c.role.clone(),
                blue: c.team == "blue",
                earned_end: c.gold + c.spent_gold,
                kill_gold: tally.gold[GoldSource::Kill.index()],
                kill_grants: tally.grants[GoldSource::Kill.index()],
            }
        })
        .collect();
    Played {
        seed,
        blue_objectives: (state.stats.blue.towers, state.stats.blue.barons),
        red_objectives: (state.stats.red.towers, state.stats.red.barons),
        winner_blue: state.winner.as_deref().map(|w| w == "blue"),
        a_is_blue,
        minutes: state.time_sec / 60.0,
        blue_kills: state.stats.blue.kills,
        red_kills: state.stats.red.kills,
        members,
        obs,
        tower,
    }
}

// -------------------------------------------------------------- statistics

fn mean(values: &[f64]) -> f64 {
    if values.is_empty() {
        f64::NAN
    } else {
        values.iter().sum::<f64>() / values.len() as f64
    }
}

fn percentile(values: &[f64], p: f64) -> f64 {
    if values.is_empty() {
        return f64::NAN;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let rank = ((p * sorted.len() as f64).ceil() as usize).clamp(1, sorted.len());
    sorted[rank - 1]
}

fn pct(part: usize, whole: usize) -> f64 {
    if whole == 0 {
        f64::NAN
    } else {
        100.0 * part as f64 / whole as f64
    }
}

fn within(value: f64, low: f64, high: f64) -> bool {
    (low..=high).contains(&value)
}

// ------------------------------------------------------------------- table

struct Scorecard {
    rows: Vec<(String, String, String, String, Option<bool>)>,
}

impl Scorecard {
    fn add(&mut self, id: &str, what: &str, target: &str, got: String, ok: Option<bool>) {
        self.rows
            .push((id.into(), what.into(), target.into(), got, ok));
    }

    fn render(&self, header: &str) -> String {
        let mut out = String::new();
        let _ = writeln!(out, "{header}");
        let _ = writeln!(
            out,
            "{:<4} {:<46} {:<30} {:<54} verdict",
            "#", "what", "target", "measured"
        );
        for (id, what, target, got, ok) in &self.rows {
            let verdict = match ok {
                Some(true) => "met",
                Some(false) => "MISS",
                None => "-",
            };
            let _ = writeln!(out, "{id:<4} {what:<46} {target:<30} {got:<54} {verdict}");
        }
        let met = self.rows.iter().filter(|r| r.4 == Some(true)).count();
        let judged = self.rows.iter().filter(|r| r.4.is_some()).count();
        let _ = writeln!(out, "met {met} of {judged} judged rows");
        out
    }
}

fn score_even(card: &mut Scorecard, even: &[Played], all: &[&Played]) {
    // T1
    let minutes: Vec<f64> = even.iter().map(|p| p.minutes).collect();
    let undecided = all.iter().filter(|p| p.winner_blue.is_none()).count();
    card.add(
        "T1",
        "match length, mean (even)",
        "32 to 40 min",
        format!("{:.1} min (p10 {:.1}, p90 {:.1})", mean(&minutes), percentile(&minutes, 0.1), percentile(&minutes, 0.9)),
        Some(within(mean(&minutes), 32.0, 40.0)),
    );
    card.add(
        "T1",
        "matches undecided at the step limit",
        "0",
        format!("{undecided} of {}", all.len()),
        Some(undecided == 0),
    );
    // T2
    let kills: Vec<f64> = even.iter().map(|p| p.kills() as f64).collect();
    card.add(
        "T2",
        "kills per match, mean (even)",
        "20 to 35",
        format!("{:.1}", mean(&kills)),
        Some(within(mean(&kills), 20.0, 35.0)),
    );
    // T3
    let with15: Vec<&Played> = even.iter().filter(|p| p.obs.at15.is_some()).collect();
    let cs_per_min = |role: &str| -> f64 {
        let values: Vec<f64> = with15
            .iter()
            .flat_map(|p| {
                let at = p.obs.at15.as_ref().expect("at15");
                p.members
                    .iter()
                    .enumerate()
                    .filter(|(_, m)| m.role == role)
                    .map(|(i, _)| at.cs[i] as f64 / 15.0)
                    .collect::<Vec<_>>()
            })
            .collect();
        mean(&values)
    };
    for (role, low, high) in [("TOP", 6.0, 9.0), ("MID", 6.0, 9.0), ("ADC", 5.5, 9.0), ("SUP", 0.0, 1.5)] {
        let value = cs_per_min(role);
        card.add(
            "T3",
            &format!("minions per minute at 15, {role}"),
            &if role == "SUP" { "at most 1.5".to_string() } else { format!("{low} to {high}") },
            format!("{value:.2}"),
            Some(within(value, low, high)),
        );
    }
    // T4
    let gap = |p: &Played, role: &str| -> f64 {
        let at = p.obs.at15.as_ref().expect("at15");
        let (b, r) = p.pair(role);
        (at.earned[b] - at.earned[r]).abs() as f64
    };
    for role in LANERS {
        let gaps: Vec<f64> = with15.iter().map(|p| gap(p, role)).collect();
        card.add(
            "T4",
            &format!("same-role gold gap at 15, median, {role}"),
            "at most 900",
            format!("{:.0} (p75 {:.0})", percentile(&gaps, 0.5), percentile(&gaps, 0.75)),
            Some(percentile(&gaps, 0.5) <= 900.0),
        );
    }
    let no_tower: Vec<&&Played> = with15
        .iter()
        .filter(|p| p.obs.at15.as_ref().is_some_and(|a| a.towers_down == 0))
        .collect();
    let lead_1000 = no_tower.iter().filter(|p| gap(p, "ADC") >= 1000.0).count();
    card.add(
        "T4",
        "ADC lead >= 1000, no tower down (of those)",
        "at most 30%",
        format!("{:.1}% ({lead_1000} of {})", pct(lead_1000, no_tower.len()), no_tower.len()),
        Some(pct(lead_1000, no_tower.len()) <= 30.0),
    );
    // T5
    let mut recall_means = Vec::new();
    for role in LANERS {
        let values: Vec<f64> = even
            .iter()
            .flat_map(|p| {
                p.members
                    .iter()
                    .enumerate()
                    .filter(|(_, m)| m.role == role)
                    .map(|(i, _)| f64::from(p.obs.recalls[i]))
                    .collect::<Vec<_>>()
            })
            .collect();
        recall_means.push((role, mean(&values)));
        let causes = (0..3).map(|cause| {
            let values: Vec<f64> = even
                .iter()
                .flat_map(|p| {
                    p.members
                        .iter()
                        .enumerate()
                        .filter(|(_, m)| m.role == role)
                        .map(|(i, _)| f64::from(p.obs.recall_causes[i][cause]))
                        .collect::<Vec<_>>()
                })
                .collect();
            mean(&values)
        });
        let causes: Vec<f64> = causes.collect();
        card.add(
            "T5",
            &format!("  {role} recalls by cause: item / low health / other"),
            "",
            format!("{:.1} / {:.1} / {:.1}", causes[0], causes[1], causes[2]),
            None,
        );
    }
    let listed: Vec<String> = recall_means.iter().map(|(r, v)| format!("{r} {v:.1}")).collect();
    card.add(
        "T5",
        "recalls per laner by minute 15, mean",
        "2 to 5 for each laner role",
        listed.join(", "),
        Some(recall_means.iter().all(|(_, v)| within(*v, 2.0, 5.0))),
    );
    for role in LANERS {
        let mut taken = [0.0f64; 4];
        let mut max_hp = 0.0;
        let mut laners = 0.0;
        for p in &with15 {
            let at = p.obs.at15.as_ref().expect("at15");
            for (i, m) in p.members.iter().enumerate().filter(|(_, m)| m.role == role) {
                let _ = m;
                for (slot, value) in at.damage[i].iter().enumerate() {
                    taken[slot] += value;
                }
                max_hp += at.max_hp[i];
                laners += 1.0;
            }
        }
        let share = |slot: usize| taken[slot] / max_hp.max(1.0);
        card.add(
            "T5",
            &format!("  {role} health lost by 15, in maximum healths"),
            "",
            format!(
                "champions {:.1} / minions {:.1} / towers {:.1} / other {:.1}",
                share(0),
                share(1),
                share(2),
                share(3)
            ),
            None,
        );
        let _ = laners;
    }
    // T6 (lanes; the sides rate is added by the caller)
    for role in LANERS {
        let ahead = with15
            .iter()
            .filter(|p| {
                let at = p.obs.at15.as_ref().expect("at15");
                let (b, r) = p.pair(role);
                at.cs[b] > at.cs[r]
            })
            .count();
        let share = pct(ahead, with15.len());
        card.add(
            "T6",
            &format!("blue ahead in farm at 15, {role}"),
            "40% to 60%",
            format!("{share:.1}% ({ahead} of {})", with15.len()),
            Some(within(share, 40.0, 60.0)),
        );
    }
}

fn score_towers(card: &mut Scorecard, even: &[Played], tanks: &[Played]) {
    let towers: Vec<&TowerScore> = even
        .iter()
        .chain(tanks)
        .filter_map(|p| p.tower.as_ref())
        .collect();
    for (slot, minute) in [15, 25, 35].into_iter().enumerate() {
        for (tank, limit, label) in [(false, SHOTS_NON_TANK_MAX, "non-tank"), (true, SHOTS_TANK_MAX, "tank")] {
            let shots: Vec<f64> = towers
                .iter()
                .flat_map(|t| t.shots_to_kill[slot].iter())
                .filter(|(is_tank, _)| *is_tank == tank)
                .map(|(_, n)| f64::from(*n))
                .collect();
            card.add(
                "T9",
                &format!("shots to kill a {label} at minute {minute}, mean"),
                &format!("at most {limit}"),
                if shots.is_empty() {
                    "no such champion".to_string()
                } else {
                    format!("{:.1} (p90 {:.0}, n {})", mean(&shots), percentile(&shots, 0.9), shots.len())
                },
                (!shots.is_empty()).then(|| mean(&shots) <= limit),
            );
        }
    }
    let bare: Vec<f64> = towers.iter().flat_map(|t| t.bare_secs.iter().copied()).collect();
    let violations: usize = towers.iter().map(|t| t.long_bare_violations).sum();
    card.add(
        "T9",
        "bare stretch inside a tower's range, p99",
        "at most 20 s",
        format!("{:.1} s (max {:.1}, {} stretches, {violations} long unexcused)", percentile(&bare, 0.99), percentile(&bare, 1.0), bare.len()),
        Some(percentile(&bare, 0.99) <= 20.0),
    );
    let tower_deaths: u32 = towers.iter().map(|t| t.tower_deaths).sum();
    let deaths: i64 = towers.iter().map(|t| t.deaths).sum();
    let share = 100.0 * f64::from(tower_deaths) / deaths.max(1) as f64;
    card.add(
        "T9",
        "deaths to towers, share of all deaths",
        "at most 15%",
        format!("{share:.1}% ({tower_deaths} of {deaths}; {:.1} deaths per match)", deaths as f64 / towers.len().max(1) as f64),
        Some(share <= 15.0),
    );
}

fn score_income(card: &mut Scorecard, even: &[Played]) {
    let with15: Vec<&Played> = even.iter().filter(|p| p.obs.at15.is_some()).collect();
    let team_income: Vec<f64> = with15
        .iter()
        .flat_map(|p| {
            let at = p.obs.at15.as_ref().expect("at15");
            [true, false].map(|blue| {
                p.members
                    .iter()
                    .enumerate()
                    .filter(|(_, m)| m.blue == blue)
                    .map(|(i, _)| at.income[i] as f64)
                    .sum::<f64>()
                    / 15.0
            })
        })
        .collect();
    let per_min = mean(&team_income);
    card.add(
        "T10",
        "team gold per minute at 15 (income since start)",
        "within 10% of 1060",
        format!("{per_min:.0}"),
        Some((per_min - TEAM_GOLD_PER_MIN_15).abs() <= 0.10 * TEAM_GOLD_PER_MIN_15),
    );
    for role in ROLES {
        let mut by_source = [0.0f64; GoldSource::COUNT];
        let mut players = 0.0f64;
        for p in &with15 {
            let at = p.obs.at15.as_ref().expect("at15");
            for (i, _) in p.members.iter().enumerate().filter(|(_, m)| m.role == role) {
                for (slot, gold) in at.gold_by_source[i].iter().enumerate() {
                    by_source[slot] += *gold as f64;
                }
                players += 1.0;
            }
        }
        let per_min = |sources: &[GoldSource]| -> f64 {
            sources.iter().map(|s| by_source[s.index()]).sum::<f64>() / players.max(1.0) / 15.0
        };
        card.add(
            "T10",
            &format!("  {role} gold per minute by 15: source"),
            "",
            format!(
                "minion {:.0} camp {:.0} kill+assist {:.0} passive {:.0} objectives {:.0}",
                per_min(&[GoldSource::LaneMinion]),
                per_min(&[GoldSource::JungleCamp]),
                per_min(&[GoldSource::Kill, GoldSource::Assist]),
                per_min(&[GoldSource::Passive]),
                per_min(&[
                    GoldSource::Tower,
                    GoldSource::Dragon,
                    GoldSource::Herald,
                    GoldSource::Voidgrub,
                    GoldSource::Elder,
                    GoldSource::Baron,
                    GoldSource::OtherObjective
                ])
            ),
            None,
        );
    }
    let share_of = |role: &str, early: bool| -> f64 {
        let values: Vec<f64> = even
            .iter()
            .filter(|p| !early || p.obs.at15.is_some())
            .flat_map(|p| {
                let earned = |i: usize| -> f64 {
                    if early {
                        p.obs.at15.as_ref().expect("at15").earned[i] as f64
                    } else {
                        p.members[i].earned_end as f64
                    }
                };
                [true, false].map(|blue| {
                    let team: Vec<usize> = (0..p.members.len()).filter(|&i| p.members[i].blue == blue).collect();
                    let total: f64 = team.iter().map(|&i| earned(i)).sum();
                    let role_gold: f64 = team.iter().filter(|&&i| p.members[i].role == role).map(|&i| earned(i)).sum();
                    role_gold / total.max(1.0)
                })
            })
            .collect();
        mean(&values)
    };
    let early: Vec<(&str, f64, bool)> = EARLY_ROLE_SHARE_RANGE
        .iter()
        .map(|(role, low, high)| {
            let value = share_of(role, true);
            (*role, value, within(value, *low, *high))
        })
        .collect();
    card.add(
        "T10",
        "role shares at 15 (bands of the 12-minute guard)",
        "TOP 17-24 JGL 15-21 MID 19-26 ADC 19-27 SUP 13-19",
        early.iter().map(|(r, v, _)| format!("{r} {:.1}", v * 100.0)).collect::<Vec<_>>().join(" "),
        Some(early.iter().all(|(_, _, ok)| *ok)),
    );
    let late: Vec<(&str, f64, bool)> = ROLE_SHARE_RANGE
        .iter()
        .map(|(role, low, high)| {
            let value = share_of(role, false);
            (*role, value, within(value, *low, *high))
        })
        .collect();
    card.add(
        "T10",
        "role shares at the end (pro-average bands)",
        "TOP 20-23 JGL 17-20 MID 21-24 ADC 23-27 SUP 10-14",
        late.iter().map(|(r, v, _)| format!("{r} {:.1}", v * 100.0)).collect::<Vec<_>>().join(" "),
        Some(late.iter().all(|(_, _, ok)| *ok)),
    );
    let pay: Vec<(&str, f64)> = ROLES
        .iter()
        .map(|role| {
            let (gold, grants) = even.iter().flat_map(|p| p.members.iter()).filter(|m| m.role == *role).fold(
                (0i64, 0i64),
                |acc, m| (acc.0 + m.kill_gold, acc.1 + m.kill_grants),
            );
            (*role, gold as f64 / grants.max(1) as f64)
        })
        .collect();
    // The rule: the reward of a kill is a function of the two champions' levels and streaks,
    // never of the killer's role. The measured spread also holds who was killed.
    let reward_of = |role: &str| {
        let mut killer = test_helpers::test_champion("k", "blue", role, "mid", Vec2 { x: 0.5, y: 0.5 });
        killer.level = 9;
        let victim = test_helpers::test_champion("v", "red", "MID", "mid", Vec2 { x: 0.5, y: 0.5 });
        economy::champion_kill_rewards(&killer, &victim)
    };
    let same_for_every_role = ROLES.iter().all(|role| reward_of(role) == reward_of("MID"));
    card.add(
        "T10",
        "a kill pays the same whatever the killer's role",
        "the same",
        format!(
            "{} (measured gold per kill: {})",
            if same_for_every_role { "the same" } else { "differs" },
            pay.iter().map(|(r, v)| format!("{r} {v:.0}")).collect::<Vec<_>>().join(" ")
        ),
        Some(same_for_every_role),
    );
    let top_weight = ROLES.iter().map(|r| economy::role_income_weight(r)).fold(0.0, f64::max);
    card.add(
        "T10",
        "largest role income weight",
        "at most 2.0",
        format!("{top_weight:.3}"),
        Some(top_weight <= ROLE_WEIGHT_MAX),
    );
}

fn score_strength(card: &mut Scorecard, even: &[Played], moderate: &[Played], extreme: &[Played], sides: &[Played]) {
    let blue_wins = sides.iter().filter(|p| p.winner_blue == Some(true)).count();
    let decided = sides.iter().filter(|p| p.winner_blue.is_some()).count();
    let rate = pct(blue_wins, decided);
    card.add(
        "T6",
        "blue wins, even matches",
        "47% to 53%",
        format!("{rate:.1}% ({blue_wins} of {decided})"),
        Some(within(rate, 47.0, 53.0)),
    );
    let stronger = |set: &[Played]| -> (usize, usize) {
        (
            set.iter().filter(|p| p.team_a_won() == Some(true)).count(),
            set.iter().filter(|p| p.winner_blue.is_some()).count(),
        )
    };
    let (mw, mn) = stronger(moderate);
    card.add(
        "T7",
        "80 vs 60, stronger team wins",
        "62% to 78%",
        format!("{:.1}% ({mw} of {mn})", pct(mw, mn)),
        Some(within(pct(mw, mn), 62.0, 78.0)),
    );
    let (ew, en) = stronger(extreme);
    card.add(
        "T7",
        "95 vs 40, stronger team wins",
        "at least 90%",
        format!("{:.1}% ({ew} of {en})", pct(ew, en)),
        Some(pct(ew, en) >= 90.0),
    );
    let played: Vec<&Played> = even.iter().chain(moderate).chain(extreme).collect();
    let lost_big = played
        .iter()
        .filter(|p| {
            p.winner_blue.is_some_and(|blue| {
                let (own, other) = if blue {
                    (p.blue_kills, p.red_kills)
                } else {
                    (p.red_kills, p.blue_kills)
                };
                other - own >= BIG_LEAD_KILLS
            })
        })
        .count();
    for p in played.iter().filter(|p| {
        p.winner_blue.is_some_and(|blue| {
            let (own, other) = if blue { (p.blue_kills, p.red_kills) } else { (p.red_kills, p.blue_kills) };
            other - own >= BIG_LEAD_KILLS
        })
    }).take(12) {
        let loser_blue = p.winner_blue == Some(false);
        let (loser, winner) = if loser_blue { (p.blue_objectives, p.red_objectives) } else { (p.red_objectives, p.blue_objectives) };
        let (lk, wk) = if loser_blue { (p.blue_kills, p.red_kills) } else { (p.red_kills, p.blue_kills) };
        card.add(
            "T7",
            &format!("  lost with a lead: seed {} ({:.0} min)", p.seed, p.minutes),
            "",
            format!("loser kills {lk} towers {} barons {} | winner kills {wk} towers {} barons {}", loser.0, loser.1, winner.0, winner.1),
            None,
        );
    }
    card.add(
        "T7",
        "matches lost by a team leading by 20+ kills",
        "0",
        format!("{lost_big} of {}", played.len()),
        Some(lost_big == 0),
    );
    card.add(
        "T7",
        "committed assertions of stronger_team_wins_at_least",
        "pass",
        "run separately (skip path)".to_string(),
        None,
    );
}

fn score_objectives(card: &mut Scorecard, matches: usize) {
    let score = objective_score(0, matches, true);
    let solo_share = |solo: usize, kills: usize| 100.0 * solo as f64 / kills.max(1) as f64;
    card.add(
        "T8",
        "Baron kills with a peak of one champion in range",
        "at most 2%",
        format!("{:.1}% ({} of {} kills)", solo_share(score.baron_solo, score.baron_kills), score.baron_solo, score.baron_kills),
        Some(solo_share(score.baron_solo, score.baron_kills) <= 2.0),
    );
    card.add(
        "T8",
        "Elder kills with a peak of one champion in range",
        "at most 2%",
        format!("{:.1}% ({} of {} kills)", solo_share(score.elder_solo, score.elder_kills), score.elder_solo, score.elder_kills),
        Some(solo_share(score.elder_solo, score.elder_kills) <= 2.0),
    );
    let per_100 = |count: usize| 100.0 * count as f64 / score.matches.max(1) as f64;
    card.add(
        "T8",
        "idle jungler stretches per 100 matches",
        "at most 1 (report-sim1 after)",
        format!("{:.1} ({} in {} matches)", per_100(score.jungler_idle), score.jungler_idle, score.matches),
        Some(per_100(score.jungler_idle) <= 1.0),
    );
    card.add(
        "T8",
        "loitering jungler stretches per 100 matches",
        "at most 3 (report-sim1 after)",
        format!("{:.1} ({} in {} matches)", per_100(score.jungler_loiter), score.jungler_loiter, score.matches),
        Some(per_100(score.jungler_loiter) <= 3.0),
    );
}

#[test]
#[ignore = "measurement: plays 100 to 1,700 full matches; see the module docs for the profiles"]
fn print_balance_scorecard() {
    let profile = profile_from_env();
    let even_pair = (Side::EVEN, Side::EVEN);
    let even: Vec<Played> = par_map(profile.even, |i| play(i, even_pair.0, even_pair.1, true));
    let moderate: Vec<Played> = par_map(profile.moderate, |i| {
        play(20_000 + i, Side::stat(80.0), Side::stat(60.0), false)
    });
    let extreme: Vec<Played> = par_map(profile.extreme, |i| {
        play(30_000 + i, Side::stat(95.0), Side::stat(40.0), false)
    });
    let tanks: Vec<Played> = par_map(profile.tanks, |i| {
        play_with(
            40_000 + i,
            even_pair.0,
            even_pair.1,
            true,
            Config::watched_with_tanks(STEP_LIMIT_SEC),
        )
    });
    let sides: Vec<Played> = if profile.sides > 0 {
        par_map(profile.sides, |i| play(10_000 + i, even_pair.0, even_pair.1, false))
    } else {
        Vec::new()
    };
    let side_set: &[Played] = if profile.sides > 0 { &sides } else { &even };

    let mut card = Scorecard { rows: Vec::new() };
    let all: Vec<&Played> = even.iter().chain(&moderate).chain(&extreme).chain(&sides).collect();
    score_even(&mut card, &even, &all);
    score_strength(&mut card, &even, &moderate, &extreme, side_set);
    score_objectives(&mut card, profile.objectives);
    score_towers(&mut card, &even, &tanks);
    score_income(&mut card, &even);
    card.rows.sort_by_key(|r| r.0[1..].parse::<u32>().unwrap_or(99));

    let header = format!(
        "balance scorecard, profile {}: {} even, {} at 80 vs 60, {} at 95 vs 40, {} side matches, {} objective matches (tick path, step {} s)",
        profile.name,
        profile.even,
        profile.moderate,
        profile.extreme,
        if profile.sides > 0 { profile.sides } else { profile.even },
        profile.objectives,
        runtime::FIXED_STEP_SEC
    );
    let table = card.render(&header);
    println!("{table}");
    if let Ok(path) = std::env::var("SCORECARD_OUT") {
        std::fs::write(&path, &table).expect("write scorecard");
    }
}

/// Prints how champions that a tower killed got there: the last seconds of each of them.
/// `SCORECARD_DEBUG_N` matches (default 6); every tower death prints one block.
#[test]
#[ignore = "diagnostic: prints the approach of every champion a tower killed"]
fn debug_tower_deaths() {
    use std::collections::VecDeque;
    let matches: usize = std::env::var("SCORECARD_DEBUG_N")
        .ok()
        .and_then(|raw| raw.parse().ok())
        .unwrap_or(6);
    let reports: Vec<Vec<String>> = par_map(matches, |seed| {
        let mut out = Vec::new();
        let mut history: Vec<VecDeque<String>> = Vec::new();
        drive_match(
            &format!("scorecard-{seed}"),
            Side::EVEN,
            Side::EVEN,
            Config::watched(STEP_LIMIT_SEC),
            |rt| {
                if history.is_empty() {
                    history = vec![VecDeque::new(); rt.champions.len()];
                }
                for (i, c) in rt.champions.iter().enumerate() {
                    let nearest = rt
                        .structures
                        .iter()
                        .filter(|s| s.alive && s.kind == "tower" && s.team != c.team)
                        .map(|s| dist(super::symmetric_structure_pos(s), c.pos))
                        .fold(f64::INFINITY, f64::min);
                    let line = format!(
                        "t{:.0} {} pos({:.3},{:.3}) hp{:.0}% tower{:.3} dest{:?} {}",
                        rt.time_sec,
                        c.state,
                        c.pos.x,
                        c.pos.y,
                        100.0 * c.hp / c.max_hp.max(1.0),
                        nearest,
                        c.target_path.last().map(|d| (d.x, d.y)),
                        c.debug_ai_decision
                    );
                    let h = &mut history[i];
                    h.push_back(line);
                    if h.len() > 7 {
                        h.pop_front();
                    }
                }
                for shot in rt.tower_ledger.shots() {
                    if let TowerVictim::Champion(ci) = shot.victim
                        && shot.killed
                    {
                        let c = &rt.champions[ci];
                        let allies = rt
                            .champions
                            .iter()
                            .filter(|o| o.alive && o.team == c.team && o.id != c.id)
                            .map(|o| format!("{}:{:.2}", o.role, dist(o.pos, c.pos)))
                            .collect::<Vec<_>>()
                            .join(" ");
                        out.push(format!(
                            "seed {seed} {} {} {} push {} killed by {} at t{:.0} | allies {allies}\n    {}",
                            c.team,
                            c.role,
                            c.state,
                            c.push.is_some(),
                            rt.structures[shot.structure_idx].id,
                            rt.time_sec,
                            history[ci].iter().cloned().collect::<Vec<_>>().join("\n    ")
                        ));
                    }
                }
            },
        );
        out
    });
    for line in reports.iter().flatten().take(40) {
        println!("{line}");
    }
    println!("tower deaths: {}", reports.iter().map(Vec::len).sum::<usize>());
    println!(
        "tower deaths while the champion had a push order: {}",
        reports.iter().flatten().filter(|line| line.contains(" push true ")).count()
    );
}

/// Prints a timeline of one 80 vs 60 match (`SCORECARD_SEED`, default 20005): every 120 s the
/// kills, towers and living champions of each side, what the living ones are doing and how far
/// the group of each side is from the other side's base.
#[test]
#[ignore = "diagnostic: timeline of one uneven match"]
fn debug_match_timeline() {
    let seed: usize = std::env::var("SCORECARD_SEED")
        .ok()
        .and_then(|raw| raw.parse().ok())
        .unwrap_or(20_005);
    let a_is_blue = seed.is_multiple_of(2);
    let (a, b) = (Side::stat(80.0), Side::stat(60.0));
    let (blue, red) = if a_is_blue { (a, b) } else { (b, a) };
    println!("seed {seed}: blue is {}", if a_is_blue { "the stronger side" } else { "the weaker side" });
    let mut next = 120.0;
    let mut alive_structures: Vec<bool> = Vec::new();
    let end = drive_match(&format!("scorecard-{seed}"), blue, red, Config::watched(STEP_LIMIT_SEC), |rt| {
        if alive_structures.is_empty() {
            alive_structures = rt.structures.iter().map(|s| s.alive).collect();
        }
        for (i, s) in rt.structures.iter().enumerate() {
            if alive_structures[i] && !s.alive {
                alive_structures[i] = false;
                let near = |team: &str, champions: bool| -> String {
                    if champions {
                        rt.champions
                            .iter()
                            .filter(|c| c.alive && c.team == team && dist(c.pos, s.pos) <= 0.20)
                            .map(|c| c.role.clone())
                            .collect::<Vec<_>>()
                            .join(",")
                    } else {
                        rt.minions
                            .iter()
                            .filter(|m| m.alive && m.team == team && dist(m.pos, s.pos) <= 0.12)
                            .count()
                            .to_string()
                    }
                };
                let attacker = if s.team == "blue" { "red" } else { "blue" };
                println!(
                    "  t{:.0} {} fell: attackers' champions [{}] minions {} | defenders' champions [{}] minions {}",
                    rt.time_sec, s.id, near(attacker, true), near(attacker, false), near(&s.team, true), near(&s.team, false)
                );
            }
        }
        if rt.time_sec < next {
            return;
        }
        next += 120.0;
        let describe = |team: &str| {
            let living: Vec<&ChampionRuntime> =
                rt.champions.iter().filter(|c| c.team == team && c.alive).collect();
            let states: Vec<String> = living.iter().map(|c| format!("{}:{}", c.role, c.state)).collect();
            let (sx, sy) = living.iter().fold((0.0, 0.0), |acc, c| (acc.0 + c.pos.x, acc.1 + c.pos.y));
            let n = living.len().max(1) as f64;
            format!("alive {} at ({:.2},{:.2}) [{}]", living.len(), sx / n, sy / n, states.join(" "))
        };
        println!(
            "t{:>4.0} kills {:>2}-{:<2} towers {:>2}-{:<2} gold {}-{} | blue {} | red {}",
            rt.time_sec,
            rt.stats.blue.kills,
            rt.stats.red.kills,
            rt.stats.blue.towers,
            rt.stats.red.towers,
            rt.champions.iter().filter(|c| c.team == "blue").map(|c| c.gold + c.spent_gold).sum::<i64>(),
            rt.champions.iter().filter(|c| c.team == "red").map(|c| c.gold + c.spent_gold).sum::<i64>(),
            describe("blue"),
            describe("red"),
        );
    });
    println!(
        "ended at {:.0} s, winner {:?}, towers {}-{}, kills {}-{}",
        end.time_sec, end.winner, end.stats.blue.towers, end.stats.red.towers, end.stats.blue.kills, end.stats.red.kills
    );
}

// ------------------------------------------------------------ default tests

#[test]
fn percentile_picks_the_nearest_rank() {
    let values = [5.0, 1.0, 3.0, 2.0, 4.0];
    assert_eq!(percentile(&values, 0.5), 3.0);
    assert_eq!(percentile(&values, 1.0), 5.0);
}

#[test]
fn par_map_keeps_the_order_of_its_jobs() {
    let squares = par_map(23, |i| i * i);
    assert_eq!(squares, (0..23).map(|i| i * i).collect::<Vec<_>>());
}

#[test]
fn recalls_are_counted_once_per_visit_to_the_base() {
    let mut obs = Obs::default();
    let mut runtime = test_helpers::test_runtime(
        vec![test_helpers::test_champion("c", "blue", "TOP", "top", Vec2 { x: 0.5, y: 0.5 })],
        vec![],
        vec![],
        test_helpers::empty_neutral(),
    );
    for state in ["lane", "recall", "recall", "lane", "recall"] {
        runtime.champions[0].state = state.to_string();
        obs.observe(&runtime);
    }
    assert_eq!(obs.recalls[0], 2, "two separate recalls, not one per step");
}
