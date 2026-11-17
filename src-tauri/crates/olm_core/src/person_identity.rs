//! Name folding for deciding whether two records name the same person.
//!
//! The catalog ships one person under several spellings: the nick and the real name swap
//! places between files, a "(real name)" trails the nick, accents come and go, and a few
//! overlay names carry a literal `&nbsp;`. Every identity check folds names through
//! [`fold_name`] so those spellings compare equal.

use crate::domain::player::Player;

/// Decode the HTML entities the data is known to carry. Anything unknown is left as is.
fn decode_entities(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut rest = raw;
    while let Some(start) = rest.find('&') {
        out.push_str(&rest[..start]);
        let tail = &rest[start..];
        let decoded = tail
            .find(';')
            .filter(|end| *end <= 8)
            .and_then(|end| decode_entity(&tail[1..end]).map(|text| (text, end)));
        match decoded {
            Some((text, end)) => {
                out.push_str(&text);
                rest = &tail[end + 1..];
            }
            None => {
                out.push('&');
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn decode_entity(name: &str) -> Option<String> {
    let text = match name {
        "nbsp" => " ".to_string(),
        "amp" => "&".to_string(),
        "quot" => "\"".to_string(),
        "apos" => "'".to_string(),
        "lt" => "<".to_string(),
        "gt" => ">".to_string(),
        numeric => {
            let digits = numeric.strip_prefix('#')?;
            let code = match digits.strip_prefix(['x', 'X']) {
                Some(hex) => u32::from_str_radix(hex, 16).ok()?,
                None => digits.parse().ok()?,
            };
            char::from_u32(code)?.to_string()
        }
    };
    Some(text)
}

/// Remove every parenthesised part: "Ace (Ignacio David Piaggio)" is the nick "Ace". A name
/// that is nothing but a parenthesis keeps its text.
fn strip_parenthesised(name: &str) -> String {
    let mut depth = 0usize;
    let stripped: String = name
        .chars()
        .filter(|c| match c {
            '(' => {
                depth += 1;
                false
            }
            ')' => {
                depth = depth.saturating_sub(1);
                false
            }
            _ => depth == 0,
        })
        .collect();
    if stripped.trim().is_empty() {
        name.to_string()
    } else {
        stripped
    }
}

fn fold_char(c: char) -> char {
    match c {
        'á' | 'à' | 'â' | 'ã' | 'ä' | 'å' | 'ā' | 'ă' | 'ą' => 'a',
        'ç' | 'ć' | 'č' | 'ĉ' | 'ċ' => 'c',
        'ď' | 'đ' => 'd',
        'é' | 'è' | 'ê' | 'ë' | 'ē' | 'ė' | 'ę' | 'ě' => 'e',
        'ğ' | 'ĝ' | 'ģ' => 'g',
        'í' | 'ì' | 'î' | 'ï' | 'ī' | 'į' | 'ı' => 'i',
        'ł' | 'ĺ' | 'ľ' => 'l',
        'ñ' | 'ń' | 'ň' | 'ņ' => 'n',
        'ó' | 'ò' | 'ô' | 'õ' | 'ö' | 'ø' | 'ō' | 'ő' => 'o',
        'ř' | 'ŕ' => 'r',
        'š' | 'ś' | 'ş' | 'ș' => 's',
        'ť' | 'ţ' | 'ț' => 't',
        'ú' | 'ù' | 'û' | 'ü' | 'ū' | 'ů' | 'ű' | 'ų' => 'u',
        'ý' | 'ÿ' => 'y',
        'ž' | 'ź' | 'ż' => 'z',
        other => other,
    }
}

/// How many whitespace-separated words a name has once entities are decoded and any
/// parenthesised part is removed: "Ace (Ignacio David Piaggio)" is one, "Pau Vintró Nogué" is
/// three. A one-word name is a nick or a first name; it says little about who the person is.
pub fn name_words(name: &str) -> usize {
    strip_parenthesised(&decode_entities(name))
        .split_whitespace()
        .count()
}

/// A name folded for identity checks: HTML entities decoded, parenthesised parts removed,
/// lowercase, accents dropped, and only letters and digits kept. "Víctor (Real Name)",
/// "victor" and "V-ictor" agree.
pub fn fold_name(name: &str) -> String {
    let decoded = decode_entities(name);
    strip_parenthesised(&decoded)
        .chars()
        .flat_map(char::to_lowercase)
        .map(fold_char)
        .filter(|c| c.is_alphanumeric())
        .collect()
}

/// The distinct non-empty folded names of a record: its match name and its full name.
pub fn folded_names(player: &Player) -> Vec<String> {
    let mut names = Vec::with_capacity(2);
    for raw in [&player.match_name, &player.full_name] {
        let folded = fold_name(raw);
        if !folded.is_empty() && !names.contains(&folded) {
            names.push(folded);
        }
    }
    names
}

/// The folded names of a record that are made of two or more words: a real name rather than
/// a nick. The match name and the full name swap places between files, so both are checked.
pub fn folded_real_names(player: &Player) -> Vec<String> {
    let mut names = Vec::with_capacity(2);
    for raw in [&player.match_name, &player.full_name] {
        let folded = fold_name(raw);
        if name_words(raw) >= 2 && !folded.is_empty() && !names.contains(&folded) {
            names.push(folded);
        }
    }
    names
}

/// Whether every one of the nine attributes is 0: a placeholder row with no rating data.
pub fn has_all_attributes_zero(player: &Player) -> bool {
    let a = &player.attributes;
    [
        a.mechanics,
        a.laning,
        a.teamfighting,
        a.macro_play,
        a.consistency,
        a.shotcalling,
        a.champion_pool,
        a.discipline,
        a.mental_resilience,
    ]
    .iter()
    .all(|value| *value == 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::player::PlayerAttributes;
    use crate::domain::stats::LolRole;

    fn named(match_name: &str, full_name: &str) -> Player {
        Player::new(
            "p".into(),
            match_name.into(),
            full_name.into(),
            "2000-01-01".into(),
            "KR".into(),
            LolRole::Mid,
            PlayerAttributes::default(),
        )
    }

    #[test]
    fn a_trailing_real_name_is_not_part_of_the_nick() {
        assert_eq!(fold_name("Ace (Ignacio David Piaggio)"), "ace");
    }

    #[test]
    fn accents_case_and_punctuation_fold_away() {
        assert_eq!(fold_name("Víctor"), fold_name("victor"));
        assert_eq!(fold_name("Z-ephyr "), "zephyr");
    }

    #[test]
    fn html_entities_are_decoded_before_folding() {
        assert_eq!(fold_name("Papiteero&nbsp;"), "papiteero");
        assert_eq!(fold_name("Bugi&nbsp;Real"), "bugireal");
        assert_eq!(fold_name("A&amp;B"), "ab");
        assert_eq!(fold_name("Caf&#233;"), "cafe");
    }

    #[test]
    fn an_unknown_entity_keeps_its_letters() {
        assert_eq!(fold_name("R&D"), "rd");
    }

    #[test]
    fn a_name_that_is_only_a_parenthesis_keeps_its_text() {
        assert_eq!(fold_name("(Solo)"), "solo");
    }

    #[test]
    fn real_names_need_two_words_and_ignore_a_parenthesis() {
        assert_eq!(name_words("Ace (Ignacio David Piaggio)"), 1);
        assert_eq!(name_words("Antero&nbsp;Trindade Baldaia"), 3);
        let swapped = named("Luis Pérez García", "Koldo");
        assert_eq!(folded_real_names(&swapped), vec!["luisperezgarcia"]);
        assert!(folded_real_names(&named("Kevin", "Kevin")).is_empty());
    }

    #[test]
    fn folded_names_lists_both_names_once() {
        assert_eq!(folded_names(&named("Dinai", "Hwang Chi-hyeon")).len(), 2);
        assert_eq!(folded_names(&named("Winner", "winner")), vec!["winner"]);
    }

    #[test]
    fn zero_attributes_are_detected_only_when_all_nine_are_zero() {
        let mut shell = named("Dome", "Dome");
        shell.attributes = PlayerAttributes {
            mechanics: 0,
            laning: 0,
            teamfighting: 0,
            macro_play: 0,
            consistency: 0,
            shotcalling: 0,
            champion_pool: 0,
            discipline: 0,
            mental_resilience: 0,
        };
        assert!(has_all_attributes_zero(&shell));
        shell.attributes.laning = 1;
        assert!(!has_all_attributes_zero(&shell));
    }
}
