/**
 * Country / nationality utilities powered by i18n-iso-countries.
 *
 * The app still accepts ISO alpha-2 codes for most countries, but also supports
 * football-specific identities where the sport diverges from ISO country data.
 */
import countries from "i18n-iso-countries";
import { hasFlag } from "country-flag-icons";
import enLocale from "i18n-iso-countries/langs/en.json";
import esLocale from "i18n-iso-countries/langs/es.json";
import ptLocale from "i18n-iso-countries/langs/pt.json";
import frLocale from "i18n-iso-countries/langs/fr.json";
import deLocale from "i18n-iso-countries/langs/de.json";
import itLocale from "i18n-iso-countries/langs/it.json";

// Register locales we support
countries.registerLocale(enLocale);
countries.registerLocale(esLocale);
countries.registerLocale(ptLocale);
countries.registerLocale(frLocale);
countries.registerLocale(deLocale);
countries.registerLocale(itLocale);

export type SupportedLocale = "en" | "es" | "pt" | "fr" | "de" | "it";
export const SUPPORTED_LOCALES: SupportedLocale[] = ["en", "es", "pt", "fr", "de", "it"];

interface LegacyNationalIdentityDefinition {
  code: string;
  names: Record<SupportedLocale, string>;
  aliases: string[];
  flagCode?: string;
  selectable?: boolean;
}

const LEGACY_NATIONAL_IDENTITIES: Record<string, LegacyNationalIdentityDefinition> = {
  ENG: {
    code: "ENG",
    names: {
      en: "England",
      es: "Inglaterra",
      pt: "Inglaterra",
      fr: "Angleterre",
      de: "England",
      it: "Inghilterra",
    },
    aliases: ["english", "england"],
    selectable: true,
  },
  SCO: {
    code: "SCO",
    names: {
      en: "Scotland",
      es: "Escocia",
      pt: "Escócia",
      fr: "Écosse",
      de: "Schottland",
      it: "Scozia",
    },
    aliases: ["scottish", "scotland"],
    selectable: true,
  },
  WAL: {
    code: "WAL",
    names: {
      en: "Wales",
      es: "Gales",
      pt: "País de Gales",
      fr: "Pays de Galles",
      de: "Wales",
      it: "Galles",
    },
    aliases: ["welsh", "wales"],
    selectable: true,
  },
  NIR: {
    code: "NIR",
    names: {
      en: "Northern Ireland",
      es: "Irlanda del Norte",
      pt: "Irlanda do Norte",
      fr: "Irlande du Nord",
      de: "Nordirland",
      it: "Irlanda del Nord",
    },
    aliases: ["northern irish", "northern ireland"],
    selectable: true,
  },
  IE: {
    code: "IE",
    names: {
      en: "Republic of Ireland",
      es: "República de Irlanda",
      pt: "República da Irlanda",
      fr: "République d'Irlande",
      de: "Republik Irland",
      it: "Repubblica d'Irlanda",
    },
    aliases: ["irish", "republic of ireland", "ireland"],
    flagCode: "IE",
    selectable: true,
  },
};

const ALIAS_TO_CODE = Object.values(LEGACY_NATIONAL_IDENTITIES).reduce<Record<string, string>>(
  (map, identity) => {
    for (const alias of identity.aliases) {
      map[alias] = identity.code;
    }
    return map;
  },
  {
    british: "GB",
    uk: "GB",
    "united kingdom": "GB",
    "great britain": "GB",
  },
);

function getBaseLocale(locale: string): string {
  if (!locale) return "en";
  // Convert 'pt-BR' to 'pt'
  return locale.split('-')[0].toLowerCase();
}

function getFootballIdentity(code: string): LegacyNationalIdentityDefinition | undefined {
  return LEGACY_NATIONAL_IDENTITIES[code.toUpperCase()];
}

function getFootballIdentityName(code: string, locale: string): string | null {
  const identity = getFootballIdentity(code);
  if (!identity) {
    return null;
  }

  const baseLocale = getBaseLocale(locale) as SupportedLocale;
  return identity.names[baseLocale] ?? identity.names.en;
}

/**
 * Get the localised country name for an ISO alpha-2 code.
 * Falls back to English if the locale doesn't have a translation.
 */
