import { mkdirSync, readdirSync, writeFileSync } from "fs";
import { resolve, join } from "path";
import { pathToFileURL } from "url";
import sharp from "sharp";
import { TEAM_PALETTE_OVERRIDES } from "./team-palette-overrides";

const ICON_DIR = resolve("public/teams-icons");
const OUT_FILE = resolve("src/lib/teams/teamPalette.generated.ts");
const DEFAULT_REVIEW_DIR = "src-tauri/target/olm-scratch/team-palette-review";

// Tunables
const SIZE = 96; // fit-inside bounding box in px (nearest-neighbour, no colour blending)
const ALPHA_MIN = 250; // only (almost) fully opaque pixels are analysed
const FRINGE_L_JUMP = 0.4; // OKLab lightness jump to a 4-neighbour that marks an edge pixel
const CHROMA_MIN = 0.03; // OKLCH chroma for a pixel to count as chromatic
const CLUSTER_CHROMA_MIN = 0.05; // minimum chroma of a cluster representative
const NEAR_BLACK_L = 0.25; // clusters darker than this lose to a brighter chromatic cluster
const BRIGHT_L = 0.5; // clusters darker than this have their rank score scaled down quadratically
const PRIMARY_MIN_SHARE = 0.04; // share of badge (opaque, non-fringe) pixels
const ACHROMATIC_BADGE_CHROMATIC_SHARE = 0.25; // badge counts as achromatic below this chromatic share
const ACCENT_MIN_SHARE = 0.015; // reduced share allowed for a strong accent on an achromatic badge
const ACCENT_MIN_CHROMA = 0.08;
const LOW_SHARE = 0.06; // below this share a cluster needs real chroma...
const LOW_SHARE_MIN_CHROMA = 0.1; // ...of at least this
const SECONDARY_MIN_SHARE = 0.02;
const SECONDARY_MIN_HUE_DIFF = 30; // degrees
const BIN_DEG = 10;
const CLUSTER_RADIUS_DEG = 20; // cluster = pixels within +-radius of peak hue
const MAX_CLUSTERS = 8;
const REVIEW_CANDIDATES = 4;

type Rgb = [number, number, number];
interface Cluster {
  hue: number;
  share: number;
  chroma: number;
  L: number;
  score: number;
  hex: string;
}
interface Entry {
  primary: string | null;
  secondary: string | null;
  primaryShare: number;
  secondaryShare: number;
  candidates: Cluster[];
  overridden: boolean;
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

interface Px {
  rgb: Rgb;
  L: number;
  C: number;
  h: number;
}

async function extract(file: string): Promise<Entry> {
  const { data, info } = await sharp(join(ICON_DIR, file))
    .ensureAlpha()
    .resize(SIZE, SIZE, { fit: "inside", kernel: "nearest" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;

  const all: (Px | null)[] = new Array(w * h).fill(null);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (data[o + 3] < ALPHA_MIN) continue;
    const rgb: Rgb = [toLinear(data[o]), toLinear(data[o + 1]), toLinear(data[o + 2])];
    all[i] = { rgb, ...linearToOklch(rgb[0], rgb[1], rgb[2]) };
  }

  // Drop fringe pixels: next to a transparent pixel or across a large lightness jump.
  const pixels: Px[] = [];
  let opaqueCount = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = all[y * w + x];
      if (!p) continue;
      opaqueCount++;
      let fringe = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = all[ny * w + nx];
        if (!q || Math.abs(q.L - p.L) > FRINGE_L_JUMP) {
          fringe = true;
          break;
        }
      }
      if (!fringe) pixels.push(p);
    }
  }

  const empty: Entry = {
    primary: null,
    secondary: null,
    primaryShare: 0,
    secondaryShare: 0,
    candidates: [],
    overridden: false,
  };
  // Tiny shapes can be all fringe; fall back to every opaque pixel.
  const badge = pixels.length > 0 ? pixels : (all.filter(Boolean) as Px[]);
  if (opaqueCount === 0 || badge.length === 0) return empty;

  const chromatic = badge.filter((p) => p.C >= CHROMA_MIN);
  const achromaticBadge = chromatic.length / badge.length < ACHROMATIC_BADGE_CHROMATIC_SHARE;

  const nBins = 360 / BIN_DEG;
  const clusters: Cluster[] = [];
  let remaining = chromatic;
  while (remaining.length > 0 && clusters.length < MAX_CLUSTERS) {
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
    // Centre on the fullest bin inside the winning window so the cluster is never empty.
    let peakIdx = bestIdx;
    for (let k = -span; k <= span; k++) {
      const idx = (bestIdx + k + nBins) % nBins;
      if (bins[idx] > bins[peakIdx]) peakIdx = idx;
    }
    const center = peakIdx * BIN_DEG + BIN_DEG / 2;
    const inside: Px[] = [];
    const outside: Px[] = [];
    for (const p of remaining) (hueDiff(p.h, center) <= CLUSTER_RADIUS_DEG ? inside : outside).push(p);

    // Chroma-weighted mean (weight C^2): saturated core pixels dominate, washed-out ones barely count.
    const sum: Rgb = [0, 0, 0];
    let wsum = 0;
    for (const p of inside) {
      const wt = p.C * p.C;
      sum[0] += p.rgb[0] * wt;
      sum[1] += p.rgb[1] * wt;
      sum[2] += p.rgb[2] * wt;
      wsum += wt;
    }
    const mean: Rgb = [sum[0] / wsum, sum[1] / wsum, sum[2] / wsum];
    const o = linearToOklch(mean[0], mean[1], mean[2]);
    const share = inside.length / badge.length;
    clusters.push({ hue: o.h, share, chroma: o.C, L: o.L, score: share * o.C * Math.min(1, o.L / BRIGHT_L) ** 2, hex: hex(mean) });
    remaining = outside;
  }
  clusters.sort((a, b) => b.score - a.score || (a.hex < b.hex ? -1 : 1));
  const candidates = clusters.slice(0, REVIEW_CANDIDATES);

  const eligible = (c: Cluster) => {
    if (c.chroma < CLUSTER_CHROMA_MIN) return false;
    if (c.share < LOW_SHARE && c.chroma < LOW_SHARE_MIN_CHROMA) return false;
    const minShare = achromaticBadge && c.chroma >= ACCENT_MIN_CHROMA ? ACCENT_MIN_SHARE : PRIMARY_MIN_SHARE;
    return c.share >= minShare;
  };
  const ok = clusters.filter(eligible);
  const first = ok.find((c) => c.L >= NEAR_BLACK_L) ?? ok[0];
  if (!first) return { ...empty, candidates };
  const second = ok.find(
    (c) =>
      c !== first &&
      c.share >= SECONDARY_MIN_SHARE &&
      hueDiff(c.hue, first.hue) >= SECONDARY_MIN_HUE_DIFF,
  );
  return {
    primary: first.hex,
    secondary: second ? second.hex : null,
    primaryShare: first.share,
    secondaryShare: second ? second.share : 0,
    candidates,
    overridden: false,
  };
}

