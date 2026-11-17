//! Day-0 world identity dump: builds a new game the way `select_team` does, then lists every
//! player with where it came from and flags every same-person repeat.
//!
//! The test is `#[ignore]`d, so a plain `cargo test` never runs it. Run it from `src-tauri`:
//!
//! ```text
//! OLM_WD_LABEL=cc OLM_WD_TEAM=lec-g2-esports OLM_WD_OUT=/some/dir \
//!   cargo test --release --lib world_identity_dump -- --ignored --nocapture
//! ```
//!
//! Environment:
//! - `OLM_WD_TEAM`  comma-separated scoped ids of the user's club (default `lec-g2-esports`)
//! - `OLM_WD_OUT`   output directory (default `target/olm-world-dupes`)
//! - `OLM_WD_LABEL` label written into the output (default `tree`)
//!
//! Files per user club, in `<out>/<label>-<club>/`:
//! - `players.jsonl`  one line per player of the built world, with provenance
//! - `teams.jsonl`    one line per main team with role counts by `position` and by `natural_position`
//! - `flags.json`     the five flags, the namesake marks and the over-7 recount
//! - `summary.txt`    the counts
//!
//! The stale-twin decision is a replica of `world_catalog::drop_stale_twins_of_live_players`
//! that also says why a stale record was kept; it is computed in every tree so the old tag can
//! be read against the same rule, but only trees that ship the exclusion apply it.

use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fmt::Write as _;
use std::path::PathBuf;

use chrono::NaiveDate;
use olm_core::competitions::{load_players, scan_competitions};
use olm_core::domain::player::Player;
use olm_core::domain::team::TeamKind;
use olm_core::roster_stability::NewGameRosterFill;
use olm_core::world_catalog::is_stale_duplicate_competition;
use olm_core::world_overlay::{PlayerOp, bundled_world_overlay};
use serde_json::{Value, json};

use crate::pool_bench::{init_message_stores, new_game};

thread_local! {
    static FILLS: RefCell<Vec<(String, String, bool)>> = const { RefCell::new(Vec::new()) };
}

/// Called by the world build right after the new-game roster fill.
pub(crate) fn record_fills(fills: &[NewGameRosterFill]) {
    FILLS.with(|f| {
        f.borrow_mut().extend(
            fills
                .iter()
                .map(|fill| (fill.team_id.clone(), fill.player_id.clone(), fill.generated)),
        );
    });
}

fn data_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("data")
}

/// The two formats the game reads (`player_age::parse_date_of_birth`, `calcAge` in the UI).
pub(crate) fn parse_dob(raw: &str) -> Option<NaiveDate> {
    let raw = raw.trim();
    ["%Y-%m-%d", "%B %d, %Y"]
        .iter()
        .find_map(|format| NaiveDate::parse_from_str(raw, format).ok())
}

