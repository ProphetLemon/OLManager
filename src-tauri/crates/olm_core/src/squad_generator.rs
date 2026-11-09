//! Founding squad generator for a custom club.
//!
//! Produces five invented players, one per role, whose strength is anchored to
//! the league the club joins ([`OvrPercentiles`]) so the squad looks like an
//! ordinary peer: just below the league median, one late bloomer, wages that
//! respect the real wage floor.
//!
//! The module is pure: the same `(spec, seed)` always yields the same squad and
//! nothing here touches a [`Game`](crate::game::Game). Installing the squad is
//! the caller's job.

use std::collections::HashSet;
use std::fmt;

use chrono::{Datelike, NaiveDate};
use rand::rngs::StdRng;
use rand::{RngExt, SeedableRng};

use crate::contracts::expected_signing_wage;
use crate::custom_team::OvrPercentiles;
use crate::domain::player::{Player, PlayerAttributes};
use crate::domain::stats::LolRole;
use crate::domain::team::Team;
use crate::game_setup::suggested_seed_market_value;
use crate::potential::calculate_lol_ovr;
use crate::wage_scale::scale_wage_for_market_value;

/// Roles of a founding squad, in the order the players are returned.
pub const SQUAD_ROLES: [LolRole; 5] = [
    LolRole::Top,
    LolRole::Jungle,
    LolRole::Mid,
    LolRole::Adc,
    LolRole::Support,
];

/// Times the generator re-seeds before giving up on a squad that breaks the window.
pub const MAX_ATTEMPTS: u8 = 8;
/// Prefix of every founding player's id (`gen-<club slug>-<role>-<n>`).
pub const FOUNDER_ID_PREFIX: &str = "gen-";
/// Contract length of every founding player, in years.
pub const CONTRACT_YEARS: i32 = 2;
/// Youngest and oldest founding player.
pub const AGE_RANGE: std::ops::RangeInclusive<i32> = 19..=27;

/// Lowest OVR offset below the league median for any starter.
///
/// Was 5 when the squad mean sat about 3 below the median. With the mean about
/// 1.5 below, a starter 5 below would make the squad uneven and drag it back
/// to last place, so the band is one point tighter.
const MAX_OFFSET_BELOW_MEDIAN: i32 = 4;
/// The weakest starter may never sit further below the median than this.
///
/// Was 7. It stays a guard one point looser than the band, so a future band
/// change cannot silently produce a starter far under the peers.
const WEAKEST_OFFSET_BELOW_MEDIAN: i32 = 5;
/// Accepted squad mean, as offsets below the median (inclusive, about 1.5).
///
/// Was 2..=4 (about 3), which left the squad last of 8 in every real LES world
/// (mean 68.0 against a peer median of 71.4, weakest peers at 69.5-69.8).
/// 1..=2 puts it in the bottom pack with a real chance of not finishing last,
/// and still below mid-table.
const MEAN_OFFSET_WINDOW: std::ops::RangeInclusive<i32> = 1..=2;
/// Offsets of the late bloomer, below the median. The bloomer stays under the
/// median (a growth story, not a present-day strength) but closer to it than
/// the old 3..=5, which would pull the mean back down.
const BLOOMER_OFFSET_RANGE: std::ops::RangeInclusive<i32> = 2..=3;
/// Chance, in 1 out of N, that one starter sits one point above the median.
const ABOVE_MEDIAN_ONE_IN: u32 = 5;
/// Weights of an OVR offset of 0..=4 points below the median for a regular
/// starter (mean offset about 1.3).
///
/// Was `[1, 2, 3, 4, 4, 3]` over 0..=5 (mean 3). With the bloomer at offset
/// 2..=3 and the occasional starter above the median, a regular mean of about
/// 1.3 puts the squad mean near 1.5 below the median.
const OFFSET_WEIGHTS: [u32; 5] = [5, 5, 3, 2, 1];
/// Weights of ages 19..=27, concentrated on 21-24.
const AGE_WEIGHTS: [u32; 9] = [1, 2, 4, 4, 4, 4, 2, 1, 1];
/// Hidden potential of a regular founding player before the level floor applies.
const POTENTIAL_RANGE: std::ops::RangeInclusive<u8> = 70..=82;
/// Highest potential a regular player can reach, so he never reads as the late bloomer.
const REGULAR_POTENTIAL_CAP: u8 = BLOOMER_POTENTIAL_FLOOR - 1;
/// Hidden potential of the late bloomer.
const BLOOMER_POTENTIAL_RANGE: std::ops::RangeInclusive<u8> = 84..=88;
/// Potential from which a player counts as the late bloomer.
const BLOOMER_POTENTIAL_FLOOR: u8 = 84;
/// Lowest median the attribute template can express without clamping.
const MIN_SUPPORTED_MEDIAN: u8 = 20;
/// Highest median the generator supports: the `median + 1` starter must still stay
/// under [`REGULAR_POTENTIAL_CAP`] so exactly one player holds a bloomer potential.
const MAX_SUPPORTED_MEDIAN: u8 = REGULAR_POTENTIAL_CAP - 1;
/// Day-1 wage bill window, in percent of the league-median wage budget.
///
/// Wages never drop below the wage floor; they are scaled up to land here. The
/// window leaves less room under the 110% soft cap than the cheapest elite free
/// agent asks for (see the calibration report), so a day-1 star signing is out
/// of reach. Interim policy: it inflates wages above the wage scale, so prefer
/// floor-priced wages with [`founding_wage_budget`].
pub const BILL_WINDOW_PCT: std::ops::RangeInclusive<i64> = 95..=98;
/// Largest wage scale-up allowed to reach [`BILL_WINDOW_PCT`], in percent of the
/// floor-priced wage. A squad that would need more is re-seeded.
pub const MAX_WAGE_SCALE_PCT: i128 = 200;
/// Day-1 bill, in percent of the budget [`founding_wage_budget`] returns.
pub const DERIVED_BUDGET_BILL_PCT: i64 = 95;
/// [`founding_wage_budget`] rounds up to this step.
const DERIVED_BUDGET_STEP: i64 = 10_000;
/// Reputation of the neutral club used to price wages.
const REFERENCE_CLUB_REPUTATION: u32 = 100;
/// Attempts at a free nick before the name pool counts as exhausted.
const MAX_NICK_TRIES: u32 = 64;

/// Why a squad could not be generated.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SquadError {
    /// The club slug has no ASCII letters or digits.
    EmptyClubSlug,
    /// No nationality was given.
    NoNationalities,
    /// The league median is outside what the attribute template can express.
    UnsupportedMedian(u8),
    /// No free nick was found in the name pool.
    NamesExhausted,
    /// Every attempt broke the window; carries the last violations.
    WindowUnsatisfied {
        /// Attempts made.
        attempts: u8,
        /// Rules the last attempt broke.
        violations: Vec<String>,
    },
}

impl fmt::Display for SquadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SquadError::EmptyClubSlug => write!(f, "club slug has no letters or digits"),
            SquadError::NoNationalities => write!(f, "no nationality to draw players from"),
            SquadError::UnsupportedMedian(median) => {
                write!(
                    f,
                    "league median OVR {median} is outside the supported range"
                )
            }
            SquadError::NamesExhausted => write!(f, "no free nick left in the name pool"),
            SquadError::WindowUnsatisfied {
                attempts,
                violations,
            } => write!(
                f,
                "no squad inside the league window after {attempts} attempts: {}",
                violations.join("; ")
            ),
        }
    }
}

impl std::error::Error for SquadError {}

