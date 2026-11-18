//! Identity invariants of a day-0 new-game world.
//!
//! The world is built the way `select_team` builds it (the same path as the `world_identity_dump`
//! harness), and these tests assert what a QA pass checks by eye: each real person once, no free
//! agent twin of a rostered player, no placeholder rating shells, no lane left uncovered.
//!
//! Reviewed exceptions live in `world_identity_review.json`, one entry per pair with a reason:
//! - `namesakes`: different people who share a name. They never fail a test.
//! - `deferred`: the same person twice that a later change will fix. Each entry must still
//!   occur (a fixed pair has to leave the list) and the list may never grow past
//!   `DEFERRED_CEILING`, so the count can only go down.
//! - `rated_one`: a record allowed at OVR 1 or with every attribute at 0.
//!
//! Set `OLM_WI_PRINT=1` to print every suspect pair as ready-to-paste JSON entries.

use std::collections::{BTreeSet, HashMap};

use chrono::NaiveDate;
use olm_core::domain::player::Player;
use olm_core::domain::stats::LolRole;
use olm_core::domain::team::TeamKind;
use olm_core::game::Game;
use olm_core::person_identity::{fold_name, folded_names, folded_real_names, has_all_attributes_zero};
use olm_core::world_overlay::bundled_world_overlay;
use serde::Deserialize;

use crate::pool_bench::{init_message_stores, new_game};
use crate::world_dupes::{nationality_key, parse_dob};

const REVIEW: &str = include_str!("world_identity_review.json");

/// The most deferred pairs the review file may hold. Lower it when pairs are fixed; raising it
/// needs a reviewed reason in the change that does so.
/// 28 since the overlay of 2026-11-17 moves Chapters (`player-0aee4cee`) instead of adding a
/// second record: the Leaguepedia KUMEW page reads Leandro Gabriel Paiano Krenz, born
/// 2005-01-17, AR, Bot, and the game record has the same name and birth date, so the
/// deferred pair `0aee4cee`/`4362e7be` no longer occurs. 27 since its pool also leaves out Howl
/// (`dea22e1c`, Kim Min-jun, born 2009-05-04, KR): the world build hides him as the same person as Eclipse
/// `d62e9487` (same real name, KR, birth dates six days apart), so the deferred pair `d62e9487`/`dea22e1c` is gone.
const DEFERRED_CEILING: usize = 27;

/// Main clubs (the user's club apart) missing a lane at day 0, by the lane the club page shows.
/// Re-measured after each change; a ratchet, so it only moves down.
const ROLE_GAP_CLUBS: usize = 0;

const USER_CLUB: &str = "lec-g2-esports";

#[derive(Debug, Deserialize)]
struct Review {
    namesakes: Vec<PairEntry>,
    deferred: Vec<PairEntry>,
    rated_one: Vec<RatedEntry>,
}

#[derive(Debug, Deserialize)]
struct PairEntry {
    ids: [String; 2],
    class: String,
    reason: String,
}

#[derive(Debug, Deserialize)]
struct RatedEntry {
    id: String,
    reason: String,
}

type Pair = (String, String);

fn pair(a: &str, b: &str) -> Pair {
    if a <= b {
        (a.to_string(), b.to_string())
    } else {
        (b.to_string(), a.to_string())
    }
}

fn review() -> Review {
    let review: Review = serde_json::from_str(REVIEW).expect("world_identity_review.json parses");
    for entry in review.namesakes.iter().chain(&review.deferred) {
        assert!(
            !entry.reason.trim().is_empty() && !entry.class.trim().is_empty(),
            "review entry {:?} needs a class and a reason",
            entry.ids
        );
    }
    for entry in &review.rated_one {
        assert!(!entry.reason.trim().is_empty(), "{} needs a reason", entry.id);
    }
    review
}

fn world() -> &'static Game {
    static WORLD: std::sync::OnceLock<Game> = std::sync::OnceLock::new();
    WORLD.get_or_init(|| {
        init_message_stores();
        let overlay = bundled_world_overlay().expect("bundled overlay");
        new_game(&overlay, USER_CLUB).0
    })
}

fn is_lane(role: LolRole) -> bool {
    !matches!(role, LolRole::Unknown)
}

/// The lane the club page shows: `position` when it is a lane, else `natural_position`.
fn shown_role(player: &Player) -> LolRole {
    if is_lane(player.position) {
        player.position
    } else {
        player.natural_position
    }
}

