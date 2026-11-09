import { mkdirSync, readdirSync, writeFileSync } from "fs";
import { resolve, join } from "path";
import sharp from "sharp";

const ICON_DIR = resolve("public/teams-icons");
const OUT_FILE = resolve("src/lib/teams/teamPalette.generated.ts");
const REVIEW_DIR =
  "/home/profetalimon/Documentos/Proyectos/OLManager/src-tauri/target/olm-scratch/ui-on-air/palette";
const ICON_ABS_DIR = "/home/profetalimon/Documentos/Proyectos/OLManager/public/teams-icons";

// Tunables
const SIZE = 80; // fit-inside bounding box in px
const ALPHA_MIN = 128; // ignore pixels with alpha below this
const CHROMA_MIN = 0.04; // OKLCH chroma for a pixel to count as chromatic
const PRIMARY_MIN_SHARE = 0.04; // share of opaque pixels
const SECONDARY_MIN_SHARE = 0.02;
const SECONDARY_MIN_HUE_DIFF = 30; // degrees
const BIN_DEG = 10;
const CLUSTER_RADIUS_DEG = 20; // cluster = pixels within +-radius of peak hue

type Rgb = [number, number, number];
interface Entry {
  primary: string | null;
  secondary: string | null;
  primaryShare: number;
  secondaryShare: number;
}

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const toSrgb8 = (l: number) => {
  const c = Math.min(1, Math.max(0, l));
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(v * 255);
};

function linearToOklch(r: number, g: number, b: number): { L: number; C: number; h: number } {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, B);
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L, C, h };
}

const hueDiff = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

function hex(rgb: Rgb): string {
  return "#" + rgb.map((v) => toSrgb8(v).toString(16).padStart(2, "0")).join("");
}

async function extract(file: string): Promise<Entry> {
  const { data, info } = await sharp(join(ICON_DIR, file))
    .ensureAlpha()
    .resize(SIZE, SIZE, { fit: "inside", withoutEnlargement: false })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let opaque = 0;
  const px: { rgb: Rgb; h: number }[] = [];
  for (let i = 0; i < info.width * info.height; i++) {
    const o = i * 4;
    if (data[o + 3] < ALPHA_MIN) continue;
    opaque++;
    const rgb: Rgb = [toLinear(data[o]), toLinear(data[o + 1]), toLinear(data[o + 2])];
    const { C, h } = linearToOklch(rgb[0], rgb[1], rgb[2]);
    if (C >= CHROMA_MIN) px.push({ rgb, h });
  }

  const empty: Entry = { primary: null, secondary: null, primaryShare: 0, secondaryShare: 0 };
  if (opaque === 0) return empty;

  const nBins = 360 / BIN_DEG;
  const clusters: { hue: number; share: number; hex: string }[] = [];
  let remaining = px;
  while (remaining.length > 0) {
    const bins = new Array<number>(nBins).fill(0);
    for (const p of remaining) bins[Math.floor(p.h / BIN_DEG) % nBins]++;
    const span = Math.round(CLUSTER_RADIUS_DEG / BIN_DEG);
    let best = -1;
    let bestIdx = 0;
    for (let i = 0; i < nBins; i++) {
      let sum = 0;
      for (let k = -span; k <= span; k++) sum += bins[(i + k + nBins) % nBins];
      if (sum > best) {
        best = sum;
        bestIdx = i;
      }
    }
    const center = bestIdx * BIN_DEG + BIN_DEG / 2;
    const inside: typeof px = [];
    const outside: typeof px = [];
    for (const p of remaining) (hueDiff(p.h, center) <= CLUSTER_RADIUS_DEG ? inside : outside).push(p);
    const mean: Rgb = [0, 0, 0];
    for (const p of inside) {
      mean[0] += p.rgb[0];
      mean[1] += p.rgb[1];
      mean[2] += p.rgb[2];
    }
    const n = inside.length;
    const mr: Rgb = [mean[0] / n, mean[1] / n, mean[2] / n];
    const o = linearToOklch(mr[0], mr[1], mr[2]);
    clusters.push({ hue: o.h, share: n / opaque, hex: hex(mr) });
    remaining = outside;
    if (clusters.length >= 8) break;
  }
  clusters.sort((a, b) => b.share - a.share);

  const first = clusters[0];
  if (!first || first.share < PRIMARY_MIN_SHARE) return empty;
  const second = clusters.find(
    (c) => c !== first && c.share >= SECONDARY_MIN_SHARE && hueDiff(c.hue, first.hue) >= SECONDARY_MIN_HUE_DIFF,
  );
  return {
    primary: first.hex,
    secondary: second ? second.hex : null,
    primaryShare: first.share,
    secondaryShare: second ? second.share : 0,
  };
}

function writeReview(files: string[], entries: Record<string, Entry>) {
  mkdirSync(REVIEW_DIR, { recursive: true });
  const PER_PAGE = 60;
  const pages = Math.ceil(files.length / PER_PAGE);
  const sw = (hexv: string | null, share: number) =>
    hexv
      ? `<div class="sw"><i style="background:${hexv}"></i>${hexv} ${(share * 100).toFixed(0)}%</div>`
      : `<div class="sw"><i class="none"></i>null</div>`;
  for (let p = 0; p < pages; p++) {
    const cells = files
      .slice(p * PER_PAGE, (p + 1) * PER_PAGE)
      .map((f) => {
        const e = entries[f];
        return `<div class="c"><img src="file://${ICON_ABS_DIR}/${f}"><div class="n">${f}</div>${sw(e.primary, e.primaryShare)}${sw(e.secondary, e.secondaryShare)}</div>`;
      })
      .join("");
    const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#18181b;color:#e4e4e7;font:11px sans-serif}
.g{display:grid;grid-template-columns:repeat(10,1fr);grid-template-rows:repeat(6,1fr);height:1200px;width:1600px;gap:4px;padding:4px;box-sizing:border-box}
.c{background:#27272a;padding:4px;overflow:hidden;display:flex;flex-direction:column;align-items:center}
img{width:100px;height:100px;object-fit:contain}
.n{font-size:10px;word-break:break-all;text-align:center}
.sw{display:flex;align-items:center;gap:4px;font-size:10px}
.sw i{width:14px;height:14px;display:inline-block;border:1px solid #52525b}
.none{background:transparent}
</style><div class="g">${cells}</div>`;
    writeFileSync(join(REVIEW_DIR, `review-${p + 1}.html`), html);
  }
  console.log(`Wrote ${pages} review pages → ${REVIEW_DIR}`);
}

async function main() {
  const files = readdirSync(ICON_DIR)
    .filter((f) => /\.(webp|png)$/.test(f))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const entries: Record<string, Entry> = {};
  for (const f of files) entries[f] = await extract(f);

  const body = files
    .map((f) => `  ${JSON.stringify(f)}: { primary: ${JSON.stringify(entries[f].primary)}, secondary: ${JSON.stringify(entries[f].secondary)} },`)
    .join("\n");
  const content = `// Generated by scripts/generate-team-palette.ts — do not edit manually
export const TEAM_LOGO_PALETTE: Readonly<Record<string, { primary: string | null; secondary: string | null }>> = {
${body}
};
`;
  writeFileSync(OUT_FILE, content);
  const withPrimary = files.filter((f) => entries[f].primary).length;
  const withSecondary = files.filter((f) => entries[f].secondary).length;
  console.log(
    `Generated team palette: ${files.length} logos, ${withPrimary} primary, ${files.length - withPrimary} null, ${withSecondary} secondary → ${OUT_FILE}`,
  );
  if (process.argv.includes("--review")) writeReview(files, entries);
}

main();
