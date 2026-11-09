//! Identity of the founding squad: edit overrides, the validation rules and the
//! in-game rename.
//!
//! A custom club's five generated founders can have their identity edited: nick
//! (`match_name`), full name, nationality and birth date. Stats, role and hidden
//! potential stay locked. Every rule lives here so the creation wizard, the
//! preview and the in-game rename agree:
//!
//! | field | rule |
//! |---|---|
//! | nick | 2-16 chars, letters, digits and `_ . -`, trimmed |
//! | full name | 2-40 chars, letters, spaces and `' -`, NFC, trimmed, spaces collapsed |
//! | nick and full name | unique world-wide (case and accent insensitive), released players included |
//! | nationality | an ISO-2 code of the competition region (never an import) |
//! | birth date | ISO `YYYY-MM-DD`, aged 19-27 on the game start date |
//!
//! # Errors on the wire
//!
//! Commands return `Result<_, String>`. A [`FounderError`] travels as the JSON of
//! [`FounderError::to_wire`], for example
//! `{"kind":"invalid_field","role":"TOP","field":"nick","reason":"too_short"}`.
//! Frontends parse an error string that starts with `{`, switch on `kind`, and
//! map `role` + `field` to the input and `reason` to the message. Any other
//! string is a generic error.
//!
//! # Unicode
//!
//! There is no Unicode normalization crate in the build, so NFC composition and
//! accent folding use a table of the Latin-1 and Latin Extended-A letters. A
//! combining mark that cannot be composed into one of those letters is rejected
//! as an invalid character; a letter outside the table is accepted as written
//! and compared case-insensitively only. Digits are ASCII digits only.

use std::collections::HashSet;
use std::fmt;
use std::ops::RangeInclusive;

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
#[cfg(feature = "typescript")]
use ts_rs::TS;

use crate::domain::player::Player;
use crate::domain::stats::LolRole;
use crate::game::Game;
use crate::squad_generator::{AGE_RANGE, FOUNDER_ID_PREFIX, full_years_between, reprice_player};

/// Nick length bounds, in characters, after normalization.
pub const NICK_LEN: RangeInclusive<usize> = 2..=16;
/// Full name length bounds, in characters, after normalization.
pub const FULL_NAME_LEN: RangeInclusive<usize> = 2..=40;

/// Optional identity edits for one founder; every field may be left out.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS))]
#[cfg_attr(feature = "typescript", ts(export))]
pub struct FounderIdentityOverride {
    /// New nick (`match_name`).
    #[serde(default)]
    #[cfg_attr(feature = "typescript", ts(optional))]
    pub nick: Option<String>,
    /// New full name.
    #[serde(default)]
    #[cfg_attr(feature = "typescript", ts(optional))]
    pub full_name: Option<String>,
    /// New nationality, an ISO-2 code of the competition region.
    #[serde(default)]
    #[cfg_attr(feature = "typescript", ts(optional))]
    pub nationality: Option<String>,
    /// New birth date as `YYYY-MM-DD`.
    #[serde(default)]
    #[cfg_attr(feature = "typescript", ts(optional))]
    pub birth_date: Option<String>,
}

/// Identity edits per role. A role left out keeps its generated identity.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(TS))]
#[cfg_attr(feature = "typescript", ts(export))]
pub struct FounderOverrides {
    /// Edits for the top laner.
    #[serde(default)]
    #[cfg_attr(feature = "typescript", ts(optional))]
    pub top: Option<FounderIdentityOverride>,
    /// Edits for the jungler.
    #[serde(default)]
    #[cfg_attr(feature = "typescript", ts(optional))]
    pub jungle: Option<FounderIdentityOverride>,
    /// Edits for the mid laner.
    #[serde(default)]
    #[cfg_attr(feature = "typescript", ts(optional))]
    pub mid: Option<FounderIdentityOverride>,
    /// Edits for the bot laner.
    #[serde(default)]
    #[cfg_attr(feature = "typescript", ts(optional))]
    pub adc: Option<FounderIdentityOverride>,
    /// Edits for the support.
    #[serde(default)]
    #[cfg_attr(feature = "typescript", ts(optional))]
    pub support: Option<FounderIdentityOverride>,
}