/// Everything the generator needs besides the seed.
#[derive(Debug, Clone)]
pub struct SquadSpec<'a> {
    /// Club slug used in player ids, for example `rayo`.
    pub club_slug: &'a str,
    /// Natural OVR distribution of the league's peers.
    pub percentiles: OvrPercentiles,
    /// ISO-2 nationalities of the league region; each player draws one.
    pub nationalities: &'a [&'a str],
    /// Date the squad is created, for ages and contracts.
    pub today: NaiveDate,
    /// Lowercase `match_name`s already in the world; none may be reused.
    pub taken_match_names: &'a HashSet<String>,
    /// Lowercase `full_name`s already in the world; none may be reused.
    pub taken_full_names: &'a HashSet<String>,
    /// The `n` of the ids `gen-<slug>-<role>-<n>`.
    pub serial: u32,
    /// League-median wage budget. When set, wages are raised above the wage
    /// floor (at most [`MAX_WAGE_SCALE_PCT`]) until the bill sits inside
    /// [`BILL_WINDOW_PCT`] of it. Only pass a league-median budget.
    ///
    /// A budget below the floor-priced bill (or one needing a larger scale-up)
    /// makes every attempt fail with [`SquadError::WindowUnsatisfied`]; there is
    /// no fallback inside the generator. Callers should then pass `None` and give
    /// the club the budget from [`founding_wage_budget`], the preferred policy.
    pub wage_budget: Option<i64>,
}

/// A squad member before it becomes a [`Player`].
struct Plan {
    role: LolRole,
    ovr: u8,
    bloomer: bool,
}

/// Generates the five founding players, one per role in [`SQUAD_ROLES`] order.
///
/// Deterministic per `seed` for a given build. The draw uses [`StdRng`], whose
/// algorithm may change between `rand` versions, so persist the generated
/// players and never regenerate a squad from its seed alone. When a draw breaks the league window it re-seeds
/// up to [`MAX_ATTEMPTS`] times and then returns
/// [`SquadError::WindowUnsatisfied`].
pub fn generate_founding_squad(spec: &SquadSpec<'_>, seed: u64) -> Result<Vec<Player>, SquadError> {
    let slug = sanitize_slug(spec.club_slug);
    if slug.is_empty() {
        return Err(SquadError::EmptyClubSlug);
    }
    if spec.nationalities.is_empty() {
        return Err(SquadError::NoNationalities);
    }
    let median = spec.percentiles.p50;
    if !(MIN_SUPPORTED_MEDIAN..=MAX_SUPPORTED_MEDIAN).contains(&median) {
        return Err(SquadError::UnsupportedMedian(median));
    }

    let mut last_violations = Vec::new();
    for attempt in 0..MAX_ATTEMPTS {
        let attempt_seed =
            seed.wrapping_add(u64::from(attempt).wrapping_mul(0x9E37_79B9_7F4A_7C15));
        let mut rng = StdRng::seed_from_u64(attempt_seed);
        let mut squad = build_squad(spec, &slug, &mut rng)?;
        if let Some(budget) = spec.wage_budget.filter(|budget| *budget > 0) {
            raise_bill_into_window(&mut squad, budget, &mut rng);
        }
        let mut violations = validate_squad(&squad, &spec.percentiles, spec.today);
        if let Some(budget) = spec.wage_budget.filter(|budget| *budget > 0) {
            violations.extend(bill_violation(&squad, budget));
        }
        if violations.is_empty() {
            return Ok(squad);
        }
        last_violations = violations;
    }
    Err(SquadError::WindowUnsatisfied {
        attempts: MAX_ATTEMPTS,
        violations: last_violations,
    })
}

/// Rules a squad breaks, empty when it fits the league window.
///
/// Checks the OVR band (`median-5..=median`, one starter may reach
/// `min(median+1, p75)`, none above p75), the mean (about `median-1.5`), the
/// weakest starter, ages, the single late bloomer and the 2-year contracts.
pub fn validate_squad(
    squad: &[Player],
    percentiles: &OvrPercentiles,
    today: NaiveDate,
) -> Vec<String> {
    let mut problems = Vec::new();
    if squad.len() != SQUAD_ROLES.len() {
        problems.push(format!("expected 5 players, got {}", squad.len()));
        return problems;
    }
    let median = i32::from(percentiles.p50);
    let ceiling = median.max((median + 1).min(i32::from(percentiles.p75)));
    let ovrs: Vec<i32> = squad
        .iter()
        .map(|p| i32::from(calculate_lol_ovr(p)))
        .collect();

    for (player, ovr) in squad.iter().zip(&ovrs) {
        if *ovr < median - MAX_OFFSET_BELOW_MEDIAN {
            problems.push(format!("{} OVR {ovr} below the window", player.id));
        }
        if *ovr < median - WEAKEST_OFFSET_BELOW_MEDIAN {
            problems.push(format!("{} OVR {ovr} weaker than median-7", player.id));
        }
        if *ovr > ceiling || *ovr > i32::from(percentiles.p75) {
            problems.push(format!("{} OVR {ovr} above the ceiling", player.id));
        }
        if i32::from(player.lol_ovr) != *ovr {
            problems.push(format!(
                "{} cached OVR differs from its attributes",
                player.id
            ));
        }
    }
    if ovrs.iter().filter(|ovr| **ovr > median).count() > 1 {
        problems.push("more than one starter above the median".to_string());
    }
    let sum: i32 = ovrs.iter().sum();
    let count = ovrs.len() as i32;
    let low = count * (median - *MEAN_OFFSET_WINDOW.end());
    let high = count * (median - *MEAN_OFFSET_WINDOW.start());
    if !(low..=high).contains(&sum) {
        problems.push(format!(
            "squad mean {:.1} outside the window",
            f64::from(sum) / f64::from(count)
        ));
    }
    let bloomers = squad
        .iter()
        .filter(|p| p.potential_base >= BLOOMER_POTENTIAL_FLOOR)
        .count();
    if bloomers != 1 {
        problems.push(format!("expected exactly one late bloomer, got {bloomers}"));
    }
    for player in squad {
        match age_on(today, &player.date_of_birth) {
            Some(age) if AGE_RANGE.contains(&age) => {}
            other => problems.push(format!("{} age {other:?} outside 19-27", player.id)),
        }
        if player.wage < scale_wage_for_market_value(player.market_value) {
            problems.push(format!("{} wage below the wage floor", player.id));
        }
    }
    problems
}

/// Yearly wage bill of `squad`.
pub fn squad_bill(squad: &[Player]) -> i64 {
    squad.iter().map(|p| i64::from(p.wage)).sum()
}

/// Wage budget a founding squad should ship with: its bill is
/// [`DERIVED_BUDGET_BILL_PCT`] of it, rounded up to 10k. Wages stay at the wage
/// floor, and the room under the 110% soft cap is about 16% of the bill, so
/// elite free agents stay out of reach without inflating wages.
pub fn founding_wage_budget(squad: &[Player]) -> i64 {
    wage_budget_for_bill(squad_bill(squad))
}

/// Wage budget at which `bill` is [`DERIVED_BUDGET_BILL_PCT`] of the budget,
/// rounded up to 10k. A negative bill counts as zero.
pub fn wage_budget_for_bill(bill: i64) -> i64 {
    let bill = u64::try_from(bill).unwrap_or(0);
    let exact = (bill * 100).div_ceil(DERIVED_BUDGET_BILL_PCT.unsigned_abs());
    let rounded =
        exact.div_ceil(DERIVED_BUDGET_STEP.unsigned_abs()) * DERIVED_BUDGET_STEP.unsigned_abs();
    i64::try_from(rounded).unwrap_or(i64::MAX)
}

/// Draws a bill target inside [`BILL_WINDOW_PCT`] and scales every wage up
/// proportionally (rounded up to 1k, at most [`MAX_WAGE_SCALE_PCT`]). A bill
/// already above the target stays: wages never go below the floor. A target the
/// cap cannot reach leaves the bill short, which [`bill_violation`] reports.
fn raise_bill_into_window(squad: &mut [Player], budget: i64, rng: &mut StdRng) {
    let pct = rng.random_range(BILL_WINDOW_PCT);
    let natural = i128::from(squad_bill(squad));
    let wanted = i128::from(budget) * i128::from(pct) / 100;
    if natural <= 0 || wanted <= natural {
        return;
    }
    let target = wanted.min(natural * MAX_WAGE_SCALE_PCT / 100);
    for player in squad.iter_mut() {
        let scaled = i128::from(player.wage) * target / natural;
        let rounded = (scaled + 999) / 1_000 * 1_000;
        player.wage = u32::try_from(rounded).unwrap_or(u32::MAX).max(player.wage);
    }
}

