//! Regression tests for the incoming transfer offer inbox message when the
//! message template store is loaded (the production path).

use olm_core::domain::message::{ActionType, InboxMessage};
use olm_core::messages;
use olm_core::messages::template_store::init_template_store;
use std::sync::Once;

/// Mirrors `data/messages/triggers/transfer/offer.json`, which only carries an
/// acknowledge action and writes the currency symbol itself (`€{fee}`).
const OFFER_TEMPLATE: &str = r#"{
  "id": "transfer_offer",
  "trigger": "transfer_offer",
  "weight": 1,
  "sender": "director_of_football",
  "category": "Transfer",
  "priority": "High",
  "actions": [
    { "type": "acknowledge", "label": "OK", "label_key": "be.msg.action.acknowledge" }
  ],
  "subject": "Transfer offer received for {player}",
  "body": "{buyer} has submitted an offer for {player}.\n\nThe proposed fee is €{fee}.",
  "translations": {
    "es": {
      "subject": "Oferta de traspaso recibida por {player}",
      "body": "{buyer} ha presentado una oferta por {player}.\n\nLa cantidad propuesta es de €{fee}."
    }
  }
}"#;

fn load_templates() {
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        let dir = std::env::temp_dir().join(format!("olm_offer_tpl_{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("create template dir");
        std::fs::write(dir.join("offer.json"), OFFER_TEMPLATE).expect("write template");
        init_template_store(&dir).expect("init template store");
    });
}

fn offer_message(fee: u64) -> InboxMessage {
    load_templates();
    messages::incoming_transfer_offer_message(
        "o1",
        "p1",
        "ToniOP",
        "Fnatic",
        fee,
        "2027-01-10",
    )
}

#[test]
fn offer_message_links_to_the_offers_view() {
    let msg = offer_message(172_000);
    let nav = msg
        .actions
        .iter()
        .find(|a| matches!(a.action_type, ActionType::NavigateTo { .. }))
        .expect("offer message should carry a navigate action");
    assert_eq!(nav.label, "View offer");
    assert_eq!(nav.label_key.as_deref(), Some("be.msg.transferOffer.actionView"));
    match &nav.action_type {
        ActionType::NavigateTo { route } => {
            assert_eq!(route, "/dashboard?tab=Transfers&view=offers")
        }
        other => panic!("unexpected action type {other:?}"),
    }
}

#[test]
fn offer_message_keeps_the_acknowledge_action() {
    let msg = offer_message(172_000);
    assert!(msg
        .actions
        .iter()
        .any(|a| matches!(a.action_type, ActionType::Acknowledge)));
}
