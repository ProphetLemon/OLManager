//! Custom club badge upload: validation and normalization of a user supplied
//! PNG.
//!
//! The browser re-encodes whatever the user picked to a PNG, but the backend
//! never trusts that. [`normalize_logo`] fully decodes the submitted data URI,
//! rejects everything that is not a PNG, bounds the input size and the image
//! dimensions *before* any pixel is decoded (decompression bombs), downsizes
//! to at most [`MAX_LOGO_SIDE`] pixels per side with area averaging on
//! premultiplied alpha (stepping the box down further when the encoded PNG
//! would exceed [`TARGET_OUTPUT_PNG_BYTES`]), and re-encodes a fresh RGBA8 PNG that carries only
//! `IHDR`, `IDAT` and `IEND` chunks (no text, time, colour profile or EXIF
//! metadata). The result is a `data:image/png;base64,...` URI that is stored in
//! `Team::logo_url`; its size is bounded, so it can ride in every `Game`
//! returned to the frontend and in saves.
//!
//! SVG is never accepted: only the exact `data:image/png;base64,` prefix passes.
//!
//! The same pipeline also prepares a founder's profile photo
//! ([`normalize_portrait`]): the image is first cropped to a centred square, then
//! fitted to [`MAX_PORTRAIT_SIDE`] with a tighter byte budget, because up to five
//! portraits ride in every `Game` and save next to the logo. The logo keeps its
//! own limits and output byte for byte.
//!
//! The module is pure and never panics on hostile input: decoded data is only
//! read through checked arithmetic and iterators.

use std::io::Cursor;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use png::{BitDepth, ColorType, Decoder, Encoder, Limits, Transformations};
use serde::Serialize;

/// The only accepted data URI prefix.
pub const PNG_DATA_URI_PREFIX: &str = "data:image/png;base64,";
/// Longest accepted base64 payload, in bytes of text (about 525 KB of PNG).
pub const MAX_INPUT_BASE64_LEN: usize = 700_000;
/// Widest and tallest accepted input image, in pixels.
pub const MAX_INPUT_SIDE: u32 = 1_024;
/// Widest and tallest stored logo, in pixels.
pub const MAX_LOGO_SIDE: u32 = 256;
/// Upper bound for the stored PNG, in bytes. The step-down below keeps the
/// result far under it, so this is a defensive check, not a quality knob.
pub const MAX_OUTPUT_PNG_BYTES: usize = 400_000;
/// Size the stored PNG should stay under. The logo is cloned and serialized in
/// every `Game` sent to the frontend and in each save, so a noisy image is
/// shrunk through [`LOGO_SIDE_STEPS`] until it fits. Flat logos stay at 256.
pub const TARGET_OUTPUT_PNG_BYTES: usize = 100_000;
/// Boxes tried in order, largest first; the first whose PNG fits the target wins.
const LOGO_SIDE_STEPS: [u32; 5] = [MAX_LOGO_SIDE, 192, 128, 96, 64];
/// Side of a stored founder photo, in pixels. The largest avatar in the app is
/// the 96 px profile card, so 192 px covers it on a 2x display.
pub const MAX_PORTRAIT_SIDE: u32 = 192;
/// Upper bound for a stored portrait PNG, in bytes (defensive, like
/// [`MAX_OUTPUT_PNG_BYTES`]).
pub const MAX_PORTRAIT_PNG_BYTES: usize = 120_000;
/// Size a stored portrait should stay under: five of them ride in every `Game`,
/// so a noisy photo is shrunk through [`PORTRAIT_SIDE_STEPS`] until it fits.
pub const TARGET_PORTRAIT_PNG_BYTES: usize = 64_000;
/// Square sides tried in order, largest first, for a portrait.
const PORTRAIT_SIDE_STEPS: [u32; 5] = [MAX_PORTRAIT_SIDE, 160, 128, 96, 64];
/// Secondary cap handed to the PNG decoder for its intermediate buffers. It does
/// not bound the pixel buffer: that is bounded by the [`MAX_INPUT_SIDE`] header
/// check, which runs before the frame buffer is allocated, and by the input cap.
const DECODER_LIMIT_BYTES: usize = 16 * 1024 * 1024;
const CHANNELS: usize = 4;

