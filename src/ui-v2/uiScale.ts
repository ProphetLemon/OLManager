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

/// The smallest root a phone may run. At 16px a 0.75rem caption is 12px, the
/// text floor on a phone, so no phone setting may go under it.
export const MIN_PHONE_ROOT_FONT_PX = 16;

/// The phone's root font size in px, in one place. Android is a phone form
/// (`data-form="phone"` on <html>) and ignores `SCALE_MAP`: its layouts are built
/// for a 16px root. A later "phone text scale" setting (16 / 18 / 20, never
/// smaller) plugs in here and reads its stored value.
export function phoneRootFontPx(): number {
  return MIN_PHONE_ROOT_FONT_PX;
}

export function isAndroidUserAgent(userAgent: string): boolean {
  return /Android/i.test(userAgent);
}

export function rootFontSizeFor(scale: string, userAgent: string): string {
  if (isAndroidUserAgent(userAgent)) return `${phoneRootFontPx()}px`;
  return SCALE_MAP[scale] || "16px";
}