impl FounderOverrides {
    /// The edits for `role`, if any.
    pub fn for_role(&self, role: LolRole) -> Option<&FounderIdentityOverride> {
        match role {
            LolRole::Top => self.top.as_ref(),
            LolRole::Jungle => self.jungle.as_ref(),
            LolRole::Mid => self.mid.as_ref(),
            LolRole::Adc => self.adc.as_ref(),
            LolRole::Support => self.support.as_ref(),
            LolRole::Unknown => None,
        }
    }

    /// Whether no role carries any edit.
    pub fn is_empty(&self) -> bool {
        [&self.top, &self.jungle, &self.mid, &self.adc, &self.support]
            .iter()
            .all(|slot| slot.is_none())
    }
}

/// The identity field an error is about.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FounderField {
    /// The nick (`match_name`).
    Nick,
    /// The full name.
    FullName,
    /// The nationality.
    Nationality,
    /// The birth date.
    BirthDate,
}

/// Why a value was rejected.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FounderEditReason {
    /// Nothing left after trimming.
    Empty,
    /// Fewer characters than the minimum.
    TooShort,
    /// More characters than the maximum.
    TooLong,
    /// A character the field does not allow (emoji, control, punctuation).
    InvalidCharacter,
    /// Another player in the world already has this nick or full name.
    Taken,
    /// The nationality is not a resident code of the competition region.
    NotInRegion,
    /// The birth date is not a valid `YYYY-MM-DD` date.
    InvalidDate,
    /// The player would be under 19 on the game start date.
    TooYoung,
    /// The player would be over 27 on the game start date.
    TooOld,
}

/// A rejected edit: which founder, which field and why.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct FounderEditError {
    /// Role of the founder the edit was for.
    pub role: LolRole,
    /// Field that was rejected.
    pub field: FounderField,
    /// Reason it was rejected.
    pub reason: FounderEditReason,
}

impl fmt::Display for FounderEditError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{:?} founder {:?} rejected: {:?}",
            self.role, self.field, self.reason
        )
    }
}

impl std::error::Error for FounderEditError {}

/// Every way a founder command can fail; serialized as the wire error.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FounderError {
    /// A field failed validation.
    InvalidField(FounderEditError),
    /// No player has this id.
    PlayerNotFound {
        /// The id that was asked for.
        player_id: String,
    },
    /// Only the user club's founders can be renamed.
    NotAFounder {
        /// The id that was asked for.
        player_id: String,
    },
    /// A rename with neither a nick nor a full name.
    NothingToChange,
}

impl FounderError {
    /// The JSON string commands put in their `Err`; see the module docs.
    pub fn to_wire(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| self.to_string())
    }
}

impl fmt::Display for FounderError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidField(error) => write!(f, "{error}"),
            Self::PlayerNotFound { player_id } => write!(f, "player '{player_id}' was not found"),
            Self::NotAFounder { player_id } => {
                write!(f, "player '{player_id}' is not a founder of your club")
            }
            Self::NothingToChange => write!(f, "a rename needs a nick or a full name"),
        }
    }
}

impl std::error::Error for FounderError {}

impl From<FounderEditError> for FounderError {
    fn from(error: FounderEditError) -> Self {
        Self::InvalidField(error)
    }
}

// ---------------------------------------------------------------------------
// Unicode: NFC composition and accent folding for the Latin letters
// ---------------------------------------------------------------------------

fn is_combining_mark(c: char) -> bool {
    ('\u{0300}'..='\u{036F}').contains(&c)
}

/// The letter `base` + `mark` compose to, if the table knows it.
fn compose_pair(base: char, mark: char) -> Option<char> {
    LATIN_DECOMPOSITIONS
        .iter()
        .find(|(_, table_base, table_mark)| *table_base == base && *table_mark == mark)
        .map(|(composed, _, _)| *composed)
}

