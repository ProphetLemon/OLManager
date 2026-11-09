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
/// Contract length of every founding player, in years.
pub const CONTRACT_YEARS: i32 = 2;
/// Youngest and oldest founding player.
pub const AGE_RANGE: std::ops::RangeInclusive<i32> = 19..=27;

/// Lowest OVR offset below the league median for a regular starter.
const MAX_OFFSET_BELOW_MEDIAN: i32 = 5;
/// The weakest starter may never sit further below the median than this.
const WEAKEST_OFFSET_BELOW_MEDIAN: i32 = 7;
/// Accepted squad mean, as offsets below the median (inclusive, about 3).
const MEAN_OFFSET_WINDOW: std::ops::RangeInclusive<i32> = 2..=4;
/// Chance, in 1 out of N, that one starter sits one point above the median.
const ABOVE_MEDIAN_ONE_IN: u32 = 5;
/// Weights of an OVR offset of 0..=5 points below the median (mean offset 3).
const OFFSET_WEIGHTS: [u32; 6] = [1, 2, 3, 4, 4, 3];
/// Weights of ages 19..=27, concentrated on 21-24.
const AGE_WEIGHTS: [u32; 9] = [1, 2, 4, 4, 4, 4, 2, 1, 1];
/// Hidden potential of a regular founding player.
const POTENTIAL_RANGE: std::ops::RangeInclusive<u8> = 70..=82;
/// Hidden potential of the late bloomer.
const BLOOMER_POTENTIAL_RANGE: std::ops::RangeInclusive<u8> = 84..=88;
/// Potential from which a player counts as the late bloomer.
const BLOOMER_POTENTIAL_FLOOR: u8 = 84;
/// Lowest median the attribute template can express without clamping.
const MIN_SUPPORTED_MEDIAN: u8 = 20;
/// Highest median the attribute template can express without clamping.
const MAX_SUPPORTED_MEDIAN: u8 = 90;
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
                write!(f, "league median OVR {median} is outside the supported range")
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
    /// The `n` of the ids `gen-<slug>-<role>-<n>`.
    pub serial: u32,
}

/// A squad member before it becomes a [`Player`].
struct Plan {
    role: LolRole,
    ovr: u8,
    bloomer: bool,
}

/// Generates the five founding players, one per role in [`SQUAD_ROLES`] order.
///
/// Deterministic per `seed`. When a draw breaks the league window it re-seeds
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
        let attempt_seed = seed.wrapping_add(u64::from(attempt).wrapping_mul(0x9E37_79B9_7F4A_7C15));
        let mut rng = StdRng::seed_from_u64(attempt_seed);
        let squad = build_squad(spec, &slug, &mut rng)?;
        let violations = validate_squad(&squad, &spec.percentiles, spec.today);
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
/// `min(median+1, p75)`, none above p75), the mean (about `median-3`), the
/// weakest starter, ages, the single late bloomer and the 2-year contracts.
pub fn validate_squad(squad: &[Player], percentiles: &OvrPercentiles, today: NaiveDate) -> Vec<String> {
    let mut problems = Vec::new();
    if squad.len() != SQUAD_ROLES.len() {
        problems.push(format!("expected 5 players, got {}", squad.len()));
        return problems;
    }
    let median = i32::from(percentiles.p50);
    let ceiling = median.max((median + 1).min(i32::from(percentiles.p75)));
    let ovrs: Vec<i32> = squad.iter().map(|p| i32::from(calculate_lol_ovr(p))).collect();

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
            problems.push(format!("{} cached OVR differs from its attributes", player.id));
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
        problems.push(format!("squad mean {:.1} outside the window", f64::from(sum) / f64::from(count)));
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

/// Full years between `date_of_birth` (`%Y-%m-%d`) and `today`, counted the
/// way the contract code does (year difference, minus one before the birthday).
fn age_on(today: NaiveDate, date_of_birth: &str) -> Option<i32> {
    let dob = NaiveDate::parse_from_str(date_of_birth, "%Y-%m-%d").ok()?;
    let mut age = today.year() - dob.year();
    if today.ordinal() < dob.ordinal() {
        age -= 1;
    }
    Some(age)
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
                // The bloomer sits near the bottom of the window.
                rng.random_range(3..=MAX_OFFSET_BELOW_MEDIAN)
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

fn build_squad(spec: &SquadSpec<'_>, slug: &str, rng: &mut StdRng) -> Result<Vec<Player>, SquadError> {
    let plans = plan_squad(rng, &spec.percentiles);
    let mut used: HashSet<String> = HashSet::new();
    let mut squad = Vec::with_capacity(plans.len());
    for plan in plans {
        let nationality = spec.nationalities[rng.random_range(0..spec.nationalities.len())];
        let (full_name, match_name) =
            invent_identity(rng, nationality, spec.taken_match_names, &mut used)?;
        let age = AGE_RANGE.start() + weighted_index(rng, &AGE_WEIGHTS) as i32;
        let extra_days = rng.random_range(0..=364u64);
        let date_of_birth = birth_date_for_age(spec.today, age, extra_days)
            .map(|d| d.format("%Y-%m-%d").to_string())
            .unwrap_or_default();

        let attributes = shaped_attributes(rng, plan.role, plan.ovr);
        let id = format!("gen-{slug}-{}-{}", role_slug(plan.role), spec.serial);
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
            rng.random_range(POTENTIAL_RANGE).max(ovr.saturating_add(1).min(99))
        };
        player.market_value = market_value_for(ovr, player.potential_base, age);
        player.contract_end = Some(contract_end(spec.today));
        player.wage = wage_for(&player, spec.today);
        squad.push(player);
    }
    Ok(squad)
}

/// Picks a free `(full_name, nick)` for `nationality`. The nick differs from
/// the full name, from every taken nick and from the nicks already used.
fn invent_identity(
    rng: &mut StdRng,
    nationality: &str,
    taken: &HashSet<String>,
    used: &mut HashSet<String>,
) -> Result<(String, String), SquadError> {
    let pool = name_pool(nationality);
    let first = pool.first[rng.random_range(0..pool.first.len())];
    let last = pool.last[rng.random_range(0..pool.last.len())];
    let full_name = format!("{first} {last}");

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
        return Ok((full_name, nick));
    }
    Err(SquadError::NamesExhausted)
}