fn nationalities_agree(a: &Player, b: &Player) -> bool {
    let (x, y) = (nationality_key(&a.nationality), nationality_key(&b.nationality));
    x.is_empty() || y.is_empty() || x == y
}

/// Whether two records may be one person. They must share a folded name (match or full name,
/// parenthesis stripped, either way round). Then:
/// - on the same club it is one person written twice;
/// - a shared name and the same birth date is one person, whatever else differs;
/// - two records that each carry a real name (two or more words) and share none are two people
///   who happen to share a nick;
/// - a shared real name settles it when the nationalities do not differ;
/// - a shared nick alone needs agreeing nationalities and birth dates within 400 days (a month,
///   a day-swap or a year-digit typo is one person; another year is not).
fn suspect(a: &Player, b: &Player) -> bool {
    let names_a = folded_names(a);
    if !folded_names(b).iter().any(|name| names_a.contains(name)) {
        return false;
    }
    // One club holding two records that share a name is one person written twice.
    if a.team_id.is_some() && a.team_id == b.team_id {
        return true;
    }
    let (born_a, born_b) = (parse_dob(&a.date_of_birth), parse_dob(&b.date_of_birth));
    if born_a.is_some() && born_a == born_b {
        return true;
    }
    let (real_a, real_b) = (folded_real_names(a), folded_real_names(b));
    if !real_a.is_empty() && !real_b.is_empty() {
        return real_a.iter().any(|name| real_b.contains(name)) && nationalities_agree(a, b);
    }
    if !nationalities_agree(a, b) {
        return false;
    }
    match (born_a, born_b) {
        (Some(x), Some(y)) => (x - y).num_days().abs() <= 400 || same_digits_but_one(x, y),
        _ => true,
    }
}

/// A year typed with one wrong digit (2003 for 2023) with the day and month intact.
fn same_digits_but_one(x: NaiveDate, y: NaiveDate) -> bool {
    use chrono::Datelike;
    x.month() == y.month()
        && x.day() == y.day()
        && x.year()
            .to_string()
            .chars()
            .zip(y.year().to_string().chars())
            .filter(|(c, d)| c != d)
            .count()
            == 1
}

/// Every pair of records that may be one person, as sorted id pairs.
fn suspects(game: &Game) -> BTreeSet<Pair> {
    let mut by_name: HashMap<String, Vec<usize>> = HashMap::new();
    for (index, player) in game.players.iter().enumerate() {
        for name in folded_names(player) {
            by_name.entry(name).or_default().push(index);
        }
    }
    let mut found = BTreeSet::new();
    for indexes in by_name.values() {
        for (position, &i) in indexes.iter().enumerate() {
            for &j in &indexes[position + 1..] {
                let (a, b) = (&game.players[i], &game.players[j]);
                if a.id != b.id && suspect(a, b) {
                    found.insert(pair(&a.id, &b.id));
                }
            }
        }
    }
    found
}

fn pairs_of(entries: &[PairEntry]) -> BTreeSet<Pair> {
    entries
        .iter()
        .map(|entry| pair(&entry.ids[0], &entry.ids[1]))
        .collect()
}

fn describe(game: &Game, id: &str) -> String {
    game.players
        .iter()
        .find(|player| player.id == id)
        .map(|p| {
            format!(
                "{id} {:?}/{:?} dob={:?} nat={} team={}",
                p.match_name,
                p.full_name,
                p.date_of_birth,
                p.nationality,
                p.team_id.as_deref().unwrap_or("FA"),
            )
        })
        .unwrap_or_else(|| format!("{id} (absent)"))
}

fn report(game: &Game, pairs: &BTreeSet<Pair>) -> String {
    pairs
        .iter()
        .map(|(a, b)| format!("\n  {}\n  {}\n", describe(game, a), describe(game, b)))
        .collect()
}

fn print_entries_if_asked(game: &Game, found: &BTreeSet<Pair>) {
    if std::env::var("OLM_WI_PRINT").is_ok() {
        for (a, b) in found {
            println!(
                "SUSPECT {{\"ids\": [\"{a}\", \"{b}\"], \"reason\": \"\"}}  // {} | {}",
                describe(game, a),
                describe(game, b)
            );
        }
        println!("SUSPECT-COUNT {}", found.len());
    }
}