/// NFC for the supported letters: a base letter followed by combining marks
/// becomes the precomposed letter. Marks that do not compose stay in the text.
fn compose(text: &str) -> String {
    let mut out: Vec<char> = Vec::with_capacity(text.len());
    for c in text.chars() {
        let composed = is_combining_mark(c)
            .then(|| out.last().and_then(|last| compose_pair(*last, c)))
            .flatten();
        match (composed, out.last_mut()) {
            (Some(letter), Some(last)) => *last = letter,
            _ => out.push(c),
        }
    }
    out.into_iter().collect()
}

/// Appends the case- and accent-folded form of `c` to `out`.
fn fold_char_into(c: char, out: &mut String) {
    if c.is_ascii() {
        out.push(c.to_ascii_lowercase());
        return;
    }
    for lower in c.to_lowercase() {
        let mut letter = lower;
        while let Some((_, base, _)) = LATIN_DECOMPOSITIONS
            .iter()
            .find(|(composed, _, _)| *composed == letter)
        {
            letter = *base;
        }
        match letter {
            'ø' => out.push('o'),
            'ł' => out.push('l'),
            'đ' | 'ð' => out.push('d'),
            'ħ' => out.push('h'),
            'ı' => out.push('i'),
            'ß' => out.push_str("ss"),
            'æ' => out.push_str("ae"),
            'œ' => out.push_str("oe"),
            'þ' => out.push_str("th"),
            mark if is_combining_mark(mark) => {}
            other => out.push(other),
        }
    }
}

/// Comparison key of a name: lowercase with the accents of the supported
/// letters removed, so `Ñandú` and `nandu` collide.
pub fn fold_key(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        fold_char_into(c, &mut out);
    }
    out
}

// ---------------------------------------------------------------------------
// Field rules
// ---------------------------------------------------------------------------

fn check_length(text: &str, bounds: &RangeInclusive<usize>) -> Result<(), FounderEditReason> {
    let count = text.chars().count();
    if count < *bounds.start() {
        Err(FounderEditReason::TooShort)
    } else if count > *bounds.end() {
        Err(FounderEditReason::TooLong)
    } else {
        Ok(())
    }
}

/// Normalizes and validates a nick: trimmed, NFC, 2-16 letters, digits or
/// `_ . -`. Uniqueness is the caller's check.
pub fn normalize_nick(raw: &str) -> Result<String, FounderEditReason> {
    let text = compose(raw).trim().to_string();
    if text.is_empty() {
        return Err(FounderEditReason::Empty);
    }
    let allowed = |c: char| c.is_alphabetic() || c.is_ascii_digit() || matches!(c, '_' | '.' | '-');
    if !text.chars().all(allowed) {
        return Err(FounderEditReason::InvalidCharacter);
    }
    check_length(&text, &NICK_LEN)?;
    Ok(text)
}

/// Normalizes and validates a full name: trimmed, NFC, runs of spaces
/// collapsed, 2-40 letters, spaces, `'` or `-`. Uniqueness is the caller's check.
pub fn normalize_full_name(raw: &str) -> Result<String, FounderEditReason> {
    let text = compose(raw).trim().to_string();
    if text.is_empty() {
        return Err(FounderEditReason::Empty);
    }
    let allowed = |c: char| c.is_alphabetic() || matches!(c, ' ' | '\'' | '-');
    if !text.chars().all(allowed) {
        return Err(FounderEditReason::InvalidCharacter);
    }
    let collapsed = text
        .split(' ')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    check_length(&collapsed, &FULL_NAME_LEN)?;
    Ok(collapsed)
}

/// Validates a nationality against the region's codes and returns it as the
/// uppercase code.
pub fn validate_nationality(
    raw: &str,
    region_codes: &[String],
) -> Result<String, FounderEditReason> {
    let code = raw.trim().to_ascii_uppercase();
    if code.is_empty() {
        return Err(FounderEditReason::Empty);
    }
    if region_codes.contains(&code) {
        Ok(code)
    } else {
        Err(FounderEditReason::NotInRegion)
    }
}

