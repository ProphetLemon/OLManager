//! Installs the generated founding squad on a freshly created custom club.
//!
//! [`install_founding_squad`] is the glue between the pure generator
//! ([`crate::squad_generator`]) and a world under construction: it measures the
//! club's peers, reserves every name already in the world, draws nationalities
//! from the competition's region, adds the five players to the game and sets the
//! club's wage budget from their wages.
//!
//! The work is split in two so a preview can match the install exactly:
//! [`plan_founding_squad`] is pure (it only reads the game) and
//! [`install_founding_squad`] is that plan plus [`apply_founding_plan`]. The
//! plan reads three things from the world: the competition's Main peers and their
//! rostered players (OVR percentiles, league-median profile), the lowercase
//! nicks and full names of every player in the game (released ones included) and
//! the club's short name and the game date. A preview must therefore be planned
//! on a world built like the real one, after the custom club replaced its slot.
//!
//! Callers run it right after [`crate::custom_team::replace_team_with_custom`]
//! and before any roster fill, so the club is never offered the free-agent fill.
//! A failure leaves the game untouched; callers fall back to that fill.
//!
//! # Nationalities
//!
//! A league's region comes from [`residency::region_for_competition`] (the same
//! table the import rule uses), falling back to the region of the manifest
//! country. The squad draws from the ISO-2 codes of that region
//! ([`residency::region_nationality_codes`]), so every founding player is a
//! resident of the club's region and the starting five can never break the
//! import limit. When the manifest country is an ISO-2 code of the same region
//! it is repeated so that about half of the squad is home-grown.

use std::collections::HashSet;
use std::fmt;

use chrono::NaiveDate;
use serde::Serialize;

use crate::custom_team::{league_median_profile, peer_ovr_percentiles};
use crate::domain::player::{Player, PlayerAttributes};
use crate::domain::stats::LolRole;
use crate::domain::team::{Team, TeamKind};
use crate::founder_identity::{
    EditContext, FounderEditError, FounderOverrides, NameIndex, apply_founder_overrides,
    birth_date_bounds,
};
use crate::game::Game;
use crate::residency::{self, Region};
use crate::squad_generator::{
    SquadError, SquadSpec, founding_wage_budget, full_years_between, generate_founding_squad,
    squad_bill,
};

/// Serials tried (`gen-<slug>-<role>-<n>`) before the player ids count as taken.
const MAX_SERIAL: u32 = 10;

/// Why a founding squad could not be installed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FoundingSquadError {
    /// The custom club is not in the game.
    TeamNotFound(String),
    /// Neither the competition nor the home country maps to a known region.
    UnknownRegion(String),
    /// Every serial produced an id that already exists.
    IdsTaken,
    /// The generator refused the squad.
    Squad(SquadError),
    /// An identity override broke a rule. Unlike the other errors this is the
    /// user's input, so callers must report it instead of falling back.
    Edit(FounderEditError),
}

impl fmt::Display for FoundingSquadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TeamNotFound(id) => write!(f, "custom club '{id}' was not found"),
            Self::UnknownRegion(competition) => {
                write!(f, "competition '{competition}' has no known region")
            }
            Self::IdsTaken => write!(f, "every founding player id is already in use"),
            Self::Squad(error) => write!(f, "{error}"),
            Self::Edit(error) => write!(f, "{error}"),
        }
    }
}

impl std::error::Error for FoundingSquadError {}

impl From<FounderEditError> for FoundingSquadError {
    fn from(error: FounderEditError) -> Self {
        Self::Edit(error)
    }
}

impl From<SquadError> for FoundingSquadError {
    fn from(error: SquadError) -> Self {
        Self::Squad(error)
    }
}

/// What [`install_founding_squad`] changed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FoundingSquadOutcome {
    /// Ids of the five new players, one per role.
    pub player_ids: Vec<String>,
    /// Wage budget now set on the club ([`founding_wage_budget`]).
    pub wage_budget: i64,
    /// League-median wage budget of the peers, for comparison in logs.
    pub peer_median_wage_budget: i64,
    /// Main peers the squad was measured against.
    pub peer_count: usize,
    /// `false` when the peers were too few and the default OVR window was used.
    pub percentiles_from_peers: bool,
}

/// Nationalities for players invented for `competition_id`; see the module docs.
pub fn founding_nationalities(
    competition_id: &str,
    home_country: Option<&str>,
) -> Result<Vec<String>, FoundingSquadError> {
    let home = home_country.map(str::trim).filter(|code| !code.is_empty());
    let region: Region = residency::region_for_competition(competition_id)
        .or_else(|| home.and_then(residency::region_for_nationality))
        .ok_or_else(|| FoundingSquadError::UnknownRegion(competition_id.to_string()))?;
    let mut codes = residency::region_nationality_codes(region);
    if let Some(home_code) = home
        .map(str::to_ascii_uppercase)
        .filter(|code| codes.contains(code))
    {
        let weight = codes.len();
        codes.extend(std::iter::repeat_n(home_code, weight));
    }
    Ok(codes)
}

