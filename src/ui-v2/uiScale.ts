/// Root font size for each interface scale offered to the player. Almost
/// everything in UI v2 is sized in rem, so this map scales the whole interface.
/// The stored setting values are persisted in saves and must keep working.
///
/// `xsmall` is clamped to 12px on desktop: below that, 0.75rem text drops under
/// 9px and panels stretch across the window.
export const MIN_OFFERED_ROOT_FONT_PX = 12;

export const SCALE_MAP: Record<string, string> = {
  xsmall: "12px",
  small: "14px",
  normal: "16px",
  large: "18px",
  xlarge: "20px",
};

/// Android runs the whole interface at a 9px root (the settings store forces
/// `xsmall` there): the layout was designed for a wider window and must shrink
/// to fit a phone. It is not an offered scale and ignores `SCALE_MAP`.
export const ANDROID_ROOT_FONT = "9px";

export function isAndroidUserAgent(userAgent: string): boolean {
  return /Android/i.test(userAgent);
}

export function rootFontSizeFor(scale: string, userAgent: string): string {
  if (isAndroidUserAgent(userAgent)) return ANDROID_ROOT_FONT;
  return SCALE_MAP[scale] || "16px";
}
