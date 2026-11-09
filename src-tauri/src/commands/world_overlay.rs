//! Downloadable roster overlay: fetch, validate, cache and select the freshest
//! overlay for a new game.
//!
//! The shipped app never scrapes Leaguepedia. It only downloads the static
//! overlay JSON produced by the maintainer tooling, validates it with the same
//! rules as the bundled one and keeps it in `app_data_dir/world/`. At new-game
//! time the overlay with the newest `as_of` wins (the bundled one on ties).
//!
//! Every downloaded overlay needs a detached Ed25519 signature (`<source>.sig`) that verifies against
//! the public key embedded in the app. The signature is checked before the overlay is parsed or
//! cached, and again whenever the cache is read; anything unsigned or badly signed is ignored.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use log::{info, warn};
use olm_core::world_overlay::{bundled_world_overlay, OverlayError, OverlaySource, WorldOverlay};
use olm_core::world_overlay_signature::{
    verify_overlay_signature, OverlayPublicKey, SignatureError,
};
use serde::Serialize;
use tauri::Manager as TauriManager;

/// Environment variable overriding where the overlay is downloaded from. Either
/// an `https://` URL or a local file path (used by tests and manual smoke runs).
pub const SOURCE_ENV_VAR: &str = "OLM_WORLD_OVERLAY_SOURCE";
const DEFAULT_SOURCE: &str =
    "https://raw.githubusercontent.com/ProphetLemon/OLManager/develop/assets/world/roster-overlay.json";
/// Hard cap on the overlay size, enforced while streaming.
const MAX_OVERLAY_BYTES: usize = 4 * 1024 * 1024;
/// Timeout of a manual "Update rosters" press.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
/// Timeout of the automatic check made when the new-game screen opens; it
/// holds the Confirm button back, so it must stay short.
const AUTOMATIC_REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_REDIRECTS: usize = 5;
const CACHE_DIR: &str = "world";
const CACHE_FILE: &str = "roster-overlay.json";
const SIGNATURE_SUFFIX: &str = ".sig";
/// A base64 Ed25519 signature is 88 bytes; the cap only bounds a hostile response.
const MAX_SIGNATURE_BYTES: usize = 1024;

