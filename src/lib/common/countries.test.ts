import { describe, it, expect } from "vitest";
import {
  countryName,
  allCountries,
  allNationalities,
  isValidCountryCode,
  normaliseNationality,
  resolveCountryFlagCode,
} from "./countries";

// ---------------------------------------------------------------------------
// resolveCountryFlagCode
// ---------------------------------------------------------------------------

describe("resolveCountryFlagCode", () => {
  it("returns a valid code when an SVG flag is available", () => {
    expect(resolveCountryFlagCode("US")).toBe("US");
    expect(resolveCountryFlagCode("GB")).toBe("GB");
    expect(resolveCountryFlagCode("br")).toBe("BR");
    expect(resolveCountryFlagCode("IE")).toBe("IE");
  });

  it("normalises demonym values before resolving", () => {
    expect(resolveCountryFlagCode("English")).toBeNull();
    expect(resolveCountryFlagCode("Brazilian")).toBe("BR");
    expect(resolveCountryFlagCode("Irish")).toBe("IE");
  });

  it("returns null for invalid values", () => {
    expect(resolveCountryFlagCode("")).toBeNull();
    expect(resolveCountryFlagCode("X")).toBeNull();
    expect(resolveCountryFlagCode("USA")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// countryName
// ---------------------------------------------------------------------------

describe("countryName", () => {
  it("returns English country name by default", () => {
    expect(countryName("GB")).toMatch(/United Kingdom/);
    expect(countryName("US")).toMatch(/United States/);
    expect(countryName("ENG")).toBe("England");
  });

  it("returns localised name for supported locales", () => {
    const nameDe = countryName("FR", "de");
    expect(nameDe).toBe("Frankreich");

    const nameEs = countryName("DE", "es");
    expect(nameEs).toBe("Alemania");

    const nameIt = countryName("DE", "it");
    expect(nameIt).toBe("Germania");

    const englandEs = countryName("ENG", "es");
    expect(englandEs).toBe("Inglaterra");
  });

  it("falls back to English for unknown locale", () => {
    const name = countryName("IT", "xx");
    expect(name).toMatch(/Italy/);
  });

  it("returns empty string for empty input", () => {
    expect(countryName("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// allCountries
// ---------------------------------------------------------------------------

describe("allCountries", () => {
  it("returns an array of { code, name } objects", () => {
    const list = allCountries("en");
    expect(list.length).toBeGreaterThan(100);
    expect(list[0]).toHaveProperty("code");
    expect(list[0]).toHaveProperty("name");
  });

  it("is sorted by name", () => {
    const list = allCountries("en");
    for (let i = 1; i < list.length; i++) {
      expect(list[i].name.localeCompare(list[i - 1].name, "en")).toBeGreaterThanOrEqual(0);
    }
  });

  it("contains well-known countries", () => {
    const list = allCountries("en");
    const codes = list.map(c => c.code);
    expect(codes).toContain("US");
    expect(codes).toContain("GB");
    expect(codes).toContain("BR");
  });

  it("returns Italian country names when requested", () => {
    const list = allCountries("it");
    const germany = list.find((country) => country.code === "DE");

    expect(germany?.name).toBe("Germania");
  });
});

describe("allNationalities", () => {
  it("surfaces football nations and excludes legacy GB from the selectable list", () => {
    const list = allNationalities("en");
    const codes = list.map((country) => country.code);

    expect(codes).toContain("ENG");
    expect(codes).toContain("SCO");
    expect(codes).toContain("WAL");
    expect(codes).toContain("NIR");
    expect(codes).toContain("IE");
    expect(codes).not.toContain("GB");
  });
});

// ---------------------------------------------------------------------------
// isValidCountryCode
// ---------------------------------------------------------------------------

describe("isValidCountryCode", () => {
  it("returns true for valid alpha-2 codes", () => {
    expect(isValidCountryCode("US")).toBe(true);
    expect(isValidCountryCode("GB")).toBe(true);
    expect(isValidCountryCode("br")).toBe(true); // case-insensitive
    expect(isValidCountryCode("ENG")).toBe(true);
    expect(isValidCountryCode("NIR")).toBe(true);
  });

  it("returns false for invalid codes", () => {
    expect(isValidCountryCode("")).toBe(false);
    expect(isValidCountryCode("X")).toBe(false);
    expect(isValidCountryCode("ZZ")).toBe(false);
    expect(isValidCountryCode("USA")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// normaliseNationality
// ---------------------------------------------------------------------------

describe("normaliseNationality", () => {
  it("returns alpha-2 code as-is if already valid", () => {
    expect(normaliseNationality("GB")).toBe("GB");
    expect(normaliseNationality("ES")).toBe("ES");
    expect(normaliseNationality("ENG")).toBe("ENG");
  });

  it("converts known demonyms to alpha-2 codes", () => {
    expect(normaliseNationality("English")).toBe("ENG");
    expect(normaliseNationality("Scottish")).toBe("SCO");
    expect(normaliseNationality("Welsh")).toBe("WAL");
    expect(normaliseNationality("Irish")).toBe("IE");
    expect(normaliseNationality("Northern Irish")).toBe("NIR");
    expect(normaliseNationality("Spanish")).toBe("ES");
    expect(normaliseNationality("Brazilian")).toBe("BR");
    expect(normaliseNationality("German")).toBe("DE");
    expect(normaliseNationality("French")).toBe("FR");
  });

  it("returns the original value for unknown demonyms", () => {
    expect(normaliseNationality("Martian")).toBe("Martian");
  });

  it("returns empty string for empty input", () => {
    expect(normaliseNationality("")).toBe("");
  });

  it("reads full country names case-insensitively", () => {
    expect(normaliseNationality("Germany")).toBe("DE");
    expect(normaliseNationality("France")).toBe("FR");
    expect(normaliseNationality("Korea")).toBe("KR");
    expect(normaliseNationality("South korea")).toBe("KR");
    expect(normaliseNationality("Hong Kong")).toBe("HK");
    expect(normaliseNationality("Austria")).toBe("AT");
    expect(normaliseNationality("Jordan")).toBe("JO");
    expect(normaliseNationality("Belgium")).toBe("BE");
    expect(normaliseNationality("germany")).toBe("DE");
    expect(normaliseNationality("  FRANCE ")).toBe("FR");
    expect(normaliseNationality("hong kong")).toBe("HK");
  });

  it("shows a flag for the full names the game data ships", () => {
    for (const name of ["Germany", "France", "Korea", "South korea", "Hong Kong", "Austria", "Jordan", "Belgium"]) {
      expect(resolveCountryFlagCode(name)).not.toBeNull();
    }
    expect(resolveCountryFlagCode("Germany")).toBe("DE");
  });

  it("keeps unreadable values unchanged", () => {
    for (const value of ["K", "Atlantis", "Generated", "USA"]) {
      expect(normaliseNationality(value)).toBe(value);
    }
  });

  it("keeps the United Kingdom identities ahead of the generic country lookup", () => {
    expect(normaliseNationality("United Kingdom")).toBe("GB");
    expect(normaliseNationality("united kingdom")).toBe("GB");
    expect(normaliseNationality("England")).toBe("ENG");
    expect(normaliseNationality("Scotland")).toBe("SCO");
    expect(normaliseNationality("Wales")).toBe("WAL");
    expect(normaliseNationality("Northern Ireland")).toBe("NIR");
    expect(normaliseNationality("Ireland")).toBe("IE");
  });

  // Every key of the original demonym / full-name table, with the value it returned before full names were read
  // case-insensitively. The table must keep returning exactly these.
  const PINNED_MAPPINGS: Array<[string, string]> = [
  ["English", "ENG"], ["British", "GB"], ["Scottish", "SCO"], ["Welsh", "WAL"], ["Irish", "IE"],
  ["Northern Irish", "NIR"], ["Spanish", "ES"], ["German", "DE"], ["French", "FR"], ["Italian", "IT"],
  ["Dutch", "NL"], ["Portuguese", "PT"], ["Brazilian", "BR"], ["Argentine", "AR"], ["Colombian", "CO"],
  ["Belgian", "BE"], ["Swedish", "SE"], ["Norwegian", "NO"], ["Danish", "DK"], ["Croatian", "HR"], ["Serbian", "RS"],
  ["Swiss", "CH"], ["Austrian", "AT"], ["United States", "US"], ["China", "CN"], ["South Korea", "KR"],
  ["Brazil", "BR"], ["Spain", "ES"], ["Poland", "PL"], ["Turkey", "TR"], ["Taiwan", "TW"], ["Vietnam", "VN"],
  ["Czech Republic", "CZ"], ["Canada", "CA"], ["Chile", "CL"], ["Mexico", "MX"], ["Netherlands", "NL"],
  ["Greece", "GR"], ["Portugal", "PT"], ["Sweden", "SE"], ["Denmark", "DK"], ["Japan", "JP"], ["Australia", "AU"],
  ["United Kingdom", "GB"], ["Colombia", "CO"], ["Russia", "RU"], ["Italy", "IT"], ["Peru", "PE"],
  ["Thailand", "TH"], ["Philippines", "PH"], ["Malaysia", "MY"], ["Singapore", "SG"], ["Indonesia", "ID"],
  ["South Africa", "ZA"], ["Ukraine", "UA"], ["Romania", "RO"], ["Hungary", "HU"], ["Finland", "FI"],
  ["Bulgaria", "BG"], ["Slovakia", "SK"], ["Lithuania", "LT"], ["Latvia", "LV"], ["Estonia", "EE"],
  ["Slovenia", "SI"], ["Luxembourg", "LU"], ["Cyprus", "CY"], ["Malta", "MT"], ["Iceland", "IS"],
  ["Montenegro", "ME"], ["North Macedonia", "MK"], ["Albania", "AL"], ["Bosnia", "BA"], ["Georgia", "GE"],
  ["Armenia", "AM"], ["Kazakhstan", "KZ"], ["Mongolia", "MN"], ["New Zealand", "NZ"], ["Saudi Arabia", "SA"],
  ["United Arab Emirates", "AE"], ["Qatar", "QA"], ["Israel", "IL"], ["India", "IN"], ["Pakistan", "PK"],
  ["Bangladesh", "BD"], ["Sri Lanka", "LK"], ["Nepal", "NP"], ["Morocco", "MA"], ["Egypt", "EG"], ["Tunisia", "TN"],
  ["Algeria", "DZ"], ["Nigeria", "NG"], ["Kenya", "KE"], ["Ghana", "GH"], ["Ethiopia", "ET"], ["Angola", "AO"],
  ["Mozambique", "MZ"], ["Venezuela", "VE"], ["Ecuador", "EC"], ["Uruguay", "UY"], ["Paraguay", "PY"],
  ["Bolivia", "BO"], ["Costa Rica", "CR"], ["Panama", "PA"], ["Guatemala", "GT"], ["Dominican Republic", "DO"],
  ["Honduras", "HN"], ["El Salvador", "SV"], ["Cuba", "CU"], ["Jamaica", "JM"], ["Trinidad and Tobago", "TT"],
  ["Brasil", "BR"], ["Estados Unidos", "US"], ["Reino Unido", "GB"], ["Alemanha", "DE"], ["França", "FR"],
  ["Espanha", "ES"], ["Itália", "IT"], ["Holanda", "NL"], ["Suécia", "SE"], ["Dinamarca", "DK"], ["Polônia", "PL"],
  ["Argentina", "AR"], ["Colômbia", "CO"], ["México", "MX"], ["Uruguai", "UY"], ["Paraguai", "PY"],
  ["Bolívia", "BO"], ["Corea del Sur", "KR"], ["Alemania", "DE"], ["Francia", "FR"], ["Italia", "IT"],
  ["Países Bajos", "NL"], ["Suecia", "SE"], ["Polonia", "PL"], ["Perú", "PE"], ["Turquía", "TR"], ["Rusia", "RU"],
  ["Japón", "JP"], ["Canadá", "CA"],
  ];

  it.each(PINNED_MAPPINGS)("keeps the existing mapping %s -> %s", (input, expected) => {
    expect(normaliseNationality(input)).toBe(expected);
  });
});