struct NamePool {
    first: &'static [&'static str],
    last: &'static [&'static str],
}

/// Name pool for an ISO-2 nationality; unknown codes get the mixed European one.
fn name_pool(nationality: &str) -> NamePool {
    match nationality.trim().to_ascii_uppercase().as_str() {
        "ES" => NamePool { first: ES_FIRST, last: ES_LAST },
        "FR" => NamePool { first: FR_FIRST, last: FR_LAST },
        "DE" => NamePool { first: DE_FIRST, last: DE_LAST },
        "DK" | "SE" | "NO" | "FI" => NamePool { first: NORDIC_FIRST, last: NORDIC_LAST },
        "PL" => NamePool { first: PL_FIRST, last: PL_LAST },
        "GB" | "UK" | "IE" => NamePool { first: GB_FIRST, last: GB_LAST },
        "IT" | "PT" => NamePool { first: IT_FIRST, last: IT_LAST },
        _ => NamePool { first: EU_FIRST, last: EU_LAST },
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
    "Alejandro", "Adrián", "Álvaro", "Andrés", "Antonio", "Carlos", "César", "Daniel", "David",
    "Diego", "Eduardo", "Enrique", "Ernesto", "Fernando", "Francisco", "Gabriel", "Gonzalo",
    "Guillermo", "Héctor", "Hugo", "Iván", "Javier", "Jorge", "José", "Juan", "Julián", "Lucas",
    "Manuel", "Marcos", "Mario", "Martín", "Miguel", "Nicolás", "Óscar", "Pablo", "Pedro",
    "Rafael", "Raúl", "Rubén", "Sergio",
];
const ES_LAST: &[&str] = &[
    "Aguilar", "Alonso", "Arroyo", "Báez", "Blanco", "Bravo", "Cabrera", "Calvo", "Campos",
    "Castaño", "Crespo", "Delgado", "Domínguez", "Esteban", "Fuentes", "Gallardo", "Gil",
    "Guerrero", "Herrero", "Ibáñez", "Iglesias", "Lozano", "Marín", "Medina", "Mora", "Moreno",
    "Navarro", "Ortega", "Pascual", "Peña", "Prieto", "Rivas", "Robles", "Rubio", "Salinas",
    "Santana", "Soler", "Sosa", "Vargas", "Vidal",
];
const FR_FIRST: &[&str] = &[
    "Adrien", "Alexandre", "Antoine", "Arthur", "Baptiste", "Benjamin", "Clément", "Damien",
    "Étienne", "Florian", "Guillaume", "Hugo", "Julien", "Kévin", "Lucas", "Mathieu", "Maxime",
    "Nicolas", "Olivier", "Pierre", "Quentin", "Romain", "Théo", "Thibault",
];
const FR_LAST: &[&str] = &[
    "Bernard", "Blanchard", "Bonnet", "Chevalier", "Colin", "Dubois", "Dupuis", "Fabre", "Faure",
    "Gauthier", "Girard", "Lambert", "Lefèvre", "Lemaire", "Marchand", "Morel", "Perrin",
    "Renard", "Rousseau", "Roux", "Simon", "Vidal", "Vincent", "Weber",
];
const DE_FIRST: &[&str] = &[
    "Alexander", "Benedikt", "Christian", "Dennis", "Felix", "Florian", "Jan", "Jonas", "Kai",
    "Lars", "Leon", "Lukas", "Marcel", "Moritz", "Niklas", "Pascal", "Philipp", "Sebastian",
    "Simon", "Stefan", "Tim", "Tobias", "Tom", "Yannick",
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
    "Andersen", "Berg", "Bjørnsen", "Christensen", "Dahl", "Eriksen", "Hansen", "Holm", "Jensen",
    "Johansson", "Karlsson", "Larsen", "Lindberg", "Lund", "Madsen", "Nielsen", "Nyberg",
    "Olsen", "Pedersen", "Rasmussen", "Sørensen", "Strand", "Svensson", "Thomsen",
];
const PL_FIRST: &[&str] = &[
    "Adam", "Bartosz", "Damian", "Dawid", "Filip", "Grzegorz", "Jakub", "Kamil", "Konrad",
    "Krzysztof", "Łukasz", "Maciej", "Marcin", "Mateusz", "Michał", "Paweł", "Piotr", "Rafał",
    "Sebastian", "Szymon", "Tomasz", "Wojciech",
];
const PL_LAST: &[&str] = &[
    "Adamski", "Baran", "Chmielewski", "Dąbrowski", "Duda", "Górski", "Jankowski", "Kaczmarek",
    "Kowalczyk", "Krawczyk", "Lewandowski", "Majewski", "Mazur", "Nowak", "Piotrowski", "Sadowski",
    "Sikora", "Szymański", "Walczak", "Wiśniewski", "Wróbel", "Zając",
];
const GB_FIRST: &[&str] = &[
    "Aaron", "Callum", "Connor", "Dominic", "Elliot", "Finley", "George", "Harry", "Jack",
    "Jamie", "Joshua", "Kieran", "Liam", "Mason", "Nathan", "Oliver", "Owen", "Reece", "Ryan",
    "Samuel", "Tyler", "Zach",
];
const GB_LAST: &[&str] = &[
    "Ashworth", "Barnes", "Bennett", "Carter", "Chapman", "Dawson", "Ellis", "Fletcher", "Foster",
    "Gibson", "Hadley", "Holland", "Hughes", "Marsh", "Murray", "Palmer", "Reeves", "Sutton",
    "Thornton", "Walsh", "Whitaker", "Wilkes",
];
const IT_FIRST: &[&str] = &[
    "Alessandro", "Andrea", "Davide", "Diogo", "Edoardo", "Federico", "Filippo", "Francesco",
    "Gabriele", "Giacomo", "João", "Leonardo", "Lorenzo", "Luca", "Marco", "Matteo", "Nuno",
    "Paolo", "Pedro", "Riccardo", "Rui", "Simone", "Tiago", "Vincenzo",
];
const IT_LAST: &[&str] = &[
    "Almeida", "Barbieri", "Bianchi", "Carvalho", "Conti", "Costa", "De Luca", "Esposito",
    "Ferrari", "Fontana", "Gallo", "Greco", "Lombardi", "Moretti", "Pereira", "Ricci", "Rinaldi",
    "Rossi", "Santos", "Serra", "Silva", "Teixeira", "Valentini", "Villa",
];
const EU_FIRST: &[&str] = &[
    "Adrian", "Alexis", "Andrei", "Bruno", "Dario", "Dimitri", "Emre", "Erik", "Gabor", "Ivan",
    "Jakub", "Kristof", "Lukas", "Marko", "Milan", "Nikola", "Petar", "Stefan", "Tomas", "Viktor",
];
const EU_LAST: &[&str] = &[
    "Horvat", "Ivanov", "Jovanovic", "Kovac", "Kovalenko", "Marek", "Nagy", "Novak", "Petrov",
    "Popescu", "Radu", "Sokolov", "Stoica", "Toth", "Varga", "Yilmaz", "Zielinski", "Zoric",
    "Dvorak", "Kral",
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
    "Volt", "Vortex", "Warden", "Wisp", "Wolf", "Xeno", "Yeti", "Zap", "Zenith", "Zephyr",
    "Zinc", "Zorro", "Bruma", "Cuervo", "Duende", "Estela", "Faro", "Gato", "Hielo", "Jaguar",
    "Lobo", "Marea", "Niebla", "Ola", "Pirata", "Rayo", "Sol", "Tigre", "Trueno", "Volcan",
];

#[cfg(test)]
mod tests {
    use super::*;

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
            serial: 1,
        };
        generate_founding_squad(&spec, seed).expect("squad")
    }

    fn ovrs(squad: &[Player]) -> Vec<i32> {
        squad.iter().map(|p| i32::from(calculate_lol_ovr(p))).collect()
    }

    #[test]
    fn same_seed_gives_the_same_squad() {
        let a = squad_for(les(), &["ES"], 42);
        let b = squad_for(les(), &["ES"], 42);
        let key = |s: &[Player]| {
            s.iter()
                .map(|p| (p.id.clone(), p.match_name.clone(), p.full_name.clone(), p.wage, p.date_of_birth.clone(), p.potential_base))
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
            assert!(values.iter().all(|v| *v >= median - 5), "seed {seed}: {values:?}");
            assert!(values.iter().all(|v| *v >= median - 7), "seed {seed}: {values:?}");
            assert!(values.iter().all(|v| *v <= i32::from(percentiles.p75)), "seed {seed}: {values:?}");
            assert!(values.iter().filter(|v| **v > median).count() <= 1, "seed {seed}: {values:?}");
            let mean = f64::from(values.iter().sum::<i32>()) / 5.0;
            assert!((f64::from(median) - 4.0..=f64::from(median) - 2.0).contains(&mean), "seed {seed}: {mean}");
            assert!(validate_squad(&squad, &percentiles, date()).is_empty(), "seed {seed}");
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
                    a.mechanics, a.laning, a.teamfighting, a.macro_play, a.consistency,
                    a.shotcalling, a.champion_pool, a.discipline, a.mental_resilience,
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
    fn exactly_one_late_bloomer_near_the_bottom_of_the_window() {
        for seed in 0..300u64 {
            let squad = squad_for(les(), &["ES"], seed);
            let bloomers: Vec<&Player> = squad.iter().filter(|p| p.potential_base >= 84).collect();
            assert_eq!(bloomers.len(), 1, "seed {seed}");
            let bloomer = bloomers[0];
            assert!((84..=88).contains(&bloomer.potential_base));
            assert!((66..=68).contains(&bloomer.lol_ovr), "seed {seed}: {}", bloomer.lol_ovr);
        }
    }

    #[test]
    fn regular_players_have_potential_between_70_and_82_and_above_their_ovr() {
        for seed in 0..200u64 {
            for p in squad_for(lec(), &["FR"], seed).iter().filter(|p| p.potential_base < 84) {
                assert!((70..=83).contains(&p.potential_base), "seed {seed}: {}", p.potential_base);
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
                assert!(p.wage >= scale_wage_for_market_value(p.market_value), "seed {seed}");
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
        let ids: Vec<String> = squad_for(les(), &["ES"], 5).iter().map(|p| p.id.clone()).collect();
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
            let nicks: HashSet<String> = squad.iter().map(|p| p.match_name.to_lowercase()).collect();
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
            serial: 1,
        };
        for seed in 0..200u64 {
            let squad = generate_founding_squad(&spec, seed).expect("squad");
            assert!(squad.iter().all(|p| !taken.contains(&p.match_name.to_lowercase())));
        }
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
            serial: 1,
        };
        assert_eq!(generate_founding_squad(&spec, 1).err(), Some(SquadError::EmptyClubSlug));
        spec.club_slug = "rayo";
        spec.nationalities = &[];
        assert_eq!(generate_founding_squad(&spec, 1).err(), Some(SquadError::NoNationalities));
    }

    #[test]
    fn unsupported_median_is_a_clear_error() {
        let taken = HashSet::new();
        let spec = SquadSpec {
            club_slug: "rayo",
            percentiles: OvrPercentiles { p50: 95, p75: 97, ..les() },
            nationalities: &["ES"],
            today: date(),
            taken_match_names: &taken,
            serial: 1,
        };
        assert_eq!(generate_founding_squad(&spec, 1).err(), Some(SquadError::UnsupportedMedian(95)));
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
            serial: 1,
        };
        match generate_founding_squad(&spec, 1) {
            Err(SquadError::WindowUnsatisfied { attempts, violations }) => {
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

    #[test]
    fn validator_flags_a_short_squad() {
        let squad = squad_for(les(), &["ES"], 9);
        assert!(!validate_squad(&squad[..4], &les(), date()).is_empty());
    }
}
