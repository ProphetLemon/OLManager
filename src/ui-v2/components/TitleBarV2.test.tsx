import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { APP_EDITION } from "@/lib/common/edition";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    i18n: { language: "es" },
    t: (key: string, opts?: { defaultValue?: string }) =>
      key === "titleBar.appName" ? "OL Manager" : (opts?.defaultValue ?? key),
  }),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: () => Promise.resolve(false),
    onResized: () => Promise.resolve(() => {}),
  }),
}));

describe("TitleBarV2", () => {
  it("shows the app name followed by the edition", async () => {
    const { TitleBarV2 } = await import("./TitleBarV2");
    render(<TitleBarV2 />);

    expect(screen.getByText("OL Manager")).toBeInTheDocument();
    expect(screen.getByText(APP_EDITION)).toBeInTheDocument();
  });

  it("gives the edition the neutral name language so Turkish uppercasing does not dot it", async () => {
    const { TitleBarV2 } = await import("./TitleBarV2");
    render(<TitleBarV2 />);

    expect(screen.getByText(APP_EDITION)).toHaveAttribute("lang", "und");
  });

  it("sits on the rail surface token without wide tracking on the app name", async () => {
    const { TitleBarV2 } = await import("./TitleBarV2");
    const { container } = render(<TitleBarV2 />);

    const bar = container.firstElementChild as HTMLElement;
    expect(bar.className).toContain("bg-rail");
    expect(bar.className).not.toContain("zinc");
    expect(screen.getByText("OL Manager").className).not.toContain("tracking-widest");
    for (const button of screen.getAllByRole("button")) {
      expect(button.className).not.toContain("zinc");
    }
  });

  it("labels the window controls through t() with readable fallbacks", async () => {
    const { TitleBarV2 } = await import("./TitleBarV2");
    render(<TitleBarV2 />);

    expect(screen.getByRole("button", { name: "Minimize" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Maximize" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /titleBar\./ })).toBeNull();
  });
});