export function countryName(alpha2: string, locale = "en"): string {
  if (!alpha2) return "";
  const normalisedCode = normaliseNationality(alpha2).toUpperCase();
  const footballIdentityName = getFootballIdentityName(normalisedCode, locale);

  if (footballIdentityName) {
    return footballIdentityName;
  }

  const baseLocale = getBaseLocale(locale);
  const name = countries.getName(normalisedCode, baseLocale);
  if (name) return name;
  // Fallback to English
  return countries.getName(normalisedCode, "en") ?? alpha2;
}

/**
 * Get all country entries as { code, name } sorted by name in the given locale.
 */
export function allCountries(locale = "en"): { code: string; name: string }[] {
  const baseLocale = getBaseLocale(locale);
  const obj = countries.getNames(baseLocale, { select: "official" });
  
  // If we couldn't find the names for the requested locale, fallback to English
  if (!obj || Object.keys(obj).length === 0) {
    const fallbackObj = countries.getNames("en", { select: "official" });
    return Object.entries(fallbackObj)
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "en"));
  }

  return Object.entries(obj)
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name, baseLocale));
}

/**
 * Get selectable nationalities for football-facing UI.
 * This excludes legacy GB while surfacing the UK football nations explicitly.
 */
export function allNationalities(locale = "en"): { code: string; name: string }[] {
  const legacyCodes = new Set(
    Object.values(LEGACY_NATIONAL_IDENTITIES)
      .filter((identity) => identity.selectable)
      .map((identity) => identity.code),
  );

  const isoNationalities = allCountries(locale)
    .filter(({ code }) => code !== "GB" && !legacyCodes.has(code))
    .map(({ code }) => ({ code, name: countryName(code, locale) }));

  const footballNationalities = Object.values(LEGACY_NATIONAL_IDENTITIES)
    .filter((identity) => identity.selectable)
    .map((identity) => ({
      code: identity.code,
      name: countryName(identity.code, locale),
    }));

  return [...footballNationalities, ...isoNationalities]
    .sort((a, b) => a.name.localeCompare(b.name, getBaseLocale(locale)));
}

/**
 * Validate that a string is a valid ISO alpha-2 country code.
 */
/** Get all lowercase names for a country code across all supported locales */
export function getAllCountryNames(code: string): Set<string> {
  const names = new Set<string>();
  for (const locale of SUPPORTED_LOCALES) {
    const name = countryName(code, locale);
    if (name) {
      names.add(name.toLowerCase());
    }
  }
  return names;
}

export function isValidCountryCode(code: string): boolean {
  if (!code) return false;

  const upper = code.toUpperCase();
  if (getFootballIdentity(upper)) {
    return true;
  }

  if (upper.length !== 2) return false;
  return countries.isValid(upper);
}

/**
 * Resolve a nationality value to a valid ISO alpha-2 code that has an SVG flag asset.
 */
export function resolveCountryFlagCode(value: string): string | null {
  const normalisedCode = normaliseNationality(value).toUpperCase();

  const footballIdentity = getFootballIdentity(normalisedCode);
  if (footballIdentity?.flagCode) {
    return footballIdentity.flagCode;
  }

  if (!isValidCountryCode(normalisedCode)) {
    return null;
  }

  return hasFlag(normalisedCode) ? normalisedCode : null;
}

/**
 * Map from old demonym-style nationality strings to ISO alpha-2 codes.
 * Used for backward compatibility with older save files.
 */