/// Why a submitted logo was rejected.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, thiserror::Error)]
#[serde(rename_all = "snake_case")]
pub enum LogoError {
    /// The input is empty or only whitespace.
    #[error("empty")]
    Empty,
    /// The input is not a `data:image/png;base64,` URI.
    #[error("not_png")]
    NotPng,
    /// The base64 payload exceeds [`MAX_INPUT_BASE64_LEN`] or the result is
    /// still above [`MAX_OUTPUT_PNG_BYTES`].
    #[error("too_large")]
    TooLarge,
    /// Invalid base64, or a PNG that is truncated, corrupt or unsupported.
    #[error("malformed")]
    Malformed,
    /// The image is empty or wider/taller than [`MAX_INPUT_SIDE`].
    #[error("too_big_dimensions")]
    TooBigDimensions,
}

impl LogoError {
    /// Machine readable reason, stable across releases.
    pub fn reason(self) -> &'static str {
        match self {
            Self::Empty => "empty",
            Self::NotPng => "not_png",
            Self::TooLarge => "too_large",
            Self::Malformed => "malformed",
            Self::TooBigDimensions => "too_big_dimensions",
        }
    }

    /// JSON wire form `{"kind":"invalid_logo","reason":"..."}`.
    pub fn to_wire(self) -> String {
        format!(r#"{{"kind":"invalid_logo","reason":"{}"}}"#, self.reason())
    }

    /// JSON wire form `{"kind":"invalid_portrait","reason":"..."}`, for a
    /// founder photo.
    pub fn to_portrait_wire(self) -> String {
        format!(
            r#"{{"kind":"invalid_portrait","reason":"{}"}}"#,
            self.reason()
        )
    }
}

/// What differs between the images this module prepares.
struct ImageProfile {
    /// Crop to a centred square before fitting.
    square: bool,
    /// Boxes tried in order, largest first.
    side_steps: &'static [u32],
    /// Size the encoded PNG should stay under.
    target_bytes: usize,
    /// Size the encoded PNG must never exceed.
    max_bytes: usize,
}

const LOGO_PROFILE: ImageProfile = ImageProfile {
    square: false,
    side_steps: &LOGO_SIDE_STEPS,
    target_bytes: TARGET_OUTPUT_PNG_BYTES,
    max_bytes: MAX_OUTPUT_PNG_BYTES,
};

const PORTRAIT_PROFILE: ImageProfile = ImageProfile {
    square: true,
    side_steps: &PORTRAIT_SIDE_STEPS,
    target_bytes: TARGET_PORTRAIT_PNG_BYTES,
    max_bytes: MAX_PORTRAIT_PNG_BYTES,
};

/// Validates `input` and returns the normalized `data:image/png;base64,...`
/// URI. Deterministic: the same pixels always produce the same string.
pub fn normalize_logo(input: &str) -> Result<String, LogoError> {
    normalize_with(input, &LOGO_PROFILE)
}

/// Validates a founder's photo like [`normalize_logo`] validates a badge, then
/// returns a square `data:image/png;base64,...` URI of at most
/// [`MAX_PORTRAIT_SIDE`] pixels per side: the centre of the image is kept.
pub fn normalize_portrait(input: &str) -> Result<String, LogoError> {
    normalize_with(input, &PORTRAIT_PROFILE)
}

fn normalize_with(input: &str, profile: &ImageProfile) -> Result<String, LogoError> {
    let input = input.trim();
    if input.is_empty() {
        return Err(LogoError::Empty);
    }
    let payload = input
        .strip_prefix(PNG_DATA_URI_PREFIX)
        .ok_or(LogoError::NotPng)?;
    if payload.len() > MAX_INPUT_BASE64_LEN {
        return Err(LogoError::TooLarge);
    }
    let bytes = STANDARD.decode(payload).map_err(|_| LogoError::Malformed)?;

    let decoded = decode_rgba(&bytes)?;
    let image = if profile.square {
        crop_center_square(&decoded)?
    } else {
        decoded
    };
    let png = encode_within_budget(&image, profile)?;
    if png.len() > profile.max_bytes {
        return Err(LogoError::TooLarge);
    }
    Ok(format!("{PNG_DATA_URI_PREFIX}{}", STANDARD.encode(png)))
}

/// An 8-bit RGBA image, row-major, straight (non-premultiplied) alpha.
struct Rgba8 {
    width: u32,
    height: u32,
    pixels: Vec<u8>,
}

