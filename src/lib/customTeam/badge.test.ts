import { describe, expect, it } from "vitest";

import { buildBadgeDataUri } from "./badge";

// Shared with the Rust `badge_data_uri` golden test (design badge contract).
const GOLDEN_UCM =
  "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20128%20128%22%3E%3Cpath%20d%3D%22M64%206L116%2022V62C116%2092%2094%20114%2064%20124C34%20114%2012%2092%2012%2062V22Z%22%20fill%3D%22%23f97316%22%20stroke%3D%22%2318181b%22%20stroke-width%3D%226%22%2F%3E%3Ctext%20x%3D%2264%22%20y%3D%2278%22%20text-anchor%3D%22middle%22%20font-family%3D%22sans-serif%22%20font-weight%3D%22800%22%20font-size%3D%2244%22%20fill%3D%22%2318181b%22%3EUCM%3C%2Ftext%3E%3C%2Fsvg%3E";
const GOLDEN_OLMX =
  "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20128%20128%22%3E%3Cpath%20d%3D%22M64%206L116%2022V62C116%2092%2094%20114%2064%20124C34%20114%2012%2092%2012%2062V22Z%22%20fill%3D%22%232563eb%22%20stroke%3D%22%23ffffff%22%20stroke-width%3D%226%22%2F%3E%3Ctext%20x%3D%2264%22%20y%3D%2278%22%20text-anchor%3D%22middle%22%20font-family%3D%22sans-serif%22%20font-weight%3D%22800%22%20font-size%3D%2236%22%20fill%3D%22%23ffffff%22%3EOLMX%3C%2Ftext%3E%3C%2Fsvg%3E";

describe("buildBadgeDataUri", () => {
  it("matches the golden string for a 3-letter short name", () => {
    expect(buildBadgeDataUri("UCM", "#f97316", "#18181b")).toBe(GOLDEN_UCM);
  });

  it("matches the golden string for a 4-letter short name (smaller font)", () => {
    expect(buildBadgeDataUri("OLMX", "#2563eb", "#ffffff")).toBe(GOLDEN_OLMX);
  });

  it("emits no raw angle brackets or spaces", () => {
    const uri = buildBadgeDataUri("UCM", "#f97316", "#18181b");
    expect(uri.slice("data:image/svg+xml;utf8,".length)).not.toMatch(/[<> ]/);
  });
});
