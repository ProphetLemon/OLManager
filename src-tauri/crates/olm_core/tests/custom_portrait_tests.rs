use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use olm_core::custom_logo::{
    LogoError, MAX_INPUT_BASE64_LEN, MAX_PORTRAIT_PNG_BYTES, MAX_PORTRAIT_SIDE,
    PNG_DATA_URI_PREFIX, TARGET_PORTRAIT_PNG_BYTES, normalize_logo, normalize_portrait,
};
use png::{BitDepth, ColorType, Decoder, Encoder};

fn encode_rgba(width: u32, height: u32, data: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut encoder = Encoder::new(&mut out, width, height);
    encoder.set_color(ColorType::Rgba);
    encoder.set_depth(BitDepth::Eight);
    let mut writer = encoder.write_header().unwrap();
    writer.write_image_data(data).unwrap();
    writer.finish().unwrap();
    out
}

fn uri(png: &[u8]) -> String {
    format!("{PNG_DATA_URI_PREFIX}{}", STANDARD.encode(png))
}

fn solid(width: u32, height: u32, pixel: [u8; 4]) -> String {
    let data: Vec<u8> = (0..width * height).flat_map(|_| pixel).collect();
    uri(&encode_rgba(width, height, &data))
}

/// `bands` vertical stripes of equal width, left to right.
fn vertical_bands(width: u32, height: u32, bands: &[[u8; 4]]) -> String {
    let band_width = width / u32::try_from(bands.len()).unwrap();
    let mut data = Vec::new();
    for _ in 0..height {
        for x in 0..width {
            let index = usize::try_from((x / band_width).min(bands.len() as u32 - 1)).unwrap();
            data.extend_from_slice(&bands[index]);
        }
    }
    uri(&encode_rgba(width, height, &data))
}

/// Pseudo random bytes do not compress: the worst case for the output size.
fn noise(width: u32, height: u32) -> String {
    let mut state = 0x2545_F491u32;
    let data: Vec<u8> = (0..width * height * 4)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            state.to_le_bytes()[0]
        })
        .collect();
    uri(&encode_rgba(width, height, &data))
}

struct Decoded {
    width: u32,
    height: u32,
    pixels: Vec<u8>,
}

fn stored_bytes(output: &str) -> Vec<u8> {
    STANDARD
        .decode(
            output
                .strip_prefix(PNG_DATA_URI_PREFIX)
                .expect("png prefix"),
        )
        .unwrap()
}

fn decode(output: &str) -> Decoded {
    let mut reader = Decoder::new(std::io::Cursor::new(stored_bytes(output)))
        .read_info()
        .unwrap();
    let mut buffer = vec![0; reader.output_buffer_size().unwrap()];
    let info = reader.next_frame(&mut buffer).unwrap();
    assert_eq!(info.color_type, ColorType::Rgba);
    assert_eq!(info.bit_depth, BitDepth::Eight);
    buffer.truncate(info.buffer_size());
    Decoded {
        width: info.width,
        height: info.height,
        pixels: buffer,
    }
}

fn chunk_types(output: &str) -> Vec<String> {
    let bytes = stored_bytes(output);
    let mut types = Vec::new();
    let mut at = 8;
    while at + 8 <= bytes.len() {
        let len = u32::from_be_bytes(bytes[at..at + 4].try_into().unwrap()) as usize;
        types.push(String::from_utf8_lossy(&bytes[at + 4..at + 8]).into_owned());
        at += 12 + len;
    }
    types
}

#[test]
fn a_wide_photo_comes_out_square() {
    let image = decode(&normalize_portrait(&solid(300, 150, [10, 20, 30, 255])).unwrap());

    assert_eq!((image.width, image.height), (150, 150));
}

#[test]
fn a_tall_photo_comes_out_square() {
    let image = decode(&normalize_portrait(&solid(100, 300, [10, 20, 30, 255])).unwrap());

    assert_eq!((image.width, image.height), (100, 100));
}

#[test]
fn a_large_photo_is_fitted_to_the_portrait_side() {
    let image = decode(&normalize_portrait(&solid(1_000, 800, [90, 80, 70, 255])).unwrap());

    assert_eq!(
        (image.width, image.height),
        (MAX_PORTRAIT_SIDE, MAX_PORTRAIT_SIDE)
    );
}