/// Validates a birth date: strict ISO `YYYY-MM-DD`, aged 19-27 on `today`.
pub fn validate_birth_date(raw: &str, today: NaiveDate) -> Result<String, FounderEditReason> {
    let text = raw.trim();
    if text.is_empty() {
        return Err(FounderEditReason::Empty);
    }
    let date = NaiveDate::parse_from_str(text, "%Y-%m-%d")
        .ok()
        .filter(|date| date.format("%Y-%m-%d").to_string() == text)
        .ok_or(FounderEditReason::InvalidDate)?;
    let age = full_years_between(today, date);
    if age < *AGE_RANGE.start() {
        Err(FounderEditReason::TooYoung)
    } else if age > *AGE_RANGE.end() {
        Err(FounderEditReason::TooOld)
    } else {
        Ok(text.to_string())
    }
}

// ---------------------------------------------------------------------------
// World name index
// ---------------------------------------------------------------------------

/// Folded nicks and full names already in use, for the uniqueness rule.
#[derive(Debug, Clone, Default)]
pub struct NameIndex {
    nicks: HashSet<String>,
    full_names: HashSet<String>,
}

impl NameIndex {
    /// Index of `players`.
    pub fn from_players<'a>(players: impl IntoIterator<Item = &'a Player>) -> Self {
        let mut index = Self::default();
        for player in players {
            index.nicks.insert(fold_key(&player.match_name));
            index.full_names.insert(fold_key(&player.full_name));
        }
        index
    }

    /// Whether another player already has this nick.
    pub fn nick_taken(&self, nick: &str) -> bool {
        self.nicks.contains(&fold_key(nick))
    }

    /// Whether another player already has this full name.
    pub fn full_name_taken(&self, full_name: &str) -> bool {
        self.full_names.contains(&fold_key(full_name))
    }
}

/// Everything the edit rules need besides the squad.
#[derive(Debug, Clone, Copy)]
pub struct EditContext<'a> {
    /// Game start date, for ages and repricing.
    pub today: NaiveDate,
    /// ISO-2 codes of the competition region.
    pub region_codes: &'a [String],
    /// Names already in the world (the founders are not part of it).
    pub world: &'a NameIndex,
}

// ---------------------------------------------------------------------------
// Applying overrides
// ---------------------------------------------------------------------------

/// Validated, normalized edits for one founder.
#[derive(Default)]
struct ValidatedEdit {
    nick: Option<String>,
    full_name: Option<String>,
    nationality: Option<String>,
    birth_date: Option<String>,
}

fn validate_edit(
    squad: &[Player],
    index: usize,
    edit: &FounderIdentityOverride,
    context: &EditContext<'_>,
) -> Result<ValidatedEdit, FounderEditError> {
    let role = squad[index].natural_position;
    let fail = |field, reason| FounderEditError {
        role,
        field,
        reason,
    };
    let others = || {
        squad
            .iter()
            .enumerate()
            .filter(move |(other, _)| *other != index)
            .map(|(_, player)| player)
    };
    let mut validated = ValidatedEdit::default();

    if let Some(raw) = &edit.nick {
        let nick = normalize_nick(raw).map_err(|reason| fail(FounderField::Nick, reason))?;
        let key = fold_key(&nick);
        if context.world.nick_taken(&nick) || others().any(|p| fold_key(&p.match_name) == key) {
            return Err(fail(FounderField::Nick, FounderEditReason::Taken));
        }
        validated.nick = Some(nick);
    }
    if let Some(raw) = &edit.full_name {
        let name =
            normalize_full_name(raw).map_err(|reason| fail(FounderField::FullName, reason))?;
        let key = fold_key(&name);
        if context.world.full_name_taken(&name) || others().any(|p| fold_key(&p.full_name) == key) {
            return Err(fail(FounderField::FullName, FounderEditReason::Taken));
        }
        validated.full_name = Some(name);
    }
    if let Some(raw) = &edit.nationality {
        validated.nationality = Some(
            validate_nationality(raw, context.region_codes)
                .map_err(|reason| fail(FounderField::Nationality, reason))?,
        );
    }
    if let Some(raw) = &edit.birth_date {
        validated.birth_date = Some(
            validate_birth_date(raw, context.today)
                .map_err(|reason| fail(FounderField::BirthDate, reason))?,
        );
    }
    Ok(validated)
}

