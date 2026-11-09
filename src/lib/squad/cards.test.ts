import { beforeEach, describe, expect, it } from "vitest";
import type { PlayerData } from "@/store/types";
import { setActiveCurrency } from "@/lib/formatting/valueFormatting";
import { getPlayerCardModel, shortRoleKey } from "./cards";

const CTX = { currentDate: "2026-03-08T00:00:00Z", locale: "en" };

function make(extra: Partial<PlayerData> = {}): PlayerData {
  return {
    id: "p1",
    match_name: "Caps",
    full_name: "Rasmus Winther",
    date_of_birth: "2000-03-09",
    nationality: "DK",
    nationality_code: "DK",
    position: "MID",
    natural_position: "MID",
    condition: 80,
    morale: 70,
    wage: 354000,
    contract_end: "2028-06-30",
    transfer_listed: false,
    lol_ovr: 88,
    ...extra,
  } as unknown as PlayerData;
}

describe("getPlayerCardModel", () => {
  beforeEach(() => setActiveCurrency("EUR"));

  it("maps the core fields", () => {
    expect(getPlayerCardModel(make(), CTX)).toMatchObject({
      id: "p1",
      name: "Caps",
      role: "MID",
      ovr: 88,
      age: 25,
      wage: 354000,
      energy: 80,
      morale: 70,
      contractEnd: "2028-06-30",
      nationalityCode: "DK",
      transferListed: false,
      isImport: false,
    });
  });

  it("formats the wage with full precision and the active currency", () => {
    expect(getPlayerCardModel(make(), CTX).wageLabel).toBe("€354,000");
    setActiveCurrency("USD");
    expect(getPlayerCardModel(make({ wage: 1250000 }), CTX).wageLabel).toBe("$1,250,000");
  });

  it("derives a compact wage, a readable contract date and the country name", () => {
    const model = getPlayerCardModel(make(), CTX);
    expect(model.wageCompact).toBe("€354K");
    expect(model.contractEndLabel).toMatch(/Jun/);
    expect(model.contractEndLabel).toMatch(/30/);
    expect(model.contractEndLabel).toBe(new Date("2028-06-30T00:00:00Z").toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }));
    expect(model.nationalityName).toBe("Denmark");
    const bare = getPlayerCardModel(make({ contract_end: null, nationality: "", nationality_code: undefined }), CTX);
    expect(bare.contractEndLabel).toBeNull();
    expect(bare.nationalityName).toBeNull();
  });

  it("keeps a missing fitness as null instead of inventing one", () => {
    expect(getPlayerCardModel(make(), CTX).fitness).toBeNull();
    expect(getPlayerCardModel(make({ fitness: 64 }), CTX).fitness).toBe(64);
  });

  it.each([
    ["2026-06-01", "critical"],
    ["2026-12-01", "warning"],
    ["2028-06-30", "ok"],
  ])("grades contract ending %s as %s", (end, risk) => {
    expect(getPlayerCardModel(make({ contract_end: end }), CTX).contractRisk).toBe(risk);
  });

  it("has no contract risk without a contract", () => {
    const model = getPlayerCardModel(make({ contract_end: null }), CTX);
    expect(model.contractRisk).toBeNull();
    expect(model.contractEnd).toBeNull();
  });

  it("computes age as of the game date and nulls an unreadable birth date", () => {
    expect(getPlayerCardModel(make({ date_of_birth: "2000-03-08" }), CTX).age).toBe(26);
    expect(getPlayerCardModel(make({ date_of_birth: "nonsense" }), CTX).age).toBeNull();
  });

  it("carries import and transfer flags", () => {
    const model = getPlayerCardModel(make({ is_import: true, transfer_listed: true, nationality_code: undefined }), CTX);
    expect(model).toMatchObject({ isImport: true, transferListed: true, nationalityCode: null });
  });
});

describe("shortRoleKey", () => {
  it("builds the onAir role key", () => {
    expect(shortRoleKey("ADC")).toBe("onAir.roles.ADC");
  });
});