#[derive(Debug, thiserror::Error)]
pub enum WorldOverlayError {
    #[error("roster overlay source must use https: {0}")]
    InsecureSource(String),
    #[error("roster overlay download failed: {0}")]
    Network(String),
    #[error("roster overlay server answered HTTP {0}")]
    HttpStatus(u16),
    #[error("roster overlay is larger than {limit} bytes")]
    TooLarge { limit: usize },
    #[error("downloaded roster overlay is not valid: {0}")]
    Invalid(#[source] OverlayError),
    #[error("roster overlay has no signature")]
    MissingSignature,
    #[error("roster overlay signature rejected: {0}")]
    BadSignature(#[source] SignatureError),
    #[error("bundled roster overlay is not valid: {0}")]
    BundledInvalid(#[source] OverlayError),
    #[error("roster overlay storage error: {0}")]
    Io(#[from] std::io::Error),
    #[error("cannot resolve the app data directory: {0}")]
    AppDir(String),
}

/// Where the overlay a new game would use comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum OverlayOrigin {
    Downloaded,
    Bundled,
}

/// What the UI needs to show about an overlay.
#[derive(Debug, Clone, Serialize)]
pub struct WorldOverlayInfo {
    pub as_of: String,
    pub origin: OverlayOrigin,
    pub source: OverlaySource,
    pub player_ops: usize,
    pub staff_ops: usize,
    /// True only when an update call replaced the overlay with a newer one.
    pub updated: bool,
}

/// An overlay together with where it came from.
#[derive(Debug, Clone)]
pub struct ResolvedOverlay {
    pub overlay: WorldOverlay,
    pub origin: OverlayOrigin,
}

impl ResolvedOverlay {
    pub fn info(&self, updated: bool) -> WorldOverlayInfo {
        WorldOverlayInfo {
            as_of: self.overlay.as_of.clone(),
            origin: self.origin,
            source: self.overlay.source.clone(),
            player_ops: self.overlay.players.len(),
            staff_ops: self.overlay.staff.len(),
            updated,
        }
    }
}

/// Pick the newest overlay. `as_of` is a validated canonical `YYYY-MM-DD`, so
/// plain string ordering is chronological.
///
/// Ties go to the bundled overlay: a downloaded overlay with the same `as_of`
/// does not replace it, even if its content differs. Publish a corrected
/// overlay with a newer `as_of` for it to take effect.
pub fn select_overlay(bundled: WorldOverlay, cached: Option<WorldOverlay>) -> ResolvedOverlay {
    match cached {
        Some(cached) if cached.as_of > bundled.as_of => ResolvedOverlay {
            overlay: cached,
            origin: OverlayOrigin::Downloaded,
        },
        Some(cached) => {
            if cached.as_of == bundled.as_of {
                info!(
                    "[world_overlay] cached overlay has the same as_of ({}) as the bundled one; keeping the bundled overlay",
                    bundled.as_of
                );
            }
            ResolvedOverlay {
                overlay: bundled,
                origin: OverlayOrigin::Bundled,
            }
        }
        None => ResolvedOverlay {
            overlay: bundled,
            origin: OverlayOrigin::Bundled,
        },
    }
}

/// Read the cached overlay. A missing file is normal; an unreadable or invalid
/// one is logged and ignored so it can never block a new game.
pub fn read_cached_overlay(path: &Path, key: &OverlayPublicKey) -> Option<WorldOverlay> {
    let bytes = match read_local_capped(path, MAX_OVERLAY_BYTES) {
        Ok(bytes) => bytes,
        Err(WorldOverlayError::Io(err)) if err.kind() == std::io::ErrorKind::NotFound => {
            return None
        }
        Err(err) => {
            warn!("[world_overlay] ignoring unreadable cache {path:?}: {err}");
            return None;
        }
    };
    let signature = match read_local_capped(&signature_path(path), MAX_SIGNATURE_BYTES) {
        Ok(signature) => signature,
        Err(err) => {
            warn!("[world_overlay] ignoring cache {path:?}: no readable signature: {err}");
            return None;
        }
    };
    if let Err(err) = verify_overlay_signature(&bytes, &signature, key) {
        warn!("[world_overlay] ignoring cache {path:?}: {err}");
        return None;
    }
    let Ok(raw) = String::from_utf8(bytes) else {
        warn!("[world_overlay] ignoring cache {path:?}: not valid UTF-8");
        return None;
    };
    match WorldOverlay::parse(&raw) {
        Ok(overlay) => Some(overlay),
        Err(err) => {
            warn!("[world_overlay] ignoring invalid cache {path:?}: {err}");
            None
        }
    }
}

/// Cache signature file: next to the cache file, `<name>.sig`.
fn signature_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(SIGNATURE_SUFFIX);
    PathBuf::from(name)
}

/// The key the shipped app trusts. Only the tests use another one, by passing it explicitly.
fn trusted_key() -> Result<OverlayPublicKey, WorldOverlayError> {
    OverlayPublicKey::embedded().map_err(WorldOverlayError::BadSignature)
}

fn resolve_from(
    cache_path: Option<&Path>,
    key: &OverlayPublicKey,
) -> Result<ResolvedOverlay, WorldOverlayError> {
    let bundled = bundled_world_overlay().map_err(WorldOverlayError::BundledInvalid)?;
    let cached = cache_path.and_then(|path| read_cached_overlay(path, key));
    Ok(select_overlay(bundled, cached))
}

fn cache_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, WorldOverlayError> {
    let base = app_handle
        .path()
        .app_data_dir()
        .map_err(|err| WorldOverlayError::AppDir(err.to_string()))?;
    Ok(base.join(CACHE_DIR).join(CACHE_FILE))
}

/// Overlay a new game starts from. Never fails the new game: a broken bundled
/// overlay yields `None` and the caller starts from the bundled data alone.
pub fn resolve_overlay_for_new_game(app_handle: &tauri::AppHandle) -> Option<WorldOverlay> {
    let path = match cache_path(app_handle) {
        Ok(path) => Some(path),
        Err(err) => {
            warn!("[world_overlay] no cache location, using bundled overlay: {err}");
            None
        }
    };
    match trusted_key().and_then(|key| resolve_from(path.as_deref(), &key)) {
        Ok(resolved) => Some(resolved.overlay),
        Err(err) => {
            warn!("[world_overlay] ignoring roster overlay: {err}");
            None
        }
    }
}

// ---------------------------------------------------------------------------
// Download + atomic storage
// ---------------------------------------------------------------------------

fn configured_source() -> String {
    std::env::var(SOURCE_ENV_VAR)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_SOURCE.to_string())
}

/// What is safe to log or show about a source: `scheme://host` for a URL
/// (userinfo, port, path and query dropped, since any of them may hold a
/// credential or token), or "local file" for a path.
fn describe_source(source: &str) -> String {
    let Some((scheme, rest)) = source.split_once("://") else {
        return "local file".to_string();
    };
    if !matches!(scheme.to_ascii_lowercase().as_str(), "http" | "https") {
        return "local file".to_string();
    }
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    let host_port = authority.rsplit('@').next().unwrap_or_default();
    let host = host_port.split(':').next().unwrap_or_default();
    format!("{}://{host}", scheme.to_ascii_lowercase())
}

fn is_remote(source: &str) -> bool {
    let lower = source.to_ascii_lowercase();
    lower.starts_with("https://") || lower.starts_with("http://")
}

fn read_local_capped(path: &Path, limit: usize) -> Result<Vec<u8>, WorldOverlayError> {
    let file = std::fs::File::open(path)?;
    let mut bytes = Vec::new();
    // One byte past the cap tells "exactly at the cap" from "over it".
    file.take(limit as u64 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > limit {
        return Err(WorldOverlayError::TooLarge { limit });
    }
    Ok(bytes)
}

async fn download_capped(
    url: &str,
    user_agent: &str,
    limit: usize,
    timeout: Duration,
) -> Result<Vec<u8>, WorldOverlayError> {
    if !url.to_ascii_lowercase().starts_with("https://") {
        return Err(WorldOverlayError::InsecureSource(describe_source(url)));
    }
    let client = reqwest::Client::builder()
        .user_agent(user_agent)
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.url().scheme() != "https" {
                attempt.error("redirect to a non-https URL")
            } else if attempt.previous().len() >= MAX_REDIRECTS {
                attempt.error("too many redirects")
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|err| WorldOverlayError::Network(err.without_url().to_string()))?;
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|err| WorldOverlayError::Network(err.without_url().to_string()))?;
    if !response.status().is_success() {
        return Err(WorldOverlayError::HttpStatus(response.status().as_u16()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err(WorldOverlayError::TooLarge { limit });
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|err| WorldOverlayError::Network(err.without_url().to_string()))?
    {
        if bytes.len() + chunk.len() > limit {
            return Err(WorldOverlayError::TooLarge { limit });
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

async fn fetch_overlay_bytes(
    source: &str,
    user_agent: &str,
    limit: usize,
    timeout: Duration,
) -> Result<Vec<u8>, WorldOverlayError> {
    if is_remote(source) {
        download_capped(source, user_agent, limit, timeout).await
    } else {
        read_local_capped(Path::new(source), limit)
    }
}

/// Where the detached signature of the overlay at `source` lives.
///
/// For a URL the suffix goes into the path, before any query or fragment; a
/// local path is taken verbatim (`?` and `#` are ordinary file-name characters).
fn signature_source(source: &str) -> String {
    if !is_remote(source) {
        return format!("{source}{SIGNATURE_SUFFIX}");
    }
    let (base, tail) = source.split_at(source.find(['?', '#']).unwrap_or(source.len()));
    let after_scheme = base.split_once("://").map_or(base, |(_, rest)| rest);
    let separator = if after_scheme.contains('/') { "" } else { "/" };
    format!("{base}{separator}{SIGNATURE_SUFFIX}{tail}")
}

/// Fetch the signature of `source`; a missing one is [`WorldOverlayError::MissingSignature`].
async fn fetch_signature_bytes(
    source: &str,
    user_agent: &str,
    timeout: Duration,
) -> Result<Vec<u8>, WorldOverlayError> {
    match fetch_overlay_bytes(
        &signature_source(source),
        user_agent,
        MAX_SIGNATURE_BYTES,
        timeout,
    )
    .await
    {
        Err(WorldOverlayError::HttpStatus(404 | 410)) => Err(WorldOverlayError::MissingSignature),
        Err(WorldOverlayError::Io(err)) if err.kind() == std::io::ErrorKind::NotFound => {
            Err(WorldOverlayError::MissingSignature)
        }
        other => other,
    }
}

/// Write `bytes` to `path` so readers see either the old file or the new one:
/// temp file in the same directory, fsync, then rename. A failure removes the
/// temp file and leaves any existing cache untouched.
pub fn write_atomically(path: &Path, bytes: &[u8]) -> Result<(), WorldOverlayError> {
    use std::io::Write;

    let dir = path.parent().ok_or_else(|| {
        WorldOverlayError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "cache path has no parent directory",
        ))
    })?;
    std::fs::create_dir_all(dir)?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or_default();
    let tmp = dir.join(format!(".{CACHE_FILE}.tmp-{}-{nonce}", std::process::id()));
    let result = (|| -> std::io::Result<()> {
        let mut file = std::fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&tmp, path)
    })();
    if let Err(err) = result {
        let _ = std::fs::remove_file(&tmp);
        return Err(err.into());
    }
    Ok(())
}

/// Fetch the overlay and then its signature under ONE total deadline: each fetch
/// gets only the time the previous one left, so the pair never takes longer than
/// `timeout` (an automatic check must not hold the new-game screen for twice that).
async fn fetch_pair_with<A, B>(
    timeout: Duration,
    fetch_overlay: impl FnOnce(Duration) -> A,
    fetch_signature: impl FnOnce(Duration) -> B,
) -> Result<(Vec<u8>, Vec<u8>), WorldOverlayError>
where
    A: std::future::Future<Output = Result<Vec<u8>, WorldOverlayError>>,
    B: std::future::Future<Output = Result<Vec<u8>, WorldOverlayError>>,
{
    let deadline = tokio::time::Instant::now() + timeout;
    let bytes = within_deadline(deadline, fetch_overlay).await?;
    let signature = within_deadline(deadline, fetch_signature).await?;
    Ok((bytes, signature))
}

async fn within_deadline<F, Fut>(
    deadline: tokio::time::Instant,
    fetch: F,
) -> Result<Vec<u8>, WorldOverlayError>
where
    F: FnOnce(Duration) -> Fut,
    Fut: std::future::Future<Output = Result<Vec<u8>, WorldOverlayError>>,
{
    let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
    tokio::time::timeout_at(deadline, fetch(remaining))
        .await
        .unwrap_or_else(|_| Err(WorldOverlayError::Network("request timed out".to_string())))
}

/// Store the downloaded pair: the overlay first, the signature last. A crash in
/// between leaves a new overlay next to the old signature, which read-time
/// verification rejects, so the pair is ignored; a new signature never sits next
/// to an old overlay.
fn store_pair_with(
    cache_path: &Path,
    overlay: &[u8],
    signature: &[u8],
    mut write: impl FnMut(&Path, &[u8]) -> Result<(), WorldOverlayError>,
) -> Result<(), WorldOverlayError> {
    write(cache_path, overlay)?;
    write(&signature_path(cache_path), signature)
}

/// Download from `source`, validate and store into `cache_path` when it is not
/// older than what is cached. Returns the overlay a new game would now use.
async fn refresh_cache(
    cache_path: &Path,
    source: &str,
    user_agent: &str,
    limit: usize,
    timeout: Duration,
    key: &OverlayPublicKey,
) -> Result<WorldOverlayInfo, WorldOverlayError> {
    let bundled = bundled_world_overlay().map_err(WorldOverlayError::BundledInvalid)?;
    let cached = read_cached_overlay(cache_path, key);
    let before = select_overlay(bundled.clone(), cached.clone());

    let (bytes, signature) = fetch_pair_with(
        timeout,
        |remaining| fetch_overlay_bytes(source, user_agent, limit, remaining),
        |remaining| fetch_signature_bytes(source, user_agent, remaining),
    )
    .await?;
    verify_overlay_signature(&bytes, &signature, key).map_err(WorldOverlayError::BadSignature)?;
    let text = std::str::from_utf8(&bytes).map_err(|_| {
        WorldOverlayError::Invalid(OverlayError::InvalidField {
            field: "document".to_string(),
            reason: "not valid UTF-8",
        })
    })?;
    let downloaded = WorldOverlay::parse(text).map_err(WorldOverlayError::Invalid)?;

    // Never go back in time relative to the cache; without a cache the download
    // must at least match the bundled overlay to be worth keeping.
    let acceptable = match &cached {
        Some(cached) => downloaded.as_of >= cached.as_of,
        None => downloaded.as_of >= bundled.as_of,
    };
    if acceptable {
        store_pair_with(cache_path, &bytes, &signature, write_atomically)?;
    } else {
        info!(
            "[world_overlay] downloaded overlay {} is older than the one in use, keeping it",
            downloaded.as_of
        );
    }
    let after = resolve_from(Some(cache_path), key)?;
    let updated = after.overlay.as_of > before.overlay.as_of;
    Ok(after.info(updated))
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Request timeout for a manual (`false`) or automatic (`true`) update.
fn request_timeout(automatic: bool) -> Duration {
    if automatic {
        AUTOMATIC_REQUEST_TIMEOUT
    } else {
        REQUEST_TIMEOUT
    }
}

/// Download a newer roster overlay (if any) and cache it for future new games.
///
/// `automatic` marks the background check made when the new-game screen opens:
/// it uses a shorter timeout than a manual update. Everything else (https
/// only, size cap, validation, atomic write) is identical.
#[tauri::command]
pub async fn update_world_overlay(
    app_handle: tauri::AppHandle,
    automatic: Option<bool>,
) -> Result<WorldOverlayInfo, String> {
    let timeout = request_timeout(automatic.unwrap_or(false));
    let source = configured_source();
    let user_agent = format!("OLManager/{}", app_handle.package_info().version);
    let path = cache_path(&app_handle).map_err(|err| err.to_string())?;
    info!(
        "[cmd] update_world_overlay: source={} timeout={}s",
        describe_source(&source),
        timeout.as_secs()
    );
    let key = trusted_key().map_err(|err| err.to_string())?;
    refresh_cache(
        &path,
        &source,
        &user_agent,
        MAX_OVERLAY_BYTES,
        timeout,
        &key,
    )
    .await
    .map_err(|err| {
        warn!("[cmd] update_world_overlay failed: {err}");
        err.to_string()
    })
}

/// Describe the overlay a new game would use right now.
#[tauri::command]
pub fn get_world_overlay_info(app_handle: tauri::AppHandle) -> Result<WorldOverlayInfo, String> {
    let path = cache_path(&app_handle).ok();
    trusted_key()
        .and_then(|key| resolve_from(path.as_deref(), &key))
        .map(|resolved| resolved.info(false))
        .map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine as _;
    use ed25519_dalek::{Signer, SigningKey};

    #[test]
    fn automatic_check_uses_the_short_timeout_and_manual_keeps_the_long_one() {
        assert_eq!(request_timeout(true), Duration::from_secs(5));
        assert_eq!(request_timeout(false), Duration::from_secs(15));
        assert!(request_timeout(true) < request_timeout(false));
    }

    const UA: &str = "OLManager/test";

    fn overlay_json(as_of: &str, moves: usize) -> String {
        let players: Vec<String> = (0..moves)
            .map(|i| {
                format!(r#"{{"op":"retire","id":"p{i}","evidence":"https://example.test/{i}"}}"#)
            })
            .collect();
        format!(
            r#"{{"schemaVersion":1,"as_of":"{as_of}","source":{{"name":"Test","url":"https://example.test","license":"CC BY-SA 3.0","license_url":"https://www.fandom.com/licensing","attribution":"Test data"}},"coverage":[],"players":[{}],"staff":[]}}"#,
            players.join(",")
        )
    }

    fn parse(as_of: &str) -> WorldOverlay {
        WorldOverlay::parse(&overlay_json(as_of, 0)).expect("fixture overlay is valid")
    }

    fn bundled_date() -> String {
        bundled_world_overlay().expect("bundled overlay").as_of
    }

    /// A date `days` away from the bundled `as_of`, in the same YYYY-MM-DD form.
    /// Keep future offsets within the validator's small future tolerance (2 days): the bundled
    /// overlay is dated the day it was generated, so a larger offset would be rejected as a future date.
    fn offset_date(days: i64) -> String {
        let base = chrono::NaiveDate::parse_from_str(&bundled_date(), "%Y-%m-%d").expect("date");
        (base + chrono::Duration::days(days))
            .format("%Y-%m-%d")
            .to_string()
    }

    fn run<T>(future: impl std::future::Future<Output = T>) -> T {
        tauri::async_runtime::block_on(future)
    }

    fn signing_key(seed: u8) -> SigningKey {
        SigningKey::from_bytes(&[seed; 32])
    }

    fn key_of(signing: &SigningKey) -> OverlayPublicKey {
        OverlayPublicKey::from_base64(&STANDARD.encode(signing.verifying_key().to_bytes()))
            .expect("test public key")
    }

    /// The key the tests trust, standing in for the embedded production key.
    fn test_key() -> OverlayPublicKey {
        key_of(&signing_key(9))
    }

    fn signature_for(signing: &SigningKey, content: &[u8]) -> String {
        format!("{}\n", STANDARD.encode(signing.sign(content).to_bytes()))
    }

    /// Writes `content` and, unless told otherwise, its signature under the test key.
    fn write_signed_source(dir: &Path, name: &str, content: &str) -> String {
        let path = dir.join(name);
        std::fs::write(&path, content).expect("write source fixture");
        std::fs::write(
            signature_path(&path),
            signature_for(&signing_key(9), content.as_bytes()),
        )
        .expect("write signature fixture");
        path.to_string_lossy().into_owned()
    }

    /// Writes a cache file together with a valid signature under the test key.
    fn write_signed_cache(path: &Path, content: &str) {
        std::fs::write(path, content).expect("write cache");
        std::fs::write(
            signature_path(path),
            signature_for(&signing_key(9), content.as_bytes()),
        )
        .expect("write cache signature");
    }

    #[test]
    fn signature_source_inserts_the_suffix_into_the_url_path() {
        assert_eq!(
            signature_source("https://example.test/a/overlay.json"),
            "https://example.test/a/overlay.json.sig"
        );
        assert_eq!(
            signature_source("https://example.test/a/overlay.json?token=1&v=2#frag"),
            "https://example.test/a/overlay.json.sig?token=1&v=2#frag"
        );
        assert_eq!(
            signature_source("https://example.test/a/overlay.json#frag"),
            "https://example.test/a/overlay.json.sig#frag"
        );
        assert_eq!(
            signature_source("https://example.test?x=1"),
            "https://example.test/.sig?x=1"
        );
    }

    #[test]
    fn signature_source_keeps_local_paths_verbatim() {
        assert_eq!(
            signature_source("/tmp/over lay.json"),
            "/tmp/over lay.json.sig"
        );
        // `?` and `#` are ordinary characters in a file name.
        assert_eq!(signature_source("/tmp/a#b?c.json"), "/tmp/a#b?c.json.sig");
    }

    #[test]
    fn the_overlay_and_signature_fetches_share_one_deadline() {
        let timeout = Duration::from_millis(300);
        let slow = |remaining: Duration| async move {
            // Each fetch would finish inside the full timeout on its own.
            let _ = remaining;
            tokio::time::sleep(Duration::from_millis(200)).await;
            Ok::<_, WorldOverlayError>(vec![1u8])
        };
        let started = std::time::Instant::now();
        let result = run(fetch_pair_with(timeout, slow, slow));
        assert!(
            matches!(result, Err(WorldOverlayError::Network(_))),
            "{result:?}"
        );
        assert!(
            started.elapsed() < Duration::from_millis(380),
            "took {:?}",
            started.elapsed()
        );
    }

    #[test]
    fn the_second_fetch_only_gets_the_time_the_first_left() {
        let timeout = Duration::from_millis(500);
        let seen = std::cell::Cell::new(Duration::ZERO);
        let result = run(fetch_pair_with(
            timeout,
            |_| async {
                tokio::time::sleep(Duration::from_millis(150)).await;
                Ok(vec![1u8])
            },
            |remaining| {
                seen.set(remaining);
                async { Ok(vec![2u8]) }
            },
        ))
        .expect("pair");
        assert_eq!(result, (vec![1u8], vec![2u8]));
        assert!(seen.get() <= Duration::from_millis(360), "{:?}", seen.get());
    }

    #[test]
    fn the_cache_pair_is_written_overlay_first_and_signature_last() {
        let cache = Path::new("/cache/world.json");
        let mut order = Vec::new();
        store_pair_with(cache, b"overlay", b"sig", |path, _| {
            order.push(path.to_path_buf());
            Ok(())
        })
        .expect("store");
        assert_eq!(order, vec![cache.to_path_buf(), signature_path(cache)]);
    }

    #[test]
    fn a_crash_between_the_two_writes_leaves_a_pair_that_is_ignored() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (cache, _) = seeded_cache(dir.path());
        let old_sig = std::fs::read(signature_path(&cache)).expect("old sig");
        let new_doc = overlay_json(&offset_date(2), 2);
        let new_sig = signature_for(&signing_key(9), new_doc.as_bytes());

        let mut writes = 0;
        let result = store_pair_with(&cache, new_doc.as_bytes(), new_sig.as_bytes(), |p, b| {
            writes += 1;
            if writes == 1 {
                write_atomically(p, b)
            } else {
                Err(WorldOverlayError::Io(std::io::Error::other("crash")))
            }
        });
        assert!(result.is_err());
        // New overlay, old signature: never a new signature over the old overlay.
        assert_eq!(std::fs::read(signature_path(&cache)).expect("sig"), old_sig);
        assert_eq!(std::fs::read(&cache).expect("overlay"), new_doc.as_bytes());
        assert!(read_cached_overlay(&cache, &test_key()).is_none());
    }

    #[test]
    fn select_overlay_prefers_newer_cached_overlay() {
        let resolved = select_overlay(parse("2026-06-22"), Some(parse("2026-09-01")));
        assert_eq!(resolved.origin, OverlayOrigin::Downloaded);
        assert_eq!(resolved.overlay.as_of, "2026-09-01");
    }

    #[test]
    fn select_overlay_keeps_bundled_on_tie() {
        let resolved = select_overlay(parse("2026-06-22"), Some(parse("2026-06-22")));
        assert_eq!(resolved.origin, OverlayOrigin::Bundled);
    }

    #[test]
    fn select_overlay_keeps_bundled_when_cache_is_older() {
        let resolved = select_overlay(parse("2026-06-22"), Some(parse("2026-01-01")));
        assert_eq!(resolved.origin, OverlayOrigin::Bundled);
    }

    #[test]
    fn select_overlay_uses_bundled_without_cache() {
        let resolved = select_overlay(parse("2026-06-22"), None);
        assert_eq!(resolved.origin, OverlayOrigin::Bundled);
    }

    #[test]
    fn corrupt_cache_is_ignored_and_bundled_is_used() {
        let dir = tempfile::tempdir().expect("tempdir");
        let cache = dir.path().join(CACHE_FILE);
        std::fs::write(&cache, "{ this is not json").expect("write");
        assert!(read_cached_overlay(&cache, &test_key()).is_none());
        let resolved = resolve_from(Some(&cache), &test_key()).expect("resolve");
        assert_eq!(resolved.origin, OverlayOrigin::Bundled);
    }

    #[test]
    fn invalid_cache_with_bad_schema_is_ignored() {
        let dir = tempfile::tempdir().expect("tempdir");
        let cache = dir.path().join(CACHE_FILE);
        std::fs::write(
            &cache,
            overlay_json("2099-01-01", 0).replace("\"schemaVersion\":1", "\"schemaVersion\":9"),
        )
        .expect("write");
        assert!(read_cached_overlay(&cache, &test_key()).is_none());
    }

    #[test]
    fn missing_cache_resolves_to_bundled() {
        let dir = tempfile::tempdir().expect("tempdir");
        let resolved =
            resolve_from(Some(&dir.path().join(CACHE_FILE)), &test_key()).expect("resolve");
        assert_eq!(resolved.origin, OverlayOrigin::Bundled);
    }

    #[test]
    fn refresh_stores_newer_overlay_and_reports_update() {
        let dir = tempfile::tempdir().expect("tempdir");
        let newer = offset_date(2);
        let source = write_signed_source(dir.path(), "src.json", &overlay_json(&newer, 2));
        let cache = dir.path().join("world").join(CACHE_FILE);

        let info = run(refresh_cache(
            &cache,
            &source,
            UA,
            MAX_OVERLAY_BYTES,
            REQUEST_TIMEOUT,
            &test_key(),
        ))
        .expect("refresh");

        assert!(info.updated);
        assert_eq!(info.origin, OverlayOrigin::Downloaded);
        assert_eq!(info.as_of, newer);
        assert_eq!(info.player_ops, 2);
        assert_eq!(info.source.license, "CC BY-SA 3.0");
        assert_eq!(
            read_cached_overlay(&cache, &test_key())
                .expect("cached")
                .as_of,
            newer
        );
    }

    /// Seeds a valid signed cache and returns its bytes, to compare after a rejected refresh.
    fn seeded_cache(dir: &Path) -> (PathBuf, Vec<u8>) {
        let cache = dir.join(CACHE_FILE);
        write_signed_cache(&cache, &overlay_json(&offset_date(1), 1));
        let bytes = std::fs::read(&cache).expect("read cache");
        (cache, bytes)
    }

    fn refresh_with(
        cache: &Path,
        source: &str,
        key: &OverlayPublicKey,
    ) -> Result<WorldOverlayInfo, WorldOverlayError> {
        run(refresh_cache(
            cache,
            source,
            UA,
            MAX_OVERLAY_BYTES,
            REQUEST_TIMEOUT,
            key,
        ))
    }

    #[test]
    fn refresh_stores_the_signature_next_to_the_cache() {
        let dir = tempfile::tempdir().expect("tempdir");
        let doc = overlay_json(&offset_date(2), 1);
        let source = write_signed_source(dir.path(), "src.json", &doc);
        let cache = dir.path().join("world").join(CACHE_FILE);

        refresh_with(&cache, &source, &test_key()).expect("refresh");

        assert_eq!(
            std::fs::read_to_string(signature_path(&cache)).expect("cached signature"),
            signature_for(&signing_key(9), doc.as_bytes())
        );
    }

    #[test]
    fn refresh_rejects_an_overlay_without_a_signature_and_keeps_the_cache() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (cache, before) = seeded_cache(dir.path());
        let source = dir.path().join("unsigned.json");
        std::fs::write(&source, overlay_json(&offset_date(2), 2)).expect("write");

        let err =
            refresh_with(&cache, &source.to_string_lossy(), &test_key()).expect_err("unsigned");

        assert!(
            matches!(err, WorldOverlayError::MissingSignature),
            "got {err:?}"
        );
        assert_eq!(std::fs::read(&cache).expect("read cache"), before);
    }

    #[test]
    fn refresh_rejects_a_tampered_overlay_and_keeps_the_cache() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (cache, before) = seeded_cache(dir.path());
        let source = write_signed_source(dir.path(), "src.json", &overlay_json(&offset_date(2), 2));
        // One byte changes after signing.
        let mut bytes = std::fs::read(&source).expect("read");
        bytes.push(b' ');
        std::fs::write(&source, bytes).expect("tamper");

        let err = refresh_with(&cache, &source, &test_key()).expect_err("tampered");

        assert!(
            matches!(
                err,
                WorldOverlayError::BadSignature(SignatureError::Invalid)
            ),
            "got {err:?}"
        );
        assert_eq!(std::fs::read(&cache).expect("read cache"), before);
    }

    #[test]
    fn refresh_rejects_a_signature_from_another_key_and_creates_no_cache() {
        let dir = tempfile::tempdir().expect("tempdir");
        let doc = overlay_json(&offset_date(2), 1);
        let source = write_signed_source(dir.path(), "src.json", &doc);
        let cache = dir.path().join(CACHE_FILE);

        let err = refresh_with(&cache, &source, &key_of(&signing_key(3))).expect_err("wrong key");

        assert!(
            matches!(
                err,
                WorldOverlayError::BadSignature(SignatureError::Invalid)
            ),
            "got {err:?}"
        );
        assert!(!cache.exists());
        assert!(!signature_path(&cache).exists());
    }

    #[test]
    fn refresh_rejects_a_malformed_signature() {
        let dir = tempfile::tempdir().expect("tempdir");
        let source = write_signed_source(dir.path(), "src.json", &overlay_json(&offset_date(2), 1));
        std::fs::write(signature_path(Path::new(&source)), "not a signature").expect("write");

        let err = refresh_with(&dir.path().join(CACHE_FILE), &source, &test_key())
            .expect_err("malformed");

        assert!(
            matches!(
                err,
                WorldOverlayError::BadSignature(SignatureError::Malformed)
            ),
            "got {err:?}"
        );
    }

    #[test]
    fn the_production_key_refuses_test_signed_sources() {
        let dir = tempfile::tempdir().expect("tempdir");
        let source = write_signed_source(dir.path(), "src.json", &overlay_json(&offset_date(2), 1));
        let production = trusted_key().expect("embedded key");

        let err = refresh_with(&dir.path().join(CACHE_FILE), &source, &production)
            .expect_err("test signature is not the production one");

        assert!(
            matches!(err, WorldOverlayError::BadSignature(_)),
            "got {err:?}"
        );
    }

    #[test]
    fn cache_without_a_signature_is_ignored_and_bundled_is_used() {
        let dir = tempfile::tempdir().expect("tempdir");
        let cache = dir.path().join(CACHE_FILE);
        std::fs::write(&cache, overlay_json("2099-01-01", 1)).expect("write");

        assert!(read_cached_overlay(&cache, &test_key()).is_none());
        let resolved = resolve_from(Some(&cache), &test_key()).expect("resolve");
        assert_eq!(resolved.origin, OverlayOrigin::Bundled);
    }

    #[test]
    fn cache_with_a_tampered_or_foreign_signature_is_ignored() {
        let dir = tempfile::tempdir().expect("tempdir");
        let cache = dir.path().join(CACHE_FILE);
        write_signed_cache(&cache, &overlay_json("2026-09-01", 1));
        assert!(read_cached_overlay(&cache, &test_key()).is_some());

        // Wrong key.
        assert!(read_cached_overlay(&cache, &key_of(&signing_key(3))).is_none());
        // Overlay edited after signing.
        std::fs::write(&cache, overlay_json("2026-09-01", 2)).expect("tamper");
        assert!(read_cached_overlay(&cache, &test_key()).is_none());
    }

    #[test]
    fn refresh_with_same_overlay_is_not_reported_as_update() {
        let dir = tempfile::tempdir().expect("tempdir");
        let newer = offset_date(2);
        let source = write_signed_source(dir.path(), "src.json", &overlay_json(&newer, 1));
        let cache = dir.path().join(CACHE_FILE);

        run(refresh_cache(
            &cache,
            &source,
            UA,
            MAX_OVERLAY_BYTES,
            REQUEST_TIMEOUT,
            &test_key(),
        ))
        .expect("first");
        let info = run(refresh_cache(
            &cache,
            &source,
            UA,
            MAX_OVERLAY_BYTES,
            REQUEST_TIMEOUT,
            &test_key(),
        ))
        .expect("second");

        assert!(!info.updated);
        assert_eq!(info.origin, OverlayOrigin::Downloaded);
    }

    #[test]
    fn refresh_does_not_replace_cache_with_older_overlay() {
        let dir = tempfile::tempdir().expect("tempdir");
        let cache = dir.path().join(CACHE_FILE);
        let newer = offset_date(2);
        let newer_src = write_signed_source(dir.path(), "new.json", &overlay_json(&newer, 3));
        run(refresh_cache(
            &cache,
            &newer_src,
            UA,
            MAX_OVERLAY_BYTES,
            REQUEST_TIMEOUT,
            &test_key(),
        ))
        .expect("seed cache");
        let before = std::fs::read(&cache).expect("read cache");

        let older_src =
            write_signed_source(dir.path(), "old.json", &overlay_json(&offset_date(1), 1));
        let info = run(refresh_cache(
            &cache,
            &older_src,
            UA,
            MAX_OVERLAY_BYTES,
            REQUEST_TIMEOUT,
            &test_key(),
        ))
        .expect("refresh");

        assert!(!info.updated);
        assert_eq!(info.as_of, newer);
        assert_eq!(std::fs::read(&cache).expect("read cache"), before);
    }

    #[test]
    fn refresh_does_not_cache_overlay_older_than_bundled() {
        let dir = tempfile::tempdir().expect("tempdir");
        let cache = dir.path().join(CACHE_FILE);
        let source =
            write_signed_source(dir.path(), "old.json", &overlay_json(&offset_date(-30), 1));

        let info = run(refresh_cache(
            &cache,
            &source,
            UA,
            MAX_OVERLAY_BYTES,
            REQUEST_TIMEOUT,
            &test_key(),
        ))
        .expect("refresh");

        assert!(!info.updated);
        assert_eq!(info.origin, OverlayOrigin::Bundled);
        assert!(!cache.exists());
    }

    #[test]
    fn refresh_rejects_invalid_overlay_and_keeps_cache() {
        let dir = tempfile::tempdir().expect("tempdir");
        let cache = dir.path().join(CACHE_FILE);
        let good = write_signed_source(dir.path(), "good.json", &overlay_json(&offset_date(2), 1));
        run(refresh_cache(
            &cache,
            &good,
            UA,
            MAX_OVERLAY_BYTES,
            REQUEST_TIMEOUT,
            &test_key(),
        ))
        .expect("seed cache");
        let before = std::fs::read(&cache).expect("read cache");

        let bad = write_signed_source(
            dir.path(),
            "bad.json",
            &overlay_json(&offset_date(2), 0).replace("\"as_of\"", "\"as_of_x\""),
        );
        let err = run(refresh_cache(
            &cache,
            &bad,
            UA,
            MAX_OVERLAY_BYTES,
            REQUEST_TIMEOUT,
            &test_key(),
        ))
        .expect_err("invalid");

        assert!(matches!(err, WorldOverlayError::Invalid(_)), "got {err:?}");
        assert_eq!(std::fs::read(&cache).expect("read cache"), before);
    }

    #[test]
    fn refresh_rejects_overlay_with_empty_op_id() {
        let dir = tempfile::tempdir().expect("tempdir");
        let cache = dir.path().join(CACHE_FILE);
        let doc = overlay_json(&offset_date(1), 1).replace("\"id\":\"p0\"", "\"id\":\"\"");
        let source = write_signed_source(dir.path(), "empty-id.json", &doc);

        let err = run(refresh_cache(
            &cache,
            &source,
            UA,
            MAX_OVERLAY_BYTES,
            REQUEST_TIMEOUT,
            &test_key(),
        ))
        .expect_err("invalid");

        assert!(matches!(err, WorldOverlayError::Invalid(_)), "got {err:?}");
        assert!(!cache.exists());
    }

    #[test]
    fn refresh_rejects_non_utf8_payload() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("binary.json");
        std::fs::write(&path, [0xff, 0xfe, 0x00]).expect("write");
        std::fs::write(
            signature_path(&path),
            signature_for(&signing_key(9), &[0xff, 0xfe, 0x00]),
        )
        .expect("write signature");

        let err = run(refresh_cache(
            &dir.path().join(CACHE_FILE),
            &path.to_string_lossy(),
            UA,
            MAX_OVERLAY_BYTES,
            REQUEST_TIMEOUT,
            &test_key(),
        ))
        .expect_err("non utf8");

        assert!(matches!(err, WorldOverlayError::Invalid(_)), "got {err:?}");
    }

    #[test]
    fn oversized_source_is_rejected_by_the_size_cap() {
        let dir = tempfile::tempdir().expect("tempdir");
        let doc = overlay_json(&offset_date(2), 50);
        let source = write_signed_source(dir.path(), "big.json", &doc);
        let cache = dir.path().join(CACHE_FILE);

        let err = run(refresh_cache(
            &cache,
            &source,
            UA,
            doc.len() - 1,
            REQUEST_TIMEOUT,
            &test_key(),
        ))
        .expect_err("too large");

        assert!(
            matches!(err, WorldOverlayError::TooLarge { .. }),
            "got {err:?}"
        );
        assert!(!cache.exists());
    }

    #[test]
    fn source_exactly_at_the_cap_is_accepted() {
        let dir = tempfile::tempdir().expect("tempdir");
        let doc = overlay_json(&offset_date(2), 5);
        let source = write_signed_source(dir.path(), "exact.json", &doc);

        let info = run(refresh_cache(
            &dir.path().join(CACHE_FILE),
            &source,
            UA,
            doc.len(),
            REQUEST_TIMEOUT,
            &test_key(),
        ))
        .expect("at the cap");

        assert!(info.updated);
    }

    #[test]
    fn plain_http_sources_are_refused_without_a_request() {
        let err = run(fetch_overlay_bytes(
            "http://example.test/roster-overlay.json",
            UA,
            MAX_OVERLAY_BYTES,
            REQUEST_TIMEOUT,
        ))
        .expect_err("http refused");
        assert!(
            matches!(err, WorldOverlayError::InsecureSource(_)),
            "got {err:?}"
        );
    }

    #[test]
    fn describe_source_keeps_only_scheme_and_host() {
        assert_eq!(
            describe_source("https://user:s3cret@example.test:8443/a/b.json?token=abc#frag"),
            "https://example.test"
        );
        assert_eq!(
            describe_source("/home/me/private/overlay.json"),
            "local file"
        );
        assert_eq!(describe_source("C:\\Users\\me\\overlay.json"), "local file");
    }

    #[test]
    fn insecure_source_error_does_not_leak_credentials_or_query() {
        let err = run(fetch_overlay_bytes(
            "http://user:s3cret@example.test/overlay.json?token=abc",
            UA,
            MAX_OVERLAY_BYTES,
            REQUEST_TIMEOUT,
        ))
        .expect_err("http refused");
        let message = err.to_string();
        assert!(
            !message.contains("s3cret") && !message.contains("token"),
            "{message}"
        );
    }

    #[test]
    fn oversized_cache_file_is_ignored() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join(CACHE_FILE);
        // Valid JSON padded with whitespace past the cap.
        let padding = " ".repeat(MAX_OVERLAY_BYTES);
        std::fs::write(&path, format!("{}{padding}", overlay_json("2026-09-01", 0)))
            .expect("write");
        assert!(read_cached_overlay(&path, &test_key()).is_none());
    }

