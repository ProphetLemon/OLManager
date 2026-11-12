//! Custom club badge and founder photo upload: the commands the club wizard
//! calls to validate and normalize an uploaded PNG before it is previewed and
//! sent with the spec.

use olm_core::custom_logo;

/// Validates and re-encodes `data_uri` (invoked from JS as `dataUri`), returning
/// the exact `data:image/png;base64,...` string that would be stored as the
/// club's logo. Errors are the JSON wire form of
/// [`custom_logo::LogoError`]: `{"kind":"invalid_logo","reason":"..."}`.
#[tauri::command]
pub async fn prepare_custom_logo(data_uri: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        custom_logo::normalize_logo(&data_uri).map_err(custom_logo::LogoError::to_wire)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Validates and re-encodes a founder's photo (`data_uri`, invoked from JS as
/// `dataUri`) into the square `data:image/png;base64,...` string that would be
/// stored as the player's `profile_image_url`. Errors are the JSON wire form
/// `{"kind":"invalid_portrait","reason":"..."}`; the reasons are those of
/// [`custom_logo::LogoError`].
#[tauri::command]
pub async fn prepare_custom_portrait(data_uri: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        custom_logo::normalize_portrait(&data_uri).map_err(custom_logo::LogoError::to_portrait_wire)
    })
    .await
    .map_err(|error| error.to_string())?
}
