use super::{
    CHAMPION_KILL_GOLD, CHAMPION_KILL_GOLD_MAX, CHAMPION_KILL_GOLD_MIN, CHAMPION_KILL_XP,
    CHAMPION_KILL_XP_MAX, CHAMPION_KILL_XP_MIN, ChampionRuntime,
};

pub(super) fn jungle_camp_reward(key: &str) -> Option<(i64, i64)> {
    match key {
        "blue-buff-blue" | "blue-buff-red" => Some((120, 180)),
        "red-buff-blue" | "red-buff-red" => Some((120, 185)),
        "wolves-blue" | "wolves-red" => Some((90, 135)),
        "raptors-blue" | "raptors-red" => Some((92, 140)),
        "gromp-blue" | "gromp-red" => Some((105, 156)),
        "krugs-blue" | "krugs-red" => Some((110, 162)),
        "scuttle-top" | "scuttle-bot" => Some((88, 132)),
        _ => None,
    }
}

pub(super) fn jungle_camp_cs_reward(key: &str) -> Option<i64> {
    match key {
        "blue-buff-blue" | "blue-buff-red" => Some(2),
        "red-buff-blue" | "red-buff-red" => Some(2),
        "wolves-blue" | "wolves-red" => Some(3),
        "raptors-blue" | "raptors-red" => Some(6),
        "gromp-blue" | "gromp-red" => Some(1),
        "krugs-blue" | "krugs-red" => Some(10),
        "scuttle-top" | "scuttle-bot" => Some(1),
        _ => None,
    }
}

pub(super) fn champion_kill_rewards(
    killer: &ChampionRuntime,
    victim: &ChampionRuntime,
) -> (i64, i64) {
    let level_gap = victim.level - killer.level;
    let victim_streak = (victim.kills - victim.deaths).max(0);
    let killer_ahead = (killer.kills - killer.deaths).max(0);
    let killer_kills = killer.kills.max(0);

    let mut gold = CHAMPION_KILL_GOLD + level_gap * 14 + victim_streak * 25;
    if killer_ahead >= 2 {
        gold -= ((killer_ahead - 1) * 24).min(160);
    }
    if killer_kills >= 6 {
        gold -= ((killer_kills - 5) * 10).min(70);
    }

    let mut xp = CHAMPION_KILL_XP + level_gap * 12 + victim_streak * 10;
    if killer_ahead >= 2 {
        xp -= ((killer_ahead - 1) * 12).min(96);
    }
    if killer_kills >= 6 {
        xp -= ((killer_kills - 5) * 6).min(42);
    }

    (
        gold.clamp(CHAMPION_KILL_GOLD_MIN, CHAMPION_KILL_GOLD_MAX),
        xp.clamp(CHAMPION_KILL_XP_MIN, CHAMPION_KILL_XP_MAX),
    )
}

/// Gold every living member of the team that kills Baron Nashor receives.
///
/// General game knowledge: the real game pays about 300 gold to each living
/// teammate. The previous model paid 60 gold to the single last hitter (ECON-002).
/// [PLACEHOLDER] pending playtest.
pub(super) const BARON_TEAM_GOLD: i64 = 300;

/// Gold every member of the team that destroys a turret receives, by tier.
///
/// The previous model paid nothing for towers (ECON-002). The real game splits
/// turret gold between a local share and a global team share; this model keeps
/// only the shared part so that pushing is rewarded evenly.
/// [PLACEHOLDER] pending playtest.
pub(super) fn tower_team_gold(structure_id: &str) -> i64 {
    if structure_id.ends_with("-outer") {
        125
    } else if structure_id.ends_with("-inner") {
        100
    } else {
        // Inhibitor towers and the two nexus towers.
        90
    }
}

/// Relative weight of a role's farm, kill and assist income (ECON-003).
///
/// The positional model lets the lane carries out-farm everyone else; these
/// weights pull the share of total team gold each role earns toward the usual
/// pro-play ranges (general knowledge, approximate): Top 20-23%, Jungle
/// 17-20%, Mid 21-24%, Bot 23-27%, Support 10-14%. Objective gold shared by the
/// whole team (Baron, towers) is not weighted. The weights are scaled so the
/// team total matches the unweighted economy: the raw per-role income shares
/// (about Top 26%, Jungle 15%, Mid 32%, Bot 17%, Support 9%) make the
/// income-weighted mean about 1.03, so the unscaled weights were divided by
/// that. A plain mean of 1.0 would cut team gold by about 14%.
///
/// Refit when the lane farming was made even: the solo laners now stand at the
/// wave and farm about twice as much, and the support no longer takes lane
/// minions from its ADC (about 70% of its early income), so its weight carries
/// its share through kills and assists. At weight 1.0 the 12-minute shares are
/// Top 31%, Jungle 13%, Mid 26%, Bot 25%, Support 5%.
/// [PLACEHOLDER] pending playtest.
pub(super) fn role_income_weight(role: &str) -> f64 {
    match role {
        "TOP" => 0.760,
        "JGL" => 1.278,
        "MID" => 0.641,
        "ADC" => 1.388,
        "SUP" => 1.700,
        _ => 1.0,
    }
}

/// `gold` scaled by the role's income weight and rounded to whole gold.
pub(super) fn role_adjusted_income(role: &str, gold: i64) -> i64 {
    ((gold as f64) * role_income_weight(role)).round() as i64
}
