/// Utilities for manager avatar file management.
/// All filename validation happens here to prevent path traversal attacks.
use crate::error::AppError;

/// Validate and sanitize an avatar filename to prevent path traversal.
/// Accepts only safe filenames with allowed image extensions,
/// rejects any path separators, null bytes, or parent directory references.
#[allow(dead_code)] // Path-traversal sanitizer kept for the avatar import flow; not wired yet.
pub fn safe_avatar_filename(input: &str) -> Result<String, AppError> {
    let bytes = input.as_bytes();
    if input.is_empty() || input.len() > 128 {
        return Err(AppError::Validation(
            "Invalid avatar filename length".into(),
        ));
    }
    if bytes.iter().any(|&b| b == b'/' || b == b'\\' || b == 0) {
        return Err(AppError::Validation(
            "Avatar filename contains invalid characters".into(),
        ));
    }
    if input.contains("..") || input.starts_with('.') {
        return Err(AppError::Validation(
            "Avatar filename contains path traversal".into(),
        ));
    }
    let ext_ok = matches!(
        input.rsplit('.').next(),
        Some("png") | Some("jpg") | Some("jpeg") | Some("webp")
    );
    if !ext_ok {
        return Err(AppError::Validation(
            "Unsupported avatar file extension (use png, jpg, jpeg, webp)".into(),
        ));
    }
    Ok(input.to_string())
}
