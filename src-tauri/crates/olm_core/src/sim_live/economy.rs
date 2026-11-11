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

/// Relative weight of a role's farm: lane minions at their last hit and jungle camps.
///
/// Kills, assists, objectives and the passive income pay the same whatever the role, so the
/// weights only shape the farm. They pull the share of the team's gold each role earns toward
/// the usual pro-play ranges (general knowledge, approximate): Top 20-23%, Jungle 17-20%,
/// Mid 21-24%, Bot 23-27%, Support 10-14%. The support takes no minions (he leaves them to his
/// ADC), so his share comes from the passive income and his item. At weight 1.0 the
/// 12-minute shares are Top 24%, Jungle 18%, Mid 20%, Bot 23%, Support 14%; the weights move
/// Top down and Bot up, and are kept close to 1.0 so that the team total stays at the unweighted
/// baseline (`economy_tests::role_weights_keep_team_gold_at_the_unweighted_baseline`).
/// [PLACEHOLDER] pending playtest.
pub(super) fn role_income_weight(role: &str) -> f64 {
    match role {
        "TOP" => 0.850,
        "JGL" => 1.000,
        "MID" => 1.000,
        "ADC" => 1.250,
        "SUP" => 1.000,
        _ => 1.0,
    }
}

/// Seconds into the match at which every player starts to earn passive gold.
pub(super) const PASSIVE_GOLD_START_SEC: f64 = 110.0;
/// Seconds between two payments of passive gold.
pub(super) const PASSIVE_GOLD_PERIOD_SEC: f64 = 10.0;
/// Gold of one payment: 1 gold per second, the same for every role and paid while dead
/// (the real game pays about 2 per second; here it is half of it, with the minions
/// worth less to match). [PLACEHOLDER] pending playtest.
pub(super) const PASSIVE_GOLD_PER_PAYMENT: i64 = 10;
/// Extra gold of one payment for the support: his item pays him for staying beside his
/// ADC instead of taking the minions. [PLACEHOLDER] pending playtest.
pub(super) const SUPPORT_ITEM_GOLD_PER_PAYMENT: i64 = 10;

/// How many passive payments the match has made by `time_sec`.
pub(super) fn passive_payments_due(time_sec: f64) -> i64 {
    if time_sec < PASSIVE_GOLD_START_SEC {
        return 0;
    }
    ((time_sec - PASSIVE_GOLD_START_SEC) / PASSIVE_GOLD_PERIOD_SEC).floor() as i64 + 1
}

/// Gold one passive payment gives a player of `role`.
pub(super) fn passive_payment(role: &str) -> i64 {
    if role == "SUP" {
        PASSIVE_GOLD_PER_PAYMENT + SUPPORT_ITEM_GOLD_PER_PAYMENT
    } else {
        PASSIVE_GOLD_PER_PAYMENT
    }
}

/// `gold` scaled by the role's income weight and rounded to whole gold.
pub(super) fn role_adjusted_income(role: &str, gold: i64) -> i64 {
    ((gold as f64) * role_income_weight(role)).round() as i64
}