/// Why the bill of `squad` is outside [`BILL_WINDOW_PCT`] of `budget`, if it is.
///
/// Rounding the five wages up to 1k can overshoot the top by at most 5k, which
/// the check tolerates.
pub fn bill_violation(squad: &[Player], budget: i64) -> Option<String> {
    let bill = i128::from(squad_bill(squad));
    let budget = i128::from(budget.max(1));
    let low = budget * i128::from(*BILL_WINDOW_PCT.start()) / 100;
    let high = budget * i128::from(*BILL_WINDOW_PCT.end()) / 100 + 5_000;
    (!(low..=high).contains(&bill)).then(|| {
        format!(
            "bill {bill} outside {}-{}% of the wage budget {budget}",
            BILL_WINDOW_PCT.start(),
            BILL_WINDOW_PCT.end()
        )
    })
}

/// Full years between `date_of_birth` (`%Y-%m-%d`) and `today`, counted the
/// way the contract code does (year difference, minus one before the birthday).
fn age_on(today: NaiveDate, date_of_birth: &str) -> Option<i32> {
    let dob = NaiveDate::parse_from_str(date_of_birth, "%Y-%m-%d").ok()?;
    Some(full_years_between(today, dob))
}

/// Full years between `dob` and `today`, counted the way the contract code does
/// (year difference, minus one before the birthday). Negative for a future date.
pub fn full_years_between(today: NaiveDate, dob: NaiveDate) -> i32 {
    let mut age = today.year() - dob.year();
    if today.ordinal() < dob.ordinal() {
        age -= 1;
    }
    age
}

fn sanitize_slug(raw: &str) -> String {
    raw.chars()
        .filter(char::is_ascii_alphanumeric)
        .map(|c| c.to_ascii_lowercase())
        .collect()
}

fn role_slug(role: LolRole) -> &'static str {
    match role {
        LolRole::Top => "top",
        LolRole::Jungle => "jungle",
        LolRole::Mid => "mid",
        LolRole::Adc => "adc",
        LolRole::Support => "support",
        LolRole::Unknown => "unknown",
    }
}

/// Index of a weighted draw. `weights` must not be empty or all zero.
fn weighted_index(rng: &mut StdRng, weights: &[u32]) -> usize {
    let total: u32 = weights.iter().sum();
    let mut roll = rng.random_range(0..total.max(1));
    for (index, weight) in weights.iter().enumerate() {
        if roll < *weight {
            return index;
        }
        roll -= weight;
    }
    weights.len().saturating_sub(1)
}

/// Draws the OVR of every slot and picks the late bloomer.
fn plan_squad(rng: &mut StdRng, percentiles: &OvrPercentiles) -> Vec<Plan> {
    let median = i32::from(percentiles.p50);
    let bloomer_slot = rng.random_range(0..SQUAD_ROLES.len());
    let mut plans: Vec<Plan> = SQUAD_ROLES
        .iter()
        .enumerate()
        .map(|(slot, role)| {
            let offset = if slot == bloomer_slot {
                // The bloomer sits under the median, a little below the squad mean.
                rng.random_range(BLOOMER_OFFSET_RANGE)
            } else {
                weighted_index(rng, &OFFSET_WEIGHTS) as i32
            };
            Plan {
                role: *role,
                ovr: (median - offset).clamp(1, 99) as u8,
                bloomer: slot == bloomer_slot,
            }
        })
        .collect();

    let above = (median + 1).min(i32::from(percentiles.p75));
    if above > median && rng.random_range(0..ABOVE_MEDIAN_ONE_IN) == 0 {
        let candidates: Vec<usize> = (0..plans.len()).filter(|i| *i != bloomer_slot).collect();
        let pick = candidates[rng.random_range(0..candidates.len())];
        plans[pick].ovr = above as u8;
    }
    plans
}

/// Attribute slots (see [`PlayerAttributes::from_array`]) a role is strong and weak in.
struct RoleTemplate {
    key: [usize; 3],
    weak: usize,
}

const MECHANICS: usize = 0;
const LANING: usize = 1;
const TEAMFIGHTING: usize = 2;
const MACRO_PLAY: usize = 3;
const CONSISTENCY: usize = 4;
const SHOTCALLING: usize = 5;
const CHAMPION_POOL: usize = 6;
const DISCIPLINE: usize = 7;
const MENTAL_RESILIENCE: usize = 8;

fn role_template(role: LolRole) -> RoleTemplate {
    match role {
        LolRole::Top => RoleTemplate {
            key: [LANING, TEAMFIGHTING, MENTAL_RESILIENCE],
            weak: SHOTCALLING,
        },
        LolRole::Jungle => RoleTemplate {
            key: [MACRO_PLAY, TEAMFIGHTING, SHOTCALLING],
            weak: LANING,
        },
        LolRole::Mid => RoleTemplate {
            key: [MECHANICS, LANING, CHAMPION_POOL],
            weak: DISCIPLINE,
        },
        LolRole::Adc => RoleTemplate {
            key: [MECHANICS, CONSISTENCY, TEAMFIGHTING],
            weak: SHOTCALLING,
        },
        LolRole::Support | LolRole::Unknown => RoleTemplate {
            key: [SHOTCALLING, MACRO_PLAY, DISCIPLINE],
            weak: MECHANICS,
        },
    }
}

/// Nine attributes whose rounded mean is exactly `ovr`: three key attributes at
/// +5..+8, one weakness at -8 and five near the target absorbing the rest.
fn shaped_attributes(rng: &mut StdRng, role: LolRole, ovr: u8) -> PlayerAttributes {
    let template = role_template(role);
    let mut offsets = [0i32; 9];
    let mut key_total = 0;
    for slot in template.key {
        let bonus = rng.random_range(5..=8);
        offsets[slot] = bonus;
        key_total += bonus;
    }
    offsets[template.weak] = -8;

    let rest: Vec<usize> = (0..offsets.len())
        .filter(|slot| !template.key.contains(slot) && *slot != template.weak)
        .collect();
    let needed = 8 - key_total;
    let share = needed.div_euclid(rest.len() as i32);
    let extra = needed.rem_euclid(rest.len() as i32) as usize;
    for (position, slot) in rest.iter().enumerate() {
        offsets[*slot] = share + i32::from(position < extra);
    }
    // Shuffle which near-target slots hold the remainder, then jitter in
    // +1/-1 pairs so the total stays exact.
    for _ in 0..2 {
        let up = rest[rng.random_range(0..rest.len())];
        let down = rest[rng.random_range(0..rest.len())];
        if up != down {
            offsets[up] += 1;
            offsets[down] -= 1;
        }
    }
    let swap_a = rest[rng.random_range(0..rest.len())];
    let swap_b = rest[rng.random_range(0..rest.len())];
    offsets.swap(swap_a, swap_b);

    let mut values = [0u8; 9];
    for (value, offset) in values.iter_mut().zip(offsets) {
        *value = (i32::from(ovr) + offset).clamp(1, 99) as u8;
    }
    PlayerAttributes::from_array(values)
}

/// Contract end `CONTRACT_YEARS` after `today`, on the game's Nov 30 cut-off.
fn contract_end(today: NaiveDate) -> String {
    format!("{}-11-30", today.year() + CONTRACT_YEARS)
}

/// Birth date that makes the player exactly `age` full years old on `today`.
fn birth_date_for_age(today: NaiveDate, age: i32, extra_days: u64) -> Option<NaiveDate> {
    let birthday = today
        .with_year(today.year() - age)
        .or_else(|| today.pred_opt()?.with_year(today.year() - age))?;
    birthday.checked_sub_days(chrono::Days::new(extra_days))
}

