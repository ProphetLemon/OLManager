/**
 * Founder profile photo.
 *
 * The same pipeline as the club badge (see `./logo`): the browser decodes the
 * picked image and exports a PNG, here the centred square of the picture, and
 * the Rust `prepare_custom_portrait` command fully re-validates and re-encodes
 * it. Its answer is the exact string stored as the player's `profile_image_url`.
 */
import { invoke } from "@tauri-apps/api/core";

import { LogoUploadError, checkLogoFile, parseLogoError, rasterizeToPngDataUri } from "./logo";
import type { RasterizeTarget } from "./logo";

/** Side of the square the browser exports; the backend fits it to 192 at most. */
export const PORTRAIT_SIDE = 192;

const PORTRAIT_TARGET: RasterizeTarget = { side: PORTRAIT_SIDE, square: true };

/** Backend-validated normalization of a PNG data URI; resolves to the stored form. */
export async function preparePortrait(dataUri: string): Promise<string> {
  try {
    return await invoke<string>("prepare_custom_portrait", { dataUri });
  } catch (error) {
    throw new LogoUploadError(parseLogoError(error));
  }
}

/** Whole pipeline for a picked file: checks, square canvas re-encode, backend normalization. */
export async function buildPortraitFromFile(file: File): Promise<string> {
  const rejected = checkLogoFile(file);
  if (rejected) throw new LogoUploadError(rejected);
  return preparePortrait(await rasterizeToPngDataUri(file, PORTRAIT_TARGET));
}
