/**
 * Club palette resolution.
 *
 * Turns a team into a small palette that is readable on the app's dark UI.
 * Pure and dependency free: all colour maths (WCAG contrast, OKLab/OKLCH,
 * gamut mapping) lives here so the policy can change without regenerating the
 * logo palette data.
 */

export type LogoPaletteEntry = { primary: string | null; secondary: string | null };
export type LogoPalette = Readonly<Record<string, LogoPaletteEntry>>;

export type ClubPaletteSource = "custom" | "logo" | "authored" | "fallback";

export interface ClubPalette {
  /** The club's primary colour as authored, before any contrast clamp (lowercase `#rrggbb`). */
  primary: string;
  accent: string;
  accentForeground: string;
  accentText: string;
  secondary: string;
  source: ClubPaletteSource;
}

export interface ClubPaletteOptions {
  highContrast?: boolean;
}

/** Structural subset of `Team` this module reads. */
export interface ClubColorTeam {
  id?: string | null;
  name?: string | null;
  logo_url?: string | null;
  colors?: { primary?: string | null; secondary?: string | null } | null;
}

// ---------------------------------------------------------------------------
// Colour maths
// ---------------------------------------------------------------------------

type Rgb = [number, number, number];
type Lch = { l: number; c: number; h: number };

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Parse `#rgb` / `#rrggbb` into 0-255 channels, or null when invalid. */
export function parseHex(value: string | null | undefined): Rgb | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!HEX_RE.test(trimmed)) return null;
  let digits = trimmed.slice(1);
  if (digits.length === 3) digits = digits.replace(/./g, (ch) => ch + ch);
  return [
    parseInt(digits.slice(0, 2), 16),
    parseInt(digits.slice(2, 4), 16),
    parseInt(digits.slice(4, 6), 16),
  ];
}

/** Format 0-255 channels as lowercase `#rrggbb` (rounded and clamped). */
export function formatHex(rgb: readonly [number, number, number]): string {
  return (
    "#" +
    rgb
      .map((v) => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, "0"))
      .join("")
  );
}

/** Normalize any valid hex to lowercase `#rrggbb`, or null. */
export function normalizeHex(value: string | null | undefined): string | null {
  const rgb = parseHex(value);
  return rgb ? formatHex(rgb) : null;
}

export function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Linear 0-1 to sRGB 0-255 (not clamped). */
export function linearToSrgb(linear: number): number {
  const c = linear <= 0.0031308 ? linear * 12.92 : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
  return c * 255;
}

/** WCAG 2.x relative luminance of a hex colour. */
export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) throw new Error(`Invalid hex colour: ${hex}`);
  const [r, g, b] = rgb.map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

function linearToOklab(r: number, g: number, b: number): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinear(L: number, a: number, b: number): Rgb {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function hexToOklch(hex: string): Lch {
  const rgb = parseHex(hex);
  if (!rgb) throw new Error(`Invalid hex colour: ${hex}`);
  const [r, g, b] = rgb.map(srgbToLinear);
  const [L, a, bb] = linearToOklab(r, g, b);
  const c = Math.hypot(a, bb);
  let h = (Math.atan2(bb, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h };
}

const GAMUT_EPS = 1e-6;

function inGamut(linear: Rgb): boolean {
  return linear.every((v) => v >= -GAMUT_EPS && v <= 1 + GAMUT_EPS);
}

function oklchToLinear(l: number, c: number, h: number): Rgb {
  const rad = (h * Math.PI) / 180;
  return oklabToLinear(l, c * Math.cos(rad), c * Math.sin(rad));
}

/** OKLCH to hex; out-of-gamut colours lose chroma (never lightness or hue). */
export function oklchToHex(l: number, c: number, h: number): string {
  const lightness = Math.min(1, Math.max(0, l));
  let linear = oklchToLinear(lightness, c, h);
  if (!inGamut(linear)) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 32; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear(lightness, mid, h))) lo = mid;
      else hi = mid;
    }
    linear = oklchToLinear(lightness, lo, h);
  }
  return formatHex(linear.map((v) => linearToSrgb(Math.min(1, Math.max(0, v)))) as Rgb);
}

// ---------------------------------------------------------------------------
// Contrast policy
// ---------------------------------------------------------------------------

/**
 * The lightest common dark surface (the dark `--border`/`--line` and
 * `--surface-clamp` token in themes/default.css), so contrast against it is
 * the worst case. A test parses default.css to keep the two in sync.
 */
export const SURFACE_HEX = "#2A3347";
export const SURFACE: string = SURFACE_HEX.toLowerCase();

/**
 * The dark theme's `--card`: the surface a club wash is mixed over, so text can be clamped
 * against the tinted result. A test keeps it in sync with themes/default.css.
 */
export const DARK_CARD_HEX = "#141924";

export const FALLBACK_ACCENT = "#f97316";
export const FALLBACK_SECONDARY = "#a1a1aa";
const FOREGROUND_DARK = "#0a0a0a";
const FOREGROUND_LIGHT = "#ffffff";

const CHROMATIC_MIN = 0.03;

/** True for authored colours; black, white and greys are placeholders. */
export function isChromatic(hex: string | null | undefined): boolean {
  const normalized = normalizeHex(hex);
  return normalized !== null && hexToOklch(normalized).c >= CHROMATIC_MIN;
}

/**
 * Move OKLCH lightness only, by the smallest amount that reaches `minRatio`
 * against `surface`. Direction is whichever of lighter/darker can contrast
 * more with the surface (lighter on a dark surface). Hue is kept; chroma only
 * shrinks when the target lightness is out of gamut.
 */
