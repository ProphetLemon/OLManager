//! Import rule: a starting five may hold at most [`MAX_IMPORTS_IN_STARTING_FIVE`]
//! non-residents (Riot's "at most 2 imports" regional rule).
//!
//! Residency is approximated as nationality versus the league's region:
//!
//! * A team's region comes from its competition id (see [`region_for_competition`]),
//!   falling back to the team's own country when the competition is unknown.
//! * A player's region comes from [`Player::resident_region`] when it is set
//!   (players on a team when a game starts, or when an older save is loaded,
//!   are grandfathered as residents of that team's region), otherwise from
//!   their nationality (ISO-2 code or English country name).
//! * A player is an import when both regions are known and they differ.
//!   Missing or unrecognised data never makes anyone an import: unknown
//!   nationality, unknown league and unknown team all count as resident.

use crate::domain::player::Player;
use crate::domain::team::Team;
use crate::game::Game;
use crate::potential::calculate_lol_ovr;
use std::collections::HashSet;
use std::fmt;

/// Most imports allowed in a starting five.
pub const MAX_IMPORTS_IN_STARTING_FIVE: usize = 2;

/// Prefix of the error string returned when a starting five holds too many
/// imports. The full form is `LINEUP_TOO_MANY_IMPORTS:<count>:<max>`; the UI
/// parses it to show a localized message.
pub const TOO_MANY_IMPORTS_ERROR_PREFIX: &str = "LINEUP_TOO_MANY_IMPORTS";

/// Competitive regions used to approximate residency.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Region {
    /// Europe, the Middle East and Africa (LEC and its ERLs, TCL, Arabian League).
    Emea,
    /// South Korea (LCK).
    Korea,
    /// China (LPL).
    China,
    /// North America (LCS).
    NorthAmerica,
    /// Brazil (CBLOL).
    Brazil,
    /// Latin America outside Brazil (LLA).
    Latam,
    /// Asia-Pacific outside Korea and China (LCP, PCS, VCS, LJL).
    Apac,
}

impl Region {
    /// Stable code stored on [`Player::resident_region`].
    pub fn code(self) -> &'static str {
        match self {
            Region::Emea => "EMEA",
            Region::Korea => "KR",
            Region::China => "CN",
            Region::NorthAmerica => "NA",
            Region::Brazil => "BR",
            Region::Latam => "LATAM",
            Region::Apac => "APAC",
        }
    }

    /// Inverse of [`Region::code`]; unknown codes return `None`.
    pub fn from_code(code: &str) -> Option<Region> {
        match code.trim().to_ascii_uppercase().as_str() {
            "EMEA" => Some(Region::Emea),
            "KR" => Some(Region::Korea),
            "CN" => Some(Region::China),
            "NA" => Some(Region::NorthAmerica),
            "BR" => Some(Region::Brazil),
            "LATAM" => Some(Region::Latam),
            "APAC" => Some(Region::Apac),
            _ => None,
        }
    }
}

/// Competition id (manifest id under `data/competitions`) to region.
const COMPETITION_REGIONS: &[(Region, &[&str])] = &[
    (
        Region::Emea,
        &[
            "lec",
            "lfl",
            "lfl-l",
            "prm",
            "prm-l",
            "prime_league",
            "les",
            "nlc",
            "ebl",
            "eec",
            "rl",
            "hll",
            "hm",
            "lit",
            "lplol",
            "rol",
            "tcl",
            "al",
            "al-l",
            "eu-lcs-l",
        ],
    ),
    (Region::Korea, &["lck", "lckcl", "lck-cl", "lck-l"]),
    (Region::China, &["lpl", "ldl", "lpl-l"]),
    (Region::NorthAmerica, &["lcs", "nacl", "nacl-l", "na-lcs-l"]),
    (Region::Brazil, &["cblol", "cblol-l", "cd"]),
    (Region::Latam, &["lrn", "lrs", "lla-l"]),
    (
        Region::Apac,
        &["lcp", "pcs", "vcs", "ljl", "ljl-l", "lms-l"],
    ),
];