/// Market value from OVR, potential and age: the seed formula, scaled up for
/// youth and down for veterans, rounded up to 10k.
fn market_value_for(ovr: u8, potential: u8, age: i32) -> u64 {
    let base = suggested_seed_market_value(ovr, potential, false);
    let percent = match age {
        ..=20 => 110,
        21..=23 => 105,
        24..=25 => 100,
        _ => 92,
    };
    (base * percent / 100).div_ceil(10_000) * 10_000
}

/// Yearly wage a neutral club pays: what [`expected_signing_wage`] asks of the
/// player, never below the wage-scale floor of his market value.
fn wage_for(player: &Player, today: NaiveDate) -> u32 {
    let mut reference = Team::new(
        String::new(),
        String::new(),
        String::new(),
        String::new(),
        String::new(),
        String::new(),
        0,
    );
    reference.reputation = REFERENCE_CLUB_REPUTATION;
    let floor = scale_wage_for_market_value(player.market_value);
    expected_signing_wage(player, &reference, today).max(floor)
}

fn build_squad(
    spec: &SquadSpec<'_>,
    slug: &str,
    rng: &mut StdRng,
) -> Result<Vec<Player>, SquadError> {
    let plans = plan_squad(rng, &spec.percentiles);
    let mut used: HashSet<String> = HashSet::new();
    let mut used_full: HashSet<String> = HashSet::new();
    let mut squad = Vec::with_capacity(plans.len());
    for plan in plans {
        let nationality = spec.nationalities[rng.random_range(0..spec.nationalities.len())];
        let (full_name, match_name) = invent_identity(
            rng,
            nationality,
            spec.taken_match_names,
            spec.taken_full_names,
            &mut used,
            &mut used_full,
        )?;
        let age = AGE_RANGE.start() + weighted_index(rng, &AGE_WEIGHTS) as i32;
        let extra_days = rng.random_range(0..=364u64);
        let date_of_birth = birth_date_for_age(spec.today, age, extra_days)
            .map(|d| d.format("%Y-%m-%d").to_string())
            .unwrap_or_default();

        let attributes = shaped_attributes(rng, plan.role, plan.ovr);
        let id = format!(
            "{FOUNDER_ID_PREFIX}{slug}-{}-{}",
            role_slug(plan.role),
            spec.serial
        );
        let mut player = Player::new(
            id,
            match_name,
            full_name,
            date_of_birth,
            nationality.to_string(),
            plan.role,
            attributes,
        );
        let ovr = calculate_lol_ovr(&player);
        player.lol_ovr = ovr;
        player.potential_base = if plan.bloomer {
            rng.random_range(BLOOMER_POTENTIAL_RANGE)
        } else {
            // Never below the current level, or the player would have no growth.
            rng.random_range(POTENTIAL_RANGE)
                .max(ovr.saturating_add(1))
                .min(REGULAR_POTENTIAL_CAP)
        };
        player.market_value = market_value_for(ovr, player.potential_base, age);
        player.contract_end = Some(contract_end(spec.today));
        player.wage = wage_for(&player, spec.today);
        squad.push(player);
    }
    Ok(squad)
}

/// Picks a free `(full_name, nick)` for `nationality`. The nick differs from
/// the full name, from every taken nick and from the nicks already used; the
/// full name differs from every taken full name and from the full names already
/// used in the squad.
fn invent_identity(
    rng: &mut StdRng,
    nationality: &str,
    taken: &HashSet<String>,
    taken_full: &HashSet<String>,
    used: &mut HashSet<String>,
    used_full: &mut HashSet<String>,
) -> Result<(String, String), SquadError> {
    let pool = name_pool(nationality);
    let mut full_name = String::new();
    for _ in 0..MAX_NICK_TRIES {
        let first = pool.first[rng.random_range(0..pool.first.len())];
        let last = pool.last[rng.random_range(0..pool.last.len())];
        full_name = format!("{first} {last}");
        if !full_name_taken(&full_name, taken_full, used_full) {
            break;
        }
    }
    if full_name_taken(&full_name, taken_full, used_full) {
        return Err(SquadError::NamesExhausted);
    }

    for attempt in 0..MAX_NICK_TRIES {
        let tag = NICKS[rng.random_range(0..NICKS.len())];
        let nick = match attempt {
            0..=7 => tag.to_string(),
            8..=15 => format!("{tag}x"),
            _ => format!("{tag}{}", rng.random_range(2..=99)),
        };
        let key = nick.to_lowercase();
        if key == full_name.to_lowercase() || taken.contains(&key) || used.contains(&key) {
            continue;
        }
        used.insert(key);
        used_full.insert(full_name.to_lowercase());
        return Ok((full_name, nick));
    }
    Err(SquadError::NamesExhausted)
}

/// Whether `full_name` (compared case-insensitively) is already in the world or
/// in the squad being built.
fn full_name_taken(
    full_name: &str,
    taken_full: &HashSet<String>,
    used_full: &HashSet<String>,
) -> bool {
    let key = full_name.to_lowercase();
    taken_full.contains(&key) || used_full.contains(&key)
}

struct NamePool {
    first: &'static [&'static str],
    last: &'static [&'static str],
}

/// Name pool for an ISO-2 nationality; unknown codes get the mixed European one.
fn name_pool(nationality: &str) -> NamePool {
    match nationality.trim().to_ascii_uppercase().as_str() {
        "ES" | "MX" | "AR" | "CL" | "CO" | "PE" | "UY" | "VE" | "EC" | "CR" | "GT" | "HN"
        | "SV" | "DO" | "CU" | "BO" | "PY" | "PA" | "NI" => NamePool {
            first: ES_FIRST,
            last: ES_LAST,
        },
        "FR" => NamePool {
            first: FR_FIRST,
            last: FR_LAST,
        },
        "DE" => NamePool {
            first: DE_FIRST,
            last: DE_LAST,
        },
        "DK" | "SE" | "NO" | "FI" => NamePool {
            first: NORDIC_FIRST,
            last: NORDIC_LAST,
        },
        "PL" => NamePool {
            first: PL_FIRST,
            last: PL_LAST,
        },
        "GB" | "UK" | "IE" => NamePool {
            first: GB_FIRST,
            last: GB_LAST,
        },
        "IT" | "PT" | "BR" => NamePool {
            first: IT_FIRST,
            last: IT_LAST,
        },
        _ => NamePool {
            first: EU_FIRST,
            last: EU_LAST,
        },
    }
}

/// Total distinct `(first, last)` combinations across every pool.
pub fn name_combinations() -> usize {
    [
        (ES_FIRST.len(), ES_LAST.len()),
        (FR_FIRST.len(), FR_LAST.len()),
        (DE_FIRST.len(), DE_LAST.len()),
        (NORDIC_FIRST.len(), NORDIC_LAST.len()),
        (PL_FIRST.len(), PL_LAST.len()),
        (GB_FIRST.len(), GB_LAST.len()),
        (IT_FIRST.len(), IT_LAST.len()),
        (EU_FIRST.len(), EU_LAST.len()),
    ]
    .iter()
    .map(|(first, last)| first * last)
    .sum()
}