#[test]
fn each_person_appears_once_unless_reviewed() {
    let game = world();
    let review = review();
    let found = suspects(game);
    print_entries_if_asked(game, &found);
    let allowed: BTreeSet<Pair> = pairs_of(&review.namesakes)
        .union(&pairs_of(&review.deferred))
        .cloned()
        .collect();
    let unexplained: BTreeSet<Pair> = found.difference(&allowed).cloned().collect();
    assert!(
        unexplained.is_empty(),
        "{} pair(s) of one person twice:{}",
        unexplained.len(),
        report(game, &unexplained)
    );
}

#[test]
fn no_free_agent_duplicates_a_contracted_player() {
    let game = world();
    let review = review();
    let team_of: HashMap<&str, Option<&str>> = game
        .players
        .iter()
        .map(|p| (p.id.as_str(), p.team_id.as_deref()))
        .collect();
    let allowed: BTreeSet<Pair> = pairs_of(&review.namesakes)
        .union(&pairs_of(&review.deferred))
        .cloned()
        .collect();
    let twins: BTreeSet<Pair> = suspects(game)
        .into_iter()
        .filter(|(a, b)| team_of[a.as_str()].is_none() != team_of[b.as_str()].is_none())
        .filter(|p| !allowed.contains(p))
        .collect();
    assert!(
        twins.is_empty(),
        "{} free agent(s) duplicate a contracted player:{}",
        twins.len(),
        report(game, &twins)
    );
}

/// The day the catalog uses when a birth date is unknown.
const PLACEHOLDER_DOB: &str = "2002-01-01";

#[test]
fn no_free_agent_shares_a_name_and_a_real_birth_date_with_a_contracted_player() {
    let game = world();
    let placeholder = parse_dob(PLACEHOLDER_DOB);
    let mut contracted: HashMap<(String, NaiveDate), Vec<&Player>> = HashMap::new();
    for player in game.players.iter().filter(|p| p.team_id.is_some()) {
        let Some(born) = parse_dob(&player.date_of_birth).filter(|d| Some(*d) != placeholder)
        else {
            continue;
        };
        for name in folded_names(player) {
            contracted.entry((name, born)).or_default().push(player);
        }
    }
    let twins: Vec<String> = game
        .players
        .iter()
        .filter(|p| p.team_id.is_none())
        .filter_map(|free_agent| {
            let born = parse_dob(&free_agent.date_of_birth).filter(|d| Some(*d) != placeholder)?;
            folded_names(free_agent)
                .into_iter()
                .find_map(|name| contracted.get(&(name, born)))
                .map(|others| {
                    format!(
                        "{} ~ {}",
                        describe(game, &free_agent.id),
                        describe(game, &others[0].id)
                    )
                })
        })
        .collect();
    assert!(
        twins.is_empty(),
        "{} free agent(s) share a name and a birth date with a contracted player:\n  {}",
        twins.len(),
        twins.join("\n  ")
    );
}

/// Measurement: the free agents of a new world that the AI signing guard treats as the twin
/// of a contracted player, with the twin each one matched.
///
/// ```text
/// cargo test --lib ai_guard_hidden_free_agents -- --ignored --nocapture
/// ```
#[test]
#[ignore = "measurement harness; run by hand"]
fn ai_guard_hidden_free_agents() {
    init_message_stores();
    let overlay = bundled_world_overlay().expect("bundled overlay");
    let game = &new_game(&overlay, "lec-fnatic").0;
    let contracted = olm_core::person_identity::PersonIndex::new(
        game.players.iter().filter(|p| p.team_id.is_some()),
    );
    let hidden: Vec<String> = game
        .players
        .iter()
        .filter(|p| p.team_id.is_none())
        .filter_map(|p| {
            contracted
                .twin_of(p)
                .map(|twin| format!("{}  ~  {}", describe(game, &p.id), describe(game, twin)))
        })
        .collect();
    println!(
        "AI-GUARD hidden free agents: {} of {}",
        hidden.len(),
        game.players.iter().filter(|p| p.team_id.is_none()).count()
    );
    for line in &hidden {
        println!("AI-GUARD {line}");
    }
}