fn person_key(name: &str) -> String {
    name.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// A name folded to lowercase ASCII letters and digits, so "Víctor" and "victor" agree.
fn fold_name(name: &str) -> String {
    name.chars()
        .flat_map(char::to_lowercase)
        .map(|c| match c {
            'á' | 'à' | 'â' | 'ã' | 'ä' | 'å' | 'ą' => 'a',
            'é' | 'è' | 'ê' | 'ë' | 'ę' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'õ' | 'ö' | 'ø' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ç' | 'ć' | 'č' => 'c',
            'ñ' | 'ń' => 'n',
            'š' | 'ś' => 's',
            'ž' | 'ź' | 'ż' => 'z',
            'ł' => 'l',
            other => other,
        })
        .filter(|c| c.is_alphanumeric())
        .collect()
}

/// The two-letter code of a nationality the data writes either way ("KR" or "South Korea").
pub(crate) fn nationality_key(raw: &str) -> String {
    let lowered = raw.trim().to_lowercase();
    let code = match lowered.as_str() {
        "south korea" | "korea" => "KR",
        "china" => "CN",
        "brazil" | "brasil" => "BR",
        "mexico" => "MX",
        "colombia" => "CO",
        "germany" => "DE",
        "argentina" => "AR",
        "spain" => "ES",
        "peru" => "PE",
        "france" => "FR",
        "venezuela" => "VE",
        "taiwan" => "TW",
        "chile" => "CL",
        "hong kong" => "HK",
        "poland" => "PL",
        "romania" => "RO",
        "united states" => "US",
        "austria" => "AT",
        "portugal" => "PT",
        "greece" => "GR",
        "jordan" => "JO",
        "costa rica" => "CR",
        "denmark" => "DK",
        "czech republic" => "CZ",
        "netherlands" => "NL",
        "australia" => "AU",
        "belgium" => "BE",
        _ => return lowered.to_uppercase(),
    };
    code.to_string()
}

/// Lowercase letters and digits only: "Zephyr", "zephyr " and "Z-ephyr" agree. A trailing
/// "(real name)" is not part of the nick.
fn nick_key(player: &Player) -> String {
    let name = if player.match_name.trim().is_empty() {
        &player.full_name
    } else {
        &player.match_name
    };
    // Some records write the real name after the nick: "Ace (Ignacio David Piaggio)".
    let nick = name
        .split('(')
        .next()
        .filter(|n| !n.trim().is_empty())
        .unwrap_or(name);
    nick.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

struct Source {
    competition: String,
    file: String,
    team: Option<String>,
    dob: String,
    stale: bool,
    decision: String,
}

impl Source {
    fn json(&self) -> Value {
        json!({
            "competition": self.competition, "file": self.file,
            "team": self.team, "dob": self.dob, "stale_competition": self.stale,
            "stale_twin_decision": self.decision,
        })
    }
}

/// The records `assemble_world` loads, tagged the same way, with the stale-twin decision each
/// stale record gets under the row 126 rule.
fn load_sources() -> (HashMap<String, Vec<Source>>, usize) {
    let data = data_dir();
    let manifests = scan_competitions(&data.join("competitions"));
    let mut tagged: Vec<(String, Player, String)> = Vec::new();
    for manifest in manifests.iter().filter(|m| !m.legacy) {
        let cid = &manifest.id;
        let prefix = format!("{cid}-");
        let Ok(players) = load_players(&data, manifest) else {
            continue;
        };
        for mut player in players {
            let own = player
                .team_id
                .clone()
                .filter(|tid| tid != "fa" && tid != "freeagent" && !tid.starts_with(&prefix));
            if let Some(tid) = own {
                player.team_id = Some(format!("{cid}-{tid}"));
            }
            tagged.push((cid.clone(), player, manifest.players_file.clone()));
        }
    }

    let names = |p: &Player| -> Vec<String> {
        [person_key(&p.full_name), person_key(&p.match_name)]
            .into_iter()
            .filter(|n| !n.is_empty())
            .collect()
    };
    let mut live_ids: HashSet<&str> = HashSet::new();
    let mut live_by_identity: HashMap<(String, NaiveDate), &str> = HashMap::new();
    let mut live_by_nick: HashMap<String, Vec<&str>> = HashMap::new();
    for (competition, player, _) in &tagged {
        if is_stale_duplicate_competition(competition) {
            continue;
        }
        live_ids.insert(player.id.as_str());
        live_by_nick
            .entry(nick_key(player))
            .or_default()
            .push(player.id.as_str());
        if let Some(born) = parse_dob(&player.date_of_birth) {
            for name in names(player) {
                live_by_identity
                    .entry((name, born))
                    .or_insert(player.id.as_str());
            }
        }
    }

    let mut out: HashMap<String, Vec<Source>> = HashMap::new();
    for (competition, player, file) in &tagged {
        let stale = is_stale_duplicate_competition(competition);
        let decision = if !stale {
            "n/a (live competition)".to_string()
        } else if live_ids.contains(player.id.as_str()) {
            "kept: same id as a live record (left to dedupe_players)".to_string()
        } else if !player.team_id.as_deref().is_none_or(|team| {
            matches!(team, "fa" | "freeagent") || team.starts_with(&format!("{competition}-"))
        }) {
            "kept: team is neither a free agent nor the stale competition's own".to_string()
        } else {
            match parse_dob(&player.date_of_birth) {
                None if player.date_of_birth.trim().is_empty() => {
                    "kept: no date of birth (a missing date never matches)".to_string()
                }
                None => format!(
                    "kept: date of birth unreadable ({:?}), never matches",
                    player.date_of_birth
                ),
                Some(born) => {
                    let twin = names(player)
                        .into_iter()
                        .find_map(|n| live_by_identity.get(&(n, born)).copied());
                    match twin {
                        Some(live) => format!("dropped: live twin {live}"),
                        None => {
                            let near = live_by_nick
                                .get(&nick_key(player))
                                .cloned()
                                .unwrap_or_default();
                            format!(
                                "kept: no live record with the same name and date {born}; same-nick live ids {near:?}"
                            )
                        }
                    }
                }
            }
        };
        out.entry(player.id.clone()).or_default().push(Source {
            competition: competition.clone(),
            file: format!("data/{file}"),
            team: player.team_id.clone(),
            dob: player.date_of_birth.clone(),
            stale,
            decision,
        });
    }
    (out, tagged.len())
}

fn overlay_ops() -> (HashMap<String, Vec<String>>, BTreeMap<&'static str, usize>) {
    let overlay = bundled_world_overlay().expect("bundled overlay");
    let mut by_id: HashMap<String, Vec<String>> = HashMap::new();
    let mut kinds: BTreeMap<&'static str, usize> = BTreeMap::new();
    for op in &overlay.players {
        match op {
            PlayerOp::Move {
                id,
                team_id,
                position,
                contract_end,
                ..
            } => {
                *kinds.entry("move").or_default() += 1;
                by_id.entry(id.clone()).or_default().push(format!(
                    "move team={team_id:?} position={position:?} contract_end={contract_end:?}"
                ));
            }
            PlayerOp::Retire { id, .. } => {
                *kinds.entry("retire").or_default() += 1;
                by_id
                    .entry(id.clone())
                    .or_default()
                    .push("retire".to_string());
            }
            PlayerOp::Add {
                player, dob_approx, ..
            } => {
                *kinds.entry("add").or_default() += 1;
                by_id.entry(player.id.clone()).or_default().push(format!(
                    "add team={:?} dob={:?} dob_approx={dob_approx} position={:?}",
                    player.team_id, player.date_of_birth, player.position
                ));
            }
        }
    }
    (by_id, kinds)
}

fn role_tag(role: &olm_core::domain::stats::LolRole) -> String {
    format!("{role:?}")
}

fn percentile_99(sorted: &[u32]) -> u32 {
    let rank = (sorted.len() as f64 * 0.99).ceil() as usize;
    sorted[rank.clamp(1, sorted.len()) - 1]
}

const NAMESAKE_NICKS: [&str; 2] = ["winner", "white"];

fn describe(p: &Value) -> String {
    format!(
        "{} [{}] nick={:?} full={:?} dob={:?} nat={:?} team={} ovr={} wage={} end={}",
        p["id"].as_str().unwrap_or(""),
        p["position"].as_str().unwrap_or(""),
        p["match_name"].as_str().unwrap_or(""),
        p["full_name"].as_str().unwrap_or(""),
        p["dob_raw"].as_str().unwrap_or(""),
        p["nationality"].as_str().unwrap_or(""),
        p["team_id"].as_str().unwrap_or("FA"),
        p["ovr"],
        p["wage"],
        p["contract_end"].as_str().unwrap_or("-"),
    )
}

#[test]
#[ignore = "measurement harness; run by hand, see the module docs"]
fn world_identity_dump() {
    init_message_stores();
    let teams: Vec<String> = std::env::var("OLM_WD_TEAM")
        .unwrap_or_else(|_| "lec-g2-esports".to_string())
        .split(',')
        .map(str::to_string)
        .collect();
    let out_root = PathBuf::from(
        std::env::var("OLM_WD_OUT").unwrap_or_else(|_| "target/olm-world-dupes".to_string()),
    );
    let label = std::env::var("OLM_WD_LABEL").unwrap_or_else(|_| "tree".to_string());

    let (sources, source_records) = load_sources();
    let (overlay_by_id, overlay_kinds) = overlay_ops();
    println!(
        "SOURCES records={source_records} ids={} overlay_ops={overlay_kinds:?}",
        sources.len()
    );

    for team in &teams {
        FILLS.with(|f| f.borrow_mut().clear());
        let overlay = bundled_world_overlay().expect("bundled overlay");
        let (game, _, _) = new_game(&overlay, team);
        let fills: HashMap<String, (String, bool)> = FILLS.with(|f| {
            f.borrow()
                .iter()
                .map(|(t, p, g)| (p.clone(), (t.clone(), *g)))
                .collect()
        });
        let free_agent_json: HashSet<String> = olm_core::game_setup::load_free_agent_players()
            .iter()
            .map(|p| p.id.clone())
            .collect();
        let today = game.clock.current_date.date_naive();
        let team_info: HashMap<&str, (&str, TeamKind, Option<&str>)> = game
            .teams
            .iter()
            .map(|t| {
                (
                    t.id.as_str(),
                    (
                        t.name.as_str(),
                        t.team_kind.clone(),
                        t.competition_id.as_deref(),
                    ),
                )
            })
            .collect();

        let mut rows: Vec<Value> = Vec::with_capacity(game.players.len());
        for p in &game.players {
            let parsed = parse_dob(&p.date_of_birth);
            let age = parsed.map(|d| today.years_since(d).unwrap_or(0));
            let ovr = olm_core::potential::calculate_lol_ovr(p);
            let info = p.team_id.as_deref().and_then(|t| team_info.get(t));
            let src: Vec<Value> = sources
                .get(&p.id)
                .map(|v| v.iter().map(Source::json).collect())
                .unwrap_or_default();
            rows.push(json!({
                "id": p.id, "match_name": p.match_name, "full_name": p.full_name,
                "nick_key": nick_key(p), "full_key": fold_name(&p.full_name),
                "nationality_key": nationality_key(&p.nationality),
                "dob_raw": p.date_of_birth, "dob": parsed.map(|d| d.to_string()), "age": age,
                "nationality": p.nationality, "team_id": p.team_id,
                "team_name": info.map(|i| i.0), "team_kind": info.map(|i| format!("{:?}", i.1)),
                "competition": info.and_then(|i| i.2),
                "position": role_tag(&p.position), "natural_position": role_tag(&p.natural_position),
                "ovr": ovr, "stored_lol_ovr": p.lol_ovr,
                "wage": p.wage, "market_value": p.market_value, "contract_end": p.contract_end,
                "sources": src,
                "free_agents_json": free_agent_json.contains(&p.id),
                "overlay_ops": overlay_by_id.get(&p.id).cloned().unwrap_or_default(),
                "new_game_fill": fills.get(&p.id).map(|(t, g)| json!({"team": t, "generated": g})),
                "generated_by_fill": fills.get(&p.id).is_some_and(|f| f.1),
            }));
        }

        // ---- flags ----
        let mut by_team_nick: BTreeMap<(String, String), Vec<&Value>> = BTreeMap::new();
        let mut by_nick_dob: BTreeMap<(String, String), Vec<&Value>> = BTreeMap::new();
        let mut by_nick: BTreeMap<String, Vec<&Value>> = BTreeMap::new();
        for r in &rows {
            let nick = r["nick_key"].as_str().unwrap_or("").to_string();
            if let Some(team_id) = r["team_id"].as_str() {
                by_team_nick
                    .entry((team_id.to_string(), nick.clone()))
                    .or_default()
                    .push(r);
            }
            if let Some(dob) = r["dob"].as_str() {
                by_nick_dob
                    .entry((nick.clone(), dob.to_string()))
                    .or_default()
                    .push(r);
            }
            by_nick.entry(nick).or_default().push(r);
        }
        let namesake = |nick: &str| NAMESAKE_NICKS.contains(&nick);
        let group = |rows: &[&Value]| rows.iter().map(|r| (*r).clone()).collect::<Vec<_>>();

        let flag1: Vec<Value> = by_team_nick
            .iter()
            .filter(|(_, v)| v.len() > 1)
            .map(|((t, n), v)| json!({"team": t, "nick": n, "known_namesake": namesake(n), "players": group(v)}))
            .collect();
        let flag2: Vec<Value> = by_nick_dob
            .iter()
            .filter(|(_, v)| v.len() > 1)
            .map(|((n, d), v)| json!({"nick": n, "dob": d, "known_namesake": namesake(n), "players": group(v)}))
            .collect();
        let mut flag3: Vec<Value> = Vec::new();
        let mut flag4: Vec<Value> = Vec::new();
        for (nick, v) in &by_nick {
            let free: Vec<&&Value> = v.iter().filter(|r| r["team_id"].is_null()).collect();
            let held: Vec<&&Value> = v.iter().filter(|r| !r["team_id"].is_null()).collect();
            for fa in &free {
                for c in &held {
                    let dob_relation = match (fa["dob"].as_str(), c["dob"].as_str()) {
                        (Some(a), Some(b)) if a == b => "same",
                        (Some(_), Some(_)) => "different",
                        (None, None) => "both missing or unreadable",
                        (None, _) => "free agent missing or unreadable",
                        (_, None) => "contracted missing or unreadable",
                    };
                    let same_full = !fa["full_key"].as_str().unwrap_or("").is_empty()
                        && fa["full_key"] == c["full_key"];
                    let same_nat = !fa["nationality_key"].as_str().unwrap_or("").is_empty()
                        && fa["nationality_key"] == c["nationality_key"];
                    let entry = json!({
                        "nick": nick, "known_namesake": namesake(nick), "dob_relation": dob_relation,
                        "same_full_name": same_full, "same_nationality": same_nat,
                        "free_agent": (**fa).clone(), "contracted": (**c).clone(),
                    });
                    if dob_relation != "same" {
                        flag3.push(entry.clone());
                    }
                    if same_full || same_nat {
                        flag4.push(entry);
                    }
                }
            }
        }

        let mut bands: BTreeMap<u32, Vec<u32>> = BTreeMap::new();
        for r in &rows {
            let wage = r["wage"].as_u64().unwrap_or(0) as u32;
            if wage > 0 {
                bands
                    .entry(r["ovr"].as_u64().unwrap_or(0) as u32 / 5 * 5)
                    .or_default()
                    .push(wage);
            }
        }
        let p99: BTreeMap<u32, (u32, usize)> = bands
            .into_iter()
            .map(|(band, mut w)| {
                w.sort_unstable();
                (band, (percentile_99(&w), w.len()))
            })
            .collect();
        let mut flag5_ovr = Vec::new();
        let mut flag5_age = Vec::new();
        let mut flag5_wage = Vec::new();
        for r in &rows {
            let ovr = r["ovr"].as_u64().unwrap_or(0);
            if ovr < 10 {
                flag5_ovr.push(r.clone());
            }
            if r["age"]
                .as_u64()
                .is_some_and(|age| !(15..=45).contains(&age))
            {
                flag5_age.push(r.clone());
            }
            let wage = r["wage"].as_u64().unwrap_or(0) as u32;
            let band = ovr as u32 / 5 * 5;
            if let Some((limit, n)) = p99.get(&band).filter(|(limit, _)| wage > *limit) {
                let mut row = r.clone();
                row["band"] = json!(band);
                row["band_p99"] = json!(limit);
                row["band_size"] = json!(n);
                flag5_wage.push(row);
            }
        }

        // ---- role gaps and the over-7 recount (AI main clubs; the user club is listed apart) ----
        let user_team = game.manager.team_id.clone().unwrap_or_default();
        let mut by_team: BTreeMap<&str, Vec<&Value>> = BTreeMap::new();
        for r in &rows {
            if let Some(t) = r["team_id"].as_str() {
                by_team.entry(t).or_default().push(r);
            }
        }
        const ROLES: [&str; 5] = ["Top", "Jungle", "Mid", "Adc", "Support"];
        let mut team_rows: Vec<Value> = Vec::new();
        let (mut gap_position, mut gap_natural, mut gap_ui) = (Vec::new(), Vec::new(), Vec::new());
        let (mut over7_raw, mut over7_dedup) = (Vec::new(), Vec::new());
        let mut hist_raw: BTreeMap<usize, usize> = BTreeMap::new();
        let mut hist_dedup: BTreeMap<usize, usize> = BTreeMap::new();
        for t in game.teams.iter().filter(|t| t.team_kind == TeamKind::Main) {
            let members = by_team.get(t.id.as_str()).cloned().unwrap_or_default();
            let count =
                |field: &str, role: &str| members.iter().filter(|m| m[field] == role).count();
            let pos: Vec<usize> = ROLES.iter().map(|r| count("position", r)).collect();
            let nat: Vec<usize> = ROLES.iter().map(|r| count("natural_position", r)).collect();
            // The club page resolves a role with `position` first, then `natural_position`.
            let ui: Vec<usize> = ROLES
                .iter()
                .map(|r| {
                    members
                        .iter()
                        .filter(|m| {
                            let p = m["position"].as_str().unwrap_or("");
                            let resolved = if ROLES.contains(&p) {
                                p
                            } else {
                                m["natural_position"].as_str().unwrap_or("")
                            };
                            resolved == *r
                        })
                        .count()
                })
                .collect();
            let missing = |c: &[usize]| {
                ROLES
                    .iter()
                    .zip(c)
                    .filter(|(_, n)| **n == 0)
                    .map(|(r, _)| *r)
                    .collect::<Vec<_>>()
            };
            let is_user = t.id == user_team;
            let people: BTreeSet<String> = members
                .iter()
                .map(|m| {
                    let n = m["nick_key"].as_str().unwrap_or("").to_string();
                    if namesake(&n) {
                        format!("{n}|{}", m["id"].as_str().unwrap_or(""))
                    } else {
                        n
                    }
                })
                .collect();
            let row = json!({
                "team_id": t.id, "name": t.name, "competition": t.competition_id, "user": is_user,
                "size": members.len(), "distinct_people": people.len(),
                "by_position": pos, "by_natural_position": nat, "by_ui_role": ui,
                "missing_by_position": missing(&pos), "missing_by_natural_position": missing(&nat),
                "missing_by_ui_role": missing(&ui),
                "players": members.iter().map(|m| json!({
                    "id": m["id"], "nick": m["match_name"], "position": m["position"],
                    "natural_position": m["natural_position"], "contract_end": m["contract_end"],
                })).collect::<Vec<_>>(),
            });
            if !is_user {
                if !missing(&pos).is_empty() {
                    gap_position.push(t.id.clone());
                }
                if !missing(&nat).is_empty() {
                    gap_natural.push(t.id.clone());
                }
                if !missing(&ui).is_empty() {
                    gap_ui.push(t.id.clone());
                }
                *hist_raw.entry(members.len()).or_default() += 1;
                *hist_dedup.entry(people.len()).or_default() += 1;
                if members.len() > 7 {
                    over7_raw.push(t.id.clone());
                }
                if people.len() > 7 {
                    over7_dedup.push(t.id.clone());
                }
            }
            team_rows.push(row);
        }

        // ---- write ----
        let dir = out_root.join(format!("{label}-{team}"));
        std::fs::create_dir_all(&dir).expect("out dir");
        let write = |name: &str, body: String| std::fs::write(dir.join(name), body).expect("write");
        write(
            "players.jsonl",
            rows.iter().map(|r| format!("{r}\n")).collect(),
        );
        write(
            "teams.jsonl",
            team_rows.iter().map(|r| format!("{r}\n")).collect(),
        );
        let flags = json!({
            "label": label, "user_team": user_team, "date": today.to_string(),
            "flag1_same_nick_on_one_team": flag1, "flag2_same_nick_same_dob": flag2,
            "flag3_fa_vs_contracted_dob_gap": flag3, "flag4_fa_vs_contracted_name_or_nat": flag4,
            "flag5_ovr_below_10": flag5_ovr, "flag5_age_outside_15_45": flag5_age,
            "flag5_wage_above_band_p99": flag5_wage,
            "wage_bands": p99.iter().map(|(b, (l, n))| json!({"band": b, "p99": l, "n": n})).collect::<Vec<_>>(),
            "gap_clubs_by_position": gap_position, "gap_clubs_by_natural_position": gap_natural,
            "gap_clubs_by_ui_role": gap_ui,
            "over7_raw": over7_raw, "over7_dedup": over7_dedup,
        });
        write(
            "flags.json",
            serde_json::to_string_pretty(&flags).expect("json"),
        );

        let mut s = String::new();
        let n = |k: &str| flags[k].as_array().map_or(0, Vec::len);
        let non_namesake = |k: &str| {
            flags[k].as_array().map_or(0, |a| {
                a.iter()
                    .filter(|e| e["known_namesake"] != json!(true))
                    .count()
            })
        };
        let _ = writeln!(
            s,
            "label={label} user={team} date={today} players={} free_agents={}",
            rows.len(),
            rows.iter().filter(|r| r["team_id"].is_null()).count()
        );
        for (k, name) in [
            ("flag1_same_nick_on_one_team", "flag1"),
            ("flag2_same_nick_same_dob", "flag2"),
            ("flag3_fa_vs_contracted_dob_gap", "flag3"),
            ("flag4_fa_vs_contracted_name_or_nat", "flag4"),
        ] {
            let _ = writeln!(
                s,
                "{name} {k}: {} groups, {} excluding known namesakes",
                n(k),
                non_namesake(k)
            );
        }
        let _ = writeln!(
            s,
            "flag5 ovr<10: {}; age outside 15-45: {}; wage > band p99: {}",
            n("flag5_ovr_below_10"),
            n("flag5_age_outside_15_45"),
            n("flag5_wage_above_band_p99")
        );
        let _ = writeln!(
            s,
            "ai main clubs: {}; over 7 raw: {}; over 7 after removing same-nick repeats: {}",
            team_rows
                .iter()
                .filter(|t| t["user"] == json!(false))
                .count(),
            over7_raw.len(),
            over7_dedup.len()
        );
        let _ = writeln!(s, "histogram raw {hist_raw:?} dedup {hist_dedup:?}");
        let _ = writeln!(
            s,
            "role-gap clubs: by position {}, by natural_position {}, by ui role {}",
            gap_position.len(),
            gap_natural.len(),
            gap_ui.len()
        );
        let _ = writeln!(
            s,
            "new-game fill: {} signed, {} generated",
            fills.values().filter(|f| !f.1).count(),
            fills.values().filter(|f| f.1).count()
        );
        for k in ["flag1_same_nick_on_one_team", "flag2_same_nick_same_dob"] {
            for e in flags[k].as_array().into_iter().flatten() {
                let _ = writeln!(
                    s,
                    "{k}: nick={} namesake={}",
                    e["nick"], e["known_namesake"]
                );
                for p in e["players"].as_array().into_iter().flatten() {
                    let _ = writeln!(s, "    {}", describe(p));
                }
            }
        }
        for k in ["flag3_fa_vs_contracted_dob_gap"] {
            for e in flags[k].as_array().into_iter().flatten() {
                let _ = writeln!(
                    s,
                    "{k}: nick={} dob_relation={} full={} nat={} namesake={}",
                    e["nick"],
                    e["dob_relation"],
                    e["same_full_name"],
                    e["same_nationality"],
                    e["known_namesake"]
                );
                let _ = writeln!(s, "    FA  {}", describe(&e["free_agent"]));
                let _ = writeln!(s, "    ROS {}", describe(&e["contracted"]));
            }
        }
        write("summary.txt", s.clone());
        println!("{s}");
    }
}
