import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNavMemoryStore } from "@/store/navMemoryStore";
import { splitNeed } from "@/ui-v2/shell/railMode";

vi.mock("@/ui-v2/_legacy/components/dashboard/ReportBugModal", () => ({ default: () => null }));

import { DashboardSidebarV2 } from "./DashboardSidebarV2";

/** Pseudo-localisation: every string grows to 1.4 times its length (long translations in de, fr, pt-BR). */
const grow = (s: string) => s.repeat(2).slice(0, Math.ceil(s.length * 1.4));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    i18n: { language: "xx" },
    t: (key: string, opts?: Record<string, unknown>) => {
      const count = opts?.count as number | undefined;
      const text =
        (count === 1 ? (opts?.defaultValue_one as string | undefined) : (opts?.defaultValue_other as string | undefined)) ??
        (opts?.defaultValue as string | undefined) ??
        key;
      return grow(text.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(opts?.[name] ?? "")));
    },
  }),
}));

type Props = React.ComponentProps<typeof DashboardSidebarV2>;

function setup(overrides: Partial<Props> = {}) {
  const props: Props = {
    activeTab: "Squad",
    onNavClick: vi.fn(),
    unreadMessagesCount: 0,
    managerName: "Boss",
    teamName: "Team",
    teamLogo: null,
    isUnemployed: false,
    onNavigateSettings: vi.fn(),
    onExitClick: vi.fn(),
    railMode: "split",
    ...overrides,
  };
  const view = render(<DashboardSidebarV2 {...props} />);
  return { props, rerender: (next: Partial<Props>) => view.rerender(<DashboardSidebarV2 {...props} {...next} />) };
}

const navId = (id: string) => document.querySelector<HTMLElement>(`[data-nav-id="${id}"]`)!;
const labelNodes = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>('[data-slot="rail-item-label"]')];
const panelLabels = () =>
  [...document.querySelectorAll<HTMLElement>('[data-slot="rail-panel"] [data-slot="rail-row"] > span[aria-hidden]:not([data-slot])')];

/** A label that wraps to `lines` lines: the measurer's spans report the height (jsdom has no layout). */
function wrapTo(lines: number) {
  return vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const h = this.closest('[data-slot="rail-measurer"]') && this.tagName === "SPAN" ? 16 * lines : 0;
    return { width: 0, height: h, top: 0, left: 0, right: 0, bottom: h, x: 0, y: 0, toJSON() {} } as DOMRect;
  });
}

beforeEach(() => useNavMemoryStore.getState().resetNavMemory());
afterEach(() => vi.restoreAllMocks());

const NEVER_CUT = ["line-clamp-2", "wrap-break-word", "hyphens-auto"];
const CUTTERS = ["truncate", "overflow-hidden", "text-ellipsis"];

function expectUncut(nodes: HTMLElement[]) {
  expect(nodes.length).toBeGreaterThan(0);
  for (const node of nodes) {
    for (const cls of NEVER_CUT) expect(node.className, `${node.textContent} ${cls}`).toContain(cls);
    for (const cls of CUTTERS) expect(node.className, `${node.textContent} ${cls}`).not.toContain(cls);
  }
}

describe("pseudo-localisation x1.4", () => {
  it("Split: stop and panel labels wrap in up to two lines and are never cut", () => {
    setup({ railSlot: { slotW: 960, slotH: 900, need: 622, rootPx: 16 } });
    expectUncut(labelNodes(document.body));
    expectUncut(panelLabels());
  });

  it("Split: accessible names stay complete", () => {
    setup({ unreadMessagesCount: 21 });
    expect(navId("tab:Inbox")).toHaveAccessibleName(`${grow("Inbox")}, 21`);
    for (const id of ["tab:Home", "group:club", "group:world"]) {
      expect(navId(id).getAttribute("aria-label")).toBeTruthy();
    }
    expect(navId("tab:Squad")).toHaveAccessibleName(grow("Squad"));
  });

  it("Android: same rules on the stops and the panel", () => {
    setup({ platform: "android" });
    expectUncut(labelNodes(document.body));
    expectUncut(panelLabels());
  });

  it("icon-only Split: no visible label to cut, the full name in the aria-label and the tip", () => {
    setup({ railSlot: { slotW: 960, slotH: 300, need: 622, rootPx: 16 } });
    expect(labelNodes(document.querySelector('[data-slot="rail-column"]')!)).toEqual([]);
    const stop = navId("tab:Inbox");
    expect(stop).toHaveAccessibleName(grow("Inbox"));
    act(() => stop.focus());
    expect(screen.getByRole("tooltip")).toHaveTextContent(grow("Inbox"));
    expectUncut(panelLabels());
  });

  it("Tree: rows are single-line by design, so the full text stays in the name and the title", () => {
    setup({ railMode: "tree" });
    for (const id of ["tab:Inbox", "group:club", "tab:Squad", "tab:Finances"]) {
      const row = navId(id);
      expect(row.getAttribute("title"), id).toBe(row.getAttribute("aria-label"));
      expect(row.getAttribute("aria-label")!.length, id).toBeGreaterThan(2);
    }
  });

  it("the Split decision moves with the measured line count", () => {
    const slotH = splitNeed(16, "labels", 1) + 20; // fits one line, not two
    expect(slotH).toBeLessThan(splitNeed(16, "labels", 2));

    let spy = wrapTo(1);
    const { rerender } = setup({ railSlot: { slotW: 960, slotH, need: 622, rootPx: 16 } });
    expect(labelNodes(document.querySelector('[data-slot="rail-column"]')!).length).toBeGreaterThan(0);
    spy.mockRestore();

    spy = wrapTo(2); // the strings grew: two lines
    rerender({ railSlot: { slotW: 960, slotH: slotH + 1, need: 622, rootPx: 16 } });
    expect(labelNodes(document.querySelector('[data-slot="rail-column"]')!)).toEqual([]);
    spy.mockRestore();
  });
});
