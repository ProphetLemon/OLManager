// Manual corrections applied after extraction by scripts/generate-team-palette.ts.
// Only for misreads that no general rule fixes. Keep this list short.
// Shape: file name -> null (no club colour) | { primary, secondary } (lowercase #rrggbb or null).
export type PaletteOverride = null | { primary: string | null; secondary: string | null };

export const TEAM_PALETTE_OVERRIDES: Readonly<Record<string, PaletteOverride>> = {
  // Facebook icon, not a club colour
  "0e4784dab02a7b30.webp": null,
  // Facebook icon, not a club colour
  "1779873997090_Team_Phantasma.webp": null,
  // Facebook icon, not a club colour
  "1779874036659_Gamespace_Mediterranean_College_Esports.webp": null,
  // Discord icon, not a club colour
  "1779874010409_WLGaming_Esports.webp": null,
  // Instagram icon, not a club colour
  "1779874045523_ALMO_Players.webp": null,
  // Instagram icon, not a club colour
  "1779874102707_Team_Insidious.webp": null,
  // Facebook icon, not a club colour
  "98d08bd708387000.webp": null,
  // Instagram icon, not a club colour
  "85af0cf2e036ee8b.webp": null,
  // Instagram icon, not a club colour
  "b50e625743b622b5.webp": null,
  // Discord icon, not a club colour
  "e70bb7aaf8ae9385.webp": null,
};