/// Nationality (lowercase ISO-2 code or English name) to region. Anything not
/// listed is unknown and counts as resident.
const NATIONALITY_REGIONS: &[(Region, &[&str])] = &[
    (
        Region::Emea,
        &[
            "pl", "poland", "tr", "turkey", "turkiye", "de", "germany", "fr", "france", "cz",
            "czech republic", "czechia", "gr", "greece", "es", "spain", "it", "italy", "pt",
            "portugal", "dk", "denmark", "se", "sweden", "bg", "bulgaria", "rs", "serbia", "nl",
            "netherlands", "hr", "croatia", "ro", "romania", "hu", "hungary", "ru", "russia", "sk",
            "slovakia", "at", "austria", "be", "belgium", "no", "norway", "fi", "finland", "ua",
            "ukraine", "gb", "uk", "united kingdom", "british", "eng", "england", "sco",
            "scotland", "wal", "wales", "nir", "northern ireland", "ie", "ireland", "ch",
            "switzerland", "si", "slovenia", "mk", "north macedonia", "al", "albania", "lv",
            "latvia", "lt", "lithuania", "ee", "estonia", "ge", "georgia", "md", "moldova", "me",
            "montenegro", "ad", "andorra", "lu", "luxembourg", "is", "iceland", "ba", "bosnia",
            "xk", "kosovo", "by", "belarus", "cy", "cyprus", "mt", "malta", "il", "israel", "tn",
            "tunisia", "eg", "egypt", "dz", "algeria", "ma", "morocco", "ly", "libya", "sa",
            "saudi arabia", "ae", "united arab emirates", "lb", "lebanon", "jo", "jordan", "ps",
            "palestine", "sy", "syria", "iq", "iraq", "ir", "iran", "kw", "kuwait", "qa", "qatar",
            "bh", "bahrain", "om", "oman", "ye", "yemen", "kz", "kazakhstan", "za", "south africa",
            "ng", "nigeria",
        ],
    ),
    (Region::Korea, &["kr", "korea", "south korea"]),
    (
        Region::China,
        &["cn", "china", "peoples republic of china", "mo", "macau"],
    ),
    (
        Region::NorthAmerica,
        &[
            "us",
            "usa",
            "united states",
            "united states of america",
            "ca",
            "canada",
            "pr",
            "puerto rico",
            "bm",
            "bermuda",
        ],
    ),
    (Region::Brazil, &["br", "brazil", "brasil"]),
    (
        Region::Latam,
        &[
            "mx", "mexico", "ar", "argentina", "cl", "chile", "pe", "peru", "co", "colombia",
            "uy", "uruguay", "ve", "venezuela", "ec", "ecuador", "cr", "costa rica", "gt",
            "guatemala", "hn", "honduras", "sv", "el salvador", "do", "dominican republic", "cu",
            "cuba", "bo", "bolivia", "py", "paraguay", "pa", "panama", "ni", "nicaragua",
        ],
    ),
    (
        Region::Apac,
        &[
            "jp", "japan", "tw", "taiwan", "hk", "hong kong", "vn", "vietnam", "au", "australia",
            "nz", "new zealand", "sg", "singapore", "th", "thailand", "ph", "philippines", "id",
            "indonesia", "my", "malaysia", "kh", "cambodia", "mn", "mongolia", "in", "india",
        ],
    ),
];

fn lookup(table: &[(Region, &[&str])], key: &str) -> Option<Region> {
    let key = key.trim().to_ascii_lowercase();
    if key.is_empty() {
        return None;
    }
    table
        .iter()
        .find(|(_, keys)| keys.contains(&key.as_str()))
        .map(|(region, _)| *region)
}

/// Region of a competition id, `None` for ids this table does not know.
pub fn region_for_competition(competition_id: &str) -> Option<Region> {
    lookup(COMPETITION_REGIONS, competition_id)
}

/// Region of a nationality (ISO-2 code or English country name), `None` when
/// the value is empty or not recognised.
pub fn region_for_nationality(nationality: &str) -> Option<Region> {
    lookup(NATIONALITY_REGIONS, nationality)
}

