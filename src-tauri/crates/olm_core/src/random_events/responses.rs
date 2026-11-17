use super::SPONSOR_OFFER_MONTHS;
use crate::finances::{format_exact, push_sponsor_offer_signed_mail};
use crate::game::Game;
use rand::RngExt;

fn parse_sponsor_amount(raw: &str) -> Option<u64> {
    let compact = raw.trim().replace([',', '€'], "");
    if compact.is_empty() {
        return None;
    }

    if compact.ends_with('K') || compact.ends_with('k') {
        let value = compact[..compact.len().saturating_sub(1)]
            .trim()
            .parse::<f64>()
            .ok()?;
        return Some((value * 1_000.0).round() as u64);
    }

    if compact.ends_with('M') || compact.ends_with('m') {
        let value = compact[..compact.len().saturating_sub(1)]
            .trim()
            .parse::<f64>()
            .ok()?;
        return Some((value * 1_000_000.0).round() as u64);
    }

    compact.parse::<u64>().ok()
}

/// Apply the effect of a sponsor offer choice.
pub fn apply_event_response(
    game: &mut Game,
    message_id: &str,
    _action_id: &str,
    option_id: &str,
) -> Option<String> {
    if message_id.starts_with("sponsor_") {
        let user_team_id = game.manager.team_id.clone()?;
        match option_id {
            "accept" => {
                let offer = game.messages.iter().find(|m| m.id == message_id);
                // New offers carry the exact yearly value; offers saved before the
                // monthly headline only have the rounded `amount` text.
                let amount = offer
                    .and_then(|m| m.i18n_params.get("annualValue"))
                    .and_then(|a| a.parse::<u64>().ok())
                    .or_else(|| {
                        offer
                            .and_then(|m| m.i18n_params.get("amount"))
                            .and_then(|a| parse_sponsor_amount(a))
                    })
                    .unwrap_or(35_000);
                let sponsor_name = offer
                    .and_then(|m| m.i18n_params.get("sponsor"))
                    .cloned()
                    .unwrap_or_else(|| "Sponsor".to_string());
                let mut monthly = amount as i64 / 12;
                if let Some(team) = game.teams.iter_mut().find(|t| t.id == user_team_id) {
                    monthly = super::sponsor_offer_monthly_payment(team, &sponsor_name, amount as i64);
                    team.sponsorship = Some(super::sponsor_offer_deal(&sponsor_name, amount as i64));
                }
                let today = game.clock.current_date.format("%Y-%m-%d").to_string();
                push_sponsor_offer_signed_mail(
                    game,
                    &user_team_id,
                    &sponsor_name,
                    monthly,
                    SPONSOR_OFFER_MONTHS,
                    &today,
                );
                // Mark resolved
                if let Some(msg) = game.messages.iter_mut().find(|m| m.id == message_id) {
                    for a in msg.actions.iter_mut() {
                        a.resolved = true;
                    }
                }
                Some(format!(
                    "Sponsorship deal signed! You will receive €{} per month for {} months (€{} in total).",
                    format_exact(monthly),
                    SPONSOR_OFFER_MONTHS,
                    format_exact(monthly * i64::from(SPONSOR_OFFER_MONTHS))
                ))
            }
            "decline" => {
                if let Some(msg) = game.messages.iter_mut().find(|m| m.id == message_id) {
                    for a in msg.actions.iter_mut() {
                        a.resolved = true;
                    }
                }
                Some("Sponsorship declined.".to_string())
            }
            _ => None,
        }
    } else if message_id.starts_with("board_confidence_") {
        match option_id {
            "reassure_board" => {
                if let Some(msg) = game.messages.iter_mut().find(|m| m.id == message_id) {
                    for a in msg.actions.iter_mut() {
                        a.resolved = true;
                    }
                }
                Some("You reassured the board. They'll give you more time — for now.".to_string())
            }
            "accept_pressure" => {
                if let Some(msg) = game.messages.iter_mut().find(|m| m.id == message_id) {
                    for a in msg.actions.iter_mut() {
                        a.resolved = true;
                    }
                }
                Some(
                    "You acknowledged the pressure. The board appreciates your honesty."
                        .to_string(),
                )
            }
            "blame_circumstances" => {
                if let Some(msg) = game.messages.iter_mut().find(|m| m.id == message_id) {
                    for a in msg.actions.iter_mut() {
                        a.resolved = true;
                    }
                }
                Some(
                    "The board isn't entirely convinced by excuses, but they'll wait and see."
                        .to_string(),
                )
            }
            _ => None,
        }
    } else if message_id.starts_with("fan_petition_") {
        match option_id {
            "listen_fans" => {
                // Small morale boost across squad
                let user_team_id = game.manager.team_id.clone().unwrap_or_default();
                let mut rng = rand::rng();
                for p in game.players.iter_mut() {
                    if p.team_id.as_deref() == Some(&user_team_id) {
                        p.morale = (p.morale as i16 + rng.random_range(1..=3)).clamp(10, 100) as u8;
                    }
                }
                if let Some(msg) = game.messages.iter_mut().find(|m| m.id == message_id) {
                    for a in msg.actions.iter_mut() {
                        a.resolved = true;
                    }
                }
                Some("You engaged with the fans. Squad morale improved slightly.".to_string())
            }
            "ignore_fans" => {
                if let Some(msg) = game.messages.iter_mut().find(|m| m.id == message_id) {
                    for a in msg.actions.iter_mut() {
                        a.resolved = true;
                    }
                }
                Some(
                    "You decided to focus on competitive matters. The fans are a little disappointed."
                        .to_string(),
                )
            }
            "address_publicly" => {
                if let Some(msg) = game.messages.iter_mut().find(|m| m.id == message_id) {
                    for a in msg.actions.iter_mut() {
                        a.resolved = true;
                    }
                }
                Some("Your public address was well received. Fan confidence is up.".to_string())
            }
            _ => None,
        }
    } else if message_id.starts_with("rival_interest_") {
        let player_id = game
            .messages
            .iter()
            .find(|m| m.id == message_id)
            .and_then(|m| m.context.player_id.clone());
        match option_id {
            "not_for_sale" => {
                // Player morale boost — they feel valued
                if let Some(pid) = &player_id
                    && let Some(p) = game.players.iter_mut().find(|p| p.id == *pid)
                {
                    let mut rng = rand::rng();
                    p.morale = (p.morale as i16 + rng.random_range(3..=8)).clamp(10, 100) as u8;
                }
                if let Some(msg) = game.messages.iter_mut().find(|m| m.id == message_id) {
                    for a in msg.actions.iter_mut() {
                        a.resolved = true;
                    }
                }
                Some(
                    "You made it clear the player is not for sale. They're feeling valued."
                        .to_string(),
                )
            }
            "open_to_offers" => {
                // Player morale drop — they feel uncertain
                if let Some(pid) = &player_id
                    && let Some(p) = game.players.iter_mut().find(|p| p.id == *pid)
                {
                    let mut rng = rand::rng();
                    p.morale = (p.morale as i16 - rng.random_range(3..=8)).clamp(10, 100) as u8;
                }
                if let Some(msg) = game.messages.iter_mut().find(|m| m.id == message_id) {
                    for a in msg.actions.iter_mut() {
                        a.resolved = true;
                    }
                }
                Some("You indicated you'd listen to offers. The player is unsettled.".to_string())
            }
            "no_comment" => {
                if let Some(msg) = game.messages.iter_mut().find(|m| m.id == message_id) {
                    for a in msg.actions.iter_mut() {
                        a.resolved = true;
                    }
                }
                Some("No comment. The rumour mill continues...".to_string())
            }
            _ => None,
        }
    } else {
        None
    }
}
