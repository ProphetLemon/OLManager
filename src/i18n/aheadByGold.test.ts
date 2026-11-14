import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dir = resolve(__dirname, "locales");
const aheadByGold = (file: string): string => JSON.parse(readFileSync(resolve(dir, file), "utf8")).onAir.match.post.aheadByGold;

describe("onAir.match.post.aheadByGold", () => {
  const files = readdirSync(dir).filter((name) => name.endsWith(".json"));

  it("keeps its two placeholders in every locale", () => {
    expect(files.length).toBe(8);
    for (const file of files) {
      const text = aheadByGold(file);
      expect(text, file).toContain("{{team}}");
      expect(text, file).toContain("{{amount}}");
    }
  });

  it("does not double a preposition, as 'por delante por' did in Spanish (T13)", () => {
    for (const file of files) {
      const words = aheadByGold(file).replace(/\{\{\w+\}\}/g, "").toLowerCase().split(/\s+/).filter(Boolean);
      for (let i = 1; i < words.length; i += 1) {
        const doubled = ["por", "de", "um", "by", "di", "of"].includes(words[i]) && words[i] === words[i - 1];
        expect(doubled, `${file}: ${words.join(" ")}`).toBe(false);
      }
    }
    expect(aheadByGold("es.json")).not.toMatch(/por delante por/);
  });
});