function applyOverride(file: string, e: Entry): Entry {
  if (!(file in TEAM_PALETTE_OVERRIDES)) return e;
  const o = TEAM_PALETTE_OVERRIDES[file];
  return {
    ...e,
    primary: o ? o.primary : null,
    secondary: o ? o.secondary : null,
    primaryShare: 0,
    secondaryShare: 0,
    overridden: true,
  };
}

function writeReview(files: string[], entries: Record<string, Entry>, reviewDir: string) {
  mkdirSync(reviewDir, { recursive: true });
  const iconUrl = pathToFileURL(ICON_DIR).href;
  const PER_PAGE = 40;
  const pages = Math.ceil(files.length / PER_PAGE);
  const sw = (label: string, hexv: string | null, share: number, overridden: boolean) =>
    hexv
      ? `<div class="sw"><i style="background:${hexv}"></i>${label} ${hexv}${overridden ? "" : ` ${(share * 100).toFixed(0)}%`}</div>`
      : `<div class="sw"><i class="none"></i>${label} null</div>`;
  const cand = (c: Cluster) =>
    `<div class="sw k"><i style="background:${c.hex}"></i>${c.hex} ${(c.share * 100).toFixed(1)}% C${c.chroma.toFixed(2)}</div>`;
  for (let p = 0; p < pages; p++) {
    const cells = files
      .slice(p * PER_PAGE, (p + 1) * PER_PAGE)
      .map((f) => {
        const e = entries[f];
        const tag = e.overridden ? `<div class="ov">override</div>` : "";
        return `<div class="c"><img src="${iconUrl}/${f}"><div class="n">${f}</div>${tag}${sw("P", e.primary, e.primaryShare, e.overridden)}${sw("S", e.secondary, e.secondaryShare, e.overridden)}${e.candidates.map(cand).join("")}</div>`;
      })
      .join("");
    const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#18181b;color:#e4e4e7;font:11px sans-serif}
.g{display:grid;grid-template-columns:repeat(8,1fr);grid-template-rows:repeat(5,1fr);height:1200px;width:1600px;gap:4px;padding:4px;box-sizing:border-box}
.c{background:#27272a;padding:4px;overflow:hidden;display:flex;flex-direction:column;align-items:center}
img{width:90px;height:90px;object-fit:contain}
.n{font-size:9px;word-break:break-all;text-align:center}
.ov{font-size:10px;font-weight:700;color:#18181b;background:#f97316;padding:0 4px;border-radius:2px}
.sw{display:flex;align-items:center;gap:4px;font-size:10px}
.k{font-size:9px;color:#a1a1aa}
.sw i{width:12px;height:12px;display:inline-block;border:1px solid #52525b}
.none{background:transparent}
</style><div class="g">${cells}</div>`;
    writeFileSync(join(reviewDir, `review-${p + 1}.html`), html);
  }
  console.log(`Wrote ${pages} review pages → ${reviewDir}`);
}

async function main() {
  const files = readdirSync(ICON_DIR)
    .filter((f) => /\.(webp|png)$/.test(f))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const entries: Record<string, Entry> = {};
  for (const f of files) entries[f] = applyOverride(f, await extract(f));

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
  const ri = process.argv.indexOf("--review");
  if (ri !== -1) {
    const next = process.argv[ri + 1];
    writeReview(files, entries, resolve(next && !next.startsWith("--") ? next : DEFAULT_REVIEW_DIR));
  }
}

main();