    #[test]
    fn cache_file_within_the_cap_is_read() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join(CACHE_FILE);
        write_signed_cache(&path, &overlay_json("2026-09-01", 0));
        assert!(read_cached_overlay(&path, &test_key()).is_some());
    }

    #[test]
    fn missing_local_source_is_an_io_error() {
        let dir = tempfile::tempdir().expect("tempdir");
        let err = run(refresh_cache(
            &dir.path().join(CACHE_FILE),
            &dir.path().join("nope.json").to_string_lossy(),
            UA,
            MAX_OVERLAY_BYTES,
            REQUEST_TIMEOUT,
            &test_key(),
        ))
        .expect_err("missing source");
        assert!(matches!(err, WorldOverlayError::Io(_)), "got {err:?}");
    }

    #[test]
    fn atomic_write_creates_directory_and_leaves_no_temp_files() {
        let dir = tempfile::tempdir().expect("tempdir");
        let target = dir.path().join("world").join(CACHE_FILE);

        write_atomically(&target, b"first").expect("write");
        write_atomically(&target, b"second").expect("overwrite");

        assert_eq!(std::fs::read(&target).expect("read"), b"second");
        let leftovers: Vec<_> = std::fs::read_dir(target.parent().expect("parent"))
            .expect("read_dir")
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name() != CACHE_FILE)
            .collect();
        assert!(leftovers.is_empty(), "temp files left: {leftovers:?}");
    }

    #[test]
    fn failed_rename_keeps_target_and_cleans_temp_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        // A directory at the target makes the final rename fail.
        let target = dir.path().join(CACHE_FILE);
        std::fs::create_dir(&target).expect("mkdir");

        let err = write_atomically(&target, b"new").expect_err("rename must fail");

        assert!(matches!(err, WorldOverlayError::Io(_)));
        assert!(target.is_dir());
        let entries = std::fs::read_dir(dir.path()).expect("read_dir").count();
        assert_eq!(entries, 1, "only the target should remain");
    }

    #[cfg(unix)]
    #[test]
    fn failed_write_leaves_the_previous_cache_intact() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().expect("tempdir");
        let target = dir.path().join(CACHE_FILE);
        write_atomically(&target, b"old").expect("seed");
        std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o555))
            .expect("chmod");

        let result = write_atomically(&target, b"new");

        std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o755))
            .expect("restore");
        // Root ignores directory permissions, so only assert when the write failed.
        if result.is_err() {
            assert_eq!(std::fs::read(&target).expect("read"), b"old");
        }
    }

    #[test]
    fn info_counts_ops_and_serializes_origin_lowercase() {
        let resolved = select_overlay(
            WorldOverlay::parse(&overlay_json("2026-06-22", 3)).expect("overlay"),
            None,
        );
        let value = serde_json::to_value(resolved.info(false)).expect("serialize");
        assert_eq!(value["origin"], "bundled");
        assert_eq!(value["player_ops"], 3);
        assert_eq!(value["staff_ops"], 0);
        assert_eq!(value["source"]["license"], "CC BY-SA 3.0");
        assert_eq!(value["updated"], false);
    }
}
