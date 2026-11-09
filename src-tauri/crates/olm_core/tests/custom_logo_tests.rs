use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use olm_core::custom_logo::{
    LogoError, MAX_INPUT_BASE64_LEN, MAX_LOGO_SIDE, PNG_DATA_URI_PREFIX, normalize_logo,
};
use png::{BitDepth, ColorType, Decoder, Encoder};

fn encode(width: u32, height: u32, color: ColorType, depth: BitDepth, data: &[u8]) -> Vec<u8> {
    encode_with(width, height, color, depth, data, |_| {})
}

fn encode_with(
    width: u32,
    height: u32,
    color: ColorType,
    depth: BitDepth,
    data: &[u8],
    configure: impl FnOnce(&mut Encoder<'_, &mut Vec<u8>>),
) -> Vec<u8> {
    let mut out = Vec::new();
    let mut encoder = Encoder::new(&mut out, width, height);
    encoder.set_color(color);
    encoder.set_depth(depth);
    configure(&mut encoder);
    let mut writer = encoder.write_header().unwrap();
    writer.write_image_data(data).unwrap();
    writer.finish().unwrap();
    out
}

fn uri(png: &[u8]) -> String {
    format!("{PNG_DATA_URI_PREFIX}{}", STANDARD.encode(png))
}

fn solid_rgba(width: u32, height: u32, pixel: [u8; 4]) -> Vec<u8> {
    let data: Vec<u8> = (0..width * height).flat_map(|_| pixel).collect();
    encode(width, height, ColorType::Rgba, BitDepth::Eight, &data)
}

struct Decoded {
    width: u32,
    height: u32,
    color: ColorType,
    depth: BitDepth,
    pixels: Vec<u8>,
}

fn decode_output(output: &str) -> Decoded {
    let payload = output
        .strip_prefix(PNG_DATA_URI_PREFIX)
        .expect("png prefix");
    let bytes = STANDARD.decode(payload).unwrap();
    let mut reader = Decoder::new(std::io::Cursor::new(bytes))
        .read_info()
        .unwrap();
    let mut buffer = vec![0; reader.output_buffer_size().unwrap()];
    let info = reader.next_frame(&mut buffer).unwrap();
    buffer.truncate(info.buffer_size());
    Decoded {
        width: info.width,
        height: info.height,
        color: info.color_type,
        depth: info.bit_depth,
        pixels: buffer,
    }
}

fn chunk_types(output: &str) -> Vec<String> {
    let payload = output.strip_prefix(PNG_DATA_URI_PREFIX).unwrap();
    let bytes = STANDARD.decode(payload).unwrap();
    let mut types = Vec::new();
    let mut at = 8;
    while at + 8 <= bytes.len() {
        let len = u32::from_be_bytes(bytes[at..at + 4].try_into().unwrap()) as usize;
        types.push(String::from_utf8_lossy(&bytes[at + 4..at + 8]).into_owned());
        at += 12 + len;
    }
    types
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for &byte in data {
        crc ^= u32::from(byte);
        for _ in 0..8 {
            crc = if crc & 1 == 1 {
                (crc >> 1) ^ 0xEDB8_8320
            } else {
                crc >> 1
            };
        }
    }
    !crc
}

fn push_chunk(out: &mut Vec<u8>, kind: &[u8; 4], body: &[u8]) {
    out.extend_from_slice(&(body.len() as u32).to_be_bytes());
    let mut checked = kind.to_vec();
    checked.extend_from_slice(body);
    out.extend_from_slice(&checked);
    out.extend_from_slice(&crc32(&checked).to_be_bytes());
}

/// A PNG whose header claims `width` x `height` but carries no pixel data.
fn header_only(width: u32, height: u32) -> Vec<u8> {
    let mut out = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    let mut ihdr = Vec::new();
    ihdr.extend_from_slice(&width.to_be_bytes());
    ihdr.extend_from_slice(&height.to_be_bytes());
    ihdr.extend_from_slice(&[8, 6, 0, 0, 0]);
    push_chunk(&mut out, b"IHDR", &ihdr);
    push_chunk(&mut out, b"IEND", &[]);
    out
}

#[test]
fn a_small_png_round_trips_as_rgba() {
    let png = solid_rgba(4, 3, [10, 20, 30, 255]);

    let output = normalize_logo(&uri(&png)).unwrap();

    let image = decode_output(&output);
    assert_eq!((image.width, image.height), (4, 3));
    assert_eq!(
        (image.color, image.depth),
        (ColorType::Rgba, BitDepth::Eight)
    );
    assert!(
        image
            .pixels
            .as_chunks::<4>()
            .0
            .iter()
            .all(|px| *px == [10, 20, 30, 255])
    );
}

#[test]
fn a_wide_image_is_downscaled_keeping_its_aspect_ratio() {
    let png = solid_rgba(1024, 512, [200, 40, 40, 255]);

    let image = decode_output(&normalize_logo(&uri(&png)).unwrap());

    assert_eq!((image.width, image.height), (256, 128));
}

#[test]
fn a_tall_image_is_downscaled_keeping_its_aspect_ratio() {
    let png = solid_rgba(300, 600, [1, 2, 3, 255]);

    let image = decode_output(&normalize_logo(&uri(&png)).unwrap());

    assert_eq!((image.width, image.height), (128, 256));
}

#[test]
fn an_image_within_the_limit_keeps_its_size() {
    let png = solid_rgba(MAX_LOGO_SIDE, 100, [1, 2, 3, 255]);

    let image = decode_output(&normalize_logo(&uri(&png)).unwrap());

    assert_eq!((image.width, image.height), (MAX_LOGO_SIDE, 100));
}

#[test]
fn a_one_pixel_high_strip_never_shrinks_to_zero() {
    let png = solid_rgba(1024, 1, [9, 9, 9, 255]);

    let image = decode_output(&normalize_logo(&uri(&png)).unwrap());

    assert_eq!((image.width, image.height), (256, 1));
}

#[test]
fn downscaling_keeps_the_two_halves_of_a_split_image_apart() {
    // Black left half, white right half: a clean 2:1 ratio keeps both halves.
    let row: Vec<u8> = (0..512)
        .flat_map(|x| {
            if x < 256 {
                [0, 0, 0, 255]
            } else {
                [255, 255, 255, 255]
            }
        })
        .collect();
    let data: Vec<u8> = row.iter().chain(row.iter()).copied().collect();
    let png = encode(512, 2, ColorType::Rgba, BitDepth::Eight, &data);

    let image = decode_output(&normalize_logo(&uri(&png)).unwrap());

    assert_eq!((image.width, image.height), (256, 1));
    assert_eq!(&image.pixels[..4], &[0, 0, 0, 255]);
    assert_eq!(
        &image.pixels[image.pixels.len() - 4..],
        &[255, 255, 255, 255]
    );
}

#[test]
fn downscaling_blends_neighbouring_pixels_into_their_mean() {
    // Alternating black and white pixels average to mid grey at 2:1.
    let row: Vec<u8> = (0..512)
        .flat_map(|x| {
            if x % 2 == 0 {
                [0, 0, 0, 255]
            } else {
                [255, 255, 255, 255]
            }
        })
        .collect();
    let data: Vec<u8> = row.iter().chain(row.iter()).copied().collect();
    let png = encode(512, 2, ColorType::Rgba, BitDepth::Eight, &data);

    let image = decode_output(&normalize_logo(&uri(&png)).unwrap());

    assert!(
        image
            .pixels
            .as_chunks::<4>()
            .0
            .iter()
            .all(|px| *px == [128, 128, 128, 255])
    );
}

#[test]
fn downscaling_does_not_darken_edges_next_to_transparent_pixels() {
    // Opaque red next to fully transparent black: premultiplied averaging keeps
    // the red, with half the alpha.
    let row: Vec<u8> = (0..512)
        .flat_map(|x| {
            if x % 2 == 0 {
                [255, 0, 0, 255]
            } else {
                [0, 0, 0, 0]
            }
        })
        .collect();
    let data: Vec<u8> = row.iter().chain(row.iter()).copied().collect();
    let png = encode(512, 2, ColorType::Rgba, BitDepth::Eight, &data);

    let image = decode_output(&normalize_logo(&uri(&png)).unwrap());

    assert!(
        image
            .pixels
            .as_chunks::<4>()
            .0
            .iter()
            .all(|px| *px == [255, 0, 0, 128])
    );
}

#[test]
fn a_palette_png_is_normalized_to_rgba_with_its_transparency() {
    let png = encode_with(
        2,
        1,
        ColorType::Indexed,
        BitDepth::Eight,
        &[0, 1],
        |encoder| {
            encoder.set_palette(vec![255, 0, 0, 0, 255, 0]);
            encoder.set_trns(vec![255, 0]);
        },
    );

    let image = decode_output(&normalize_logo(&uri(&png)).unwrap());

    assert_eq!(
        (image.color, image.depth),
        (ColorType::Rgba, BitDepth::Eight)
    );
    assert_eq!(image.pixels[..4], [255, 0, 0, 255]);
    assert_eq!(image.pixels[4..], [0, 255, 0, 0]);
}

#[test]
fn a_palette_png_without_transparency_becomes_opaque() {
    let png = encode_with(1, 1, ColorType::Indexed, BitDepth::Eight, &[0], |encoder| {
        encoder.set_palette(vec![1, 2, 3]);
    });

    let image = decode_output(&normalize_logo(&uri(&png)).unwrap());

    assert_eq!(image.pixels, [1, 2, 3, 255]);
}

#[test]
fn a_greyscale_png_is_normalized_to_rgba() {
    let png = encode(2, 1, ColorType::Grayscale, BitDepth::Eight, &[40, 200]);

    let image = decode_output(&normalize_logo(&uri(&png)).unwrap());

    assert_eq!(image.pixels, [40, 40, 40, 255, 200, 200, 200, 255]);
}

#[test]
fn a_greyscale_alpha_png_is_normalized_to_rgba() {
    let png = encode(1, 1, ColorType::GrayscaleAlpha, BitDepth::Eight, &[90, 77]);

    let image = decode_output(&normalize_logo(&uri(&png)).unwrap());

    assert_eq!(image.pixels, [90, 90, 90, 77]);
}

#[test]
fn a_sixteen_bit_png_is_normalized_to_eight_bits() {
    // Samples are big endian; 0xFF00 strips to 0xFF, 0x8000 to 0x80.
    let data = [0xFF, 0x00, 0x80, 0x00, 0x00, 0x00, 0xFF, 0xFF];
    let png = encode(1, 1, ColorType::Rgba, BitDepth::Sixteen, &data);

    let image = decode_output(&normalize_logo(&uri(&png)).unwrap());

    assert_eq!(
        (image.color, image.depth),
        (ColorType::Rgba, BitDepth::Eight)
    );
    assert_eq!(image.pixels, [0xFF, 0x80, 0x00, 0xFF]);
}

#[test]
fn an_svg_data_uri_is_rejected() {
    let svg = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=";

    assert_eq!(normalize_logo(svg), Err(LogoError::NotPng));
}

#[test]
fn a_jpeg_data_uri_is_rejected() {
    let jpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

    assert_eq!(normalize_logo(jpeg), Err(LogoError::NotPng));
}

#[test]
fn urls_and_paths_are_rejected() {
    for input in [
        "http://example.com/logo.png",
        "https://example.com/logo.png",
        "file:///etc/passwd",
        "/home/user/logo.png",
        "logo.png",
    ] {
        assert_eq!(normalize_logo(input), Err(LogoError::NotPng), "{input}");
    }
}

#[test]
fn a_png_prefix_with_svg_bytes_is_rejected() {
    let fake = format!(
        "{PNG_DATA_URI_PREFIX}{}",
        STANDARD.encode("<svg xmlns='x'/>")
    );

    assert_eq!(normalize_logo(&fake), Err(LogoError::Malformed));
}

#[test]
fn empty_input_is_rejected() {
    assert_eq!(normalize_logo(""), Err(LogoError::Empty));
    assert_eq!(normalize_logo("   \n"), Err(LogoError::Empty));
}

#[test]
fn bad_base64_is_rejected() {
    assert_eq!(
        normalize_logo("data:image/png;base64,@@@not base64@@@"),
        Err(LogoError::Malformed)
    );
}

#[test]
fn a_truncated_png_is_rejected() {
    let png = solid_rgba(64, 64, [5, 6, 7, 255]);
    let truncated = &png[..png.len() / 2];

    assert_eq!(normalize_logo(&uri(truncated)), Err(LogoError::Malformed));
}

#[test]
fn a_png_with_a_corrupt_checksum_is_rejected() {
    let mut png = solid_rgba(8, 8, [5, 6, 7, 255]);
    let last_idat_crc = png.len() - 12 - 4;
    png[last_idat_crc] ^= 0xFF;

    assert_eq!(normalize_logo(&uri(&png)), Err(LogoError::Malformed));
}

#[test]
fn an_oversized_payload_is_rejected_before_decoding() {
    let input = format!(
        "{PNG_DATA_URI_PREFIX}{}",
        "A".repeat(MAX_INPUT_BASE64_LEN + 1)
    );

    assert_eq!(normalize_logo(&input), Err(LogoError::TooLarge));
}

#[test]
fn a_header_claiming_a_huge_image_is_rejected_without_decoding_pixels() {
    let bomb = header_only(50_000, 50_000);

    assert_eq!(
        normalize_logo(&uri(&bomb)),
        Err(LogoError::TooBigDimensions)
    );
}

#[test]
fn images_just_above_the_input_limit_are_rejected() {
    assert_eq!(
        normalize_logo(&uri(&header_only(1_025, 10))),
        Err(LogoError::TooBigDimensions)
    );
    assert_eq!(
        normalize_logo(&uri(&header_only(10, 1_025))),
        Err(LogoError::TooBigDimensions)
    );
}

#[test]
fn a_zero_sized_header_is_rejected() {
    assert!(matches!(
        normalize_logo(&uri(&header_only(0, 16))),
        Err(LogoError::TooBigDimensions | LogoError::Malformed)
    ));
}

#[test]
fn an_image_at_the_input_limit_is_accepted_and_downscaled() {
    let png = solid_rgba(1_024, 1_024, [3, 3, 3, 255]);

    let image = decode_output(&normalize_logo(&uri(&png)).unwrap());

    assert_eq!((image.width, image.height), (256, 256));
}

#[test]
fn metadata_chunks_do_not_survive() {
    let png = encode_with(
        8,
        8,
        ColorType::Rgba,
        BitDepth::Eight,
        &[7; 8 * 8 * 4],
        |encoder| {
            encoder
                .add_text_chunk("Author".to_string(), "secret-person".to_string())
                .unwrap();
            encoder
                .add_itxt_chunk("Comment".to_string(), "secret-comment".to_string())
                .unwrap();
        },
    );
    assert!(chunk_types(&uri(&png)).contains(&"tEXt".to_string()));

    let output = normalize_logo(&uri(&png)).unwrap();

    let types = chunk_types(&output);
    assert_eq!(types.first().map(String::as_str), Some("IHDR"));
    assert_eq!(types.last().map(String::as_str), Some("IEND"));
    assert!(
        types[1..types.len() - 1].iter().all(|t| t == "IDAT"),
        "{types:?}"
    );
    let raw = STANDARD
        .decode(output.strip_prefix(PNG_DATA_URI_PREFIX).unwrap())
        .unwrap();
    assert!(!String::from_utf8_lossy(&raw).contains("secret"));
}

#[test]
fn the_output_is_deterministic() {
    let png = solid_rgba(700, 300, [12, 34, 56, 200]);

    let first = normalize_logo(&uri(&png)).unwrap();
    let second = normalize_logo(&uri(&png)).unwrap();

    assert_eq!(first, second);
}

#[test]
fn normalizing_twice_changes_nothing() {
    let png = solid_rgba(700, 300, [12, 34, 56, 200]);

    let once = normalize_logo(&uri(&png)).unwrap();
    let twice = normalize_logo(&once).unwrap();

    assert_eq!(once, twice);
}

#[test]
fn surrounding_whitespace_is_ignored() {
    let png = solid_rgba(4, 4, [1, 1, 1, 255]);

    let padded = format!("  {}\n", uri(&png));

    assert!(normalize_logo(&padded).is_ok());
}

#[test]
fn the_noisiest_allowed_logo_stays_within_the_stored_size_budget() {
    // Pseudo random bytes do not compress: the worst case for the output size.
    let mut state = 0x2545_F491u32;
    let data: Vec<u8> = (0..256 * 256 * 4)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            state.to_le_bytes()[0]
        })
        .collect();
    let png = encode(256, 256, ColorType::Rgba, BitDepth::Eight, &data);

    let output = normalize_logo(&uri(&png)).unwrap();

    assert!(output.len() < 400_000, "{}", output.len());
}

#[test]
fn error_wire_form_is_json_with_a_reason() {
    assert_eq!(
        LogoError::NotPng.to_wire(),
        r#"{"kind":"invalid_logo","reason":"not_png"}"#
    );
    assert_eq!(
        LogoError::TooBigDimensions.to_wire(),
        r#"{"kind":"invalid_logo","reason":"too_big_dimensions"}"#
    );
}