/// Lowercase nicks and full names of every player in the game, released ones
/// included, so the squad never duplicates a name that exists in the world.
fn taken_names(game: &Game) -> (HashSet<String>, HashSet<String>) {
    let nicks = game
        .players
        .iter()
        .map(|player| player.match_name.to_lowercase())
        .collect();
    let full = game
        .players
        .iter()
        .map(|player| player.full_name.to_lowercase())
        .collect();
    (nicks, full)
}

/// A generated and edited squad that is not in the game yet.
#[derive(Debug, Clone)]
pub struct FoundingSquadPlan {
    /// The five players, on the custom club, one per role.
    pub players: Vec<Player>,
    /// Wage budget the club gets ([`founding_wage_budget`] of the edited squad).
    pub wage_budget: i64,
    /// League-median wage budget of the peers, for comparison in logs.
    pub peer_median_wage_budget: i64,
    /// Main peers the squad was measured against.
    pub peer_count: usize,
    /// `false` when the peers were too few and the default OVR window was used.
    pub percentiles_from_peers: bool,
    /// Game date the squad was made for (ages, contracts).
    pub today: NaiveDate,
    /// ISO-2 codes an edit may use as nationality: the single source the
    /// validator checks against.
    pub allowed_nationalities: Vec<String>,
}

impl FoundingSquadPlan {
    /// Yearly wage bill of the squad.
    pub fn bill(&self) -> i64 {
        squad_bill(&self.players)
    }

    /// The squad as the creation wizard shows it: visible data only, never the
    /// hidden potential.
    pub fn summary(&self) -> FoundingSquadSummary {
        FoundingSquadSummary {
            players: self
                .players
                .iter()
                .map(|player| FounderSummary::of(player, self.today))
                .collect(),
            wage_budget: self.wage_budget,
            bill: self.bill(),
            allowed_nationalities: self.allowed_nationalities.clone(),
        }
    }
}

/// One founder as the wizard shows him.
#[derive(Debug, Clone, Serialize)]
pub struct FounderSummary {
    /// Player id, `gen-<club slug>-<role>-<n>`.
    pub id: String,
    /// Natural role.
    pub role: LolRole,
    /// Nick (`match_name`).
    pub nick: String,
    /// Full name.
    pub full_name: String,
    /// ISO-2 nationality.
    pub nationality: String,
    /// Birth date as `YYYY-MM-DD`.
    pub date_of_birth: String,
    /// Full years old on the game date.
    pub age: i32,
    /// Earliest birth date (`YYYY-MM-DD`) that keeps `age` on the game date.
    pub birth_date_min: String,
    /// Latest birth date (`YYYY-MM-DD`) that keeps `age` on the game date.
    pub birth_date_max: String,
    /// Overall rating.
    pub ovr: u8,
    /// The nine visible attributes.
    pub attributes: PlayerAttributes,
    /// Yearly wage.
    pub wage: u32,
    /// Contract end as `YYYY-MM-DD`.
    pub contract_end: String,
    /// Market value.
    pub market_value: u64,
}

impl FounderSummary {
    fn of(player: &Player, today: NaiveDate) -> Self {
        let dob = NaiveDate::parse_from_str(&player.date_of_birth, "%Y-%m-%d").ok();
        let age = dob
            .map(|dob| full_years_between(today, dob))
            .unwrap_or_default();
        let (min, max) = dob
            .map(|dob| birth_date_bounds(today, dob))
            .map(|(min, max)| (min.to_string(), max.to_string()))
            .unwrap_or_default();
        Self {
            id: player.id.clone(),
            role: player.natural_position,
            nick: player.match_name.clone(),
            full_name: player.full_name.clone(),
            nationality: player.nationality.clone(),
            date_of_birth: player.date_of_birth.clone(),
            age,
            birth_date_min: min,
            birth_date_max: max,
            ovr: player.lol_ovr,
            attributes: player.attributes.clone(),
            wage: player.wage,
            contract_end: player.contract_end.clone().unwrap_or_default(),
            market_value: player.market_value,
        }
    }
}

/// What the wizard shows for a squad: the founders, the derived wage budget and
/// the yearly wage bill.
#[derive(Debug, Clone, Serialize)]
pub struct FoundingSquadSummary {
    /// The five founders, one per role.
    pub players: Vec<FounderSummary>,
    /// Wage budget the club would get.
    pub wage_budget: i64,
    /// Yearly wage bill of the five.
    pub bill: i64,
    /// ISO-2 nationality codes the wizard may offer when editing a founder.
    pub allowed_nationalities: Vec<String>,
}