const ES_FIRST: &[&str] = &[
    "Alejandro",
    "Adrián",
    "Álvaro",
    "Andrés",
    "Antonio",
    "Carlos",
    "César",
    "Daniel",
    "David",
    "Diego",
    "Eduardo",
    "Enrique",
    "Ernesto",
    "Fernando",
    "Francisco",
    "Gabriel",
    "Gonzalo",
    "Guillermo",
    "Héctor",
    "Hugo",
    "Iván",
    "Javier",
    "Jorge",
    "José",
    "Juan",
    "Julián",
    "Lucas",
    "Manuel",
    "Marcos",
    "Mario",
    "Martín",
    "Miguel",
    "Nicolás",
    "Óscar",
    "Pablo",
    "Pedro",
    "Rafael",
    "Raúl",
    "Rubén",
    "Sergio",
];
const ES_LAST: &[&str] = &[
    "Aguilar",
    "Alonso",
    "Arroyo",
    "Báez",
    "Blanco",
    "Bravo",
    "Cabrera",
    "Calvo",
    "Campos",
    "Castaño",
    "Crespo",
    "Delgado",
    "Domínguez",
    "Esteban",
    "Fuentes",
    "Gallardo",
    "Gil",
    "Guerrero",
    "Herrero",
    "Ibáñez",
    "Iglesias",
    "Lozano",
    "Marín",
    "Medina",
    "Mora",
    "Moreno",
    "Navarro",
    "Ortega",
    "Pascual",
    "Peña",
    "Prieto",
    "Rivas",
    "Robles",
    "Rubio",
    "Salinas",
    "Santana",
    "Soler",
    "Sosa",
    "Vargas",
    "Vidal",
];
const FR_FIRST: &[&str] = &[
    "Adrien",
    "Alexandre",
    "Antoine",
    "Arthur",
    "Baptiste",
    "Benjamin",
    "Clément",
    "Damien",
    "Étienne",
    "Florian",
    "Guillaume",
    "Hugo",
    "Julien",
    "Kévin",
    "Lucas",
    "Mathieu",
    "Maxime",
    "Nicolas",
    "Olivier",
    "Pierre",
    "Quentin",
    "Romain",
    "Théo",
    "Thibault",
];
const FR_LAST: &[&str] = &[
    "Bernard",
    "Blanchard",
    "Bonnet",
    "Chevalier",
    "Colin",
    "Dubois",
    "Dupuis",
    "Fabre",
    "Faure",
    "Gauthier",
    "Girard",
    "Lambert",
    "Lefèvre",
    "Lemaire",
    "Marchand",
    "Morel",
    "Perrin",
    "Renard",
    "Rousseau",
    "Roux",
    "Simon",
    "Vidal",
    "Vincent",
    "Weber",
];
const DE_FIRST: &[&str] = &[
    "Alexander",
    "Benedikt",
    "Christian",
    "Dennis",
    "Felix",
    "Florian",
    "Jan",
    "Jonas",
    "Kai",
    "Lars",
    "Leon",
    "Lukas",
    "Marcel",
    "Moritz",
    "Niklas",
    "Pascal",
    "Philipp",
    "Sebastian",
    "Simon",
    "Stefan",
    "Tim",
    "Tobias",
    "Tom",
    "Yannick",
];
const DE_LAST: &[&str] = &[
    "Albrecht", "Bauer", "Becker", "Brandt", "Engel", "Fischer", "Graf", "Hartmann", "Hoffmann",
    "Jansen", "Keller", "Köhler", "Krüger", "Lehmann", "Neumann", "Ortmann", "Richter", "Schäfer",
    "Schmid", "Seidel", "Vogel", "Wagner", "Winter", "Ziegler",
];
const NORDIC_FIRST: &[&str] = &[
    "Anders", "Bjørn", "Emil", "Erik", "Filip", "Gustav", "Henrik", "Jens", "Joakim", "Johan",
    "Kasper", "Lasse", "Magnus", "Mikkel", "Nils", "Oskar", "Rasmus", "Simon", "Sofus", "Thor",
    "Victor", "William", "Ville", "Viggo",
];
const NORDIC_LAST: &[&str] = &[
    "Andersen",
    "Berg",
    "Bjørnsen",
    "Christensen",
    "Dahl",
    "Eriksen",
    "Hansen",
    "Holm",
    "Jensen",
    "Johansson",
    "Karlsson",
    "Larsen",
    "Lindberg",
    "Lund",
    "Madsen",
    "Nielsen",
    "Nyberg",
    "Olsen",
    "Pedersen",
    "Rasmussen",
    "Sørensen",
    "Strand",
    "Svensson",
    "Thomsen",
];
const PL_FIRST: &[&str] = &[
    "Adam",
    "Bartosz",
    "Damian",
    "Dawid",
    "Filip",
    "Grzegorz",
    "Jakub",
    "Kamil",
    "Konrad",
    "Krzysztof",
    "Łukasz",
    "Maciej",
    "Marcin",
    "Mateusz",
    "Michał",
    "Paweł",
    "Piotr",
    "Rafał",
    "Sebastian",
    "Szymon",
    "Tomasz",
    "Wojciech",
];
const PL_LAST: &[&str] = &[
    "Adamski",
    "Baran",
    "Chmielewski",
    "Dąbrowski",
    "Duda",
    "Górski",
    "Jankowski",
    "Kaczmarek",
    "Kowalczyk",
    "Krawczyk",
    "Lewandowski",
    "Majewski",
    "Mazur",
    "Nowak",
    "Piotrowski",
    "Sadowski",
    "Sikora",
    "Szymański",
    "Walczak",
    "Wiśniewski",
    "Wróbel",
    "Zając",
];
const GB_FIRST: &[&str] = &[
    "Aaron", "Callum", "Connor", "Dominic", "Elliot", "Finley", "George", "Harry", "Jack", "Jamie",
    "Joshua", "Kieran", "Liam", "Mason", "Nathan", "Oliver", "Owen", "Reece", "Ryan", "Samuel",
    "Tyler", "Zach",
];
const GB_LAST: &[&str] = &[
    "Ashworth", "Barnes", "Bennett", "Carter", "Chapman", "Dawson", "Ellis", "Fletcher", "Foster",
    "Gibson", "Hadley", "Holland", "Hughes", "Marsh", "Murray", "Palmer", "Reeves", "Sutton",
    "Thornton", "Walsh", "Whitaker", "Wilkes",
];
const IT_FIRST: &[&str] = &[
    "Alessandro",
    "Andrea",
    "Davide",
    "Diogo",
    "Edoardo",
    "Federico",
    "Filippo",
    "Francesco",
    "Gabriele",
    "Giacomo",
    "João",
    "Leonardo",
    "Lorenzo",
    "Luca",
    "Marco",
    "Matteo",
    "Nuno",
    "Paolo",
    "Pedro",
    "Riccardo",
    "Rui",
    "Simone",
    "Tiago",
    "Vincenzo",
];
const IT_LAST: &[&str] = &[
    "Almeida",
    "Barbieri",
    "Bianchi",
    "Carvalho",
    "Conti",
    "Costa",
    "De Luca",
    "Esposito",
    "Ferrari",
    "Fontana",
    "Gallo",
    "Greco",
    "Lombardi",
    "Moretti",
    "Pereira",
    "Ricci",
    "Rinaldi",
    "Rossi",
    "Santos",
    "Serra",
    "Silva",
    "Teixeira",
    "Valentini",
    "Villa",
];
const EU_FIRST: &[&str] = &[
    "Adrian", "Alexis", "Andrei", "Bruno", "Dario", "Dimitri", "Emre", "Erik", "Gabor", "Ivan",
    "Jakub", "Kristof", "Lukas", "Marko", "Milan", "Nikola", "Petar", "Stefan", "Tomas", "Viktor",
];
const EU_LAST: &[&str] = &[
    "Horvat",
    "Ivanov",
    "Jovanovic",
    "Kovac",
    "Kovalenko",
    "Marek",
    "Nagy",
    "Novak",
    "Petrov",
    "Popescu",
    "Radu",
    "Sokolov",
    "Stoica",
    "Toth",
    "Varga",
    "Yilmaz",
    "Zielinski",
    "Zoric",
    "Dvorak",
    "Kral",
];

