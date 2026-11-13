use serde_json::Value;

use super::{
    EVENT_CAP, EventCode, EventData, RuntimeEvent, RuntimeState, SKIP_FAST_MODE_EXTRA_KEY,
};

/// An event with its stable code and data next to the English line.
pub fn push_coded_event(
    events: &mut Vec<RuntimeEvent>,
    at: f64,
    text: &str,
    kind: &str,
    code: EventCode,
    data: EventData,
) {
    push_event_with(events, at, text, kind, Some(code), data);
}

fn push_event_with(
    events: &mut Vec<RuntimeEvent>,
    at: f64,
    text: &str,
    kind: &str,
    code: Option<EventCode>,
    data: EventData,
) {
    events.push(RuntimeEvent {
        t: at,
        text: text.to_string(),
        kind: kind.to_string(),
        code,
        data,
    });

    if events.len() > EVENT_CAP {
        let drain = events.len() - EVENT_CAP;
        events.drain(0..drain);
    }
}

pub fn log_event(runtime: &mut RuntimeState, text: &str, kind: &str) {
    log_event_with(runtime, text, kind, None, EventData::default());
}

pub fn log_coded_event(
    runtime: &mut RuntimeState,
    text: &str,
    kind: &str,
    code: EventCode,
    data: EventData,
) {
    log_event_with(runtime, text, kind, Some(code), data);
}

fn log_event_with(
    runtime: &mut RuntimeState,
    text: &str,
    kind: &str,
    code: Option<EventCode>,
    data: EventData,
) {
    if runtime_is_skip_fast_mode(runtime)
        && !matches!(kind, "kill" | "tower" | "dragon" | "baron" | "nexus")
    {
        return;
    }
    push_event_with(&mut runtime.events, runtime.time_sec, text, kind, code, data);
}

fn runtime_is_skip_fast_mode(runtime: &RuntimeState) -> bool {
    runtime
        .extra
        .get(SKIP_FAST_MODE_EXTRA_KEY)
        .and_then(Value::as_bool)
        .unwrap_or(false)
}