/// Applies `overrides` to a freshly generated `squad`, role by role in squad
/// order. A birth date or nationality change reprices the founder with the same
/// functions the generator uses, so wages never fall below the wage floor.
///
/// Edits are validated in order (nick, full name, nationality, birth date) and
/// the first failure is returned; it never falls back to the generated value.
/// On error the squad may be partly edited, so callers discard it.
pub fn apply_founder_overrides(
    squad: &mut [Player],
    overrides: &FounderOverrides,
    context: &EditContext<'_>,
) -> Result<(), FounderEditError> {
    for index in 0..squad.len() {
        let Some(edit) = overrides.for_role(squad[index].natural_position) else {
            continue;
        };
        let validated = validate_edit(squad, index, edit, context)?;
        let player = &mut squad[index];
        if let Some(nick) = validated.nick {
            player.match_name = nick;
        }
        if let Some(full_name) = validated.full_name {
            player.full_name = full_name;
        }
        let reprice = validated.nationality.is_some() || validated.birth_date.is_some();
        if let Some(nationality) = validated.nationality {
            player.nationality = nationality;
        }
        if let Some(birth_date) = validated.birth_date {
            player.date_of_birth = birth_date;
        }
        if reprice {
            reprice_player(player, context.today);
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// In-game rename
// ---------------------------------------------------------------------------

/// Whether `player` is a founder of the manager's own custom club: a generated
/// id, on the manager's team, and that team is a custom club.
pub fn is_user_club_founder(game: &Game, player: &Player) -> bool {
    let Some(team_id) = game.manager.team_id.as_deref() else {
        return false;
    };
    player.id.starts_with(FOUNDER_ID_PREFIX)
        && player.team_id.as_deref() == Some(team_id)
        && crate::custom_team::is_custom_team_id(team_id)
}

/// Renames a founder of the manager's custom club. Only the nick and the full
/// name can change; either may be left out. Both are validated (including world
/// uniqueness, excluding the player himself) before anything is written.
pub fn rename_founder(
    game: &mut Game,
    player_id: &str,
    nick: Option<&str>,
    full_name: Option<&str>,
) -> Result<(), FounderError> {
    if nick.is_none() && full_name.is_none() {
        return Err(FounderError::NothingToChange);
    }
    let index = game
        .players
        .iter()
        .position(|player| player.id == player_id)
        .ok_or_else(|| FounderError::PlayerNotFound {
            player_id: player_id.to_string(),
        })?;
    if !is_user_club_founder(game, &game.players[index]) {
        return Err(FounderError::NotAFounder {
            player_id: player_id.to_string(),
        });
    }
    let role = game.players[index].natural_position;
    let others = NameIndex::from_players(
        game.players
            .iter()
            .enumerate()
            .filter(|(other, _)| *other != index)
            .map(|(_, player)| player),
    );
    let fail = |field, reason| {
        FounderError::InvalidField(FounderEditError {
            role,
            field,
            reason,
        })
    };

    let new_nick = nick
        .map(|raw| {
            let nick = normalize_nick(raw).map_err(|reason| fail(FounderField::Nick, reason))?;
            if others.nick_taken(&nick) {
                return Err(fail(FounderField::Nick, FounderEditReason::Taken));
            }
            Ok(nick)
        })
        .transpose()?;
    let new_full_name = full_name
        .map(|raw| {
            let name =
                normalize_full_name(raw).map_err(|reason| fail(FounderField::FullName, reason))?;
            if others.full_name_taken(&name) {
                return Err(fail(FounderField::FullName, FounderEditReason::Taken));
            }
            Ok(name)
        })
        .transpose()?;

    let player = &mut game.players[index];
    if let Some(nick) = new_nick {
        player.match_name = nick;
    }
    if let Some(full_name) = new_full_name {
        player.full_name = full_name;
    }
    Ok(())
}

/// Precomposed Latin-1 and Latin Extended-A letters as `(letter, base, mark)`,
/// one canonical decomposition step each.
const LATIN_DECOMPOSITIONS: &[(char, char, char)] = &[
    ('À', 'A', '\u{0300}'),
    ('Á', 'A', '\u{0301}'),
    ('Â', 'A', '\u{0302}'),
    ('Ã', 'A', '\u{0303}'),
    ('Ä', 'A', '\u{0308}'),
    ('Å', 'A', '\u{030A}'),
    ('Ç', 'C', '\u{0327}'),
    ('È', 'E', '\u{0300}'),
    ('É', 'E', '\u{0301}'),
    ('Ê', 'E', '\u{0302}'),
    ('Ë', 'E', '\u{0308}'),
    ('Ì', 'I', '\u{0300}'),
    ('Í', 'I', '\u{0301}'),
    ('Î', 'I', '\u{0302}'),
    ('Ï', 'I', '\u{0308}'),
    ('Ñ', 'N', '\u{0303}'),
    ('Ò', 'O', '\u{0300}'),
    ('Ó', 'O', '\u{0301}'),
    ('Ô', 'O', '\u{0302}'),
    ('Õ', 'O', '\u{0303}'),
    ('Ö', 'O', '\u{0308}'),
    ('Ù', 'U', '\u{0300}'),
    ('Ú', 'U', '\u{0301}'),
    ('Û', 'U', '\u{0302}'),
    ('Ü', 'U', '\u{0308}'),
    ('Ý', 'Y', '\u{0301}'),
    ('à', 'a', '\u{0300}'),
    ('á', 'a', '\u{0301}'),
    ('â', 'a', '\u{0302}'),
    ('ã', 'a', '\u{0303}'),
    ('ä', 'a', '\u{0308}'),
    ('å', 'a', '\u{030A}'),
    ('ç', 'c', '\u{0327}'),
    ('è', 'e', '\u{0300}'),
    ('é', 'e', '\u{0301}'),
    ('ê', 'e', '\u{0302}'),
    ('ë', 'e', '\u{0308}'),
    ('ì', 'i', '\u{0300}'),
    ('í', 'i', '\u{0301}'),
    ('î', 'i', '\u{0302}'),
    ('ï', 'i', '\u{0308}'),
    ('ñ', 'n', '\u{0303}'),
    ('ò', 'o', '\u{0300}'),
    ('ó', 'o', '\u{0301}'),
    ('ô', 'o', '\u{0302}'),
    ('õ', 'o', '\u{0303}'),
    ('ö', 'o', '\u{0308}'),
    ('ù', 'u', '\u{0300}'),
    ('ú', 'u', '\u{0301}'),
    ('û', 'u', '\u{0302}'),
    ('ü', 'u', '\u{0308}'),
    ('ý', 'y', '\u{0301}'),
    ('ÿ', 'y', '\u{0308}'),
    ('Ā', 'A', '\u{0304}'),
    ('ā', 'a', '\u{0304}'),
    ('Ă', 'A', '\u{0306}'),
    ('ă', 'a', '\u{0306}'),
    ('Ą', 'A', '\u{0328}'),
    ('ą', 'a', '\u{0328}'),
    ('Ć', 'C', '\u{0301}'),
    ('ć', 'c', '\u{0301}'),
    ('Ĉ', 'C', '\u{0302}'),
    ('ĉ', 'c', '\u{0302}'),
    ('Ċ', 'C', '\u{0307}'),
    ('ċ', 'c', '\u{0307}'),
    ('Č', 'C', '\u{030C}'),
    ('č', 'c', '\u{030C}'),
    ('Ď', 'D', '\u{030C}'),
    ('ď', 'd', '\u{030C}'),
    ('Ē', 'E', '\u{0304}'),
    ('ē', 'e', '\u{0304}'),
    ('Ĕ', 'E', '\u{0306}'),
    ('ĕ', 'e', '\u{0306}'),
    ('Ė', 'E', '\u{0307}'),
    ('ė', 'e', '\u{0307}'),
    ('Ę', 'E', '\u{0328}'),
    ('ę', 'e', '\u{0328}'),
    ('Ě', 'E', '\u{030C}'),
    ('ě', 'e', '\u{030C}'),
    ('Ĝ', 'G', '\u{0302}'),
    ('ĝ', 'g', '\u{0302}'),
    ('Ğ', 'G', '\u{0306}'),
    ('ğ', 'g', '\u{0306}'),
    ('Ġ', 'G', '\u{0307}'),
    ('ġ', 'g', '\u{0307}'),
    ('Ģ', 'G', '\u{0327}'),
    ('ģ', 'g', '\u{0327}'),
    ('Ĥ', 'H', '\u{0302}'),
    ('ĥ', 'h', '\u{0302}'),
    ('Ĩ', 'I', '\u{0303}'),
    ('ĩ', 'i', '\u{0303}'),
    ('Ī', 'I', '\u{0304}'),
    ('ī', 'i', '\u{0304}'),
    ('Ĭ', 'I', '\u{0306}'),
    ('ĭ', 'i', '\u{0306}'),
    ('Į', 'I', '\u{0328}'),
    ('į', 'i', '\u{0328}'),
    ('İ', 'I', '\u{0307}'),
    ('Ĵ', 'J', '\u{0302}'),
    ('ĵ', 'j', '\u{0302}'),
    ('Ķ', 'K', '\u{0327}'),
    ('ķ', 'k', '\u{0327}'),
    ('Ĺ', 'L', '\u{0301}'),
    ('ĺ', 'l', '\u{0301}'),
    ('Ļ', 'L', '\u{0327}'),
    ('ļ', 'l', '\u{0327}'),
    ('Ľ', 'L', '\u{030C}'),
    ('ľ', 'l', '\u{030C}'),
    ('Ń', 'N', '\u{0301}'),
    ('ń', 'n', '\u{0301}'),
    ('Ņ', 'N', '\u{0327}'),
    ('ņ', 'n', '\u{0327}'),
    ('Ň', 'N', '\u{030C}'),
    ('ň', 'n', '\u{030C}'),
    ('Ō', 'O', '\u{0304}'),
    ('ō', 'o', '\u{0304}'),
    ('Ŏ', 'O', '\u{0306}'),
    ('ŏ', 'o', '\u{0306}'),
    ('Ő', 'O', '\u{030B}'),
    ('ő', 'o', '\u{030B}'),
    ('Ŕ', 'R', '\u{0301}'),
    ('ŕ', 'r', '\u{0301}'),
    ('Ŗ', 'R', '\u{0327}'),
    ('ŗ', 'r', '\u{0327}'),
    ('Ř', 'R', '\u{030C}'),
    ('ř', 'r', '\u{030C}'),
    ('Ś', 'S', '\u{0301}'),
    ('ś', 's', '\u{0301}'),
    ('Ŝ', 'S', '\u{0302}'),
    ('ŝ', 's', '\u{0302}'),
    ('Ş', 'S', '\u{0327}'),
    ('ş', 's', '\u{0327}'),
    ('Š', 'S', '\u{030C}'),
    ('š', 's', '\u{030C}'),
    ('Ţ', 'T', '\u{0327}'),
    ('ţ', 't', '\u{0327}'),
    ('Ť', 'T', '\u{030C}'),
    ('ť', 't', '\u{030C}'),
    ('Ũ', 'U', '\u{0303}'),
    ('ũ', 'u', '\u{0303}'),
    ('Ū', 'U', '\u{0304}'),
    ('ū', 'u', '\u{0304}'),
    ('Ŭ', 'U', '\u{0306}'),
    ('ŭ', 'u', '\u{0306}'),
    ('Ů', 'U', '\u{030A}'),
    ('ů', 'u', '\u{030A}'),
    ('Ű', 'U', '\u{030B}'),
    ('ű', 'u', '\u{030B}'),
    ('Ų', 'U', '\u{0328}'),
    ('ų', 'u', '\u{0328}'),
    ('Ŵ', 'W', '\u{0302}'),
    ('ŵ', 'w', '\u{0302}'),
    ('Ŷ', 'Y', '\u{0302}'),
    ('ŷ', 'y', '\u{0302}'),
    ('Ÿ', 'Y', '\u{0308}'),
    ('Ź', 'Z', '\u{0301}'),
    ('ź', 'z', '\u{0301}'),
    ('Ż', 'Z', '\u{0307}'),
    ('ż', 'z', '\u{0307}'),
    ('Ž', 'Z', '\u{030C}'),
    ('ž', 'z', '\u{030C}'),
];
