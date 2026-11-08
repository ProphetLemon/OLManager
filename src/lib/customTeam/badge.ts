/**
 * Generated club badge for user-created teams.
 *
 * Contract shared byte for byte with the Rust `badge_data_uri` writer: inputs
 * are pre-validated (short name 3-4 chars [A-Z0-9], colors `#rrggbb` lowercase)
 * and the output is `data:image/svg+xml;utf8,` followed by an
 * `encodeURIComponent` encoding of the SVG.
 */
export function buildBadgeDataUri(shortName: string, primary: string, secondary: string): string {
  const fontSize = shortName.length <= 3 ? 44 : 36;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">` +
    `<path d="M64 6L116 22V62C116 92 94 114 64 124C34 114 12 92 12 62V22Z" fill="${primary}" stroke="${secondary}" stroke-width="6"/>` +
    `<text x="64" y="78" text-anchor="middle" font-family="sans-serif" font-weight="800" font-size="${fontSize}" fill="${secondary}">${shortName}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
