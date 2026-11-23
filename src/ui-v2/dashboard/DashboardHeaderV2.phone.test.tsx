import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DashboardHeaderV2 } from "@/ui-v2/dashboard/DashboardHeaderV2";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_k: string, o?: Record<string, unknown> & { defaultValue?: string }) =>
      (o?.defaultValue ?? _k).replace(/{{(\w+)}}/g, (_m, name: string) => String(o?.[name] ?? "")),
  }),
}));

const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; CPH2449) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";

type Props = React.ComponentProps<typeof DashboardHeaderV2>;

// jsdom has no layout: these tests pin which elements render and in what order. The bar's
// height, and that it stays one row at 804 x 360, are measured on the emulator.
function setup(extra: Partial<Props> = {}) {
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(ANDROID_UA);
  return render(
    <DashboardHeaderV2
      title="Squad"
      currentDate="Monday, 12 January"
      currentDateShort="Mon, Jan 12"
      backTo="Home"
      isAdvancing={false}
      isSaving={false}
      saveFlash={false}
      hasMatchToday={false}
      dayPhase="Morning"
      alerts={[]}
      onBack={vi.fn()}
      onSave={vi.fn()}
      onContinue={vi.fn()}
      onSkipToMatchDay={vi.fn()}
      onSkipToNextDay={vi.fn()}
      teamName="Night Owls"
      activeTab="Squad"
      more={<button type="button">More</button>}
      {...extra}
    />,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("DashboardHeaderV2 on the phone", () => {
  it("drops the club shield, the team name and the crumb, and keeps the title as h1", () => {
    setup();
    expect(screen.queryByText("Night Owls")).toBeNull();
    expect(document.querySelector('[data-slot="club-shield"]')).toBeNull();
    expect(document.querySelector('[data-slot="crumb"]')).toBeNull();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent("Squad");
    expect(h1).toHaveAttribute("title", "Squad");
  });

  it("is one row of the touch hit that never wraps, over the club rule", () => {
    setup();
    const row = document.querySelector('[data-slot="bar-row"]')!;
    expect(row.className).toContain("h-[var(--hit)]");
    expect(row.className).not.toContain("flex-wrap");
    expect(document.querySelector('[data-slot="bar-actions"]')!.className).not.toContain("flex-wrap");
    expect(document.querySelector('[data-slot="bar-rule"]')).not.toBeNull();
  });

  it("orders Back, title, date, More, Save, Continue, and puts More before Save", () => {
    setup();
    const order = [
      screen.getByRole("button", { name: "Back to Home" }),
      screen.getByRole("heading", { level: 1 }),
      screen.getByRole("group", { name: "Game date and phase" }),
      screen.getByRole("button", { name: "More" }),
      screen.getByRole("button", { name: "Save" }),
      screen.getByRole("button", { name: "Continue" }),
      screen.getByRole("button", { name: "More ways to advance" }),
    ];
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING, String(i)).toBeTruthy();
    }
  });

  it("shows the short date over the day phase in one compact block", () => {
    setup();
    const clock = screen.getByRole("group", { name: "Game date and phase" });
    expect(within(clock).getByText("Mon, Jan 12")).toBeInTheDocument();
    expect(within(clock).getByText("Morning")).toBeInTheDocument();
    expect(within(clock).queryByText("Monday, 12 January")).toBeNull();
    expect(clock.querySelector('[data-slot="tag-block"]')).toBeNull();
  });

  it("hides the date block on the end-of-season screen", () => {
    setup({ compact: true });
    expect(screen.queryByRole("group", { name: "Game date and phase" })?.className ?? "hidden").toContain("hidden");
  });

  it("keeps Back focusable and aria-disabled with nowhere to go, and the decisions chip", () => {
    setup({ backTo: null, callCount: 2, onShowCalls: vi.fn() });
    const back = screen.getByRole("button", { name: "Nothing to go back to" });
    expect(back).toHaveAttribute("aria-disabled", "true");
    expect(back).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "2 to resolve" })).toBeInTheDocument();
  });

  it("makes no room for More on a desktop user agent", () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (X11; Linux x86_64) Chrome/126.0");
    render(
      <DashboardHeaderV2
        title="Squad" currentDate="12 Jan" backTo={null} isAdvancing={false} isSaving={false}
        saveFlash={false} hasMatchToday={false} dayPhase="Morning" alerts={[]} onBack={vi.fn()}
        onSave={vi.fn()} onContinue={vi.fn()} onSkipToMatchDay={vi.fn()} onSkipToNextDay={vi.fn()}
        teamName="Night Owls" activeTab="Squad"
      />,
    );
    expect(screen.getByText("Night Owls")).toBeInTheDocument();
    expect(document.querySelector('[data-slot="bar-row"]')!.className).toContain("flex-wrap");
  });
});