/// Gamer tags; a nick never equals the full name of the player who wears it.
const NICKS: &[&str] = &[
    "Aether", "Akira", "Apex", "Arcos", "Atlas", "Axiom", "Bandit", "Bishop", "Blaze", "Bolt",
    "Brisa", "Cairo", "Cinder", "Cobalt", "Comet", "Cortex", "Crow", "Dagger", "Dingo", "Drift",
    "Echo", "Eclipse", "Ember", "Falco", "Fenix", "Flint", "Frost", "Gale", "Ghost", "Glitch",
    "Halo", "Havoc", "Hydra", "Icarus", "Indigo", "Ion", "Jackal", "Jinx", "Kestrel", "Kilo",
    "Koda", "Lance", "Lumen", "Lynx", "Maverick", "Mirage", "Mistral", "Mono", "Nebula", "Neon",
    "Nimbus", "Nova", "Onyx", "Orbit", "Otter", "Pixel", "Phantom", "Pulse", "Quartz", "Quill",
    "Radar", "Raven", "Razor", "Rift", "Rogue", "Rune", "Saga", "Sable", "Scout", "Shade",
    "Sierra", "Slate", "Spark", "Spike", "Sprout", "Storm", "Talon", "Tempo", "Terra", "Thorn",
    "Tidal", "Titan", "Torque", "Umbra", "Vandal", "Vapor", "Vector", "Velvet", "Vertex", "Viper",
    "Volt", "Vortex", "Warden", "Wisp", "Wolf", "Xeno", "Yeti", "Zap", "Zenith", "Zephyr", "Zinc",
    "Zorro", "Bruma", "Cuervo", "Duende", "Estela", "Faro", "Gato", "Hielo", "Jaguar", "Lobo",
    "Marea", "Niebla", "Ola", "Pirata", "Rayo", "Sol", "Tigre", "Trueno", "Volcan",
];

#[cfg(test)]
mod tests {
    use super::*;

    /// Shared empty set for specs that reserve no full names.
    static NO_FULL_NAMES: std::sync::LazyLock<HashSet<String>> =
        std::sync::LazyLock::new(HashSet::new);