/// Generates and edits the founding squad for `custom_team_id` without touching
/// the game.
///
/// Peers are the Main teams of `competition_id` other than the custom club; the
/// same set feeds the OVR percentiles and the league-median profile. The
/// generated players join the club at the wage floor with 2-year contracts.
/// `overrides` are applied after generation and validated with the identity
/// rules; a broken one is [`FoundingSquadError::Edit`], never a silent fallback.
/// The wage budget is derived after the edits. `home_country` is the manifest
/// country of the competition, if it has one.
pub fn plan_founding_squad(
    game: &Game,
    competition_id: &str,
    custom_team_id: &str,
    home_country: Option<&str>,
    seed: u64,
    overrides: &FounderOverrides,
) -> Result<FoundingSquadPlan, FoundingSquadError> {
    let slug = game
        .teams
        .iter()
        .find(|team| team.id == custom_team_id)
        .map(|team| team.short_name.clone())
        .ok_or_else(|| FoundingSquadError::TeamNotFound(custom_team_id.to_string()))?;
    let nationalities = founding_nationalities(competition_id, home_country)?;
    let nationality_refs: Vec<&str> = nationalities.iter().map(String::as_str).collect();
    let (taken_match_names, taken_full_names) = taken_names(game);
    let today = game.clock.current_date.date_naive();

    let peers: Vec<&Team> = game
        .teams
        .iter()
        .filter(|team| {
            team.team_kind == TeamKind::Main
                && team.competition_id.as_deref() == Some(competition_id)
                && team.id != custom_team_id
        })
        .collect();
    let percentiles = peer_ovr_percentiles(&peers, &game.players);
    let profile = league_median_profile(&peers);
    let peer_count = peers.len();

    let mut squad = None;
    for serial in 1..=MAX_SERIAL {
        let spec = SquadSpec {
            club_slug: &slug,
            percentiles,
            nationalities: &nationality_refs,
            today,
            taken_match_names: &taken_match_names,
            taken_full_names: &taken_full_names,
            serial,
            wage_budget: None,
        };
        let candidate = generate_founding_squad(&spec, seed)?;
        let clash = candidate
            .iter()
            .any(|new| game.players.iter().any(|old| old.id == new.id));
        if !clash {
            squad = Some(candidate);
            break;
        }
    }
    let mut squad = squad.ok_or(FoundingSquadError::IdsTaken)?;
    for player in &mut squad {
        player.team_id = Some(custom_team_id.to_string());
    }

    // Edits may only use residents of the region: never an import.
    let region_codes = founding_region_codes(competition_id, home_country)?;
    if !overrides.is_empty() {
        let world = NameIndex::from_players(&game.players);
        let context = EditContext {
            today,
            region_codes: &region_codes,
            world: &world,
        };
        apply_founder_overrides(&mut squad, overrides, &context)?;
    }

    Ok(FoundingSquadPlan {
        wage_budget: founding_wage_budget(&squad),
        players: squad,
        peer_median_wage_budget: profile.wage_budget,
        peer_count,
        percentiles_from_peers: percentiles.from_peers,
        today,
        allowed_nationalities: region_codes,
    })
}

/// ISO-2 codes of the competition's region, without the home-country weighting
/// [`founding_nationalities`] adds.
fn founding_region_codes(
    competition_id: &str,
    home_country: Option<&str>,
) -> Result<Vec<String>, FoundingSquadError> {
    let home = home_country.map(str::trim).filter(|code| !code.is_empty());
    let region: Region = residency::region_for_competition(competition_id)
        .or_else(|| home.and_then(residency::region_for_nationality))
        .ok_or_else(|| FoundingSquadError::UnknownRegion(competition_id.to_string()))?;
    Ok(residency::region_nationality_codes(region))
}

/// Adds the planned squad to the game and sets the club's wage budget.
pub fn apply_founding_plan(
    game: &mut Game,
    custom_team_id: &str,
    plan: FoundingSquadPlan,
) -> FoundingSquadOutcome {
    let outcome = FoundingSquadOutcome {
        player_ids: plan
            .players
            .iter()
            .map(|player| player.id.clone())
            .collect(),
        wage_budget: plan.wage_budget,
        peer_median_wage_budget: plan.peer_median_wage_budget,
        peer_count: plan.peer_count,
        percentiles_from_peers: plan.percentiles_from_peers,
    };
    game.moved_player_ids
        .extend(outcome.player_ids.iter().cloned());
    game.players.extend(plan.players);
    if let Some(team) = game.teams.iter_mut().find(|team| team.id == custom_team_id) {
        team.wage_budget = plan.wage_budget;
    }
    outcome
}

/// Generates the founding squad for `custom_team_id` and installs it; see
/// [`plan_founding_squad`]. The five players are marked as moved so catalog
/// rehydration keeps them.
///
/// On error nothing is changed.
pub fn install_founding_squad(
    game: &mut Game,
    competition_id: &str,
    custom_team_id: &str,
    home_country: Option<&str>,
    seed: u64,
) -> Result<FoundingSquadOutcome, FoundingSquadError> {
    install_founding_squad_with(
        game,
        competition_id,
        custom_team_id,
        home_country,
        seed,
        &FounderOverrides::default(),
    )
}

/// [`install_founding_squad`] with identity edits for the founders.
pub fn install_founding_squad_with(
    game: &mut Game,
    competition_id: &str,
    custom_team_id: &str,
    home_country: Option<&str>,
    seed: u64,
    overrides: &FounderOverrides,
) -> Result<FoundingSquadOutcome, FoundingSquadError> {
    let plan = plan_founding_squad(
        game,
        competition_id,
        custom_team_id,
        home_country,
        seed,
        overrides,
    )?;
    Ok(apply_founding_plan(game, custom_team_id, plan))
}
