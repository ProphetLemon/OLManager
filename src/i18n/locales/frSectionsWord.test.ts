import { describe, expect, it } from "vitest";

import fr from "./fr.json";

describe("fr: one word for sections (R73)", () => {
  it("names the rail's group list and the palette group with the same word, Rubriques", () => {
    expect(fr.onAir.nav.sections).toBe("Rubriques {{group}}");
    expect(fr.onAir.palette.groups.sections).toBe("Rubriques");
  });
});
