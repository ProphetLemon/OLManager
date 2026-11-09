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
      if (parsed && typeof parsed === "object" && (parsed as { kind?: unknown }).kind === "invalid_logo") {
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

/** Decodes `file`, draws it fitted into 256x256 on a canvas and exports a PNG data URI. */
export async function rasterizeToPngDataUri(file: Blob): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new LogoUploadError("unreadable");
  }
  try {
    const { width, height } = fitLogoSize(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new LogoUploadError("unreadable");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, width, height);
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
