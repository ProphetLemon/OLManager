//! Ed25519 verification of the roster overlay.
//!
//! The maintainer signs the exact bytes of `assets/world/roster-overlay.json`; the detached
//! signature lives next to it as `roster-overlay.json.sig` (base64 of the 64-byte signature, one
//! trailing newline allowed). The app embeds the matching public key and verifies before it parses
//! or caches anything. Pure: no I/O.

use std::fmt;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use ed25519_dalek::{Signature, VerifyingKey};

/// Base64 of the raw 32-byte public key the shipped app trusts.
const EMBEDDED_PUBLIC_KEY_B64: &str =
    include_str!("../../../../assets/world/overlay-signing-key.pub");

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SignatureError {
    /// The public key is not valid base64 of a valid 32-byte Ed25519 key.
    BadPublicKey,
    /// The signature is not base64 of exactly 64 bytes.
    Malformed,
    /// The signature does not match the bytes under the key.
    Invalid,
}

impl fmt::Display for SignatureError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::BadPublicKey => write!(f, "the overlay public key is malformed"),
            Self::Malformed => write!(f, "the overlay signature is malformed"),
            Self::Invalid => write!(f, "the overlay signature does not match the overlay"),
        }
    }
}

impl std::error::Error for SignatureError {}

/// The public key overlays must be signed with.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OverlayPublicKey(VerifyingKey);

impl OverlayPublicKey {
    /// Parse a base64 raw 32-byte key (surrounding whitespace allowed).
    pub fn from_base64(text: &str) -> Result<Self, SignatureError> {
        let raw = STANDARD
            .decode(text.trim())
            .map_err(|_| SignatureError::BadPublicKey)?;
        let raw: [u8; 32] = raw.try_into().map_err(|_| SignatureError::BadPublicKey)?;
        VerifyingKey::from_bytes(&raw)
            .map(Self)
            .map_err(|_| SignatureError::BadPublicKey)
    }

    /// The key compiled into this build.
    pub fn embedded() -> Result<Self, SignatureError> {
        Self::from_base64(EMBEDDED_PUBLIC_KEY_B64)
    }
}

/// Verify `signature` (base64 text of the 64-byte signature) over the exact overlay `bytes`.
pub fn verify_overlay_signature(
    bytes: &[u8],
    signature: &[u8],
    key: &OverlayPublicKey,
) -> Result<(), SignatureError> {
    let text = std::str::from_utf8(signature).map_err(|_| SignatureError::Malformed)?;
    let raw = STANDARD
        .decode(text.trim())
        .map_err(|_| SignatureError::Malformed)?;
    let raw: [u8; 64] = raw.try_into().map_err(|_| SignatureError::Malformed)?;
    key.0
        .verify_strict(bytes, &Signature::from_bytes(&raw))
        .map_err(|_| SignatureError::Invalid)
}

/// Verify against the embedded key.
pub fn verify_with_embedded_key(bytes: &[u8], signature: &[u8]) -> Result<(), SignatureError> {
    verify_overlay_signature(bytes, signature, &OverlayPublicKey::embedded()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    const BUNDLED_OVERLAY: &[u8] = include_bytes!("../../../../assets/world/roster-overlay.json");
    const BUNDLED_SIGNATURE: &[u8] =
        include_bytes!("../../../../assets/world/roster-overlay.json.sig");

    fn keypair(seed: u8) -> (SigningKey, OverlayPublicKey) {
        let signing = SigningKey::from_bytes(&[seed; 32]);
        let public = OverlayPublicKey(signing.verifying_key());
        (signing, public)
    }

    fn sign(key: &SigningKey, bytes: &[u8]) -> String {
        format!("{}\n", STANDARD.encode(key.sign(bytes).to_bytes()))
    }

    #[test]
    fn a_valid_signature_is_accepted() {
        let (signing, public) = keypair(1);
        let sig = sign(&signing, b"overlay");
        assert_eq!(
            verify_overlay_signature(b"overlay", sig.as_bytes(), &public),
            Ok(())
        );
    }

    #[test]
    fn a_tampered_byte_is_rejected() {
        let (signing, public) = keypair(1);
        let sig = sign(&signing, b"overlay");
        assert_eq!(
            verify_overlay_signature(b"overlaz", sig.as_bytes(), &public),
            Err(SignatureError::Invalid)
        );
    }

    #[test]
    fn a_signature_from_another_key_is_rejected() {
        let (signing, _) = keypair(1);
        let (_, other_public) = keypair(2);
        let sig = sign(&signing, b"overlay");
        assert_eq!(
            verify_overlay_signature(b"overlay", sig.as_bytes(), &other_public),
            Err(SignatureError::Invalid)
        );
    }

    #[test]
    fn malformed_signatures_are_rejected() {
        let (_, public) = keypair(1);
        for bad in [&b""[..], b"not base64!!", b"AAAA", &[0xff, 0xfe][..]] {
            assert_eq!(
                verify_overlay_signature(b"overlay", bad, &public),
                Err(SignatureError::Malformed),
                "{bad:?}"
            );
        }
    }

    #[test]
    fn public_key_parsing_rejects_garbage() {
        assert_eq!(
            OverlayPublicKey::from_base64("%%%"),
            Err(SignatureError::BadPublicKey)
        );
        assert_eq!(
            OverlayPublicKey::from_base64("AAAA"),
            Err(SignatureError::BadPublicKey)
        );
    }

    #[test]
    fn the_embedded_key_is_valid() {
        assert!(OverlayPublicKey::embedded().is_ok());
    }

    #[test]
    fn the_committed_bundled_overlay_verifies_with_the_embedded_key() {
        assert_eq!(
            verify_with_embedded_key(BUNDLED_OVERLAY, BUNDLED_SIGNATURE),
            Ok(())
        );
    }

    #[test]
    fn the_embedded_key_rejects_a_tampered_bundled_overlay() {
        let mut tampered = BUNDLED_OVERLAY.to_vec();
        tampered.push(b' ');
        assert_eq!(
            verify_with_embedded_key(&tampered, BUNDLED_SIGNATURE),
            Err(SignatureError::Invalid)
        );
    }
}