    fn date() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 11, 9).expect("valid date")
    }

    fn les() -> OvrPercentiles {
        OvrPercentiles {
            p10: 68,
            p25: 70,
            p50: 71,
            p75: 72,
            p90: 73,
            from_peers: true,
        }
    }

    fn lec() -> OvrPercentiles {
        OvrPercentiles {
            p10: 72,
            p25: 76,
            p50: 80,
            p75: 83,
            p90: 86,
            from_peers: true,
        }
    }

    fn squad_for(percentiles: OvrPercentiles, nationalities: &[&str], seed: u64) -> Vec<Player> {
        let taken = HashSet::new();
        let spec = SquadSpec {
            club_slug: "Rayo",
            percentiles,
            nationalities,
            today: date(),
            taken_match_names: &taken,
            taken_full_names: &NO_FULL_NAMES,
            serial: 1,
            wage_budget: None,
        };
        generate_founding_squad(&spec, seed).expect("squad")
    }

    fn ovrs(squad: &[Player]) -> Vec<i32> {
        squad
            .iter()
            .map(|p| i32::from(calculate_lol_ovr(p)))
            .collect()
    }

    #[test]
    fn same_seed_gives_the_same_squad() {
        let a = squad_for(les(), &["ES"], 42);
        let b = squad_for(les(), &["ES"], 42);
        let key = |s: &[Player]| {
            s.iter()
                .map(|p| {
                    (
                        p.id.clone(),
                        p.match_name.clone(),
                        p.full_name.clone(),
                        p.wage,
                        p.date_of_birth.clone(),
                        p.potential_base,
                    )
                })
                .collect::<Vec<_>>()
        };
        assert_eq!(key(&a), key(&b));
    }

    #[test]
    fn different_seeds_give_different_squads() {
        let a = squad_for(les(), &["ES"], 1);
        let b = squad_for(les(), &["ES"], 2);
        assert_ne!(
            a.iter().map(|p| p.full_name.clone()).collect::<Vec<_>>(),
            b.iter().map(|p| p.full_name.clone()).collect::<Vec<_>>()
        );
    }

    #[test]
    fn squad_has_one_player_per_role_in_order() {
        let squad = squad_for(les(), &["ES"], 7);
        let roles: Vec<LolRole> = squad.iter().map(|p| p.natural_position).collect();
        assert_eq!(roles, SQUAD_ROLES.to_vec());
    }

    fn assert_bands(percentiles: OvrPercentiles, nationalities: &[&str]) {
        let median = i32::from(percentiles.p50);
        for seed in 0..400u64 {
            let squad = squad_for(percentiles, nationalities, seed);
            let values = ovrs(&squad);
            assert!(
                values.iter().all(|v| *v >= median - 4),
                "seed {seed}: {values:?}"
            );
            assert!(
                values.iter().all(|v| *v <= i32::from(percentiles.p75)),
                "seed {seed}: {values:?}"
            );
            assert!(
                values.iter().filter(|v| **v > median).count() <= 1,
                "seed {seed}: {values:?}"
            );
            let mean = f64::from(values.iter().sum::<i32>()) / 5.0;
            assert!(
                (f64::from(median) - 2.0..=f64::from(median) - 1.0).contains(&mean),
                "seed {seed}: {mean}"
            );
            assert!(
                validate_squad(&squad, &percentiles, date()).is_empty(),
                "seed {seed}"
            );
        }
    }

    #[test]
    fn les_squads_stay_inside_the_ovr_bands() {
        assert_bands(les(), &["ES"]);
    }

    #[test]
    fn lec_squads_stay_inside_the_ovr_bands() {
        assert_bands(lec(), &["FR", "DE", "DK", "PL"]);
    }

    #[test]
    fn fallback_window_squads_stay_inside_the_ovr_bands() {
        assert_bands(OvrPercentiles::FALLBACK, &["ES"]);
    }

    #[test]
    fn attributes_follow_the_role_template() {
        for seed in 0..100u64 {
            for player in squad_for(les(), &["ES"], seed) {
                let template = role_template(player.natural_position);
                let a = &player.attributes;
                let values = [
                    a.mechanics,
                    a.laning,
                    a.teamfighting,
                    a.macro_play,
                    a.consistency,
                    a.shotcalling,
                    a.champion_pool,
                    a.discipline,
                    a.mental_resilience,
                ];
                let ovr = i32::from(player.lol_ovr);
                let weak = i32::from(values[template.weak]) - ovr;
                assert_eq!(weak, -8, "seed {seed} weakness");
                for slot in template.key {
                    let bonus = i32::from(values[slot]) - ovr;
                    assert!((5..=8).contains(&bonus), "seed {seed} key bonus {bonus}");
                }
            }
        }
    }

    #[test]
    fn exactly_one_late_bloomer_under_the_median() {
        for seed in 0..300u64 {
            let squad = squad_for(les(), &["ES"], seed);
            let bloomers: Vec<&Player> = squad.iter().filter(|p| p.potential_base >= 84).collect();
            assert_eq!(bloomers.len(), 1, "seed {seed}");
            let bloomer = bloomers[0];
            assert!((84..=88).contains(&bloomer.potential_base));
            assert!(
                (68..=69).contains(&bloomer.lol_ovr),
                "seed {seed}: {}",
                bloomer.lol_ovr
            );
        }
    }

    #[test]
    fn regular_players_have_potential_between_70_and_82_and_above_their_ovr() {
        for seed in 0..200u64 {
            for p in squad_for(lec(), &["FR"], seed)
                .iter()
                .filter(|p| p.potential_base < 84)
            {
                assert!(
                    (70..=83).contains(&p.potential_base),
                    "seed {seed}: {}",
                    p.potential_base
                );
                assert!(p.potential_base > p.lol_ovr);
            }
        }
    }

    #[test]
    fn ages_are_19_to_27_and_weighted_to_21_24() {
        let mut core = 0;
        let mut total = 0;
        for seed in 0..300u64 {
            for p in squad_for(les(), &["ES"], seed) {
                let age = age_on(date(), &p.date_of_birth).expect("dob");
                assert!(AGE_RANGE.contains(&age), "age {age}");
                total += 1;
                core += i32::from((21..=24).contains(&age));
            }
        }
        assert!(f64::from(core) / f64::from(total) > 0.6);
    }

    #[test]
    fn wage_is_never_below_the_wage_scale_floor() {
        for seed in 0..300u64 {
            for p in squad_for(lec(), &["FR", "DE"], seed) {
                assert!(
                    p.wage >= scale_wage_for_market_value(p.market_value),
                    "seed {seed}"
                );
                assert!(p.market_value > 0);
            }
        }
    }

    #[test]
    fn contracts_last_two_years() {
        for p in squad_for(les(), &["ES"], 3) {
            assert_eq!(p.contract_end.as_deref(), Some("2028-11-30"));
        }
    }

    #[test]
    fn ids_follow_the_club_slug_role_and_serial() {
        let ids: Vec<String> = squad_for(les(), &["ES"], 5)
            .iter()
            .map(|p| p.id.clone())
            .collect();
        assert_eq!(
            ids,
            vec![
                "gen-rayo-top-1",
                "gen-rayo-jungle-1",
                "gen-rayo-mid-1",
                "gen-rayo-adc-1",
                "gen-rayo-support-1",
            ]
        );
    }

    #[test]
    fn nicks_differ_from_full_names_and_are_unique() {
        for seed in 0..300u64 {
            let squad = squad_for(les(), &["ES"], seed);
            let nicks: HashSet<String> =
                squad.iter().map(|p| p.match_name.to_lowercase()).collect();
            assert_eq!(nicks.len(), 5, "seed {seed}");
            for p in &squad {
                assert_ne!(p.match_name.to_lowercase(), p.full_name.to_lowercase());
            }
        }
    }

    #[test]
    fn nicks_never_clash_with_taken_match_names() {
        let taken: HashSet<String> = NICKS.iter().take(90).map(|n| n.to_lowercase()).collect();
        let spec = SquadSpec {
            club_slug: "rayo",
            percentiles: les(),
            nationalities: &["ES"],
            today: date(),
            taken_match_names: &taken,
            taken_full_names: &NO_FULL_NAMES,
            serial: 1,
            wage_budget: None,
        };
        for seed in 0..200u64 {
            let squad = generate_founding_squad(&spec, seed).expect("squad");
            assert!(
                squad
                    .iter()
                    .all(|p| !taken.contains(&p.match_name.to_lowercase()))
            );
        }
    }

    #[test]
    fn full_names_never_clash_with_taken_full_names() {
        let reserved: HashSet<String> = (0..50u64)
            .flat_map(|seed| squad_for(les(), &["ES"], seed))
            .map(|p| p.full_name.to_lowercase())
            .collect();
        let no_nicks = HashSet::new();
        let spec = SquadSpec {
            club_slug: "rayo",
            percentiles: les(),
            nationalities: &["ES"],
            today: date(),
            taken_match_names: &no_nicks,
            taken_full_names: &reserved,
            serial: 1,
            wage_budget: None,
        };
        for seed in 0..50u64 {
            let squad = generate_founding_squad(&spec, seed).expect("squad");
            assert!(
                squad
                    .iter()
                    .all(|p| !reserved.contains(&p.full_name.to_lowercase())),
                "seed {seed}"
            );
        }
    }

    #[test]
    fn latam_and_brazil_codes_use_their_own_name_pools() {
        assert_eq!(name_pool("MX").first, ES_FIRST);
        assert_eq!(name_pool("br").last, IT_LAST);
    }

    #[test]
    fn name_pool_is_much_larger_than_twenty_by_twenty() {
        assert!(name_combinations() > 400 * 10);
        assert!(ES_FIRST.len() * ES_LAST.len() >= 1_600);
    }

    #[test]
    fn nationality_comes_from_the_given_list() {
        for p in squad_for(lec(), &["FR", "DK"], 11) {
            assert!(p.nationality == "FR" || p.nationality == "DK");
        }
    }

    #[test]
    fn empty_slug_or_nationalities_are_rejected() {
        let taken = HashSet::new();
        let mut spec = SquadSpec {
            club_slug: "--",
            percentiles: les(),
            nationalities: &["ES"],
            today: date(),
            taken_match_names: &taken,
            taken_full_names: &NO_FULL_NAMES,
            serial: 1,
            wage_budget: None,
        };
        assert_eq!(
            generate_founding_squad(&spec, 1).err(),
            Some(SquadError::EmptyClubSlug)
        );
        spec.club_slug = "rayo";
        spec.nationalities = &[];
        assert_eq!(
            generate_founding_squad(&spec, 1).err(),
            Some(SquadError::NoNationalities)
        );
    }

    #[test]
    fn unsupported_median_is_a_clear_error() {
        let taken = HashSet::new();
        let spec = SquadSpec {
            club_slug: "rayo",
            percentiles: OvrPercentiles {
                p50: 95,
                p75: 97,
                ..les()
            },
            nationalities: &["ES"],
            today: date(),
            taken_match_names: &taken,
            taken_full_names: &NO_FULL_NAMES,
            serial: 1,
            wage_budget: None,
        };
        assert_eq!(
            generate_founding_squad(&spec, 1).err(),
            Some(SquadError::UnsupportedMedian(95))
        );
    }

    #[test]
    fn inconsistent_percentiles_report_the_unsatisfied_window() {
        let taken = HashSet::new();
        // p75 below the median: no starter can sit inside the window and under p75.
        let spec = SquadSpec {
            club_slug: "rayo",
            percentiles: OvrPercentiles { p75: 60, ..les() },
            nationalities: &["ES"],
            today: date(),
            taken_match_names: &taken,
            taken_full_names: &NO_FULL_NAMES,
            serial: 1,
            wage_budget: None,
        };
        match generate_founding_squad(&spec, 1) {
            Err(SquadError::WindowUnsatisfied {
                attempts,
                violations,
            }) => {
                assert_eq!(attempts, MAX_ATTEMPTS);
                assert!(!violations.is_empty());
            }
            other => panic!("expected WindowUnsatisfied, got {other:?}"),
        }
    }

    #[test]
    fn validator_flags_a_squad_that_breaks_the_window() {
        let mut squad = squad_for(les(), &["ES"], 9);
        squad[0].attributes = PlayerAttributes::from_array([90; 9]);
        squad[0].lol_ovr = 90;
        let problems = validate_squad(&squad, &les(), date());
        assert!(problems.iter().any(|p| p.contains("above the ceiling")));
    }

    fn squad_with_budget(
        percentiles: OvrPercentiles,
        nationalities: &[&str],
        budget: i64,
        seed: u64,
    ) -> Vec<Player> {
        let taken = HashSet::new();
        let spec = SquadSpec {
            club_slug: "rayo",
            percentiles,
            nationalities,
            today: date(),
            taken_match_names: &taken,
            taken_full_names: &NO_FULL_NAMES,
            serial: 1,
            wage_budget: Some(budget),
        };
        generate_founding_squad(&spec, seed).expect("squad")
    }

    #[test]
    fn bill_lands_inside_the_window_for_les_and_lec_budgets() {
        for (percentiles, nats, budget) in [
            (les(), vec!["ES"], 1_297_570i64),
            (lec(), vec!["FR", "DE"], 1_750_000i64),
        ] {
            for seed in 0..300u64 {
                let squad = squad_with_budget(percentiles, &nats, budget, seed);
                assert_eq!(
                    bill_violation(&squad, budget),
                    None,
                    "seed {seed}: {}",
                    squad_bill(&squad)
                );
            }
        }
    }

    #[test]
    fn scaled_wages_stay_at_or_above_the_wage_floor() {
        for seed in 0..300u64 {
            for p in squad_with_budget(lec(), &["FR"], 1_750_000, seed) {
                assert!(
                    p.wage >= scale_wage_for_market_value(p.market_value),
                    "seed {seed}"
                );
            }
        }
    }

    #[test]
    fn a_tiny_budget_cannot_pull_wages_under_the_floor() {
        let taken = HashSet::new();
        let spec = SquadSpec {
            club_slug: "rayo",
            percentiles: les(),
            nationalities: &["ES"],
            today: date(),
            taken_match_names: &taken,
            taken_full_names: &NO_FULL_NAMES,
            serial: 1,
            wage_budget: Some(100_000),
        };
        assert!(matches!(
            generate_founding_squad(&spec, 1),
            Err(SquadError::WindowUnsatisfied { .. })
        ));
    }

    #[test]
    fn bill_violation_reports_a_bill_outside_the_window() {
        let squad = squad_for(les(), &["ES"], 4);
        assert!(bill_violation(&squad, 1_000_000_000).is_some());
    }

    fn spec_for<'a>(
        percentiles: OvrPercentiles,
        taken: &'a HashSet<String>,
        today: NaiveDate,
        wage_budget: Option<i64>,
    ) -> SquadSpec<'a> {
        SquadSpec {
            club_slug: "rayo",
            percentiles,
            nationalities: &["ES"],
            today,
            taken_match_names: taken,
            taken_full_names: &NO_FULL_NAMES,
            serial: 1,
            wage_budget,
        }
    }

    fn identity_key(squad: &[Player]) -> Vec<(String, String, u32, String)> {
        squad
            .iter()
            .map(|p| {
                (
                    p.match_name.clone(),
                    p.full_name.clone(),
                    p.wage,
                    p.date_of_birth.clone(),
                )
            })
            .collect()
    }

    #[test]
    fn same_seed_and_budget_give_the_same_wages() {
        let a = squad_with_budget(les(), &["ES"], 1_297_570, 42);
        let b = squad_with_budget(les(), &["ES"], 1_297_570, 42);
        assert_eq!(identity_key(&a), identity_key(&b));
    }

    #[test]
    fn every_median_is_supported_or_rejected_clearly() {
        let taken = HashSet::new();
        for median in 0..=99u8 {
            let percentiles = OvrPercentiles {
                p10: median.saturating_sub(4),
                p25: median.saturating_sub(2),
                p50: median,
                p75: median.saturating_add(2).min(99),
                p90: median.saturating_add(4).min(99),
                from_peers: true,
            };
            let supported = (MIN_SUPPORTED_MEDIAN..=MAX_SUPPORTED_MEDIAN).contains(&median);
            for seed in 0..40u64 {
                let spec = spec_for(percentiles, &taken, date(), None);
                match generate_founding_squad(&spec, seed) {
                    Ok(squad) => {
                        assert!(supported, "median {median} should be rejected");
                        assert!(
                            validate_squad(&squad, &percentiles, date()).is_empty(),
                            "median {median} seed {seed}"
                        );
                    }
                    Err(error) => {
                        assert!(!supported, "median {median} seed {seed}: {error}");
                        assert_eq!(error, SquadError::UnsupportedMedian(median));
                    }
                }
            }
        }
    }

    #[test]
    fn the_highest_supported_median_still_has_one_bloomer() {
        let percentiles = OvrPercentiles {
            p50: MAX_SUPPORTED_MEDIAN,
            p75: MAX_SUPPORTED_MEDIAN + 2,
            ..lec()
        };
        for seed in 0..200u64 {
            let squad = squad_for(percentiles, &["ES"], seed);
            let bloomers = squad.iter().filter(|p| p.potential_base >= 84).count();
            assert_eq!(bloomers, 1, "seed {seed}");
        }
    }

    #[test]
    fn full_names_are_unique_inside_a_squad() {
        for seed in 0..3_000u64 {
            let squad = squad_for(les(), &["ES"], seed);
            let names: HashSet<String> = squad.iter().map(|p| p.full_name.to_lowercase()).collect();
            assert_eq!(names.len(), 5, "seed {seed}");
        }
    }

    #[test]
    fn an_exhausted_nick_pool_is_a_clear_error() {
        let mut taken: HashSet<String> = HashSet::new();
        for tag in NICKS {
            let tag = tag.to_lowercase();
            taken.insert(format!("{tag}x"));
            for n in 2..=99 {
                taken.insert(format!("{tag}{n}"));
            }
            taken.insert(tag);
        }
        let spec = spec_for(les(), &taken, date(), None);
        assert_eq!(
            generate_founding_squad(&spec, 1).err(),
            Some(SquadError::NamesExhausted)
        );
    }

    #[test]
    fn a_leap_day_start_still_gives_ages_19_to_27() {
        let today = NaiveDate::from_ymd_opt(2028, 2, 29).expect("leap day");
        let taken = HashSet::new();
        for seed in 0..200u64 {
            let spec = spec_for(les(), &taken, today, None);
            let squad = generate_founding_squad(&spec, seed).expect("squad");
            for p in &squad {
                let age = age_on(today, &p.date_of_birth).expect("dob");
                assert!(AGE_RANGE.contains(&age), "seed {seed}: age {age}");
            }
        }
    }

    #[test]
    fn birth_date_for_a_leap_day_falls_back_to_the_previous_day() {
        let today = NaiveDate::from_ymd_opt(2028, 2, 29).expect("leap day");
        let born = birth_date_for_age(today, 21, 0).expect("birth date");
        assert_eq!(born, NaiveDate::from_ymd_opt(2007, 2, 28).expect("date"));
    }

    #[test]
    fn wages_are_never_scaled_past_the_cap() {
        for seed in 0..200u64 {
            let squad = squad_with_budget(lec(), &["FR"], 1_750_000, seed);
            let floor: i128 = squad
                .iter()
                .map(|p| i128::from(scale_wage_for_market_value(p.market_value)))
                .sum();
            let bill = i128::from(squad_bill(&squad));
            assert!(
                bill * 100 <= floor * MAX_WAGE_SCALE_PCT + 5_000 * 100,
                "seed {seed}: bill {bill} floor {floor}"
            );
        }
    }

    #[test]
    fn a_budget_that_needs_a_huge_scale_up_is_refused() {
        let taken = HashSet::new();
        let spec = spec_for(les(), &taken, date(), Some(50_000_000));
        match generate_founding_squad(&spec, 1) {
            Err(SquadError::WindowUnsatisfied { violations, .. }) => {
                assert!(violations.iter().any(|v| v.contains("wage budget")));
            }
            other => panic!("expected WindowUnsatisfied, got {other:?}"),
        }
    }

    #[test]
    fn derived_budget_puts_the_floor_bill_at_95_percent_in_10k_steps() {
        for seed in 0..300u64 {
            let squad = squad_for(lec(), &["FR", "DE"], seed);
            let bill = squad_bill(&squad);
            let budget = founding_wage_budget(&squad);
            assert_eq!(budget % 10_000, 0, "seed {seed}");
            assert!(
                bill * 100 <= budget * DERIVED_BUDGET_BILL_PCT,
                "seed {seed}"
            );
            assert!(
                bill * 100 > (budget - 10_000) * DERIVED_BUDGET_BILL_PCT,
                "seed {seed}"
            );
        }
    }

    #[test]
    fn derived_budget_leaves_about_sixteen_percent_of_the_bill_as_room() {
        for seed in 0..300u64 {
            let squad = squad_for(les(), &["ES"], seed);
            let bill = squad_bill(&squad);
            let room = founding_wage_budget(&squad) * 110 / 100 - bill;
            let ratio = room as f64 / bill as f64;
            assert!((0.15..=0.17).contains(&ratio), "seed {seed}: {ratio}");
        }
    }

    #[test]
    fn derived_budget_of_an_empty_squad_is_zero() {
        assert_eq!(founding_wage_budget(&[]), 0);
    }

    #[test]
    fn budget_for_a_bill_keeps_the_bill_at_95_percent_rounded_up_to_10k() {
        assert_eq!(wage_budget_for_bill(950_000), 1_000_000);
        assert_eq!(wage_budget_for_bill(1_000_000), 1_060_000);
        assert_eq!(wage_budget_for_bill(-5), 0);
    }

    #[test]
    fn validator_flags_a_short_squad() {
        let squad = squad_for(les(), &["ES"], 9);
        assert!(!validate_squad(&squad[..4], &les(), date()).is_empty());
    }
}