export function ensureContrast(hex: string, surface: string, minRatio: number): string {
  const start = normalizeHex(hex);
  if (!start) throw new Error(`Invalid hex colour: ${hex}`);
  if (contrastRatio(start, surface) >= minRatio) return start;

  const { l, c, h } = hexToOklch(start);
  const lighter = contrastRatio("#ffffff", surface) >= contrastRatio("#000000", surface);
  const target = lighter ? 1 : 0;
  const at = (lightness: number) => oklchToHex(lightness, c, h);

  if (contrastRatio(at(target), surface) < minRatio) return at(target);

  // Binary search for the lightness closest to `l` that satisfies the ratio.
  let bad = l;
  let good = target;
  for (let i = 0; i < 40; i++) {
    const mid = (bad + good) / 2;
    if (contrastRatio(at(mid), surface) >= minRatio) good = mid;
    else bad = mid;
  }
  // Quantisation to 8 bits can land just under; nudge toward the target.
  let result = at(good);
  const step = lighter ? 0.001 : -0.001;
  for (let lightness = good; contrastRatio(result, surface) < minRatio; lightness += step) {
    result = at(lightness);
    if (lightness <= 0 || lightness >= 1) break;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Logo key and club detection
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Logo palette key for a team: basename of `logo_url` (query, hash and any
 * path or asset prefix removed). Without a usable `logo_url`, the same slug
 * rule as `resolveTeamLogo` plus ".webp".
 */
export function logoKeyForTeam(team: ClubColorTeam): string | null {
  const url = team.logo_url;
  if (url && !url.startsWith("data:")) {
    const clean = url.split(/[?#]/)[0] ?? "";
    const base = clean.slice(clean.lastIndexOf("/") + 1);
    if (base) {
      try {
        return decodeURIComponent(base);
      } catch {
        return base;
      }
    }
  }
  if (!team.name) return null;
  const slug = slugify(team.name);
  return slug ? `${slug}.webp` : null;
}

/**
 * User-created clubs get a generated `data:image/svg+xml` badge as `logo_url`
 * and an id of the form `{competition}-custom-{slug}`; their `colors` are the
 * colours the user chose (olm_core custom_team.rs).
 */
export function isCustomClub(team: ClubColorTeam): boolean {
  if (team.logo_url?.startsWith("data:image/svg+xml")) return true;
  return typeof team.id === "string" && team.id.includes("-custom-");
}

// ---------------------------------------------------------------------------
// Palette resolution
// ---------------------------------------------------------------------------

/** Text colour for a fill of `accent`: whichever of near-black and white contrasts more. */
export function readableForeground(accent: string): string {
  return contrastRatio(FOREGROUND_DARK, accent) >= contrastRatio(FOREGROUND_LIGHT, accent)
    ? FOREGROUND_DARK
    : FOREGROUND_LIGHT;
}

function buildPalette(
  rawAccent: string,
  rawSecondary: string,
  source: ClubPaletteSource,
  highContrast: boolean,
): ClubPalette {
  const accent = ensureContrast(rawAccent, SURFACE, highContrast ? 4.5 : 3);
  const accentText = ensureContrast(accent, SURFACE, 4.5);
  const secondary = ensureContrast(rawSecondary, SURFACE, highContrast ? 4.5 : 3);

  let accentForeground = readableForeground(accent);
  let finalAccent = accent;
  if (contrastRatio(accentForeground, accent) < 4.5) {
    // Unreachable in practice (the two extremes cross over above 4.5), kept as a guard.
    finalAccent = ensureContrast(accent, FOREGROUND_DARK, 4.5);
    accentForeground = FOREGROUND_DARK;
  }
  return {
    primary: normalizeHex(rawAccent) ?? rawAccent,
    accent: finalAccent,
    accentForeground,
    accentText,
    secondary,
    source,
  };
}

/**
 * Resolve a team's readable palette.
 * Precedence (D8): user-created club colours, logo palette primary, authored
 * `team.colors` when chromatic, fallback.
 */
export function resolveClubPalette(
  team: ClubColorTeam | null | undefined,
  logoPalette: LogoPalette,
  options: ClubPaletteOptions = {},
): ClubPalette {
  const highContrast = options.highContrast === true;
  const fallback = () => buildPalette(FALLBACK_ACCENT, FALLBACK_SECONDARY, "fallback", highContrast);
  if (!team) return fallback();

  const authoredPrimary = normalizeHex(team.colors?.primary);
  const authoredSecondary = normalizeHex(team.colors?.secondary);

  if (isCustomClub(team) && authoredPrimary) {
    return buildPalette(authoredPrimary, authoredSecondary ?? FALLBACK_SECONDARY, "custom", highContrast);
  }

  const key = logoKeyForTeam(team);
  const entry = key && Object.prototype.hasOwnProperty.call(logoPalette, key) ? logoPalette[key] : undefined;
  const logoPrimary = normalizeHex(entry?.primary);
  if (logoPrimary) {
    return buildPalette(
      logoPrimary,
      normalizeHex(entry?.secondary) ?? FALLBACK_SECONDARY,
      "logo",
      highContrast,
    );
  }

  if (authoredPrimary && isChromatic(authoredPrimary)) {
    return buildPalette(authoredPrimary, authoredSecondary ?? FALLBACK_SECONDARY, "authored", highContrast);
  }

  return fallback();
}
