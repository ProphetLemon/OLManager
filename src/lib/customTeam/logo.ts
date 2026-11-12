/**
 * Custom club badge upload.
 *
 * The browser decodes the picked image (PNG, JPEG or WebP), draws it on a
 * canvas that fits 256x256 keeping aspect ratio and alpha, and exports a PNG.
 * The Rust `prepare_custom_logo` command then fully re-validates and re-encodes
 * it; its answer is the exact string that is stored as the club logo. SVG is
 * never accepted.
 */
import { invoke } from "@tauri-apps/api/core";

export const LOGO_ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
/** File input `accept` value: the MIME types plus the extensions some pickers need. */
export const LOGO_ACCEPT_ATTRIBUTE = ".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp";
export const LOGO_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const LOGO_MAX_SIDE = 256;
/** Largest declared width or height accepted before the browser decodes the image. */
export const LOGO_MAX_SOURCE_SIDE = 4096;

/** Why a badge could not be used. Each code maps to one localized message. */
export type LogoErrorCode =
  | "unsupportedType"
  | "fileTooLarge"
  | "unreadable"
  | "invalid"
  | "tooBig"
  | "failed";

/** Thrown by [`buildLogoFromFile`]; carries the code the UI localizes. */
export class LogoUploadError extends Error {
  readonly code: LogoErrorCode;

  constructor(code: LogoErrorCode) {
    super(code);
    this.name = "LogoUploadError";
    this.code = code;
  }
}

/** Type and size checks on the picked file, before anything is decoded. */
export function checkLogoFile(file: { type: string; size: number }): LogoErrorCode | null {
  if (!(LOGO_ACCEPTED_TYPES as readonly string[]).includes(file.type)) return "unsupportedType";
  if (file.size > LOGO_MAX_FILE_BYTES) return "fileTooLarge";
  return null;
}

/**
 * Size that fits `width` x `height` inside `limit` x `limit`, keeping the
 * aspect ratio. Never upscales and never returns a zero side. Rounds like the
 * Rust side so previews and stored logos agree.
 */
export function fitLogoSize(
  width: number,
  height: number,
  limit: number = LOGO_MAX_SIDE,
): { width: number; height: number } {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const longest = Math.max(w, h);
  if (longest <= limit) return { width: w, height: h };
  const scale = (side: number) => Math.min(limit, Math.max(1, Math.round((side * limit) / longest)));
  return { width: scale(w), height: scale(h) };
}

const REASON_TO_CODE: Record<string, LogoErrorCode> = {
  empty: "invalid",
  not_png: "invalid",
  malformed: "invalid",
  too_large: "tooBig",
  too_big_dimensions: "tooBig",
};

/**
 * Maps a backend rejection to a code. Understands the JSON wire form of the
 * `prepare_custom_logo` command (`{"kind":"invalid_logo","reason":"..."}`) and
 * the plain `Invalid club logo: <reason>` text `select_team` returns.
 */
export function parseLogoError(raw: unknown): LogoErrorCode {
  const text = raw instanceof Error ? raw.message : typeof raw === "string" ? raw : "";
  if (text.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(text);
      const kind = parsed && typeof parsed === "object" ? (parsed as { kind?: unknown }).kind : undefined;
      // `prepare_custom_portrait` answers with the same reasons under its own kind, and
      // `set_player_photo` under the founder error kind `invalid_photo`.
      if (kind === "invalid_logo" || kind === "invalid_portrait" || kind === "invalid_photo") {
        const reason = (parsed as { reason?: unknown }).reason;
        return (typeof reason === "string" && REASON_TO_CODE[reason]) || "failed";
      }
    } catch {
      return "failed";
    }
    return "failed";
  }
  const match = /invalid club logo: (\w+)/i.exec(text);
  return (match && REASON_TO_CODE[match[1].toLowerCase()]) || "failed";
}

/** Backend-validated normalization of a PNG data URI; resolves to the stored form. */
export async function prepareCustomLogo(dataUri: string): Promise<string> {
  try {
    return await invoke<string>("prepare_custom_logo", { dataUri });
  } catch (error) {
    throw new LogoUploadError(parseLogoError(error));
  }
}