fn decode_rgba(bytes: &[u8]) -> Result<Rgba8, LogoError> {
    let mut decoder = Decoder::new_with_limits(
        Cursor::new(bytes),
        Limits {
            bytes: DECODER_LIMIT_BYTES,
        },
    );
    // The header is read first so oversized dimensions are rejected before the
    // decoder allocates anything for the pixel data.
    let (width, height) = {
        let header = decoder
            .read_header_info()
            .map_err(|_| LogoError::Malformed)?;
        header.size()
    };
    if width == 0 || height == 0 || width > MAX_INPUT_SIDE || height > MAX_INPUT_SIDE {
        return Err(LogoError::TooBigDimensions);
    }
    // Palette and low bit depth images expand to 8-bit, 16-bit strips to 8-bit,
    // and a palette always gains an alpha channel.
    decoder.set_transformations(
        Transformations::EXPAND | Transformations::STRIP_16 | Transformations::ALPHA,
    );
    let mut reader = decoder.read_info().map_err(|_| LogoError::Malformed)?;
    let size = reader.output_buffer_size().ok_or(LogoError::Malformed)?;
    let mut buffer = vec![0u8; size];
    let frame = reader
        .next_frame(&mut buffer)
        .map_err(|_| LogoError::Malformed)?;
    if frame.bit_depth != BitDepth::Eight {
        return Err(LogoError::Malformed);
    }
    let raw = buffer
        .get(..frame.buffer_size())
        .ok_or(LogoError::Malformed)?;

    let pixel_count = usize::try_from(width)
        .ok()
        .zip(usize::try_from(height).ok())
        .and_then(|(w, h)| w.checked_mul(h))
        .ok_or(LogoError::Malformed)?;
    let mut pixels = Vec::with_capacity(pixel_count.saturating_mul(CHANNELS));
    match frame.color_type {
        ColorType::Rgba => pixels.extend_from_slice(raw),
        ColorType::Rgb => {
            for px in raw.as_chunks::<3>().0 {
                pixels.extend_from_slice(px);
                pixels.push(u8::MAX);
            }
        }
        ColorType::Grayscale => {
            for &grey in raw {
                pixels.extend_from_slice(&[grey, grey, grey, u8::MAX]);
            }
        }
        ColorType::GrayscaleAlpha => {
            for &[grey, alpha] in raw.as_chunks::<2>().0 {
                pixels.extend_from_slice(&[grey, grey, grey, alpha]);
            }
        }
        // `Transformations::ALPHA` expands palettes; seeing one here means the
        // decoder did not do what was asked.
        ColorType::Indexed => return Err(LogoError::Malformed),
    }
    if pixels.len() != pixel_count.saturating_mul(CHANNELS) {
        return Err(LogoError::Malformed);
    }
    Ok(Rgba8 {
        width,
        height,
        pixels,
    })
}

/// The largest centred square of `image`; the image itself when already square.
fn crop_center_square(image: &Rgba8) -> Result<Rgba8, LogoError> {
    let side = image.width.min(image.height);
    if image.width == image.height {
        return Ok(Rgba8 {
            width: image.width,
            height: image.height,
            pixels: image.pixels.clone(),
        });
    }
    let to_usize = |value: u32| usize::try_from(value).map_err(|_| LogoError::Malformed);
    let stride = to_usize(image.width)?.saturating_mul(CHANNELS);
    let left = to_usize((image.width - side) / 2)?.saturating_mul(CHANNELS);
    let row_bytes = to_usize(side)?.saturating_mul(CHANNELS);
    let top = to_usize((image.height - side) / 2)?;
    let mut pixels = Vec::with_capacity(row_bytes.saturating_mul(to_usize(side)?));
    for row in image
        .pixels
        .chunks_exact(stride)
        .skip(top)
        .take(to_usize(side)?)
    {
        pixels.extend_from_slice(
            row.get(left..left + row_bytes)
                .ok_or(LogoError::Malformed)?,
        );
    }
    if pixels.len() != row_bytes.saturating_mul(to_usize(side)?) {
        return Err(LogoError::Malformed);
    }
    Ok(Rgba8 {
        width: side,
        height: side,
        pixels,
    })
}

/// Size that fits `width` x `height` inside `limit` x `limit` keeping the
/// aspect ratio; never zero and never larger than the input.
fn fitted_size(width: u32, height: u32, limit: u32) -> (u32, u32) {
    let longest = width.max(height);
    if longest <= limit {
        return (width, height);
    }
    let scale = |side: u32| -> u32 {
        let scaled =
            (u64::from(side) * u64::from(limit) + u64::from(longest) / 2) / u64::from(longest);
        u32::try_from(scaled).unwrap_or(limit).clamp(1, limit)
    };
    (scale(width), scale(height))
}

/// Encodes `image` fitted into the largest box of the profile's steps whose PNG
/// stays within its target size. Each box is resampled from the original
/// pixels, so quality does not compound. Deterministic.
fn encode_within_budget(image: &Rgba8, profile: &ImageProfile) -> Result<Vec<u8>, LogoError> {
    let mut last = None;
    for &limit in profile.side_steps {
        let png = encode_rgba(&fit_within(image, limit))?;
        if png.len() <= profile.target_bytes {
            return Ok(png);
        }
        last = Some(png);
    }
    // Even the smallest box missed the target: hand it to the hard cap check.
    last.ok_or(LogoError::Malformed)
}

