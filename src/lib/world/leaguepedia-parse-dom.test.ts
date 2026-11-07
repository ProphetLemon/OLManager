// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

// Every jsdom window the parser opens is recorded, so the test can check that each one was closed.
const { windows } = vi.hoisted(() => ({ windows: [] as Array<{ close: { mock: { calls: unknown[] } } }> }));

vi.mock("jsdom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jsdom")>();
  class TrackedJSDOM extends actual.JSDOM {
    constructor(...args: ConstructorParameters<typeof actual.JSDOM>) {
      super(...args);
      windows.push({ close: vi.spyOn(this.window, "close") });
    }
  }
  return { ...actual, JSDOM: TrackedJSDOM };
});

const { parseActiveRoster, parseIntro, parseStaffTable } = await import("../../../scripts/world/lib/leaguepedia-parse.mjs");

const ROSTER_HTML = `<table class="team-members-current"><tr>
  <td class="team-members-player" data-player-id="Faker (Lee Sang-hyeok)"><a>Faker</a></td>
  <td class="team-members-irlname">Lee Sang-hyeok</td>
  <td class="team-members-role"><span class="markup-object-name">Mid Laner</span></td>
</tr></table>`;
const STAFF_HTML = `<table class="listplayer-table"><tr>
  <td><span class="country-sprite" title="South Korea"></span></td><td><a title="kkOma">kkOma</a></td>
  <td>Kim Jeong-gyun</td><td><b>Head Coach</b></td>
</tr></table>`;
const INTRO_HTML = "<p>Faker is a South Korean esports player, currently mid laner for T1.</p>";

describe("Leaguepedia HTML parsing releases its jsdom windows", () => {
  // An unclosed window lives until its pending load tasks run. An offline refresh reads every answer from
  // the cache without yielding to the event loop, so thousands of windows piled up and the run ran out of memory.
  it("closes the window of every page it parses and still returns the parsed data", () => {
    windows.length = 0;

    expect(parseActiveRoster(ROSTER_HTML)).toMatchObject([{ ign: "Faker", realName: "Lee Sang-hyeok", position: "Mid" }]);
    expect(parseStaffTable(STAFF_HTML)).toMatchObject([{ ign: "kkOma", roleLabel: "Head Coach" }]);
    expect(parseIntro(INTRO_HTML)).toEqual({ state: "currently", teamText: "mid laner for T1" });

    expect(windows).toHaveLength(3);
    for (const window of windows) expect(window.close.mock.calls).toHaveLength(1);
  });
});