#[test]
fn a_small_square_photo_is_never_upscaled() {
    let image = decode(&normalize_portrait(&solid(40, 40, [1, 2, 3, 255])).unwrap());

    assert_eq!((image.width, image.height), (40, 40));
}

#[test]
fn the_centre_of_the_photo_is_kept() {
    let red = [255, 0, 0, 255];
    let green = [0, 255, 0, 255];
    let blue = [0, 0, 255, 255];

    let image =
        decode(&normalize_portrait(&vertical_bands(300, 100, &[red, green, blue])).unwrap());

    assert_eq!((image.width, image.height), (100, 100));
    assert!(
        image
            .pixels
            .as_chunks::<4>()
            .0
            .iter()
            .all(|px| *px == green)
    );
}

#[test]
fn a_noisy_photo_steps_down_to_fit_the_stored_size_target() {
    let output = normalize_portrait(&noise(300, 300)).unwrap();

    let stored = stored_bytes(&output).len();
    let image = decode(&output);
    assert!(stored <= TARGET_PORTRAIT_PNG_BYTES, "{stored}");
    assert!(stored <= MAX_PORTRAIT_PNG_BYTES);
    assert_eq!(image.width, image.height);
    assert!(
        image.width < MAX_PORTRAIT_SIDE && image.width >= 64,
        "{}",
        image.width
    );
}

#[test]
fn only_the_pixel_chunks_survive() {
    assert_eq!(
        chunk_types(&normalize_portrait(&solid(30, 20, [1, 2, 3, 255])).unwrap()),
        ["IHDR", "IDAT", "IEND"]
    );
}

#[test]
fn the_output_is_deterministic_and_stable_when_normalized_again() {
    let input = noise(300, 220);

    let first = normalize_portrait(&input).unwrap();

    assert_eq!(normalize_portrait(&input).unwrap(), first);
    assert_eq!(normalize_portrait(&first).unwrap(), first);
}

#[test]
fn a_jpeg_svg_or_url_is_not_an_image_it_accepts() {
    for input in [
        "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
        "data:image/svg+xml;base64,PHN2Zy8+",
        "https://example.com/photo.png",
        "/home/user/photo.png",
    ] {
        assert_eq!(normalize_portrait(input), Err(LogoError::NotPng), "{input}");
    }
}

#[test]
fn bytes_that_are_not_a_png_are_refused() {
    let input = format!("{PNG_DATA_URI_PREFIX}{}", STANDARD.encode(b"<svg></svg>"));

    assert_eq!(normalize_portrait(&input), Err(LogoError::Malformed));
}

#[test]
fn empty_input_is_refused() {
    assert_eq!(normalize_portrait("  "), Err(LogoError::Empty));
}

#[test]
fn an_oversized_payload_is_refused_before_decoding() {
    let input = format!(
        "{PNG_DATA_URI_PREFIX}{}",
        "A".repeat(MAX_INPUT_BASE64_LEN + 1)
    );

    assert_eq!(normalize_portrait(&input), Err(LogoError::TooLarge));
}

#[test]
fn a_photo_wider_than_the_input_limit_is_refused() {
    let input = solid(1_025, 10, [0, 0, 0, 255]);

    assert_eq!(normalize_portrait(&input), Err(LogoError::TooBigDimensions));
}

#[test]
fn a_truncated_png_is_refused() {
    let full = stored_bytes(&solid(20, 20, [5, 5, 5, 255]));

    assert_eq!(
        normalize_portrait(&uri(&full[..full.len() / 2])),
        Err(LogoError::Malformed)
    );
}

#[test]
fn the_portrait_wire_form_names_a_portrait_and_the_logo_wire_form_is_unchanged() {
    assert_eq!(
        LogoError::TooLarge.to_portrait_wire(),
        r#"{"kind":"invalid_portrait","reason":"too_large"}"#
    );
    assert_eq!(
        LogoError::TooLarge.to_wire(),
        r#"{"kind":"invalid_logo","reason":"too_large"}"#
    );
}

#[test]
fn the_logo_keeps_its_aspect_ratio_where_a_portrait_is_cropped_square() {
    let input = solid(300, 150, [10, 20, 30, 255]);

    let logo = decode(&normalize_logo(&input).unwrap());
    let portrait = decode(&normalize_portrait(&input).unwrap());

    assert_eq!((logo.width, logo.height), (256, 128));
    assert_eq!((portrait.width, portrait.height), (150, 150));
}