/// Region a team plays in: its competition when known, else its own country.
pub fn team_region(team: &Team) -> Option<Region> {
    team.competition_id
        .as_deref()
        .and_then(region_for_competition)
        .or_else(|| region_for_nationality(&team.country))
}

/// Region the player is resident of: the stored region when set, else the
/// nationality's region.
pub fn player_region(player: &Player) -> Option<Region> {
    player
        .resident_region
        .as_deref()
        .and_then(Region::from_code)
        .or_else(|| region_for_nationality(&player.nationality))
}

/// Whether `player` would count as an import on a team of `team_region`.
/// Unknown on either side is resident.
pub fn is_import(player: &Player, team_region: Option<Region>) -> bool {
    match (team_region, player_region(player)) {
        (Some(team), Some(player)) => team != player,
        _ => false,
    }
}

/// Number of imports among `players` for a team of `team_region`.
pub fn count_imports<'a>(
    players: impl IntoIterator<Item = &'a Player>,
    team_region: Option<Region>,
) -> usize {
    players
        .into_iter()
        .filter(|player| is_import(player, team_region))
        .count()
}

/// Region of the team with `team_id`, `None` when the team is missing or unknown.
pub fn region_of_team_id(game: &Game, team_id: &str) -> Option<Region> {
    game.teams
        .iter()
        .find(|team| team.id == team_id)
        .and_then(team_region)
}

/// A starting five that holds more imports than the rule allows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ImportLimitExceeded {
    pub imports: usize,
    pub max: usize,
}

impl fmt::Display for ImportLimitExceeded {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{}:{}:{}",
            TOO_MANY_IMPORTS_ERROR_PREFIX, self.imports, self.max
        )
    }
}

impl std::error::Error for ImportLimitExceeded {}

/// Check a lineup of `player_ids` for `team_id` against the import rule.
/// Ids that match no player are ignored (other validation owns them).
pub fn validate_lineup_imports(
    game: &Game,
    team_id: &str,
    player_ids: &[String],
) -> Result<(), ImportLimitExceeded> {
    let region = region_of_team_id(game, team_id);
    let imports = player_ids
        .iter()
        .filter_map(|id| game.players.iter().find(|player| &player.id == id))
        .filter(|player| is_import(player, region))
        .count();
    if imports > MAX_IMPORTS_IN_STARTING_FIVE {
        Err(ImportLimitExceeded {
            imports,
            max: MAX_IMPORTS_IN_STARTING_FIVE,
        })
    } else {
        Ok(())
    }
}

/// Make `lineup` respect the import rule by swapping excess imports for
/// residents of `pool` (the whole roster) who play the same role.
///
/// Each step makes the swap that costs the least rating. Slot order is kept.
/// When no same-role resident exists the lineup is returned as far as it got:
/// a role is never given up to satisfy the rule.
pub fn limit_imports<'a>(
    mut lineup: Vec<&'a Player>,
    pool: &[&'a Player],
    team_region: Option<Region>,
) -> Vec<&'a Player> {
    while count_imports(lineup.iter().copied(), team_region) > MAX_IMPORTS_IN_STARTING_FIVE {
        let in_lineup: HashSet<&str> = lineup.iter().map(|player| player.id.as_str()).collect();
        let best_swap = lineup
            .iter()
            .enumerate()
            .filter(|(_, starter)| is_import(starter, team_region))
            .flat_map(|(slot, starter)| {
                pool.iter()
                    .copied()
                    .filter(|candidate| {
                        !in_lineup.contains(candidate.id.as_str())
                            && candidate.natural_position == starter.natural_position
                            && !is_import(candidate, team_region)
                    })
                    .map(move |candidate| {
                        let loss = i16::from(calculate_lol_ovr(starter))
                            - i16::from(calculate_lol_ovr(candidate));
                        (slot, candidate, loss)
                    })
            })
            .min_by_key(|(_, _, loss)| *loss);
        let Some((slot, replacement, _)) = best_swap else {
            break;
        };
        lineup[slot] = replacement;
    }
    lineup
}

