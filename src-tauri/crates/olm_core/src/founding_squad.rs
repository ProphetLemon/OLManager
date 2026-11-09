//! Installs the generated founding squad on a freshly created custom club.
//!
//! [`install_founding_squad`] is the glue between the pure generator
//! ([`crate::squad_generator`]) and a world under construction: it measures the
//! club's peers, reserves every name already in the world, draws nationalities
//! from the competition's region, adds the five players to the game and sets the
//! club's wage budget from their wages.
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

use crate::custom_team::{league_median_profile, peer_ovr_percentiles};
use crate::domain::team::{Team, TeamKind};
use crate::game::Game;
use crate::residency::{self, Region};
use crate::squad_generator::{
    SquadError, SquadSpec, founding_wage_budget, generate_founding_squad,
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
        }
    }
}

impl std::error::Error for FoundingSquadError {}

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

/// Generates the founding squad for `custom_team_id` and installs it.
///
/// Peers are the Main teams of `competition_id` other than the custom club; the
/// same set feeds the OVR percentiles and the league-median profile. The five
/// players join the club at the wage floor with 2-year contracts and are marked
/// as moved so catalog rehydration keeps them. The club's `wage_budget` becomes
/// [`founding_wage_budget`] of the squad. `home_country` is the manifest country
/// of the competition, if it has one.
///
/// On error nothing is changed.
pub fn install_founding_squad(
    game: &mut Game,
    competition_id: &str,
    custom_team_id: &str,
    home_country: Option<&str>,
    seed: u64,
) -> Result<FoundingSquadOutcome, FoundingSquadError> {
    let slug = game
        .teams
        .iter()
        .find(|team| team.id == custom_team_id)
        .map(|team| team.short_name.clone())
        .ok_or_else(|| FoundingSquadError::TeamNotFound(custom_team_id.to_string()))?;
    let nationalities = founding_nationalities(competition_id, home_country)?;
    let nationality_refs: Vec<&str> = nationalities.iter().map(String::as_str).collect();
    let (taken_match_names, taken_full_names) = taken_names(game);

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
            today: game.clock.current_date.date_naive(),
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

    let wage_budget = founding_wage_budget(&squad);
    for player in &mut squad {
        player.team_id = Some(custom_team_id.to_string());
    }
    let player_ids: Vec<String> = squad.iter().map(|player| player.id.clone()).collect();
    game.moved_player_ids.extend(player_ids.iter().cloned());
    game.players.extend(squad);
    if let Some(team) = game.teams.iter_mut().find(|team| team.id == custom_team_id) {
        team.wage_budget = wage_budget;
    }

    Ok(FoundingSquadOutcome {
        player_ids,
        wage_budget,
        peer_median_wage_budget: profile.wage_budget,
        peer_count,
        percentiles_from_peers: percentiles.from_peers,
    })
}