/// Downscales to fit `limit`, if needed, by exact area averaging on
/// premultiplied alpha, so transparent pixels never darken the edges.
fn fit_within(image: &Rgba8, limit: u32) -> Rgba8 {
    let (dst_w, dst_h) = fitted_size(image.width, image.height, limit);
    if (dst_w, dst_h) == (image.width, image.height) {
        return Rgba8 {
            width: image.width,
            height: image.height,
            pixels: image.pixels.clone(),
        };
    }
    let (src_w, src_h) = (u64::from(image.width), u64::from(image.height));
    let (dw, dh) = (u64::from(dst_w), u64::from(dst_h));
    let src_stride = usize::try_from(image.width)
        .unwrap_or(0)
        .saturating_mul(CHANNELS);
    let mut pixels = Vec::with_capacity(
        usize::try_from(dst_w)
            .unwrap_or(0)
            .saturating_mul(usize::try_from(dst_h).unwrap_or(0))
            .saturating_mul(CHANNELS),
    );
    for dy in 0..dh {
        let y_range = axis_overlaps(dy, dh, src_h);
        for dx in 0..dw {
            let x_range = axis_overlaps(dx, dw, src_w);
            let (mut acc_a, mut acc_r, mut acc_g, mut acc_b, mut acc_w) =
                (0u64, 0u64, 0u64, 0u64, 0u64);
            for &(sy, oy) in &y_range {
                let row = usize::try_from(sy).unwrap_or(0).saturating_mul(src_stride);
                for &(sx, ox) in &x_range {
                    let at = row
                        .saturating_add(usize::try_from(sx).unwrap_or(0).saturating_mul(CHANNELS));
                    let Some(px) = image.pixels.get(at..at.saturating_add(CHANNELS)) else {
                        continue;
                    };
                    let [r, g, b, a] = *px else {
                        continue;
                    };
                    let weight = ox * oy;
                    let alpha_weight = weight * u64::from(a);
                    acc_w += weight;
                    acc_a += alpha_weight;
                    acc_r += alpha_weight * u64::from(r);
                    acc_g += alpha_weight * u64::from(g);
                    acc_b += alpha_weight * u64::from(b);
                }
            }
            if acc_a == 0 || acc_w == 0 {
                pixels.extend_from_slice(&[0, 0, 0, 0]);
                continue;
            }
            let channel = |sum: u64| u8::try_from((sum + acc_a / 2) / acc_a).unwrap_or(u8::MAX);
            let alpha = u8::try_from((acc_a + acc_w / 2) / acc_w).unwrap_or(u8::MAX);
            pixels.extend_from_slice(&[channel(acc_r), channel(acc_g), channel(acc_b), alpha]);
        }
    }
    Rgba8 {
        width: dst_w,
        height: dst_h,
        pixels,
    }
}

/// Source indices overlapping destination cell `index` of `dst_len` cells over
/// `src_len` source cells, with their overlap length. Lengths are measured in
/// units of `1 / (src_len * dst_len)` so the arithmetic stays integral: source
/// cell `s` spans `[s * dst_len, (s + 1) * dst_len)` and destination cell `d`
/// spans `[d * src_len, (d + 1) * src_len)`.
fn axis_overlaps(index: u64, dst_len: u64, src_len: u64) -> Vec<(u64, u64)> {
    let start = index * src_len;
    let end = start + src_len;
    let first = start / dst_len;
    let last = (end - 1) / dst_len;
    (first..=last.min(src_len - 1))
        .filter_map(|s| {
            let lo = start.max(s * dst_len);
            let hi = end.min((s + 1) * dst_len);
            hi.checked_sub(lo).filter(|&o| o > 0).map(|o| (s, o))
        })
        .collect()
}

fn encode_rgba(image: &Rgba8) -> Result<Vec<u8>, LogoError> {
    let mut out = Vec::new();
    let mut encoder = Encoder::new(&mut out, image.width, image.height);
    encoder.set_color(ColorType::Rgba);
    encoder.set_depth(BitDepth::Eight);
    let mut writer = encoder.write_header().map_err(|_| LogoError::Malformed)?;
    writer
        .write_image_data(&image.pixels)
        .map_err(|_| LogoError::Malformed)?;
    writer.finish().map_err(|_| LogoError::Malformed)?;
    Ok(out)
}