/// [`limit_imports`] over ids: resolves `lineup_ids` and the roster of
/// `team_id` from `game` and returns the repaired ids, keeping slot order.
/// Ids that match no player are kept untouched.
pub fn limit_lineup_ids(game: &Game, team_id: &str, lineup_ids: Vec<String>) -> Vec<String> {
    limit_lineup_ids_in(&game.teams, &game.players, team_id, lineup_ids)
}

/// [`limit_lineup_ids`] for callers that hold the team and player slices
/// rather than a [`Game`].
pub fn limit_lineup_ids_in(
    teams: &[Team],
    players: &[Player],
    team_id: &str,
    lineup_ids: Vec<String>,
) -> Vec<String> {
    let region = teams
        .iter()
        .find(|team| team.id == team_id)
        .and_then(team_region);
    limit_lineup_ids_for(region, players, team_id, lineup_ids)
}

/// [`limit_lineup_ids`] with the team's region already resolved.
pub fn limit_lineup_ids_for(
    region: Option<Region>,
    players: &[Player],
    team_id: &str,
    lineup_ids: Vec<String>,
) -> Vec<String> {
    let roster: Vec<&Player> = players
        .iter()
        .filter(|player| player.team_id.as_deref() == Some(team_id))
        .collect();
    let resolved: Vec<&Player> = lineup_ids
        .iter()
        .filter_map(|id| roster.iter().copied().find(|player| &player.id == id))
        .collect();
    if resolved.len() != lineup_ids.len()
        || count_imports(resolved.iter().copied(), region) <= MAX_IMPORTS_IN_STARTING_FIVE
    {
        return lineup_ids;
    }
    limit_imports(resolved, &roster, region)
        .into_iter()
        .map(|player| player.id.clone())
        .collect()
}

/// Whether a team can take on `candidate` without the import rule making them
/// a player it could not start.
///
/// Residents always fit. An import fits while the current starting five holds
/// fewer than the allowed imports, or when the import would replace an import
/// already starting at his role.
pub fn has_import_slot_for(game: &Game, team: &Team, candidate: &Player) -> bool {
    let region = team_region(team);
    if !is_import(candidate, region) {
        return true;
    }
    let starters: Vec<&Player> = team
        .active_lineup_ids
        .iter()
        .filter_map(|id| {
            game.players
                .iter()
                .find(|player| &player.id == id && player.team_id.as_deref() == Some(&team.id))
        })
        .collect();
    if count_imports(starters.iter().copied(), region) < MAX_IMPORTS_IN_STARTING_FIVE {
        return true;
    }
    starters.iter().any(|starter| {
        starter.natural_position == candidate.natural_position && is_import(starter, region)
    })
}

/// Mark every player who is on a team as a resident of that team's region,
/// unless a region is already stored. Runs once per game
/// ([`Game::residency_initialized`]): at new game, and when an older save is
/// first loaded. Returns how many players were marked.
pub fn grandfather_rostered_players(game: &mut Game) -> usize {
    if game.residency_initialized {
        return 0;
    }
    let regions: std::collections::HashMap<String, Region> = game
        .teams
        .iter()
        .filter_map(|team| team_region(team).map(|region| (team.id.clone(), region)))
        .collect();
    let mut marked = 0;
    for player in &mut game.players {
        if player.resident_region.is_some() {
            continue;
        }
        let Some(region) = player
            .team_id
            .as_deref()
            .and_then(|team_id| regions.get(team_id))
        else {
            continue;
        };
        player.resident_region = Some(region.code().to_string());
        marked += 1;
    }
    game.residency_initialized = true;
    marked
}

