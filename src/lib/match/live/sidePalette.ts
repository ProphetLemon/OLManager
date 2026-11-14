/**
 * Each side of the live match wears its club's colours: the accent, the text tone that reads on
 * the dark surface, the text that reads on an accent fill, and the club's logo. Pure: the screen
 * hands over the game's team list and the two team ids, and gets both sides back.
 *
 * Both clubs resolve through `resolveClubPalette` (which clamps the accent against the shared
 * `--surface-clamp` surface, so the result is the same in every theme). When the two clubs' authored
 * primary colours are too close to tell apart (see MIN_PRIMARY_HUE_DEGREES), the red side (the away
 * club) takes its secondary colour.
 */
import {
  ensureContrast,
  hexToOklch,
  isChromatic,
  readableForeground,
  resolveClubPalette,
  SURFACE,
  type ClubPaletteSource,
  type LogoPalette,
} from "@/lib/teams/clubColors";
import { resolveTeamLogo, resolveTeamLogoById } from "@/lib/teams/teamLogos";
import { TEAM_LOGO_PALETTE } from "@/lib/teams/teamPalette.generated";
import type { TeamData } from "@/store/types";

/**
 * The closeness fallback compares the clubs' primary colours as authored, not the clamped
 * accents: clamping every colour to the same contrast against the surface pulls any two towards
 * 1:1, so it would fire for almost every pair. Two chromatic primaries are close under this many
 * degrees of OKLCH hue; when either is a grey (no hue) they are close under this OKLCH lightness gap.
 */
export const MIN_PRIMARY_HUE_DEGREES = 30;
export const MIN_ACHROMATIC_LIGHTNESS_GAP = 0.15;

export interface SidePalette {
  /** Fill for rings, bars and washes: at least 3:1 on the surface clamp (4.5:1 in high contrast). */
  accent: string;
  /** The accent as text: at least 4.5:1 on the surface clamp. */
  accentText: string;
  /** Text on an accent fill: near-black or white, whichever contrasts more. */
  foreground: string;
  secondary: string;
  /** Where the accent came from; "secondary" when the closeness fallback replaced it. */
  source: ClubPaletteSource | "secondary";
}

export interface SideStyle {
  logoUrl: string | null;
  palette: SidePalette;
}

export interface SideTeamRef {
  id: string;
  name: string;
}

export interface PrimaryCloseness {
  /** Smallest angle between the two OKLCH hues, 0 to 180; null when either primary is a grey. */
  hueDegrees: number | null;
  /** Absolute difference of OKLCH lightness, 0 to 1. */
  lightnessGap: number;
}

export interface SideStyles {
  blue: SideStyle;
  red: SideStyle;
  /** True when the red side took its secondary colour. */
  fellBack: boolean;
  closeness: PrimaryCloseness;
}

export interface SideOptions {
  highContrast?: boolean;
  /** Logo palette to resolve against; the generated one by default. */
  logoPalette?: LogoPalette;
}

/** How near two primary colours are: hue angle when both are chromatic, lightness gap always. */
export function measureCloseness(a: string, b: string): PrimaryCloseness {
  const first = hexToOklch(a);
  const second = hexToOklch(b);
  const lightnessGap = Math.abs(first.l - second.l);
  if (!isChromatic(a) || !isChromatic(b)) return { hueDegrees: null, lightnessGap };
  const gap = Math.abs(first.h - second.h) % 360;
  return { hueDegrees: gap > 180 ? 360 - gap : gap, lightnessGap };
}

export function primariesAreClose({ hueDegrees, lightnessGap }: PrimaryCloseness): boolean {
  return hueDegrees === null ? lightnessGap < MIN_ACHROMATIC_LIGHTNESS_GAP : hueDegrees < MIN_PRIMARY_HUE_DEGREES;
}

interface Resolved {
  style: SideStyle;
  primary: string;
}

function styleFor(
  teams: readonly TeamData[] | null | undefined,
  ref: SideTeamRef,
  logoPalette: LogoPalette,
  highContrast: boolean,
): Resolved {
  const team = teams?.find((candidate) => candidate.id === ref.id) ?? null;
  const palette = resolveClubPalette(team, logoPalette, { highContrast });
  return {
    primary: palette.primary,
    style: {
      logoUrl: resolveTeamLogoById(teams, ref.id, () => resolveTeamLogo(ref.name)),
      palette: {
        accent: palette.accent,
        accentText: palette.accentText,
        foreground: palette.accentForeground,
        secondary: palette.secondary,
        source: palette.source,
      },
    },
  };
}

/** The palette with its accent replaced by its own secondary colour, clamped like any accent. */
function withSecondary(palette: SidePalette, highContrast: boolean): SidePalette {
  const accent = ensureContrast(palette.secondary, SURFACE, highContrast ? 4.5 : 3);
  return {
    accent,
    accentText: ensureContrast(accent, SURFACE, 4.5),
    foreground: readableForeground(accent),
    secondary: palette.secondary,
    source: "secondary",
  };
}

/**
 * Both sides' logos and palettes from the game's team list, found by team id. A club that is not
 * in the list gets the generic fallback palette and the logo its name points at.
 */
export function resolveSideStyles(
  teams: readonly TeamData[] | null | undefined,
  blue: SideTeamRef,
  red: SideTeamRef,
  options: SideOptions = {},
): SideStyles {
  const highContrast = options.highContrast === true;
  const logoPalette = options.logoPalette ?? TEAM_LOGO_PALETTE;
  const blueSide = styleFor(teams, blue, logoPalette, highContrast);
  const redSide = styleFor(teams, red, logoPalette, highContrast);
  const closeness = measureCloseness(blueSide.primary, redSide.primary);
  if (!primariesAreClose(closeness)) return { blue: blueSide.style, red: redSide.style, fellBack: false, closeness };
  return {
    blue: blueSide.style,
    red: { ...redSide.style, palette: withSecondary(redSide.style.palette, highContrast) },
    fellBack: true,
    closeness,
  };
}