/// Measurement: the pool adds of the bundled overlay that the world build folds away (K2,
/// `collapse_same_person_records`) before the player sees them, with the records that share a
/// folded name with each.
///
/// ```text
/// cargo test --lib pool_adds_folded_by_the_world_build -- --ignored --nocapture
/// ```
#[test]
#[ignore = "measurement harness; run by hand"]
fn pool_adds_folded_by_the_world_build() {
    init_message_stores();
    let overlay = bundled_world_overlay().expect("bundled overlay");
    let game = &new_game(&overlay, "lec-fnatic").0;
    let in_world: BTreeSet<&str> = game.players.iter().map(|p| p.id.as_str()).collect();
    let mut folded = 0;
    for op in &overlay.players {
        let olm_core::world_overlay::PlayerOp::Add { player, .. } = op else {
            continue;
        };
        if player.team_id.is_some() || in_world.contains(player.id.as_str()) {
            continue;
        }
        folded += 1;
        let names = folded_names(player);
        let twins: Vec<String> = game
            .players
            .iter()
            .filter(|other| folded_names(other).iter().any(|n| names.contains(n)))
            .map(|other| describe(game, &other.id))
            .collect();
        println!(
            "FOLDED {} {:?}/{:?} dob={:?} nat={} -> {}",
            player.id, player.match_name, player.full_name, player.date_of_birth,
            player.nationality, twins.join(" | ")
        );
    }
    println!("FOLDED total {folded}");
}

#[test]
fn deferred_pairs_still_occur_and_never_grow() {
    let game = world();
    let review = review();
    let found = suspects(game);
    let deferred = pairs_of(&review.deferred);
    let fixed: BTreeSet<Pair> = deferred.difference(&found).cloned().collect();
    assert!(
        fixed.is_empty(),
        "{} deferred pair(s) no longer occur; remove them from the review file:{}",
        fixed.len(),
        report(game, &fixed)
    );
    assert_eq!(
        review.deferred.len(),
        deferred.len(),
        "a deferred pair is listed twice"
    );
    assert!(
        review.deferred.len() <= DEFERRED_CEILING,
        "{} deferred pairs, ceiling {DEFERRED_CEILING}",
        review.deferred.len()
    );
    assert_eq!(
        review.deferred.len(),
        DEFERRED_CEILING,
        "fewer deferred pairs than the ceiling: lower DEFERRED_CEILING to {}",
        review.deferred.len()
    );
}

#[test]
fn no_player_is_a_placeholder_shell_without_a_reason() {
    let game = world();
    let review = review();
    let allowed: BTreeSet<&str> = review.rated_one.iter().map(|e| e.id.as_str()).collect();
    let shells: Vec<String> = game
        .players
        .iter()
        .filter(|p| has_all_attributes_zero(p) || olm_core::potential::calculate_lol_ovr(p) <= 1)
        .filter(|p| !allowed.contains(p.id.as_str()))
        .map(|p| describe(game, &p.id))
        .collect();
    assert!(
        shells.is_empty(),
        "{} player(s) with no rating data:\n  {}",
        shells.len(),
        shells.join("\n  ")
    );
}

fn clubs_missing_a_lane(game: &Game) -> Vec<String> {
    let user_team = game.manager.team_id.clone().unwrap_or_default();
    game.teams
        .iter()
        .filter(|team| team.team_kind == TeamKind::Main && team.id != user_team)
        .filter(|team| {
            let shown: std::collections::HashSet<LolRole> = game
                .players
                .iter()
                .filter(|p| p.team_id.as_deref() == Some(team.id.as_str()))
                .map(shown_role)
                .collect();
            [LolRole::Top, LolRole::Jungle, LolRole::Mid, LolRole::Adc, LolRole::Support]
                .iter()
                .any(|lane| !shown.contains(lane))
        })
        .map(|team| team.id.clone())
        .collect()
}

#[test]
fn clubs_missing_a_lane_only_go_down() {
    let game = world();
    let gaps = clubs_missing_a_lane(game);
    // The ratchet sits at its floor: any club missing a lane fails. When the ceiling is
    // above 0, also fail on a lower count so the constant is lowered with the fix.
    assert_eq!(
        gaps.len(),
        ROLE_GAP_CLUBS,
        "{} clubs miss a lane, ratchet {ROLE_GAP_CLUBS} (lower the constant when fewer): {gaps:?}",
        gaps.len()
    );
}

