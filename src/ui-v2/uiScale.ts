/// Root font size (in px) for each interface scale setting. Almost everything in
/// UI v2 is sized in rem, so this map scales the whole interface. The stored
/// setting values are persisted in saves and must keep working.
///
/// `xsmall` is clamped to 12px: below that, 0.75rem text drops under 9px and
/// panels stretch across the window. See `MIN_ROOT_FONT_PX`.
export const MIN_ROOT_FONT_PX = 12;

export const SCALE_MAP: Record<string, string> = {
  xsmall: "12px",
  small: "14px",
  normal: "16px",
  large: "18px",
  xlarge: "20px",
};
