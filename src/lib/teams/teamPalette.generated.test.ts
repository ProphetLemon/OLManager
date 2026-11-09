import { readdirSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { TEAM_LOGO_PALETTE } from "./teamPalette.generated";

const logos = readdirSync(resolve("public/teams-icons")).filter((f) => /\.(webp|png)$/.test(f));
const HEX = /^#[0-9a-f]{6}$/;

describe("TEAM_LOGO_PALETTE", () => {
  it("has an entry for every logo file", () => {
    const missing = logos.filter((f) => !(f in TEAM_LOGO_PALETTE));
    expect(missing).toEqual([]);
  });

  it("has no stale keys", () => {
    const known = new Set(logos);
    const stale = Object.keys(TEAM_LOGO_PALETTE).filter((k) => !known.has(k));
    expect(stale).toEqual([]);
  });

  it("only holds null or lowercase #rrggbb values", () => {
    for (const [file, { primary, secondary }] of Object.entries(TEAM_LOGO_PALETTE)) {
      for (const v of [primary, secondary]) {
        expect(v === null || HEX.test(v), `${file}: ${v}`).toBe(true);
      }
    }
  });
});
