//! Release lookup for platforms the updater plugin cannot serve.
//!
//! `tauri-plugin-updater` has no Android target, and its own TLS client panics
//! there ("Expect rustls-platform-verifier to be initialized"). This command
//! reads the version out of the same `latest.json` with the app's own reqwest
//! client (rustls with bundled roots), which does work on Android. It only
//! reports the published version; downloading and installing stay elsewhere.

use std::time::Duration;

use serde::Deserialize;

/// The manifest the updater plugin reads; a test pins it to `tauri.conf.json`.
const LATEST_RELEASE_URL: &str =
    "https://github.com/ProphetLemon/OLManager/releases/latest/download/latest.json";
/// A manifest is a few KiB; the cap only bounds a hostile or broken response.
const MAX_MANIFEST_BYTES: usize = 64 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Deserialize)]
struct Manifest {
    version: String,
}

/// Pull the `version` field out of a `latest.json` body.
fn parse_manifest_version(body: &[u8]) -> Result<String, String> {
    let manifest: Manifest =
        serde_json::from_slice(body).map_err(|err| format!("invalid release manifest: {err}"))?;
    Ok(manifest.version)
}

async fn fetch_manifest(url: &str, user_agent: &str) -> Result<Vec<u8>, String> {
    // The overlay client follows GitHub's release-download redirect and refuses
    // anything that is not https, which is exactly what this request needs.
    let client = super::world_overlay::overlay_client_builder(user_agent, REQUEST_TIMEOUT)
        .build()
        .map_err(|err| format!("release check failed: {}", err.without_url()))?;
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|err| format!("release check failed: {}", err.without_url()))?;
    if !response.status().is_success() {
        return Err(format!(
            "release check failed: HTTP {}",
            response.status().as_u16()
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_MANIFEST_BYTES as u64)
    {
        return Err("release manifest is too large".to_string());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|err| format!("release check failed: {}", err.without_url()))?
    {
        if bytes.len() + chunk.len() > MAX_MANIFEST_BYTES {
            return Err("release manifest is too large".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

/// The version published in the fork's latest release manifest.
#[tauri::command]
pub async fn latest_release_version(app_handle: tauri::AppHandle) -> Result<String, String> {
    let user_agent = format!("OLManager/{}", app_handle.package_info().version);
    let body = fetch_manifest(LATEST_RELEASE_URL, &user_agent).await?;
    parse_manifest_version(&body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_manifest_version_returns_the_version_of_a_valid_manifest() {
        let body = br#"{"version":"2026.1122.1","notes":"x","platforms":{}}"#;
        assert_eq!(parse_manifest_version(body).unwrap(), "2026.1122.1");
    }

    #[test]
    fn parse_manifest_version_rejects_a_manifest_without_version() {
        let err = parse_manifest_version(br#"{"notes":"x"}"#).unwrap_err();
        assert!(err.contains("version"), "unexpected error: {err}");
    }

    #[test]
    fn parse_manifest_version_rejects_invalid_json() {
        assert!(parse_manifest_version(b"<html>Not Found</html>").is_err());
    }

    #[test]
    fn latest_release_url_matches_the_updater_endpoint_in_tauri_conf() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
        assert_eq!(
            conf["plugins"]["updater"]["endpoints"][0].as_str(),
            Some(LATEST_RELEASE_URL)
        );
    }
}