const ascii = (bytes: Uint8Array, start: number, text: string): boolean =>
  text.length + start <= bytes.length && [...text].every((ch, i) => bytes[start + i] === ch.charCodeAt(0));
const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2; // standalone marker, no length
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end of image or scan before any frame header
    const length = u16be(bytes, i + 2);
    if (length < 2) return null;
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (i + 9 > bytes.length) return null;
      return { width: u16be(bytes, i + 7), height: u16be(bytes, i + 5) };
    }
    i += 2 + length;
  }
  return null;
}

function webpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (!ascii(bytes, 0, "RIFF") || !ascii(bytes, 8, "WEBP")) return null;
  if (ascii(bytes, 12, "VP8X") && bytes.length >= 30) {
    return { width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 };
  }
  if (ascii(bytes, 12, "VP8L") && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = (bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24)) >>> 0;
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (ascii(bytes, 12, "VP8 ") && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return { width: (bytes[26] | (bytes[27] << 8)) & 0x3fff, height: (bytes[28] | (bytes[29] << 8)) & 0x3fff };
  }
  return null;
}

/**
 * Declared pixel size read from the container header (PNG IHDR, JPEG frame
 * header, WebP VP8/VP8L/VP8X) without decoding, or null when the header cannot
 * be parsed. Lets the picker refuse a tiny file that declares a huge canvas
 * before `createImageBitmap` allocates it.
 */
export function readImageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length >= 24 && u32be(bytes, 0) === 0x89504e47 && u32be(bytes, 4) === 0x0d0a1a0a && ascii(bytes, 12, "IHDR")) {
    return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return jpegDimensions(bytes);
  return webpDimensions(bytes);
}

/** Rejects a file whose header is unreadable, empty or declares more than the allowed side. */
async function checkDeclaredSize(file: Blob): Promise<void> {
  const size = readImageDimensions(new Uint8Array(await file.arrayBuffer()));
  if (!size) throw new LogoUploadError("unreadable");
  if (size.width < 1 || size.height < 1) throw new LogoUploadError("unreadable");
  if (size.width > LOGO_MAX_SOURCE_SIDE || size.height > LOGO_MAX_SOURCE_SIDE) throw new LogoUploadError("tooBig");
}

/** Where the decoded image lands: fitted whole (the badge), or its centre cropped to a square. */
export interface RasterizeTarget {
  /** Longest side of the output, in pixels. */
  side: number;
  /** Keep the centred square of the image instead of the whole picture. */
  square: boolean;
}

const LOGO_TARGET: RasterizeTarget = { side: LOGO_MAX_SIDE, square: false };

/** Decodes `file`, draws it into `target` on a canvas and exports a PNG data URI. */
export async function rasterizeToPngDataUri(file: Blob, target: RasterizeTarget = LOGO_TARGET): Promise<string> {
  await checkDeclaredSize(file);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new LogoUploadError("unreadable");
  }
  try {
    // A square target reads the centred square of the picture; the badge reads all of it.
    const cropSide = Math.min(bitmap.width, bitmap.height);
    const source = target.square
      ? {
          x: Math.floor((bitmap.width - cropSide) / 2),
          y: Math.floor((bitmap.height - cropSide) / 2),
          width: cropSide,
          height: cropSide,
        }
      : { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
    const { width, height } = fitLogoSize(source.width, source.height, target.side);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new LogoUploadError("unreadable");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    if (target.square) {
      context.drawImage(bitmap, source.x, source.y, source.width, source.height, 0, 0, width, height);
    } else {
      context.drawImage(bitmap, 0, 0, width, height);
    }
    const dataUri = canvas.toDataURL("image/png");
    if (!dataUri.startsWith("data:image/png;base64,")) throw new LogoUploadError("unreadable");
    return dataUri;
  } finally {
    bitmap.close?.();
  }
}

/** Whole pipeline for a picked file: checks, canvas re-encode, backend normalization. */
export async function buildLogoFromFile(file: File): Promise<string> {
  const rejected = checkLogoFile(file);
  if (rejected) throw new LogoUploadError(rejected);
  return prepareCustomLogo(await rasterizeToPngDataUri(file));
}
