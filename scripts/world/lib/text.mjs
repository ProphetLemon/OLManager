// Text normalisation helpers shared by the parser, matcher and generator.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const countries = require("i18n-iso-countries");
countries.registerLocale(require("i18n-iso-countries/langs/en.json"));

/** Lowercase ASCII fold: "Óscar Muñoz" -> "oscar munoz". */
export function fold(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ø/gi, "o")
    .replace(/ß/g, "ss")
    .toLowerCase();
}

/** Compact identity key for IGNs: letters and digits only. */
export function compactKey(value) {
  return fold(value).replace(/[^a-z0-9]/g, "");
}

export function stripParenthetical(value) {
  return String(value ?? "").replace(/\s*\([^)]*\)\s*/g, " ").trim();
}

/** Real-name tokens in two granularities so "Dong-ju" and "Dongju" compare equal. */
export function nameTokens(value) {
  const folded = fold(stripParenthetical(value));
  const words = new Set(
    folded
      .split(/\s+/)
      .map((w) => w.replace(/[^a-z0-9]/g, ""))
      .filter(Boolean),
  );
  const parts = new Set(folded.split(/[^a-z0-9]+/).filter(Boolean));
  return { words, parts };
}

const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const overlap = (a, b) => [...a].filter((x) => b.has(x)).length;

/** @returns {"equal"|"overlap"|"conflict"|"unknown"} */
export function nameRelation(a, b) {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.words.size === 0 || tb.words.size === 0) return "unknown";
  if (sameSet(ta.words, tb.words) || sameSet(ta.parts, tb.parts)) return "equal";
  if ([...ta.words].sort().join("") === [...tb.words].sort().join("")) return "equal";
  const shared = Math.max(overlap(ta.words, tb.words), overlap(ta.parts, tb.parts));
  const smallest = Math.min(ta.words.size, tb.words.size);
  if (shared >= 2 || (smallest === 1 && shared === 1)) return "overlap";
  return "conflict";
}

const COUNTRY_ALIASES = {
  korea: "KR",
  "south korea": "KR",
  "republic of korea": "KR",
  taiwan: "TW",
  "hong kong": "HK",
  macau: "MO",
  vietnam: "VN",
  russia: "RU",
  turkey: "TR",
  turkiye: "TR",
  "united states": "US",
  usa: "US",
  "united kingdom": "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  "northern ireland": "GB",
  "czech republic": "CZ",
  czechia: "CZ",
  "north macedonia": "MK",
  "ivory coast": "CI",
  "cape verde": "CV",
  kosovo: "XK",
  "china": "CN",
};

/** Country name (any common spelling) or ISO-2 code -> upper-case ISO-2, or "" when unknown. */
export function countryToIso2(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  const alias = COUNTRY_ALIASES[fold(raw).trim()];
  if (alias) return alias;
  return countries.getAlpha2Code(raw, "en") ?? "";
}

export function pythonishDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")) ? String(value) : null;
}