/// Ace is one person written three times (the Spanish stub and the merged catalog record on
/// one club, and the overlay's pool add): exactly one record survives, the catalog record.
#[test]
fn ace_is_one_person_and_the_merged_catalog_record_survives() {
    let game = world();
    let aces: Vec<&str> = game
        .players
        .iter()
        .filter(|p| fold_name(&p.full_name) == "ignaciodavidpiaggio")
        .map(|p| p.id.as_str())
        .collect();
    assert_eq!(aces, vec!["player-cea7803b"]);
    let stubs = game.players.iter().filter(|p| p.id == "player-2ba313af").count();
    assert_eq!(stubs, 0, "the Spanish stub is gone");
}

/// A collapsed record that is not tombstoned comes back on the next load, when the catalog
/// rehydration appends every id the save lacks.
#[test]
fn collapsed_same_club_records_are_tombstoned_and_the_moved_survivor_stays_protected() {
    let game = world();
    let retired: BTreeSet<&str> = game.retired_player_ids.iter().map(String::as_str).collect();
    for loser in [
        "player-2ba313af", // Ace, the stub
        "player-e340e76a", // Samkz, the cd stub
        "player-067b9a1f", // Kaii, the les record
        "player-20d7dc63", // Sankaizer, the stub
    ] {
        assert!(retired.contains(loser), "{loser} is not tombstoned");
        assert!(
            game.players.iter().all(|p| p.id != loser),
            "{loser} is still in the world"
        );
    }
    assert!(
        game.moved_player_ids.contains("player-d9d06923"),
        "the moved Samkz keeps its protection"
    );
}

/// The pool adds of the overlay of 2026-11-14 that the world build folded into a catalog record, and so tombstoned:
/// Ace `5236c06a`, BetaTwinz `e6070e34`, Pauporter `6f539319`, Kellie `988c0230`, Papiteero `723229ff` and Lurox
/// `776a86c8`. The overlay of 2026-11-17 no longer adds them: its pool leaves out a person the world build would
/// fold or hide (`pool-no-duplicates`, same rules as `collapse_same_person_records`), so a new world never holds
/// them and there is nothing to tombstone. Ace, for one: Leaguepedia's "Ace (Ignacio David Piaggio)" page reads
/// Uruguay, Bot, Senshi eSports, and the catalog record `cea7803b` has the same real name, UY and ADC. The
/// collapse that tombstones them when an overlay does add them is covered by
/// `a_world_holding_the_old_pool_add_of_ace_keeps_only_the_catalog_record` in `olm_core::world_catalog`; a save that
/// already holds them is not repaired (`commands::import`).
#[test]
fn pool_adds_the_world_build_used_to_fold_are_no_longer_added() {
    let game = world();
    let overlay = bundled_world_overlay().expect("bundled overlay");
    let added = overlay.teamless_added_player_ids();
    for id in [
        "player-5236c06a",
        "player-e6070e34",
        "player-6f539319",
        "player-988c0230",
        "player-723229ff",
        "player-776a86c8",
    ] {
        assert!(!added.contains(id), "{id} is a pool add of the overlay again");
        assert!(game.players.iter().all(|p| p.id != id), "{id} is in the world");
    }
}

/// Every pool add of the bundled overlay reaches a new world: none is folded into a record on a club.
#[test]
fn every_pool_add_of_the_bundled_overlay_survives_the_world_build() {
    let game = world();
    let overlay = bundled_world_overlay().expect("bundled overlay");
    let in_world: BTreeSet<&str> = game.players.iter().map(|p| p.id.as_str()).collect();
    let folded: Vec<String> = overlay
        .teamless_added_player_ids()
        .into_iter()
        .filter(|id| !in_world.contains(id.as_str()))
        .collect();
    assert!(folded.is_empty(), "{} pool add(s) folded away: {folded:?}", folded.len());
}

/// A player's lane and natural role are one fact: where both name a lane they agree. The
/// catalog ships 29 rows where `natural_position` says Mid for a jungler, so the roster fill
/// signed them into Mid gaps and counted the gaps closed.
#[test]
fn position_and_natural_position_agree_wherever_both_name_a_lane() {
    let game = world();
    let split: Vec<String> = game
        .players
        .iter()
        .filter(|p| is_lane(p.position) && is_lane(p.natural_position))
        .filter(|p| p.position != p.natural_position)
        .map(|p| format!("{} {:?} {:?}/{:?}", p.id, p.match_name, p.position, p.natural_position))
        .collect();
    assert!(split.is_empty(), "{} player(s) disagree:\n  {}", split.len(), split.join("\n  "));
}