/// Recompute [`Player::is_import`] for every player against the team they are
/// on (free agents are never imports).
pub fn refresh_import_flags(game: &mut Game) {
    let regions: std::collections::HashMap<&str, Option<Region>> = game
        .teams
        .iter()
        .map(|team| (team.id.as_str(), team_region(team)))
        .collect();
    let flags: Vec<bool> = game
        .players
        .iter()
        .map(|player| {
            player
                .team_id
                .as_deref()
                .and_then(|team_id| regions.get(team_id).copied())
                .is_some_and(|region| is_import(player, region))
        })
        .collect();
    for (player, flag) in game.players.iter_mut().zip(flags) {
        player.is_import = flag;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::GameClock;
    use crate::domain::manager::Manager;
    use crate::domain::player::{LolRole, PlayerAttributes};
    use chrono::{TimeZone, Utc};

    fn attrs(value: u8) -> PlayerAttributes {
        PlayerAttributes {
            laning: value,
            mechanics: value,
            macro_play: value,
            consistency: value,
            discipline: value,
            teamfighting: value,
            shotcalling: value,
            champion_pool: value,
            mental_resilience: value,
        }
    }

    fn player(id: &str, nationality: &str, role: LolRole, rating: u8, team: &str) -> Player {
        let mut player = Player::new(
            id.to_string(),
            id.to_string(),
            format!("{id} Test"),
            "2000-01-01".to_string(),
            nationality.to_string(),
            role,
            attrs(rating),
        );
        player.team_id = Some(team.to_string());
        player
    }

    fn team(id: &str, competition: &str) -> Team {
        let mut team = Team::new(
            id.to_string(),
            id.to_string(),
            id.to_uppercase(),
            "Spain".to_string(),
            "Madrid".to_string(),
            "Arena".to_string(),
            10_000,
        );
        team.competition_id = Some(competition.to_string());
        team
    }

    fn game(teams: Vec<Team>, players: Vec<Player>) -> Game {
        let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 8, 1, 12, 0, 0).unwrap());
        let manager = Manager::new(
            "manager".to_string(),
            "Alex".to_string(),
            "Manager".to_string(),
            "1980-01-01".to_string(),
            "Spain".to_string(),
        );
        Game::new(clock, manager, teams, players, vec![], vec![])
    }

    #[test]
    fn competitions_map_to_their_region() {
        assert_eq!(region_for_competition("lec"), Some(Region::Emea));
        assert_eq!(region_for_competition("LCK"), Some(Region::Korea));
        assert_eq!(region_for_competition("lpl"), Some(Region::China));
        assert_eq!(region_for_competition("lcs"), Some(Region::NorthAmerica));
        assert_eq!(region_for_competition("cblol"), Some(Region::Brazil));
        assert_eq!(region_for_competition("lcp"), Some(Region::Apac));
        assert_eq!(region_for_competition("made-up"), None);
    }

    #[test]
    fn nationalities_map_by_code_and_by_name() {
        assert_eq!(region_for_nationality("KR"), Some(Region::Korea));
        assert_eq!(region_for_nationality("South Korea"), Some(Region::Korea));
        assert_eq!(region_for_nationality("DE"), Some(Region::Emea));
        assert_eq!(region_for_nationality("Germany"), Some(Region::Emea));
        assert_eq!(region_for_nationality("Brasil"), Some(Region::Brazil));
        assert_eq!(region_for_nationality("MX"), Some(Region::Latam));
        assert_eq!(region_for_nationality("TW"), Some(Region::Apac));
    }

    #[test]
    fn unknown_or_missing_nationality_counts_as_resident() {
        let lec = Some(Region::Emea);
        for value in ["", "   ", "Generated", "K", "Atlantis"] {
            let p = player("p", value, LolRole::Mid, 70, "t");
            assert!(!is_import(&p, lec), "{value:?} must be resident");
        }
    }

    #[test]
    fn a_player_is_an_import_only_outside_their_region() {
        let kr = player("kr", "KR", LolRole::Mid, 70, "t");
        let de = player("de", "DE", LolRole::Mid, 70, "t");
        assert!(is_import(&kr, Some(Region::Emea)));
        assert!(!is_import(&de, Some(Region::Emea)));
        assert!(!is_import(&kr, Some(Region::Korea)));
        assert!(!is_import(&kr, None), "unknown league never makes imports");
    }

    #[test]
    fn stored_residency_wins_over_nationality() {
        let mut kr = player("kr", "KR", LolRole::Mid, 70, "t");
        kr.resident_region = Some("EMEA".to_string());
        assert!(!is_import(&kr, Some(Region::Emea)));
        assert!(is_import(&kr, Some(Region::Korea)));
    }

    #[test]
    fn team_region_prefers_competition_then_country() {
        let lck = team("t1", "lck");
        assert_eq!(team_region(&lck), Some(Region::Korea));
        let mut unknown_league = team("t2", "mystery");
        assert_eq!(team_region(&unknown_league), Some(Region::Emea));
        unknown_league.country = "Atlantis".to_string();
        assert_eq!(team_region(&unknown_league), None);
    }

    #[test]
    fn lineup_with_three_imports_is_refused_and_two_is_allowed() {
        let g = game(
            vec![team("lec-a", "lec")],
            vec![
                player("top", "KR", LolRole::Top, 70, "lec-a"),
                player("jg", "KR", LolRole::Jungle, 70, "lec-a"),
                player("mid", "CN", LolRole::Mid, 70, "lec-a"),
                player("adc", "DE", LolRole::Adc, 70, "lec-a"),
                player("sup", "ES", LolRole::Support, 70, "lec-a"),
            ],
        );
        let ids = |list: &[&str]| list.iter().map(|id| id.to_string()).collect::<Vec<_>>();
        let err = validate_lineup_imports(&g, "lec-a", &ids(&["top", "jg", "mid", "adc", "sup"]))
            .unwrap_err();
        assert_eq!(err.imports, 3);
        assert_eq!(err.to_string(), "LINEUP_TOO_MANY_IMPORTS:3:2");
        assert!(validate_lineup_imports(&g, "lec-a", &ids(&["top", "jg", "adc", "sup"])).is_ok());
    }

    #[test]
    fn limit_imports_swaps_the_cheapest_import_for_a_same_role_resident() {
        let top = player("top", "KR", LolRole::Top, 90, "t");
        let jg = player("jg", "KR", LolRole::Jungle, 80, "t");
        let mid = player("mid", "CN", LolRole::Mid, 85, "t");
        let adc = player("adc", "DE", LolRole::Adc, 70, "t");
        let sup = player("sup", "ES", LolRole::Support, 70, "t");
        let jg_resident = player("jg2", "FR", LolRole::Jungle, 78, "t");
        let top_resident = player("top2", "DE", LolRole::Top, 60, "t");
        let pool = vec![&top, &jg, &mid, &adc, &sup, &jg_resident, &top_resident];

        let fixed = limit_imports(vec![&top, &jg, &mid, &adc, &sup], &pool, Some(Region::Emea));
        let ids: Vec<&str> = fixed.iter().map(|p| p.id.as_str()).collect();
        // Jungle loses 2 rating points, Top would lose 30: the jungle swap wins.
        assert_eq!(ids, vec!["top", "jg2", "mid", "adc", "sup"]);
        assert_eq!(count_imports(fixed.iter().copied(), Some(Region::Emea)), 2);
    }

    #[test]
    fn limit_imports_never_gives_up_a_role() {
        let top = player("top", "KR", LolRole::Top, 70, "t");
        let jg = player("jg", "KR", LolRole::Jungle, 70, "t");
        let mid = player("mid", "CN", LolRole::Mid, 70, "t");
        let adc = player("adc", "DE", LolRole::Adc, 70, "t");
        let sup = player("sup", "ES", LolRole::Support, 70, "t");
        let off_role = player("bench-adc", "DE", LolRole::Adc, 99, "t");
        let pool = vec![&top, &jg, &mid, &adc, &sup, &off_role];

        let fixed = limit_imports(vec![&top, &jg, &mid, &adc, &sup], &pool, Some(Region::Emea));
        assert_eq!(fixed.len(), 5);
        assert!(fixed.iter().any(|p| p.natural_position == LolRole::Top));
        assert_eq!(count_imports(fixed.iter().copied(), Some(Region::Emea)), 3);
    }

    #[test]
    fn limit_lineup_ids_repairs_from_the_game_roster() {
        let g = game(
            vec![team("lec-a", "lec")],
            vec![
                player("top", "KR", LolRole::Top, 70, "lec-a"),
                player("jg", "KR", LolRole::Jungle, 70, "lec-a"),
                player("mid", "CN", LolRole::Mid, 70, "lec-a"),
                player("adc", "DE", LolRole::Adc, 70, "lec-a"),
                player("sup", "ES", LolRole::Support, 70, "lec-a"),
                player("mid2", "FR", LolRole::Mid, 60, "lec-a"),
            ],
        );
        let ids = ["top", "jg", "mid", "adc", "sup"]
            .iter()
            .map(|id| id.to_string())
            .collect::<Vec<_>>();
        let fixed = limit_lineup_ids(&g, "lec-a", ids);
        assert_eq!(fixed, vec!["top", "jg", "mid2", "adc", "sup"]);
    }

    #[test]
    fn import_slot_is_full_after_two_imports_unless_replacing_one() {
        let g = game(
            vec![{
                let mut t = team("lec-a", "lec");
                t.active_lineup_ids = ["top", "jg", "mid", "adc", "sup"]
                    .iter()
                    .map(|id| id.to_string())
                    .collect();
                t
            }],
            vec![
                player("top", "KR", LolRole::Top, 70, "lec-a"),
                player("jg", "KR", LolRole::Jungle, 70, "lec-a"),
                player("mid", "DE", LolRole::Mid, 70, "lec-a"),
                player("adc", "DE", LolRole::Adc, 70, "lec-a"),
                player("sup", "ES", LolRole::Support, 70, "lec-a"),
            ],
        );
        let team = &g.teams[0];
        let import_mid = player("fa-mid", "CN", LolRole::Mid, 90, "x");
        let import_top = player("fa-top", "CN", LolRole::Top, 90, "x");
        let resident_mid = player("fa-mid2", "FR", LolRole::Mid, 90, "x");
        assert!(!has_import_slot_for(&g, team, &import_mid));
        assert!(has_import_slot_for(&g, team, &import_top));
        assert!(has_import_slot_for(&g, team, &resident_mid));
    }

    #[test]
    fn grandfathering_marks_rostered_players_once() {
        let mut free_agent = player("fa", "KR", LolRole::Mid, 70, "x");
        free_agent.team_id = None;
        let mut g = game(
            vec![team("lec-a", "lec")],
            vec![player("top", "KR", LolRole::Top, 70, "lec-a"), free_agent],
        );
        assert_eq!(grandfather_rostered_players(&mut g), 1);
        assert_eq!(g.players[0].resident_region.as_deref(), Some("EMEA"));
        assert_eq!(g.players[1].resident_region, None);
        assert!(!is_import(&g.players[0], region_of_team_id(&g, "lec-a")));

        // A later signing is not grandfathered by a second pass.
        g.players[1].team_id = Some("lec-a".to_string());
        assert_eq!(grandfather_rostered_players(&mut g), 0);
        assert_eq!(g.players[1].resident_region, None);
        assert!(is_import(&g.players[1], region_of_team_id(&g, "lec-a")));
    }

    #[test]
    fn old_saves_without_the_fields_load_and_get_grandfathered() {
        let g = game(
            vec![team("lec-a", "lec")],
            vec![player("top", "KR", LolRole::Top, 70, "lec-a")],
        );
        let mut json = serde_json::to_value(&g).unwrap();
        json.as_object_mut().unwrap().remove("residency_initialized");
        for p in json["players"].as_array_mut().unwrap() {
            let p = p.as_object_mut().unwrap();
            p.remove("resident_region");
            p.remove("is_import");
        }
        let mut loaded: Game = serde_json::from_value(json).unwrap();
        assert!(!loaded.residency_initialized);
        assert_eq!(grandfather_rostered_players(&mut loaded), 1);
        assert_eq!(loaded.players[0].resident_region.as_deref(), Some("EMEA"));
    }

    #[test]
    fn refresh_flags_follow_the_current_team() {
        let mut g = game(
            vec![team("lec-a", "lec"), team("lck-a", "lck")],
            vec![player("kr", "KR", LolRole::Top, 70, "lec-a")],
        );
        refresh_import_flags(&mut g);
        assert!(g.players[0].is_import);
        g.players[0].team_id = Some("lck-a".to_string());
        refresh_import_flags(&mut g);
        assert!(!g.players[0].is_import);
        g.players[0].team_id = None;
        refresh_import_flags(&mut g);
        assert!(!g.players[0].is_import);
    }
}