const DEMONYM_TO_CODE: Record<string, string> = {
  English: "ENG",
  British: "GB",
  Scottish: "SCO",
  Welsh: "WAL",
  Irish: "IE",
  "Northern Irish": "NIR",
  Spanish: "ES",
  German: "DE",
  French: "FR",
  Italian: "IT",
  Dutch: "NL",
  Portuguese: "PT",
  Brazilian: "BR",
  Argentine: "AR",
  Colombian: "CO",
  Belgian: "BE",
  Swedish: "SE",
  Norwegian: "NO",
  Danish: "DK",
  Croatian: "HR",
  Serbian: "RS",
  Swiss: "CH",
  Austrian: "AT",
  // Full country names (from data exports)
  "United States": "US",
  China: "CN",
  "South Korea": "KR",
  Brazil: "BR",
  Spain: "ES",
  Poland: "PL",
  Turkey: "TR",
  Taiwan: "TW",
  Vietnam: "VN",
  "Czech Republic": "CZ",
  Canada: "CA",
  Chile: "CL",
  Mexico: "MX",
  Netherlands: "NL",
  Greece: "GR",
  Portugal: "PT",
  Sweden: "SE",
  Denmark: "DK",
  Japan: "JP",
  Australia: "AU",
  "United Kingdom": "GB",
  Colombia: "CO",
  Russia: "RU",
  Italy: "IT",
  Peru: "PE",
  Thailand: "TH",
  Philippines: "PH",
  Malaysia: "MY",
  Singapore: "SG",
  Indonesia: "ID",
  "South Africa": "ZA",
  Ukraine: "UA",
  Romania: "RO",
  Hungary: "HU",
  Finland: "FI",
  Bulgaria: "BG",
  Slovakia: "SK",
  Lithuania: "LT",
  Latvia: "LV",
  Estonia: "EE",
  Slovenia: "SI",
  Luxembourg: "LU",
  Cyprus: "CY",
  Malta: "MT",
  Iceland: "IS",
  Montenegro: "ME",
  "North Macedonia": "MK",
  Albania: "AL",
  Bosnia: "BA",
  Georgia: "GE",
  Armenia: "AM",
  Kazakhstan: "KZ",
  Mongolia: "MN",
  "New Zealand": "NZ",
  "Saudi Arabia": "SA",
  "United Arab Emirates": "AE",
  Qatar: "QA",
  Israel: "IL",
  India: "IN",
  Pakistan: "PK",
  Bangladesh: "BD",
  "Sri Lanka": "LK",
  Nepal: "NP",
  Morocco: "MA",
  Egypt: "EG",
  Tunisia: "TN",
  Algeria: "DZ",
  Nigeria: "NG",
  Kenya: "KE",
  Ghana: "GH",
  Ethiopia: "ET",
  Angola: "AO",
  Mozambique: "MZ",
  Venezuela: "VE",
  Ecuador: "EC",
  Uruguay: "UY",
  Paraguay: "PY",
  Bolivia: "BO",
  "Costa Rica": "CR",
  Panama: "PA",
  Guatemala: "GT",
  "Dominican Republic": "DO",
  Honduras: "HN",
  "El Salvador": "SV",
  Cuba: "CU",
  Jamaica: "JM",
  "Trinidad and Tobago": "TT",
  // Portuguese variants
  Brasil: "BR",
  "Estados Unidos": "US",
  "Reino Unido": "GB",
  Alemanha: "DE",
  França: "FR",
  Espanha: "ES",
  Itália: "IT",
  Holanda: "NL",
  Suécia: "SE",
  Dinamarca: "DK",
  Polônia: "PL",
  Argentina: "AR",
  Colômbia: "CO",
  México: "MX",
  Uruguai: "UY",
  Paraguai: "PY",
  Bolívia: "BO",
  // Spanish variants
  "Corea del Sur": "KR",
  Alemania: "DE",
  Francia: "FR",
  Italia: "IT",
  "Países Bajos": "NL",
  Suecia: "SE",
  Polonia: "PL",
  Perú: "PE",
  Turquía: "TR",
  Rusia: "RU",
  Japón: "JP",
  Canadá: "CA",
};

const DEMONYM_TO_CODE_LOWER: Record<string, string> = Object.fromEntries(
  Object.entries(DEMONYM_TO_CODE).map(([name, code]) => [name.toLowerCase(), code]),
);

/** Short spellings the data uses that the English country list does not carry. */
const NAME_ALIAS_TO_CODE: Record<string, string> = { korea: "KR" };

/** Full English country name (case-insensitive) to its alpha-2 code. */
function countryNameToCode(value: string): string | undefined {
  const name = value.trim();
  // Three letters or fewer is a code or an abbreviation ("USA"), never a full name.
  if (name.length <= 3) return undefined;
  return NAME_ALIAS_TO_CODE[name.toLowerCase()] ?? countries.getAlpha2Code(name, "en");
}

/**
 * Normalise a nationality value: if it's already an alpha-2 code, return it;
 * if it's a demonym string from an old save, convert it.
 */
export function normaliseNationality(value: string): string {
  if (!value) return "";
  const upper = value.toUpperCase();
  if (getFootballIdentity(upper)) return upper;
  // Already a valid 2-letter code?
  if (upper.length === 2 && countries.isValid(upper)) return upper;
  const alias = ALIAS_TO_CODE[value.trim().toLowerCase()];
  if (alias) return alias;
  // Try demonym map, then the same names ignoring case, then any English country name.
  return (
    DEMONYM_TO_CODE[value] ??
    DEMONYM_TO_CODE_LOWER[value.trim().toLowerCase()] ??
    countryNameToCode(value) ??
    value
  );
}

export { countries };
